// context 화면의 고정 데이터. phroner project의 eval context가 중심이고, 위반·판·용어집·검색 이름이 여기서 나온다.
import { experimentPath, findingPath } from "../phroner-data.ts";

export interface ViolationRow {
  readonly path: string;
  readonly what: string;
  readonly rule: string;
  /** 위반한 문서를 여는 탭을 만든다. */
  readonly kind: "finding" | "experiment";
  readonly id: string;
}

export const VIOLATIONS: readonly ViolationRow[] = [
  {
    path: findingPath("F-012"),
    what: "field effects is missing",
    rule: "Finding.effects is required",
    kind: "finding",
    id: "F-012",
  },
  {
    path: experimentPath("exp-012"),
    what: 'status "paused" is not allowed',
    rule: "Experiment.status is draft | running | reported",
    kind: "experiment",
    id: "exp-012",
  },
];

/** 위반 목록에서 Project Manager에게 넘길 때 session에 붙는 근거 한 줄. */
export const violationEvidence = (rows: readonly ViolationRow[]) =>
  `eval · ${rows.length} ${
    rows.length === 1 ? "document doesn't" : "documents don't"
  } match: ${
    rows.map((row) => `${row.path} (${row.what}; rule: ${row.rule})`).join(
      "; ",
    )
  }`;

export interface VersionRow {
  readonly id: string;
  readonly when: string;
  /** 이 판이 무엇을 바꿨는지 한 줄. */
  readonly change: string;
}

const VERSIONS: readonly VersionRow[] = [
  {
    id: "r3",
    when: "2 hours ago",
    change: "Experiment.status allows draft, running and reported only",
  },
  {
    id: "r2",
    when: "yesterday",
    change: "Finding gained effects (metric changes)",
  },
  { id: "r1", when: "3 days ago", change: "First version" },
];

const HARNESS_VERSIONS: readonly VersionRow[] = [
  { id: "r5", when: "yesterday", change: "Component gained an owner" },
  { id: "r4", when: "last week", change: "Change links to Component" },
];

/** context의 판 목록. 가장 새 판이 먼저다. */
export const versionsOf = (name: string): readonly VersionRow[] =>
  name === "eval"
    ? VERSIONS
    : name === "harness"
    ? HARNESS_VERSIONS
    : [{ id: "r1", when: "today", change: "First version" }];

export interface GlossaryTerm {
  readonly term: string;
  readonly meaning: string;
}

export const GLOSSARY: readonly GlossaryTerm[] = [
  {
    term: "pass rate",
    meaning:
      "The share of scenarios that passed in one run, a number from 0 to 1.",
  },
  {
    term: "baseline",
    meaning: "The run an experiment's result is compared with.",
  },
  {
    term: "regression",
    meaning: "A finding where a metric got worse after a change.",
  },
  {
    term: "world action",
    meaning: "A try to change the game world during a task.",
  },
];

export const DECLARED_SEARCHES = [
  { id: "findings-about-change", title: "Findings about a change" },
  { id: "experiments-by-status", title: "Experiments by status" },
  { id: "scenarios-by-rubric", title: "Scenarios using a rubric" },
] as const;

export const SAVED_VIEWS: readonly string[] = [
  "Findings for C-049",
  "Running experiments",
];
