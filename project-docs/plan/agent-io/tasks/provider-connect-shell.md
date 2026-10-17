# provider-connect-shell

설정 화면의 API key 연결이 보호 입력 창을 실제로 열고, 값이 `stored`로 올라간 뒤에 `providers/connect`를 부르게 한다. key 없는 custom provider도 `providers/connect`로 옮긴다. 끊을 때 `secrets.json`의 값도 지운다.

- 단위: provider-connect (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/lophn-space/settings/core-call.ts`
  - `packages/shell/renderer/desktop/lophn-space/settings/providers/core-source.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/platform.md`의 "API key로 provider를 연결해도 쓸 수 있는 provider가 생기지 않는다"(정한 것: 보호 입력 창이 `secrets/put` 뒤에 `ConnectProvider`를 부른다)
  - architecture: `project-docs/architecture/agent-definition.md`(provider 연결)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `providers`, `secrets`, `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/shell/main`
  - 본보기: `packages/shell/ipc/secret-input.ts`(`SecretInputOpen`, `SecretInputOpenReply`: 창을 연 쪽은 `stored`를 받은 뒤에야 그 이름을 가리키는 command를 보낸다), `packages/shell/preload/shell.ts`(`lophnShell.openSecretInput`), `packages/shell/main/secret-input/ipc.ts`(제출은 main이 `secrets/put`으로 올린다)
  - test: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `window.lophnShell.openSecretInput({name, purpose: "provider", subject})` → `{ok: true, result: "stored" | "cancelled"}` 또는 `{ok: false, code}`(`ipc/secret-input.ts`, 고정), core `providers/connect`(`connectProviderInputSchema`, 이미 protocol에 있다. 입력은 `{id, name, definition, endpoint, protocol, auth_kind, credential: {secret} | null}`), core memory route `secrets/delete {name}`(user)
  - 내놓는 것: `ProviderSettingsSource`의 모양은 그대로다(`connect`, `registerCustom`, `disconnect`는 `WindowOutcome`/`SourceResult<null>`). secret 이름은 `provider.<id에서 "pvd_"를 뗀 것>`이다. `provider-connect-handler`의 `ConnectProvider`가 같은 규칙으로 이름을 검사하므로 어긋나면 `invalid_input`이다.

## 지킬 것(계획 README "지켜야 할 것")

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- protocol을 바꾸면 쓰는 쪽(shell, coding agent CLI)을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- secret 값은 보호 메모리와 전송 직전 attach 밖으로 나가지 않는다(log, event, ledger, model 입력 금지). renderer는 값을 만지지 않는다. 이름과 창 결과만 다룬다.

## 할 일

1. `core-call.ts`: 보호 입력 창 열기를 하나 더한다. `windowSecretInputOpener()`는 `lophnShell.openSecretInput`을 돌려주고(없는 창에서는 undefined), `enterSecret(open, {name, purpose, subject}): Promise<SourceResult<"stored" | "cancelled">>`는 reply를 `SourceResult`로 옮긴다(`ok: false`의 code는 그대로). 근거: 지금 `windowSecretOpener`는 preload에 없는 `openConfirmation`을 읽어 창이 늘 열리지 않는다(`unavailable`). `ipc/secret-input.ts`는 shell 쪽 고정 계약이라 이쪽을 맞춘다. `subject`는 창에 보일 provider 이름이다(제어 문자 없음, 80자 이하여야 하므로 자르고 제어 문자를 뺀다).
2. `windowSecretOpener`, `openProtected`, `SecretIntent`는 지우지 않는다. 쓰는 곳이 남아 있다: OAuth 로그인의 붙여 넣기 창(`providers/core-source.ts`의 `signIn`)과 MCP credential 입력(`settings/core-source.ts`, `settings/agents/core-source.ts`). 이것들은 같은 이유로 이미 안 열린다. 이 task는 고치지 않는다("알려진 미완 동작"에 적는다).
3. `providers/core-source.ts`의 API key 연결(`connect`의 api_key 길과 `registerCustom`의 `withKey` 길)을 바꾼다: `id = idFor(...)`, `secret = "provider." + id.slice("pvd_".length)` → `enterSecret(...)` → `result === "stored"`면 `command(core, "providers", "connect", {input: {id, name, definition, endpoint, protocol, auth_kind: "api_key", credential: {secret}}, key: "provider-connect-<random>"})`. `cancelled`면 아무것도 부르지 않고 `{ok: true, value: null}`. `connect`가 실패하면 올라간 값을 `call(core, "memory", "secrets", "delete", {name: secret})`로 best-effort 지우고(결과는 무시) 그 실패를 돌려준다. 근거: 이슈 "고치려면"과 `SecretInputOpenReply`의 설명. `connectIntent`의 api_key 쓰임은 없어진다. OAuth용 `builtinConnect(definition, "oauth", login)`은 남기고, `signIn`이 `builtinConnect(definition, "api_key") === null`로 endpoint를 점검하는 줄은 그 점검만 하도록 맞춘다.
4. key 없는 custom(`registerCustom`의 `!withKey`)은 `providers/register` 대신 `providers/connect`로 보낸다: `auth_kind: "none"`, `credential: null`. 근거: `RegisterProvider`는 `provider-connect-cleanup`이 지운다. 이 호출이 마지막 쓰는 곳이다(`grep -rn '"register"' packages/shell`로 확인한다).
5. `disconnect`: `DisconnectProvider`가 성공하면 `secrets/delete`로 `provider.<id>` 값을 best-effort로 지운다(결과 무시). 근거: 옛 reclaim sweep(`provider-connect-cleanup`이 지운다)이 하던 일이 이제 이 호출뿐이다.
6. `main/secret-input/submit.ts`와 `submit_test.ts`는 바꾸지 않는다(제출은 `secrets/put`으로 값만 올리고, `ConnectProvider`는 창을 연 renderer가 `stored` 뒤에 보낸다). 사람이 이 task를 보고 main에서 부르게 바꿔야 한다고 판단하면 고치지 말고 "계약 바꾸기 요청"에 적는다.

## 끝남

- `deno task check`가 통과한다.
- renderer build가 된다: `deno run -A packages/shell/renderer/build.ts`(`check:full`은 이 build를 안 본다).
- 위험 test: 없음(화면 쪽 흐름이고 값은 이 파일을 지나지 않는다. secret 경계는 main의 `submit_test.ts`와 core가 본다)
- 남지 않음: `grep -rn "credential: { kind: \"none\", preparation" packages/shell`가 0줄이다. `grep -rn "\"register\"" packages/shell/renderer/desktop/lophn-space/settings/providers`가 0줄이다.
- 실제 provider를 부르지 않는다. 새 E2E·subprocess·서버 test를 쓰지 않는다. core나 app을 띄워 손으로 확인하는 일은 이 계획에 없다. 확인은 unit test와 `deno task check`까지다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: OAuth 로그인의 붙여 넣기 창과 MCP credential 입력 창은 `windowSecretOpener`가 없는 `openConfirmation`을 읽어 열리지 않는다(이 task가 고치지 않는다. lead가 이슈로 올릴 것). `connect`가 성공했는데 `secrets/delete` 정리가 실패하면 쓰이지 않는 값이 `secrets.json`에 남는다.
