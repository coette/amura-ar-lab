import "./axis-r12-lab.js?v=r12.1";

const LAB_STATE = {
  status: "listo",
  revision: "R12-CAPTURA-FALLOS",
  visible: false,
  depthMm: 0,
  palmWidthMm: 0,
  reprojectionErrorPx: 0,
  contact: "—",
  asset: "sin reloj · R12 captura libre de fallos"
};

export function updateWristWatch() {
  return { ...LAB_STATE };
}

export function holdWristWatch() {
  return { ...LAB_STATE };
}

export function hideWristWatch() {
  return { ...LAB_STATE };
}
