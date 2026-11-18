import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BRIDGE_ENV,
  bridgeEnv,
  isRelayableUrl,
  type LinkPrefs,
  linkTarget,
  MAX_REQUEST_BYTES,
  MAX_URL_CHARS,
  parseBridgeRequest,
} from "./policy.ts";

const KEY = "a".repeat(64);
const req = (o: Record<string, unknown>) => JSON.stringify(o);

test("bridge request line and relayable url", () => {
  const ok = { v: 1, key: KEY, url: "https://example.com/a?b=1" };
  assert.deepEqual(parseBridgeRequest(req(ok)), { key: KEY, url: ok.url });

  const bad: unknown[] = [
    "",
    "not json",
    "null",
    "[]",
    req({ ...ok, v: 2 }),
    req({ ...ok, v: "1" }),
    req({ key: KEY, url: ok.url }),
    req({ ...ok, key: "A".repeat(64) }),
    req({ ...ok, key: "a".repeat(63) }),
    req({ ...ok, key: "a".repeat(65) }),
    req({ ...ok, key: 1 }),
    req({ ...ok, url: "" }),
    req({ ...ok, url: 1 }),
    req({ v: 1, key: KEY }),
    // 8192 byte를 넘는 줄. 글자 수로는 넘지 않는 multibyte도 byte로 센다.
    req({ ...ok, url: "https://example.com/" + "a".repeat(MAX_REQUEST_BYTES) }),
    req({ ...ok, url: "https://example.com/" + "한".repeat(3000) }),
  ];
  for (const line of bad) {
    assert.equal(
      parseBridgeRequest(line as string),
      null,
      String(line).slice(0, 60),
    );
  }

  const urls: [string, boolean][] = [
    ["https://example.com/", true],
    ["http://localhost:3000/x?y#z", true],
    ["http://[::1]:8080/", true],
    ["https://example.com/" + "a".repeat(MAX_URL_CHARS - 20), true],
    ["https://example.com/" + "a".repeat(MAX_URL_CHARS), false],
    ["https://user@example.com/", false],
    ["https://user:pass@example.com/", false],
    ["https://:pass@example.com/", false],
    ["file:///etc/passwd", false],
    ["javascript:alert(1)", false],
    ["data:text/html,<p>x</p>", false],
    ["mailto:a@example.com", false],
    ["about:blank", false],
    ["ftp://example.com/", false],
    ["/relative/path", false],
    ["example.com", false],
    ["//example.com/", false],
    ["", false],
    ["not a url", false],
  ];
  for (const [url, want] of urls) {
    assert.equal(isRelayableUrl(url), want, url.slice(0, 60));
  }
});

test("link target splits local and web hosts", () => {
  const prefs: LinkPrefs = {
    web_links: "system_browser",
    local_links: "browser_tab",
  };
  const local = [
    "http://localhost/",
    "http://LOCALHOST./",
    "http://app.localhost/",
    "http://127.0.0.2/",
    "http://10.1.2.3/",
    "http://192.168.0.5/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://169.254.1.1/",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://nas.local/",
  ];
  const web = [
    "https://example.com/",
    "http://8.8.8.8/",
    "http://172.32.0.1/",
    "http://172.15.0.1/",
    "http://11.0.0.1/",
    "http://[2001:db8::1]/",
    "http://localhost.evil.com/",
    "http://127.0.0.1.evil.com/",
    "http://evil.com/.local",
    "http://notlocal/",
    "http://local.example.com/",
  ];
  for (const url of local) {
    assert.equal(linkTarget(url, prefs), "browser_tab", url);
  }
  for (const url of web) {
    assert.equal(linkTarget(url, prefs), "system_browser", url);
  }
  for (const url of [
    "file:///x",
    "javascript:1",
    "https://u:p@localhost/",
    "/rel",
  ]) {
    assert.equal(linkTarget(url, prefs), null, url);
  }
});

test("bridge env never overrides the user's BROWSER", () => {
  const issued = { shim: "/shim/open", socket: "/s.sock", key: KEY };
  const out = {
    BROWSER: "/shim/open",
    [BRIDGE_ENV]: JSON.stringify({ socket: "/s.sock", key: KEY }),
  };
  assert.deepEqual(bridgeEnv({}, issued), out);
  assert.deepEqual(bridgeEnv({ BROWSER: "" }, issued), out);
  assert.deepEqual(bridgeEnv({ BROWSER: undefined }, issued), out);
  assert.equal(bridgeEnv({ BROWSER: "firefox" }, issued), null);
  // 바깥 lophn이 넣은 shim은 덮는다.
  assert.deepEqual(
    bridgeEnv({ BROWSER: "/outer/open", [BRIDGE_ENV]: "{}" }, issued),
    out,
  );
});
