// 형식 문제 줄의 왼쪽 여백 24px 아이콘 14px(shell/editor#R11). 문제 목록은 problem-list.tsx다.
import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { gutter, GutterMarker } from "@codemirror/view";
import { t } from "@lophn/wording";

import type { EditorProblem } from "./problems.ts";
import { svgIcon, TRIANGLE_ALERT } from "../svg-icon.ts";

export const setProblems = StateEffect.define<readonly EditorProblem[]>();

export const problemsField = StateField.define<readonly EditorProblem[]>({
  create: () => [],
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setProblems)) return effect.value;
    }
    return value;
  },
});

class ProblemMarker extends GutterMarker {
  constructor(readonly message: string) {
    super();
  }
  override eq(other: ProblemMarker): boolean {
    return other.message === this.message;
  }
  override toDOM(): Node {
    const marker = document.createElement("span");
    marker.className = "cm-lp-problem";
    if (this.message === "") {
      marker.dataset.spacer = "";
      return marker;
    }
    marker.title = this.message;
    marker.setAttribute(
      "aria-label",
      t("document.label.problem", { message: this.message }),
    );
    marker.appendChild(svgIcon(TRIANGLE_ALERT));
    return marker;
  }
}

export function problemGutter(): Extension {
  return [
    problemsField,
    gutter({
      class: "cm-lp-problems",
      lineMarker(view, line) {
        const number = view.state.doc.lineAt(line.from).number;
        const here = view.state.field(problemsField).filter((problem) =>
          problem.line === number
        );
        return here.length > 0
          ? new ProblemMarker(here.map((problem) => problem.message).join("\n"))
          : null;
      },
      lineMarkerChange: (update) =>
        update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setProblems))
        ),
      initialSpacer: () => new ProblemMarker(""),
    }),
  ];
}
