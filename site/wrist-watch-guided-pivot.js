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

// AR-04 · CALIBRACIÓN + PIVOT CENTRO MUÑECA
// +X = codo→mano · +Y = 6→12 · +Z = fondo→cristal.
// El corredor solo existe durante calibración. Después gobierna Hands puro.
// La tríada permanece en P0/fondo. La posición se compensa para que el centro
// de la muñeca virtual sea el eje mecánico alrededor del que rota el conjunto.

const root = document.querySelector(".camera-lab") || document.body;
const marker = document.getElementById("ar04Marker");
const WATCH_X_MM = -24;
const GUIDE_OFFSET_PX = 66;
const GUIDE_HALF_LENGTH_PX = 190;
const DEG_TO_RAD = Math.PI / 180;

let calibrating = true;
let guideDirection = null;
let pivotReferenceZ = null;
let latestPose = null;
let latestOptions = null;
let latestDeltaRad = null;
let readyToConfirm = false;
let resumeOccluderMode = Number.isFinite(Number(tuning.occluderMode)) ? Number(tuning.occluderMode) : 1;
let resumeTriadMode = Number.isFinite(Number(tuning.triadMode)) ? Number(tuning.triadMode) : 0;
let resumeWatchX = WATCH_X_MM;

const guideCanvas = document.createElement("canvas");
guideCanvas.id = "forearmGuideCanvas";
guideCanvas.setAttribute("aria-hidden", "true");
Object.assign(guideCanvas.style, {
  position: "absolute", inset: "0", width: "100%", height: "100%",
  pointerEvents: "none", zIndex: "99979"
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
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 76px)",
  zIndex: "100030",
  height: "36px",
  padding: "0 12px",
  borderRadius: "18px",
  border: "1px solid rgba(255,255,255,.42)",
  background: "rgba(0,0,0,.58)",
  color: "rgba(255,255,255,.88)",
  font: "800 10px/1 Arial, sans-serif",
  letterSpacing: ".045em",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
  display: "none"
});
root.appendChild(recalibrateButton);

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
  const correctedX = rotateAroundAxis(pose.xAxis, pose.zAxis, -deltaRad);
  let direction = projectAxisDifferential(pose, correctedX);
  if (!direction) return null;
  if (document.body && document.body.dataset.facing === "user") {
    direction = { x: -direction.x, y: direction.y };
  }
  return normalize2(direction);
}

function applyWristCenterPivot(pose) {
  if (!pose || !pose.positionMm || !pivotReferenceZ) return pose;
  const currentZ = normalize3(pose.zAxis);
  if (!currentZ) return pose;

  // La cápsula validada tiene su centro a medio grosor desde P0 sobre Z local.
  // Compensamos la traslación para que ese centro no orbite alrededor de P0:
  // C = P0_corregido + Z_vivo*r = P0_raw + Z_calibración*r.
  const radiusMm = Math.max(1, Number(tuning.occluderThicknessMm) || 44) * 0.5;
  const correction = {
    x: (pivotReferenceZ.x - currentZ.x) * radiusMm,
    y: (pivotReferenceZ.y - currentZ.y) * radiusMm,
    z: (pivotReferenceZ.z - currentZ.z) * radiusMm
  };

  return {
    ...pose,
    positionMm: {
      x: Number(pose.positionMm.x) + correction.x,
      y: Number(pose.positionMm.y) + correction.y,
      z: Number(pose.positionMm.z) + correction.z
    }
  };
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
  if (!guideDirection || !guideContext) return clearGuide();
  const projection = displayProjection(options, pose);
  if (!projection) return clearGuide();

  const size = resizeGuideCanvas(projection.width, projection.height);
  guideContext.clearRect(0, 0, size.width, size.height);

  const d = guideDirection;
  let normal = normalize2({ x: -d.y, y: d.x });
  if (!normal) return;
  if (normal.x > 0) normal = { x: -normal.x, y: -normal.y };

  const center = {
    x: projection.x + normal.x * GUIDE_OFFSET_PX,
    y: projection.y + normal.y * GUIDE_OFFSET_PX
  };

  guideContext.save();
  guideContext.strokeStyle = "rgba(255,255,255,.25)";
  guideContext.lineWidth = 2;
  guideContext.setLineDash([10, 10]);
  guideContext.lineCap = "round";
  guideContext.shadowColor = "rgba(0,0,0,.45)";
  guideContext.shadowBlur = 3;
  guideContext.beginPath();
  guideContext.moveTo(center.x - d.x * GUIDE_HALF_LENGTH_PX, center.y - d.y * GUIDE_HALF_LENGTH_PX);
  guideContext.lineTo(center.x + d.x * GUIDE_HALF_LENGTH_PX, center.y + d.y * GUIDE_HALF_LENGTH_PX);
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
  doneButton.style.background = readyToConfirm ? "rgba(0,229,255,.88)" : "rgba(0,0,0,.82)";
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
  if (!calibrating) {
    resumeOccluderMode = Number(tuning.occluderMode) || 0;
    resumeTriadMode = Number(tuning.triadMode) || 0;
    resumeWatchX = Number(window.AmuraWatchPlacementXmm);
    if (!Number.isFinite(resumeWatchX)) resumeWatchX = WATCH_X_MM;
  }

  calibrating = true;
  document.body.dataset.calibrating = "true";
  guideDirection = null;
  pivotReferenceZ = null;
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
  const referenceZ = normalize3(latestPose.zAxis);
  if (!direction || !referenceZ) return;

  guideDirection = direction;
  pivotReferenceZ = referenceZ;
  calibrating = false;
  document.body.dataset.calibrating = "false";
  setCorridorOverlayVisible(false);

  // Desde aquí el corredor deja de ejecutarse. Se restaura la interfaz de trabajo.
  tuning.watchVisible = 1;
  tuning.occluderMode = resumeOccluderMode;
  tuning.triadMode = resumeTriadMode;
  window.AmuraWatchPlacementXmm = Number.isFinite(resumeWatchX) ? resumeWatchX : WATCH_X_MM;

  calibrationHud.style.display = "none";
  doneButton.style.display = "none";
  recalibrateButton.style.display = "block";
  if (marker) marker.textContent = "AR-04 · PIVOT MUÑECA";

  const pivotPose = applyWristCenterPivot(latestPose);
  drawGuide(latestOptions, pivotPose);
}

doneButton.addEventListener("click", finishCalibration);
recalibrateButton.addEventListener("click", enterCalibration);

export function updateWristWatch(options) {
  const pose = options && options.pose;
  latestPose = pose || latestPose;
  latestOptions = options || latestOptions;

  if (calibrating) {
    tuning.watchVisible = 0;
    tuning.occluderMode = 0;
    tuning.triadMode = 0;
    window.AmuraWatchPlacementXmm = WATCH_X_MM;
    clearGuide();

    const state = updateCorridorWristWatch(options);
    updateCalibrationUi();
    return state ? { ...state, units: "AR-04 · calibración temporal AR-03" } : state;
  }

  setCorridorOverlayVisible(false);

  // Hands sigue siendo la única orientación en tiempo real. Solo corregimos la
  // traslación para que el centro de la muñeca virtual sea el eje de pivotamiento.
  const pivotPose = applyWristCenterPivot(pose);
  drawGuide(options, pivotPose);
  const state = updateBaseWristWatch({ ...options, pose: pivotPose });
  return state ? { ...state, units: "AR-04 · Hands + pivot centro muñeca" } : state;
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
  get calibrating() { return calibrating; },
  get pivotReferenceZ() { return pivotReferenceZ; }
};

enterCalibration();
