// lophn-agent/harness/run-loop: core가 runtime의 안전화 요청에 답한다. 알려진 값을 다 알지 못하면 지울 자리를
// 돌려주지 않는다(runtime은 그 글을 보내지 않는다).
import { assert, assertEquals } from "@std/assert";
import { answerRedactRequest } from "./runtime-redaction.ts";

const KNOWN = "violet-harbor-lantern-4821";
const known = (ready: boolean) => ({
  ready,
  match(text: string) {
    const index = text.indexOf(KNOWN);
    return index < 0 ? undefined : { index, length: KNOWN.length };
  },
});

function request(windows: string[]) {
  return { type: "redact_request", request_id: "r", windows };
}

Deno.test("lophn-agent/harness/run-loop#R8: 알려진 값과 credential 형태의 자리를 조각마다 돌려준다", () => {
  const key = "AKIAIOSFODNN7EXAMPLE";
  const answer = answerRedactRequest(
    request([`a ${KNOWN} b ${key}`, "plain"]),
    known(true),
  );
  assert(answer?.ok === true);
  assertEquals(answer.spans[0], [
    { index: 2, length: KNOWN.length },
    { index: 2 + KNOWN.length + 3, length: key.length },
  ]);
  assertEquals(answer.spans[1], []);
});

Deno.test("lophn-agent/harness/run-loop#R8: 알려진 값을 다 알지 못하거나 요청이 올바르지 않으면 안전화를 끝낸 것으로 답하지 않는다", () => {
  assertEquals(
    answerRedactRequest(request(["x"]), known(false)),
    { type: "redact_response", request_id: "r", ok: false },
  );
  assertEquals(
    answerRedactRequest(request(["x"]), undefined),
    { type: "redact_response", request_id: "r", ok: false },
  );
  assertEquals(
    answerRedactRequest({ type: "redact_request" }, known(true)),
    undefined,
  );
  assertEquals(
    answerRedactRequest(request(["x".repeat(32_769)]), known(true)),
    undefined,
  );
});
