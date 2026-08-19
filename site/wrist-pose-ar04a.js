import { buildWristFrame, imageSpaceLandmarks } from "./wrist-frame.js?v=11.2";

/**
 * AMURA · AR-04A · DIAGNÓSTICO MÉTRICO
 *
 * Esta fase NO cambia todavía la profundidad que gobierna el reloj.
 * Mantiene exactamente el estimador de AR-03 y, en paralelo, mide por pareja:
 * - profundidad que calcula hoy el sistema;
 * - cuánto del segmento 3D queda transversal al eje de cámara;
 * - confianza geométrica aproximada = componente transversal / longitud 3D;
 * - profundidad alternativa usando esa componente transversal.
 *
 * El objetivo es identificar qué parejas se vuelven degeneradas al girar la
 * muñeca antes de cambiar la fórmula definitiva.
 */

const EPSILON = 1e-9;
const PAIRS = [
  [0, 9],
  [0, 5],
  [0, 17],
  [5, 17],
  [5, 9],
  [9, 13],
  [13, 17]
];
const DIAGNOSTIC_SAMPLE_MS = 250;
const MAX_LOG_ENTRIES = 160;

let metricHud = null;
let lastDiagnosticSampleAt = 0;
let staleTimer = 0;

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a, scalar) {
  return { x: a.x * scalar, y: a.y * scalar, z: a.z * scalar };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function len(a) {
  return Math.hypot(a.x, a.y, a.z);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

export function focalFromFov(imageHeight, fovYDegrees) {
  const fov = (Number(fovYDegrees) || 60) * Math.PI / 180;
  return (imageHeight * 0.5) / Math.tan(fov * 0.5);
}

export function focalFromDiagonalFov(imageWidth, imageHeight, fovDegrees) {
  const diagonal = Math.hypot(imageWidth, imageHeight);
  const fov = (Number(fovDegrees) || 73) * Math.PI / 180;
  return (diagonal * 0.5) / Math.tan(fov * 0.5);
}

export function metricWristBasis(worldPoints, physicalHand) {
  if (!Array.isArray(worldPoints) || worldPoints.length < 18) return null;
  const p0 = worldPoints[0];
  const p5 = worldPoints[5];
  const p17 = worldPoints[17];
  if (!p0 || !p5 || !p17) return null;

  const mid = {
    x: (p5.x + p17.x) * 0.5,
    y: (p5.y + p17.y) * 0.5,
    z: (p5.z + p17.z) * 0.5
  };
  const longitudinal = sub(mid, p0);
  const longitudinalLength = len(longitudinal);
  if (longitudinalLength < EPSILON) return null;
  const xAxis = scale(longitudinal, 1 / longitudinalLength);

  const transverse = physicalHand === "right"
    ? sub(p17, p5)
    : sub(p5, p17);
  const dotXY = dot(transverse, xAxis);
  const yRaw = sub(transverse, scale(xAxis, dotXY));
  const yLength = len(yRaw);
  if (yLength < EPSILON) return null;
  const yAxis = scale(yRaw, 1 / yLength);
  const zRaw = {
    x: xAxis.y * yAxis.z - xAxis.z * yAxis.y,
    y: xAxis.z * yAxis.x - xAxis.x * yAxis.z,
    z: xAxis.x * yAxis.y - xAxis.y * yAxis.x
  };
  const zLength = len(zRaw);
  if (zLength < EPSILON) return null;
  const zAxis = scale(zRaw, 1 / zLength);

  return { xAxis, yAxis, zAxis, armAxis: xAxis };
}

// Estimador AR-03 original: NO se modifica en AR-04A.
function estimateDepthMm(worldPoints, imagePoints, focal, imageWidth, imageHeight) {
  const estimates = [];

  for (const [a, b] of PAIRS) {
    const wa = worldPoints[a];
    const wb = worldPoints[b];
    const ia = imagePoints[a];
    const ib = imagePoints[b];
    if (!wa || !wb || !ia || !ib) continue;

    const worldProjectedMm = Math.hypot(
      (wa.x - wb.x) * 1000,
      (wa.y - wb.y) * 1000
    );
    const pixelDistance = Math.hypot(
      (ia.x - ib.x) * imageWidth,
      (ia.y - ib.y) * imageHeight
    );

    if (worldProjectedMm < 3 || pixelDistance < 6) continue;
    const depth = focal * worldProjectedMm / pixelDistance;
    if (Number.isFinite(depth) && depth >= 120 && depth <= 1800) {
      estimates.push(depth);
    }
  }

  return median(estimates);
}

/**
 * Rota un vector del marco 3D de worldLandmarks al marco observado por cámara.
 * La rotación se obtiene únicamente de direcciones P0/P5/P17; no usa la
 * profundidad que estamos intentando medir, por lo que no hay circularidad.
 */
function worldVectorToCameraFrame(vector, worldFrame, imageFrame) {
  if (!vector || !worldFrame || !imageFrame) return null;

  const localX = dot(vector, worldFrame.xAxis);
  const localY = dot(vector, worldFrame.yAxis);
  const localZ = dot(vector, worldFrame.zAxis);

  return add(
    add(scale(imageFrame.xAxis, localX), scale(imageFrame.yAxis, localY)),
    scale(imageFrame.zAxis, localZ)
  );
}

function buildDepthDiagnostics(
  worldPoints,
  normalizedImagePoints,
  physicalHand,
  focal,
  imageWidth,
  imageHeight
) {
  const worldFrame = buildWristFrame(worldPoints, physicalHand);
  const imageMetricPoints = imageSpaceLandmarks(
    normalizedImagePoints,
    imageWidth,
    imageHeight
  );
  const imageFrame = buildWristFrame(imageMetricPoints, physicalHand);
  if (!worldFrame || !imageFrame) return [];

  const rows = [];

  for (const [a, b] of PAIRS) {
    const wa = worldPoints[a];
    const wb = worldPoints[b];
    const ia = normalizedImagePoints[a];
    const ib = normalizedImagePoints[b];
    if (!wa || !wb || !ia || !ib) continue;

    const worldVector = sub(wa, wb);
    const worldTotalMm = len(worldVector) * 1000;
    const legacyProjectedMm = Math.hypot(worldVector.x, worldVector.y) * 1000;
    const pixelDistance = Math.hypot(
      (ia.x - ib.x) * imageWidth,
      (ia.y - ib.y) * imageHeight
    );
    const cameraVector = worldVectorToCameraFrame(worldVector, worldFrame, imageFrame);
    const cameraTransverseMm = cameraVector
      ? Math.hypot(cameraVector.x, cameraVector.y) * 1000
      : 0;
    const confidence = worldTotalMm > EPSILON
      ? clamp(cameraTransverseMm / worldTotalMm, 0, 1)
      : 0;

    const legacyDepthMm = legacyProjectedMm >= 3 && pixelDistance >= 6
      ? focal * legacyProjectedMm / pixelDistance
      : null;
    const cameraDepthMm = cameraTransverseMm >= 3 && pixelDistance >= 6
      ? focal * cameraTransverseMm / pixelDistance
      : null;

    rows.push({
      pair: `${a}-${b}`,
      pixelDistance,
      worldTotalMm,
      legacyProjectedMm,
      cameraTransverseMm,
      confidence,
      legacyDepthMm: Number.isFinite(legacyDepthMm) ? legacyDepthMm : null,
      cameraDepthMm: Number.isFinite(cameraDepthMm) ? cameraDepthMm : null
    });
  }

  return rows;
}

function ensureMetricHud() {
  if (metricHud || typeof document === "undefined") return metricHud;
  const root = document.querySelector(".camera-lab") || document.body;
  if (!root) return null;

  metricHud = document.createElement("div");
  metricHud.id = "metricDepthHud";
  metricHud.setAttribute("aria-live", "polite");
  Object.assign(metricHud.style, {
    position: "absolute",
    top: "64px",
    left: "10px",
    zIndex: "12",
    minWidth: "176px",
    maxWidth: "235px",
    padding: "8px 9px",
    borderRadius: "10px",
    background: "rgba(0,0,0,.66)",
    color: "white",
    font: "600 10px/1.28 ui-monospace, SFMono-Regular, Menlo, monospace",
    letterSpacing: "0.01em",
    pointerEvents: "none",
    whiteSpace: "pre"
  });
  metricHud.textContent = "AR-04A · esperando mano";
  root.appendChild(metricHud);
  return metricHud;
}

function formatDepth(value) {
  return Number.isFinite(value) ? `${Math.round(value)}mm` : "—";
}

function publishDiagnostics(depthMm, rows) {
  const now = performance.now();
  if (now - lastDiagnosticSampleAt < DIAGNOSTIC_SAMPLE_MS) return;
  lastDiagnosticSampleAt = now;

  const hud = ensureMetricHud();
  if (hud) {
    const lines = [
      `AR-04A  PROF ${Math.round(depthMm)} mm`,
      "par   actual   conf  correg."
    ];
    for (const row of rows) {
      lines.push(
        `${row.pair.padEnd(5)} ${formatDepth(row.legacyDepthMm).padStart(6)}  ` +
        `${row.confidence.toFixed(2)}  ${formatDepth(row.cameraDepthMm).padStart(6)}`
      );
    }
    hud.textContent = lines.join("\n");
  }

  if (!Array.isArray(window.AmuraMetricLog)) window.AmuraMetricLog = [];
  window.AmuraMetricLog.push({
    t: Math.round(now),
    depthMm: Math.round(depthMm * 10) / 10,
    pairs: rows.map((row) => ({
      pair: row.pair,
      legacyDepthMm: Number.isFinite(row.legacyDepthMm)
        ? Math.round(row.legacyDepthMm * 10) / 10
        : null,
      confidence: Math.round(row.confidence * 1000) / 1000,
      cameraDepthMm: Number.isFinite(row.cameraDepthMm)
        ? Math.round(row.cameraDepthMm * 10) / 10
        : null
    }))
  });
  if (window.AmuraMetricLog.length > MAX_LOG_ENTRIES) {
    window.AmuraMetricLog.splice(0, window.AmuraMetricLog.length - MAX_LOG_ENTRIES);
  }

  if (window.AmuraTrackingDiagnostics) {
    window.AmuraTrackingDiagnostics["AR-04A profundidad"] = `${Math.round(depthMm)} mm`;
    for (const row of rows) {
      window.AmuraTrackingDiagnostics[`Métrica ${row.pair}`] =
        `${formatDepth(row.legacyDepthMm)} · conf ${row.confidence.toFixed(2)} · ` +
        `corr ${formatDepth(row.cameraDepthMm)}`;
    }
  }

  if (staleTimer) clearTimeout(staleTimer);
  staleTimer = setTimeout(() => {
    if (metricHud) metricHud.textContent = "AR-04A · sin medida";
  }, 900);
}

export function solveMetricWristPose(options) {
  const worldPoints = options.worldPoints;
  const imagePoints = options.imagePoints;
  const physicalHand = options.physicalHand;
  const imageWidth = Math.max(1, Number(options.imageWidth) || 1);
  const imageHeight = Math.max(1, Number(options.imageHeight) || 1);
  const focal = Math.max(1, Number(options.focal) || 1);

  if (!Array.isArray(worldPoints) || worldPoints.length < 18) return null;
  if (!Array.isArray(imagePoints) || imagePoints.length < 18) return null;
  if (!imagePoints[0]) return null;

  const depthMm = estimateDepthMm(
    worldPoints,
    imagePoints,
    focal,
    imageWidth,
    imageHeight
  );
  if (!depthMm) return null;

  const depthDiagnostics = buildDepthDiagnostics(
    worldPoints,
    imagePoints,
    physicalHand,
    focal,
    imageWidth,
    imageHeight
  );
  publishDiagnostics(depthMm, depthDiagnostics);

  const p0 = imagePoints[0];
  const u = p0.x * imageWidth;
  const v = p0.y * imageHeight;
  const cx = imageWidth * 0.5;
  const cy = imageHeight * 0.5;

  const positionMm = {
    x: (u - cx) * depthMm / focal,
    y: -(v - cy) * depthMm / focal,
    z: -depthMm
  };

  const basis = metricWristBasis(worldPoints, physicalHand);
  if (!basis) return null;
  const toThree = (axis) => ({ x: axis.x, y: -axis.y, z: -axis.z });

  const palmWidthMm = len(sub(worldPoints[17], worldPoints[5])) * 1000;

  return {
    positionMm,
    depthMm,
    palmWidthMm,
    depthDiagnostics,
    reprojectionErrorPx: 0,
    xAxis: toThree(basis.xAxis),
    yAxis: toThree(basis.yAxis),
    zAxis: toThree(basis.zAxis),
    armAxis: toThree(basis.xAxis),
    focal
  };
}
