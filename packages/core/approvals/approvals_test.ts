import { assert, assertEquals } from "@std/assert";
import {
  createIdSource,
  err,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import type { BusEvent } from "../../protocol/events/mod.ts";
import type {
  AgentGrant,
  Intent,
  PendingApproval,
} from "../../protocol/approvals/mod.ts";
import type { RequestContext } from "../../protocol/server/mod.ts";
import { applyMigrations } from "../storage/migration/mod.ts";
import {
  LEDGER_SCHEMA_STEPS,
  openConnection,
  openLedger,
} from "../storage/ledger/mod.ts";
import {
  type ApprovalLedger,
  createApprovalLedger,
  createApprovals,
  createSessionAllowances,
  gate,
} from "./mod.ts";
import {
  cancelPendingForCommand,
  createPendingCommand,
  decideCommand,
  recordAppliedCommand,
} from "./commands.ts";
import { approvalsUnappliedRead } from "./reads.ts";
import { APPROVAL_SCHEMA_STEPS } from "./schema.ts";

const APP = "app_0000000000000000000000000a";
const REL = "rel_0000000000000000000000000a";
const NEWER = "rel_0000000000000000000000000b";
const AGENT = { role: "lophn" } as const;
const SES = "ses_0000000000000000000000000a";
const OTHER_SES = "ses_0000000000000000000000000b";

const context = (actor: string): RequestContext => ({
  principal: actor,
  actor: actor as RequestContext["actor"],
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: actor,
});

function externalCall(session: string, input = {}): Intent {
  return {
    kind: "app_api",
    actor: { kind: "agent", agent: AGENT, session },
    target: { kind: "app_api", app: APP, api: "mail.send" },
    effect: "external",
    input,
    origin: {
      kind: "turn",
      session,
      turn: "trn_0000000000000000000000000a",
      tool_call: "tcl_0000000000000000000000000a",
    },
  };
}

function activation(release: string): Intent {
  return {
    kind: "activation",
    actor: { kind: "program", seq: "1" },
    target: { kind: "activation", app: APP, release },
    effect: "read",
    input: {
      previous_release: null,
      first: true,
      added_resources: [],
      added_app_apis: [],
      loss_steps: [],
    },
    origin: { kind: "activation", app: APP, release },
  };
}

async function withApprovals(
  body: (kit: ReturnType<typeof makeKit>) => Promise<void>,
) {
  const dir = await Deno.makeTempDir({ prefix: "approvals-" });
  const path = `${dir}/core.sqlite`;
  const clock = manualClock(Date.UTC(2026, 0, 1));
  try {
    const migrated = await applyMigrations(path, [
      ...LEDGER_SCHEMA_STEPS,
      ...APPROVAL_SCHEMA_STEPS,
    ], { clock });
    assert(migrated.ok);
    const side = openConnection(path);
    assert(side.ok);
    const ids = createIdSource({ clock, random: seededRandom(1) });
    const opened = openLedger(path, {
      clock,
      ids,
      registerBlobRef: () => err({ code: "unavailable", message: "unused" }),
      call: () => err({ code: "unavailable", message: "unused" }),
    });
    assert(opened.ok);
    try {
      await body(makeKit(opened.value, side.value, clock, ids));
    } finally {
      opened.value.close();
      side.value.close();
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

type Ledger = Extract<ReturnType<typeof openLedger>, { ok: true }>["value"];
type Connection = Extract<
  ReturnType<typeof openConnection>,
  { ok: true }
>["value"];

function makeKit(
  ledger: Ledger,
  side: Connection,
  clock: ReturnType<typeof manualClock>,
  ids: ReturnType<typeof createIdSource>,
) {
  const machine = context("machine");
  const commands = new Map<string, typeof createPendingCommand>([
    [createPendingCommand.route.name, createPendingCommand],
    [cancelPendingForCommand.route.name, cancelPendingForCommand as never],
    [recordAppliedCommand.route.name, recordAppliedCommand as never],
  ]);
  const store: ApprovalLedger = createApprovalLedger({
    command: (name, input) =>
      Promise.resolve(
        ledger.transaction(
          { actor: "machine" },
          (tx) => commands.get(name)!.handle(tx, machine, input as never, {}),
        ),
      ),
    read: () =>
      Promise.resolve(approvalsUnappliedRead.handle(
        { sql: side.sql, as_of_seq: "0", port: () => undefined as never },
        machine,
        {},
      )),
  });
  const grant: AgentGrant = {
    agent: AGENT,
    entries: [{ kind: "app", app: APP, apis: [] }],
  };
  const published: BusEvent[] = [];
  // 앞 호출의 결과를 보존한 채 같은 DB에 다시 붙인다(재시작).
  const build = () =>
    createApprovals({
      gate,
      grants: {
        appGrants: () => Promise.resolve(ok([])),
        agentGrant: () => Promise.resolve(ok(grant)),
        reactionGrant: () =>
          Promise.resolve(ok({
            ProblemOpened: "open",
            ProblemReopened: "open",
            AppRestartHalted: "open",
            ReleaseActivationFailed: "open",
            ContextViolationFound: "open",
            KindViolationFound: "open",
          })),
        setAlways: () => Promise.resolve(ok(undefined)),
      },
      allowances: createSessionAllowances(),
      bus: { publish: (event) => published.push(event) },
      ledger: store,
      clock,
      ids,
    });
  const count = (sql: string) => Number(side.sql.get(sql, [])?.n);
  const decide = (request: string, choice: object) =>
    ledger.transaction(
      { actor: "user" },
      (tx) =>
        decideCommand.handle(
          tx,
          context("user"),
          { request, choice } as never,
          {},
        ),
    );
  return { build, published, count, decide, side };
}

Deno.test("이 session 동안 허락은 같은 session에서만 쓰이고 재시작에 남지 않는다", async () => {
  await withApprovals(async ({ build, count }) => {
    const approvals = build();
    const rows = () => count("select count(*) as n from approval_requests");
    const before = rows();
    const asks = async (session: string, from = approvals) => {
      const verdict = await from.judge(externalCall(session));
      assert(verdict.ok);
      return verdict.value.verdict;
    };
    assertEquals(await asks(SES), "ask");

    const opened = approvals.openTurnRequest(externalCall(SES));
    assert(opened.ok);
    const decided = await approvals.decideTurn({ actor: "user" }, {
      session: SES,
      request: opened.value.id,
      choice: { kind: "session" },
    });
    assert(decided.ok);
    assertEquals(await asks(SES), "run");
    assertEquals(await asks(OTHER_SES), "ask");

    // 재시작: 메모리가 사라지고 DB에도 남은 것이 없다.
    assertEquals(await asks(SES, build()), "ask");
    assertEquals(rows(), before);

    // 사람이 아니면 결정하지 못한다. 요청은 그대로 기다린다.
    const waiting = approvals.openTurnRequest(externalCall(SES, { to: "x" }));
    assert(waiting.ok);
    const forbidden = await approvals.decideTurn({ actor: "agent" }, {
      session: SES,
      request: waiting.value.id,
      choice: { kind: "once" },
    });
    assert(!forbidden.ok && forbidden.error.code === "forbidden");
    assertEquals(approvals.turnRequests(SES).map((one) => one.id), [
      waiting.value.id,
    ]);
  });
});

Deno.test("허락은 그 intent에 한 번만 쓰인다", async () => {
  await withApprovals(async ({ build }) => {
    const approvals = build();
    const allowOnce = async (intent: Intent) => {
      const opened = approvals.openTurnRequest(intent);
      assert(opened.ok);
      const decided = await approvals.decideTurn({ actor: "user" }, {
        session: SES,
        request: opened.value.id,
        choice: { kind: "once" },
      });
      assert(decided.ok);
      return opened.value.id;
    };
    const codeOf = (result: { ok: boolean; error?: { code: string } }) =>
      result.ok ? "ok" : result.error?.code;

    const intent = externalCall(SES);
    const id = await allowOnce(intent);
    assertEquals(codeOf(await approvals.consumeTurnAllow(id, intent)), "ok");
    assertEquals(
      codeOf(await approvals.consumeTurnAllow(id, intent)),
      "conflict",
    );

    const changed = await allowOnce(intent);
    assertEquals(
      codeOf(
        await approvals.consumeTurnAllow(
          changed,
          externalCall(SES, { to: "y" }),
        ),
      ),
      "conflict",
    );
  });
});

Deno.test("보류 request는 한 번만 결정되고 적용 결과가 나온 뒤 ApprovalDecided가 난다", async () => {
  await withApprovals(async ({ build, published, count, decide, side }) => {
    const approvals = build();
    const applied: string[] = [];
    approvals.registerApplier("activation", (request) => {
      applied.push(request.id);
      return Promise.resolve(ok({ state: "applied" as const }));
    });
    const decidedEvents = () =>
      side.sql.all(
        "select payload from events where type = 'ApprovalDecided' order by seq",
        [],
      ).map((row) => JSON.parse(String(row.payload)));

    // 같은 intent는 한 번만 묻고 ApprovalRequested도 한 번이다.
    const first = await approvals.createPending(activation(REL));
    const again = await approvals.createPending(activation(REL));
    assert(first.ok && again.ok);
    assertEquals(again.value.id, first.value.id);
    assertEquals(
      published.filter((event) => event.type === "ApprovalRequested").length,
      1,
    );

    // 허락은 접수일 뿐이다. 적용이 끝나야 결과와 함께 event가 난다.
    const allowed = decide(first.value.id, { kind: "allow" });
    assert(allowed.ok);
    const accepted = allowed.value.request as PendingApproval;
    assertEquals([accepted.status, accepted.applied], ["allow", null]);
    assertEquals(decidedEvents(), []);
    assert((await approvals.applyAllowed(accepted)).ok);
    assertEquals(applied, [first.value.id]);
    assertEquals(decidedEvents(), [
      { kind: "activation", decision: "allow", applied: { state: "applied" } },
    ]);

    // 끝난 request는 다시 열리지 않고, 두 번 적용되지도 않는다.
    const again2 = decide(first.value.id, { kind: "reject" });
    assert(!again2.ok && again2.error.code === "conflict");
    assert((await approvals.applyAllowed(accepted)).ok);
    assertEquals(applied.length, 1);

    // 거절은 바로 event가 나고 적용하지 않는다.
    const second = await approvals.createPending(activation(NEWER));
    assert(second.ok);
    assert(decide(second.value.id, { kind: "reject", reason: "no" }).ok);
    assertEquals(decidedEvents().length, 2);
    assertEquals(applied.length, 1);

    // 더 새 release의 activation이 시작되면 이전 release의 request는 cancelled다.
    const third = await approvals.createPending(activation(REL));
    assert(third.ok);
    const cancelled = await approvals.cancelPendingFor(APP, NEWER);
    assertEquals(cancelled.ok && cancelled.value, 1);
    assertEquals(
      count(
        "select count(*) as n from approval_requests where status = 'pending'",
      ),
      0,
    );
  });
});
