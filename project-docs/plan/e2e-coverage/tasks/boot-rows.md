# boot-rows

`tests/e2e/boot_test.ts`에 행 셋을 더한다: 같은 data root에 둘째 core를 띄우면 거절당하고 첫째가 안 상한다, model 요청이 도는 중에 core가 꺼지면(정상 종료·SIGKILL) child와 요청이 남지 않는다, 망가진 ledger로는 시작을 거절하고 원본을 그대로 둔다.

- 단위: boot-rows (wave 2)
- 선행: boot-damaged. `tryBootCore`를 쓴다.
- 소유(이 task만 고친다):
  - `tests/e2e/boot_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/base/install/instance-lock.ts`
  - `packages/core/main/daemon/core.ts`
  - `packages/core/main/daemon/parent.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-invariants.md` 후보 4(`shutdown-orphans`), 5(`second-core-same-root`); `candidates-bugs.md` 후보 `boot-failure-frame`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `supervision`, `server`, `storage`
  - 코드: `packages/core/main/daemon/{main,core,parent}.ts`(`watchParent`: pipe EOF나 `stop` frame이면 shutdown), `packages/base/install/instance-lock.ts`(죽으면 커널이 lock을 푼다), `packages/core/storage/migration/migrations.ts`(손상은 아무것도 쓰지 않고 `damaged_original`로 거절)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tryBootCore`·`bootCore(run, options)`(`boot-damaged`), `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `platformStatus`(`packages/protocol/server/mod.ts`), `receivedMessageList`·`turnList`(`packages/protocol/lophn-agent/mod.ts`).
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `tests/e2e/boot_test.ts`가 main에 있어야 한다(계획 `testing`의 `e2e-support-core`가 land한 뒤). 없으면 시작하지 말고 보고한다. 이 brief의 "지금 모양"은 branch `e2e/e2e-support-core`에서 본 것이므로 main의 file을 먼저 읽고 어긋나면 main을 따른다. (boot_test.ts는 `boot-damaged`가 건드리지 않는다. 지금 한 `Deno.test`는 그대로 두고 아래 행마다 `Deno.test`를 하나씩 더한다. 행의 준비는 file 맨 위 helper 하나(`withCore(run, fake, body)` 정도)로 둔다.)
2. 행 표. 모두 `try/finally`로 `core?.kill()`, `fake.close()`, `run.remove()`를 부른다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `second-core` | `bootCore` → `connectFakeProvider` → `openSession(lophn)` → `say` → `waitTurnEnd` → `processesOf(home)`와 `run/location.json` 읽기 → `tryBootCore(같은 run)` → 첫째에 `platformStatus`·`receivedMessageList`·`turnList` | ① text | process: 둘째가 `ok: false`이고 `exit`가 0이 아니며 그 뒤 `processesOf(home)`가 앞 값과 같다 / disk: `run/location.json`이 바이트 그대로(`api_port`가 첫째 것) / ledger: 첫째의 message·turn 개수가 그대로이고 `platformStatus.ready`다 | 후보 5. 데이터 잃기(두 instance가 한 DB). boundary `supervision`·`server` |
| `shutdown-stop` | `bootCore` → `connectFakeProvider` → `openSession(lophn)` → `say` → `fake.arrived(1)` → `core.stop()` → `fake.aborted(1)` | ① stall(text 앞 절반) | fake: `aborted(1)`이 풀리고 journal이 1개 / process: `processesOf(home)`가 빔 / disk: `run/location.json`이 없다(정상 종료에서만 지운다) | 후보 4. 비용(남은 child의 열린 요청) |
| `shutdown-kill` | 위와 같고 `core.kill()` → `fake.aborted(1)` → `bootCore(같은 run)` → `platformStatus` | ① stall | fake: `aborted(1)` / process: `kill()`이 child까지 없는 것을 확인했고 `processesOf`가 빔 / ledger: 다시 뜬 core의 `platformStatus.ready` | 후보 4. SIGKILL 뒤에도 child가 요청을 놓는다 |
| `damaged-ledger` | `bootCore` → `core.stop()` → `home/lophn.db`를 쓰레기 byte로 덮고(`lophn.db-wal`·`-shm`이 있으면 지운다) sha256을 적어 둠 → `tryBootCore` | 없음 | frame: `ok: false`, `reason: "damaged_original"`, `exit`가 0이 아님 / disk: `lophn.db` sha256이 그대로이고 `home` 아래에 새 `.db`가 안 생김 / process: `processesOf(home)`가 빔 | `boot-failure-frame`. 사용자 data를 지우지 않는 규칙 |

3. 단정이 어긋나면 test를 고치지 말고 제품 bug로 본다(위 "추가 소유" 안에서만 고친다). 예: 둘째 core가 `run/location.json`을 덮어쓰거나 첫째 data를 건드리면 instance lock 순서의 결함이다. 고친 행은 "고치기 전 코드에서 실패"를 보고에 적는다.
4. `stall`이 끝나지 않으므로 `fake.close()`가 열린 연결을 놓는 것에 기댄다(`close()`는 `silent`·`stall`을 끊는다).

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `supervision`·`server`(instance lock, child 정리, 시작 실패 알림), `storage`(손상된 ledger를 열지 않고 원본을 지키는 규칙).
- 현실적 회귀: instance lock이 풀려 두 core가 한 `lophn.db`를 열어 data를 망가뜨리는 것, core가 꺼지는데 agent runtime의 model 요청이 열려 token을 계속 쓰는 것, 손상된 ledger를 "고치려고" 덮어쓰는 것. 10-16 하루에 "core가 안 켜짐" 수정이 넷이었다.
- 왜 지금 test가 못 잡나: `boot_test`는 정상 종료와 SIGKILL 뒤 재기동만 본다. 둘째 instance, 요청이 열린 채 끄기, 손상 ledger는 process 둘 이상이나 시작 실패 frame이 필요해 unit이 없다(`base`에 instance lock test가 없다).

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/boot_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/boot_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "같은 data root에 둘째 core는 시작하지 못하고 첫째는 안 상한다 / core가 꺼질 때 child와 열린 model 요청이 남지 않는다 / 손상된 ledger는 원본 그대로 두고 시작을 거절한다"

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
