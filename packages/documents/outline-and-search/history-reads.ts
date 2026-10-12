// section 이력과 두 판의 줄 diff 읽기 handler(documents#T16). route 선언은 contract가 한다
// (`document.section_history`, `document.diff`). ledger snapshot의 문서·판 metadata와
// derived store의 section·원문(derived_versions·derived_sections·derived_texts)만 읽는다.
// 비교 규칙은 model.ts의 공용 section-comparison이고 줄 계산은 diff.ts다. 계산은 reader
// Worker(core 밖)에서 하고 응답은 한 번에 변경 block 단위로 끊어 cursor로 잇는다.
// 추출이 끝나지 않았거나 지원·확인되지 않은 판(검사 한도 1 MiB 초과 포함)은 section도
// 본문도 추정하지 않고 누락으로 밝힌다. 권한 밖 문서와 없는 문서는 같은 not_found다.
import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import type { RequestContext } from "../../protocol/platform/mod.ts";
import {
  documentDiff,
  documentSectionHistory,
} from "../../protocol/projects/mod.ts";
import type { DerivedRead } from "./adapters/store.ts";
import {
  type ChangeLine,
  changeLines,
  decodeDiffCursor,
  DIFF_PAGE_CODEPOINTS,
  type DiffBinding,
  diffBlocks,
  encodeDiffCursor,
  groupRuns,
  pageEnd,
} from "./diff.ts";
import {
  codepoints,
  type ComparedVersion,
  sectionHistory,
  type SectionSide,
} from "./model.ts";
import { authorizeTarget } from "./outline-support.ts";
import type { PortLookup, SearchSnapshot } from "./types.ts";
import {
  OMISSION_FAILED,
  OMISSION_UNSUPPORTED,
  OMISSION_UNVERIFIED,
} from "./work.ts";

// 한 응답이 다루는 판 수(`document.history`와 같다).
export const SECTION_HISTORY_PAGE = 50;

export type HistoryHandlerDeps = {
  read: DerivedRead;
  snapshot: SearchSnapshot;
  ports: PortLookup;
  // 출력 redaction. 안전화를 끝내지 못한 줄은 싣지 않고 누락으로 밝힌다.
  redactor?: (
    source: { concern: string; revision: string; scope: string },
    mediaType: string,
    text: string,
  ) => string | null;
};

export type FormatRefValue = {
  name: string;
  module_hash: string;
  explicit: boolean;
};

export type SectionHistoryInput = {
  document: string;
  section: string;
  from?: string;
  to?: string;
  cursor?: string;
};

export type DiffInput = {
  document: string;
  before: string;
  after: string;
  section?: string | null;
  cursor?: string;
};

type LineRangeValue = { start_line: number; end_line: number };
type OmissionValue = {
  version: string;
  section: string | null;
  ranges: LineRangeValue[];
  reason: string;
};

type HistorySide = {
  version: string;
  format: FormatRefValue;
  module_hash: string;
  body_hash: string | null;
};

export type SectionHistoryPage = {
  document: string;
  section: string;
  entries: {
    section: string;
    version: string;
    before: HistorySide | null;
    after: HistorySide;
    status: "unchanged" | "modified" | "added" | "missing";
    title: string | null;
  }[];
  omissions: OmissionValue[];
  complete: boolean;
  next_cursor: string | null;
  as_of_seq: string;
};

export type DiffPage = {
  document: string;
  before: { version: string; format: FormatRefValue; module_hash: string };
  after: { version: string; format: FormatRefValue; module_hash: string };
  section: string | null;
  additions: { range: LineRangeValue; text: string }[];
  deletions: { range: LineRangeValue; text: string }[];
  omissions: OmissionValue[];
  complete: boolean;
  next_cursor: string | null;
  as_of_seq: string;
};

export type HistoryHandlers = {
  sectionHistory(
    ctx: RequestContext,
    input: SectionHistoryInput,
  ): Result<SectionHistoryPage>;
  diff(ctx: RequestContext, input: DiffInput): Result<DiffPage>;
};

type VersionMeta = {
  id: string;
  number: number;
  content_hash: string;
  format: FormatRefValue;
};

function deny(): Result<never> {
  return err({ code: "not_found", message: "history does not resolve" });
}

function text(value: unknown): string {
  return String(value);
}

function integer(value: unknown): number {
  return typeof value === "bigint" ? Number(value) : Number(value);
}

function metaOf(row: Record<string, unknown>): VersionMeta {
  return {
    id: text(row["id"]),
    number: integer(row["number"]),
    content_hash: text(row["content_hash"]),
    format: {
      name: text(row["format_name"]),
      module_hash: text(row["module_hash"]),
      explicit: row["format_explicit"] === 1 ||
        row["format_explicit"] === BigInt(1),
    },
  };
}

const VERSION_COLUMNS =
  `id, number, content_hash, format_name, module_hash, format_explicit`;

// 문서가 있고 요청 자격이 닿으면 통과다. 보관 문서의 고정 판도 읽힌다(versions#R11).
function readableDocument(
  deps: HistoryHandlerDeps,
  ctx: RequestContext,
  operation: string,
  document: string,
): boolean {
  const row = deps.snapshot.sql.get(
    `SELECT place_kind, place_id FROM documents WHERE id = ?`,
    [document],
  );
  if (row === undefined) return false;
  const kind = row["place_kind"];
  const place = row["place_id"];
  return authorizeTarget(
    deps,
    ctx,
    operation,
    document,
    kind === null || kind === undefined ? undefined : text(kind),
    place === null || place === undefined ? undefined : text(place),
  );
}

function versionById(
  deps: HistoryHandlerDeps,
  document: string,
  id: string,
): VersionMeta | undefined {
  const row = deps.snapshot.sql.get(
    `SELECT ${VERSION_COLUMNS} FROM versions WHERE id = ? AND document = ?`,
    [id, document],
  );
  return row === undefined ? undefined : metaOf(row);
}

// 판의 추출 상태. ready가 아니면 사람이 읽을 이유다. 추출이 이 판의 판·module과 맞지
// 않으면(복원 뒤 낡은 derived) 그 결과를 쓰지 않는다.
type Extraction =
  | { kind: "ready"; text_hash: string }
  | { kind: "unknown"; reason: string };

function extractionOf(deps: HistoryHandlerDeps, meta: VersionMeta): Extraction {
  const row = deps.read.sql.get(
    `SELECT content_hash, module_hash, extraction_status, text_hash, failure_reason
     FROM derived_versions WHERE version = ?`,
    [meta.id],
  );
  if (row === undefined) {
    return { kind: "unknown", reason: OMISSION_UNVERIFIED };
  }
  if (
    text(row["content_hash"]) !== meta.content_hash ||
    text(row["module_hash"]) !== meta.format.module_hash
  ) {
    return { kind: "unknown", reason: OMISSION_UNVERIFIED };
  }
  switch (text(row["extraction_status"])) {
    case "ready":
      return { kind: "ready", text_hash: text(row["text_hash"] ?? "") };
    case "unsupported":
      return { kind: "unknown", reason: OMISSION_UNSUPPORTED };
    case "failed":
      return {
        kind: "unknown",
        reason: row["failure_reason"] === null ||
            row["failure_reason"] === undefined
          ? OMISSION_FAILED
          : text(row["failure_reason"]),
      };
    default:
      return { kind: "unknown", reason: OMISSION_UNVERIFIED };
  }
}

function historyCursor(
  binding: {
    document: string;
    section: string;
    from: string | null;
    to: string | null;
  },
  after: number,
): string {
  const bytes = new TextEncoder().encode(
    canonicalize({ history: { ...binding, after } }),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function readHistoryCursor(
  cursor: string,
  binding: {
    document: string;
    section: string;
    from: string | null;
    to: string | null;
  },
): Result<number> {
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { history?: Record<string, unknown> };
    const read = parsed.history;
    if (
      read === undefined ||
      canonicalize({ ...read, after: 0 }) !==
        canonicalize({ ...binding, after: 0 }) ||
      typeof read["after"] !== "number" ||
      !Number.isSafeInteger(read["after"]) ||
      read["after"] < 0
    ) {
      return err({ code: "invalid_input", message: "invalid history cursor" });
    }
    return ok(read["after"]);
  } catch {
    return err({ code: "invalid_input", message: "invalid history cursor" });
  }
}

function sectionHistoryPage(
  deps: HistoryHandlerDeps,
  ctx: RequestContext,
  input: SectionHistoryInput,
): Result<SectionHistoryPage> {
  if (
    !readableDocument(deps, ctx, documentSectionHistory.name, input.document)
  ) return deny();
  const bounds: { from?: number; to?: number } = {};
  for (const [name, id] of [["from", input.from], ["to", input.to]] as const) {
    if (id === undefined) continue;
    const found = versionById(deps, input.document, id);
    if (found === undefined) return deny();
    bounds[name] = found.number;
  }
  if (
    bounds.from !== undefined && bounds.to !== undefined &&
    bounds.from > bounds.to
  ) {
    return err({ code: "invalid_input", message: "from is after to" });
  }
  const binding = {
    document: input.document,
    section: input.section,
    from: input.from ?? null,
    to: input.to ?? null,
  };
  let after = 0;
  if (input.cursor !== undefined) {
    const read = readHistoryCursor(input.cursor, binding);
    if (!read.ok) return read;
    after = read.value;
  }
  const first = Math.max(bounds.from ?? 1, after + 1);
  const rows = deps.snapshot.sql.all(
    `SELECT ${VERSION_COLUMNS} FROM versions
     WHERE document = ? AND number >= ? AND number <= ?
     ORDER BY number LIMIT ?`,
    [
      input.document,
      first,
      bounds.to ?? Number.MAX_SAFE_INTEGER,
      SECTION_HISTORY_PAGE + 1,
    ],
  ).map(metaOf);
  const page = rows.slice(0, SECTION_HISTORY_PAGE);
  // 중간 판부터 잘라도 첫 비교는 직전 판과 한다(outline-and-search#R20).
  const previousRow = deps.snapshot.sql.get(
    `SELECT ${VERSION_COLUMNS} FROM versions
     WHERE document = ? AND number < ? ORDER BY number DESC LIMIT 1`,
    [input.document, first],
  );
  const previous = previousRow === undefined ? [] : [metaOf(previousRow)];
  const chain: ComparedVersion<FormatRefValue>[] = [...previous, ...page].map(
    (meta) => comparedVersion(deps, meta, input.section),
  );
  const history = sectionHistory(chain, previous.length, input.section);
  const side = (
    version: string,
    format: FormatRefValue,
    body: SectionSide | null,
  ): HistorySide => ({
    version,
    format,
    module_hash: format.module_hash,
    body_hash: body === null ? null : body.body_hash,
  });
  const more = rows.length > SECTION_HISTORY_PAGE;
  return ok({
    document: input.document,
    section: input.section,
    entries: history.rows.map((row) => ({
      section: input.section,
      version: row.version,
      before: row.before === null
        ? null
        : side(row.before.version, row.before.format, row.before.side),
      after: side(row.after.version, row.after.format, row.after.side),
      status: row.status,
      title: row.title,
    })),
    omissions: history.omissions.map((omission) => ({
      version: omission.version,
      section: input.section,
      ranges: [],
      reason: omission.reason,
    })),
    complete: !more,
    next_cursor: more
      ? historyCursor(binding, page[page.length - 1].number)
      : null,
    as_of_seq: deps.snapshot.as_of_seq,
  });
}

// 이 key의 section만 읽는다. 다른 section은 읽지 않아 판이 많아도 가볍다.
function comparedVersion(
  deps: HistoryHandlerDeps,
  meta: VersionMeta,
  key: string,
): ComparedVersion<FormatRefValue> {
  const extraction = extractionOf(deps, meta);
  if (extraction.kind === "unknown") {
    return { version: meta.id, format: meta.format, state: extraction };
  }
  const row = deps.read.sql.get(
    `SELECT key, title, position, body_hash FROM derived_sections
     WHERE version = ? AND key = ?`,
    [meta.id, key],
  );
  return {
    version: meta.id,
    format: meta.format,
    state: {
      kind: "ready",
      snapshot: {
        module_hash: meta.format.module_hash,
        sections: row === undefined ? [] : [{
          key: text(row["key"]),
          title: text(row["title"]),
          position: integer(row["position"]),
          body_hash: text(row["body_hash"]),
        }],
      },
    },
  };
}

// diff 한쪽의 줄. number는 그 판의 대표 텍스트 1-based 줄 번호다.
type SideLines = {
  meta: VersionMeta;
  text_hash: string;
  numbers: number[];
  lines: string[];
  // 범위가 원문 밖이라 복원할 수 없는 줄 번호.
  lost: number[];
};

function sideLines(
  deps: HistoryHandlerDeps,
  meta: VersionMeta,
  section: string | null,
): Result<
  | { kind: "ready"; side: SideLines }
  | { kind: "unknown"; reason: string }
  | { kind: "absent" }
> {
  const extraction = extractionOf(deps, meta);
  if (extraction.kind === "unknown") return ok(extraction);
  const content = deps.read.sql.get(
    `SELECT text_hash, text FROM derived_texts WHERE version = ?`,
    [meta.id],
  );
  if (content === undefined) {
    return ok({ kind: "unknown", reason: OMISSION_UNVERIFIED });
  }
  const original = text(content["text"]);
  const all = original === "" ? [] : original.split("\n");
  let numbers: number[];
  if (section === null) {
    numbers = all.map((_line, index) => index + 1);
  } else {
    const row = deps.read.sql.get(
      `SELECT own_ranges FROM derived_sections WHERE version = ? AND key = ?`,
      [meta.id, section],
    );
    if (row === undefined) return ok({ kind: "absent" });
    const parsed = parseRanges(row["own_ranges"]);
    if (!parsed.ok) return parsed;
    numbers = [];
    for (const range of parsed.value) {
      for (let line = range.start_line; line <= range.end_line; line++) {
        numbers.push(line);
      }
    }
  }
  const present: number[] = [];
  const lost: number[] = [];
  for (const number of numbers) {
    (number >= 1 && number <= all.length ? present : lost).push(number);
  }
  return ok({
    kind: "ready",
    side: {
      meta,
      text_hash: text(content["text_hash"]),
      numbers: present,
      lines: present.map((number) => all[number - 1]),
      lost,
    },
  });
}

function parseRanges(value: unknown): Result<LineRangeValue[]> {
  try {
    const parsed = JSON.parse(text(value)) as unknown;
    if (!Array.isArray(parsed)) throw new Error("not a list");
    return ok(parsed.map((item) => {
      const range = item as LineRangeValue;
      if (
        !Number.isSafeInteger(range.start_line) ||
        !Number.isSafeInteger(range.end_line) ||
        range.end_line < range.start_line
      ) throw new Error("bad range");
      return { start_line: range.start_line, end_line: range.end_line };
    }));
  } catch {
    return err({
      code: "internal",
      message: "stored section range is invalid",
    });
  }
}

type Change = { number: number; text: string };

function diffPage(
  deps: HistoryHandlerDeps,
  ctx: RequestContext,
  input: DiffInput,
): Result<DiffPage> {
  if (!readableDocument(deps, ctx, documentDiff.name, input.document)) {
    return deny();
  }
  const section = input.section ?? null;
  const beforeMeta = versionById(deps, input.document, input.before);
  const afterMeta = versionById(deps, input.document, input.after);
  if (beforeMeta === undefined || afterMeta === undefined) return deny();
  const header = {
    document: input.document,
    before: {
      version: beforeMeta.id,
      format: beforeMeta.format,
      module_hash: beforeMeta.format.module_hash,
    },
    after: {
      version: afterMeta.id,
      format: afterMeta.format,
      module_hash: afterMeta.format.module_hash,
    },
    section,
  };
  const before = sideLines(deps, beforeMeta, section);
  if (!before.ok) return before;
  const after = sideLines(deps, afterMeta, section);
  if (!after.ok) return after;
  // 구간이 한쪽 판에도 없으면 비교할 것이 없는 잘못된 주소다.
  if (before.value.kind === "absent" && after.value.kind === "absent") {
    return deny();
  }
  const omissions: OmissionValue[] = [];
  const sides: [VersionMeta, typeof before.value][] = [
    [beforeMeta, before.value],
    [afterMeta, after.value],
  ];
  let unknown = false;
  for (const [meta, side] of sides) {
    if (side.kind === "unknown") {
      unknown = true;
      omissions.push({
        version: meta.id,
        section,
        ranges: [],
        reason: side.reason,
      });
    }
  }
  // 한쪽 본문을 복원할 수 없으면 비교하지 않는다. 빈 본문으로 성공을 꾸미지 않는다.
  if (unknown) {
    return ok({
      ...header,
      additions: [],
      deletions: [],
      omissions,
      complete: true,
      next_cursor: null,
      as_of_seq: deps.snapshot.as_of_seq,
    });
  }
  const empty = (meta: VersionMeta): SideLines => ({
    meta,
    text_hash: "",
    numbers: [],
    lines: [],
    lost: [],
  });
  const left = before.value.kind === "ready"
    ? before.value.side
    : empty(beforeMeta);
  const right = after.value.kind === "ready"
    ? after.value.side
    : empty(afterMeta);
  for (const side of [left, right]) {
    if (side.lost.length === 0) continue;
    omissions.push({
      version: side.meta.id,
      section,
      ranges: groupRuns(side.lost).map((run) => ({
        start_line: Math.max(run.start, 1),
        end_line: Math.max(run.end, 1),
      })),
      reason: "text range is not restorable",
    });
  }
  const binding: DiffBinding = {
    before: beforeMeta.id,
    after: afterMeta.id,
    section,
    before_text: left.text_hash,
    after_text: right.text_hash,
  };
  const blocks = diffBlocks(left.lines, right.lines);
  const { lines, ends } = changeLines(blocks);
  let start = 0;
  if (input.cursor !== undefined) {
    const read = decodeDiffCursor(input.cursor, binding);
    if (!read.ok) return read;
    if (read.value > lines.length) {
      return err({ code: "invalid_input", message: "invalid diff cursor" });
    }
    start = read.value;
  }
  const lineOf = (line: ChangeLine) =>
    line.side === "delete" ? left.lines[line.index] : right.lines[line.index];
  const oversize = (line: ChangeLine) =>
    codepoints(lineOf(line)) > DIFF_PAGE_CODEPOINTS;
  const end = pageEnd(
    lines,
    ends,
    start,
    (line) => oversize(line) ? 0 : codepoints(lineOf(line)),
  );
  const deleted: Change[] = [];
  const inserted: Change[] = [];
  const dropped: { side: SideLines; number: number; reason: string }[] = [];
  for (const line of lines.slice(start, end)) {
    const side = line.side === "delete" ? left : right;
    const number = side.numbers[line.index];
    if (oversize(line)) {
      dropped.push({
        side,
        number,
        reason: `line exceeds ${DIFF_PAGE_CODEPOINTS} codepoints`,
      });
      continue;
    }
    (line.side === "delete" ? deleted : inserted).push({
      number,
      text: lineOf(line),
    });
  }
  const carry = (
    side: SideLines,
    changes: readonly Change[],
  ): { range: LineRangeValue; text: string }[] => {
    const carried: { range: LineRangeValue; text: string }[] = [];
    for (const run of groupRuns(changes.map((change) => change.number))) {
      const body = changes
        .filter((change) =>
          change.number >= run.start && change.number <= run.end
        )
        .map((change) => change.text)
        .join("\n");
      const range = { start_line: run.start, end_line: run.end };
      const safe = deps.redactor === undefined ? body : deps.redactor(
        {
          concern: "documents",
          revision: side.meta.id,
          scope: input.document,
        },
        "text/plain",
        body,
      );
      if (safe === null) {
        omissions.push({
          version: side.meta.id,
          section,
          ranges: [range],
          reason: "redaction_failed",
        });
        continue;
      }
      carried.push({ range, text: safe });
    }
    return carried;
  };
  const deletions = carry(left, deleted);
  const additions = carry(right, inserted);
  for (const item of dropped) {
    omissions.push({
      version: item.side.meta.id,
      section,
      ranges: [{ start_line: item.number, end_line: item.number }],
      reason: item.reason,
    });
  }
  const complete = end >= lines.length;
  return ok({
    ...header,
    additions,
    deletions,
    omissions,
    complete,
    next_cursor: complete ? null : encodeDiffCursor(binding, end),
    as_of_seq: deps.snapshot.as_of_seq,
  });
}

export function createHistoryHandlers(
  deps: HistoryHandlerDeps,
): HistoryHandlers {
  return {
    sectionHistory: (ctx, input) => sectionHistoryPage(deps, ctx, input),
    diff: (ctx, input) => diffPage(deps, ctx, input),
  };
}
