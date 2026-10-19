// artifact wireframe의 가짜 data. 실제로는 program이 domain의 `artifacts/*/index.html`에서 `<title>`과
// `<meta name="description">`을 읽어 만든다.
export interface ArtifactRow {
  /** 폴더 이름(slug). 신원의 한 쪽이다. */
  readonly name: string;
  readonly title: string;
  readonly description: string;
}

export const ARTIFACTS: readonly ArtifactRow[] = [
  {
    name: "spending",
    title: "Monthly spending",
    description: "What went out this month, by category, as bars.",
  },
  {
    name: "tax-deadlines",
    title: "Tax deadlines",
    description: "Every filing date for the year with the ones due soon first.",
  },
  {
    name: "receipts-q3",
    title: "Receipts, third quarter",
    description: "Receipts grouped by vendor with the totals that need review.",
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
  file: "2026-report.html",
  title: "Annual report 2026",
  folder: "~/Documents/taxes",
} as const;

/** annotate 목록. label은 page layer가 만든다(component 이름이 없으면 role과 글자). */
export const ANNOTATIONS = [
  {
    n: 1,
    kind: "element" as const,
    label: "div · Dining",
    note: "This looks high. Split out the delivery orders.",
  },
  {
    n: 2,
    kind: "element" as const,
    label: "div · Rent",
    note: "Add last month next to it.",
  },
] as const;

/** 보낼 곳. 그 artifact 폴더에 마지막으로 쓴 session의 agent다. */
export const WRITER = "Operator";
