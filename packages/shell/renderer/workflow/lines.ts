// workflow 줄(workflow_lines) 하나를 화면 글로 바꾼다: 누가 냈는지와 무슨 일이었는지. run 화면의 여러 조각이 같이 쓴다.
import { t } from "@lophn/i18n";

import type {
  WorkflowInstanceDetailView,
  WorkflowLineView,
} from "../workspace/source.ts";
import {
  type FaceOf,
  jobWho,
  notHandedKey,
  participantText,
  whoName,
  whoOf,
} from "./model.ts";

type Detail = WorkflowInstanceDetailView;

const participantName = (detail: Detail, key: string, faceOf?: FaceOf) => {
  const participant = detail.instance.participants[key];
  return participant === undefined
    ? key
    : faceOf === undefined
      ? participantText(participant)
      : whoName(whoOf(detail.instance.participants, key), faceOf);
};

// agent가 낸 줄은 session으로 참가자를 찾는다. 그 session에 step을 넘긴 줄(handed)이 단서다.
export function lineBy(
  detail: Detail,
  line: WorkflowLineView,
  faceOf?: FaceOf,
) {
  if (line.by.kind === "user") return t("workflow.label.participant-human");
  if (line.by.kind === "lophn") return t("workflow.label.participant-lophn");
  if (line.by.kind === "program") {
    return t("workflow.label.participant-program");
  }
  if (line.by.kind === "job") {
    const by = detail.instance.started_by;
    return jobWho(by.kind === "job" ? by.title : null);
  }
  if (line.by.kind === "workflow") {
    return t("workflow.label.participant-workflow", {
      instance: line.by.instance,
    });
  }
  if (line.by.kind === "remote") {
    return t("workflow.label.participant-on", {
      who: line.by.name,
      computer: line.by.computer,
    });
  }
  if (line.by.kind === "remote_lophn") {
    return t("workflow.label.participant-on", {
      who: t("workflow.label.participant-lophn"),
      computer: line.by.computer,
    });
  }
  const session = line.by.session;
  const handed = detail.lines.find(
    (item) => item.kind === "handed" && item.receiver === session,
  );
  return handed?.kind === "handed"
    ? participantName(detail, handed.participant, faceOf)
    : t("workflow.label.participant-unknown");
}

// edit 줄. step이 필요한 op인데 step이 없으면 "고쳤다"로만 읽는다.
function editText(line: Extract<WorkflowLineView, { kind: "edit" }>): string {
  if (line.op === "end") return t("workflow.label.line-edit-end");
  if (line.op === "set_participant") {
    return t("workflow.label.line-edit-set-participant");
  }
  if (line.op === "remove_participant") {
    return t("workflow.label.line-edit-remove-participant");
  }
  const step = line.step;
  if (step === null) return t("workflow.label.line-edited");
  switch (line.op) {
    case "add_step":
      return t("workflow.label.line-edit-add-step", { step });
    case "insert_steps":
      return t("workflow.label.line-edit-insert-steps", { step });
    case "update_step":
      return t("workflow.label.line-edit-update-step", { step });
    case "remove_step":
      return t("workflow.label.line-edit-remove-step", { step });
    case "hand_now":
      return t("workflow.label.line-edit-hand-now", { step });
    default:
      return t("workflow.label.line-edited");
  }
}

export function textOf(
  detail: Detail,
  line: WorkflowLineView,
  faceOf?: FaceOf,
) {
  switch (line.kind) {
    case "started":
      return t("workflow.label.line-started", { text: line.text });
    case "report":
      return line.text;
    case "edit":
      return editText(line);
    case "handed":
      return t("workflow.label.line-handed", {
        participant: participantName(detail, line.participant, faceOf),
        turn: line.human_turn ? "yes" : "no",
        session: line.session ?? "none",
      });
    case "not_handed":
      // 다른 컴퓨터에서 돌지 못한 이유는 core가 경우마다 읽을 글로 적는다(건너뜀, 만료, 취소, report 없이 닫힘).
      return line.reason === "remote_failed"
        ? line.message
        : t(notHandedKey(line.reason));
    case "ended":
      return t("workflow.label.state-ended");
    case "stopped":
      return t("workflow.label.state-stopped");
    case "lophn_restarted":
      return t(
        line.step === null
          ? "workflow.note.restarted-flow"
          : "workflow.note.restarted",
      );
    case "program_exited":
      return line.code === null
        ? t("workflow.note.program-signal")
        : t("workflow.note.program-exited", { code: String(line.code) });
    case "step_stalled":
      return t("workflow.note.step-stalled", { step: line.step });
    case "retried":
      return line.step === null
        ? t("workflow.label.line-retried")
        : t("workflow.label.line-retried-step", { step: line.step });
    case "escalated":
      return t("workflow.label.line-escalated", { text: line.text });
    case "code_updated":
      return t("workflow.label.line-code-updated");
  }
}
