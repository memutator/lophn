// 문제의 사람 결정. app-detail Issues가 고른 결정·한 줄 이유로
// 창을 열면, 이 종류가 문제·활성 release·마지막 보고를 독립 read해 정본을 만든다. 표시와 제출은 같은
// 정본에 묶이고 renderer가 보낸 다른 값은 쓰지 않는다. 결정은 `ApplyProblemDecision`으로 보낸다.
// route binding이 [choice, problem, …]이라 handle의 대상은 고른 결정이다.
import type { LiveHandle } from "../handle.ts";
import type { ConfirmationIntent } from "../types.ts";
import {
  bindingOf,
  failed,
  type KindCore,
  type Read,
  readFailure,
  record,
  sendCommand,
  type Sent,
  text,
} from "./core.ts";

export const PROBLEM_CONCERN = "problems/closing";
/** contracts PROBLEM_DECISION(창을 여는 결정 이름). */
export const PROBLEM_DECISION = "problem_decision";
/** core가 handle 사용을 비교하는 결정 이름(= command route 이름). */
export const APPLY_PROBLEM_DECISION = "ApplyProblemDecision";

/** contracts applyProblemDecision의 binding. 첫 field가 handle 대상이다. */
const BINDING = [
  "choice",
  "problem",
  "basis_seq",
  "release",
  "last_report",
  "note",
] as const;

type Intent = Extract<ConfirmationIntent, { kind: "owner_decision" }>;

export function isProblemDecision(intent: Intent): boolean {
  return intent.concern === PROBLEM_CONCERN &&
    intent.decision === PROBLEM_DECISION && intent.targets?.length === 1 &&
    intent.choice !== undefined;
}

export async function readProblemDecision(
  core: KindCore,
  intent: Intent,
): Promise<Read> {
  const problem = intent.targets?.[0] ?? "";
  const choice = intent.choice!;
  const missing = failed("not_found", "이 문제를 찾지 못했다");
  const got = await core.internal("read", "problems", "get", { problem });
  if (!got.ok) return readFailure(got);
  const found = record(got.value);
  const shown = record(found.problem);
  const seq = text(shown.seq);
  const app = text(shown.app);
  if (shown.id !== problem || seq === null || app === null) return missing;
  const appRead = await core.internal("read", "apps", "get", { app });
  if (!appRead.ok) return readFailure(appRead);
  const release = text(record(record(appRead.value).app).active_release);
  let version: number | null = null;
  if (release !== null) {
    const rel = await core.internal("read", "releases", "get", { release });
    if (!rel.ok) return readFailure(rel);
    const number = record(record(rel.value).release).number;
    version = typeof number === "number" ? number : null;
  }
  let lastReport: string | null = null;
  if (choice === "not_visible") {
    const reports = await core.internal("read", "problems", "list-reports", {
      problem,
    });
    if (!reports.ok) return readFailure(reports);
    const list = record(reports.value).reports;
    // 최근 순이다. 첫 항목이 그 문제의 마지막 live 보고다.
    lastReport = Array.isArray(list) ? text(record(list[0]).id) : null;
  }
  const note = choice === "dismiss" ? intent.note ?? null : null;
  const closed = shown.status === "closed";
  // 닫은 문제는 다시 열기(not_fixed)만 받는다. contract가 거절할 결정은 고를 수 없게 둔다.
  const allowed = !(closed && choice !== "not_fixed") &&
    !(choice === "fixed" && release === null) &&
    !(choice === "not_visible" && (release === null || lastReport === null)) &&
    !(choice === "dismiss" && note === null);
  const bound = bindingOf(BINDING, {
    choice,
    problem,
    basis_seq: seq,
    release,
    last_report: lastReport,
    note,
  });
  const seen = found.report_count;
  return {
    ok: true,
    value: {
      targetRef: bound.target,
      content: bound.content,
      allowed: allowed ? [APPLY_PROBLEM_DECISION] : [],
      expiresAt: null,
      secondConfirm: false,
      request: {
        kind: "owner_decision",
        concern: PROBLEM_CONCERN,
        decision: PROBLEM_DECISION,
        targets: [problem],
        input: { kind: "inline", value: bound.content },
        comparison: { problem_seq: seq, release },
      },
      view: {
        kind: "problem_decision",
        choice,
        symptom: text(found.text) ?? "",
        ...(typeof seen === "number" ? { seen } : {}),
        version,
        note,
      },
    },
  };
}

/** handle을 만든 정본 그대로 보낸다. 닫힘이 생기면 결정 자체가 적용이다. */
export async function submitProblemDecision(
  core: KindCore,
  input: { handle: LiveHandle; content: Record<string, unknown> },
): Promise<Sent> {
  const content = input.content;
  const sent = await sendCommand(core, "problems", "apply-decision", {
    input: content,
    idempotency_key: `confirmation:${input.handle.ref}`,
    compare: { problem_seq: content.basis_seq, release: content.release },
    prepared: [],
    confirmation: input.handle.ref,
  });
  if (!sent.ok) return sent;
  return {
    ok: true,
    value: {
      receipt: { kind: "entity", id: String(content.problem) },
      result: "applied",
    },
  };
}
