import "./static-bank-player.js?v=r13.5";
import "./axis-r12-bank.js?v=r12bank.1";

const LAB_STATE = {
  status: "listo",
  revision: "R13.1-REPLAY-REAL",
  visible: false,
  depthMm: 0,
  palmWidthMm: 0,
  reprojectionErrorPx: 0,
  contact: "—",
  asset: "sin reloj · R13.1 cámara + banco reprocesado IMAGE"
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
