import {
  hideWristWatch as hideBaseWristWatch,
  holdWristWatch as holdBaseWristWatch,
  updateWristWatch as updateBaseWristWatch
} from "./wrist-watch.js?v=ar02.2";
import {
  hideWristWatch as hideCorridorWristWatch,
  holdWristWatch as holdCorridorWristWatch,
  updateWristWatch as updateCorridorWristWatch
} from "./wrist-watch-ar03-corridor.js?v=ar03.8";
import { tuning } from "./tuner.js?v=11.2";

// AR-04 · CALIBRACIÓN GUIADA
// - AR-03/corredor existe SOLO mientras el usuario calibra.
// - Al pulsar LISTO se guarda únicamente la dirección visual del antebrazo.
// - A partir de ahí el corredor deja de ejecutarse por completo.
// - El reloj vuelve a estar gobernado exclusivamente por MediaPipe Hands.
// +X = codo→mano · +Y = 6→12 · +Z = fondo→cristal.

const root = document.querySelector(".camera-lab") || document.body;
const marker = document.getElementById("ar04Marker");
const WATCH_X_MM = -24;
const GUIDE_OFFSET_PX = 66;
const GUIDE_HALF_LENGTH_PX = 190;
const DEG_TO_RAD = Math.PI / 180;

const savedOccluderMode = Number.isFinite(Number(tuning.occluderMode))
  ? Number(tuning.occluderMode)
  : 1;
const savedTriadMode = Number.isFinite(Number(tuning.triadMode))
  ? Number(tuning.triadMode)
  : 0;

let calibrating = true;
let guideDirection = null;
let latestPose = null;
let latestOptions = null;
let latestDeltaRad = null;
let readyToConfirm = false;

const guideCanvas = document.createElement("canvas");
guideCanvas.id = "forearmGuideCanvas";
guideCanvas.setAttribute("aria-hidden", "true");
Object.assign(guideCanvas.style, {
  position: "absolute",
  inset: "0",
  width: "100%",
  height: "100%",
  pointerEvents: "none",
  zIndex: "99979"
});
root.appendChild(guideCanvas);
const guideContext = guideCanvas.getContext("2d");

const calibrationHud = document.createElement("div");
calibrationHud.id = "forearmCalibrationHud";
Object.assign(calibrationHud.style, {
  position: "absolute",
  top: "calc(env(safe-area-inset-top, 0px) + 48px)",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: "100020",
  maxWidth: "min(88vw, 390px)",
  padding: "10px 14px",
  borderRadius: "12px",
  background: "rgba(0,0,0,.78)",
  border: "1px solid rgba(255,255,255,.22)",
  color: "#fff",
  font: "700 13px/1.35 Arial, sans-serif",
  textAlign: "center",
  boxShadow: "0 3px 14px rgba(0,0,0,.4)",
  pointerEvents: "none"
});
calibrationHud.textContent = "Ajusta el brazo hasta que las líneas azules se ciñan al antebrazo.";
root.appendChild(calibrationHud);

const doneButton = document.createElement("button");
doneButton.id = "forearmCalibrationDone";
doneButton.type = "button";
doneButton.textContent = "LISTO";
Object.assign(doneButton.style, {
  position: "fixed",
  left: "50%",
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
  transform: "translateX(-50%)",
  zIndex: "100030",
  minWidth: "132px",
  height: "52px",
  padding: "0 24px",
  borderRadius: "26px",
  border: "1px solid rgba(255,255,255,.88)",
  background: "rgba(0,0,0,.82)",
  color: "#fff",
  font: "800 15px/1 Arial, sans-serif",
  letterSpacing: ".06em",
  boxShadow: "0 4px 18px rgba(0,0,0,.45)",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation"
});
root.appendChild(doneButton);

const recalibrateButton = document.createElement("button");
recalibrateButton.id = "forearmRecalibrate";
recalibrateButton.type = "button";
recalibrateButton.textContent = "RECALIBRAR";
Object.assign(recalibrateButton.style, {
  position: "fixed",
  right: "12px",
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  zIndex: "100030",
  height: "38px",
  padding: "0 13px",
  borderRadius: "19px",
  border: "1px solid rgba(255,255,255,.46)",
  background: "rgba(0,0,0,.58)",
  color: "rgba(255,255,255,.88)",
  font: "800 10px/1 Arial, sans-serif",
  letterSpacing: ".045em",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
  display: "none"
});
root.appendChild(recalibrateButton);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross3 = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
});
const add3 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale3 = (v, s) => ({ x: v.x * s, y: v.y * s, z: v.z * s });

function normalize2(v) {
  if (!v) return null;
  const x = Number(v.x) || 0;
  const y = Number(v.y) || 0;
  const n = Math.hypot(x, y);
  return n < 1e-7 ? null : { x: x / n, y: y / n };
}

function normalize3(v) {
  if (!v) return null;
  const x = Number(v.x) || 0;
  const y = Number(v.y) || 0;
  const z = Number(v.z) || 0;
  const n = Math.hypot(x, y, z);
  return n < 1e-7 ? null : { x: x / n, y: y / n, z: z / n };
}

function rotateAroundAxis(vector, axis, angle) {
  const v = normalize3(vector);
  const k = normalize3(axis);
  if (!v || !k) return null;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return normalize3(add3(add3(
    scale3(v, c),
    scale3(cross3(k, v), s)
  ), scale3(k, dot3(k, v) * (1 - c))));
}

function projectAxisDifferential(pose, axis) {
  if (!pose || !pose.positionMm || !axis) return null;
  const p = pose.positionMm;
  const depth = -Number(p.z);
  if (!Number.isFinite(depth) || depth <= 1) return null;
  return normalize2({
    x: Number(axis.x) * depth + Number(p.x) * Number(axis.z),
    y: -(Number(axis.y) * depth + Number(p.y) * Number(axis.z))
  });
}

function correctedForearmDirection(pose, deltaRad) {
  if (!pose || !Number.isFinite(deltaRad) || !pose.xAxis || !pose.zAxis) return null;
  // AR-03 aplica R(Z, -δ). Replicamos SOLO ese instante para guardar la guía.
  const correctedX = rotateAroundAxis(pose.xAxis, pose.zAxis, -deltaRad);
  let direction = projectAxisDifferential(pose, correctedX);
  if (!direction) return null;
  if (document.body && document.body.dataset.facing === "user") {
    direction = { x: -direction.x, y: direction.y };
  }
  return normalize2(direction);
}

function displayProjection(options, pose) {
  const width = Number(options && options.viewportWidth) || window.innerWidth || 0;
  const height = Number(options && options.viewportHeight) || window.innerHeight || 0;
  const fovY = Number(options && options.fovYDegrees) || 50;
  if (!width || !height || !pose || !pose.positionMm) return null;
  const depth = -Number(pose.positionMm.z);
  if (!Number.isFinite(depth) || depth <= 1) return null;
  const focal = height / (2 * Math.tan((fovY * Math.PI / 180) / 2));
  let x = width * 0.5 + Number(pose.positionMm.x) * focal / depth;
  const y = height * 0.5 - Number(pose.positionMm.y) * focal / depth;
  if (document.body && document.body.dataset.facing === "user") x = width - x;
  return { x, y, width, height };
}

function resizeGuideCanvas(width, height) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (guideCanvas.width !== pw || guideCanvas.height !== ph) {
    guideCanvas.width = pw;
    guideCanvas.height = ph;
    guideCanvas.style.width = w + "px";
    guideCanvas.style.height = h + "px";
  }
  guideContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: w, height: h };
}

function clearGuide() {
  if (!guideContext) return;
  const width = window.innerWidth || 1;
  const height = window.innerHeight || 1;
  resizeGuideCanvas(width, height);
  guideContext.clearRect(0, 0, width, height);
}

function drawGuide(options, pose) {
  if (!guideDirection || !guideContext) {
    clearGuide();
    return;
  }

  const projection = displayProjection(options, pose);
  if (!projection) {
    clearGuide();
    return;
  }

  const size = resizeGuideCanvas(projection.width, projection.height);
  guideContext.clearRect(0, 0, size.width, size.height);

  const d = guideDirection;
  let normal = normalize2({ x: -d.y, y: d.x });
  if (!normal) return;
  // Elegimos siempre el lado visualmente más a la izquierda de la pantalla.
  if (normal.x > 0) normal = { x: -normal.x, y: -normal.y };

  const center = {
    x: projection.x + normal.x * GUIDE_OFFSET_PX,
    y: projection.y + normal.y * GUIDE_OFFSET_PX
  };

  guideContext.save();
  guideContext.strokeStyle = "rgba(255,255,255,.27)";
  guideContext.lineWidth = 2;
  guideContext.setLineDash([10, 10]);
  guideContext.lineCap = "round";
  guideContext.shadowColor = "rgba(0,0,0,.45)";
  guideContext.shadowBlur = 3;
  guideContext.beginPath();
  guideContext.moveTo(
    center.x - d.x * GUIDE_HALF_LENGTH_PX,
    center.y - d.y * GUIDE_HALF_LENGTH_PX
  );
  guideContext.lineTo(
    center.x + d.x * GUIDE_HALF_LENGTH_PX,
    center.y + d.y * GUIDE_HALF_LENGTH_PX
  );
  guideContext.stroke();
  guideContext.restore();
}

function parseDeltaFromDiagnostics() {
  const diagnostics = window.AmuraTrackingDiagnostics || {};
  const label = String(diagnostics["δ antebrazo"] || "");
  const match = label.match(/-?\d+(?:\.\d+)?/);
  if (!match || !label.includes("δ ACTIVA")) return null;
  const degrees = Number(match[0]);
  return Number.isFinite(degrees) ? degrees * DEG_TO_RAD : null;
}

function updateCalibrationUi() {
  const diagnostics = window.AmuraTrackingDiagnostics || {};
  const tube = String(diagnostics["Tubo"] || "SIN BORDES");
  const sections = String(diagnostics["Secciones válidas"] || "0/7");
  latestDeltaRad = parseDeltaFromDiagnostics();
  readyToConfirm = tube === "TUBO VÁLIDO" && Number.isFinite(latestDeltaRad);

  doneButton.disabled = !readyToConfirm;
  doneButton.style.opacity = readyToConfirm ? "1" : ".48";
  doneButton.style.background = readyToConfirm
    ? "rgba(0,229,255,.88)"
    : "rgba(0,0,0,.82)";
  doneButton.style.color = readyToConfirm ? "#07111f" : "#fff";
  doneButton.textContent = readyToConfirm ? "LISTO" : "AJUSTANDO…";

  calibrationHud.textContent = readyToConfirm
    ? `Líneas válidas (${sections}). Si coinciden con tu antebrazo, pulsa LISTO.`
    : `Ajusta el brazo hasta que las líneas azules se ciñan al antebrazo · ${sections}`;
}

function setCorridorOverlayVisible(visible) {
  const canvas = document.getElementById("forearmEdgeCanvas");
  if (canvas) canvas.style.display = visible ? "block" : "none";
}

function enterCalibration() {
  calibrating = true;
  guideDirection = null;
  latestDeltaRad = null;
  readyToConfirm = false;
  clearGuide();
  setCorridorOverlayVisible(true);

  tuning.watchVisible = 0;
  tuning.occluderMode = 0;
  tuning.triadMode = 0;
  window.AmuraWatchPlacementXmm = WATCH_X_MM;

  calibrationHud.style.display = "block";
  doneButton.style.display = "block";
  doneButton.disabled = true;
  recalibrateButton.style.display = "none";
  if (marker) marker.textContent = "AR-04 · CALIBRACIÓN";
}

function finishCalibration() {
  if (!readyToConfirm || !latestPose || !Number.isFinite(latestDeltaRad)) return;
  const direction = correctedForearmDirection(latestPose, latestDeltaRad);
  if (!direction) return;

  guideDirection = direction;
  calibrating = false;
  setCorridorOverlayVisible(false);

  // A partir de aquí AR-03 NO se vuelve a llamar hasta RECALIBRAR.
  tuning.watchVisible = 1;
  tuning.occluderMode = savedOccluderMode;
  tuning.triadMode = savedTriadMode;
  window.AmuraWatchPlacementXmm = WATCH_X_MM;

  calibrationHud.style.display = "none";
  doneButton.style.display = "none";
  recalibrateButton.style.display = "block";
  if (marker) marker.textContent = "AR-04 · RELOJ · HANDS";

  drawGuide(latestOptions, latestPose);
}

doneButton.addEventListener("click", finishCalibration);
recalibrateButton.addEventListener("click", enterCalibration);

export function updateWristWatch(options) {
  const pose = options && options.pose;
  latestPose = pose || latestPose;
  latestOptions = options || latestOptions;
  window.AmuraWatchPlacementXmm = WATCH_X_MM;

  if (calibrating) {
    tuning.watchVisible = 0;
    tuning.occluderMode = 0;
    tuning.triadMode = 0;
    clearGuide();

    const state = updateCorridorWristWatch(options);
    updateCalibrationUi();
    return state ? { ...state, units: "AR-04 · calibración temporal AR-03" } : state;
  }

  setCorridorOverlayVisible(false);
  tuning.watchVisible = 1;
  tuning.occluderMode = savedOccluderMode;
  tuning.triadMode = savedTriadMode;
  drawGuide(options, pose);

  // IMPORTANTE: pose original de Hands. Sin δ, sin corredor, sin corrección de antebrazo.
  const state = updateBaseWristWatch(options);
  return state ? { ...state, units: "AR-04 · MediaPipe Hands puro + guía" } : state;
}

export function holdWristWatch() {
  if (calibrating) return holdCorridorWristWatch();
  return holdBaseWristWatch();
}

export function hideWristWatch() {
  clearGuide();
  if (calibrating) return hideCorridorWristWatch();
  return hideBaseWristWatch();
}

window.AmuraForearmCalibration = {
  recalibrate: enterCalibration,
  get calibrating() { return calibrating; }
};

enterCalibration();
