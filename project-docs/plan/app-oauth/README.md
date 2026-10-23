# app-oauth: 앱 secret에 OAuth를 열고 사람이 앱 secret을 넣는 화면을 둔다

- **목표:** 앱이 Google Drive 같은 OAuth 서비스를 쓸 수 있게 한다.
  - 사람이 앱 화면에서 앱 secret을 넣는다. 지금은 넣는 화면이 없다.
  - 앱이 선언한 secret에 OAuth를 둘 수 있다. 사람이 그 화면에서 sign-in하고, core가 token을 refresh한다. 앱은 지금처럼 token을 보지 못하고 Bearer가 붙은 요청만 보낸다.
  - 앱의 `netFetch`가 요청 본문과 header를 보낸다. 파일 올리기(Drive upload)에 필요하다.
- **재료:**
  - roadmap `project-docs/products/roadmap/headless-schedule.md`(gdrive, 끝남 기준)
  - architecture `app-call.md`(secret과 목적지, cap-net, "다른 인증 꼴은 앱이 필요할 때 더한다"), `agent-definition.md`(secret 저장소의 이름 공간, refresh token은 core 밖으로 나가지 않는다, issuer 호출 줄), `activation.md`(넓어진 선언은 사람의 동의)
  - 코드:
    - 앱 secret 길: `packages/sdk/cap-secret`, `packages/core/apps/permissions/broker/secrets.ts`, `packages/core/main/app-supervisor/secret-delivery.ts`, `packages/core/apps/permissions/secret-value.ts`, `packages/core/secrets/file-attach.ts`(`purposeOf`)
    - 네트워크: `packages/sdk/cap-net/fetch.ts`, `packages/core/apps/permissions/broker/net-fetch.ts`, `packages/protocol/apps/broker.ts`
    - OAuth: `packages/core/lophn-agent/extensions/mcp-auth.ts`(PKCE, loopback, 교환, refresh), `mcp-oauth-vault.ts`, `mcp-oauth.ts`, `mcp-auth-control.ts`(`openCallbackListener`), `packages/core/lophn-agent/issuer-requests.ts`(issuer 줄), provider OAuth `packages/core/lophn-agent/providers/oauth-refresh.ts`(refresh 실패 다루기)
    - 화면: 보호된 입력 창(`packages/shell/ipc/secret-input.ts`, `purpose: "app"`이 있지만 부르는 곳이 없다), 앱 Access 탭(`packages/shell/renderer/app-frame/app-detail/access/access-tab.tsx`)
  - `project-docs/boundary-catalog.yaml`, `project-docs/module-catalog.yaml`
- **범위 밖:**
  - MCP OAuth의 sign-in 단추, discovery, dynamic client registration. 이슈로 남긴다(지금 MCP server form에 oauth2 선택이 없고 sign-in 단추도 없다).
  - Google만을 위한 code. OAuth는 표준 authorization code + PKCE로 일반으로 연다. Google에 맞춘 것은 선언의 추가 authorize parameter(`access_type=offline`, `prompt=consent`)뿐이다.
  - gdrive 앱 자체. App Engineer가 이 계획 뒤에 짓는다.
  - 앱마다 secret 이름 공간 나누기. 지금처럼 앱 secret 이름은 전역이다(같은 이름을 선언한 두 앱은 같은 값을 쓴다).
  - 진짜 Google로 하는 test. lead가 사람에게 손으로 한 번 해 달라고 한다.
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `ao-`로 시작한다.
- **시작 조건:** 없다. 다른 열린 계획과 겹칠 file은 `status.py ready`가 거른다. 계획 `blueprint-remove`는 이 계획이 land한 뒤에 시작한다(같은 선언 file을 고친다).

## 정한 것

agent(planner)가 정했다. 근거는 줄마다 적는다. 사람에게 보일 때 바뀌면 고친다.

선언
- **OAuth는 앱 선언의 `secret.use` 칸에 둔다.** `oauth: {authorization_endpoint, token_endpoint, scopes, params?}`(선택). 끝점은 https만 받는다. 개발과 test를 위해 loopback http도 받는다(provider OAuth와 같다).
- **OAuth 칸이 바뀌면 넓어진 선언이다.** 지금 선언 비교는 scope 전체를 정규화해 맞추므로 끝점이나 scope가 바뀌면 activation 동의를 다시 묻는다(`activation.md`). 동의 화면의 자원 이름(`resourceLabel`)에 OAuth 끝점의 host와 scope를 싣는다.
- API host(예: `www.googleapis.com:443`)는 지금처럼 `net.fetch` 선언과 grant가 따로 있어야 한다. token 끝점은 core가 issuer 줄로 부르므로 앱의 `net.fetch`가 필요 없다.

client
- **client id와 client secret은 사람이 넣는다.** Google 같은 곳은 자동 등록이 없어 사람이 그 서비스에 OAuth client를 만들어야 한다. lophn이 자기 client를 들고 다니려면 그 서비스의 심사를 받아야 해서 지금은 하지 않는다.
- client id는 보통 글로, client secret은 보호된 입력 창(`purpose: "app"`)으로 넣는다. 둘 다 앱 Access 탭의 그 secret 줄에서 넣는다.

화면
- **앱 Access 탭의 secret 줄에서 값을 넣는다.** 지금은 이름과 [Revoke]뿐이다.
  - OAuth가 없는 secret: [Set value]가 보호된 입력 창을 연다. 지금 test만 하던 일을 사람이 한다.
  - OAuth secret: client id, [Set client secret], [Sign in], 상태(none, in_progress, signed_in, failed와 이유)를 보인다.
- **sign-in은 사람이 연다.** [Sign in]을 누르면 core가 loopback callback을 열고 authorize URL을 만들고, shell이 OS browser로 연다. core가 background에서 callback을 받아 token으로 바꾸고, 화면은 상태를 다시 읽는다(provider login과 같은 꼴, 막히는 `complete`를 쓰지 않는다).
- 화면 모양은 wireframe으로 정하고 사람이 승인한다. 승인 전에는 화면 task를 띄우지 않는다.

token
- **access token은 선언한 이름 그대로 둔다.** 그래서 broker, 전달, Bearer 붙이기 길이 바뀌지 않는다.
- **refresh token, meta, client secret은 `app-oauth.<이름>.refresh|.meta|.client`에 둔다.** 이 이름 공간은 어디로도 보내지 않는다(`purposeOf`). `provider-oauth.` 이름도 지금 앱 secret으로 분류되는 틈이 있어 같이 막는다.
- **refresh는 core가 값을 보내기 직전에 한다.** 남은 시간이 5분 이하면 refresh한다(앞 줄에서 값을 60초 쥐므로 넉넉히). 이름마다 한 번에 하나다. 네트워크는 issuer 줄이다.
  - 400, 401, `invalid_grant`: access와 refresh를 지우고 상태를 `failed`(다시 sign-in)로 둔다. 앱은 "다시 sign-in이 필요하다"는 오류를 받는다.
  - 닿지 않음이나 5xx: 지금 token이 아직 유효하면 그것을 보낸다. MCP 쪽의 "400 이상이면 모두 버림"을 따르지 않는다. 일시 오류로 sign-in을 잃지 않게 한다(provider refresh와 같다).
- MCP OAuth의 code(PKCE, loopback, 교환, refresh, vault)를 쓰되 MCP에 묶인 것(끝점을 issuer에서 만들기, 이름, client secret을 늘 null로 보내기, 추가 parameter 없음)은 인자로 뺀다. MCP 쪽 동작은 바뀌지 않는다.

네트워크
- **`netFetch`가 요청 본문과 header를 받는다.** 본문은 글이나 bytes이고 10 MiB까지다. header는 앱이 정하되 `Authorization`, `Cookie`, `Host`, `Content-Length`는 받지 않는다(인증은 core가 붙인다). 응답 한도(1 MiB)는 그대로다.

## 위험 test

`write-test` 기준으로 셋만 둔다.
- `app-oauth.*`와 `provider-oauth.*` 이름은 앱을 대신하는 호출에도, 다른 어떤 호출에도 보내지지 않는다(`file-attach`).
- refresh가 거절되면(400·401·`invalid_grant`) access와 refresh가 지워지고 상태가 `failed`가 되며 앱은 값을 받지 못한다. 닿지 않으면 유효한 지금 token을 준다(가짜 issuer와 주입한 시각).
- 앱이 `netFetch`에 `Authorization` header를 실으면 거절된다.

새 e2e는 두지 않는다. `tests/support/fake-oauth`로 위 test를 돈다. 그 밖에 subprocess·Worker·서버를 띄우는 test가 필요하면 사람에게 먼저 묻는다.

## lead가 할 일

- wireframe task가 끝나면 멈추고 사람에게 gallery Drafts를 보여 승인을 받는다. 사람이 볼 것: 앱 Access 탭의 secret 줄(값 넣기, OAuth client, [Sign in], 상태와 실패 이유).
- 화면 task를 merge할 때 `deno run -A packages/shell/renderer/build.ts`를 돈다.
- 손으로 해 볼 것(test로 남기지 않는다): 진짜 Google로 sign-in, refresh, Drive 호출 한 번을 사람에게 해 달라고 한다(Google Cloud의 OAuth client가 필요하다). `tests/support/fake-oauth`에는 authorize 끝점이 없고 `deno task dev`가 띄우지도 않아 sign-in은 가짜로 해 볼 수 없다. refresh 규칙은 위험 test가 가짜 issuer의 refresh grant로 본다. 그때 Google의 "Testing" 상태 앱은 refresh token이 7일 뒤 끊긴다는 것을 SDK guide와 App Engineer가 읽을 글에 적는다(확인한 사실로 적는다).
- MCP OAuth의 빈 곳(sign-in 단추, discovery, 등록, `client_credential`을 읽지 않음)은 이슈로 올린다.
- 다 끝나면:
  - architecture: `app-call.md`(OAuth secret, netFetch 본문과 header), `agent-definition.md`(이름 공간 `app-oauth.`), `activation.md`(OAuth 칸은 넓어진 선언).
  - SDK guide: `packages/sdk/cap-secret/guide.md`, `packages/sdk/cap-net/guide.md`, 앱 선언 SDK의 guide.
  - roadmap `headless-schedule.md`에서 land된 것을 지운다.
  - changelog 열린 판 `project-docs/products/change-log/0.8.0.md`에 항목을 쓴다.
  - 계획 폴더를 지운다.
- 사람에게 묻는 것: AGENTS.md "사람에게 묻는 것" 전부, wireframe 승인, subprocess·Worker·서버·브라우저를 띄우는 새 test. 그 밖은 planner에게 묻는다.
