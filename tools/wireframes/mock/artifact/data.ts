// artifact gallery의 가짜 data. 실제로는 program이 domain의 `artifacts/*/index.html`에서 `<title>`과
// `<meta name="description">`을 읽어 목록을 만든다.
import type { ArtifactListItem } from "../../../../packages/shell/ipc/artifact.ts";
import type { AnnotateState } from "../../../../packages/shell/ipc/annotation.ts";

export const ARTIFACTS: readonly ArtifactListItem[] = [
  {
    name: "spending",
    title: "Monthly spending",
    description: "What went out this month, by category, as bars.",
    modified: "2026-10-19T09:12:00Z",
  },
  {
    name: "tax-deadlines",
    title: "Tax deadlines",
    description: "Every filing date for the year with the ones due soon first.",
    modified: "2026-10-18T16:40:00Z",
  },
  {
    name: "receipts-q3",
    title: "Receipts, third quarter",
    description: "Receipts grouped by vendor with the totals that need review.",
    modified: "2026-10-12T11:05:00Z",
  },
];

/** 둘째 domain(research)의 artifact. */
export const RESEARCH_ARTIFACTS: readonly ArtifactListItem[] = [
  {
    name: "reading-list",
    title: "Reading list",
    description: "Papers and posts to read next, grouped by topic.",
    modified: "2026-10-17T14:20:00Z",
  },
  {
    name: "interview-notes",
    title: "Interview notes",
    description: "What each person said, with the quotes that repeat.",
    modified: "2026-10-10T10:00:00Z",
  },
];

export const SPENDING = ARTIFACTS[0]!;

/** 막대 하나의 값. 높이는 가장 큰 값 대비 비율이다. */
export const SPENDING_BARS = [
  { label: "Rent", value: 1200 },
  { label: "Groceries", value: 430 },
  { label: "Dining", value: 240 },
  { label: "Utilities", value: 180 },
  { label: "Transport", value: 160 },
  { label: "Other", value: 95 },
] as const;

/** 사람의 폴더에 있는 `.html`을 연 탭. root는 그 파일이 든 폴더다. */
export const FILE_TAB = {
  path: "/home/mina/Documents/taxes/2026-report.html",
  title: "Annual report 2026",
} as const;

/** annotate 목록. label은 page layer가 만든다(component 이름이 없으면 role과 글자). */
export const ANNOTATIONS: AnnotateState["items"] = [
  {
    n: 1,
    kind: "element",
    label: "div · Dining",
    note: "This looks high. Split out the delivery orders.",
  },
  {
    n: 2,
    kind: "element",
    label: "div · Rent",
    note: "Add last month next to it.",
  },
];
