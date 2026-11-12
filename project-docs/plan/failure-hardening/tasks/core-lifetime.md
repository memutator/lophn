# core-lifetime

ledger writer Worker가 죽거나 그 안의 SQLite 연결이 fault되면 core가 log 한 줄을 남기고 `exit(1)`해 shell이 다시 띄우게 한다. 멈춘 shutdown은 전체 기한에서 강제로 끝내고, 비정상 종료는 다음 기동이 log로 알린다.

- 단위: core (wave 1)
- 선행: 없음. `shell-core-connection`(재시작 상한)과 같이 land한다(README "돌리기 전에").
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/{core,runtime,main}.ts`
  - `packages/core/storage/ledger/writer-worker.ts`
  - `packages/core/server/serve.ts`
- 읽을 것:
  - 계획 README "정한 것"의 "ledger writer가 죽으면 core가 `exit(1)`한다"와 "사람이 정할 것" 1
  - architecture: `project-docs/architecture/platform.md`의 "core 수명"(끝나는 길, crash 뒤 다시 띄우는 쪽은 shell의 다음 ensure)과 "지키는 것" 6, 7, 8
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/main`(boundary `core`), `packages/core/storage`(`storage`), `packages/core/server`(`server`)
- 계약:
  - 쓰는 것: writer Worker 통로 `packages/core/storage/ledger/writer-message.ts`의 `WriterResponse`(`{id: 0, op: "failed"}`는 이미 main이 writer 죽음으로 읽는다. 모양을 바꾸지 않는다). `LedgerConnection.failed()`(`packages/core/storage/ledger/sqlite.ts`). `shell-core-connection`이 내놓는 재시작 상한: core가 ready 뒤 짧은 시간 안에 거듭 끝나면 shell이 다시 띄우지 않고 시작 실패 화면에 멈춘다. 이 상한이 없으면 writer가 계속 죽을 때 shell이 core를 끝없이 다시 띄운다.
  - 내놓는 것: writer Worker 안 연결이 `connection.failed()`가 되면 core가 끝난다. `storage-errors`는 corrupt에서 `connection.fault()`만 부르고 `writer-worker.ts`를 고치지 않는다.

## 할 일

1. writer Worker가 `error` 없이 끝나는 길(rt #28 경로 1). 지금은 `terminate()`나 Worker 안 `process.exit`처럼 uncaught exception이 아닌 끝남이면 `packages/core/main/daemon/runtime.ts` `openProductWriter`의 `fail()`이 불리지 않는다. `pending`의 promise가 영원히 안 풀리고, 죽은 Worker에 `postMessage`는 던지지 않아 뒤의 모든 command도 멈추며, `ctx.server.stop()`이 그 요청을 기다려 shutdown barrier까지 멈춘다.
   - `worker.on("exit", ...)`를 더해 `fail()`을 부른다.
   - `closing` flag를 둔다. `writer.close()`가 close를 보내기 전에 세운다. 그래야 정상 close의 `closed` 답, 그 뒤의 `exit`, `closeWithin` 기한 초과의 `terminate()`가 죽음으로 읽히지 않는다.
   - `openRuntime` 입력에 `onDead(cause: "exit" | "error" | "failed")`를 더해 `openProductWriter`로 넘긴다. `fail()`이 처음 불리고 `closing`이 아닐 때 한 번만 부른다. cause는 `exit` listener, `error` listener, id 0 `failed` 메시지(그리고 `postMessage`가 던진 경우) 중 어디서 왔는지다.
2. `error` event 길(경로 2). 지금은 `fail()` 뒤 command가 영원히 `unavailable "writer가 끝났다"`로 끝나고 core는 `ready`로 남는다. 1의 `onDead`가 같이 덮는다(`worker.on("error")`도 cause `error`로 같은 `fail()`을 부른다).
3. Worker는 살아 있는데 연결이 fault된 길(경로 3). 지금은 `tx.ts`의 `rollback()` 실패(그리고 `storage-errors` 뒤에는 corrupt)가 `connection.fault()`를 부르면 그 뒤 모든 command가 `unavailable`인데 Worker가 main에 알리지 않아 아무도 모른다.
   - `packages/core/storage/ledger/writer-worker.ts`의 message chain에서 `handle(...)`이 끝날 때마다(성공과 `.catch` 둘 다) `connection.failed()`를 보고, 참이면 `{id: 0, op: "failed", body: {code: "unavailable", message: ...}}`를 한 번만 보낸다. main은 이미 id 0 `failed`를 `fail()`로 읽는다(`runtime.ts`의 `message` listener).
   - `close` 요청은 `connection.close()`가 `failed()`를 참으로 만든 뒤 Worker를 끝내므로 이 확인에서 뺀다.
4. `packages/core/main/daemon/core.ts`가 `openRuntime`에 `onDead`를 넘긴다.
   - ready 전(`ctx.ready`가 한 번도 참이 된 적 없음): 끝내지 않고 `writerDead` 표시만 남긴다. `ctx.ready = true` 바로 앞(wiring `start` 다음)에서 이 표시가 있으면 `wiring.start` 실패 갈래와 같이 정리(`health.close()`, `server.stop()`, `runtime.close()`)하고 `err({code: "unavailable", message: "writer가 끝났다"})`를 돌려준다. 그 앞에서 writer를 쓰는 단계(`records`, `build`)는 이미 실패로 돌려준다.
   - shutdown 중(`ctx.stopped`): log만 남긴다. barrier는 그대로 이어진다(`fail()`이 기다리던 promise를 푼다).
   - 그 밖: `telemetry.logger.error({component: "core", event: "writer_dead", fields: {cause}})`를 쓰고 `telemetry.shutdown()`을 최대 1초 기다린 뒤 `exit(1)`한다. `ctx.shutdown()`을 부르지 않는다(graceful 종료는 Gateway에 `closed(shutdown)`을 보내 shell이 다시 띄우지 않는다).
   - `exit`는 주입한다. `CoreOptions`에 `exit(code: number): void`를 더하고(필수), `packages/core/main/daemon/main.ts`가 `(code) => process.exit(code)`를 넘긴다. `startCore`를 부르는 곳은 `main.ts` 하나다(`tests/support/core`는 자기 함수다).
5. 전체 shutdown 기한(rt #15). 지금은 barrier에 전체 기한이 없어 멈춘 요청 하나가 instance lock을 쥔 채 shutdown을 멈추고, 다음 ensure는 `waitGone` 15초 뒤 실패한다.
   - `core.ts` `shutdown()`에서 `ctx.stopped = true` 바로 뒤 `SHUTDOWN_DEADLINE_MS = 90_000`의 unref된 timer를 건다. 기한이 지나면 `telemetry.logger.error({component: "core", event: "shutdown_deadline"})`를 쓰고 `exit(1)`한다(자식은 stdin EOF로 끝나고 lock은 OS가 푼다). barrier가 끝나면 `finally`에서 timer를 지운다.
   - `packages/core/server/serve.ts` `handleOf`의 `shutdown()`: `requests.whenIdle(...)`을 기다리는 것에 더해 `SERVER_DRAIN_MS = 10_000` 뒤 `server.closeAllConnections()`를 부르는 unref된 timer를 건다. 멈춘 요청이 있어도 server close가 끝나 barrier가 정지 유지보수까지 간다.
6. 비정상 종료 표지(rt #16). 지금은 core가 crash·SIGKILL·4와 5의 `exit(1)`로 끝나도 다음 기동이 그것을 모른다.
   - `startCore`에서 lock을 잡고 `user-token`·`location.json`을 지운 뒤 `<run>/running.marker`(`root.value.run`)가 있는지 본다. 있으면 그 내용(`{pid, started_at}`)을 fields로 `telemetry.logger.warn({component: "core", event: "previous_unclean_exit", ...})`을 쓴다. 그 다음 새 표지를 `{pid: process.pid, started_at: clock.now()}`로 쓴다.
   - 지우기: shutdown의 `finally`에서 `control.close()` 다음, `lock.release()` 앞. 기동 실패 갈래(`control` 실패, `open()` 실패)도 lock을 풀기 앞에서 지운다. 표지 읽기·쓰기·지우기 실패는 log만 남기고 기동·종료를 막지 않는다.

### 정한 것

- ready 전 writer 죽음은 `exit(1)`이 아니라 기동 실패로 돌려준다. `main.ts`가 stdout에 `start_failed` 줄을 쓰는 길이 남아야 shell이 바로 시작 실패 화면으로 간다. 그 줄 없이 끝나면 ensure가 ready를 60초 기다린다.
- 전체 기한은 90초다. 지금 단계별 기한의 합(server 10초 + 자식 정지 5초씩 + writer close 15초 + 정지 유지보수 30초 = 65초)보다 길어야 정상 종료를 자르지 않는다. 검증 보고의 20초는 정지 유지보수(`packages/core/main/daemon/wiring/storage.ts` `MAINTENANCE_TIMEOUT_MS = 30_000`)를 자른다.
- 표지는 lock을 쥔 동안에만 쓰고 지운다. lock을 푼 뒤 지우면 그 사이 lock을 잡은 다음 core의 표지를 지운다. 표지는 log에만 쓰고 liveness에 쓰지 않는다(platform "지키는 것" 7: liveness는 identify 하나다). data root `run/` 안의 새 file이라 migration은 없다.
- `packages/core/diagnostics/components.ts`의 writer 생존 확인은 하지 않는다. `/readyz`를 읽는 shell 쪽이 없고, 죽으면 core가 끝난다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음. writer 죽음을 보는 test는 Worker를 띄워야 하는데 사람이 아직 답하지 않았다(README "사람이 정할 것" 1). `openRuntime`은 Worker를 바꿔 끼울 길이 없다(`openProductWriter`가 `new Worker(...)`를 직접 부른다). 그 길을 test만을 위해 만들지 않는다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴을 따른다.

- 등록할 것: 없음(test file을 더하지 않는다).
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음".
- **알려진 미완 동작**: 예를 들어 Worker test가 없어 세 길(exit, error, 연결 fault)을 손으로만 확인한 것. 없으면 "없음".
