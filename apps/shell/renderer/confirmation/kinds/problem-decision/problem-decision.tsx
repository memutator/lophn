import { t } from "@lophn/wording";
import { Button } from "@lophn/design/components";

import type { Display } from "../../display.ts";
import { ConfirmationLayout } from "../../layout/layout.tsx";
import { facts, type KindProps, obj, str } from "../exact.tsx";

/** 창을 여는 결정 이름(contracts의 PROBLEM_DECISION). */
export const PROBLEM_DECISION = "problem_decision";
/** 확인 창이 허용하는 결정 이름(= command route 이름). 누르면 main이 `ApplyProblemDecision`을 problem·basis_seq·release·last_report에 묶은 handle로 보낸다. */
export const APPLY_PROBLEM_DECISION = "ApplyProblemDecision";

type Choice = "fixed" | "not_fixed" | "not_visible" | "dismiss";

const CHOICES: readonly Choice[] = [
  "fixed",
  "not_fixed",
  "not_visible",
  "dismiss",
];

function choiceOf(value: unknown): Choice | undefined {
  return CHOICES.find((choice) => choice === value);
}

/**
 * 문제 결정(고쳐짐·아직 안 고쳐짐·안 보임·더 다루지 않음)의 owner decision 화면. main이 정본에서
 * 만든 view는 `{ kind: "problem_decision", choice, symptom, seen, version, note }`다. symptom은
 * problems가 정한 영향 문장 그대로이고 version은 활성 release 번호(없으면 null), note는 dismiss의
 * 한 줄 이유다.
 * 이 결정은 실제 테스트 통과가 아니라 사람이 한 말이라는 것을 영향 칸에서 먼저 말한다.
 */
export function ProblemDecisionKind({ view, decide, cancel, busy }: KindProps) {
  const shown = obj(view.view);
  const choice = choiceOf(shown.choice);
  if (choice === undefined) {
    return (
      <p data-change="missing">{t("confirmation-window.change.missing")}</p>
    );
  }
  const note = str(shown.note);
  const seen = typeof shown.seen === "number" ? shown.seen : undefined;
  const display: Display = {
    title: title(choice),
    subject: str(shown.symptom) ?? "",
    effect: effect(choice),
    reversible: true,
    revertNote: revertNote(choice),
    noteOnly: true,
    action: button(choice),
    details: facts([
      [
        t("confirmation-window.label.problem-seen"),
        seen === undefined ? undefined : String(seen),
      ],
      [
        t("confirmation-window.label.problem-version"),
        typeof shown.version === "number"
          ? t("app-detail.label.version", { number: String(shown.version) })
          : str(shown.version),
      ],
      [t("confirmation-window.label.problem-reason"), note],
    ]),
    noChange: true,
  };
  return (
    <ConfirmationLayout
      display={display}
      actions={
        <>
          <Button variant="ghost" data-action="cancel" onClick={cancel}>
            {t("confirmation-window.button.cancel")}
          </Button>
          {(view.decisions ?? []).includes(APPLY_PROBLEM_DECISION)
            ? (
              <Button
                variant="primary"
                data-decision={APPLY_PROBLEM_DECISION}
                data-choice={choice}
                disabled={busy}
                onClick={() => decide(APPLY_PROBLEM_DECISION)}
              >
                {display.action}
              </Button>
            )
            : null}
        </>
      }
    />
  );
}

function title(choice: Choice): string {
  switch (choice) {
    case "fixed":
      return t("confirmation-window.title.problem-fixed");
    case "not_fixed":
      return t("confirmation-window.title.problem-not-fixed");
    case "not_visible":
      return t("confirmation-window.title.problem-not-visible");
    case "dismiss":
      return t("confirmation-window.title.problem-dismiss");
  }
}

function effect(choice: Choice): string {
  switch (choice) {
    case "fixed":
      return t("confirmation-window.problem.effect-fixed");
    case "not_fixed":
      return t("confirmation-window.problem.effect-not-fixed");
    case "not_visible":
      return t("confirmation-window.problem.effect-not-visible");
    case "dismiss":
      return t("confirmation-window.problem.effect-dismiss");
  }
}

function revertNote(choice: Choice): string {
  switch (choice) {
    case "fixed":
      return t("confirmation-window.problem.note-fixed");
    case "not_fixed":
      return t("confirmation-window.problem.note-not-fixed");
    case "not_visible":
      return t("confirmation-window.problem.note-not-visible");
    case "dismiss":
      return t("confirmation-window.problem.note-dismiss");
  }
}

function button(choice: Choice): string {
  switch (choice) {
    case "fixed":
      return t("confirmation-window.button.problem-fixed");
    case "not_fixed":
      return t("confirmation-window.button.problem-not-fixed");
    case "not_visible":
      return t("confirmation-window.button.problem-not-visible");
    case "dismiss":
      return t("confirmation-window.button.problem-dismiss");
  }
}
