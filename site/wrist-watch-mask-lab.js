import "./static-bank-player-r16.js?v=r16.1";
import "./axis-r16-live.js?v=r16.1";

const LAB_STATE = {
  status: "listo",
  revision: "R16-OFFICIAL-SECTIONS",
  visible: false,
  depthMm: 0,
  palmWidthMm: 0,
  reprojectionErrorPx: 0,
  contact: "—",
  asset: "sin reloj · R16 verde por secciones + naranja final oficial"
};

export function updateWristWatch() { return { ...LAB_STATE }; }
export function holdWristWatch() { return { ...LAB_STATE }; }
export function hideWristWatch() { return { ...LAB_STATE }; }
