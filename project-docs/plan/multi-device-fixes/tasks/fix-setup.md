# fix-setup

다른 기계를 부르는 `machines/call`·`machines/watch`를 shell main이 받은 capability로만 열고, 터미널 입력을 허락받은 기기에게도 열지 않는 것(vault·구독 token 이름의 `secrets/*`, `remote.*` 설정, 명단·로그인 route)을 core에서 막고 test로 박는다. 임시 provider secret을 기동 때 치우고, 화면만 막던 loopback 로그인을 core에서 거절하고, remote 오류의 `details`를 그대로 넘기고, review가 찾은 작은 것을 고친다.

- 단위: fix (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/remote/{call.ts,call_test.ts,machine-routes.ts}`(`machine-routes.ts`는 새 file)
  - `packages/core/secrets/routes.ts`
  - `packages/core/config/{routes.ts,routes_test.ts}`
  - `packages/core/lophn-agent/providers/{login.ts,oauth-secrets.ts}`
  - `packages/core/main/daemon/wiring/{lophn-agent.ts,secret-slot.ts}`
  - `packages/protocol/lophn-agent/{provider-inputs.ts,input-request.ts}`
  - `packages/shell/main/desktop/core/connection.ts`, `packages/shell/main/desktop/wiring/machines.ts`
  - `project-docs/architecture/{approval.md,agent-definition.md}`
  - `project-docs/flows/areas/models.yaml`
  - `project-docs/issues/remote-call-errors-drop-details.yaml`
- 읽을 것:
  - 계획 README "정한 것 › 경계"의 셋째·넷째 줄, "위험 test"
  - review `reports/multi-device/review-core-setup.md` 전부(finding 1~12, "Docs and catalog pieces checked", "Not determined")
  - architecture: `project-docs/architecture/approval.md`(`:179-186` 기기 자격), `remote.md`(기기 route 목록, 사람 route), `agent-definition.md`(항목 59, 63)
  - 본보기: `packages/core/terminals/routes.ts`의 `restart`(capability를 input으로 받아 `deps.capability`로 본다), `packages/core/secrets/login-routes.ts:103`(`logins/release`), shell 쪽 `connection.ts`의 `terminalCall`·`releaseLogin`
- 계약:
  - 쓰는 것: `machinesCall`·`machinesWatch`(`packages/protocol/remote/routes.ts`)의 input `shell_capability: z.string().min(1)`. lead가 띄우기 전에 plan branch에 계약 commit으로 넣는다(`routes.ts`는 `fix-roster`의 file이다). `Links`(`packages/core/remote/links.ts`), `REMOTE_PERSON_ROUTES`·`REMOTE_ALLOWED_ROUTES`(`packages/protocol/remote/allowlist.ts`, 읽기만), `ctx.peek.shellCapabilities`
  - 내놓는 것: `createMachineRoutes(deps: {links: Pick<Links, "call" | "watch">; capability(value: string): boolean})`가 내는 `{call(who, input), watch(who, input)}`. lead가 `wiring/remote.ts`의 `machinesCall`·`machinesWatch` 두 줄을 이것으로 바꾼다(`capability: (v) => ctx.peek.shellCapabilities?.has(v) ?? false`). `CoreConnection.machineCall(method: "call" | "watch", body)`(shell main)

시작 전에 다시 볼 것: 위 계약 commit이 plan branch에 있다. 없으면 띄우지 않는다. `fix-roster`가 같은 wave에 `wiring/remote.ts`를 고친다. 그 file은 고치지 않는다.

## 할 일

1. `machines/*`를 shell main으로만(finding 1, README "다른 기계를 부르는 route는 그 기계의 화면만 부른다").
   - `packages/core/remote/machine-routes.ts`에 `createMachineRoutes`를 둔다. input의 `shell_capability`가 살아 있는 capability가 아니면 `forbidden`이고 `links`에 닿지 않는다. 맞으면 그 칸을 뺀 나머지로 `links.call`·`links.watch`를 부른다(capability는 다른 기계로 가지 않는다).
   - shell main: `connection.ts`에 `machineCall`을 `terminalCall`과 같은 꼴로 더하고(인터페이스 주석의 "shell capability는 이것과 `terminalCall`만" 줄도 고친다), `wiring/machines.ts`의 `ctx.coreInternal("memory", "machines", "call" | "watch", …)` 두 곳을 그것으로 바꾼다. 다른 호출자가 없는지 `grep -rn '"machines", "call"\|"machines", "watch"' packages tools tests`로 본다(지금은 shell main만이다).
   - `wiring/remote.ts`의 두 줄 바꾸기는 보고의 "등록할 것"에 적는다.
2. 허락이 있어도 열지 않는 저장소 이름(finding 2, README "허락이 있어도 열지 않는 것에 저장소의 이름도 든다"). `secrets/routes.ts`의 `secretPutHandler`·`secretDeleteHandler`는 `ctx.principal`이 `device:`로 시작하고 이름이 `login.`이나 `provider-oauth.`로 시작하면 값을 읽기 전에 `forbidden`이다(put은 body를 cancel한다). `secrets/status`와 다른 이름은 그대로 둔다(README가 고른 둘이다).
3. `remote.*` 설정(finding 5, README 같은 줄). `config/routes.ts`의 `settingsUpdateHandler`는 `ctx.principal`이 `device:`로 시작하고 changes에 `remote.`로 시작하는 key가 하나라도 있으면 아무것도 바꾸지 않고 `forbidden`이다.
4. actor 검사(finding 4). `call.ts:173-178`의 사람 route 조건에 `current.value.actor === "user"`를 더한다. `call_test.ts:250`의 test는 이름이 말하는 것을 그대로 본다.
5. 오류의 `details`(열린 이슈 `remote-call-errors-drop-details`). `call.ts:228-233`이 dispatch 결과의 오류를 `{code, message}`로 다시 지어 `details`를 버린다. `details`가 있으면 그대로 싣는다(`host.ts:232-238`은 이미 싣는다). 먼저 code에서 확인하고, 이미 다른 곳에서 넘기고 있으면 이 항목은 하지 않고 보고에 적는다. 고쳤으면 이슈를 `issue` skill "닫기"대로 닫는다(`status: fixed`, `closed`, `guard`는 아래 test 이름).
6. 임시 secret 정리(finding 7, `agent-definition.md` 항목 59). `oauth-secrets.ts`에 provider id 없이 이름만 보는 판정(`provider.<id>.new.<꼬리>`)을 더하고, `wiring/lophn-agent.ts`의 start가 secret store의 이름 가운데 그것을 지운다. 지우지 못한 이름은 log에 남기고 기동은 계속한다.
7. loopback 로그인(finding 9, `remote.md:55`, `agent-definition.md` 항목 63). `login.ts`의 `signIn`은 `who.principal`이 `device:`로 시작하고 그 정의의 OAuth flow가 `device_code`가 아니면(`OAUTH_FLOWS`, `packages/protocol/lophn-agent/provider-values.ts`) `forbidden`이다. 받는 쪽의 flow 값이 어디 있는지 정의 type에서 확인한다.
8. provider id를 한 곳에서(finding 8). `secret-slot.ts:120,164`의 `deps.newProviderId()`를 connect의 `freshId`(같은 정의가 다시 이을 때 같은 id, `given`)로 바꾼다. `freshId`가 caller(`who`)를 받으면 slot이 쓸 수 있는 자격을 확인한다.
9. 옛 이름(finding 10). `provider-inputs.ts`의 `loginBeginInputSchema`·`loginBeginOutputSchema`를 지금 route 이름에 맞춘다(`providerSignInTargetSchema`처럼, 쓰는 곳 `input-request.ts:122`, `provider-inputs.ts:220,231`).
10. production wiring의 test hook(finding 11). `wiring/lophn-agent.ts:65`의 `JSON.parse`가 틀린 env에 던지지 않게 받는다(틀리면 log 한 줄과 가짜 target 없음). `crypto.randomUUID()`(`:117,151,164,191`)는 `ctx.random`에서 만든다. env를 읽는 자리는 wiring에 둔다(wiring이 전역 값을 인자로 바꾸는 가장자리다. 다른 wiring도 그렇다).
11. 확인만(PLAUSIBLE): finding 12(허락을 끈 뒤에도 진행 중인 로그인이 끝난다). code에서 맞으면 고치지 않고 `issue` skill "올릴지"를 거쳐 이슈를 쓴다(README에 결정이 없다). finding 6(값이 log와 넘기는 컴퓨터에 남지 않는다)은 review도 code가 맞다고 읽었다. test를 더하지 않고 보고에 그렇게 적는다.
12. 문서: `approval.md:179-186`(기기 자격 문단): `:180`의 `terminal_view/input|open`을 지금 route(`terminals/open|input`)로, `terminals/open`의 `command`·`resume`도 터미널 입력 허락이 있어야 한다(`fix-terminals`가 만든다), 허락이 있어도 열지 않는 것에 `login.`·`provider-oauth.` 이름의 `secrets/put|delete`와 `remote.*` 설정을 더하고, `machines/call|watch`는 shell main capability로만. `agent-definition.md` 항목 59(기동 때 치운다), 63(core가 거절한다).
13. flows(`flows` skill): `models.yaml`의 `settings/update`(`:37`), `providers/sign-in`(`:1300`), `secrets/put`(`:1467`), `secrets/delete`(`:1497`) flow에 기기 거절 outcome을 더한다. `core-platform.yaml`(`fix-roster`의 file)의 `machines/call`(`:2555`)·`machines/watch`(`:2598`)에 더할 forbidden outcome 글과 remote call이 `details`를 싣는다는 줄은 보고에 적는다.

정한 것:
- `machines/*` handler는 새 file에 둔다: `wiring/remote.ts`는 같은 wave의 `fix-roster` file이고, handler를 떼면 test가 wiring 없이 handler만 부른다.
- 기기에게 막는 이름은 `login.`과 `provider-oauth.` 둘이다(README). review가 든 `app-oauth.`는 더하지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/core/remote/call_test.ts`): "CLI의 사람 token으로 `machines/call`을 부르지 못한다". `createMachineRoutes`에 capability 없는 사람 자격(`process: "cli"`)과 죽은 capability로 부르면 `forbidden`이고 가짜 `links`에 닿지 않는다. 살아 있는 capability면 닿고 `shell_capability`는 넘기지 않는다.
- 위험 test: "허락받은 기기가 `roster/*`, `logins/*`, vault 이름의 `secrets/put`, `remote.*` 설정 쓰기를 부르면 `forbidden`이다".
  - `call_test.ts`: `GRANTED` 기기로 허락이 있어도 열지 않는 route 표(`allowlist.ts:325` 둘레 주석이 든 것 가운데 두 목록 어디에도 없는 route: `roster/*`에서 기기 목록의 `roster/leave`를 뺀 것, `logins/*`, 목록에 없는 `devices/*`, `machines/call|watch`, `agent-mcp-auth/begin`, `sessions/change-skip`. 표는 목록 file에서 뽑지 않고 이름으로 적는다)를 부르면 모두 `forbidden`이고 handler에 닿지 않는다(finding 3). 같은 test에서 `REMOTE_ALLOWED_ROUTES`와 `REMOTE_PERSON_ROUTES`가 겹치지 않고 둘 다 actor `user` route만 든다. `secrets/put`은 실제 `secretPutHandler`(가짜 store)를 단 줄로 `login.x.password`가 `forbidden`이고 store에 닿지 않는다.
  - `config/routes_test.ts`: `device:` 자격의 `remote.enabled` 쓰기가 `forbidden`이고 설정이 그대로다.
- test 하나(이슈 guard): `call_test.ts`에서 handler가 낸 오류의 `details`가 부른 쪽 결과에 그대로 온다.
- subprocess·server를 띄우는 test와 E2E를 새로 만들지 않는다.
- 남지 않음: `grep -rn "loginBeginInputSchema\|loginBeginOutputSchema" packages tests`와 `grep -n "crypto.randomUUID" packages/core/main/daemon/wiring/lophn-agent.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). `wiring/remote.ts`의 `machines/*` 두 줄, `core-platform.yaml`의 줄, `boundary-catalog.yaml:298`(`remote-protocol`이 사람 route 목록을 말하지 않는다), tests yaml covers 줄도 여기 적는다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
