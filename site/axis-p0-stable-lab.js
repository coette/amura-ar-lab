const maskCanvas = document.getElementById("maskCanvas");
const maskContext = maskCanvas && maskCanvas.getContext("2d");
const video = document.getElementById("cameraVideo");
const readyButton = document.getElementById("maskReadyButton");
const resetButton = document.getElementById("maskResetButton");
const maskStateValue = document.getElementById("maskStateValue");
const maskCenterValue = document.getElementById("maskCenterValue");
const maskDeltaValue = document.getElementById("maskDeltaValue");
const maskWidthValue = document.getElementById("maskWidthValue");
const maskHint = document.getElementById("maskHint");
const measureValue = document.getElementById("maskMeasureValue");

const AXIS_SLICE_FRACTIONS = [0.18, 0.32, 0.46, 0.60, 0.74];
const SAMPLE_INTERVAL_MS = 85;

let lastRunAt = 0;
let lastStableMetric = null;
let pendingP0AtListo = null;
let anchorCalibration = null;
let raf = 0;
let rewritingMeasure = false;
let allowOwnStroke = false;

function parseVector(value) {
  if (!value || value === "—") return null;
  const numbers = String(value).split(",").map((item) => Number(item.trim()));
  if (numbers.length < 2 || !numbers.every(Number.isFinite)) return null;
  return { x: numbers[0], y: numbers[1], z: numbers[2] || 0 };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function fitAxis(points, preferredDirection) {
  if (!points || points.length < 2) return null;
  const mean = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };

  let xx = 0;
  let xy = 0;
  let yy = 0;
  points.forEach((point) => {
    const dx = point.x - mean.x;
    const dy = point.y - mean.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  });

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  let direction = { x: Math.cos(angle), y: Math.sin(angle) };
  if (preferredDirection && direction.x * preferredDirection.x + direction.y * preferredDirection.y < 0) {
    direction = { x: -direction.x, y: -direction.y };
  }
  return { mean, direction, perpendicular: { x: -direction.y, y: direction.x } };
}

// ÚNICA lectura de P0 para posición: se llama al pulsar LISTO, nunca durante el tracking posterior.
function captureP0AtListo() {
  if (!maskCanvas || !maskCanvas.width || !maskCanvas.height) return null;
  const diagnostics = window.AmuraTrackingDiagnostics || {};
  if (diagnostics["Mano detectada"] !== "sí") return null;
  const p0 = parseVector(diagnostics["Origen muñeca"]);
  if (!p0) return null;
  return {
    x: p0.x * maskCanvas.width,
    y: p0.y * maskCanvas.height
  };
}

function coordinatesInGeometry(x, y, geometry) {
  const dx = x - geometry.origin.x;
  const dy = y - geometry.origin.y;
  return {
    t: dx * geometry.elbow.x + dy * geometry.elbow.y,
    u: dx * geometry.perpendicular.x + dy * geometry.perpendicular.y
  };
}

function isCloudPixel(data, index) {
  return data[index] < 35 && data[index + 1] > 185 && data[index + 2] > 210 && data[index + 3] > 35;
}

function collectCentersFromCloud(geometry) {
  if (!maskCanvas || !maskContext || !geometry || !maskCanvas.width || !maskCanvas.height) return [];
  let imageData;
  try {
    imageData = maskContext.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  } catch (_) {
    return [];
  }

  const halfSlice = geometry.roiEnd * 0.065;
  const buckets = AXIS_SLICE_FRACTIONS.map(() => ({ xs: [], ys: [] }));
  const data = imageData.data;
  const width = maskCanvas.width;
  const height = maskCanvas.height;

  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      if (!isCloudPixel(data, index)) continue;
      const local = coordinatesInGeometry(x + 0.5, y + 0.5, geometry);
      for (let i = 0; i < AXIS_SLICE_FRACTIONS.length; i += 1) {
        const targetT = geometry.roiEnd * AXIS_SLICE_FRACTIONS[i];
        if (Math.abs(local.t - targetT) > halfSlice) continue;
        buckets[i].xs.push(x + 0.5);
        buckets[i].ys.push(y + 0.5);
        break;
      }
    }
  }

  return buckets.map((bucket, index) => {
    if (bucket.xs.length < 10) return null;
    return {
      x: median(bucket.xs),
      y: median(bucket.ys),
      fraction: AXIS_SLICE_FRACTIONS[index],
      count: bucket.xs.length
    };
  }).filter(Boolean);
}

function projectPointOnAxis(point, axis) {
  const dx = point.x - axis.mean.x;
  const dy = point.y - axis.mean.y;
  const along = dx * axis.direction.x + dy * axis.direction.y;
  return {
    x: axis.mean.x + axis.direction.x * along,
    y: axis.mean.y + axis.direction.y * along,
    along
  };
}

function axisSpan(axis, points) {
  const projections = points.map((point) =>
    (point.x - axis.mean.x) * axis.direction.x + (point.y - axis.mean.y) * axis.direction.y
  );
  if (projections.length < 2) return 0;
  return Math.max(...projections) - Math.min(...projections);
}

function makeAnchorCalibration(p0, axis, stableCenters) {
  if (!p0 || !axis || stableCenters.length < 4) return null;
  const span = axisSpan(axis, stableCenters);
  if (!Number.isFinite(span) || span < 8) return null;
  const projected = projectPointOnAxis(p0, axis);
  return {
    alongPerSpan: projected.along / span,
    initialSpan: span,
    capturedAt: performance.now()
  };
}

function transportedAnchor(axis, stableCenters, calibration) {
  const span = axisSpan(axis, stableCenters);
  if (!calibration || !Number.isFinite(span) || span < 8) return null;
  const along = calibration.alongPerSpan * span;
  return {
    x: axis.mean.x + axis.direction.x * along,
    y: axis.mean.y + axis.direction.y * along,
    span
  };
}

function drawStableAxis(axis, centers, wristAnchor) {
  if (!maskContext || !axis || centers.length < 5 || !wristAnchor) return;
  const stableCenters = centers.slice(1);
  const projections = stableCenters.map((point) =>
    (point.x - wristAnchor.x) * axis.direction.x + (point.y - wristAnchor.y) * axis.direction.y
  );
  const far = Math.max(24, ...projections) + 18;
  const end = {
    x: wristAnchor.x + axis.direction.x * far,
    y: wristAnchor.y + axis.direction.y * far
  };

  maskContext.save();
  allowOwnStroke = true;

  maskContext.strokeStyle = "rgba(255,255,255,.99)";
  maskContext.lineWidth = 4;
  maskContext.beginPath();
  maskContext.moveTo(wristAnchor.x, wristAnchor.y);
  maskContext.lineTo(end.x, end.y);
  maskContext.stroke();

  maskContext.fillStyle = "rgba(255,255,255,.99)";
  stableCenters.forEach((point) => {
    maskContext.beginPath();
    maskContext.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
    maskContext.fill();
  });

  const excluded = centers[0];
  maskContext.strokeStyle = "rgba(255,190,90,.98)";
  maskContext.lineWidth = 2;
  maskContext.beginPath();
  maskContext.arc(excluded.x, excluded.y, 6, 0, Math.PI * 2);
  maskContext.stroke();

  // Marca de la muñeca transportada por la nube: ya no es P0 vivo.
  maskContext.strokeStyle = "rgba(255,255,255,.99)";
  maskContext.lineWidth = 3;
  maskContext.beginPath();
  maskContext.moveTo(
    wristAnchor.x - axis.perpendicular.x * 9,
    wristAnchor.y - axis.perpendicular.y * 9
  );
  maskContext.lineTo(
    wristAnchor.x + axis.perpendicular.x * 9,
    wristAnchor.y + axis.perpendicular.y * 9
  );
  maskContext.stroke();

  allowOwnStroke = false;
  maskContext.restore();
}

function updateLabels(metric) {
  if (!metric || !video || !maskCanvas) return;
  const scaleX = (video.videoWidth || maskCanvas.width) / maskCanvas.width;
  const scaleY = (video.videoHeight || maskCanvas.height) / maskCanvas.height;
  const videoMetric = {
    x: metric.x * scaleX,
    y: metric.y * scaleY
  };

  const dt = maskCenterValue && maskCenterValue.previousElementSibling;
  if (dt) dt.textContent = "EJE@P0 X/Y";
  if (maskCenterValue) maskCenterValue.textContent = videoMetric.x.toFixed(1) + " / " + videoMetric.y.toFixed(1) + " px";
  if (maskStateValue) maskStateValue.textContent = "CRUDO · EJE 4/5 · P0 CAL TRANSPORTADO";

  if (maskDeltaValue) {
    const delta = lastStableMetric
      ? Math.hypot(videoMetric.x - lastStableMetric.x, videoMetric.y - lastStableMetric.y)
      : null;
    const oldText = String(maskDeltaValue.textContent || "");
    const widthDeltaMatch = oldText.match(/ancho\s+([+-]?\d+(?:\.\d+)?)/i);
    const widthDelta = widthDeltaMatch ? Number(widthDeltaMatch[1]) : null;
    maskDeltaValue.textContent = delta === null
      ? "eje@P0 primer frame"
      : "eje@P0 " + delta.toFixed(1) + " px" +
        (Number.isFinite(widthDelta) ? " · ancho " + (widthDelta >= 0 ? "+" : "") + widthDelta.toFixed(1) + " px" : "");
    lastStableMetric = videoMetric;
  }

  window.AmuraAxisStableMetrics = {
    centerX: videoMetric.x,
    centerY: videoMetric.y,
    analysisX: metric.x,
    analysisY: metric.y,
    cloudSpan: metric.span,
    p0Source: "CAPTURADO_SOLO_EN_LISTO",
    mediaPipePositionReadsAfterListo: 0,
    centersUsed: 4,
    excludedCenter: 1,
    updatedAt: performance.now()
  };
}

function rewriteMeasurementText() {
  if (!measureValue || rewritingMeasure) return;
  const original = String(measureValue.textContent || "");
  if (!original || (!original.includes("CENTRO rango") && !original.includes("centro "))) return;
  const replaced = original
    .replace(/CENTRO rango/g, "EJE@P0 rango")
    .replace(/centro /g, "eje@P0 ");
  if (replaced === original) return;
  rewritingMeasure = true;
  measureValue.textContent = replaced;
  rewritingMeasure = false;
}

function resetAnchorExperiment() {
  pendingP0AtListo = null;
  anchorCalibration = null;
  lastStableMetric = null;
  window.AmuraAxisStableMetrics = null;
}

// Captura P0 exactamente en el gesto de LISTO. Después no volvemos a consultar P0 para posición.
if (readyButton) {
  readyButton.addEventListener("click", () => {
    resetAnchorExperiment();
    pendingP0AtListo = captureP0AtListo();
  }, true);
}

if (resetButton) {
  resetButton.addEventListener("click", resetAnchorExperiment, true);
}

function run(now) {
  raf = requestAnimationFrame(run);
  if (now - lastRunAt < SAMPLE_INTERVAL_MS) return;
  lastRunAt = now;

  const snapshot = window.AmuraForearmMaskLab && window.AmuraForearmMaskLab.snapshot
    ? window.AmuraForearmMaskLab.snapshot()
    : null;
  if (!snapshot || !snapshot.calibrated || !snapshot.geometry) return;

  const centers = collectCentersFromCloud(snapshot.geometry);
  if (centers.length < 5) return;

  const stableCenters = centers.slice(1); // el centro más próximo a la mano no decide dirección ni posición.
  const axis = fitAxis(stableCenters, snapshot.geometry.elbow);
  if (!axis) return;

  if (!anchorCalibration) {
    if (!pendingP0AtListo) {
      if (maskStateValue) maskStateValue.textContent = "CRUDO · P0 NO CAPTURADO · REPITE";
      if (maskHint) maskHint.textContent = "P0 no estaba disponible al pulsar LISTO. Pulsa REPETIR; después de LISTO no leeremos MediaPipe para posición.";
      return;
    }
    anchorCalibration = makeAnchorCalibration(pendingP0AtListo, axis, stableCenters);
    pendingP0AtListo = null;
    if (!anchorCalibration) return;
  }

  const wristAnchor = transportedAnchor(axis, stableCenters, anchorCalibration);
  if (!wristAnchor) return;

  drawStableAxis(axis, centers, wristAnchor);
  updateLabels(wristAnchor);
  rewriteMeasurementText();

  if (maskHint) {
    maskHint.textContent = "P0 se leyó una sola vez en LISTO. Ahora 4 centros de la nube transportan solos dirección, posición y escala de la muñeca; MediaPipe ya no toca la posición.";
  }
}

// Oculta la línea blanca antigua de 5 centros para que solo evaluemos el eje 4/5 + anclaje transportado.
if (maskContext) {
  const originalStroke = maskContext.stroke.bind(maskContext);
  maskContext.stroke = function (...args) {
    const white = String(this.strokeStyle || "").replace(/\s/g, "");
    const isOldAxis = !allowOwnStroke && Math.abs(Number(this.lineWidth) - 3) < 0.05 &&
      (white === "rgba(255,255,255,0.98)" || white === "rgba(255,255,255,.98)");
    if (isOldAxis) return;
    return originalStroke(...args);
  };
}

if (measureValue) {
  new MutationObserver(rewriteMeasurementText).observe(measureValue, {
    childList: true,
    characterData: true,
    subtree: true
  });
}

raf = requestAnimationFrame(run);
window.addEventListener("pagehide", () => {
  if (raf) cancelAnimationFrame(raf);
});
