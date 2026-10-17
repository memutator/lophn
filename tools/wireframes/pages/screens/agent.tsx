import type { Area } from "../types.ts";
import {
  AgentApproval,
  AgentApprovalDeny,
  AgentApprovalSettings,
  AgentApprovalStates,
  AgentCallOpen,
  AgentCallReplies,
  AgentCommands,
  AgentCommandsFiltered,
  AgentConversation,
  AgentModelPicker,
  AgentPermissions,
  AgentQuestion,
  AgentQuestionAnswered,
  AgentQuestionEnded,
  AgentQueuedMessage,
  AgentRecap,
  AgentRequestError,
  AgentRewind,
  AgentSenderChips,
  AgentSessionArchived,
  AgentSessions,
  AgentSessionsEdit,
} from "./agent-pages.tsx";

export const agentArea: Area = {
  id: "agent",
  title: "Agent",
  summary: "Agent 대화 탭. 메시지, 질문·승인 card, 명령, 권한, session 전환.",
  pages: [
    {
      id: "new-agent-conversation",
      title: "Agent · tab",
      description:
        "일하는 중인 Agent 탭이다. 도는 turn에 steer로 들어간 메시지에 steer 표시가 붙고, 시각 블록은 앱 카드뿐이다. 일하는 중 composer에는 Stop과 Send만 있고, 입력칸 아래에 권한 요약 한 줄이 있다.",
      render: () => <AgentConversation />,
    },
    {
      id: "new-agent-queued-message",
      title: "Agent · queued message",
      description:
        "일하는 중에 보낸 메시지가 composer 위 Next turn 줄로 쌓인 모습이다. 줄 오른쪽 끝의 [Send now]를 누르면 도는 turn에 steer로 들어가고 steer 표시가 붙는다. 보내기 방식을 고르는 menu는 없다.",
      render: () => <AgentQueuedMessage />,
    },
    {
      id: "new-agent-sender-chips",
      title: "Agent · sender chips",
      description:
        "받은 메시지에 보낸 쪽 chip이 붙는다(program의 reaction, 다른 agent, coding agent). coding agent chip에는 harness 아이콘이 있다. chip을 누르면 맡긴 글, 근거 링크, 보낸 session 링크가 든 panel이 열린다.",
      render: () => <AgentSenderChips />,
    },
    {
      id: "new-agent-call-open",
      title: "Agent · handed-over task",
      description:
        "다른 agent에게 맡긴 일의 블록이다. 받는 곳, 맡긴 글 한 줄, 답 방식이 보이고 누르면 그때의 상태를 읽는다. 끝나지 않은 일에는 [Cancel]이 있다. 상태가 바뀌어도 따로 알리지 않는다.",
      render: () => <AgentCallOpen />,
    },
    {
      id: "new-agent-call-replies",
      title: "Agent · replies to a handed-over task",
      description:
        "답과 실패가 블록 안이 아니라 그 일에 이어진 새 메시지로 보인다. 답이 온 경우와 받은 session이 답 없이 끝나 실패한 경우다.",
      render: () => <AgentCallReplies />,
    },
    {
      id: "new-agent-question",
      title: "Agent · question card",
      description:
        "composer 위 질문 카드다. 질문은 한 번에 하나만 보이고 ‹ 1 of 2 ›로 넘긴다. 질문마다 header, 선택지 2~4개(label과 description), multiSelect, 늘 붙는 Other가 있다. 단추는 오른쪽 끝이다.",
      render: () => <AgentQuestion />,
    },
    {
      id: "new-agent-question-answered",
      title: "Agent · question answered",
      description:
        "답을 보내면 카드가 접힌 요약으로 남고 agent의 일이 이어진다.",
      render: () => <AgentQuestionAnswered />,
    },
    {
      id: "new-agent-question-ended",
      title: "Agent · question ended by message",
      description:
        "기다리는 중 사람이 그냥 메시지를 보내면 카드가 Ended by your message로 접히고, 고른 답이 없다고 보인다.",
      render: () => <AgentQuestionEnded />,
    },
    {
      id: "new-agent-approval",
      title: "Agent · approval card",
      description:
        "app-api나 MCP tool의 승인 카드다. 확인 창 없이 Allow once, Allow for this session, Always allow, Deny로 바로 결정한다. 내용은 program 문구(대상, 입력, 효과)다.",
      render: () => <AgentApproval />,
    },
    {
      id: "new-agent-approval-deny",
      title: "Agent · approval deny reason",
      description: "Deny를 누르면 이유 칸이 열린다. 적지 않고 보내도 된다.",
      render: () => <AgentApprovalDeny />,
    },
    {
      id: "new-agent-approval-settings",
      title: "Agent · approval for settings",
      description:
        "설정 고치기(LOPHN.md 쓰기) 카드다. 선택지는 Allow와 Deny뿐이고 바뀌는 줄을 diff로 보인다.",
      render: () => <AgentApprovalSettings />,
    },
    {
      id: "new-agent-approval-states",
      title: "Agent · approval results",
      description:
        "결정 뒤 대화에 남는 줄 넷이다. 허락 접수, 적용됨, 거절(이유 포함), cancelled(이 일이 끝나서 없어진 요청)를 구별한다.",
      render: () => <AgentApprovalStates />,
    },
    {
      id: "new-agent-commands",
      title: "Agent · commands",
      description:
        "입력칸에 /를 친 메뉴다. 한 줄에 아이콘, 이름, 설명이 붙은 얇은 행이고 묶음은 선으로 나눈다. Recap이 있고 Permissions는 grant와 이 session의 허락을 보인다.",
      render: () => <AgentCommands />,
    },
    {
      id: "new-agent-commands-filtered",
      title: "Agent · commands filtered",
      description:
        "일하는 중 /re로 거른 메뉴다. 이름이나 설명에 맞는 것만 남고, 고른 명령은 다음 turn에 들어간다고 줄 오른쪽에 보인다.",
      render: () => <AgentCommandsFiltered />,
    },
    {
      id: "new-agent-recap",
      title: "Agent · recap",
      description:
        "/recap 결과다. session을 짧게 요약해 보이고 대화 이력은 그대로 둔다.",
      render: () => <AgentRecap />,
    },
    {
      id: "new-agent-permissions",
      title: "Agent · permissions",
      description:
        "/permissions 보기다. 그 agent의 grant(대상, 효과, 묻는지)와 이 session에서 이 session 동안으로 허락한 대상을 보인다. 입력칸 아래 권한 요약을 눌러도 같은 보기가 열린다.",
      render: () => <AgentPermissions />,
    },
    {
      id: "new-agent-model-picker",
      title: "Agent · model picker",
      description:
        "composer의 model을 누르면 Favorites가 맨 위에, 그 아래 provider별 model이 provider 아이콘과 함께 나온다. option 축은 고른 model이 가진 것만 보이고 따로 붙는 안내 문구는 없다.",
      render: () => <AgentModelPicker />,
    },
    {
      id: "new-agent-request-error",
      title: "Agent · request error",
      description:
        "model을 바꾼 뒤 provider가 요청을 거절한 모습이다. 어떤 오류인지와 [Retry]가 대화 안 오류 메시지로 남는다. model을 바꿀 때 조정 안내는 없고 새 model의 기본 variant로 맞춘다.",
      render: () => <AgentRequestError />,
    },
    {
      id: "new-agent-rewind",
      title: "Agent · rewind",
      description:
        "내 메시지에서 그 시점으로 되돌리는 대화 안 panel이다. 대화와 file tool로 바꾼 파일은 기본으로 함께 되돌리고, 앱은 앱마다 고른다. write 목록, 함께 되돌아갈 다른 변경, 되돌아가지 않는 external 효과, 결과를 모르는 write를 보인다.",
      render: () => <AgentRewind />,
    },
    {
      id: "new-agent-sessions",
      title: "Agent · session switcher",
      description:
        "agent header의 session 제목을 누르면 열리는 목록이다. Archived 줄에는 되살리기가 없고 눌러서 읽기만 한다. session 상태는 열림, archive, 지움 셋이다.",
      render: () => <AgentSessions />,
    },
    {
      id: "new-agent-sessions-edit",
      title: "Agent · session rename and delete",
      description:
        "이름 고치기와 지움 확인이다. 지움 확인에 다른 agent가 이 session에 맡겨 두고 답을 기다리는 일이 실패한다는 영향이 적혀 있다.",
      render: () => <AgentSessionsEdit />,
    },
    {
      id: "new-agent-session-archived",
      title: "Agent · archived session",
      description:
        "archive한 session을 열면 기록만 보이고 입력칸이 없다. 머리에 Archived 표시와 안내 줄이 있다.",
      render: () => <AgentSessionArchived />,
    },
  ],
};
