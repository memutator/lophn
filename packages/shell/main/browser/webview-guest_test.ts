import assert from "node:assert/strict";
import { test } from "node:test";

import { BROWSER_PARTITION } from "./session.ts";
import { hardenWebviewAttach } from "./webview-guest.ts";

const BASE = { sandbox: true, contextIsolation: true, nodeIntegration: false };

function attach(
  params: Record<string, string>,
  fromShell = true,
  webPreferences: Record<string, unknown> = {
    preload: "file:///tmp/evil.js",
    nodeIntegration: true,
    sandbox: false,
  },
) {
  const allowed = hardenWebviewAttach({
    fromShell,
    webPreferences,
    params,
    base: BASE,
  });
  return { allowed, webPreferences, params };
}

test("webview attach takes only our partition from the shell and hardens it", () => {
  assert.equal(
    attach({ partition: BROWSER_PARTITION, src: "https://a.example/" }, false)
      .allowed,
    false,
  );
  assert.equal(attach({ partition: "persist:evil" }).allowed, false);
  assert.equal(attach({ src: "https://a.example/" }).allowed, false);

  const ok = attach({
    partition: BROWSER_PARTITION,
    src: "https://a.example/",
    preload: "file:///tmp/evil.js",
    webpreferences: "nodeIntegration=yes",
    disablewebsecurity: "on",
  });
  assert.equal(ok.allowed, true);
  assert.deepEqual(ok.webPreferences, {
    ...BASE,
    partition: BROWSER_PARTITION,
    disablePopups: false,
  });
  assert.equal(ok.params.preload, undefined);
  assert.equal(ok.params.webpreferences, undefined);
  assert.equal(ok.params.disablewebsecurity, undefined);
  assert.equal(ok.params.src, "https://a.example/");

  for (const src of [
    "file:///etc/passwd",
    "lophn-app://x/index.html",
    "javascript:alert(1)",
    "data:text/html,<p>x</p>",
  ]) {
    assert.equal(
      attach({ partition: BROWSER_PARTITION, src }).params.src,
      "about:blank",
      src,
    );
  }
});
