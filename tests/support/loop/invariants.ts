import assert from "node:assert/strict";
import type { ModelCallRequest } from "../../../packages/core/lophn-agent/run-loop/mod.ts";
import { OMITTED_RESULT } from "../../../packages/core/lophn-agent/run-loop/history.ts";

// 모든 요청에 대해 지키는 불변식이다: tool_use와 tool_result가 짝이고, 다음 요청의 대화는 앞 요청의
// 대화를 접두로 가진다(같은 쪽이 이어 말한 것은 한 message로 합쳐지므로 조각 단위로 본다). 앞부분을 바꿔도
// 되는 것은 context에 맞추려고 오래된 tool 결과 본문을 고정 문장으로 바꾼 것뿐이다.

function parts(request: ModelCallRequest): string[] {
  return request.prompt.request.messages.flatMap((message) =>
    message.parts.map((part) => JSON.stringify([message.role, part])),
  );
}

function sameOrOmitted(before: string, after: string | undefined): boolean {
  if (after === undefined) return false;
  if (before === after) return true;
  const [role, part] = JSON.parse(after) as [string, Record<string, unknown>];
  const [oldRole, oldPart] = JSON.parse(before) as [
    string,
    Record<string, unknown>,
  ];
  return (
    part.kind === "tool_result" &&
    part.text === OMITTED_RESULT &&
    oldPart.kind === "tool_result" &&
    oldPart.id === part.id &&
    role === oldRole
  );
}

export function assertRequestInvariants(
  requests: readonly ModelCallRequest[],
): void {
  requests.forEach((request, i) => {
    const ids = (kind: string) =>
      request.prompt.request.messages
        .flatMap((message) =>
          message.parts.flatMap((part) =>
            part.kind === kind && "id" in part ? [part.id] : [],
          ),
        )
        .sort();
    assert.deepStrictEqual(
      ids("tool_use"),
      ids("tool_result"),
      `request ${i}: tool_use and tool_result ids do not pair`,
    );
    if (i === 0) return;
    const before = parts(requests[i - 1]);
    const after = parts(request);
    assert.ok(
      before.every((part, at) => sameOrOmitted(part, after[at])),
      `request ${i}: conversation does not extend request ${i - 1}`,
    );
  });
}
