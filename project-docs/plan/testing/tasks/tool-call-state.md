# tool-call-state

성공한 tool call이 ledger에 `requested`로 남는 bug를 고친다. `attemptTool`이 record 뒤 decide·start를 거쳐 finish하게 하고, 그 command의 실패를 버리지 않는다.

- 단위: fix (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/core-ports.ts`
- 읽을 것:
  - `project-docs/issues/place-session.md`의 "성공한 tool call이 ledger에 `requested`로 남는다"
  - `packages/core/lophn-agent/tools/commands.ts`(record, decide, start, finish의 상태 전이와 compare. 이 규칙이 설계다), `packages/protocol/lophn-agent/tool-calls.ts`(`decideToolCall`, `startToolCall`, `finishToolCall`의 입력)
  - `packages/core/lophn-agent/run-loop/core-ports.ts`의 `attemptTool`, `record`, `close`, `packages/core/lophn-agent/run-loop/runtime-access.ts`(child가 부를 수 있는 route)
  - Gate 결정이 나오는 곳: `packages/core/agent-roles/hooks.ts`(`writeGate`), `packages/core/lophn-agent/tools/`의 실행 context
  - `project-docs/architecture/approval.md`("지키는 것")
- 계약:
  - 쓰는 것: `decideToolCall`, `startToolCall`, `finishToolCall`(바꾸지 않는다).
  - 내놓는 것: 없음.

## 지켜야 할 것(계획 공통)

- `~/.lophn`, OS keychain, 사람의 전역 harness 설정을 건드리지 않는다. E2E data root는 `.dev-data/e2e/<run>/home`뿐이다.
- 진짜 model provider는 부르지 않는다.
- 전역 mutable 상태를 두지 않는다. sleep으로 기다리지 않는다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.
- E2E test file(`tests/e2e/*`)은 고치지 않는다. 그 test가 이 bug를 재현한다. test에 맞추려고 제품의 다른 동작을 바꾸지 않는다.

## 정한 것

- command 쪽 규칙(`requested` → decide → `started` → finish)을 따른다. `finish`가 `requested`에서 success를 받게 바꾸지 않는다.
- decide의 `decision`은 실제로 적용된 결정이다. Gate가 묻지 않은 tool은 정책상 허락이고, Gate가 물어 사람이 허락한 tool은 그 결정과 `approval` id다. Gate가 거절하거나 실행하지 않은 call은 지금처럼 failure·not_executed로 끝난다(이 길은 지금 맞게 기록된다).
- 각 command의 `compare`는 앞 command가 돌려준 `state_seq`를 쓴다. 상수 `"0"`을 쓰지 않는다.
- decide·start·finish 중 하나라도 실패하면 버리지 않는다. 그 call을 `uncertain`으로 닫는 길(`attemptTool` 안의 기존 `done(..., "uncertain", ...)`)을 쓴다.
- 결정이 tool 실행 context 안(hook)에서만 알려져 `core-ports.ts` 밖을 고쳐야 하면, 그 file은 최소로 맞추고 "넘길 줄"에 적는다. 크게 바뀌어야 하면 멈추고 보고한다.

## 할 일

1. 아래 "E2E로 확인하기"로 고치기 전 실패를 본다.
2. `attemptTool`을 위 "정한 것"대로 고친다.
3. E2E 두 개(`file-write_test.ts`, `approval_test.ts`)를 돌린다. `approval_test.ts`는 `session_snapshots/list` bug(다른 fix task)에도 막혀 있으니 이 task에서는 `file-write_test.ts`만 10번 연속 통과를 기준으로 한다. `approval_test.ts`는 한 번 돌려 실패 이유가 snapshot read뿐인지만 본다.

## E2E로 확인하기

이 bug를 재현하는 E2E는 아직 merge되지 않은 branch `e2e/e2e-file-write`에 있다. 그 file을 이 worktree에 잠시 가져와 돌리고, 끝나면 지운다(commit하지 않는다).

```sh
git show e2e/e2e-file-write:tests/e2e/file-write_test.ts > tests/e2e/file-write_test.ts
for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/file-write_test.ts || echo FAIL $i; done
rm tests/e2e/file-write_test.ts
```

- 고치기 전에 한 번 돌려 이 bug로 실패하는 것을 보고에 적는다. 고친 뒤 10번 연속 통과한다.
- 끝난 뒤 `ls .dev-data/e2e`가 비어 있고, `pgrep -af core/main/daemon/main.ts`에 이 worktree의 run이 없다(줄마다 `/proc/<pid>/environ`의 `LOPHN_HOME`으로 가린다. 읽기만 하고 pkill·killall은 쓰지 않는다).

## 끝남

- `deno task check:full`이 통과한다. core 기동 두 번이 된다.
- `file-write_test.ts`가 10번 연속 통과한다(위 방법. commit하지 않음).
- 위험 test: 새로 쓰지 않는다(`tests/e2e/file-write_test.ts`가 이 bug의 test다).
- 남지 않음: `grep -n 'state_seq: "0"' packages/core/lophn-agent/run-loop/core-ports.ts`가 tool call finish에 남지 않는다.

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
