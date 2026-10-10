// 문제 op 공통 흐름 시험이다(coding-agent#T44). record_fix가 저장하지 않은 blob의 hash를 기록에 싣지
// 않는지, test가 현재 claim 없이 runner에 닿지 않는지를 가짜 client로 본다. 실제 core 경로는
// apps/core/coding-problem-tools_test.ts가 본다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result, sha256Hex } from "../../base/mod.ts";
import type { LophnError } from "../../base/mod.ts";
import { type ProblemOpDeps, runProblemOp } from "./problem-ops.ts";

const PRB = "prb_01arz3ndektsv4rrffq69g5fav";
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const TKT = "tkt_01arz3ndektsv4rrffq69g5fav";
const REL_A = "rel_01arz3ndektsv4rrffq69g5fa1";
const REL_B = "rel_01arz3ndektsv4rrffq69g5fa2";
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const SUMMARY = "변경: leaf\n";

type Sent = { route: string; body: Record<string, unknown> };

function fake(options: {
  upload?: (hash: string) => Result<unknown, LophnError>;
  read?: (route: string) => Result<unknown, LophnError>;
}) {
  const sent: Sent[] = [];
  const uploads: string[] = [];
  const deps: ProblemOpDeps = {
    client: {
      command(route, body) {
        sent.push({ route: route.name, body });
        return Promise.resolve(ok({ seq: "21" }));
      },
      read(route) {
        return Promise.resolve(
          options.read?.(route.name) ??
            err({ code: "not_found", message: "x" }),
        );
      },
      async upload(_route, input, bytes) {
        const hash = (input as { blob_hash: string }).blob_hash;
        // 올린 바이트를 끝까지 읽는다.
        for await (const _ of bytes) { /* drain */ }
        uploads.push(hash);
        return options.upload?.(hash) ?? err({
          code: "unavailable",
          message: "준비 중계가 없다",
        });
      },
    },
    idempotencyKey: () => "key-1",
    now: () => "2026-10-07T00:00:00.000Z",
    connection: CAC,
    surface: "mcp",
    wait: { budget_ms: 0, interval_ms: 1 },
  };
  return { deps, sent, uploads };
}

const blobFor = (hash: string, overrides: Record<string, unknown> = {}) => ({
  preparation: "prep-1",
  principal: `coding_agent:${CAC}`,
  purpose: "fix_summary",
  hash,
  size_bytes: 12,
  ...overrides,
});

const fixInput = {
  op: "record_fix",
  problem: PRB,
  problem_seq: "7",
  fix: {
    before: REL_A,
    after: REL_B,
    verification: [],
    ticket: TKT,
    claim_seq: "3",
  },
  summary: SUMMARY,
};

Deno.test("coding-agent/mcp-server#R25: record_fix는 올려 저장한 summary의 준비 증거와 hash만 싣는다", async () => {
  const hash = await sha256Hex(new TextEncoder().encode(SUMMARY));
  const { deps, sent, uploads } = fake({ upload: (h) => ok(blobFor(h)) });
  const done = await runProblemOp(fixInput, deps);
  assertEquals(done.isError, undefined, done.summary);
  assertEquals(uploads, [hash]);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].route, "RecordProblemFix");
  const body = sent[0].body as {
    input: {
      fix: { summary: string; ticket: string; claim_seq: string };
      summary_blob: { hash: string; purpose: string };
    };
    compare: unknown;
    prepared: string[];
  };
  assertEquals(body.input.fix.summary, hash);
  assertEquals(body.input.summary_blob.hash, hash);
  assertEquals(body.input.summary_blob.purpose, "fix_summary");
  assertEquals(body.input.fix.ticket, TKT);
  assertEquals(body.compare, { problem_seq: "7" });
  assertEquals(body.prepared, ["prep-1"]);
});

Deno.test("coding-agent/mcp-server#R25: summary를 올리지 못했거나 준비된 blob이 올린 바이트와 다르면 기록을 보내지 않는다", async () => {
  const failed = fake({});
  const refused = await runProblemOp(fixInput, failed.deps);
  assertEquals(refused.isError, true);
  assertEquals((refused.data as { stage: string }).stage, "upload");
  assertEquals(failed.sent, []);

  // 다른 hash를 가리키는 준비 증거는 저장된 blob이 아니다. 그 hash를 기록에 싣지 않는다.
  const wrong = fake({ upload: () => ok(blobFor("e".repeat(64))) });
  const mismatch = await runProblemOp(fixInput, wrong.deps);
  assertEquals(mismatch.isError, true);
  assertEquals(wrong.sent, []);

  // 다른 purpose의 준비 증거도 거절이다.
  const purpose = fake({
    upload: (h) => ok(blobFor(h, { purpose: "ticket_summary" })),
  });
  assertEquals((await runProblemOp(fixInput, purpose.deps)).isError, true);
  assertEquals(purpose.sent, []);
});

const reproduction = {
  op: "test",
  ticket_source: { ticket: TKT, claim_seq: "3" },
  request_key: "repro-1",
  kind: "reproduction",
  app: APP,
  target: { bundle_hash: "b".repeat(64), release: REL_B },
  problem: PRB,
  basis_seq: "1",
  reports: ["rpt_01arz3ndektsv4rrffq69g5fav"],
  before: REL_A,
  after: REL_B,
  ticket: null,
  test: "9".repeat(64),
};

const claimedTicket = (overrides: Record<string, unknown> = {}) => ({
  ticket: {
    kind: "repair",
    state: "claimed",
    app: APP,
    problems: [PRB],
    claim: {
      connection: CAC,
      claim_seq: "3",
      expires_at: "2026-10-07T01:00:00.000Z",
    },
    ...overrides,
  },
});

Deno.test("coding-agent/mcp-server#R25: test는 지정 ticket의 현재 claim이 없으면 runner 요청 없이 conflict다", async () => {
  const cases: [string, Record<string, unknown>][] = [
    ["다른 claim_seq", {
      claim: {
        connection: CAC,
        claim_seq: "4",
        expires_at: "2026-10-07T01:00:00.000Z",
      },
    }],
    ["만료", {
      claim: {
        connection: CAC,
        claim_seq: "3",
        expires_at: "2026-10-06T23:00:00.000Z",
      },
    }],
    ["다른 연결의 claim", {
      claim: {
        connection: "cac_01arz3ndektsv4rrffq69g5fb9",
        claim_seq: "3",
        expires_at: "2026-10-07T01:00:00.000Z",
      },
    }],
    ["claim 없음", { state: "open", claim: null }],
    ["다른 문제의 ticket", { problems: [] }],
  ];
  for (const [label, overrides] of cases) {
    const { deps, sent } = fake({
      read: () => ok(claimedTicket(overrides)),
    });
    const ran = await runProblemOp(reproduction, deps);
    assertEquals(ran.isError, true, label);
    assertEquals((ran.data as { code: string }).code, "conflict", label);
    assertEquals(sent, [], label);
  }
  // 읽을 수 없는 ticket(없는·범위 밖)도 같은 conflict다.
  const absent = fake({});
  const ran = await runProblemOp(reproduction, absent.deps);
  assertEquals((ran.data as { code: string }).code, "conflict");
  assertEquals(absent.sent, []);
});

Deno.test("coding-agent/mcp-server#R25: test는 reproduction만 요청하고 현재 claim이면 RequestTest로 보낸다", async () => {
  const other = fake({ read: () => ok(claimedTicket()) });
  const wrongKind = await runProblemOp(
    { ...reproduction, kind: "app_test" },
    other.deps,
  );
  assertEquals((wrongKind.data as { code: string }).code, "invalid_input");
  assertEquals(other.sent, []);

  const { deps, sent } = fake({
    read: (route) =>
      route === "ShowTicket"
        ? ok(claimedTicket())
        : ok({ request: { request_key: "repro-1", accepted: true } }),
  });
  const ran = await runProblemOp(reproduction, deps);
  // 접수했고 결과가 아직 없다. 성공 pass가 아니다.
  assert(sent.some((entry) => entry.route === "RequestTest"));
  const body = sent.find((entry) => entry.route === "RequestTest")!.body as {
    input: Record<string, unknown>;
  };
  // 현재 claim을 RequestTest에 실어 core가 접수 때 다시 확인한다. ticket link는 null이다.
  assertEquals(body.input["ticket_source"], { ticket: TKT, claim_seq: "3" });
  assertEquals(body.input["ticket"], null);
  assertEquals((ran.data as { real_test?: boolean }).real_test, undefined);
});

Deno.test("problems#T22 problems/grouping#R12: show는 ticket·version ID 없이 detail의 담당·수리 상태를 보인다", async () => {
  const VER = "ver_01arz3ndektsv4rrffq69g5fav";
  const read = {
    problem: {
      id: PRB,
      app: APP,
      group_key: { kind: "declared", code: "save_failed", discriminator: null },
      status: "fixing",
      work: TKT,
      interpretation: { version: VER, section: null },
      closure: null,
      seq: "4",
    },
    detail: {
      progress: { state: "fixing", label: "Fixing" },
      owner: {
        kind: "coding_agent",
        label: "A coding agent is working on this.",
      },
      needed_action: null,
      repair: {
        state: "in_progress",
        label: "In progress",
        needs: [],
        last_check_failed: false,
      },
      result: {
        fix_report: "none",
        fix_report_label: "No fix reported yet.",
        tests: { state: "not_run", label: "No tests have run.", items: [] },
      },
      closed: null,
    },
    text: "Saving failed.",
    report_count: 2,
    first_observed_at: null,
    last_observed_at: null,
    first_release: null,
    last_release: null,
    as_of_seq: "4",
    next_cursor: null,
  };
  const { deps } = fake({
    read: (route) => route === "GetProblem" ? ok(read) : undefined!,
  });
  const shown = await runProblemOp({ op: "show", problem: PRB }, deps);
  assertEquals(shown.isError, undefined, shown.summary);
  assert(shown.summary.includes("A coding agent is working on this."));
  assert(shown.summary.includes("In progress"));
  const text = JSON.stringify(shown.data);
  assert(!text.includes(TKT) && !text.includes(VER), text);
  assertEquals((shown.data as { problem: { seq: string } }).problem.seq, "4");
});
