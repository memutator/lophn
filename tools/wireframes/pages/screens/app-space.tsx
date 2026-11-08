import type { Area } from "../types.ts";
import {
  AccessGrants,
  AccessOAuthFailed,
  AccessOAuthReady,
  AccessOAuthSetup,
  AccessOAuthSignedIn,
  AccessOAuthWaiting,
  AccessRevoking,
  AccessSecrets,
  ActivityLog,
  AnnotateList,
  AnnotatePicking,
  AppWorkspaceMenu,
  AppWorkspaceScreen,
  AppWorkspaceSession,
  AppWorkspaceSplit,
  CoachFailed,
  CoachIdle,
  CoachReviewed,
  CoachWorking,
  PreviewButton,
  PreviewStopped,
  PreviewTab,
  RewindConfirm,
  RewindConflict,
  RewindDone,
  RewindRunning,
  RunsEmpty,
  RunsList,
  VersionApplied,
  VersionApplying,
  VersionFailed,
} from "./app-space/pages.tsx";

export const appSpaceArea: Area = {
  id: "app-space",
  title: "App workspace",
  summary:
    "앱 workspace. project 창과 같은 shell 안에서 앱 화면 tab, 그 앱의 lophn session tab, App details tab, 오른쪽 Logs panel. Version, Access, Activity, rewind, annotate.",
  pages: [
    {
      id: "app-space",
      title: "App workspace",
      description:
        "앱 workspace를 처음 연 모양. 같은 shell 안에서 가운데 tab은 앱 화면 하나(앱 화면은 고정 그림), 왼쪽은 workspace·session이고 지금 앱 줄 오른쪽 끝 톱니가 App details 탭을 연다. 오른쪽은 Logs panel이고, Annotate는 앱 화면 머리 줄 ⋯ 메뉴에 있다. title bar에 desk 단추가 없다.",
      render: () => <AppWorkspaceScreen />,
    },
    {
      id: "new-app-menu",
      title: "App workspace · ⋯ menu",
      description:
        "앱 화면 탭 머리 줄의 ⋯ 메뉴를 열었다. 맨 위 묶음에 Annotate가 있고(앱이 올린 메뉴 항목이 있으면 그 앞), 구분선 아래가 탭 기본 항목이다.",
      render: () => <AppWorkspaceMenu />,
    },
    {
      id: "app-preview-button",
      title: "App workspace · [Preview]",
      description:
        "그 앱에 preview가 돌고 있을 때만 앱 화면 탭 머리 줄에 [Preview]가 선다. 누르면 사람이 연 preview 탭이 열린다.",
      render: () => <PreviewButton />,
    },
    {
      id: "app-preview-tab",
      title: "App workspace · Preview tab",
      description:
        "preview 탭. 위 한 줄에 preview라는 것, fixture data, 바깥 연결이 대역이라는 것을 적고 [Stop]이 있다. 아래는 앱 view(mode preview) 자리이고 Annotate는 앱 화면 탭과 같이 ⋯ 메뉴에 있다. 보낸 annotation은 release 대신 preview의 bundle hash를 싣는다.",
      render: () => <PreviewTab />,
    },
    {
      id: "app-preview-stopped",
      title: "App workspace · Preview tab (stopped)",
      description:
        "[Stop]을 누르거나 preview가 멈춘 뒤. 탭은 남고 view 대신 한 줄 안내만 있다. 다시 start하면 같은 탭이 새 preview를 load한다.",
      render: () => <PreviewStopped />,
    },
    {
      id: "new-app-split",
      title: "App workspace · app + session",
      description:
        "앱 화면과 그 앱 workspace의 lophn session을 group(좌우) 하나로 붙여 나란히 본다. 새 앱을 만들면 이 모양으로 열린다. 오른쪽 sidebar는 접었다.",
      render: () => <AppWorkspaceSplit />,
    },
    {
      id: "new-app-session",
      title: "App workspace · session tab",
      description:
        "앱 화면 탭과 lophn session 탭이 tab 줄에 따로 서 있고 session 탭을 골랐다. 안의 대화는 project 창 Agent 탭과 같은 component다.",
      render: () => <AppWorkspaceSession />,
    },
    {
      id: "new-app-runs",
      title: "App workspace · Logs",
      description:
        "오른쪽 Logs panel. 이 앱의 Budget reviewer agent run과 Orders tool run이 새것부터 있고 agent run 아래에 그 run이 연 session이 들여 쓰여 있다. tool을 부른 일은 session 줄이 없다. 시각과 상태는 줄 오른쪽 끝에 있고, session 줄을 누르면 그 session이 tab으로 열린다.",
      render: () => <RunsList />,
    },
    {
      id: "new-app-runs-empty",
      title: "App workspace · Logs (empty)",
      description: "이 앱에서 시작된 일이 없을 때 한 줄 안내만 있다.",
      render: () => <RunsEmpty />,
    },
    {
      id: "new-app-version-applied",
      title: "App workspace · Version (applied)",
      description:
        "App details 탭(왼쪽 sidebar 앱 줄의 톱니로 연다) 안에 Icon, Folders 아래 Version, Access, Activity 셋이 있다. Version 탭은 적용된 release, 늘어난 선언과 손실 단계만 보이는 what changes, 이전 release로 돌아가기를 보인다. 돌아가기는 data schema가 같은 release에만 켜지고 나머지는 이유와 함께 꺼진다.",
      render: () => <VersionApplied />,
    },
    {
      id: "new-app-version-applying",
      title: "App workspace · Version (applying)",
      description:
        "사람이 시작하지 않은 activation이 도는 중이다. 접수를 닫고 도는 호출을 기다리는 단계가 보이고 그동안 돌아가기는 꺼진다.",
      render: () => <VersionApplying />,
    },
    {
      id: "new-app-version-failed",
      title: "App workspace · Version (apply failed)",
      description:
        "적용 실패와 이유가 보인다. 이전 release가 그대로 활성이고 이 앱 workspace의 lophn이 이어 받는다는 안내가 있다.",
      render: () => <VersionFailed />,
    },
    {
      id: "new-app-access",
      title: "App workspace · Access",
      description:
        "앱이 activation 때 허락받은 바깥 자원(network host, secret 이름, 파일)과 다른 앱 tool을 보이고 [Revoke]로 거둔다. 예전 Connections 탭을 합쳤고 만들기 단추는 없다.",
      render: () => <AccessGrants />,
    },
    {
      id: "new-app-access-revoking",
      title: "App workspace · Access (revoking)",
      description:
        "거두기를 요청한 뒤다. 요청 접수(새 호출 막힘)와 정리(이전 process 종료 확인 뒤 다시 시작)를 두 단계로 나눠 보인다.",
      render: () => <AccessRevoking />,
    },
    {
      id: "new-app-access-secrets",
      title: "App workspace · Access (secrets)",
      description:
        "Access 탭의 Outside resources 목록에 있는 plain secret 줄 둘이다. 이름 아래에 Not set/Set이 있고 줄 오른쪽 끝에 [Set value]/[Change value], 값이 있는 줄의 [Remove value], [Revoke]가 있다. 값은 보호된 입력 창이 받으므로 여기 그리지 않고, 값과 token은 어디에도 보이지 않는다.",
      render: () => <AccessSecrets />,
    },
    {
      id: "new-app-access-oauth-setup",
      title: "App workspace · Access (OAuth setup)",
      description:
        "OAuth secret 줄의 처음 상태다. 이름 아래에 앱이 선언한 sign-in 곳(host와 scope, 사람이 바꿀 수 없음)이 있고, 왼쪽 선 안에 client id 입력과 [Save], client secret(선택)의 [Set client secret]이 있다. client id가 없어 [Sign in]은 꺼져 있고 이유 글이 줄 아래에 있다. 아래에 plain secret 줄이 섞여 있다.",
      render: () => <AccessOAuthSetup />,
    },
    {
      id: "new-app-access-oauth-ready",
      title: "App workspace · Access (OAuth ready)",
      description:
        "client id와 client secret이 있는 상태다. 각 값 옆에 [Change]가 있고 client id는 값을 보인다(secret은 Set만). [Sign in]이 켜져 있고 누르면 OS browser가 열린다는 안내 한 줄이 있다.",
      render: () => <AccessOAuthReady />,
    },
    {
      id: "new-app-access-oauth-waiting",
      title: "App workspace · Access (OAuth waiting)",
      description:
        "[Sign in]을 눌러 browser가 열린 뒤 상태(in_progress)다. Waiting for you to finish in your browser와 [Cancel]이 있다. 화면은 이 동안 상태를 다시 읽는다.",
      render: () => <AccessOAuthWaiting />,
    },
    {
      id: "new-app-access-oauth-signed-in",
      title: "App workspace · Access (OAuth signed in)",
      description:
        "sign-in이 끝난 상태(signed_in)다. Signed in 표시와 [Sign out], [Sign in again]이 있다. [Sign out]은 보관한 token 셋을 지우고 client id·client secret은 남긴다. token은 보이지 않는다.",
      render: () => <AccessOAuthSignedIn />,
    },
    {
      id: "new-app-access-oauth-failed",
      title: "App workspace · Access (OAuth failed)",
      description:
        "실패 이유 여섯(callback_timeout, state_mismatch, exchange_failed, refresh_rejected, expired, store_failed)을 줄 하나씩 위아래로 쌓았다. 같은 앱에 OAuth secret이 여럿일 때 줄이 어떻게 쌓이는지도 보인다. 이유 글이 상태 자리에 있고, 남은 token을 지우는 [Sign out]과 [Sign in again]이 있다.",
      render: () => <AccessOAuthFailed />,
    },
    {
      id: "new-app-activity",
      title: "App workspace · Activity",
      description:
        "위에 그 앱의 영구 기록(Records: release 켜짐·실패, 앱 멈춤 등, 새것부터)이 있고 아래 호출 기록(Calls)이다. 호출자(사람 화면, agent session 링크, 다른 앱, 앱 시작), project, 효과, 대기와 되돌림됨이 보인다. 지금 release의 live write, external, 앱 시작 행에만 [Rewind from here]가 있고, 행을 펼치면 부른 쪽 session과 tool call, 입력 지문, 결과, 되돌림 기록이 있다.",
      render: () => <ActivityLog />,
    },
    {
      id: "new-app-rewind-confirm",
      title: "App workspace · rewind panel",
      description:
        "Activity 탭 안의 rewind panel이다. 고른 호출부터 최신까지 함께 되돌아갈 목록을 보이고 external은 Won't be undone, 결과를 모르는 write는 Can't be undone으로 표시한다. 그 앱을 쓴 모두의 변경이 함께 사라진다는 안내가 있고 사람이 눌러야 시작한다.",
      render: () => <RewindConfirm />,
    },
    {
      id: "new-app-rewind-running",
      title: "App workspace · rewind in progress",
      description:
        "접수를 닫고 도는 호출을 기다리는 중이다. 그동안 붙잡힌 호출의 안내가 있다.",
      render: () => <RewindRunning />,
    },
    {
      id: "new-app-rewind-done",
      title: "App workspace · rewind done",
      description:
        "성공 결과다. 앱이 고른 시점 직전으로 돌아갔고 열린 앱 화면이 갱신됐다. 되돌아가지 않은 external과 되돌릴 수 없던 write가 구별돼 보인다.",
      render: () => <RewindDone />,
    },
    {
      id: "new-app-rewind-conflict",
      title: "App workspace · rewind cancelled",
      description:
        "충돌로 통째로 취소된 결과다. 아무것도 바뀌지 않았고, 이유와 붙잡았던 호출이 이어졌음이 보인다.",
      render: () => <RewindConflict />,
    },
    {
      id: "new-app-annotate",
      title: "App workspace · annotate (picking)",
      description:
        "앱 화면 탭 머리 줄 ⋯ 메뉴의 Annotate를 골랐다. 머리 줄이 Annotate 줄로 바뀐다: 가운데에 Annotate · 앱 이름과 고르는 법 한 줄, 오른쪽 끝에 모두 지우기(휴지통), [Done], [Send to lophn]. 아직 고른 것이 없어 지우기와 보내기는 꺼져 있다. 화면 옆이나 위에 목록이 없어 고를 요소를 가리지 않는다. 요소를 가리키면 윤곽과 이름표가 뜨고, 고른 요소에 번호와 메모 칸이 붙는다. 영역을 끄는 중인 모양도 있다.",
      render: () => <AnnotatePicking />,
    },
    {
      id: "new-app-annotate-list",
      title: "App workspace · annotate (three picked)",
      description:
        "annotation 셋(요소 둘, 영역 하나)을 모았다. 머리 줄 [Send to lophn] 안에 모은 수 3이 있고 누르면 한 번에 보낸다. 이 앱 workspace의 lophn session 메시지가 된다. 휴지통은 모두 지우고, 하나는 화면 안 메모 칸 아래 줄의 ×로 지운다.",
      render: () => <AnnotateList />,
    },
    {
      id: "coach-idle",
      title: "Coding coach app · before review",
      description:
        "앱이 `@lophn/agent`로 agent와 이야기하는 예(앱이 그린 화면이라 lophn 창은 없다). 사람이 코드 textarea에 코드를 썼고 [Send for review]를 아직 누르지 않았다. session은 첫 보내기 때 열린다.",
      render: () => <CoachIdle />,
    },
    {
      id: "coach-working",
      title: "Coding coach app · reviewing",
      description:
        "앱이 attempt와 코드를 context block으로, 줄 주석 답 꼴을 붙여 보냈고 그 앱 workspace session의 turn이 도는 중이다. 보내기는 꺼진다. 같은 session이 sidebar와 채팅 탭에도 보인다.",
      render: () => <CoachWorking />,
    },
    {
      id: "coach-reviewed",
      title: "Coding coach app · line notes",
      description:
        "turn이 끝나 마지막 agent 메시지의 JSON이 답 꼴 검사를 통과했다. 앱이 그 값으로 textarea 줄 옆 gutter에 표시를 달고 아래에 줄 주석 목록을 그린다.",
      render: () => <CoachReviewed />,
    },
    {
      id: "coach-failed",
      title: "Coding coach app · reply did not fit",
      description:
        "agent 답이 꼴에 맞지 않아 값이 아니라 오류로 나왔다. 앱은 다시 보내기를 보인다.",
      render: () => <CoachFailed />,
    },
  ],
};
