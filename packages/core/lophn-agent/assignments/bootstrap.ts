// 내장 assignment 준비(lophn-agent/assignments#R2). 새 데이터 root에는 거두지 않은 lophn과
// Context Engineer 전역 assignment가 각각 하나 있어야 한다. 만드는 command
// (CreateBuiltinAssignment)는 machine 전용이고 부르는 자리가 core 기동뿐이라 여기서 한다.
// 이미 있으면 아무것도 보내지 않으므로 재시작은 중복을 만들지 않는다.
import { err, type IdSource, ok, type Result } from "../../../base/mod.ts";
import {
  assignmentList,
  createBuiltinAssignment,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  AuthenticatedContext,
  ReadRoute,
} from "../../../protocol/server/mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";

export const BOOTSTRAP_PRINCIPAL = "machine:lophn-agent-bootstrap";
// 준비하지 못했을 때 core가 한 번 다시 시도하기까지의 대기.
export const BOOTSTRAP_RETRY_MS = 60_000;

const BUILTIN_ROLES = ["lophn", "context_engineer"] as const;

export type BootstrapDeps = {
  // 등록된 command 이름. lophn-agent 팀이 조립에 없으면 아무것도 하지 않는다.
  commands: ReadonlySet<string>;
  writer: Writer;
  record(context: AuthenticatedContext): Promise<Result<void>>;
  read(
    route: Pick<ReadRoute, "resource" | "method">,
    ctx: AuthenticatedContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  ids: IdSource;
};

const OPERATIONS = [createBuiltinAssignment.name, assignmentList.name];

function context(): AuthenticatedContext {
  return {
    principal: BOOTSTRAP_PRINCIPAL,
    actor: "machine",
    scope: { operations: OPERATIONS, targets: {} },
    conditions: {},
    credential_ref: BOOTSTRAP_PRINCIPAL,
  };
}

function failed(message: string): Result<never> {
  return err({ code: "unavailable", message });
}

export async function bootstrapBuiltinAssignments(
  deps: BootstrapDeps,
): Promise<Result<void>> {
  if (!deps.commands.has(createBuiltinAssignment.name)) return ok(undefined);
  const ctx = context();
  const recorded = await deps.record(ctx);
  if (!recorded.ok) return recorded;
  for (const role of BUILTIN_ROLES) {
    const assignments = await deps.read(assignmentList, ctx, { role });
    if (!assignments.ok) return assignments;
    const existing = (assignments.value as { assignments?: unknown[] })
      .assignments;
    if (existing === undefined) return failed("assignment 목록을 읽지 못했다");
    if (existing.length > 0) continue;
    const created = await deps.writer.command(ctx, {
      command: createBuiltinAssignment.name,
      input: {
        id: deps.ids.newId("asg"),
        role,
        scope: { kind: "all", id: null },
      },
      compare: {},
      idempotency_key: `bootstrap:assignment:${role}`,
      prepared: [],
    });
    if (!created.ok) return created;
  }
  return ok(undefined);
}

// 준비 실패의 diagnostics 기록(platform/diagnostics). 기동을 막지 않으므로 기록 실패도
// 삼킨다. 경로·원문·hash는 넣지 않고 고정 문장과 오류 코드만 남긴다.
export async function noteBootstrapFailure(
  dataRoot: string,
  at: string,
  code: string,
): Promise<void> {
  try {
    const directory = `${dataRoot}/logs`;
    try {
      await Deno.mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    await Deno.writeTextFile(
      `${directory}/bootstrap.jsonl`,
      JSON.stringify({
        at,
        component: "platform/core",
        kind: "log",
        code: "lophn_internal",
        error_type: "lophn_agent_bootstrap",
        location: "packages/core/lophn-agent/assignments/bootstrap.ts",
        message: "Builtin assignment bootstrap did not finish.",
        error_code: code,
      }) + "\n",
      { append: true },
    );
  } catch {
    // 기록하지 못해도 core는 그대로 선다.
  }
}
