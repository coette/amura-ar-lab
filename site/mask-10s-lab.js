function ensureMeasureUi() {
  if (!document.getElementById("maskMeasureLabStyle")) {
    const style = document.createElement("style");
    style.id = "maskMeasureLabStyle";
    style.textContent = `
      #maskMeasureButton {
        left: 50%;
        bottom: calc(env(safe-area-inset-bottom, 0px) + 18px);
        transform: translateX(-50%);
        min-width: 150px;
        background: rgba(126, 74, 220, .90);
      }
      #maskMeasureButton:disabled { opacity: .82; }
      #maskMeasurePanel {
        position: absolute;
        top: calc(env(safe-area-inset-top, 0px) + 190px);
        left: 10px;
        z-index: 100025;
        width: min(350px, calc(100vw - 20px));
        padding: 9px 11px;
        border-radius: 10px;
        background: rgba(4, 8, 14, .82);
        color: #fff;
        font: 700 11px/1.38 Arial, sans-serif;
        white-space: pre-line;
        pointer-events: none;
        backdrop-filter: blur(8px);
      }
      #maskMeasurePanel[hidden] { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  const lab = document.querySelector(".camera-lab") || document.body;
  if (!document.getElementById("maskMeasureButton")) {
    const button = document.createElement("button");
    button.id = "maskMeasureButton";
    button.className = "mask-action";
    button.type = "button";
    button.hidden = true;
    button.textContent = "MEDIR 10 s";
    lab.appendChild(button);
  }

  if (!document.getElementById("maskMeasurePanel")) {
    const panel = document.createElement("aside");
    panel.id = "maskMeasurePanel";
    panel.hidden = true;
    const value = document.createElement("div");
    value.id = "maskMeasureValue";
    panel.appendChild(value);
    lab.appendChild(panel);
  }
}

ensureMeasureUi();

const video = document.getElementById("cameraVideo");
const maskCanvas = document.getElementById("maskCanvas");
const trackingCanvas = document.getElementById("trackingCanvas");
const readyButton = document.getElementById("maskReadyButton");
const resetButton = document.getElementById("maskResetButton");
const photoButton = document.getElementById("maskPhotoButton");
const measureButton = document.getElementById("maskMeasureButton");
const measurePanel = document.getElementById("maskMeasurePanel");
const measureValue = document.getElementById("maskMeasureValue");
const stateValue = document.getElementById("maskStateValue");
const centerValue = document.getElementById("maskCenterValue");
const widthValue = document.getElementById("maskWidthValue");
const coverageValue = document.getElementById("maskCoverageValue");
const rollValue = document.getElementById("maskRollValue");
const hint = document.getElementById("maskHint");

const MEASURE_MS = 10000;
const SAMPLE_MS = 90;
let measuring = false;
let measurementResult = null;
let measureTimer = 0;
let sampleTimer = 0;

function numberFrom(text) {
  const match = String(text || "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function readMetrics() {
  if (!stateValue || !String(stateValue.textContent).includes("CRUDO")) return null;

  const centerParts = String(centerValue.textContent || "").split("/");
  if (centerParts.length < 2) return null;
  const x = numberFrom(centerParts[0]);
  const y = numberFrom(centerParts[1]);
  const width = numberFrom(widthValue.textContent);
  const coverage = numberFrom(coverageValue.textContent);
  const roll = numberFrom(rollValue.textContent);
  if (![x, y, width, coverage].every(Number.isFinite)) return null;

  return {
    t: performance.now(),
    x,
    y,
    width,
    coverage,
    roll: Number.isFinite(roll) ? roll : null
  };
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function range(values) {
  if (!values.length) return 0;
  return Math.max(...values) - Math.min(...values);
}

function edgeAverage(values, fromStart) {
  if (!values.length) return 0;
  const count = Math.max(1, Math.round(values.length * 0.20));
  const slice = fromStart ? values.slice(0, count) : values.slice(-count);
  return average(slice);
}

function summarize(samples) {
  if (!samples.length) return null;
  const xs = samples.map((sample) => sample.x);
  const ys = samples.map((sample) => sample.y);
  const widths = samples.map((sample) => sample.width);
  const coverages = samples.map((sample) => sample.coverage);
  const rolls = samples.map((sample) => sample.roll).filter(Number.isFinite);

  const centerRange = Math.hypot(range(xs), range(ys));
  const widthDrift = edgeAverage(widths, false) - edgeAverage(widths, true);

  return {
    count: samples.length,
    centerRange,
    widthMean: average(widths),
    widthRange: range(widths),
    widthDrift,
    coverageMin: Math.min(...coverages),
    coverageMax: Math.max(...coverages),
    rollStart: rolls.length ? rolls[0] : null,
    rollEnd: rolls.length ? rolls[rolls.length - 1] : null
  };
}

function signed(value) {
  return (value >= 0 ? "+" : "") + value.toFixed(1);
}

function summaryLine(label, summary) {
  if (!summary) return label + ": SIN DATOS";
  return label + ": centro " + summary.centerRange.toFixed(1) + " px · ancho Δ " +
    summary.widthRange.toFixed(1) + " px · deriva " + signed(summary.widthDrift) + " px";
}

function resultLines(result) {
  if (!result) return [];
  const total = result.total;
  return [
    "MEDICIÓN 10 s · " + total.count + " muestras",
    "CENTRO rango: " + total.centerRange.toFixed(1) + " px",
    "ANCHO media: " + total.widthMean.toFixed(1) + " px",
    "ANCHO rango: " + total.widthRange.toFixed(1) + " px",
    "ANCHO deriva: " + signed(total.widthDrift) + " px",
    "COBERTURA: " + total.coverageMin.toFixed(1) + "–" + total.coverageMax.toFixed(1) + "%",
    summaryLine("0–5 s", result.firstHalf),
    summaryLine("5–10 s", result.secondHalf)
  ];
}

function renderResult(result) {
  if (!measurePanel || !measureValue) return;
  if (!result) {
    measurePanel.hidden = true;
    measureValue.textContent = "";
    return;
  }
  measurePanel.hidden = false;
  measureValue.textContent = resultLines(result).join("\n");
}

function syncVisibility() {
  if (!measureButton || !readyButton || !resetButton) return;
  const calibrated = readyButton.hidden && !resetButton.hidden;
  measureButton.hidden = !calibrated;
  if (!calibrated && !measuring) {
    measurementResult = null;
    renderResult(null);
  }
}

function stopMeasurement(resetText) {
  measuring = false;
  if (sampleTimer) window.clearInterval(sampleTimer);
  if (measureTimer) window.clearTimeout(measureTimer);
  sampleTimer = 0;
  measureTimer = 0;
  if (measureButton) {
    measureButton.disabled = false;
    if (resetText !== false) measureButton.textContent = "MEDIR 10 s";
  }
}

function startMeasurement() {
  if (measuring) return;
  if (!readyButton.hidden || stateValue.textContent.indexOf("CRUDO") === -1) {
    hint.textContent = "Primero pulsa LISTO y espera a que la máscara esté activa.";
    return;
  }

  measurementResult = null;
  renderResult(null);
  measuring = true;
  const samples = [];
  const startedAt = performance.now();
  measureButton.disabled = true;
  hint.textContent = "Mantén el antebrazo completamente quieto durante 10 segundos.";

  const sample = () => {
    const metrics = readMetrics();
    if (metrics) samples.push(metrics);
    const remaining = Math.max(0, MEASURE_MS - (performance.now() - startedAt));
    measureButton.textContent = "QUIETO · " + (remaining / 1000).toFixed(1) + " s";
  };

  sample();
  sampleTimer = window.setInterval(sample, SAMPLE_MS);
  measureTimer = window.setTimeout(() => {
    stopMeasurement();
    const midpoint = startedAt + MEASURE_MS / 2;
    const first = samples.filter((sampleValue) => sampleValue.t < midpoint);
    const second = samples.filter((sampleValue) => sampleValue.t >= midpoint);
    const total = summarize(samples);

    if (!total || samples.length < 25) {
      hint.textContent = "Medición inválida: la máscara se perdió demasiado tiempo. Repite con el brazo quieto.";
      return;
    }

    measurementResult = {
      total,
      firstHalf: summarize(first),
      secondHalf: summarize(second),
      measuredAt: new Date().toISOString()
    };
    window.AmuraMaskMeasureResult = measurementResult;
    renderResult(measurementResult);
    hint.textContent = "Medición terminada. Pulsa FOTO para guardar máscara + MediaPipe + resultado numérico.";
  }, MEASURE_MS + 40);
}

function photoLines() {
  const lines = [
    "AMURA · LAB MÁSCARA ANTEBRAZO",
    "ESTADO: " + stateValue.textContent,
    "CENTRO X/Y: " + centerValue.textContent,
    "ANCHO: " + widthValue.textContent,
    "GIRO MEDIAPIPE: " + rollValue.textContent,
    "COBERTURA: " + coverageValue.textContent,
    "MÁSCARA: CRUDA / SIN FILTRO"
  ];
  if (measurementResult) lines.push(...resultLines(measurementResult));
  return lines;
}

function takeEnhancedPhoto(event) {
  if (event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

  const output = document.createElement("canvas");
  output.width = video.videoWidth;
  output.height = video.videoHeight;
  const context = output.getContext("2d");
  context.drawImage(video, 0, 0, output.width, output.height);
  if (maskCanvas && maskCanvas.width && maskCanvas.height) {
    context.drawImage(maskCanvas, 0, 0, output.width, output.height);
  }
  if (trackingCanvas && trackingCanvas.width && trackingCanvas.height) {
    context.drawImage(trackingCanvas, 0, 0, output.width, output.height);
  }

  const lines = photoLines();
  const fontSize = Math.max(18, Math.round(output.width * 0.016));
  const lineHeight = Math.round(fontSize * 1.32);
  const padding = Math.round(fontSize * 0.65);
  const panelWidth = Math.min(output.width - padding * 2, Math.round(output.width * 0.82));
  const panelHeight = padding * 2 + lineHeight * lines.length;
  context.fillStyle = "rgba(0,0,0,.76)";
  context.fillRect(padding, padding, panelWidth, panelHeight);
  context.fillStyle = "#ffffff";
  context.font = "600 " + fontSize + "px Arial, sans-serif";
  context.textBaseline = "top";
  lines.forEach((line, index) => {
    context.fillText(line, padding * 2, padding * 2 + index * lineHeight, panelWidth - padding * 2);
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const link = document.createElement("a");
  link.download = "amura-mask-10s-" + stamp + ".jpg";
  link.href = output.toDataURL("image/jpeg", 0.92);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

measureButton.addEventListener("click", startMeasurement);
photoButton.addEventListener("click", takeEnhancedPhoto, true);
resetButton.addEventListener("click", () => {
  stopMeasurement();
  measurementResult = null;
  window.AmuraMaskMeasureResult = null;
  renderResult(null);
  window.setTimeout(syncVisibility, 0);
});
readyButton.addEventListener("click", () => window.setTimeout(syncVisibility, 120));
window.addEventListener("amura-camera-state", () => window.setTimeout(syncVisibility, 0));

window.setInterval(syncVisibility, 250);
syncVisibility();
