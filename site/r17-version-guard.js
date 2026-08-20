// AMURA R17.2 · guardia ligera de versión.
// No toca tracking, nube, geometría ni el algoritmo verde/naranja.

const REV = "R17.2";

async function clearLegacyRuntimeCaches() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (_) {}
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (_) {}
}

function enforceLabels() {
  document.title = `AMURA · AUTORRESCATE · ${REV}`;
  const eyebrow = document.querySelector("#startPanel .eyebrow");
  if (eyebrow) eyebrow.textContent = `LABORATORIO · ${REV}`;
  const title = document.getElementById("cameraTitle");
  if (title) title.textContent = "VERDE / NARANJA + AUTORRESCATE";
  const labTitle = document.querySelector("#maskLabHud .lab-title");
  if (labTitle) labTitle.textContent = `${REV} · MÉTODO OFICIAL + RESCATE`;
}

// Limpieza preventiva una sola vez. Sin observers ni bucles.
clearLegacyRuntimeCaches();
enforceLabels();
window.addEventListener("DOMContentLoaded", enforceLabels, { once: true });
window.addEventListener("pageshow", enforceLabels);

window.AmuraRevisionGuard = { revision: REV, active: true };
