// 설명 준비의 본문 검사(platform/approvals#R1, R2, R14).
// command는 hash만 받으므로 공백·secret 거절은 이 단계에서 한다.

import { assert, assertEquals } from "@std/assert";
import { ok, sha256Hex } from "../../base/mod.ts";
import type { PreparedBlob } from "../../contracts/platform/mod.ts";
import { prepareClosedReason, prepareDescription } from "./work.ts";

const PRINCIPAL = "user-1";

function preparer() {
  return {
    async prepare(text: string, principal: string) {
      const blob: PreparedBlob = {
        preparation: "approval-test",
        principal,
        purpose: "approval_text",
        hash: await sha256Hex(text),
        size_bytes: new TextEncoder().encode(text).length,
      };
      return ok(blob);
    },
  };
}

Deno.test("platform/approvals#R1: 공백뿐인 설명과 secret 모양은 준비하지 않는다", async () => {
  const texts = preparer();
  for (const blank of ["", "   ", "\n\t"]) {
    const prepared = await prepareDescription(texts, blank, PRINCIPAL);
    assert(!prepared.ok);
    if (!prepared.ok) assertEquals(prepared.error.code, "invalid_input");
  }
  const secret = await prepareDescription(
    texts,
    "key sk-abcdefghijklmnopqrstuvwxyz0123456789",
    PRINCIPAL,
  );
  assert(!secret.ok);
  if (!secret.ok) assertEquals(secret.error.code, "invalid_input");
});

Deno.test("platform/approvals#R1 #R2: 있는 설명은 본문 hash와 같은 blob을 준비한다", async () => {
  const text = "원본 blob을 유지하고 sha256으로 검증한다";
  const prepared = await prepareDescription(preparer(), text, PRINCIPAL);
  assert(prepared.ok);
  if (prepared.ok) {
    assertEquals(prepared.value.text, text);
    assertEquals(prepared.value.blob.hash, await sha256Hex(text));
  }
});

Deno.test("platform/approvals#R14: 거절 이유는 없어도 되고 있으면 그대로 준비한다", async () => {
  const texts = preparer();
  const empty = await prepareClosedReason(texts, undefined, PRINCIPAL);
  assert(empty.ok);
  if (empty.ok) assertEquals(empty.value, undefined);
  const reason = "지금은 진행하지 않는다";
  const written = await prepareClosedReason(texts, reason, PRINCIPAL);
  assert(written.ok);
  if (written.ok && written.value !== undefined) {
    assertEquals(written.value.text, reason);
    assertEquals(written.value.blob.hash, await sha256Hex(reason));
  }
});
