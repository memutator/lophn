# provider-connect-attach

agent runtime이 provider API key를 `secrets.json`에서 받아 붙이게 한다. 감독 pipe의 `secret_send_request`가 provider에는 이름 기반 `use`(`{name, destination}`)를 싣고, core가 `createFileSecretAttach`로 답하며 목적지는 그 이름을 가진 provider의 endpoint origin 하나다. MCP는 옛 keychain 길을 그대로 쓴다.

- 단위: provider-connect (wave 1)
- 선행: provider-connect-handler. 같은 file(`models/resolve.ts`)을 이어서 고치고, `ProviderCredential.secret_ref`가 `{name}`이 된 모양을 쓴다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/runtime-secret.ts`
  - `packages/core/lophn-agent/models/resolve.ts`(`use`를 만드는 부분)
  - `packages/core/lophn-agent/providers/adapters/auth-transport.ts`
  - `packages/core/lophn-agent/providers/secret-refs.ts`(`providerSecretDestinations`를 더한다. 옛 함수는 지우지 않는다)
  - `packages/core/lophn-agent/providers/secret-refs_test.ts`(새로 만든다)
  - `packages/core/lophn-agent/providers/mod.ts`(새 함수 export 한 줄)
  - `packages/core/main/daemon/wiring/secrets.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`(`createAgentRuntimeSecrets({...})` 호출부만)
  - `packages/core/main/agent-runtime/secret-link.ts`
  - `packages/protocol/supervision/supervision.ts`(`secretSendRequestSchema`의 `use`만)
  - `packages/protocol/secrets/secret-file.ts`(`secretFileUseSchema`, `SecretFileSendInput` export)
- 읽을 것:
  - 이슈: `project-docs/issues/platform.md`의 "API key로 provider를 연결해도 쓸 수 있는 provider가 생기지 않는다"의 "agent runtime의 전송은 옛 keychain에서 읽는다", "allowance가 늘 forbidden, 목적지가 빈 목록"
  - architecture: `project-docs/architecture/agent-definition.md`(provider 호출과 credential)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `providers`(`models` 아래), `secrets`, `run-loop`, `project-docs/module-catalog.yaml`의 `packages/core/secrets`, `packages/core/lophn-agent`
  - 본보기: `packages/core/secrets/file-attach.ts`(순서: machine context → process → allowance → 목적지 비교 → 값 읽기 → transmit), `run-loop/runtime-secret.ts`의 옛 MCP 길(알려진 값 검사 `wholly`까지)
  - test: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `createFileSecretAttach({file, allowance, processes, destinations})`와 `SecretAttachPort`(`secrets/mod.ts`, `protocol/secrets`), `providerSecretDestination(endpoint)`(`providers/secret-refs.ts`), `sameDestination`, `provider-connect-handler`가 내놓은 `credential.secret_ref.name`
  - 내놓는 것:
    - pipe `secret_send_request.use`는 둘 중 하나다: 옛 `secretUseSchema`(`{sealed_ref, revision, purpose, destination}`, MCP) 또는 `secretFileUseSchema`(`{name, destination}`, provider). 이름 칸의 유무로 갈린다.
    - `providerSecretDestinations(sql: Pick<Sql,"all">, name: string): SecretDestination[]`: `provider_credentials.secret_name = name`이고 `state != 'revoked'`인 provider의 `providerSecretDestination(endpoint)` 하나. 모르는 이름, 목적지를 못 만드는 endpoint, revoked는 빈 목록이다.
    - attach의 목적지 규칙: 값은 요청의 `use.destination`이 위 목록의 어느 것과 `sameDestination`(kind와 host:port 같음)일 때만 붙는다. 아니면 `forbidden`이고 값을 읽지도 않는다.
    - allowance 규칙: `purpose === "provider_credential"`이면 ok, `app_secret`이면 `forbidden`(앱 secret은 아직 소유 concern이 없다).

## 지킬 것(계획 README "지켜야 할 것")

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- protocol을 바꾸면 쓰는 쪽(shell, coding agent CLI)을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- secret 값은 보호 메모리와 전송 직전 attach 밖으로 나가지 않는다(log, event, ledger, model 입력 금지).

## 할 일

1. `protocol/secrets/secret-file.ts`: `secretFileUseSchema`와 `SecretFileSendInput` 타입을 export한다. 근거: pipe 요청과 child의 attach가 같은 모양을 써야 한다.
2. `protocol/supervision/supervision.ts`: `secretSendRequestSchema.use`를 `z.union([secretUseSchema, secretFileUseSchema])`로 바꾼다. 위 주석의 "secret 참조·판·용도·목적지"를 맞춘다. 근거: provider는 이름, MCP는 옛 참조를 싣는다. 쓰는 쪽은 아래 3, 4, 6이다.
3. `providers/adapters/auth-transport.ts`: `createAuthTransport`의 `use`를 `SecretFileSendInput["use"]`로 받고, `SecretAttachLike.send`의 `input`을 `SecretSendInput | SecretFileSendInput`으로 넓힌다(MCP의 `McpSecretAttach`가 옛 모양만 받는 함수를 넘겨도 컴파일되어야 한다. 아니면 MCP 쪽 type을 건드리지 말고 `SecretAttachLike`를 오버로드 없이 합집합 입력으로만 둔다).
4. `models/resolve.ts`: `use`를 `{ name: credential.secret_ref.name, destination }`로 바꾼다(`sealed_ref`, `revision`, `purpose` 칸을 뺀다). `main/agent-runtime/secret-link.ts`는 `input.use`를 그대로 pipe에 싣는 줄이 새 type에서 컴파일되게 맞춘다.
5. `providers/secret-refs.ts`에 `providerSecretDestinations`를 더하고 `providers/mod.ts`에서 내보낸다. 옛 `createProviderSecretRefSource`, `lookupProviderSecretUse`, `PROVIDER_SECRET_OWNER`는 두고 `provider-connect-cleanup`이 지운다.
6. `main/daemon/wiring/secrets.ts`: `ctx.provide("secretAttach", createFileSecretAttach({...}))`를 채운다. `allowance`는 위 규칙, `destinations.allowed(name)`는 `ctx.ledgerPath`의 ledger를 `openConnection`으로 열어(`runtime-secret.ts`의 `lookupCurrent`와 같은 모양) `providerSecretDestinations`를 부르고 닫는다, `processes`는 `ctx.peek.io?.observation(context.conditions.process).available === true`(`lophn-agent-runtime.ts`의 componentChecks와 같은 읽기)이다. 맨 위 주석("allowance·process·목적지가 context에 아직 없어 모두 거절")을 지운다. 근거: 이슈의 "allowance가 늘 forbidden, 목적지가 빈 목록". 추천안이다. `processes`가 세대(generation)를 못 구별해 문제가 되면 대신 `runtime-secret.ts`가 `alive`를 `processes`로 넘기는 attach를 호출마다 만들게 하고 `file`을 wiring에서 넘기는 쪽으로 바꿔도 된다. 그때는 이유를 "정한 것"에 적는다.
7. `run-loop/runtime-secret.ts`: `createAgentRuntimeSecrets`가 `fileAttach: SecretAttachPort`를 받는다. `answer`는 `use`에 `name`이 있으면 `deps.fileAttach.send({context, use, operation, body: {url, method}}, transmit)`로 값을 한 번 받고, 없으면 옛 MCP 길(keychain `createSecretAttach`)을 그대로 쓴다. 옛 길의 `references.current`에서 `lookupProviderSecretUse` 호출과 `provider_credential` allowance 분기를 지운다(MCP 전용이 된다). 값을 받은 뒤의 `wholly(known, text)` 검사와 오류 code 정리는 두 길이 공유한다. `lophn-agent-runtime.ts`는 `fileAttach: ctx.secretAttach`를 넘긴다. 근거: 알려진 값 registry(`ctx.knownSecrets`는 `secrets.json` 값과 옛 keychain 값을 모두 안다)가 모르는 값은 child로 보내지 않는다.
8. test 하나(아래).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "attach는 허락한 provider host가 아닌 목적지에 값을 붙이지 않는다." `providers/secret-refs_test.ts`에 한 개(표로): 가짜 sql(`all`이 provider 행을 돌려준다)과 가짜 file(`get`이 값을 돌려주고 호출 여부를 센다), `providerSecretDestinations`로 만든 `destinations`를 `createFileSecretAttach`에 끼워, (a) endpoint와 다른 origin, (b) 모르는 secret 이름, (c) revoked credential, (d) loopback이 아닌 `http` endpoint는 `transmit`이 불리지 않고 `forbidden`이며, (e) endpoint origin과 같은 `use.destination`만 `transmit`에 값이 간다.
- 남지 않음: `grep -n "lookupProviderSecretUse" packages/core/lophn-agent/run-loop/runtime-secret.ts`가 0줄이다. `grep -n "sealed_ref" packages/core/lophn-agent/models/resolve.ts`가 0줄이다.
- 실제 provider를 부르지 않는다. 새 E2E·subprocess·서버 test를 쓰지 않는다. core를 띄워 손으로 확인하는 일은 이 계획에 없다. 확인은 unit test와 `deno task check`까지다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`ctx.secretAttach`는 이미 있는 port다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): `lookupProviderSecretUse`(이제 `runtime-secret.ts`가 안 쓴다. `provider-connect-cleanup`이 지운다)
- 정한 것: `processes`를 어떻게 구했는지
- 넘길 줄: `lophn-agent-runtime.ts`(계획 `agent-place`가 `placeFolders` 때문에 같은 file을 고칠 수 있다)
- 계약 바꾸기 요청: `run-loop/runtime.ts`의 `AgentRuntimeDeps.secrets`는 type이 그대로라 바꾸지 않는다. 바꿔야 하면 고치지 말고 여기 적는다.
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: OAuth credential은 여전히 model 호출에 못 쓴다(`models/resolve.ts`가 `api_key`와 `none` 밖을 거절). 앱 secret의 allowance는 `forbidden`이다.
