import assert from "node:assert/strict";
import { test } from "node:test";

import {
  decideShellNavigation,
  type ShellNavigation,
} from "./navigation-guard.ts";

const ALLOW: ShellNavigation = { allow: true };
const BLOCK: ShellNavigation = { allow: false };
const EXTERNAL: ShellNavigation = { allow: false, external: true };

// [url, main frame]
const rows: [string, ShellNavigation][] = [
  ["lophn-shell://desktop/index.html", ALLOW],
  [
    "lophn-shell://desktop/index.html?mock#project=prj_0123456789abcdefghijklmnop",
    ALLOW,
  ],
  ["https://example.com/a?b#c", EXTERNAL],
  ["http://localhost:3000/", EXTERNAL],
  ["lophn-shell://overlay/index.html", BLOCK],
  ["lophn-app://x/index.html", BLOCK],
  ["lophn-artifact://a-0123456789abcdef01234567/index.html", BLOCK],
  ["file:///etc/passwd", BLOCK],
  ["data:text/html,<p>x</p>", BLOCK],
  ["blob:https://example.com/1", BLOCK],
  ["javascript:alert(1)", BLOCK],
  ["about:blank", BLOCK],
  ["mailto:a@example.com", BLOCK],
  ["not a url", BLOCK],
];

test("shell 창의 main frame은 lophn-shell://desktop 밖으로 가지 않고 http·https는 open-external로 넘긴다", () => {
  for (const [url, expected] of rows) {
    assert.deepEqual(
      decideShellNavigation({ url, isMainFrame: true }),
      expected,
      `main ${url}`,
    );
  }
  // subframe은 정하지 않는다(늘 allow). 편집기의 pdf `<embed>`가 안쪽 frame을 쓴다.
  assert.deepEqual(
    decideShellNavigation({ url: "https://example.com/", isMainFrame: false }),
    ALLOW,
  );
});
