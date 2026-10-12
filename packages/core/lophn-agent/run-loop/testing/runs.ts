// run 선택·한도 테스트가 함께 쓰는 실제 ledger 도우미. 등록 executor(harness)와 임시
// ledger 파일을 쓴다. harness Worker가 registration_test.ts를 import하므로 이 파일은
// mod.ts와 나누어 둔다(그 graph에 harness를 끌어들이면 Worker가 뜨지 못한다).
import { ok, type Result } from "../../../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../../../protocol/server/mod.ts";
import { envelope } from "./mod.ts";

export { envelope };
import type { CoreRead } from "../startup.ts";

// 도우미가 쓰는 harness의 모양. 실제 harness(packages/core/testing/ledger.ts)는 *_test.ts만
// import하므로 여기서는 이 모양만 요구한다. 여는 곳은 open_test.ts다.
export type LedgerHarness = {
  command(
    ctx: AuthenticatedContext,
    request: ReturnType<typeof envelope>,
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
  probeWrite(
    query: string,
    params?: readonly (string | number)[],
  ): Promise<Result<unknown>>;
  close(): Promise<void>;
};

export const RUN_NOW = Date.UTC(2026, 0, 1);

export const RUN_OPERATIONS = [
  "CreateBuiltinAssignment",
  "SeedAssignmentState",
  "AcceptRun",
  "StartRun",
  "CheckpointRun",
  "FinishRun",
  "StopRun",
  "ConfirmNextRun",
  "ReadRun",
  "ReadAssignment",
  "ListRuns",
  "ListAssignments",
  "ReadRunResult",
  "SeedSteeringFixture",
  "SeedSettingChoice",
  "CommandResult",
];

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
export function runId(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

export const userCredential: AuthenticatedContext = {
  actor: "user",
  principal: "user-1",
  credential_ref: "test:user-1:user",
  scope: { operations: RUN_OPERATIONS, targets: {} },
  conditions: {},
};

export const machineCredential: AuthenticatedContext = {
  actor: "machine",
  principal: "machine-1",
  credential_ref: "test:machine-1:machine",
  scope: { operations: RUN_OPERATIONS, targets: {} },
  conditions: {},
};

export const RUN_BASIS = "b".repeat(64);
export const RUN_RESULT = "c".repeat(64);
export const RUN_LIMITS = {
  model_attempts: 30,
  stall_ms: 300_000,
  active_ms: 1_800_000,
};

export function must<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

// lophn(전역 하나)과 Context Engineer(전역 하나) assignment.
export const ASG_LOPHN = runId("asg", 1);
export const ASG_CE = runId("asg", 2);

export async function seedAssignments(h: LedgerHarness): Promise<void> {
  for (
    const [role, assignment] of [
      ["lophn", ASG_LOPHN],
      ["context_engineer", ASG_CE],
    ] as const
  ) {
    must(
      await h.command(
        machineCredential,
        envelope("CreateBuiltinAssignment", {
          id: assignment,
          role,
          scope: { kind: "all", id: null },
        }),
      ),
    );
  }
}

// assignment를 멈춘 상태로 만든다(registration_test.ts의 SeedAssignmentState).
export async function pauseAssignmentFixture(
  h: LedgerHarness,
  assignment: string,
): Promise<void> {
  must(
    await h.command(
      machineCredential,
      envelope("SeedAssignmentState", { assignment, state: "paused" }),
    ),
  );
}

export type AcceptInput = {
  run: string;
  assignment?: string;
  source: Record<string, unknown>;
  session?: string | null;
  continued_from?: string | null;
  start_after?: string | null;
};

export function acceptRun(h: LedgerHarness, input: AcceptInput) {
  return h.command(
    machineCredential,
    envelope("AcceptRun", {
      id: input.run,
      assignment: input.assignment ?? ASG_LOPHN,
      session: input.session === undefined ? runId("ses", 1) : input.session,
      source: input.source,
      continued_from: input.continued_from ?? null,
      start_after: input.start_after ?? null,
    }, { assignment_revision: 1 }),
  );
}

// 사람이 설정을 apply한 것처럼 공통 선택을 저장한다(다음 run의 한도가 된다).
export async function seedRunLimits(
  h: LedgerHarness,
  limits: typeof RUN_LIMITS,
): Promise<void> {
  for (
    const [key, value] of [
      ["lophn-agent.run.model_attempts", limits.model_attempts],
      ["lophn-agent.run.stall_ms", limits.stall_ms],
      ["lophn-agent.run.active_ms", limits.active_ms],
    ] as const
  ) {
    must(
      await h.command(
        machineCredential,
        envelope("SeedSettingChoice", { key, value }),
      ),
    );
  }
}

export async function readRunRecord(h: LedgerHarness, run: string) {
  const read = must(
    await h.read({ resource: "runs", method: "read" }, userCredential, { run }),
  ) as { run: Record<string, unknown> & { state_seq: string } };
  return read.run;
}

export async function startRunFixture(
  h: LedgerHarness,
  run: string,
  assignment: string,
  limits: typeof RUN_LIMITS = RUN_LIMITS,
) {
  const record = await readRunRecord(h, run);
  return h.command(
    machineCredential,
    envelope("StartRun", {
      run,
      basis: RUN_BASIS,
      limits,
      scope: {
        role: assignment === ASG_LOPHN ? "lophn" : "context_engineer",
        assignment,
        apps: [],
      },
    }, { state_seq: record.state_seq }),
  );
}

export async function finishRunFixture(
  h: LedgerHarness,
  run: string,
  outcome: { kind: string; reason: string },
  result: string = RUN_RESULT,
) {
  const record = await readRunRecord(h, run);
  return h.command(
    machineCredential,
    envelope("FinishRun", { run, outcome, result }, {
      state_seq: record.state_seq,
    }),
  );
}

// core loopback read를 대신하는 함수. 등록 read는 harness 경로로, events/list는 ledger의
// events 표를 읽어 contract 모양으로 돌려준다(harness는 event replay를 지원하지 않는다).
export function ledgerRead(h: LedgerHarness): CoreRead {
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
