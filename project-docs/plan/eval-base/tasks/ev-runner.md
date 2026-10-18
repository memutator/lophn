# ev-runner

`deno task eval`의 입구와 trial 하나를 도는 순서를 만든다. 새 data root에서 core를 띄우고, 재료를 되살리고, 진짜 model을 `real`에만 붙여 사람 말을 보내고, 멈출 때까지 기다린 뒤, 수집 → program check → judge → run 요약 쓰기까지 이어 붙인다. 앞선 task가 내놓은 것을 잇는 일이라 새 규칙은 거의 없다.

- 단위: ev-runner (wave 3)
- 선행: ev-versions, ev-restore, ev-provider, ev-collect, ev-checks, ev-judge. 여섯 모두 merge된 export를 읽어 이어 붙인다.
- 소유(이 task만 고친다):
  - `tests/eval/run.ts`
  - `tests/eval/runner/**`
- 읽을 것:
  - 계획: `project-docs/plan/eval-base/README.md`(자리, 정한 것, 계약)
  - 설계: `project-docs/products/roadmap/eval.md`의 "run", "check와 judge", "병렬과 의존", "지켜야 할 것", "끝남 기준"
  - architecture: `project-docs/architecture/testing.md`("`tests/support`", "E2E 실행 폴더"), `project-docs/architecture/agent-call.md`("지키는 것"의 입력함·받은 메시지 항목)
  - 이미 있는 길: `tests/support/core/mod.ts`(`createRun`, `bootCore`, `Core`), `tests/support/core/human.ts`(`openSession`, `say`), `tests/live/run.ts`(key 없을 때 이유를 찍고 0으로 끝나는 진입), `packages/core/main/agent-runtime/product-driver.ts`의 `startTurnPump`
  - 이슈: `project-docs/issues/agent-definition.md`의 "turn 준비가 예외로 끝나면 아무 기록 없이 매 주기 다시 시도한다"
  - 병합된 wave 1·2 코드: `tests/eval/types.ts`와 `tests/eval/{versions,restore,provider,collect,checks,judge,criteria}/mod.ts`. 아래 이름과 다르면 merge된 실제 export를 따른다.
- 계약:
  - 쓰는 것(코드에서 확인한 것):
    - `tests/support/core/mod.ts`: `createRun(): Promise<Run>`(`run.home`, `run.remove()`), `bootCore(run, { settings }): Promise<Core>`, `Core`(`call`, `tryCall`, `stop`, `logPath`, `ids`). core는 env를 비운 채 뜬다(`spawnCore`의 `clearEnv`).
    - `tests/support/core/human.ts`: `openSession(core, agentRef): Promise<string>`, `say(core, session, text)`.
    - `packages/protocol/events/mod.ts`의 `sessionSnapshotsList`(입력 `{}`이면 열린 session 전부): 칸 `session`, `agent`, `state`(`running` | `waiting` | `idle` | `unknown`), `permission_requests`, `questions`. 질문이나 허락 기다림이 있으면 `waiting`, 끝나지 않은 turn이 있으면 `running`, 아니면 `idle`이다(`packages/core/main/daemon/wiring/session-snapshots.ts`).
    - `packages/protocol/lophn-agent/mod.ts`의 `receivedMessageList`(입력 `{ session }`): `messages[].turn`이 `null`이면 아직 turn이 가져가지 않은 입력이다. turn pump는 500ms 주기라(`PUMP_IDLE_MS`) `state: idle`만 보면 방금 온 입력을 놓친다. 그래서 둘을 같이 본다.
    - model 없는 agent는 turn이 `failed`(`configuration_unavailable`, `model_required`)로 바로 닫히고 입력의 `turn`은 채워진다(`closeUnstarted`, `packages/core/lophn-agent/run-loop/prepare.ts`). 그래서 `real`이 아닌 agent가 call을 받아도 기다림이 끝난다. 이는 정상이고 실패가 아니다.
    - `packages/base/mod.ts`: `Clock`(`now`, `nowMs`), `systemClock`, `createIdSource`, `cryptoRandom`.
    - `tests/eval/types.ts`(ev-contract): `Scenario`(`id`, `n`, `proposal`, `world`, `real`, `setup?`, `steps`, `checks`, `fixtures`), `Participant`, `Step`, `SetupContext`, `WorldIds`, `Check`(`ProgramCheck` | `JudgeCheck`), `CheckInput = { trial, core }`, `CheckResult`, `TrialRecord = { index, started_at, finished_at, settle, sessions, metrics }`, `Settle = { kind: "idle" | "timeout"; unstarted: string[] }`, `TrialResult`, `JudgeItem`, `RunRecord`, `SourceInfo`, `VersionRef`, `parseRef(text, kind?)`, `refText(ref)`.
    - ev-restore `tests/eval/restore/mod.ts`: `beginRestore(core): Promise<SetupContext>`(fake provider가 전역 기본 model이 된다), `restoreWorld(ctx, refs): Promise<Result<void>>`(재료마다 hash를 확인하고 `needs` 순서로 되살리며 `ctx.world`를 채운다), `endRestore(ctx): Promise<void>`(전역 기본 model을 `null`로, fake를 닫는다), `agentRefOf(world, participant): AgentRef`(이름 → id 풀이. 직접 쓰지 않는다). `tests/eval/restore/manifest.ts`: `loadMaterial`, `verifyMaterial`(되살리기 전 hash 확인에 쓴다).
    - ev-provider `tests/eval/provider/mod.ts`: `readAnthropicKey(env)`, `evalCoreSettings()`(`bootCore`의 `settings`), `attachRealModels(core, { key, model, real: AgentRef[], endpoint? })`(`secrets/put`, 연결, `settle`, `real`에만 model. 전역 기본 model이 `null`이 아니면 던진다).
    - ev-collect `tests/eval/collect/mod.ts`: `collectSessions({ port: core, readBlob: diskBlobReader(run.home) }, roots, since): Promise<SessionRecord[]>`(`roots`는 runner가 연 session id, `since`는 t0), `metricsOf`, `sumMetrics`, `writeFullRecord(dir, run, trial, value)`.
    - ev-checks `tests/eval/checks/mod.ts`: `runProgramChecks(checks, input): Promise<CheckResult[]>`(async, program만 돌린다), `validateFixtures(scenarios): Promise<{ ok: boolean; problems: string[] }>`(async).
    - ev-judge `tests/eval/judge/mod.ts`: `judgeItem({ fetch, apiKey }, { check, criterion, input, judge }): Promise<JudgeItem>`(던지지 않는다. 인용 검사 포함), `judgePassed(criterion, item)`, `loadJudgeDefinition()`. `tests/eval/criteria/mod.ts`: `loadCriterion(ref)`.
    - ev-versions `tests/eval/versions/mod.ts`: `registerAuthored(dir, ref, hash, content?): Promise<Result<...>>`(scenario, material, criterion, judge는 작성자가 쓴 n이고 registry는 hash가 같은지만 본다. 다르면 `conflict`), `scenarioHash(path)`, `criterionContent`, `judgeContent`, `hashText`, `checksVersion()`, `coreVersion()`, `captureSource()`, `seenComponents(sessions): Promise<Result<VersionRef[]>>`. registry 폴더는 `tests/eval/registry`.
  - 내놓는 것:
    - `tests/eval/run.ts`: `deno run --allow-all --env-file=.env tests/eval/run.ts [옵션]`. lead가 `deno task eval`로 등록한다.
    - 옵션: `--scenario <id>`(여러 번 가능) | `--all`, `--model <name>`(기본 `claude-sonnet-5-5`), `--trials N`(기본 1), `--budget <usd>`(기본 50).
    - 종료 코드: 0 = 끝까지 돌았거나 key가 없어 돌지 않음. 1 = 재료 hash·registry conflict·fixture 확인 실패, 되살리기·provider·core 오류로 멈춤. 2 = 인자 오류.
    - `tests/eval/runner/`의 export: `discoverScenarios()`, `waitUntilIdle(read, deps, options)`, `runTrials(count, runOne, cap)`, `createCap(limitUsd)`. 뒤 계획(`eval-experiment`)이 다시 쓴다.

## 할 일

1. `tests/eval/runner/discover.ts`: `tests/eval/scenarios/` 아래를 `Deno.readDir`로 재귀로 돌며 `*.scenario.ts`를 모아 동적 import하고, 각 module의 `default` export(`Scenario`)를 읽는다. 같은 `id`가 둘이면 멈춘다. 공용 index file을 두지 않는다. 이유: 시나리오 file을 더해도 남의 file을 고치지 않게 하려는 것이다(`@std/fs`는 의존에 없어 직접 돈다). 시나리오의 path도 같이 돌려준다(`scenarioHash`가 쓴다).
2. `tests/eval/runner/idle.ts`: `waitUntilIdle(read, { clock, sleep }, { timeoutMs = 300_000, quietMs = 1_000, pollMs = 250 })`.
   - `read()`는 `{ running: string[]; waiting: {session, questions, permissions}[]; unstarted: {session, message}[] }`를 돌려준다. `running` = `state: running`인 session, `waiting` = `state: waiting`, `unstarted` = `receivedMessageList`에서 `turn === null`인 입력.
   - 조용함 = `running`과 `unstarted`가 모두 빔. `waiting`은 조용함에 든다(`ask` 질문이나 허락을 사람이 답할 때까지 session이 멈추는 것은 L1·A1-ask의 정상 끝이다).
   - 조용함이 `quietMs` 동안 이어져야 `{ kind: "idle", waiting }`을 돌려준다. 이유: pump(500ms)와 reaction이 아직 입력을 turn으로 만들지 않은 틈을 넘기려는 것이다.
   - `timeoutMs`를 넘으면 `{ kind: "timeout", unstarted: [message id와 session id…], running }`을 돌려준다. 이유: turn 준비가 예외로 끝나면 입력이 영영 turn이 되지 않고 기록이 없다(이슈 "turn 준비가 예외로 끝나면…"). 멈춘 이유를 이 값으로만 알 수 있다.
   - `readSnapshot(core)`가 실제 `read`다: `sessionSnapshotsList({})`로 session을 얻고, `agent.role !== "coding_agent"`인 session마다 `receivedMessageList`의 첫 page를 읽는다(판단 case는 입력이 적다).
   - 결과의 `kind`와 `unstarted`가 `TrialRecord.settle`(`Settle`)이 된다. `waiting`이 있으면 stdout에 "ask 대기 ses_…"나 "허락 대기 ses_…"를 한 줄 찍는다(기록 칸은 없다).
3. `tests/eval/runner/trial.ts`: trial 하나. 순서는 README 그대로다.
   1. `createRun()` → `bootCore(run, { settings: evalCoreSettings() })`.
   2. `ctx = await beginRestore(core)` → `restoreWorld(ctx, scenario.world)`(`!ok`면 이유를 담아 던진다) → `await scenario.setup?.(ctx)` → `endRestore(ctx)`. setup은 endRestore 앞이다(ticket 대본이 fake를 쓴다).
   3. `attachRealModels(core, { key, model, real })`. `real`은 `scenario.real.map((p) => agentRefOf(ctx.world, p))`다. 이 뒤에야 진짜 model이 붙는다.
   4. t0 = `clock.now()`를 `started_at`으로 잡고 `steps`를 차례로 실행한다. `say`: 그 참가자의 session이 아직 없으면 `openSession(core, agentRefOf(ctx.world, step.to))`으로 열고(참가자마다 trial 안에서 session 하나, `roots`에 쌓는다), `say`로 보낸다. `untilIdle`: `waitUntilIdle(readSnapshot)`. timeout이면 남은 step은 건너뛴다. t0를 첫 step 직전으로 잡는 이유: collector가 t0 전에 시작한 turn(되살리기·setup이 남긴 것)을 뺀다.
   5. `finished_at`, `collectSessions(...)`(core를 끄기 전에 한다: `ask`의 질문 글은 기다리는 동안에만 읽힌다), `sumMetrics(sessions.map(metricsOf))`로 `TrialRecord`를 만든다.
   6. `runProgramChecks(scenario.checks, { trial, core })`.
   7. judge check마다: `settle.kind === "timeout"`이거나 전제 check(id)가 하나라도 fail이면 judge를 부르지 않고 fail로 두며 이유에 이유를 적는다(timeout, 또는 떨어진 전제 id). 아니면 `check.input({ trial, core })`로 입력을 만들고 `criterion = await loadCriterion(check.criterion)`, `judgeItem({ fetch: fetch, apiKey: key }, { check: check.id, criterion, input, judge })`를 부른다. pass는 `judgePassed(criterion, item)`이고 이유는 verdict와 인용(또는 `item.error`) 한 줄이다. `JudgeItem`은 그대로 `TrialResult.judge`에 넣는다.
   8. `seenComponents(sessions)`로 이 trial이 본 component 목록(`!ok`면 이유를 담아 던진다).
   9. trial 통과 = `settle.kind === "idle"`이고 모든 `CheckResult`가 pass.
   10. `writeFullRecord(".dev-data/eval", runId, index, { trial, judge, source })`(`source`는 `diff`·`untracked` 포함 전체)와 `core.logPath`를 `.dev-data/eval/<runId>/trial-<index>.core.log`로 복사.
   11. `finally`: `core.stop()`, `run.remove()`. 각각 실패해도 다음을 한다.
4. `tests/eval/runner/cap.ts`와 `trials.ts`: `createCap(limitUsd)`(`add(usd)`, `exceeded()`, `total()`)와 `runTrials(count, runOne, cap)`. 각 trial 앞에서 `cap.exceeded()`면 새 trial을 띄우지 않고 `stoppedByCap: true`로 돌아온다. 이미 돈 trial은 버리지 않는다. trial 뒤에 `Metrics.cost_usd`와 judge item의 `cost_usd`를 더한다. `unpriced_calls`가 0보다 크면 한 번 "비용 모르는 call 있음"을 찍는다. 이유: roadmap이 대상 비용과 judge 비용을 합쳐 상한을 지키라고 했다. 병렬 실행은 이 계획에 없다(`eval-experiment`). trial은 차례로 돈다.
5. `tests/eval/run.ts`와 `tests/eval/runner/cli.ts`: `node:util`의 `parseArgs`로 인자를 읽는다(새 의존을 들이지 않는다). 순서:
   1. 시나리오 고르기(`--scenario` 없고 `--all`도 없으면 사용법을 찍고 2로 끝남. 모르는 id는 있는 id 목록과 함께 2).
   2. 고른 시나리오마다 재료를 `loadMaterial` + `verifyMaterial`로 확인하고(되살리기 전 hash 확인), `registerAuthored`로 시나리오(`kind: "scenario"`, `scenarioHash(path)`), 재료(`content_hash`), judge check가 가리키는 criterion(`parseRef(check.criterion, "criterion")`, `hashText(criterionContent(c))`), judge(`loadJudgeDefinition()`, `judgeContent`)를 등록한다. `conflict`나 hash 불일치는 "이름@n의 내용이 바뀌었다. n을 올려라"와 함께 1로 끝난다.
   3. `validateFixtures(scenarios)`를 `await`한다. `!ok`면 `problems`를 찍고 1로 끝난다. 2·3번은 key가 없어도 돈다(worker가 provider 없이 확인하는 길이다).
   4. `readAnthropicKey(Deno.env)`가 없으면 "ANTHROPIC_API_KEY가 없어 진짜 provider를 부르지 않는다. .env에 두면 돈다."를 찍고 0으로 끝난다.
   5. `coreVersion()`, `checksVersion()`, `captureSource()`를 한 번 얻는다. 시나리오마다 `runTrials(N, ...)`.
   6. 시나리오마다 `RunRecord`를 만들어 `tests/eval/runs/<시각>-<id>@<n>-<model>.json`에 쓴다(`JSON.stringify(value, null, 2) + "\n"`, 시각은 `Clock`, 폴더가 없으면 만든다). `components`는 trial들의 `seenComponents` 합집합이고(`kind:name` 정렬, 중복 없이), `grader`는 `{ criteria: [사용한 criterion ref], judge: judge ref 또는 judge check가 없으면 null, checks: checksVersion() }`, `source`는 `{ commit, dirty }`만 담는다(`diff`는 전체 기록 쪽. 요약은 커밋되므로 작게 둔다). 요약에는 key도, 대답 글도, 요청 body도 넣지 않는다. 전체 기록은 `.dev-data/eval/<run id>/`다(run id는 `createIdSource`의 `run` 접두).
   7. 시나리오마다 한 줄을 찍는다: id, trial 통과 수, 떨어진 check id, 비용. 끝에 합계 비용과 상한에 걸려 멈췄는지.
   8. 되살리기·provider·core 오류는 이유를 찍고 1로 멈춘다. 그 시나리오의 요약은 쓰지 않는다(앞서 끝난 시나리오 것은 이미 써 있다). 이유: roadmap "바뀐 checkout에서 되살리기가 깨지면 runner는 이유를 찍고 멈춘다".
6. 시간과 id는 인자로 받는다(`Clock`, `IdSource`, `sleep`). 전역 mutable 상태를 두지 않는다. key는 변수로만 들고 있고 어디에도 찍거나 쓰지 않는다.
7. 진짜 provider 없이 손으로 확인한다: `ANTHROPIC_API_KEY`를 비운 채 `deno run --allow-all tests/eval/run.ts --all`을 돌려, 재료 hash 확인과 fixture 확인이 돌고 0으로 끝나는지, 모르는 `--scenario`가 2로 끝나는지 본다. 진짜 key로 돌리는 확인은 lead가 한다(roadmap "정할 것" 1).

## 끝남

- `deno task check`가 통과한다. `tests/eval`의 `*_test.ts`도 check에서 돈다. 그래서 test는 순수해야 한다(core 부팅, subprocess, 네트워크, 진짜 provider 없음).
- 위험 test(2개, `tests/eval/runner/*_test.ts`):
  - "조용함이 `quietMs` 동안 이어져야 idle이 되고, 입력이 turn이 되지 않은 채 `timeoutMs`를 넘으면 그 입력과 session을 담은 timeout으로 끝난다": `read`와 `Clock`·`sleep`을 가짜로 넣는다. turn 준비 예외로 입력이 영영 안 읽히는 일이 실제로 있었다.
  - "누적 비용이 상한을 넘으면 새 trial을 띄우지 않고 이미 돈 trial은 남긴다": `runOne`을 가짜로 넣는다. 돈이 새는 쪽의 경계다.
- 새 subprocess·서버·브라우저를 띄우는 test는 만들지 않는다(실제 core를 띄우는 길은 손 확인뿐이다).
- 남지 않음: 진짜 provider를 부르는 test가 없다. `grep -rn "ANTHROPIC_API_KEY" tests/eval/runner`는 `run.ts`·`cli.ts`의 key 안내 문구 말고는 없다(key 읽기는 ev-provider의 `readAnthropicKey`다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `deno.json`의 `eval` task(`"eval": "deno run --allow-all --env-file=.env tests/eval/run.ts"`). `tests/eval/runs/`를 `fmt.exclude`에 넣는 것은 lead가 이미 하기로 했다.
- 안 쓰게 된 export
- 정한 것: 기대한 export와 달라 맞춘 이름, `--budget` 기본값, `quietMs`·`timeoutMs`, 인자 읽기를 `node:util`로 한 것, 요약의 `source`에서 `diff`를 뺀 것
- 넘길 줄: wave 2 task의 export가 모자라 runner에 둔 이음 코드
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 병렬 trial 없음. `receivedMessageList`는 첫 page만 읽는다. coding agent session은 기다림에서 뺀다(`eval-coding`). `repeat-kind` judge는 이 계획에 없다(`eval-experiment`).
