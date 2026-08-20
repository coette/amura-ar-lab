import "./static-bank-player.js?v=r13.6";
import "./axis-r12-bank.js?v=r12bank.1";

const LAB_STATE = {
  status: "listo",
  revision: "R13.2-CAPTURAS",
  visible: false,
  depthMm: 0,
  palmWidthMm: 0,
  reprojectionErrorPx: 0,
  contact: "—",
  asset: "sin reloj · R13.2 banco real + capturas seleccionables"
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
