import {
  ACESFilmicToneMapping,
  AmbientLight,
  AxesHelper,
  CapsuleGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  REVISION,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer
} from "./vendor/three/three.module.js";
import { GLTFLoader } from "./vendor/three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "./vendor/three/addons/loaders/DRACOLoader.js";
import { tuning } from "./tuner.js?v=11.2";

const MODEL_URL = "./models/A1-Irontide-AR-pretty-mobile.glb";
const MODEL_CONFIG_URL = "./models/A1-Irontide-AR-pretty-mobile.json";
const MODEL_Z_OFFSET_RADIANS = 0;
const MODEL_X_OFFSET_RADIANS = Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const DIRECT_P0_TEST_MODE = true;

const DEFAULT_MODEL_CONFIG = {
  asset: "A1-Irontide-AR-pretty-mobile.glb",
  scaleToMillimeters: 1000,
  rootNode: "AMURA_AR_ROOT",
  contactNode: "AMURA_CASEBACK_CONTACT"
};

const canvas = document.getElementById("threeCanvas");
const scene = new Scene();
const camera = new PerspectiveCamera(50, 1, 1, 20000);
const orientationMatrix = new Matrix4();
const orientationQuaternion = new Quaternion();
const dialQuaternion = new Quaternion();
const axisX = new Vector3();
const axisY = new Vector3();
const axisZ = new Vector3();
const wristSurfaceOffset = new Vector3();
const rotatedContactOffset = new Vector3();
const contactWorldPosition = new Vector3();
const wristLocalQuaternion = new Quaternion();
const wristSurfacePoint = new Vector3();

let renderer = null;
let wristRig = null;
let watchAnchor = null;
let watchModel = null;
let wristOccluder = null;
let wristOccluderMaterial = null;
let calibrationAxes = null;
let contactOffsetInAnchor = new Vector3();
let occluderModeApplied = -1;
let modelStatus = "en espera";
let modelError = "";
let modelPromise = null;
let viewportWidth = 0;
let viewportHeight = 0;
let initializationError = "";
let lastDepthMm = 0;
let lastPalmWidthMm = 0;
let lastReprojectionErrorPx = 0;
let modelConfig = DEFAULT_MODEL_CONFIG;
let contactStatus = "sin comprobar";

camera.position.set(0, 0, 0);
camera.lookAt(0, 0, -1);
scene.background = null;

scene.add(new HemisphereLight(0xe8efff, 0x24182f, 2.25));
scene.add(new AmbientLight(0xffffff, 0.85));

const keyLight = new DirectionalLight(0xffffff, 3.2);
keyLight.position.set(-280, 420, 780);
scene.add(keyLight);

const rimLight = new DirectionalLight(0xa992ff, 1.8);
rimLight.position.set(420, -160, 520);
scene.add(rimLight);

async function loadModelConfig() {
  try {
    const response = await fetch(MODEL_CONFIG_URL);
    if (!response.ok) throw new Error("HTTP " + response.status);
    const loaded = await response.json();
    modelConfig = Object.assign({}, DEFAULT_MODEL_CONFIG, loaded);
  } catch (error) {
    console.warn("Se utilizará la configuración AR integrada.", error);
    modelConfig = DEFAULT_MODEL_CONFIG;
  }
  return modelConfig;
}

function createWristOccluder() {
  if (!wristRig || wristOccluder) return wristOccluder;

  const geometry = new CapsuleGeometry(1, 2, 8, 20);
  wristOccluderMaterial = new MeshBasicMaterial({
    color: 0x8d6cff,
    transparent: true,
    opacity: 0.30,
    depthTest: true,
    depthWrite: false
  });

  wristOccluder = new Mesh(geometry, wristOccluderMaterial);
  wristOccluder.name = "AMURA_PROCEDURAL_WRIST_OCCLUDER";
  wristOccluder.renderOrder = -1000;
  wristOccluder.visible = false;
  wristRig.add(wristOccluder);

  // Tríada única del sistema:
  // +X = 9→3 · +Y = 6→12 · +Z = esfera→cristal.
  calibrationAxes = new AxesHelper(38);
  calibrationAxes.name = "AMURA_COMMON_XYZ_TRIAD";
  calibrationAxes.visible = false;
  calibrationAxes.renderOrder = 5000;
  if (calibrationAxes.material) {
    calibrationAxes.material.depthTest = false;
    calibrationAxes.material.transparent = true;
    calibrationAxes.material.opacity = 0.98;
  }
  wristRig.add(calibrationAxes);

  return wristOccluder;
}

function updateVirtualWristAndWatch() {
  if (!wristOccluder || !wristOccluderMaterial) return;

  const width = Math.max(1, Number(tuning.occluderWidthMm) || 62);
  const thickness = Math.max(1, Number(tuning.occluderThicknessMm) || 44);
  const length = Math.max(1, Number(tuning.occluderLengthMm) || 150);
  const mode = Math.max(
    0,
    Math.min(3, Math.round(Number(tuning.occluderMode) || 0))
  );

  wristOccluder.visible = mode !== 0;
  if (mode !== occluderModeApplied) {
    if (mode === 1) {
      // TRANSPARENTE: sirve para comprobar el volumen sin ocultar el reloj.
      wristOccluderMaterial.colorWrite = true;
      wristOccluderMaterial.transparent = true;
      wristOccluderMaterial.opacity = 0.30;
      wristOccluderMaterial.depthWrite = false;
    } else if (mode === 2) {
      // SÓLIDA: muestra claramente la geometría virtual de la muñeca.
      wristOccluderMaterial.colorWrite = true;
      wristOccluderMaterial.transparent = false;
      wristOccluderMaterial.opacity = 1;
      wristOccluderMaterial.depthWrite = true;
    } else if (mode === 3) {
      // OCLUSIÓN: no pinta color, solo profundidad para tapar el GLB.
      wristOccluderMaterial.colorWrite = false;
      wristOccluderMaterial.transparent = false;
      wristOccluderMaterial.opacity = 1;
      wristOccluderMaterial.depthWrite = true;
    }

    wristOccluderMaterial.depthTest = true;
    wristOccluderMaterial.needsUpdate = true;
    occluderModeApplied = mode;
  }

  // AR-02 · MUÑECA
  // El rig sigue siendo exactamente el de AR-01: origen=P0 y misma tríada.
  // La cápsula NO tiene pose independiente. Su centro baja medio grosor en -Z,
  // de modo que su punto más alto (+Z) toca exactamente el origen de la tríada,
  // que es también AMURA_CASEBACK_CONTACT.
  if (DIRECT_P0_TEST_MODE) {
    wristOccluder.scale.set(width / 2, length / 4, thickness / 2);
    wristOccluder.position.set(0, 0, -thickness / 2);
    wristOccluder.rotation.set(0, 0, Math.PI / 2);

    // El reloj conserva íntegra la referencia estable AR-01.
    if (watchAnchor && watchModel) {
      watchAnchor.quaternion.identity();
      watchAnchor.position.copy(contactOffsetInAnchor).multiplyScalar(-1);
      watchModel.visible = Boolean(Number(tuning.watchVisible));
    }

    if (calibrationAxes) {
      const triadMode = Math.max(
        0,
        Math.min(2, Math.round(Number(tuning.triadMode) || 0))
      );
      calibrationAxes.visible = triadMode !== 0;
      calibrationAxes.position.set(0, 0, 0);
      calibrationAxes.quaternion.identity();
    }
    return;
  }

  // Ruta antigua conservada fuera de AR-02 por compatibilidad.
  wristOccluder.scale.set(width / 2, length / 4, thickness / 2);
  wristOccluder.position.set(
    Number(tuning.occluderXmm) || 0,
    Number(tuning.occluderYmm) || 0,
    Number(tuning.occluderZmm) || 0
  );
  wristOccluder.rotation.set(
    (Number(tuning.occluderRotX) || 0) * DEG_TO_RAD,
    (Number(tuning.occluderRotY) || 0) * DEG_TO_RAD,
    (Number(tuning.occluderRotZ) || 0) * DEG_TO_RAD
  );

  wristLocalQuaternion.copy(wristOccluder.quaternion);

  wristSurfaceOffset
    .set(0, 0, thickness / 2)
    .applyQuaternion(wristLocalQuaternion);

  wristSurfacePoint
    .copy(wristOccluder.position)
    .add(wristSurfaceOffset);

  if (watchAnchor && watchModel) {
    watchAnchor.quaternion.copy(wristLocalQuaternion);

    rotatedContactOffset
      .copy(contactOffsetInAnchor)
      .applyQuaternion(wristLocalQuaternion);

    watchAnchor.position
      .copy(wristSurfacePoint)
      .sub(rotatedContactOffset);

    watchModel.visible = Boolean(Number(tuning.watchVisible));
  }

  if (calibrationAxes) {
    const triadMode = Math.max(
      0,
      Math.min(2, Math.round(Number(tuning.triadMode) || 0))
    );

    calibrationAxes.visible = triadMode !== 0;
    calibrationAxes.quaternion.copy(wristLocalQuaternion);

    if (triadMode === 1) {
      calibrationAxes.position.copy(wristOccluder.position);
    } else if (triadMode === 2) {
      calibrationAxes.position.copy(wristSurfacePoint);
    }
  }
}

function loadWatch() {
  if (watchModel) return Promise.resolve(watchModel);
  if (modelPromise) return modelPromise;

  modelStatus = "cargando";

  const loader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("./vendor/three/draco/");
  dracoLoader.setDecoderConfig({ type: "wasm" });
  loader.setDRACOLoader(dracoLoader);

  modelPromise = Promise.all([
    loadModelConfig(),
    loader.loadAsync(MODEL_URL)
  ]).then(([config, gltf]) => {
    watchModel = gltf.scene;
    watchModel.name = "A1_IRONTIDE_AR_PRETTY_METERS";

    watchModel.scale.setScalar(Number(config.scaleToMillimeters) || 1000);

    // El GLB ya no necesita el antiguo +90° en Z. La única corrección de esta
    // prueba es 180° alrededor de X (eje longitudinal 9→3) para que +Z quede
    // físicamente en el sentido palma→dorso sin mover P0 ni alterar la escala.
    watchModel.rotateZ(MODEL_Z_OFFSET_RADIANS);
    watchModel.rotateX(MODEL_X_OFFSET_RADIANS);

    const rootNode = watchModel.getObjectByName(config.rootNode);
    const contactNode = watchModel.getObjectByName(config.contactNode);

    wristRig = new Group();
    wristRig.name = "AMURA_WRIST_RIG_MILLIMETERS";
    wristRig.visible = false;

    watchAnchor = new Group();
    watchAnchor.name = "AMURA_WATCH_ON_WRIST_ANCHOR";
    watchAnchor.add(watchModel);
    wristRig.add(watchAnchor);
    scene.add(wristRig);

    createWristOccluder();

    wristRig.updateMatrixWorld(true);
    if (contactNode) {
      contactNode.getWorldPosition(contactWorldPosition);
      contactOffsetInAnchor = watchAnchor.worldToLocal(
        contactWorldPosition.clone()
      );
    } else {
      contactOffsetInAnchor.set(0, 0, 0);
    }

    contactStatus = rootNode && contactNode
      ? (DIRECT_P0_TEST_MODE ? "AMURA_CASEBACK_CONTACT = P0" : "fondo → superficie muñeca · automático")
      : "fallback al origen del GLB · automático";

    updateVirtualWristAndWatch();
    modelStatus = "listo";
    dracoLoader.dispose();
    return watchModel;
  }).catch((error) => {
    modelStatus = "error";
    modelError = error && error.message
      ? error.message
      : "No se ha podido cargar A1-Irontide-AR-pretty-mobile.glb";
    console.error("No se ha podido cargar el reloj AR optimizado.", error);
    throw error;
  });

  return modelPromise;
}

function ensureRenderer(width, height) {
  if (renderer) {
    resizeRenderer(width, height);
    return true;
  }
  if (initializationError || !canvas) return false;

  try {
    renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      premultipliedAlpha: true
    });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    resizeRenderer(width, height);
    loadWatch().catch(() => {});
    return true;
  } catch (error) {
    initializationError = error && error.message
      ? error.message
      : "WebGL no disponible";
    console.error("No se ha podido iniciar Three.js.", error);
    return false;
  }
}

function resizeRenderer(width, height) {
  const nextWidth = Math.max(1, Math.round(width));
  const nextHeight = Math.max(1, Math.round(height));

  if (
    !renderer ||
    (nextWidth === viewportWidth && nextHeight === viewportHeight)
  ) {
    return;
  }

  viewportWidth = nextWidth;
  viewportHeight = nextHeight;
  renderer.setSize(viewportWidth, viewportHeight, false);
  camera.aspect = viewportWidth / viewportHeight;
  camera.updateProjectionMatrix();
}

function state(visible) {
  return {
    status: initializationError ? "error" : modelStatus,
    visible,
    depthMm: lastDepthMm,
    palmWidthMm: lastPalmWidthMm,
    reprojectionErrorPx: lastReprojectionErrorPx,
    revision: REVISION,
    asset: modelConfig.asset || DEFAULT_MODEL_CONFIG.asset,
    contact: contactStatus,
    units: DIRECT_P0_TEST_MODE ? "AR-02 · P0 + muñeca virtual" : "GLB m → escena mm → muñeca virtual",
    error: initializationError || modelError
  };
}

export function updateWristWatch(options) {
  const width = Number(options && options.viewportWidth) || 0;
  const height = Number(options && options.viewportHeight) || 0;
  const pose = options && options.pose;

  if (!width || !height || !pose) return holdWristWatch();
  if (!ensureRenderer(width, height)) return state(false);

  if (!wristRig) {
    renderer.render(scene, camera);
    return state(false);
  }

  const fovYDegrees = Number(options.fovYDegrees) || 50;
  if (Math.abs(camera.fov - fovYDegrees) > 0.01) {
    camera.fov = fovYDegrees;
    camera.updateProjectionMatrix();
  }

  const calibrationPaused = Boolean(window.AmuraWristCalibrationPaused);

  // En pausa se congela la pose completa del rig. El loop continúa y solo
  // re-renderiza los cambios manuales de la muñeca virtual sobre la foto fija.
  if (!calibrationPaused) {
    axisX.set(pose.xAxis.x, pose.xAxis.y, pose.xAxis.z).normalize();
    axisY.set(pose.yAxis.x, pose.yAxis.y, pose.yAxis.z).normalize();
    axisZ.set(pose.zAxis.x, pose.zAxis.y, pose.zAxis.z).normalize();

    orientationMatrix.makeBasis(axisX, axisY, axisZ);
    orientationQuaternion.setFromRotationMatrix(orientationMatrix);

    const dialRadians = (Number(tuning.dialDegrees) || 0) * DEG_TO_RAD;
    dialQuaternion.setFromAxisAngle(axisZ, dialRadians);
    orientationQuaternion.premultiply(dialQuaternion);
    wristRig.quaternion.copy(orientationQuaternion);

    if (DIRECT_P0_TEST_MODE) {
      // P0 manda la posición completa del origen. Ningún offset de muñeca,
      // fondo o calibración puede separarlo del landmark dorado.
      wristRig.position.set(
        pose.positionMm.x,
        pose.positionMm.y,
        pose.positionMm.z
      );
    } else {
      const backMm = Number(tuning.offsetMm) || 0;
      const sideMm = Number(tuning.lateralMm) || 0;
      const upMm = Number(tuning.liftMm) || 0;
      const arm = pose.armAxis || pose.yAxis;

      wristRig.position.set(
        pose.positionMm.x - arm.x * backMm + axisX.x * sideMm + axisZ.x * upMm,
        pose.positionMm.y - arm.y * backMm + axisX.y * sideMm + axisZ.y * upMm,
        pose.positionMm.z - arm.z * backMm + axisX.z * sideMm + axisZ.z * upMm
      );
    }

    lastDepthMm = pose.depthMm;
    lastPalmWidthMm = pose.palmWidthMm;
    lastReprojectionErrorPx = pose.reprojectionErrorPx;
  }

  wristRig.scale.setScalar(1);
  wristRig.visible = true;
  updateVirtualWristAndWatch();
  renderer.render(scene, camera);

  return state(true);
}

export function holdWristWatch() {
  if (!renderer) return state(false);
  updateVirtualWristAndWatch();
  renderer.render(scene, camera);
  return state(Boolean(wristRig && wristRig.visible));
}

export function hideWristWatch() {
  if (!renderer) return;
  if (wristRig) wristRig.visible = false;
  renderer.render(scene, camera);
}

loadWatch().catch(() => {});
