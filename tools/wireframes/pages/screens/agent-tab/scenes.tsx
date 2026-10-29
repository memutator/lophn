// Agent 탭의 새 설계 화면들. 모두 동작하는 ProjectApp 위에 고정 상태로 놓고, 탭 본문은 renderer의 AgentView가 장면(fake
// source)으로 그린다. 한 화면은 한 상태다: 보내기, 보낸 쪽 chip, call 블록, 질문 카드, 허락 카드, rewind, 권한.
import { ProjectApp } from "../project-app.tsx";
import type { ChatInit } from "../../../mock/agents-data.ts";
import { documentTab } from "../../../mock/phroner-data.ts";
import type { TabSpec } from "../project-window.tsx";

const DOC = documentTab("eval/experiments/exp-008-query-tools.md");
const SIDEBAR = { foldersClosed: true } as const;

/** 장면 하나(`sub`)를 Agent 탭으로 놓는다. */
function Scene({ sub, chat }: { sub: string; chat?: ChatInit }) {
  const tab: TabSpec = {
    key: `scene:${sub}`,
    kind: "agent",
    title: "Week 41 summary · lophn",
    sub,
    ...(chat === undefined ? {} : { chat }),
  };
  return (
    <ProjectApp
      sidebar={SIDEBAR}
      panes={[{ tabs: [DOC, tab], selected: tab.key }]}
    />
  );
}

/** 대화와 보내기: 일하는 중에 steer로 보낸 메시지에는 steer 표시가 붙고, 시각 블록은 앱 카드뿐이다. */
export const ConversationScene = () => <Scene sub="working" />;
/** 일하는 중에 보낸 메시지가 composer 위에 "다음 turn" 줄로 쌓인다. 줄 오른쪽 끝의 [Send now]를 누르면 도는 turn에 steer로 들어간다. */
export const QueuedMessageScene = () => <Scene sub="queued" />;
/** model을 바꾼 뒤 provider가 요청을 거절한 모습. 어떤 오류인지와 [Retry]가 대화 안에 남는다. */
export const RequestErrorScene = () => <Scene sub="request-error" />;
/** 받은 메시지의 보낸 쪽 chip 셋(program의 reaction, 다른 agent, coding agent). 마지막 chip은 눌러서 panel을 열었다. */
export const SenderChipsScene = () => <Scene sub="sender-chips" />;
/** 보낸 session의 call 블록: handoff, 답을 기다리는 call, 취소한 call. */
export const CallOpenScene = () => <Scene sub="call-open" />;
/** call이 끝난 모습 둘. 답과 실패는 블록이 아니라 그 call에 이어지는 새 메시지로 보인다. */
export const CallRepliesScene = () => <Scene sub="call-replies" />;
/** 질문 카드: header, 선택지 2~4개(label과 description), multiSelect, 늘 붙는 Other. 기한도 Skip도 없다. */
export const QuestionScene = () => <Scene sub="question" />;
/** 답한 뒤: 카드가 대화 안의 접힌 요약이 되고 일이 이어진다. */
export const QuestionAnsweredScene = () => <Scene sub="question-answered" />;
/** 기다리는 중 내가 그냥 메시지를 보낸 뒤: 카드가 "Ended by your message"로 접힌다. */
export const QuestionEndedScene = () => <Scene sub="question-ended" />;
/** 허락 카드(shell 명령): 명령이 그대로 보이고 선택지는 한 번, 항상(더할 규칙을 보인다), 거절이다. */
export const ApprovalScene = () => <Scene sub="approval" />;
/** [Deny]를 누른 모습: 이유를 적는 칸이 열린다. 적지 않고 보내도 된다. */
export const ApprovalDenyScene = () => <Scene sub="approval-deny" />;
/** 결정 뒤 대화에 남는 줄 넷: 한 번 허락, 항상 허락, 거절, 일이 끝나 취소된 것을 구별한다. */
export const ApprovalStatesScene = () => <Scene sub="approval-states" />;
/** skip을 켠 session. composer 아래 줄 오른쪽 끝의 Skip permissions 스위치가 켜져 있다. */
export const SkipScene = () => <Scene sub="skip" />;
/** rewind: 내 메시지에서 그 시점으로 되돌리는 panel이 대화 화면 안에 열린다. 앱은 앱마다 고른다. */
export const RewindScene = () => <Scene sub="rewind" />;
/** `/permissions`: 그 agent에 할당한 앱과 앱마다 뺀 tool, MCP server는 설정한 곳을 가리키는 한 줄. */
export const PermissionsScene = () => (
  <Scene sub="working" chat={{ view: "permissions" }} />
);
