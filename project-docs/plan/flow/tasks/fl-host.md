# fl-host

flow process를 띄우고 이끄는 host. instance마다 sandbox 안에서 process 하나를 띄우고, stdin·stdout JSON 줄로 SDK의 요청(agent, tool, report)을 받아 core 일로 옮기고, stderr를 log file에 redaction을 거쳐 남기고, 끝나면 `programExited`를 부른다. `core/main`의 새 module과 새 wiring이다.

- 단위: host (wave 3)
- 선행: fl-workflows, fl-runs. 이 둘이 `WorkflowService.programExited`와 `RunService.cancelOfInstance`, `InstanceOrigin`을 내놓는다.
- 소유(이 task만 고친다):
  - `packages/core/main/flow-host/flags.ts` (새 file)
  - `packages/core/main/flow-host/flags_test.ts` (새 file)
  - `packages/core/main/flow-host/channel.ts` (새 file)
  - `packages/core/main/flow-host/host.ts` (새 file)
  - `packages/core/main/daemon/wiring/flows.ts` (새 file)
- 읽을 것:
  - 계획: `project-docs/plan/flow/README.md`의 "process", "SDK", "자격", "instance와 줄", "위험 test"
  - architecture: `project-docs/architecture/run.md`("시작"의 origin, 끝을 아는 법의 `WaitRun`, "취소"), `project-docs/architecture/app-call.md`, `project-docs/architecture/layers.md`(core/main은 조립 자리, 업무 규칙은 module. module은 `core/main`을 import하지 않는다), `project-docs/architecture/activation.md`(앱 process의 sandbox flag)
  - 본보기(flag): `packages/core/apps/permissions/flags.ts`의 `appFlags`·`FIXED`·`single`(flag 모양, 정렬, 쉼표·제어 문자 거절). `--quiet`까지 `FIXED`를 그대로 따른다.
  - 본보기(argv·env·spawn): `packages/core/apps/runtime/processes/spawn.ts`의 `appArgv`(flag 뒤 `--import-map=`, 그 뒤 entry)·`appEnv`(HOME, DENO_DIR, XDG_CACHE_HOME, PATH만), `packages/core/main/app-supervisor/spawn.ts`의 `spawnApp`(`spawnProcess` 호출과 stdin 쓰기), `packages/core/supervision/responsiveness/process.ts`의 `spawnProcess`·`Spawned`(`exited`는 신호로 죽으면 null, `terminate()`는 process group 전체를 SIGKILL하고 확인한다. leader가 스스로 끝나도 같은 경계를 지난다. stdin 쓰기는 child가 죽으면 reject한다)
  - 본보기(줄 읽기·log): `packages/core/apps/runtime/observations/stream-decoder.ts`의 `createStreamDecoder`·`drain`(줄 상한을 넘으면 그 줄을 통째로 버리고 `onDropped`), `packages/core/apps/runtime/observations/log-file.ts`(log file을 줄로 덧붙이고 상한에서 돌리는 꼴. 앱 전용 경로라 쓰지는 않고 꼴만 본다)
  - 본보기(redaction): `packages/core/main/daemon/wiring/workflows.ts`의 `createProductRedactor(ctx.knownSecrets)` 쓰임(`redact(source, "text/plain", text)`가 `null`이면 redaction이 끝나지 못한 것이다. 그 글은 쓰지 않는다). `app-supervisor/log-redact.ts`의 `lineRedactor`는 app supervisor의 `KnownSecretRegistry` 용이라 쓰지 않는다.
  - 본보기(wiring): `packages/core/main/daemon/wiring/jobs.ts`(`ctx.runService.wait` 되풀이, `closing` 때 멈춤, `closeWork`), `wiring/runs.ts`(`placeOfAgentRef`, `closeIntake`), `wiring/workflows.ts`, `wiring/context.ts`(`Late`, `WiringFactory`의 `build`·`closeIntake`)
  - SDK 쪽 약속: `project-docs/plan/flow/tasks/fl-sdk.md`(`entry.ts`가 stdin EOF에 스스로 끝나고, `console`을 stderr로 돌리고, 끝나기 전에 보낸 요청의 응답을 기다린다)
  - 안 쓰는 것: `createSupervisor`(끝난 child를 다시 띄우고 stdout을 frame 통로로 쓴다)
- 계약:
  - 쓰는 것: `flow-wire.ts`(요청·응답·start 메시지, `FLOW_SDK_NAME`·`FLOW_SDK_VERSION`·`FLOW_ENTRY_FILE`), `WorkflowFlows`와 `Late.flowHost`, `ctx.runService.start/wait/cancelOfInstance`, `ctx.workflowService.report(input, {kind: "program"})`/`programExited`, `InstanceOrigin`(creator는 그 project PM: `{role: "project_manager", project}`, place `{kind: "project", id: project}`), `packageInstallPath`(SDK 설치 사본 위치), `workflowFolder`·`WORKFLOW_FLOW_FILE`(`packages/protocol/workflows/paths.ts`).
  - 내놓는 것: `ctx.provide("flowHost", host)`. host는 `WorkflowFlows`(`launch`, `stop`)를 구현한다.

## 정한 것 (이 brief가 정했다. 까닭 없이 바꾸지 않는다)

- 위치: log는 `<data>/flows/<instance>.log`, 공용 import map은 `<data>/flows/import-map.json`이다. 둘 다 `host.ts` 안의 상수 `${dataRoot}/flows` 아래다. PM이 쓰는 workflow 폴더(`<data>/projects/<prj>/workflows/…`)와 SDK 읽기 범위(`<data>/sdk`) 밖이라 flow process가 읽지 못하고, `<data>/logs`(diagnostics가 이름 규칙으로 읽는 자리)와도 섞이지 않는다.
- 통로 줄 상한: process → core 한 줄은 `FLOW_LINE_MAX_BYTES = 1 MiB`다(가장 큰 요청은 agent prompt+input이고 run의 메시지 상한이 `MESSAGE_CONTENT_MAX_BYTES` 240 KiB라 넉넉하다). 넘으면 `createStreamDecoder`가 줄을 버리고 `onDropped`가 부르니 그것도 틀린 줄이다. core → process 응답에는 상한을 두지 않는다(core는 믿는 쪽이다).
- stderr 끝: 마지막 10줄, 줄마다 500자까지, 줄바꿈으로 이은 글(대략 5 KB 아래)이다. redaction을 거친 줄만 쌓는다. `program_exited` 줄의 글은 `fl-workflows`의 `withStepText`가 한 번 더 거르지만(마지막 관문) host도 여기서 먼저 거른다. 상한은 계약에 없다(`stderr_tail: string`). 위 크기가 그 상한을 대신한다.
- log file: 줄마다 `<clock.now()> <redaction한 줄>`을 덧붙인다. 한 instance가 1 MiB를 넘게 쓰면 `[log truncated]` 한 줄을 남기고 더 쓰지 않는다(stderr를 쏟아내는 code가 디스크를 채우지 않게. 돌려 쓰기는 하지 않는다). redaction이 `null`이면 그 줄 대신 `[line withheld: redaction not ready]`를 쓴다.
- 환경: `appEnv({home, denoDir, xdgCacheHome, path})`에 core의 `HOME`, `DENO_DIR`, `XDG_CACHE_HOME`, `PATH`만 넘긴다(core의 allow-env에 있는 이름이다. `wiring/supervision.ts`가 같은 꼴로 읽는다). 값이 없으면 키를 넣지 않는다. deno 실행 파일은 `Deno.execPath()`다(core가 `--allow-run`으로 허락받은 것이 `/usr/bin/kill`과 deno binary뿐이라 이 둘 밖의 것은 띄울 수 없다. 이 task도 새 실행 허락을 요구하지 않는다).
- import map: `devImportMap({"@lophn/flow": "lophn-sdk:@lophn/flow@1.0.0/mod.ts"}, dataRoot, dataRoot)`다. **끝의 `/mod.ts`가 필요하다.** `lophn-sdk:@lophn/flow@1.0.0`만 쓰면 설치 사본 폴더 URL로 풀려 `import "@lophn/flow"`가 깨진다(앱 template의 `deno.json.tmpl`이 모두 `/mod.ts`를 쓴다). 상대 경로 값이 없으니 appDir 인자는 영향이 없고, 내용이 instance와 무관해서 파일 하나를 처음 launch 때 한 번 쓰고 다음부터 쓴다(동시 launch가 같은 파일을 덮어쓰지 않게 만든 promise를 재사용한다).
- 종료 때 정리: `close()`는 새 launch를 막고 남은 process를 모두 `terminate()`한다. **이때는 `programExited`와 `cancelOfInstance`를 부르지 않는다.** 꺼지는 중인 ledger에 쓰지 않고, instance는 `running`으로 남아 다음 기동 때 `flow_restarted`로 닫힌다(`fl-workflows`의 reconcile). core가 갑자기 죽어도 같다. 그때 flow process는 stdin EOF로 스스로 끝난다(`fl-sdk`).
- process가 스스로 끝났거나 죽으면(멈춤이 아닌 때도) 그 instance가 연 `running` run을 `cancelOfInstance`로 닫는다. 주인 없는 agent run이 계속 도는 것을 막는다. 멈춤(`stop`)과 같은 길이다.
- 시간 한도는 두지 않는다(오래 도는 flow가 정상이다). 멈추는 길은 `StopWorkflow`뿐이다.

## 할 일

1. `flags.ts`: 순수 함수를 둘 낸다. Result(`packages/base`)를 돌려준다.
   - `flowFlags({workflowFolder, sdkRoot}): Result<string[]>`. 고정 flag `--no-prompt --no-config --no-remote --no-npm --cached-only --no-lock --quiet`(`appFlags`의 `FIXED`와 같은 순서·같은 이름)와 `--allow-read=<workflowFolder>,<sdkRoot>` 하나. 쓰기, 네트워크, `--allow-run`, `--allow-env`, `--allow-all`, `--allow-sys`, `--allow-ffi`, `--allow-import`는 만들지 않는다. 경로에 쉼표나 제어 문자가 있으면 `invalid_input`(`appFlags`의 `single`과 같은 규칙. 한 flag 값이 두 항목으로 갈라져 허락 범위가 넓어지는 것을 막는다).
   - `flowArgv({workflowFolder, sdkRoot, importMap, entry, flow}): Result<string[]>`. `["run", ...flowFlags, "--import-map=<importMap>", entry, flow]`. flag가 entry 뒤로 가면 Deno가 program 인자로 읽어 sandbox가 사라지므로 순서를 이 한 곳에서 정한다.
   - 근거: `activation.md`의 앱 sandbox와 같은 꼴, README "process".
2. `flags_test.ts`: 위험 test(아래 "끝남"). 표로 돈다.
3. `channel.ts`:
   - `FLOW_LINE_MAX_BYTES`.
   - `readRequests(stdout, handlers)`: `drain(stdout, createStreamDecoder({maxLineBytes: FLOW_LINE_MAX_BYTES, onLine, onDropped}))`. `onLine`은 먼저 `JSON.parse`한다. 두 갈래다.
     - 통로가 깨진 것: JSON이 아니거나, 객체가 아니거나, 문자열 `id`가 없거나, 줄이 상한을 넘어 버려졌다(`onDropped`). `handlers.bad(reason)`를 한 번만 부르고 그 뒤 줄은 무시한다. host는 process를 끝낸다.
     - 요청의 값이 틀린 것: `id`는 읽혔지만 `flowRequestSchema.safeParse`가 실패한다(모르는 `type`, 길이·모양이 틀린 `step`·`text` 등). 통로는 멀쩡하므로 process를 죽이지 않고 `handlers.invalid(id, message)`로 `{ok: false, reason: "invalid_input", message}` 응답을 쓰게 한다. SDK는 zod 없이 손 사본이라 PM의 code가 보낸 값을 미리 다 검사하지 못한다. 오타 하나로 flow 전체가 죽지 않고 code가 값으로 받아 처리하게 하려는 것이다("실패는 값").
     - 통과하면 `handlers.request(req)`. EOF까지 돌고 resolve한다. `drain`은 pipe 오류도 끝으로 삼으므로 host가 "stdout이 끝났는데 process가 안 끝났다"를 따로 본다(할 일 6).
   - `createWriter(stdin)`: `start(message)`, `response(message)`가 `JSON.stringify(message) + "\n"`을 쓴다. 여러 요청이 동시에 응답하므로 쓰기를 promise 줄로 직렬화한다(줄이 섞이지 않게). child가 이미 죽어 `write`가 reject해도 던지지 않고 삼킨다(그 instance는 `exited`가 정리한다).
   - 근거: README "process"("통로에 틀린 줄이 오면 그 instance의 process를 끝낸다"). 값이 틀린 요청은 "틀린 줄"이 아니라 값 오류로 읽는다(위 설명, 보고의 "정한 것"에 적는다).
4. `host.ts`의 `createFlowHost(deps)`와 `launch`:
   - deps: `dataRoot`, `deno`, `env`, `clock`, `runs`(`start`·`wait`·`cancelOfInstance`만 쓰는 좁은 type), `workflows`(`report`·`programExited`만), `redact(line): string | null`. 반환은 `WorkflowFlows & {close(): Promise<void>}`.
   - `launch({instance, project, workflow, input})`: 이미 같은 instance가 있거나 `close()`가 불렸으면 `conflict`/`unavailable`. `flowArgv`(workflowFolder = `workflowFolder(dataRoot, project, workflow)`, sdkRoot = `${dataRoot}/sdk`, entry = `${dataRoot}/${packageInstallPath(FLOW_SDK_NAME, FLOW_SDK_VERSION).value}/${FLOW_ENTRY_FILE}`, flow = `${workflowFolder}/${WORKFLOW_FLOW_FILE}`)가 err면 그대로 돌려준다. import map(위 "정한 것")과 `<data>/flows/`를 만들고, `spawnProcess({command: deno, args, env})`를 `try`로 감싼다(던지면 `unavailable`. 이 환경은 process group 강제가 linux 밖이면 던진다). 띄운 뒤 첫 줄로 `{type: "start", instance, input}`를 쓴다. 쓰기가 실패하면 `terminate()`하고 err. 성공하면 ok를 돌려주고 process가 끝나기를 기다리지 않는다.
   - 띄운 process마다 상태(child, 직렬 report 줄, stderr 끝, 닫는 중 표시)를 `Map<instance, …>`에 둔다. 전역 mutable 상태를 두지 않는다(`createFlowHost`의 닫힘 안).
   - `spawnProcess`를 쓰고 `createSupervisor`는 쓰지 않는다. 재시작이 없고 stdout을 JSON 줄에 쓰기 위해서다.
5. 요청 처리(`host.ts`): process가 이미 끝났으면(exited 표시) 요청을 버린다.
   - `agent`: `runs.start({kind: "agent", agent, prompt, input?, schema?}, origin)`. `tool`: `runs.start({kind: "tool", app, tool, input?}, origin)`. origin은 `InstanceOrigin` `{instance, creator: {role: "project_manager", project}, creator_place: {kind: "project", id: project}}`이다. **instance·project는 host가 그 process의 것으로 채운다.** 요청 본문에서 받지 않고 process에 credential도 주지 않는다(README "origin과 flow 자격은 route 입력이 아니다").
   - 시작이 err(`invalid_input`, `not_found`, `forbidden` 등)면 `{ok: false, reason: error.code, message}`를 돌려준다. 던지지 않는다.
   - 시작이 ok면 `runs.wait(run.id, RUN_WAIT_MAX_MS)`(`packages/protocol/runs`)를 `running`이 아닐 때까지 되풀이한다. 매 바퀴 앞에서 process가 끝났거나 host가 닫는 중이면 멈추고 응답을 쓰지 않는다. `wait` 자체가 err면 그 code로 `ok: false`. 끝난 run은 `done` → `{ok: true, result: run.result}`, `failed` → `{ok: false, reason: run.error.reason, message: run.error.message}`, `cancelled` → `{ok: false, reason: "cancelled", message}`.
   - `report`: `workflows.report({instance, step, text, next?}, {kind: "program"})`. 같은 process의 report는 promise 줄로 **순서대로** 하나씩 처리한다(step 순서가 의미를 갖는다). agent·tool은 동시에 돌아도 된다(SDK가 `Promise.all`로 부를 수 있다). 결과는 ok → `{ok: true, result: null}`, err → `{ok: false, reason: error.code, message}`. 이 문장 말고 service에 판정을 더하지 않는다(lophn은 report를 믿고 기록할 뿐이다).
   - 응답은 `{type: "response", id: <요청 id>, outcome}`.
   - 근거: `run.md`(시작의 origin, `WaitRun` 60초, 끝을 아는 법), README "SDK"·"자격".
6. stderr와 끝(`host.ts`):
   - stderr는 `drain(child.stderr, createStreamDecoder(...))`로 줄을 읽는다. 줄마다 `redact`를 거쳐(`null`이면 위 "정한 것"의 대체 글) log file에 덧붙이고 끝 10줄에 쌓는다. 쓰기 오류는 삼킨다(log 실패가 flow를 멈추지 않는다. `createAppLogFile`과 같은 태도). 상한을 넘은 줄(`onDropped`)은 무시한다.
   - stdout이 먼저 끝났는데(EOF나 pipe 오류, 틀린 줄) process가 살아 있으면 `terminate()`한다. 틀린 줄(`bad`)도 같다. 사유는 stderr log에 `[lophn] channel closed: <reason>` 한 줄로 남긴다(끝 stderr 줄에 실려 PM이 본다).
   - `child.exited`가 오면 순서대로: ① stdout·stderr drain이 끝나기를 기다린다(`exit`이 마지막 data보다 먼저 올 수 있다. `pipe.ts` 주석), ② 쌓인 report 줄이 비기를 기다린다(마지막 report가 `program_exited` 앞에 남게), ③ `close()` 중이면 여기서 정리만 하고 끝낸다, ④ `runs.cancelOfInstance(instance)`, ⑤ `workflows.programExited({instance, code, stderr_tail})`(`code`는 `exited`가 준 값 그대로, 신호면 null), ⑥ Map에서 지운다. 오류는 삼키되 `console.error`가 아닌 log file에 한 줄 남긴다. 다시 띄우지 않는다.
7. `stop(instance)`와 `close()`:
   - `stop`: Map에 없으면 ok. 있으면 `terminate()`를 기다리고, `runs.cancelOfInstance(instance)`(best-effort, 오류 삼킴). `terminate()`가 `false`면(group 소멸 미확인) `unavailable` err를 돌려준다. `programExited` 줄은 위 6의 `exited` 길이 남긴다(service가 먼저 `stopped`로 닫았으므로 줄만 남는다).
   - `close()`: 닫는 중 표시를 켜고 남은 process를 모두 `terminate()`하고 끝나기를 기다린다.
8. `wiring/flows.ts`: `flowsWiring: WiringFactory`.
   - `build(ctx)`: `createFlowHost`를 만든다. `dataRoot: ctx.root.path`, `deno: Deno.execPath()`, `env: appEnv({home, denoDir, xdgCacheHome, path})`(`Deno.env.get`으로 읽는다), `clock: ctx.clock`, `runs: ctx.runService`, `workflows: ctx.workflowService`, `redact`는 `createProductRedactor(ctx.knownSecrets)`를 `{concern: "flows", revision: "1", scope: "stderr"}`, `"text/plain"`으로 부르는 한 줄 함수다. 그 뒤 `ctx.provide("flowHost", host)`하고 `ok({})`.
   - `closeIntake`에서 `host.close()`. 새 launch를 막고 process를 끄는 일을 server가 서기·내려가기와 무관하게 가장 먼저 하려는 것이다.
   - `ctx.runService`·`ctx.workflowService`는 `runsWiring`·`workflowsWiring`이 `build`에서 낸다. 그래서 `flowsWiring`이 그 뒤에 있어야 한다. `workflowsWiring`은 `ctx.flowHost`를 부를 때 읽는 어댑터로 쓴다(`fl-workflows`).
   - 업무 규칙은 두지 않고 연결만 한다(`layers.md`).

## 등록할 것

lead가 merge 뒤 고친다.
- `packages/core/main/daemon/assembly.ts`의 `WIRINGS`에 `flowsWiring`을 `workflowsWiring` 뒤, `jobsWiring` 앞에 더하고 import 줄을 더한다. 이 목록 앞쪽의 순서 설명 주석(runs·workflows는 router 뒤, jobs는 runs·workflows 뒤)에 "flows는 workflows 뒤, jobs 앞"을 한 줄 더한다.
- `project-docs/module-catalog.yaml`: `packages/core/main`(boundary `core`)이 이미 이 폴더를 덮는다(세분도가 `packages/core/` 바로 아래 module까지라 `packages/core/main/flow-host`와 `packages/sdk/flow`는 항목이 필요 없다. `tools/check-modules.ts`가 요구하지 않는다). 원하면 `core/main`의 notes에 "flow-host: flow process를 띄우는 host"를 덧붙인다. boundary-catalog에는 새 boundary가 없다(`workflows` 설명에 flow 시작이 들어가는 것은 wrap 때 lead의 문서 일).
- `Late.flowHost`와 `LATE_KEYS`는 `fl-contract`가 이미 더했다.

## 끝남

- `deno task check`가 통과한다. process를 띄우는 새 test는 만들지 않는다(사람에게 먼저 묻는다). 띄우는 쪽은 `project-docs/plan/tools/lead/boot.sh`로 core가 뜨고 꺼지는지만 본다(`flowsWiring`이 `WIRINGS`에 들어가 있어야 이 확인이 host를 거친다. 아직 없으면 보고에 적는다).
- 위험 test (`flags_test.ts`): "flow process의 deno flag는 workflow 폴더와 SDK 폴더 밖을 읽거나 어디에도 쓰거나 네트워크·run·env를 허락하지 않는다(flag를 만드는 순수 함수의 결과로 본다. process는 띄우지 않는다)." 표로 본다:
  - `flowFlags`의 결과 이름 집합이 고정 flag 일곱과 `--allow-read` 하나뿐이다. 값은 정확히 `[workflowFolder, sdkRoot]`다.
  - `--allow-write`, `--allow-net`, `--allow-run`, `--allow-env`, `--allow-all`, `-A`, `--allow-sys`, `--allow-ffi`, `--allow-import`로 시작하는 것이 없다.
  - 경로에 쉼표나 줄바꿈이 있으면 `invalid_input`이다.
  - `flowArgv`에서 모든 flag(와 `--import-map`)가 entry보다 앞이고 마지막 둘이 entry, flow 경로다.
- 남지 않음: 해당 없음(새 file만). 다만 `grep -rn "createSupervisor" packages/core/main/flow-host`가 0줄이다.
- 손으로 한 번(남기지 않는다): 개발 core에서 `kind: flow` workflow 하나를 시작해 보면 좋다. 한다면 `.dev-data/`만 쓰고 사람의 `~/.lophn`은 건드리지 않는다. 이 task의 필수는 아니다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 위 "등록할 것"을 확인하고, 빠진 것이 있으면 더한다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다(예: `program_exited`의 `stderr_tail`에 상한이 필요한지)
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 알려진 것: workflow 폴더 안에 폴더 밖을 가리키는 symlink가 있으면 `--allow-read`가 따라간다(`appFlags`는 `--deny-read`로 막지만 여기서는 막지 않는다. PM이 symlink를 만들 길이 아직 없어 두었다). flow process에 CPU·메모리·시간 한도가 없다.
