// saved view read. list·get은 ledger metadata만 준다. open은 매번 저장한 조건으로
// 현재 허용 문서 목록을 다시 만든다(R24). 결과를 ledger에 쓰지 않는다. cursor는
// view id·revision·조건·정렬·현재 scope에 묶이고 스캔 위치(마지막 문서 id)를
// 옮긴다. 삭제된 view cursor는 conflict다.

import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import {
  type IndexCoverage,
  type PlaceOutlineEntry,
  type SavedView,
  viewGet,
  viewList,
  viewOpen,
} from "../../contracts/documents/mod.ts";
import {
  EXCERPT_CODEPOINT_LIMIT,
  PLACE_ESTIMATED_TOKEN_BUDGET,
} from "../../contracts/documents/mod.ts";
import type {
  ReadDefinition,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import { TargetAuthorization } from "../../contracts/platform/mod.ts";
import type { DerivedRead } from "./adapters/store.ts";
import { estimatedTokens } from "./model.ts";
import { coverageOf } from "./work.ts";
import type { ContextItemSource, PortLookup, SearchSnapshot } from "./types.ts";
import {
  listSavedViews,
  loadSavedViewRow,
  type SavedViewRow,
} from "./saved-views-store.ts";

const PAGE = 50;

// view의 정렬은 saved_views CHECK가 정한 어휘다. ORDER BY는 parameter로 못 주므로
// 어휘를 절로 옮긴다.
const SORT_CLAUSE: Record<string, string> = {
  updated_desc: "d.revision DESC, d.id ASC",
  updated_asc: "d.revision ASC, d.id ASC",
  title_asc: "d.title ASC, d.id ASC",
  address_asc: "d.id ASC",
};

function rejected(code: string, message: string): Result<never> {
  return err({ code: code as "not_found", message });
}

function readActorAllowed(ctx: RequestContext, allowed: readonly string[]) {
  const kind = ctx.actor.split(":")[0];
  return allowed.includes(kind);
}

// ledger list·get cursor. pagination window의 숫자 offset이다.
function offsetOf(cursor: string | undefined): Result<number> {
  if (cursor === undefined) return ok(0);
  if (!/^[0-9]+$/.test(cursor)) {
    return rejected("invalid_input", "cursor is invalid");
  }
  const value = Number(cursor);
  if (!Number.isSafeInteger(value)) {
    return rejected("invalid_input", "cursor is invalid");
  }
  return ok(value);
}

// 대상 범위는 platform이 주입한 TargetAuthorization port가 판정한다. forbidden은
// 존재를 새지 않는다(list는 건너뛰고 get은 not_found다). dispatch가 주는 read
// snapshot에 port가 있다(contexts/reads와 같은 cast다).
function allowed(
  snapshot: SearchSnapshot,
  ctx: RequestContext,
  operation: string,
): Result<boolean> {
  try {
    const ported = snapshot as SearchSnapshot & {
      port?: (key: unknown) => unknown;
    };
    if (typeof ported.port !== "function") return ok(true);
    const authorize = ported.port(TargetAuthorization) as unknown as (
      ctx: RequestContext,
      operation: string,
      target: Record<string, unknown>,
    ) => Result<undefined>;
    if (authorize instanceof Promise) return ok(false);
    const decision = authorize(ctx, operation, {});
    if (!decision.ok) {
      return decision.error.code === "forbidden" ||
          decision.error.code === "not_found"
        ? ok(false)
        : decision;
    }
    return ok(true);
  } catch {
    return ok(false);
  }
}

export function createViewReads(): {
  list: ReadDefinition<typeof viewList>;
  get: ReadDefinition<typeof viewGet>;
} {
  return {
    list: {
      route: viewList,
      handle(snapshot, ctx, input) {
        if (!readActorAllowed(ctx, viewList.actors)) {
          return rejected("forbidden", "actor cannot read views");
        }
        const scope = allowed(snapshot as never, ctx, viewList.name);
        if (!scope.ok) return scope;
        if (!scope.value) {
          return ok({
            views: [],
            complete: true,
            as_of_seq: snapshot.as_of_seq,
            next_cursor: null,
          } as never);
        }
        const limit = PAGE;
        const offset = offsetOf(input.cursor);
        if (!offset.ok) return offset;
        const listed = listSavedViews(snapshot.sql as never, {
          limit,
          offset: offset.value,
        });
        if (!listed.ok) return listed;
        return ok({
          views: listed.value.views,
          complete: listed.value.complete,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: listed.value.complete
            ? null
            : String(offset.value + limit),
        } as never);
      },
    },
    get: {
      route: viewGet,
      handle(snapshot, ctx, input) {
        if (!readActorAllowed(ctx, viewGet.actors)) {
          return rejected("forbidden", "actor cannot read views");
        }
        const scope = allowed(snapshot as never, ctx, viewGet.name);
        if (!scope.ok) return scope;
        if (!scope.value) {
          return rejected("not_found", "saved view not found");
        }
        const loaded = loadSavedViewRow(snapshot.sql as never, input.view);
        if (!loaded.ok) return loaded;
        if (loaded.value === null) {
          return rejected("not_found", "saved view not found");
        }
        return ok({
          view: viewOfRow(loaded.value),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        } as never);
      },
    },
  };
}

function viewOfRow(row: SavedViewRow): SavedView {
  return {
    id: row.id,
    name: row.name,
    place: row.place,
    filter: row.filter,
    sort: row.sort,
    revision: row.revision,
  };
}

export type ViewOpenHandlerDeps = {
  read: DerivedRead;
  snapshot: SearchSnapshot;
  ports: PortLookup;
  contexts?: ContextItemSource;
  nowMs: () => number;
};

// open handler. worker 경로라 snapshot·derived read·port를 주입받는다.
export function createViewOpenHandler(deps: ViewOpenHandlerDeps): {
  open(ctx: RequestContext, input: {
    view: string;
    estimated_token_budget?: number;
    cursor?: string;
  }): Result<{
    kind: "view";
    basis_seq: string;
    view: string;
    revision: string;
    filter: SavedView["filter"];
    opened_at_ms: number;
    entries: PlaceOutlineEntry[];
    coverage: IndexCoverage | null;
    complete: boolean;
    next_cursor: string | null;
    as_of_seq: string;
  }>;
} {
  return {
    open(ctx, input) {
      if (!readActorAllowed(ctx, viewOpen.actors)) {
        return rejected("forbidden", "actor cannot open views");
      }
      const loaded = loadSavedViewRow(deps.snapshot.sql as never, input.view);
      if (!loaded.ok) return loaded;
      if (loaded.value === null) {
        return rejected("not_found", "saved view not found");
      }
      const view = loaded.value;
      // 상대 기간도 이 시각에 고정한다. cursor를 유지하는 동안 같다.
      const now = deps.nowMs();
      const budget = input.estimated_token_budget ??
        PLACE_ESTIMATED_TOKEN_BUDGET;
      // cursor는 view id·revision·조건·정렬·현재 scope에 묶인다. 스캔 위치는
      // 마지막 문서 id다.
      const cursorState = input.cursor === undefined
        ? ok({ after: null as string | null })
        : decodeViewCursor(input.cursor, {
          view: view.id,
          revision: view.revision,
          filter: view.filter,
          sort: view.sort,
          credential: ctx.credential_ref,
        });
      if (!cursorState.ok) return cursorState;
      const documents = readViewDocuments(deps, ctx, view, now);
      if (!documents.ok) return documents;
      const after = cursorState.value.after;
      let start = 0;
      if (after !== null) {
        const found = documents.value.findIndex((row) => row.id === after);
        if (found < 0) {
          return rejected("invalid_input", "view cursor position is stale");
        }
        start = found + 1;
      }
      const page = documents.value.slice(start);
      const built = buildViewEntries(deps, page, budget);
      const coverage = view.filter.text === undefined ? null : coverageOf(
        deps.read,
        deps.snapshot.as_of_seq,
        new Set(page.map((row) => row.id)),
      );
      const last = built.entries.at(-1)?.document ?? null;
      return ok({
        kind: "view" as const,
        basis_seq: deps.snapshot.as_of_seq,
        view: view.id,
        revision: view.revision,
        filter: view.filter,
        opened_at_ms: now,
        entries: built.entries,
        coverage,
        complete: built.complete,
        next_cursor: built.complete || last === null ? null : encodeViewCursor({
          view: view.id,
          revision: view.revision,
          filter: view.filter,
          sort: view.sort,
          credential: ctx.credential_ref,
        }, last),
        as_of_seq: deps.snapshot.as_of_seq,
      });
    },
  };
}

// 현재 허용 문서. place·title_contains·formats·document_status·context·상대 기간
// 조건을 현재 ledger 상태로 적용한다(R24). 범위 밖 문서의 존재는 새지 않는다.
function readViewDocuments(
  deps: ViewOpenHandlerDeps,
  ctx: RequestContext,
  view: SavedViewRow,
  now: number,
): Result<{
  id: string;
  title: string;
  name: string | null;
  version: string;
  format: { name: string; module_hash: string; explicit: boolean };
}[]> {
  const status = view.filter.document_status;
  const clauses = ["WHERE 1 = 1"];
  const params: string[] = [];
  if (status !== "all") {
    clauses.push("AND d.status = ?");
    params.push(status);
  }
  if (view.place !== null) {
    clauses.push("AND d.place_kind = ? AND d.place_id = ?");
    params.push(view.place.kind, view.place.id);
  }
  const clause = SORT_CLAUSE[view.sort] ?? SORT_CLAUSE.address_asc;
  const rows = deps.snapshot.sql.all(
    `SELECT d.id, d.title, d.name FROM documents d ${clauses.join(" ")}
     ORDER BY ${clause}`,
    params,
  );
  const contextDocuments = view.filter.context === undefined
    ? undefined
    : contextDocumentSet(deps.contexts, view.filter.context);
  if (contextDocuments !== undefined && contextDocuments.size === 0) {
    return ok([]);
  }
  const out: {
    id: string;
    title: string;
    name: string | null;
    version: string;
    format: { name: string; module_hash: string; explicit: boolean };
  }[] = [];
  for (const row of rows) {
    const id = String(row["id"]);
    if (contextDocuments !== undefined && !contextDocuments.has(id)) continue;
    const title = String(row["title"] ?? "");
    if (
      view.filter.title_contains !== undefined &&
      !title.includes(view.filter.title_contains)
    ) continue;
    const version = latestVersion(deps.snapshot, id);
    if (version === null) continue;
    const format = formatRef(deps.snapshot, version);
    if (format === null) continue;
    if (
      view.filter.formats !== undefined && view.filter.formats.length > 0 &&
      !view.filter.formats.includes(format.name)
    ) continue;
    if (
      view.filter.changed_within_ms !== undefined &&
      !changedWithin(deps.snapshot, version, now, view.filter.changed_within_ms)
    ) continue;
    if (!authorizeTarget(deps, ctx, id)) continue;
    out.push({
      id,
      title,
      name: row["name"] === null || row["name"] === undefined
        ? null
        : String(row["name"]),
      version,
      format,
    });
  }
  return ok(out);
}

function contextDocumentSet(
  contexts: ContextItemSource | undefined,
  contextId: string | undefined,
): Set<string> | undefined {
  if (contextId === undefined) return undefined;
  if (contexts === undefined) return new Set();
  const loaded = contexts.items(contextId);
  if (!loaded.ok) return new Set();
  const documents = new Set<string>();
  for (const item of loaded.value) {
    if (item.kind === "document" && item.document !== undefined) {
      documents.add(item.document);
    }
  }
  return documents;
}

// 상대 갱신 기간은 open 시각에 고정한다(cursor가 그 시각을 유지하는 동안 같다).
// 마지막 판의 saved_at을 open 시각과 비교한다.
function changedWithin(
  snapshot: SearchSnapshot,
  latest: string,
  now: number,
  within: number,
): boolean {
  const row = snapshot.sql.get(
    `SELECT saved_at FROM versions WHERE id = ?`,
    [latest],
  );
  if (row === undefined) return false;
  const savedAt = Date.parse(String(row["saved_at"] ?? ""));
  if (Number.isNaN(savedAt)) return false;
  return savedAt >= now - within;
}

// 단일 대상 handler의 범위 검사. 권한 밖은 없는 대상과 같이 답한다.
function authorizeTarget(
  deps: ViewOpenHandlerDeps,
  ctx: RequestContext,
  document: string,
): boolean {
  let authorize: unknown;
  try {
    authorize = deps.ports.port(TargetAuthorization);
  } catch {
    return false;
  }
  if (typeof authorize !== "function") return false;
  try {
    const result = authorize(ctx, viewOpen.name, { document });
    if (result instanceof Promise) {
      void result.catch(() => {});
      return false;
    }
    if (typeof result !== "object" || result === null || "then" in result) {
      return false;
    }
    return result.ok === true;
  } catch {
    return false;
  }
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

function formatRef(
  snapshot: SearchSnapshot,
  version: string,
): { name: string; module_hash: string; explicit: boolean } | null {
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

// view open의 문서 항목. outline place 항목과 같은 모양이다(R25). token 추정으로
// 자르고 잘렸으면 complete는 false다.
function buildViewEntries(
  deps: ViewOpenHandlerDeps,
  documents: readonly {
    id: string;
    title: string;
    name: string | null;
    version: string;
    format: { name: string; module_hash: string; explicit: boolean };
  }[],
  budget: number,
): { entries: PlaceOutlineEntry[]; complete: boolean } {
  const entries: PlaceOutlineEntry[] = [];
  let used = 0;
  let complete = true;
  for (const document of documents) {
    const bytes = estimatedTokens(entryCost(deps, document.version));
    if (used + bytes > budget && entries.length > 0) {
      complete = false;
      break;
    }
    used += bytes;
    entries.push(viewEntry(deps, document));
  }
  return { entries, complete };
}

function entryCost(
  deps: ViewOpenHandlerDeps,
  version: string,
): number {
  const row = deps.read.sql.get(
    `SELECT section_count, line_count FROM derived_versions WHERE version = ?`,
    [version],
  );
  if (row === undefined) return EXCERPT_CODEPOINT_LIMIT + 120;
  const sections = numberCell(row["section_count"]);
  const lines = numberCell(row["line_count"]);
  return sections > 0 ? sections * 24 + Math.min(lines, 200) : 120;
}

function numberCell(value: unknown): number {
  return typeof value === "bigint"
    ? Number(value)
    : typeof value === "number"
    ? value
    : 0;
}

function viewEntry(
  deps: ViewOpenHandlerDeps,
  document: {
    id: string;
    title: string;
    name: string | null;
    version: string;
    format: { name: string; module_hash: string; explicit: boolean };
  },
): PlaceOutlineEntry {
  const savedBy = deps.snapshot.sql.get(
    `SELECT saved_by, saved_at FROM versions WHERE id = ?`,
    [document.version],
  );
  const summary = cacheSummary(deps, document.version);
  const excerpt = summary === null
    ? entryExcerpt(deps, document.version)
    : null;
  return {
    document: document.id,
    name: document.name,
    title: document.title,
    version: document.version,
    latest_version: document.version,
    format: document.format,
    saved_by: String(
      savedBy?.["saved_by"] ?? "user",
    ) as PlaceOutlineEntry["saved_by"],
    saved_at: String(
      savedBy?.["saved_at"] ?? "1970-01-01T00:00:00.000Z",
    ) as PlaceOutlineEntry["saved_at"],
    excerpt,
    summary,
    section_count: sectionCount(deps, document.version),
  };
}

function cacheSummary(
  deps: ViewOpenHandlerDeps,
  version: string,
): PlaceOutlineEntry["summary"] {
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
  deps: ViewOpenHandlerDeps,
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

function sectionCount(
  deps: ViewOpenHandlerDeps,
  version: string,
): number {
  const row = deps.read.sql.get(
    `SELECT section_count FROM derived_versions WHERE version = ?`,
    [version],
  );
  if (row === undefined) return 0;
  return numberCell(row["section_count"]);
}

type ViewCursorBasis = {
  view: string;
  revision: string;
  filter: SavedView["filter"];
  sort: SavedView["sort"];
  credential: string;
};

// cursor는 스캔 위치(마지막 문서 id)와 basis를 옮긴다. 문서 목록은 같은 정렬로
// 다시 계산되므로 위치는 id 하나면 충분하다.
function encodeViewCursor(basis: ViewCursorBasis, after: string): string {
  const value = {
    page: { after },
    basis: {
      view: basis.view,
      revision: basis.revision,
      filter: basis.filter,
      sort: basis.sort,
      credential: basis.credential,
    },
  };
  return encodeCursorValue(value);
}

function decodeViewCursor(
  cursor: string,
  current: ViewCursorBasis,
): Result<{ after: string }> {
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as {
      page?: { after?: unknown };
      basis?: ViewCursorBasis;
    };
    if (
      parsed.page === undefined || parsed.basis === undefined ||
      typeof parsed.page.after !== "string"
    ) {
      return invalidViewCursor();
    }
    const basis = parsed.basis;
    const different = basis.view !== current.view ||
      canonicalize(basis.filter) !== canonicalize(current.filter) ||
      basis.sort !== current.sort ||
      basis.credential !== current.credential;
    if (different) return invalidViewCursor();
    // 저장된 revision과 다르면 조건이 바뀌었다. 삭제된 view의 cursor도 같은
    // 검사를 거친다. 다시 열어 달라는 conflict다.
    if (basis.revision !== current.revision) {
      return err({
        code: "conflict",
        message: "saved view basis changed",
      });
    }
    return ok({ after: parsed.page.after });
  } catch {
    return invalidViewCursor();
  }
}

function invalidViewCursor(): Result<never> {
  return err({ code: "invalid_input", message: "invalid view cursor" });
}

function encodeCursorValue(value: unknown): string {
  const bytes = new TextEncoder().encode(canonicalize(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
