import {
  hideWristWatch as hideBaseWristWatch,
  holdWristWatch as holdBaseWristWatch,
  updateWristWatch as updateBaseWristWatch
} from "./wrist-watch.js?v=ar02.2";
import { tuning } from "./tuner.js?v=11.2";
import { StableSignalGate } from "./stable-signal-gate.js?v=ar03.1";

// AR-03 · EJE ANTEBRAZO · DOBLE BORDE FÍSICO
// +X = 9→3 = codo→mano
// +Y = 6→12
// +Z = fondo→cristal
//
// MediaPipe gobierna siempre el movimiento vivo.
// El detector del antebrazo sólo puede actualizar δ si la geometría de entrada
// es físicamente plausible. Para adquirir se exigen DOS bordes opuestos,
// aproximadamente paralelos y con anchura plausible en mm. Tras adquirir,
// un único borde puede ayudar sólo si produce un δ cercano al ya retenido.

const video = document.getElementById("cameraVideo");

const MAX_SCAN_DIMENSION = 480;
const EDGE_HOLD_MS = 350;
const EDGE_SEARCH_MEMORY_MS = 1200;
const EDGE_MIN_MEAN_CONTRAST = 14;
const EDGE_MIN_POINTS = 5;

const PAIR_MAX_PARALLEL_RAD = 12 * Math.PI / 180;
const PAIR_MAX_DELTA_SPREAD_RAD = 8 * Math.PI / 180;
const SINGLE_MAX_DELTA_FROM_LOCK_RAD = 9 * Math.PI / 180;
const FOREARM_MIN_WIDTH_MM = 45;
const FOREARM_MAX_WIDTH_MM = 95;

const CONFIRM_FRAMES = 5;
const RECONFIRM_FRAMES = 8;
const STABLE_ANGLE = 6 * Math.PI / 180;
const OUTLIER_ANGLE = 22 * Math.PI / 180;

const ANGLE_MIN_CUTOFF_HZ = 0.85;
const ANGLE_BETA = 0.22;

const scanCanvas = document.createElement("canvas");
const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });

let overlayCanvas = null;
let overlayContext = null;
let edgeVisible = true;

let lastScanAt = 0;
let lastGoodAt = 0;
let lastDirection = null;
let lastQuality = 0;
let lastValidSegments = [];

let correctionLocked = false;
let requiredGateFrames = CONFIRM_FRAMES;
let acceptedCorrectionRad = null;
let lastCalibrationAt = 0;
let lastGateStatus = "esperando doble borde fiable";
let lastValidationStatus = "sin validar";
let lastWidthMm = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize2(vector) {
  if (!vector) return null;
  const x = Number(vector.x) || 0;
  const y = Number(vector.y) || 0;
  const length = Math.hypot(x, y);
  if (length < 1e-7) return null;
  return { x: x / length, y: y / length };
}

function normalize3(vector) {
  if (!vector) return null;
  const x = Number(vector.x) || 0;
  const y = Number(vector.y) || 0;
  const z = Number(vector.z) || 0;
  const length = Math.hypot(x, y, z);
  if (length < 1e-7) return null;
  return { x: x / length, y: y / length, z: z / length };
}

function dot2(a, b) {
  return a.x * b.x + a.y * b.y;
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross2(a, b) {
  return a.x * b.y - a.y * b.x;
}

function cross3(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function scale3(vector, scalar) {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function add3(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtract3(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function wrapAngle(angle) {
  let next = Number(angle) || 0;
  while (next > Math.PI) next -= Math.PI * 2;
  while (next < -Math.PI) next += Math.PI * 2;
  return next;
}

function angleDelta(target, current) {
  return wrapAngle(target - current);
}

function blendAngle(a, b, alpha) {
  return wrapAngle(a + angleDelta(b, a) * alpha);
}

function averageAngles(a, b) {
  return Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));
}

function radiansToDegrees(angle) {
  return Number(angle) * 180 / Math.PI;
}

const correctionGate = new StableSignalGate({
  confirmFrames: CONFIRM_FRAMES,
  stableDistance: STABLE_ANGLE,
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
      return Math.atan2(this.sine, this.cosine);
    }

    const dt = clamp((timestamp - this.lastTimestamp) / 1000, 1 / 120, 0.12);
    this.lastTimestamp = timestamp;

    const current = Math.atan2(this.sine, this.cosine);
    const speed = Math.abs(angleDelta(angle, current)) / dt;
    const cutoff = ANGLE_MIN_CUTOFF_HZ + ANGLE_BETA * speed;
    const tau = 1 / (2 * Math.PI * Math.max(0.05, cutoff));
    const alpha = 1 / (1 + tau / dt);

    let nextCos = this.cosine * (1 - alpha) + targetCos * alpha;
    let nextSin = this.sine * (1 - alpha) + targetSin * alpha;
    const length = Math.hypot(nextCos, nextSin);

    if (length > 1e-7) {
      nextCos /= length;
      nextSin /= length;
    } else {
      nextCos = targetCos;
      nextSin = targetSin;
    }

    this.cosine = nextCos;
    this.sine = nextSin;
    return Math.atan2(nextSin, nextCos);
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
    const syncButton = () => {
      button.setAttribute("aria-pressed", edgeVisible ? "true" : "false");
      button.classList.toggle("primary-control", edgeVisible);
      if (value) value.textContent = edgeVisible ? "OCULTAR" : "MOSTRAR";
      if (!edgeVisible) clearOverlay();
    };

    button.addEventListener("click", () => {
      edgeVisible = !edgeVisible;
      syncButton();
    });
    syncButton();
  }
}

function resizeOverlay(width, height) {
  ensureOverlay();
  if (!overlayCanvas) return;
  const nextWidth = Math.max(1, Math.round(width));
  const nextHeight = Math.max(1, Math.round(height));
  if (overlayCanvas.width !== nextWidth || overlayCanvas.height !== nextHeight) {
    overlayCanvas.width = nextWidth;
    overlayCanvas.height = nextHeight;
  }
}

function clearOverlay() {
  if (!overlayContext || !overlayCanvas) return;
  overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
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
    focal,
    depth,
    width,
    height
  };
}

function videoGeometry(options, pose) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;

  const projected = displayProjection(options, pose);
  if (!projected) return null;

  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  const coverScale = Math.max(projected.width / videoWidth, projected.height / videoHeight);
  const offsetX = (projected.width - videoWidth * coverScale) * 0.5;
  const offsetY = (projected.height - videoHeight * coverScale) * 0.5;

  return {
    videoWidth,
    videoHeight,
    displayWidth: projected.width,
    displayHeight: projected.height,
    coverScale,
    offsetX,
    offsetY,
    p0: {
      x: (projected.x - offsetX) / coverScale,
      y: (projected.y - offsetY) / coverScale
    },
    pixelsPerMm: projected.focal / projected.depth / coverScale
  };
}

function sampleRgb(data, width, height, x, y) {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= width || iy >= height) return null;
  const index = (iy * width + ix) * 4;
  return [data[index], data[index + 1], data[index + 2]];
}

function edgeContrast(data, width, height, x, y, normalX, normalY) {
  const radius = 2.25;
  const a = sampleRgb(data, width, height, x + normalX * radius, y + normalY * radius);
  const b = sampleRgb(data, width, height, x - normalX * radius, y - normalY * radius);
  if (!a || !b) return 0;
  return (
    Math.abs(a[0] - b[0]) +
    Math.abs(a[1] - b[1]) +
    Math.abs(a[2] - b[2])
  ) / 3;
}

function fitLine(points) {
  if (!points || points.length < EDGE_MIN_POINTS) return null;

  let meanX = 0;
  let meanY = 0;
  for (const point of points) {
    meanX += point.x;
    meanY += point.y;
  }
  meanX /= points.length;
  meanY /= points.length;

  let xx = 0;
  let yy = 0;
  let xy = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    xx += dx * dx;
    yy += dy * dy;
    xy += dx * dy;
  }

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const normal = { x: -direction.y, y: direction.x };

  let minAlong = Infinity;
  let maxAlong = -Infinity;
  let residualSquared = 0;
  let meanContrast = 0;

  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    const along = dx * direction.x + dy * direction.y;
    const across = dx * normal.x + dy * normal.y;
    minAlong = Math.min(minAlong, along);
    maxAlong = Math.max(maxAlong, along);
    residualSquared += across * across;
    meanContrast += point.contrast;
  }

  meanContrast /= points.length;
  return {
    center: { x: meanX, y: meanY },
    direction,
    rms: Math.sqrt(residualSquared / points.length),
    span: maxAlong - minAlong,
    meanContrast
  };
}

function scanOneSide(data, width, height, p0, longitudinal, wristWidth, sideSign) {
  const normal = { x: -longitudinal.y, y: longitudinal.x };
  const samples = 10;
  const startAlong = wristWidth * 0.18;
  const endAlong = wristWidth * 1.45;
  const minOffset = wristWidth * 0.28;
  const maxOffset = wristWidth * 0.82;
  const offsetStep = Math.max(1, wristWidth * 0.035);
  const points = [];
  let previousOffset = null;

  for (let index = 0; index < samples; index += 1) {
    const ratio = samples === 1 ? 0 : index / (samples - 1);
    const along = startAlong + (endAlong - startAlong) * ratio;
    const centerX = p0.x - longitudinal.x * along;
    const centerY = p0.y - longitudinal.y * along;

    let best = null;
    for (let offset = minOffset; offset <= maxOffset; offset += offsetStep) {
      const x = centerX + normal.x * offset * sideSign;
      const y = centerY + normal.y * offset * sideSign;
      const contrast = edgeContrast(data, width, height, x, y, normal.x, normal.y);
      const continuityPenalty = previousOffset === null
        ? 0
        : Math.abs(offset - previousOffset) * 0.45;
      const score = contrast - continuityPenalty;
      if (!best || score > best.score) best = { x, y, offset, contrast, score };
    }

    if (best && best.contrast >= EDGE_MIN_MEAN_CONTRAST * 0.65) {
      points.push(best);
      previousOffset = best.offset;
    }
  }

  const fit = fitLine(points);
  if (!fit) return null;

  const normalizedRms = fit.rms / Math.max(1, wristWidth);
  const normalizedSpan = fit.span / Math.max(1, wristWidth);
  if (fit.meanContrast < EDGE_MIN_MEAN_CONTRAST) return null;
  if (normalizedRms > 0.16 || normalizedSpan < 0.58) return null;

  fit.quality = fit.meanContrast *
    clamp(1 - normalizedRms * 4.5, 0.15, 1) *
    clamp(normalizedSpan / 0.95, 0.35, 1);
  return fit;
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

function liveMediaDirection(pose) {
  return projectAxisDifferential(pose, normalize3(pose && pose.xAxis));
}

function solveLocalZCorrection(pose, edgeDirection) {
  if (!pose || !edgeDirection || !pose.xAxis || !pose.yAxis || !pose.zAxis) return null;

  const z = normalize3(pose.zAxis);
  let x = normalize3(pose.xAxis);
  if (!z || !x) return null;

  x = normalize3(subtract3(x, scale3(z, dot3(x, z))));
  if (!x) return null;
  const y = normalize3(cross3(z, x));
  if (!y) return null;

  const projectedX = projectAxisDifferential(pose, x);
  const projectedY = projectAxisDifferential(pose, y);
  let target = normalize2(edgeDirection);
  if (!projectedX || !projectedY || !target) return null;

  if (dot2(target, projectedX) < 0) target = { x: -target.x, y: -target.y };

  const crossX = cross2(target, projectedX);
  const crossY = cross2(target, projectedY);
  let delta = Math.atan2(-crossX, crossY);

  const projectedRotated = normalize2({
    x: projectedX.x * Math.cos(delta) + projectedY.x * Math.sin(delta),
    y: projectedX.y * Math.cos(delta) + projectedY.y * Math.sin(delta)
  });

  if (projectedRotated && dot2(projectedRotated, target) < 0) {
    delta = wrapAngle(delta + Math.PI);
  }

  return wrapAngle(delta);
}

function orientCandidate(fit, mediaDirection, scale, wristWidth) {
  if (!fit) return null;
  let direction = normalize2(fit.direction);
  if (!direction) return null;
  if (dot2(direction, mediaDirection) < 0) direction = { x: -direction.x, y: -direction.y };

  const halfSpan = Math.max(fit.span * 0.5, wristWidth * 0.35);
  return {
    ...fit,
    direction,
    segment: {
      start: {
        x: (fit.center.x - direction.x * halfSpan) / scale,
        y: (fit.center.y - direction.y * halfSpan) / scale
      },
      end: {
        x: (fit.center.x + direction.x * halfSpan) / scale,
        y: (fit.center.y + direction.y * halfSpan) / scale
      }
    }
  };
}

function validatePair(candidateA, candidateB, p0, geometry, scale, pose) {
  if (!candidateA || !candidateB) return { valid: false, reason: "faltan dos bordes" };

  const parallel = Math.acos(clamp(dot2(candidateA.direction, candidateB.direction), -1, 1));
  if (parallel > PAIR_MAX_PARALLEL_RAD) {
    return { valid: false, reason: "bordes no paralelos" };
  }

  const axis = normalize2({
    x: candidateA.direction.x + candidateB.direction.x,
    y: candidateA.direction.y + candidateB.direction.y
  });
  if (!axis) return { valid: false, reason: "eje degenerado" };

  const normal = { x: -axis.y, y: axis.x };
  const offsetA = (candidateA.center.x - p0.x) * normal.x +
    (candidateA.center.y - p0.y) * normal.y;
  const offsetB = (candidateB.center.x - p0.x) * normal.x +
    (candidateB.center.y - p0.y) * normal.y;

  if (offsetA * offsetB >= 0) {
    return { valid: false, reason: "no abrazan P0" };
  }

  const widthScanPx = Math.abs(offsetA - offsetB);
  const widthVideoPx = widthScanPx / Math.max(scale, 1e-7);
  const widthMm = widthVideoPx / Math.max(geometry.pixelsPerMm, 1e-7);

  if (widthMm < FOREARM_MIN_WIDTH_MM || widthMm > FOREARM_MAX_WIDTH_MM) {
    return { valid: false, reason: "anchura imposible", widthMm };
  }

  const deltaA = solveLocalZCorrection(pose, candidateA.direction);
  const deltaB = solveLocalZCorrection(pose, candidateB.direction);
  if (!Number.isFinite(deltaA) || !Number.isFinite(deltaB)) {
    return { valid: false, reason: "δ no resoluble", widthMm };
  }

  const deltaSpread = Math.abs(angleDelta(deltaA, deltaB));
  if (deltaSpread > PAIR_MAX_DELTA_SPREAD_RAD) {
    return { valid: false, reason: "δ distintos", widthMm, deltaSpread };
  }

  return {
    valid: true,
    reason: "doble borde válido",
    direction: axis,
    correctionTargetRad: averageAngles(deltaA, deltaB),
    widthMm,
    deltaSpread,
    quality: Math.min(candidateA.quality, candidateB.quality)
  };
}

function chooseCoherentSingle(candidates, pose) {
  if (!Number.isFinite(acceptedCorrectionRad)) return null;

  let best = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const delta = solveLocalZCorrection(pose, candidate.direction);
    if (!Number.isFinite(delta)) continue;
    const difference = Math.abs(angleDelta(delta, acceptedCorrectionRad));
    if (difference > SINGLE_MAX_DELTA_FROM_LOCK_RAD) continue;

    if (!best || candidate.quality > best.candidate.quality) {
      best = { candidate, delta, difference };
    }
  }
  return best;
}

function smoothValidDirection(rawDirection) {
  let raw = normalize2(rawDirection);
  if (!raw) return null;
  if (lastDirection) {
    if (dot2(raw, lastDirection) < 0) raw = { x: -raw.x, y: -raw.y };
    raw = normalize2({
      x: lastDirection.x * 0.72 + raw.x * 0.28,
      y: lastDirection.y * 0.72 + raw.y * 0.28
    }) || raw;
  }
  return raw;
}

function detectForearmAxis(options, pose, mediaDirection) {
  const now = performance.now();
  const geometry = videoGeometry(options, pose);
  if (!geometry || !scanContext || !mediaDirection) {
    return { detected: false, held: false, geometry: geometry || null, candidates: [] };
  }

  if (lastScanAt && now - lastScanAt < 24) {
    return {
      detected: false,
      held: Boolean(lastDirection && now - lastGoodAt <= EDGE_HOLD_MS),
      direction: lastDirection,
      quality: lastQuality,
      geometry,
      candidates: [],
      validSegments: lastValidSegments,
      reason: "entre escaneos"
    };
  }
  lastScanAt = now;

  let searchDirection = lastDirection && now - lastGoodAt < EDGE_SEARCH_MEMORY_MS
    ? lastDirection
    : mediaDirection;
  if (dot2(searchDirection, mediaDirection) < 0) {
    searchDirection = { x: -searchDirection.x, y: -searchDirection.y };
  }

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
    return { detected: false, held: false, geometry, candidates: [], reason: "sin frame" };
  }

  let imageData;
  try {
    imageData = scanContext.getImageData(0, 0, scanWidth, scanHeight);
  } catch (error) {
    return { detected: false, held: false, geometry, candidates: [], reason: "sin píxeles" };
  }

  const p0 = { x: geometry.p0.x * scale, y: geometry.p0.y * scale };
  const wristWidthVideo = clamp(
    (Number(tuning.occluderWidthMm) || 62) * geometry.pixelsPerMm,
    34,
    Math.min(geometry.videoWidth, geometry.videoHeight) * 0.36
  );
  const wristWidth = wristWidthVideo * scale;

  const rawA = scanOneSide(imageData.data, scanWidth, scanHeight, p0, searchDirection, wristWidth, 1);
  const rawB = scanOneSide(imageData.data, scanWidth, scanHeight, p0, searchDirection, wristWidth, -1);
  const candidateA = orientCandidate(rawA, mediaDirection, scale, wristWidth);
  const candidateB = orientCandidate(rawB, mediaDirection, scale, wristWidth);
  const candidates = [candidateA, candidateB].filter(Boolean);

  const pair = validatePair(candidateA, candidateB, p0, geometry, scale, pose);
  lastWidthMm = Number.isFinite(pair.widthMm) ? pair.widthMm : null;

  if (pair.valid) {
    const direction = smoothValidDirection(pair.direction);
    if (direction) {
      lastDirection = direction;
      lastGoodAt = now;
      lastQuality = pair.quality;
      lastValidSegments = candidates.map((candidate) => candidate.segment);
      lastValidationStatus = pair.reason;
      return {
        detected: true,
        held: false,
        source: "pair",
        direction,
        correctionTargetRad: pair.correctionTargetRad,
        quality: pair.quality,
        geometry,
        candidates,
        validSegments: lastValidSegments,
        widthMm: pair.widthMm,
        reason: pair.reason
      };
    }
  }

  // Antes de la primera adquisición NO aceptamos nunca un borde único.
  // Después, un borde único sólo puede actualizar si su δ está muy cerca del
  // δ bueno ya retenido. Una diagonal estable de 45° queda fuera de la puerta.
  const coherentSingle = chooseCoherentSingle(candidates, pose);
  if (coherentSingle) {
    const direction = smoothValidDirection(coherentSingle.candidate.direction);
    if (direction) {
      lastDirection = direction;
      lastGoodAt = now;
      lastQuality = coherentSingle.candidate.quality;
      lastValidSegments = [coherentSingle.candidate.segment];
      lastValidationStatus = "1 borde coherente con δ retenida";
      return {
        detected: true,
        held: false,
        source: "single",
        direction,
        correctionTargetRad: coherentSingle.delta,
        quality: coherentSingle.candidate.quality,
        geometry,
        candidates,
        validSegments: lastValidSegments,
        widthMm: pair.widthMm,
        reason: lastValidationStatus
      };
    }
  }

  lastValidationStatus = pair.reason || "candidatos rechazados";
  if (now - lastGoodAt > EDGE_SEARCH_MEMORY_MS) {
    lastDirection = null;
    lastQuality = 0;
    lastValidSegments = [];
  }

  return {
    detected: false,
    held: Boolean(lastDirection && now - lastGoodAt <= EDGE_HOLD_MS),
    direction: lastDirection,
    quality: lastQuality,
    geometry,
    candidates,
    validSegments: [],
    widthMm: pair.widthMm,
    reason: lastValidationStatus
  };
}

function updateCorrection(edge) {
  if (!edge || !edge.detected || edge.held || !Number.isFinite(edge.correctionTargetRad)) {
    if (edge && !edge.held) {
      correctionLocked = false;
      requiredGateFrames = CONFIRM_FRAMES;
      correctionGate.miss();
      lastGateStatus = acceptedCorrectionRad === null
        ? "esperando doble borde fiable"
        : "entrada rechazada · δ congelada";
    }
    return acceptedCorrectionRad;
  }

  const target = edge.correctionTargetRad;
  const now = performance.now();

  if (!correctionLocked) {
    const result = correctionGate.observe(target, requiredGateFrames);
    lastGateStatus = "confirmando " + result.count + "/" + result.required;
    if (!result.accepted) return acceptedCorrectionRad;

    correctionLocked = true;
    requiredGateFrames = CONFIRM_FRAMES;
    correctionGate.resetCandidate();
    const snap = acceptedCorrectionRad === null;
    acceptedCorrectionRad = circularFilter.update(result.value, now, snap);
    lastCalibrationAt = now;
    lastGateStatus = edge.source === "pair" ? "doble borde fiable" : "borde único coherente";
    return acceptedCorrectionRad;
  }

  const current = circularFilter.value();
  const difference = current === null ? 0 : Math.abs(angleDelta(target, current));

  if (current === null || difference <= OUTLIER_ANGLE) {
    acceptedCorrectionRad = circularFilter.update(target, now, current === null);
    lastCalibrationAt = now;
    lastGateStatus = edge.source === "pair" ? "doble borde fiable" : "borde único coherente";
    return acceptedCorrectionRad;
  }

  correctionLocked = false;
  requiredGateFrames = RECONFIRM_FRAMES;
  correctionGate.resetCandidate();
  const result = correctionGate.observe(target, requiredGateFrames);
  lastGateStatus = "salto sospechoso " + result.count + "/" + result.required;
  return acceptedCorrectionRad;
}

function rotateAroundAxis(vector, axis, angle) {
  const v = normalize3(vector);
  const k = normalize3(axis);
  if (!v || !k) return null;

  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const term1 = scale3(v, cosine);
  const term2 = scale3(cross3(k, v), sine);
  const term3 = scale3(k, dot3(k, v) * (1 - cosine));
  return normalize3(add3(add3(term1, term2), term3));
}

function applyLocalZCorrection(pose, correctionRad) {
  if (!pose || !Number.isFinite(correctionRad) || !pose.zAxis) return pose;

  const z = normalize3(pose.zAxis);
  const oldX = normalize3(pose.xAxis);
  const oldY = normalize3(pose.yAxis);
  if (!z || !oldX || !oldY) return pose;

  const rotatedX = rotateAroundAxis(oldX, z, correctionRad);
  const rotatedY = rotateAroundAxis(oldY, z, correctionRad);
  if (!rotatedX || !rotatedY) return pose;

  const x = normalize3(subtract3(rotatedX, scale3(z, dot3(rotatedX, z))));
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

function drawSegment(segment, geometry, accepted) {
  if (!segment || !overlayContext) return;
  const start = videoPointToDisplay(segment.start, geometry);
  const end = videoPointToDisplay(segment.end, geometry);
  overlayContext.save();
  overlayContext.strokeStyle = accepted ? "#00e5ff" : "#ff8a65";
  overlayContext.globalAlpha = accepted ? 1 : 0.72;
  overlayContext.lineWidth = accepted ? 5 : 3;
  overlayContext.lineCap = "round";
  overlayContext.shadowColor = "rgba(0,0,0,.72)";
  overlayContext.shadowBlur = 5;
  overlayContext.beginPath();
  overlayContext.moveTo(start.x, start.y);
  overlayContext.lineTo(end.x, end.y);
  overlayContext.stroke();
  overlayContext.restore();
}

function drawEdge(edge, correctedPose, options) {
  const width = Number(options && options.viewportWidth) || 0;
  const height = Number(options && options.viewportHeight) || 0;
  resizeOverlay(width, height);
  clearOverlay();

  if (!edgeVisible || !overlayContext || !edge || !edge.geometry) return;
  const geometry = edge.geometry;

  const acceptedSet = new Set((edge.validSegments || []).map((segment) => JSON.stringify(segment)));
  for (const candidate of edge.candidates || []) {
    const accepted = acceptedSet.has(JSON.stringify(candidate.segment));
    drawSegment(candidate.segment, geometry, accepted);
  }

  const correctedDirection = liveMediaDirection(correctedPose);
  if (correctedDirection) {
    const p0 = videoPointToDisplay(geometry.p0, geometry);
    let dx = correctedDirection.x;
    const dy = correctedDirection.y;
    if (document.body && document.body.dataset.facing === "user") dx = -dx;

    const length = clamp(
      (Number(tuning.occluderWidthMm) || 62) * geometry.pixelsPerMm * geometry.coverScale * 0.95,
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
}

function correctionLabel() {
  if (acceptedCorrectionRad === null) return lastGateStatus;
  return radiansToDegrees(acceptedCorrectionRad).toFixed(1) + "° · " + lastGateStatus;
}

export function updateWristWatch(options) {
  const pose = options && options.pose;
  if (!pose) {
    clearOverlay();
    return updateBaseWristWatch(options);
  }

  const mediaDirection = liveMediaDirection(pose);
  const edge = detectForearmAxis(options, pose, mediaDirection);
  const correctionRad = updateCorrection(edge);
  const nextPose = Number.isFinite(correctionRad)
    ? applyLocalZCorrection(pose, correctionRad)
    : pose;

  drawEdge(edge, nextPose, options);

  if (window.AmuraTrackingDiagnostics) {
    window.AmuraTrackingDiagnostics["Borde antebrazo"] = edge.detected
      ? (edge.source === "pair" ? "DOBLE válido" : "UNO coherente")
      : "RECHAZADO · δ retenida";
    window.AmuraTrackingDiagnostics["Validación borde"] = edge.reason || lastValidationStatus;
    window.AmuraTrackingDiagnostics["Anchura antebrazo"] = Number.isFinite(edge.widthMm)
      ? edge.widthMm.toFixed(0) + " mm"
      : (Number.isFinite(lastWidthMm) ? lastWidthMm.toFixed(0) + " mm" : "—");
    window.AmuraTrackingDiagnostics["Calidad borde"] = Number.isFinite(edge.quality)
      ? edge.quality.toFixed(1)
      : "—";
    window.AmuraTrackingDiagnostics["δ antebrazo"] = correctionLabel();
    window.AmuraTrackingDiagnostics["Aplicación δ"] = "rotación sobre Z vivo 3D";
    window.AmuraTrackingDiagnostics["Última calibración"] = lastCalibrationAt
      ? Math.round((performance.now() - lastCalibrationAt) / 100) / 10 + " s"
      : "—";
  }

  const state = updateBaseWristWatch({ ...options, pose: nextPose });
  return state
    ? { ...state, units: "AR-03 · MediaPipe + doble borde físico" }
    : state;
}

export function holdWristWatch() {
  return holdBaseWristWatch();
}

export function hideWristWatch() {
  clearOverlay();
  return hideBaseWristWatch();
}

ensureOverlay();