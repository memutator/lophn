// Agent 탭이 TabItem.fields에 두는 값(agent·work_place·session)의 읽기와 쓰기. layout 파일에 남는 것은 이 셋뿐이고, chips는 탭을 연 순간의 메모리 값이다(저장하지 않는다).
import type { ContextChipView } from "../../conversation/composer/agent-composer.tsx";
import type { TabItem } from "../model.ts";

export const SESSION_ID = /^ses_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
export const TAB_KEY = /^[A-Za-z0-9._:-]+$/;

/** 탭이 보는 agent의 id(sidebar의 agent 줄이 주는 값). 맞지 않으면 null이다. */
export function agentOf(tab: TabItem): string | null {
  const agent = tab.fields?.agent;
  return typeof agent === "string" && agent.length > 0 && agent.length <= 128
    ? agent
    : null;
}

/** 탭을 연 자리(project). 탭을 연 뒤 바꾸지 않는다. */
export function placeOf(tab: TabItem): string | null {
  const place = tab.fields?.place;
  return typeof place === "string" && place.length > 0 && place.length <= 128
    ? place
    : null;
}

/** 탭이 보는 session. 없으면 아직 만들지 않은 새 session이다. */
export function sessionOf(tab: TabItem): string | null {
  const session = tab.fields?.session;
  return typeof session === "string" && SESSION_ID.test(session)
    ? session
    : null;
}

/** 새 session의 첫 말 전에 붙은 context chip. 저장하지 않는다. */
export function chipsOf(tab: TabItem): readonly ContextChipView[] {
  const chips = tab.fields?.chips;
  return Array.isArray(chips) ? (chips as readonly ContextChipView[]) : [];
}
