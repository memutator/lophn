import assert from "node:assert/strict";
import { test } from "node:test";

import { EXTERNAL_URL_MAX_CHARS } from "../../../protocol/shell/app-bridge-types.ts";
import {
  checkExternalUrl,
  createExternalLinks,
  externalLinkRecord,
} from "./external-link.ts";
import { navigationAllowed } from "./network-policy.ts";
import type { BoundView } from "./registry.ts";
import { appHostLabel } from "./session-policy.ts";

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";

function viewOf(mode: "live" | "preview"): BoundView {
  return {
    view_session: "view-1",
    generation: 1,
    target: {
      app: APP,
      mode,
      release: mode === "live" ? "rel_01j9zzzzzzzzzzzzzzzzzzzzz1" : null,
      screen: "main",
      size: "full",
    },
    binding: {
      endpoint: "/run/app.sock",
      authorization: "signed",
      release: null,
      bundleHash: "1".repeat(64),
      processNonce: "nonce-1",
      expiresAtMs: null,
    },
  };
}

function world(fails = false) {
  const opened: string[] = [];
  const logs: string[] = [];
  const links = createExternalLinks({
    open(url) {
      opened.push(url);
      return fails
        ? Promise.reject(new Error("no browser"))
        : Promise.resolve();
    },
    log: (line) => logs.push(line),
  });
  return { links, opened, logs };
}

function sized(length: number): string {
  const head = "https://example.com/";
  return head + "a".repeat(length - head.length);
}

test("shell/app-frame#R5: 8,193자·다른 scheme·userinfo URL은 아무것도 열지 않고 8,192자 HTTP·HTTPS는 확인 없이 연다", async () => {
  const w = world();
  assert.equal(sized(EXTERNAL_URL_MAX_CHARS).length, 8192);
  for (
    const bad of [
      sized(EXTERNAL_URL_MAX_CHARS + 1),
      "ftp://example.com/a",
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,hi",
      "lophn-app://app-01j9zzzzzzzzzzzzzzzzzzzzzz/main/index.html",
      "lophn-shell://desktop/",
      "https://user@example.com/a",
      "https://user:pass@example.com/a",
      "http://:pass@example.com/a",
      "not a url",
      "",
    ]
  ) {
    assert.equal(checkExternalUrl(bad), undefined, bad.slice(0, 40));
    const result = await w.links.open(viewOf("live"), { url: bad });
    assert.deepEqual(result, {
      ok: false,
      error: { code: "invalid_input", message: "external link is invalid" },
    });
  }
  for (
    const bad of [
      { url: "https://example.com/", confirm: true },
      { href: "https://example.com/" },
      "https://example.com/",
      null,
    ]
  ) {
    assert.equal((await w.links.open(viewOf("live"), bad)).ok, false);
  }
  assert.deepEqual(w.opened, []);

  for (const mode of ["live", "preview"] as const) {
    for (
      const good of [
        sized(EXTERNAL_URL_MAX_CHARS),
        "http://example.com/a",
        "https://example.com:8443/docs?x=1#y",
      ]
    ) {
      assert.deepEqual(await w.links.open(viewOf(mode), { url: good }), {
        ok: true,
        value: null,
      });
    }
  }
  assert.equal(w.opened.length, 6);
  // browser가 열리지 않으면 실패로 알린다.
  const broken = world(true);
  assert.deepEqual(
    await broken.links.open(viewOf("live"), { url: "https://example.com/" }),
    {
      ok: false,
      error: { code: "unavailable", message: "browser did not open" },
    },
  );
});

test("shell/app-frame#R6: OAuth URL을 열어도 기록에는 origin·path만 남고 query·state·fragment는 없으며 view 안에서는 열지 않는다", async () => {
  const w = world();
  const url = "https://accounts.example.com/o/oauth2/auth?client_id=abc" +
    "&state=STATE-SECRET&code_challenge=CHALLENGE#access_token=TOKEN";
  assert.deepEqual(await w.links.open(viewOf("preview"), { url }), {
    ok: true,
    value: null,
  });
  assert.deepEqual(w.opened, [url]);
  assert.deepEqual(externalLinkRecord(url), {
    origin: "https://accounts.example.com",
    path: "/o/oauth2/auth",
  });
  const logged = w.logs.join("\n");
  assert.match(logged, /origin=https:\/\/accounts\.example\.com/);
  assert.match(logged, /path=\/o\/oauth2\/auth/);
  for (const secret of ["STATE-SECRET", "CHALLENGE", "TOKEN", "client_id"]) {
    assert.equal(logged.includes(secret), false, secret);
  }
  // 앱 view의 main frame 탐색은 자기 scheme·screen만 통과한다. 외부 URL은 view 안에서 열리지 않는다.
  const label = appHostLabel(APP);
  assert.equal(navigationAllowed(url, label, "main"), false);
  assert.equal(
    navigationAllowed("http://example.com/a", label, "main"),
    false,
  );
  assert.equal(
    navigationAllowed(`lophn-app://${label}/main/next.html`, label, "main"),
    true,
  );
});
