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
  AgentCost,
  AgentCostUnknown,
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
  ManageModels,
  ManageModelsConnect,
  ManageModelsCustom,
  ManageModelsRefreshFailed,
  ModelInfoAdd,
  ModelInfoConflict,
  ModelInfoConnectEmpty,
  ModelInfoConnectFound,
  ModelInfoEdit,
  ModelInfoManage,
  ModelInfoPicker,
  ModelPickerEmpty,
  ModelPickerInherited,
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
      id: "new-conversation-cost",
      title: "Agent · session cost",
      description:
        "입력칸 아래 줄 오른쪽 끝에 그 session의 추정 비용 합이 조용한 보조 글로 보인다. 1센트 미만은 소수 넷째 자리까지($0.0046), 그 위는 둘째 자리까지 보인다. 쓴 돈이 없고 가격 모르는 call도 없으면 줄이 없다.",
      render: () => <AgentCost />,
    },
    {
      id: "new-conversation-cost-unknown",
      title: "Agent · session cost, price unknown",
      description:
        '추정 비용 합 옆에 가격을 모르는 call 수가 " · Price unknown 2"로 붙는다. 그 call은 합에 들지 않았다는 뜻이다. 합할 금액이 없고 모르는 call만 있으면 "Price unknown N" 하나만 보인다.',
      render: () => <AgentCostUnknown />,
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
        "composer의 model을 누르면 위에서부터 지금 model이 온 층 한 줄(이 대화에서 골랐다), 검색칸, 켜 둔 model이 provider 아이콘과 함께 provider별로 나온다. 꺼 둔 model(Haiku, GPT-6.1 Mini)은 없다. 고른 model의 option 축이 있고 맨 아래 Manage models 한 줄이 창을 연다. picker는 고르기만 한다.",
      render: () => <AgentModelPicker />,
    },
    {
      id: "new-model-picker-inherited",
      title: "Agent · model picker, project default",
      description:
        "이 대화에서 model을 고르지 않아 project default를 따르는 상태다. 머리의 층 한 줄이 project default를 말한다. 목록에서 고르면 이 대화의 model이 된다.",
      render: () => <ModelPickerInherited />,
    },
    {
      id: "new-model-picker-empty",
      title: "Agent · model picker, nothing shown",
      description:
        "보일 model이 하나도 없을 때다. 보일 model이 없다는 안내와 맨 아래 Manage models 줄만 있다. 줄을 누르면 Manage models 창이 열린다.",
      render: () => <ModelPickerEmpty />,
    },
    {
      id: "new-manage-models",
      title: "Agent · Manage models",
      description:
        "picker의 Manage models 줄이 여는 창이다. 오른쪽 위 [Connect provider], 검색칸, provider마다 묶음이 있고 묶음 머리의 toggle이 그 provider의 model 전부를 켜고 끈다. model마다 toggle이 있고 꺼 둔 model(Haiku, GPT-6.1 Mini)은 picker에 보이지 않는다.",
      render: () => <ManageModels />,
    },
    {
      id: "new-manage-models-custom",
      title: "Agent · Manage models, custom provider",
      description:
        "custom provider의 묶음이다. 머리에 [Refresh models]가 있고, 줄마다 [Edit]이, 묶음 아래에 [Add model]이 있다. [Add model]은 provider가 목록에 주지 않는 model의 정보를 적는 form을 연다.",
      render: () => <ManageModelsCustom />,
    },
    {
      id: "new-model-info-manage",
      title: "Agent · Manage models, model info",
      description:
        "내장 provider(Anthropic)와 custom provider(Local server)를 같이 둔 창이다. 모든 줄에 입력 modality icon과 아는 경우 짧은 context(200K, 1M)가 보인다. catalog model은 읽기만 하고, custom provider의 줄에는 [Edit]이, 묶음 아래에는 [Add model]이 있다. 정보를 적은 deepseek-v4.1-flash는 provider가 알려 준 목록에 없어도 줄로 보인다.",
      render: () => <ModelInfoManage />,
    },
    {
      id: "new-model-info-add",
      title: "Agent · model info, new model",
      description:
        "[Add model]을 눌러 연 빈 form이다. Manage models 창 위에 Dialog로 열린다. 한도 칸은 비어 있고 안 적었을 때 turn이 쓰는 기본값(131072, context와 같음, 4096)이 회색 placeholder로 보인다. 가격 칸도 비우면 모름이다.",
      render: () => <ModelInfoAdd />,
    },
    {
      id: "new-model-info-edit",
      title: "Agent · model info, editing",
      description:
        "행의 [Edit]으로 연 채운 form이다. 이름은 읽기만 한다. 입력 media에 image가 켜져 있고, reasoning이 켜져 effort low·medium·high·maximum 중 기본 high, 가격 셋이 적혀 있다. 맨 아래 [Remove model]은 이 정보를 지운다.",
      render: () => <ModelInfoEdit />,
    },
    {
      id: "new-model-info-conflict",
      title: "Agent · model info, stale save",
      description:
        "form을 연 사이 다른 창이 정보를 바꿔 [Save]가 conflict가 된 모습이다. form 값은 그대로 두고 form 안에 한 줄만 보인다. 판을 다시 읽었으니 한 번 더 누르면 저장된다.",
      render: () => <ModelInfoConflict />,
    },
    {
      id: "new-model-info-connect-found",
      title: "Agent · connect a custom provider, models found",
      description:
        'Manage models에서 Custom provider를 붙이면 연결 직후 provider의 model 목록을 한 번 읽는다. 찾았을 때 돌아온 창이다. 새 provider 묶음이 맨 위에 있고 창 안에 "Found 2 models on Local server." 한 줄이 보인다. 전역 기본 model이 없을 때는 이 한 줄이 기본 model 창에 보인다.',
      render: () => <ModelInfoConnectFound />,
    },
    {
      id: "new-model-info-connect-empty",
      title: "Agent · connect a custom provider, no model list",
      description:
        "Custom provider를 붙였는데 목록을 읽지 못했거나 비어 있을 때(hive처럼 /models가 404)다. Manage models의 그 provider 묶음이 맨 위에 서고 Add model form이 바로 열려 있다. form 맨 위 한 줄이 목록을 받지 못했으니 이름으로 더하라고 알린다. 저장하고 창을 닫은 뒤 전역 기본 model이 없으면 기본 model 창이 이어진다.",
      render: () => <ModelInfoConnectEmpty />,
    },
    {
      id: "new-model-info-picker",
      title: "Agent · model picker, custom model with effort",
      description:
        "정보를 적은 custom model(deepseek-v4.1-flash)을 고른 picker다. 적은 effort가 option 축(low·medium·high·maximum, 지금 high)으로 보인다. 정보가 없는 같은 provider의 model(llama-3.3-70b, qwen-3-coder)은 축이 없다.",
      render: () => <ModelInfoPicker />,
    },
    {
      id: "new-manage-models-refresh-failed",
      title: "Agent · Manage models, refresh failed",
      description:
        "[Refresh models]를 눌렀지만 읽지 못한 상태다. 앞 목록은 그대로 있고 창 안에 실패 한 줄만 보인다.",
      render: () => <ManageModelsRefreshFailed />,
    },
    {
      id: "new-manage-models-connect",
      title: "Agent · Manage models, connect provider",
      description:
        "창의 [Connect provider]를 누르면 provider 연결 창이 Manage models 창 위에 열린다. 붙이고 나면 창으로 돌아와 새 provider 묶음이 맨 위에 보인다.",
      render: () => <ManageModelsConnect />,
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
