# app-data-rewind

합이 control frame(256KiB)을 넘는 여러 write를 앱 data rewind가 한 번에 되돌린다. 되돌릴 수 없게 충돌하면 통째로 취소되고 DB가 안 바뀐다. 동시에 부른 write는 따로 기록되어 rewind 하나가 다른 쪽을 안 지우고, session rewind에서 앱을 고르면 그 앱도 같이 되돌아간다. `tests/e2e/app-data-rewind_test.ts`.

- 단위: app-data-rewind (wave 3)
- 선행: test-app
- 소유(이 task만 고친다):
  - `tests/e2e/app-data-rewind_test.ts`
  - `tests/support/app/patch-rewind.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/rewind/`
  - `packages/core/lophn-agent/session/rewind/files.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 3절 `app-write-serialized`, `session-rewind-with-app`; `candidates-invariants.md` 후보 21(`app-rewind-atomic`); `candidates-bugs.md` `app-rewind-multi-write`; `candidates-product.md` 후보 `app-data-rewind`
  - architecture: `project-docs/architecture/app-call.md`("changeset은 최신부터 뒤집어 한 transaction, 충돌하면 통째로 취소", 뒤집은 changeset 전부가 요청 하나로 간다: bytes frame과 `end`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-data`, `app-runtime`, `child-supervision-protocol`
  - 코드: `packages/protocol/apps/calls/rewind.ts`(`appRewindPlan`, `appRewind`(메모리 route), `appRewinds`, reason `conflict`·`app_unavailable`·`core_restarted`), `packages/core/apps/rewind/`, `project-docs/issues/archived/app-call.md`("앱 rewind가 안 된다": wiring이 비어 늘 rejected였다. 연결을 보는 test가 없다), `project-docs/issues/activation.md`(write app-api의 rewind 검사)
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/app/`(`test-app`이 내놓는 `startTestApp`, `deliverRelease`, `approveActivation`, `waitRunning`, `activateTestApp`, `createAppSource`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script(steps, lane?)`, 함수 대답, `JournalEntry.lane`)와 `probe.ts`, `tests/support/app/`(`test-app`이 내놓는 `startTestApp`, `deliverRelease`, `approveActivation`, `waitRunning`, `activateTestApp`, `createAppSource`), `appCallApi`·`appInvocations`·`appRewindPlan`·`appRewind`·`appRewinds`·`sessionRewind`·`sessionRewindPreview`, `bootCore(run, { env: await appCoreEnv() })`(`coding-role`의 `tests/support/coding/deps.ts`: `DENO_DIR=.dev-data/e2e/deno-dir`, `XDG_RUNTIME_DIR`).
  - 내놓는 것: `tests/support/app/patch-rewind.ts`: `rewindPatch(dir)`. write app-api `add_blob {kb}`(row 하나에 `kb` KiB 글을 넣는다), read app-api `count_blobs`(row 수), 그리고 선언은 read인데 실제로는 마지막 blob row를 고치는 `touch_blob`(충돌 행용. 선언과 동작이 다른 앱 code의 실수를 흉내 낸다).

## 할 일

1. 시작 조건: `test-app`이 merge됐다.
2. 한 write의 changeset은 한도 안(`add_blob {kb: 100}` ≈ 100KiB)이고 셋의 합은 256KiB를 넘는다. platform app test의 `rewind` 검사가 새 api에서 통과하는지 먼저 본다(`issues/activation.md`). 안 되면 입력을 줄이는 대신 "계약 바꾸기 요청"에 적는다.
3. 행 넷. core 하나, 앱 하나. 둘째 행은 첫 행이 끝난 뒤 새 write 셋을 더 한다. `session-rewind-with-app`만 model을 쓰고 앞 세 행보다 뒤에 둔다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `rewind-many-writes` | `activateTestApp(patch)` → `appCallApi add_blob {kb: 100}` ×3 → `appRewindPlan {app, from_invocation: 첫 호출}` → `appRewind` → `appCallApi count_blobs` → `appRewinds` | 앱 activation의 대답뿐이다. fake 대답은 README "정한 것" 11의 예외(앱 activation helper의 App Engineer 대답)다. test 머리 주석에 이유를 한 줄 적는다. | app state: `count_blobs`가 0이다(첫 write 이전 상태) / ledger: `appRewinds`의 status가 `applied`이고 되돌린 invocation이 셋이며 `appInvocations({reverted: true})`가 셋이다 / process: `appRuntime`이 같은 `process_nonce`로 `running`이고 `unknown` invocation이 없다 | 후보 21. 데이터 잃기, 두 번 고친 bug |
| `rewind-conflict` | `add_blob {kb: 100}` ×3 → `appCallApi touch_blob`(DB를 기록 없이 고친다) → `appRewindPlan` → `appRewind` → `count_blobs` | 같다 | app state: `count_blobs`가 3 그대로이고 `touch_blob`이 고친 값이 남아 있다(반쯤 되돌아간 DB가 없다) / ledger: `appRewinds`의 status가 `cancelled`이고 reason code가 `conflict` / process: 앱이 살아 있다 | 후보 21 행 b. 충돌하면 통째로 취소 |

| `writes-serialized` | `appCallApi add_item {title: "a"}`와 `{title: "b"}`를 `Promise.all`로 동시에 → `appInvocations` → 나중에 시작한 호출(`started_at`)을 `from_invocation`으로 `appRewindPlan`·`appRewind` → `list_items` | 없음 | ledger: 두 invocation이 모두 `succeeded`이고 각각 자기 changeset을 따로 가진다(둘이 하나로 합쳐지지 않았다) / route: plan 항목이 그 호출 하나뿐이다 / app state: rewind 뒤 `list_items`에 먼저 시작한 호출의 item 하나만 남는다(rewind 하나가 다른 쪽을 안 지웠다) | `app-write-serialized`(app-call.md 105·106행). write는 한 번에 하나씩 돈다 |
| `session-rewind-with-app` (case 둘. 각각 agent 호출 1 write) | lophn session에 앱을 할당하고 `say` → `waitTurnEnd`(agent가 `add_item`을 부른다) → `sessionRewindPreview {choice: "restore_all"}`의 앱 목록 확인 → `sessionRewind`에 그 앱을 고른 행(`apps` 칸)과 안 고른 행(`apps: []`)을 각각 → `list_items` | ① 함수: `toolNames`에서 `__add_item`으로 끝나는 tool 호출 ② text (행마다 새 session) | app state: 고른 행은 `list_items`가 비고, 안 고른 행은 item이 그대로 / ledger: `sessionRewind` header와 `appRewinds`에 앱 rewind가 고른 행에서만 `applied`로 기록된다 / disk: 대화의 file 복원은 앱 선택과 독립이다(그 session이 file을 안 건드렸다면 변화 없음) | `session-rewind-with-app`(place-session.md 38~40행, app-call.md 134행). 앱 선택은 `Rewind` 입력의 `apps`이고 core가 확정 뒤 앱 rewind를 요청한다(`session/rewind/files.ts`). 대답이 행마다 2개다 |

4. `touch_blob`이 platform test나 앱 build에서 걸러져 만들 수 없으면 둘째 행은 접고 보고한다(첫 행이 이 task의 핵심이다). `session-rewind-with-app`은 `rewind/preview`의 `restore_all` bug(`issues/place-session.md`)가 고쳐져 있어야 한다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `app-data`(changeset은 최신부터 뒤집어 한 transaction이고 충돌하면 통째로 취소된다), `child-supervision-protocol`(뒤집은 changeset 전부가 요청 하나로 bytes frame과 end로 간다).
- 현실적 회귀: rewind 요청이 frame 한도를 못 지나 되돌림이 통째로 막히거나(두 번 난 일), 일부만 되돌아가 DB가 반쯤 되돌아간 채 남는 것, rewind wiring이 비어 늘 rejected인 것("연결 자체를 보는 test는 없다"고 닫음에 적혀 있다).
- 왜 지금 test가 못 잡나: 한도 계산은 unit이 있지만 실제 pipe와 앱 process의 한 transaction은 process를 건너야 한다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/app-data-rewind_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/app-data-rewind_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "여러 write의 앱 data rewind는 한 번에 되돌아가고, 충돌하면 아무것도 바꾸지 않으며, 다른 write를 지우지 않는다"

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
