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

## 설정 화면의 보호 입력 창이 열리지 않아 MCP credential을 넣을 수 없다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/lophn-agent, packages/core/secrets]
```

지금: `packages/shell/renderer/desktop/lophn-space/settings/core-call.ts`의 `windowSecretOpener`가 `lophnShell.openConfirmation`을 찾는데, preload(`packages/shell/preload/shell.ts`)는 `openSecretInput`만 낸다. 그래서 이 opener로 보호 입력 창을 여는 길은 `unavailable`이다. provider API key만 같은 file의 `windowSecretInputOpener`·`enterSecret`(preload의 `openSecretInput`)으로 고쳤다. 이 opener를 쓰는 곳은 셋이다: 전역 MCP credential(`settings/core-source.ts`의 `enterServerCredential`), agent 설정에서 만든 서버의 credential(`settings/agents/core-source.ts`의 `createServer`), provider OAuth 붙여 넣기(`settings/providers/core-source.ts`의 `signIn`, 아래 절). MCP의 `sec:` 참조는 창을 고쳐도 옛 ledger `secrets` 표와 keychain을 보므로 `secrets.json`에 넣은 값을 찾지 못한다(`packages/core/lophn-agent/extensions/secret-refs.ts`의 `lookupMcpSecretUse`, `run-loop/runtime-secret.ts`의 MCP 가지).

영향: 사람이 token이 필요한 MCP server를 붙일 수 없다.

고치려면: MCP credential을 provider와 같은 `secrets.json` 길로 옮긴다. 보호 입력 창은 `windowSecretInputOpener`·`enterSecret`을 쓰고, MCP의 secret 참조를 이름(`{name}`)으로 바꾸고 attach가 file 저장소에서 읽는다(중간). provider 길(`createFileSecretAttach`, `providerSecretDestinations`)의 모양을 따른다. 다 옮기면 `windowSecretOpener`와 그 intent type은 쓰는 곳이 없으니 지운다. 추천: 이 안.

## provider OAuth 로그인 길은 있지만 그 credential로 model을 부르는 길이 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/protocol, packages/shell/renderer]
```

지금: provider 정의의 `auth_kinds`에 `oauth`가 있고(`packages/protocol/lophn-agent/provider-values.ts`), core에 로그인 흐름(`packages/core/lophn-agent/providers/oauth.ts`, `providers/login.ts`)이, 설정 화면에 `signIn`(`settings/providers/core-source.ts`)이 있다. 그러나 붙여 넣기 창은 위 절대로 열리지 않고, agent runtime의 secret 전달(`run-loop/runtime-secret.ts`)에는 provider API key(`secrets.json`) 가지만 있다. OAuth token이 model 호출에 실리는 길이 없다.

영향: 사람이 구독 계정(OAuth)으로 provider를 연결할 수 없다. 화면에는 sign in 단추가 보인다.

고치려면:
- 살린다(큼): 붙여 넣기 창을 `openSecretInput` 길로 고치고, token을 `secrets.json`에 두고, runtime이 provider 호출에 token을 싣고 갱신(`RefreshProviderCredential`)을 잇는다.
- 지운다(중간): OAuth 정의와 로그인 흐름, 화면의 sign in을 지운다. API key와 loopback provider만 남는다.
- 추천: 사람이 구독 OAuth를 제품에 둘지 정한 뒤 그대로 한다. 둘 생각이 없으면 지운다.

정할 것: 구독 계정(OAuth) provider 연결을 제품에 둘지.
