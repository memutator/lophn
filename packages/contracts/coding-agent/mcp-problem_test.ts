import { assertEquals } from "@std/assert";
import { commandRequestSchema } from "../platform/envelope.ts";
import { routePath } from "../platform/route.ts";
import { APP, HASH, PRB, REL, TKT, VRF } from "./ticket-fixtures.ts";
import {
  CLI_PROBLEM_NAMES as cliProblemNames,
  cliProblemAttachmentOpenSchema,
  cliProblemBundleSchema,
  cliProblemConfirmSchema,
  cliProblemDismissSchema,
  cliProblemFixRecordsSchema,
  cliProblemListSchema,
  cliProblemMoreSchema,
  cliProblemRecordFixSchema,
  cliProblemReportSchema,
  cliProblemRequestRepairSchema,
  cliProblemShowSchema,
  cliProblemSnapshotSchema,
  cliProblemSummarySchema,
  cliProblemTestSchema,
  MCP_PROBLEM_ROUTES,
  MCP_PROBLEM_TOOLS,
  mcpProblemTool,
} from "./mcp-problem.ts";

const tool = (name: string) => {
  const found = mcpProblemTool(name);
  if (!found) throw new Error(name);
  return found;
};

const fixInput = {
  problem: PRB,
  fix: {
    before: REL,
    after: "rel_01h455vb4pex5v6nkc6gd5fdw2",
    summary: HASH,
    verification: [VRF],
    ticket: TKT,
    claim_seq: "12",
  },
  idempotency_key: "fix-1",
};

const testInput = {
  request_key: "test-1",
  kind: "reproduction" as const,
  app: APP,
  target: { bundle_hash: HASH, release: "rel_01h455vb4pex5v6nkc6gd5fdw2" },
  problem: PRB,
  basis_seq: "4",
  reports: ["rpt_01h455vb4pex5v6nkc6gd5fdw1"],
  before: REL,
  after: "rel_01h455vb4pex5v6nkc6gd5fdw2",
  ticket: null,
  test: HASH,
};

Deno.test(
  "coding-agent/mcp-server#R24: lophn_problem은 9개 op이고 owner route를 가리킨다",
  () => {
    assertEquals(MCP_PROBLEM_TOOLS.map((item) => item.name), ["lophn_problem"]);
    const problem = tool("lophn_problem");
    assertEquals(problem.ops, [
      "list",
      "show",
      "snapshot",
      "fix_records",
      "summary",
      "bundle",
      "more",
      "record_fix",
      "test",
    ]);
    assertEquals(problem.toolset, "app");
    assertEquals(problem.scope, "S/A");
    // record_fix·test가 있으므로 읽기 전용 주석이 없다(output.ts READ_ONLY_TOOLS).
    assertEquals(problem.readOnlyHint, undefined);
    problem.input.parse({ op: "list", app: APP, status: "open" });
    problem.input.parse({ op: "show", problem: PRB });
    problem.input.parse({ op: "snapshot", snapshot: `snp_${PRB.slice(4)}` });
    problem.input.parse({ op: "fix_records", problem: PRB, cursor: "4" });
    problem.input.parse({
      op: "summary",
      selector: { ticket: TKT },
    });
    problem.input.parse({
      op: "bundle",
      selector: { problem: PRB },
    });
    problem.input.parse({
      op: "more",
      problem: PRB,
      kind: "log",
      source: `snp_${PRB.slice(4)}/logs`,
      cursor: null,
    });
    assertEquals(
      MCP_PROBLEM_ROUTES.lophn_problem.list.name,
      "ListProblems",
    );
    assertEquals(MCP_PROBLEM_ROUTES.lophn_problem.show.name, "GetProblem");
    assertEquals(
      MCP_PROBLEM_ROUTES.lophn_problem.snapshot.name,
      "GetSnapshot",
    );
    assertEquals(
      MCP_PROBLEM_ROUTES.lophn_problem.fix_records.name,
      "ListProblemFixes",
    );
    assertEquals(
      MCP_PROBLEM_ROUTES.lophn_problem.summary.method,
      "summary",
    );
    assertEquals(
      routePath(MCP_PROBLEM_ROUTES.lophn_problem.summary),
      "/v1/repair_context/summary",
    );
    assertEquals(
      routePath(MCP_PROBLEM_ROUTES.lophn_problem.bundle),
      "/v1/repair_context/bundle",
    );
    assertEquals(
      routePath(MCP_PROBLEM_ROUTES.lophn_problem.more),
      "/v1/repair_context/more",
    );
    // 목록 밖 op는 없다. claim·닫힘·test result 입력 op도 없다(mcp#R25).
    for (const op of ["claim", "renew", "release", "close", "apply-decision"]) {
      assertEquals(
        problem.input.safeParse({ op, problem: PRB }).success,
        false,
      );
    }
  },
);

Deno.test(
  "coding-agent/mcp-server#R24: 요약·상세·snapshot 읽기는 owner read 입력을 그대로 쓴다",
  () => {
    assertEquals(
      tool("lophn_problem").input.safeParse({
        op: "list",
        limit: 101,
      }).success,
      false,
    );
    assertEquals(
      tool("lophn_problem").input.safeParse({
        op: "show",
        problem: "tkt_01h455vb4pex5v6nkc6gd5fdw1",
      }).success,
      false,
    );
    assertEquals(
      tool("lophn_problem").input.safeParse({
        op: "snapshot",
        snapshot: PRB,
      }).success,
      false,
    );
    // more는 정본 참조뿐이다. 임의 파일 경로 field는 owner object에 없다.
    assertEquals(
      tool("lophn_problem").input.safeParse({
        op: "more",
        problem: PRB,
        kind: "image",
        source: "/etc/passwd",
        path: "/etc",
      }).success,
      false,
    );
  },
);

Deno.test(
  "coding-agent/mcp-server#R25: record_fix와 test는 현재 ticket·claim_seq가 필수다",
  () => {
    const problem = tool("lophn_problem");
    // fixRecordInputSchema가 ticket·claim_seq를 필수로 묶는다(problems/repairs).
    problem.input.parse({ ...fixInput, op: "record_fix" });
    assertEquals(
      problem.input.safeParse({
        ...fixInput,
        fix: { ...fixInput.fix, ticket: null, claim_seq: null },
      }).success,
      false,
    );
    assertEquals(
      problem.input.safeParse({
        ...fixInput,
        fix: { ...fixInput.fix, after: fixInput.fix.before },
      }).success,
      false,
    );
    problem.input.parse({ ...testInput, op: "test" });
    // reproduction은 ticket이 null이어야 한다(problems/tests).
    assertEquals(
      problem.input.safeParse({
        ...testInput,
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
    assertEquals(
      problem.input.safeParse({
        ...testInput,
        op: "test",
        target: { bundle_hash: HASH, release: REL },
      }).success,
      false,
    );
    const request = commandRequestSchema(
      MCP_PROBLEM_ROUTES.lophn_problem.record_fix,
    )
      .parse({
        input: fixInput,
        idempotency_key: fixInput.idempotency_key,
        compare: { problem_seq: "12" },
        prepared: [],
      });
    assertEquals(request.compare.problem_seq, "12");
    assertEquals(MCP_PROBLEM_ROUTES.lophn_problem.record_fix.actors, [
      "coding_agent",
    ]);
  },
);

Deno.test(
  "coding-agent/mcp-server#R24, coding-agent/mcp-server#R25: CLI problem command는 14개다",
  () => {
    assertEquals(cliProblemNames, [
      "problem list",
      "problem show",
      "problem snapshot",
      "problem fix-records",
      "problem summary",
      "problem bundle",
      "problem more",
      "problem record-fix",
      "problem test",
      "problem attachment open",
      "problem report",
      "problem request-repair",
      "problem confirm",
      "problem dismiss",
    ]);
    cliProblemListSchema.parse({
      command: "problem list",
      app: APP,
      status: "fixing",
    });
    cliProblemShowSchema.parse({
      command: "problem show",
      problem: PRB,
      json: true,
    });
    cliProblemSnapshotSchema.parse({
      command: "problem snapshot",
      snapshot: `snp_${PRB.slice(4)}`,
      item: "logs",
    });
    cliProblemFixRecordsSchema.parse({
      command: "problem fix-records",
      problem: PRB,
      cursor: "4",
    });
    cliProblemSummarySchema.parse({
      command: "problem summary",
      selector: { ticket: TKT },
    });
    cliProblemBundleSchema.parse({
      command: "problem bundle",
      selector: { problem: PRB },
    });
    cliProblemMoreSchema.parse({
      command: "problem more",
      problem: PRB,
      kind: "source_diff",
      source: "rel-1..rel-2",
      cursor: "page-2",
    });
  },
);

Deno.test(
  "coding-agent/mcp-server#R25, coding-agent/cli#R26: CLI 쓰기는 claim 안 ticket 입력과 사람 전용 command를 구별한다",
  () => {
    cliProblemRecordFixSchema.parse({
      command: "problem record-fix",
      problem: PRB,
      fix: {
        before: REL,
        after: "rel_01h455vb4pex5v6nkc6gd5fdw2",
        summary: HASH,
        verification: [VRF],
        ticket: TKT,
        claim_seq: "12",
      },
      idempotency_key: "fix-1",
    });
    // ticket 없는 fix 기록은 owner input이 거절한다(mcp#R25).
    assertEquals(
      cliProblemRecordFixSchema.safeParse({
        command: "problem record-fix",
        problem: PRB,
        fix: {
          before: REL,
          after: "rel_01h455vb4pex5v6nkc6gd5fdw2",
          summary: HASH,
          verification: [],
          ticket: null,
          claim_seq: null,
        },
        idempotency_key: "fix-2",
      }).success,
      false,
    );
    cliProblemTestSchema.parse({
      command: "problem test",
      ...testInput,
    });
    // attachment open은 허용된 첨부 참조다.
    cliProblemAttachmentOpenSchema.parse({
      command: "problem attachment open",
      problem: PRB,
      snapshot: `snp_${PRB.slice(4)}`,
    });
    // 사람 전용 command는 결정 화면 안내용 선택값만 받는다(D27).
    cliProblemReportSchema.parse({
      command: "problem report",
      app: APP,
      symptom: "save 버튼이 동작하지 않는다",
    });
    cliProblemRequestRepairSchema.parse({
      command: "problem request-repair",
      problem: PRB,
    });
    cliProblemConfirmSchema.parse({
      command: "problem confirm",
      problem: PRB,
      evidence: "재현 절차가 통과했다",
    });
    cliProblemDismissSchema.parse({
      command: "problem dismiss",
      problem: PRB,
      reason: "이미 고쳐졌다",
      false_alarm: true,
    });
    // 코딩 credential 거절과 닫힘 입력은 이 schema에 없다.
    assertEquals(
      cliProblemDismissSchema.safeParse({
        command: "problem dismiss",
        problem: PRB,
        reason: "x",
        close: true,
      }).success,
      false,
    );
    assertEquals(
      cliProblemConfirmSchema.safeParse({
        command: "problem confirm",
        problem: PRB,
        evidence: "x",
        claim: {
          connection: "cac_01h455vb4pex5v6nkc6gd5fdw1",
          claim_seq: "12",
        },
      }).success,
      false,
    );
  },
);
