// Project Manager 대화 화면의 고정 데이터. 위반은 renderer의 fake 통로(fake-source)의 eval 위반과 같다.
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
    path: experimentPath("exp-012"),
    what: "about is missing",
    rule: "Experiment.about-required",
    kind: "experiment",
    id: "exp-012",
  },
  {
    path: findingPath("F-014"),
    what: "scenario sched-x doesn't exist",
    rule: "broken link",
    kind: "finding",
    id: "F-014",
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
