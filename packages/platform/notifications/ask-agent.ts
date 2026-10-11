import type {
  NotificationAskRole,
  NotificationFirstContext,
  Seq,
} from "../../contracts/platform/mod.ts";

// 계기 종류가 정한 부를 agent와 첫 context 모양이다(platform/notifications#R13).
// 계기 표(contract)의 한 행이며 notification 내용이나 대상 문서의 내용을 읽지 않는다.
export type AskAgent = {
  role: NotificationAskRole;
  first_context: NotificationFirstContext;
};

// Ask를 고른 notification의 원래 사실이다. app은 대상이 속한 앱이다: 문제는 source
// payload에서, release는 core가 앱 read로 구해 넣는다(이 모듈은 읽지 않는다).
export type AskSource = {
  event: string;
  source_seq: Seq;
  subject: string;
  app: string;
};

// Ask가 내는 전부다(platform/notifications#R14). Agent 탭을 열 role과 자리, 세션의
// opening_context(→ lophn-agent/conversation)가 될 대상 참조뿐이다. run·message·읽음·
// notification 본문 복사본은 담지 않는다. 탭을 여는 일은 command도 event도 아니다.
export type AskTab = {
  role: NotificationAskRole;
  work_place: { kind: "app"; id: string };
  opening_context: {
    source_seq: Seq;
    target: { kind: NotificationFirstContext["target"]; id: string };
  };
};

// 계기 종류 → 부를 agent. 표에 없거나 agent가 없는 종류는 null(보기만)이다.
export function askAgentOf(_event: string): AskAgent | null {
  throw new Error("not implemented: agent-I18");
}

// 사람이 Ask를 골랐을 때 열 탭 값. agent가 없는 계기는 null이다.
export function askTab(_source: AskSource): AskTab | null {
  throw new Error("not implemented: agent-I18");
}
