# turn-loop

agent runtime run loop의 다섯 bug를 고친다: 재시작 뒤 secret 거절, `done` rejection으로 runtime 죽음, `next()`/`began()` race, StartModelCall 실패 뒤 진행, StartTurn 실패 busy-loop.

- 단위: run-loop (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/**` (단 `schema.ts`는 `ledger-freeze` 소유라 고치지 않는다)
  - `packages/core/main/agent-runtime/**`
  - 추가 소유: `packages/protocol/supervision/supervision.ts`의 turn source pipe 메시지(`began`에 message id를 싣는 칸만). 쓰는 곳을 같은 변경에서 고친다.
- 읽을 것:
  - `project-docs/architecture/`의 run-loop·agent runtime topic
  - 아래 할 일마다 적은 file과 행
- 계약:
  - 쓰는 것: core command(StartTurn, StartModelCall, FinishModelCall, FinishTurn). 고치지 않는다.
  - 내놓는 것: 없음

## 할 일

1. **재시작 뒤 secret 거절** — `run-loop/runtime.ts` 242·259·289행. `callbacks()`가 한 번 만들어져 supervisor가 재시작마다 재사용하는데(`supervisor.ts`의 supervise loop, `run.ts` 171행), `onEnd`가 `alive = false`로 한 뒤 다시 켜는 곳이 없다. 재시작 뒤 모든 `secret_send_request`가 `forbidden`이 되고 응답도 안 간다. 재시작(attempt)마다 generation 상태를 새로 만든다.
2. **`done` rejection** — `main/agent-runtime/product-driver.ts` 341행, `run-loop/driver.ts` 124행. `startNext()`가 낸 `done`을 아무도 기다리거나 `.catch`하지 않아 `runTurn`이 throw하면 unhandled rejection → crash handler가 프로세스를 끝낸다. driver에서 `done`을 잡아 그 turn을 failed(internal)로 끝내고, pump도 promise를 관찰한다.
3. **`next()`/`began()` race** — `run-loop/driver.ts` 81-110행, `prepare.ts` 992행, `work.ts`, `turn-pipe.ts`, `main/agent-runtime/turn-source-link.ts`. StartTurn은 `next()`의 입력을 기록하는데 loop는 나중의 `began()`이 그때 queue 머리에서 집은 것을 돈다. `began(session, messageId)`로 바꿔 정확히 그 entry를 집게 한다. 없어졌으면 아무것도 소비하지 않고 turn을 닫는다. `closed` 경로(92·105행)도 남의 머리를 버리지 않게 같은 방식으로 고친다.
4. **StartModelCall 실패 뒤 진행** — `run-loop/core-ports.ts` 262-281행. `started`가 실패해도 `settled(applied.length)`와 `model.invoke`를 한다. `!started.ok`면 settle·invoke 전에 오류를 돌려준다.
5. **StartTurn 실패 busy-loop** — `driver.ts` 108행, `product-driver.ts` 342행. `beginTurn`이 StartTurn 전에 실패하면 `not_started`인데 pump가 진전으로 보고 idle 대기 없이 바로 다시 돈다. 입력이 소비된 경우만 진전으로 센다.
6. 같은 file에서 함께 고칠 것: `driver.ts` 129행 `source.ended` 결과를 버려 session이 running으로 남는 것 — 실패하면 한 번 다시 시도하고 그래도 실패하면 log를 남긴다. `core-ports.ts` 360-379행 output blob 저장 실패 시 FinishModelCall 없이 return하는 것 — 늘 row를 끝낸다(가능한 outcome 값으로).

## 끝남

- `npm run check:full`이 통과한다(lead가 준 Windows 기준선 실패는 빼고).
- 위험 test(사람 메시지를 잃는 규칙이라 둔다, 몇 개만):
  - "queue 머리가 바뀐 뒤 began은 StartTurn에 기록한 그 message를 집고, 그 message가 없으면 아무것도 소비하지 않는다"
  - "StartModelCall이 실패하면 steering이 queue에 남고 model을 부르지 않는다"
  - "turn이 throw해도 driver가 그 turn을 실패로 끝내고 다음 turn을 시작할 수 있다"
- `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.

## 보고

brief-template의 보고 꼴.
