// lophn_ticket tool 실행 테스트다(T20, mcp#R27, R37; tickets#R16). 가짜 core
// client를 끼워 claim·renew·release 응답의 connection·claim_seq·expires_at·
// 반납 방법과, 표 밖 op(start·resume·permission 응답류)·문제 직접 claim op의
// 거절을 본다. core에 닿지 않는다.
import { assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import { MCP_APP_ROUTES } from "../../../contracts/coding-agent/mod.ts";
import { createTicketTool } from "./ticket.ts";

const TKT = "tkt_01h455vb4pex5v6nkc6gd5fdw1";
const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
const EXPIRES = "2026-10-05T01:00:00.000Z";

type Sent = { resource: string; method: string; input: unknown };

// 호출을 기록하는 가짜 core client다.
function fakeClient(
  results: Record<string, unknown>,
  sent: Sent[],
) {
  return {
    connection: CAC,
    baseUrl: "http://127.0.0.1:1",
    command(
      route: { resource: string; method: string },
      body: { input: unknown },
    ): Promise<ReturnType<typeof ok>> {
      sent.push({
        resource: route.resource,
        method: route.method,
        input: body.input,
      });
      const key = `${route.resource}.${route.method}`;
      const value = results[key] ?? {};
      return Promise.resolve(ok(value));
    },
    // read는 command와 따로 불린다. 같은 기록에 남긴다.
    read(route: { resource: string; method: string }, input: unknown) {
      sent.push({
        resource: route.resource,
        method: route.method,
        input,
      });
      const key = `${route.resource}.${route.method}`;
      return Promise.resolve(ok(results[key] ?? {}));
    },
  };
}

function tool(
  results: Record<string, unknown>,
  sent: Sent[] = [],
) {
  return {
    run: createTicketTool({
      client: fakeClient(results, sent),
      now: () => "2026-10-05T00:00:00.000Z",
      idempotencyKey: () => `key-${sent.length}`,
    }),
    sent,
  };
}

Deno.test(
  "coding-agent/mcp-server#R27: claim 응답은 connection·claim_seq·expires_at과 반납 방법을 남긴다",
  async () => {
    const { run, sent } = tool({
      "tickets.claim": {
        ticket: TKT,
        connection: CAC,
        claim_seq: "12",
        expires_at: EXPIRES,
      },
    });
    const result = await run(
      "lophn_ticket",
      MCP_APP_ROUTES.lophn_ticket.claim,
      { op: "claim", ticket: TKT, base_revision: "11" },
    );
    assertEquals(sent, [{
      resource: "tickets",
      method: "claim",
      input: { op: "claim", ticket: TKT, base_revision: "11" },
    }]);
    const data = result.data as {
      connection?: string;
      claim_seq?: string;
      expires_at?: string;
    };
    assertEquals(data.connection, CAC);
    assertEquals(data.claim_seq, "12");
    assertEquals(data.expires_at, EXPIRES);
    // 반납 방법이 다음 동작 안내에 있다.
    assertEquals(
      result.next.some((line) => line.includes("release")),
      true,
    );
    // 자동 갱신을 통로가 덧붙이지 않는다. renew 주기 안내는 없다.
    assertEquals(
      result.next.some((line) => line.includes("자동 갱신")),
      false,
    );
  },
);

Deno.test(
  "coding-agent/mcp-server#R27: renew·release는 실제 실행이고 응답에 대응 contract 출력을 그대로 가진다",
  async () => {
    const { run, sent } = tool({
      "tickets.renew_claim": {
        ticket: TKT,
        connection: CAC,
        claim_seq: "12",
        expires_at: EXPIRES,
      },
      "tickets.release_claim": { ticket: TKT, state: "open" },
    });
    const renewed = await run(
      "lophn_ticket",
      MCP_APP_ROUTES.lophn_ticket.renew,
      { op: "renew", ticket: TKT, base_revision: "13", claim_seq: "12" },
    );
    assertEquals((renewed.data as { claim_seq?: string }).claim_seq, "12");
    const released = await run(
      "lophn_ticket",
      MCP_APP_ROUTES.lophn_ticket.release,
      { op: "release", ticket: TKT, base_revision: "14", claim_seq: "12" },
    );
    assertEquals((released.data as { state?: string }).state, "open");
    assertEquals(sent.map((item) => item.method), [
      "renew_claim",
      "release_claim",
    ]);
  },
);

Deno.test(
  "coding-agent/mcp-server#R26: list·show·checks read는 소유 route로만 보낸다",
  async () => {
    const { run, sent } = tool({
      "tickets.list": { tickets: [], as_of_seq: "1", next_cursor: null },
      "tickets.show": {
        ticket: { id: TKT, state: "claimed", claim: { claim_seq: "12" } },
        as_of_seq: "1",
        next_cursor: null,
      },
      "tickets.checks": {
        ticket: TKT,
        completion_seq: null,
        checks: [],
        as_of_seq: "1",
        next_cursor: null,
      },
    });
    const list = await run(
      "lophn_ticket",
      MCP_APP_ROUTES.lophn_ticket.list,
      { op: "list", state: "claimed", limit: 20 },
    );
    // read는 op를 떼고 소유 read route에 입력만 간다.
    assertEquals(sent[0], {
      resource: "tickets",
      method: "list",
      input: { state: "claimed", limit: 20 },
    });
    await run(
      "lophn_ticket",
      MCP_APP_ROUTES.lophn_ticket.show,
      { op: "show", ticket: TKT },
    );
    await run(
      "lophn_ticket",
      MCP_APP_ROUTES.lophn_ticket.checks,
      { op: "checks", ticket: TKT },
    );
    assertEquals(sent.map((item) => item.method), [
      "list",
      "show",
      "checks",
    ]);
    assertEquals(list.summary.includes("목록"), true);
  },
);

Deno.test(
  "coding-agent/mcp-server#R37: start·resume·harness 설치·permission 응답 op는 실행하지 않는다",
  async () => {
    const { run, sent } = tool({});
    const routes = MCP_APP_ROUTES.lophn_ticket as Record<string, unknown>;
    // 소유 route 표에 이 op가 없다. discovery에도 나오지 않는다(registry).
    for (const op of ["start", "resume", "install", "permission"]) {
      assertEquals(Object.hasOwn(routes, op), false);
    }
    const refused = await run(
      "lophn_ticket",
      MCP_APP_ROUTES.lophn_ticket.claim,
      { op: "start", ticket: TKT },
    );
    assertEquals(sent, []);
    assertEquals(refused.summary.includes("표에 없는 op다"), true);
  },
);

Deno.test(
  "coding-agent/tickets#R16: 문제 tool에 직접 claim op가 없다",
  () => {
    // lophn_problem의 소유 route 표에 claim이 없다(tickets#R16).
    // lophn_ticket의 7개 op에도 문제 claim이 없다. claim은 ticket만 가진다.
    const ticketRoutes = MCP_APP_ROUTES.lophn_ticket;
    assertEquals(
      Object.hasOwn(ticketRoutes, "claim_problem"),
      false,
    );
    assertEquals(Object.keys(ticketRoutes).sort(), [
      "checks",
      "claim",
      "list",
      "release",
      "renew",
      "report",
      "show",
    ]);
  },
);
