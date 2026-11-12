# runtime-children

agent runtime process가 끝날 때 아직 도는 `shell.run` 자식의 process group을 죽이고, 시간 초과로 죽인 shell 명령을 결과 불명(`uncertain`)으로 돌려준다. 감독이 agent runtime을 포기하면 log를 남기고 한 번 다시 띄운다.

- 단위: core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/shell/{run,run_test}.ts`
  - `packages/core/lophn-agent/run-loop/runtime.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/platform.md`의 "process와 IPC"(child tree 끄기, agent shell tool)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `child-supervision-protocol`, `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`(boundary `lophn-agent`), `packages/core/main`(`core`), `packages/core/supervision`(`supervision`)
  - `project-docs/products/roadmap/failure-hardening.md`: runtime #1(turn 밖 예외의 fail-fast), #5, #17은 넣지 않는다
- 계약:
  - 쓰는 것: `killTree`, `treeSpawnOptions`(`packages/core/supervision/security/tree-kill.ts`). `ChildCallbacks.onGiveUp`(`packages/core/supervision/responsiveness/slot.ts`), `Supervisor.updateSpec`(`packages/core/supervision/responsiveness/supervisor.ts`: `unavailable` slot에도 된다). tool 결과 status `uncertain`(`packages/protocol/lophn-agent/tool-values.ts`).
  - 내놓는 것: 없음.

## 할 일

1. agent runtime이 끝날 때 `shell.run` 자식 정리(rt #4). 지금 `packages/core/lophn-agent/tools/shell/run.ts`의 `runCommand`는 `/bin/sh -c`를 새 session(`treeSpawnOptions`)으로 띄우고, group을 죽이는 것은 timeout과 `ctx.signal` abort뿐이다. 그 listener는 runtime process 안에 있어서 crash handler의 `exit(1)`, graceful stop, 감독의 group SIGKILL로 runtime이 끝나면 자식은 최대 600초 더 돈다.
   - `ShellDeps`에 `onExit(hook: () => void): () => void`(process가 끝날 때 동기로 부를 hook 등록, 돌려준 함수가 푼다)를 더한다. `processShellDeps()`는 `process.on("exit", hook)` / `process.off("exit", hook)`로 채운다.
   - `runCommand`는 spawn이 pid를 얻은 바로 뒤 `deps.onExit(() => killTree(child, deps.platform))`을 걸고, `exited`가 풀리면 푼다(`clearTimeout(timer)` 옆).
   - POSIX의 `killTree`는 `signalTree` 안에서 `kill(-pid, "SIGKILL")`을 첫 `await` 전에 동기로 부르므로 `exit` listener 안에서 된다. Windows는 `taskkill`을 띄우기만 하고 기다리지 않는다.
   - `processShellDeps()`를 쓰는 다른 곳(사람의 `!` 명령: `packages/core/main/daemon/wiring/acp.ts`의 `run: runCommand`, core process에서 돈다)도 같은 규칙을 얻는다. core가 끝나면 도는 `!` 명령도 끝난다.
   - `packages/core/lophn-agent/tools/shell/run_test.ts`의 Windows test가 만드는 `ShellDeps`에 `onExit`를 채운다.
2. 시간 초과한 shell 명령은 결과 불명(tools #19의 shell 쪽). 지금 `runShell`은 시간 초과를 `status: "failure"`로 돌려줘 model이 효과가 없었다고 읽고, `turn.ts`의 `record()`가 `unknown_effects`에 넣지 않는다.
   - `runShell`의 status를 `timedOut ? "uncertain" : stopped ? "failure" : "success"`로 바꾼다. 시간 초과 summary는 효과가 났을 수 있으니 다시 돌리기 전에 확인하라는 뜻을 싣는다(예: `timed out after ${timeoutMs} ms and was killed; it may have already taken effect, check before running it again`).
   - `uncertain` 결과는 `executeToolCall`(`packages/core/lophn-agent/tools/work.ts`)이 outcome `{kind: "uncertain", code: "uncertain"}`로 닫는다. `shell.run`은 effect `external`이라 자동 retry가 없다(`toolMayRetry`). 이 둘은 고치지 않는다.
   - 사람이 멈춘(`stopped`) 명령은 지금처럼 `failure`다.
3. 감독 포기 뒤(rt #7). 지금 agent runtime child가 재기동 한도(1·2·4초, 세 번)를 넘으면 supervisor가 `onGiveUp`을 부르는데 `packages/core/lophn-agent/run-loop/runtime.ts` `startAgentRuntimeChild`의 `callbacks()`에 그 callback이 없다. core는 `ready`로 남고, turn은 돌지 않고, 알림도 다시 띄우기도 없다(diagnostics의 `agent-runtime` component만 불가로 보인다).
   - `callbacks()`가 돌려주는 객체에 `onGiveUp(reason)`을 더한다.
   - `AgentRuntimeDeps`에 `onGiveUp?(reason: string, retry: boolean): void`를 더해 log를 wiring에 맡긴다. `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`가 `ctx.telemetry.logger.error({component: "agent-runtime", event: "gave_up", fields: {reason, retry}})`로 채운다.
   - 다시 띄우기: 포기를 처음 본 때만 `GIVE_UP_RETRY_MS = 60_000` 뒤 `deps.io.updateSpec(agentRuntimeLaunchSpec(), hello, callbacks())`를 한 번 부른다. hello(machine credential 포함)와 `callbacks()`가 이 함수 안에 있어서 다시 띄우기도 여기 둔다. 결과가 `ok`가 아니면 log만 남긴다(`retry_failed`).
   - `AgentRuntimeChild.stop()`(core 종료의 `closeIntake`가 부른다)이 예약한 timer를 지우고, 그 뒤에는 다시 띄우지 않는다. 안 그러면 `stopAll` 뒤에 timer가 child를 새로 띄운다.

### 정한 것

- 살아 있는 자식 목록을 `agent-runtime/main.ts`에서 만들어 넘기지 않고, `ShellDeps.onExit`로 자식마다 exit hook을 건다. `runShell`의 deps는 기본값 `processShellDeps()` 하나로만 오고, 목록을 넘기려면 `packages/core/lophn-agent/tools/bundles/shell.ts`(`SHELL_TOOLS` 상수), `packages/core/main/agent-tools.ts`(`agentTools`), `packages/core/main/agent-runtime/product-driver.ts`(실제 tool 조립)를 같이 고쳐야 한다. 셋 다 이 task 것이 아니다. hook은 deps로 주입되므로 전역 상태가 아니다.
- `run-loop/driver.ts`의 `endAll()`이 도는 turn을 멈추게 하는 길(검증 보고 rt #4의 1)은 하지 않는다. 그 file은 `loop-driver` 것이고, exit hook이 graceful stop도 덮는다(runtime은 `process.exit`로 끝난다).
- `&`로 띄워 `sh`가 먼저 끝난 background 자식은 `exited`가 풀리며 hook을 풀므로 덮지 않는다. 지금도 timeout·Stop이 그것을 죽이지 않는다. 끝난 group 번호를 계속 들고 있다가 죽이면 재사용된 pid group을 죽일 수 있다.
- 사람에게 보이는 알림은 하지 않는다. program notice(`packages/protocol/apps/notice.ts`의 `PROGRAM_NOTICE_KINDS`)에 맞는 종류가 없고(`app_unavailable`은 앱이 있어야 한다) 종류를 더하면 protocol이 바뀐다.
- 다시 띄우기는 core process 하나에 한 번이다. 다시 포기하면 core를 다시 켤 때까지 그대로다. 매번 다시 띄우면 망가진 설치에서 1분마다 세 번씩 crash가 되풀이된다.
- `platform/io` child의 `onGiveUp`은 하지 않는다(rt #7은 agent runtime이 대상이다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음. 자식 정리와 시간 초과는 실제 process를 띄워야 보이고(사람에게 묻는 test), `killTree`가 진짜 `process.kill`을 쓰므로 가짜 pid로 부를 수 없다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴을 따른다.

- 등록할 것: 없음.
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음".
- **알려진 미완 동작**: 적어도 runtime이 SIGKILL·OOM으로 끝나면 hook이 돌지 않아 자식이 남는 것, `&` background 자식, 동시에 도는 shell 명령이 10개를 넘으면 Node가 `MaxListenersExceededWarning`을 한 번 내는 것(본 대로 적는다). 그 밖에 없으면 "없음".
