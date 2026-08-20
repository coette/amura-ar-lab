import "./axis-r10-lab.js?v=r10.1";

// AMURA AR · R11
// Instrumentación pura sobre R10: no modifica nube, PCA, rectángulo, P0 ni línea.
// Pregunta: ¿P0 permanece centrado respecto al eje R10 en las posturas donde MediaPipe lo detecta?

const TARGETS = [0, 15, 30, 45, 60, 70, 75, 80, 85, 90, 95, 100, 105, 110, 120, 135, 150, 165, 180];
const BURST_COUNT = 3;
const BURST_GAP_MS = 220;
const COUNTDOWN_MS = 1000;
const THUMB_WIDTH = 360;

const video = document.getElementById("cameraVideo");
const maskCanvas = document.getElementById("maskCanvas");
const trackingCanvas = document.getElementById("trackingCanvas");
const readyButton = document.getElementById("maskReadyButton");
const resetButton = document.getElementById("maskResetButton");

let targetIndex = 0;
let busy = false;
let results = [];
let lastCapturedIndex = -1;
let runToken = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function median(values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) * 0.5;
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

function liveP0() {
  const diagnostics = window.AmuraTrackingDiagnostics || {};
  const detected = diagnostics["Mano detectada"] === "sí";
  const origin = parseVector(diagnostics["Origen muñeca"]);
  return detected && origin ? origin : null;
}

function mediaPipeAngle() {
  const diagnostics = window.AmuraTrackingDiagnostics || {};
  return parseAngle(diagnostics["Giro Y muñeca"]);
}

function liveAxis() {
  const metric = window.AmuraR09AxisMetrics;
  if (!metric || performance.now() - metric.updatedAt > 400) return null;
  if (!metric.start || !metric.end || !metric.midpoint) return null;
  return metric;
}

function measureSample(objectiveDeg, burstIndex) {
  const axis = liveAxis();
  const p0 = liveP0();
  const mpAngle = mediaPipeAngle();
  const width = maskCanvas && maskCanvas.width ? maskCanvas.width : 0;
  const height = maskCanvas && maskCanvas.height ? maskCanvas.height : 0;

  const sample = {
    objectiveDeg,
    burstIndex,
    capturedAt: new Date().toISOString(),
    performanceMs: performance.now(),
    mpAngleDeg: Number.isFinite(mpAngle) ? mpAngle : null,
    p0State: p0 ? "VIVO" : "PERDIDO",
    axisState: axis ? "VIVO" : "PERDIDO",
    p0Xpx: null,
    p0Ypx: null,
    axisStartXpx: axis ? axis.start.x : null,
    axisStartYpx: axis ? axis.start.y : null,
    axisEndXpx: axis ? axis.end.x : null,
    axisEndYpx: axis ? axis.end.y : null,
    axisMidXpx: axis ? axis.midpoint.x : null,
    axisMidYpx: axis ? axis.midpoint.y : null,
    axisAngleDeg: axis && Number.isFinite(axis.angleDeg) ? axis.angleDeg : null,
    perpendicularPx: null,
    longitudinalPx: null,
    maskWidth: width,
    maskHeight: height
  };

  if (p0 && width && height) {
    sample.p0Xpx = p0.x * width;
    sample.p0Ypx = p0.y * height;
  }

  if (!axis || !p0 || !width || !height) return sample;

  const dx = axis.end.x - axis.start.x;
  const dy = axis.end.y - axis.start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1e-5) return sample;

  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const rx = sample.p0Xpx - axis.midpoint.x;
  const ry = sample.p0Ypx - axis.midpoint.y;

  sample.perpendicularPx = rx * px + ry * py;
  sample.longitudinalPx = rx * ux + ry * uy;
  return sample;
}

function captureThumbnail(sample) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
  const output = document.createElement("canvas");
  output.width = THUMB_WIDTH;
  output.height = Math.max(1, Math.round(THUMB_WIDTH * video.videoHeight / video.videoWidth));
  const context = output.getContext("2d");
  context.drawImage(video, 0, 0, output.width, output.height);

  if (maskCanvas && maskCanvas.width && maskCanvas.height) {
    context.drawImage(maskCanvas, 0, 0, output.width, output.height);
  }
  if (trackingCanvas && trackingCanvas.width && trackingCanvas.height) {
    context.drawImage(trackingCanvas, 0, 0, output.width, output.height);
  }

  if (sample && sample.maskWidth && sample.maskHeight) {
    const sx = output.width / sample.maskWidth;
    const sy = output.height / sample.maskHeight;

    // Redibuja explícitamente el eje medido para que nunca falte por un refresco del canvas.
    if (sample.axisState === "VIVO" && Number.isFinite(sample.axisStartXpx) && Number.isFinite(sample.axisEndXpx)) {
      context.save();
      context.strokeStyle = "rgba(255,255,255,.99)";
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(sample.axisStartXpx * sx, sample.axisStartYpx * sy);
      context.lineTo(sample.axisEndXpx * sx, sample.axisEndYpx * sy);
      context.stroke();
      context.restore();
    }

    // Marca diagnóstica de P0 solamente en la copia guardada. No interviene en tracking.
    if (sample.p0State === "VIVO" && Number.isFinite(sample.p0Xpx) && Number.isFinite(sample.p0Ypx)) {
      const x = sample.p0Xpx * sx;
      const y = sample.p0Ypx * sy;
      context.save();
      context.strokeStyle = "rgba(255,215,0,.98)";
      context.lineWidth = 4;
      context.beginPath();
      context.arc(x, y, 10, 0, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(x - 14, y);
      context.lineTo(x + 14, y);
      context.moveTo(x, y - 14);
      context.lineTo(x, y + 14);
      context.stroke();
      context.restore();
    }
  }
  return output;
}

function ensureUi() {
  if (!document.getElementById("r11Style")) {
    const style = document.createElement("style");
    style.id = "r11Style";
    style.textContent = `
      #r09Hud, #r09Countdown, #r09MeasureButton { display:none !important; }
      #r11Hud {
        position:absolute; top:calc(env(safe-area-inset-top,0px) + 10px); left:10px;
        z-index:100080; width:min(360px,calc(100vw - 20px)); padding:10px 12px;
        border-radius:10px; background:rgba(4,8,14,.84); color:#fff;
        font:800 12px/1.45 Arial,sans-serif; pointer-events:none; backdrop-filter:blur(8px);
      }
      #r11Title { letter-spacing:.07em; font-size:13px; }
      #r11Target { margin-top:5px; font-size:22px; }
      #r11Status { margin-top:4px; opacity:.88; white-space:pre-line; }
      #r11Countdown {
        position:absolute; left:50%; top:30%; transform:translate(-50%,-50%);
        z-index:100090; color:#fff; text-align:center;
        font:900 clamp(88px,28vw,150px)/1 Arial,sans-serif;
        text-shadow:0 4px 28px rgba(0,0,0,.72); pointer-events:none;
      }
      #r11Countdown[hidden] { display:none !important; }
      #r11CaptureButton {
        left:50%; bottom:calc(env(safe-area-inset-bottom,0px) + 18px); transform:translateX(-50%);
        min-width:190px; background:rgba(126,74,220,.92);
      }
      #r11RepeatButton {
        left:12px; bottom:calc(env(safe-area-inset-bottom,0px) + 78px); min-width:132px;
      }
      #r11ExportButton {
        right:12px; bottom:calc(env(safe-area-inset-bottom,0px) + 78px); min-width:132px;
        background:rgba(0,133,164,.92);
      }
      body[data-status="idle"] #r11Hud, body[data-status="requesting"] #r11Hud,
      body[data-status="idle"] #r11CaptureButton, body[data-status="requesting"] #r11CaptureButton,
      body[data-status="idle"] #r11RepeatButton, body[data-status="requesting"] #r11RepeatButton,
      body[data-status="idle"] #r11ExportButton, body[data-status="requesting"] #r11ExportButton,
      body[data-status="idle"] #r11Countdown, body[data-status="requesting"] #r11Countdown { display:none !important; }
    `;
    document.head.appendChild(style);
  }

  const lab = document.querySelector(".camera-lab") || document.body;
  if (!document.getElementById("r11Hud")) {
    const hud = document.createElement("aside");
    hud.id = "r11Hud";
    hud.innerHTML = '<div id="r11Title">LAB · P0 VS EJE · R11</div><div id="r11Target">ESPERANDO LISTO</div><div id="r11Status">R10 intacto · R11 solo observa</div>';
    lab.appendChild(hud);
  }
  if (!document.getElementById("r11Countdown")) {
    const countdown = document.createElement("div");
    countdown.id = "r11Countdown";
    countdown.hidden = true;
    countdown.setAttribute("aria-live", "polite");
    lab.appendChild(countdown);
  }
  if (!document.getElementById("r11CaptureButton")) {
    const button = document.createElement("button");
    button.id = "r11CaptureButton";
    button.className = "mask-action";
    button.type = "button";
    button.hidden = true;
    button.textContent = "LISTO · CAPTURAR";
    lab.appendChild(button);
  }
  if (!document.getElementById("r11RepeatButton")) {
    const button = document.createElement("button");
    button.id = "r11RepeatButton";
    button.className = "mask-action";
    button.type = "button";
    button.hidden = true;
    button.textContent = "REPETIR ANTERIOR";
    lab.appendChild(button);
  }
  if (!document.getElementById("r11ExportButton")) {
    const button = document.createElement("button");
    button.id = "r11ExportButton";
    button.className = "mask-action";
    button.type = "button";
    button.hidden = true;
    button.textContent = "EXPORTAR R11";
    lab.appendChild(button);
  }

  if (resetButton) resetButton.textContent = "REINICIAR BRAZO";
  document.title = "AMURA · P0 VS EJE · R11";
}

function setCountdown(value) {
  const el = document.getElementById("r11Countdown");
  if (!el) return;
  if (value === null) {
    el.hidden = true;
    el.textContent = "";
  } else {
    el.hidden = false;
    el.textContent = String(value);
  }
}

function setStatus(text) {
  const el = document.getElementById("r11Status");
  if (el) el.textContent = text;
}

function summaryForResult(result) {
  if (!result) return "";
  const live = result.samples.filter((sample) => sample.p0State === "VIVO").length;
  const mp = median(result.samples.map((sample) => sample.mpAngleDeg));
  const perp = median(result.samples.map((sample) => sample.perpendicularPx));
  const longitudinal = median(result.samples.map((sample) => sample.longitudinalPx));
  const parts = [`P0 ${live}/3`];
  if (Number.isFinite(mp)) parts.push(`MP ${mp.toFixed(1)}°`);
  if (Number.isFinite(perp)) parts.push(`d⊥ ${perp.toFixed(1)} px`);
  if (Number.isFinite(longitudinal)) parts.push(`d∥ ${longitudinal.toFixed(1)} px`);
  return parts.join(" · ");
}

function syncUi() {
  ensureUi();
  const capture = document.getElementById("r11CaptureButton");
  const repeat = document.getElementById("r11RepeatButton");
  const exportButton = document.getElementById("r11ExportButton");
  const target = document.getElementById("r11Target");
  if (!capture || !repeat || !exportButton || !target || !readyButton || !resetButton) return;

  const calibrated = readyButton.hidden && !resetButton.hidden;
  capture.hidden = !calibrated || targetIndex >= TARGETS.length;
  capture.disabled = busy;
  repeat.hidden = !calibrated || busy || lastCapturedIndex < 0;
  exportButton.hidden = !calibrated || busy || results.length === 0;
  exportButton.textContent = targetIndex >= TARGETS.length ? "EXPORTAR R11" : `EXPORTAR ${results.length}/19`;

  if (!calibrated) {
    target.textContent = "ESPERANDO LISTO";
    setStatus("Aprende primero el brazo. R10 permanece intacto.");
    return;
  }
  if (busy) return;

  if (targetIndex >= TARGETS.length) {
    target.textContent = "19/19 · TERMINADO";
    setStatus("Secuencia completa. Pulsa EXPORTAR R11 para compartir CSV + JSON + hoja de contactos.");
    return;
  }

  target.textContent = `OBJETIVO ${TARGETS[targetIndex]}° · ${targetIndex + 1}/19`;
  const last = lastCapturedIndex >= 0 ? results.find((item) => item.targetIndex === lastCapturedIndex) : null;
  const prefix = last ? `Anterior: ${summaryForResult(last)}\n` : "";
  setStatus(prefix + "Coloca aproximadamente la muñeca y pulsa LISTO cuando estés quieto.");
  repeat.textContent = last ? `REPETIR ${last.objectiveDeg}°` : "REPETIR ANTERIOR";
}

async function captureBurst() {
  if (busy || targetIndex >= TARGETS.length) return;
  const axis = liveAxis();
  if (!axis) {
    setStatus("SIN EJE R10 VÁLIDO · ESPERA UN MOMENTO");
    return;
  }

  const token = ++runToken;
  busy = true;
  syncUi();
  const objectiveDeg = TARGETS[targetIndex];
  const targetEl = document.getElementById("r11Target");
  if (targetEl) targetEl.textContent = `OBJETIVO ${objectiveDeg}° · QUIETO`;

  for (let value = 3; value >= 1; value -= 1) {
    setCountdown(value);
    setStatus("NO MUEVAS LA MUÑECA");
    await sleep(COUNTDOWN_MS);
    if (token !== runToken) return;
  }
  setCountdown("FOTO");

  const samples = [];
  let thumbnail = null;
  for (let i = 0; i < BURST_COUNT; i += 1) {
    const sample = measureSample(objectiveDeg, i + 1);
    samples.push(sample);
    if (i === 1) thumbnail = captureThumbnail(sample);
    setStatus(`CAPTURANDO ${i + 1}/3`);
    if (i < BURST_COUNT - 1) {
      await sleep(BURST_GAP_MS);
      if (token !== runToken) return;
    }
  }
  await sleep(260);
  if (token !== runToken) return;
  setCountdown(null);

  const existingIndex = results.findIndex((item) => item.targetIndex === targetIndex);
  const result = { targetIndex, objectiveDeg, samples, thumbnail };
  if (existingIndex >= 0) results[existingIndex] = result;
  else results.push(result);
  results.sort((a, b) => a.targetIndex - b.targetIndex);

  lastCapturedIndex = targetIndex;
  targetIndex += 1;
  busy = false;
  window.AmuraR11Results = results;
  syncUi();
}

function repeatPrevious() {
  if (busy || lastCapturedIndex < 0) return;
  const index = lastCapturedIndex;
  results = results.filter((item) => item.targetIndex !== index);
  targetIndex = index;
  lastCapturedIndex = results.length ? results[results.length - 1].targetIndex : -1;
  window.AmuraR11Results = results;
  syncUi();
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function buildCsv() {
  const headers = [
    "position_index", "objective_deg", "burst_sample", "captured_at", "mp_angle_deg",
    "p0_state", "axis_state", "p0_x_px", "p0_y_px", "axis_start_x_px", "axis_start_y_px",
    "axis_end_x_px", "axis_end_y_px", "axis_mid_x_px", "axis_mid_y_px", "axis_angle_deg",
    "perpendicular_px_signed", "longitudinal_px", "mask_width", "mask_height"
  ];
  const rows = [headers.join(",")];
  results.forEach((result) => {
    result.samples.forEach((sample) => {
      const values = [
        result.targetIndex + 1, result.objectiveDeg, sample.burstIndex, sample.capturedAt, sample.mpAngleDeg,
        sample.p0State, sample.axisState, sample.p0Xpx, sample.p0Ypx, sample.axisStartXpx, sample.axisStartYpx,
        sample.axisEndXpx, sample.axisEndYpx, sample.axisMidXpx, sample.axisMidYpx, sample.axisAngleDeg,
        sample.perpendicularPx, sample.longitudinalPx, sample.maskWidth, sample.maskHeight
      ];
      rows.push(values.map(csvEscape).join(","));
    });
  });
  return rows.join("\n");
}

function buildJson() {
  return JSON.stringify({
    revision: "R11",
    base: "R10 unchanged",
    question: "P0 transverse/longitudinal position relative to R10 axis while MediaPipe is live",
    targets: TARGETS,
    burstCount: BURST_COUNT,
    exportedAt: new Date().toISOString(),
    results: results.map(({ thumbnail, ...rest }) => rest)
  }, null, 2);
}

function buildContactSheet() {
  const columns = 3;
  const tileWidth = 360;
  const imageHeight = results.find((item) => item.thumbnail)?.thumbnail?.height || 203;
  const labelHeight = 78;
  const tileHeight = imageHeight + labelHeight;
  const rows = Math.ceil(results.length / columns);
  const sheet = document.createElement("canvas");
  sheet.width = columns * tileWidth;
  sheet.height = Math.max(1, rows * tileHeight);
  const context = sheet.getContext("2d");
  context.fillStyle = "#090b10";
  context.fillRect(0, 0, sheet.width, sheet.height);
  context.font = "700 18px Arial, sans-serif";
  context.textBaseline = "top";

  results.forEach((result, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = col * tileWidth;
    const y = row * tileHeight;
    if (result.thumbnail) context.drawImage(result.thumbnail, x, y, tileWidth, imageHeight);

    const live = result.samples.filter((sample) => sample.p0State === "VIVO").length;
    const mp = median(result.samples.map((sample) => sample.mpAngleDeg));
    const perp = median(result.samples.map((sample) => sample.perpendicularPx));
    const longitudinal = median(result.samples.map((sample) => sample.longitudinalPx));
    context.fillStyle = "rgba(0,0,0,.92)";
    context.fillRect(x, y + imageHeight, tileWidth, labelHeight);
    context.fillStyle = "#ffffff";
    context.fillText(`OBJ ${result.objectiveDeg}° · P0 ${live}/3`, x + 10, y + imageHeight + 8);
    context.font = "600 15px Arial, sans-serif";
    context.fillText(`MP ${Number.isFinite(mp) ? mp.toFixed(1) + "°" : "—"} · d⊥ ${Number.isFinite(perp) ? perp.toFixed(1) + " px" : "—"}`, x + 10, y + imageHeight + 34);
    context.fillText(`d∥ ${Number.isFinite(longitudinal) ? longitudinal.toFixed(1) + " px" : "—"}`, x + 10, y + imageHeight + 55);
    context.font = "700 18px Arial, sans-serif";
  });
  return sheet;
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1800);
}

function fileStamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

async function exportResults() {
  if (busy || !results.length) return;
  busy = true;
  syncUi();
  setStatus("PREPARANDO CSV + JSON + HOJA DE CONTACTOS…");

  try {
    const stamp = fileStamp();
    const csvBlob = new Blob([buildCsv()], { type: "text/csv;charset=utf-8" });
    const jsonBlob = new Blob([buildJson()], { type: "application/json;charset=utf-8" });
    const contactBlob = await canvasToBlob(buildContactSheet());
    if (!contactBlob) throw new Error("No se pudo generar la hoja de contactos");

    const files = [
      new File([csvBlob], `AMURA_R11_${stamp}.csv`, { type: csvBlob.type }),
      new File([jsonBlob], `AMURA_R11_${stamp}.json`, { type: jsonBlob.type }),
      new File([contactBlob], `AMURA_R11_CONTACTOS_${stamp}.png`, { type: "image/png" })
    ];

    const shareData = { files };
    if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
      try {
        await navigator.share(shareData);
        setStatus("EXPORTACIÓN LISTA · PUEDES PASARME LOS 3 ARCHIVOS");
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
        console.warn("Compartir múltiple no disponible; se descargan archivos.", error);
      }
    }

    downloadBlob(csvBlob, files[0].name);
    await sleep(180);
    downloadBlob(jsonBlob, files[1].name);
    await sleep(180);
    downloadBlob(contactBlob, files[2].name);
    setStatus("ARCHIVOS GENERADOS · CSV + JSON + HOJA DE CONTACTOS");
  } catch (error) {
    console.error(error);
    setStatus("ERROR AL EXPORTAR · INTÉNTALO DE NUEVO");
  } finally {
    busy = false;
    syncUi();
  }
}

function resetR11() {
  runToken += 1;
  busy = false;
  targetIndex = 0;
  results = [];
  lastCapturedIndex = -1;
  window.AmuraR11Results = results;
  setCountdown(null);
  setTimeout(syncUi, 0);
}

function boot() {
  ensureUi();
  document.title = "AMURA · P0 VS EJE · R11";
  window.AmuraR11Diagnostic = {
    revision: "R11",
    base: "R10",
    mode: "observer-only",
    targets: TARGETS.slice()
  };

  const capture = document.getElementById("r11CaptureButton");
  const repeat = document.getElementById("r11RepeatButton");
  const exportButton = document.getElementById("r11ExportButton");
  if (capture) capture.addEventListener("click", captureBurst);
  if (repeat) repeat.addEventListener("click", repeatPrevious);
  if (exportButton) exportButton.addEventListener("click", exportResults);
  if (resetButton) resetButton.addEventListener("click", resetR11);
  if (readyButton) readyButton.addEventListener("click", () => setTimeout(syncUi, 150));

  setInterval(syncUi, 250);
  syncUi();
}

boot();
