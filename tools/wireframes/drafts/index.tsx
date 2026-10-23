import type { Area } from "../pages/types.ts";
import {
  AccessOAuthFailed,
  AccessOAuthReady,
  AccessOAuthSetup,
  AccessOAuthSignedIn,
  AccessOAuthWaiting,
  AccessSecrets,
} from "./app-oauth/pages.tsx";

export const draftsArea: Area = {
  id: "experiments",
  title: "Experiments",
  summary:
    "승인 전 실험. renderer에 같은 component가 아직 없는 모양을 먼저 그려 본다.",
  pages: [
    {
      id: "draft-app-access-secrets",
      title: "App Access · secrets",
      description:
        "앱 Access 탭의 Outside resources 목록에 있는 plain secret 줄 둘이다. 이름 아래에 Not set/Set이 있고 줄 오른쪽 끝에 [Set value]/[Change value]와 [Revoke]가 있다. 값은 보호된 입력 창이 받으므로 여기 그리지 않고, 값과 token은 어디에도 보이지 않는다.",
      render: () => <AccessSecrets />,
    },
    {
      id: "draft-app-access-oauth-setup",
      title: "App Access · OAuth setup",
      description:
        "OAuth secret 줄의 처음 상태다. 이름 아래에 앱이 선언한 sign-in 곳(host와 scope, 사람이 바꿀 수 없음)이 있고, client id 입력과 [Save], client secret(선택)의 [Set client secret]이 있다. client id가 없어 [Sign in]은 꺼져 있고 이유 글이 줄 아래에 있다. 아래에 plain secret 줄을 섞어 같은 목록에서 어떻게 보이는지 본다.",
      render: () => <AccessOAuthSetup />,
    },
    {
      id: "draft-app-access-oauth-ready",
      title: "App Access · OAuth ready",
      description:
        "client id와 client secret이 있는 상태다. 각 값 옆에 [Change]가 있고 client id는 값을 보인다(secret은 Set만). [Sign in]이 켜져 있고 누르면 OS browser가 열린다는 안내 한 줄이 있다.",
      render: () => <AccessOAuthReady />,
    },
    {
      id: "draft-app-access-oauth-waiting",
      title: "App Access · OAuth waiting",
      description:
        "[Sign in]을 눌러 browser가 열린 뒤 상태(in_progress)다. Waiting for you to finish in your browser와 [Cancel]이 있다.",
      render: () => <AccessOAuthWaiting />,
    },
    {
      id: "draft-app-access-oauth-signed-in",
      title: "App Access · OAuth signed in",
      description:
        "sign-in이 끝난 상태(signed_in)다. Signed in 표시와 [Sign in again]이 있다. token은 보이지 않는다.",
      render: () => <AccessOAuthSignedIn />,
    },
    {
      id: "draft-app-access-oauth-failed",
      title: "App Access · OAuth failed",
      description:
        "실패 이유 여섯(callback_timeout, state_mismatch, exchange_failed, refresh_rejected, expired, store_failed)을 줄 하나씩 위아래로 쌓았다. 같은 앱에 OAuth secret이 여럿일 때 줄이 어떻게 쌓이는지도 보인다. 이유 글이 상태 자리에 있고 [Sign in again]이 있다.",
      render: () => <AccessOAuthFailed />,
    },
  ],
};
