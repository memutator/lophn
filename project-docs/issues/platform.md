# platform

config, diagnostics, storage, server, supervision 같은 바닥 module. 이 주제의 architecture 문서는 없다.

## events 점검이 Reactor backoff를 보지 못한다

```yaml
kind: bug
modules: [packages/core/main, packages/core/events]
```

지금: `core/main/daemon/wiring/events.ts`의 `events` 점검은 연결이 열려 있고 `start` 뒤인지, `events` 표를 한 번 읽을 수 있는지만 본다. `ReactorRunner`에 상태를 내는 칸이 없어 handler가 실패해 backoff 중이어도 `available`이다. 두 점검 모두 마지막 응답 시각은 보지 않는다.

영향: reaction이 멈춰 있어도 Diagnostics는 정상으로 보인다.

고치려면: `ReactorRunner`에 마지막 성공 시각이나 backoff 여부를 내는 읽기를 더하고 점검이 본다(작음). 필요해질 때 한다.

## provider OAuth 로그인 길은 있지만 그 credential로 model을 부르는 길이 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/protocol, packages/shell/renderer]
```

지금: provider 정의의 `auth_kinds`에 `oauth`가 있고(`packages/protocol/lophn-agent/provider-values.ts`), core에 로그인 흐름(`packages/core/lophn-agent/providers/oauth.ts`, `providers/login.ts`)이, 설정 화면에 `signIn`(`settings/providers/core-source.ts`)이 있다. 그러나 붙여 넣기 창을 여는 `settings/core-call.ts`의 `windowSecretOpener`가 preload에 없는 `lophnShell.openConfirmation`을 찾아 창이 열리지 않고(preload는 `openSecretInput`만 낸다), agent runtime의 secret 전달(`run-loop/runtime-secret.ts`)은 `provider.`·`mcp.`·`mcp-oauth.` 이름만 보낸다. OAuth token이 model 호출에 실리는 길이 없다.

영향: 사람이 구독 계정(OAuth)으로 provider를 연결할 수 없다. 화면에는 sign in 단추가 보인다.

고치려면:
- 살린다(큼): 붙여 넣기 창을 `openSecretInput` 길로 고치고, token을 `secrets.json`에 두고, runtime이 provider 호출에 token을 싣고 갱신(`RefreshProviderCredential`)을 잇는다.
- 지운다(중간): OAuth 정의와 로그인 흐름, 화면의 sign in을 지운다. API key와 loopback provider만 남는다.
- 추천: 사람이 구독 OAuth를 제품에 둘지 정한 뒤 그대로 한다. 둘 생각이 없으면 지운다.

정할 것: 구독 계정(OAuth) provider 연결을 제품에 둘지.
