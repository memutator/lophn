// 사람이 확인해야 하는 앱 command(confirm)의 approval request 규칙(platform/approvals#R8).
// concern은 `apps/invocations`, command는 접수 command `invocation.accept_confirm`이다. 그 접수와
// approval 사용은 `apply_approved_action`이 한 transaction에서 확정한다(소유 command를 부르고 그
// event를 receipt로 `Tx.useApproval`). 그래서 action의 input은 접수 command의 입력 그대로다.
//
// 요청 생성 때 고정하는 것:
// - 요청자는 실제 호출 주체다. 사람의 결정(허락·거절)은 별도 command·event이므로 요청자와 섞이지 않는다.
// - 대상은 정확한 앱과 release, 입력은 접수 입력 전체(앱·release·command·입력 지문·approval id·
//   key·process nonce·caller)다. release나 입력 한 값이 바뀌면 같은 action이 아니라 새 request다.
// - input에 이 request의 id가 들어 있어 한 approval은 한 호출에만 묶인다. agent의 사전 질문과 앱의
//   confirm이 겹쳐도 같은 approval id를 쓰는 한 approval_uses PK가 한 번만 소비한다.
// handler가 동기이므로 지문은 동기 hash로 확인한다.
import { createHash } from "node:crypto";
import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import {
  type ApprovalAction,
  approvalBinding,
  type Tx,
} from "../../protocol/server/mod.ts";
import {
  type InvocationAcceptConfirmInput,
  invocationAcceptConfirmInputSchema,
} from "../../protocol/apps/mod.ts";

export const CONFIRM_CONCERN = "apps/invocations";
// 소유 command route 이름 그대로다(contracts/apps/invocations.ts).
export const CONFIRM_COMMAND = "invocation.accept_confirm";

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// 접수 입력의 caller가 요청자(인증된 실제 주체)와 같은 종류·같은 주체여야 한다.
// 사람이 확인하는 호출의 caller는 사람 직접·다른 앱·agent뿐이다(domain model invocation.accept_confirm).
function callerMatches(
  caller: InvocationAcceptConfirmInput["caller"],
  requester: string,
): boolean {
  switch (caller.kind) {
    case "direct":
      return requester === "user";
    case "app":
      return requester === `app:${caller.app}`;
    case "agent":
      return requester.startsWith("agent:");
    default:
      return false;
  }
}

// confirm action이면 R8의 고정 규칙을 확인한다. confirm이 아닌 action은 건드리지 않는다.
export function checkConfirmAction(
  approval: string,
  requester: string,
  action: ApprovalAction,
): Result<void> {
  if (action.command !== CONFIRM_COMMAND) return ok(undefined);
  if (action.concern !== CONFIRM_CONCERN) {
    return invalid("confirm 접수 command는 apps/invocations의 동작이다");
  }
  if (action.input.kind !== "inline") {
    return invalid("confirm 입력은 접수 입력 전체여야 한다");
  }
  const parsed = invocationAcceptConfirmInputSchema.safeParse(
    action.input.value,
  );
  if (!parsed.success) {
    return invalid("confirm 입력이 접수 입력 schema와 다르다");
  }
  const accept = parsed.data;
  if (accept.approval !== approval) {
    return invalid("confirm 입력의 approval이 이 request와 다르다");
  }
  if (
    action.targets.length !== 2 || action.targets[0] !== accept.app ||
    action.targets[1] !== accept.release
  ) {
    return invalid("confirm 대상은 정확한 앱과 release여야 한다");
  }
  if (action.comparison["release"] !== accept.release) {
    return invalid("confirm 비교 기준은 정확한 release를 포함해야 한다");
  }
  // 요청자와 호출 주체는 같다. 사람의 결정자와 섞지 않고 원래 요청자를 그대로 남긴다.
  if (action.caller !== requester || !callerMatches(accept.caller, requester)) {
    return invalid("confirm 요청자는 실제 호출 주체여야 한다");
  }
  if (action.input_hash !== sha256(action.input.value)) {
    return invalid("입력 지문이 confirm 입력과 다르다");
  }
  if (action.binding_hash !== sha256(approvalBinding(action))) {
    return invalid("binding 지문이 action 내용과 다르다");
  }
  return ok(undefined);
}

// 같은 호출은 approval id만 다른 접수 입력과 같은 호출 주체다. approval id를 뺀 정규 입력으로 비교한다.
function callOf(action: ApprovalAction): string | undefined {
  if (action.input.kind !== "inline") return undefined;
  const { approval: _approval, ...rest } = action.input.value;
  return canonicalize({ caller: action.caller, accept: rest });
}

// 같은 호출을 위해 이미 대기 중이거나 허락된 request가 있으면 그 approval id를 돌려준다.
// agent의 사전 질문과 앱의 confirm이 겹쳐도 한 호출에는 approval 하나만 있고, 둘 다 그 approval을 쓰므로
// 한 번만 소비된다(R8). 거절·만료·취소된 request는 새 결정을 막지 않는다.
export function overlappingConfirm(
  tx: Pick<Tx, "sql">,
  approval: string,
  action: ApprovalAction,
): string | undefined {
  if (action.command !== CONFIRM_COMMAND) return undefined;
  const call = callOf(action);
  if (call === undefined) return undefined;
  const rows = tx.sql.all(
    `select id, action from approval_requests
      where status in ('pending', 'granted')
        and json_extract(action, '$.command') = ?
      order by created_seq`,
    [CONFIRM_COMMAND],
  );
  for (const row of rows) {
    if (String(row["id"]) === approval) continue;
    try {
      if (callOf(JSON.parse(String(row["action"]))) === call) {
        return String(row["id"]);
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

// confirm request의 action을 만든다. 요청자(agent의 tool 판정·앱 runtime의 caller 확인)가 쓴다.
// caller는 요청자 자신이어야 하고 지문은 위 검사와 같은 규칙으로 정한다.
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
