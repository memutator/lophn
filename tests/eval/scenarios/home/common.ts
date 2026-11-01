// home 시나리오가 같이 쓰는 참가자와 judge 입력 helper. 시나리오가 아니라 runner가 읽지 않는다.
import type { AskInput } from "../../../../packages/protocol/lophn-agent/ask-tool.ts";
import { type CallWhere, sentCalls, toolCallsOf } from "../../checks/mod.ts";
import type { Participant, TrialRecord } from "../../types.ts";

// 이름은 `call.send` 명령의 `to`가 맞추는 이름과 같다. 앱은 app.name, project는 project.name이다.
export const LOPHN: Participant = { agent: "lophn" };
export const LOPHN_가계부: Participant = {
  agent: "lophn",
  place: { app: "가계부" },
};
export const LOPHN_할일: Participant = {
  agent: "lophn",
  place: { app: "할일" },
};
export const LOPHN_캘린더: Participant = {
  agent: "lophn",
  place: { app: "캘린더" },
};
export const LOPHN_tax: Participant = {
  agent: "lophn",
  place: { project: "tax" },
};
export const LOPHN_hr: Participant = {
  agent: "lophn",
  place: { project: "hr" },
};

// where를 만족하는 첫 call의 본문. 없으면 빈 글(premise가 먼저 떨어져 judge가 안 불린다).
export function firstCallBody(trial: TrialRecord, where?: CallWhere): string {
  return sentCalls(trial, where)[0]?.body ?? "";
}

// 사람에게 한 `ask`의 질문을 이은 목록. input이 null이면 건너뛴다.
export function askedQuestions(trial: TrialRecord): AskInput["questions"] {
  return toolCallsOf(trial, "ask").flatMap(
    (c) => (c.input as AskInput | null)?.questions ?? [],
  );
}
