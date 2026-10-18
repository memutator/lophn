import assert from "node:assert/strict";
import { test } from "node:test";

import { decideNavigation, type NavigationDecision } from "./navigation.ts";

const ALLOW: NavigationDecision = { allow: true };
const SCHEME: NavigationDecision = { allow: false, reason: "scheme" };
const EXTERNAL: NavigationDecision = {
  allow: false,
  reason: "scheme",
  external: true,
};
const CREDENTIALS: NavigationDecision = { allow: false, reason: "credentials" };

// [url, main frame, subframe]
const rows: [string, NavigationDecision, NavigationDecision][] = [
  ["https://example.com/a?b=1#c", ALLOW, ALLOW],
  ["http://localhost:3000/", ALLOW, ALLOW],
  ["http://127.0.0.1:8080/", ALLOW, ALLOW],
  ["http://192.168.0.5/", ALLOW, ALLOW],
  ["http://10.0.0.1/", ALLOW, ALLOW],
  ["https://user:pass@example.com/", CREDENTIALS, ALLOW],
  ["about:blank", ALLOW, ALLOW],
  ["about:srcdoc", SCHEME, ALLOW],
  ["data:text/html,<p>x</p>", SCHEME, ALLOW],
  ["blob:https://example.com/1234", SCHEME, ALLOW],
  ["mailto:a@example.com", EXTERNAL, SCHEME],
  ["tel:+821012345678", EXTERNAL, SCHEME],
  ["file:///etc/passwd", SCHEME, SCHEME],
  ["lophn-shell://x", SCHEME, SCHEME],
  ["lophn-app://x/index.html", SCHEME, SCHEME],
  ["chrome://settings", SCHEME, SCHEME],
  ["devtools://devtools/bundled/x.html", SCHEME, SCHEME],
  ["javascript:alert(1)", SCHEME, SCHEME],
  ["slack://channel?id=1", SCHEME, SCHEME],
  ["not a url", { allow: false, reason: "unparseable" }, {
    allow: false,
    reason: "unparseable",
  }],
];

test("navigation rules per frame", () => {
  for (const [url, main, sub] of rows) {
    assert.deepEqual(
      decideNavigation({ url, isMainFrame: true }),
      main,
      `main ${url}`,
    );
    assert.deepEqual(
      decideNavigation({ url, isMainFrame: false }),
      sub,
      `sub ${url}`,
    );
  }
});
