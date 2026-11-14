// Runs in a frame without CSP: shows what shouldInterceptRequest alone blocks.
function settle(promise, ms = 3000) {
  return Promise.race([
    promise.then(() => "loaded", (e) => `refused: ${e?.message ?? e}`),
    new Promise((r) => setTimeout(() => r("timeout"), ms)),
  ]);
}

const results = {
  fetchOutside: await settle(fetch("https://example.com/")),
  fetchHost: await settle(fetch("http://10.0.2.2:7499/")),
  websocket: await settle(
    new Promise((resolve, reject) => {
      const ws = new WebSocket("ws://10.0.2.2:7499/");
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error("ws error"));
    }),
  ),
};
parent.postMessage({ nocsp: results }, "*");
