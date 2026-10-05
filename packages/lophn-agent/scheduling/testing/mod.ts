import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalize, formatAt, ok, type Result } from "../../../base/mod.ts";
import {
  ACTOR_KINDS,
  type AuthenticatedContext,
  defineCommand,
  type SqlRow,
} from "../../../contracts/platform/mod.ts";

// 회차 테스트 fixture. 제품 코드와 mod.ts는 import하지 않는다. 실제 provider를
// 부르지 않고 시계는 manual clock이다. harness 모양은 *_test.ts가 연 것을 구조로만 받는다.

export type LedgerHarness = {
  command(
    ctx: AuthenticatedContext,
    request: {
      command: string;
      input: unknown;
      compare: unknown;
      idempotency_key: string;
      prepared: string[];
    },
  ): Promise<Result<unknown>>;
  read(
    route: { resource: string; method: string },
    ctx: AuthenticatedContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  inspect(
    query: string,
    params?: readonly (string | number)[],
  ): Promise<Result<SqlRow[]>>;
  close(): Promise<void>;
};

export const START_MS = Date.UTC(2026, 0, 1);
export const HOUR_MS = 3_600_000;

export const OPERATIONS = [
  "RegisterDefaultPreset",
  "CreateBuiltinAssignment",
  "ApplyOperatorAssignment",
  "PauseAssignment",
  "ResumeAssignment",
  "WithdrawAssignment",
  "AcceptRun",
  "StartRun",
  "FinishRun",
  "StopRun",
  "ProcessAssignmentOccurrence",
  "ListAssignmentOccurrences",
  "ListAssignments",
  "ReadAssignment",
  "ListRuns",
  "ReadRun",
  "SeedApprovalFixture",
  "SetClockFixture",
  "SetRunStateFixture",
  "CommandResult",
];

export const userCredential: AuthenticatedContext = {
  actor: "user",
  principal: "user-1",
  credential_ref: "test:user-1:user",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

export const machineCredential: AuthenticatedContext = {
  actor: "machine",
  principal: "machine-1",
  credential_ref: "test:machine-1:machine",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

export function agentCredential(assignment: string): AuthenticatedContext {
  return {
    actor: `agent:${assignment}`,
    principal: `agent:${assignment}`,
    credential_ref: `test:agent:${assignment}`,
    scope: { operations: OPERATIONS, targets: { assignment } },
    conditions: { assignment },
  };
}

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
export function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

export function hashOf(definition: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(definition), "utf8").digest(
    "hex",
  );
}

export function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

// 시험이 시각을 앞으로 보낸다. 시계는 ledger writer Worker 안에 있어 command로만
// 움직인다. 사람의 설정 변경이 아니라 fixture다.
export const setClockRoute = defineCommand({
  resource: "clock-fixture",
  method: "set",
  name: "SetClockFixture",
  input: z.strictObject({ at: z.string() }),
  output: z.strictObject({ at: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

// approval 표는 platform/approvals 소유다. ApplyOperatorAssignment가 읽는 id·status만 같은
// 모양으로 심는 fixture command다.
export const seedApprovalRoute = defineCommand({
  resource: "approval-fixture",
  method: "seed",
  name: "SeedApprovalFixture",
  input: z.strictObject({ id: z.string(), status: z.string() }),
  output: z.strictObject({ id: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

// 질문·approval 대기(WaitRun)는 waiting-and-recovery 소유라 아직 이 ledger에 없다. 대기
// 중인 run은 같은 열의 값(waiting_user와 waiting_on)을 직접 놓는 fixture로 만든다.
export const setRunStateRoute = defineCommand({
  resource: "run-state-fixture",
  method: "set",
  name: "SetRunStateFixture",
  input: z.strictObject({
    run: z.string(),
    state: z.enum(["running", "waiting_user"]),
  }),
  output: z.strictObject({ run: z.string() }),
  compare: z.strictObject({}),
  actors: ACTOR_KINDS,
  errors: ["conflict"],
});

export const APPROVAL_FIXTURE_SQL =
  "create table approval_requests (id text primary key, status text not null)";

export function atOf(ms: number): string {
  return formatAt(ms);
}

// core loopback read를 대신하는 함수. 등록 read는 harness 경로로, events/list는 ledger의
// events 표를 읽어 contract 모양으로 돌려준다(harness는 event replay를 지원하지 않는다).
export function ledgerRead(
  h: LedgerHarness,
): (path: string, body: unknown) => Promise<Result<unknown>> {
  return async (path, body) => {
    const [, , resource, method] = path.split("/");
    if (resource === "events" && method === "list") {
      const input = body as { after_seq: string; types?: string[] };
      const rows = must(
        await h.inspect(
          "select seq, type, subject, actor, run, payload, at from events where seq > ? order by seq",
          [Number(input.after_seq)],
        ),
      );
      const head = must(
        await h.inspect("select coalesce(max(seq), 0) as head from events", []),
      )[0]!["head"];
      const events = rows
        .filter((row) =>
          input.types === undefined || input.types.includes(String(row["type"]))
        )
        .map((row) => ({
          seq: String(row["seq"]),
          type: String(row["type"]),
          subject: row["subject"] === null ? null : String(row["subject"]),
          actor: String(row["actor"]),
          run: row["run"] === null ? null : String(row["run"]),
          payload: JSON.parse(String(row["payload"])),
          at: String(row["at"]),
        }));
      return ok({
        events,
        scanned_through_seq: String(head),
        head_seq: String(head),
        as_of_seq: String(head),
        next_cursor: null,
      });
    }
    return await h.read(
      { resource: resource!, method: method! },
      userCredential,
      body,
    );
  };
}
