import assert from "node:assert/strict";
import { test } from "node:test";
import { REDACTION_REPLACEMENT } from "../../../base/redaction/mod.ts";
import type { ChildMessage } from "../../../protocol/supervision/mod.ts";
import { createRedactLink } from "./redact-link.ts";

// 이미지가 쌓인 model 요청 body는 수 MB다. 한꺼번에 보내면 감독 pipe의 쓰기 backlog(약 2MB)가 넘쳐
// runtime 전체가 멈췄다.
test("큰 글을 안전화해도 답을 기다리는 요청의 글은 상한을 넘지 않는다", async () => {
  const SECRET = "sk-test-known-value";
  const text = `${"a".repeat(3_000_000)}${SECRET}${"b".repeat(10)}`;
  let waiting = 0;
  let most = 0;
  const link = createRedactLink({
    async send(message: ChildMessage) {
      if (message.type !== "redact_request") return;
      const units = message.windows.reduce((sum, w) => sum + w.length, 0);
      waiting += units;
      most = Math.max(most, waiting);
      setTimeout(() => {
        waiting -= units;
        link.onParent({
          type: "redact_response",
          request_id: message.request_id,
          ok: true,
          spans: message.windows.map((window) => {
            const at = window.indexOf(SECRET);
            return at < 0 ? [] : [{ index: at, length: SECRET.length }];
          }),
        });
      }, 0);
    },
  });

  const safe = await link.redact(text);
  assert.equal(
    safe,
    `${"a".repeat(3_000_000)}${REDACTION_REPLACEMENT}${"b".repeat(10)}`,
  );
  assert.ok(most <= 4 * 32_768, `in flight ${most}`);
});
