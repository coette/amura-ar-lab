import { tuning } from "./tuner.js?v=11.2";

// AMURA · AR-04 · COMPROBACIÓN CORREDOR REAL AR-03
// No calcula un segundo corredor. Lee exclusivamente el estado que publica
// wrist-watch-ar03-corridor.js, es decir, la misma instancia que consume δ.

const video = document.getElementById("cameraVideo");
const root = document.querySelector(".camera-lab") || document.body;

const overlay = document.createElement("canvas");
overlay.id = "p0AxisTestCanvas";
overlay.setAttribute("aria-hidden", "true");
Object.assign(overlay.style, {
  position: "absolute",
  inset: "0",
  width: "100%",
  height: "100%",
  pointerEvents: "none",
  zIndex: "99990"
});
root.appendChild(overlay);
const ctx = overlay.getContext("2d");

const hud = document.createElement("div");
hud.id = "p0AxisTestHud";
Object.assign(hud.style, {
  position: "absolute",
  top: "calc(env(safe-area-inset-top, 0px) + 48px)",
  left: "10px",
  zIndex: "99999",
  minWidth: "245px",
  maxWidth: "330px",
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid rgba(0,229,255,.78)",
  background: "rgba(0,0,0,.84)",
  color: "#fff",
  font: "700 12px/1.42 ui-monospace, SFMono-Regular, Menlo, monospace",
  whiteSpace: "pre-wrap",
  pointerEvents: "none"
});
hud.textContent = "CORREDOR REAL AR-03 · esperando datos";
root.appendChild(hud);

function parseOrigin(value) {
  const numbers = String(value || "")
    .split(",")
    .map((part) => Number(part.trim()));
  if (numbers.length < 2 || !Number.isFinite(numbers[0]) || !Number.isFinite(numbers[1])) return null;
  return { x: numbers[0], y: numbers[1] };
}

function parseNumber(value) {
  const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function resizeOverlay() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (overlay.width !== pixelWidth || overlay.height !== pixelHeight) {
    overlay.width = pixelWidth;
    overlay.height = pixelHeight;
    overlay.style.width = width + "px";
    overlay.style.height = height + "px";
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

function normalizedPointToScreen(origin) {
  if (!video || !video.videoWidth || !video.videoHeight || !origin) return null;
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

function drawP0(origin) {
  const point = normalizedPointToScreen(origin);
  if (!point) return;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.75)";
  ctx.shadowBlur = 5;
  ctx.fillStyle = "#d4b76a";
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.font = "800 16px Arial";
  ctx.fillStyle = "#d4b76a";
  ctx.fillText("P0", point.x + 14, point.y - 12);
  ctx.restore();
}

function cleanTestMode() {
  tuning.watchVisible = 0;
  tuning.occluderMode = 0;
  tuning.triadMode = 0;
}

function render() {
  cleanTestMode();
  const size = resizeOverlay();
  ctx.clearRect(0, 0, size.width, size.height);

  const diagnostics = window.AmuraTrackingDiagnostics || {};
  const origin = parseOrigin(diagnostics["Origen muñeca"]);
  const roll = parseNumber(diagnostics["Giro Y muñeca"]);
  const depth = parseNumber(
    diagnostics["AR-04B profundidad"] || diagnostics["Distancia a la muñeca"]
  );
  const tube = diagnostics["Tubo"] || "—";
  const sections = diagnostics["Secciones válidas"] || "—";
  const reason = diagnostics["Validación tubo"] || "—";
  const delta = diagnostics["δ antebrazo"] || "—";
  const calibration = diagnostics["Última calibración"] || "—";
  const points = diagnostics["Landmarks"] || "0";

  if (origin) drawP0(origin);

  const rollText = Number.isFinite(roll) ? roll.toFixed(1) + "°" : "—";
  const depthText = Number.isFinite(depth) ? Math.round(depth) + " mm" : "—";

  hud.textContent = [
    "CORREDOR REAL AR-03",
    `GIRO ${rollText} · PROF ${depthText}`,
    `TUBO ${tube}`,
    `SECCIONES ${sections} · PUNTOS ${points}`,
    `MOTIVO ${reason}`,
    `δ ${delta}`,
    `ÚLTIMA CAL ${calibration}`,
    "MISMA INSTANCIA QUE USA δ"
  ].join("\n");

  if (tube === "TUBO VÁLIDO") {
    hud.style.borderColor = "rgba(0,229,255,.95)";
  } else if (tube === "TUBO RECHAZADO") {
    hud.style.borderColor = "rgba(255,138,101,.95)";
  } else {
    hud.style.borderColor = "rgba(255,255,255,.38)";
  }

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
