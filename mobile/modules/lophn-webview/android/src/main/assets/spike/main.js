import { dep } from "./dep.js";

const out = document.getElementById("out");
const results = { origin: location.origin, href: location.href, dep };
const show = () => (out.textContent = JSON.stringify(results, null, 1));
show();

function settle(promise, ms = 3000) {
  return Promise.race([
    promise.then(() => "loaded", (e) => `refused: ${e?.message ?? e}`),
    new Promise((r) => setTimeout(() => r("timeout"), ms)),
  ]);
}

async function probes() {
  results.css = getComputedStyle(document.querySelector(".probe")).color;
  await document.fonts.load('16px "SpikeMono"');
  results.font = document.fonts.check('16px "SpikeMono"') ? "loaded" : "missing";
  results.fetchOutside = await settle(fetch("https://example.com/"));
  results.fetchHost = await settle(fetch("http://10.0.2.2:7499/"));
  results.websocket = await settle(
    new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket("ws://10.0.2.2:7499/");
        ws.onopen = resolve;
        ws.onerror = () => reject(new Error("ws error"));
      } catch (e) {
        reject(e);
      }
    }),
  );
  const img = document.getElementById("outside");
  results.imageOutside = await settle(
    new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("img error"));
      img.src = "https://example.com/favicon.ico";
    }),
  );
  results.bridge = typeof globalThis.lophnNative;
  results.secureContext = isSecureContext;
  results.subtle = typeof crypto.subtle;
  results.randomUUID = typeof crypto.randomUUID;
  results.localStorage = await settle(Promise.resolve().then(() => localStorage.length));
  const frame = document.createElement("iframe");
  const nocsp = new Promise((resolve) =>
    addEventListener("message", (e) => e.data?.nocsp && resolve(e.data.nocsp)),
  );
  frame.src = "nocsp.html";
  document.body.append(frame);
  results.nocsp = await Promise.race([nocsp, new Promise((r) => setTimeout(() => r("timeout"), 8000))]);
  show();
}

await probes();
if (globalThis.lophnNative) {
  lophnNative.onmessage = (event) => {
    results.fromNative = event.data;
    show();
    lophnNative.postMessage(JSON.stringify({ type: "ack", got: event.data }));
  };
  lophnNative.postMessage(JSON.stringify({ type: "probes", results }));
}
console.log(`probes ${JSON.stringify(results)}`);
