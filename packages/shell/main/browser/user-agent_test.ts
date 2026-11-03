import assert from "node:assert/strict";
import { test } from "node:test";

import { browserUserAgent } from "./user-agent.ts";

// 순수 Chrome UA로 만들면 Google 로그인이 막힌다. 두 번 거꾸로 고친 자리다.
test("UA에서 Electron token만 빠지고 앱 이름 token은 남는다", () => {
  assert.equal(
    browserUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) lophn/0.17.0 Chrome/152.0.7977.130 Electron/44.5.1 Safari/537.36",
    ),
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) lophn/0.17.0 Chrome/152.0.7977.130 Safari/537.36",
  );
});
