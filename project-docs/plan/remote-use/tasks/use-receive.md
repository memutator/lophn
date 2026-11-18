# use-receive

받는 기계를 짓는다: 다른 컴퓨터가 넘긴 call의 요청한 쪽(`by`)을 종류마다 대하고, 앱 command 입구 `apps/remote_call`을 열고, 터미널 입력 허락·private·내놓은 command를 보고, 호출 기록에 `remote` caller로 남긴다. 받은 call은 사람으로 보지 않는 것이 기본이다.

- 단위: use (wave 2)
- 선행: use-contract. 계약의 이름으로 짓는다.
- 소유(이 task만 고친다):
  - `packages/core/remote/call.ts`, `packages/core/remote/forwarded_test.ts`(새 file. `call_test.ts`는 `use-send`가 `fix-setup`의 test를 바꾸느라 가진다)
  - `packages/core/remote/host.ts`, `packages/core/remote/host_test.ts`
  - `packages/core/apps/calls/{caller,gate,service,record}.ts`, `packages/core/apps/calls/calls_test.ts`
  - `packages/core/main/daemon/wiring/apps.ts`
  - `project-docs/flows/areas/app-runtime.yaml`, `project-docs/flows/tests/{core-rest,core-apps}.yaml`
- 읽을 것:
  - `project-docs/plan/remote-use/tasks/use-contract.md`의 "내놓는 것"과 받는 기계의 표
  - 계획 README "정한 것"의 "요청에 누가 시켰는지가 실린다", "받는 기계는 자기 규칙을 본다", "private은 기계 사이에도 선다"
  - architecture: `approval.md`("폰(기기) 자격", `use-contract`가 고친 초안), `app-call.md`(지키는 것 "호출 경로" 2·4·5, "공개 범위와 사용 관계" 1), `agent-call.md`(call 정책)
  - 조사 `reports/multi-device/survey-n3-remote-use.md` 1.1(7~11), 1.2(4~6), 1.3, 6절. review `reports/multi-device/review-core-setup.md` finding 1
  - boundary·module: `remote-protocol`, `core-api`; module `remote`, `apps`
- 계약:
  - 쓰는 것: `Requester`·`requesterSchema`, call frame `by`, `appRemoteCall`, `appToolCallerSchema`의 `remote`, `CallAuth.remote`, `VerifiedCaller`의 `remote`, `isPrivate`, `REMOTE_AGENT_ROUTES`, `ctx.machineLinks.resolve`, `ctx.deviceKind`, `createRemoteCall`의 dep `kind`(계약이 두고 `wiring/remote.ts`에서 채웠다)
  - 내놓는 것: `apps/remote_call`의 동작(`use-send`와 `use-cli`가 그 기계에서 부른다), `RemoteCall`의 새 꼴 `(credential, call: {resource, method, body, by?})`

## 할 일

1. `host.ts`: `call` frame의 `by`를 `deps.call`에 그대로 넘긴다(frame type이 이미 싣는다).
2. `call.ts` `createRemoteCall`: 계약이 둔 dep `kind(principal)`로 `use-contract`의 표대로 거른다.
   - 폰이 `by`를 실었거나 컴퓨터가 `by` 없이 불렀으면 `invalid_input`.
   - 사람 목록과 확인이 필요한 command는 `by`가 없는 폰이나 `screen`이고 허락이 있을 때만이다. `terminal`, `agent`, `app`은 허락이 있어도 `forbidden`.
   - `agent`·`app`은 `REMOTE_AGENT_ROUTES` 밖이면 `forbidden`.
   - `apps/remote_call`은 컴퓨터이고 허락이 있을 때만이다. 통과하면 body의 `by`를 frame의 `by`로 덮어 쓴다(기기가 보낸 값은 버린다).
   - 오류를 다시 만들 때 `details`를 버리지 않는다(이슈 `remote-call-errors-drop-details`, `call.ts`의 `err({code, message})`).
   - `call.ts` 머리 주석과 `createRemoteCall` 위 주석(사람 route는 허락받은 기기에 연다)을 요청한 쪽 기준으로 고친다.
3. `wiring/apps.ts`에 `apps/remote_call` handler: principal이 `device:`이고 `ctx.deviceKind`가 `computer`가 아니면 `forbidden`. 부른 기계는 `ctx.machineLinks.resolve(<dev_ id>)`로 얻는다. `ctx.appCallPath.call`에 target `{mode:"live", app, release:null}`, kind `command`, caller `{kind:"remote", machine, device, requester: by}`, auth `{actor:"remote", remote: {...같은 것}}`로 넘긴다. 등록은 lead다(보고).
4. `caller.ts`/`gate.ts`/`service.ts`: `remote` caller.
   - 확인: `use-contract`가 둔 본문과 `auth.remote` 대조를 그대로 둔다. route로는 이 자격이 생기지 않는다.
   - 막기(`callAllowed`): command가 `public`이어야 한다(README "command가 밖에 내놓은 것"). 요청한 쪽이 `agent`·`app`이면 대상 앱의 workspace `{kind:"app", id}`가 이 기계의 call 정책에서 private이 아니어야 한다(`isPrivate`. `CallGateDeps`에 정책 읽기를 더한다. 읽는 곳은 `callPolicyAt`). `screen`·`terminal`은 private을 보지 않는다(README "사람의 화면과 터미널은 private이어도 된다").
   - operation과 구독 handler는 지금 non-person 갈래대로 막힌다. 보관한 앱은 agent처럼 `not_found`다.
   - 막히면 `denied(gate_blocked)`이고 기록이 남는다.
5. `record.ts`: caller JSON과 `caller_kind 'remote'`가 그대로 남는지 본다(session·turn은 null).
6. test(`write-test` 기준, 표로):
   - `call_test.ts`(`fix-setup`의 test가 있다)는 `use-send`의 file이다. 바꾼 `call.ts` 때문에 거기 test가 깨지면 고치지 말고 고칠 줄을 보고에 적는다. 새 test file은 `core-rest.yaml`에 적는다.
   - 새 `forwarded_test.ts`: 위험 test 둘과 "폰이 실은 `by`와 `by` 없는 컴퓨터의 call은 dispatch까지 가지 않는다"를 한 표로.
   - `calls_test.ts`: 위험 test 하나.
   - `host_test.ts`의 "다른 기계로 넘긴 call은 그 기계에서 기기 route 목록과 허락으로 걸러져 …"(지금 1472줄)는 옛 설계("넘긴 call = 그 컴퓨터의 사람")를 지킨다. 지우고, 그 test가 보던 경계(`roster/*`·`machines/call`이 `forbidden`, 목록 밖이 handler에 닿지 않음)는 새 표 test에 남긴다.
7. flows(`flows` skill): `app-runtime.yaml`에 `apps/remote_call` flow(성공, `forbidden`(폰·로컬 자격·허락 없음·private·비공개 command), `not_found`, 앱이 꺼짐). `core-rest.yaml`·`core-apps.yaml`의 `covers`를 바꾼 test에 맞춘다.

정한 것:
- 입구 호출은 요청한 쪽이 누구든 `public` command만이다: README가 받는 기계의 검사로 "밖에 내놓은 것"을 둘 다 적었다.
- 받는 기계는 부른 기계의 할당을 다시 따지지 않는다(README). 받는 쪽의 판정은 위 셋뿐이다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "agent나 앱이 요청한 call은 받는 기계에서 사람의 route와 확인이 필요한 명령을 통과하지 못한다(부른 컴퓨터에 허락이 있어도)." (`forwarded_test.ts`)
  - "터미널 입력 허락이 없는 컴퓨터의 요청은 받는 기계가 앱 command를 돌리지 않는다." (`forwarded_test.ts`, `apps/remote_call`이 handler에 닿지 않는다)
  - "private인 workspace의 앱은 agent나 앱이 요청한 다른 기계의 call로 불리지 않는다." (`calls_test.ts`, README 위험 test 넷째의 받는 쪽 반. 부르는 쪽 반은 `use-send`)
- 입구부터 실행기까지 한 번 잇는다: `createRemoteCall` → `apps/remote_call` handler → 앱 호출 경로 → 기록의 `caller_kind`가 `remote`(실행 경로를 바꾸는 task의 규칙).
- 새로 subprocess·서버를 띄우는 test와 E2E는 만들지 않는다(필요하면 보고에 적는다).
- 남지 않음: `grep -rn "다른 기계로 넘긴 call은 그 기계에서 기기 route 목록과 허락으로" packages tests`가 0줄이다(옛 test 이름). `allowlist.ts` 머리 주석의 "허락은 그 기기를 사람으로 본다는 뜻이다"는 lead의 file이라 고칠 문장을 보고에 적는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task는: `packages/core/apps/register.ts`의 `memoryRoutes`에 `appRemoteCall`, `allowlist.ts`의 `REMOTE_ALLOWED_ROUTES`에 `appRemoteCall`(handler와 같은 merge에)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## 시작 전에 다시 볼 것

- `fix-setup`이 `call.ts`에 더한 거절(vault·token 이름, `remote.*` 설정)과 그 test 이름, `carry-paths`가 `service.ts`·`host.ts`에 더한 것, `one-screen`의 `screen-terminals`가 기기 목록에 더한 route, `core-browser`의 `page_view/*`(기기 목록이라 `terminal`은 닿고 `agent`·`app`은 닿지 않는다), 그때 `createRemoteCall`의 줄 번호와 이슈 `remote-call-errors-drop-details`가 아직 열려 있는지. 컴퓨터가 부른 `roster/leave`의 거절(`fix-roster`, review-device-roster F12)이 main에 있는지(`terminal`이 열리면 실제 길이 된다. 없으면 lead에게 알린다).
