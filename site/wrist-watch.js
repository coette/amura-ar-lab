import {
  ACESFilmicToneMapping,
  AmbientLight,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
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

let renderer = null;
let wristRig = null;
let watchModel = null;
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

    // El GLB conserva metros estándar; este nodo lo convierte una sola vez a mm.
    watchModel.scale.setScalar(Number(config.scaleToMillimeters) || 1000);

    const rootNode = watchModel.getObjectByName(config.rootNode);
    const contactNode = watchModel.getObjectByName(config.contactNode);
    contactStatus = rootNode && contactNode
      ? "raíz + fondo encontrados"
      : "fallback al origen del GLB";

    wristRig = new Group();
    wristRig.name = "AMURA_WRIST_RIG_MILLIMETERS";
    wristRig.visible = false;
    wristRig.add(watchModel);
    scene.add(wristRig);

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
  if (!renderer || (nextWidth === viewportWidth && nextHeight === viewportHeight)) {
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
    units: "GLB m → escena mm → perspectiva aproximada",
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

  // La perspectiva usa la focal estimada del vídeo. El navegador no expone
  // intrínsecos completos, por eso el FOV diagonal sigue siendo ajustable.
  const fovYDegrees = Number(options.fovYDegrees) || 50;
  if (Math.abs(camera.fov - fovYDegrees) > 0.01) {
    camera.fov = fovYDegrees;
    camera.updateProjectionMatrix();
  }

  axisX.set(pose.xAxis.x, pose.xAxis.y, pose.xAxis.z).normalize();
  axisY.set(pose.yAxis.x, pose.yAxis.y, pose.yAxis.z).normalize();
  axisZ.set(pose.zAxis.x, pose.zAxis.y, pose.zAxis.z).normalize();
  orientationMatrix.makeBasis(axisX, axisY, axisZ);
  orientationQuaternion.setFromRotationMatrix(orientationMatrix);

  const dialRadians = (Number(tuning.dialDegrees) || 0) * Math.PI / 180;
  dialQuaternion.setFromAxisAngle(axisZ, dialRadians);
  orientationQuaternion.premultiply(dialQuaternion);
  wristRig.quaternion.copy(orientationQuaternion);

  // Todo en milímetros. El offset hacia el codo usa un eje anatómico separado
  // del marco del reloj, de modo que cambiar de mano no invierte la posición.
  const backMm = Number(tuning.offsetMm) || 0;
  const sideMm = Number(tuning.lateralMm) || 0;
  const upMm = Number(tuning.liftMm) || 0;
  const arm = pose.armAxis || pose.yAxis;

  wristRig.position.set(
    pose.positionMm.x - arm.x * backMm + axisX.x * sideMm + axisZ.x * upMm,
    pose.positionMm.y - arm.y * backMm + axisX.y * sideMm + axisZ.y * upMm,
    pose.positionMm.z - arm.z * backMm + axisX.z * sideMm + axisZ.z * upMm
  );

  // El GLB ya está en metros; x1000 lo deja en mm, que es la unidad de escena.
  // No hay factor de tamaño: si el reloj mide 40 mm, mide 40 mm. Se ve mayor
  // o menor porque está más cerca o más lejos, como un objeto de verdad.
  wristRig.scale.setScalar(1);
  wristRig.visible = true;
  lastDepthMm = pose.depthMm;
  lastPalmWidthMm = pose.palmWidthMm;
  lastReprojectionErrorPx = pose.reprojectionErrorPx;
  renderer.render(scene, camera);

  return state(true);
}

export function holdWristWatch() {
  if (!renderer) return state(false);
  renderer.render(scene, camera);
  return state(Boolean(wristRig && wristRig.visible));
}

export function hideWristWatch() {
  if (!renderer) return;
  if (wristRig) wristRig.visible = false;
  renderer.render(scene, camera);
}

// Carga el A1 mientras el usuario concede el permiso de cámara.
loadWatch().catch(() => {});
