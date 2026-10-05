import { createHash } from "node:crypto";
import { canonicalize } from "../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../contracts/platform/mod.ts";

// 세션·메시지 ledger 시험이 함께 쓰는 값과 자격. 제품 코드와 mod.ts는 import하지
// 않는다. 실제 provider를 부르지 않는다.

export const OPERATIONS = [
  "RegisterDefaultPreset",
  "CreateBuiltinAssignment",
  "CreateAppEngineerAssignment",
  "PauseAssignment",
  "ResumeAssignment",
  "WithdrawAssignment",
  "AcceptRun",
  "StartRun",
  "FinishRun",
  "StopRun",
  "ConfirmNextRun",
  "ReadRun",
  "ListRuns",
  "OpenSession",
  "ChangeSessionWorkPlace",
  "CloseSession",
  "ReceiveMessage",
  "ExecuteStoredRequest",
  "RecordMessage",
  "ApplyMessages",
  "AssignMessage",
  "ReadSession",
  "ListSessions",
  "ListMessages",
  "RegisterProvider",
  "StartModelCall",
  "SeedTargetFixture",
  "SeedOperatorFixture",
  "SeedAcceptFailure",
  "CommandResult",
];

export function cred(actor: string): AuthenticatedContext {
  const assignment = actor.startsWith("agent:") ? actor.slice(6) : undefined;
  return {
    actor,
    principal: assignment === undefined ? `${actor}-1` : actor,
    credential_ref: `test:${actor}`,
    scope: {
      operations: OPERATIONS,
      targets: assignment === undefined ? {} : { assignment },
    },
    conditions: assignment === undefined ? {} : { assignment },
  };
}

// agent 자격은 run 하나에 묶여 발급된다(platform/ledger). 시험은 그 run이 생긴 뒤
// 같은 모양의 자격을 harness에 더한다.
export function agentRun(
  assignment: string,
  run: string,
): AuthenticatedContext {
  return {
    actor: `agent:${assignment}`,
    principal: `agent:${assignment}`,
    credential_ref: `test:agent:${assignment}:${run}`,
    scope: { operations: OPERATIONS, targets: { assignment, run } },
    conditions: { assignment, run },
  };
}

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
export function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

export const BODY = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

export function hashOf(definition: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(definition), "utf8").digest(
    "hex",
  );
}
