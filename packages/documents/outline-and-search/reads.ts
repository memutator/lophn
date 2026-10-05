// search 읽기 handler. route 등록은 API 작업으로 남긴다(contract SEARCH_ROUTES,
// packages/contracts/documents/search.ts). 입력 검사와 operation scope는 dispatch가
// 이미 본다. 여기서는 ledger snapshot의 문서·판 metadata와 derived store의
// search_rows·search_fts를 읽는다. 권한 밖 ID는 후보 단계에서 빼고 count·rank·page도
// 허용 집합에서 계산한다(outline-and-search#R12, R14, R17).
import { err, ok, type Result } from "../../base/mod.ts";
import type { LineRange } from "../../contracts/documents/mod.ts";
import type { SearchResult } from "../../contracts/documents/mod.ts";
import type { RequestContext } from "../../contracts/platform/mod.ts";
import type { DerivedRead } from "./adapters/store.ts";
import { candidateDocuments } from "./candidates.ts";
import {
  codepoints,
  preambleExcerpt,
  SNIPPET_TOKENS,
  trimmedQuery,
} from "./model.ts";
import { allOmissions, type SearchCoverage } from "./work.ts";
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
  next_cursor: null;
};

export type SearchStatusPage = {
  documents: IndexDocument[];
  coverage: SearchCoverage;
  as_of_seq: string;
  next_cursor: null;
};

export type IndexDocument = {
  document: string;
  version: string | null;
  latest_version: string;
  module_hash: string | null;
  format: SearchResult["format"] | null;
};

const DEFAULT_LIMIT = 30;

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
      );
      const coverage = coverageOfLike(deps.read, deps.snapshot.as_of_seq);
      if (coverage.rebuilding || coverage.lagging) {
        // 재생성 중·뒤처짐이면 결과 없이 진실만 낸다. 빈 검색을 원본 부재로 판정하지 않는다(R14).
        return ok({
          results: [],
          coverage,
          as_of_seq: deps.snapshot.as_of_seq,
          next_cursor: null,
        });
      }
      const limit = input.limit ?? DEFAULT_LIMIT;
      const results = matchDocuments(
        deps,
        ctx,
        candidates,
        input,
        coverage.ledger_basis_seq,
        limit,
      );
      return ok({
        results,
        coverage,
        as_of_seq: deps.snapshot.as_of_seq,
        next_cursor: null,
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
      const coverage = coverageOfLike(deps.read, deps.snapshot.as_of_seq);
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
      });
    },
  };
}

// coverage는 현재 scope의 진실이다. 같은 seq에도 lagging=true를 허용한다.
function coverageOfLike(
  read: DerivedRead,
  ledgerBasisSeq: string,
): SearchCoverage {
  const row = read.sql.get(
    `SELECT processed_seq, rebuilding FROM derived_cursors WHERE consumer = 'search'`,
    [],
  );
  const processed = row === undefined ? "0" : String(row.processed_seq);
  const rebuilding = row === undefined ? false : Number(row.rebuilding) === 1;
  const basis = ledgerBasisSeq;
  const lagging = BigInt(processed) < BigInt(basis);
  return {
    processed_seq: processed,
    ledger_basis_seq: basis,
    lagging,
    rebuilding,
    omissions: allOmissions(read.sql),
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
    const row = deps.read.sql.get(
      `SELECT document, version, section_key, ranges, title, body FROM search_rows WHERE document = ?`,
      [id],
    );
    if (row === undefined) continue;
    const version = String(row["version"]);
    const formatName = fmtName(deps.snapshot, version);
    if (input.formats !== undefined && input.formats.length > 0) {
      if (!input.formats.includes(formatName)) continue;
    }
    const latest = latestOf(deps.snapshot, id);
    if (latest === null) continue;
    // 일치 판정. title·body 둘 다 본다.
    const title = String(row["title"]);
    const body = String(row["body"]);
    if (!title.includes(query) && !body.includes(query)) continue;
    const result = buildResult(deps, id, version, row, query, latest);
    if (result !== undefined) results.push(result);
  }
  return results.slice(0, limit);
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
  const number = versionNumber(deps.snapshot, version);
  if (number === null) return undefined;
  const title = String(row["title"]);
  const body = String(row["body"]);
  const ranges = lineRanges(body, query);
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
    reference: {
      place: document,
      document,
      section,
      version: number,
    },
    title,
    snippet: snippetText(body, query),
    score: scoreText(title, body, query),
    match_source: "original",
    cache_basis: null,
  };
}

function formatRef(
  snapshot: SearchSnapshot,
  version: string,
): SearchResult["format"] | null {
  const row = snapshot.sql.get(
    `SELECT format_name, module_hash, format_explicit FROM versions WHERE id = ?`,
    [version],
  );
  if (row === undefined) return null;
  const name = row["format_name"];
  const hash = row["module_hash"];
  if (typeof name !== "string" || typeof hash !== "string") return null;
  const explicit = row["format_explicit"];
  return {
    name,
    module_hash: hash,
    explicit: explicit === 1 || explicit === BigInt(1),
  };
}

function versionNumber(
  snapshot: SearchSnapshot,
  version: string,
): number | null {
  const row = snapshot.sql.get(`SELECT number FROM versions WHERE id = ?`, [
    version,
  ]);
  if (row === undefined) return null;
  const value = row["number"];
  return typeof value === "bigint"
    ? Number(value)
    : typeof value === "number"
    ? value
    : null;
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
