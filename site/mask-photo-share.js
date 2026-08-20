// AMURA AR · R07 · salida nativa de foto en iPhone/iPad.
// La foto guardada refleja exactamente este experimento: nube + eje R07 + resultados R07.

const video = document.getElementById("cameraVideo");
const maskCanvas = document.getElementById("maskCanvas");
const photoButton = document.getElementById("maskPhotoButton");
const hint = document.getElementById("maskHint");

if (photoButton) photoButton.textContent = "GUARDAR FOTO";

function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

function filename() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `AMURA_R07_EJE_NUBE_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.png`;
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
  const lines = ["LAB · EJE NUBE · R07"];
  const result = window.AmuraR07MeasureResult;
  if (result) {
    lines.push(
      `PUNTO EJE · rango ${result.total.pointRange.toFixed(1)} px`,
      `ÁNGULO EJE · rango ${result.total.angleRange.toFixed(2)}°`,
      `0–5 s · punto ${result.first.pointRange.toFixed(1)} px · ángulo ${result.first.angleRange.toFixed(2)}°`,
      `5–10 s · punto ${result.second.pointRange.toFixed(1)} px · ángulo ${result.second.angleRange.toFixed(2)}°`
    );
  } else {
    lines.push("SIN MEDICIÓN 10 s");
  }
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

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("#maskPhotoButton") : null;
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  void sharePhoto();
}, true);

window.setInterval(() => {
  if (photoButton) photoButton.textContent = "GUARDAR FOTO";
}, 250);
