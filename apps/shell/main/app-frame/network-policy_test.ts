import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appContentSecurityPolicy,
  grantedUrl,
  isLoopback,
  navigationAllowed,
  requestAllowed,
} from "./network-policy.ts";

const LABEL = "app-01j9zzzzzzzzzzzzzzzzzzzzzz";
const HOSTS = [{ host: "api.example.com", port: 443 }, {
  host: "127.0.0.1",
  port: 8443,
}];

function allowed(
  url: string,
  kind: "mainFrame" | "subFrame" | "other" = "other",
  platformPorts: number[] = [],
) {
  return requestAllowed({
    url,
    kind,
    appLabel: LABEL,
    hosts: HOSTS,
    platformPorts,
  });
}

test("shell/app-frame#R2, shell/app-frame#R16: 자기 scheme과 부여한 fetch host만 통과하고 나머지 network는 기본 차단한다", () => {
  assert.equal(allowed(`lophn-app://${LABEL}/main/app.js`), true);
  assert.equal(allowed("https://api.example.com/v1/items"), true);
  assert.equal(allowed("https://API.example.com:443/v1"), true);
  assert.equal(allowed("wss://api.example.com/stream"), true);
  for (
    const url of [
      "https://evil.example.com/",
      "https://api.example.com:8443/",
      "http://api.example.com/",
      "ws://api.example.com/",
      "https://user:pass@api.example.com/",
      "file:///etc/passwd",
      "lophn-app://app-01j9yyyyyyyyyyyyyyyyyyyyyy/main/index.html",
      `lophn-app://${LABEL}:99/main/index.html`,
      "lophn-shell://desktop/index.html",
      "lophn-document://ver-01j9zzzzzzzzzzzzzzzzzzzzzz/a.html",
      "http://127.0.0.1:7431/v1/apps/connect",
      "chrome://settings",
      "not a url",
    ]
  ) {
    assert.equal(allowed(url), false, url);
  }
});

test("shell/app-frame#R16: port·WebSocket·subframe·redirect target에도 같은 host 판정을 쓴다", () => {
  // redirect는 Chromium이 새 URL로 같은 판정을 다시 부른다. 판정 함수가 하나다.
  assert.equal(allowed("https://api.example.com:444/", "other"), false);
  assert.equal(allowed("wss://api.example.com:444/", "other"), false);
  assert.equal(allowed("https://api.example.com/embed", "subFrame"), true);
  assert.equal(allowed("https://evil.example.com/embed", "subFrame"), false);
  assert.equal(allowed("data:text/html,<p>x</p>", "subFrame"), false);
  assert.equal(allowed("data:image/png;base64,AAAA", "other"), true);
  assert.equal(allowed("blob:lophn-app://x/abc", "other"), true);
});

test("shell/app-frame#R4: main frame은 자기 앱 주소로만 가고 외부 문서를 view 안에서 열지 않는다", () => {
  assert.equal(
    allowed(`lophn-app://${LABEL}/main/index.html`, "mainFrame"),
    true,
  );
  assert.equal(allowed("https://api.example.com/", "mainFrame"), false);
  assert.equal(
    navigationAllowed(`lophn-app://${LABEL}/main/next.html`, LABEL, "main"),
    true,
  );
  for (
    const url of [
      `lophn-app://${LABEL}/other/index.html`,
      "https://api.example.com/",
      "lophn-app://app-01j9yyyyyyyyyyyyyyyyyyyyyy/main/index.html",
      "file:///tmp/a.html",
    ]
  ) {
    assert.equal(navigationAllowed(url, LABEL, "main"), false, url);
  }
});

test("shell/app-frame#R16: 플랫폼 port의 loopback은 부여돼 있어도 막고 임의 loopback도 막는다", () => {
  assert.equal(allowed("https://127.0.0.1:8443/", "other", []), true);
  assert.equal(allowed("https://127.0.0.1:8443/", "other", [8443]), false);
  assert.equal(allowed("https://127.0.0.1:7431/", "other", []), false);
  assert.equal(allowed("https://localhost:8443/", "other", []), false);
  assert.equal(isLoopback("[::1]"), true);
  assert.equal(isLoopback("127.10.0.1"), true);
  assert.equal(isLoopback("example.com"), false);
  assert.equal(
    grantedUrl(new URL("https://[::1]:9000/"), [{ host: "::1", port: 9000 }], [
      9000,
    ]),
    false,
  );
});

test("shell/app-frame#R16: 앱 응답 CSP는 자기 자원과 부여한 host만 연결로 연다", () => {
  const csp = appContentSecurityPolicy(HOSTS);
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(
    csp,
    /connect-src 'self' https:\/\/127\.0\.0\.1:8443 https:\/\/api\.example\.com:443 wss:\/\/127\.0\.0\.1:8443 wss:\/\/api\.example\.com:443/,
  );
  assert.match(appContentSecurityPolicy([]), /connect-src 'self';/);
});
