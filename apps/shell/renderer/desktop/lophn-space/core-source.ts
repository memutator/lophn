// LophnSource를 main의 core 통로로 만든다. token·port는 main에 있고 이 쪽은 route 이름과
// 입력만 보낸다. 응답은 main의 contract client가 route output schema로 이미 검사했다.
// 아래 응답 모양은 그 schema(outline.root·document, search.query, views, series,
// documents.get·list·resolve, formats.list)에서 이 화면이 읽는 field만 옮긴 것이다.
import type { CoreCall } from "../../../ipc/core.ts";
import type { CoreSource } from "../connection/connection.ts";
import { newId, searchBody, viewFilterOf } from "./model.ts";
import type {
  ArchivedHit,
  Catalog,
  Coverage,
  DocumentOutline,
  LophnSource,
  Named,
  OutlineSection,
  PlaceDocument,
  PlaceRef,
  SavedView,
  SearchHit,
  Series,
  SeriesMember,
  SeriesOrder,
  SeriesRow,
  SourceResult,
  ViewEntry,
} from "./source.ts";

interface RootPage {
  entries: (
    | { kind: "project" | "app" | "context"; id: string; title: string }
    | { kind: "unplaced" }
  )[];
  complete: boolean;
  next_cursor: string | null;
}

interface CoverageValue {
  lagging: boolean;
  rebuilding: boolean;
  omissions: unknown[];
}

interface SearchValue {
  results: {
    document: string;
    version: string;
    latest_version: string;
    format: { name: string };
    section: string | null;
    title: string;
    snippet: string;
    match_source: "original" | "summary" | "topic";
  }[];
  coverage: CoverageValue;
  next_cursor: string | null;
}

interface DocumentListValue {
  documents: {
    document: { id: string; title: string; status: "active" | "archived" };
    latest_version: { id: string; format: { name: string } };
  }[];
  next_cursor: string | null;
}

interface ViewValue {
  id: string;
  name: string;
  place: PlaceRef | null;
  filter: {
    text?: string;
    context?: string;
    formats?: string[];
    document_status: "active" | "archived" | "all";
  };
  revision: string;
}

interface ViewOpenValue {
  entries: {
    document: string;
    title: string;
    version: string;
    latest_version: string;
    saved_at: string;
    excerpt: string | null;
  }[];
  coverage: CoverageValue | null;
  next_cursor: string | null;
}

interface OutlineValue {
  document: string;
  version: string;
  latest_version: string;
  section_status: DocumentOutline["status"];
  entries: { key: string; title: string; level: number }[];
  complete: boolean;
  next_cursor: string | null;
}

interface DocumentGetValue {
  document: { title: string; status: "active" | "archived" };
  version: { number: number; saved_at: string };
}

interface ReadValue {
  section_status: DocumentOutline["status"];
  text: string | null;
  redacted: boolean;
  complete: boolean;
  next_cursor: string | null;
}

interface ResolveValue {
  resolved: {
    document: string;
    version: string;
    section: string | null;
    redirected: boolean;
    current_reference:
      | { place: string; document: string; section: string | null }
      | { document: string };
    section_status: DocumentOutline["status"];
  };
}

interface SeriesValue {
  id: string;
  place: PlaceRef;
  name: string;
  title: string;
  format: string;
  order: SeriesOrder & { type?: string };
  next_rule: string;
  revision: string;
  status: "active" | "archived";
}

interface SeriesGetValue {
  series: SeriesValue;
  entries: {
    key: string;
    document: string;
    title: string;
    version: string;
    latest_version: string;
    status: "active" | "archived";
  }[];
  complete: boolean;
  next_cursor: string | null;
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 20;
/** 보관 문서 제목 찾기에서 넘겨 볼 page 상한. */
const ARCHIVED_PAGE_LIMIT = 10;

async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  const reply = await core.call({ kind, resource, method, body });
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
  return { ok: true, value: reply.value as T };
}

async function command<T>(
  core: CoreSource,
  resource: string,
  method: string,
  input: unknown,
  compare: unknown,
): Promise<SourceResult<T>> {
  const result = await call<{ result: T }>(core, "command", resource, method, {
    input,
    idempotency_key: `${resource}-${method}-${crypto.randomUUID()}`,
    compare,
    prepared: [],
  });
  return result.ok ? { ok: true, value: result.value.result } : result;
}

function coverageOf(value: CoverageValue): Coverage {
  return {
    lagging: value.lagging,
    rebuilding: value.rebuilding,
    omissions: value.omissions.length,
  };
}

function seriesOf(value: SeriesValue): Series {
  const order: SeriesOrder = value.order.kind === "key"
    ? { kind: "key", direction: value.order.direction }
    : {
      kind: "format_field",
      field: value.order.field,
      direction: value.order.direction,
    };
  return {
    id: value.id,
    place: { kind: value.place.kind, id: value.place.id },
    name: value.name,
    title: value.title,
    format: value.format,
    order,
    nextRule: value.next_rule,
    revision: value.revision,
    archived: value.status === "archived",
  };
}

function viewOf(value: ViewValue): SavedView {
  return {
    id: value.id,
    name: value.name,
    place: value.place === null
      ? null
      : { kind: value.place.kind, id: value.place.id },
    filter: {
      text: value.filter.text ?? null,
      context: value.filter.context ?? null,
      format: value.filter.formats?.[0] ?? null,
      status: value.filter.document_status,
    },
    revision: value.revision,
  };
}

function parseLink(link: string) {
  const match = /^([^/#@]+)\/([^/#@]+)(?:#([^#@]+))?(?:@([1-9][0-9]*))?$/.exec(
    link.trim(),
  );
  if (!match) return null;
  let section: string | null = null;
  try {
    section = match[3] === undefined ? null : decodeURIComponent(match[3]);
  } catch {
    return null;
  }
  return {
    place: match[1]!,
    document: match[2]!,
    section,
    version: match[4] === undefined ? null : Number(match[4]),
  };
}

export function coreLophnSource(
  core: CoreSource,
  idOf: (prefix: string) => string = (prefix) => newId(prefix),
): LophnSource {
  return {
    async catalog() {
      const projects: Named[] = [];
      const apps: Named[] = [];
      const contexts: Named[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result: SourceResult<RootPage> = await call<RootPage>(
          core,
          "read",
          "outline",
          "root",
          cursor === undefined ? {} : { cursor },
        );
        if (!result.ok) return result;
        for (const entry of result.value.entries) {
          if (entry.kind === "unplaced") continue;
          const item = { id: entry.id, title: entry.title };
          if (entry.kind === "project") projects.push(item);
          else if (entry.kind === "app") apps.push(item);
          else contexts.push(item);
        }
        if (result.value.complete || result.value.next_cursor === null) break;
        cursor = result.value.next_cursor;
      }
      const catalog: Catalog = { projects, apps, contexts };
      return { ok: true, value: catalog };
    },

    async formats() {
      const result = await call<{ formats: { name: string }[] }>(
        core,
        "read",
        "formats",
        "list",
        {},
      );
      return result.ok
        ? { ok: true, value: result.value.formats.map((item) => item.name) }
        : result;
    },

    async search(conditions, cursor) {
      const result = await call<SearchValue>(
        core,
        "worker",
        "search",
        "query",
        searchBody(conditions, cursor),
      );
      if (!result.ok) return result;
      const hits: SearchHit[] = result.value.results.map((item) => ({
        document: item.document,
        version: item.version,
        latestVersion: item.latest_version,
        section: item.section,
        title: item.title,
        snippet: item.snippet,
        format: item.format.name,
        fromSummary: item.match_source !== "original",
      }));
      return {
        ok: true,
        value: {
          hits,
          coverage: coverageOf(result.value.coverage),
          nextCursor: result.value.next_cursor,
        },
      };
    },

    // 검색 index는 보관 문서를 넣지 않는다(outline-and-search#R17). 보관 포함은 보관 목록의
    // 제목으로 찾고 그 문서의 마지막 판을 연다.
    async archived(conditions) {
      const needle = conditions.query.trim().toLowerCase();
      const found: ArchivedHit[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < ARCHIVED_PAGE_LIMIT; page += 1) {
        const result: SourceResult<DocumentListValue> = await call<
          DocumentListValue
        >(core, "read", "documents", "list", {
          ...(conditions.place === null ? {} : { place: conditions.place }),
          status: "archived",
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!result.ok) return result;
        for (const entry of result.value.documents) {
          const format = entry.latest_version.format.name;
          if (conditions.format !== null && conditions.format !== format) {
            continue;
          }
          if (!entry.document.title.toLowerCase().includes(needle)) continue;
          found.push({
            document: entry.document.id,
            version: entry.latest_version.id,
            title: entry.document.title,
            format,
          });
        }
        if (result.value.next_cursor === null) break;
        cursor = result.value.next_cursor;
      }
      return { ok: true, value: found };
    },

    async views() {
      const views: SavedView[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result: SourceResult<
          { views: ViewValue[]; next_cursor: string | null }
        > = await call(
          core,
          "read",
          "views",
          "list",
          cursor === undefined ? {} : { cursor },
        );
        if (!result.ok) return result;
        views.push(...result.value.views.map(viewOf));
        if (result.value.next_cursor === null) break;
        cursor = result.value.next_cursor;
      }
      return { ok: true, value: views };
    },

    async saveView(name, conditions) {
      const filter = viewFilterOf(conditions);
      const result = await command<ViewValue>(core, "views", "save", {
        id: idOf("viw"),
        name: name.trim(),
        ...(conditions.place === null ? {} : { place: conditions.place }),
        filter: {
          ...(filter.text === null ? {} : { text: filter.text }),
          ...(filter.context === null ? {} : { context: filter.context }),
          ...(filter.format === null ? {} : { formats: [filter.format] }),
          document_status: filter.status,
        },
      }, {});
      return result.ok ? { ok: true, value: viewOf(result.value) } : result;
    },

    async openView(view, cursor) {
      const result = await call<ViewOpenValue>(
        core,
        "worker",
        "views",
        "open",
        { view, ...(cursor === undefined ? {} : { cursor }) },
      );
      if (!result.ok) return result;
      const entries: ViewEntry[] = result.value.entries.map((entry) => ({
        document: entry.document,
        title: entry.title,
        version: entry.version,
        latestVersion: entry.latest_version,
        savedAt: Date.parse(entry.saved_at),
        excerpt: entry.excerpt,
      }));
      return {
        ok: true,
        value: {
          entries,
          coverage: result.value.coverage === null
            ? null
            : coverageOf(result.value.coverage),
          nextCursor: result.value.next_cursor,
        },
      };
    },

    async head(document, version) {
      const result = await call<DocumentGetValue>(
        core,
        "read",
        "documents",
        "get",
        { document, version },
      );
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          title: result.value.document.title,
          versionNumber: result.value.version.number,
          savedAt: Date.parse(result.value.version.saved_at),
          status: result.value.document.status,
        },
      };
    },

    async outline(document, version) {
      const sections: OutlineSection[] = [];
      let first: OutlineValue | null = null;
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        // 이어 보는 page는 처음 page가 고른 판을 그대로 쓴다(outline-and-search#R8).
        const fixed: string | null = first === null ? version : first.version;
        const result: SourceResult<OutlineValue> = await call<OutlineValue>(
          core,
          "worker",
          "outline",
          "document",
          {
            reference: { document, version: fixed, section: null },
            depth: 3,
            ...(cursor === undefined ? {} : { cursor }),
          },
        );
        if (!result.ok) return result;
        const value: OutlineValue = result.value;
        if (first === null) first = value;
        for (const entry of value.entries) {
          if (entry.level < 1) continue;
          sections.push({
            key: entry.key,
            title: entry.title,
            level: entry.level,
          });
        }
        if (value.complete || value.next_cursor === null) break;
        cursor = value.next_cursor;
      }
      if (first === null) return { ok: false, code: "unavailable" };
      const outline: DocumentOutline = {
        document: first.document,
        version: first.version,
        latestVersion: first.latest_version,
        status: first.section_status,
        sections,
      };
      return { ok: true, value: outline };
    },

    async read(document, version, section, cursor) {
      const result = await call<ReadValue>(
        core,
        "worker",
        "documents",
        "read",
        {
          reference: { document, version, section: null },
          section,
          ...(cursor === undefined ? {} : { cursor }),
        },
      );
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          status: result.value.section_status,
          text: result.value.text,
          hidden: result.value.text === null && result.value.redacted,
          complete: result.value.complete,
          nextCursor: result.value.next_cursor,
        },
      };
    },

    async resolve(link) {
      const reference = parseLink(link);
      if (reference === null) return { ok: true, value: null };
      const result = await call<ResolveValue>(
        core,
        "read",
        "documents",
        "resolve",
        { reference },
      );
      if (!result.ok) {
        return result.code === "not_found" || result.code === "invalid_input"
          ? { ok: true, value: null }
          : result;
      }
      const resolved = result.value.resolved;
      const current = resolved.current_reference;
      return {
        ok: true,
        value: {
          document: resolved.document,
          version: resolved.version,
          section: resolved.section,
          moved: resolved.redirected,
          current: "place" in current
            ? `${current.place}/${current.document}`
            : null,
          pinned: reference.version !== null,
          status: resolved.section_status,
        },
      };
    },

    async seriesList(status) {
      const rows: SeriesRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result: SourceResult<
          {
            series: (SeriesValue & { member_count: number })[];
            next_cursor: string | null;
          }
        > = await call(core, "read", "series", "list", {
          status,
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!result.ok) return result;
        for (const item of result.value.series) {
          rows.push({ ...seriesOf(item), members: item.member_count });
        }
        if (result.value.next_cursor === null) break;
        cursor = result.value.next_cursor;
      }
      return { ok: true, value: rows };
    },

    async series(id) {
      const members: SeriesMember[] = [];
      let series: Series | null = null;
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result: SourceResult<SeriesGetValue> = await call<
          SeriesGetValue
        >(core, "read", "series", "get", {
          selector: { series: id },
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!result.ok) return result;
        series = seriesOf(result.value.series);
        for (const entry of result.value.entries) {
          members.push({
            key: entry.key,
            document: entry.document,
            title: entry.title,
            version: entry.version,
            latestVersion: entry.latest_version,
            archived: entry.status === "archived",
          });
        }
        if (result.value.complete || result.value.next_cursor === null) break;
        cursor = result.value.next_cursor;
      }
      return series === null
        ? { ok: false, code: "unavailable" }
        : { ok: true, value: { series, members } };
    },

    async nextKey(id) {
      const result = await call<
        { suggestion: { key: string; from: string | null; taken: boolean } }
      >(core, "read", "series", "next", { selector: { series: id } });
      if (!result.ok) return result;
      const suggestion = result.value.suggestion;
      return {
        ok: true,
        value: {
          key: suggestion.key,
          from: suggestion.from,
          taken: suggestion.taken,
        },
      };
    },

    async createSeries(input) {
      const result = await command<SeriesValue>(core, "series", "create", {
        id: idOf("ser"),
        place: input.place,
        name: input.name,
        title: input.title.trim(),
        format: input.format,
        order: { kind: "key", direction: input.direction },
        next_rule: input.nextRule.trim(),
      }, {});
      return result.ok ? { ok: true, value: seriesOf(result.value) } : result;
    },

    async addMember(series, document, key) {
      const result = await command<SeriesValue>(
        core,
        "series",
        "add_instance",
        { series: series.id, document, key },
        { base_revision: series.revision },
      );
      return result.ok ? { ok: true, value: seriesOf(result.value) } : result;
    },

    async setArchived(series, archived) {
      const result = await command<SeriesValue>(
        core,
        "series",
        archived ? "archive" : "unarchive",
        { series: series.id },
        { base_revision: series.revision },
      );
      return result.ok ? { ok: true, value: seriesOf(result.value) } : result;
    },

    async placeDocuments(place) {
      const documents: PlaceDocument[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result: SourceResult<DocumentListValue> = await call<
          DocumentListValue
        >(core, "read", "documents", "list", {
          place,
          status: "active",
          ...(cursor === undefined ? {} : { cursor }),
        });
        if (!result.ok) return result;
        for (const entry of result.value.documents) {
          documents.push({
            id: entry.document.id,
            title: entry.document.title,
            format: entry.latest_version.format.name,
          });
        }
        if (result.value.next_cursor === null) break;
        cursor = result.value.next_cursor;
      }
      return { ok: true, value: documents };
    },
  };
}
