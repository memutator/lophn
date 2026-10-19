import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ArtifactNavigation,
  decideArtifactNavigation,
} from "./navigation.ts";

const HOST = "a-0123456789abcdef01234567";
const ALLOW: ArtifactNavigation = { allow: true };
const BLOCK: ArtifactNavigation = { allow: false };
const EXTERNAL: ArtifactNavigation = { allow: false, external: true };

// [url, main frame, subframe]
const rows: [string, ArtifactNavigation, ArtifactNavigation][] = [
  [`lophn-artifact://${HOST}/index.html`, ALLOW, ALLOW],
  [`lophn-artifact://${HOST}/sub/page.html?x=1#y`, ALLOW, ALLOW],
  ["lophn-artifact://a-ffffffffffffffffffffffff/index.html", BLOCK, BLOCK],
  ["https://example.com/", EXTERNAL, BLOCK],
  ["http://localhost:3000/", EXTERNAL, BLOCK],
  ["file:///etc/passwd", BLOCK, BLOCK],
  ["lophn-shell://desktop/index.html", BLOCK, BLOCK],
  ["lophn-app://x/index.html", BLOCK, BLOCK],
  ["data:text/html,<p>x</p>", BLOCK, BLOCK],
  ["blob:https://example.com/1234", BLOCK, BLOCK],
  ["javascript:alert(1)", BLOCK, BLOCK],
  ["about:blank", BLOCK, BLOCK],
  ["mailto:a@example.com", BLOCK, BLOCK],
  ["slack://channel?id=1", BLOCK, BLOCK],
  ["not a url", BLOCK, BLOCK],
];

test("artifact navigation rules per frame", () => {
  for (const [url, main, sub] of rows) {
    assert.deepEqual(
      decideArtifactNavigation({ url, isMainFrame: true, host: HOST }),
      main,
      `main ${url}`,
    );
    assert.deepEqual(
      decideArtifactNavigation({ url, isMainFrame: false, host: HOST }),
      sub,
      `sub ${url}`,
    );
  }
});
