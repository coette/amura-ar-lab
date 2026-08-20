// AMURA AR · captura rápida de la vista de diagnóstico.
// No puede invocar la captura de pantalla nativa de iOS; compone la vista de la app
// (vídeo + canvases + HUD) y descarga un PNG con un solo toque.

const root = document.querySelector('.camera-lab') || document.body;
const video = document.getElementById('cameraVideo');

const button = document.createElement('button');
button.id = 'quickCaptureButton';
button.type = 'button';
button.setAttribute('aria-label', 'Capturar pantalla');
button.innerHTML = '<span style="font-size:27px;line-height:1">📷</span><span id="quickCaptureCount" style="font:800 10px/1 Arial;margin-top:2px">0</span>';
Object.assign(button.style, {
  position: 'fixed',
  left: '12px',
  bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
  width: '62px',
  height: '62px',
  borderRadius: '50%',
  border: '2px solid rgba(255,255,255,.92)',
  background: 'rgba(0,0,0,.72)',
  color: '#fff',
  zIndex: '100500',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0',
  boxShadow: '0 3px 14px rgba(0,0,0,.5)',
  WebkitTapHighlightColor: 'transparent',
  touchAction: 'manipulation'
});
root.appendChild(button);

let captureCount = 0;

function visible(element) {
  if (!element) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 0 && rect.height > 0;
}

function roundedRect(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawVideoCover(ctx, outWidth, outHeight, dpr) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
  const cssW = outWidth / dpr;
  const cssH = outHeight / dpr;
  const scale = Math.max(cssW / video.videoWidth, cssH / video.videoHeight);
  const sourceW = cssW / scale;
  const sourceH = cssH / scale;
  const sx = Math.max(0, (video.videoWidth - sourceW) * 0.5);
  const sy = Math.max(0, (video.videoHeight - sourceH) * 0.5);

  ctx.save();
  if (document.body && document.body.dataset.facing === 'user') {
    ctx.translate(outWidth, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, sx, sy, sourceW, sourceH, 0, 0, outWidth, outHeight);
  ctx.restore();
}

function drawCanvasLayer(ctx, canvas, dpr) {
  if (!canvas || !visible(canvas) || canvas.id === 'quickCaptureComposite') return;
  const rect = canvas.getBoundingClientRect();
  try {
    ctx.drawImage(
      canvas,
      Math.round(rect.left * dpr),
      Math.round(rect.top * dpr),
      Math.round(rect.width * dpr),
      Math.round(rect.height * dpr)
    );
  } catch (_) {
    // Un canvas no dibujable no debe impedir la captura del resto.
  }
}

function drawTextBox(ctx, element, dpr) {
  if (!element || !visible(element)) return;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const x = rect.left * dpr;
  const y = rect.top * dpr;
  const w = rect.width * dpr;
  const h = rect.height * dpr;
  const radius = (parseFloat(style.borderRadius) || 8) * dpr;

  ctx.save();
  roundedRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)'
    ? style.backgroundColor
    : 'rgba(0,0,0,.82)';
  ctx.fill();

  const borderWidth = parseFloat(style.borderTopWidth) || 0;
  if (borderWidth > 0) {
    ctx.lineWidth = borderWidth * dpr;
    ctx.strokeStyle = style.borderTopColor || 'rgba(255,255,255,.5)';
    ctx.stroke();
  }

  const paddingLeft = (parseFloat(style.paddingLeft) || 10) * dpr;
  const paddingTop = (parseFloat(style.paddingTop) || 8) * dpr;
  const fontSize = (parseFloat(style.fontSize) || 12) * dpr;
  const lineHeight = (parseFloat(style.lineHeight) || fontSize / dpr * 1.35) * dpr;
  const family = style.fontFamily || 'monospace';
  const weight = style.fontWeight || '700';
  ctx.font = `${weight} ${fontSize}px ${family}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = style.color || '#fff';

  const text = (element.innerText || element.textContent || '').trim();
  const lines = text.split(/\n/);
  lines.forEach((line, index) => {
    ctx.fillText(line, x + paddingLeft, y + paddingTop + index * lineHeight);
  });
  ctx.restore();
}

function filename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `AMURA_AR_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.png`;
}

function capture() {
  if (!video || video.readyState < 2) return;

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssWidth = Math.max(1, window.innerWidth);
  const cssHeight = Math.max(1, window.innerHeight);
  const canvas = document.createElement('canvas');
  canvas.id = 'quickCaptureComposite';
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext('2d');

  drawVideoCover(ctx, canvas.width, canvas.height, dpr);

  // Reproduce las capas gráficas reales de la prueba, en su orden aproximado.
  document.querySelectorAll('canvas').forEach((layer) => {
    if (layer === canvas || layer.id === 'trackingCanvas') return;
    drawCanvasLayer(ctx, layer, dpr);
  });

  // HUD/etiquetas HTML importantes para interpretar la captura.
  drawTextBox(ctx, document.getElementById('ar04Marker'), dpr);
  drawTextBox(ctx, document.getElementById('p0AxisTestHud'), dpr);
  drawTextBox(ctx, document.getElementById('trackingHud'), dpr);

  const url = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = url;
  link.download = filename();
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();

  captureCount += 1;
  const count = document.getElementById('quickCaptureCount');
  if (count) count.textContent = String(captureCount);

  button.animate(
    [
      { transform: 'scale(1)', background: 'rgba(0,0,0,.72)' },
      { transform: 'scale(.88)', background: 'rgba(0,229,255,.95)' },
      { transform: 'scale(1)', background: 'rgba(0,0,0,.72)' }
    ],
    { duration: 220, easing: 'ease-out' }
  );
}

button.addEventListener('click', capture);
