// lophn_ticket tool 실행 테스트다(T20, mcp#R27, R37; tickets#R16). 가짜 core
// client를 끼워 claim·renew·release 응답의 connection·claim_seq·expires_at·
// 반납 방법과, 표 밖 op(start·resume·permission 응답류)·문제 직접 claim op의
// 거절을 본다. core에 닿지 않는다.
import { assertEquals } from "@std/assert";
import { err, ok, sha256Hex } from "../../../base/mod.ts";
import { MCP_APP_ROUTES } from "../../../contracts/coding-agent/mod.ts";
import { createTicketTool } from "./ticket.ts";

const TKT = "tkt_01h455vb4pex5v6nkc6gd5fdw1";
const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";
const EXPIRES = "2026-10-05T01:00:00.000Z";

type Sent = {
  resource: string;
  method: string;
  input: unknown;
  compare?: unknown;
  prepared?: readonly string[];
};

// 호출을 기록하는 가짜 core client다. upload는 올린 바이트의 hash로 준비 참조를 돌려준다.
function fakeClient(
  results: Record<string, unknown>,
  sent: Sent[],
  failures: Record<
    string,
    { code: "conflict" | "forbidden"; message: string }
  > = {},
) {
  return {
    connection: CAC,
    baseUrl: "http://127.0.0.1:1",
    command(
      route: { resource: string; method: string },
      body: { input: unknown; compare?: unknown; prepared?: readonly string[] },
    ) {
      sent.push({
        resource: route.resource,
        method: route.method,
        input: body.input,
        compare: body.compare,
        prepared: body.prepared,
      });
      const key = `${route.resource}.${route.method}`;
      if (failures[key] !== undefined) {
        return Promise.resolve(err(failures[key]));
      }
      return Promise.resolve(ok(results[key] ?? {}));
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
    async upload(
      route: { resource: string; method: string },
      input: unknown,
      bytes: ReadableStream<Uint8Array>,
    ) {
      sent.push({ resource: route.resource, method: route.method, input });
      const read = new Uint8Array(await new Response(bytes).arrayBuffer());
      return ok({
        preparation: "prep-1",
        principal: `coding_agent:${CAC}`,
        purpose: "ticket_summary",
        hash: await sha256Hex(read),
        size_bytes: read.length,
      });
    },
  };
}

function tool(
  results: Record<string, unknown>,
  sent: Sent[] = [],
  failures: Parameters<typeof fakeClient>[2] = {},
) {
  return {
    run: createTicketTool({
      client: fakeClient(results, sent, failures),
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
    // op는 선택자라 소유 route 입력에 없고 CAS 비교가 따른다.
    assertEquals(sent, [{
      resource: "tickets",
      method: "claim",
      input: { ticket: TKT, base_revision: "11" },
      compare: { base_revision: "11" },
      prepared: undefined,
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

const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const VRF = "vrf_01h455vb4pex5v6nkc6gd5fdw1";
const SUMMARY = "변경: leaf redaction\n수행한 확인: deno task test";
type ReportData = {
  code: string;
  completion_claim: { claimed: boolean; completion_seq: string };
  report: unknown;
  check: { state: string };
  approval_wait: boolean;
  activation: unknown;
  problems_confirmed: unknown;
};
const reportInput = {
  op: "report",
  ticket: TKT,
  base_revision: "15",
  claim_seq: "12",
  release: REL,
  summary: SUMMARY,
  verifications: [VRF],
};

Deno.test(
  "coding-agent/mcp-server#R28: report는 summary를 upload_summary로 올린 준비 참조로 보고하고 completion seq를 입력받지 않는다",
  async () => {
    const { run, sent } = tool({
      "tickets.report_completion": {
        ticket: TKT,
        state: "reported",
        completion_seq: "21",
      },
      "tickets.show": {
        ticket: {
          id: TKT,
          state: "reported",
          conditions: [
            { position: 0, kind: "app_test" },
            { position: 1, kind: "release_active" },
            { position: 2, kind: "problems_closed" },
          ],
        },
      },
      "tickets.checks": {
        ticket: TKT,
        completion_seq: "21",
        checks: [{
          condition: 0,
          result: "pass",
          reason: "",
          verification: null,
        }],
      },
    });
    const result = await run(
      "lophn_ticket",
      MCP_APP_ROUTES.lophn_ticket.report,
      reportInput,
    );
    const hash = await sha256Hex(new TextEncoder().encode(SUMMARY));
    // 올린 뒤에 보고한다. 보고는 준비 참조를 싣고 completion seq 필드가 없다.
    assertEquals(sent.map((item) => item.method).slice(0, 2), [
      "upload_summary",
      "report_completion",
    ]);
    assertEquals(sent[0].input, {
      blob_hash: hash,
      bytes: new TextEncoder().encode(SUMMARY).length,
    });
    const report = sent[1];
    assertEquals(report.prepared, ["prep-1"]);
    assertEquals(report.compare, { base_revision: "15" });
    const input = report.input as Record<string, unknown>;
    assertEquals(Object.keys(input).sort(), [
      "base_revision",
      "claim_seq",
      "completion",
      "summary_blob",
      "ticket",
    ]);
    assertEquals(input.completion, {
      release: REL,
      summary_hash: hash,
      outputs: [],
      fix_records: [],
      verifications: [VRF],
    });
    // 결과는 완료 주장·보고 접수·확인·approval 대기·activation·문제 확인을 따로 낸다.
    const data = result.data as ReportData;
    assertEquals(data.completion_claim.claimed, true);
    assertEquals(data.completion_claim.completion_seq, "21");
    assertEquals(data.report, { accepted: true, state: "reported" });
    assertEquals(data.check.state, "pending");
    assertEquals(data.approval_wait, true);
    assertEquals(data.activation, { required: true, state: "pending" });
    assertEquals(data.problems_confirmed, { required: true, state: "pending" });
    assertEquals(result.isError, undefined);
  },
);

Deno.test(
  "coding-agent/mcp-server#R27: 만료·취소 뒤 보고는 거절이고 통로가 claim을 갱신하지 않는다",
  async () => {
    const { run, sent } = tool({}, [], {
      "tickets.report_completion": {
        code: "conflict",
        message: "claim이 더는 유효하지 않다",
      },
    });
    const result = await run(
      "lophn_ticket",
      MCP_APP_ROUTES.lophn_ticket.report,
      reportInput,
    );
    assertEquals(result.isError, true);
    const data = result.data as ReportData;
    assertEquals(data.code, "conflict");
    assertEquals(data.report, { accepted: false });
    // 갱신·claim 호출이 없다. upload와 거절된 보고뿐이다.
    assertEquals(sent.map((item) => item.method), [
      "upload_summary",
      "report_completion",
    ]);
  },
);
