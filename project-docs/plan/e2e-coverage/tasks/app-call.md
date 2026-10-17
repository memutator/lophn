# app-call

활성 앱의 app-api를 agent tool로 부르면 core를 지나 앱 process가 실행하고 invocation이 기록된다. 응답이 control frame 한도(256KiB)를 넘는 write도 "결과 모름"이 아니라 성공으로 닫히고, 사람 화면 호출은 Gate를 안 거치며, 한도를 넘는 입력은 core가 거절하고, project에 놓인 agent는 project 범위 api를 자기 project로만 부르고, "이 session 동안" 허락은 그 session에만 유효하다. `tests/e2e/app-call_test.ts`.

- 단위: app-call (wave 3)
- 선행: test-app. `projectScopePatch`와 helper를 쓴다.
- 소유(이 task만 고친다):
  - `tests/e2e/app-call_test.ts`
  - `tests/support/app/patch-call.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/runtime/`
  - `packages/core/apps/calls/`
  - `packages/core/approvals/turn-requests.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 3절 `app-call-from-screen`, `app-big-result-changeset-dropped`, `app-input-too-large`, `app-project-scope`와 4절 `allow-session-scope`; `candidates-invariants.md` 후보 20(`app-call-roundtrip`), 26; `candidates-bugs.md` "앱이 필요한 것"의 `app-big-result-frame`; `candidates-product.md` 후보 `app-release-activate-call`, `agent-app-api-gate`(넣지 않음)
  - architecture: `project-docs/architecture/app-call.md`("모든 app-api 호출은 core를 지난다", "write 동안의 changeset을 invocation에 붙임", 응답이 frame 한도를 넘으면 앱 process가 changeset만 빼고 `changeset_dropped: "too_large"`를 싣는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `app-spi`, `agent-tools`, `child-supervision-protocol`
  - 코드: `packages/core/lophn-agent/tools/app-tools.ts`와 `app-api/name.ts`(tool 이름 `app__<app id>__<api>`), `packages/protocol/apps/calls/{call,invocation,process-wire}.ts`(`appCallApi`, `appInvocations`, `changeset_dropped`), `packages/core/apps/runtime/entrypoint/limits.ts`(`RESULT_MAX_BYTES`, `CALL_BODY_MAX_BYTES`), `project-docs/issues/archived/app-call.md`(frame 한도 bug 셋)
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script(steps, lane?)`, 함수 대답, `JournalEntry.lane`)와 `probe.ts`, `tests/support/app/`(`test-app`이 내놓는 `startTestApp`, `deliverRelease`, `approveActivation`, `waitRunning`, `activateTestApp`, `createAppSource`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script(steps, lane?)`, 함수 대답, `JournalEntry.lane`)와 `probe.ts`, `tests/support/app/`(`test-app`이 내놓는 `startTestApp`, `deliverRelease`, `approveActivation`, `waitRunning`, `activateTestApp`, `createAppSource`), `agentGrantsSet`, `appCallApi`·`appInvocations`·`appRuntime`(`packages/protocol/apps/mod.ts`), `bootCore(run, { env: await appCoreEnv() })`(`coding-role`의 `tests/support/coding/deps.ts`: `DENO_DIR=.dev-data/e2e/deno-dir`, `XDG_RUNTIME_DIR`).
  - 내놓는 것: `tests/support/app/patch-call.ts`: `callPatch(dir)`. template에 app-api 셋을 더한다: write `big_write {kb}`(입력 `{kb}`만큼의 글을 한 row에 넣고 row 수를 돌려준다), write `put_text {text}`(길이 제한이 없는 글 하나를 저장), external `external_ping {}`(효과 `external`, 바깥에 나가지 않고 `ok`만 돌려준다. 효과가 external이라 agent grant 기본이 "묻기"다). blueprint 선언과 `src/app-api.ts` handler가 같아야 platform test가 통과한다. project 범위 api는 `test-app`의 `projectScopePatch`를 같이 적용한다.

## 할 일

1. 시작 조건: `test-app`이 merge됐고 `deno task e2e:deps`로 `.dev-data/e2e/deno-dir`가 채워져 있다.
2. `patch-call.ts`를 만든다. platform app test(`blueprint_handler_match`, `rewind`)가 새 api에서도 통과해야 한다: 입력이 `{kb: number}`면 fixture 입력으로도 성공한다(`issues/activation.md`).
3. 행 여섯. core 하나, 앱 하나(`callPatch`와 `projectScopePatch` 적용), 행마다 새 session을 쓴다. 모델을 쓰는 행은 `agent-calls-app`, `project-scope`, `allow-session-scope`뿐이다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `agent-calls-app` | `agentGrantsSet {agent: {role: "lophn"}, entries: [{kind: "app", app, apis: []}]}` → `openSession(lophn)` → `say` → `waitTurnEnd` → `appCallApi`(user)로 `list_items` | ① 함수: 요청의 `toolNames`에서 `__add_item`으로 끝나는 tool을 골라 `<그 이름> {title: "first"}` ② text | ledger: `appInvocations({app})`에 write 호출이 하나이고 caller가 agent(이 session·이 tool call id)이며 `succeeded`이고 changeset이 붙어 있다 / app state: `list_items` 결과에 `first`가 있다 / fake: 둘째 요청의 tool_result에 앱의 응답(새 row)이 있다 | 후보 20. 모든 호출이 core를 지난다 |
| `big-changeset` | `appCallApi`(user) `big_write {kb: 300}` → `appInvocations`로 그 invocation 읽기 → `appRewindPlan {from_invocation}` → `appRuntime` | 없음 | ledger: invocation이 `succeeded`(`unknown`이 아니다)이고 요약에 `changeset_dropped: "too_large"`가 있으며 `appRewindPlan`이 그 write를 "DB를 되돌리지 못함"으로 보인다(항목의 `reverts_db`가 false이거나 `blocked`. 모양은 `rewind.ts`에서 읽는다) / app state: `big_write`가 돌려준 row 수가 늘었다 / process: `appRuntime`이 같은 `process_nonce`로 `running`이다(앱이 안 죽었다) | `app-big-result-frame`, `app-big-result-changeset-dropped`(app-call.md 119·120행). frame 한도 bug가 세 번 났다 |
| `call-from-person` | `appCallApi`(user, caller `{kind: "person", view_session}`) `add_item {title: "by-hand"}` → `appInvocations` | 없음 | ledger: invocation이 `succeeded`이고 caller가 person이며 changeset이 붙어 있다 / route: Gate 요청이 생기지 않았다(`approvals/pending`이 비어 있다. 사람 화면은 Gate를 안 거친다) / app state: `list_items`에 `by-hand`가 있다 | `app-call-from-screen`(app-call.md 79·112행) |
| `input-too-large` | `core.tryCall(appCallApi, put_text {text: <CALL_BODY_MAX_BYTES + 1 byte>})` → `appInvocations` → `appRuntime` | 없음 | route: 오류 code가 `invalid_input`이다 / ledger: 그 호출의 invocation이 생기지 않았다 / process: 앱 process가 같은 `process_nonce`로 살아 있다(core가 보내기 전에 거절했다) | `app-input-too-large`(app-call.md 121행). `CALL_BODY_MAX_BYTES`는 `packages/core/apps/runtime/entrypoint/limits.ts`에서 import한다 |
| `project-scope` | project `proj`와 PM session을 `openProject`·`openSession(PM)`으로 연다 → `agentGrantsSet`(PM에게 앱 할당) → `say` → `waitTurnEnd` → `appInvocations` | ① 함수: `toolNames`에서 `__list_in_project`로 끝나는 tool을 골라 입력 없이 호출 ② text | ledger: invocation의 `project`가 PM의 project id다 / fake: 첫 요청의 그 tool 입력 schema에 `project` 칸이 없다(project에 놓인 agent는 project를 못 고른다) / app state: handler가 돌려준 project가 PM의 project id다 | `app-project-scope`(app-call.md 101행) |
| `allow-session-scope` | `agentGrantsSet`(lophn에게 앱 할당. `external_ping`은 기본이 "묻기") → `openSession(lophn)` → `say` → `waitPermission` → `core.call(approvalsDecideTurn, {session, request, choice: {kind: "session"}})` → `waitTurnEnd` → 다른 `openSession(lophn)` → `say` → `waitPermission` → `decide(reject)` | ① tool `external_ping` ×2 ② text ③ 둘째 session의 tool `external_ping` ④ text | route: 첫 session에서는 `waitPermission`이 한 번뿐이었다(둘째 호출은 안 물었다. 그랬다면 turn이 멈춰 `waitTurnEnd`가 실패한다) / route: 둘째 session은 같은 호출을 다시 물었다 / ledger: 첫 session의 `external_ping` 둘이 `success`이고 둘째 session의 호출은 거절로 닫혔다 | `allow-session-scope`(approval.md 178행). "이 session 동안" 선택지는 app_api·MCP intent에만 있다(`protocol/approvals/requests.ts`의 `choicesFor`). 대답이 4라 README 정한 것 11의 예외가 아니다: 두 session을 나눠 두 case로 쪼갠다(①② / ③④) |

   앞 행의 fake 대답은 둘뿐이고 `agent-calls-app`의 대답은 함수 대답이다. fake 대답은 README "정한 것" 11의 예외(앱 activation helper의 App Engineer 대답)다. test 머리 주석에 이유를 한 줄 적는다.
4. 어긋나면 제품 bug다. 추가 소유 안에서만 고치고 "고치기 전 코드에서 실패"를 보고에 적는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `app-runtime`·`app-spi`(app-api 호출은 core를 지나고 invocation과 changeset이 같이 남는다), `child-supervision-protocol`(응답이 control frame 한도를 넘어도 호출은 결과 모름이 되지 않는다), `agent-tools`(app-api tool).
- 현실적 회귀: 큰 changeset·결과가 frame 한도에서 거절되어 호출이 "결과 모름"이 되고 rewind가 막히는 것(세 번 난 일), agent tool이 core를 건너뛰는 것, caller 확인이 풀리는 것.
- 왜 지금 test가 못 잡나: 한도 관계는 `fit_test`, `supervisor-link_test`가 상수로만 본다. 실제 pipe를 지나는 호출과 agent → core → 앱 process 왕복은 process를 건너야 한다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/app-call_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/app-call_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "agent의 app-api 호출은 core를 지나 앱 process가 실행하고 기록되며, frame 한도를 넘는 write도 성공으로 닫힌다"

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
