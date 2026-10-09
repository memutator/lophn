// fake coding agent 수리 script(coding-agent#T47). repair ticket claim →
// summary·bundle·more → reproduction test → record_fix → lophn_app release_prepare
// → report. claim_seq·problem seq·fix seq·ticket revision은 앞 응답에서 채운다.
// 돌지 않은 test의 verification을 만들지 않는다. release_prepare는 release id를
// 돌려주지 않으므로 record_fix·report의 release는 호출자가 준 같은 id다.
import {
  type FakeAgentCall,
  type FakeAgentSession,
  type FakeAgentStep,
  openFakeCodingAgentSession,
} from "./mod.ts";

export const REPAIR_STAGES = [
  "claim",
  "summary",
  "bundle",
  "more",
  "reproduction",
  "record_fix",
  "release_prepare",
  "report",
] as const;

export type RepairStage = (typeof REPAIR_STAGES)[number];

export type RepairStepRecord = {
  stage: RepairStage | "show" | "problem_show";
  tool: string;
  op: string;
  input: Record<string, unknown>;
  isError: boolean;
  summary: string | null;
  code: string | null;
  data: Record<string, unknown>;
};

export type RepairScriptResult = {
  steps: RepairStepRecord[];
  stages: RepairStage[];
  claim_seq: string | null;
  problem_seq: string | null;
  fix_seq: string | null;
  report_state: string | null;
  completion_seq: string | null;
  halted_before: RepairStage | null;
};

export type RepairScriptOptions = {
  command: string;
  args: readonly string[];
  env?: Record<string, string>;
  cwd?: string;
  protocolVersion?: string;
  label?: string;
  ticket: string;
  base_revision: string;
  app: string;
  // summary가 문제를 주지 않을 때 more·reproduction이 쓰는 문제 id다.
  problem: string;
  before: string;
  // record_fix.after와 report release. release_prepare의 결과가 아니다.
  release: string;
  bundle_hash: string;
  reports: readonly string[];
  basis_seq: string;
  test: string;
  // record_fix·report에 같이 넣는 변경 설명이다.
  summary: string;
  commit: string;
  request_key?: string;
  release_request_key?: string;
  // 단계가 끝난 뒤. "stop"이면 다음 단계 전에 멈춘다.
  after?: (
    stage: RepairStage,
    step: RepairStepRecord,
  ) => void | "stop" | Promise<void | "stop">;
};

type Trace = {
  steps: RepairStepRecord[];
  stages: RepairStage[];
  halted_before: RepairStage | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function traceOf(
  stage: RepairStepRecord["stage"],
  call: FakeAgentCall,
): RepairStepRecord {
  const op = call.input.op;
  return {
    stage,
    tool: call.tool,
    op: typeof op === "string" ? op : "",
    input: call.input,
    isError: call.isError,
    summary: call.summary,
    code: call.code,
    data: call.data,
  };
}

function nextStage(stage: RepairStage): RepairStage | null {
  const index = REPAIR_STAGES.indexOf(stage);
  const following = REPAIR_STAGES[index + 1];
  return following ?? null;
}

function problemOf(
  data: Record<string, unknown>,
): { id: string; seq: string } | null {
  const summary = asRecord(data.summary);
  const problems = summary?.problems;
  if (!Array.isArray(problems) || problems.length === 0) return null;
  const first = asRecord(problems[0]);
  const id = text(first?.id);
  const seq = text(first?.seq);
  if (id === null || seq === null) return null;
  return { id, seq };
}

function moreOf(
  data: Record<string, unknown>,
  problem: string,
): {
  problem: string;
  evidence: string;
  source: string;
  cursor?: string | null;
} {
  const sections = asRecord(data.context)?.sections;
  if (Array.isArray(sections)) {
    for (const section of sections) {
      const more = asRecord(section)?.more;
      if (!Array.isArray(more)) continue;
      for (const item of more) {
        const ref = asRecord(item);
        const id = text(ref?.problem);
        const evidence = text(ref?.kind);
        const source = text(ref?.source);
        if (id === null || evidence === null || source === null) continue;
        const cursor = ref?.cursor;
        return {
          problem: id,
          evidence,
          source,
          ...(cursor === null || typeof cursor === "string" ? { cursor } : {}),
        };
      }
    }
  }
  return { problem, evidence: "log", source: `problem:${problem}` };
}

function verificationOf(step: RepairStepRecord): string[] {
  // 거절·pass가 아닌 응답에서 vrf id가 있을 때만 옮긴다. 없는 test를 만들지 않는다.
  if (step.isError) return [];
  const id = step.data.result_ref ?? step.data.verification ?? step.data.id;
  return typeof id === "string" && id.startsWith("vrf_") ? [id] : [];
}

function revisionOf(data: Record<string, unknown>, fallback: string): string {
  const revision = text(asRecord(data.ticket)?.revision);
  return revision ?? fallback;
}

function problemSeqOf(data: Record<string, unknown>): string | null {
  return text(asRecord(data.problem)?.seq);
}

function reportOf(step: RepairStepRecord): {
  state: string | null;
  completion_seq: string | null;
} {
  if (step.isError) return { state: null, completion_seq: null };
  const report = asRecord(step.data.report);
  const claim = asRecord(step.data.completion_claim);
  const state = report?.accepted === true ? text(report.state) : null;
  return {
    state,
    completion_seq: text(claim?.completion_seq),
  };
}

// 수리 순서 한 번. claim이 없으면 summary·bundle·more만 하고 쓰기 전에 멈춘다.
// 이후 단계의 거절(회수된 연결 등)은 기록하고 다음 단계로 간다.
export async function runRepairScript(
  options: RepairScriptOptions,
): Promise<RepairScriptResult> {
  const session = await openFakeCodingAgentSession(options);
  const trace: Trace = { steps: [], stages: [], halted_before: null };
  let claimSeq: string | null = null;
  let problemSeq: string | null = null;
  let fixSeq: string | null = null;
  let reportState: string | null = null;
  let completionSeq: string | null = null;
  try {
    const claim = await runStage(session, trace, options, "claim", {
      kind: "claim",
      ticket: options.ticket,
      base_revision: options.base_revision,
    });
    if (claim === "stop") return resultOf(trace, null, null, null, null, null);
    claimSeq = text(trace.steps.at(-1)?.data.claim_seq);

    const summary = await runStage(session, trace, options, "summary", {
      kind: "summary",
      selector: { ticket: options.ticket },
    });
    if (summary === "stop") {
      return resultOf(trace, claimSeq, null, null, null, null);
    }
    const summarized = problemOf(trace.steps.at(-1)?.data ?? {});
    const problem = summarized?.id ?? options.problem;
    problemSeq = summarized?.seq ?? null;

    const bundle = await runStage(session, trace, options, "bundle", {
      kind: "bundle",
      selector: { ticket: options.ticket },
    });
    if (bundle === "stop") {
      return resultOf(trace, claimSeq, problemSeq, null, null, null);
    }
    const evidence = moreOf(trace.steps.at(-1)?.data ?? {}, problem);

    const more = await runStage(session, trace, options, "more", {
      kind: "more",
      problem: evidence.problem,
      evidence: evidence.evidence,
      source: evidence.source,
      ...(evidence.cursor === undefined ? {} : { cursor: evidence.cursor }),
    });
    if (more === "stop" || claimSeq === null) {
      if (claimSeq === null) trace.halted_before = "reproduction";
      return resultOf(trace, claimSeq, problemSeq, null, null, null);
    }

    const reproduction = await runStage(
      session,
      trace,
      options,
      "reproduction",
      {
        kind: "reproduction",
        body: {
          ticket_source: { ticket: options.ticket, claim_seq: claimSeq },
          request_key: options.request_key ?? "repro-1",
          kind: "reproduction",
          app: options.app,
          target: {
            bundle_hash: options.bundle_hash,
            release: options.release,
          },
          problem,
          basis_seq: options.basis_seq,
          reports: [...options.reports],
          before: options.before,
          after: options.release,
          ticket: null,
          test: options.test,
        },
      },
    );
    if (reproduction === "stop") {
      return resultOf(trace, claimSeq, problemSeq, null, null, null);
    }
    const verifications = verificationOf(trace.steps.at(-1)!);

    const shownProblem = await side(session, trace, "problem_show", {
      kind: "problem_show",
      problem,
    });
    problemSeq = problemSeqOf(shownProblem.data) ?? problemSeq;

    const recorded = await runStage(session, trace, options, "record_fix", {
      kind: "record_fix",
      body: {
        problem,
        problem_seq: problemSeq ?? "",
        fix: {
          before: options.before,
          after: options.release,
          verification: verifications,
          ticket: options.ticket,
          claim_seq: claimSeq,
        },
        summary: options.summary,
      },
    });
    if (recorded === "stop") {
      return resultOf(trace, claimSeq, problemSeq, null, null, null);
    }
    fixSeq = text(trace.steps.at(-1)?.data.seq);

    const prepared = await runStage(
      session,
      trace,
      options,
      "release_prepare",
      {
        kind: "release_prepare",
        body: {
          app: options.app,
          commit: options.commit,
          request_key: options.release_request_key ?? "repair-release-1",
          ticket_source: { ticket: options.ticket, claim_seq: claimSeq },
        },
      },
    );
    if (prepared === "stop") {
      return resultOf(trace, claimSeq, problemSeq, fixSeq, null, null);
    }

    // report CAS. claim이 revision을 claim_seq로 두고 record_fix는 ticket을 고치지 않는다.
    const shown = await side(session, trace, "show", {
      kind: "show",
      ticket: options.ticket,
    });
    const reported = await runStage(session, trace, options, "report", {
      kind: "report",
      ticket: options.ticket,
      claim_seq: claimSeq,
      base_revision: revisionOf(shown.data, claimSeq),
      release: options.release,
      summary: options.summary,
      fix_records: fixSeq === null ? [] : [fixSeq],
      ...(verifications.length === 0 ? {} : { verifications }),
    });
    if (reported === "stop") {
      return resultOf(trace, claimSeq, problemSeq, fixSeq, null, null);
    }
    const report = reportOf(trace.steps.at(-1)!);
    reportState = report.state;
    completionSeq = report.completion_seq;
    return resultOf(
      trace,
      claimSeq,
      problemSeq,
      fixSeq,
      reportState,
      completionSeq,
    );
  } finally {
    await session.close();
  }
}

async function runStage(
  session: FakeAgentSession,
  trace: Trace,
  options: RepairScriptOptions,
  stage: RepairStage,
  step: FakeAgentStep,
): Promise<"stop" | "go"> {
  const call = await session.call(step);
  const traced = traceOf(stage, call);
  trace.steps.push(traced);
  trace.stages.push(stage);
  if (options.after) {
    const decision = await options.after(stage, traced);
    if (decision === "stop") {
      trace.halted_before = nextStage(stage);
      return "stop";
    }
  }
  return "go";
}

async function side(
  session: FakeAgentSession,
  trace: Trace,
  stage: "show" | "problem_show",
  step: FakeAgentStep,
): Promise<RepairStepRecord> {
  const call = await session.call(step);
  const traced = traceOf(stage, call);
  trace.steps.push(traced);
  return traced;
}

function resultOf(
  trace: Trace,
  claimSeq: string | null,
  problemSeq: string | null,
  fixSeq: string | null,
  reportState: string | null,
  completionSeq: string | null,
): RepairScriptResult {
  return {
    steps: trace.steps,
    stages: trace.stages,
    claim_seq: claimSeq,
    problem_seq: problemSeq,
    fix_seq: fixSeq,
    report_state: reportState,
    completion_seq: completionSeq,
    halted_before: trace.halted_before,
  };
}
