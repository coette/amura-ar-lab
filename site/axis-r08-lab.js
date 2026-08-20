// AMURA AR · R08
// Una sola pregunta: ¿la línea blanca de la nube es estable con el antebrazo quieto?
// Punto de prueba: punto medio geométrico del segmento ajustado exclusivamente con los 4 centros buenos.
// R08 no usa P0, landmarks, giro MediaPipe, ancho, Z, profundidad ni textos del HUD para medir.
// MediaPipe vuelve a mostrarse SOLO como ayuda visual de colocación. No participa en la medición.

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

let lastAxisAt = 0;
let raf = 0;
let measuring = false;
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

  // R08: el centro más cercano a la muñeca queda fuera. Solo votan los otros cuatro.
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

  // DEFINICIÓN OFICIAL R08: punto medio geométrico del segmento ajustado a los 4 centros buenos.
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
    "LAB · EJE NUBE · R08",
    `PUNTO EJE · rango ${value.total.pointRange.toFixed(1)} px`,
    `ÁNGULO EJE · rango ${value.total.angleRange.toFixed(2)}°`,
    `0–5 s · punto ${value.first.pointRange.toFixed(1)} px · ángulo ${value.first.angleRange.toFixed(2)}°`,
    `5–10 s · punto ${value.second.pointRange.toFixed(1)} px · ángulo ${value.second.angleRange.toFixed(2)}°`
  ];
}

function ensureUi() {
  if (legacyHud) legacyHud.style.display = "none";

  if (!document.getElementById("r08Style")) {
    const style = document.createElement("style");
    style.id = "r08Style";
    style.textContent = `
      #r08Hud {
        position:absolute; top:calc(env(safe-area-inset-top,0px) + 10px); left:10px;
        z-index:100060; width:min(350px,calc(100vw - 20px)); padding:10px 12px;
        border-radius:10px; background:rgba(4,8,14,.82); color:#fff;
        font:800 12px/1.45 Arial,sans-serif; pointer-events:none; backdrop-filter:blur(8px);
      }
      #r08Title { letter-spacing:.07em; font-size:13px; }
      #r08Status { margin-top:5px; opacity:.86; }
      #r08Result { margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,.2); white-space:pre-line; }
      #r08MeasureButton {
        left:50%; bottom:calc(env(safe-area-inset-bottom,0px) + 18px); transform:translateX(-50%);
        min-width:150px; background:rgba(126,74,220,.90);
      }
      #r08MeasureButton:disabled { opacity:.82; }
      body[data-status="idle"] #r08Hud, body[data-status="requesting"] #r08Hud,
      body[data-status="idle"] #r08MeasureButton, body[data-status="requesting"] #r08MeasureButton { display:none !important; }
    `;
    document.head.appendChild(style);
  }

  const lab = document.querySelector(".camera-lab") || document.body;

  if (!document.getElementById("r08Hud")) {
    const hud = document.createElement("aside");
    hud.id = "r08Hud";
    hud.innerHTML = '<div id="r08Title">LAB · EJE NUBE · R08</div><div id="r08Status">ESPERANDO LISTO</div><div id="r08Result"></div>';
    lab.appendChild(hud);
  }

  if (!document.getElementById("r08MeasureButton")) {
    const button = document.createElement("button");
    button.id = "r08MeasureButton";
    button.className = "mask-action";
    button.type = "button";
    button.hidden = true;
    button.textContent = "MEDIR 10 s";
    lab.appendChild(button);
  }

  if (photoButton) photoButton.textContent = "GUARDAR FOTO";
  document.title = "AMURA · EJE NUBE · R08";
}

function renderResult(value) {
  const el = document.getElementById("r08Result");
  if (!el) return;
  el.textContent = value ? resultLines(value).slice(1).join("\n") : "";
}

function setStatus(text) {
  const el = document.getElementById("r08Status");
  if (el) el.textContent = text;
}

function syncUi() {
  const button = document.getElementById("r08MeasureButton");
  if (!button || !readyButton || !resetButton) return;

  const calibrated = readyButton.hidden && !resetButton.hidden;
  button.hidden = !calibrated;

  if (!measuring && !result) {
    setStatus(calibrated ? "EJE 4 CENTROS · LISTO PARA MEDIR" : "ESPERANDO LISTO");
  }

  if (photoButton) {
    photoButton.hidden = !frozenCanvas;
    photoButton.textContent = frozenCanvas ? "GUARDAR FOTO" : "FOTO";
  }
}

function validMetric() {
  const metric = window.AmuraR08AxisMetrics;
  if (!metric || performance.now() - metric.updatedAt > 350) return null;
  return metric;
}

function stopMeasurement() {
  measuring = false;
  if (sampleTimer) clearInterval(sampleTimer);
  if (measureTimer) clearTimeout(measureTimer);
  sampleTimer = 0;
  measureTimer = 0;

  const button = document.getElementById("r08MeasureButton");
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

  // Se ejecuta automáticamente al terminar los 10 s, antes de que el usuario toque o mueva el teléfono.
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

  // Los segmentos morados de MediaPipe vuelven a aparecer y también quedan congelados en la captura R08.
  if (trackingCanvas && trackingCanvas.width && trackingCanvas.height) {
    context.drawImage(trackingCanvas, 0, 0, output.width, output.height);
  }

  drawFrozenOverlay(context, output, value);
  return output;
}

function startMeasurement() {
  if (measuring) return;

  const firstMetric = validMetric();
  if (!firstMetric) {
    setStatus("SIN EJE VÁLIDO · ESPERA");
    return;
  }

  result = null;
  frozenCanvas = null;
  window.AmuraR08MeasureResult = null;
  window.AmuraR08FrozenCaptureReady = false;
  renderResult(null);
  measuring = true;

  const button = document.getElementById("r08MeasureButton");
  const samples = [];
  const startedAt = performance.now();
  button.disabled = true;
  setStatus("BRAZO QUIETO · MIDIENDO");

  const takeSample = () => {
    const metric = validMetric();
    if (metric) {
      samples.push({ t: performance.now(), x: metric.x, y: metric.y, angle: metric.angleDeg });
    }
    const remaining = Math.max(0, MEASURE_MS - (performance.now() - startedAt));
    button.textContent = `QUIETO · ${(remaining / 1000).toFixed(1)} s`;
  };

  takeSample();
  sampleTimer = setInterval(takeSample, SAMPLE_MS);
  measureTimer = setTimeout(() => {
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

    window.AmuraR08MeasureResult = result;
    renderResult(result);

    // La foto queda congelada AQUÍ. Lo que ocurra después al mover el móvil ya no la modifica.
    frozenCanvas = freezeCurrentFrame(result);
    window.AmuraR08FrozenCaptureReady = Boolean(frozenCanvas);

    setStatus(frozenCanvas
      ? "CAPTURA AUTOMÁTICA LISTA · YA PUEDES MOVER EL MÓVIL"
      : "MEDICIÓN TERMINADA · CAPTURA NO DISPONIBLE");
    syncUi();
  }, MEASURE_MS + 50);
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function frozenFilename() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `AMURA_R08_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.png`;
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

function resetR08() {
  stopMeasurement();
  result = null;
  frozenCanvas = null;
  window.AmuraR08MeasureResult = null;
  window.AmuraR08FrozenCaptureReady = false;
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
    window.AmuraR08AxisMetrics = null;
    return;
  }

  const centers = collectFiveCenters(snapshot.geometry);
  if (centers.length !== 5) {
    window.AmuraR08AxisMetrics = null;
    if (!result) setStatus(measuring ? "BRAZO QUIETO · EJE PERDIDO" : "ESPERANDO 5 CENTROS");
    return;
  }

  const metric = buildTestAxis(centers, snapshot.geometry.elbow);
  if (!metric) return;

  drawAxis(metric);
  window.AmuraR08AxisMetrics = {
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

const measureButton = document.getElementById("r08MeasureButton");
if (measureButton) measureButton.addEventListener("click", startMeasurement);
if (photoButton) photoButton.addEventListener("click", shareFrozenCapture, true);
if (resetButton) resetButton.addEventListener("click", resetR08);
if (readyButton) readyButton.addEventListener("click", () => setTimeout(syncUi, 120));
window.addEventListener("amura-camera-state", () => setTimeout(syncUi, 0));
window.addEventListener("pagehide", () => {
  stopMeasurement();
  if (raf) cancelAnimationFrame(raf);
});

setInterval(syncUi, 250);
syncUi();
raf = requestAnimationFrame(axisLoop);
