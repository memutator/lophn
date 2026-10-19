// domain Drafts의 가짜 data. project는 phroner(eval 실험 저장소), 앱은 Orders다. 실제로는 core의 domain.list가 주는 값이다.
export interface DomainRow {
  /** slug. 보관한 것까지 전체에서 유일하다. */
  readonly name: string;
  readonly title: string;
  readonly purpose: string;
}

export interface ProjectDomain extends DomainRow {
  readonly kinds: number;
  readonly skills: number;
  readonly artifacts: number;
}

export interface AppDomain extends DomainRow {
  readonly tools: number;
  /** 다른 그릇이 grant 받아 쓸 수 있는 tool 수. */
  readonly shared: number;
}

export const PROJECT_NAME = "phroner";
export const APP_NAME = "Orders";

export const PROJECT_DOMAINS: readonly ProjectDomain[] = [
  {
    name: "eval",
    title: "Eval",
    purpose: "Experiments, rubrics and scenario runs for the query tools.",
    kinds: 3,
    skills: 3,
    artifacts: 2,
  },
  {
    name: "findings",
    title: "Findings",
    purpose: "What each experiment taught us, one finding per file.",
    kinds: 2,
    skills: 2,
    artifacts: 2,
  },
  {
    name: "docs",
    title: "Docs",
    purpose: "Notes and design write-ups for the phroner project.",
    kinds: 1,
    skills: 1,
    artifacts: 1,
  },
];

export const APP_DOMAINS: readonly AppDomain[] = [
  {
    name: "orders",
    title: "Orders",
    purpose: "Orders and their life from placed to shipped.",
    tools: 6,
    shared: 2,
  },
  {
    name: "shipping",
    title: "Shipping",
    purpose: "Carriers, labels and tracking.",
    tools: 3,
    shared: 1,
  },
  {
    name: "customers",
    title: "Customers",
    purpose: "Who orders and where it ships.",
    tools: 2,
    shared: 0,
  },
];

export interface Skill {
  readonly domain: string;
  readonly name: string;
  readonly detail: string;
}

export const PROJECT_SKILLS: readonly Skill[] = [
  {
    domain: "eval",
    name: "run-experiment",
    detail: "Run an experiment end to end and record its scores",
  },
  {
    domain: "eval",
    name: "score-rubric",
    detail: "Score a result against a rubric",
  },
  {
    domain: "eval",
    name: "compare-runs",
    detail: "Compare two runs and list what changed",
  },
  {
    domain: "findings",
    name: "write-finding",
    detail: "Write up one finding with its evidence",
  },
  {
    domain: "findings",
    name: "triage-findings",
    detail: "Sort open findings by impact",
  },
  { domain: "docs", name: "edit-notes", detail: "Keep notes short and linked" },
];

export const APP_SKILLS: readonly Skill[] = [
  {
    domain: "orders",
    name: "triage-orders",
    detail: "Sort open orders by age",
  },
  {
    domain: "orders",
    name: "refund-order",
    detail: "Refund an order and tell the customer",
  },
  {
    domain: "shipping",
    name: "book-carrier",
    detail: "Pick a carrier and book the label",
  },
  {
    domain: "customers",
    name: "merge-duplicates",
    detail: "Merge customers that share an address",
  },
];

export interface DomainArtifact {
  readonly domain: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
}

/** 수정이 최근인 것이 위다. 개수는 PROJECT_DOMAINS의 artifacts와 같다. */
export const DOMAIN_ARTIFACTS: readonly DomainArtifact[] = [
  {
    domain: "eval",
    name: "scores",
    title: "Experiment scores",
    description: "Scores per experiment and rubric, as bars.",
  },
  {
    domain: "findings",
    name: "open-findings",
    title: "Open findings",
    description: "Findings still waiting for a decision.",
  },
  {
    domain: "eval",
    name: "run-diff",
    title: "Run comparison",
    description: "What changed between the last two runs.",
  },
  {
    domain: "findings",
    name: "by-impact",
    title: "Findings by impact",
    description: "Every finding grouped by how much it matters.",
  },
  {
    domain: "docs",
    name: "notes-index",
    title: "Notes index",
    description: "All notes with their last edit.",
  },
];

export const OPERATOR_NAME = "Eval analyst";
export const APP_OPERATOR_NAME = "Order desk";

/** Agent 탭 줄(B의 chip 줄 아래)과 앱 agent select가 쓰는 agent. */
export const AGENTS = [
  { id: "lophn", name: "lophn", icon: "dock", role: "lophn" },
  {
    id: "engineer",
    name: "Project Manager",
    icon: "contexts",
    role: "project_manager",
  },
  { id: "eval-analyst", name: OPERATOR_NAME, icon: "read", role: "operator" },
] as const;
