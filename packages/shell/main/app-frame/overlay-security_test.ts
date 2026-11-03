import assert from "node:assert/strict";
import { test } from "node:test";

import { shellPermission } from "./overlay-security.ts";

test("the default session grants only clipboard write from a main frame shell page", () => {
  const ask = (
    permission: string,
    isMainFrame = true,
    url = "lophn-shell://desktop/index.html",
  ) => shellPermission({ permission, requestingUrl: url, isMainFrame });
  assert.equal(ask("clipboard-sanitized-write"), true);
  assert.equal(
    ask("clipboard-sanitized-write", true, "lophn-shell://overlay/index.html"),
    true,
  );
  assert.equal(ask("clipboard-sanitized-write", false), false);
  for (const url of ["https://a.example/", "file:///x", "lophn-app://a/", ""]) {
    assert.equal(ask("clipboard-sanitized-write", true, url), false, url);
  }
  for (const p of [
    "clipboard-read",
    "media",
    "geolocation",
    "notifications",
    "fullscreen",
    "unknown",
  ]) {
    assert.equal(ask(p), false, p);
  }
});
