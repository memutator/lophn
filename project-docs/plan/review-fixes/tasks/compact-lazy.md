# compact-lazy

자동 Compact를 그 session의 다음 turn을 시작하기 전으로 되돌린다. 요약하는 동안 그 session만 잡아 두고 다른 session의 turn 시작은 막지 않는다.

- 단위: run-loop (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/**` (단 `schema.ts` 제외)
  - `packages/core/main/agent-runtime/**`
  - `packages/protocol/supervision/supervision.ts` (turn source op `hold` 더하기만)
  - `project-docs`는 고치지 않는다(lead가 고친다)
- 읽을 것:
  - `project-docs/architecture/agent-definition.md`의 "compact는 사람이 부르거나…" 항목(지금 글은 turn 끝 eager다. 이 task 뒤 lead가 되돌린다)
  - `packages/core/lophn-agent/run-loop/driver.ts`(`startNext`, `done.finally`의 `deps.compact`, `release`), `queue.ts`(`running`, `take`, `setRunning`), `work.ts`, `turn-pipe.ts`, `packages/core/main/agent-runtime/turn-source-link.ts`, `product-driver.ts`(`startTurnPump`)
- 계약:
  - 쓰는 것: core command(StartTurn 등). 고치지 않는다.
  - 내놓는 것: turn source op `hold(session)` — queue가 그 session을 도는 중으로 둔다(입력은 꺼내지 않는다). 푸는 것은 지금의 `ended`(release)를 쓴다.

## 할 일

1. 지금(직전 task가 바꾼 것): `driver.ts`의 turn `done.finally`가 `handle.compactNext()`면 session을 풀기 전에 `deps.compact`를 돈다(eager). 이것을 지운다. 대신 turn이 끝날 때 `compactNext()`면 session을 driver 메모리의 "다음 turn 전에 Compact" 표에 올린다(runtime이 다시 뜨면 잊는다. 예전 `compactBefore`와 같다). `endSession`에서 지운다.
2. `startNext`가 `next()`로 받은 start의 session이 그 표에 있으면: 표에서 빼고, `source.hold(session)`으로 그 session을 도는 중으로 잡고, `deps.compact(session)`을 기다리지 않고 시작한다. compact가 끝나거나 실패하면(rejection은 `report`로 남긴다) `release(session)`으로 푼다. 이번 `startNext`는 입력을 소비하지 않고 진전으로 센다(pump가 바로 다음 session을 본다). 그 session의 입력은 queue에 남아, 풀린 뒤 다음 `next()`가 다시 내어 보통 turn으로 시작한다.
3. `hold`: supervision `turn_source_request`의 op에 `hold`(message 없음)를 더하고, `ports.ts`의 `TurnSource`, `work.ts`, `turn-pipe.ts`, `turn-source-link.ts`, queue에 잇는다. queue에서는 `setRunning(session, true)`와 같고 입력을 꺼내지 않는다. 이미 도는 중이면 아무것도 하지 않고 그 사실을 돌려준다(그때 driver는 compact를 시작하지 않고 표에 되돌려 둔다).
4. 사람이 부른 Compact와 "Summarize from here"(pump 밖 single-flight)는 그대로 둔다.
5. `driver.ts`의 `DriveDeps.compact` 주석을 새 동작으로 고친다.

## 끝남

- `npm run check:full`이 통과한다.
- 위험 test: 직전 task의 test("한 session이 compaction 중이어도 다른 session의 turn이 시작되고, compaction 중인 session은 끝날 때까지 새 turn을 시작하지 않는다")를 새 동작에 맞춘다. 더해서 "turn이 compaction을 정해도 다음 입력이 오기 전에는 compact하지 않는다" 하나.
- `bash project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.
- 남지 않음: turn `done.finally` 안의 `deps.compact` 호출이 0개.

## 보고

brief-template의 보고 꼴.
