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

// 통로 하나가 프로젝트마다 마지막으로 연 세션(여는 중이면 그 약속). 세션 목록은 작업 자리를 알려 주지
// 않아 연 쪽이 기억한다. 연달아 눌러도 앞 누름이 끝나길 기다렸다 그 세션을 본다.
const lastOpened = new WeakMap<
  ConversationSource,
  Map<string, Promise<string | null>>
>();

/** 그 세션이 아직 열려 있고 메시지가 하나도 없는가. 읽지 못하면 아니다. */
async function isEmptyOpen(
  source: ConversationSource,
  agent: string,
  project: string,
  session: string,
): Promise<boolean> {
  const sessions = await source.sessions(agent, {
    kind: "project",
    id: project,
  });
  if (!sessions.ok) return false;
  const row = sessions.value.find((item) => item.id === session);
  if (row === undefined || row.state !== "open") return false;
  const messages = await source.messages(session);
  return messages.ok && messages.value.length === 0;
}

/**
 * 이 프로젝트에서 Context Engineer와 말할 세션을 고른다. 앞서 연 세션이 아직 비어 있으면 새로
 * 열지 않고 그 세션을 고른다([New context]를 두 번 눌러도 세션은 하나다). 담당이 없거나 회수됐거나
 * 세션을 못 열면 false다. 그때도 대화는 열려 있어 그 이유를 대화 화면이 보인다.
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
  const memory = lastOpened.get(source) ??
    new Map<string, Promise<string | null>>();
  lastOpened.set(source, memory);
  const key = `${agent.value.id}/${project}`;
  // 기억이 없으면 await 없이 바로 여는 데까지 가야 연달아 누른 둘이 둘 다 열지 않는다.
  const pending = memory.get(key);
  const earlier = pending === undefined ? undefined : await pending;
  if (
    earlier !== undefined && earlier !== null &&
    await isEmptyOpen(source, agent.value.id, project, earlier)
  ) {
    drafts.select(earlier);
    return true;
  }
  const opening = source.openSession({
    id: newId("ses", now()),
    agent: agent.value,
    workPlace: { kind: "project", id: project },
  }).then((opened) => opened.ok ? opened.value.id : null);
  memory.set(key, opening);
  const id = await opening;
  if (id === null) return false;
  drafts.select(id);
  return true;
}
