// search 읽기 handler. route 등록은 API 작업으로 남긴다(contract SEARCH_ROUTES,
// packages/contracts/documents/search.ts). 입력 검사와 operation scope는 dispatch가
// 이미 본다. 여기서는 ledger snapshot의 문서·판 metadata와 derived store의
// search_rows·search_fts를 읽는다. 권한 밖 ID는 후보 단계에서 빼고 count·rank·page와
// omissions도 허용 집합에서 계산한다(outline-and-search#R12, R14, R17).
// read는 derived writer 연결이 아니라 openDerivedRead의 query_only 연결이다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { LineRange } from "../../../protocol/projects/mod.ts";
import type { SearchResult } from "../../../protocol/projects/mod.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import type { DerivedRead } from "./adapters/store.ts";
import { candidateDocuments } from "./candidates.ts";
import {
  codepoints,
  decodeSearchCursor,
  encodeSearchCursor,
  preambleExcerpt,
  searchBasis,
  SNIPPET_TOKENS,
  trimmedQuery,
} from "./model.ts";
import {
  authorize,
  authorizeTarget,
  coverageOfLike,
  cutOutline,
  formatRef,
  readTextWindow,
  sectionStatusOf,
  selectBodyLines,
} from "./outline-support.ts";
import { OMISSION_UNVERIFIED, type SearchCoverage } from "./work.ts";
import type { PortLookup, SearchFilters, SearchSnapshot } from "./types.ts";

export type { SearchFilters, SearchSnapshot };
export type { PortLookup } from "./types.ts";

export type SearchQueryInput = SearchFilters & {
  query: string;
  cursor?: string;
  limit?: number;
};

export type SearchStatusInput = SearchFilters & {
  documents?: string[];
};

export type SearchHandlerDeps = {
  read: DerivedRead;
  snapshot: SearchSnapshot;
  ports: PortLookup;
};

export type SearchHandlers = {
  query(ctx: RequestContext, input: SearchQueryInput): Result<SearchQueryPage>;
  status(
    ctx: RequestContext,
    input: SearchStatusInput,
  ): Result<SearchStatusPage>;
};

export type SearchQueryPage = {
  results: SearchResult[];
  coverage: SearchCoverage;
  as_of_seq: string;
  next_cursor: string | null;
  complete: boolean;
};

export type SearchStatusPage = {
  documents: IndexDocument[];
  coverage: SearchCoverage;
  as_of_seq: string;
  next_cursor: null;
  complete: boolean;
};

export type IndexDocument = {
  document: string;
  version: string | null;
  latest_version: string;
  module_hash: string | null;
  format: SearchResult["format"] | null;
};

const DEFAULT_LIMIT = 30;

// 요약·주제 cache 비교는 같은 규약이므로 3 codepoint 미만 query도 비교한다.
// FTS trigram이 건너뛰는 query는 cache text 비교로 찾는다.
function needLike(_input: SearchQueryInput): boolean {
  return false;
}

// handler 두 개. route 선언은 contract가 하고, 여기서는 read handler만 낸다.
export function createSearchHandlers(deps: SearchHandlerDeps): SearchHandlers {
  return {
    query(ctx, input) {
      const rest = trimmedQuery(input.query);
      if (rest.length === 0) {
        return err({ code: "invalid_input", message: "blank query" });
      }
      const candidates = candidateDocuments(
        deps.snapshot,
        ctx,
        deps.ports,
        input,
        undefined,
      );
      const coverage = coverageOfLike(
        deps.read,
        deps.snapshot.as_of_seq,
        candidates,
      );
      if (coverage.rebuilding || coverage.lagging) {
        // 재생성 중·뒤처짐이면 결과 없이 진실만 낸다. 빈 검색을 원본 부재로 판정하지
        // 않는다(R14). omissions도 허용 집합에서 뺀다(존재를 새지 않는다).
        return ok({
          results: [],
          coverage,
          as_of_seq: deps.snapshot.as_of_seq,
          next_cursor: null,
          complete: true,
        });
      }
      const limit = input.limit ?? DEFAULT_LIMIT;
      // cursor는 질의·필터·색인 반영 위치·자격에 묶인다. 다르면 invalid_input·conflict다.
      const basis = searchBasis(ctx, input.query, input, coverage);
      const offset = input.cursor === undefined
        ? ok(0)
        : decodeSearchCursor(input.cursor, basis);
      if (!offset.ok) return offset;
      const results = matchDocuments(
        deps,
        ctx,
        candidates,
        input,
        coverage.ledger_basis_seq,
        Number.MAX_SAFE_INTEGER,
      );
      // 가용 요약·주제 cache의 결과를 합친다. 같은 LIKE 규약으로 현재 허용
      // 대상에 한해 비교한다. 아니오 모두 원문 일치에 흡수되지 않는다.
      const cacheResults: SearchResult[] = [];
      if (
        coverage.processed_seq === coverage.ledger_basis_seq &&
        !needLike(input)
      ) {
        for (const found of cacheMatchingDocuments(deps, candidates, rest)) {
          const result = buildCacheResult(
            deps,
            found.document,
            found.row,
            rest,
          );
          if (result === null) continue;
          // 원문 일치(같은 문서·section)는 실제 본문 근거가 우선이다.
          if (
            results.some((kept) =>
              kept.document === result.document &&
              kept.section === result.section
            )
          ) continue;
          cacheResults.push(result);
        }
      }
      const all = [...results, ...cacheResults];
      const merged = all.slice(offset.value, offset.value + limit);
      const complete = offset.value + limit >= all.length;
      return ok({
        results: merged,
        coverage,
        as_of_seq: deps.snapshot.as_of_seq,
        next_cursor: complete
          ? null
          : encodeSearchCursor(basis, offset.value + limit),
        complete,
      });
    },
    status(ctx, input) {
      const candidates = candidateDocuments(
        deps.snapshot,
        ctx,
        deps.ports,
        input,
        input.documents,
      );
      const coverage = coverageOfLike(
        deps.read,
        deps.snapshot.as_of_seq,
        candidates,
      );
      const documents: IndexDocument[] = [];
      for (const id of candidates) {
        const indexed = indexedOf(deps.read, deps.snapshot, id);
        if (indexed !== undefined) documents.push(indexed);
      }
      return ok({
        documents,
        coverage,
        as_of_seq: deps.snapshot.as_of_seq,
        next_cursor: null,
        complete: true,
      });
    },
  };
}

function matchDocuments(
  deps: SearchHandlerDeps,
  _ctx: RequestContext,
  candidates: Set<string>,
  input: SearchQueryInput,
  _basis: string,
  limit: number,
): SearchResult[] {
  const results: SearchResult[] = [];
  const query = input.query;
  for (const id of candidates) {
    // 문서의 section 행 전부. 한 문서의 여러 section이 각각 일치할 수 있다.
    const rows = deps.read.sql.all(
      `SELECT document, version, section_key, ranges, title, body FROM search_rows WHERE document = ? ORDER BY rowid`,
      [id],
    );
    if (rows.length === 0) continue;
    const latest = latestOf(deps.snapshot, id);
    if (latest === null) continue;
    for (const row of rows) {
      const version = String(row["version"]);
      if (input.formats !== undefined && input.formats.length > 0) {
        if (!input.formats.includes(fmtName(deps.snapshot, version))) continue;
      }
      // 일치 판정. title·body 둘 다 본다.
      const title = String(row["title"]);
      const body = String(row["body"]);
      if (!title.includes(query) && !body.includes(query)) continue;
      const result = buildResult(deps, id, version, row, query, latest);
      if (result !== undefined) results.push(result);
    }
  }
  return results.slice(0, limit);
}

// 가용 요약·주제 cache의 결과. 같은 trigram/LIKE 규약으로 현재 허용 대상만
// 비교한다(architecture/documents 5.4). cache 일치는 실제 입력 판·section·
// input_hash·stale을 별도로 낸다. 매칭의 근거가 text 비교다. 요약 cache 행은
// text가 있는 행만 규약 결과로 센다(summaryCacheSchema.text가 required).
function cacheMatchingDocuments(
  deps: SearchHandlerDeps,
  candidates: ReadonlySet<string>,
  query: string,
): { document: string; row: Record<string, unknown> }[] {
  const rows = deps.read.sql.all(
    `SELECT version, section_key, input_hash, text
     FROM summary_cache WHERE text IS NOT NULL ORDER BY version, section_key`,
    [],
  );
  const found: { document: string; row: Record<string, unknown> }[] = [];
  for (const row of rows) {
    if (!String(row["text"]).includes(query)) continue;
    const document = versionDocument(deps.snapshot, String(row["version"]));
    if (document === null || !candidates.has(document)) continue;
    found.push({ document, row });
  }
  return found;
}

function versionDocument(
  snapshot: SearchSnapshot,
  version: string,
): string | null {
  const row = snapshot.sql.get(
    `SELECT document FROM versions WHERE id = ?`,
    [version],
  );
  return row === undefined ? null : String(row["document"]);
}

function buildCacheResult(
  deps: SearchHandlerDeps,
  document: string,
  row: Record<string, unknown>,
  query: string,
): SearchResult | null {
  const version = String(row["version"]);
  const format = formatRef(deps.snapshot, version);
  if (format === null) return null;
  const latest = latestOf(deps.snapshot, document);
  if (latest === null) return null;
  const section = row["section_key"] === null
    ? null
    : String(row["section_key"]);
  // 요약의 위치를 원문 일치 줄처럼 꾸미지 않는다. ranges는 없고 reference는
  // 실제 입력 판을 가리킨다. 문서 제목으로 title을 두고 score는 고정값이다.
  return {
    document,
    version,
    latest_version: latest,
    format,
    module_hash: format.module_hash,
    section,
    ranges: [],
    reference: {
      document,
      section,
      version,
    },
    title: documentTitle(deps.snapshot, document),
    snippet: cacheSnippet(String(row["text"]), query),
    score: 1,
    match_source: section === null ? "summary" : "topic",
    cache_basis: {
      version,
      section,
      input_hash: String(row["input_hash"]),
      stale: version !== latest,
    },
  };
}

function documentTitle(snapshot: SearchSnapshot, document: string): string {
  const row = snapshot.sql.get(
    `SELECT title FROM documents WHERE id = ?`,
    [document],
  );
  return row === undefined ? document : String(row["title"] ?? document);
}

function cacheSnippet(text: string, query: string): string {
  const index = text.indexOf(query);
  const total = codepoints(text);
  if (index === -1) return [...text].slice(0, SNIPPET_TOKENS * 2).join("");
  const before = codepoints(text.slice(0, index));
  const head = Math.max(0, before - SNIPPET_TOKENS);
  const length = SNIPPET_TOKENS * 2 + codepoints(query);
  const parts = [...text].slice(head, head + length);
  const lead = head > 0 ? "…" : "";
  const tail = head + length < total ? "…" : "";
  return `${lead}${parts.join("")}${tail}`;
}

function fmtName(snapshot: SearchSnapshot, version: string): string {
  const row = snapshot.sql.get(
    `SELECT format_name FROM versions WHERE id = ?`,
    [version],
  );
  return row === undefined ? "" : String(row["format_name"] ?? "");
}

function latestOf(snapshot: SearchSnapshot, document: string): string | null {
  const row = snapshot.sql.get(
    `SELECT id FROM versions WHERE document = ? ORDER BY number DESC LIMIT 1`,
    [document],
  );
  return row === undefined ? null : String(row["id"]);
}

function buildResult(
  deps: SearchHandlerDeps,
  document: string,
  version: string,
  row: Record<string, unknown>,
  query: string,
  latest: string,
): SearchResult | undefined {
  const format = formatRef(deps.snapshot, version);
  if (format === null) return undefined;
  const title = String(row["title"]);
  const body = String(row["body"]);
  const ranges = documentRanges(
    lineRanges(body, query),
    sectionLineNumbers(row["ranges"]),
  );
  if (ranges.length === 0) return undefined;
  const section = row["section_key"] === null
    ? null
    : String(row["section_key"]);
  return {
    document,
    version,
    latest_version: latest,
    format,
    module_hash: format.module_hash,
    section,
    ranges,
    // 고정 판 참조는 문서 ID와 판 ID다. 자리·이름 주소로 바꾸지 않는다.
    reference: { document, section, version },
    title,
    snippet: snippetText(body, query),
    score: scoreText(title, body, query),
    match_source: "original",
    cache_basis: null,
  };
}

// section 행의 body는 own 범위 줄만 이어 붙인 것이라 body의 n번째 줄이 문서의 몇 번째 줄인지
// 다르다. own 범위(JSON)를 줄 번호 목록으로 펼친다. 범위가 없는 행(section 없는 판)은 본문
// 전체라 body의 줄 번호가 곧 문서의 줄 번호이고, 이때는 undefined다.
function sectionLineNumbers(value: unknown): number[] | undefined {
  if (typeof value !== "string") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  const lines: number[] = [];
  for (const range of parsed as { start_line: number; end_line: number }[]) {
    for (let line = range.start_line; line <= range.end_line; line++) {
      lines.push(line);
    }
  }
  return lines;
}

// body 줄 범위를 문서 줄 범위로 바꾼다. 문서에서 이어지지 않는 줄은 범위를 나눈다.
function documentRanges(
  found: LineRange[],
  lines: number[] | undefined,
): LineRange[] {
  if (lines === undefined) return found;
  const mapped: LineRange[] = [];
  for (const range of found) {
    let start: number | undefined;
    let previous: number | undefined;
    for (let line = range.start_line; line <= range.end_line; line++) {
      const document = lines[line - 1];
      if (document === undefined) continue;
      if (previous !== undefined && document === previous + 1) {
        previous = document;
        continue;
      }
      if (start !== undefined && previous !== undefined) {
        mapped.push({ start_line: start, end_line: previous });
      }
      start = document;
      previous = document;
    }
    if (start !== undefined && previous !== undefined) {
      mapped.push({ start_line: start, end_line: previous });
    }
  }
  return mapped;
}

// 일치 줄을 1-based inclusive range로 묶는다. 검색 판 본문의 근거다(R12).
function lineRanges(body: string, query: string): LineRange[] {
  const rest = trimmedQuery(query);
  if (rest.length === 0) return [];
  const lines = body.split("\n");
  const found: LineRange[] = [];
  let start: number | undefined;
  let previous: number | undefined;
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].includes(rest)) continue;
    const line = index + 1;
    if (previous !== undefined && line === previous + 1) {
      previous = line;
      continue;
    }
    if (start !== undefined && previous !== undefined) {
      found.push({ start_line: start, end_line: previous });
    }
    start = line;
    previous = line;
  }
  if (start !== undefined && previous !== undefined) {
    found.push({ start_line: start, end_line: previous });
  }
  return found;
}

function snippetText(body: string, query: string): string {
  const rest = trimmedQuery(query);
  if (rest.length === 0) return "";
  const index = body.indexOf(rest);
  const total = codepoints(body);
  if (index === -1) return [...body].slice(0, SNIPPET_TOKENS * 2).join("");
  const before = codepoints(body.slice(0, index));
  const head = Math.max(0, before - SNIPPET_TOKENS);
  const length = SNIPPET_TOKENS * 2 + codepoints(rest);
  const parts = [...body].slice(head, head + length);
  const lead = head > 0 ? "…" : "";
  const tail = head + length < total ? "…" : "";
  return `${lead}${parts.join("")}${tail}`;
}

function scoreText(title: string, body: string, query: string): number {
  const rest = trimmedQuery(query);
  if (rest.length === 0) return 0;
  if (title.includes(rest)) return 2;
  if (body.includes(rest)) return 1;
  return 0.5;
}

function indexedOf(
  read: DerivedRead,
  snapshot: SearchSnapshot,
  id: string,
): IndexDocument | undefined {
  const row = read.sql.get(
    `SELECT indexed_version FROM search_documents WHERE document = ?`,
    [id],
  );
  if (row === undefined) return undefined;
  const indexed = String(row["indexed_version"]);
  const latest = latestOf(snapshot, id);
  if (latest === null) return undefined;
  const format = formatRef(snapshot, indexed);
  return {
    document: id,
    version: format === null ? null : indexed,
    latest_version: latest,
    module_hash: format === null ? null : format.module_hash,
    format,
  };
}

// 요약 없는 문서의 서문 발췌. 요약과 구분이다(R18).
export function excerptOf(text: string): string {
  return preambleExcerpt(text);
}

// outline·단계적 읽기 handler. root·place·document outline·본문 읽기를
// ledger snapshot(문서·판 metadata)과 derived store(sections·texts·extraction
// 상태)로 조립한다. 목록에 본문을 싣지 않는다(R1). 목록의 본문 자리는
// 발췌와 요약뿐이다(R3). count·순서·길이도 허용 집합에서 계산한다.
// scope 밖 대상은 존재를 새지 않는다. 없는 대상과 같은 응답이다.
import type { At } from "../../../protocol/server/mod.ts";
import type {
  ContentFileReference,
  FormatRef,
  Section,
} from "../../../protocol/projects/mod.ts";
import {
  decodeOutlineCursor,
  encodeOutlineCursor,
  estimatedTokens,
  lineCount,
} from "./model.ts";
import {
  DOCUMENT_OUTLINE_DEPTH,
  EXCERPT_CODEPOINT_LIMIT,
  READ_CODEPOINT_BUDGET,
} from "../../../protocol/projects/mod.ts";

export type OutlineRootInput = {
  estimated_token_budget?: number;
  cursor?: string;
};

export type OutlinePlaceInput = {
  place: { kind: "project" | "app"; id: string };
  estimated_token_budget?: number;
  cursor?: string;
};

export type OutlineDocumentInput = {
  reference:
    | { document: string; version?: string | null; section?: string | null }
    | {
      place: string;
      document: string;
      section?: string | null;
      version?: number | null;
    };
  depth?: number;
  estimated_token_budget?: number;
  cursor?: string;
};

export type DocumentReadInput = {
  reference: {
    document?: string;
    place?: string;
    section?: string | null;
    version?: string | number | null;
  };
  section?: string | null;
  include_children?: boolean;
  ranges?: { start_line: number; end_line: number }[];
  max_codepoints?: number;
  cursor?: string;
};

// R15의 근원. 선택 판 직접 추출. worker 조립이 넣는다(T11/T14 조립 seam).
export type DirectExtraction = (record: {
  document: string;
  version: string;
}) => void;

export type OutlineHandlerDeps = {
  read: DerivedRead;
  snapshot: SearchSnapshot;
  ports: PortLookup;
  // 선택 판이 derived에 없을 때 직접 추출하는 근원. 없으면 미완료로 답한다.
  extract?: DirectExtraction;
  // 출력 redaction. 이 grep은 없음 % Escape를 건너 뛴다.
  redactor?: (
    source: { concern: string; revision: string; scope: string },
    mediaType: string,
    text: string,
  ) => string | null;
};

export type OutlineHandlers = {
  root(ctx: RequestContext, input: OutlineRootInput): Result<OutlineRootPage>;
  place(
    ctx: RequestContext,
    input: OutlinePlaceInput,
  ): Result<OutlinePlacePage>;
  document(
    ctx: RequestContext,
    input: OutlineDocumentInput,
  ): Result<OutlineDocumentPage>;
  read(ctx: RequestContext, input: DocumentReadInput): Result<DocumentReadPage>;
};

export type OutlineRootEntry =
  | {
    kind: "project";
    id: string;
    title: string;
    purpose: string;
    activity_seq: string;
    document_count: number;
  }
  | {
    kind: "app";
    id: string;
    title: string;
    purpose: string;
    activity_seq: string;
    document_count: number;
  }
  | { kind: "unplaced"; document_count: number };

export type OutlineRootPage = {
  kind: "root";
  basis_seq: string;
  entries: OutlineRootEntry[];
  as_of_seq: string;
  next_cursor: string | null;
  complete: boolean;
};

export type OutlinePlacePage = {
  kind: "place";
  basis_seq: string;
  entries: OutlinePlaceEntryValue[];
  coverage: OutlineCoverageValue;
  as_of_seq: string;
  next_cursor: string | null;
  complete: boolean;
};

export type OutlinePlaceEntryValue = {
  document: string;
  name: string | null;
  title: string;
  version: string;
  latest_version: string;
  format: FormatRef;
  saved_by: string;
  saved_at: At;
  excerpt: string | null;
  summary: {
    version: string;
    section: string | null;
    text: string;
    input_hash: string;
    stale: boolean;
  } | null;
  section_count: number;
};

export type OutlineCoverageValue = {
  processed_seq: string;
  ledger_basis_seq: string;
  lagging: boolean;
  rebuilding: boolean;
  omissions: { document: string; version: string; reason: string }[];
};

export type OutlineDocumentPage = {
  kind: "document";
  basis_seq: string;
  document: string;
  version: string;
  latest_version: string;
  format: FormatRef;
  module_hash: string;
  section_status: string;
  failure_reason: string | null;
  file: ContentFileReference | null;
  entries: Section[];
  as_of_seq: string;
  next_cursor: string | null;
  complete: boolean;
};

export type DocumentReadPage = {
  file: ContentFileReference | null;
  document: string;
  version: string;
  latest_version: string;
  format: FormatRef;
  module_hash: string;
  section: string | null;
  section_status: string;
  include_children: boolean;
  ranges: { start_line: number; end_line: number }[];
  text: string | null;
  redacted: boolean;
  failure_reason: string | null;
  omission_reason: string | null;
  complete: boolean;
  next_cursor: string | null;
  as_of_seq: string;
};

function deny(): Result<never> {
  return err({ code: "not_found", message: "outline does not resolve" });
}

// 공용 sections·texts 읽기. static이 아닌 derived query_only 연결이다.
function extractedStatus(
  deps: OutlineHandlerDeps,
  version: string,
): { status: string; failure_reason: string | null } {
  const row = deps.read.sql.get(
    `SELECT extraction_status, failure_reason, unverified_reason FROM derived_versions WHERE version = ?`,
    [version],
  );
  if (row === undefined) return { status: "unverified", failure_reason: null };
  // unverified의 이유(추출 한도 같은 것)는 failure_reason 자리로 읽는 쪽에 전한다.
  const reason = row["failure_reason"] ?? row["unverified_reason"];
  return {
    status: String(row["extraction_status"]),
    failure_reason: reason === null || reason === undefined
      ? null
      : String(reason),
  };
}

// root 활동 순 목록. project·app 자리를 마지막 활동 seq가 큰 순서로(동점은
// kind·ID 순) 두고 자리 없는 문서 묶음을 마지막에 둔다. 권한 밖 자리는 없는 것과 같다.
function buildRootEntries(
  deps: OutlineHandlerDeps,
  ctx: RequestContext,
): OutlineRootEntry[] {
  const placed: OutlineRootEntry[] = [];
  const projects = deps.snapshot.sql.all(
    `SELECT id, name, title, purpose, revision FROM projects WHERE status = 'active'`,
    [],
  );
  for (const row of projects) {
    const id = String(row["id"]);
    if (!authorizeTarget(deps, ctx, "outline.root", id, "project", id)) {
      continue;
    }
    placed.push({
      kind: "project",
      id,
      title: String(row["title"] ?? row["name"] ?? ""),
      purpose: String(row["purpose"] ?? ""),
      activity_seq: String(row["revision"] ?? "0"),
      document_count: placeDocumentCount(deps, "project", id),
    });
  }
  const apps = deps.snapshot.sql.all(
    `SELECT id, slug, name, description, revision FROM apps WHERE status = 'active'`,
    [],
  );
  for (const row of apps) {
    const id = String(row["id"]);
    if (!authorizeTarget(deps, ctx, "outline.root", id, "app", id)) continue;
    placed.push({
      kind: "app",
      id,
      title: String(row["name"] ?? row["slug"] ?? ""),
      purpose: String(row["description"] ?? ""),
      activity_seq: String(row["revision"] ?? "0"),
      document_count: placeDocumentCount(deps, "app", id),
    });
  }
  placed.sort(compareActivity);
  // 자리 없는 문서는 자리 target이 없다. 자리·문서로 범위가 좁은 credential은 이 묶음의 건수도
  // 볼 수 없으므로 target 없는 판정이 통과할 때만 묶음을 낸다.
  const unplaced = authorize(deps.ports, ctx, "outline.root", {})
    ? placeDocumentCount(deps, null, null)
    : 0;
  if (unplaced > 0) {
    placed.push({ kind: "unplaced", document_count: unplaced });
  }
  return placed;
}

// 활동 seq 내림차순, 동점은 kind·ID 순이다. seq는 문자열 숫자라 BigInt로 비교한다.
function compareActivity(a: OutlineRootEntry, b: OutlineRootEntry): number {
  if (a.kind === "unplaced" || b.kind === "unplaced") return 0;
  const left = BigInt(a.activity_seq);
  const right = BigInt(b.activity_seq);
  if (left !== right) return left > right ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rootEntryCost(entry: OutlineRootEntry): number {
  return entry.kind === "unplaced" ? estimatedTokens(120) : estimatedTokens(
    120 + [...entry.title].length + [...entry.purpose].length,
  );
}

function placeDocumentCount(
  deps: OutlineHandlerDeps,
  kind: string | null,
  id: string | null,
): number {
  const row = kind === null
    ? deps.snapshot.sql.get(
      `SELECT COUNT(*) AS count FROM documents
       WHERE place_kind IS NULL AND status = 'active'`,
      [],
    )
    : deps.snapshot.sql.get(
      `SELECT COUNT(*) AS count FROM documents
       WHERE place_kind = ? AND place_id = ? AND status = 'active'`,
      [kind, id],
    );
  if (row === undefined) return 0;
  const value = row["count"];
  return typeof value === "bigint"
    ? Number(value)
    : typeof value === "number"
    ? value
    : 0;
}

// place 갱신 순 목록. 이름·제목·format·선택 판·갱신 시각·발췌·section 수다.
// 본문을 싣지 않는다(R1). agent 경로·디스크 상태도 없다(R3).
function buildPlaceEntries(
  deps: OutlineHandlerDeps,
  ctx: RequestContext,
  place: { kind: "project" | "app"; id: string },
  budget: number,
  offset: number,
): { entries: OutlinePlaceEntryValue[]; complete: boolean } {
  const rows = deps.snapshot.sql.all(
    `SELECT d.id, d.name, d.title, d.latest_version, d.revision
     FROM documents d
     WHERE d.place_kind = ? AND d.place_id = ? AND d.status = 'active'
     ORDER BY d.revision DESC, d.id`,
    [place.kind, place.id],
  );
  const entries: OutlinePlaceEntryValue[] = [];
  let used = 0;
  let complete = true;
  // offset은 허용된 항목 수다. 앞 page가 담은 만큼 건너뛰고 이어 담는다.
  let skipped = 0;
  for (const row of rows) {
    const document = String(row["id"]);
    if (
      !authorizeTarget(
        deps,
        ctx,
        "outline.place",
        document,
        place.kind,
        place.id,
      )
    ) continue;
    const latest = latestVersion(deps.snapshot, document);
    if (latest === null) continue;
    const format = formatRef(deps.snapshot, latest);
    if (format === null) continue;
    if (skipped < offset) {
      skipped += 1;
      continue;
    }
    const bytes = estimatedTokens(entryCost(deps, latest));
    if (used + bytes > budget && entries.length > 0) {
      complete = false;
      break;
    }
    used += bytes;
    entries.push(placeEntry(deps, row, document, latest, format));
  }
  return { entries, complete };
}

function entryCost(
  deps: OutlineHandlerDeps,
  version: string,
): number {
  const row = deps.read.sql.get(
    `SELECT section_count, line_count FROM derived_versions WHERE version = ?`,
    [version],
  );
  // 목록 자리의 비용. section과 줄 수가 크기다. 본문은 싣지 않는다.
  if (row === undefined) return EXCERPT_CODEPOINT_LIMIT + 120;
  const sections = numberCell(row["section_count"]);
  const lines = numberCell(row["line_count"]);
  return sections > 0 ? sections * 24 + Math.min(lines, 200) : 120;
}

function latestVersion(
  snapshot: SearchSnapshot,
  document: string,
): string | null {
  const row = snapshot.sql.get(
    `SELECT latest_version FROM documents WHERE id = ?`,
    [document],
  );
  return row === undefined ? null : String(row["latest_version"]);
}

function placeEntry(
  deps: OutlineHandlerDeps,
  row: Record<string, unknown>,
  document: string,
  version: string,
  format: FormatRef,
): OutlinePlaceEntryValue {
  const savedBy = deps.snapshot.sql.get(
    `SELECT saved_by, saved_at FROM versions WHERE id = ?`,
    [version],
  );
  const summary = cacheSummary(deps, version);
  const excerpt = summary === null ? entryExcerpt(deps, version) : null;
  return {
    document,
    name: row["name"] === null || row["name"] === undefined
      ? null
      : String(row["name"]),
    title: String(row["title"] ?? ""),
    version,
    latest_version: latestVersion(deps.snapshot, document) ?? version,
    format,
    saved_by: String(savedBy?.["saved_by"] ?? "user"),
    saved_at: String(savedBy?.["saved_at"] ?? "1970-01-01T00:00:00.000Z") as At,
    excerpt,
    summary,
    section_count: sectionCount(deps, version),
  };
}

function cacheSummary(
  deps: OutlineHandlerDeps,
  version: string,
): OutlinePlaceEntryValue["summary"] {
  const row = deps.read.sql.get(
    `SELECT section_key, input_hash, text FROM summary_cache
     WHERE version = ? AND text IS NOT NULL
     ORDER BY section_key LIMIT 1`,
    [version],
  );
  if (row === undefined) return null;
  return {
    version,
    section: row["section_key"] === null || row["section_key"] === undefined
      ? null
      : String(row["section_key"]),
    text: String(row["text"]),
    input_hash: String(row["input_hash"]),
    stale: false,
  };
}

function entryExcerpt(
  deps: OutlineHandlerDeps,
  version: string,
): string | null {
  const row = deps.read.sql.get(
    `SELECT text FROM derived_texts WHERE version = ?`,
    [version],
  );
  if (row === undefined) return null;
  const text = String(row["text"]);
  return [...text].slice(0, EXCERPT_CODEPOINT_LIMIT).join("");
}

function sectionCount(deps: OutlineHandlerDeps, version: string): number {
  const row = deps.read.sql.get(
    `SELECT section_count FROM derived_versions WHERE version = ?`,
    [version],
  );
  if (row === undefined) return 0;
  const value = row["section_count"];
  return typeof value === "bigint"
    ? Number(value)
    : typeof value === "number"
    ? value
    : 0;
}

// document outline. depth·estimated_token_budget 예산, 숨긴 자식 수, 추출 상태.
function buildDocumentOutline(
  deps: OutlineHandlerDeps,
  document: string,
  version: string,
  depth: number,
  budget: number,
): Result<OutlineDocumentPage> {
  const status = extractedStatus(deps, version);
  const format = formatRef(deps.snapshot, version);
  if (format === null) return deny();
  const latest = latestVersion(deps.snapshot, document);
  if (latest === null) return deny();
  const file = primaryFile(deps.snapshot, version);
  const term = sectionStatusOf(status);
  if (term !== null) {
    // 추출 실패·미지원·미완료. entries는 없고 fallback 근거만 낸다.
    return ok({
      kind: "document",
      basis_seq: deps.snapshot.as_of_seq,
      document,
      version,
      latest_version: latest,
      format,
      module_hash: format.module_hash,
      section_status: term.status,
      failure_reason: term.failure_reason,
      file,
      entries: [],
      as_of_seq: deps.snapshot.as_of_seq,
      next_cursor: null,
      complete: true,
    });
  }
  const rows = deps.read.sql.all(
    `SELECT key, title, parent, position, level, anchor, own_ranges, subtree_range,
            characters, body_hash, children_count
     FROM derived_sections WHERE version = ? ORDER BY position`,
    [version],
  );
  const sections: Section[] = [];
  for (const row of rows) {
    const own = parseRanges(row["own_ranges"]);
    const characters = numberCell(row["characters"]);
    const level = numberCell(row["level"]);
    const section: Section = {
      key: String(row["key"]),
      title: String(row["title"]),
      parent: row["parent"] === null || row["parent"] === undefined
        ? null
        : String(row["parent"]),
      position: numberCell(row["position"]),
      level,
      anchor: row["anchor"] === null || row["anchor"] === undefined
        ? null
        : String(row["anchor"]),
      characters,
      body_hash: String(row["body_hash"]),
      own_ranges: own,
      subtree_range: parseOne(row["subtree_range"]),
      version,
      estimated_tokens: estimatedTokens(characters),
      children_count: numberCell(row["children_count"]),
      hidden_children_count: 0,
    };
    sections.push(section);
  }
  // depth 컷과 예산 컷: 설치 안내 outline과 같은 함수다.
  const { entries, complete } = cutOutline(sections, depth, budget);
  return ok({
    kind: "document",
    basis_seq: deps.snapshot.as_of_seq,
    document,
    version,
    latest_version: latest,
    format,
    module_hash: format.module_hash,
    section_status: "whole",
    failure_reason: null,
    file,
    entries,
    as_of_seq: deps.snapshot.as_of_seq,
    next_cursor: complete ? null : encodeOutlineCursor({
      topic: "outline.document",
      basis_seq: deps.snapshot.as_of_seq,
      sort: "position",
      conditions: { document, depth, budget },
      versions: [{ document, version }],
      credential: "outline",
    }, entries.length),
    complete,
  });
}

function primaryFile(
  snapshot: SearchSnapshot,
  version: string,
): ContentFileReference | null {
  const row = snapshot.sql.get(
    `SELECT path, blob_hash, bytes, media_type FROM version_files
     WHERE version = ? AND primary_file = 1 ORDER BY path LIMIT 1`,
    [version],
  );
  if (row === undefined) return null;
  const bytes = numberCell(row["bytes"]);
  return {
    version,
    path: String(row["path"]),
    blob_hash: String(row["blob_hash"]),
    bytes,
    media_type: String(row["media_type"]),
    primary: true,
  };
}

function parseRanges(
  value: unknown,
): { start_line: number; end_line: number }[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((range) => ({
      start_line: numberCell((range as { start_line: unknown }).start_line),
      end_line: numberCell((range as { end_line: unknown }).end_line),
    }));
  } catch {
    return [];
  }
}

// subtree_range는 범위 하나(JSON 객체)로 저장된다. 배열 모양도 받는다.
function parseOne(value: unknown): { start_line: number; end_line: number } {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ) {
        const range = parsed as { start_line?: unknown; end_line?: unknown };
        return {
          start_line: numberCell(range.start_line),
          end_line: numberCell(range.end_line),
        };
      }
    } catch { /* 아래 기본 범위 */ }
  }
  return parseRanges(value)[0] ?? { start_line: 1, end_line: lineCount("") };
}

function numberCell(value: unknown): number {
  return typeof value === "bigint"
    ? Number(value)
    : typeof value === "number"
    ? value
    : 0;
}

// 본문 읽기. section·자식 포함·줄 범위 선택, 12,000 codepoint 예산, 이어 읽기.
// outline 뒤 새 판이 저장돼도 같은 cursor는 처음 판을 유지한다(R8).
// 원문 파일 참조는 모든 답에 싣는다: 계약은 unverified·unsupported 판에 그 참조를
// 요구하고, 호출자가 documents/file로 원문을 열게 한다.
function readDocumentBody(
  deps: OutlineHandlerDeps,
  ctx: RequestContext,
  input: DocumentReadInput,
): Result<DocumentReadPage> {
  const page = readSelectedBody(deps, ctx, input);
  if (!page.ok) return page;
  return ok({
    ...page.value,
    file: primaryFile(deps.snapshot, page.value.version),
  });
}

function readSelectedBody(
  deps: OutlineHandlerDeps,
  ctx: RequestContext,
  input: DocumentReadInput,
): Result<Omit<DocumentReadPage, "file">> {
  const reference = input.reference;
  const document = typeof reference.document === "string"
    ? reference.document
    : null;
  if (document === null) return deny();
  const row = deps.snapshot.sql.get(
    `SELECT id, place_kind, place_id, latest_version, status FROM documents WHERE id = ?`,
    [document],
  );
  // 보관한 문서도 확정한 판은 읽는다(versions#R11, outline-and-search#R17). 보관은 목록·검색에서
  // 빼는 상태일 뿐 판 읽기를 막지 않는다.
  if (row === undefined) return deny();
  if (
    !authorizeTarget(
      deps,
      ctx,
      "document.read",
      document,
      row["place_kind"] === null || row["place_kind"] === undefined
        ? undefined
        : String(row["place_kind"]),
      row["place_id"] === null || row["place_id"] === undefined
        ? undefined
        : String(row["place_id"]),
      typeof reference.version === "string" ? reference.version : undefined,
    )
  ) return deny();
  const latest = latestVersion(deps.snapshot, document);
  if (latest === null) return deny();
  const requested =
    reference.version === null || reference.version === undefined
      ? latest
      : String(reference.version);
  const exists = deps.snapshot.sql.get(
    `SELECT format_name, module_hash FROM versions WHERE id = ? AND document = ?`,
    [requested, document],
  );
  if (exists === undefined) return deny();
  const format = formatRef(deps.snapshot, requested);
  if (format === null) return deny();
  const section = input.section ?? null;
  const includeChildren = input.include_children ?? false;
  const budget = input.max_codepoints ?? READ_CODEPOINT_BUDGET;
  // 추출 상태. failed·unverified는 unverified, unsupported는 그대로다(R22).
  const status = extractedStatus(deps, requested);
  const term = sectionStatusOf(status);
  if (term !== null) {
    return ok({
      document,
      version: requested,
      latest_version: latest,
      format,
      module_hash: format.module_hash,
      section,
      section_status: term.status,
      include_children: includeChildren,
      ranges: [],
      text: null,
      redacted: false,
      failure_reason: term.failure_reason,
      omission_reason: null,
      complete: true,
      next_cursor: null,
      as_of_seq: deps.snapshot.as_of_seq,
    });
  }
  // 성공 추출에 key 없음은 missing이다(R22).
  if (section !== null && !versionHasSection(deps, requested, section)) {
    return ok({
      document,
      version: requested,
      latest_version: latest,
      format,
      module_hash: format.module_hash,
      section,
      section_status: "missing",
      include_children: includeChildren,
      ranges: [],
      text: null,
      redacted: false,
      failure_reason: null,
      omission_reason: null,
      complete: true,
      next_cursor: null,
      as_of_seq: deps.snapshot.as_of_seq,
    });
  }
  const content = deps.read.sql.get(
    `SELECT text_hash, text FROM derived_texts WHERE version = ?`,
    [requested],
  );
  if (content === undefined) {
    // derived에 없다. 직접 추출(R15)을 시도하고 미완료로 답한다. worker 조립이
    // extract를 넣는다. 없는 조립도 검색을 기다리지 않고 미완료 하나다.
    if (deps.extract !== undefined) {
      deps.extract({ document, version: requested });
    }
    return ok({
      document,
      version: requested,
      latest_version: latest,
      format,
      module_hash: format.module_hash,
      section,
      section_status: "unverified",
      include_children: includeChildren,
      ranges: [],
      text: null,
      redacted: false,
      failure_reason: status.failure_reason ?? OMISSION_UNVERIFIED,
      omission_reason: null,
      complete: true,
      next_cursor: null,
      as_of_seq: deps.snapshot.as_of_seq,
    });
  }
  const text = String(content["text"]);
  const textHash = String(content["text_hash"]);
  const selected = selectLines(
    deps,
    requested,
    section,
    includeChildren,
    input.ranges ?? [],
  );
  // 출력 redaction. 없는 redactor 조립도 본문을 뺀다. 안전화가 불명이면
  // 본문을 싣지 않는다(platform/redaction). fail-closed다.
  const window = readTextWindow({
    lines: text.split("\n"),
    selected,
    binding: {
      ver: requested,
      module_hash: format.module_hash,
      section,
      include_children: includeChildren,
      ranges: input.ranges ?? [],
      text_hash: textHash,
    },
    cursor: input.cursor,
    budget,
    redactor: deps.redactor,
    redactionSource: {
      concern: "documents",
      revision: requested,
      scope: document,
    },
  });
  if (!window.ok) return window;
  return ok({
    document,
    version: requested,
    latest_version: latest,
    format,
    module_hash: format.module_hash,
    section,
    section_status: section === null ? "whole" : "found",
    include_children: includeChildren,
    ranges: window.value.ranges,
    text: window.value.text,
    redacted: window.value.redacted,
    failure_reason: null,
    omission_reason: window.value.omission_reason,
    complete: window.value.complete,
    next_cursor: window.value.next_cursor,
    as_of_seq: deps.snapshot.as_of_seq,
  });
}

function versionHasSection(
  deps: OutlineHandlerDeps,
  version: string,
  section: string,
): boolean {
  const found = deps.read.sql.get(
    `SELECT key FROM derived_sections WHERE version = ? AND key = ?`,
    [version, section],
  );
  return found !== undefined;
}

function selectLines(
  deps: OutlineHandlerDeps,
  version: string,
  section: string | null,
  includeChildren: boolean,
  ranges: readonly { start_line: number; end_line: number }[],
): number[] {
  let spans: { start_line: number; end_line: number }[] | null = null;
  if (section !== null) {
    const row = deps.read.sql.get(
      `SELECT own_ranges, subtree_range FROM derived_sections WHERE version = ? AND key = ?`,
      [version, section],
    );
    // section 자체의 줄(own)은 조각이 여럿일 수 있고, 자식 포함이면 subtree 범위 하나다.
    if (row !== undefined) {
      spans = includeChildren
        ? [parseOne(row["subtree_range"])]
        : parseRanges(row["own_ranges"]);
    }
  }
  return selectBodyLines(
    spans,
    ranges,
    spans === null && ranges.length === 0 ? lineCountOf(deps, version) : 0,
  );
}

function lineCountOf(deps: OutlineHandlerDeps, version: string): number {
  const row = deps.read.sql.get(
    `SELECT line_count FROM derived_versions WHERE version = ?`,
    [version],
  );
  if (row === undefined) return 0;
  return numberCell(row["line_count"]);
}

// handler 네 개. route 선언은 contract가 하고, 여기서 read handler만 낸다.
export function createOutlineHandlers(
  deps: OutlineHandlerDeps,
): OutlineHandlers {
  return {
    root(ctx, input) {
      // root도 contract 입력을 받는다. estimated token 예산과 cursor offset이다.
      // 자리 없는 문서 묶음과 예산 초과는 개수로만 답한다(존재를 새지 않는다(R14)).
      const budget = input.estimated_token_budget ?? ROOT_BUDGET;
      const cursorState = input.cursor === undefined
        ? ok({ offset: 0 })
        : decodeOutlineCursor(input.cursor, {
          topic: "outline.root",
          basis_seq: deps.snapshot.as_of_seq,
          sort: "activity",
          conditions: {},
          credential: ctx.credential_ref,
        });
      if (!cursorState.ok) return cursorState as never;
      const built = buildRootEntries(deps, ctx);
      // offset 뒤부터 예산만큼 담는다. 다음 page는 담은 만큼 이어 간다.
      const rest = built.slice(cursorState.value.offset);
      let used = 0;
      let complete = true;
      const entries: OutlineRootEntry[] = [];
      for (const entry of rest) {
        const cost = rootEntryCost(entry);
        if (used + cost > budget && entries.length > 0) {
          complete = false;
          break;
        }
        used += cost;
        entries.push(entry);
      }
      return ok({
        kind: "root",
        basis_seq: deps.snapshot.as_of_seq,
        entries,
        as_of_seq: deps.snapshot.as_of_seq,
        next_cursor: complete ? null : encodeOutlineCursor({
          topic: "outline.root",
          basis_seq: deps.snapshot.as_of_seq,
          sort: "activity",
          conditions: {},
          versions: [],
          credential: ctx.credential_ref,
        }, cursorState.value.offset + entries.length),
        complete,
      });
    },
    place(ctx, input) {
      const rows = deps.snapshot.sql.get(
        `SELECT id FROM projects WHERE id = ? UNION ALL SELECT id FROM apps WHERE id = ?`,
        [input.place.id, input.place.id],
      );
      if (rows === undefined) return deny();
      if (
        !authorizeTarget(
          deps,
          ctx,
          "outline.place",
          input.place.id,
          input.place.kind,
          input.place.id,
        )
      ) return deny();
      const budget = input.estimated_token_budget ?? PLACE_BUDGET;
      const cursorState = input.cursor === undefined
        ? ok({ offset: 0 })
        : decodeOutlineCursor(input.cursor, {
          topic: "outline.place",
          basis_seq: deps.snapshot.as_of_seq,
          sort: "updated_desc",
          conditions: { place: input.place, budget },
          credential: ctx.credential_ref,
        });
      if (!cursorState.ok) return cursorState as never;
      const result = buildPlaceEntries(
        deps,
        ctx,
        input.place,
        budget,
        cursorState.value.offset,
      );
      const entries = result.entries;
      const complete = result.complete;
      return ok({
        kind: "place",
        basis_seq: deps.snapshot.as_of_seq,
        entries,
        coverage: coverageOfLike(deps.read, deps.snapshot.as_of_seq),
        as_of_seq: deps.snapshot.as_of_seq,
        next_cursor: complete ? null : encodeOutlineCursor({
          topic: "outline.place",
          basis_seq: deps.snapshot.as_of_seq,
          sort: "updated_desc",
          conditions: { place: input.place, budget },
          versions: entries.map((entry) => ({
            document: entry.document,
            version: entry.version,
          })),
          credential: ctx.credential_ref,
        }, cursorState.value.offset + entries.length),
        complete,
      });
    },
    document(ctx, input) {
      const reference = input.reference;
      const document = "document" in reference
        ? String(reference.document)
        : null;
      if (document === null) return deny();
      const row = deps.snapshot.sql.get(
        `SELECT place_kind, place_id, status FROM documents WHERE id = ?`,
        [document],
      );
      // 보관한 문서도 확정한 판의 목차는 읽는다(versions#R11).
      if (row === undefined) return deny();
      if (
        !authorizeTarget(
          deps,
          ctx,
          "outline.document",
          document,
          row["place_kind"] === null || row["place_kind"] === undefined
            ? undefined
            : String(row["place_kind"]),
          row["place_id"] === null || row["place_id"] === undefined
            ? undefined
            : String(row["place_id"]),
          "version" in reference && typeof reference.version === "string"
            ? reference.version
            : undefined,
        )
      ) return deny();
      const latest = latestVersion(deps.snapshot, document);
      if (latest === null) return deny();
      const requested = "version" in reference && reference.version !== null &&
          reference.version !== undefined &&
          typeof reference.version === "string"
        ? reference.version
        : latest;
      const exists = deps.snapshot.sql.get(
        `SELECT id FROM versions WHERE id = ? AND document = ?`,
        [requested, document],
      );
      if (exists === undefined) return deny();
      return buildDocumentOutline(
        deps,
        document,
        requested,
        input.depth ?? DOCUMENT_OUTLINE_DEPTH,
        input.estimated_token_budget ?? DOCUMENT_BUDGET,
      );
    },
    read(ctx, input) {
      return readDocumentBody(deps, ctx, input);
    },
  };
}

const PLACE_BUDGET = 3000;
const ROOT_BUDGET = 1500;
const DOCUMENT_BUDGET = 2000;
