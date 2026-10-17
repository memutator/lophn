# turn-stop

사람이 turn을 멈추면(`turns/stop`) core가 그 turn을 돌리는 agent runtime child에 `turn_stop`을 보내고, child가 `driver.stop(turn, reason)`으로 진행 중인 model 요청을 끊게 한다. 지금은 core의 turn 행만 닫혀 child가 요청을 연 채 둔다.

- 단위: fix (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/runtime.ts`
  - `packages/core/lophn-agent/run-loop/driver.ts`
  - `packages/core/main/agent-runtime/`
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`
- 읽을 것:
  - `project-docs/issues/place-session.md`의 "사람이 turn을 멈춰도 agent runtime의 진행 중인 model 요청이 끊기지 않는다"
  - `packages/protocol/supervision/supervision.ts`의 `turnStopSchema`(lead가 고정한 계약. `{type: "turn_stop", turn, reason: "user_stopped"}`)
  - `packages/core/lophn-agent/run-loop/commands.ts`의 stop(`turns/stop`이 turn 행을 닫는 곳. 읽기만), `run-loop/driver.ts`(`stop`, active turn), `run-loop/loop.ts`(`handle.stop`이 진행 호출을 abort)
  - core가 child에 parent message를 보내는 곳: `run-loop/runtime.ts`(`deps.io.send(AGENT_RUNTIME_KIND, ...)`), child가 받는 곳: `packages/core/main/agent-runtime/main.ts`(`onParent`), `product-driver.ts`
  - boundary: `project-docs/boundary-catalog.yaml`의 `run-loop`("멈춤은 진행 중인 요청을 끊는다"), `supervision`, `child-supervision-protocol`
  - 다음 계획의 조사 자료 `/home/pyosechang/projects/lophn/project-docs/plan/e2e-coverage/research/candidates-bugs.md` N1(읽기만. session archive·delete로 멈추는 길은 그 계획의 몫이다)
- 계약:
  - 쓰는 것: `turnStopSchema`(바꾸지 않는다. 바꿀 것이 있으면 요청으로 적는다), `TurnDriver.stop`.
  - 내놓는 것: 없음.

## 지켜야 할 것(계획 공통)

- `~/.lophn`, OS keychain, 사람의 전역 harness 설정을 건드리지 않는다. E2E data root는 `.dev-data/e2e/<run>/home`뿐이다.
- 진짜 model provider는 부르지 않는다.
- 전역 mutable 상태를 두지 않는다. sleep으로 기다리지 않는다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- E2E test file(`tests/e2e/*`)은 고치지 않는다. 그 test가 이 bug를 재현한다. test에 맞추려고 제품의 다른 동작을 바꾸지 않는다.

## 정한 것

- 이 task는 사람이 멈추는 길(`turns/stop`, reason `user_stopped`)만 고친다. session archive·delete로 turn을 닫을 때 child에 알리는 일은 다음 계획(`e2e-coverage`의 `stop-triggers`)이다.
- core는 `turns/stop` command가 commit된 **뒤에** 보낸다(행이 닫히지 않았는데 child를 멈추지 않는다). 어떻게 아는지(command 결과를 감싸기, bus의 event, Reactor)는 코드에 있는 가장 단순한 길을 고르고 "정한 것"에 적는다. `run-loop/commands.ts`를 고쳐야 하면 최소로 맞추고 "넘길 줄"에 적는다.
- child는 `turn_stop`을 받으면 `driver.stop(turn, reason)`을 부른다. 그 turn이 child에 없으면(이미 끝남, 다른 runtime) 아무 일도 하지 않는다.
- runtime child가 다시 뜨는 중이라 보낼 수 없으면 보내기를 버린다(새 child는 그 turn을 시작하지 않는다. turn 행이 이미 닫혔다). 재시도 queue를 만들지 않는다.

## 할 일

1. 아래 "E2E로 확인하기"로 고치기 전 실패(`fake.aborted(1)`이 30초 안에 안 풀림)를 본다.
2. core 쪽 보내기와 child 쪽 받기를 만든다. `driver.stop`이 production에서 불리게 된다.
3. E2E를 10번 연속 돌린다.

## E2E로 확인하기

이 bug를 재현하는 E2E는 아직 merge되지 않은 branch `e2e/e2e-stop`에 있다. 그 file을 이 worktree에 잠시 가져와 돌리고, 끝나면 지운다(commit하지 않는다).

```sh
git show e2e/e2e-stop:tests/e2e/stop_test.ts > tests/e2e/stop_test.ts
for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/stop_test.ts || echo FAIL $i; done
rm tests/e2e/stop_test.ts
```

- 고치기 전에 한 번 돌려 이 bug로 실패하는 것을 보고에 적는다. 고친 뒤 10번 연속 통과한다.
- 끝난 뒤 `ls .dev-data/e2e`가 비어 있고, `pgrep -af core/main/daemon/main.ts`에 이 worktree의 run이 없다(줄마다 `/proc/<pid>/environ`의 `LOPHN_HOME`으로 가린다. 읽기만 하고 pkill·killall은 쓰지 않는다).

## 끝남

- `deno task check:full`이 통과한다. core 기동 두 번이 된다.
- `stop_test.ts`가 10번 연속 통과한다(위 방법. commit하지 않음).
- 위험 test: 새로 쓰지 않는다(`tests/e2e/stop_test.ts`가 이 bug의 test다).
- 남지 않음: `grep -rn "turn_stop" packages/core`가 보내는 곳과 받는 곳을 보인다.

## 보고

- 바꾼 file
- 고치기 전 E2E 실패(출력 한 줄)와 고친 뒤 10번 연속 결과
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
