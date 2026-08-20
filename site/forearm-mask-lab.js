const video = document.getElementById("cameraVideo");
const trackingCanvas = document.getElementById("trackingCanvas");
const maskCanvas = document.getElementById("maskCanvas");
const maskContext = maskCanvas.getContext("2d");
const readyButton = document.getElementById("maskReadyButton");
const resetButton = document.getElementById("maskResetButton");
const photoButton = document.getElementById("maskPhotoButton");
const maskStateValue = document.getElementById("maskStateValue");
const maskCenterValue = document.getElementById("maskCenterValue");
const maskWidthValue = document.getElementById("maskWidthValue");
const maskDeltaValue = document.getElementById("maskDeltaValue");
const maskRollValue = document.getElementById("maskRollValue");
const maskCoverageValue = document.getElementById("maskCoverageValue");
const maskHint = document.getElementById("maskHint");

const analysisCanvas = document.createElement("canvas");
const analysisContext = analysisCanvas.getContext("2d", { willReadFrequently: true });
const TARGET_ANALYSIS_WIDTH = 360;
const ANALYSIS_INTERVAL_MS = 80;

let calibrated = false;
let calibration = null;
let lastAnalysisAt = 0;
let rafHandle = 0;
let lastMetrics = null;
let currentMetrics = null;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseVector(value) {
  if (!value || value === "—") return null;
  const numbers = String(value).split(",").map((item) => Number(item.trim()));
  if (numbers.length < 2 || !numbers.every(Number.isFinite)) return null;
  return { x: numbers[0], y: numbers[1], z: numbers[2] || 0 };
}

function parseAngle(value) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function normalize2(x, y) {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length < 1e-5) return null;
  return { x: x / length, y: y / length };
}

function currentMediaPipeGuide() {
  const diagnostics = window.AmuraTrackingDiagnostics || {};
  const origin = parseVector(diagnostics["Origen muñeca"]);
  const xAxis = parseVector(diagnostics["X 9→3"]);
  const roll = parseAngle(diagnostics["Giro Y muñeca"]);
  const detected = diagnostics["Mano detectada"] === "sí";
  if (!detected || !origin || !xAxis) return null;

  const handDirection = normalize2(xAxis.x, xAxis.y);
  if (!handDirection) return null;

  return {
    origin,
    elbowDirection: { x: -handDirection.x, y: -handDirection.y },
    roll
  };
}

function ensureCanvasSize() {
  const sourceWidth = video.videoWidth || 0;
  const sourceHeight = video.videoHeight || 0;
  if (!sourceWidth || !sourceHeight) return false;

  const width = TARGET_ANALYSIS_WIDTH;
  const height = Math.max(1, Math.round(width * sourceHeight / sourceWidth));
  if (analysisCanvas.width !== width || analysisCanvas.height !== height) {
    analysisCanvas.width = width;
    analysisCanvas.height = height;
    maskCanvas.width = width;
    maskCanvas.height = height;
  }
  return true;
}

function rgbToYCbCr(r, g, b) {
  return {
    y: 0.299 * r + 0.587 * g + 0.114 * b,
    cb: 128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    cr: 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function robustChannel(values, floor) {
  const center = median(values);
  const deviations = values.map((value) => Math.abs(value - center));
  const sigma = Math.max(floor, median(deviations) * 1.4826);
  return { center, sigma };
}

function pixelGeometry(guide) {
  const width = analysisCanvas.width;
  const height = analysisCanvas.height;
  const origin = {
    x: guide.origin.x * width,
    y: guide.origin.y * height
  };
  const elbow = guide.elbowDirection;
  const perpendicular = { x: -elbow.y, y: elbow.x };

  // Ventana deliberadamente amplia. Tras LISTO queda congelada: MediaPipe no
  // puede mover ni recentrar la posición que estamos midiendo.
  const scale = width;
  return {
    origin,
    elbow,
    perpendicular,
    roiStart: scale * 0.015,
    roiEnd: scale * 0.58,
    roiHalfWidth: scale * 0.18,
    seedStart: scale * 0.10,
    seedEnd: scale * 0.30,
    seedHalfWidth: scale * 0.050,
    measureStart: scale * 0.13,
    measureEnd: scale * 0.34,
    sourceWidth: video.videoWidth,
    sourceHeight: video.videoHeight
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

function learnColorModel(imageData, geometry) {
  const ys = [];
  const cbs = [];
  const crs = [];
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const local = coordinatesInGeometry(x + 0.5, y + 0.5, geometry);
      if (
        local.t < geometry.seedStart || local.t > geometry.seedEnd ||
        Math.abs(local.u) > geometry.seedHalfWidth
      ) continue;

      const index = (y * width + x) * 4;
      const color = rgbToYCbCr(data[index], data[index + 1], data[index + 2]);
      if (color.y < 18 || color.y > 245) continue;
      ys.push(color.y);
      cbs.push(color.cb);
      crs.push(color.cr);
    }
  }

  if (ys.length < 80) return null;
  return {
    y: robustChannel(ys, 16),
    cb: robustChannel(cbs, 5.5),
    cr: robustChannel(crs, 5.5),
    sampleCount: ys.length
  };
}

function isSkinPixel(r, g, b, model) {
  const color = rgbToYCbCr(r, g, b);
  if (color.y < 15 || color.y > 250) return false;

  const cb = (color.cb - model.cb.center) / model.cb.sigma;
  const cr = (color.cr - model.cr.center) / model.cr.sigma;
  const y = (color.y - model.y.center) / model.y.sigma;
  const chromaDistance = cb * cb + cr * cr;
  const luminanceDistance = Math.abs(y);

  return chromaDistance <= 10.5 && luminanceDistance <= 4.2;
}

function drawGeometryOutline(geometry, context, calibratedState) {
  const corners = [
    { t: geometry.roiStart, u: -geometry.roiHalfWidth },
    { t: geometry.roiEnd, u: -geometry.roiHalfWidth },
    { t: geometry.roiEnd, u: geometry.roiHalfWidth },
    { t: geometry.roiStart, u: geometry.roiHalfWidth }
  ].map(({ t, u }) => ({
    x: geometry.origin.x + geometry.elbow.x * t + geometry.perpendicular.x * u,
    y: geometry.origin.y + geometry.elbow.y * t + geometry.perpendicular.y * u
  }));

  context.save();
  context.strokeStyle = calibratedState ? "rgba(255,255,255,.88)" : "rgba(255,214,102,.95)";
  context.lineWidth = 2;
  context.setLineDash([7, 5]);
  context.beginPath();
  context.moveTo(corners[0].x, corners[0].y);
  corners.slice(1).forEach((point) => context.lineTo(point.x, point.y));
  context.closePath();
  context.stroke();
  context.setLineDash([]);

  context.strokeStyle = "rgba(255,255,255,.72)";
  context.lineWidth = 1;
  const a = {
    x: geometry.origin.x + geometry.elbow.x * geometry.measureStart,
    y: geometry.origin.y + geometry.elbow.y * geometry.measureStart
  };
  const b = {
    x: geometry.origin.x + geometry.elbow.x * geometry.measureEnd,
    y: geometry.origin.y + geometry.elbow.y * geometry.measureEnd
  };
  context.beginPath();
  context.moveTo(a.x, a.y);
  context.lineTo(b.x, b.y);
  context.stroke();
  context.restore();
}

function paintPreviewGuide() {
  maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  const guide = currentMediaPipeGuide();
  if (!guide || !ensureCanvasSize()) return;
  drawGeometryOutline(pixelGeometry(guide), maskContext, false);
}

function segmentFrame(imageData, calibrationState) {
  const { geometry, model } = calibrationState;
  const width = imageData.width;
  const height = imageData.height;
  const source = imageData.data;
  const overlay = maskContext.createImageData(width, height);
  const target = overlay.data;

  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minU = Infinity;
  let maxU = -Infinity;
  let bandCandidates = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const local = coordinatesInGeometry(x + 0.5, y + 0.5, geometry);
      const inRoi = (
        local.t >= geometry.roiStart && local.t <= geometry.roiEnd &&
        Math.abs(local.u) <= geometry.roiHalfWidth
      );
      if (!inRoi) continue;

      const index = (y * width + x) * 4;
      const skin = isSkinPixel(source[index], source[index + 1], source[index + 2], model);
      if (!skin) continue;

      target[index] = 0;
      target[index + 1] = 229;
      target[index + 2] = 255;
      target[index + 3] = 92;

      if (local.t >= geometry.measureStart && local.t <= geometry.measureEnd) {
        bandCandidates += 1;
        count += 1;
        sumX += x + 0.5;
        sumY += y + 0.5;
        minU = Math.min(minU, local.u);
        maxU = Math.max(maxU, local.u);
      }
    }
  }

  maskContext.clearRect(0, 0, width, height);
  maskContext.putImageData(overlay, 0, 0);
  drawGeometryOutline(geometry, maskContext, true);

  if (count < 18 || !Number.isFinite(minU) || !Number.isFinite(maxU)) {
    return null;
  }

  const centerAnalysis = { x: sumX / count, y: sumY / count };
  const videoScaleX = geometry.sourceWidth / width;
  const videoScaleY = geometry.sourceHeight / height;
  const videoScale = (videoScaleX + videoScaleY) * 0.5;
  const widthVideoPx = Math.max(0, maxU - minU) * videoScale;
  const centerVideo = {
    x: centerAnalysis.x * videoScaleX,
    y: centerAnalysis.y * videoScaleY
  };

  maskContext.save();
  maskContext.strokeStyle = "rgba(255,255,255,.98)";
  maskContext.lineWidth = 2;
  maskContext.beginPath();
  maskContext.moveTo(centerAnalysis.x - 8, centerAnalysis.y);
  maskContext.lineTo(centerAnalysis.x + 8, centerAnalysis.y);
  maskContext.moveTo(centerAnalysis.x, centerAnalysis.y - 8);
  maskContext.lineTo(centerAnalysis.x, centerAnalysis.y + 8);
  maskContext.stroke();
  maskContext.restore();

  return {
    centerX: centerVideo.x,
    centerY: centerVideo.y,
    widthPx: widthVideoPx,
    coverage: bandCandidates > 0 ? count / bandCandidates : 0,
    pixelCount: count
  };
}

function currentRoll() {
  const diagnostics = window.AmuraTrackingDiagnostics || {};
  return parseAngle(diagnostics["Giro Y muñeca"]);
}

function updateHud(metrics) {
  const roll = currentRoll();
  maskRollValue.textContent = Number.isFinite(roll) ? roll.toFixed(1) + "°" : "—";

  if (!calibrated) {
    maskStateValue.textContent = currentMediaPipeGuide() ? "LISTA PARA APRENDER" : "BUSCANDO MANO";
    maskCenterValue.textContent = "—";
    maskWidthValue.textContent = "—";
    maskDeltaValue.textContent = "—";
    maskCoverageValue.textContent = "—";
    return;
  }

  if (!metrics) {
    maskStateValue.textContent = "MÁSCARA PERDIDA";
    maskCenterValue.textContent = "—";
    maskWidthValue.textContent = "—";
    maskDeltaValue.textContent = "—";
    maskCoverageValue.textContent = "—";
    return;
  }

  maskStateValue.textContent = "CRUDO · SIN FILTRO";
  maskCenterValue.textContent = metrics.centerX.toFixed(1) + " / " + metrics.centerY.toFixed(1) + " px";
  maskWidthValue.textContent = metrics.widthPx.toFixed(1) + " px";
  maskCoverageValue.textContent = (metrics.coverage * 100).toFixed(1) + "% · " + metrics.pixelCount + " px";

  if (lastMetrics) {
    const deltaCenter = Math.hypot(
      metrics.centerX - lastMetrics.centerX,
      metrics.centerY - lastMetrics.centerY
    );
    const deltaWidth = metrics.widthPx - lastMetrics.widthPx;
    maskDeltaValue.textContent = "centro " + deltaCenter.toFixed(1) + " px · ancho " + (deltaWidth >= 0 ? "+" : "") + deltaWidth.toFixed(1) + " px";
  } else {
    maskDeltaValue.textContent = "primer frame";
  }
}

function calibrate() {
  if (!ensureCanvasSize()) {
    maskHint.textContent = "La cámara todavía no está lista.";
    return;
  }

  const guide = currentMediaPipeGuide();
  if (!guide) {
    maskHint.textContent = "Necesito ver los segmentos de MediaPipe antes de pulsar LISTO.";
    return;
  }

  analysisContext.drawImage(video, 0, 0, analysisCanvas.width, analysisCanvas.height);
  const imageData = analysisContext.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
  const geometry = pixelGeometry(guide);
  const model = learnColorModel(imageData, geometry);
  if (!model) {
    maskHint.textContent = "No he podido aprender suficiente piel. Recoloca el antebrazo y vuelve a pulsar LISTO.";
    return;
  }

  calibration = {
    geometry,
    model,
    initialRoll: guide.roll,
    learnedAt: Date.now()
  };
  calibrated = true;
  lastMetrics = null;
  currentMetrics = null;
  readyButton.hidden = true;
  resetButton.hidden = false;
  photoButton.hidden = false;
  maskHint.textContent = "Ya no se recentra con MediaPipe. Quieto → acerca/aleja → gira 0°→90°. La máscara y los números son crudos.";
}

function resetCalibration() {
  calibrated = false;
  calibration = null;
  lastMetrics = null;
  currentMetrics = null;
  readyButton.hidden = false;
  resetButton.hidden = true;
  photoButton.hidden = true;
  maskContext.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
  maskHint.textContent = "Coloca el antebrazo sobre un fondo distinto de la piel. Cuando MediaPipe lo vea bien, pulsa LISTO.";
  updateHud(null);
}

function frameLoop(now) {
  rafHandle = requestAnimationFrame(frameLoop);
  if (now - lastAnalysisAt < ANALYSIS_INTERVAL_MS) return;
  lastAnalysisAt = now;
  if (video.readyState < 2 || !ensureCanvasSize()) return;

  if (!calibrated) {
    paintPreviewGuide();
    updateHud(null);
    return;
  }

  analysisContext.drawImage(video, 0, 0, analysisCanvas.width, analysisCanvas.height);
  const imageData = analysisContext.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
  const metrics = segmentFrame(imageData, calibration);
  updateHud(metrics);
  lastMetrics = currentMetrics;
  currentMetrics = metrics;
}

function hudLinesForPhoto() {
  return [
    "AMURA · LAB MÁSCARA ANTEBRAZO",
    "ESTADO: " + maskStateValue.textContent,
    "CENTRO X/Y: " + maskCenterValue.textContent,
    "ANCHO: " + maskWidthValue.textContent,
    "Δ FRAME: " + maskDeltaValue.textContent,
    "GIRO MEDIAPIPE: " + maskRollValue.textContent,
    "COBERTURA: " + maskCoverageValue.textContent,
    "POSICIÓN MÁSCARA: VENTANA CONGELADA TRAS LISTO",
    "MEDIAPIPE: SOLO GUÍA VISUAL / ÁNGULO"
  ];
}

function takePhoto() {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
  const output = document.createElement("canvas");
  output.width = video.videoWidth;
  output.height = video.videoHeight;
  const context = output.getContext("2d");
  context.drawImage(video, 0, 0, output.width, output.height);
  context.drawImage(maskCanvas, 0, 0, output.width, output.height);
  if (trackingCanvas && trackingCanvas.width && trackingCanvas.height) {
    context.drawImage(trackingCanvas, 0, 0, output.width, output.height);
  }

  const lines = hudLinesForPhoto();
  const fontSize = Math.max(20, Math.round(output.width * 0.018));
  const lineHeight = Math.round(fontSize * 1.35);
  const padding = Math.round(fontSize * 0.65);
  const panelWidth = Math.min(output.width - padding * 2, Math.round(output.width * 0.62));
  const panelHeight = padding * 2 + lineHeight * lines.length;
  context.fillStyle = "rgba(0,0,0,.72)";
  context.fillRect(padding, padding, panelWidth, panelHeight);
  context.fillStyle = "#ffffff";
  context.font = "600 " + fontSize + "px Arial, sans-serif";
  context.textBaseline = "top";
  lines.forEach((line, index) => {
    context.fillText(line, padding * 2, padding * 2 + index * lineHeight, panelWidth - padding * 2);
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const link = document.createElement("a");
  link.download = "amura-mask-" + stamp + ".jpg";
  link.href = output.toDataURL("image/jpeg", 0.92);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

readyButton.addEventListener("click", calibrate);
resetButton.addEventListener("click", resetCalibration);
photoButton.addEventListener("click", takePhoto);

window.addEventListener("amura-camera-state", (event) => {
  if (!event.detail || event.detail.status !== "live") {
    resetCalibration();
  }
});

resetCalibration();
rafHandle = requestAnimationFrame(frameLoop);

window.addEventListener("pagehide", () => {
  if (rafHandle) cancelAnimationFrame(rafHandle);
});
