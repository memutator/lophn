# setup-scope

기기가 부를 수 있는 route 목록을 둘로 나눈다: 모든 기기의 목록(지금 그대로)과, 터미널 입력을 허락받은 기기에만 여는 사람의 route 목록(secret, provider·model, 설정 쓰기, agent·project 만들고 고치기). 허락받은 기기가 보낸 확인이 필요한 명령(`providers/disconnect`)은 사람이 확인한 것으로 보고 core가 그 자리에서 확인 handle을 붙인다. 기기가 secret을 넣는 길은 지금의 upload frame(`call`의 `{input, base64}`)이다.

- 단위: setup (wave 1)
- 선행: 없음. device-roster 계획의 `roster-links`가 merge된 뒤에 띄운다(`roster-core`와 같은 `call.ts`, `allowlist.ts`를 고치고, `machines/call`을 받는 길이 있어야 4를 확인할 수 있다. 계획 README).
- 소유(이 task만 고친다):
  - `packages/protocol/remote/allowlist.ts`(목록의 구조와 처음 내용. 같은 wave의 다른 task가 보고한 이름은 lead가 더한다)
  - `packages/core/remote/call.ts`, `packages/core/remote/call_test.ts`(새 file), `packages/core/remote/host_test.ts`
  - `packages/core/main/daemon/wiring/{remote,remote_test}.ts`
  - `project-docs/flows/areas/{core-platform,approvals}.yaml`, `project-docs/flows/tests/core-rest.yaml`
- 읽을 것:
  - 계획 README "정한 것"의 값, 설정을 하는 기기, 사람이 확인했다는 표
  - device-roster 계획 README(`project-docs/plan/device-roster/README.md`)의 "허락은 항목에 있다", "다른 기계를 부르는 길은 core의 route 하나다"
  - architecture: `project-docs/architecture/approval.md` "폰(기기) 자격", "사람 결정 handle", 결정의 shell capability 줄. `project-docs/architecture/remote.md` "지키는 것" 1, 10, "폰 route 목록". `project-docs/architecture/agent-definition.md` 60(값을 넣는 것은 사람뿐)
  - 조사: `reports/multi-device/survey-s2-roster.md` 1.5와 3의 G3, `reports/multi-device/survey-s4-setup-tabs.md` 1.1, 1.4
  - 지금 길: `packages/core/remote/call.ts`(`createDeviceCredentials`, `createRemoteCall`, `uploadRequest`), `packages/core/server/identity/{confirmation,confirmation-binding,confirmation-route}.ts`, `packages/core/server/control/handler.ts`(capability 검사), `packages/core/main/daemon/control.ts`(`register`가 `runtime.confirmation({action: "issue"})`를 부른다), `packages/core/storage/ledger/executor.ts`(command의 확인 예약)
- 계약:
  - 쓰는 것: `ctx.runtime.confirmation({action: "issue", request: ConfirmationHandleRegister})`, `confirmationBinding(route, input)`, `CONFIRMATION_HANDLE_TTL_MS`, 기기마다의 터미널 입력 허락(지금 `createTerminalInputGrants().granted`, `ctx.terminalInputGrant`. `roster-core`가 명단 항목으로 옮긴 뒤의 이름을 merge된 code에서 확인한다)
  - 내놓는 것:
    - `REMOTE_ALLOWED_ROUTES`: 모든 기기의 목록. 이름과 내용은 그대로다.
    - `REMOTE_PERSON_ROUTES`(새, `allowlist.ts`): 허락받은 기기에만 여는 목록. 두 목록은 겹치지 않는다.
    - 기기 자격의 scope는 두 목록의 합이다(writer가 command scope를 ledger의 자격 기록으로 보므로 사람 route도 자격에 있어야 한다). 거르기는 `createRemoteCall`이 한다: 사람 route인데 그 principal의 허락이 없으면 handler 전에 `forbidden`.
    - `createRemoteCall` deps에 `granted(principal): boolean`과 `confirm(principal, route, input): Promise<Result<ConfirmationRef>>`를 더한다.

## 정한 것

- 사람 route의 처음 내용(모두 actor user인 것만): secret(`secretPut`, `secretDelete`, `secretStatus`), provider(`connectProvider`, `disconnectProvider`, `providerList`, `providerDefinitions`, `refreshProviderModels`, `loginCancel`), model(`changeShownModels`, `shownModelsRead`, `saveUserModelInfo`, `removeUserModelInfo`, `userModelInfoRead`, `modelCatalogRead`, `modelDefaultRead`, `modelDefaultChange`, `workspaceModelRead`, `workspaceModelChange`), 설정(`settingsList`, `settingsUpdate`), agent(`agentCreate`, `agentChange`, `agentDelete`, `agentProfileImageUpload`), project(`projectApi.register`·`edit`·`relinkFolder`·`archive`·`unarchive`과 `projectIdentityApi`의 `identity`·`createIdentity`·`renewIdentity`·`match`). 그 밖에 desktop Settings의 General·Providers·Agents·Tools and skills·Shell rules·Diagnostics 화면(`packages/shell/renderer/desktop/settings/`, `packages/shell/renderer/workspace/agents/`)이 부르는 actor user route를 code에서 찾아 더한다. `connectProvider`와 `projectApi.register`를 넣는 까닭: 새 route(`setup-provider`, `setup-project`)가 부른 사람의 자격으로 이 command를 writer에 보낸다.
- 넣지 않는 것(허락이 있어도): 기기·pairing·명단 관리(`devices/*`, `pairing/*`, `roster-core`가 둔 명단 route), 터미널 입력 허락 바꾸기, `always_on/*`, `machine/rename`, `logins/*`(site login vault는 계획 범위 밖), `sessions/delete`, `sessions/change-skip`, `tabs/*`, `host/*`, `terminal_sessions/*`, `apps/call_tool`, `app_grants/*`, 할당(`assignment` 쓰기), `agent-mcp-auth/*`와 `apps/oauth_*`(그 기계의 loopback으로 돌아오는 로그인이다).
- 확인: 허락받은 기기의 command가 `confirmation: "required"`이면 `createRemoteCall`이 `confirmationBinding(route, body.input)`으로 대상과 내용을 정하고 `confirm`으로 handle을 하나 받아(`window_id`는 `device:<id>`, `allowed_decisions`는 `[route.name]`, 기한은 지금부터 `CONFIRMATION_HANDLE_TTL_MS`) body의 `confirmation`에 싣는다. 기기가 보낸 `confirmation` 값은 버린다. 허락이 없거나 principal이 `device:`가 아니면 `forbidden`이다. file route의 확인은 다루지 않는다(지금 `confirmation: "required"`인 route는 `providers/disconnect` 하나다). 화면이 보내기 전에 사람에게 한 번 묻는 것은 화면의 일이다(`setup-viewer`, `setup-phone`).
- control socket, shell capability, CLI는 바꾸지 않는다. agent와 CLI에는 이 길이 없다: 기기 자격은 handshake한 기기 key로만 생긴다.

## 할 일

1. `allowlist.ts`: 머리 주석을 두 목록으로 고쳐 쓰고 `REMOTE_PERSON_ROUTES`를 둔다(위 내용). `REMOTE_ALLOWED_EVENTS`는 그대로다. `packages/protocol/remote/mod.ts`는 lead의 것이라 새 이름은 `allowlist.ts`에서 바로 import한다.
2. `call.ts`: `createDeviceCredentials`의 scope를 두 목록의 합으로 한다. `createRemoteCall`에서 `authorize` 뒤에 사람 route면 `deps.granted(principal)`를 보고, 확인이 필요한 command면 위 규칙으로 handle을 붙인다.
3. `wiring/remote.ts`: `granted`는 지금의 터미널 입력 허락(명단 항목으로 옮긴 뒤의 것)을, `confirm`은 `ctx.runtime.confirmation({action: "issue", …})`을 준다. 허락이 바뀌면 다음 call부터 반영된다(허락은 call마다 읽는다).
4. 다른 컴퓨터가 `machines/call`로 넘긴 call을 받는 길(device-roster의 `roster-links`, merge되어 있다)이 이 기계에서 같은 `createRemoteCall`(같은 거르기와 확인)을 타는지 code에서 확인한다. 다른 길이면 고치지 말고 보고한다(그 file은 이 task의 소유가 아니다).
5. `packages/core/main/daemon/wiring/acp-send.ts`가 기기 자격으로 안에서 부르는 route가 모두 모든 기기의 목록 안인지 본다. 사람 route가 있으면 고치지 말고 보고한다(그 길은 `createRemoteCall`의 거르기를 지나지 않는다).
6. test와 flows를 고친다(`flows` skill). `host_test.ts`의 "route 목록을 넓힌 뒤에도 … forbidden이고 …" test는 허락 없는 기기의 경우로 남기고 이름을 맞춘다. `remote_test.ts`의 `devices/set_terminal_input` test는 그대로 지킨다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`createRemoteCall`을 가짜 handler·가짜 writer와 실제 `CredentialRegistry`, `ConfirmationRegistry`로 돌린다. `host_test.ts`의 준비를 본보기로 한다):
  - "터미널 입력 허락이 없는 기기는 secret, provider, 설정 쓰기 route를 부르지 못한다": `secrets/put`, `providers/disconnect`, `settings/update`, `agents/create`, `projects/create`를 허락 없는 기기로 부르면 `forbidden`이고 handler·writer에 닿지 않는다. 같은 표를 허락받은 기기로 부르면 handler·writer에 닿고, `providers/disconnect`는 확인을 소비한 채 writer에 닿는다.
  - "agent 자격은 기기의 길로도 secret을 넣거나 확인이 필요한 명령을 통과하지 못한다": actor agent인 자격과 principal이 `device:`가 아닌 user 자격을 `createRemoteCall`에 넣으면 `secrets/put`과 `providers/disconnect`가 `forbidden`이고, 확인 registry에 handle이 생기지 않으며 writer에 닿지 않는다.
  - subprocess나 core를 띄우는 test, E2E는 만들지 않는다.
- 남지 않음: 지우는 이름이 없다. `grep -rn "REMOTE_ALLOWED_ROUTES.map" packages`가 0줄이다(자격 scope가 두 목록을 함께 본다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). `packages/protocol/remote/mod.ts`에 `REMOTE_PERSON_ROUTES` export
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## wave 1이 merge된 뒤 (lead가 더함)

- 사람 route 목록에 더한다(`setup-provider`, `setup-project`가 낸 것): `providerConnectKey`(`providers/connect-key`, upload), `providerConnectLocal`, `providerSignIn`, `providerSignInState`(`packages/protocol/lophn-agent/providers.ts`), `inputRequestAnswerSecret`(`input_request/answer_secret`, upload, `packages/protocol/lophn-agent/input-request.ts`), `projectAdd`·`projectBrowse`(`packages/protocol/projects/add-api.ts`). 이 route들은 안에서 부른 사람(기기)의 자격으로 `providers/list`를 읽고 `providers/connect`·`projects/create`를 writer에 보내므로 `providerList`, `connectProvider`, `projectApi.register`는 목록에 남는다.
- 기기에서 시작한 로그인·연결 뒤 core가 model 목록을 그 자격으로 기록한다(`RecordProviderModels`). 그 command가 기기 자격의 scope 밖이면 기록이 조용히 실패하고 처음 쓸 때 다시 읽는다. code에서 actor를 보고 scope에 넣을지 정한다(actor user면 사람 목록에, machine만이면 보고한다).
- 위험 test의 "허락 없는 기기" 표에 `providers/connect-key`와 `input_request/answer_secret`을 더한다(값이 handler에 닿지 않는다).
