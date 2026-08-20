import "./mask-10s-lab.js?v=measure.1";
import "./axis-p0-stable-lab.js?v=axisstable.2";
import "./mask-photo-share.js?v=share.1";
import "./mask-state-compat.js?v=axis.1";

const LAB_STATE = {
  status: "listo",
  revision: "MASK-LAB",
  visible: false,
  depthMm: 0,
  palmWidthMm: 0,
  reprojectionErrorPx: 0,
  contact: "—",
  asset: "sin reloj · laboratorio máscara"
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
