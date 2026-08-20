// AMURA AR · R12
// Captura libre de fallos sobre R10. R12 no modifica tracking: solo observa y exporta.
// Flujo: CAPTURAR FALLO -> 3..2..1 -> 3 muestras + foto; repetir libremente; TERMINAR -> GUARDAR/COMPARTIR.

const BURST_COUNT = 3;
const BURST_GAP_MS = 220;
const COUNTDOWN_MS = 1000;
const THUMB_WIDTH = 360;
const RAW_TAP_WAIT_MS = 10000;

const video = document.getElementById("cameraVideo");
const maskCanvas = document.getElementById("maskCanvas");
const trackingCanvas = document.getElementById("trackingCanvas");
const readyButton = document.getElementById("maskReadyButton");
const resetButton = document.getElementById("maskResetButton");
const photoButton = document.getElementById("maskPhotoButton");

let latestRawSnapshot = null;
let failures = [];
let busy = false;
let finished = false;
let runToken = 0;
let sessionStartedAt = Date.now();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clonePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : null;
}

function cloneRawSnapshot(snapshot) {
  if (!snapshot) return null;
  const geometry = snapshot.geometry;
  return {
    calibrated: Boolean(snapshot.calibrated),
    currentMetrics: snapshot.currentMetrics ? { ...snapshot.currentMetrics } : null,
    initialRoll: snapshot.initialRoll,
    currentRoll: snapshot.currentRoll,
    geometry: geometry ? {
      ...geometry,
      origin: clonePoint(geometry.origin),
      elbow: clonePoint(geometry.elbow),
      perpendicular: clonePoint(geometry.perpendicular)
    } : null
  };
}

async function installRawSnapshotTapBeforeR10() {
  const startedAt = performance.now();
  while (performance.now() - startedAt < RAW_TAP_WAIT_MS) {
    const lab = window.AmuraForearmMaskLab;
    if (lab && typeof lab.snapshot === "function") {
      if (!lab.__r12RawTapInstalled) {
        const rawSnapshot = lab.snapshot.bind(lab);
        lab.snapshot = function () {
          const snapshot = rawSnapshot();
          latestRawSnapshot = cloneRawSnapshot(snapshot);
          return snapshot;
        };
        lab.__r12RawTapInstalled = true;
      }
      return true;
    }
    await sleep(20);
  }
  return false;
}

function parseVector(value) {
  if (!value || value === "—") return null;
  const numbers = String(value).split(",").map((item) => Number(item.trim()));
  if (numbers.length < 2 || !numbers.slice(0, 2).every(Number.isFinite)) return null;
  return { x: numbers[0], y: numbers[1], z: Number.isFinite(numbers[2]) ? numbers[2] : 0 };
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

function angleFromDirection(direction) {
  if (!direction || !Number.isFinite(direction.x) || !Number.isFinite(direction.y)) return null;
  return Math.atan2(direction.y, direction.x) * 180 / Math.PI;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = clamp(q, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  const mix = index - lo;
  return sorted[lo] * (1 - mix) + sorted[hi] * mix;
}

function isCloudPixel(data, index) {
  return data[index] < 35 && data[index + 1] > 185 && data[index + 2] > 210 && data[index + 3] > 35;
}

function fitAxis(points, preferredDirection) {
  if (!points || points.length < 2) return null;
  let meanX = 0;
  let meanY = 0;
  points.forEach((point) => {
    meanX += point.x;
    meanY += point.y;
  });
  meanX /= points.length;
  meanY /= points.length;

  let xx = 0;
  let xy = 0;
  let yy = 0;
  points.forEach((point) => {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  });

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  let direction = { x: Math.cos(angle), y: Math.sin(angle) };
  if (preferredDirection && direction.x * preferredDirection.x + direction.y * preferredDirection.y < 0) {
    direction = { x: -direction.x, y: -direction.y };
  }
  return { mean: { x: meanX, y: meanY }, direction };
}

function currentRawAndPatchedSnapshots() {
  const lab = window.AmuraForearmMaskLab;
  if (!lab || typeof lab.snapshot !== "function") return { raw: latestRawSnapshot, patched: null };
  let patched = null;
  try {
    patched = lab.snapshot();
  } catch (_) {
    patched = null;
  }
  return { raw: latestRawSnapshot, patched };
}

function cloudPcaDiagnostic(preferredDirection) {
  if (!maskCanvas || !maskCanvas.width || !maskCanvas.height) return null;
  const context = maskCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  let imageData;
  try {
    imageData = context.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  } catch (_) {
    return null;
  }

  const points = [];
  const data = imageData.data;
  for (let y = 0; y < imageData.height; y += 2) {
    for (let x = 0; x < imageData.width; x += 2) {
      const index = (y * imageData.width + x) * 4;
      if (!isCloudPixel(data, index)) continue;
      points.push({ x: x + 0.5, y: y + 0.5 });
    }
  }
  if (points.length < 120) return { state: "PERDIDO", angleDeg: null, pixelCount: points.length, spanPx: null };

  const axis = fitAxis(points, preferredDirection);
  if (!axis) return { state: "PERDIDO", angleDeg: null, pixelCount: points.length, spanPx: null };
  const projections = points.map((point) =>
    (point.x - axis.mean.x) * axis.direction.x + (point.y - axis.mean.y) * axis.direction.y
  );
  const wristSide = quantile(projections, 0.03);
  const elbowSide = quantile(projections, 0.97);
  const span = elbowSide - wristSide;
  if (!Number.isFinite(span) || span < 36) {
    return { state: "PERDIDO", angleDeg: null, pixelCount: points.length, spanPx: Number.isFinite(span) ? span : null };
  }

  return {
    state: "VIVO",
    angleDeg: angleFromDirection(axis.direction),
    pixelCount: points.length,
    spanPx: span
  };
}

function liveFinalAxis() {
  const metric = window.AmuraR09AxisMetrics;
  if (!metric || performance.now() - metric.updatedAt > 450) return null;
  if (!metric.start || !metric.end || !metric.midpoint) return null;
  return metric;
}

function measureSample(failureIndex, burstIndex) {
  const snapshots = currentRawAndPatchedSnapshots();
  const rawGeometry = snapshots.raw && snapshots.raw.geometry ? snapshots.raw.geometry : null;
  const roiAngleDeg = rawGeometry ? angleFromDirection(rawGeometry.elbow) : null;
  const pca = cloudPcaDiagnostic(rawGeometry ? rawGeometry.elbow : null);
  const finalAxis = liveFinalAxis();
  const p0 = liveP0();
  const mpAngleDeg = mediaPipeAngle();
  const width = maskCanvas && maskCanvas.width ? maskCanvas.width : 0;
  const height = maskCanvas && maskCanvas.height ? maskCanvas.height : 0;

  const sample = {
    failureIndex,
    burstIndex,
    capturedAt: new Date().toISOString(),
    elapsedMs: Date.now() - sessionStartedAt,
    mpAngleDeg: Number.isFinite(mpAngleDeg) ? mpAngleDeg : null,
    p0State: p0 ? "VIVO" : "PERDIDO",
    roiState: rawGeometry ? "VIVO" : "PERDIDO",
    roiAngleDeg: Number.isFinite(roiAngleDeg) ? roiAngleDeg : null,
    pcaState: pca ? pca.state : "PERDIDO",
    pcaAngleDeg: pca && Number.isFinite(pca.angleDeg) ? pca.angleDeg : null,
    pcaPixelCount: pca ? pca.pixelCount : 0,
    pcaSpanPx: pca && Number.isFinite(pca.spanPx) ? pca.spanPx : null,
    finalState: finalAxis ? "VIVO" : "PERDIDO",
    finalAngleDeg: finalAxis && Number.isFinite(finalAxis.angleDeg) ? finalAxis.angleDeg : null,
    p0Xpx: null,
    p0Ypx: null,
    finalStartXpx: finalAxis ? finalAxis.start.x : null,
    finalStartYpx: finalAxis ? finalAxis.start.y : null,
    finalEndXpx: finalAxis ? finalAxis.end.x : null,
    finalEndYpx: finalAxis ? finalAxis.end.y : null,
    finalMidXpx: finalAxis ? finalAxis.midpoint.x : null,
    finalMidYpx: finalAxis ? finalAxis.midpoint.y : null,
    perpendicularPx: null,
    longitudinalPx: null,
    maskWidth: width,
    maskHeight: height
  };

  if (p0 && width && height) {
    sample.p0Xpx = p0.x * width;
    sample.p0Ypx = p0.y * height;
  }

  if (!finalAxis || !p0 || !width || !height) return sample;
  const dx = finalAxis.end.x - finalAxis.start.x;
  const dy = finalAxis.end.y - finalAxis.start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 1e-5) return sample;

  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const rx = sample.p0Xpx - finalAxis.midpoint.x;
  const ry = sample.p0Ypx - finalAxis.midpoint.y;
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

    if (sample.finalState === "VIVO" && Number.isFinite(sample.finalStartXpx) && Number.isFinite(sample.finalEndXpx)) {
      context.save();
      context.strokeStyle = "rgba(255,255,255,.99)";
      context.lineWidth = 4;
      context.beginPath();
      context.moveTo(sample.finalStartXpx * sx, sample.finalStartYpx * sy);
      context.lineTo(sample.finalEndXpx * sx, sample.finalEndYpx * sy);
      context.stroke();
      context.restore();
    }

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
  if (!document.getElementById("r12Style")) {
    const style = document.createElement("style");
    style.id = "r12Style";
    style.textContent = `
      #r09Hud, #r09Countdown, #r09MeasureButton, #maskPhotoButton { display:none !important; }
      #r12Hud {
        position:absolute; top:calc(env(safe-area-inset-top,0px) + 10px); left:10px;
        z-index:100080; width:min(340px,calc(100vw - 20px)); padding:10px 12px;
        border-radius:10px; background:rgba(4,8,14,.84); color:#fff;
        font:800 12px/1.45 Arial,sans-serif; pointer-events:none; backdrop-filter:blur(8px);
      }
      #r12Title { letter-spacing:.07em; font-size:13px; }
      #r12Count { margin-top:5px; font-size:22px; }
      #r12Status { margin-top:4px; opacity:.88; white-space:pre-line; }
      #r12Countdown {
        position:absolute; left:50%; top:30%; transform:translate(-50%,-50%);
        z-index:100090; color:#fff; text-align:center;
        font:900 clamp(88px,28vw,150px)/1 Arial,sans-serif;
        text-shadow:0 4px 28px rgba(0,0,0,.72); pointer-events:none;
      }
      #r12Countdown[hidden] { display:none !important; }
      #r12CaptureButton {
        left:50%; bottom:calc(env(safe-area-inset-bottom,0px) + 18px); transform:translateX(-50%);
        min-width:190px; background:rgba(126,74,220,.94);
      }
      #r12FinishButton {
        right:12px; bottom:calc(env(safe-area-inset-bottom,0px) + 78px); min-width:142px;
        background:rgba(20,25,34,.92);
      }
      #r12ExportButton {
        left:50%; bottom:calc(env(safe-area-inset-bottom,0px) + 18px); transform:translateX(-50%);
        min-width:230px; background:rgba(0,133,164,.94);
      }
      #maskResetButton {
        left:12px !important; right:auto !important;
        bottom:calc(env(safe-area-inset-bottom,0px) + 78px) !important;
        min-width:0 !important; padding:0 12px !important; font-size:10px !important;
      }
      body[data-status="idle"] #r12Hud, body[data-status="requesting"] #r12Hud,
      body[data-status="idle"] #r12CaptureButton, body[data-status="requesting"] #r12CaptureButton,
      body[data-status="idle"] #r12FinishButton, body[data-status="requesting"] #r12FinishButton,
      body[data-status="idle"] #r12ExportButton, body[data-status="requesting"] #r12ExportButton,
      body[data-status="idle"] #r12Countdown, body[data-status="requesting"] #r12Countdown { display:none !important; }
    `;
    document.head.appendChild(style);
  }

  const lab = document.querySelector(".camera-lab") || document.body;
  if (!document.getElementById("r12Hud")) {
    const hud = document.createElement("aside");
    hud.id = "r12Hud";
    hud.innerHTML = '<div id="r12Title">LAB · CAPTURA DE FALLOS · R12</div><div id="r12Count">FALLOS: 0</div><div id="r12Status">R10 intacto · mueve la muñeca libremente</div>';
    lab.appendChild(hud);
  }
  if (!document.getElementById("r12Countdown")) {
    const countdown = document.createElement("div");
    countdown.id = "r12Countdown";
    countdown.hidden = true;
    countdown.setAttribute("aria-live", "polite");
    lab.appendChild(countdown);
  }
  if (!document.getElementById("r12CaptureButton")) {
    const button = document.createElement("button");
    button.id = "r12CaptureButton";
    button.className = "mask-action";
    button.type = "button";
    button.hidden = true;
    button.textContent = "CAPTURAR FALLO";
    lab.appendChild(button);
  }
  if (!document.getElementById("r12FinishButton")) {
    const button = document.createElement("button");
    button.id = "r12FinishButton";
    button.className = "mask-action";
    button.type = "button";
    button.hidden = true;
    button.textContent = "TERMINAR PRUEBA";
    lab.appendChild(button);
  }
  if (!document.getElementById("r12ExportButton")) {
    const button = document.createElement("button");
    button.id = "r12ExportButton";
    button.className = "mask-action";
    button.type = "button";
    button.hidden = true;
    button.textContent = "GUARDAR / COMPARTIR";
    lab.appendChild(button);
  }

  if (resetButton) resetButton.textContent = "REINICIAR";
  document.title = "AMURA · CAPTURA DE FALLOS · R12";
}

function setCountdown(value) {
  const el = document.getElementById("r12Countdown");
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
  const el = document.getElementById("r12Status");
  if (el) el.textContent = text;
}

function syncUi() {
  ensureUi();
  const capture = document.getElementById("r12CaptureButton");
  const finish = document.getElementById("r12FinishButton");
  const exportButton = document.getElementById("r12ExportButton");
  const count = document.getElementById("r12Count");
  if (!capture || !finish || !exportButton || !count || !readyButton || !resetButton) return;

  const calibrated = readyButton.hidden && !resetButton.hidden;
  count.textContent = `FALLOS: ${failures.length}`;

  capture.hidden = !calibrated || finished;
  finish.hidden = !calibrated || finished || busy;
  exportButton.hidden = !calibrated || !finished;
  capture.disabled = busy;
  exportButton.disabled = busy;

  if (!calibrated) {
    setStatus("Aprende primero el brazo. Después mueve la muñeca libremente.");
    return;
  }
  if (busy) return;
  if (finished) {
    setStatus(`PRUEBA TERMINADA · ${failures.length} fallo${failures.length === 1 ? "" : "s"} capturado${failures.length === 1 ? "" : "s"}`);
    return;
  }
  setStatus("Cuando veas la línea blanca mal: para la muñeca y pulsa CAPTURAR FALLO.");
}

async function captureFailure() {
  if (busy || finished) return;
  const calibrated = readyButton && resetButton && readyButton.hidden && !resetButton.hidden;
  if (!calibrated) return;

  const token = ++runToken;
  busy = true;
  syncUi();
  const failureIndex = failures.length + 1;
  const count = document.getElementById("r12Count");
  if (count) count.textContent = `FALLO ${String(failureIndex).padStart(2, "0")} · QUIETO`;

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
    const sample = measureSample(failureIndex, i + 1);
    samples.push(sample);
    if (i === 1) thumbnail = captureThumbnail(sample);
    setStatus(`CAPTURANDO ${i + 1}/3`);
    if (i < BURST_COUNT - 1) {
      await sleep(BURST_GAP_MS);
      if (token !== runToken) return;
    }
  }

  await sleep(220);
  if (token !== runToken) return;
  setCountdown(null);
  failures.push({
    failureIndex,
    capturedAt: samples[0] ? samples[0].capturedAt : new Date().toISOString(),
    samples,
    thumbnail
  });
  window.AmuraR12Failures = failures;
  busy = false;
  syncUi();
}

function finishTest() {
  if (busy || finished) return;
  finished = true;
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
    "failure_index", "burst_sample", "captured_at", "elapsed_ms", "mp_angle_deg", "p0_state",
    "roi_state", "roi_angle_deg", "pca_state", "pca_angle_deg", "pca_pixel_count", "pca_span_px",
    "final_state", "final_angle_deg", "p0_x_px", "p0_y_px",
    "final_start_x_px", "final_start_y_px", "final_end_x_px", "final_end_y_px",
    "final_mid_x_px", "final_mid_y_px", "perpendicular_px_signed", "longitudinal_px",
    "mask_width", "mask_height"
  ];
  const rows = [headers.join(",")];
  failures.forEach((failure) => {
    failure.samples.forEach((sample) => {
      const values = [
        failure.failureIndex, sample.burstIndex, sample.capturedAt, sample.elapsedMs, sample.mpAngleDeg, sample.p0State,
        sample.roiState, sample.roiAngleDeg, sample.pcaState, sample.pcaAngleDeg, sample.pcaPixelCount, sample.pcaSpanPx,
        sample.finalState, sample.finalAngleDeg, sample.p0Xpx, sample.p0Ypx,
        sample.finalStartXpx, sample.finalStartYpx, sample.finalEndXpx, sample.finalEndYpx,
        sample.finalMidXpx, sample.finalMidYpx, sample.perpendicularPx, sample.longitudinalPx,
        sample.maskWidth, sample.maskHeight
      ];
      rows.push(values.map(csvEscape).join(","));
    });
  });
  return rows.join("\n");
}

function buildJson() {
  return JSON.stringify({
    revision: "R12",
    base: "R10 unchanged",
    mode: "free visual fault capture",
    burstCount: BURST_COUNT,
    sessionStartedAt: new Date(sessionStartedAt).toISOString(),
    exportedAt: new Date().toISOString(),
    failureCount: failures.length,
    failures: failures.map(({ thumbnail, ...rest }) => rest)
  }, null, 2);
}

function median(values) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[middle] : (valid[middle - 1] + valid[middle]) * 0.5;
}

function buildContactSheet() {
  const columns = failures.length <= 2 ? 1 : (failures.length <= 8 ? 2 : 3);
  const tileWidth = 360;
  const imageHeight = failures.find((item) => item.thumbnail)?.thumbnail?.height || 240;
  const labelHeight = 100;
  const tileHeight = imageHeight + labelHeight;
  const rows = Math.max(1, Math.ceil(Math.max(1, failures.length) / columns));
  const sheet = document.createElement("canvas");
  sheet.width = columns * tileWidth;
  sheet.height = rows * tileHeight;
  const context = sheet.getContext("2d");
  context.fillStyle = "#090b10";
  context.fillRect(0, 0, sheet.width, sheet.height);
  context.textBaseline = "top";

  if (!failures.length) {
    context.fillStyle = "#ffffff";
    context.font = "700 24px Arial, sans-serif";
    context.fillText("R12 · 0 FALLOS CAPTURADOS", 18, 18);
    return sheet;
  }

  failures.forEach((failure, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = col * tileWidth;
    const y = row * tileHeight;
    if (failure.thumbnail) context.drawImage(failure.thumbnail, x, y, tileWidth, imageHeight);

    const roi = median(failure.samples.map((sample) => sample.roiAngleDeg));
    const pca = median(failure.samples.map((sample) => sample.pcaAngleDeg));
    const final = median(failure.samples.map((sample) => sample.finalAngleDeg));
    const perp = median(failure.samples.map((sample) => sample.perpendicularPx));
    const p0Live = failure.samples.filter((sample) => sample.p0State === "VIVO").length;

    context.fillStyle = "rgba(0,0,0,.94)";
    context.fillRect(x, y + imageHeight, tileWidth, labelHeight);
    context.fillStyle = "#ffffff";
    context.font = "700 18px Arial, sans-serif";
    context.fillText(`FALLO ${String(failure.failureIndex).padStart(2, "0")} · P0 ${p0Live}/3`, x + 10, y + imageHeight + 8);
    context.font = "600 14px Arial, sans-serif";
    context.fillText(`ROI ${Number.isFinite(roi) ? roi.toFixed(1) + "°" : "—"} · PCA ${Number.isFinite(pca) ? pca.toFixed(1) + "°" : "—"}`, x + 10, y + imageHeight + 34);
    context.fillText(`FINAL ${Number.isFinite(final) ? final.toFixed(1) + "°" : "—"} · d⊥ ${Number.isFinite(perp) ? perp.toFixed(1) + " px" : "—"}`, x + 10, y + imageHeight + 58);
    context.fillText(`3 muestras automáticas`, x + 10, y + imageHeight + 80);
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
  if (busy || !finished) return;
  busy = true;
  syncUi();
  setStatus("PREPARANDO PRUEBA…");

  try {
    const stamp = fileStamp();
    const csvBlob = new Blob([buildCsv()], { type: "text/csv;charset=utf-8" });
    const jsonBlob = new Blob([buildJson()], { type: "application/json;charset=utf-8" });
    const contactBlob = await canvasToBlob(buildContactSheet());
    if (!contactBlob) throw new Error("No se pudo generar la hoja de contactos");

    const files = [
      new File([csvBlob], `AMURA_R12_FALLOS_${stamp}.csv`, { type: csvBlob.type }),
      new File([jsonBlob], `AMURA_R12_FALLOS_${stamp}.json`, { type: jsonBlob.type }),
      new File([contactBlob], `AMURA_R12_CONTACTOS_${stamp}.png`, { type: "image/png" })
    ];

    const shareData = { files };
    if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
      try {
        await navigator.share(shareData);
        setStatus("PRUEBA GUARDADA · YA PUEDES PASARME LOS ARCHIVOS");
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
    setStatus("ERROR AL GUARDAR · INTÉNTALO DE NUEVO");
  } finally {
    busy = false;
    syncUi();
  }
}

function resetR12() {
  runToken += 1;
  busy = false;
  finished = false;
  failures = [];
  sessionStartedAt = Date.now();
  window.AmuraR12Failures = failures;
  setCountdown(null);
  setTimeout(syncUi, 0);
}

async function startR12() {
  ensureUi();
  await installRawSnapshotTapBeforeR10();
  await import("./axis-r10-lab.js?v=r10.1");

  // R10 arranca R09 de forma asíncrona; R12 solo oculta su UX y observa sus métricas finales.
  setTimeout(() => {
    ensureUi();
    document.title = "AMURA · CAPTURA DE FALLOS · R12";
    syncUi();
  }, 180);

  const capture = document.getElementById("r12CaptureButton");
  const finish = document.getElementById("r12FinishButton");
  const exportButton = document.getElementById("r12ExportButton");
  if (capture) capture.addEventListener("click", captureFailure);
  if (finish) finish.addEventListener("click", finishTest);
  if (exportButton) exportButton.addEventListener("click", exportResults);
  if (resetButton) resetButton.addEventListener("click", () => setTimeout(resetR12, 0));
  if (photoButton) photoButton.hidden = true;

  window.addEventListener("amura-camera-state", (event) => {
    if (!event.detail || event.detail.status !== "live") resetR12();
  });

  setInterval(syncUi, 250);
  window.AmuraR12Mode = {
    revision: "R12",
    base: "R10",
    workflow: "free-fault-capture",
    burstCount: BURST_COUNT
  };
}

startR12();
