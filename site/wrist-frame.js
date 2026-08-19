const EPSILON = 1e-8;

function vectorFrom(point) {
  return {
    x: Number(point && point.x) || 0,
    y: Number(point && point.y) || 0,
    z: Number(point && point.z) || 0
  };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(vector, scalar) {
  return {
    x: vector.x * scalar,
    y: vector.y * scalar,
    z: vector.z * scalar
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x
  };
}

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize(vector) {
  const length = magnitude(vector);
  if (length < EPSILON) return null;
  return scale(vector, 1 / length);
}

function average(points, indices) {
  const total = indices.reduce((sum, index) => {
    const point = vectorFrom(points[index]);
    return {
      x: sum.x + point.x,
      y: sum.y + point.y,
      z: sum.z + point.z
    };
  }, { x: 0, y: 0, z: 0 });

  return scale(total, 1 / indices.length);
}

function validPoints(points) {
  return Array.isArray(points) && points.length >= 18 && points.every((point) => (
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z)
  ));
}

export function buildWristFrame(points, physicalHand) {
  if (!validPoints(points) || (physicalHand !== "left" && physicalHand !== "right")) {
    return null;
  }

  const origin = vectorFrom(points[0]);
  const knuckleCenter = average(points, [5, 9, 13, 17]);
  const longitudinalGuide = subtract(knuckleCenter, origin);
  const yAxis = normalize(longitudinalGuide);
  if (!yAxis) return null;

  const indexMcp = vectorFrom(points[5]);
  const pinkyMcp = vectorFrom(points[17]);
  // Convención AMURA/GLB:
  //   +X = 9→3 (transversal de la caja)
  //   +Y = 12→6 (longitudinal, hacia los dedos)
  //   +Z = fondo→cristal
  // En la mano derecha X debe invertirse para conservar una base dextrógira
  // con Z saliendo del dorso; un reloj real no se refleja al cambiar de muñeca.
  const transverseGuide = physicalHand === "right"
    ? subtract(pinkyMcp, indexMcp)
    : subtract(indexMcp, pinkyMcp);
  const xWithoutY = subtract(
    transverseGuide,
    scale(yAxis, dot(transverseGuide, yAxis))
  );
  let xAxis = normalize(xWithoutY);
  if (!xAxis) return null;

  const zAxis = normalize(cross(xAxis, yAxis));
  if (!zAxis) return null;

  xAxis = normalize(cross(yAxis, zAxis));
  if (!xAxis) return null;

  return {
    origin,
    xAxis,
    yAxis,
    zAxis
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function degrees(radians) {
  return radians * 180 / Math.PI;
}

function radians(value) {
  return value * Math.PI / 180;
}

function angularDistance(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

export function imageSpaceLandmarks(points, width, height) {
  const imageWidth = Math.max(1, Number(width) || 1);
  const imageHeight = Math.max(1, Number(height) || 1);

  if (!Array.isArray(points)) return [];

  return points.map((point) => ({
    x: (Number(point && point.x) || 0) * imageWidth,
    y: (Number(point && point.y) || 0) * imageHeight,
    // MediaPipe expresa z aproximadamente en la misma escala normalizada que x.
    z: (Number(point && point.z) || 0) * imageWidth
  }));
}

export function createHybridWristState() {
  return {
    hand: "",
    referenceRatio: 0,
    angle: null,
    longitudinalReference: 0
  };
}

export function resetHybridWristState(state) {
  if (!state) return;
  state.hand = "";
  state.referenceRatio = 0;
  state.angle = null;
  state.longitudinalReference = 0;
}

function selectContinuousRoll(magnitude, signal, previousAngle) {
  const positive = magnitude;
  const negative = -magnitude;

  if (!Number.isFinite(previousAngle)) {
    return signal < 0 ? negative : positive;
  }

  const positiveDistance = angularDistance(positive, previousAngle);
  const negativeDistance = angularDistance(negative, previousAngle);
  if (Math.abs(positiveDistance - negativeDistance) < radians(2)) {
    return signal < 0 ? negative : positive;
  }
  return positiveDistance <= negativeDistance ? positive : negative;
}

export function buildHybridWristFrame(
  imagePoints,
  worldPoints,
  physicalHand,
  state,
  correctFlexion
) {
  if (!validPoints(imagePoints) || !state) return null;
  if (physicalHand !== "left" && physicalHand !== "right") return null;

  if (state.hand !== physicalHand) {
    resetHybridWristState(state);
    state.hand = physicalHand;
  }

  const origin = vectorFrom(imagePoints[0]);
  const knuckleCenter = average(imagePoints, [5, 9, 13, 17]);
  const longitudinalGuide = subtract(knuckleCenter, origin);
  const longitudinalPixels = Math.hypot(longitudinalGuide.x, longitudinalGuide.y);
  if (longitudinalPixels < EPSILON) return null;

  const yAxis = normalize({
    x: longitudinalGuide.x,
    y: longitudinalGuide.y,
    z: 0
  });
  if (!yAxis) return null;

  const transverseGuide = physicalHand === "right"
    ? subtract(vectorFrom(imagePoints[17]), vectorFrom(imagePoints[5]))
    : subtract(vectorFrom(imagePoints[5]), vectorFrom(imagePoints[17]));
  // Perpendicular fija en pantalla: no se deriva de la anchura instantánea,
  // porque esa anchura cambia de signo al sobrepasar 90° de pronación.
  const xBase = normalize({ x: -yAxis.y, y: yAxis.x, z: 0 });
  if (!xBase) return null;
  const zBase = normalize(cross(xBase, yAxis));
  if (!zBase) return null;

  const signedTransversePixels =
    transverseGuide.x * xBase.x + transverseGuide.y * xBase.y;

  // Doblar la muñeca arriba/abajo acorta la longitudinal proyectada sin tocar
  // la transversal. Dividir por la longitudinal instantánea convierte esa
  // flexión en un giro de antebrazo que no ha ocurrido. Como la pronación mueve
  // la transversal y la flexión mueve la longitudinal, basta con normalizar
  // contra una longitudinal filtrada lento: sigue los cambios de distancia
  // (segundos) pero ignora la flexión (décimas).
  if (!state.longitudinalReference) {
    state.longitudinalReference = longitudinalPixels;
  } else {
    state.longitudinalReference +=
      (longitudinalPixels - state.longitudinalReference) * 0.04;
  }
  const normalizer = correctFlexion
    ? Math.max(state.longitudinalReference, EPSILON)
    : longitudinalPixels;
  const observedRatio = signedTransversePixels / normalizer;

  let worldRatio = 0;
  let worldFrame = null;
  if (validPoints(worldPoints)) {
    worldFrame = buildWristFrame(worldPoints, physicalHand);
    const worldOrigin = vectorFrom(worldPoints[0]);
    const worldKnuckles = average(worldPoints, [5, 9, 13, 17]);
    const worldLongitudinal = magnitude(subtract(worldKnuckles, worldOrigin));
    const worldTransverse = magnitude(subtract(
      vectorFrom(worldPoints[17]),
      vectorFrom(worldPoints[5])
    ));
    if (worldLongitudinal > EPSILON) {
      worldRatio = clamp(worldTransverse / worldLongitudinal, 0.55, 1.35);
    }
  }

  const absoluteObservedRatio = Math.abs(observedRatio);
  if (!state.referenceRatio) {
    state.referenceRatio = Math.max(absoluteObservedRatio, worldRatio, 0.55);
  } else if (absoluteObservedRatio > state.referenceRatio) {
    // La postura más frontal observada actualiza automáticamente la anchura base.
    state.referenceRatio = absoluteObservedRatio;
  }

  const cosine = clamp(observedRatio / state.referenceRatio, -1, 1);
  const magnitudeRoll = Math.acos(cosine);

  const imageFrame = buildWristFrame(imagePoints, physicalHand);
  const imageMetrics = wristFrameMetrics(imageFrame);
  const worldMetrics = wristFrameMetrics(worldFrame);
  const imageSignal = imageMetrics ? radians(imageMetrics.rollY) : 0;
  const worldSignal = worldMetrics ? radians(worldMetrics.rollY) : 0;
  const depthSignal = Math.abs(imageSignal) > radians(4)
    ? imageSignal
    : worldSignal;
  const roll = selectContinuousRoll(magnitudeRoll, depthSignal, state.angle);
  state.angle = roll;

  const cosineRoll = Math.cos(roll);
  const sineRoll = Math.sin(roll);
  const xAxis = normalize({
    x: xBase.x * cosineRoll - zBase.x * sineRoll,
    y: xBase.y * cosineRoll - zBase.y * sineRoll,
    z: xBase.z * cosineRoll - zBase.z * sineRoll
  });
  const zAxis = normalize({
    x: zBase.x * cosineRoll + xBase.x * sineRoll,
    y: zBase.y * cosineRoll + xBase.y * sineRoll,
    z: zBase.z * cosineRoll + xBase.z * sineRoll
  });
  if (!xAxis || !zAxis) return null;

  return {
    frame: { origin, xAxis, yAxis, zAxis },
    rollDegrees: degrees(roll),
    referenceRatio: state.referenceRatio,
    observedRatio,
    longitudinalReference: state.longitudinalReference,
    depthSignalDegrees: degrees(depthSignal)
  };
}

export function wristFrameMetrics(frame) {
  if (!frame) return null;

  const rotation = degrees(Math.atan2(frame.xAxis.y, frame.xAxis.x));
  const tilt = degrees(Math.acos(clamp(Math.abs(frame.zAxis.z), 0, 1)));
  // Pronación/supinación: giro alrededor del eje longitudinal Y.
  const rollY = degrees(Math.atan2(frame.xAxis.z, -frame.zAxis.z));

  return {
    rotation,
    tilt,
    rollY,
    zDirection: frame.zAxis.z < 0 ? "hacia cámara" : "opuesta a cámara"
  };
}

export function formatFrameVector(vector) {
  if (!vector) return "—";
  return [vector.x, vector.y, vector.z].map((value) => value.toFixed(3)).join(", ");
}
