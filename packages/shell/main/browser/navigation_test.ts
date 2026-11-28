import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUILTIN_SEARCH_ENGINES,
  isValidCustomSearchUrl,
  resolveSearchTemplate,
} from "../../../protocol/shell/browser-search.ts";
import { normalizeAddress } from "./address.ts";
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
  [
    "not a url",
    { allow: false, reason: "unparseable" },
    {
      allow: false,
      reason: "unparseable",
    },
  ],
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

const GOOGLE = BUILTIN_SEARCH_ENGINES.google;

test("address bar keeps explicit URLs and dangerous schemes without sending them to search", () => {
  assert.equal(normalizeAddress("   ", { searchUrl: GOOGLE }), null);
  assert.equal(
    normalizeAddress("https://example.com/a?b=1", { searchUrl: GOOGLE }),
    "https://example.com/a?b=1",
  );
  assert.equal(
    normalizeAddress("localhost:3000/api", { searchUrl: GOOGLE }),
    "http://localhost:3000/api",
  );
  assert.equal(
    normalizeAddress("127.0.0.1:8080", { searchUrl: GOOGLE }),
    "http://127.0.0.1:8080",
  );
  assert.equal(
    normalizeAddress("example.com/docs", { searchUrl: GOOGLE }),
    "https://example.com/docs",
  );
  assert.equal(
    normalizeAddress("[::1]:3000", { searchUrl: GOOGLE }),
    "http://[::1]:3000",
  );
  // 위험하거나 내부 scheme은 검색 엔진으로 넘기지 않고 그대로 남겨 decideNavigation이 거절하게 한다.
  for (const raw of [
    "javascript:alert(1)",
    "file:///etc/passwd",
    "data:text/html,<p>x</p>",
    "lophn-shell://desktop",
    "about:blank",
    "mailto:a@example.com",
    "https://user:pass@example.com/",
  ]) {
    assert.equal(normalizeAddress(raw, { searchUrl: GOOGLE }), raw, raw);
  }
});

test("address bar turns non-URL queries into encoded search URLs", () => {
  assert.equal(
    normalizeAddress("hello", { searchUrl: GOOGLE }),
    "https://www.google.com/search?q=hello",
  );
  assert.equal(
    normalizeAddress("react useEffect", { searchUrl: GOOGLE }),
    "https://www.google.com/search?q=react%20useEffect",
  );
  assert.equal(
    normalizeAddress("v1.2.3", { searchUrl: GOOGLE }),
    "https://www.google.com/search?q=v1.2.3",
  );
  assert.equal(
    normalizeAddress("a&b=c $&", {
      searchUrl: BUILTIN_SEARCH_ENGINES.naver,
    }),
    "https://search.naver.com/search.naver?query=a%26b%3Dc%20%24%26",
  );
  // searchUrl이 없으면(webview attach 검사 등) 검색 URL로 바꾸지 않는다.
  assert.equal(normalizeAddress("react useEffect"), null);
});

test("custom search engine template validation and resolution", () => {
  assert.equal(isValidCustomSearchUrl("https://kagi.com/search?q=%s"), true);
  assert.equal(
    isValidCustomSearchUrl("http://localhost:8080/search?q=%s"),
    true,
  );
  assert.equal(isValidCustomSearchUrl("https://kagi.com/search"), false);
  assert.equal(isValidCustomSearchUrl("javascript:%s"), false);
  assert.equal(
    isValidCustomSearchUrl("https://user:pass@kagi.com/search?q=%s"),
    false,
  );

  assert.equal(
    resolveSearchTemplate("duckduckgo", ""),
    BUILTIN_SEARCH_ENGINES.duckduckgo,
  );
  assert.equal(
    resolveSearchTemplate("custom", "https://kagi.com/search?q=%s"),
    "https://kagi.com/search?q=%s",
  );
  assert.equal(resolveSearchTemplate("custom", ""), GOOGLE);
  assert.equal(resolveSearchTemplate("unknown", ""), GOOGLE);
});
