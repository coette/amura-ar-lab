/**
 * AMURA · Pose P0 directa V11.3
 *
 * Regla de esta prueba:
 *   1) P0 manda la posición visual del centro del fondo.
 *   2) La profundidad sólo decide perspectiva/escala.
 *   3) La orientación se calcula fuera, con P0/P5/P17.
 *
 * Por tanto ya no resolvemos una traslación XYZ libre mediante mínimos
 * cuadrados. Estimamos una única profundidad robusta a partir del tamaño
 * aparente de varios segmentos de la palma y colocamos P0 sobre su rayo de
 * cámara. Así un error de escala no puede desplazar lateralmente el reloj.
 */

const EPSILON = 1e-9;

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function len(a) {
  return Math.hypot(a.x, a.y, a.z);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

export function focalFromFov(imageHeight, fovYDegrees) {
  const fov = (Number(fovYDegrees) || 60) * Math.PI / 180;
  return (imageHeight * 0.5) / Math.tan(fov * 0.5);
}

export function focalFromDiagonalFov(imageWidth, imageHeight, fovDegrees) {
  const diagonal = Math.hypot(imageWidth, imageHeight);
  const fov = (Number(fovDegrees) || 73) * Math.PI / 180;
  return (diagonal * 0.5) / Math.tan(fov * 0.5);
}

/**
 * Se conserva por compatibilidad/diagnóstico. La orientación que llega al
 * reloj la sustituye hand-tracking.js por buildWristFrame(P0,P5,P17).
 */
export function metricWristBasis(worldPoints, physicalHand) {
  if (!Array.isArray(worldPoints) || worldPoints.length < 18) return null;
  const p0 = worldPoints[0];
  const p5 = worldPoints[5];
  const p17 = worldPoints[17];
  if (!p0 || !p5 || !p17) return null;

  const mid = {
    x: (p5.x + p17.x) * 0.5,
    y: (p5.y + p17.y) * 0.5,
    z: (p5.z + p17.z) * 0.5
  };
  const longitudinal = sub(mid, p0);
  const longitudinalLength = len(longitudinal);
  if (longitudinalLength < EPSILON) return null;
  const xAxis = {
    x: longitudinal.x / longitudinalLength,
    y: longitudinal.y / longitudinalLength,
    z: longitudinal.z / longitudinalLength
  };

  const transverse = physicalHand === "right"
    ? sub(p17, p5)
    : sub(p5, p17);
  const dotXY = transverse.x * xAxis.x + transverse.y * xAxis.y + transverse.z * xAxis.z;
  const yRaw = {
    x: transverse.x - xAxis.x * dotXY,
    y: transverse.y - xAxis.y * dotXY,
    z: transverse.z - xAxis.z * dotXY
  };
  const yLength = len(yRaw);
  if (yLength < EPSILON) return null;
  const yAxis = { x: yRaw.x / yLength, y: yRaw.y / yLength, z: yRaw.z / yLength };
  const zRaw = {
    x: xAxis.y * yAxis.z - xAxis.z * yAxis.y,
    y: xAxis.z * yAxis.x - xAxis.x * yAxis.z,
    z: xAxis.x * yAxis.y - xAxis.y * yAxis.x
  };
  const zLength = len(zRaw);
  if (zLength < EPSILON) return null;
  const zAxis = { x: zRaw.x / zLength, y: zRaw.y / zLength, z: zRaw.z / zLength };

  return { xAxis, yAxis, zAxis, armAxis: xAxis };
}

/**
 * Profundidad estimada exclusivamente desde escala.
 *
 * Para cada pareja usamos la longitud de su componente XY en worldLandmarks
 * (metros) y la longitud observada en píxeles. Esto compensa el acortamiento
 * por giro: cuando un segmento apunta hacia cámara, su proyección 3D XY y su
 * proyección 2D se reducen juntas. La mediana de varias parejas evita depender
 * de P5-P17 justo cerca del perfil.
 */
function estimateDepthMm(worldPoints, imagePoints, focal, imageWidth, imageHeight) {
  const pairs = [
    [0, 9],
    [0, 5],
    [0, 17],
    [5, 17],
    [5, 9],
    [9, 13],
    [13, 17]
  ];
  const estimates = [];

  for (const [a, b] of pairs) {
    const wa = worldPoints[a];
    const wb = worldPoints[b];
    const ia = imagePoints[a];
    const ib = imagePoints[b];
    if (!wa || !wb || !ia || !ib) continue;

    const worldProjectedMm = Math.hypot(
      (wa.x - wb.x) * 1000,
      (wa.y - wb.y) * 1000
    );
    const pixelDistance = Math.hypot(
      (ia.x - ib.x) * imageWidth,
      (ia.y - ib.y) * imageHeight
    );

    if (worldProjectedMm < 3 || pixelDistance < 6) continue;
    const depth = focal * worldProjectedMm / pixelDistance;
    if (Number.isFinite(depth) && depth >= 120 && depth <= 1800) {
      estimates.push(depth);
    }
  }

  return median(estimates);
}

export function solveMetricWristPose(options) {
  const worldPoints = options.worldPoints;
  const imagePoints = options.imagePoints;
  const physicalHand = options.physicalHand;
  const imageWidth = Math.max(1, Number(options.imageWidth) || 1);
  const imageHeight = Math.max(1, Number(options.imageHeight) || 1);
  const focal = Math.max(1, Number(options.focal) || 1);

  if (!Array.isArray(worldPoints) || worldPoints.length < 18) return null;
  if (!Array.isArray(imagePoints) || imagePoints.length < 18) return null;
  if (!imagePoints[0]) return null;

  const depthMm = estimateDepthMm(
    worldPoints,
    imagePoints,
    focal,
    imageWidth,
    imageHeight
  );
  if (!depthMm) return null;

  const p0 = imagePoints[0];
  const u = p0.x * imageWidth;
  const v = p0.y * imageHeight;
  const cx = imageWidth * 0.5;
  const cy = imageHeight * 0.5;

  // Punto 3D sobre el rayo exacto que atraviesa P0.
  const positionMm = {
    x: (u - cx) * depthMm / focal,
    y: -(v - cy) * depthMm / focal,
    z: -depthMm
  };

  const basis = metricWristBasis(worldPoints, physicalHand);
  if (!basis) return null;
  const toThree = (axis) => ({ x: axis.x, y: -axis.y, z: -axis.z });

  const palmWidthMm = len(sub(worldPoints[17], worldPoints[5])) * 1000;

  return {
    positionMm,
    depthMm,
    palmWidthMm,
    // En este modo P0 se satisface por construcción; no existe reproyección
    // libre del origen que pueda desviarlo.
    reprojectionErrorPx: 0,
    xAxis: toThree(basis.xAxis),
    yAxis: toThree(basis.yAxis),
    zAxis: toThree(basis.zAxis),
    armAxis: toThree(basis.xAxis),
    focal
  };
}
