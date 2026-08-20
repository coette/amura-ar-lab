// AMURA AR · R12 BANCO
// Banco guiado de 8 fotogramas limpios sobre R10. R12 no modifica tracking: solo observa, captura y exporta.
// Flujo: LISTO -> objetivos 0/30/60/90/135/150/165/180 -> 3..2..1 -> foto limpia + 3 muestras -> guardar banco.

const TARGETS = [0, 30, 60, 90, 135, 150, 165, 180];
const BURST_COUNT = 3;
const BURST_GAP_MS = 220;
const COUNTDOWN_MS = 1000;
const RAW_TAP_WAIT_MS = 10000;
const JPEG_QUALITY = 0.94;

const video = document.getElementById("cameraVideo");
const maskCanvas = document.getElementById("maskCanvas");
const readyButton = document.getElementById("maskReadyButton");
const resetButton = document.getElementById("maskResetButton");
const photoButton = document.getElementById("maskPhotoButton");

let latestRawSnapshot = null;
let captures = [];
let targetIndex = 0;
let busy = false;
let finished = false;
let runToken = 0;
let sessionStartedAt = Date.now();
let noticeText = "";
let noticeUntil = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clonePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    ? { x: point.x, y: point.y }
    : null;
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
      if (!lab.__r12BankRawTapInstalled) {
        const rawSnapshot = lab.snapshot.bind(lab);
        lab.snapshot = function () {
          const snapshot = rawSnapshot();
          latestRawSnapshot = cloneRawSnapshot(snapshot);
          return snapshot;
        };
        lab.__r12BankRawTapInstalled = true;
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

function currentRawSnapshot() {
  const lab = window.AmuraForearmMaskLab;
  if (!lab || typeof lab.snapshot !== "function") return latestRawSnapshot;
  try {
    lab.snapshot();
  } catch (_) {
    return latestRawSnapshot;
  }
  return latestRawSnapshot;
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

  if (points.length < 120) {
    return { state: "PERDIDO", angleDeg: null, pixelCount: points.length, spanPx: null };
  }

  const axis = fitAxis(points, preferredDirection);
  if (!axis) return { state: "PERDIDO", angleDeg: null, pixelCount: points.length, spanPx: null };

  const projections = points.map((point) =>
    (point.x - axis.mean.x) * axis.direction.x + (point.y - axis.mean.y) * axis.direction.y
  );
  const wristSide = quantile(projections, 0.03);
  const elbowSide = quantile(projections, 0.97);
  const span = elbowSide - wristSide;
  if (!Number.isFinite(span) || span < 36) {
    return {
      state: "PERDIDO",
      angleDeg: null,
      pixelCount: points.length,
      spanPx: Number.isFinite(span) ? span : null
    };
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

function imageFileName(index, targetDeg) {
  const position = String(index + 1).padStart(2, "0");
  const angle = String(targetDeg).padStart(3, "0");
  return `postura_${position}_${angle}deg.jpg`;
}

function measureSample(index, targetDeg, burstIndex, imageFile) {
  const rawSnapshot = currentRawSnapshot();
  const rawGeometry = rawSnapshot && rawSnapshot.geometry ? rawSnapshot.geometry : null;
  const roiAngleDeg = rawGeometry ? angleFromDirection(rawGeometry.elbow) : null;
  const pca = cloudPcaDiagnostic(rawGeometry ? rawGeometry.elbow : null);
  const finalAxis = liveFinalAxis();
  const p0 = liveP0();
  const mpAngleDeg = mediaPipeAngle();
  const width = maskCanvas && maskCanvas.width ? maskCanvas.width : 0;
  const height = maskCanvas && maskCanvas.height ? maskCanvas.height : 0;

  const sample = {
    postureIndex: index + 1,
    targetDeg,
    imageFile,
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

function captureCleanCanvas() {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
  const output = document.createElement("canvas");
  output.width = video.videoWidth;
  output.height = video.videoHeight;
  const context = output.getContext("2d");
  if (!context) return null;
  // IMPORTANTE: solo el vídeo. No se dibujan máscara, landmarks, ROI, P0 ni línea blanca.
  context.drawImage(video, 0, 0, output.width, output.height);
  return output;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function ensureUi() {
  if (!document.getElementById("r12BankStyle")) {
    const style = document.createElement("style");
    style.id = "r12BankStyle";
    style.textContent = `
      #r09Hud, #r09Countdown, #r09MeasureButton, #maskPhotoButton, #maskLabHud { display:none !important; }
      #r12BankHud {
        position:absolute; top:calc(env(safe-area-inset-top,0px) + 10px); left:10px;
        z-index:100080; width:min(360px,calc(100vw - 20px)); padding:11px 13px;
        border-radius:11px; background:rgba(4,8,14,.86); color:#fff;
        font:800 12px/1.45 Arial,sans-serif; pointer-events:none; backdrop-filter:blur(8px);
      }
      #r12BankTitle { letter-spacing:.07em; font-size:12px; opacity:.78; }
      #r12BankTarget { margin-top:3px; font-size:25px; line-height:1.1; }
      #r12BankCount { margin-top:5px; font-size:13px; opacity:.82; }
      #r12BankStatus { margin-top:5px; padding-top:6px; border-top:1px solid rgba(255,255,255,.18); white-space:pre-line; }
      #r12BankCountdown {
        position:absolute; left:50%; top:30%; transform:translate(-50%,-50%);
        z-index:100090; color:#fff; text-align:center;
        font:900 clamp(88px,28vw,150px)/1 Arial,sans-serif;
        text-shadow:0 4px 28px rgba(0,0,0,.72); pointer-events:none;
      }
      #r12BankCountdown[hidden] { display:none !important; }
      #r12BankCaptureButton {
        left:50%; bottom:calc(env(safe-area-inset-bottom,0px) + 18px); transform:translateX(-50%);
        min-width:210px; background:rgba(126,74,220,.94);
      }
      #r12BankExportButton {
        left:50%; bottom:calc(env(safe-area-inset-bottom,0px) + 18px); transform:translateX(-50%);
        min-width:240px; background:rgba(0,133,164,.94);
      }
      #maskResetButton {
        left:12px !important; right:auto !important;
        bottom:calc(env(safe-area-inset-bottom,0px) + 78px) !important;
        min-width:0 !important; padding:0 12px !important; font-size:10px !important;
      }
      body[data-status="idle"] #r12BankHud, body[data-status="requesting"] #r12BankHud,
      body[data-status="idle"] #r12BankCaptureButton, body[data-status="requesting"] #r12BankCaptureButton,
      body[data-status="idle"] #r12BankExportButton, body[data-status="requesting"] #r12BankExportButton,
      body[data-status="idle"] #r12BankCountdown, body[data-status="requesting"] #r12BankCountdown { display:none !important; }
    `;
    document.head.appendChild(style);
  }

  const lab = document.querySelector(".camera-lab") || document.body;
  if (!document.getElementById("r12BankHud")) {
    const hud = document.createElement("aside");
    hud.id = "r12BankHud";
    hud.innerHTML = '<div id="r12BankTitle">R12 · BANCO DE PRUEBAS</div><div id="r12BankTarget">PRIMERO LISTO</div><div id="r12BankCount">0 / 8 FOTOS</div><div id="r12BankStatus">Aprende el brazo una vez y después te guío.</div>';
    lab.appendChild(hud);
  }

  if (!document.getElementById("r12BankCountdown")) {
    const countdown = document.createElement("div");
    countdown.id = "r12BankCountdown";
    countdown.hidden = true;
    countdown.setAttribute("aria-live", "polite");
    lab.appendChild(countdown);
  }

  if (!document.getElementById("r12BankCaptureButton")) {
    const button = document.createElement("button");
    button.id = "r12BankCaptureButton";
    button.className = "mask-action";
    button.type = "button";
    button.hidden = true;
    button.textContent = "CAPTURAR 0°";
    lab.appendChild(button);
  }

  if (!document.getElementById("r12BankExportButton")) {
    const button = document.createElement("button");
    button.id = "r12BankExportButton";
    button.className = "mask-action";
    button.type = "button";
    button.hidden = true;
    button.textContent = "GUARDAR BANCO";
    lab.appendChild(button);
  }

  if (resetButton) resetButton.textContent = "REINICIAR";
  document.title = "AMURA · BANCO DE PRUEBAS · R12";
}

function setCountdown(value) {
  const el = document.getElementById("r12BankCountdown");
  if (!el) return;
  if (value === null) {
    el.hidden = true;
    el.textContent = "";
  } else {
    el.hidden = false;
    el.textContent = String(value);
  }
}

function syncUi() {
  ensureUi();
  const capture = document.getElementById("r12BankCaptureButton");
  const exportButton = document.getElementById("r12BankExportButton");
  const target = document.getElementById("r12BankTarget");
  const count = document.getElementById("r12BankCount");
  const status = document.getElementById("r12BankStatus");
  if (!capture || !exportButton || !target || !count || !status || !readyButton || !resetButton) return;

  const calibrated = readyButton.hidden && !resetButton.hidden;
  count.textContent = `${captures.length} / ${TARGETS.length} FOTOS`;
  capture.hidden = !calibrated || finished;
  exportButton.hidden = !calibrated || !finished;
  capture.disabled = busy;
  exportButton.disabled = busy;

  if (!calibrated) {
    target.textContent = "PRIMERO LISTO";
    status.textContent = "Pulsa LISTO · APRENDER BRAZO. Después empiezan las 8 fotos.";
    return;
  }

  if (busy) return;

  if (finished) {
    target.textContent = "BANCO COMPLETO";
    status.textContent = "8/8 guardadas · pulsa GUARDAR BANCO para compartir las 8 fotos limpias + CSV + JSON.";
    return;
  }

  const targetDeg = TARGETS[targetIndex];
  target.textContent = `OBJETIVO ≈ ${targetDeg}°`;
  capture.textContent = `CAPTURAR ${targetDeg}°`;

  if (Date.now() < noticeUntil && noticeText) {
    status.textContent = noticeText;
  } else {
    status.textContent = "Coloca aproximadamente esa postura. Cuando estés listo, pulsa CAPTURAR; la foto se hace sola tras 3…2…1.";
  }
}

async function capturePosture() {
  if (busy || finished || targetIndex >= TARGETS.length) return;
  const calibrated = readyButton && resetButton && readyButton.hidden && !resetButton.hidden;
  if (!calibrated) return;

  const token = ++runToken;
  busy = true;
  syncUi();

  const index = targetIndex;
  const targetDeg = TARGETS[index];
  const imageFile = imageFileName(index, targetDeg);
  const targetEl = document.getElementById("r12BankTarget");
  const statusEl = document.getElementById("r12BankStatus");
  if (targetEl) targetEl.textContent = `≈ ${targetDeg}° · QUIETO`;

  for (let value = 3; value >= 1; value -= 1) {
    setCountdown(value);
    if (statusEl) statusEl.textContent = "NO MUEVAS LA MUÑECA";
    await sleep(COUNTDOWN_MS);
    if (token !== runToken) return;
  }

  setCountdown("FOTO");
  const samples = [];
  let cleanCanvas = null;

  for (let i = 0; i < BURST_COUNT; i += 1) {
    const sample = measureSample(index, targetDeg, i + 1, imageFile);
    samples.push(sample);
    if (i === 1) cleanCanvas = captureCleanCanvas();
    if (statusEl) statusEl.textContent = `CAPTURANDO ${i + 1}/3`;
    if (i < BURST_COUNT - 1) {
      await sleep(BURST_GAP_MS);
      if (token !== runToken) return;
    }
  }

  if (!cleanCanvas) {
    setCountdown(null);
    busy = false;
    noticeText = "NO SE PUDO GUARDAR LA FOTO · REPITE ESTA POSTURA";
    noticeUntil = Date.now() + 2500;
    syncUi();
    return;
  }

  // La imagen ya quedó congelada en cleanCanvas; desde aquí el usuario puede moverse sin alterar la foto.
  const imageBlob = await canvasToBlob(cleanCanvas, "image/jpeg", JPEG_QUALITY);
  if (token !== runToken) return;
  setCountdown(null);

  if (!imageBlob) {
    busy = false;
    noticeText = "ERROR AL CREAR EL JPG · REPITE ESTA POSTURA";
    noticeUntil = Date.now() + 2500;
    syncUi();
    return;
  }

  captures.push({
    postureIndex: index + 1,
    targetDeg,
    imageFile,
    capturedAt: samples[1] ? samples[1].capturedAt : new Date().toISOString(),
    imageWidth: cleanCanvas.width,
    imageHeight: cleanCanvas.height,
    samples,
    imageBlob
  });

  targetIndex += 1;
  finished = targetIndex >= TARGETS.length;
  window.AmuraR12Bank = captures;
  busy = false;

  if (finished) {
    noticeText = `FOTO ${captures.length}/8 GUARDADA · BANCO COMPLETO`;
    noticeUntil = Date.now() + 3000;
  } else {
    noticeText = `FOTO ${captures.length}/8 GUARDADA · YA PUEDES MOVER LA MUÑECA · SIGUIENTE ≈ ${TARGETS[targetIndex]}°`;
    noticeUntil = Date.now() + 2600;
  }
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
    "image_file", "posture_index", "target_deg", "burst_sample", "captured_at", "elapsed_ms",
    "mp_angle_deg", "p0_state", "roi_state", "roi_angle_deg", "pca_state", "pca_angle_deg",
    "pca_pixel_count", "pca_span_px", "final_state", "final_angle_deg", "p0_x_px", "p0_y_px",
    "final_start_x_px", "final_start_y_px", "final_end_x_px", "final_end_y_px",
    "final_mid_x_px", "final_mid_y_px", "perpendicular_px_signed", "longitudinal_px",
    "mask_width", "mask_height"
  ];
  const rows = [headers.join(",")];

  captures.forEach((capture) => {
    capture.samples.forEach((sample) => {
      const values = [
        capture.imageFile, capture.postureIndex, capture.targetDeg, sample.burstIndex, sample.capturedAt, sample.elapsedMs,
        sample.mpAngleDeg, sample.p0State, sample.roiState, sample.roiAngleDeg, sample.pcaState, sample.pcaAngleDeg,
        sample.pcaPixelCount, sample.pcaSpanPx, sample.finalState, sample.finalAngleDeg, sample.p0Xpx, sample.p0Ypx,
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
    revision: "R12-BANCO-FOTOS",
    base: "R10 unchanged",
    mode: "guided static reference bank",
    purpose: "same clean camera images reused later for spatial/geometric regression tests",
    targets: TARGETS,
    burstCount: BURST_COUNT,
    sessionStartedAt: new Date(sessionStartedAt).toISOString(),
    exportedAt: new Date().toISOString(),
    postureCount: captures.length,
    postures: captures.map(({ imageBlob, ...capture }) => capture)
  }, null, 2);
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

async function exportBank() {
  if (busy || !finished || captures.length !== TARGETS.length) return;
  busy = true;
  syncUi();
  const statusEl = document.getElementById("r12BankStatus");
  if (statusEl) statusEl.textContent = "PREPARANDO 8 JPG + CSV + JSON…";

  try {
    const stamp = fileStamp();
    const csvBlob = new Blob([buildCsv()], { type: "text/csv;charset=utf-8" });
    const jsonBlob = new Blob([buildJson()], { type: "application/json;charset=utf-8" });

    const files = captures.map((capture) =>
      new File([capture.imageBlob], capture.imageFile, { type: "image/jpeg" })
    );
    files.push(new File([csvBlob], `AMURA_BANCO_R12_${stamp}.csv`, { type: csvBlob.type }));
    files.push(new File([jsonBlob], `AMURA_BANCO_R12_${stamp}.json`, { type: jsonBlob.type }));

    const shareData = { files };
    if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
      try {
        await navigator.share(shareData);
        if (statusEl) statusEl.textContent = "BANCO COMPARTIDO · 8 FOTOS LIMPIAS + CSV + JSON";
        return;
      } catch (error) {
        if (error && error.name === "AbortError") return;
        console.warn("Compartir múltiples archivos no disponible; se usa descarga.", error);
      }
    }

    for (const capture of captures) {
      downloadBlob(capture.imageBlob, capture.imageFile);
      await sleep(180);
    }
    downloadBlob(csvBlob, `AMURA_BANCO_R12_${stamp}.csv`);
    await sleep(180);
    downloadBlob(jsonBlob, `AMURA_BANCO_R12_${stamp}.json`);
    if (statusEl) statusEl.textContent = "BANCO GENERADO · 8 JPG INDIVIDUALES + CSV + JSON";
  } catch (error) {
    console.error(error);
    if (statusEl) statusEl.textContent = "ERROR AL GUARDAR · INTÉNTALO DE NUEVO";
  } finally {
    busy = false;
    syncUi();
  }
}

function resetBank() {
  runToken += 1;
  captures = [];
  targetIndex = 0;
  busy = false;
  finished = false;
  sessionStartedAt = Date.now();
  noticeText = "";
  noticeUntil = 0;
  window.AmuraR12Bank = captures;
  setCountdown(null);
  setTimeout(syncUi, 0);
}

async function startBank() {
  ensureUi();
  await installRawSnapshotTapBeforeR10();
  await import("./axis-r10-lab.js?v=r10.1");

  setTimeout(() => {
    ensureUi();
    document.title = "AMURA · BANCO DE PRUEBAS · R12";
    syncUi();
  }, 180);

  const captureButton = document.getElementById("r12BankCaptureButton");
  const exportButton = document.getElementById("r12BankExportButton");
  if (captureButton) captureButton.addEventListener("click", capturePosture);
  if (exportButton) exportButton.addEventListener("click", exportBank);
  if (resetButton) resetButton.addEventListener("click", () => setTimeout(resetBank, 0));
  if (readyButton) readyButton.addEventListener("click", () => setTimeout(syncUi, 120));
  if (photoButton) photoButton.hidden = true;

  window.addEventListener("amura-camera-state", (event) => {
    if (!event.detail || event.detail.status !== "live") resetBank();
  });

  setInterval(syncUi, 250);
  window.AmuraR12Mode = {
    revision: "R12-BANCO-FOTOS",
    base: "R10",
    workflow: "guided-static-photo-bank",
    targets: TARGETS.slice(),
    burstCount: BURST_COUNT,
    cleanImages: true
  };
}

startBank();
