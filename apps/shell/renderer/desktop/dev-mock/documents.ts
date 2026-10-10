// mock 모드의 lophn 공간 documents·contexts·projects 정리 통로. 글과 검색은 메모리 표에서 읽고,
// series·contexts·organize의 나머지는 화면 테스트의 가짜 통로에 대표 값만 채운다.
import {
  type FakeData,
  fakeSource,
} from "../lophn-space/testdata/fake-source.ts";
import { fakeContexts } from "../lophn-space/contexts/testdata/fake-source.ts";
import {
  fakeOrganize,
  PROJECT,
} from "../lophn-space/organize/testdata/fake-organize.ts";
import {
  FOCUS,
  MEANINGS,
} from "../lophn-space/contexts/testdata/fake-source.ts";
import type {
  Catalog,
  LophnSource,
  SearchConditions,
  SearchHit,
  SourceResult,
} from "../lophn-space/source.ts";
import type {
  OrganizeSource,
  PlacedDocument,
} from "../lophn-space/organize/source.ts";
import {
  APP_PLANNER,
  DOC_BUDGET,
  DOC_DRAFT,
  DOC_OLD_BUDGET,
  DOC_RECEIPTS,
  DOC_WEEK_1,
  DOC_WEEK_2,
  DOC_WEEK_3,
  FOCUS_GROCERY,
  PROJECT_GROCERY,
  PROJECT_OFFICE,
  PROJECT_TRIP,
} from "./ids.ts";

interface Section {
  readonly key: string;
  readonly title: string;
  readonly text: string;
}

interface MockDocument {
  readonly id: string;
  readonly title: string;
  readonly name: string;
  readonly format: string;
  readonly project: string;
  readonly version: number;
  readonly latest: number;
  readonly archived: boolean;
  readonly savedAgo: number;
  readonly intro: string;
  readonly sections: readonly Section[];
}

const HOUR = 60 * 60 * 1000;

const DOCUMENTS: readonly MockDocument[] = [
  {
    id: DOC_BUDGET,
    title: "Monthly budget plan",
    name: "monthly-budget",
    format: "document",
    project: PROJECT_GROCERY,
    version: 2,
    latest: 2,
    archived: false,
    savedAgo: HOUR,
    intro:
      "Food spending is planned month by month. The table below keeps the limits we agreed on.",
    sections: [
      {
        key: "limits",
        title: "Monthly limits",
        text:
          "Food spending stays under 600 per month, with 80 kept for staples.",
      },
      {
        key: "staples",
        title: "Staples",
        text: "Keep 80 for staples such as rice, eggs and oil.",
      },
    ],
  },
  {
    id: DOC_RECEIPTS,
    title: "Receipts March",
    name: "receipts-march",
    format: "data",
    project: PROJECT_GROCERY,
    version: 5,
    latest: 6,
    archived: false,
    savedAgo: 24 * HOUR,
    intro: "Totals for each shop trip, grouped by week.",
    sections: [],
  },
  {
    id: DOC_DRAFT,
    title: "Shopping list draft",
    name: "shopping-draft",
    format: "document",
    project: PROJECT_GROCERY,
    version: 1,
    latest: 1,
    archived: true,
    savedAgo: 9 * 24 * HOUR,
    intro: "A first list before the budget plan existed.",
    sections: [],
  },
  {
    id: DOC_OLD_BUDGET,
    title: "Shopping budget 2025",
    name: "shopping-budget-2025",
    format: "document",
    project: PROJECT_OFFICE,
    version: 3,
    latest: 3,
    archived: true,
    savedAgo: 300 * 24 * HOUR,
    intro: "Last year's budget, kept for comparison.",
    sections: [],
  },
  ...[
    [DOC_WEEK_1, "Week 1 shopping", 3],
    [DOC_WEEK_2, "Week 2 shopping", 2],
    [DOC_WEEK_3, "Week 3 shopping", 4],
  ].map(([id, title, version]): MockDocument => ({
    id: id as string,
    title: title as string,
    name: (title as string).toLowerCase().replaceAll(" ", "-"),
    format: "document",
    project: PROJECT_GROCERY,
    version: version as number,
    latest: version as number,
    archived: false,
    savedAgo: 5 * 24 * HOUR,
    intro: "Rice, eggs, oil and whatever is on sale.",
    sections: [],
  })),
];

function bodyOf(doc: MockDocument): string {
  return [
    `# ${doc.title}`,
    "",
    doc.intro,
    ...doc.sections.flatMap((s) => ["", `## ${s.title}`, "", s.text]),
  ].join("\n");
}

function hitOf(doc: MockDocument, section: Section | null): SearchHit {
  return {
    document: doc.id,
    version: `ver_${doc.version}`,
    latestVersion: `ver_${doc.latest}`,
    section: section?.key ?? null,
    title: doc.title,
    snippet: section?.text ?? doc.intro,
    format: doc.format,
    fromSummary: doc.format === "data",
  };
}

function matches(doc: MockDocument, conditions: SearchConditions): boolean {
  if (conditions.place !== null && conditions.place.kind === "project") {
    if (doc.project !== conditions.place.id) return false;
  }
  if (conditions.place?.kind === "app") return false;
  if (conditions.format !== null && doc.format !== conditions.format) {
    return false;
  }
  const query = conditions.query.trim().toLowerCase();
  return query === "" || bodyOf(doc).toLowerCase().includes(query);
}

const ok = <T>(value: T): SourceResult<T> => ({ ok: true, value });
const missing = <T>(): SourceResult<T> => ({ ok: false, code: "not_found" });

export const CATALOG: Catalog = {
  projects: [
    { id: PROJECT_GROCERY, title: "Grocery budget" },
    { id: PROJECT_OFFICE, title: "Home office" },
  ],
  apps: [{ id: APP_PLANNER, title: "Meal planner" }],
  contexts: [{ id: FOCUS_GROCERY, title: "Grocery budget" }],
};

const SERIES = {
  id: "ser_1",
  place: { kind: "project", id: PROJECT_GROCERY },
  name: "weekly-shopping",
  title: "Weekly shopping log",
  format: "document",
  order: { kind: "key", direction: "ascending" },
  nextRule: "week-{n}",
  revision: "7",
  archived: false,
  draft: null,
} as const;

export function mockLophn(): LophnSource {
  const documents = DOCUMENTS.filter((doc) => !doc.archived);
  const data: FakeData = {
    catalog: CATALOG,
    formats: ["document", "pdf", "data"],
    views: [
      {
        id: "viw_1",
        name: "Budget documents",
        place: { kind: "project", id: PROJECT_GROCERY },
        filter: {
          text: "budget",
          context: null,
          format: null,
          status: "active",
        },
        revision: "2",
      },
      {
        id: "viw_2",
        name: "Receipts",
        place: null,
        filter: {
          text: "receipt",
          context: null,
          format: "data",
          status: "active",
        },
        revision: "1",
      },
    ],
    seriesList: [{ ...SERIES, members: 3 }],
    series: () =>
      ok({
        series: SERIES,
        members: [DOC_WEEK_1, DOC_WEEK_2, DOC_WEEK_3].map((id, index) => {
          const doc = DOCUMENTS.find((item) => item.id === id)!;
          return {
            key: `week-${index + 1}`,
            document: id,
            title: doc.title,
            version: `ver_${doc.version}`,
            latestVersion: `ver_${doc.latest}`,
            archived: false,
          };
        }),
      }),
    next: { key: "week-4", from: "week-3", taken: false },
    placeDocuments: documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      format: doc.format,
    })),
  };
  const base = fakeSource(data).source;
  return {
    ...base,
    search: (conditions) =>
      Promise.resolve(ok({
        hits: documents.filter((doc) => matches(doc, conditions)).flatMap((
          doc,
        ) => {
          const query = conditions.query.trim().toLowerCase();
          const hit = doc.sections.find((s) =>
            query !== "" && s.text.toLowerCase().includes(query)
          );
          return [hitOf(doc, hit ?? null)];
        }),
        coverage: { lagging: false, rebuilding: false, omissions: 0 },
        nextCursor: null,
      })),
    archived: (conditions) =>
      Promise.resolve(ok(
        DOCUMENTS.filter((doc) => doc.archived).filter((doc) =>
          conditions.query.trim() === "" ||
          doc.title.toLowerCase().includes(
            conditions.query.trim().toLowerCase(),
          )
        ).map((doc) => ({
          document: doc.id,
          version: `ver_${doc.version}`,
          title: doc.title,
          format: doc.format,
        })),
      )),
    openView: (view) =>
      Promise.resolve(ok({
        entries: documents.filter((doc) =>
          view === "viw_2" ? doc.format === "data" : doc.format === "document"
        ).map((doc) => ({
          document: doc.id,
          title: doc.title,
          version: `ver_${doc.version}`,
          latestVersion: `ver_${doc.latest}`,
          savedAt: Date.now() - doc.savedAgo,
          excerpt: doc.intro,
        })),
        coverage: null,
        nextCursor: null,
      })),
    head: (document) => {
      const doc = DOCUMENTS.find((item) => item.id === document);
      return Promise.resolve(
        doc === undefined ? missing() : ok({
          title: doc.title,
          versionNumber: doc.version,
          savedAt: Date.now() - doc.savedAgo,
          status: doc.archived ? "archived" as const : "active" as const,
        }),
      );
    },
    outline: (document, version) => {
      const doc = DOCUMENTS.find((item) => item.id === document);
      return Promise.resolve(
        doc === undefined ? missing() : ok({
          document,
          version: version ?? `ver_${doc.latest}`,
          latestVersion: `ver_${doc.latest}`,
          status: "whole" as const,
          sections: doc.sections.map((s) => ({
            key: s.key,
            title: s.title,
            level: 2,
          })),
        }),
      );
    },
    read: (document, _version, section) => {
      const doc = DOCUMENTS.find((item) => item.id === document);
      const part = doc?.sections.find((s) => s.key === section);
      return Promise.resolve(
        doc === undefined ? missing() : ok({
          status: section === null
            ? "whole" as const
            : part
            ? "found" as const
            : "missing" as const,
          text: section === null
            ? bodyOf(doc)
            : part
            ? `## ${part.title}\n\n${part.text}`
            : null,
          hidden: false,
          complete: true,
          nextCursor: null,
        }),
      );
    },
    resolve: () => Promise.resolve(ok(null)),
    latestVersion: (document) => {
      const doc = DOCUMENTS.find((item) => item.id === document);
      return Promise.resolve(ok(doc ? `ver_${doc.latest}` : null));
    },
    placeDocuments: (place) =>
      Promise.resolve(ok(
        DOCUMENTS.filter((doc) =>
          place.kind === "project" && doc.project === place.id
        )
          .map((doc) => ({ id: doc.id, title: doc.title, format: doc.format })),
      )),
  };
}

export function mockContexts() {
  return fakeContexts({ meanings: ok(MEANINGS) }).source;
}

function placed(doc: MockDocument): PlacedDocument {
  return {
    id: doc.id,
    title: doc.title,
    name: doc.name,
    latestVersion: `ver_${doc.latest}`,
    archived: doc.archived,
  };
}

export function mockOrganize(): OrganizeSource {
  const base = fakeOrganize({
    projects: [
      {
        ...PROJECT,
        id: PROJECT_GROCERY,
        name: "grocery-budget",
        title: "Grocery budget",
        purpose: FOCUS.purpose,
        folders: ["/home/mina/Documents/grocery"],
      },
      {
        ...PROJECT,
        id: PROJECT_OFFICE,
        name: "home-office",
        title: "Home office",
        purpose: "Tax papers and receipts for the desk.",
        tracking: false,
        folders: [],
      },
      {
        ...PROJECT,
        id: PROJECT_TRIP,
        name: "old-trip",
        title: "Old trip",
        purpose: "",
        archived: true,
        tracking: false,
        folders: [],
      },
    ],
  }).source;
  const place = (project: string) =>
    DOCUMENTS.filter((doc) => doc.project === project).map(placed);
  return {
    ...base,
    placeDocuments: (target) =>
      Promise.resolve(ok(target.kind === "project" ? place(target.id) : [])),
    document: (id) => {
      const doc = DOCUMENTS.find((item) => item.id === id);
      return Promise.resolve(
        doc === undefined ? missing() : ok({
          id: doc.id,
          title: doc.title,
          name: doc.name,
          place: { kind: "project" as const, id: doc.project },
          revision: "3",
          latestVersion: `ver_${doc.latest}`,
          archived: doc.archived,
          file: null,
          singleFile: `${doc.name}.md`,
        }),
      );
    },
    versions: (id) => {
      const doc = DOCUMENTS.find((item) => item.id === id);
      return Promise.resolve(ok(
        Array.from({ length: doc?.latest ?? 1 }, (_, index) => ({
          id: `ver_${(doc?.latest ?? 1) - index}`,
          number: (doc?.latest ?? 1) - index,
        })),
      ));
    },
  };
}
