# shell-core-connection

core가 ready 뒤 금세 끝나기를 되풀이하면 shell이 backoff로 다시 띄우다가 다섯 번째에 시작 실패 화면에 멈춘다. 두 번째 shell process는 single-instance lock을 잡기 전에 core를 건드리지 않고, Quit·`Stop lophn` 중에 돌던 ensure는 core를 새로 띄우지 않는다. 이슈 `second-shell-touches-core-before-lock`, `quit-ensure-restarts-core`를 닫는 task다.

- 단위: shell (wave 1)
- 선행: 없음. `core-lifetime`과 같이 land한다(README "돌리기 전에").
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/core/{connection,supervise}.ts`
  - `packages/shell/main/desktop/{main,single-instance}.ts`
  - `packages/shell/main/desktop/wiring/desktop.ts`
  - `packages/protocol/client/ensure.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/platform.md`의 "core 수명"과 "지키는 것" 7, 8(Quit은 core를 끄지 않는다, 명시 stop 뒤 shell이 저절로 다시 띄우지 않는다)
  - 이슈: `project-docs/issues/second-shell-touches-core-before-lock.yaml`, `project-docs/issues/quit-ensure-restarts-core.yaml`(`fix` 칸이 추천이다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `core-control-protocol`, `project-docs/module-catalog.yaml`의 `packages/shell/main`(boundary `shell`), `packages/protocol`(`protocol`)
  - `project-docs/products/roadmap/failure-hardening.md`: runtime #9(heartbeat, "core가 답하지 않는다" 상태)와 #22(`packages/shell/main/desktop/core/login-path.ts`)는 넣지 않는다
- 계약:
  - 쓰는 것: renderer로 가는 연결 상태 `ConnectionState`(`packages/shell/ipc/core.ts`)는 바꾸지 않는다. 지금 있는 `failed-start`와 그 화면의 Retry(`retryConnection`이 core call을 하나 보내 `attachIfAlive` → `recover()`로 간다)를 그대로 쓴다.
  - 내놓는 것: 재시작 상한. core가 Gateway ready 뒤 `STABLE_MS` 안에 끝나기를 다섯 번 이어 하면 shell이 다시 띄우지 않고 `failed-start`에 멈춘다. `core-lifetime`(writer가 죽으면 core `exit(1)`)이 이 상한에 기댄다. `ensureCore`의 새 선택 입력 `signal`(CLI는 넘기지 않는다).

## 할 일

1. core 재시작 상한(rt #8). 지금 `packages/shell/main/desktop/core/connection.ts`의 Gateway `stale` sink는 매번 `setTimeout(recover, RECOVER_DELAY_MS)`(1초)를 걸고 `recover()` → `attach()` → `control.ensure()`가 core를 다시 띄운다. 새 core가 ready까지 갔다가 또 죽으면 1초 + 기동 시간마다 영원히 되풀이된다.
   - `startCoreConnection` 안에 `crashes`(수)와 `readyAt`(Gateway `ready` sink가 `options.clock.now()`로 채운다)를 둔다.
   - `stale` sink(`shutdownSeen`이면 지금처럼 아무것도 안 한다): `readyAt`이 있고 지금과의 차이가 `STABLE_MS = 60_000` 이상이면 `crashes = 0`. 그 다음 `crashes += 1`, `readyAt = undefined`. `crashes >= RESTART_LIMIT`(5)이면 `fail()`(이유 없음 → `failed-start`)하고 다시 띄우지 않는다. 아니면 `RECOVER_DELAY_MS * 2 ** (crashes - 1)`(1, 2, 4, 8초) 뒤 `recover()`.
   - Retry(`attachIfAlive`가 `failed-start`에서 `recover()`)는 `crashes`를 0으로 돌리지 않는다. Retry 한 번이 시도 한 번이고, 그 core가 또 금세 죽으면 바로 `failed-start`다. 오래 산 core의 crash는 위의 `STABLE_MS` 규칙이 0으로 돌린다.
   - ensure 자체의 실패는 지금처럼 `attach()`가 `fail()`로 보낸다.
2. lock보다 먼저 core를 건드리는 두 번째 shell(rt #12, 이슈 `second-shell-touches-core-before-lock`). 지금 `packages/shell/main/desktop/main.ts` `startDesktop`의 `createShellContext()` → `connectCore` → `startCoreConnection`이 끝에서 `void recover()`(identify, ensure)를 부르고, lock은 그 뒤 `desktop.register`의 `startSingleInstance`가 잡는다. 곧 끝날 두 번째 process가 core를 띄우거나 판이 다르면 갈아 띄운다.
   - `packages/shell/main/desktop/single-instance.ts`의 `startSingleInstance`를 둘로 나눈다: lock만 잡는 것(`requestSingleInstanceLock({dataRoot})`, 못 잡으면 `app.quit()`하고 false)과 `second-instance` listener를 다는 것(지금 intent 처리 그대로).
   - `main.ts` `startDesktop` 맨 앞(`createShellContext()` 앞)에서 lock을 잡는다. 못 잡으면 아무것도 조립하지 않고 돌아간다. `dataRoot`는 `resolveDataRoot()`(`packages/shell/main/desktop/paths.ts`, 이미 import돼 있다)로 얻는다.
   - Electron의 single-instance lock은 userData 폴더에 걸린다. 그래서 `packages/shell/main/desktop/wiring/desktop.ts`의 `app.setPath("userData", browserDataPath(dataRoot))`를 lock 앞으로 같이 옮긴다(session이 생기기 전이라는 지금 조건도 지킨다). `registerViewSchemes(protocol)`은 그 자리에 둔다.
   - `desktop.ts`는 listener만 단다. `instance.acquired` 분기는 늘 참이 되므로 지운다.
   - `ensureCoreOnly()`(`--core`)는 지금처럼 lock 없이 ensure한다(platform.md "autostart는 core만 띄운다").
3. Quit 중의 ensure(rt #12, 이슈 `quit-ensure-restarts-core`). 지금 `recover()`/`ensureCore`는 취소할 길이 없어, `detach()`(일반 Quit)나 `stopCore()`(`Stop lophn`)가 `stopped`만 세운 뒤에도 돌던 ensure가 core를 띄운다. 시작 중 `Stop lophn`은 control stop이 `unavailable`로 돌아와 성공으로 쳐지고 막 뜬 core가 남는다.
   - `packages/protocol/client/ensure.ts`의 `EnsureOptions`에 `signal?: AbortSignal`을 더한다. `startAndJoin`의 `deps.spawnDetached` 바로 앞과 `ensureCore`의 판 교체 `controlStop` 바로 앞에서 `signal?.aborted`면 `err({code: "unavailable", message: ...})`로 끝난다. `waitReady`는 끊지 않는다(이미 띄운 core가 ready가 되어야 아래의 stop이 닿는다).
   - `packages/shell/main/desktop/core/supervise.ts`의 `ShellCoreControl.ensure`가 선택 인자 `signal`을 받아 `ensureCore` options로 넘긴다.
   - `connection.ts`: `AbortController` 하나를 두고 `attach()`가 `control.ensure(controller.signal)`을 부른다. `detach()`와 `stopCore()`가 `abort()`한다.
   - `stopCore()`: abort 뒤 `recovering`이 있으면 끝나기를 기다린 다음 `control.stop()`을 보낸다. 이미 띄운 core는 ready가 된 뒤 멈추고, 띄우기 전이었으면 stop이 "core 없음"(성공)으로 끝난다.
   - CLI(`packages/cli/connection/core.ts`의 `ensureAndJoin`)와 `ensureCoreOnly()`는 signal 없이 부르고 그대로 compile된다.

### 정한 것

- 상한 값: ready 뒤 60초 안의 끝남을 다섯 번 세면 멈춘다. backoff는 1, 2, 4, 8초다. 계획의 확인 목록("core를 kill하면 다시 뜨고 다섯 번이면 시작 실패 화면인가")과 맞춘다.
- Retry가 counter를 비우지 않는다. renderer의 core call 어느 것이든 `failed-start`에서 `recover()`로 가므로, 비우면 화면 뒤의 call 하나가 상한을 풀어 버린다.
- signal은 spawn 앞과 판 교체 stop 앞에서만 본다. 앞의 것이 이슈의 추천이고, 뒤의 것은 Quit 중에 돌던 ensure가 다른 판 core를 멈추지 않게 하는 같은 한 줄이다.
- heartbeat와 "core가 답하지 않는다" 상태(rt #9)는 넣지 않는다. 연결 상태 IPC 모양을 바꾸지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음. `startCoreConnection`은 control을 안에서 직접 열어(`openShellCoreControl`) 가짜로 바꿀 수 없고, 상한·Quit 동작은 화면·process 수명이라 lead의 설치본 확인 목록이 본다.
- 남지 않음: `grep -rn "startSingleInstance" packages tools tests`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴을 따른다.

- 등록할 것: 없음. 이슈 둘은 lead가 닫는다.
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음".
- **알려진 미완 동작**: 예를 들어 `failed-start` 동안 Retry 밖의 renderer core call이 core를 다시 띄우는 곳을 찾았다면 그 자리. 없으면 "없음".
