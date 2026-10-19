// lophn 판단 case들이 같이 쓰는 참가자와 judge 입력 helper. 시나리오가 아니라 runner가 읽지 않는다.
import type { AskInput } from "../../../../packages/protocol/lophn-agent/ask-tool.ts";
import { type CallWhere, sentCalls, toolCallsOf } from "../../checks/mod.ts";
import type { Participant, TrialRecord } from "../../types.ts";

export const LOPHN: Participant = { role: "lophn" };
// 앱마다 project가 하나씩 있다. 이름은 apps-home 같은 재료가 만든 `<slug>-project`다.
export const PM_ledger: Participant = {
  role: "project_manager",
  place: { project: "ledger-project" },
};
export const PM_todo: Participant = {
  role: "project_manager",
  place: { project: "todo-project" },
};
export const PM_calendar: Participant = {
  role: "project_manager",
  place: { project: "calendar-project" },
};
export const PM_notify: Participant = {
  role: "project_manager",
  place: { project: "notify-project" },
};
export const PM_tax: Participant = {
  role: "project_manager",
  place: { project: "tax" },
};
export const PM_hr: Participant = {
  role: "project_manager",
  place: { project: "hr" },
};

// where를 만족하는 첫 call의 본문. 없으면 빈 글(premise가 먼저 떨어져 judge가 안 불린다).
export function firstCallBody(trial: TrialRecord, where?: CallWhere): string {
  return sentCalls(trial, where)[0]?.body ?? "";
}

// 사람에게 한 `ask`의 질문을 이은 목록. input이 null이면 건너뛴다.
export function askedQuestions(trial: TrialRecord): AskInput["questions"] {
  return toolCallsOf(trial, "ask").flatMap((c) =>
    (c.input as AskInput | null)?.questions ?? []
  );
}
