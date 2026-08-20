// AMURA AR · R09
// Una sola pregunta: ¿la línea blanca de la nube es estable con el antebrazo quieto?
// Punto de prueba: punto medio geométrico del segmento ajustado exclusivamente con los 4 centros buenos.
// R09 mantiene exactamente el algoritmo de eje de R08. Solo añade preparación 3-2-1 y contador visible durante los 10 s.
// MediaPipe se muestra SOLO como ayuda visual de colocación. No participa en la medición.

const video = document.getElementById("cameraVideo");
const maskCanvas = document.getElementById("maskCanvas");
const maskContext = maskCanvas && maskCanvas.getContext("2d");
const trackingCanvas = document.getElementById("trackingCanvas");
const readyButton = document.getElementById("maskReadyButton");
const resetButton = document.getElementById("maskResetButton");
const photoButton = document.getElementById("maskPhotoButton");
const legacyHud = document.getElementById("maskLabHud");

const AXIS_SLICE_FRACTIONS = [0.18, 0.32, 0.46, 0.60, 0.74];
const AXIS_INTERVAL_MS = 85;
const MEASURE_MS = 10000;
const SAMPLE_MS = 90;
const PREPARE_STEP_MS = 1000;

let lastAxisAt = 0;
let raf = 0;
let preparing = false;
let measuring = false;
let prepareTimer = 0;
let sampleTimer = 0;
let measureTimer = 0;
let result = null;
let frozenCanvas = null;
let allowOwnStroke = false;

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
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

function collectFiveCenters(geometry) {
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
      fraction: AXIS_SLICE_FRACTIONS[index]
    };
  }).filter(Boolean);
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

  return { mean, direction };
}

function buildTestAxis(centers, preferredDirection) {
  if (centers.length !== 5) return null;

  // Igual que R08: el centro más cercano a la muñeca queda fuera. Solo votan los otros cuatro.
  const good = centers.slice(1);
  const axis = fitAxis(good, preferredDirection);
  if (!axis) return null;

  const projections = good.map((point) =>
    (point.x - axis.mean.x) * axis.direction.x + (point.y - axis.mean.y) * axis.direction.y
  );
  const minT = Math.min(...projections);
  const maxT = Math.max(...projections);

  const start = {
    x: axis.mean.x + axis.direction.x * minT,
    y: axis.mean.y + axis.direction.y * minT
  };
  const end = {
    x: axis.mean.x + axis.direction.x * maxT,
    y: axis.mean.y + axis.direction.y * maxT
  };

  // DEFINICIÓN OFICIAL: punto medio geométrico del segmento ajustado a los 4 centros buenos.
  const midpoint = {
    x: (start.x + end.x) * 0.5,
    y: (start.y + end.y) * 0.5
  };

  return {
    start,
    end,
    midpoint,
    angleDeg: Math.atan2(axis.direction.y, axis.direction.x) * 180 / Math.PI,
    centersUsed: 4
  };
}

function drawAxis(metric) {
  if (!maskContext || !metric) return;

  maskContext.save();
  allowOwnStroke = true;

  maskContext.strokeStyle = "rgba(255,255,255,.99)";
  maskContext.lineWidth = 4;
  maskContext.beginPath();
  maskContext.moveTo(metric.start.x, metric.start.y);
  maskContext.lineTo(metric.end.x, metric.end.y);
  maskContext.stroke();

  maskContext.fillStyle = "rgba(255,255,255,.99)";
  maskContext.beginPath();
  maskContext.arc(metric.midpoint.x, metric.midpoint.y, 6, 0, Math.PI * 2);
  maskContext.fill();

  allowOwnStroke = false;
  maskContext.restore();
}

function maxPointSpread(samples) {
  let max = 0;
  for (let i = 0; i < samples.length; i += 1) {
    for (let j = i + 1; j < samples.length; j += 1) {
      max = Math.max(max, Math.hypot(samples[i].x - samples[j].x, samples[i].y - samples[j].y));
    }
  }
  return max;
}

function unwrapAngles(values) {
  if (!values.length) return [];
  const out = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    let value = values[i];
    const previous = out[out.length - 1];
    while (value - previous > 180) value -= 360;
    while (value - previous < -180) value += 360;
    out.push(value);
  }
  return out;
}

function summarize(samples) {
  if (!samples.length) return null;
  const angles = unwrapAngles(samples.map((sample) => sample.angle));
  return {
    count: samples.length,
    pointRange: maxPointSpread(samples),
    angleRange: Math.max(...angles) - Math.min(...angles)
  };
}

function resultLines(value) {
  if (!value) return [];
  return [
    "LAB · EJE NUBE · R09",
    `PUNTO EJE · rango ${value.total.pointRange.toFixed(1)} px`,
    `ÁNGULO EJE · rango ${value.total.angleRange.toFixed(2)}°`,
    `0–5 s · punto ${value.first.pointRange.toFixed(1)} px · ángulo ${value.first.angleRange.toFixed(2)}°`,
    `5–10 s · punto ${value.second.pointRange.toFixed(1)} px · ángulo ${value.second.angleRange.toFixed(2)}°`
  ];
}

function ensureUi() {
  if (legacyHud) legacyHud.style.display = "none";

  if (!document.getElementById("r09Style")) {
    const style = document.createElement("style");
    style.id = "r09Style";
    style.textContent = `
      #r09Hud {
        position:absolute; top:calc(env(safe-area-inset-top,0px) + 10px); left:10px;
        z-index:100060; width:min(350px,calc(100vw - 20px)); padding:10px 12px;
        border-radius:10px; background:rgba(4,8,14,.82); color:#fff;
        font:800 12px/1.45 Arial,sans-serif; pointer-events:none; backdrop-filter:blur(8px);
      }
      #r09Title { letter-spacing:.07em; font-size:13px; }
      #r09Status { margin-top:5px; opacity:.86; }
      #r09Result { margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,.2); white-space:pre-line; }
      #r09MeasureButton {
        left:50%; bottom:calc(env(safe-area-inset-bottom,0px) + 18px); transform:translateX(-50%);
        min-width:150px; background:rgba(126,74,220,.90);
      }
      #r09MeasureButton:disabled { opacity:.82; }
      #r09Countdown {
        position:absolute; left:50%; top:30%; transform:translate(-50%,-50%);
        z-index:100070; min-width:1.5em; text-align:center; color:#fff;
        font:900 clamp(88px,28vw,150px)/1 Arial,sans-serif;
        letter-spacing:-.04em; text-shadow:0 4px 28px rgba(0,0,0,.72);
        pointer-events:none; user-select:none;
      }
      #r09Countdown[hidden] { display:none !important; }
      body[data-status="idle"] #r09Hud, body[data-status="requesting"] #r09Hud,
      body[data-status="idle"] #r09MeasureButton, body[data-status="requesting"] #r09MeasureButton,
      body[data-status="idle"] #r09Countdown, body[data-status="requesting"] #r09Countdown { display:none !important; }
    `;
    document.head.appendChild(style);
  }

  const lab = document.querySelector(".camera-lab") || document.body;

  if (!document.getElementById("r09Hud")) {
    const hud = document.createElement("aside");
    hud.id = "r09Hud";
    hud.innerHTML = '<div id="r09Title">LAB · EJE NUBE · R09</div><div id="r09Status">ESPERANDO LISTO</div><div id="r09Result"></div>';
    lab.appendChild(hud);
  }

  if (!document.getElementById("r09Countdown")) {
    const countdown = document.createElement("div");
    countdown.id = "r09Countdown";
    countdown.hidden = true;
    countdown.setAttribute("aria-live", "polite");
    lab.appendChild(countdown);
  }

  if (!document.getElementById("r09MeasureButton")) {
    const button = document.createElement("button");
    button.id = "r09MeasureButton";
    button.className = "mask-action";
    button.type = "button";
    button.hidden = true;
    button.textContent = "MEDIR 10 s";
    lab.appendChild(button);
  }

  if (photoButton) photoButton.textContent = "GUARDAR FOTO";
  document.title = "AMURA · EJE NUBE · R09";
}

function renderResult(value) {
  const el = document.getElementById("r09Result");
  if (!el) return;
  el.textContent = value ? resultLines(value).slice(1).join("\n") : "";
}

function setStatus(text) {
  const el = document.getElementById("r09Status");
  if (el) el.textContent = text;
}

function setCountdown(value) {
  const el = document.getElementById("r09Countdown");
  if (!el) return;
  if (value === null || value === undefined || value === "") {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.textContent = String(value);
  el.hidden = false;
}

function syncUi() {
  const button = document.getElementById("r09MeasureButton");
  if (!button || !readyButton || !resetButton) return;

  const calibrated = readyButton.hidden && !resetButton.hidden;
  button.hidden = !calibrated;

  if (!preparing && !measuring && !result) {
    setStatus(calibrated ? "EJE 4 CENTROS · LISTO PARA MEDIR" : "ESPERANDO LISTO");
  }

  if (photoButton) {
    photoButton.hidden = !frozenCanvas;
    photoButton.textContent = frozenCanvas ? "GUARDAR FOTO" : "FOTO";
  }
}

function validMetric() {
  const metric = window.AmuraR09AxisMetrics;
  if (!metric || performance.now() - metric.updatedAt > 350) return null;
  return metric;
}

function stopMeasurement() {
  preparing = false;
  measuring = false;
  if (prepareTimer) clearTimeout(prepareTimer);
  if (sampleTimer) clearInterval(sampleTimer);
  if (measureTimer) clearTimeout(measureTimer);
  prepareTimer = 0;
  sampleTimer = 0;
  measureTimer = 0;
  setCountdown(null);

  const button = document.getElementById("r09MeasureButton");
  if (button) {
    button.disabled = false;
    button.textContent = "MEDIR 10 s";
  }
}

function drawFrozenOverlay(context, output, value) {
  const lines = resultLines(value);
  const fontSize = Math.max(18, Math.round(output.width * 0.016));
  const lineHeight = Math.round(fontSize * 1.32);
  const padding = Math.round(fontSize * 0.65);
  const panelWidth = Math.min(output.width - padding * 2, Math.round(output.width * 0.86));
  const panelHeight = padding * 2 + lineHeight * lines.length;

  context.fillStyle = "rgba(0,0,0,.76)";
  context.fillRect(padding, padding, panelWidth, panelHeight);
  context.fillStyle = "#ffffff";
  context.font = "700 " + fontSize + "px Arial, sans-serif";
  context.textBaseline = "top";
  lines.forEach((line, index) => {
    context.fillText(line, padding * 2, padding * 2 + index * lineHeight, panelWidth - padding * 2);
  });
}

function freezeCurrentFrame(value) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;

  // Se ejecuta automáticamente al terminar los 10 s reales, antes de que el usuario toque o mueva el teléfono.
  const metric = validMetric();
  if (metric) drawAxis(metric);

  const output = document.createElement("canvas");
  output.width = video.videoWidth;
  output.height = video.videoHeight;
  const context = output.getContext("2d");
  context.drawImage(video, 0, 0, output.width, output.height);

  if (maskCanvas && maskCanvas.width && maskCanvas.height) {
    context.drawImage(maskCanvas, 0, 0, output.width, output.height);
  }

  // Los segmentos morados de MediaPipe siguen visibles y quedan congelados en la captura R09.
  if (trackingCanvas && trackingCanvas.width && trackingCanvas.height) {
    context.drawImage(trackingCanvas, 0, 0, output.width, output.height);
  }

  drawFrozenOverlay(context, output, value);
  return output;
}

function finishMeasurement(samples, startedAt) {
  stopMeasurement();

  const midpointTime = startedAt + MEASURE_MS / 2;
  const first = samples.filter((sample) => sample.t < midpointTime);
  const second = samples.filter((sample) => sample.t >= midpointTime);
  const totalSummary = summarize(samples);
  const firstSummary = summarize(first);
  const secondSummary = summarize(second);

  if (!totalSummary || !firstSummary || !secondSummary || samples.length < 25) {
    setStatus("MEDICIÓN INVÁLIDA · REPITE");
    syncUi();
    return;
  }

  result = {
    total: totalSummary,
    first: firstSummary,
    second: secondSummary,
    measuredAt: new Date().toISOString()
  };

  window.AmuraR09MeasureResult = result;
  renderResult(result);

  // La foto queda congelada AQUÍ. Lo que ocurra después al mover el móvil ya no la modifica.
  frozenCanvas = freezeCurrentFrame(result);
  window.AmuraR09FrozenCaptureReady = Boolean(frozenCanvas);

  setStatus(frozenCanvas
    ? "CAPTURA AUTOMÁTICA LISTA · YA PUEDES MOVER EL MÓVIL"
    : "MEDICIÓN TERMINADA · CAPTURA NO DISPONIBLE");
  syncUi();
}

function beginTimedMeasurement() {
  prepareTimer = 0;
  preparing = false;

  const firstMetric = validMetric();
  if (!firstMetric) {
    setCountdown(null);
    const button = document.getElementById("r09MeasureButton");
    if (button) {
      button.disabled = false;
      button.textContent = "MEDIR 10 s";
    }
    setStatus("SIN EJE VÁLIDO · REPITE");
    syncUi();
    return;
  }

  measuring = true;
  const button = document.getElementById("r09MeasureButton");
  const samples = [];
  const startedAt = performance.now();
  if (button) button.textContent = "BRAZO QUIETO";
  setStatus("BRAZO QUIETO · MIDIENDO");
  setCountdown(10);

  const takeSample = () => {
    const metric = validMetric();
    if (metric) {
      samples.push({ t: performance.now(), x: metric.x, y: metric.y, angle: metric.angleDeg });
    }
    const remaining = Math.max(0, MEASURE_MS - (performance.now() - startedAt));
    if (remaining > 0) setCountdown(Math.max(1, Math.ceil(remaining / 1000)));
  };

  takeSample();
  sampleTimer = setInterval(takeSample, SAMPLE_MS);
  measureTimer = setTimeout(() => finishMeasurement(samples, startedAt), MEASURE_MS + 50);
}

function runPrepareCountdown(value) {
  if (!preparing) return;
  if (value <= 0) {
    setCountdown(null);
    beginTimedMeasurement();
    return;
  }

  setCountdown(value);
  setStatus("PREPÁRATE · SUJETA EL MÓVIL QUIETO");
  prepareTimer = setTimeout(() => runPrepareCountdown(value - 1), PREPARE_STEP_MS);
}

function startMeasurement() {
  if (preparing || measuring) return;

  const firstMetric = validMetric();
  if (!firstMetric) {
    setStatus("SIN EJE VÁLIDO · ESPERA");
    return;
  }

  result = null;
  frozenCanvas = null;
  window.AmuraR09MeasureResult = null;
  window.AmuraR09FrozenCaptureReady = false;
  renderResult(null);
  preparing = true;

  const button = document.getElementById("r09MeasureButton");
  if (button) {
    button.disabled = true;
    button.textContent = "PREPÁRATE";
  }
  if (photoButton) photoButton.hidden = true;

  runPrepareCountdown(3);
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function frozenFilename() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `AMURA_R09_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.png`;
}

function fallbackDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function shareFrozenCapture(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }
  if (!photoButton || photoButton.disabled) return;

  if (!frozenCanvas) {
    setStatus("NO HAY CAPTURA · HAZ MEDIR 10 s");
    return;
  }

  photoButton.disabled = true;
  const oldText = photoButton.textContent;
  photoButton.textContent = "PREPARANDO…";

  try {
    const blob = await canvasToBlob(frozenCanvas);
    if (!blob) return;

    const name = frozenFilename();
    const file = new File([blob], name, { type: "image/png" });
    const shareData = { files: [file] };

    if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
        console.warn("No se pudo abrir Compartir; se usa descarga.", error);
      }
    }

    fallbackDownload(blob, name);
  } finally {
    photoButton.disabled = false;
    photoButton.textContent = oldText || "GUARDAR FOTO";
  }
}

function resetR09() {
  stopMeasurement();
  result = null;
  frozenCanvas = null;
  window.AmuraR09MeasureResult = null;
  window.AmuraR09FrozenCaptureReady = false;
  renderResult(null);
  setStatus("ESPERANDO LISTO");
  setTimeout(syncUi, 0);
}

function axisLoop(now) {
  raf = requestAnimationFrame(axisLoop);
  if (now - lastAxisAt < AXIS_INTERVAL_MS) return;
  lastAxisAt = now;

  const snapshot = window.AmuraForearmMaskLab && window.AmuraForearmMaskLab.snapshot
    ? window.AmuraForearmMaskLab.snapshot()
    : null;

  if (!snapshot || !snapshot.calibrated || !snapshot.geometry) {
    window.AmuraR09AxisMetrics = null;
    return;
  }

  const centers = collectFiveCenters(snapshot.geometry);
  if (centers.length !== 5) {
    window.AmuraR09AxisMetrics = null;
    if (!result) {
      if (measuring) setStatus("BRAZO QUIETO · EJE PERDIDO");
      else if (preparing) setStatus("PREPÁRATE · EJE PERDIDO");
      else setStatus("ESPERANDO 5 CENTROS");
    }
    return;
  }

  const metric = buildTestAxis(centers, snapshot.geometry.elbow);
  if (!metric) return;

  drawAxis(metric);
  window.AmuraR09AxisMetrics = {
    x: metric.midpoint.x,
    y: metric.midpoint.y,
    angleDeg: metric.angleDeg,
    start: metric.start,
    end: metric.end,
    midpoint: metric.midpoint,
    centersUsed: 4,
    definition: "midpoint-of-fitted-segment-from-centers-2-to-5",
    updatedAt: performance.now()
  };
}

// Oculta la línea blanca antigua de 3 px del laboratorio base, pero deja intactos máscara y puntos.
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

ensureUi();

const measureButton = document.getElementById("r09MeasureButton");
if (measureButton) measureButton.addEventListener("click", startMeasurement);
if (photoButton) photoButton.addEventListener("click", shareFrozenCapture, true);
if (resetButton) resetButton.addEventListener("click", resetR09);
if (readyButton) readyButton.addEventListener("click", () => setTimeout(syncUi, 120));
window.addEventListener("amura-camera-state", () => setTimeout(syncUi, 0));
window.addEventListener("pagehide", () => {
  stopMeasurement();
  if (raf) cancelAnimationFrame(raf);
});

setInterval(syncUi, 250);
syncUi();
raf = requestAnimationFrame(axisLoop);
