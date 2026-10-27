import assert from "node:assert/strict";
import type { ModelCallRequest } from "../../../packages/core/lophn-agent/run-loop/mod.ts";

// 모든 요청에 대해 지키는 불변식이다: tool_use와 tool_result가 짝이고, 다음 요청의 대화는 앞 요청의
// 대화를 접두로 가진다(같은 쪽이 이어 말한 것은 한 message로 합쳐지므로 조각 단위로 본다).

function parts(request: ModelCallRequest): string[] {
  return request.prompt.request.messages.flatMap((message) =>
    message.parts.map((part) => JSON.stringify([message.role, part]))
  );
}

export function assertRequestInvariants(
  requests: readonly ModelCallRequest[],
): void {
  requests.forEach((request, i) => {
    const ids = (kind: string) =>
      request.prompt.request.messages.flatMap((message) =>
        message.parts.flatMap((part) =>
          part.kind === kind && "id" in part ? [part.id] : []
        )
      ).sort();
    assert.deepStrictEqual(
      ids("tool_use"),
      ids("tool_result"),
      `request ${i}: tool_use and tool_result ids do not pair`,
    );
    if (i === 0) return;
    const before = parts(requests[i - 1]);
    assert.ok(
      before.every((part, at) => parts(request)[at] === part),
      `request ${i}: conversation does not extend request ${i - 1}`,
    );
  });
}
