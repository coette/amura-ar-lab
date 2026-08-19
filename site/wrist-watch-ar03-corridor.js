import {
  hideWristWatch as hideBaseWristWatch,
  holdWristWatch as holdBaseWristWatch,
  updateWristWatch as updateBaseWristWatch
} from "./wrist-watch.js?v=ar02.2";
import { tuning } from "./tuner.js?v=11.2";
import { StableSignalGate } from "./stable-signal-gate.js?v=ar03.1";

// AR-03 · CORREDOR P0
// +X codo→mano · +Y 6→12 · +Z fondo→cristal
// δ = X_antebrazo→X_MediaPipe. Se aplica R(Z_vivo, -δ).

const video = document.getElementById("cameraVideo");
const MAX_SCAN_DIMENSION = 480;
const SCAN_INTERVAL_MS = 28;
const EDGE_MIN_CONTRAST = 13;

const SECTION_COUNT = 7;
const SECTION_START_MM = 12;
const SECTION_STEP_MM = 17;
const MIN_VALID_SECTIONS = 4;
const MIN_CONSECUTIVE_SECTIONS = 3;

const FOREARM_MIN_WIDTH_MM = 42;
const FOREARM_MAX_WIDTH_MM = 100;
const WIDTH_MAX_CHANGE_MM = 20;
const LOCAL_RECENTER_MAX_MM = 8;
const LOCAL_TURN_MAX_RAD = 8 * Math.PI / 180;
const GLOBAL_ANGLE_MAX_RAD = 34 * Math.PI / 180;
const GLOBAL_LATERAL_MAX_MM = 48;

const CONFIRM_FRAMES = 5;
const RECONFIRM_FRAMES = 8;
const STABLE_DELTA_RAD = 6 * Math.PI / 180;
const OUTLIER_DELTA_RAD = 22 * Math.PI / 180;
const ANGLE_MIN_CUTOFF_HZ = 0.85;
const ANGLE_BETA = 0.22;

const scanCanvas = document.createElement("canvas");
const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });

let overlayCanvas = null;
let overlayContext = null;
let edgeVisible = true;
let lastScanAt = 0;
let lastTube = null;

let acceptedDeltaRad = null;
let lastCalibrationAt = 0;
let gateLocked = false;
let requiredGateFrames = CONFIRM_FRAMES;
let lastGateStatus = "esperando tubo válido";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dot2 = (a, b) => a.x * b.x + a.y * b.y;
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross2 = (a, b) => a.x * b.y - a.y * b.x;
const cross3 = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
});
const add2 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub2 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const scale2 = (v, s) => ({ x: v.x * s, y: v.y * s });
const add3 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale3 = (v, s) => ({ x: v.x * s, y: v.y * s, z: v.z * s });

function normalize2(v) {
  if (!v) return null;
  const x = Number(v.x) || 0;
  const y = Number(v.y) || 0;
  const n = Math.hypot(x, y);
  return n < 1e-7 ? null : { x: x / n, y: y / n };
}

function normalize3(v) {
  if (!v) return null;
  const x = Number(v.x) || 0;
  const y = Number(v.y) || 0;
  const z = Number(v.z) || 0;
  const n = Math.hypot(x, y, z);
  return n < 1e-7 ? null : { x: x / n, y: y / n, z: z / n };
}

function wrapAngle(a) {
  let v = Number(a) || 0;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
}

const angleDelta = (target, current) => wrapAngle(target - current);
const blendAngle = (a, b, alpha) => wrapAngle(a + angleDelta(b, a) * alpha);
const signedAngle2 = (a, b) => Math.atan2(cross2(a, b), dot2(a, b));
const radiansToDegrees = (a) => Number(a) * 180 / Math.PI;

function rotate2(v, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return normalize2({ x: v.x * c - v.y * s, y: v.x * s + v.y * c });
}

const deltaGate = new StableSignalGate({
  confirmFrames: CONFIRM_FRAMES,
  stableDistance: STABLE_DELTA_RAD,
  distance: (a, b) => Math.abs(angleDelta(a, b)),
  blend: blendAngle,
  blendAlpha: 0.35
});

const circularFilter = {
  cosine: null,
  sine: null,
  lastTimestamp: 0,
  value() {
    if (this.cosine === null || this.sine === null) return null;
    return Math.atan2(this.sine, this.cosine);
  },
  update(angle, timestamp = performance.now(), snap = false) {
    const targetCos = Math.cos(angle);
    const targetSin = Math.sin(angle);
    if (snap || this.cosine === null || this.sine === null || !this.lastTimestamp) {
      this.cosine = targetCos;
      this.sine = targetSin;
      this.lastTimestamp = timestamp;
      return angle;
    }
    const dt = clamp((timestamp - this.lastTimestamp) / 1000, 1 / 120, 0.12);
    this.lastTimestamp = timestamp;
    const current = Math.atan2(this.sine, this.cosine);
    const speed = Math.abs(angleDelta(angle, current)) / dt;
    const cutoff = ANGLE_MIN_CUTOFF_HZ + ANGLE_BETA * speed;
    const tau = 1 / (2 * Math.PI * Math.max(0.05, cutoff));
    const alpha = 1 / (1 + tau / dt);

    let c = this.cosine * (1 - alpha) + targetCos * alpha;
    let s = this.sine * (1 - alpha) + targetSin * alpha;
    const n = Math.hypot(c, s);
    if (n > 1e-7) {
      c /= n;
      s /= n;
    } else {
      c = targetCos;
      s = targetSin;
    }
    this.cosine = c;
    this.sine = s;
    return Math.atan2(s, c);
  }
};

function ensureOverlay() {
  if (overlayCanvas) return;
  const root = document.querySelector(".camera-lab");
  if (!root) return;

  overlayCanvas = document.createElement("canvas");
  overlayCanvas.id = "forearmEdgeCanvas";
  overlayCanvas.setAttribute("aria-hidden", "true");
  Object.assign(overlayCanvas.style, {
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    pointerEvents: "none",
    zIndex: "0"
  });

  const trackingCanvas = document.getElementById("trackingCanvas");
  if (trackingCanvas && trackingCanvas.nextSibling) {
    root.insertBefore(overlayCanvas, trackingCanvas.nextSibling);
  } else {
    root.appendChild(overlayCanvas);
  }
  overlayContext = overlayCanvas.getContext("2d");

  const button = document.getElementById("forearmEdgeButton");
  const value = document.getElementById("forearmEdgeValue");
  if (button) {
    const sync = () => {
      button.setAttribute("aria-pressed", edgeVisible ? "true" : "false");
      button.classList.toggle("primary-control", edgeVisible);
      if (value) value.textContent = edgeVisible ? "OCULTAR" : "MOSTRAR";
      if (!edgeVisible) clearOverlay();
    };
    button.addEventListener("click", () => {
      edgeVisible = !edgeVisible;
      sync();
    });
    sync();
  }
}

function resizeOverlay(width, height) {
  ensureOverlay();
  if (!overlayCanvas) return;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (overlayCanvas.width !== w || overlayCanvas.height !== h) {
    overlayCanvas.width = w;
    overlayCanvas.height = h;
  }
}

function clearOverlay() {
  if (overlayContext && overlayCanvas) {
    overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  }
}

function displayProjection(options, pose) {
  const width = Number(options && options.viewportWidth) || 0;
  const height = Number(options && options.viewportHeight) || 0;
  const fovY = Number(options && options.fovYDegrees) || 50;
  if (!width || !height || !pose || !pose.positionMm) return null;
  const depth = -Number(pose.positionMm.z);
  if (!Number.isFinite(depth) || depth <= 1) return null;
  const focal = height / (2 * Math.tan((fovY * Math.PI / 180) / 2));
  return {
    x: width * 0.5 + Number(pose.positionMm.x) * focal / depth,
    y: height * 0.5 - Number(pose.positionMm.y) * focal / depth,
    focal, depth, width, height
  };
}

function videoGeometry(options, pose) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
  const p = displayProjection(options, pose);
  if (!p) return null;
  const coverScale = Math.max(p.width / video.videoWidth, p.height / video.videoHeight);
  const offsetX = (p.width - video.videoWidth * coverScale) * 0.5;
  const offsetY = (p.height - video.videoHeight * coverScale) * 0.5;
  return {
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    displayWidth: p.width,
    displayHeight: p.height,
    coverScale, offsetX, offsetY,
    p0: {
      x: (p.x - offsetX) / coverScale,
      y: (p.y - offsetY) / coverScale
    },
    pixelsPerMm: p.focal / p.depth / coverScale
  };
}

function projectAxisDifferential(pose, axis) {
  if (!pose || !pose.positionMm || !axis) return null;
  const p = pose.positionMm;
  const depth = -Number(p.z);
  if (!Number.isFinite(depth) || depth <= 1) return null;
  return normalize2({
    x: Number(axis.x) * depth + Number(p.x) * Number(axis.z),
    y: -(Number(axis.y) * depth + Number(p.y) * Number(axis.z))
  });
}

const liveMediaDirection = (pose) =>
  projectAxisDifferential(pose, normalize3(pose && pose.xAxis));

function sampleRgb(data, width, height, x, y) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= width || iy >= height) return null;
  const i = (iy * width + ix) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

function edgeContrast(data, width, height, x, y, nx, ny) {
  const r = 2.4;
  const a = sampleRgb(data, width, height, x + nx * r, y + ny * r);
  const b = sampleRgb(data, width, height, x - nx * r, y - ny * r);
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
    if (!best || contrast > best.contrast) {
      best = { x, y, offset, contrast };
    }
  }
  return best && best.contrast >= EDGE_MIN_CONTRAST ? best : null;
}

function searchSection(data, width, height, predictedCenter, direction, pxPerMm) {
  const normal = { x: -direction.y, y: direction.x };
  const a = bestEdgeOnSide(data, width, height, predictedCenter, normal, 1, pxPerMm);
  const b = bestEdgeOnSide(data, width, height, predictedCenter, normal, -1, pxPerMm);

  if (!a && !b) return { foundAny: false, valid: false, reason: "sin bordes" };
  if (!a || !b) return { foundAny: true, valid: false, reason: "falta un borde", sideA: a, sideB: b };

  const widthPx = Math.abs((a.x - b.x) * normal.x + (a.y - b.y) * normal.y);
  const widthMm = widthPx / Math.max(pxPerMm, 1e-7);
  if (widthMm < FOREARM_MIN_WIDTH_MM || widthMm > FOREARM_MAX_WIDTH_MM) {
    return { foundAny: true, valid: false, reason: "anchura imposible", sideA: a, sideB: b, widthMm };
  }

  const rawMid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
  const shiftPx =
    (rawMid.x - predictedCenter.x) * normal.x +
    (rawMid.y - predictedCenter.y) * normal.y;
  const maxShiftPx = LOCAL_RECENTER_MAX_MM * pxPerMm;

  if (Math.abs(shiftPx) > maxShiftPx) {
    return {
      foundAny: true, valid: false, reason: "recentrado local excesivo",
      sideA: a, sideB: b, widthMm, rawMid
    };
  }

  return {
    foundAny: true,
    valid: true,
    reason: "sección válida",
    sideA: a,
    sideB: b,
    widthMm,
    rawMid,
    center: add2(predictedCenter, scale2(normal, shiftPx)),
    contrast: Math.min(a.contrast, b.contrast)
  };
}

function buildTube(data, width, height, p0, mediaDirection, pxPerMm) {
  const baseElbow = normalize2({ x: -mediaDirection.x, y: -mediaDirection.y });
  if (!baseElbow) return { status: "SIN BORDES", reason: "dirección degenerada", sections: [] };

  const baseNormal = { x: -baseElbow.y, y: baseElbow.x };
  let direction = baseElbow;
  let previousCenter = p0;
  let previousWidthMm = null;
  let validCount = 0;
  let consecutive = 0;
  let maxConsecutive = 0;
  let foundAny = 0;
  const sections = [];
  const validSections = [];

  for (let index = 0; index < SECTION_COUNT; index += 1) {
    const stepMm = index === 0 ? SECTION_START_MM : SECTION_STEP_MM;
    const predicted = add2(previousCenter, scale2(direction, stepMm * pxPerMm));
    const section = searchSection(data, width, height, predicted, direction, pxPerMm);
    section.index = index;
    section.predictedCenter = predicted;
    section.direction = direction;
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
    const globalDir = normalize2(fromP0);
    if (globalDir && Math.abs(signedAngle2(baseElbow, globalDir)) > GLOBAL_ANGLE_MAX_RAD) {
      section.valid = false;
      section.reason = "ángulo global excesivo";
      consecutive = 0;
      previousCenter = predicted;
      sections.push(section);
      continue;
    }

    const globalLateralMm = Math.abs(dot2(fromP0, baseNormal)) / Math.max(pxPerMm, 1e-7);
    if (globalLateralMm > GLOBAL_LATERAL_MAX_MM) {
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
    validSections.push(section);
  }

  if (foundAny === 0) {
    return { status: "SIN BORDES", reason: "ninguna sección encontró límites", sections, validSections };
  }

  if (validCount < MIN_VALID_SECTIONS || maxConsecutive < MIN_CONSECUTIVE_SECTIONS) {
    return {
      status: "TUBO RECHAZADO",
      reason: "geometría insuficiente",
      sections, validSections, validCount, maxConsecutive
    };
  }

  const first = validSections[0];
  const last = validSections[validSections.length - 1];
  let elbowDirection = normalize2(sub2(last.center, first.center)) || direction;
  if (dot2(elbowDirection, baseElbow) < 0) {
    elbowDirection = { x: -elbowDirection.x, y: -elbowDirection.y };
  }

  const forearmX = { x: -elbowDirection.x, y: -elbowDirection.y };
  return {
    status: "TUBO VÁLIDO",
    reason: "tubo coherente",
    sections,
    validSections,
    forearmX,
    widthMm: validSections.reduce((s, x) => s + x.widthMm, 0) / validSections.length,
    quality: validSections.reduce((s, x) => s + x.contrast, 0) / validSections.length
  };
}

function solveMediaToTargetRotation(pose, targetDirection) {
  if (!pose || !targetDirection || !pose.xAxis || !pose.zAxis) return null;
  const z = normalize3(pose.zAxis);
  let x = normalize3(pose.xAxis);
  if (!z || !x) return null;

  x = normalize3(sub3(x, scale3(z, dot3(x, z))));
  if (!x) return null;
  const y = normalize3(cross3(z, x));
  if (!y) return null;

  const px = projectAxisDifferential(pose, x);
  const py = projectAxisDifferential(pose, y);
  let target = normalize2(targetDirection);
  if (!px || !py || !target) return null;
  if (dot2(target, px) < 0) target = { x: -target.x, y: -target.y };

  let rotation = Math.atan2(-cross2(target, px), cross2(target, py));
  const check = normalize2({
    x: px.x * Math.cos(rotation) + py.x * Math.sin(rotation),
    y: px.y * Math.cos(rotation) + py.y * Math.sin(rotation)
  });
  if (check && dot2(check, target) < 0) rotation = wrapAngle(rotation + Math.PI);
  return wrapAngle(rotation);
}

function detectTube(options, pose, mediaDirection) {
  const now = performance.now();
  const geometry = videoGeometry(options, pose);
  if (!geometry || !scanContext || !mediaDirection) {
    return { status: "SIN BORDES", reason: "sin geometría", geometry, sections: [] };
  }

  if (lastScanAt && now - lastScanAt < SCAN_INTERVAL_MS && lastTube) {
    return { ...lastTube, cached: true, geometry };
  }
  lastScanAt = now;

  const scale = Math.min(1, MAX_SCAN_DIMENSION / Math.max(geometry.videoWidth, geometry.videoHeight));
  const scanWidth = Math.max(2, Math.round(geometry.videoWidth * scale));
  const scanHeight = Math.max(2, Math.round(geometry.videoHeight * scale));
  if (scanCanvas.width !== scanWidth || scanCanvas.height !== scanHeight) {
    scanCanvas.width = scanWidth;
    scanCanvas.height = scanHeight;
  }

  try {
    scanContext.drawImage(video, 0, 0, scanWidth, scanHeight);
  } catch (error) {
    return { status: "SIN BORDES", reason: "sin frame", geometry, sections: [] };
  }

  let image;
  try {
    image = scanContext.getImageData(0, 0, scanWidth, scanHeight);
  } catch (error) {
    return { status: "SIN BORDES", reason: "sin píxeles", geometry, sections: [] };
  }

  const p0 = { x: geometry.p0.x * scale, y: geometry.p0.y * scale };
  const pxPerMm = Math.max(0.15, geometry.pixelsPerMm * scale);
  const tube = buildTube(image.data, scanWidth, scanHeight, p0, mediaDirection, pxPerMm);

  const convertPoint = (p) => p ? { x: p.x / scale, y: p.y / scale } : null;
  const sections = tube.sections.map((s) => ({
    ...s,
    predictedCenter: convertPoint(s.predictedCenter),
    center: convertPoint(s.center),
    rawMid: convertPoint(s.rawMid),
    sideA: s.sideA ? { ...s.sideA, x: s.sideA.x / scale, y: s.sideA.y / scale } : null,
    sideB: s.sideB ? { ...s.sideB, x: s.sideB.x / scale, y: s.sideB.y / scale } : null
  }));

  const result = { ...tube, sections, geometry };
  if (tube.status === "TUBO VÁLIDO" && tube.forearmX) {
    const mediaToForearm = solveMediaToTargetRotation(pose, tube.forearmX);
    if (Number.isFinite(mediaToForearm)) {
      // δ = antebrazo→MediaPipe; por eso δ = -(MediaPipe→antebrazo).
      result.deltaTargetRad = wrapAngle(-mediaToForearm);
    } else {
      result.status = "TUBO RECHAZADO";
      result.reason = "δ no resoluble";
    }
  }

  lastTube = result;
  return result;
}

function updateDelta(tube) {
  if (!tube || tube.status !== "TUBO VÁLIDO" || !Number.isFinite(tube.deltaTargetRad)) {
    gateLocked = false;
    requiredGateFrames = CONFIRM_FRAMES;
    deltaGate.miss();
    lastGateStatus = acceptedDeltaRad === null ? (tube && tube.status) || "SIN BORDES" : "δ CONGELADA";
    return acceptedDeltaRad;
  }

  const target = tube.deltaTargetRad;
  const now = performance.now();

  if (!gateLocked) {
    const result = deltaGate.observe(target, requiredGateFrames);
    lastGateStatus = "confirmando δ " + result.count + "/" + result.required;
    if (!result.accepted) return acceptedDeltaRad;

    gateLocked = true;
    requiredGateFrames = CONFIRM_FRAMES;
    deltaGate.resetCandidate();
    const snap = acceptedDeltaRad === null;
    acceptedDeltaRad = circularFilter.update(result.value, now, snap);
    lastCalibrationAt = now;
    lastGateStatus = "δ ACTIVA";
    return acceptedDeltaRad;
  }

  const current = circularFilter.value();
  const difference = current === null ? 0 : Math.abs(angleDelta(target, current));
  if (current === null || difference <= OUTLIER_DELTA_RAD) {
    acceptedDeltaRad = circularFilter.update(target, now, current === null);
    lastCalibrationAt = now;
    lastGateStatus = "δ ACTIVA";
    return acceptedDeltaRad;
  }

  gateLocked = false;
  requiredGateFrames = RECONFIRM_FRAMES;
  deltaGate.resetCandidate();
  const result = deltaGate.observe(target, requiredGateFrames);
  lastGateStatus = "δ sospechosa " + result.count + "/" + result.required;
  return acceptedDeltaRad;
}

function rotateAroundAxis(vector, axis, angle) {
  const v = normalize3(vector);
  const k = normalize3(axis);
  if (!v || !k) return null;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return normalize3(add3(add3(
    scale3(v, c),
    scale3(cross3(k, v), s)
  ), scale3(k, dot3(k, v) * (1 - c))));
}

function applyDelta(pose, deltaRad) {
  if (!pose || !Number.isFinite(deltaRad) || !pose.zAxis) return pose;
  const z = normalize3(pose.zAxis);
  const oldX = normalize3(pose.xAxis);
  const oldY = normalize3(pose.yAxis);
  if (!z || !oldX || !oldY) return pose;

  const rotation = -deltaRad;
  const rx = rotateAroundAxis(oldX, z, rotation);
  const ry = rotateAroundAxis(oldY, z, rotation);
  if (!rx || !ry) return pose;

  const x = normalize3(sub3(rx, scale3(z, dot3(rx, z))));
  if (!x) return pose;
  const y = normalize3(cross3(z, x));
  if (!y) return pose;
  return { ...pose, xAxis: x, yAxis: y, zAxis: z };
}

function videoPointToDisplay(point, geometry) {
  let x = point.x * geometry.coverScale + geometry.offsetX;
  const y = point.y * geometry.coverScale + geometry.offsetY;
  if (document.body && document.body.dataset.facing === "user") {
    x = geometry.displayWidth - x;
  }
  return { x, y };
}

function drawPolyline(points, geometry, color, width, alpha = 1) {
  if (!overlayContext || points.length < 2) return;
  overlayContext.save();
  overlayContext.strokeStyle = color;
  overlayContext.globalAlpha = alpha;
  overlayContext.lineWidth = width;
  overlayContext.lineCap = "round";
  overlayContext.lineJoin = "round";
  overlayContext.shadowColor = "rgba(0,0,0,.65)";
  overlayContext.shadowBlur = 4;
  overlayContext.beginPath();
  let p = videoPointToDisplay(points[0], geometry);
  overlayContext.moveTo(p.x, p.y);
  for (let i = 1; i < points.length; i += 1) {
    p = videoPointToDisplay(points[i], geometry);
    overlayContext.lineTo(p.x, p.y);
  }
  overlayContext.stroke();
  overlayContext.restore();
}

function drawTube(tube, correctedPose, options) {
  const width = Number(options && options.viewportWidth) || 0;
  const height = Number(options && options.viewportHeight) || 0;
  resizeOverlay(width, height);
  clearOverlay();
  if (!edgeVisible || !overlayContext || !tube || !tube.geometry) return;

  const valid = (tube.sections || []).filter((s) => s.valid);
  const invalid = (tube.sections || []).filter((s) => !s.valid && (s.sideA || s.sideB));
  const left = valid.filter((s) => s.sideA).map((s) => ({ x: s.sideA.x, y: s.sideA.y }));
  const right = valid.filter((s) => s.sideB).map((s) => ({ x: s.sideB.x, y: s.sideB.y }));
  const centers = valid.filter((s) => s.center).map((s) => s.center);
  const color = tube.status === "TUBO VÁLIDO" ? "#00e5ff" : "#ff8a65";

  drawPolyline(left, tube.geometry, color, tube.status === "TUBO VÁLIDO" ? 5 : 3, 0.9);
  drawPolyline(right, tube.geometry, color, tube.status === "TUBO VÁLIDO" ? 5 : 3, 0.9);
  if (tube.status === "TUBO VÁLIDO") {
    drawPolyline(centers, tube.geometry, "#4dd0e1", 2, 0.8);
  }

  for (const s of invalid) {
    if (s.sideA && s.sideB) {
      drawPolyline(
        [{ x: s.sideA.x, y: s.sideA.y }, { x: s.sideB.x, y: s.sideB.y }],
        tube.geometry,
        "#ff8a65",
        2,
        0.5
      );
    }
  }

  const correctedDirection = liveMediaDirection(correctedPose);
  if (!correctedDirection) return;

  const p0 = videoPointToDisplay(tube.geometry.p0, tube.geometry);
  let dx = correctedDirection.x;
  const dy = correctedDirection.y;
  if (document.body && document.body.dataset.facing === "user") dx = -dx;

  const length = clamp(
    (Number(tuning.occluderWidthMm) || 62) *
      tube.geometry.pixelsPerMm *
      tube.geometry.coverScale *
      0.95,
    48,
    130
  );

  overlayContext.save();
  overlayContext.strokeStyle = "#d4b76a";
  overlayContext.lineWidth = 3;
  overlayContext.setLineDash([9, 7]);
  overlayContext.lineCap = "round";
  overlayContext.beginPath();
  overlayContext.moveTo(p0.x - dx * length * 0.55, p0.y - dy * length * 0.55);
  overlayContext.lineTo(p0.x + dx * length, p0.y + dy * length);
  overlayContext.stroke();
  overlayContext.restore();
}

function deltaLabel() {
  if (acceptedDeltaRad === null) return lastGateStatus;
  return radiansToDegrees(acceptedDeltaRad).toFixed(1) + "° · " + lastGateStatus;
}

export function updateWristWatch(options) {
  const pose = options && options.pose;
  if (!pose) {
    clearOverlay();
    return updateBaseWristWatch(options);
  }

  const mediaDirection = liveMediaDirection(pose);
  const tube = detectTube(options, pose, mediaDirection);
  const deltaRad = updateDelta(tube);
  const nextPose = Number.isFinite(deltaRad) ? applyDelta(pose, deltaRad) : pose;

  drawTube(tube, nextPose, options);

  if (window.AmuraTrackingDiagnostics) {
    const frozen = tube.status !== "TUBO VÁLIDO" && Number.isFinite(acceptedDeltaRad);
    window.AmuraTrackingDiagnostics["Antebrazo"] = frozen ? "δ CONGELADA" : tube.status;
    window.AmuraTrackingDiagnostics["Tubo"] = tube.status;
    window.AmuraTrackingDiagnostics["Validación tubo"] = tube.reason || "—";
    window.AmuraTrackingDiagnostics["Secciones válidas"] =
      ((tube.validSections && tube.validSections.length) || 0) + "/" + SECTION_COUNT;
    window.AmuraTrackingDiagnostics["Anchura antebrazo"] =
      Number.isFinite(tube.widthMm) ? tube.widthMm.toFixed(0) + " mm" : "—";
    window.AmuraTrackingDiagnostics["δ antebrazo"] = deltaLabel();
    window.AmuraTrackingDiagnostics["Aplicación δ"] = "R(Z vivo, -δ)";
    window.AmuraTrackingDiagnostics["Última calibración"] = lastCalibrationAt
      ? Math.round((performance.now() - lastCalibrationAt) / 100) / 10 + " s"
      : "—";
  }

  const state = updateBaseWristWatch({ ...options, pose: nextPose });
  return state ? { ...state, units: "AR-03 · corredor P0 + δ local-Z" } : state;
}

export function holdWristWatch() {
  return holdBaseWristWatch();
}

export function hideWristWatch() {
  clearOverlay();
  return hideBaseWristWatch();
}

ensureOverlay();