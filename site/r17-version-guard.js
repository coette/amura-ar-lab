// AMURA R17.2 · guardia de versión visual + limpieza preventiva de cachés históricas.
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
  const lead = document.getElementById("statusMessage");
  if (lead && document.body.dataset.status === "idle") {
    lead.textContent = "Mismo método oficial verde/naranja, ahora con recuperación automática si la nube se pierde.";
  }
  const labTitle = document.querySelector("#maskLabHud .lab-title");
  if (labTitle) labTitle.textContent = `${REV} · MÉTODO OFICIAL + RESCATE`;
  const hint = document.getElementById("maskHint");
  if (hint && /^R16 OFICIAL/.test(hint.textContent || "")) {
    hint.textContent = `${REV} · VERDE: eje por secciones · NARANJA: final 5 cortes / 4 centros`;
  }
  const bankHeader = document.querySelector("#r16Hud > div:first-child");
  if (bankHeader) bankHeader.textContent = `${REV} · MÉTODO OFICIAL VERDE/NARANJA`;
}

clearLegacyRuntimeCaches();
enforceLabels();

const observer = new MutationObserver(enforceLabels);
observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
window.addEventListener("DOMContentLoaded", enforceLabels, { once: true });
window.addEventListener("pageshow", enforceLabels);

window.AmuraRevisionGuard = { revision: REV, active: true };
