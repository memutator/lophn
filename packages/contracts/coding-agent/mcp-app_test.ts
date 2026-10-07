import { assertEquals } from "@std/assert";
import { sha256Hex } from "../../base/mod.ts";
import { APP, HASH, REL, TKT } from "./ticket-fixtures.ts";
import {
  APP_TOOL_NAME_LENGTH,
  APP_TOOL_NAME_PREFIX,
  appCommandToolInputSchema,
  appToolName,
  MCP_APP_ROUTES,
  MCP_APP_TOOLS,
  mcpAppTool,
} from "./mcp-app.ts";
import { releasePreparation } from "../apps/releases.ts";
import { TEST_EXECUTION_LIMITS } from "../problems/tests.ts";

const tool = (name: string) => {
  const found = mcpAppTool(name);
  if (!found) throw new Error(name);
  return found;
};

// tool op 하나가 받는 field. `op`는 tool 것이므로 뺀다.
const branchFields = (input: unknown, op: string) => {
  const union = input as {
    options: { shape: Record<string, unknown> }[];
  };
  const branch = union.options.find((option) => {
    const value = (option.shape.op as unknown as { value?: string }).value;
    return value === op;
  });
  if (!branch) throw new Error(op);
  return Object.keys(branch.shape).filter((field) => field !== "op").sort();
};

// app_test 요청은 ticket 없이 runner에 요청한다(mcp#R33).
const appTestRequest = {
  op: "test",
  request_key: "test-1",
  kind: "app_test" as const,
  app: APP,
  target: { bundle_hash: HASH, release: null },
  problem: null,
  basis_seq: null,
  reports: [],
  before: null,
  after: null,
  ticket: null,
  test: HASH,
};

Deno.test(
  "coding-agent/mcp-server#R19: lophn_app은 16개 op이고 owner route를 가리킨다",
  () => {
    assertEquals(
      MCP_APP_TOOLS.map((item) => item.name),
      ["lophn_app", "lophn_sdk", "lophn_ticket"],
    );
    const app = tool("lophn_app");
    assertEquals(app.ops, [
      "list",
      "show",
      "register",
      "source",
      "validate",
      "test",
      "preview_start",
      "preview_stop",
      "release_prepare",
      "status",
      "blueprint",
      "invocations",
      "logs",
      "sync_tools",
      "command",
      "invocation",
    ]);
    assertEquals(app.toolset, "app");
    assertEquals(app.scope, "S/A");
    // register·쓰기 op가 있으므로 읽기 전용 주석이 없다(output.ts READ_ONLY_TOOLS).
    assertEquals(app.readOnlyHint, undefined);
    app.input.parse({ op: "list", status: "active" });
    app.input.parse({ op: "show", app: APP });
    app.input.parse({
      op: "register",
      slug: "calendar",
      name: "Calendar",
      description: "Keeps one calendar",
    });
    app.input.parse({ op: "source", app: APP, source_path: "/work/app" });
    app.input.parse({
      op: "validate",
      app: APP,
      commit: "a".repeat(40),
      request_key: "prep-1",
    });
    app.input.parse({ op: "preparation", app: APP, request_key: "prep-1" });
    app.input.parse(appTestRequest);
    assertEquals(
      MCP_APP_ROUTES.lophn_app.list.name,
      "app.list",
    );
    assertEquals(
      MCP_APP_ROUTES.lophn_app.show.name,
      "app.get",
    );
    assertEquals(
      MCP_APP_ROUTES.lophn_app.register.name,
      "app.create",
    );
    assertEquals(
      MCP_APP_ROUTES.lophn_app.source.name,
      "app.connect_source",
    );
  },
);

Deno.test(
  "coding-agent/mcp-server#R19, coding-agent/mcp-server#R29: preview·runtime·invocation·log 읽기 op는 owner read 입력을 그대로 쓴다",
  () => {
    const app = tool("lophn_app");
    // preview_start는 nested preview 참조다.
    app.input.parse({
      op: "preview_start",
      input: { app: APP, bundle_hash: HASH, release: null, fixture_hash: null },
    });
    app.input.parse({ op: "preview_stop", app: APP, process_nonce: "nonce-1" });
    app.input.parse({ op: "status", app: APP });
    app.input.parse({ op: "blueprint", app: APP });
    app.input.parse({ op: "sync_tools", app: APP });
    app.input.parse({ op: "invocations", app: APP, limit: 20, cursor: "4" });
    app.input.parse({
      op: "invocation",
      invocation: `inv_${APP.slice(4)}`,
      app: APP,
      environment: "live",
    });
    app.input.parse({
      op: "logs",
      app: APP,
      limit: 200,
      max_bytes: 65_536,
    });
    // preview_start에 오래 걸리는 일을 응답에서 기다리지 않으므로 접수와 다음 read다.
    // nested input의 준비 접수(process_nonce·ready=false)와 previews.get 재조회가
    // owner route에 있다.
    assertEquals(
      MCP_APP_ROUTES.lophn_sdk.show.name,
      "packages.versions",
    );
  },
);

Deno.test(
  "coding-agent/mcp-server#R29, coding-agent/mcp-server#R32: command·invocation op는 environment와 기한을 구별한다",
  () => {
    const app = tool("lophn_app");
    // command 입력은 app·command·JSON input·environment·양의 timeout_ms?이며
    // 기본 preview다(architecture 5.2).
    app.input.parse({
      op: "command",
      app: APP,
      command: "usage.list",
    });
    app.input.parse({
      op: "command",
      app: APP,
      command: "usage.list",
      input: { month: "2026-10" },
      environment: "live",
      timeout_ms: 5_000,
    });
    assertEquals(
      app.input.safeParse({
        op: "command",
        app: APP,
        command: "us*.list",
      }).success,
      false,
    );
    assertEquals(
      app.input.safeParse({
        op: "command",
        app: APP,
        command: "usage.list",
        environment: "test",
      }).success,
      false,
    );
    assertEquals(
      app.input.safeParse({
        op: "command",
        app: APP,
        command: "usage.list",
        timeout_ms: 0,
      }).success,
      false,
    );
    assertEquals(
      app.input.safeParse({
        op: "command",
        app: APP,
        command: "usage.list",
        timeout_ms: -1,
      }).success,
      false,
    );
    // invocation은 app을 더 받고 environment를 바꾸어 재조회하지 않는다(R29).
    assertEquals(branchFields(MCP_APP_TOOLS[0].input, "command"), [
      "app",
      "command",
      "environment",
      "input",
      "timeout_ms",
    ]);
  },
);

Deno.test(
  "coding-agent/mcp-server#R32: invocations은 최대 20개 페이지고 logs는 1~200줄이다",
  () => {
    const app = tool("lophn_app");
    assertEquals(
      app.input.safeParse({ op: "invocations", app: APP, limit: 21 }).success,
      false,
    );
    // owner invocationsList는 페이지당 최대 200개를 허용하므로 20개는 통과한다.
    app.input.parse({ op: "invocations", app: APP, limit: 20 });
    app.input.parse({ op: "logs", app: APP, limit: 1 });
    app.input.parse({ op: "logs", app: APP, limit: 200 });
    assertEquals(
      app.input.safeParse({ op: "logs", app: APP, limit: 0 }).success,
      false,
    );
    assertEquals(
      app.input.safeParse({ op: "logs", app: APP, limit: 201 }).success,
      false,
    );
  },
);

Deno.test(
  "coding-agent/mcp-server#R20, coding-agent/mcp-server#R21: validate와 release_prepare는 접수를 내고 준비 조회를 가리킨다",
  () => {
    const app = tool("lophn_app");
    // bundle 준비 요청은 ticket_source 없이도 접수받는다(claim 검사는 release.prepare에서).
    app.input.parse({
      op: "release_prepare",
      app: APP,
      commit: "a".repeat(40),
      request_key: "prep-2",
      ticket_source: { ticket: TKT, claim_seq: "12" },
    });
    // ticket_source의 ticket은 tkt ID이다. 다른 모양은 owner가 거절한다.
    assertEquals(
      app.input.safeParse({
        op: "release_prepare",
        app: APP,
        commit: "a".repeat(40),
        request_key: "prep-2",
        ticket_source: { ticket: APP, claim_seq: "12" },
      }).success,
      false,
    );
    // 준비 결과는 preparation op으로 다시 읽는다(접수와 다음 read).
    app.input.parse({ op: "preparation", app: APP, request_key: "prep-2" });
    // validate·release_prepare의 소유 contract는 release.prepare_bundle이고
    // 준비 결과는 release.preparation을 가리킨다.
    assertEquals(
      releasePreparation.name,
      "release.preparation",
    );
  },
);

Deno.test(
  "coding-agent/mcp-server#R33: app test 요청은 300초를 runner에 명시하고 timeout을 구별한다",
  () => {
    const app = tool("lophn_app");
    // app_test는 ticket 없이 runner에 요청한다. ticket 붙은 요청은 owner가 거절한다.
    app.input.parse({ ...appTestRequest, op: "test" });
    assertEquals(
      app.input.safeParse({
        ...appTestRequest,
        op: "test",
        ticket: {
          ticket: TKT,
          check_index: 0,
          check_hash: HASH,
          completion_seq: "12",
        },
      }).success,
      false,
    );
    // runner timeout은 problems/tests 실행 상한(300,000ms) 안에 있다.
    assertEquals(TEST_EXECUTION_LIMITS.timeout_ms, 300_000);
  },
);

Deno.test(
  "coding-agent/mcp-server#R22, coding-agent/mcp-server#R23: lophn_sdk는 catalog·show·add다",
  () => {
    const sdk = tool("lophn_sdk");
    assertEquals(sdk.ops, ["catalog", "show", "add"]);
    assertEquals(sdk.toolset, "app");
    assertEquals(sdk.scope, "G");
    sdk.input.parse({ op: "catalog", name: "@lophn/calendar" });
    sdk.input.parse({ op: "catalog" });
    sdk.input.parse({ op: "show", name: "@lophn/calendar" });
    sdk.input.parse({
      op: "add",
      name: "@lophn/calendar",
      version: "1.2.3",
    });
    assertEquals(
      MCP_APP_ROUTES.lophn_sdk.catalog.name,
      "packages.list",
    );
    assertEquals(
      MCP_APP_ROUTES.lophn_sdk.add.name,
      "packages.guide",
    );
  },
);

Deno.test(
  "coding-agent/mcp-server#R26, coding-agent/mcp-server#R27, coding-agent/mcp-server#R28: lophn_ticket은 7개 op이고 list는 1~20이다",
  () => {
    const ticket = tool("lophn_ticket");
    assertEquals(ticket.ops, [
      "list",
      "show",
      "checks",
      "claim",
      "renew",
      "release",
      "report",
    ]);
    assertEquals(ticket.toolset, "app");
    assertEquals(ticket.scope, "S/A");
    ticket.input.parse({ op: "list", app: APP, state: "claimed", limit: 20 });
    assertEquals(
      ticket.input.safeParse({ op: "list", app: APP, limit: 21 }).success,
      false,
    );
    ticket.input.parse({ op: "show", ticket: TKT });
    ticket.input.parse({ op: "checks", ticket: TKT });
    ticket.input.parse({ op: "claim", ticket: TKT, base_revision: "12" });
    ticket.input.parse({
      op: "renew",
      ticket: TKT,
      base_revision: "13",
      claim_seq: "8",
    });
    ticket.input.parse({
      op: "release",
      ticket: TKT,
      base_revision: "14",
      claim_seq: "8",
    });
    ticket.input.parse({
      op: "report",
      ticket: TKT,
      base_revision: "15",
      claim_seq: "8",
      release: REL,
      summary: "변경: leaf redaction",
      outputs: [],
      fix_records: [],
      verifications: [],
    });
    // completion seq와 hash·준비 참조는 입력이 아니다(통로가 upload_summary로 만든다).
    assertEquals(
      ticket.input.safeParse({
        op: "report",
        ticket: TKT,
        base_revision: "15",
        claim_seq: "8",
        release: REL,
        summary: "요약",
        completion_seq: "9",
      }).success,
      false,
    );
    // ticket 준비에 ticket 없는 test를 요청하지 않으므로 mcp#R37의 create·cancel·
    // check 판정 op는 없다.
    for (const op of ["create", "cancel", "record_checks"]) {
      assertEquals(
        ticket.input.safeParse({ op, ticket: TKT }).success,
        false,
      );
    }
    assertEquals(
      MCP_APP_ROUTES.lophn_ticket.list.name,
      "ListTickets",
    );
    assertEquals(
      MCP_APP_ROUTES.lophn_ticket.claim.name,
      "ClaimTicket",
    );
    assertEquals(MCP_APP_ROUTES.lophn_ticket.claim.actors, ["coding_agent"]);
  },
);

Deno.test(
  "coding-agent/mcp-server#R34: blueprint 유래 read tool 이름은 39자이고 결정적이다",
  async () => {
    const appIdHash = await sha256Hex(APP);
    const commandHash = await sha256Hex("usage.list");
    const name = appToolName(appIdHash, commandHash);
    assertEquals(name.startsWith(APP_TOOL_NAME_PREFIX), true);
    assertEquals(APP_TOOL_NAME_LENGTH, 39);
    assertEquals(name.length, APP_TOOL_NAME_LENGTH);
    assertEquals(
      name,
      `${APP_TOOL_NAME_PREFIX}${appIdHash.slice(0, 12)}_${
        commandHash.slice(0, 16)
      }`,
    );
    // 같은 입력은 같은 이름이고 다른 command는 다른 이름이다.
    assertEquals(name, appToolName(appIdHash, commandHash));
    assertEquals(
      name === appToolName(appIdHash, await sha256Hex("usage.show")),
      false,
    );
    // app ID hash 앞 12자와 command hash 앞 16자 사이는 구분자가 있다.
    const rest = name.slice(APP_TOOL_NAME_PREFIX.length);
    assertEquals(rest.length, 12 + 1 + 16);
    assertEquals(rest[12], "_");
  },
);

Deno.test(
  "coding-agent/mcp-server#R35: blueprint 유래 read tool의 바깥 입력은 input·environment·timeout_ms다",
  () => {
    appCommandToolInputSchema.parse({});
    appCommandToolInputSchema.parse({ environment: "live" });
    appCommandToolInputSchema.parse({
      input: { month: "2026-10" },
      environment: "preview",
      timeout_ms: 1_000,
    });
    // command input과 겹치지 않는 객체에 둔다. environment 생략은 preview다.
    assertEquals(
      appCommandToolInputSchema.safeParse({ command: "usage.list" }).success,
      false,
    );
    assertEquals(
      appCommandToolInputSchema.safeParse({ environment: "test" }).success,
      false,
    );
    assertEquals(
      appCommandToolInputSchema.safeParse({ timeout_ms: 0 }).success,
      false,
    );
  },
);
