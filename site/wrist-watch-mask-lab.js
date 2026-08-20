import "./axis-r11-lab.js?v=r11.1";

const LAB_STATE = {
  status: "listo",
  revision: "R11-P0-DIAGNOSTICO",
  visible: false,
  depthMm: 0,
  palmWidthMm: 0,
  reprojectionErrorPx: 0,
  contact: "—",
  asset: "sin reloj · R11 diagnóstico P0"
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
