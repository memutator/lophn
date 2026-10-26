import type { Area } from "../types.ts";
import {
  SecretInputApp,
  SecretInputMcp,
  SecretInputProvider,
  WaitingActivation,
  WaitingDenyReason,
  WaitingFinished,
  WaitingFirstActivation,
  WaitingJobHoldConflict,
  WaitingJobHoldKinds,
  WaitingJobHolds,
  WaitingList,
  WaitingPermission,
  WaitingSettled,
  WaitingToasts,
} from "./waiting/waiting-pages.tsx";

export const questionsArea: Area = {
  id: "questions",
  title: "Questions & input",
  summary: "사람에게 묻는 화면. 대기 중인 요청(Waiting)과 secret 입력.",
  pages: [
    {
      id: "new-waiting-list",
      title: "Waiting · list",
      description:
        "창 위 pill(5 waiting)을 펼친 대기 목록이다. 모든 session의 권한 요청(shell 명령, coding agent), 질문, 앱 업데이트(activation 동의), 예약된 job의 놓친 차례가 네 묶음으로 나뉘고 항목마다 agent, session, 앱이나 project가 보인다. 세부는 접혀 있어 제목, 한 줄 설명, 단추만 보이고 단추는 카드 오른쪽 끝에 모인다. coding agent 항목은 harness 아이콘과 [Answer in terminal]만 있다.",
      render: () => <WaitingList />,
    },
    {
      id: "new-waiting-permission",
      title: "Waiting · permission requests",
      description:
        "권한 요청 둘의 세부를 펼친 상태다. shell 카드는 명령을 code 줄로 늘 보이고 Always allow가 더할 규칙 줄을 함께 보이며 단추는 Deny, Always allow, Allow once다. MCP tool 카드는 대상과 효과를 접어 두고 Deny, Allow once다. 할당한 tool의 바깥 효과는 지금 묻지 않아 tool 카드는 실제로 뜨지 않는다.",
      render: () => <WaitingPermission />,
    },
    {
      id: "new-waiting-deny-reason",
      title: "Waiting · deny with reason",
      description:
        "권한 요청 카드에서 Deny를 누르면 이유 칸이 열린다. 비워도 되고, 적으면 요청한 agent의 tool 결과로 간다. activation 동의 카드에는 이유 칸이 없다.",
      render: () => <WaitingDenyReason />,
    },
    {
      id: "new-waiting-activation",
      title: "Waiting · activation consent",
      description:
        "activation 동의 카드의 세부를 펼친 상태다. 이유 칸 없이 Allow와 Deny뿐이다. 이전 release보다 늘어난 선언(network host, secret, 파일, 다른 앱 tool 쓰기)과 손실 단계(표 지움, 칸 지움, type 좁힘)만 보인다.",
      render: () => <WaitingActivation />,
    },
    {
      id: "new-waiting-first-activation",
      title: "Waiting · first activation",
      description:
        "첫 activation의 세부를 펼친 상태다. 선언 전부가 늘어난 것이고 손실 단계는 없다.",
      render: () => <WaitingFirstActivation />,
    },
    {
      id: "new-waiting-finished",
      title: "Waiting · finished",
      description:
        "알림 panel의 Finished 묶음이다. 사람이 보지 않는 사이 turn이 끝난 터미널 coding agent와 lophn Agent session이 대기 항목 아래에 한 줄씩 나온다. 줄(오른쪽 끝 [Show])을 누르면 그 탭을 고르고, 탭을 보면 줄이 저절로 빠진다. 알림 단추의 개수에도 센다.",
      render: () => <WaitingFinished />,
    },
    {
      id: "new-waiting-settled",
      title: "Waiting · just settled",
      description:
        "결정한 뒤 목록에 잠깐 남는 줄 셋이다. 허락, 거절, cancelled(원래 일이 끝남)를 나눈다.",
      render: () => <WaitingSettled />,
    },
    {
      id: "waiting-job-hold-list",
      title: "Waiting · scheduled jobs",
      description:
        "대기 목록의 네 번째 묶음 Scheduled jobs다. hold 정책 job이 놓친 차례를 [Skip]이나 [Start now]로 정한다. 정하면 card는 목록에서 빠지고 남는 줄과 toast는 없다.",
      render: () => <WaitingJobHolds />,
    },
    {
      id: "waiting-job-hold-kinds",
      title: "Waiting · job kinds",
      description:
        "job hold card의 세 가지 할 일: agent 호출(받는 agent), 앱 tool 호출(tool과 앱의 짧은 id), workflow 시작(workflow 이름). 카드에는 job 제목, 만든 agent와 place, 놓친 수와 마지막 차례 시각이 보인다.",
      render: () => <WaitingJobHoldKinds />,
    },
    {
      id: "waiting-job-hold-conflict",
      title: "Waiting · start blocked",
      description:
        "앞 차례가 아직 돌아 [Start now]를 누르면 막힌 상태다(Weekly review). card는 남고 사유 글이 단추 위에 보이며 [Skip]은 쓸 수 있다.",
      render: () => <WaitingJobHoldConflict />,
    },
    {
      id: "new-waiting-toasts",
      title: "Waiting · toasts",
      description:
        "창 오른쪽 아래에 쌓인 toast 다섯(권한 요청, activation 동의, 질문, App restart halted, kind 위반)이다. layout을 차지하지 않고 단추([Review], [Open session])는 오른쪽 끝에 있다.",
      render: () => <WaitingToasts />,
    },
    {
      id: "new-secret-input",
      title: "Secret input · provider key",
      description:
        "shell이 띄우는 작은 secret 보호 입력 창이다. 값은 점으로만 보이고, 저장하면 이름과 설정 여부만 남는다. 빈 칸이면 Save가 꺼져 있다.",
      render: () => <SecretInputProvider />,
    },
    {
      id: "new-secret-input-app",
      title: "Secret input · app secret",
      description:
        "이미 설정된 앱 secret의 값을 바꾸는 상태다. 저장하면 값이 바뀐다는 안내가 있다.",
      render: () => <SecretInputApp />,
    },
    {
      id: "new-secret-input-mcp",
      title: "Secret input · MCP credential",
      description: "MCP server credential을 받는 같은 보호 입력 창이다.",
      render: () => <SecretInputMcp />,
    },
  ],
};
