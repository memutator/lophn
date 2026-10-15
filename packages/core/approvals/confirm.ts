// 앱 command의 확인 request를 만드는 옛 action. 이 흐름을 쓰는 앱 쪽(app-calls-invocations)이 걷으면
// 이 file도 지운다.
import { createHash } from "node:crypto";
import { canonicalize } from "../../base/mod.ts";
import {
  type ApprovalAction,
  approvalBinding,
} from "../../protocol/approvals/mod.ts";
import type { InvocationAcceptConfirmInput } from "../../protocol/apps/mod.ts";

export const CONFIRM_CONCERN = "apps/invocations";
// 소유 command route 이름 그대로다(contracts/apps/invocations.ts).
export const CONFIRM_COMMAND = "invocation.accept_confirm";

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

export function confirmAction(
  requester: ApprovalAction["caller"],
  accept: InvocationAcceptConfirmInput,
): ApprovalAction {
  const base = {
    concern: CONFIRM_CONCERN,
    command: CONFIRM_COMMAND,
    caller: requester,
    targets: [accept.app, accept.release],
    input: { kind: "inline" as const, value: accept },
    input_hash: sha256(accept),
    comparison: { release: accept.release },
  };
  // binding은 binding_hash를 뺀 여섯 값의 지문이다. 아직 없는 그 값은 읽히지 않는다.
  const binding = approvalBinding({ ...base, binding_hash: "" });
  return { ...base, binding_hash: sha256(binding) };
}
