import {
  hideWristWatch as hideBase,
  holdWristWatch as holdBase,
  updateWristWatch as updateBase
} from "./wrist-watch.js?v=ar02.2";
import {
  hideWristWatch as hideCorridor,
  holdWristWatch as holdCorridor,
  updateWristWatch as updateCorridor
} from "./wrist-watch-ar03-corridor.js?v=ar03.8";
import { tuning } from "./tuner.js?v=11.2";

const root = document.querySelector(".camera-lab") || document.body;
const marker = document.getElementById("ar04Marker");
const WATCH_X_MM = -24;
const WIDTH_REF = 62;
const THICKNESS_REF = 44;
const GUIDE_OFFSET_PX = 66;
const GUIDE_HALF_LENGTH_PX = 190;

let calibrating = true;
let latestPose = null;
let latestOptions = null;
let ready = false;
let guideDirection = null;
let correctionLocalMm = null;
let calibrationData = null;
let resumeOccluderMode = Number(tuning.occluderMode) || 1;
let resumeTriadMode = Number(tuning.triadMode) || 0;
let resumeWatchX = Number.isFinite(Number(window.AmuraWatchPlacementXmm))
  ? Number(window.AmuraWatchPlacementXmm)
  : WATCH_X_MM;

const guideCanvas = document.createElement("canvas");
guideCanvas.id = "forearmGuideCanvas";
guideCanvas.setAttribute("aria-hidden", "true");
Object.assign(guideCanvas.style, {
  position: "absolute", inset: "0", width: "100%", height: "100%",
  pointerEvents: "none", zIndex: "99979"
});
root.appendChild(guideCanvas);
const gctx = guideCanvas.getContext("2d");

const hud = document.createElement("div");
hud.id = "forearmCalibrationHud";
Object.assign(hud.style, {
  position: "absolute",
  top: "calc(env(safe-area-inset-top, 0px) + 48px)",
  left: "50%", transform: "translateX(-50%)", zIndex: "100020",
  maxWidth: "min(90vw, 410px)", padding: "10px 14px", borderRadius: "12px",
  background: "rgba(0,0,0,.78)", border: "1px solid rgba(255,255,255,.22)",
  color: "#fff", font: "700 13px/1.35 Arial, sans-serif", textAlign: "center",
  boxShadow: "0 3px 14px rgba(0,0,0,.4)", pointerEvents: "none"
});
hud.textContent = "Pon el dorso de la muñeca de frente y ajusta las líneas azules al antebrazo.";
root.appendChild(hud);

const done = document.createElement("button");
done.id = "forearmCalibrationDone";
done.type = "button";
done.textContent = "AJUSTANDO…";
Object.assign(done.style, {
  position: "fixed", left: "50%",
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 18px)",
  transform: "translateX(-50%)", zIndex: "100030", minWidth: "132px", height: "52px",
  padding: "0 24px", borderRadius: "26px", border: "1px solid rgba(255,255,255,.88)",
  background: "rgba(0,0,0,.82)", color: "#fff", font: "800 15px/1 Arial, sans-serif",
  letterSpacing: ".06em", boxShadow: "0 4px 18px rgba(0,0,0,.45)",
  WebkitTapHighlightColor: "transparent", touchAction: "manipulation"
});
root.appendChild(done);

const recalibrate = document.createElement("button");
recalibrate.id = "forearmRecalibrate";
recalibrate.type = "button";
recalibrate.textContent = "RECALIBRAR";
Object.assign(recalibrate.style, {
  position: "fixed", right: "12px",
  bottom: "calc(env(safe-area-inset-bottom, 0px) + 76px)",
  zIndex: "100030", height: "36px", padding: "0 12px", borderRadius: "18px",
  border: "1px solid rgba(255,255,255,.42)", background: "rgba(0,0,0,.58)",
  color: "rgba(255,255,255,.88)", font: "800 10px/1 Arial, sans-serif",
  letterSpacing: ".045em", WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation", display: "none"
});
root.appendChild(recalibrate);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dot3 = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const add3 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale3 = (v, s) => ({ x: v.x * s, y: v.y * s, z: v.z * s });

function norm2(v) {
  if (!v) return null;
  const n = Math.hypot(Number(v.x) || 0, Number(v.y) || 0);
  return n < 1e-7 ? null : { x: v.x / n, y: v.y / n };
}
function norm3(v) {
  if (!v) return null;
  const n = Math.hypot(Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0);
  return n < 1e-7 ? null : { x: v.x / n, y: v.y / n, z: v.z / n };
}
function basisOf(pose) {
  const x = norm3(pose && pose.xAxis);
  const y = norm3(pose && pose.yAxis);
  const z = norm3(pose && pose.zAxis);
  return x && y && z ? { x, y, z } : null;
}
function localToWorld(local, b) {
  return add3(add3(scale3(b.x, local.x), scale3(b.y, local.y)), scale3(b.z, local.z));
}
function worldToLocal(v, b) {
  return { x: dot3(v, b.x), y: dot3(v, b.y), z: dot3(v, b.z) };
}

function projection(options, pose) {
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
  return { x, y, width, height, focal, depth };
}

function backProject(point, depth, p) {
  let x = point.x;
  if (document.body && document.body.dataset.facing === "user") x = p.width - x;
  return {
    x: (x - p.width * 0.5) * depth / p.focal,
    y: -(point.y - p.height * 0.5) * depth / p.focal,
    z: -depth
  };
}

function parseNumber(value) {
  const m = String(value || "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function widthMm() {
  const d = window.AmuraTrackingDiagnostics || {};
  const v = parseNumber(d["Anchura antebrazo"]);
  return Number.isFinite(v) ? clamp(v, 42, 100) : null;
}
function tubeReady() {
  const d = window.AmuraTrackingDiagnostics || {};
  return d["Tubo"] === "TUBO VÁLIDO" &&
    String(d["δ antebrazo"] || "").includes("δ ACTIVA") &&
    Number.isFinite(widthMm());
}

function centerLineFromOverlay() {
  const canvas = document.getElementById("forearmEdgeCanvas");
  if (!canvas || !canvas.width || !canvas.height) return null;
  let image;
  try {
    image = canvas.getContext("2d", { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height);
  } catch (_) { return null; }

  const pts = [];
  const data = image.data;
  for (let y = 0; y < canvas.height; y += 2) {
    for (let x = 0; x < canvas.width; x += 2) {
      const i = (y * canvas.width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a > 70 && r >= 35 && r <= 130 && g >= 150 && b >= 175 && g - r >= 55 && b - r >= 70) {
        pts.push({ x, y });
      }
    }
  }
  if (pts.length < 18) return null;

  let cx = 0, cy = 0;
  for (const q of pts) { cx += q.x; cy += q.y; }
  cx /= pts.length; cy /= pts.length;

  let sxx = 0, syy = 0, sxy = 0;
  for (const q of pts) {
    const dx = q.x - cx, dy = q.y - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const direction = norm2({ x: Math.cos(theta), y: Math.sin(theta) });
  return direction ? { point: { x: cx, y: cy }, direction, samples: pts.length } : null;
}

function nearestPointOnLine(point, line) {
  const dx = point.x - line.point.x;
  const dy = point.y - line.point.y;
  const t = dx * line.direction.x + dy * line.direction.y;
  return {
    x: line.point.x + line.direction.x * t,
    y: line.point.y + line.direction.y * t
  };
}

function buildCalibration(pose, options) {
  const p = projection(options, pose);
  const b = basisOf(pose);
  const w = widthMm();
  const line = centerLineFromOverlay();
  if (!p || !b || !w || !line) return null;

  const axisScreen = nearestPointOnLine({ x: p.x, y: p.y }, line);
  const thickness = clamp(w * (THICKNESS_REF / WIDTH_REF), 28, 72);
  const surfaceDepth = -Number(pose.positionMm.z);
  const axisDepth = surfaceDepth + thickness * 0.5;
  const realAxis = backProject(axisScreen, axisDepth, p);

  const virtualCenter = {
    x: Number(pose.positionMm.x) + b.z.x * thickness * 0.5,
    y: Number(pose.positionMm.y) + b.z.y * thickness * 0.5,
    z: Number(pose.positionMm.z) + b.z.z * thickness * 0.5
  };
  const correctionWorld = {
    x: realAxis.x - virtualCenter.x,
    y: realAxis.y - virtualCenter.y,
    z: realAxis.z - virtualCenter.z
  };
  let dir = line.direction;
  if (dir.x < 0) dir = { x: -dir.x, y: -dir.y };

  return {
    correctionLocal: worldToLocal(correctionWorld, b),
    guideDirection: dir,
    widthMm: w,
    thicknessMm: thickness,
    surfaceDepthMm: surfaceDepth,
    axisDepthMm: axisDepth,
    axisScreenPoint: axisScreen,
    realAxisPoint: realAxis,
    samples: line.samples
  };
}

function applyAxis(pose) {
  if (!pose || !pose.positionMm || !correctionLocalMm) return pose;
  const b = basisOf(pose);
  if (!b) return pose;
  const c = localToWorld(correctionLocalMm, b);
  return {
    ...pose,
    positionMm: {
      x: Number(pose.positionMm.x) + c.x,
      y: Number(pose.positionMm.y) + c.y,
      z: Number(pose.positionMm.z) + c.z
    }
  };
}

function resizeGuide(width, height) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (guideCanvas.width !== pw || guideCanvas.height !== ph) {
    guideCanvas.width = pw; guideCanvas.height = ph;
    guideCanvas.style.width = w + "px"; guideCanvas.style.height = h + "px";
  }
  gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: w, height: h };
}
function clearGuide() {
  const s = resizeGuide(window.innerWidth || 1, window.innerHeight || 1);
  gctx.clearRect(0, 0, s.width, s.height);
}
function drawGuide(options, pose) {
  if (!guideDirection) return clearGuide();
  const p = projection(options, pose);
  if (!p) return clearGuide();
  const s = resizeGuide(p.width, p.height);
  gctx.clearRect(0, 0, s.width, s.height);
  const d = guideDirection;
  let n = norm2({ x: -d.y, y: d.x });
  if (!n) return;
  if (n.x > 0) n = { x: -n.x, y: -n.y };
  const c = { x: p.x + n.x * GUIDE_OFFSET_PX, y: p.y + n.y * GUIDE_OFFSET_PX };
  gctx.save();
  gctx.strokeStyle = "rgba(255,255,255,.25)";
  gctx.lineWidth = 2;
  gctx.setLineDash([10, 10]);
  gctx.lineCap = "round";
  gctx.beginPath();
  gctx.moveTo(c.x - d.x * GUIDE_HALF_LENGTH_PX, c.y - d.y * GUIDE_HALF_LENGTH_PX);
  gctx.lineTo(c.x + d.x * GUIDE_HALF_LENGTH_PX, c.y + d.y * GUIDE_HALF_LENGTH_PX);
  gctx.stroke();
  gctx.restore();
}

function showCorridor(visible) {
  const c = document.getElementById("forearmEdgeCanvas");
  if (c) c.style.display = visible ? "block" : "none";
}
function updateUi() {
  const d = window.AmuraTrackingDiagnostics || {};
  const sections = String(d["Secciones válidas"] || "0/7");
  ready = tubeReady();
  done.disabled = !ready;
  done.style.opacity = ready ? "1" : ".48";
  done.style.background = ready ? "rgba(0,229,255,.88)" : "rgba(0,0,0,.82)";
  done.style.color = ready ? "#07111f" : "#fff";
  done.textContent = ready ? "LISTO" : "AJUSTANDO…";
  hud.textContent = ready
    ? `Muñeca de frente · líneas válidas (${sections}). Si están ceñidas, pulsa LISTO.`
    : `Pon el dorso de la muñeca de frente y ajusta las líneas azules · ${sections}`;
}

function enterCalibration() {
  if (!calibrating) {
    resumeOccluderMode = Number(tuning.occluderMode) || 0;
    resumeTriadMode = Number(tuning.triadMode) || 0;
    const x = Number(window.AmuraWatchPlacementXmm);
    resumeWatchX = Number.isFinite(x) ? x : WATCH_X_MM;
  }
  calibrating = true;
  document.body.dataset.calibrating = "true";
  correctionLocalMm = null;
  calibrationData = null;
  guideDirection = null;
  ready = false;
  clearGuide();
  showCorridor(true);
  tuning.watchVisible = 0;
  tuning.occluderMode = 0;
  tuning.triadMode = 0;
  window.AmuraWatchPlacementXmm = WATCH_X_MM;
  hud.style.display = "block";
  done.style.display = "block";
  done.disabled = true;
  recalibrate.style.display = "none";
  if (marker) marker.textContent = "AR-04 · CALIBRACIÓN EJE";
}

function finishCalibration() {
  if (!ready || !latestPose || !latestOptions) return;
  const c = buildCalibration(latestPose, latestOptions);
  if (!c) {
    hud.textContent = "No he podido fijar el eje central. Mantén la muñeca de frente y vuelve a pulsar LISTO.";
    return;
  }

  correctionLocalMm = c.correctionLocal;
  guideDirection = c.guideDirection;
  calibrationData = c;
  tuning.occluderWidthMm = c.widthMm;
  tuning.occluderThicknessMm = c.thicknessMm;

  calibrating = false;
  document.body.dataset.calibrating = "false";
  showCorridor(false);
  tuning.watchVisible = 1;
  tuning.occluderMode = resumeOccluderMode;
  tuning.triadMode = resumeTriadMode;
  window.AmuraWatchPlacementXmm = Number.isFinite(resumeWatchX) ? resumeWatchX : WATCH_X_MM;
  hud.style.display = "none";
  done.style.display = "none";
  recalibrate.style.display = "block";
  if (marker) marker.textContent = "AR-04 · EJE REAL";
  drawGuide(latestOptions, applyAxis(latestPose));
}

done.addEventListener("click", finishCalibration);
recalibrate.addEventListener("click", enterCalibration);

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
    const state = updateCorridor(options);
    updateUi();
    return state ? { ...state, units: "AR-04 · calibración eje real" } : state;
  }

  showCorridor(false);
  const correctedPose = applyAxis(pose);
  drawGuide(options, correctedPose);
  const state = updateBase({ ...options, pose: correctedPose });
  return state ? { ...state, units: "AR-04 · Hands + eje real calibrado" } : state;
}

export function holdWristWatch() {
  return calibrating ? holdCorridor() : holdBase();
}
export function hideWristWatch() {
  clearGuide();
  return calibrating ? hideCorridor() : hideBase();
}

window.AmuraForearmCalibration = {
  recalibrate: enterCalibration,
  get calibrating() { return calibrating; },
  get correctionLocalMm() { return correctionLocalMm; },
  get calibrationData() { return calibrationData; }
};

enterCalibration();