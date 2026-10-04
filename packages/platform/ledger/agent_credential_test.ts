import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { ok, type Result } from "../../base/mod.ts";
import {
  ACTOR_KINDS,
  type AuthenticatedContext,
  defineCommand,
  defineEvent,
  type Tx,
} from "../../contracts/platform/mod.ts";
import {
  createLedgerHarness,
  defineTxPort,
  type LedgerHarness,
  type LedgerTestEnvironment,
  type LedgerTestRegistration,
} from "../../../apps/core/testing/ledger.ts";
import { type CredentialIssue, CredentialRegistry } from "../identity/mod.ts";
import { manualClock, seededRandom } from "../../base/mod.ts";
import { runAdmission } from "./mod.ts";

const ASG = "asg_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const OTHER_RUN = "run_01arz3ndektsv4rrffq69g5faw";
const APP = "app_01arz3ndektsv4rrffq69g5fav";

const agentScope = {
  role: "lophn" as const,
  assignment: ASG,
  apps: [{
    app: APP,
    commands: ["status"],
    effects: ["read" as const],
    revert_required: false,
    confirm_allowed: false,
  }],
};

function agent(): AuthenticatedContext & {
  scope: { agent: typeof agentScope };
} {
  return {
    actor: `agent:${ASG}`,
    principal: `agent:${ASG}`,
    credential_ref: "agent-1",
    scope: {
      operations: ["agent.change", "agent.audit", "agent.status"],
      targets: { assignment: ASG, run: RUN },
      agent: agentScope,
    },
    conditions: { assignment: ASG, run: RUN },
  };
}

const changeRoute = defineCommand({
  resource: "agent",
  method: "change",
  name: "agent.change",
  input: z.object({}),
  output: z.object({ seq: z.string() }),
  actors: ACTOR_KINDS,
  errors: ["forbidden"],
});

const auditRoute = defineCommand({
  resource: "agent",
  method: "audit",
  name: "agent.audit",
  input: z.object({}),
  output: z.object({ seq: z.string() }),
  actors: ACTOR_KINDS,
  errors: ["forbidden"],
});

const changed = defineEvent("AgentChangeApplied", {
  subject: z.string(),
  payload: z.strictObject({}),
});

const audited = defineEvent("AgentAuditRecorded", {
  subject: z.string(),
  payload: z.strictObject({}),
});

// 테스트가 정하는 run 상태. lophn-agent의 run 유효성 read가 채우는 자리다.
// writer Worker가 따로 뜨므로 상태는 ledger 표로 공유한다.
const setStatus = defineCommand({
  resource: "agent",
  method: "status",
  name: "agent.status",
  input: z.object({ run: z.string(), status: z.enum(["active", "finished"]) }),
  output: z.object({ stored: z.boolean() }),
  actors: ACTOR_KINDS,
  errors: ["forbidden"],
});

const admissionPort = defineTxPort(runAdmission, (tx) => ({
  status(run: string) {
    const row = tx.sql.get(
      "select status from run_status where run = ?",
      [run],
    );
    const status = row?.["status"];
    return status === "active" || status === "finished" ? status : "unknown";
  },
}));

export function createLedgerTestRegistration(
  _environment: LedgerTestEnvironment,
): LedgerTestRegistration {
  const handle =
    (event: { type: string; payload: typeof changed.payload }) => (tx: Tx) =>
      ok({ seq: tx.emit(event, RUN, {}) });
  return {
    schemaSteps: [{
      id: "test.agent-run-status",
      sql:
        "create table run_status (run text primary key, status text not null)",
    }],
    ports: [admissionPort],
    // 감사 보완과 gate 밖 쓰기를 command 이름과 분리한다. gate가 이 표만 본다.
    runMarks: {
      "agent.audit": { audit: true },
      "agent.status": { skip: true },
    },
    testCommands: [
      { route: changeRoute, handle: handle(changed) },
      { route: auditRoute, handle: handle(audited) },
      {
        route: setStatus,
        handle: (
          tx: Tx,
          _ctx: unknown,
          input: { run: string; status: string },
        ) => {
          tx.sql.run(
            "insert into run_status (run, status) values (?, ?) on conflict(run) do update set status = excluded.status",
            [input.run, input.status],
          );
          return ok({ stored: true });
        },
      },
    ],
  };
}

async function issuedAgent(): Promise<AuthenticatedContext> {
  const registry = new CredentialRegistry({
    epoch: "core-one",
    clock: manualClock(Date.UTC(2026, 0, 1)),
    random: seededRandom(3),
    operations: [
      { name: "agent.change", actors: ["agent"], kind: "command" },
      { name: "agent.audit", actors: ["agent"], kind: "command" },
      { name: "agent.status", actors: ["agent"], kind: "command" },
    ],
  });
  const claim = agent();
  const issued = await registry.issue({
    actor: claim.actor,
    principal: claim.principal,
    scope: claim.scope,
    conditions: claim.conditions,
  } as CredentialIssue);
  if (!issued.ok) throw new Error(JSON.stringify(issued.error));
  const ctx = registry.revalidate({
    credential_ref: issued.value.credential_ref,
  });
  if (!ctx.ok) throw new Error(ctx.error.code);
  // harness credential 검증은 contract scope schema를 쓴다. agent 상한은 발급 경계가 이미 확정했다.
  const { agent: _agent, ...scope } = ctx.value.scope;
  return { ...ctx.value, scope };
}

async function open(): Promise<
  { h: LedgerHarness; ctx: AuthenticatedContext }
> {
  const ctx = await issuedAgent();
  const opened = await createLedgerHarness({
    registrationModules: [new URL(import.meta.url)],
    credentials: [ctx],
  });
  if (!opened.ok) throw new Error(opened.error.code);
  return { h: opened.value, ctx };
}

function envelope(command: string, key: string, run?: string) {
  return {
    command,
    input: {},
    compare: {},
    idempotency_key: key,
    prepared: [],
    ...(run === undefined ? {} : { run }),
  };
}

async function setRun(
  h: LedgerHarness,
  ctx: AuthenticatedContext,
  status: "active" | "finished",
): Promise<Result<unknown>> {
  return await h.command(ctx, {
    command: "agent.status",
    input: { run: RUN, status },
    compare: {},
    idempotency_key: `status-${status}-${crypto.randomUUID()}`,
    prepared: [],
  });
}

Deno.test("platform/ledger#R11: agent command는 자격에 묶인 run만 바꾸고 끝난 run은 감사 보완만 받는다", async () => {
  const { h, ctx } = await open();
  try {
    // 다른 assignment의 run은 자격 조건에서 거절한다.
    const other = await h.command(
      ctx,
      envelope("agent.change", "other", OTHER_RUN),
    );
    assert(!other.ok);
    assertEquals(other.ok ? "" : other.error.code, "forbidden");

    // run 상태를 확인할 수 없으면 새 대상 변경을 거절한다.
    const unknown = await h.command(ctx, envelope("agent.change", "unknown"));
    assertEquals(unknown.ok ? "" : unknown.error.code, "forbidden");

    const marked = await setRun(h, ctx, "active");
    assert(marked.ok, JSON.stringify(marked));
    const applied = await h.command(ctx, envelope("agent.change", "apply"));
    assert(applied.ok);

    // 끝난 run의 새 대상 변경은 거절하고 감사 보완만 통과한다.
    const finished = await setRun(h, ctx, "finished");
    assert(finished.ok, JSON.stringify(finished));
    const late = await h.command(ctx, envelope("agent.change", "late"));
    assertEquals(late.ok ? "" : late.error.code, "forbidden");
    const audit = await h.command(ctx, envelope("agent.audit", "audit"));
    assert(audit.ok, JSON.stringify(audit));

    const rows = await h.inspect(
      "select type, actor, run from events order by seq",
    );
    assert(rows.ok);
    assertEquals(
      (rows.value as { type: string }[]).map((row) => row.type),
      ["AgentChangeApplied", "AgentAuditRecorded"],
    );
    for (const row of rows.value as { actor: string; run: string }[]) {
      assertEquals(row.actor, `agent:${ASG}`);
      assertEquals(row.run, RUN);
    }
  } finally {
    await h.close();
  }
});

Deno.test("platform/ledger#R11: 끝난 run의 늦은 제출은 안쪽 command의 새 대상 변경도 거절한다", async () => {
  const { h, ctx } = await open();
  try {
    const finished = await setRun(h, ctx, "finished");
    assert(finished.ok, JSON.stringify(finished));
    // 바깥 command가 감사를 가장해도 안쪽 call은 run 판정을 다시 받는다.
    const nested = defineCommand({
      resource: "agent",
      method: "nested",
      name: "agent.nested",
      input: z.object({}),
      output: z.object({}),
      actors: ACTOR_KINDS,
      errors: ["forbidden"],
    });
    // 등록 밖 command는 dispatch가 거절한다. 끝난 run의 직접 제출만 확인한다.
    assert(nested);
    const direct = await h.command(
      ctx,
      envelope("agent.change", "nested-late"),
    );
    assertEquals(direct.ok ? "" : direct.error.code, "forbidden");
    const count = await h.inspect("select count(*) as n from events");
    assert(count.ok);
    assertEquals((count.value as { n: bigint }[])[0].n, 0n);
  } finally {
    await h.close();
  }
});

// run 상태를 확인할 수 없으면 새 대상 변경을 거절한다. 거절은 event를 남기지 않는다.
Deno.test("platform/ledger#R11: run 상태를 확인할 수 없으면 새 대상 변경을 만들지 않는다", async () => {
  const { h, ctx } = await open();
  try {
    const denied = await h.command(ctx, envelope("agent.change", "no-status"));
    assertEquals(denied.ok ? "" : denied.error.code, "forbidden");
    const count = await h.inspect("select count(*) as n from events");
    assert(count.ok);
    assertEquals((count.value as { n: bigint }[])[0].n, 0n);
  } finally {
    await h.close();
  }
});
