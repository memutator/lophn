// 수리 자료 조립(repair-context#R1, R2, R18, R20). 요청마다 현재 정본을 port로 읽어 summary와
// bundle을 만든다. 읽기만 하고(claim·문제·ticket 상태 무변경) 완성 묶음을 저장하지 않는다.
// 전체 묶음 byte·줄 예산, 추가 근거 페이지, cursor, 이미지는 T43이 맡는다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  REPAIR_CONTEXT_BYTES,
  REPAIR_CONTEXT_LINES,
  REPAIR_CONTEXT_SUMMARY_MAX_CHARS,
  type RepairContext,
  RepairContextSchema,
  type RepairContextSection,
  type RepairEvidenceSource,
} from "../../contracts/coding-agent/mod.ts";
import type { ProblemSummary } from "../../contracts/problems/mod.ts";
import {
  type OccurrenceFacts,
  type ProblemFacts,
  type ProblemOut,
  readReason,
  type RepairReadPort,
  type RepairTarget,
  type TargetFacts,
  UNREADABLE_MESSAGE,
} from "./model.ts";
import { buildSections } from "./sections.ts";
import { reduceSections, renderSections } from "./budget.ts";
import {
  type Fingerprint,
  type OccurrenceCandidate,
  selectRepresentatives,
} from "./select.ts";
import { clipCodePoints, inlineFence, lineCount, utf8Bytes } from "./text.ts";

// 보고 목록은 한 쪽이 100건이다. 쪽 수 상한을 넘으면 더 읽을 수 있는 보고가 남은 것으로 표시한다.
export const REPORT_LIST_PAGES = 5;
// 상세를 읽어 비교하는 발생 수의 상한. 넘으면 접수 순서에 고르게 뽑되 첫·마지막은 항상 넣는다.
export const OCCURRENCE_SCAN_LIMIT = 16;
const HUMAN_TEXT_BYTES = 8_192;
const LOG_BYTES = 65_536;
const SUMMARY_MAX_PROBLEMS = 5;

export type RepairSummary = {
  app: string;
  ticket: string | null;
  problems: ProblemSummary[];
  observed_at: string;
  truncated: boolean;
};

export type AssembledRepair = {
  as_of_seq: string;
  summary: RepairSummary;
  // 전체 상한(24,576 bytes·300줄) 안에서 만든 bundle이다. 절을 줄이고도(budget.ts) 상한을 넘으면
  // null이고 over_budget에 센 값이 있다.
  context: RepairContext | null;
  over_budget: { bytes: number; lines: number } | null;
};

function unreadable(): Result<never> {
  return err({ code: "not_found", message: UNREADABLE_MESSAGE });
}

// 없음·범위 밖은 같은 not_found이고 그 밖의 읽기 실패는 일시 장애다.
function failure(error: { code: string }): Result<never> {
  return error.code === "not_found" || error.code === "forbidden"
    ? unreadable()
    : err({ code: "unavailable", message: "수리 자료를 읽지 못했다" });
}

// 접수 순서 오름차순 목록에서 첫·마지막을 포함해 고르게 뽑은 위치다.
export function scanIndexes(count: number, limit: number): number[] {
  if (count <= limit) return Array.from({ length: count }, (_, i) => i);
  const picked = new Set<number>();
  for (let i = 0; i < limit; i += 1) {
    picked.add(Math.round(i * (count - 1) / (limit - 1)));
  }
  return [...picked].sort((a, b) => a - b);
}

function fingerprintOf(
  report: OccurrenceFacts["report"],
  detail: OccurrenceFacts["detail"],
  invocation: OccurrenceFacts["invocation"],
): Fingerprint {
  const snapshot = detail.ok ? detail.value.snapshot : null;
  const kinds = snapshot === null ? [] : [
    snapshot.invocation !== null ? "invocation" : null,
    snapshot.error !== null ? "error" : null,
    snapshot.logs !== null ? "logs" : null,
    snapshot.screen !== null ? "screen" : null,
  ].filter((kind): kind is string => kind !== null).sort();
  const frame = snapshot?.error?.frames[0];
  const operation = invocation !== null && invocation.ok &&
      invocation.value.invocation !== null
    ? invocation.value.invocation.operation
    : null;
  return {
    release: report.release,
    command: operation === null
      ? null
      : operation.kind === "command"
      ? operation.command
      : operation.kind,
    evidence: kinds.join(","),
    stack: frame === undefined ? null : `${frame.path}:${frame.line ?? "?"}`,
  };
}

async function gatherProblem(
  port: RepairReadPort,
  id: string,
  known?: Result<ProblemOut>,
): Promise<ProblemFacts> {
  const problem = known ?? await port.problem(id);
  const empty = (
    reports: ProblemFacts["reports"],
  ): ProblemFacts => ({
    id,
    problem,
    reports,
    occurrences: [],
    sampled: false,
    representatives: [],
    first_release: null,
    fixes: err({ code: "not_found", message: UNREADABLE_MESSAGE }),
    verifications: err({ code: "not_found", message: UNREADABLE_MESSAGE }),
  });
  if (!problem.ok) {
    return empty({ listed: [], complete: true, error: null });
  }
  const app = problem.value.problem.app;
  const listed: OccurrenceFacts["report"][] = [];
  let cursor: string | undefined;
  let complete = false;
  let listError: string | null = null;
  for (let page = 0; page < REPORT_LIST_PAGES; page += 1) {
    const read = await port.reports(id, cursor);
    if (!read.ok) {
      listError = `보고 목록: ${readReason(read)}`;
      break;
    }
    listed.push(...read.value.reports);
    if (read.value.next_cursor === null) {
      complete = true;
      break;
    }
    cursor = read.value.next_cursor;
  }
  // 목록은 최신순이다. 접수 순서(오름차순)로 뒤집는다.
  listed.reverse();
  const indexes = scanIndexes(listed.length, OCCURRENCE_SCAN_LIMIT);
  const occurrences: OccurrenceFacts[] = await Promise.all(
    indexes.map(async (index): Promise<OccurrenceFacts> => {
      const report = listed[index];
      const detail = await port.report(report.id);
      const invocationId = detail.ok
        ? detail.value.snapshot?.invocation?.id ?? null
        : null;
      const invocation = invocationId === null
        ? null
        : await port.invocation(invocationId);
      return {
        report,
        rank: index + 1,
        detail,
        invocation,
        fingerprint: fingerprintOf(report, detail, invocation),
        human_text: null,
        logs: null,
      };
    }),
  );
  const candidates: OccurrenceCandidate[] = occurrences.map((item) => ({
    id: item.report.id,
    rank: item.rank,
    fingerprint: item.fingerprint,
  }));
  const chosen = selectRepresentatives(candidates);
  const representatives = chosen.map((pick) =>
    occurrences.find((item) => item.report.id === pick.id)!
  );
  for (const item of representatives) {
    const text = item.detail.ok ? item.detail.value.report.text : null;
    if (text !== null) {
      item.human_text = await port.blob(
        {
          owner_kind: "report",
          owner_key: item.report.id,
          field: "report_text",
        },
        HUMAN_TEXT_BYTES,
      );
    }
    const logs = item.detail.ok ? item.detail.value.snapshot?.logs : null;
    if (logs !== null && logs !== undefined) {
      item.logs = await port.blob(
        {
          owner_kind: "report",
          owner_key: item.report.id,
          field: "snapshot_logs",
        },
        LOG_BYTES,
      );
    }
  }
  const firstRelease = problem.value.first_release;
  const [first_release, fixes, verifications] = await Promise.all([
    firstRelease === null ? Promise.resolve(null) : port.release(firstRelease),
    port.fixes(id),
    port.verifications(app, id),
  ]);
  return {
    id,
    problem,
    reports: { listed, complete, error: listError },
    occurrences,
    sampled: indexes.length < listed.length,
    representatives,
    first_release,
    fixes,
    verifications,
  };
}

function basisOf(facts: TargetFacts): RepairEvidenceSource[] {
  const basis: RepairEvidenceSource[] = [];
  for (const problem of facts.problems) {
    if (problem.problem.ok) {
      basis.push({
        concern: "problems",
        id: problem.id,
        event_seq: problem.problem.value.problem.seq,
      });
    }
  }
  if (facts.ticket !== null && facts.ticket.ok) {
    basis.push({
      concern: "tickets",
      id: facts.ticket.value.ticket.id,
      event_seq: facts.ticket.value.ticket.revision,
    });
  }
  for (const problem of facts.problems) {
    if (problem.first_release !== null && problem.first_release.ok) {
      const release = problem.first_release.value.release;
      if (release !== null) {
        basis.push({
          concern: "apps",
          id: release.id,
          version: String(release.number),
        });
      }
    }
  }
  return basis;
}

// 최종 텍스트. 절 사이 구분과 가용성 표시를 포함해 bytes·줄을 센다.
export function renderBundleText(
  context: Pick<RepairContext, "observed_at" | "sections">,
): string {
  return renderSections(context.sections);
}

function limitsOf(sections: RepairContextSection[], problem: string): string {
  const limits = sections.filter((section) =>
    section.problem === problem && section.availability !== "available"
  ).map((section) => `${section.kind}:${section.availability}`);
  return limits.length === 0 ? "" : ` [limits ${limits.join(",")}]`;
}

async function summarize(
  port: RepairReadPort,
  facts: TargetFacts,
  sections: RepairContextSection[],
  truncated: boolean,
): Promise<RepairSummary> {
  const readable = facts.problems.filter((item) => item.problem.ok);
  const shown = readable.slice(0, SUMMARY_MAX_PROBLEMS);
  const share = Math.floor(REPAIR_CONTEXT_SUMMARY_MAX_CHARS / shown.length) -
    180;
  const problems: ProblemSummary[] = [];
  for (const item of shown) {
    const read = (item.problem as { ok: true; value: ProblemOut }).value;
    const text = read.text === null ? null : await port.redact(read.text);
    const symptom = read.text === null
      ? "symptom missing"
      : text === null
      ? "symptom redacted"
      : inlineFence("symptom", clipCodePoints(text, Math.max(20, share)).text);
    const evidence = item.representatives.length === 0
      ? " [occurrences missing]"
      : "";
    problems.push({
      id: item.id,
      app: read.problem.app,
      status: read.problem.status,
      symptom: `${symptom}${evidence}${limitsOf(sections, item.id)}`.replace(
        /[\r\n]+/g,
        " ",
      ),
      next_action: "read: repair_context bundle " +
        (facts.problems.length > shown.length ||
            readable.length < facts.problems.length
          ? `(요약에 ${shown.length}/${facts.problems.length}개 문제만 보임: 나머지는 문제 하나씩 또는 bundle로 읽는다)`
          : `for ${item.id}`),
      seq: read.problem.seq,
    });
  }
  // 식별·상태·이어 읽기도 summary 두 줄의 문자 예산에 포함한다. fence는 통째로 유지한다.
  for (const item of problems) {
    const limit = Math.floor(
      REPAIR_CONTEXT_SUMMARY_MAX_CHARS / problems.length,
    );
    const fixed =
      Array.from(`${item.id} ${item.status}\n${item.next_action}`).length;
    if (Array.from(item.symptom).length + fixed > limit) {
      item.next_action = `read repair_context bundle ${item.id}`;
      const room = limit -
        Array.from(`${item.id} ${item.status}\n${item.next_action}`).length -
        Array.from(inlineFence("symptom", "")).length;
      item.symptom = inlineFence(
        "symptom",
        clipCodePoints("summary truncated; limits present", Math.max(0, room))
          .text,
      );
      truncated = true;
    }
  }
  return {
    app: facts.app,
    ticket: facts.ticket !== null && facts.ticket.ok
      ? facts.ticket.value.ticket.id
      : null,
    problems,
    observed_at: facts.observed_at,
    truncated: truncated || readable.length < facts.problems.length ||
      shown.length < readable.length,
  };
}

export async function assembleRepairContext(
  port: RepairReadPort,
  target: RepairTarget,
): Promise<Result<AssembledRepair>> {
  const observed_at = port.now();
  let app: string;
  let ticket: TargetFacts["ticket"] = null;
  let problemIds: string[];
  let first: Result<ProblemOut> | undefined;
  if ("ticket" in target) {
    const read = await port.ticket(target.ticket);
    if (!read.ok) return failure(read.error);
    ticket = read;
    app = read.value.ticket.app;
    problemIds = read.value.ticket.problems;
  } else {
    first = await port.problem(target.problem);
    if (!first.ok) return failure(first.error);
    app = first.value.problem.app;
    problemIds = [target.problem];
  }
  if (problemIds.length === 0) return unreadable();
  const requested = "problem" in target ? target.problem : null;
  const problems: ProblemFacts[] = [];
  for (const id of problemIds) {
    problems.push(
      await gatherProblem(port, id, id === requested ? first : undefined),
    );
  }
  if (!problems.some((item) => item.problem.ok)) return unreadable();
  const as_of_seq = problems.reduce(
    (seq, item) =>
      item.problem.ok && BigInt(item.problem.value.as_of_seq) > BigInt(seq)
        ? item.problem.value.as_of_seq
        : seq,
    "0",
  );
  const [same_app, releases] = await Promise.all([
    port.problems(app),
    port.releases(app),
  ]);
  const facts: TargetFacts = {
    app,
    ticket,
    problems,
    related: { same_app },
    releases,
    observed_at,
  };
  const built = await buildSections({
    facts,
    redact: (text) => port.redact(text),
  });
  built.sections = reduceSections(built.sections);
  const truncated = built.skipped.length > 0 ||
    built.sections.some((section) => section.availability === "truncated");
  const text = renderBundleText({ observed_at, sections: built.sections });
  const bytes = utf8Bytes(text);
  const lines = lineCount(text);
  const summary = await summarize(port, facts, built.sections, truncated);
  const parsed = RepairContextSchema.safeParse({
    app,
    ticket: ticket !== null && ticket.ok ? ticket.value.ticket.id : null,
    problems: problemIds,
    observed_at,
    basis: basisOf(facts),
    sections: built.sections,
    truncated,
    bytes,
    lines,
  });
  if (!parsed.success) {
    if (bytes > REPAIR_CONTEXT_BYTES || lines > REPAIR_CONTEXT_LINES) {
      return ok({
        as_of_seq,
        summary,
        context: null,
        over_budget: { bytes, lines },
      });
    }
    return err({
      code: "internal",
      message: "수리 자료 조립 결과가 contract에 맞지 않는다",
    });
  }
  return ok({ as_of_seq, summary, context: parsed.data, over_budget: null });
}
