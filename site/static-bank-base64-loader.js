// GitHub connector stored the JPEG payloads as base64 text. Convert transparently for the bank player.
const TARGET_ID = "r13BankImage";
let converting = false;

async function convertIfNeeded(img) {
  if (!img || converting) return;
  const src = img.getAttribute("src") || "";
  if (!src || src.startsWith("data:image/")) return;
  if (!src.includes("/test-bank/2026-08-20-banco-base/") || !src.includes(".jpg")) return;

  converting = true;
  try {
    const response = await fetch(src, { cache: "no-store" });
    if (!response.ok) throw new Error(`Banco HTTP ${response.status}`);
    const payload = (await response.text()).replace(/\s+/g, "");
    if (!payload.startsWith("/9j/")) throw new Error("Payload JPEG del banco no reconocido");
    img.src = `data:image/jpeg;base64,${payload}`;
  } catch (error) {
    console.error("R13 · no se pudo decodificar la foto del banco", error);
  } finally {
    converting = false;
  }
}

function install() {
  const root = document.documentElement;
  const observer = new MutationObserver(() => {
    const img = document.getElementById(TARGET_ID);
    if (img) convertIfNeeded(img);
  });
  observer.observe(root, { subtree:true, childList:true, attributes:true, attributeFilter:["src"] });
  const img = document.getElementById(TARGET_ID);
  if (img) convertIfNeeded(img);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once:true });
else install();
