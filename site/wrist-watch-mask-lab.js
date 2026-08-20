import "./static-bank-player.js?v=r14.1";
import "./axis-r12-bank.js?v=r12bank.1";

const LAB_STATE = {
  status: "listo",
  revision: "R14-PCA-AB",
  visible: false,
  depthMm: 0,
  palmWidthMm: 0,
  reprojectionErrorPx: 0,
  contact: "—",
  asset: "sin reloj · R14 PCA actual vs secciones + referencia manual"
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
