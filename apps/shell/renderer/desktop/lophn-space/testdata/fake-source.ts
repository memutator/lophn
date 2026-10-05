// 화면 테스트의 LophnSource. 부른 순서와 입력을 남기고 미리 정한 값을 돌려준다.
// core를 흉내 내지 않고 화면이 무엇을 언제 부르는지만 본다.
import type {
  ArchivedHit,
  Catalog,
  DocumentHead,
  DocumentOutline,
  LophnSource,
  NextSuggestion,
  PlaceDocument,
  ReadPage,
  Resolved,
  SavedView,
  SearchPage,
  Series,
  SeriesDetail,
  SeriesRow,
  SourceResult,
  ViewPage,
} from "../source.ts";

export interface Call {
  readonly method: keyof LophnSource;
  readonly args: readonly unknown[];
}

export interface FakeData {
  catalog?: Catalog;
  formats?: readonly string[];
  search?: (cursor?: string) => SourceResult<SearchPage>;
  archived?: readonly ArchivedHit[];
  views?: readonly SavedView[];
  saveView?: SourceResult<SavedView>;
  openView?: (cursor?: string) => SourceResult<ViewPage>;
  outline?: (version: string | null) => SourceResult<DocumentOutline>;
  head?: DocumentHead;
  read?: (
    section: string | null,
    cursor?: string,
  ) => SourceResult<ReadPage>;
  resolve?: SourceResult<Resolved | null>;
  seriesList?: readonly SeriesRow[];
  series?: () => SourceResult<SeriesDetail>;
  next?: NextSuggestion;
  created?: SourceResult<Series>;
  added?: SourceResult<Series>;
  archived_?: SourceResult<Series>;
  placeDocuments?: readonly PlaceDocument[];
}

export const CATALOG: Catalog = {
  projects: [{ id: "prj_1", title: "lophn" }],
  apps: [{ id: "app_1", title: "Groceries" }],
  contexts: [{ id: "ctx_1", title: "Release" }],
};

export const OUTLINE: DocumentOutline = {
  document: "doc_1",
  version: "ver_2",
  latestVersion: "ver_2",
  status: "whole",
  sections: [
    { key: "goals", title: "Goals", level: 2 },
    { key: "plan", title: "Plan", level: 2 },
  ],
};

export const HEAD: DocumentHead = {
  title: "Release notes",
  versionNumber: 2,
  savedAt: 0,
  status: "active",
};

export const SERIES: Series = {
  id: "ser_1",
  place: { kind: "project", id: "prj_1" },
  name: "weekly",
  title: "Weekly report",
  format: "document",
  order: { kind: "key", direction: "ascending" },
  nextRule: "week-{n}",
  revision: "7",
  archived: false,
};

function ok<T>(value: T): SourceResult<T> {
  return { ok: true, value };
}

export function fakeSource(data: FakeData = {}): {
  source: LophnSource;
  calls: Call[];
  of: (method: keyof LophnSource) => Call[];
} {
  const calls: Call[] = [];
  const log = <T>(method: keyof LophnSource, args: unknown[], value: T) => {
    calls.push({ method, args });
    return Promise.resolve(value);
  };
  const source: LophnSource = {
    catalog: () => log("catalog", [], ok(data.catalog ?? CATALOG)),
    formats: () =>
      log("formats", [], ok(data.formats ?? ["document", "pdf", "data"])),
    search: (conditions, cursor) =>
      log(
        "search",
        [conditions, cursor],
        data.search?.(cursor) ?? ok({
          hits: [],
          coverage: { lagging: false, rebuilding: false, omissions: 0 },
          nextCursor: null,
        }),
      ),
    archived: (conditions) =>
      log("archived", [conditions], ok(data.archived ?? [])),
    views: () => log("views", [], ok(data.views ?? [])),
    saveView: (name, conditions) =>
      log(
        "saveView",
        [name, conditions],
        data.saveView ?? ok({
          id: "viw_1",
          name,
          place: conditions.place,
          filter: {
            text: conditions.query,
            context: null,
            format: null,
            status: "active" as const,
          },
          revision: "1",
        }),
      ),
    openView: (view, cursor) =>
      log(
        "openView",
        [view, cursor],
        data.openView?.(cursor) ??
          ok({ entries: [], coverage: null, nextCursor: null }),
      ),
    head: (document, version) =>
      log("head", [document, version], ok(data.head ?? HEAD)),
    outline: (document, version) =>
      log(
        "outline",
        [document, version],
        data.outline?.(version) ?? ok(OUTLINE),
      ),
    read: (document, version, section, cursor) =>
      log(
        "read",
        [document, version, section, cursor],
        data.read?.(section, cursor) ?? ok({
          status: section === null ? "whole" : "found",
          text: section === null ? "# Release notes\n\nBody." : `## ${section}`,
          hidden: false,
          complete: true,
          nextCursor: null,
        }),
      ),
    resolve: (link) => log("resolve", [link], data.resolve ?? ok(null)),
    seriesList: (status) =>
      log("seriesList", [status], ok(data.seriesList ?? [])),
    series: (id) =>
      log(
        "series",
        [id],
        data.series?.() ?? ok({ series: SERIES, members: [] }),
      ),
    nextKey: (id) =>
      log(
        "nextKey",
        [id],
        ok(data.next ?? { key: "", from: null, taken: false }),
      ),
    createSeries: (input) =>
      log("createSeries", [input], data.created ?? ok(SERIES)),
    addMember: (series, document, key) =>
      log(
        "addMember",
        [series, document, key],
        data.added ?? ok({ ...SERIES, revision: "8" }),
      ),
    setArchived: (series, archived) =>
      log(
        "setArchived",
        [series, archived],
        data.archived_ ?? ok({ ...series, archived, revision: "9" }),
      ),
    placeDocuments: (place) =>
      log("placeDocuments", [place], ok(data.placeDocuments ?? [])),
  };
  return {
    source,
    calls,
    of: (method) => calls.filter((call) => call.method === method),
  };
}
