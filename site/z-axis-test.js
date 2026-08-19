import { tuning } from "./tuner.js?v=11.2";

// AR-04 · PRUEBA Z
// Diagnóstico temporal: no modifica la geometría del reloj ni AR-03.
// Fuerza visualización limpia P0 + Z y desactiva el suavizado para observar
// el marco crudo que entrega wrist-frame.js.

const video = document.getElementById("cameraVideo");
const root = document.querySelector(".camera-lab") || document.body;

const canvas = document.createElement("canvas");
canvas.id = "zTestCanvas";
canvas.setAttribute("aria-hidden", "true");
Object.assign(canvas.style, {
  position: "absolute",
  inset: "0",
  width: "100%",
  height: "100%",
  pointerEvents: "none",
  zIndex: "99990"
});
root.appendChild(canvas);
const ctx = canvas.getContext("2d");

const hud = document.createElement("div");
hud.id = "zTestHud";
Object.assign(hud.style, {
  position: "absolute",
  top: "calc(env(safe-area-inset-top, 0px) + 48px)",
  left: "10px",
  zIndex: "99999",
  minWidth: "205px",
  padding: "9px 11px",
  borderRadius: "10px",
  border: "1px solid rgba(90,169,255,.75)",
  background: "rgba(0,0,0,.82)",
  color: "#fff",
  font: "700 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
  whiteSpace: "pre",
  pointerEvents: "none"
});
hud.textContent = "P0 + Z · esperando mano";
root.appendChild(hud);

let lastZ = null;
let lastLoggedAt = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseVector(value) {
  const numbers = String(value || "")
    .split(",")
    .map((part) => Number(part.trim()));
  if (numbers.length !== 3 || numbers.some((number) => !Number.isFinite(number))) return null;
  const length = Math.hypot(numbers[0], numbers[1], numbers[2]);
  if (length < 1e-7) return null;
  return { x: numbers[0] / length, y: numbers[1] / length, z: numbers[2] / length };
}

function parseOrigin(value) {
  const numbers = String(value || "")
    .split(",")
    .map((part) => Number(part.trim()));
  if (numbers.length < 2 || !Number.isFinite(numbers[0]) || !Number.isFinite(numbers[1])) return null;
  return { x: numbers[0], y: numbers[1] };
}

function parseDegrees(value) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function angleBetween(a, b) {
  if (!a || !b) return null;
  const dot = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  return Math.acos(dot) * 180 / Math.PI;
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

function videoPointToScreen(origin) {
  if (!video || !video.videoWidth || !video.videoHeight) return null;
  const rect = video.getBoundingClientRect();
  const scale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const renderedWidth = video.videoWidth * scale;
  const renderedHeight = video.videoHeight * scale;
  const offsetX = rect.left + (rect.width - renderedWidth) * 0.5;
  const offsetY = rect.top + (rect.height - renderedHeight) * 0.5;
  let x = offsetX + origin.x * renderedWidth;
  const y = offsetY + origin.y * renderedHeight;
  if (document.body && document.body.dataset.facing === "user") {
    x = rect.left + rect.width - (x - rect.left);
  }
  return { x, y };
}

function drawArrow(origin, z) {
  const projection = Math.hypot(z.x, z.y);
  const length = 155;
  let dx = z.x;
  let dy = z.y;
  if (document.body && document.body.dataset.facing === "user") dx = -dx;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,.75)";
  ctx.shadowBlur = 6;

  // P0 dorado.
  ctx.fillStyle = "#d4b76a";
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (projection >= 0.055) {
    const end = {
      x: origin.x + dx * length,
      y: origin.y + dy * length
    };
    const angle = Math.atan2(end.y - origin.y, end.x - origin.x);
    const head = 15;

    ctx.strokeStyle = "#5aa9ff";
    ctx.fillStyle = "#5aa9ff";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(origin.x, origin.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();

    ctx.font = "800 20px Arial";
    ctx.fillText("Z", end.x + 10, end.y - 10);
  }

  // Cuando Z apunta casi hacia/desde cámara, la flecha 2D se acorta por física.
  // El círculo muestra el signo de Z para que no parezca que el vector desaparece.
  const cameraColor = z.z < 0 ? "#00e5ff" : "#ff9f43";
  ctx.strokeStyle = cameraColor;
  ctx.fillStyle = cameraColor;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, 25, 0, Math.PI * 2);
  ctx.stroke();
  if (Math.abs(z.z) > 0.35) {
    if (z.z < 0) {
      ctx.beginPath();
      ctx.arc(origin.x, origin.y, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(origin.x - 7, origin.y - 7);
      ctx.lineTo(origin.x + 7, origin.y + 7);
      ctx.moveTo(origin.x + 7, origin.y - 7);
      ctx.lineTo(origin.x - 7, origin.y + 7);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function logSample(now, origin, z, roll, pointCount, handConfidence, jump) {
  const denseZone = Number.isFinite(roll) && Math.abs(roll) >= 60 && Math.abs(roll) <= 120;
  const interval = denseZone ? 90 : 240;
  if (now - lastLoggedAt < interval) return;
  lastLoggedAt = now;

  if (!Array.isArray(window.AmuraZTestLog)) window.AmuraZTestLog = [];
  window.AmuraZTestLog.push({
    t: Math.round(now),
    roll: Number.isFinite(roll) ? Math.round(roll * 10) / 10 : null,
    p0: { x: origin.x, y: origin.y },
    z: { x: z.x, y: z.y, z: z.z },
    jumpDeg: Number.isFinite(jump) ? Math.round(jump * 10) / 10 : null,
    landmarks: pointCount,
    handednessConfidence: handConfidence
  });
  if (window.AmuraZTestLog.length > 500) {
    window.AmuraZTestLog.splice(0, window.AmuraZTestLog.length - 500);
  }
}

function forceCleanTestMode() {
  // Observamos el marco crudo, no el resultado filtrado.
  tuning.smoothing = 0;
  tuning.watchVisible = 0;
  tuning.occluderMode = 0;
  tuning.triadMode = 0;
}

function render(now) {
  forceCleanTestMode();
  const size = resize();
  ctx.clearRect(0, 0, size.width, size.height);

  const diagnostics = window.AmuraTrackingDiagnostics || {};
  const originNormalized = parseOrigin(diagnostics["Origen muñeca"]);
  const z = parseVector(diagnostics["Z normal"]);
  const roll = parseDegrees(diagnostics["Giro Y muñeca"]);
  const pointCount = Number(diagnostics["Landmarks"]) || 0;
  const handConfidence = parseDegrees(diagnostics["Confianza lateralidad"]);

  if (originNormalized && z && pointCount) {
    const origin = videoPointToScreen(originNormalized);
    const jump = angleBetween(lastZ, z);
    if (origin) drawArrow(origin, z);

    const zone = Number.isFinite(roll) && Math.abs(roll) >= 60 && Math.abs(roll) <= 120
      ? "ZONA 60–120 · MUESTREO DENSO"
      : "FUERA ZONA CRÍTICA";
    hud.textContent = [
      "P0 + Z · CRUDO",
      `GIRO ${Number.isFinite(roll) ? roll.toFixed(1) + "°" : "—"}`,
      `Z  ${z.x.toFixed(3)}  ${z.y.toFixed(3)}  ${z.z.toFixed(3)}`,
      `SALTO Z ${Number.isFinite(jump) ? jump.toFixed(1) + "°" : "—"}`,
      `PUNTOS ${pointCount} · MANO ${Number.isFinite(handConfidence) ? Math.round(handConfidence) + "%" : "—"}`,
      zone
    ].join("\n");

    logSample(now, originNormalized, z, roll, pointCount, handConfidence, jump);
    lastZ = z;
  } else {
    hud.textContent = "P0 + Z · buscando mano";
    lastZ = null;
  }

  requestAnimationFrame(render);
}

window.AmuraZTestLog = [];
requestAnimationFrame(render);
