import type { Result } from "../../../base/mod.ts";
import type { InvocationAcceptConfirmInput } from "../../../protocol/apps/mod.ts";
import type { JsonObject } from "../../../protocol/base/mod.ts";

// 소유 계약이 말하는 되돌림. 계약이 모르면 unknown이고 보장 없음으로 취급한다.
export type Reversibility = "reversible" | "irreversible" | "unknown";

// 소유 계약이 입력에서 읽은 정확한 동작. 모르거나 읽지 못하면 err이고 deny다.
export type ResolvedAction = {
  concern: string;
  // 소유 command 이름. approval의 동작 이름과 같다.
  operation: string;
  contractRevision: string;
  targets: readonly { id: string; reversibility: Reversibility }[];
  // 쓰기 계약이 요구하는 정확한 대상 CAS.
  comparison: JsonObject;
  // approval 화면의 변경·되돌림 설명. 실행기가 해석한 값이고 model의 말이 아니다.
  changes: string;
  external: string | null;
  reversibility: string;
  // 사람이 확인해야 하는 앱 command(confirm)의 접수 입력에서 approval ID를 뺀 값이다. 있으면 approval
  // request의 동작이 접수 command(`invocation.accept_confirm`) 자체라서, agent의 사전 질문과 앱의
  // confirm이 같은 approval 하나다.
  confirm?: Omit<InvocationAcceptConfirmInput, "approval">;
};

export type CallRef = { run: string; toolCall: string };

export type ToolBinding = {
  // 현재 사실로 소유 계약의 동작을 읽는다. 읽지 못하거나 정의가 만들어진 계약과 달라졌으면 err이고
  // 호출은 deny다.
  resolve(
    input: unknown,
    call: CallRef,
  ): Result<ResolvedAction> | Promise<Result<ResolvedAction>>;
};

export type CallRequest = {
  toolCall: string;
  run: string;
  tool: string;
  input: unknown;
  // ToolCall의 현재 state_seq. 호출자가 기록한 판을 그대로 넘긴다.
  stateSeq: string;
};

export type Admission =
  | { kind: "enter"; approval: string | null }
  | { kind: "waiting"; approval: string }
  | { kind: "rejected"; approval: string }
  | { kind: "ended"; approval: string; status: string }
  | { kind: "used"; approval: string }
  | { kind: "changed" }
  | { kind: "denied"; reason: string };
