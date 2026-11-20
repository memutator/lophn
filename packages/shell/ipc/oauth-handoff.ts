// 다른 컴퓨터의 loopback OAuth 로그인(`callback_mode: remote_handoff`)을 이 컴퓨터의 browser에서 마쳤을 때
// 돌아오는 `http://127.0.0.1:<port>/...`·`http://localhost:<port>/...` callback을 잠시 받아 renderer로 넘기는 IPC다.
// renderer가 받은 주소는 대상 컴퓨터 core의 `*/callback`으로만 전달하고, token 교환과 저장은 대상 컴퓨터가 한다.
// 이 파일은 main·preload·renderer가 함께 부르므로 import가 없다.

export const OAUTH_HANDOFF_CHANNEL = "shell:oauth-handoff";

export type OAuthHandoffRequest =
  | {
      readonly action: "start";
      readonly id: string;
      readonly redirectUri: string;
      readonly state: string;
    }
  | {
      readonly action: "wait";
      readonly id: string;
    }
  | {
      readonly action: "cancel";
      readonly id: string;
    };

export type OAuthHandoffReply =
  | { readonly ok: true; readonly callbackUrl?: string }
  | {
      readonly ok: false;
      readonly code:
        | "forbidden"
        | "invalid_input"
        | "conflict"
        | "cancelled"
        | "unavailable";
    };

export interface OAuthHandoffApi {
  oauthHandoff(request: OAuthHandoffRequest): Promise<OAuthHandoffReply>;
}
