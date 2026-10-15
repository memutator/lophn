// mock 모드의 lophn 공간 통로. 팔레트 검색은 메모리 표에서 읽고, projects는 메모리 목록을
// 고친다.
import type {
  Catalog,
  LophnSource,
  ProjectRow,
  SearchConditions,
  SearchHit,
} from "../lophn-space/source.ts";
import {
  APP_PLANNER,
  DOC_BUDGET,
  DOC_RECEIPTS,
  PROJECT_GROCERY,
  PROJECT_OFFICE,
  PROJECT_TRIP,
} from "./ids.ts";

interface MockDocument {
  readonly id: string;
  readonly title: string;
  readonly format: string;
  readonly project: string;
  readonly text: string;
}

const DOCUMENTS: readonly MockDocument[] = [
  {
    id: DOC_BUDGET,
    title: "Monthly budget plan",
    format: "document",
    project: PROJECT_GROCERY,
    text: "Food spending stays under 600 per month, with 80 kept for staples.",
  },
  {
    id: DOC_RECEIPTS,
    title: "Receipts March",
    format: "data",
    project: PROJECT_GROCERY,
    text: "Totals for each shop trip, grouped by week.",
  },
];

const CATALOG: Catalog = {
  projects: [
    { id: PROJECT_GROCERY, title: "Grocery budget" },
    { id: PROJECT_OFFICE, title: "Home office" },
  ],
  apps: [{ id: APP_PLANNER, title: "Meal planner" }],
};

const PROJECTS: readonly ProjectRow[] = [
  {
    id: PROJECT_GROCERY,
    name: "grocery-budget",
    title: "Grocery budget",
    purpose: "Keep the monthly food spending under the plan.",
    revision: "1",
    archived: false,
  },
  {
    id: PROJECT_OFFICE,
    name: "home-office",
    title: "Home office",
    purpose: "Tax papers and receipts for the desk.",
    revision: "1",
    archived: false,
  },
  {
    id: PROJECT_TRIP,
    name: "old-trip",
    title: "Old trip",
    purpose: "",
    revision: "1",
    archived: true,
  },
];

function matches(doc: MockDocument, conditions: SearchConditions): boolean {
  if (conditions.place?.kind === "app") return false;
  if (conditions.place !== null && doc.project !== conditions.place.id) {
    return false;
  }
  const query = conditions.query.trim().toLowerCase();
  return query === "" ||
    `${doc.title} ${doc.text}`.toLowerCase().includes(query);
}

function hitOf(doc: MockDocument): SearchHit {
  return {
    document: doc.id,
    version: "ver_1",
    latestVersion: "ver_1",
    section: null,
    title: doc.title,
    snippet: doc.text,
    format: doc.format,
    fromSummary: false,
  };
}

export function mockLophn(): LophnSource {
  let projects = PROJECTS;
  const change = (row: ProjectRow, patch: Partial<ProjectRow>) => {
    const next = { ...row, ...patch, revision: `${Number(row.revision) + 1}` };
    projects = projects.map((item) => item.id === row.id ? next : item);
    return Promise.resolve({ ok: true as const, value: next });
  };
  return {
    catalog: () => Promise.resolve({ ok: true, value: CATALOG }),
    search: (conditions) =>
      Promise.resolve({
        ok: true,
        value: {
          hits: DOCUMENTS.filter((doc) => matches(doc, conditions)).map(hitOf),
          coverage: { lagging: false, rebuilding: false, omissions: 0 },
          nextCursor: null,
        },
      }),
    projects: () => Promise.resolve({ ok: true, value: projects }),
    updateProject: (row, patch) => change(row, patch),
    setProjectArchived: (row, archived) => change(row, { archived }),
  };
}
