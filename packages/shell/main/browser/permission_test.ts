import assert from "node:assert/strict";
import { test } from "node:test";

import { decidePermission } from "./permission.ts";

test("only clipboard write from a main frame http(s) page is granted", () => {
  const ask = (
    permission: string,
    isMainFrame = true,
    url = "https://a.example/",
  ) => decidePermission({ permission, requestingUrl: url, isMainFrame });
  assert.equal(ask("clipboard-sanitized-write"), true);
  assert.equal(ask("clipboard-sanitized-write", false), false);
  assert.equal(ask("clipboard-sanitized-write", true, "file:///x"), false);
  for (
    const p of [
      "clipboard-read",
      "media",
      "geolocation",
      "notifications",
      "midi",
      "fullscreen",
      "unknown",
    ]
  ) {
    assert.equal(ask(p), false, p);
  }
});
