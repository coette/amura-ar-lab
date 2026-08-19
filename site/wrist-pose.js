/**
 * AMURA · Pose métrica de muñeca
 *
 * Sustituye el camino ortográfico por una traslación métrica aproximada y una
 * cámara perspectiva. La orientación final procede siempre del modo de giro
 * seleccionado en el laboratorio para que posición y giro no usen dos marcos
 * incompatibles.
 *
 * MediaPipe entrega dos cosas a la vez:
 *   - landmarks       → posición en la imagen, normalizada
 *   - worldLandmarks  → la MISMA mano en METROS, centrada en su origen
 *
 * Los worldLandmarks dan la forma y la orientación reales, pero no dicen dónde
 * está la mano respecto a la cámara. Esa traslación se recupera cruzando ambos
 * conjuntos contra la focal del objetivo: es un problema de perspectiva de tres
 * puntos resuelto por mínimos cuadrados, que con la orientación ya conocida se
 * reduce a un sistema lineal. De ahí sale la profundidad real.
 *
 * La escala visual sale de la distancia estimada. No se presenta como una
 * calibración industrial: la focal del navegador y la escala inferida por el
 * modelo siguen siendo aproximaciones y por eso permanecen diagnosticables.
 */

const EPSILON = 1e-9;

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}
function scale(a, k) { return { x: a.x * k, y: a.y * k, z: a.z * k }; }
function len(a) { return Math.hypot(a.x, a.y, a.z); }
function norm(a) {
  const l = len(a);
  return l < EPSILON ? null : scale(a, 1 / l);
}
function mean(points, indices) {
  let x = 0, y = 0, z = 0;
  indices.forEach((i) => { x += points[i].x; y += points[i].y; z += points[i].z; });
  const k = 1 / indices.length;
  return { x: x * k, y: y * k, z: z * k };
}

/**
 * Focal en píxeles a partir del campo de visión vertical.
 * Los objetivos principales de móvil rondan un FOV vertical de 60° en vídeo
 * 16:9; es una aproximación, pero errar 5° mueve la profundidad menos que
 * cualquier otro término del sistema.
 */
export function focalFromFov(imageHeight, fovYDegrees) {
  const fov = (Number(fovYDegrees) || 60) * Math.PI / 180;
  return (imageHeight * 0.5) / Math.tan(fov * 0.5);
}

/**
 * Focal en píxeles desde el FOV diagonal. A diferencia del FOV vertical, el
 * valor diagonal sigue siendo coherente cuando el usuario gira el dispositivo.
 */
export function focalFromDiagonalFov(imageWidth, imageHeight, fovDegrees) {
  const diagonal = Math.hypot(imageWidth, imageHeight);
  const fov = (Number(fovDegrees) || 73) * Math.PI / 180;
  return (diagonal * 0.5) / Math.tan(fov * 0.5);
}

/**
 * Base ortonormal de la muñeca en el espacio métrico de MediaPipe.
 *   xAxis → 9→3 (transversal)
 *   yAxis → 12→6 (muñeca hacia nudillos)
 *   zAxis → fondo→cristal
 * Es la misma convención que el GLB y wrist-frame.js.
 */
export function metricWristBasis(worldPoints, physicalHand) {
  if (!Array.isArray(worldPoints) || worldPoints.length < 18) return null;

  const origin = worldPoints[0];
  const knuckles = mean(worldPoints, [5, 9, 13, 17]);
  const longitudinal = sub(knuckles, origin);
  const yAxis = norm(longitudinal);
  if (!yAxis) return null;

  const transverse = physicalHand === "right"
    ? sub(worldPoints[17], worldPoints[5])
    : sub(worldPoints[5], worldPoints[17]);
  const withoutY = sub(transverse, scale(yAxis, dot(transverse, yAxis)));
  let xAxis = norm(withoutY);
  if (!xAxis) return null;

  const zAxis = norm(cross(xAxis, yAxis));
  if (!zAxis) return null;
  xAxis = norm(cross(yAxis, zAxis));
  if (!xAxis) return null;

  return { xAxis, yAxis, zAxis, armAxis: norm(longitudinal) };
}

/**
 * Traslación métrica de la mano respecto a la cámara.
 *
 * Para cada punto i:  (X_i + T) proyectado = pixel observado
 * Con X_i conocido (worldLandmarks rotados a cámara) queda un sistema lineal
 * de dos ecuaciones por punto en las tres incógnitas de T. Se resuelve por
 * mínimos cuadrados sobre las ecuaciones normales 3x3.
 */
export function solveTranslation(cameraPoints, pixelPoints, focal, cx, cy) {
  const count = Math.min(cameraPoints.length, pixelPoints.length);
  if (count < 3) return null;

  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const b = [0, 0, 0];

  for (let i = 0; i < count; i++) {
    const X = cameraPoints[i];
    const u = pixelPoints[i].x - cx;
    const v = pixelPoints[i].y - cy;

    // fila u:  f*Tx - u*Tz = u*X.z - f*X.x
    // fila v:  f*Ty - v*Tz = v*X.z - f*X.y
    const rows = [
      { r: [focal, 0, -u], s: u * X.z - focal * X.x },
      { r: [0, focal, -v], s: v * X.z - focal * X.y }
    ];

    rows.forEach(({ r, s }) => {
      for (let m = 0; m < 3; m++) {
        for (let n = 0; n < 3; n++) A[m * 3 + n] += r[m] * r[n];
        b[m] += r[m] * s;
      }
    });
  }

  const solved = solve3x3(A, b);
  if (!solved) return null;
  if (!Number.isFinite(solved.z) || solved.z <= 0.02 || solved.z > 6) return null;

  let squaredError = 0;
  for (let i = 0; i < count; i++) {
    const X = cameraPoints[i];
    const z = X.z + solved.z;
    if (z <= EPSILON) return null;
    const projectedX = focal * (X.x + solved.x) / z + cx;
    const projectedY = focal * (X.y + solved.y) / z + cy;
    const dx = projectedX - pixelPoints[i].x;
    const dy = projectedY - pixelPoints[i].y;
    squaredError += dx * dx + dy * dy;
  }
  solved.rmsPixels = Math.sqrt(squaredError / count);
  return solved;
}

function solve3x3(A, b) {
  const m = [
    [A[0], A[1], A[2], b[0]],
    [A[3], A[4], A[5], b[1]],
    [A[6], A[7], A[8], b[2]]
  ];

  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    if (pivot !== col) { const t = m[pivot]; m[pivot] = m[col]; m[col] = t; }

    const d = m[col][col];
    for (let k = col; k < 4; k++) m[col][k] /= d;

    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const factor = m[row][col];
      if (!factor) continue;
      for (let k = col; k < 4; k++) m[row][k] -= factor * m[col][k];
    }
  }

  return { x: m[0][3], y: m[1][3], z: m[2][3] };
}

/**
 * Pose métrica completa de la muñeca.
 * Devuelve milímetros y una base ortonormal en espacio cámara (Y arriba,
 * Z hacia el observador), lista para three.js.
 */
export function solveMetricWristPose(options) {
  const worldPoints = options.worldPoints;
  const imagePoints = options.imagePoints;
  const physicalHand = options.physicalHand;
  const imageWidth = options.imageWidth;
  const imageHeight = options.imageHeight;
  const focal = options.focal;

  if (!Array.isArray(worldPoints) || worldPoints.length < 18) return null;
  if (!Array.isArray(imagePoints) || imagePoints.length < 18) return null;

  const basis = metricWristBasis(worldPoints, physicalHand);
  if (!basis) return null;

  // Los worldLandmarks ya vienen orientados como la mano se ve; sólo hace
  // falta la traslación. Se usan los puntos estables de la palma: la muñeca y
  // las cuatro bases de los dedos. Las puntas se descartan porque se mueven.
  const indices = [0, 5, 9, 13, 17];
  const cameraPoints = [];
  const pixelPoints = [];
  indices.forEach((i) => {
    if (!worldPoints[i] || !imagePoints[i]) return;
    cameraPoints.push({
      x: worldPoints[i].x,
      y: worldPoints[i].y,
      z: worldPoints[i].z
    });
    pixelPoints.push({
      x: imagePoints[i].x * imageWidth,
      y: imagePoints[i].y * imageHeight
    });
  });

  const translation = solveTranslation(
    cameraPoints,
    pixelPoints,
    focal,
    imageWidth * 0.5,
    imageHeight * 0.5
  );
  if (!translation) return null;

  const wristMetres = {
    x: worldPoints[0].x + translation.x,
    y: worldPoints[0].y + translation.y,
    z: worldPoints[0].z + translation.z
  };

  // Distancia entre los MCP de índice y meñique. Es anchura de palma, no
  // anchura anatómica de muñeca; se conserva como referencia de estabilidad.
  const palmWidthMm = len(sub(worldPoints[17], worldPoints[5])) * 1000;

  // A espacio three.js: X igual, Y hacia arriba, Z hacia el observador.
  const toThree = (v) => ({ x: v.x, y: -v.y, z: -v.z });

  return {
    positionMm: {
      x: wristMetres.x * 1000,
      y: -wristMetres.y * 1000,
      z: -wristMetres.z * 1000
    },
    depthMm: wristMetres.z * 1000,
    palmWidthMm,
    reprojectionErrorPx: translation.rmsPixels,
    xAxis: toThree(basis.xAxis),
    yAxis: toThree(basis.yAxis),
    zAxis: toThree(basis.zAxis),
    armAxis: toThree(basis.armAxis),
    focal
  };
}
