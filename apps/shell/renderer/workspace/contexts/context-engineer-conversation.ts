// [New context]가 시작하는 Context Engineer 대화(shell/workspace#R30). 창의 대화 통로가 묻는 담당을
// Context Engineer로 바꾸고, 프로젝트를 작업 자리로 하는 새 세션을 열어 고른다. 대화 화면은 그
// 세션을 그대로 보인다.
import { newId } from "../../desktop/lophn-space/model.ts";
import type { DraftStore } from "../../conversation/drafts.ts";
import type { ConversationSource } from "../../conversation/source.ts";

/** 같은 통로로 Context Engineer와 말하는 통로. 담당 하나만 다르다. */
export function contextEngineerSource(
  source: ConversationSource,
): ConversationSource {
  return { ...source, agent: () => source.agent("context_engineer") };
}

/**
 * 이 프로젝트에서 Context Engineer와 말할 새 세션을 연다. 담당이 없거나 회수됐거나 세션을 못 열면
 * false다. 그때도 대화는 열려 있어 그 이유를 대화 화면이 보인다.
 */
export async function startContextEngineerSession(
  source: ConversationSource,
  drafts: Pick<DraftStore, "select">,
  project: string,
  now: () => number,
): Promise<boolean> {
  const agent = await source.agent();
  if (!agent.ok || agent.value === null || agent.value.state === "withdrawn") {
    return false;
  }
  const opened = await source.openSession({
    id: newId("ses", now()),
    agent: agent.value,
    workPlace: { kind: "project", id: project },
  });
  if (!opened.ok) return false;
  drafts.select(opened.value.id);
  return true;
}
