// lophn-agent#T49 끝에서 끝까지: ticket tool(`ticket.list`·`read`·`create`·`make_ready`)을 실제 core(임시
// LOPHN_HOME, 실제 ledger와 coding-agent/tickets)에 붙인다. 앱 하나에 묶인 agent 자격(App Engineer)의
// tool 호출이 담당 앱에 ticket을 만들고, 다른 앱에는 없는 앱·없는 ticket과 같은 답으로 거절된다. tool은
// 제품 조립(agent-runtime의 `createContractCall`·`ALL_ROUTES`)이 쓰는 같은 통로로 core를 부른다. model
// provider는 부르지 않고(tool 호출은 실행기를 직접 부른다) 사람 데이터 root는 열지 않는다.
import { assert, assertEquals } from "@std/assert";
import { ok, type Result } from "../../packages/base/mod.ts";
import { ALL_ROUTES } from "../../packages/contracts/mod.ts";
import {
  createBuiltinToolHandlers,
  executeTool,
  type ExecutionOutcome,
  runOperations,
  TICKET_TOOLS,
} from "../../packages/lophn-agent/harness/tools/mod.ts";
import { agentCall } from "../agent-runtime/core-http.ts";
import { createContractCall } from "../agent-runtime/toolkit.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "./documents.ts";
import { lophnAgentDefinitions } from "./lophn-agent.ts";
import { ticketDefinitions } from "./tickets.ts";
import { createCoreHarness } from "./testing/core.ts";

const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const MESSAGE = "msg_01arz3ndektsv4rrffq69g5fav";
const CALL = "tcl_01arz3ndektsv4rrffq69g5fav";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const ABSENT_APP = "app_01arz3ndektsv4rrffq69g5fb9";
const ABSENT_TICKET = "tkt_01arz3ndektsv4rrffq69g5fb9";
const START = Date.parse("2026-10-05T00:00:00.000Z");

const teams = [
  { lophnAgentDefinitions },
  { createLedgerRegistration: createDocumentsRegistration },
  { createLedgerRegistration: createAppsRegistration },
  { codingAgentConnectionDefinitions },
  { ticketDefinitions },
];
// 질문 채택 read의 소유 구현이 아직 없어 채택된 답 하나를 두는 시험 전용 port다(`ticket-claim-ports_test`).
const teamModules = [
  new URL("./lophn-agent.ts", import.meta.url).href,
  new URL("./documents.ts", import.meta.url).href,
  new URL("./apps.ts", import.meta.url).href,
  new URL("./coding-agent.ts", import.meta.url).href,
  new URL("./tickets.ts", import.meta.url).href,
  new URL("./ticket-claim-ports_test.ts", import.meta.url).href,
];

type Body = Record<string, unknown> & {
  tickets?: { id: string; app: string; readiness: string }[];
  ticket?: Record<string, unknown>;
  id?: string;
  revision?: string;
};

async function send(
  port: number,
  path: string,
  token: string,
  body: unknown,
): Promise<{ status: number; body: Body }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const command = (input: unknown, compare: unknown = {}) => ({
  input,
  idempotency_key: `k-${crypto.randomUUID()}`,
  compare,
  prepared: [],
});

const evidence = {
  references: [{
    kind: "version",
    target: VER,
    address: {
      place: "project",
      document: "leaf-redaction",
      section: null,
      version: 1,
    },
    section: null,
  }],
  adoption_questions: [QUESTION],
  conditions: [
    { kind: "app_test" },
    {
      kind: "test_command",
      executable: "deno",
      argv: ["task", "test"],
      cwd: ".",
      timeout_ms: 60_000,
      expected_exit_code: 0,
    },
  ],
};

function ticketInput(app: string, over: Record<string, unknown> = {}) {
  return {
    app,
    kind: "implementation",
    title: "Redact the leaf before the snapshot",
    what: "redact the leaf",
    why: "the snapshot shows the raw leaf",
    references: [],
    adoption_questions: [],
    conditions: [],
    inspect: ["src/leaf.ts"],
    preserve: [],
    problems: [],
    needs: [],
    ...over,
  };
}

async function world() {
  const harness = await createCoreHarness({
    nowMs: START,
    teams,
    teamModules,
    // 내장 assignment 준비가 역할 prompt blob을 준비하려면 I/O worker가 있어야 한다.
    io: true,
  });
  assert(harness.ok, harness.ok ? undefined : JSON.stringify(harness.error));
  const core = harness.value;
  const token = async (
    input: Parameters<typeof core.credential>[0],
  ): Promise<string> => {
    const made: Result<{ token: string }> = await core.credential(input);
    assert(made.ok, made.ok ? undefined : JSON.stringify(made.error));
    return made.value.token;
  };
  const user = await token({
    actor: "user",
    principal: "user-1",
    scope: {
      operations: ["app.create", "CreateTicket", "ListTickets", "ShowTicket"],
      targets: {},
    },
    conditions: {},
  });
  const app = async (slug: string): Promise<string> => {
    const created = await send(
      core.port,
      "/v1/apps/create",
      user,
      command({ slug, name: slug, description: `${slug} app` }),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    return String(created.body.id);
  };
  const own = await app("notes");
  const other = await app("budget");
  // 사람 요청에서 접수된 run 하나가 있어야 agent 자격이 선다(run 상태를 ledger가 확인한다).
  const machine = await token({
    actor: "machine",
    principal: "machine",
    scope: { operations: ["ListAssignments", "AcceptRun"], targets: {} },
    conditions: {},
  });
  const listed = await send(core.port, "/v1/assignments/list", machine, {});
  assertEquals(listed.status, 200, JSON.stringify(listed.body));
  const assignment = (listed.body["assignments"] as {
    id: string;
    role: string;
    revision: number;
  }[]).find((entry) => entry.role === "lophn")!;
  const accepted = await send(
    core.port,
    "/v1/runs/accept",
    machine,
    command({
      id: RUN,
      assignment: assignment.id,
      session: null,
      source: { kind: "message", message: MESSAGE },
      continued_from: null,
      start_after: null,
    }, { assignment_revision: assignment.revision }),
  );
  assertEquals(accepted.status, 200, JSON.stringify(accepted.body));
  // 담당 앱 하나에 묶인 자격이다(App Engineer의 `app` 조건): 열린 operation은 ticket tool이 가리키는
  // 소유 contract뿐이고 `app` 조건이 담당 앱을 고정한다.
  const agent = await token({
    actor: "agent",
    principal: `agent:${assignment.id}`,
    scope: {
      operations: [...runOperations(TICKET_TOOLS)],
      targets: { assignment: assignment.id, run: RUN },
    },
    conditions: { assignment: assignment.id, run: RUN, app: own },
  });
  const handlers = createBuiltinToolHandlers({
    ...createContractCall(
      ALL_ROUTES,
      agentCall({ port: core.port, token: agent }),
    ),
    newId: () => "id",
    runFacts: () =>
      Promise.resolve(ok({
        session: null,
        role: "app_engineer" as never,
        original_message: null,
        assignment: assignment.id,
      })),
  });
  const run = (
    tool: string,
    input: unknown,
    call: string | undefined = undefined,
  ): Promise<ExecutionOutcome> =>
    executeTool(
      {
        listed: TICKET_TOOLS,
        handlers,
        credential: {
          run: RUN,
          targets: new Set(),
          operations: new Set(runOperations(TICKET_TOOLS)),
          ...(call === undefined ? {} : { call }),
        },
      },
      tool,
      input,
    );
  const list = (as: string, input: unknown = {}) =>
    send(core.port, "/v1/tickets/list", as, input);
  return { core, user, own, other, run, list };
}

Deno.test("lophn-agent/harness/tools#R9: AE 자격의 ticket.create는 담당 앱에 확인 필요 ticket을 만들고 시작·claim 없이 open으로 남는다", async () => {
  const { core, user, own, run, list } = await world();
  try {
    const created = await run("ticket.create", ticketInput(own));
    assertEquals(created.outcome.kind, "success", JSON.stringify(created));
    const content = created.result.content as {
      ticket: string;
      state: string;
      readiness: string;
      needs: string[];
    };
    assertEquals(content.state, "open");
    assertEquals(content.readiness, "needs_confirmation");
    assertEquals(content.needs.length, 3);
    const listed = await list(user);
    assertEquals(listed.body.tickets?.length, 1);
    assertEquals(listed.body.tickets?.[0]?.id, content.ticket);
    assertEquals(listed.body.tickets?.[0]?.app, own);
    // 읽으면 소유 contract가 가진 값 그대로이고 claim은 없다.
    const read = await run("ticket.read", { ticket: content.ticket });
    assertEquals(read.outcome.kind, "success");
    const ticket = (read.result.content as {
      ticket: { claim: unknown; needs: string[]; state: string };
    }).ticket;
    assertEquals(ticket.claim, null);
    assertEquals(ticket.state, "open");
    assertEquals(ticket.needs, content.needs);
  } finally {
    await core.close();
  }
});

Deno.test("lophn-agent/harness/tools#R9: 다른 앱의 ticket 생성·읽기·목록·전환은 없는 앱·없는 ticket과 같은 답이다", async () => {
  const { core, user, own, other, run, list } = await world();
  try {
    // 사람이 다른 앱에 만든 ticket이 있다.
    const made = await send(
      core.port,
      "/v1/tickets/create",
      user,
      command({
        ...ticketInput(other),
        readiness: "needs_confirmation",
        needs: ["confirm the leaf"],
      }),
    );
    assertEquals(made.status, 200, JSON.stringify(made.body));
    const foreign = String(made.body["ticket"]);
    const mine = await run("ticket.create", ticketInput(own));
    assertEquals(mine.outcome.kind, "success");

    const summary = (outcome: ExecutionOutcome) => ({
      outcome: outcome.outcome,
      summary: outcome.result.summary,
      content: outcome.result.content,
    });
    // 생성: 다른 앱과 없는 앱이 같다.
    const createOther = await run("ticket.create", ticketInput(other));
    const createAbsent = await run("ticket.create", ticketInput(ABSENT_APP));
    assertEquals(createOther.outcome.kind, "failure");
    assertEquals(summary(createOther), summary(createAbsent));
    // 읽기·전환: 다른 앱의 ticket과 없는 ticket이 같다.
    const readOther = await run("ticket.read", { ticket: foreign });
    const readAbsent = await run("ticket.read", { ticket: ABSENT_TICKET });
    assertEquals(readOther.outcome.kind, "failure");
    assertEquals(summary(readOther), summary(readAbsent));
    const ready = (ticket: string) =>
      run("ticket.make_ready", {
        ticket,
        base_revision: "1",
        ...evidence,
        inspect: [],
        preserve: [],
      });
    const readyOther = await ready(foreign);
    const readyAbsent = await ready(ABSENT_TICKET);
    assertEquals(readyOther.outcome.kind, "failure");
    assertEquals(summary(readyOther), summary(readyAbsent));
    // 목록: 다른 앱을 이름 지어도, 이름 짓지 않아도 담당 앱의 ticket만 보인다.
    const namedOther = await run("ticket.list", { app: other });
    assertEquals(
      (namedOther.result.content as { tickets: unknown[] }).tickets,
      [],
    );
    const all = await run("ticket.list", {});
    const tickets = (all.result.content as {
      tickets: { id: string; app: string }[];
    }).tickets;
    assertEquals(tickets.map((ticket) => ticket.app), [own]);
    // 사람(전체 범위)에게는 둘 다 보이고 다른 앱에는 agent가 아무것도 만들지 않았다.
    const human = await list(user);
    assertEquals(
      human.body.tickets?.map((ticket) => ticket.app).sort(),
      [own, other].sort(),
    );
  } finally {
    await core.close();
  }
});

Deno.test("lophn-agent/harness/tools#R9: 같은 ToolCall의 재전송은 ticket을 하나만 만들고 근거가 갖춰진 생성은 실행 준비로 남는다", async () => {
  const { core, user, own, run, list } = await world();
  try {
    const first = await run("ticket.create", ticketInput(own), CALL);
    const again = await run("ticket.create", ticketInput(own), CALL);
    assertEquals(first.outcome.kind, "success", JSON.stringify(first));
    assertEquals(again.outcome.kind, "success", JSON.stringify(again));
    assertEquals(
      (first.result.content as { ticket: string }).ticket,
      (again.result.content as { ticket: string }).ticket,
    );
    assertEquals((await list(user)).body.tickets?.length, 1);

    // 채택된 질문 답과 같은 고정 판을 근거로 갖춘 생성은 확인 필요가 아니라 실행 준비다.
    const ready = await run(
      "ticket.create",
      ticketInput(own, { title: "Second ticket", ...evidence }),
    );
    assertEquals(ready.outcome.kind, "success", JSON.stringify(ready));
    assertEquals(
      (ready.result.content as { readiness: string }).readiness,
      "ready",
    );
  } finally {
    await core.close();
  }
});

Deno.test("lophn-agent/harness/tools#R9: make_ready는 읽은 revision 위에서 확인 필요 ticket을 실행 준비로 바꾸고 낡은 revision은 conflict다", async () => {
  const { core, own, run, list, user } = await world();
  try {
    const created = await run("ticket.create", ticketInput(own));
    const id = (created.result.content as { ticket: string }).ticket;
    const read = await run("ticket.read", { ticket: id });
    const revision = (read.result.content as {
      ticket: { revision: string };
    }).ticket.revision;
    const input = { ticket: id, ...evidence, inspect: [], preserve: [] };
    const stale = await run("ticket.make_ready", {
      ...input,
      base_revision: String(Number(revision) - 1),
    });
    assertEquals(stale.outcome.kind, "failure");
    assertEquals(
      (stale.outcome as { code: string }).code,
      "conflict",
    );
    const made = await run("ticket.make_ready", {
      ...input,
      base_revision: revision,
    });
    assertEquals(made.outcome.kind, "success", JSON.stringify(made));
    const after = await run("ticket.read", { ticket: id });
    const ticket = (after.result.content as {
      ticket: { readiness: string; needs: string[]; state: string };
    }).ticket;
    assertEquals(ticket.readiness, "ready");
    assertEquals(ticket.needs, []);
    // 전환은 시작이 아니다: ticket은 여전히 claim 없이 open이다.
    assertEquals(ticket.state, "open");
    assertEquals((await list(user)).body.tickets?.length, 1);
  } finally {
    await core.close();
  }
});
