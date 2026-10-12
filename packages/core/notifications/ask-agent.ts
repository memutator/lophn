import { BUILTIN_AGENT_NAMES } from "../../protocol/lophn-agent/mod.ts";
import {
  type NotificationAsk,
  type NotificationAskRole,
  notificationAskSchema,
  type NotificationFirstContext,
} from "../../protocol/notifications/mod.ts";
import type { Seq } from "../../protocol/base/mod.ts";
import { triggerOf } from "./model.ts";

// 계기 종류가 정한 부를 agent와 첫 context 모양이다(platform/notifications#R13).
// 계기 표(contract)의 한 행이며 notification 내용이나 대상 문서의 내용을 읽지 않는다.
export type AskAgent = {
  role: NotificationAskRole;
  first_context: NotificationFirstContext;
};

// Ask를 고른 notification의 원래 사실이다. app은 대상이 속한 앱이다: 문제는 source
// payload에서, release는 그 release를 만든 사실(ReleasePrepared)에서 reads가 구해 넣는다.
// project는 위반된 context가 속한 project다: 그 context를 만든 사실(ContextCreated)에서 구한다
// (이 모듈은 읽지 않는다).
export type AskSource = {
  event: string;
  source_seq: Seq;
  subject: string;
  app?: string;
  project?: string;
};

// Ask가 내는 전부다(platform/notifications#R14). Agent 탭을 열 role과 자리, 세션의
// opening_context(→ lophn-agent/conversation)가 될 대상 참조뿐이다. run·message·읽음·
// notification 본문 복사본은 담지 않는다. 탭을 여는 일은 command도 event도 아니다.
export type AskTab = {
  role: NotificationAskRole;
  work_place: { kind: NotificationFirstContext["work_place"]; id: string };
  opening_context: {
    source_seq: Seq;
    target: { kind: NotificationFirstContext["target"]; id: string };
  };
};

// 계기 종류 → 부를 agent. 표에 없거나 agent가 없는 종류는 null(보기만)이다.
// 표의 복사본을 돌려준다: 호출한 쪽이 값을 바꿔도 계기 표는 그대로 남는다.
export function askAgentOf(event: string): AskAgent | null {
  const trigger = triggerOf(event);
  if (trigger === undefined || trigger.ask_agent === null) return null;
  return {
    role: trigger.ask_agent,
    first_context: { ...trigger.first_context },
  };
}

// 사람이 Ask를 골랐을 때 열 탭 값. agent가 없는 계기는 null이다.
export function askTab(source: AskSource): AskTab | null {
  const agent = askAgentOf(source.event);
  if (agent === null) return null;
  const place = agent.first_context.work_place === "app"
    ? source.app
    : source.project;
  if (place === undefined) return null;
  return {
    role: agent.role,
    work_place: { kind: agent.first_context.work_place, id: place },
    opening_context: {
      source_seq: source.source_seq,
      target: { kind: agent.first_context.target, id: source.subject },
    },
  };
}

// 알림 행에 싣는 [Ask <agent 이름>] 값(platform/notifications#R13, R14). 계기 표가 부를 agent와
// 첫 context 모양을 정하고 source 사실이 자리(앱 또는 project)와 대상 id를 채운다. agent가
// 없는 계기, 자리나 대상 id를 알 수 없는 사실, 모양이 맞지 않는 id는 null이다(보기만). 열
// 자리를 짐작하지 않는다.
// agent_name은 그 role의 built-in 이름이다: 부를 수 있는 role은 built-in뿐이다.
export function notificationAsk(
  event: string,
  subject: string,
  place: string | null,
): NotificationAsk | null {
  const agent = askAgentOf(event);
  if (agent === null || place === null) return null;
  const parsed = notificationAskSchema.safeParse({
    role: agent.role,
    agent_name: BUILTIN_AGENT_NAMES[agent.role],
    first_context: {
      work_place: { kind: agent.first_context.work_place, id: place },
      target: { kind: agent.first_context.target, id: subject },
    },
  });
  return parsed.success ? parsed.data : null;
}
