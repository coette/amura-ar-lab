import "./static-bank-player-r16.js?v=r16.1";
import "./r16-bank-fix.js?v=r16.1";
import "./axis-r16-live.js?v=r16.1";
import "./r17-auto-rescue.js?v=r17.1";

const LAB_STATE = {
  status: "listo",
  revision: "R17-AUTO-RESCUE",
  visible: false,
  depthMm: 0,
  palmWidthMm: 0,
  reprojectionErrorPx: 0,
  contact: "—",
  asset: "sin reloj · R16 verde/naranja + R17 autorescate"
};

export function updateWristWatch() { return { ...LAB_STATE }; }
export function holdWristWatch() { return { ...LAB_STATE }; }
export function hideWristWatch() { return { ...LAB_STATE }; }
