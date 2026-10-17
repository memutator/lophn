# provider-connect-cleanup

옛 길을 지운다. `RegisterProvider`와 `RefreshProviderCredential`의 `preparation`, provider가 쓰던 keychain 코드(secret 참조 통로, 참조 대조, `reclaim`·`sweep`)를 지운다. MCP OAuth vault와 coding token이 쓰는 keychain 코드는 남긴다.

- 단위: provider-connect (wave 1)
- 선행: provider-connect-handler, provider-connect-attach, provider-connect-shell. 새 길(handler, attach, shell)이 다 들어간 뒤에만 옛 길의 마지막 쓰는 곳이 없어진다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/register.ts`(`commands.register`와 `createProviderSecretRefSource` 줄만. 계획 `agent-place`도 이 file을 고쳐 `status.py`가 동시에 띄우지 않는다)
  - `packages/protocol/lophn-agent/provider-inputs.ts`
  - `packages/protocol/lophn-agent/providers.ts`
  - `packages/core/lophn-agent/providers/commands.ts`
  - `packages/core/lophn-agent/providers/secret-refs.ts`
  - `packages/core/lophn-agent/providers/mod.ts`
  - `packages/core/secrets/store.ts`
  - `packages/core/main/daemon/runtime.ts`(provider `reclaim` 설정과 `sweep` 호출, `PROVIDER_SECRET_OWNER` import만)
- 읽을 것:
  - 이슈: `project-docs/issues/platform.md`의 "API key로 provider를 연결해도 쓸 수 있는 provider가 생기지 않는다"의 "`RegisterProvider`의 `preparation`과 provider가 쓰던 옛 keychain 코드는 지운다"
  - architecture: `project-docs/architecture/agent-definition.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `providers`, `secrets`, `project-docs/module-catalog.yaml`의 `packages/core/secrets`, `packages/core/lophn-agent`
  - test: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `providerSecretDestination`(남는다), `providerSecretDestinations`(`provider-connect-attach`가 냈다), `providers/connect`(`provider-connect-handler`가 냈다)
  - 내놓는 것: `protocol/lophn-agent`에 `registerProvider`, `registerProviderInputSchema`가 없다. `refreshProviderCredential` 입력은 `{provider, expires_at, unavailable_reason}`이고 성공은 `expires_at !== null`(`unavailable_reason`과 정확히 하나)이다. `PROVIDER_ROUTES`에 `connectProvider`가 들어가지 않는 것은 그대로다(`registry.ts`가 따로 넣는다).

## 지킬 것(계획 README "지켜야 할 것")

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- protocol을 바꾸면 쓰는 쪽(shell, coding agent CLI)을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- secret 값은 보호 메모리와 전송 직전 attach 밖으로 나가지 않는다(log, event, ledger, model 입력 금지).

## 남기는 keychain 코드(지우지 않는다)

provider 말고 쓰는 곳이 있다. 아래는 건드리지 않는다.

- `packages/core/secrets/{attach,adapters/*,preparations,commands,reads,refs,schema,model}.ts`와 `store.ts`의 나머지(참조 등록·회수): MCP credential(`SetSecret`/`RemoveSecret`, ledger `secrets` 표, `lophn-agent/extensions/secret-refs.ts`의 `lookupMcpSecretUse`·`createMcpSecretRefSource`)과 MCP OAuth token vault(`extensions/mcp-oauth-vault.ts`, `mcp-auth-control.ts`)가 쓴다.
- `createSecretAttach`(keychain 대조): `run-loop/runtime-secret.ts`의 MCP 길이 쓴다.
- `KeychainAdapter`, `productKeychain`, `codingKeychain`(`main/daemon/main.ts`, `core.ts`): coding agent와 MCP OAuth가 쓴다.
- `SecretPurpose`의 `provider_credential`: `createFileSecretAttach`가 purpose로 쓴다.

## 할 일

1. `protocol/lophn-agent/providers.ts`에서 `registerProvider`를 지우고 `PROVIDER_ROUTES`에서 뺀다. `provider-inputs.ts`에서 `registerProviderInputSchema`와, 그것만 쓰던 `secretPreparationInputSchema` import를 지운다(`refreshProviderCredentialInputSchema`가 아직 쓰면 다음 줄에서 같이 정리한다). 근거: 이슈 "`RegisterProvider`는 api_key의 값 참조를 옛 `credential.preparation.sealed_ref`로만 받는다. 그 준비를 만드는 코드는 지워졌다". 쓰는 쪽(shell)은 `provider-connect-shell`이 이미 `connect`로 옮겼다. `grep -rn "registerProvider\|RegisterProvider\|providers/register" packages tools`로 마지막 쓰는 곳이 없음을 먼저 확인한다.
2. `refreshProviderCredentialInputSchema`에서 `preparation`을 지우고 refine을 `(expires_at === null) === (unavailable_reason !== null)`로 바꾼다. `providers/commands.ts`의 `refreshCredential`은 성공 분기를 `secret_ref`를 건드리지 않고 `expires_at`, `refreshed_at`, `state: "available"`만 갱신하게 한다. 근거: 이 route의 호출자가 지금 없고(`grep -rn "refreshProviderCredential" packages`), `preparation`은 옛 sealed_ref를 위한 칸이다. OAuth refresh를 다시 잇는 일은 이 계획 밖이다.
3. `providers/commands.ts`에서 `register`와 `createProviderCommands` 반환 type의 `register`, `insertCredential`/`secretNameForProvider` 중 안 쓰는 것을 지운다(`connect`가 쓰는 것은 남긴다).
4. `providers/secret-refs.ts`에서 `createProviderSecretRefSource`, `lookupProviderSecretUse`, `PROVIDER_SECRET_OWNER`를 지운다. `providerSecretDestination`, `providerSecretDestinations`는 남긴다. 파일 머리 주석을 "provider endpoint가 credential을 받을 수 있는 고정 목적지" 하나로 고친다. `providers/mod.ts`의 export를 맞춘다.
5. `main/daemon/runtime.ts`에서 `openSecretStore({... reclaim: {...}})`의 `reclaim`과 `await secretStore.sweep({ immediate: true })`와 `PROVIDER_SECRET_OWNER` import를 지운다. `secrets/store.ts`에서 `reclaim` 옵션, `sweep`(+ `sweepMs`, `sweeping` timer, `reclaimOwners`)과 그 type을 지운다. 근거: `reclaim`은 provider 값만 지우던 일이고 `grep -rn "reclaim\|\.sweep(" packages/core/secrets packages/core/main`에서 쓰는 곳이 `runtime.ts` 하나다. 참조 등록·회수와 `SetSecret`/`RemoveSecret`용 코드는 남긴다.
6. 넘길 줄(남의 file을 최소로 맞춘다): `packages/core/lophn-agent/register.ts`(계획 `agent-place`의 file)의 `commands.register` 한 줄과 `createProviderSecretRefSource`의 import·`secretRefs` 항목 한 줄을 지운다. 이 둘이 없으면 컴파일이 안 된다. 다른 줄은 건드리지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지우는 일이다. 값 경계는 `provider-connect-attach`의 test가 본다. 지우는 test가 지키던 권한 경계는 없음을 확인했다: `file-store_test.ts`는 그대로다)
- 남지 않음:
  - `grep -rn "registerProvider\|RegisterProvider\|PROVIDER_SECRET_OWNER\|createProviderSecretRefSource\|lookupProviderSecretUse" packages tools`가 0줄이다.
  - `grep -rn "preparation" packages/core/lophn-agent/providers packages/protocol/lophn-agent/provider-inputs.ts packages/protocol/lophn-agent/providers.ts`가 0줄이다.
  - `grep -rn "reclaim" packages/core/secrets packages/core/main/daemon/runtime.ts`가 0줄이다.
  - 옛 keychain attach: `grep -n "createSecretAttach" packages/core/lophn-agent/run-loop/runtime-secret.ts`는 MCP 길 한 곳만 남는다(provider 분기가 없다).
- 실제 provider를 부르지 않는다. 새 E2E·subprocess·서버 test를 쓰지 않는다. core를 띄워 손으로 확인하는 일은 이 계획에 없다. 확인은 unit test와 `deno task check`까지다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`protocol/lophn-agent/registry.ts`는 `PROVIDER_ROUTES`를 펼치므로 그대로다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것
- 넘길 줄: `register.ts` 두 곳
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: OAuth credential 저장·갱신 길은 없다(이 계획 밖).
