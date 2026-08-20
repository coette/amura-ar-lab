import "./axis-r10-lab.js?v=r10.1";

const LAB_STATE = {
  status: "listo",
  revision: "R10-EJE-NUBE",
  visible: false,
  depthMm: 0,
  palmWidthMm: 0,
  reprojectionErrorPx: 0,
  contact: "—",
  asset: "sin reloj · R10 eje por nube"
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
