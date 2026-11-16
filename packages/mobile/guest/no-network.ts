// A guest has no network modules (the patched sandbox leaves them out), so React Native's own fetch, XMLHttpRequest and
// WebSocket would fail inside a lazy module load, which Metro reports as a fatal error that ends the screen. These fail
// the way a network error does instead. They are only the friendly failure: the boundary is the missing native modules.
// A backend that runs on the phone shares these globals; its computer-only work belongs in an external operation, so
// the error also carries the `unavailable` code the SDK's other computer-only paths give.
const refusal = () =>
  Object.assign(
    new TypeError("Network request failed: an app on the phone has no network. Use the app's operations"),
    { code: "unavailable" },
  );

class NoXMLHttpRequest {
  readyState = 0;
  status = 0;
  onerror: ((event: unknown) => void) | null = null;
  onloadend: ((event: unknown) => void) | null = null;
  open() {}
  setRequestHeader() {}
  abort() {}
  send() {
    setTimeout(() => {
      this.readyState = 4;
      this.onerror?.(refusal());
      this.onloadend?.(refusal());
    }, 0);
  }
}

class NoWebSocket {
  constructor() {
    throw refusal();
  }
}

const globals: Record<string, unknown> = {
  fetch: () => Promise.reject(refusal()),
  XMLHttpRequest: NoXMLHttpRequest,
  WebSocket: NoWebSocket,
};
for (const [name, value] of Object.entries(globals)) {
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}
