// Probes what the native view allows. Results go to logcat (tag LophnWebView) as `probes {...}`.
document.addEventListener("click", (e) => console.log(`click ${e.target.id}`), true);
import { dep } from "./dep.js";

const out = document.getElementById("out");
const results = { origin: location.origin, dep };
const show = () => (out.textContent = JSON.stringify(results, null, 1));
show();

function settle(promise, ms = 3000) {
  return Promise.race([
    promise.then(() => "loaded", (e) => `refused: ${e?.message ?? e}`),
    new Promise((r) => setTimeout(() => r("timeout"), ms)),
  ]);
}

const socket = (url) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("ws error"));
  });

results.css = getComputedStyle(document.querySelector(".probe")).color;
await document.fonts.load('16px "TestMono"');
results.font = document.fonts.check('16px "TestMono"') ? "loaded" : "missing";
results.fetchOutside = await settle(fetch("https://example.com/"));
results.fetchHost = await settle(fetch("http://10.0.2.2:7499/"));
results.fetchSelf = await settle(fetch("dep.js"));
results.ws = await settle(socket("ws://10.0.2.2:7499/"));
results.wss = await settle(socket("wss://example.com/"));
const img = document.getElementById("outside");
results.imageOutside = await settle(
  new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("img error"));
    img.src = "https://example.com/favicon.ico";
  }),
);
results.escape = await settle(import("./%2e%2e/secret.js"));
results.escapeEncoded = await settle(import("./..%2Fsecret.js"));
results.symlink = await settle(import("./link.js"));
results.serviceWorker = await settle(navigator.serviceWorker?.register("sw.js") ?? Promise.reject(new Error("no serviceWorker")));
results.geolocation = await settle(
  new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new Error(e.message)))),
);
results.camera = await settle(navigator.mediaDevices?.getUserMedia({ video: true }) ?? Promise.reject(new Error("no mediaDevices")));
results.randomUUID = typeof crypto.randomUUID;
results.localStorage = await settle(Promise.resolve().then(() => localStorage.setItem("k", "v")));
const before = location.href;
window.open("https://example.com/");
location.href = "https://example.com/";
await new Promise((r) => setTimeout(r, 1000));
results.navigationStayed = location.href === before;

const remote = globalThis.lophnRemote;
results.bridge = typeof remote;
if (remote) {
  results.state = await new Promise((resolve) => remote.subscribe(resolve));
  const events = [];
  remote.onEvent((message) => events.push(message.kind));
  results.call = await remote.call({ kind: "read", resource: "echo", method: "test", body: { x: 1 } });
  const file = await remote.call({ kind: "file", resource: "echo", method: "file", body: {} });
  results.file = { contentType: file.value.contentType, text: new TextDecoder().decode(file.value.bytes) };
  const upload = await remote.call({ kind: "upload", resource: "echo", method: "upload", body: {}, bytes: new TextEncoder().encode("hi") });
  results.upload = upload.value;
  results.watch = await settle(remote.watch([{ session: "s1" }]));
  lophnNative.postMessage(JSON.stringify({ type: "open", url: "https://example.com/" }));
  await new Promise((r) => setTimeout(r, 300));
  results.events = events;
}
show();
console.log(`probes ${JSON.stringify(results)}`);
