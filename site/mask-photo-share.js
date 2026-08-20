// AMURA AR · salida nativa de la foto del laboratorio de máscara en iPhone/iPad.
// Recupera el flujo validado anteriormente: PNG -> hoja nativa Compartir -> Guardar imagen.

const video = document.getElementById("cameraVideo");
const maskCanvas = document.getElementById("maskCanvas");
const trackingCanvas = document.getElementById("trackingCanvas");
const photoButton = document.getElementById("maskPhotoButton");
const stateValue = document.getElementById("maskStateValue");
const centerValue = document.getElementById("maskCenterValue");
const widthValue = document.getElementById("maskWidthValue");
const deltaValue = document.getElementById("maskDeltaValue");
const rollValue = document.getElementById("maskRollValue");
const coverageValue = document.getElementById("maskCoverageValue");
const hint = document.getElementById("maskHint");

if (photoButton) photoButton.textContent = "GUARDAR FOTO";

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function filename() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `AMURA_MASK_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.png`;
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
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function currentTextLines() {
  const lines = [
    "AMURA · LAB MÁSCARA ANTEBRAZO",
    "ESTADO: " + (stateValue?.textContent || "—"),
    "CENTRO X/Y: " + (centerValue?.textContent || "—"),
    "ANCHO: " + (widthValue?.textContent || "—"),
    "Δ FRAME: " + (deltaValue?.textContent || "—"),
    "GIRO MEDIAPIPE: " + (rollValue?.textContent || "—"),
    "COBERTURA: " + (coverageValue?.textContent || "—"),
    "MÁSCARA: CRUDA / SIN FILTRO"
  ];

  const measureValue = document.getElementById("maskMeasureValue");
  const measurement = String(measureValue?.textContent || "").trim();
  if (measurement) lines.push(...measurement.split(/\n+/));
  return lines;
}

function drawComposite() {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;

  const output = document.createElement("canvas");
  output.width = video.videoWidth;
  output.height = video.videoHeight;
  const context = output.getContext("2d");
  context.drawImage(video, 0, 0, output.width, output.height);

  if (maskCanvas?.width && maskCanvas?.height) {
    context.drawImage(maskCanvas, 0, 0, output.width, output.height);
  }
  if (trackingCanvas?.width && trackingCanvas?.height) {
    context.drawImage(trackingCanvas, 0, 0, output.width, output.height);
  }

  const lines = currentTextLines();
  const fontSize = Math.max(18, Math.round(output.width * 0.016));
  const lineHeight = Math.round(fontSize * 1.32);
  const padding = Math.round(fontSize * 0.65);
  const panelWidth = Math.min(output.width - padding * 2, Math.round(output.width * 0.84));
  const panelHeight = padding * 2 + lineHeight * lines.length;

  context.fillStyle = "rgba(0,0,0,.76)";
  context.fillRect(padding, padding, panelWidth, panelHeight);
  context.fillStyle = "#ffffff";
  context.font = "600 " + fontSize + "px Arial, sans-serif";
  context.textBaseline = "top";
  lines.forEach((line, index) => {
    context.fillText(line, padding * 2, padding * 2 + index * lineHeight, panelWidth - padding * 2);
  });

  return output;
}

async function sharePhoto() {
  if (!photoButton || photoButton.disabled) return;
  const canvas = drawComposite();
  if (!canvas) return;

  photoButton.disabled = true;
  const originalText = photoButton.textContent;
  photoButton.textContent = "PREPARANDO…";

  try {
    const blob = await canvasToBlob(canvas);
    if (!blob) return;

    const name = filename();
    const file = new File([blob], name, { type: "image/png" });
    const shareData = { files: [file] };

    if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
      if (hint) hint.textContent = "En el menú del iPhone pulsa Guardar imagen.";
      try {
        await navigator.share(shareData);
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
        console.warn("No se pudo abrir Compartir; se usa descarga.", error);
      }
    }

    fallbackDownload(blob, name);
    if (hint) hint.textContent = "El navegador no abrió Compartir; la imagen se ha enviado a Descargas.";
  } finally {
    photoButton.disabled = false;
    photoButton.textContent = originalText || "GUARDAR FOTO";
  }
}

// Interceptamos antes del listener antiguo, que descargaba el JPG directamente.
document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("#maskPhotoButton") : null;
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  void sharePhoto();
}, true);

window.setInterval(() => {
  if (!photoButton) return;
  photoButton.textContent = "GUARDAR FOTO";
  if (window.AmuraMaskMeasureResult && hint?.textContent.includes("Pulsa FOTO")) {
    hint.textContent = "Medición terminada. Pulsa GUARDAR FOTO y después Guardar imagen en el iPhone.";
  }
}, 250);
