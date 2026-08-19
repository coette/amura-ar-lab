import { tuning } from "./tuner.js?v=11.2";
import { focalFromDiagonalFov } from "./wrist-pose.js?v=11.2";

// AMURA · AR-04 · PRUEBA P0 ↔ EJE ANTEBRAZO
// Diagnóstico independiente. No modifica AR-03, profundidad ni pose del reloj.
// Usa solo secciones lejanas del corredor y solo acepta la medida si el tubo
// completo es válido. La distancia se expresa en mm con la profundidad AR-04B.

const video = document.getElementById("cameraVideo");
const root = document.querySelector(".camera-lab") || document.body;

const MAX_SCAN_DIMENSION = 480;
const SCAN_INTERVAL_MS = 105;
const EDGE_MIN_CONTRAST = 13;

const SECTION_COUNT = 7;
const SECTION_START_MM = 12;
const SECTION_STEP_MM = 17;
const FAR_SECTION_START_INDEX = 3; // ≈63 mm desde P0; evita usar la zona inmediata a P0.
const MIN_VALID_SECTIONS = 4;
const MIN_CONSECUTIVE_SECTIONS = 3;
const MIN_FAR_SECTIONS = 3;

const FOREARM_MIN_WIDTH_MM = 42;
const FOREARM_MAX_WIDTH_MM = 100;
const WIDTH_MAX_CHANGE_MM = 20;
const LOCAL_RECENTER_MAX_MM = 8;
const LOCAL_TURN_MAX_RAD = 8 * Math.PI / 180;
const GLOBAL_ANGLE_MAX_RAD = 34 * Math.PI / 180;
const GLOBAL_LATERAL_MAX_MM = 48;

const scanCanvas = document.createElement("canvas");
const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });

const overlay = document.createElement("canvas");
overlay.id = "p0AxisTestCanvas";
overlay.setAttribute("aria-hidden", "true");
Object.assign(overlay.style, {
  position: "absolute",
  inset: "0",
  width: "100%",
  height: "100%",
  pointerEvents: "none",
  zIndex: "99990"
});
root.appendChild(overlay);
const ctx = overlay.getContext("2d");

const hud = document.createElement("div");
hud.id = "p0AxisTestHud";
Object.assign(hud.style, {
  position: "absolute",
  top: "calc(env(safe-area-inset-top, 0px) + 48px)",
  left: "10px",
  zIndex: "99999",
  minWidth: "235px",
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid rgba(0,229,255,.78)",
  background: "rgba(0,0,0,.84)",
  color: "#fff",
  font: "700 12px/1.42 ui-monospace, SFMono-Regular, Menlo, monospace",
  whiteSpace: "pre",
  pointerEvents: "none"
});
hud.textContent = "P0 ↔ EJE · esperando mano";
root.appendChild(hud);

let lastScanAt = 0;
let lastMeasurement = null;
let baselineOffsetMm = null;
let lastLoggedAt = 0;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const add2 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub2 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const scale2 = (v, scalar) => ({ x: v.x * scalar, y: v.y * scalar });
const dot2 = (a, b) => a.x * b.x + a.y * b.y;
const cross2 = (a, b) => a.x * b.y - a.y * b.x;

function normalize2(v) {
  if (!v) return null;
  const length = Math.hypot(Number(v.x) || 0, Number(v.y) || 0);
  if (length < 1e-7) return null;
  return { x: v.x / length, y: v.y / length };
}

function signedAngle2(a, b) {
  return Math.atan2(cross2(a, b), dot2(a, b));
}

function rotate2(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return normalize2({ x: v.x * c - v.y * s, y: v.x * s + v.y * c });
}

function parseVector(value) {
  const numbers = String(value || "")
    .split(",")
    .map((part) => Number(part.trim()));
  if (numbers.length !== 3 || numbers.some((number) => !Number.isFinite(number))) return null;
  return { x: numbers[0], y: numbers[1], z: numbers[2] };
}

function parseOrigin(value) {
  const numbers = String(value || "")
    .split(",")
    .map((part) => Number(part.trim()));
  if (numbers.length < 2 || !Number.isFinite(numbers[0]) || !Number.isFinite(numbers[1])) return null;
  return { x: numbers[0], y: numbers[1] };
}

function parseNumber(value) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function resizeOverlay() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (overlay.width !== pixelWidth || overlay.height !== pixelHeight) {
    overlay.width = pixelWidth;
    overlay.height = pixelHeight;
    overlay.style.width = width + "px";
    overlay.style.height = height + "px";
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

function videoPointToScreen(point) {
  if (!video || !video.videoWidth || !video.videoHeight || !point) return null;
  const rect = video.getBoundingClientRect();
  const coverScale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const renderedWidth = video.videoWidth * coverScale;
  const renderedHeight = video.videoHeight * coverScale;
  const offsetX = rect.left + (rect.width - renderedWidth) * 0.5;
  const offsetY = rect.top + (rect.height - renderedHeight) * 0.5;
  let x = offsetX + point.x * coverScale;
  const y = offsetY + point.y * coverScale;
  if (document.body && document.body.dataset.facing === "user") {
    x = rect.left + rect.width - (x - rect.left);
  }
  return { x, y };
}

function sampleRgb(data, width, height, x, y) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= width || iy >= height) return null;
  const index = (iy * width + ix) * 4;
  return [data[index], data[index + 1], data[index + 2]];
}

function edgeContrast(data, width, height, x, y, nx, ny) {
  const radius = 2.4;
  const a = sampleRgb(data, width, height, x + nx * radius, y + ny * radius);
  const b = sampleRgb(data, width, height, x - nx * radius, y - ny * radius);
  if (!a || !b) return 0;
  return (
    Math.abs(a[0] - b[0]) +
    Math.abs(a[1] - b[1]) +
    Math.abs(a[2] - b[2])
  ) / 3;
}

function bestEdgeOnSide(data, width, height, center, normal, sideSign, pxPerMm) {
  const minPx = FOREARM_MIN_WIDTH_MM * 0.5 * pxPerMm;
  const maxPx = FOREARM_MAX_WIDTH_MM * 0.5 * pxPerMm;
  const step = Math.max(1, 1.8 * pxPerMm);
  let best = null;

  for (let offset = minPx; offset <= maxPx; offset += step) {
    const x = center.x + normal.x * offset * sideSign;
    const y = center.y + normal.y * offset * sideSign;
    const contrast = edgeContrast(data, width, height, x, y, normal.x, normal.y);
    if (!best || contrast > best.contrast) best = { x, y, offset, contrast };
  }

  return best && best.contrast >= EDGE_MIN_CONTRAST ? best : null;
}

function searchSection(data, width, height, predictedCenter, direction, pxPerMm) {
  const normal = { x: -direction.y, y: direction.x };
  const sideA = bestEdgeOnSide(data, width, height, predictedCenter, normal, 1, pxPerMm);
  const sideB = bestEdgeOnSide(data, width, height, predictedCenter, normal, -1, pxPerMm);

  if (!sideA && !sideB) return { foundAny: false, valid: false, reason: "sin bordes" };
  if (!sideA || !sideB) return { foundAny: true, valid: false, reason: "falta un borde", sideA, sideB };

  const widthPx = Math.abs(
    (sideA.x - sideB.x) * normal.x +
    (sideA.y - sideB.y) * normal.y
  );
  const widthMm = widthPx / Math.max(pxPerMm, 1e-7);
  if (widthMm < FOREARM_MIN_WIDTH_MM || widthMm > FOREARM_MAX_WIDTH_MM) {
    return { foundAny: true, valid: false, reason: "anchura imposible", sideA, sideB, widthMm };
  }

  const rawMid = {
    x: (sideA.x + sideB.x) * 0.5,
    y: (sideA.y + sideB.y) * 0.5
  };
  const shiftPx =
    (rawMid.x - predictedCenter.x) * normal.x +
    (rawMid.y - predictedCenter.y) * normal.y;
  const maxShiftPx = LOCAL_RECENTER_MAX_MM * pxPerMm;

  if (Math.abs(shiftPx) > maxShiftPx) {
    return {
      foundAny: true,
      valid: false,
      reason: "recentrado local excesivo",
      sideA,
      sideB,
      widthMm,
      rawMid
    };
  }

  return {
    foundAny: true,
    valid: true,
    reason: "sección válida",
    sideA,
    sideB,
    widthMm,
    rawMid,
    center: add2(predictedCenter, scale2(normal, shiftPx))
  };
}

function buildTube(data, width, height, p0, mediaX, pxPerMm) {
  const baseElbow = normalize2({ x: -mediaX.x, y: -mediaX.y });
  if (!baseElbow) {
    return { status: "SIN BORDES", reason: "dirección degenerada", sections: [] };
  }

  const baseNormal = { x: -baseElbow.y, y: baseElbow.x };
  let direction = baseElbow;
  let previousCenter = p0;
  let previousWidthMm = null;
  let validCount = 0;
  let consecutive = 0;
  let maxConsecutive = 0;
  let foundAny = 0;
  const sections = [];

  for (let index = 0; index < SECTION_COUNT; index += 1) {
    const stepMm = index === 0 ? SECTION_START_MM : SECTION_STEP_MM;
    const predicted = add2(previousCenter, scale2(direction, stepMm * pxPerMm));
    const section = searchSection(data, width, height, predicted, direction, pxPerMm);
    section.index = index;
    section.predictedCenter = predicted;
    if (section.foundAny) foundAny += 1;

    if (!section.valid) {
      consecutive = 0;
      previousCenter = predicted;
      sections.push(section);
      continue;
    }

    if (
      previousWidthMm !== null &&
      Math.abs(section.widthMm - previousWidthMm) > WIDTH_MAX_CHANGE_MM
    ) {
      section.valid = false;
      section.reason = "cambio brusco de anchura";
      consecutive = 0;
      previousCenter = predicted;
      sections.push(section);
      continue;
    }

    const fromP0 = sub2(section.center, p0);
    const globalDirection = normalize2(fromP0);
    if (
      globalDirection &&
      Math.abs(signedAngle2(baseElbow, globalDirection)) > GLOBAL_ANGLE_MAX_RAD
    ) {
      section.valid = false;
      section.reason = "ángulo global excesivo";
      consecutive = 0;
      previousCenter = predicted;
      sections.push(section);
      continue;
    }

    const lateralMm = Math.abs(dot2(fromP0, baseNormal)) / Math.max(pxPerMm, 1e-7);
    if (lateralMm > GLOBAL_LATERAL_MAX_MM) {
      section.valid = false;
      section.reason = "deriva global excesiva";
      consecutive = 0;
      previousCenter = predicted;
      sections.push(section);
      continue;
    }

    const measured = normalize2(sub2(section.center, previousCenter));
    if (measured) {
      const turn = clamp(
        signedAngle2(direction, measured),
        -LOCAL_TURN_MAX_RAD,
        LOCAL_TURN_MAX_RAD
      );
      direction = rotate2(direction, turn) || direction;
    }

    previousCenter = section.center;
    previousWidthMm = previousWidthMm === null
      ? section.widthMm
      : previousWidthMm * 0.65 + section.widthMm * 0.35;

    validCount += 1;
    consecutive += 1;
    maxConsecutive = Math.max(maxConsecutive, consecutive);
    sections.push(section);
  }

  if (foundAny === 0) {
    return { status: "SIN BORDES", reason: "ninguna sección encontró límites", sections };
  }

  if (validCount < MIN_VALID_SECTIONS || maxConsecutive < MIN_CONSECUTIVE_SECTIONS) {
    return {
      status: "TUBO RECHAZADO",
      reason: "geometría insuficiente",
      sections,
      validCount,
      maxConsecutive
    };
  }

  return {
    status: "TUBO VÁLIDO",
    reason: "tubo coherente",
    sections,
    validCount,
    maxConsecutive
  };
}

function fitFarAxis(tube, p0, pxPerMm) {
  if (!tube || tube.status !== "TUBO VÁLIDO") return null;

  // Usamos el punto medio BRUTO de ambos bordes, no el centro predicho/recentrado.
  // Así la línea lejana depende lo mínimo posible del P0 que estamos comprobando.
  const far = (tube.sections || []).filter((section) =>
    section.valid &&
    section.index >= FAR_SECTION_START_INDEX &&
    section.rawMid &&
    Number.isFinite(section.rawMid.x) &&
    Number.isFinite(section.rawMid.y)
  );

  if (far.length < MIN_FAR_SECTIONS) return null;

  const points = far.map((section) => section.rawMid);
  const mean = points.reduce(
    (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
    { x: 0, y: 0 }
  );
  mean.x /= points.length;
  mean.y /= points.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const point of points) {
    const dx = point.x - mean.x;
    const dy = point.y - mean.y;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  if (sxx + syy < 1e-6) return null;

  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const trend = normalize2(sub2(points[points.length - 1], points[0]));
  if (trend && dot2(direction, trend) < 0) {
    direction = { x: -direction.x, y: -direction.y };
  }

  const normal = { x: -direction.y, y: direction.x };
  const fromMean = sub2(p0, mean);
  const signedPx = dot2(fromMean, normal);
  const nearest = sub2(p0, scale2(normal, signedPx));
  const offsetMm = signedPx / Math.max(pxPerMm, 1e-7);

  let errorSquared = 0;
  for (const point of points) {
    const distancePx = dot2(sub2(point, mean), normal);
    errorSquared += distancePx * distancePx;
  }
  const rmsPx = Math.sqrt(errorSquared / points.length);
  const fitErrorMm = rmsPx / Math.max(pxPerMm, 1e-7);

  return {
    points,
    mean,
    direction,
    normal,
    nearest,
    offsetMm,
    fitErrorMm,
    farCount: points.length
  };
}

function scan(now) {
  if (
    now - lastScanAt < SCAN_INTERVAL_MS ||
    !video ||
    video.readyState < 2 ||
    !video.videoWidth ||
    !video.videoHeight
  ) return;
  lastScanAt = now;

  // Prueba cruda: nada de reloj, muñeca virtual ni suavizado de P0/orientación.
  tuning.smoothing = 0;
  tuning.watchVisible = 0;
  tuning.occluderMode = 0;
  tuning.triadMode = 0;

  const diagnostics = window.AmuraTrackingDiagnostics || {};
  const origin = parseOrigin(diagnostics["Origen muñeca"]);
  const xAxis = parseVector(diagnostics["X 9→3"]);
  const roll = parseNumber(diagnostics["Giro Y muñeca"]);
  const depthMm = parseNumber(
    diagnostics["AR-04B profundidad"] || diagnostics["Distancia a la muñeca"]
  );
  const pointCount = Number(diagnostics["Landmarks"]) || 0;

  if (!origin || !xAxis || !Number.isFinite(depthMm) || depthMm <= 0 || !pointCount) {
    lastMeasurement = {
      valid: false,
      status: "SIN MEDIDA",
      reason: "faltan P0 / X / profundidad",
      roll,
      depthMm,
      pointCount
    };
    return;
  }

  const xProjection = normalize2({ x: xAxis.x, y: xAxis.y });
  if (!xProjection) {
    lastMeasurement = {
      valid: false,
      status: "SIN MEDIDA",
      reason: "X sin proyección útil",
      roll,
      depthMm,
      pointCount
    };
    return;
  }

  const scale = Math.min(
    1,
    MAX_SCAN_DIMENSION / Math.max(video.videoWidth, video.videoHeight)
  );
  const scanWidth = Math.max(2, Math.round(video.videoWidth * scale));
  const scanHeight = Math.max(2, Math.round(video.videoHeight * scale));
  if (scanCanvas.width !== scanWidth || scanCanvas.height !== scanHeight) {
    scanCanvas.width = scanWidth;
    scanCanvas.height = scanHeight;
  }

  try {
    scanContext.drawImage(video, 0, 0, scanWidth, scanHeight);
  } catch (error) {
    lastMeasurement = { valid: false, status: "SIN MEDIDA", reason: "sin frame" };
    return;
  }

  let image;
  try {
    image = scanContext.getImageData(0, 0, scanWidth, scanHeight);
  } catch (error) {
    lastMeasurement = { valid: false, status: "SIN MEDIDA", reason: "sin píxeles" };
    return;
  }

  const focal = focalFromDiagonalFov(
    video.videoWidth,
    video.videoHeight,
    tuning.fovDiagonal
  );
  const pxPerMmVideo = focal / depthMm;
  const pxPerMm = Math.max(0.15, pxPerMmVideo * scale);
  const p0 = {
    x: origin.x * scanWidth,
    y: origin.y * scanHeight
  };

  const tube = buildTube(
    image.data,
    scanWidth,
    scanHeight,
    p0,
    xProjection,
    pxPerMm
  );
  const axis = fitFarAxis(tube, p0, pxPerMm);
  const valid = Boolean(tube.status === "TUBO VÁLIDO" && axis);

  if (valid && baselineOffsetMm === null && Number.isFinite(roll) && Math.abs(roll) <= 20) {
    baselineOffsetMm = axis.offsetMm;
  }

  const deltaMm = valid && baselineOffsetMm !== null
    ? axis.offsetMm - baselineOffsetMm
    : null;

  const convertPoint = (point) => point
    ? { x: point.x / scale, y: point.y / scale }
    : null;

  lastMeasurement = {
    valid,
    status: tube.status,
    reason: valid ? "muestra válida" : (axis ? tube.reason : `${tube.reason} / pocas secciones lejanas`),
    roll,
    depthMm,
    pointCount,
    offsetMm: valid ? axis.offsetMm : null,
    deltaMm,
    fitErrorMm: valid ? axis.fitErrorMm : null,
    farCount: axis ? axis.farCount : 0,
    p0: convertPoint(p0),
    nearest: axis ? convertPoint(axis.nearest) : null,
    mean: axis ? convertPoint(axis.mean) : null,
    direction: axis ? axis.direction : null,
    farPoints: axis ? axis.points.map(convertPoint) : []
  };

  logMeasurement(now, lastMeasurement);
}

function logMeasurement(now, measurement) {
  const roll = measurement && measurement.roll;
  const denseZone = Number.isFinite(roll) && Math.abs(roll) >= 60 && Math.abs(roll) <= 120;
  const interval = denseZone ? 90 : 240;
  if (now - lastLoggedAt < interval) return;
  lastLoggedAt = now;

  if (!Array.isArray(window.AmuraP0AxisLog)) window.AmuraP0AxisLog = [];
  window.AmuraP0AxisLog.push({
    t: Math.round(now),
    valid: Boolean(measurement.valid),
    status: measurement.status || "—",
    roll: Number.isFinite(measurement.roll) ? Math.round(measurement.roll * 10) / 10 : null,
    depthMm: Number.isFinite(measurement.depthMm) ? Math.round(measurement.depthMm * 10) / 10 : null,
    offsetMm: Number.isFinite(measurement.offsetMm) ? Math.round(measurement.offsetMm * 100) / 100 : null,
    deltaMm: Number.isFinite(measurement.deltaMm) ? Math.round(measurement.deltaMm * 100) / 100 : null,
    fitErrorMm: Number.isFinite(measurement.fitErrorMm) ? Math.round(measurement.fitErrorMm * 100) / 100 : null,
    farSections: measurement.farCount || 0
  });
  if (window.AmuraP0AxisLog.length > 600) {
    window.AmuraP0AxisLog.splice(0, window.AmuraP0AxisLog.length - 600);
  }
}

function drawMeasurement(measurement) {
  if (!measurement || !measurement.p0) return;

  const p0 = videoPointToScreen(measurement.p0);
  if (!p0) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,.75)";
  ctx.shadowBlur = 5;

  // P0 dorado.
  ctx.fillStyle = "#d4b76a";
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(p0.x, p0.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = "800 16px Arial";
  ctx.fillStyle = "#d4b76a";
  ctx.fillText("P0", p0.x + 14, p0.y - 12);

  if (!measurement.valid || !measurement.nearest || !measurement.mean || !measurement.direction) {
    ctx.restore();
    return;
  }

  const nearest = videoPointToScreen(measurement.nearest);
  const mean = videoPointToScreen(measurement.mean);
  if (!nearest || !mean) {
    ctx.restore();
    return;
  }

  // Eje extrapolado del antebrazo, obtenido solo de secciones lejanas.
  const screenDirection = normalize2({
    x: measurement.direction.x * (document.body && document.body.dataset.facing === "user" ? -1 : 1),
    y: measurement.direction.y
  });
  if (screenDirection) {
    const length = Math.max(window.innerWidth, window.innerHeight) * 0.72;
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 8]);
    ctx.beginPath();
    ctx.moveTo(mean.x - screenDirection.x * length, mean.y - screenDirection.y * length);
    ctx.lineTo(mean.x + screenDirection.x * length, mean.y + screenDirection.y * length);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Puntos lejanos que realmente han construido el eje.
  ctx.fillStyle = "#00e5ff";
  for (const point of measurement.farPoints || []) {
    const screen = videoPointToScreen(point);
    if (!screen) continue;
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Separación P0 ↔ eje.
  ctx.strokeStyle = "#ff77d4";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(nearest.x, nearest.y);
  ctx.stroke();

  const mid = { x: (p0.x + nearest.x) * 0.5, y: (p0.y + nearest.y) * 0.5 };
  ctx.font = "800 17px Arial";
  ctx.fillStyle = "#ff77d4";
  ctx.fillText(`${measurement.offsetMm >= 0 ? "+" : ""}${measurement.offsetMm.toFixed(1)} mm`, mid.x + 8, mid.y - 8);
  ctx.restore();
}

function updateHud(measurement) {
  if (!measurement) {
    hud.textContent = "P0 ↔ EJE · esperando datos";
    hud.style.borderColor = "rgba(255,255,255,.35)";
    return;
  }

  const rollText = Number.isFinite(measurement.roll)
    ? measurement.roll.toFixed(1) + "°"
    : "—";
  const depthText = Number.isFinite(measurement.depthMm)
    ? Math.round(measurement.depthMm) + " mm"
    : "—";

  if (!measurement.valid) {
    hud.textContent = [
      "P0 ↔ EJE ANTEBRAZO",
      `GIRO ${rollText} · PROF ${depthText}`,
      `${measurement.status || "SIN MEDIDA"}`,
      `LEJANAS ${measurement.farCount || 0}/${SECTION_COUNT - FAR_SECTION_START_INDEX}`,
      "MUESTRA NO VÁLIDA",
      measurement.reason || "—"
    ].join("\n");
    hud.style.borderColor = "rgba(255,138,101,.9)";
    return;
  }

  const deltaText = Number.isFinite(measurement.deltaMm)
    ? `${measurement.deltaMm >= 0 ? "+" : ""}${measurement.deltaMm.toFixed(1)} mm`
    : "esperando 0°";

  hud.textContent = [
    "P0 ↔ EJE ANTEBRAZO",
    `GIRO ${rollText} · PROF ${depthText}`,
    `${measurement.status} · LEJANAS ${measurement.farCount}/4`,
    `OFFSET ${measurement.offsetMm >= 0 ? "+" : ""}${measurement.offsetMm.toFixed(1)} mm`,
    `Δ DESDE 0° ${deltaText}`,
    `AJUSTE EJE ±${measurement.fitErrorMm.toFixed(1)} mm`,
    "MUESTRA VÁLIDA"
  ].join("\n");
  hud.style.borderColor = "rgba(0,229,255,.9)";
}

function render(now) {
  const size = resizeOverlay();
  ctx.clearRect(0, 0, size.width, size.height);
  scan(now);
  drawMeasurement(lastMeasurement);
  updateHud(lastMeasurement);
  requestAnimationFrame(render);
}

window.AmuraP0AxisLog = [];
requestAnimationFrame(render);
