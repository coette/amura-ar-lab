// AMURA AR · R10
// R10 mantiene la medición/UX de R09, pero desacopla el ángulo del eje del rectángulo.
// El rectángulo sigue siendo solo zona de búsqueda. La nube cyan decide la dirección fina.
// P0 sigue perteneciendo al segmentador base únicamente como tope del lado de la mano.

const maskCanvas = document.getElementById("maskCanvas");
const maskContext = maskCanvas && maskCanvas.getContext("2d", { willReadFrequently: true });

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function quantile(values, q) {
  if (!values.length) return 0;
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
  const mean = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length
  };

  let xx = 0;
  let xy = 0;
  let yy = 0;
  points.forEach((point) => {
    const dx = point.x - mean.x;
    const dy = point.y - mean.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  });

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  let direction = { x: Math.cos(angle), y: Math.sin(angle) };
  if (preferredDirection && direction.x * preferredDirection.x + direction.y * preferredDirection.y < 0) {
    direction = { x: -direction.x, y: -direction.y };
  }
  return { mean, direction };
}

function cloudDrivenGeometry(baseGeometry) {
  if (!maskCanvas || !maskContext || !maskCanvas.width || !maskCanvas.height || !baseGeometry) return null;

  let imageData;
  try {
    imageData = maskContext.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
  } catch (_) {
    return null;
  }

  const points = [];
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;

  // Solo leemos los píxeles cyan que ya produjo el segmentador.
  // No usamos los bordes ni el ángulo del rectángulo para calcular el ángulo fino.
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const index = (y * width + x) * 4;
      if (!isCloudPixel(data, index)) continue;
      points.push({ x: x + 0.5, y: y + 0.5 });
    }
  }

  if (points.length < 120) return null;

  // PCA de toda la nube: esta es la dirección real que alimentará los 5 cortes de R09.
  // baseGeometry.elbow solo elige el SENTIDO hacia el codo; no aporta el ángulo.
  const axis = fitAxis(points, baseGeometry.elbow);
  if (!axis) return null;

  const projections = points.map((point) =>
    (point.x - axis.mean.x) * axis.direction.x + (point.y - axis.mean.y) * axis.direction.y
  );
  const wristSide = quantile(projections, 0.03);
  const elbowSide = quantile(projections, 0.97);
  const span = elbowSide - wristSide;
  if (!Number.isFinite(span) || span < 36) return null;

  const origin = {
    x: axis.mean.x + axis.direction.x * wristSide,
    y: axis.mean.y + axis.direction.y * wristSide
  };
  const perpendicular = { x: -axis.direction.y, y: axis.direction.x };

  return {
    ...baseGeometry,
    origin,
    elbow: axis.direction,
    perpendicular,
    roiStart: 0,
    roiEnd: span
  };
}

function installR10SnapshotPatch() {
  const lab = window.AmuraForearmMaskLab;
  if (!lab || typeof lab.snapshot !== "function") return false;
  if (lab.__r10CloudAxisInstalled) return true;

  const originalSnapshot = lab.snapshot.bind(lab);
  lab.snapshot = function () {
    const snapshot = originalSnapshot();
    if (!snapshot || !snapshot.calibrated || !snapshot.geometry) return snapshot;
    const geometry = cloudDrivenGeometry(snapshot.geometry);
    return geometry ? { ...snapshot, geometry } : snapshot;
  };
  lab.__r10CloudAxisInstalled = true;
  return true;
}

function installR10CanvasLabelPatch() {
  if (window.__amuraR10FillTextPatch) return;
  const proto = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
  if (!proto || typeof proto.fillText !== "function") return;
  const original = proto.fillText;
  proto.fillText = function (text, ...args) {
    const value = typeof text === "string" ? text.replace(/R09/g, "R10") : text;
    return original.call(this, value, ...args);
  };
  window.__amuraR10FillTextPatch = true;
}

function exposeR10Labels() {
  document.title = "AMURA · EJE NUBE · R10";
  const title = document.getElementById("r09Title");
  if (title) title.textContent = "LAB · EJE NUBE · R10";
  window.AmuraR10AxisMode = {
    revision: "R10",
    source: "cloud-pca",
    rectangleRole: "search-only",
    p0Role: "hand-side-cutoff-only"
  };
}

async function startR10() {
  installR10CanvasLabelPatch();

  const startedAt = performance.now();
  while (!installR10SnapshotPatch()) {
    if (performance.now() - startedAt > 6000) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  // Reutilizamos la UX y la medición temporal de R09. Gracias al snapshot parcheado,
  // sus 5 cortes y sus 4 centros buenos se calculan ahora sobre el eje de la nube.
  await import("./axis-r09-lab.js?v=r09.1");
  exposeR10Labels();
  setTimeout(exposeR10Labels, 120);
}

startR10();
