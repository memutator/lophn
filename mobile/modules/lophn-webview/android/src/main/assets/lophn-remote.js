// Runs at document start in the remote page (origin rule: https://remote.lophn.invalid only).
// Turns the message port `lophnNative` into `globalThis.lophnRemote`, the desktop `CoreSource` shape.
// Message kinds: mobile/src/webview/bridge.ts.
(() => {
  const native = globalThis.lophnNative;
  if (!native || globalThis.lophnRemote) return;
  let next = 0;
  let last;
  const pending = new Map();
  const states = new Set();
  const events = new Set();
  const post = (message) => native.postMessage(JSON.stringify(message));
  const request = (message) =>
    new Promise((resolve) => {
      const id = String(++next);
      pending.set(id, resolve);
      post({ ...message, id });
    });
  const toBase64 = (bytes) => {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(text);
  };
  const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

  native.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "state") {
      last = message.state;
      for (const listener of states) listener(last);
    } else if (message.type === "event") {
      for (const listener of events) listener(message.message);
    } else if (message.type === "reply") {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message.reply);
    }
  };

  globalThis.lophnRemote = Object.freeze({
    subscribe(listener) {
      states.add(listener);
      if (last) listener(last);
      return () => states.delete(listener);
    },
    current: () => last,
    async call(input) {
      const { bytes, ...call } = input;
      if (bytes) call.base64 = toBase64(bytes);
      const reply = await request({ type: "call", call });
      if (input.kind !== "file" || !reply.ok) return reply;
      const { content_type, base64 } = reply.value;
      return { ok: true, value: { bytes: fromBase64(base64), contentType: content_type } };
    },
    async watch(conditions) {
      const reply = await request({ type: "watch", conditions });
      if (!reply.ok) throw new Error(reply.error?.message ?? "watch failed");
    },
    onEvent(listener) {
      events.add(listener);
      return () => events.delete(listener);
    },
  });
  post({ type: "state" });
})();
