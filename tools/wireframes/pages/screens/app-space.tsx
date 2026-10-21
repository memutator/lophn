import type { Area } from "../types.ts";
import { APP_BUDGET } from "../../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import { openApp } from "../../../../packages/shell/renderer/desktop/router.ts";
import {
  AccessGrants,
  AccessRevoking,
  ActivityLog,
  AgentPaneOpen,
  AnnotateList,
  AnnotatePicking,
  AppSpaceFrame,
  CodingEnded,
  CodingOpenedToast,
  CodingPermission,
  CodingRunning,
  RewindConfirm,
  RewindConflict,
  RewindDone,
  RewindRunning,
  SidePanelTabs,
  VersionApplied,
  VersionApplying,
  VersionFailed,
} from "./app-space/pages.tsx";
import { MockDesktop } from "../../mock/mock-desktop.tsx";

export const appSpaceArea: Area = {
  id: "app-space",
  title: "App space",
  summary: "앱 공간. Version, Access, Activity, rewind, annotate, coding 탭.",
  pages: [
    {
      id: "app-space",
      title: "App space",
      description:
        "앱 공간. 상단 바에 앱 이름, 본문에 앱 view. 앱 view는 안내 상자로 그린다.",
      render: () => <MockDesktop route={openApp(APP_BUDGET)} />,
    },
    {
      id: "new-app-space",
      title: "App space · frame",
      description:
        "앱 공간이다. 탭 줄 없이 앱 화면이 title bar 아래 전체를 쓴다. title bar에 [Annotate], 앱 상세 단추가 있고, 펼친 agent select에 lophn, App Engineer, Operator 둘, Manage가 있다.",
      render: () => <AppSpaceFrame />,
    },
    {
      id: "new-app-agent-pane",
      title: "App space · agent tab",
      description:
        "title bar의 Agent select로 연 오른쪽 패널이다. 앱 화면 옆에 붙고 머리 줄에 Agent 탭 하나가 있다. 안의 대화는 project 창 Agent 탭과 같은 component다.",
      render: () => <AgentPaneOpen />,
    },
    {
      id: "new-app-side-panel",
      title: "App space · side panel tabs",
      description:
        "오른쪽 패널 하나에 App details, Agent, coding 터미널이 탭 줄로 선다. 탭마다 아이콘과 닫기 ×가 있고 마지막 탭을 닫으면 패널이 닫힌다. title bar의 App details와 Agent 단추는 해당 탭을 열거나 고르고, 이미 고른 탭이면 패널을 닫는다. 탭을 바꿔도 안의 상태는 그대로다.",
      render: () => <SidePanelTabs />,
    },
    {
      id: "new-app-version-applied",
      title: "App space · Version (applied)",
      description:
        "오른쪽 패널의 App details 탭 안에 Version, Access, Activity 셋이 있다. Version 탭은 적용된 release, 늘어난 선언과 손실 단계만 보이는 what changes, 이전 release로 돌아가기를 보인다. 돌아가기는 data schema가 같은 release에만 켜지고 나머지는 이유와 함께 꺼진다.",
      render: () => <VersionApplied />,
    },
    {
      id: "new-app-version-applying",
      title: "App space · Version (applying)",
      description:
        "사람이 시작하지 않은 activation이 도는 중이다. 접수를 닫고 도는 호출을 기다리는 단계가 보이고 그동안 돌아가기는 꺼진다.",
      render: () => <VersionApplying />,
    },
    {
      id: "new-app-version-failed",
      title: "App space · Version (apply failed)",
      description:
        "적용 실패와 이유가 보인다. 이전 release가 그대로 활성이고 App Engineer가 이어 받는다는 안내가 있다.",
      render: () => <VersionFailed />,
    },
    {
      id: "new-app-access",
      title: "App space · Access",
      description:
        "앱이 activation 때 허락받은 바깥 자원(network host, secret 이름, 파일)과 다른 앱 tool을 보이고 [Revoke]로 거둔다. 예전 Connections 탭을 합쳤고 만들기 단추는 없다.",
      render: () => <AccessGrants />,
    },
    {
      id: "new-app-access-revoking",
      title: "App space · Access (revoking)",
      description:
        "거두기를 요청한 뒤다. 요청 접수(새 호출 막힘)와 정리(이전 process 종료 확인 뒤 다시 시작)를 두 단계로 나눠 보인다.",
      render: () => <AccessRevoking />,
    },
    {
      id: "new-app-activity",
      title: "App space · Activity",
      description:
        "호출 기록이다. 호출자(사람 화면, agent session 링크, 다른 앱, 앱 시작), project, 효과, 대기와 되돌림됨이 보인다. 지금 release의 live write, external, 앱 시작 행에만 [Rewind from here]가 있고, 행을 펼치면 부른 쪽 session과 tool call, 입력 지문, 결과, 되돌림 기록이 있다.",
      render: () => <ActivityLog />,
    },
    {
      id: "new-app-rewind-confirm",
      title: "App space · rewind panel",
      description:
        "Activity 탭 안의 rewind panel이다. 고른 호출부터 최신까지 함께 되돌아갈 목록을 보이고 external은 Won't be undone, 결과를 모르는 write는 Can't be undone으로 표시한다. 그 앱을 쓴 모두의 변경이 함께 사라진다는 안내가 있고 사람이 눌러야 시작한다.",
      render: () => <RewindConfirm />,
    },
    {
      id: "new-app-rewind-running",
      title: "App space · rewind in progress",
      description:
        "접수를 닫고 도는 호출을 기다리는 중이다. 그동안 붙잡힌 호출의 안내가 있다.",
      render: () => <RewindRunning />,
    },
    {
      id: "new-app-rewind-done",
      title: "App space · rewind done",
      description:
        "성공 결과다. 앱이 고른 시점 직전으로 돌아갔고 열린 앱 화면이 갱신됐다. 되돌아가지 않은 external과 되돌릴 수 없던 write가 구별돼 보인다.",
      render: () => <RewindDone />,
    },
    {
      id: "new-app-rewind-conflict",
      title: "App space · rewind cancelled",
      description:
        "충돌로 통째로 취소된 결과다. 아무것도 바뀌지 않았고, 이유와 붙잡았던 호출이 이어졌음이 보인다.",
      render: () => <RewindConflict />,
    },
    {
      id: "new-app-annotate",
      title: "App space · annotate (picking)",
      description:
        "앱 공간 바의 [Annotate]를 켰다. 요소를 가리키면 윤곽과 이름표가 뜨고, 고른 요소에 번호와 메모 칸이 붙는다. 영역을 끄는 중인 모양도 있다.",
      render: () => <AnnotatePicking />,
    },
    {
      id: "new-app-annotate-list",
      title: "App space · annotations list",
      description:
        "모은 annotation 셋(요소 둘, 영역 하나)의 목록이다. 하나씩 지우거나 전부 지우고 [Send to App Engineer]로 한 번에 보낸다. App Engineer session의 메시지가 된다.",
      render: () => <AnnotateList />,
    },
    {
      id: "new-app-coding-toast",
      title: "App space · coding tab opened",
      description:
        "App Engineer가 ticket을 맡기자 lophn이 coding 터미널을 열었다. agent 대화에 focus가 그대로 있고 pane 위쪽 toast로 알린다. 패널 탭 줄에 harness 아이콘이 붙은 터미널 탭이 생겼다.",
      render: () => <CodingOpenedToast />,
    },
    {
      id: "new-app-coding-terminal",
      title: "App space · coding terminal tab",
      description:
        "패널 탭 줄에서 바꿔 본 coding 터미널이다. harness 아이콘과 ticket이 탭 이름이고 터미널 바탕은 pane과 같다.",
      render: () => <CodingRunning />,
    },
    {
      id: "new-app-coding-permission",
      title: "App space · coding permission prompt",
      description:
        "대기 목록에서 coding agent의 권한 요청을 눌러 온 장면이다. 그 터미널로 focus가 오고 물음은 TUI 안에 있다. 답은 TUI에서 한다.",
      render: () => <CodingPermission />,
    },
    {
      id: "new-app-coding-ended",
      title: "App space · coding session ended",
      description:
        "끝난 coding session이다. 상태 줄만 있고 다시 시작 단추는 없다. 새 맡기기는 새 터미널로 열린다.",
      render: () => <CodingEnded />,
    },
  ],
};
