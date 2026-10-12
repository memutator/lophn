// 15절 조립(repair-context#R3-R10, R18, R19). 절 순서는 contracts의 SECTION_KINDS가 정하고
// 줄·자·개수 상한은 SECTION_LIMITS를 쓴다. 사람 말·앱 문자열·log 원문은 모두 redaction을
// 지난 뒤 data fence 안에만 둔다. 빠진 근거는 빠졌다고 적고 채우지 않는다.
import {
  type RepairContextSection,
  type RepairEvidenceSource as EvidenceSource,
  SECTION_KINDS,
  SECTION_LIMITS,
} from "../../protocol/coding-agent/mod.ts";
import { Draft } from "./draft.ts";
import {
  type BlobText,
  type OccurrenceFacts,
  type ProblemFacts,
  readReason,
  type TargetFacts,
  type TicketOut,
} from "./model.ts";
import {
  allocate,
  PRECEDING_WINDOW_MS,
  selectPrecedingChanges,
} from "./select.ts";
import {
  clipCodePoints,
  codePointCount,
  fenceBlock,
  fitLines,
  inlineFence,
  logicalLines,
} from "./text.ts";

type Redact = (text: string) => Promise<string | null>;

export type SectionContext = {
  facts: TargetFacts;
  redact: Redact;
};

const L = SECTION_LIMITS;
// 머리 정보는 6줄 이하다(repair-context#R4).
const HEAD_LINES = 6;
const REDACTED_REASON = "redaction이 이 자료를 통과시키지 않아 내용을 뺐다";
const NO_BLOB_PATH = "이 연결로 읽는 blob 통로가 없다";

function src(concern: string, id?: string): EvidenceSource {
  return id === undefined ? { concern } : { concern, id };
}

function problemOf(
  facts: TargetFacts,
): { ticketId: string | null; single: string | null } {
  const ticket = facts.ticket !== null && facts.ticket.ok
    ? facts.ticket.value.ticket.id
    : null;
  return {
    ticketId: ticket,
    single: facts.problems.length === 1 ? facts.problems[0].id : null,
  };
}

// 읽을 수 없는 문제는 없는 문제와 같은 문장이다(connection#R5).
function readable(problem: ProblemFacts): boolean {
  return problem.problem.ok;
}

async function safe(redact: Redact, text: string): Promise<string | null> {
  return await redact(text);
}

function describeBlob(blob: BlobText | null): string | null {
  if (blob === null) return null;
  return blob.kind === "unavailable" ? blob.reason : null;
}

function atOf(text: string | null | undefined): string {
  return text ?? "unknown";
}

// ---- 머리와 증상 -----------------------------------------------------------------

function headSection(facts: TargetFacts): RepairContextSection | null {
  const draft = new Draft("target_symptom", null, HEAD_LINES);
  // 머리 정보는 6줄 이하다(repair-context#R4). target_symptom 절의 문제 없는 공통 머리다.
  const lines: string[] = [];
  const ticket = facts.ticket;
  let target =
    "investigation (ticket 없음: 조사만, code 작업은 ticket 생성·MCP claim 뒤)";
  if (ticket !== null) {
    if (ticket.ok) {
      const value = ticket.value.ticket;
      const claim = value.claim === null
        ? "claim 없음"
        : `claim ${value.claim.connection} claim_seq ${value.claim.claim_seq} until ${value.claim.expires_at}`;
      target =
        `ticket ${value.id} state ${value.state} readiness ${value.readiness}; ${claim}`;
      draft.source(src("tickets", value.id));
    } else {
      target = `ticket ${readReason(ticket)}`;
      draft.forbidden(readReason(ticket)!);
    }
  }
  lines.push(`app ${facts.app}; ${target}`);
  lines.push(
    `observed_at ${facts.observed_at} (요청마다 현재 정본에서 조립, 저장 없음)`,
  );
  for (const problem of facts.problems) {
    if (!problem.problem.ok) {
      lines.push(`${problem.id}: ${readReason(problem.problem)}`);
      continue;
    }
    const read = problem.problem.value;
    const release = read.first_release;
    const last = read.last_release;
    const commit = problem.first_release !== null && problem.first_release.ok &&
        problem.first_release.value.release !== null
      ? problem.first_release.value.release.code_commit
      : null;
    lines.push(
      `${problem.id} [${read.problem.status}] reports ${read.report_count}; first ${
        atOf(read.first_observed_at)
      } last ${atOf(read.last_observed_at)}; release ${release ?? "unknown"}${
        last !== null && last !== release ? ` -> ${last}` : ""
      }; base commit ${commit ?? "unknown"}`,
    );
    draft.source(src("problems", problem.id));
  }
  const fitted = fitLines(
    lines,
    HEAD_LINES,
    (count) => `... ${count}줄 생략(머리 ${HEAD_LINES}줄 한도)`,
  );
  draft.extend(fitted.lines);
  if (fitted.omitted > 0) {
    draft.truncated(`머리에서 ${fitted.omitted}줄 생략`);
  }
  // cap은 위에서 이미 맞췄으므로 Draft의 fitLines는 변하지 않는다.
  return draft.finish({
    source: src("problems"),
    more: {
      kind: "reference",
      source: `app:${facts.app}`,
      problem: facts.problems[0].id,
    },
  });
}

async function symptomSection(
  ctx: SectionContext,
  problem: ProblemFacts,
  lines: number,
): Promise<RepairContextSection | null> {
  const draft = new Draft("target_symptom", problem.id, lines);
  draft.source(src("problems", problem.id));
  if (!problem.problem.ok) {
    draft.forbidden(readReason(problem.problem)!);
    return draft.finish(fallback(problem.id, "reference"));
  }
  const read = problem.problem.value;
  const symptom = await safe(ctx.redact, read.text ?? "");
  let line = `${problem.id} [${read.problem.status}] `;
  if (read.text === null) {
    draft.missing("증상 문구를 읽지 못했다");
    line += "symptom missing";
  } else if (symptom === null) {
    draft.redacted(REDACTED_REASON);
    line += "symptom redacted";
  } else {
    line += inlineFence("symptom", clipCodePoints(symptom, 200).text);
  }
  const ticket = ctx.facts.ticket;
  if (ticket !== null && ticket.ok) {
    const title = await safe(ctx.redact, ticket.value.ticket.title);
    line += title === null
      ? " ticket title redacted"
      : ` ticket ${ticket.value.ticket.id} ${
        inlineFence("ticket_title", clipCodePoints(title, 80).text)
      }`;
    if (title === null) draft.redacted(REDACTED_REASON);
  }
  draft.line(line);
  return draft.finish(fallback(problem.id, "reference"));
}

function fallback(problem: string, kind: "reference" | "occurrences") {
  return {
    source: src("problems", problem),
    more: { kind, source: `problem:${problem}`, problem },
  };
}

// ---- 사람 말 ---------------------------------------------------------------------

async function humanTextSection(
  ctx: SectionContext,
  problem: ProblemFacts,
  lines: number,
  chars: number,
): Promise<RepairContextSection | null> {
  const draft = new Draft("human_text", problem.id, lines);
  const withText = problem.representatives.concat(
    problem.occurrences.filter((item) =>
      !problem.representatives.includes(item)
    ),
  ).filter((item) => item.detail.ok && item.detail.value.report.text !== null);
  if (withText.length === 0) return null;
  const pick = withText.find((item) => item.human_text !== null) ??
    withText[0];
  const report = pick.report.id;
  draft.source(src("problems", report));
  const blob = pick.human_text;
  if (blob === null || blob.kind === "unavailable") {
    draft.missing(
      `${report} 사람 원문을 읽지 못했다: ${
        blob === null ? NO_BLOB_PATH : blob.reason
      }`,
    );
    draft.line(`${report} human text not read`);
    return draft.finish(fallback(problem.id, "occurrences"));
  }
  const text = await safe(ctx.redact, blob.text);
  if (text === null) {
    draft.redacted(REDACTED_REASON);
    draft.line(`${report} human text redacted`);
    return draft.finish(fallback(problem.id, "occurrences"));
  }
  const fenced = lines >= 3
    ? fenceBlock(`human_text ${report}`, text, {
      maxDataLines: lines - 2,
      maxChars: chars,
    })
    : undefined;
  if (fenced !== undefined) {
    draft.extend(fenced.lines);
    if (fenced.clipped || blob.truncated) {
      draft.truncated(
        `원문 ${fenced.original_chars}자 ${fenced.original_lines}줄 중 일부만 보인다`,
        {
          problem: problem.id,
          kind: "occurrences",
          source: `report:${report}`,
          cursor: null,
        },
      );
    }
  } else {
    const clipped = clipCodePoints(text, chars);
    draft.line(inlineFence(`human_text ${report}`, clipped.text));
    if (clipped.clipped || blob.truncated) {
      draft.truncated("원문 일부만 보인다", {
        problem: problem.id,
        kind: "occurrences",
        source: `report:${report}`,
        cursor: null,
      });
    }
  }
  return draft.finish(fallback(problem.id, "occurrences"));
}

// ---- ticket 절: 볼 곳·acceptance·지킬 것 ----------------------------------------

type TicketValue = TicketOut["ticket"];

function referenceLine(ref: TicketValue["references"][number]): string {
  if (ref.address !== null) {
    const a = ref.address;
    return `version ${ref.target} ${a.place}/${a.document}${
      a.section !== null ? `#${a.section}` : ""
    }${a.version !== null ? `@${a.version}` : ""}`;
  }
  return `${ref.kind} ${ref.target}`;
}

function ticketOf(facts: TargetFacts): TicketValue | null {
  return facts.ticket !== null && facts.ticket.ok
    ? facts.ticket.value.ticket
    : null;
}

function inspectSection(facts: TargetFacts): RepairContextSection | null {
  const ticket = ticketOf(facts);
  if (ticket === null) return null;
  const draft = new Draft("inspect", null, L.inspect.lines);
  draft.source(src("tickets", ticket.id));
  const items = [
    ...ticket.references.map(referenceLine),
    ...ticket.inspect.map((path) => `path ${path}`),
  ];
  if (items.length === 0) {
    draft.missing("ticket이 볼 곳과 고정 근거를 아직 정하지 않았다");
    return draft.finish(ticketFallback(facts, ticket.id));
  }
  const shown = items.slice(0, L.inspect.sources);
  draft.extend(shown);
  if (items.length > shown.length) {
    draft.line(
      `... ${
        items.length - shown.length
      }개 더: tickets/show ${ticket.id} references·inspect`,
    );
    draft.truncated(`볼 곳 ${items.length}개 중 ${shown.length}개만 보인다`, {
      problem: facts.problems[0].id,
      kind: "reference",
      source: `ticket:${ticket.id}`,
      cursor: null,
    });
  }
  return draft.finish(ticketFallback(facts, ticket.id));
}

function ticketFallback(facts: TargetFacts, ticket: string) {
  return {
    source: src("tickets", ticket),
    more: {
      kind: "reference" as const,
      source: `ticket:${ticket}`,
      problem: facts.problems[0].id,
    },
  };
}

// 요약과 전체 읽을 곳을 합쳐 maxChars(code point)를 넘기지 않는다. 읽을 곳은 항상 남는다.
function summaryText(
  head: string,
  maxChars: number,
  fullRead: string[],
): { lines: string[]; clipped: boolean } {
  const fixed = fullRead.join("\n");
  const room = Math.max(0, maxChars - codePointCount(fixed) - 1);
  const clip = clipCodePoints(head, room);
  return { lines: [clip.text, ...fullRead], clipped: clip.clipped };
}

function conditionsSection(facts: TargetFacts): RepairContextSection | null {
  const ticket = ticketOf(facts);
  if (ticket === null) return null;
  const draft = new Draft("acceptance_checks", null, L.acceptance_checks.lines);
  draft.source(src("tickets", ticket.id));
  if (ticket.conditions.length === 0) {
    draft.missing("ticket에 acceptance check가 아직 없다");
    return draft.finish(ticketFallback(facts, ticket.id));
  }
  const full = [
    `full: tickets/show ${ticket.id} conditions[0..${
      ticket.conditions.length - 1
    }]`,
  ];
  if (ticket.conditions.some((item) => item.kind === "problems_closed")) {
    full.push("closing: problems/closing (problems_closed)");
  }
  const head = `conditions(${ticket.conditions.length}): ${
    ticket.conditions.map((item) => `#${item.position} ${item.kind}`).join(" ")
  }`;
  const built = summaryText(head, L.acceptance_checks.chars, full);
  draft.extend(built.lines);
  if (built.clipped) {
    draft.truncated("조건 요약이 200자 한도로 잘렸다", {
      problem: facts.problems[0].id,
      kind: "reference",
      source: `ticket:${ticket.id}`,
      cursor: null,
    });
  }
  return draft.finish(ticketFallback(facts, ticket.id));
}

function preserveSection(facts: TargetFacts): RepairContextSection | null {
  const ticket = ticketOf(facts);
  if (ticket === null) return null;
  const draft = new Draft("preserve", null, L.preserve.lines);
  draft.source(src("tickets", ticket.id));
  const full = [`full: tickets/show ${ticket.id} preserve`];
  const head = ticket.preserve.length === 0
    ? "preserve(0): ticket이 지킬 것을 지정하지 않았다"
    : `preserve(${ticket.preserve.length}): ${ticket.preserve.join(" ")}`;
  const built = summaryText(head, L.preserve.chars, full);
  draft.extend(built.lines);
  if (built.clipped) {
    draft.truncated("유지 제약 요약이 200자 한도로 잘렸다", {
      problem: facts.problems[0].id,
      kind: "reference",
      source: `ticket:${ticket.id}`,
      cursor: null,
    });
  }
  return draft.finish(ticketFallback(facts, ticket.id));
}

// ---- 발생 근거와 실패 invocation -------------------------------------------------

function errorOf(item: OccurrenceFacts) {
  return item.detail.ok ? item.detail.value.snapshot?.error ?? null : null;
}

async function failureSection(
  ctx: SectionContext,
  problem: ProblemFacts,
  lines: number,
): Promise<RepairContextSection | null> {
  if (!readable(problem)) return null;
  const draft = new Draft("failure_basis", problem.id, lines);
  const read = problem.problem.ok ? problem.problem.value : null;
  draft.source(src("problems", problem.id));
  const release = problem.first_release !== null && problem.first_release.ok
    ? problem.first_release.value.release
    : null;
  draft.line(
    `occurred ${atOf(read?.first_observed_at)} .. ${
      atOf(read?.last_observed_at)
    } release ${read?.first_release ?? "unknown"}; source line numbers use ${
      release === null ? "commit unknown" : `commit ${release.code_commit}`
    }`,
  );
  if (read?.first_release === null) {
    draft.missing("보고가 release를 모른다");
  } else if (release === null && problem.first_release !== null) {
    draft.missing(
      problem.first_release.ok
        ? "발생 release 기록이 없다"
        : `발생 release: ${readReason(problem.first_release)}`,
    );
  }
  const item = problem.representatives[0];
  if (item === undefined) {
    draft.missing("읽은 발생이 없어 당시 실패 근거가 없다");
    return draft.finish(fallback(problem.id, "occurrences"));
  }
  draft.source(src("problems", item.report.id));
  if (!item.detail.ok) {
    draft.missing(`${item.report.id}: ${readReason(item.detail)}`);
    return draft.finish(fallback(problem.id, "occurrences"));
  }
  const detail = item.detail.value;
  const error = errorOf(item);
  // error와 invocation이 남은 줄을 반씩 쓴다.
  const errorRoom = Math.floor((lines - draft.lines.length) / 2);
  if (error === null) {
    draft.missing(
      `error 근거 없음: ${detail.missing.error?.reason ?? "수집되지 않았다"}`,
    );
  } else {
    const body = [
      `${error.name}${error.message === null ? "" : `: ${error.message}`}`,
      ...error.frames.slice(0, 3).map((frame) =>
        `at ${frame.function ?? "?"} ${frame.path}:${frame.line ?? "?"}`
      ),
    ].join("\n");
    const text = await safe(ctx.redact, body);
    if (text === null) {
      draft.redacted(REDACTED_REASON);
    } else if (errorRoom >= 3) {
      const fenced = fenceBlock(`error ${item.report.id}`, text, {
        maxDataLines: errorRoom - 2,
      });
      draft.extend(fenced.lines);
      if (fenced.clipped) draft.truncated("error 줄을 한도로 잘랐다");
    } else {
      draft.line(inlineFence(`error ${item.report.id}`, text.split("\n")[0]));
    }
    if (error.source_missing_reason !== null) {
      draft.missing(`source 위치 없음: ${error.source_missing_reason.reason}`);
    }
    if (error.stack === null && error.stack_missing_reason !== null) {
      draft.missing(`stack 없음: ${error.stack_missing_reason.reason}`);
    }
  }
  // 실패 invocation은 앱 기록(apps/invocations)이다. 기록 없음도 그대로 말한다.
  const snapshot = detail.snapshot;
  if (snapshot === null) {
    draft.missing("snapshot이 없어 실패 invocation 근거가 없다");
  } else if (snapshot.invocation === null) {
    draft.missing(
      `invocation 기록 없음: ${
        detail.missing.invocation?.reason ?? "수집되지 않았다"
      }`,
    );
  } else if (item.invocation === null || !item.invocation.ok) {
    draft.missing(
      `invocation ${snapshot.invocation.id}: ${
        item.invocation === null ? "읽지 않았다" : readReason(item.invocation)
      }`,
    );
  } else if (item.invocation.value.invocation === null) {
    draft.missing(
      `invocation ${snapshot.invocation.id} 기록이 apps/invocations에 없다`,
    );
  } else {
    const invocation = item.invocation.value.invocation;
    const op = invocation.operation.kind === "command"
      ? `command ${invocation.operation.command}`
      : invocation.operation.kind;
    draft.source(src("apps", invocation.id));
    draft.line(
      `invocation ${invocation.id} ${op} status ${invocation.status} started ${
        atOf(invocation.started_at)
      } finished ${atOf(invocation.finished_at)} release ${invocation.release}`,
    );
    const summary = await safe(ctx.redact, JSON.stringify(invocation.summary));
    const room = lines - draft.lines.length;
    if (summary === null) {
      draft.redacted(REDACTED_REASON);
    } else if (room >= 3) {
      const fenced = fenceBlock(
        `invocation_summary ${invocation.id}`,
        summary,
        {
          maxDataLines: room - 2,
          maxChars: 400,
        },
      );
      draft.extend(fenced.lines);
      if (fenced.clipped) draft.truncated("invocation summary를 잘랐다");
    } else if (room >= 1) {
      draft.line(
        inlineFence(
          `invocation_summary ${invocation.id}`,
          clipCodePoints(summary, 200).text,
        ),
      );
    }
  }
  return draft.finish(fallback(problem.id, "occurrences"));
}

// ---- 대표 발생 -------------------------------------------------------------------

function whyChosen(problem: ProblemFacts, item: OccurrenceFacts): string {
  const reps = problem.representatives;
  if (reps[0] === item) return "first";
  if (reps[1] === item) return reps.length > 1 ? "last" : "first";
  return "most_different";
}

async function occurrencesSection(
  ctx: SectionContext,
  problem: ProblemFacts,
  lines: number,
  count: number,
): Promise<RepairContextSection | null> {
  if (!readable(problem)) return null;
  const draft = new Draft("representative_occurrences", problem.id, lines);
  draft.source(src("problems", problem.id));
  const reps = problem.representatives.slice(0, count);
  if (reps.length === 0) {
    if (problem.reports.error !== null) {
      draft.missing(problem.reports.error);
      return draft.finish(fallback(problem.id, "occurrences"));
    }
    draft.missing("대표로 고를 발생이 없다");
    return draft.finish(fallback(problem.id, "occurrences"));
  }
  const per = Math.max(2, Math.floor(lines / reps.length));
  for (const item of reps) {
    draft.source(src("problems", item.report.id));
    draft.line(
      `#${
        whyChosen(problem, item)
      } ${item.report.id} seq-rank ${item.rank}/${problem.reports.listed.length}${
        problem.reports.complete ? "" : "+"
      } ${item.report.observed_at} release ${
        item.report.release ?? "unknown"
      } ${item.report.mode} ${item.report.source}`,
    );
    const error = errorOf(item);
    if (error === null) {
      draft.missing(`${item.report.id} error 근거 없음`);
      continue;
    }
    const text = await safe(
      ctx.redact,
      `${error.name}${error.message === null ? "" : `: ${error.message}`}`,
    );
    if (text === null) {
      draft.redacted(REDACTED_REASON);
      continue;
    }
    const clipped = clipCodePoints(
      text,
      L.representative_occurrences.chars_each,
    );
    if (per >= 4) {
      const fenced = fenceBlock(`excerpt ${item.report.id}`, clipped.text, {
        maxDataLines: per - 3,
      });
      draft.extend(fenced.lines);
      if (clipped.clipped || fenced.clipped) {
        draft.truncated("excerpt를 400자 한도로 잘랐다", {
          problem: problem.id,
          kind: "occurrences",
          source: `problem:${problem.id}`,
          cursor: null,
        });
      }
    } else {
      draft.line(inlineFence(`excerpt ${item.report.id}`, clipped.text));
      if (clipped.clipped) {
        draft.truncated("excerpt를 400자 한도로 잘랐다", {
          problem: problem.id,
          kind: "occurrences",
          source: `problem:${problem.id}`,
          cursor: null,
        });
      }
    }
  }
  if (problem.sampled || !problem.reports.complete) {
    draft.truncated(
      `보고 ${problem.reports.listed.length}${
        problem.reports.complete ? "" : "+"
      }건 중 ${problem.occurrences.length}건의 근거만 비교했다`,
      {
        problem: problem.id,
        kind: "occurrences",
        source: `problem:${problem.id}`,
        cursor: null,
      },
    );
  }
  return draft.finish(fallback(problem.id, "occurrences"));
}

// ---- 직전 변화 -------------------------------------------------------------------

function changesSection(
  facts: TargetFacts,
  problem: ProblemFacts,
  lines: number,
): RepairContextSection | null {
  if (!readable(problem)) return null;
  const read = problem.problem.ok ? problem.problem.value : null;
  const draft = new Draft("preceding_changes", problem.id, lines);
  draft.source(src("apps", facts.app));
  if (read === null || read.first_observed_at === null) {
    draft.missing("첫 발생 시각을 몰라 직전 변화를 고르지 못했다");
    return draft.finish(fallback(problem.id, "reference"));
  }
  if (!facts.releases.ok) {
    draft.missing(`release 목록: ${readReason(facts.releases)}`);
    return draft.finish(fallback(problem.id, "reference"));
  }
  const first = Date.parse(read.first_observed_at);
  const now = Date.parse(facts.observed_at);
  const releases = facts.releases.value.releases;
  const candidates = releases.map((release) => ({
    id: release.id,
    at_ms: Date.parse(release.created_at),
    order: release.number,
  }));
  const inWindow = selectPrecedingChanges(
    candidates,
    first,
    now,
  );
  const allInWindow =
    candidates.filter((item) =>
      item.at_ms >= first - PRECEDING_WINDOW_MS && item.at_ms <= now
    ).length;
  const room = Math.max(0, Math.min(lines - 1, L.preceding_changes.count));
  draft.line(
    `release 변경 후보(첫 발생 ${read.first_observed_at} 기준 7일 전~지금, 가까운 순). 시간상 가까운 후보이며 원인으로 판단하지 않는다`
      .slice(0, 160),
  );
  const shown = inWindow.slice(0, room);
  for (const change of shown) {
    const release = releases.find((item) => item.id === change.id)!;
    const hours = Math.round(change.distance_ms / 3_600_000);
    draft.line(
      clipCodePoints(
        `${release.id} #${release.number} ${release.created_at} ${release.status} ${
          release.code_commit.slice(0, 12)
        } d=${hours}h`,
        L.preceding_changes.chars_each,
      ).text,
    );
    draft.source(src("apps", release.id));
  }
  if (shown.length === 0) {
    draft.line("window 안에 release 변경이 없다(문서 변경은 읽지 않았다)");
  }
  if (allInWindow > shown.length) {
    draft.truncated(
      `window의 변경 ${allInWindow}개 중 ${shown.length}개만 보인다`,
      {
        problem: problem.id,
        kind: "reference",
        source: `app:${facts.app}`,
        cursor: null,
      },
    );
  }
  return draft.finish(fallback(problem.id, "reference"));
}

// ---- log -------------------------------------------------------------------------

async function logsSection(
  ctx: SectionContext,
  problem: ProblemFacts,
  lines: number,
): Promise<RepairContextSection | null> {
  if (!readable(problem)) return null;
  const draft = new Draft("logs", problem.id, lines);
  draft.source(src("problems", problem.id));
  // log가 있는 가장 최근 대표 발생을 쓴다. 없으면 snapshot이 있는 가장 최근 발생이다(없는 이유를 낸다).
  const recent = [...problem.representatives].reverse();
  const item =
    recent.find((rep) =>
      rep.detail.ok && rep.detail.value.snapshot?.logs != null
    ) ??
      recent.find((rep) =>
        rep.detail.ok && rep.detail.value.snapshot !== null
      ) ?? problem.representatives[0];
  if (item === undefined) {
    draft.missing("log를 읽을 발생이 없다");
    return draft.finish(fallback(problem.id, "occurrences"));
  }
  if (!item.detail.ok) {
    draft.missing(`${item.report.id}: ${readReason(item.detail)}`);
    return draft.finish(fallback(problem.id, "occurrences"));
  }
  const snapshot = item.detail.value.snapshot;
  if (snapshot === null || snapshot.logs === null) {
    draft.missing(
      `log 근거 없음: ${
        item.detail.value.missing.logs?.reason ?? "수집되지 않았다"
      }`,
    );
    return draft.finish(fallback(problem.id, "occurrences"));
  }
  const logs = snapshot.logs;
  draft.source(src("problems", snapshot.id));
  const more = {
    problem: problem.id,
    kind: "log" as const,
    source: `snapshot:${snapshot.id}`,
    cursor: null,
  };
  const info =
    `snapshot ${snapshot.id} logs ${logs.line_count}줄 scope ${logs.scope}${
      logs.truncated ? " (수집 때 이미 잘림)" : ""
    }`;
  draft.line(info);
  const reason = describeBlob(item.logs);
  if (item.logs === null || reason !== null) {
    draft.missing(
      `log 본문을 읽지 못했다: ${reason ?? NO_BLOB_PATH}`,
    );
    draft.addMore(more);
    return draft.finish(fallback(problem.id, "occurrences"));
  }
  if (item.logs.kind !== "text") {
    return draft.finish(fallback(problem.id, "occurrences"));
  }
  const text = await safe(ctx.redact, item.logs.text);
  if (text === null) {
    draft.redacted(REDACTED_REASON);
    return draft.finish(fallback(problem.id, "occurrences"));
  }
  const all = logicalLines(text);
  const room = Math.max(0, lines - 1 - 2);
  const tail = all.slice(Math.max(0, all.length - room));
  const fenced = fenceBlock(`log ${snapshot.id}`, tail.join("\n"), {
    maxDataLines: room,
  });
  draft.extend(fenced.lines);
  if (tail.length < all.length || item.logs.truncated) {
    draft.truncated(
      `log ${all.length}줄 중 마지막 ${tail.length}줄만 보인다`,
      more,
    );
  }
  return draft.finish(fallback(problem.id, "occurrences"));
}

// ---- 지난 고친 기록 --------------------------------------------------------------

function pastRepairsSection(
  problem: ProblemFacts,
  lines: number,
): RepairContextSection | null {
  if (!readable(problem)) return null;
  const draft = new Draft("past_repairs", problem.id, lines);
  draft.source(src("problems", problem.id));
  if (!problem.fixes.ok) {
    draft.missing(`고친 기록: ${readReason(problem.fixes)}`);
    return draft.finish(fallback(problem.id, "reference"));
  }
  const fixes = [...problem.fixes.value.fixes].sort((a, b) =>
    BigInt(b.seq) > BigInt(a.seq) ? 1 : BigInt(b.seq) < BigInt(a.seq) ? -1 : 0
  );
  if (fixes.length === 0) return null;
  const results = new Map<string, string>();
  if (problem.verifications.ok) {
    for (const item of problem.verifications.value.verifications) {
      results.set(item.id, `${item.kind}:${item.result}`);
    }
  }
  const count = Math.min(L.past_repairs.count, Math.floor(lines / 2));
  for (const entry of fixes.slice(0, count)) {
    const fix = entry.fix;
    draft.line(
      `fix seq ${entry.seq} ${fix.before} -> ${fix.after}${
        fix.ticket === null ? "" : ` ticket ${fix.ticket}`
      }`,
    );
    const verification = fix.verification.length === 0
      ? "verification 없음"
      : fix.verification.map((id) =>
        `${id} ${results.get(id) ?? "result unknown"}`
      )
        .join(", ");
    draft.line(`  ${verification}`);
    draft.source(src("problems", `fix:${entry.seq}`));
  }
  if (fixes.length > count) {
    draft.truncated(`고친 기록 ${fixes.length}개 중 최신 ${count}개만 보인다`, {
      problem: problem.id,
      kind: "fix_records",
      source: `problem:${problem.id}`,
      cursor: null,
    });
  }
  if (!problem.verifications.ok) {
    draft.missing(`verification 결과: ${readReason(problem.verifications)}`);
  }
  return draft.finish(fallback(problem.id, "reference"));
}

// ---- 관련 문제 -------------------------------------------------------------------

function relatedSection(facts: TargetFacts): RepairContextSection | null {
  const { single } = problemOf(facts);
  const draft = new Draft(
    "related_problems",
    single,
    L.related_problems.lines * 2,
  );
  const targets = new Set(facts.problems.map((item) => item.id));
  draft.source(src("problems", facts.app));
  const ticket = ticketOf(facts);
  const group = (name: string, rows: { id: string; status: string }[]) => {
    if (rows.length === 0) return;
    const cap = L.related_problems.lines;
    const items = rows.map((row) => `${row.id} [${row.status}]`);
    const fitted = fitLines(
      items.map((item) => `${name}: ${item}`),
      cap,
      (count) => `${name}: ... ${count}개 더`,
    );
    draft.extend(fitted.lines);
    if (fitted.omitted > 0) {
      draft.truncated(`${name} ${rows.length}개 중 일부만 보인다`, {
        problem: facts.problems[0].id,
        kind: "reference",
        source: `app:${facts.app}`,
        cursor: null,
      });
    }
  };
  if (ticket !== null) {
    // 이 ticket의 다른 문제는 이미 문제별 절에 있다. 읽지 못한 것만 관련으로 적지 않는다.
    void ticket;
  }
  if (facts.related.same_app.ok) {
    const others = facts.related.same_app.value.problems.filter((row) =>
      !targets.has(row.id) && row.status !== "closed"
    );
    group(
      "same_app_open",
      others.slice(0, L.related_problems.count_total).map((row) => ({
        id: row.id,
        status: row.status,
      })),
    );
  } else {
    draft.missing(`같은 앱 문제 목록: ${readReason(facts.related.same_app)}`);
  }
  return draft.finish({
    source: src("problems", facts.app),
    more: {
      kind: "reference",
      source: `app:${facts.app}`,
      problem: facts.problems[0].id,
    },
  });
}

// ---- 첨부 ------------------------------------------------------------------------

async function attachmentsSection(
  ctx: SectionContext,
  problem: ProblemFacts,
  lines: number,
): Promise<RepairContextSection | null> {
  if (!readable(problem)) return null;
  const draft = new Draft("attachments", problem.id, lines);
  draft.source(src("problems", problem.id));
  let images = 0;
  for (const item of problem.representatives) {
    if (!item.detail.ok) continue;
    const snapshot = item.detail.value.snapshot;
    if (snapshot === null) continue;
    draft.source(src("problems", snapshot.id));
    if (snapshot.screen === null) {
      const reason = item.detail.value.missing.screen?.reason;
      if (reason !== undefined) {
        const text = await safe(ctx.redact, reason);
        draft.missing(`${snapshot.id} screen 없음`);
        draft.line(
          `${snapshot.id} screen missing ${
            text === null ? "(reason redacted)" : inlineFence("reason", text)
          }`,
        );
      }
      continue;
    }
    const screen = snapshot.screen;
    const name = await safe(ctx.redact, screen.name);
    draft.line(
      `${snapshot.id} screen ${
        name === null
          ? "(name redacted)"
          : inlineFence("screen_name", clipCodePoints(name, 80).text)
      } observed ${screen.observed_at}; state ${
        screen.state === null
          ? `missing`
          : `blob ${screen.state.slice(0, 12)} (read: screen)`
      }`,
    );
    if (screen.state === null) {
      draft.missing(
        `${snapshot.id} screen state: ${screen.state_missing_reason?.reason}`,
      );
    }
    if (screen.screenshot === null) {
      draft.missing(
        `${snapshot.id} screenshot: ${screen.screenshot_missing_reason?.reason}`,
      );
    } else if (images < L.attachments.image_metadata) {
      images += 1;
      // 이미지 내용은 이 통로가 보내지 않는다(redaction이 image/png를 지원하지 않는다). 크기와 첨부 열기
      // 참조만 낸다(repair-context#R17).
      const size = item.detail.value.attachments?.find((attachment) =>
        attachment.hash === screen.screenshot
      )?.size_bytes;
      draft.line(
        `${snapshot.id} image blob ${
          screen.screenshot.slice(0, 12)
        } kind image size ${
          size === undefined ? "unknown" : `${size} bytes`
        }; 내용은 보내지 않는다. 열기: 허용 첨부 열기(report ${item.report.id}, feedback_screenshot), 읽기: more image`,
      );
    }
  }
  return draft.finish(fallback(problem.id, "reference"));
}

// ---- 재현 ------------------------------------------------------------------------

function reproductionSection(
  facts: TargetFacts,
  problem: ProblemFacts,
  lines: number,
): RepairContextSection | null {
  if (!readable(problem)) return null;
  const draft = new Draft("reproduction", problem.id, lines);
  draft.source(src("problems", problem.id));
  const ticket = ticketOf(facts);
  const found: string[] = [];
  if (ticket !== null) {
    for (const condition of ticket.conditions) {
      if (
        condition.input.kind === "reproduction_test" &&
        condition.input.problem === problem.id
      ) {
        found.push(
          `ticket ${ticket.id} #${condition.position} reproduction_test ${
            condition.input.test_hash.slice(0, 12)
          }`,
        );
        draft.source(src("tickets", ticket.id));
      }
    }
  }
  if (problem.verifications.ok) {
    const done = problem.verifications.value.verifications.filter((item) =>
      item.kind === "reproduction" && item.problem === problem.id
    ).slice(-2);
    for (const item of done) {
      found.push(
        `verification ${item.id} reproduction ${item.result} test ${
          item.test.slice(0, 12)
        }`,
      );
    }
  } else {
    draft.missing(`verification 결과: ${readReason(problem.verifications)}`);
  }
  if (found.length === 0) {
    draft.missing("이 문제의 고정된 재현 테스트도 결과도 없다");
    return draft.finish(fallback(problem.id, "reference"));
  }
  draft.extend(
    found.map((line) => clipCodePoints(line, L.reproduction.chars).text),
  );
  draft.line(
    "원래 증상이 재현되는지는 problems/request-test(RequestTest)의 실제 결과만 근거다",
  );
  return draft.finish(fallback(problem.id, "reference"));
}

// ---- 더 읽기·반환 ---------------------------------------------------------------

function moreSection(
  facts: TargetFacts,
  skipped: string[],
): RepairContextSection | null {
  const draft = new Draft("more", null, L.more.lines);
  draft.source(src("problems", facts.app));
  const lines: string[] = [];
  if (skipped.length > 0) {
    lines.push(
      `cap으로 생략한 절: ${skipped.join(", ")} (문제 하나씩 읽는다)`,
    );
  }
  for (const problem of facts.problems) {
    if (!readable(problem)) continue;
    const snapshot = problem.representatives.find((item) =>
      item.detail.ok && item.detail.value.snapshot !== null
    );
    const snapshotId = snapshot !== undefined && snapshot.detail.ok
      ? snapshot.detail.value.snapshot?.id
      : undefined;
    if (snapshotId !== undefined) {
      lines.push(`log ${problem.id} snapshot:${snapshotId}`);
    }
    lines.push(`occurrences ${problem.id} problem:${problem.id}`);
    const rel = problem.problem.ok ? problem.problem.value.first_release : null;
    if (rel !== null) {
      lines.push(`source_diff ${problem.id} release:${rel}..current`);
    }
  }
  const fitted = fitLines(
    lines,
    L.more.lines,
    (count) => `... 더 읽을 근거 ${count}개 생략: 문제 하나씩 읽는다`,
  );
  draft.extend(fitted.lines);
  if (fitted.omitted > 0) draft.truncated(`더 읽기 ${fitted.omitted}개 생략`);
  return draft.finish({
    source: src("problems", facts.app),
    more: {
      kind: "reference",
      source: `app:${facts.app}`,
      problem: facts.problems[0].id,
    },
  });
}

function returnSection(facts: TargetFacts): RepairContextSection {
  const ticket = ticketOf(facts);
  const draft = new Draft("return_method", null, L.return_method.lines);
  const lines: string[] = [];
  if (ticket !== null) {
    draft.source(src("tickets", ticket.id));
    lines.push(
      `완료 보고: tickets/report_completion (ticket ${ticket.id}${
        ticket.claim === null
          ? "; 먼저 MCP claim"
          : `, claim_seq ${ticket.claim.claim_seq}`
      })`,
    );
  } else {
    draft.source(src("problems", facts.app));
    lines.push(
      "ticket 준비: 담당 agent(lophn-agent)의 ticket 준비로 이어진다. code 작업은 ticket 생성·MCP claim 뒤에만 시작한다",
    );
  }
  lines.push(
    "테스트: problems/request-test(RequestTest)로 실제 테스트를 요청한다. 통과는 machine 결과만 뜻한다",
  );
  lines.push(
    "문제 닫힘은 problems/closing이 정한다. coding agent는 문제를 닫지 않는다",
  );
  draft.extend(lines);
  return draft.finish({
    source: src("problems", facts.app),
    more: {
      kind: "reference",
      source: `app:${facts.app}`,
      problem: facts.problems[0].id,
    },
  })!;
}

// ---- 조립 ------------------------------------------------------------------------

export type BuiltSections = {
  sections: RepairContextSection[];
  // 줄·개수 몫이 없어 이번 묶음에 절을 내지 못한 종류와 문제.
  skipped: string[];
};

export async function buildSections(
  ctx: SectionContext,
): Promise<BuiltSections> {
  const facts = ctx.facts;
  const n = facts.problems.length;
  const skipped: string[] = [];
  const collected: Map<string, RepairContextSection[]> = new Map();
  const add = (section: RepairContextSection | null) => {
    if (section === null) return;
    const list = collected.get(section.kind) ?? [];
    list.push(section);
    collected.set(section.kind, list);
  };
  const perProblem = async (
    kind: string,
    total: number,
    build: (problem: ProblemFacts, share: number, index: number) =>
      | Promise<
        RepairContextSection | null
      >
      | RepairContextSection
      | null,
    minShare = 1,
  ) => {
    const shares = allocate(total, n);
    for (let i = 0; i < n; i += 1) {
      const share = shares[i];
      if (share < minShare) {
        skipped.push(`${kind}(${facts.problems[i].id})`);
        continue;
      }
      add(await build(facts.problems[i], share, i));
    }
  };
  add(headSection(facts));
  await perProblem(
    "target_symptom",
    L.target_symptom.lines_total,
    (p, share) =>
      symptomSection(
        ctx,
        p,
        Math.min(L.target_symptom.lines_per_problem, share),
      ),
  );
  await perProblem(
    "human_text",
    L.human_text.lines_total,
    (p, share) =>
      humanTextSection(ctx, p, share, L.human_text.chars_per_problem),
  );
  add(inspectSection(facts));
  add(conditionsSection(facts));
  add(preserveSection(facts));
  await perProblem(
    "failure_basis",
    L.failure_basis.invocation_lines,
    (p, share) => failureSection(ctx, p, share),
    3,
  );
  const countShares = allocate(L.representative_occurrences.count, n);
  await perProblem(
    "representative_occurrences",
    L.representative_occurrences.lines_total,
    (p, share, i) => occurrencesSection(ctx, p, share, countShares[i]),
    2,
  );
  await perProblem(
    "preceding_changes",
    L.preceding_changes.lines,
    (p, share) => changesSection(facts, p, share),
    2,
  );
  await perProblem(
    "logs",
    L.logs.default_lines,
    (p, share) => logsSection(ctx, p, share),
    4,
  );
  await perProblem(
    "past_repairs",
    L.past_repairs.lines,
    (p, share) => pastRepairsSection(p, share),
    2,
  );
  add(relatedSection(facts));
  await perProblem(
    "attachments",
    L.attachments.lines,
    (p, share) => attachmentsSection(ctx, p, share),
    2,
  );
  await perProblem(
    "reproduction",
    L.reproduction.lines * n,
    (p, share) =>
      reproductionSection(facts, p, Math.min(L.reproduction.lines, share)),
  );
  add(moreSection(facts, skipped));
  add(returnSection(facts));
  const sections: RepairContextSection[] = [];
  for (const kind of SECTION_KINDS) {
    sections.push(...(collected.get(kind) ?? []));
  }
  return { sections, skipped };
}
