# provider-connect-handler

core에 `ConnectProvider` handler를 둔다. provider credential의 secret 참조를 `{name}` 하나로 줄여(파일 저장소에는 sealed_ref·revision이 없다) 모양을 바꾸고, 그 모양을 읽는 곳(`models/resolve.ts`의 `available()`)을 같이 맞춘다.

- 단위: provider-connect (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/provider-values.ts`
  - `packages/core/lophn-agent/providers/commands.ts`(`connect`를 더한다. `register`는 지우지 않는다)
  - `packages/core/lophn-agent/providers/model.ts`
  - `packages/core/lophn-agent/providers/schema.ts`
  - `packages/core/lophn-agent/providers/commands_test.ts`(새로 만든다)
  - `packages/core/lophn-agent/models/resolve.ts`(`available()`만. `use`를 만드는 줄은 `provider-connect-attach`가 고친다)
- 읽을 것:
  - 이슈: `project-docs/issues/platform.md`의 "API key로 provider를 연결해도 쓸 수 있는 provider가 생기지 않는다"(정한 것: `secrets.json` 길로 끝낸다)
  - architecture: `project-docs/architecture/agent-definition.md`(provider·credential 절)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `providers`(`models` 아래 "model catalog와 provider 연결"), `secrets`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/secrets`
  - 본보기: `providers/commands.ts`의 `register`(같은 일을 옛 `preparation`으로 한다. 입력 검사 → 중복 id → credential → 쓰기 순서와 `requireUser`를 그대로 따른다)
  - test: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `protocol/lophn-agent/providers.ts`의 `connectProvider`(이미 정의되어 있고 `registry.ts`에 들어 있다), `provider-inputs.ts`의 `connectProviderInputSchema`(`{id, name, definition, endpoint, protocol, auth_kind, credential: {secret} | null}`)
  - 내놓는 것(다른 task가 기대는 것):
    - `ProviderCredential.secret_ref`는 `{ name }`이다(`sealed_ref`, `revision` 칸이 없다). `provider_credentials` 표는 `secret_name`만 두고 `secret_sealed_ref`, `secret_revision` 열을 뺀다. check는 `(kind in ('api_key','oauth')) = (secret_name is not null)`.
    - `providers/connect` 결과는 `{ provider: ProviderRecord }`다. 오류: `forbidden`(user가 아님), `conflict`(이미 있는 id), `invalid_input`(secret 이름 규칙 위반, definition 검사 실패).
    - secret 이름 규칙: `credential.secret`은 `provider.<id에서 "pvd_"를 뗀 것>`(기존 `secretNameForProvider`와 같다)이어야 한다. 다른 이름이면 `invalid_input`이다.
    - Connect는 `logged_in_at`을 kind와 상관없이 `tx.now()`로 채운다(`none` 포함). 이것이 "이 연결"의 identity다.

## 지킬 것(계획 README "지켜야 할 것")

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- protocol을 바꾸면 쓰는 쪽(shell, coding agent CLI)을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- secret 값은 보호 메모리와 전송 직전 attach 밖으로 나가지 않는다(log, event, ledger, model 입력 금지). 이 task는 값을 다루지 않는다. 이름만 다룬다.

## 할 일

1. `providers/commands.ts`에 `connect`(`CommandDefinition<typeof connectProvider>`)를 더하고 `createProviderCommands`의 반환에 넣는다. 순서: `requireUser` → `assertDefinition` → 같은 id가 있으면 `conflict` → `credential`이 null이 아니면 이름 규칙 검사 → `assertCredential` → `assertRecord` → insert. credential은 `kind = input.auth_kind`, `secret_ref = credential === null ? null : { name: credential.secret }`, `logged_in_at = tx.now()`, 나머지는 `register`와 같다. 근거: 이슈 "새 길의 `ConnectProvider`는 protocol에만 있고 core handler가 없다", secrets 경계(`secrets`)는 파일 저장소의 이름이 곧 key다. 이름 규칙은 provider가 앱·MCP의 다른 secret 이름을 가리켜 그 값이 provider endpoint로 가는 일을 막는다.
2. `register`는 이 task에서 지우지 않는다(shell이 `provider-connect-shell`에서 `connect`로 옮기고, `provider-connect-cleanup`이 지운다). 옛 길은 옆에 둔다. 단 `register`가 만드는 `secret_ref`는 새 모양에 맞춰 컴파일되어야 한다: `preparation !== null`이면 `{ name: secretNameForProvider(id) }`로 둔다(`sealed_ref`는 버린다).
3. `refreshCredential`의 `secret_ref`도 새 모양으로 맞춘다(`{ name: ... }`). 입력의 `preparation`은 `provider-connect-cleanup`이 지우므로 이 task에서는 그 칸을 읽되 `sealed_ref`를 쓰지 않는다.
4. `providers/schema.ts`의 step을 고친다: `provider_credentials`에서 `secret_sealed_ref`, `secret_revision`을 빼고 check를 위 규칙으로 바꾼다. 새 step을 더하지 않고 기존 step(`lophn-agent.harness-provider.tables`)을 고친다(AGENTS.md "호환성": migration 없음. 개발 data는 지우고 새로 만든다). `insertCredential`/`updateCredential`의 열과 `model.ts`의 `credentialFromRow` select를 맞춘다. 맨 위 주석의 "secret_ref는 참조만 담는다(platform/secrets)"도 맞춘다.
5. `protocol/lophn-agent/provider-values.ts`: `secretRefFields`를 `{ name }`로 줄인다(`providerSecretRefSchema`, `providerSecretRefOutputSchema`). `secretOpaqueRefSchema`, `secretRevisionSchema` import가 안 쓰이면 지운다. 이 protocol 변경의 쓰는 쪽: `models/resolve.ts`(아래), shell renderer는 `credential.kind/state/unavailable_reason`만 읽어 영향이 없다(`grep -rn "secret_ref" packages/shell`로 확인한다).
6. `models/resolve.ts`의 `available()`: "provider가 아직 연결돼 있고 같은 연결인가"를 `current.kind === credential.kind && current.secret_ref?.name === credential.secret_ref?.name && current.logged_in_at === credential.logged_in_at`로 비교한다. 근거: Disconnect 뒤 같은 id로 다시 Connect하면 진행 중이던 turn이 새 연결의 key를 쓰지 않아야 한다. 옛 코드는 sealed_ref가 그 identity였고 이제 `logged_in_at`이 그 자리다(추천: 아니면 credential에 연결 번호 열을 따로 둔다. 가장 단순한 쪽을 골랐다).
7. test 하나(아래).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "`ConnectProvider`가 `provider.<id>`가 아닌 secret 이름을 거절하고 provider row를 남기지 않으며, 맞는 이름이면 `secret_ref.name`이 그 이름인 record를 만든다." `providers/commands_test.ts`에 한 개. handler 하나를 가짜 `Tx`(또는 가벼운 in-memory sql)로 부른다. 가벼운 준비가 없으면 이름 규칙을 `model.ts`의 순수 함수로 빼서 그 함수를 표로 본다.
- 남지 않음: `grep -rn "secret_sealed_ref\|secret_revision" packages/core/lophn-agent/providers/commands.ts packages/core/lophn-agent/providers/model.ts packages/core/lophn-agent/providers/schema.ts`가 0줄이다. (`providers/secret-refs.ts`는 아직 이 열을 읽는다. `provider-connect-attach`와 `provider-connect-cleanup`이 지운다. 이 task에서 건드리지 않는다.)
- 실제 provider를 부르지 않는다. 새 E2E·subprocess·서버 test를 쓰지 않는다. core를 띄워 손으로 확인하는 일은 이 계획에 없다. 확인은 unit test와 `deno task check`까지다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `packages/core/lophn-agent/register.ts`의 `commands: [...]`에 `commands.connect`(lead가 더한다. `register.ts`는 계획 `agent-place`의 file이다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: `available()`의 identity를 `logged_in_at`으로 둔 것, secret 이름 규칙
- 넘길 줄: 없음
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: `providers/secret-refs.ts`가 지운 열을 읽어 core를 띄우면 그 읽기가 `unavailable`이 된다(attach·cleanup task가 지운다). Connect 때 secret이 `secrets.json`에 있는지 확인하지 않는다(없으면 model 호출 때 `not_found`로 막힌다).
