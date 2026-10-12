import { assertEquals } from "@std/assert";
import type { Tx } from "../../packages/protocol/server/mod.ts";
import type { TicketClaimCheckResult } from "../../packages/protocol/coding-agent/mod.ts";
import { reproductionClaimRejection } from "./problems-test-ports.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const TICKET = "tkt_01arz3ndektsv4rrffq69g5fav";
const PROBLEM = "prb_01arz3ndektsv4rrffq69g5fav";

const request = (patch: Record<string, unknown> = {}) => ({
  request_key: "key-1",
  kind: "reproduction" as const,
  app: APP,
  target: {
    bundle_hash: "b".repeat(64),
    release: "rel_01ary8h2z3n4p5q6r7s8t9v0wa",
  },
  problem: PROBLEM,
  basis_seq: "1",
  reports: ["rpt_01arz3ndektsv4rrffq69g5fav"],
  before: "rel_01arz3ndektsv4rrffq69g5fav",
  after: "rel_01ary8h2z3n4p5q6r7s8t9v0wa",
  ticket: null,
  test: "c".repeat(64),
  ...patch,
});

function tx(
  claim: TicketClaimCheckResult,
  linked = true,
): Pick<Tx, "port" | "now" | "sql"> {
  return {
    now: () => "2026-10-07T00:00:00.000Z",
    port: (() => () => ({ ok: true, value: claim })) as never,
    sql: {
      get: () => linked ? { hit: 1 } : undefined,
      all: () => [],
      run: () => ({ changes: 0, lastInsertRowid: 0 }),
    },
  };
}

const agent = { actor: "coding_agent:cac_01arz3ndektsv4rrffq69g5fav" };
const current = {
  ok: true as const,
  expires_at: "2099-01-01T00:00:00.000Z",
  app: APP,
};

Deno.test("problems/tests#R1 coding-agent/mcp-server#R25: coding agent의 reproduction 요청은 현재 claim과 이 문제의 repair ticket이 맞을 때만 통과한다", () => {
  const source = { ticket_source: { ticket: TICKET, claim_seq: "5" } };
  // 맞는 claim이고 그 ticket이 이 앱·이 문제의 repair ticket이면 통과한다.
  assertEquals(
    reproductionClaimRejection(tx(current), agent, request(source) as never),
    undefined,
  );
  // claim을 싣지 않으면 거절한다.
  assertEquals(
    typeof reproductionClaimRejection(tx(current), agent, request() as never),
    "string",
  );
  // 현재가 아닌 claim은 거절 이유를 그대로 돌려준다.
  assertEquals(
    reproductionClaimRejection(
      tx({ ok: false, reason: "expired" }),
      agent,
      request(source) as never,
    ),
    "expired",
  );
  // 다른 앱의 ticket은 없는 ticket과 같다.
  assertEquals(
    reproductionClaimRejection(
      tx({ ...current, app: "app_01ary8h2z3n4p5q6r7s8t9v0wa" }),
      agent,
      request(source) as never,
    ),
    "missing",
  );
  // 그 ticket이 이 문제의 repair ticket이 아니다.
  assertEquals(
    typeof reproductionClaimRejection(
      tx(current, false),
      agent,
      request(source) as never,
    ),
    "string",
  );
  // 사람·machine과 다른 종류의 요청에는 이 규칙이 없다.
  for (const actor of ["user", "machine"]) {
    assertEquals(
      reproductionClaimRejection(tx(current), { actor }, request() as never),
      undefined,
    );
  }
  assertEquals(
    reproductionClaimRejection(
      tx(current),
      agent,
      request({ kind: "app_test" }) as never,
    ),
    undefined,
  );
});
