import {
  hideWristWatch as hideBaseWristWatch,
  holdWristWatch as holdBaseWristWatch,
  updateWristWatch as updateBaseWristWatch
} from "./wrist-watch.js?v=ar02.2";
import { tuning } from "./tuner.js?v=11.2";

// AR-03 · EJE ANTEBRAZO
// Mantiene AR-02 intacta y corrige únicamente X/Y del rig.
// +X = 9→3 = codo→mano. +Z se conserva de MediaPipe.
// La dirección longitudinal se obtiene de un tramo recto del borde del
// antebrazo y se traslada en paralelo por P0.

const video = document.getElementById("cameraVideo");
const MAX_SCAN_DIMENSION = 480;
const EDGE_HOLD_MS = 350;
const EDGE_MIN_MEAN_CONTRAST = 14;
const EDGE_MIN_POINTS = 5;

const scanCanvas = document.createElement("canvas");
const scanContext = scanCanvas.getContext("2d", { willReadFrequently: true });

let overlayCanvas = null;
let overlayContext = null;
let edgeVisible = true;
let lastScanAt = 0;
let lastGoodAt = 0;
let lastDirection = null;
let lastDetectedSegment = null;
let lastQuality = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize2(vector) {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 1e-6) return null;
  return { x: vector.x / length, y: vector.y / length };
}

function normalize3(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < 1e-6) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function dot2(a, b) {
  return a.x * b.x + a.y * b.y;
}

function dot3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross3(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

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
  const a = sampleRgb(
    data,
    width,
    height,
    x + normalX * radius,
    y + normalY * radius
  );
  const b = sampleRgb(
    data,
    width,
    height,
    x - normalX * radius,
    y - normalY * radius
  );
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
      if (!best || score > best.score) {
        best = { x, y, offset, contrast, score };
      }
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

function smoothDirection(rawDirection) {
  let raw = normalize2(rawDirection);
  if (!raw) return null;

  if (lastDirection) {
    if (dot2(raw, lastDirection) < 0) {
      raw = { x: -raw.x, y: -raw.y };
    }
    const alpha = 0.34;
    const mixed = normalize2({
      x: lastDirection.x * (1 - alpha) + raw.x * alpha,
      y: lastDirection.y * (1 - alpha) + raw.y * alpha
    });
    if (mixed) raw = mixed;
  }

  return raw;
}

function detectForearmEdge(options, pose) {
  const now = performance.now();
  const geometry = videoGeometry(options, pose);
  if (!geometry || !scanContext) return null;

  if (lastScanAt && now - lastScanAt < 24) {
    return lastDirection && now - lastGoodAt <= EDGE_HOLD_MS
      ? { direction: lastDirection, segment: lastDetectedSegment, quality: lastQuality, held: true, geometry }
      : null;
  }
  lastScanAt = now;

  const handDirection = normalize2({
    x: Number(pose.xAxis && pose.xAxis.x) || 0,
    y: -(Number(pose.xAxis && pose.xAxis.y) || 0)
  });
  if (!handDirection) return null;

  let searchDirection = lastDirection && now - lastGoodAt < 900
    ? lastDirection
    : handDirection;
  if (dot2(searchDirection, handDirection) < 0) {
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
    return null;
  }

  let imageData;
  try {
    imageData = scanContext.getImageData(0, 0, scanWidth, scanHeight);
  } catch (error) {
    return null;
  }

  const p0 = {
    x: geometry.p0.x * scale,
    y: geometry.p0.y * scale
  };
  const wristWidthVideo = clamp(
    (Number(tuning.occluderWidthMm) || 62) * geometry.pixelsPerMm,
    34,
    Math.min(geometry.videoWidth, geometry.videoHeight) * 0.36
  );
  const wristWidth = wristWidthVideo * scale;

  const candidateA = scanOneSide(
    imageData.data,
    scanWidth,
    scanHeight,
    p0,
    searchDirection,
    wristWidth,
    1
  );
  const candidateB = scanOneSide(
    imageData.data,
    scanWidth,
    scanHeight,
    p0,
    searchDirection,
    wristWidth,
    -1
  );

  let chosen = null;
  if (candidateA && candidateB) {
    chosen = candidateA.quality >= candidateB.quality ? candidateA : candidateB;
  } else {
    chosen = candidateA || candidateB;
  }

  if (chosen) {
    let rawDirection = chosen.direction;
    if (dot2(rawDirection, handDirection) < 0) {
      rawDirection = { x: -rawDirection.x, y: -rawDirection.y };
    }
    const direction = smoothDirection(rawDirection);
    if (direction) {
      const halfSpan = Math.max(chosen.span * 0.5, wristWidth * 0.35);
      lastDirection = direction;
      lastGoodAt = now;
      lastQuality = chosen.quality;
      lastDetectedSegment = {
        start: {
          x: (chosen.center.x - direction.x * halfSpan) / scale,
          y: (chosen.center.y - direction.y * halfSpan) / scale
        },
        end: {
          x: (chosen.center.x + direction.x * halfSpan) / scale,
          y: (chosen.center.y + direction.y * halfSpan) / scale
        }
      };
      return {
        direction,
        segment: lastDetectedSegment,
        quality: chosen.quality,
        held: false,
        geometry
      };
    }
  }

  lastDetectedSegment = null;
  if (lastDirection && now - lastGoodAt <= EDGE_HOLD_MS) {
    return {
      direction: lastDirection,
      segment: null,
      quality: lastQuality,
      held: true,
      geometry
    };
  }

  lastDirection = null;
  lastQuality = 0;
  return null;
}

function correctedPose(pose, edge) {
  if (!pose || !edge || !edge.direction || !pose.zAxis) return pose;

  const z = normalize3({
    x: Number(pose.zAxis.x) || 0,
    y: Number(pose.zAxis.y) || 0,
    z: Number(pose.zAxis.z) || 0
  });
  if (!z) return pose;

  let desired = normalize3({
    x: edge.direction.x,
    y: -edge.direction.y,
    z: 0
  });
  if (!desired) return pose;

  const projection = dot3(desired, z);
  const projectedDesired = {
    x: desired.x - z.x * projection,
    y: desired.y - z.y * projection,
    z: desired.z - z.z * projection
  };
  if (Math.hypot(projectedDesired.x, projectedDesired.y, projectedDesired.z) < 0.20) {
    return pose;
  }
  desired = normalize3(projectedDesired);
  if (!desired) return pose;

  const oldX = normalize3({
    x: Number(pose.xAxis.x) || 0,
    y: Number(pose.xAxis.y) || 0,
    z: Number(pose.xAxis.z) || 0
  });
  if (oldX && dot3(desired, oldX) < 0) {
    desired = { x: -desired.x, y: -desired.y, z: -desired.z };
  }

  const y = normalize3(cross3(z, desired));
  if (!y) return pose;
  const x = normalize3(cross3(y, z));
  if (!x) return pose;

  return {
    ...pose,
    xAxis: x,
    yAxis: y,
    zAxis: z
  };
}

function videoPointToDisplay(point, geometry) {
  let x = point.x * geometry.coverScale + geometry.offsetX;
  const y = point.y * geometry.coverScale + geometry.offsetY;
  if (document.body && document.body.dataset.facing === "user") {
    x = geometry.displayWidth - x;
  }
  return { x, y };
}

function drawEdge(edge, options, pose) {
  const width = Number(options && options.viewportWidth) || 0;
  const height = Number(options && options.viewportHeight) || 0;
  resizeOverlay(width, height);
  clearOverlay();
  if (!edgeVisible || !overlayContext || !edge || !edge.geometry) return;

  const geometry = edge.geometry;
  if (edge.segment) {
    const start = videoPointToDisplay(edge.segment.start, geometry);
    const end = videoPointToDisplay(edge.segment.end, geometry);

    overlayContext.save();
    overlayContext.strokeStyle = "#00e5ff";
    overlayContext.lineWidth = 5;
    overlayContext.lineCap = "round";
    overlayContext.shadowColor = "rgba(0,0,0,.72)";
    overlayContext.shadowBlur = 6;
    overlayContext.beginPath();
    overlayContext.moveTo(start.x, start.y);
    overlayContext.lineTo(end.x, end.y);
    overlayContext.stroke();
    overlayContext.restore();
  }

  if (edge.direction && pose) {
    const p0 = videoPointToDisplay(geometry.p0, geometry);
    let dx = edge.direction.x;
    const dy = edge.direction.y;
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

export function updateWristWatch(options) {
  const pose = options && options.pose;
  if (!pose) {
    clearOverlay();
    return updateBaseWristWatch(options);
  }

  const edge = detectForearmEdge(options, pose);
  const nextPose = edge ? correctedPose(pose, edge) : pose;
  drawEdge(edge, options, pose);

  if (window.AmuraTrackingDiagnostics) {
    window.AmuraTrackingDiagnostics["Borde antebrazo"] = edge
      ? (edge.held ? "retenido" : "detectado")
      : "fallback MediaPipe";
    window.AmuraTrackingDiagnostics["Calidad borde"] = edge
      ? edge.quality.toFixed(1)
      : "—";
  }

  const state = updateBaseWristWatch({
    ...options,
    pose: nextPose
  });
  return state ? { ...state, units: "AR-03 · X por borde de antebrazo" } : state;
}

export function holdWristWatch() {
  return holdBaseWristWatch();
}

export function hideWristWatch() {
  clearOverlay();
  return hideBaseWristWatch();
}

ensureOverlay();
