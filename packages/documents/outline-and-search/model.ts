import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import type { RequestContext } from "../../contracts/platform/mod.ts";
import type { LineRange } from "../../contracts/documents/mod.ts";
import { z } from "zod";

// FTS5 trigram 규약과 짧은 query의 escaped LIKE를 한 근원으로 둔다.
// search_fts와 summary cache 비교가 같은 규약을 쓴다(docs/architecture/documents 5.4).

export const QUERY_CODEPOINT_MIN = 3;
export const PREAMBLE_EXCERPT_CODEPOINTS = 200;

// query를 codepoint 목록으로 본다.한국어 2글자와 3글자 미만의 기준이다.
export function codepoints(value: string): number {
  return [...value].length;
}

export function trimmedQuery(query: string): string {
  return query.trim();
}

// 3 codepoint 미만 query는 FTS5 trigram이 건너뛴다. escaped SQL LIKE로 처리한다.
export function needsLikeFallback(query: string): boolean {
  return codepoints(trimmedQuery(query)) < QUERY_CODEPOINT_MIN;
}

// LIKE pattern의 %·_·\ 를 escape한다. ESCAPE '\'와 함께 쓴다.
export function escapeLike(value: string): string {
  let out = "";
  for (const char of value) {
    if (char === "%" || char === "_" || char === "\\") out += `\\${char}`;
    else out += char;
  }
  return out;
}

// 짧은 query용 escaped LIKE pattern. 이 문자 그대로 SQL LIKE ? ESCAPE '\'에 결합한다.
export function likePattern(query: string): string {
  return `%${escapeLike(trimmedQuery(query))}%`;
}

// FTS5 MATCH용 parameterized query. 공백으로 나뉜 첫 codepoint 3 이상 token만
// quoted term으로 남긴다. trigram은 3 미만 token을 무시하므로 잘라도 결과는 같다.
// bare token은 AND다. 모두 3 미만이면 FTS MATCH를 쓰지 않는다.
export function ftsTerms(query: string): string[] {
  const found = trimmedQuery(query).split(/\s+/)
    .filter((token) => codepoints(token) >= QUERY_CODEPOINT_MIN);
  return found.map((token) => `"${token.replaceAll('"', '""')}"`);
}

export function ftsMatchQuery(query: string): string | null {
  const terms = ftsTerms(query);
  if (terms.length === 0) return null;
  return terms.join(" ");
}

// snippet() 결꿔치기. snippet(tbl, col, open, close, ellipsis, tokens)은
// SQLite가 parameterized로 받는다. ellipsis와 tokens는 여기서 고정한다.
export const SNIPPET_ELLIPSIS = "…";
export const SNIPPET_TOKENS = 12;

// 저장 본문 줄 안 일치 위치를 준다. LIKE/FTS 일치 행의 ranges 근거다.
export function matchCodepointRange(
  text: string,
  query: string,
): { start: number; end: number } | null {
  const rest = trimmedQuery(query);
  if (rest.length === 0) return null;
  const index = text.indexOf(rest);
  if (index === -1) return null;
  return { start: index, end: index + rest.length };
}

// 줄 목록 안 query 일치 줄을 찾는다. ranges 없이 결과가 없으면 200 codepoint
// 서문 발췌로 돌아간다(R18).
export function matchingLines(
  lines: readonly string[],
  query: string,
): number[] {
  const rest = trimmedQuery(query);
  if (rest.length === 0) return [];
  const found: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].includes(rest)) found.push(index);
  }
  return found;
}

// 원문 서문 발췌. codepoint 기준 200자다.요약과 구별해 match_source 없이 쓴다.
export function preambleExcerpt(text: string): string {
  return [...text].slice(0, PREAMBLE_EXCERPT_CODEPOINTS).join("");
}

export function estimatedTokens(characters: number): number {
  return Math.ceil(characters / 3);
}

export function lineCount(text: string): number {
  return text === "" ? 0 : text.split("\n").length;
}

export function lineOffsets(text: string): number[] {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  const offsets: number[] = [];
  let byte = 0;
  for (const line of text.split("\n")) {
    offsets.push(byte);
    byte += encoder.encode(line).length + 1;
  }
  return byte === bytes.length + 1 ? offsets : offsets;
}

// LineRange 범위의 원문 조각. ranges는 대표 텍스트 1-based 줄이다.
export function textOfRanges(text: string, ranges: readonly LineRange[]): {
  ok: string[];
} {
  const lines = text.split("\n");
  const parts: string[] = [];
  for (const range of ranges) {
    for (let line = range.start_line; line <= range.end_line; line++) {
      const value = lines[line - 1];
      if (value !== undefined) parts.push(value);
    }
  }
  return { ok: parts };
}

export function validRangesFormat(ranges: unknown): ranges is LineRange[] {
  if (!Array.isArray(ranges)) return false;
  return ranges.every((range) =>
    typeof range === "object" && range !== null &&
    typeof (range as LineRange).start_line === "number" &&
    typeof (range as LineRange).end_line === "number" &&
    (range as LineRange).end_line >= (range as LineRange).start_line
  );
}

// 코덱: canonical JSON → base64. opaque cursor다. schema가 decode를 하지 않는다.
const cursorQuerySchema = z.strictObject({ query: z.string() });
const cursorFiltersSchema = z.strictObject({
  place: z.unknown().optional(),
  context: z.string().optional(),
  formats: z.array(z.string()).optional(),
});
const cursorPageSchema = z.object({
  offset: z.number().int().nonnegative(),
  complete: z.boolean().optional().nullable(),
});
const cursorSchema = z.object({
  page: cursorPageSchema,
  query: cursorQuerySchema,
  filters: cursorFiltersSchema,
  coverage: z.object({
    processed_seq: z.string(),
    rebuilding: z.boolean(),
  }),
  credential: z.string(),
});

type Cursor = z.infer<typeof cursorSchema>;

export type SearchPageBasis = {
  query: string;
  place?: unknown;
  context?: string;
  formats?: string[];
  coverage: { processed_seq: string; rebuilding: boolean };
  credential: string;
};

export function searchBasis(
  ctx: RequestContext,
  query: string,
  filters: { place?: unknown; context?: string; formats?: string[] },
  coverage: { processed_seq: string; rebuilding: boolean },
): SearchPageBasis {
  return {
    query,
    place: filters.place,
    context: filters.context,
    formats: filters.formats,
    coverage,
    credential: ctx.credential_ref,
  };
}

export function encodeSearchCursor(
  basis: SearchPageBasis,
  offset: number,
): string {
  const value: Cursor = {
    page: { offset },
    query: { query: basis.query },
    filters: {
      place: basis.place,
      context: basis.context,
      formats: basis.formats,
    },
    coverage: basis.coverage,
    credential: basis.credential,
  };
  const bytes = new TextEncoder().encode(canonicalize(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeSearchCursor(
  cursor: string,
  current: SearchPageBasis,
): Result<number> {
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = cursorSchema.safeParse(JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ));
    if (!parsed.success) return invalidCursor();
    if (
      parsed.data.query.query.trim() !== trimmedQuery(current.query) ||
      canonicalize(parsed.data.filters) !==
        canonicalize({
          place: current.place,
          context: current.context,
          formats: current.formats,
        }) ||
      parsed.data.coverage.processed_seq !== current.coverage.processed_seq ||
      parsed.data.coverage.rebuilding !== current.coverage.rebuilding ||
      parsed.data.credential !== current.credential
    ) {
      if (
        parsed.data.coverage.processed_seq !== current.coverage.processed_seq
      ) {
        return err({ code: "conflict", message: "search page basis advanced" });
      }
      return invalidCursor();
    }
    return ok(parsed.data.page.offset);
  } catch {
    return invalidCursor();
  }
}

function invalidCursor(): Result<never> {
  return err({ code: "invalid_input", message: "invalid search cursor" });
}

// outline 목록·본문 읽기 cursor. 목록 cursor는 basis_seq·query_hash(조건의
// canonical form)·sort·scope_basis(credential)·선택 판 목록에 묶인다.
// 본문 cursor는 ver·module_hash·section·include_children·ranges·줄 위치·
// 줄 안 codepoint 위치를 함께 가진다. 긴 한 줄도 codepoint 위치로 이어 읽는다.
// 조건·판 mismatch는 invalid_input, basis 만료는 conflict다(read-values 규약).
const outlineListBasisSchema = z.object({
  topic: z.string(),
  basis_seq: z.string(),
  sort: z.string(),
  conditions: z.unknown(),
  versions: z.array(z.object({ document: z.string(), version: z.string() })),
  credential: z.string(),
});
const outlineListCursorSchema = z.object({
  page: z.object({ offset: z.number().int().nonnegative() }),
  basis: outlineListBasisSchema,
});

export type OutlineListBasis = {
  topic: string;
  basis_seq: string;
  sort: string;
  conditions: unknown;
  versions: { document: string; version: string }[];
  credential: string;
};

export type OutlineResume = { offset: number };

export function encodeOutlineCursor(
  basis: OutlineListBasis,
  offset: number,
): string {
  const value = {
    page: { offset },
    basis: {
      topic: basis.topic,
      basis_seq: basis.basis_seq,
      sort: basis.sort,
      conditions: basis.conditions,
      versions: basis.versions,
      credential: basis.credential,
    },
  };
  return encodeCursorValue(outlineListCursorSchema, value);
}

export function decodeOutlineCursor(
  cursor: string,
  current: {
    topic: string;
    basis_seq: string;
    sort: string;
    conditions: unknown;
    credential: string;
  },
): Result<OutlineResume> {
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = outlineListCursorSchema.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (!parsed.success) return invalidOutlineCursor();
    const basis = parsed.data.basis;
    const different = basis.topic !== current.topic ||
      basis.sort !== current.sort ||
      canonicalize(basis.conditions) !== canonicalize(current.conditions) ||
      basis.credential !== current.credential;
    if (different) return invalidOutlineCursor();
    // basis_seq 만료. 목록을 만든 seq가 지나갔으면 안정 기준이 없다.
    if (basis.basis_seq !== current.basis_seq) {
      return err({
        code: "conflict",
        message: "outline page basis advanced",
      });
    }
    return ok({ offset: parsed.data.page.offset });
  } catch {
    return invalidOutlineCursor();
  }
}

function invalidOutlineCursor(): Result<never> {
  return err({ code: "invalid_input", message: "invalid outline cursor" });
}

// 본문 읽기 cursor. json 형식은 opaque다. schema는 decode하지 않는다.
const bodyPositionSchema = z.object({
  ver: z.string(),
  module_hash: z.string(),
  section: z.string().nullable(),
  include_children: z.boolean(),
  ranges: z.array(
    z.object({
      start_line: z.number().int().positive(),
      end_line: z.number().int().positive(),
    }),
  ),
  line: z.number().int().positive(),
  codepoint: z.number().int().nonnegative(),
  text_hash: z.string().nullable(),
});
const bodyCursorSchema = z.object({ read: bodyPositionSchema });

export type BodyPosition = {
  ver: string;
  module_hash: string;
  section: string | null;
  include_children: boolean;
  ranges: { start_line: number; end_line: number }[];
  line: number;
  codepoint: number;
  text_hash: string | null;
};

export type BodyResume = { line: number; codepoint: number };

export function encodeBodyCursor(position: BodyPosition): string {
  return encodeCursorValue(bodyCursorSchema, { read: position });
}

export function decodeBodyCursor(
  cursor: string,
  current: {
    ver: string;
    module_hash: string;
    section: string | null;
    include_children: boolean;
    ranges: readonly { start_line: number; end_line: number }[];
    text_hash: string | null;
  },
): Result<BodyResume> {
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = bodyCursorSchema.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (!parsed.success) return invalidBodyCursor();
    const read = parsed.data.read;
    const different = read.ver !== current.ver ||
      read.module_hash !== current.module_hash ||
      read.section !== current.section ||
      read.include_children !== current.include_children ||
      canonicalize(read.ranges) !== canonicalize(current.ranges);
    if (different) return invalidBodyCursor();
    // 같은 cursor는 처음 판을 유지한다. 판의 원문이 바뀌면 basis가 만료다.
    if (read.text_hash !== current.text_hash) {
      return err({ code: "conflict", message: "text basis advanced" });
    }
    return ok({ line: read.line, codepoint: read.codepoint });
  } catch {
    return invalidBodyCursor();
  }
}

function invalidBodyCursor(): Result<never> {
  return err({ code: "invalid_input", message: "invalid read cursor" });
}

function encodeCursorValue(
  schema: { safeParse(value: unknown): { success: boolean } },
  value: unknown,
): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error("cursor value is invalid");
  }
  const bytes = new TextEncoder().encode(canonicalize(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// 선택 줄��� codepoint 예산 안에서 자른다. 긴 한 줄도 줄 안 codepoint 위치로
// 겹침·누락 없이 이어 읽는다(R7). pieces는 "\n"으로 붙고, 붙임 줄바꿈도 예산에
// 센다. 범위는 1-based inclusive range로 연속 줄을 묶는다. 다음
// 위치({line, codepoint})를 준다.
export type BodyChunk = {
  text: string;
  ranges: { start_line: number; end_line: number }[];
  position: { line: number; codepoint: number };
  complete: boolean;
};

export function bodyChunk(
  lines: readonly string[],
  selected: readonly number[],
  from: { line: number; codepoint: number },
  maxCodepoints: number,
): BodyChunk {
  const pieces: string[] = [];
  const ranges: { start_line: number; end_line: number }[] = [];
  let start: number | undefined;
  let previous: number | undefined;
  let remaining = maxCodepoints;
  let position = { line: from.line, codepoint: from.codepoint };
  let complete = true;
  for (const number of selected) {
    if (number < position.line) continue;
    // 붙임 줄바꿈도 예산에 센다. 줄바꿈이 안 남으면 여기서 끊는다.
    const allowance = remaining - (pieces.length > 0 ? 1 : 0);
    if (allowance <= 0) {
      complete = false;
      break;
    }
    const value = lines[number - 1] ?? "";
    let piece = value;
    if (position.codepoint > 0) {
      piece = [...value].slice(position.codepoint).join("");
    }
    const width = [...piece].length;
    if (width > allowance) {
      piece = [...piece].slice(0, allowance).join("");
      position = {
        line: number,
        codepoint: position.codepoint + allowance,
      };
      remaining = 0;
      complete = false;
    } else {
      remaining -= width + (pieces.length > 0 ? 1 : 0);
      position = { line: number + 1, codepoint: 0 };
    }
    pieces.push(piece);
    if (previous !== undefined && number === previous + 1) {
      previous = number;
      continue;
    }
    if (start !== undefined && previous !== undefined) {
      ranges.push({ start_line: start, end_line: previous });
    }
    start = number;
    previous = number;
  }
  if (start !== undefined && previous !== undefined) {
    ranges.push({ start_line: start, end_line: previous });
  }
  return { text: pieces.join("\n"), ranges, position, complete };
}

export const SEARCH_QUIET_MS = 500;
