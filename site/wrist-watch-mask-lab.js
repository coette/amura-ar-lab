import "./static-bank-player.js?v=r15.2";
import "./axis-r12-bank.js?v=r12bank.1";

const LAB_STATE = {
  status: "listo",
  revision: "R15-FINAL-CHAIN-AB",
  visible: false,
  depthMm: 0,
  palmWidthMm: 0,
  reprojectionErrorPx: 0,
  contact: "—",
  asset: "sin reloj · R15 final actual vs final nuevo"
};

export function updateWristWatch() { return { ...LAB_STATE }; }
export function holdWristWatch() { return { ...LAB_STATE }; }
export function hideWristWatch() { return { ...LAB_STATE }; }
