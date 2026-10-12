// lophn-agent/harness/tools#R9: ticket tool은 coding-agent/tickets의 읽기·생성과 확인 필요 ticket의
// 실행 준비 전환(make_ready)만 준다. claim·연장·보고·취소·[Start]는 정의가 없다. 소유 contract는
// 대역이 받는다(실제 core는 packages/core/lophn-agent/tools/ticket-tools-core_test.ts). 실제 provider·사람 데이터 root는 열지
// 않는다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import { type CallFacts, judge } from "../tool-judgment/mod.ts";
import { ROLE_CAPS } from "../agents/mod.ts";
import {
  BUILTIN_TOOLS,
  createBuiltinToolHandlers,
  executeTool,
  TICKET_READ_TOOL_NAMES,
  TICKET_TOOLS,
  TICKET_WRITE_TOOL_NAMES,
  TOOL_BUNDLES,
} from "./mod.ts";
import type { AgentToolPorts } from "./mod.ts";

const RUN = "run_01h455vb4pex5v6nkc6gd5fdw1";
const CALL = "tcl_01h455vb4pex5v6nkc6gd5fdw1";
const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const TICKET = "tkt_01h455vb4pex5v6nkc6gd5fdw1";
const QUESTION = "qst_01h455vb4pex5v6nkc6gd5fdw1";
const VERSION = "ver_01h455vb4pex5v6nkc6gd5fdw1";
const PROBLEM = "prb_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER_PROBLEM = "prb_01h455vb4pex5v6nkc6gd5fdw2";

const REFERENCE = {
  kind: "version",
  target: VERSION,
  address: {
    place: "project",
    document: "leaf-redaction",
    section: null,
    version: 1,
  },
  section: null,
};
const APP_TEST = { kind: "app_test" };
const TEST_COMMAND = {
  kind: "test_command",
  executable: "deno",
  argv: ["task", "test"],
  cwd: ".",
  timeout_ms: 60_000,
  expected_exit_code: 0,
};

type Seen = {
  contract: string;
  input: Record<string, unknown>;
  options?: { compare?: unknown; idempotency_key?: string };
};

function ticketRow(index: number) {
  return {
    id: `tkt_01h455vb4pex5v6nkc6gd5f${String(index).padStart(3, "0")}`,
    app: APP,
    kind: "implementation",
    title: `ticket ${index}`,
    state: "open",
    readiness: "needs_confirmation",
    problem_count: 0,
  };
}

function rig(options: { fail?: "unavailable" | "not_found" } = {}) {
  const seen: Seen[] = [];
  const all = Array.from({ length: 45 }, (_, index) => ticketRow(index + 1));
  const ports = {
    call(
      contract: string,
      input: unknown,
      _run: string,
      callOptions?: Seen["options"],
    ): Promise<Result<unknown>> {
      const value = input as Record<string, unknown>;
      seen.push({
        contract,
        input: value,
        ...(callOptions === undefined ? {} : { options: callOptions }),
      });
      if (options.fail !== undefined && contract !== "ListTickets") {
        return Promise.resolve(
          err({ code: options.fail, message: "core refused" }),
        );
      }
      if (contract === "ListTickets") {
        const offset = value["cursor"] === undefined
          ? 0
          : Number(value["cursor"]);
        const limit = Number(value["limit"] ?? 20);
        return Promise.resolve(ok({
          tickets: all.slice(offset, offset + limit),
          as_of_seq: "9",
          next_cursor: offset + limit < all.length
            ? String(offset + limit)
            : null,
        }));
      }
      if (contract === "ShowTicket") {
        return Promise.resolve(ok({
          ticket: {
            id: value["ticket"],
            state: "claimed",
            readiness: "ready",
            needs: [],
            app: APP,
            kind: "implementation",
            title: "fix leaf redaction",
            what: "redact the leaf",
            why: "the snapshot shows it",
            problems: [],
            claim: {
              connection: "cac_01h455vb4pex5v6nkc6gd5fdw1",
              claim_seq: "4",
              expires_at: "2026-10-05T01:00:00.000Z",
            },
            completion_seq: null,
            conditions: [],
            references: [],
            adoption_questions: [],
            inspect: [],
            preserve: [],
            revision: "7",
          },
          as_of_seq: "9",
          next_cursor: null,
        }));
      }
      if (contract === "CreateTicket") {
        return Promise.resolve(ok({
          ticket: TICKET,
          state: "open",
          readiness: value["readiness"],
          revision: "5",
        }));
      }
      if (contract === "MakeTicketReady") {
        return Promise.resolve(ok({
          ticket: value["ticket"],
          readiness: "ready",
          revision: "6",
        }));
      }
      return Promise.resolve(
        err({ code: "not_found", message: "contract is not open" }),
      );
    },
  };
  const handlers = createBuiltinToolHandlers({
    ...ports,
    newId: () => "id",
    runFacts: () =>
      Promise.resolve(
        ok({
          session: null,
          role: "lophn" as never,
          original_message: null,
          assignment: "asg_01h455vb4pex5v6nkc6gd5fdw1",
        }),
      ),
  } as AgentToolPorts);
  const credential = {
    run: RUN,
    call: CALL,
    targets: new Set<string>(),
    operations: new Set(TICKET_TOOLS.map((tool) => tool.contract)),
  };
  const run = (name: string, input: unknown) =>
    executeTool({ listed: TICKET_TOOLS, handlers, credential }, name, input);
  return { seen, run };
}

const base = {
  app: APP,
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
};

const complete = {
  ...base,
  references: [REFERENCE],
  adoption_questions: [QUESTION],
  conditions: [APP_TEST, TEST_COMMAND],
};

Deno.test("lophn-agent/harness/tools#R9: ticket tool은 읽기·생성·make_ready뿐이고 claim·연장·보고·취소·시작은 정의가 없다", () => {
  const names = BUILTIN_TOOLS.map((tool) => tool.name).filter((name) =>
    name.startsWith("ticket.")
  );
  assertEquals(names.sort(), [
    "ticket.create",
    "ticket.list",
    "ticket.make_ready",
    "ticket.read",
  ]);
  assertEquals(TICKET_READ_TOOL_NAMES, ["ticket.list", "ticket.read"]);
  assertEquals(TICKET_WRITE_TOOL_NAMES, ["ticket.create", "ticket.make_ready"]);
  assertEquals(TOOL_BUNDLES.get("ticket-read"), TICKET_READ_TOOL_NAMES);
  assertEquals(TOOL_BUNDLES.get("ticket-write"), TICKET_WRITE_TOOL_NAMES);
  // 소유 contract는 coding-agent/tickets의 읽기·생성·전환 하나씩이고 claim·연장·보고·release 연결이
  // 아니다.
  assertEquals(
    TICKET_TOOLS.map((tool) => [tool.name, tool.contract]),
    [
      ["ticket.list", "ListTickets"],
      ["ticket.read", "ShowTicket"],
      ["ticket.create", "CreateTicket"],
      ["ticket.make_ready", "MakeTicketReady"],
    ],
  );
  for (
    const absent of [
      "ticket.claim",
      "ticket.renew",
      "ticket.renew_claim",
      "ticket.release",
      "ticket.report",
      "ticket.report_completion",
      "ticket.start",
      "ticket.cancel",
      "ticket.link_release",
    ]
  ) {
    assertEquals(names.includes(absent), false, absent);
  }
  assertEquals(
    BUILTIN_TOOLS.some((tool) =>
      /^(ClaimTicket|RenewTicketClaim|ReleaseTicketClaim|ReportTicketCompletion|CancelTicket)$/
        .test(tool.contract)
    ),
    false,
  );
  // 목록·읽기는 읽기, 생성·전환은 되돌릴 수 있는 쓰기이고 사람 확인을 요구하지 않는다.
  for (const name of TICKET_READ_TOOL_NAMES) {
    const tool = TICKET_TOOLS.find((entry) => entry.name === name)!;
    assertEquals(tool.effect, "read");
  }
  for (const name of TICKET_WRITE_TOOL_NAMES) {
    const tool = TICKET_TOOLS.find((entry) => entry.name === name)!;
    assertEquals(tool.effect, "write");
    assertEquals(tool.reversible, true);
    assertEquals(tool.confirm, false);
  }
});

Deno.test("lophn-agent/harness/tools#R9: lophn은 읽기·생성, App Engineer는 읽기·생성·make_ready만 상한에 둔다", () => {
  const ticketNames = (role: string) =>
    ROLE_CAPS.get(role)!.tools.filter((tool) => tool.startsWith("ticket."));
  assertEquals(ticketNames("lophn"), [
    "ticket.list",
    "ticket.read",
    "ticket.create",
  ]);
  assertEquals(ticketNames("app_engineer"), [
    "ticket.list",
    "ticket.read",
    "ticket.create",
    "ticket.make_ready",
  ]);
  assertEquals(ticketNames("context_engineer"), []);
  assertEquals(ticketNames("operator"), []);
});

Deno.test("lophn-agent/harness/tools#R9: 목록은 20개씩 이어 읽고 읽기는 claim한 연결의 정보를 싣지 않는다", async () => {
  const { seen, run } = rig();
  const first = await run("ticket.list", { app: APP });
  assertEquals(first.outcome.kind, "success");
  const firstContent = first.result.content as { tickets: unknown[] };
  assertEquals(firstContent.tickets.length, 20);
  assert(first.result.continuation !== null);
  const next = await run("ticket.list", {
    app: APP,
    cursor: first.result.continuation.read_next,
  });
  assertEquals(
    (next.result.content as { tickets: unknown[] }).tickets.length,
    20,
  );
  // 다른 조건에서 온 cursor는 거절한다.
  const foreign = await run("ticket.list", {
    cursor: first.result.continuation.read_next,
  });
  assertEquals(foreign.outcome.kind, "failure");
  assertEquals(
    seen.filter((entry) => entry.contract === "ListTickets").length,
    2,
  );

  const read = await run("ticket.read", { ticket: TICKET });
  assertEquals(read.outcome.kind, "success");
  const ticket = (read.result.content as {
    ticket: { claim: Record<string, unknown>; revision: string };
  }).ticket;
  assertEquals(ticket.claim, { expires_at: "2026-10-05T01:00:00.000Z" });
  assertEquals(ticket.revision, "7");
  assertEquals(JSON.stringify(read.result.content).includes("cac_"), false);
});

Deno.test("lophn-agent/roles/lophn#R24: 근거·채택 질문·acceptance check가 모자란 직접 요청도 ticket이고 확인 필요와 필요한 확인 목록이 남는다", async () => {
  const { seen, run } = rig();
  const created = await run("ticket.create", base);
  assertEquals(created.outcome.kind, "success");
  // 소유 contract는 생성 하나만 불렀고 coding agent 시작·claim은 부르지 않았다.
  assertEquals(seen.map((entry) => entry.contract), ["CreateTicket"]);
  const sent = seen[0]!.input;
  assertEquals(sent["readiness"], "needs_confirmation");
  assertEquals(sent["needs"], [
    "fixed design evidence is missing",
    "an adopted decision question is missing",
    "an executable acceptance check is missing",
  ]);
  const content = created.result.content as {
    readiness: string;
    needs: string[];
    state: string;
  };
  assertEquals(content.readiness, "needs_confirmation");
  assertEquals(content.state, "open");
  assertEquals(content.needs, sent["needs"]);
});

Deno.test("lophn-agent/roles/lophn#R24: 근거가 모두 있고 모델이 따로 적은 확인이 없을 때만 실행 준비로 만들고, 적은 확인은 목록에 남는다", async () => {
  const { seen, run } = rig();
  const ready = await run("ticket.create", complete);
  assertEquals(ready.outcome.kind, "success");
  assertEquals(seen[0]!.input["readiness"], "ready");
  assertEquals(seen[0]!.input["needs"], []);
  assertEquals(
    (ready.result.content as { needs?: string[] }).needs,
    undefined,
  );

  const asked = await run("ticket.create", {
    ...complete,
    needs: ["ask the person whether the leaf may be empty"],
  });
  assertEquals(asked.outcome.kind, "success");
  assertEquals(seen[1]!.input["readiness"], "needs_confirmation");
  assertEquals(seen[1]!.input["needs"], [
    "ask the person whether the leaf may be empty",
  ]);
  // readiness는 모델이 입력으로 고르지 못한다.
  const forced = await run("ticket.create", {
    ...complete,
    readiness: "ready",
  });
  assertEquals(forced.outcome.kind, "failure");
  assertEquals(seen.length, 2);
});

Deno.test("lophn-agent/roles/lophn#R24: 수리 ticket은 problems_closed와 문제마다 재현 또는 사람 확인이 없으면 확인 필요다", async () => {
  const { seen, run } = rig();
  const repair = {
    ...complete,
    kind: "repair",
    problems: [PROBLEM, OTHER_PROBLEM],
    conditions: [
      APP_TEST,
      TEST_COMMAND,
      { kind: "human_confirmation", problem: PROBLEM },
    ],
  };
  const created = await run("ticket.create", repair);
  assertEquals(created.outcome.kind, "success");
  assertEquals(seen[0]!.input["readiness"], "needs_confirmation");
  assertEquals(seen[0]!.input["needs"], [
    "the problems_closed check is missing",
    `no reproduction or human confirmation for ${OTHER_PROBLEM}`,
  ]);
});

Deno.test("lophn-agent/harness/tools#R9: make_ready는 읽은 revision을 비교 기준으로 같은 ToolCall의 같은 key로 부른다", async () => {
  const { seen, run } = rig();
  const input = {
    ticket: TICKET,
    base_revision: "5",
    references: [REFERENCE],
    adoption_questions: [QUESTION],
    conditions: [APP_TEST, TEST_COMMAND],
    inspect: [],
    preserve: [],
  };
  const made = await run("ticket.make_ready", input);
  assertEquals(made.outcome.kind, "success");
  assertEquals(seen[0]!.contract, "MakeTicketReady");
  assertEquals(seen[0]!.options?.compare, { base_revision: "5" });
  assertEquals(seen[0]!.options?.idempotency_key, CALL);
  // 생성도 같은 ToolCall이면 같은 key라 재전송이 ticket을 늘리지 않는다.
  await run("ticket.create", complete);
  await run("ticket.create", complete);
  assertEquals(seen[1]!.options?.idempotency_key, CALL);
  assertEquals(seen[2]!.options?.idempotency_key, CALL);
});

Deno.test("lophn-agent/harness/tools#R9: 소유 contract의 거절은 안전한 문장 하나로 돌려주고 응답이 없으면 효과 불명확이다", async () => {
  const missing = rig({ fail: "not_found" });
  const refused = await missing.run("ticket.create", complete);
  assertEquals(refused.outcome.kind, "failure");
  // 범위 밖과 없는 대상은 같은 문장이다.
  const absent = await missing.run("ticket.make_ready", {
    ticket: TICKET,
    base_revision: "5",
    references: [REFERENCE],
    adoption_questions: [QUESTION],
    conditions: [APP_TEST, TEST_COMMAND],
    inspect: [],
    preserve: [],
  });
  assertEquals(absent.result.summary, refused.result.summary);

  const down = rig({ fail: "unavailable" });
  const uncertain = await down.run("ticket.create", complete);
  assertEquals(uncertain.result.status, "uncertain");
  assertEquals(uncertain.result.pending, ["change_confirmation"]);
});

function factsOf(tool: string): CallFacts {
  const definition = TICKET_TOOLS.find((entry) => entry.name === tool)!;
  return {
    identity: true,
    assignment: "active",
    run: "active",
    origin: "human_request",
    listed: true,
    roleAllows: true,
    connection: "n/a",
    inputValid: true,
    effect: definition.effect,
    confirm: definition.confirm,
    refused: false,
    // 소유 contract가 되돌릴 수 있다고 하는 대상(claim 전의 ticket은 사람이 취소한다).
    targets: [{
      id: TICKET,
      inScope: true,
      reversibility: definition.reversible ? "reversible" : "unknown",
    }],
  };
}

Deno.test("lophn-agent/roles/app-engineer#R6: 설계 근거를 갖춘 ticket 생성과 전환은 사람 요청에서 approval을 묻지 않는다", () => {
  for (const tool of ["ticket.create", "ticket.make_ready"]) {
    const verdict = judge(factsOf(tool));
    assertEquals(verdict.decision, "allow", tool);
  }
  // 읽기도 묻지 않는다.
  assertEquals(judge(factsOf("ticket.read")).decision, "allow");
});

Deno.test("lophn-agent/roles/app-engineer#R6: 범위 밖 ticket은 승인으로 열지 않고 deny다", () => {
  const facts = factsOf("ticket.create");
  const outside: CallFacts = {
    ...facts,
    targets: [{ ...facts.targets[0]!, inScope: false }],
  };
  assertEquals(judge(outside).decision, "deny");
});

Deno.test("lophn-agent/harness/tools#R3: key 순서만 다른 입력은 바뀐 입력으로 거절하지 않고 그대로 실행한다", async () => {
  const { seen, run } = rig();
  const made = await run("ticket.make_ready", {
    inspect: [],
    preserve: [],
    conditions: [APP_TEST, TEST_COMMAND],
    adoption_questions: [QUESTION],
    references: [REFERENCE],
    base_revision: "5",
    ticket: TICKET,
  });
  assertEquals(made.outcome.kind, "success", JSON.stringify(made));
  assertEquals(seen[0]!.options?.compare, { base_revision: "5" });
});
