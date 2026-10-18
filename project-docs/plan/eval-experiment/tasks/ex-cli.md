# ex-cli

`deno task eval:experiment <id>`와 `deno task eval:gate <id>`를 만든다. wave 2 조각(spec, select, trials, verdict, variant, gate, parallel, overfit, assembly, repeat)을 runner에 잇는다: spec 읽기와 검사 → 버전 확인 → 고르기 → gate → 경고 → 병렬 실행(trial 정책) → 판정 → `result.json`. 새 규칙은 거의 없고 잇는 일이다. 같이, judge와 사람 역할이 key 호출에서 eval을 돌리는 agent로 옮겨 간 것(`ex-judge-agent`, `ex-human-agent`)을 runner가 따르게 하고(채점 대기 item을 남기고, 질문을 "답 대기"로 두고 기다린다), `deno task eval`의 trial 실행을 병렬 pool로 바꾸고 trial이 variant checkout의 core를 쓰게 한다.

- 단위: ex-cli (wave 3)
- 선행: ex-select, ex-trials, ex-verdict, ex-variant, ex-gate, ex-parallel, ex-overfit, ex-assembly, ex-repeat, ex-judge-agent, ex-human-agent
- 소유(이 task만 고친다):
  - `tests/eval/run.ts`
  - `tests/eval/runner/**`
  - `tests/eval/experiment/mod.ts`
  - `tests/eval/types.ts`(죽은 `cost_usd` 칸을 지우는 것만)
  - `tests/eval/scorecard/**`(그 칸을 읽던 곳만)
  - `tests/eval/judge/**`, `tests/eval/human/**`(`cost_usd: 0` literal 줄만)
  - `tests/eval/experiment/spec/**`(`outcomeOf`가 `Outcome.cost_usd`에 더하던 `JudgeItem.cost_usd`·`HumanSummary.cost_usd` 항만 지운다. ex-spec이 선행 wave에서 land한 뒤라 겹치지 않는다)
- 읽을 것:
  - 설계 정본: `project-docs/products/roadmap/eval.md`의 "experiment"(표, "trial 수", "특정 시나리오에 맞추지 않기"), "역할과 흐름"(gate, program이 하는 일), "병렬과 의존", "공통 수치"의 assembly 단락, "지켜야 할 것"
  - 계획: `project-docs/plan/eval-experiment/README.md`("정한 것" 전부), `project-docs/plan/eval-coding/README.md`
  - eval-base brief(`ev-*.md`)는 계획 폴더에 더 없다. 아래 landed 코드와 `project-docs/architecture/eval.md`가 정본이다: `tests/eval/collect/store.ts`(`writeFullRecord`), `tests/eval/scorecard/{runs,pick}.ts`(`readRuns`, `Current`), `tests/eval/provider/attach.ts`(`attachRealModels`의 `endpoint`)
  - **landed 코드(정본)**: eval-base와 eval-coding은 main에 있다. 이 brief의 runner 사실은 `tests/eval/run.ts`, `tests/eval/runner/{cli,trial,steps,idle,spend,trials,cap,discover}.ts`, `tests/eval/human/{role,answer,approve}.ts`, `tests/eval/judge/{run,definition,input}.ts`, `tests/eval/coding/driver/{prepare,driver,wrapper}.ts`를 열어 확인한 것이다. 옛 brief(`ev-runner.md`, `ec-runner.md`)와 다르면 코드를 따른다.
  - 코드: `tests/eval/restore/{mod,env}.ts`(`restoreWorld(ctx, refs)`, `restoreCoreEnv(refs)`)
  - eval-experiment brief: `ex-spec.md`, `ex-select.md`, `ex-trials.md`, `ex-verdict.md`, `ex-variant.md`, `ex-gate.md`, `ex-parallel.md`, `ex-overfit.md`, `ex-assembly.md`, `ex-repeat.md`, `ex-judge-agent.md`, `ex-human-agent.md`
- 계약:
  - 쓰는 것. 아래 이름은 각 brief가 정한 것이다. landed 코드와 다르면 landed 코드를 따르고 "정한 것"에 적는다.
    | 출처(`tests/eval/experiment/<폴더>/mod.ts`) | export |
    |---|---|
    | `spec` (ex-spec) | `readSpec(dir, id): Promise<Result<{ spec, hash }>>`, `readResult(dir, id): Promise<Result<ExperimentResult \| null>>`, `writeResult(dir, result)`, `checkSpecAgainst(spec, { scenarios, runs, versions })`, `checkSpecLocked(facts: LockFacts): Result<{ spec_commit }>`, `outcomeOf(trial, runComponents)`(`runComponents` = 그 trial이 든 `RunRecord.components`. `TrialResult.components`가 없을 때 쓰는 대비), `EXPERIMENTS_DIR`, type `ExperimentSpec`, `ExperimentResult`, `PlanEntry`, `Outcome`, `LockFacts`, `OverfitWarning`, `AssemblyReport` |
    | `select` (ex-select) | `selectRuns(spec, runs, current): Result<Plan>`(`Plan = { entries: PlanEntry[]; keep; excluded }`), `changedComponents(baseMap, variantMap): { from; to }[]`. `current`는 ev-scorecard `pick.ts`의 `Current` |
    | `trials` (ex-trials) | `nextTrials(state: TrialState, policy): number`, `flakyScenarios(runs, scenarios): Set<string>`, `estimateTrials(entries, policy): Estimate` |
    | `verdict` (ex-verdict) | `recordVerdict(dir, input: VerdictInput): Promise<Result<ExperimentResult>>`(`decide` 다음 `writeResult`. 이 task가 부른다), `decide(input: VerdictInput): Result<ExperimentResult>`(순수), type `VerdictEntry`, `VerdictInput`(`overfit?`, `repeats?`, `assembly?` 진단 칸을 입력에 담아 그대로 옮긴다) |
    | `variant` (ex-variant) | `resolveVariant`, `explainBreak`, `Variant`(`root`, `isCurrent`, `versionDeps`, `graderDeps`, `boot`) |
    | `gate` (ex-gate) | `runGate`, `defaultGateDeps`, `GateReport` |
    | `parallel` (ex-parallel) | `createPool`, `trialKindOf`, `Pool`, `Job`, `JobResult`, `Budget` |
    | `overfit` (ex-overfit) | `loadChangedText(registryDir, change)`, `findOverfit(changed, scenarios, extraNames?)`, `formatWarnings(warnings)` |
    | `assembly` (ex-assembly) | `loadRecordedTrial(dir, run, index)`, `measureAssembly(deps: { port: ReplayPort; startFake? }, args)`, `formatAssembly(report)`, type `ReplayPort`. **`ReplayPort`는 이 task가 구현한다**(아래) |
    | `repeat` (ex-repeat) | `REPEAT_KIND`, `queueRepeats({ evalDir, run, clock, criterion, judge }, trial, opts?): Promise<RepeatFinding[]>`(묶음마다 `kind: "diagnosis"` 대기 entry를 쓰고 `RepeatFinding`을 돌려준다. API를 안 부른다), `findRepeatGroups`, type `RepeatFinding` |
    | eval-base | `tests/eval/versions/mod.ts`의 `currentVersions`, `readEntries`, `contentFiles`, `registerAuthored`, `criterionContent`, `hashText`, `judgeContent`, `coreVersion`, `checksVersion`, `captureSource`, `seenComponents`, `denoGit`. `tests/eval/scorecard/runs.ts`의 `readRuns`, `pick.ts`의 `Current`. `tests/eval/runner/`의 기존 `discoverScenarios`, `createCap`. `tests/eval/provider/mod.ts`의 `readAnthropicKey`, `attachRealModels`. `tests/eval/collect/mod.ts`의 `writeFullRecord`. `tests/eval/judge/mod.ts`의 `loadJudgeDefinition`(이제 채점 안내 글의 버전 `judge@n`이다), `JudgeDefinition`. `tests/eval/criteria/mod.ts`의 `loadCriterion`. `tests/eval/restore/mod.ts`의 `beginRestore`, `restoreWorld`, `endRestore`, `agentRefOf`와 `manifest.ts`의 `loadMaterial` |
    | eval-coding(landed) | `tests/eval/restore/mod.ts`의 `restoreCoreEnv(refs)`, `runner/`의 `waitUntilIdle`(hooks `act`·`over`·`graceMs`), `runSteps(ctx)`, `createSpendGuard`, `roleSpendUsd`, `TRIAL_CAP_USD`, `CODING_TRIAL_LIMIT_MS`. `tests/eval/coding/driver/mod.ts`의 `prepareCodingAgent({ core, root, hookRoot, binDir, model, clock, install })`, `startCodingDriver({ core, clock, binDir, outDir, root, log, timeoutMs })`(`active()`, `stop()`) |
    | `judge` (ex-judge-agent, `tests/eval/judge/mod.ts`) | `loadJudgeDefinition()`(`{ n, prompt }`), `newJudgeItem`, `PendingJudge`(`kind: "check" \| "diagnosis"`), `judgeKey(trial, check)`, `writePending(evalDir, entry)`, `readPending(evalDir, run)`, `outstanding(entries)`, `foldJudge(trials, entries)`, `foldRun(...)`, `judgePassed`. `JudgeItem.state`(`"pending" | "judged" | "error"`), `CheckResult.pending?`, `JudgeItem.model`(ex-spec이 `types.ts`에 정의한다). `judgeItem`·`JudgeFetch`는 지워진다. `deno task eval:judge`(`judge/main.ts`) |
    | `human` (ex-human-agent, `tests/eval/human/mod.ts`) | `createHumanRole({ port, clock, spec, evalDir, run, trial, log, definition? })`(fetch·apiKey 없음), `HumanRole = { tick, record, waiting }`, `questionKey`, `readQuestions`, `PendingQuestion`. `deno task eval:answer`(`human/main.ts`). 질문은 `<evalDir>/<run>/questions/`에 "답 대기"로 놓이고, 돌리는 agent가 `eval:answer <run> set`으로 답 file을 쓰면 trial을 쥔 이 process의 `tick()`이 제품 `askAnswer`로 보낸다(CLI는 core에 닿지 않는다) |
  - 내놓는 것:
    - `tests/eval/experiment/mod.ts`: `runExperimentCommand(args: string[]): Promise<number>`, `runGateCommand(args: string[]): Promise<number>`(종료 코드를 돌려준다).
    - `deno task`(lead가 등록): `"eval:experiment": "deno run --allow-all --env-file=.env tests/eval/run.ts experiment"`, `"eval:gate": "deno run --allow-all tests/eval/run.ts gate"`. `eval:gate`는 `--env-file`이 없다. gate는 key를 읽지 않는다.

## 이 task가 landed runner에서 바꾸는 것

landed `tests/eval/runner/`(`cli.ts`, `trial.ts`, `steps.ts`, `idle.ts`, `spend.ts`, `trials.ts`)와 `tests/eval/run.ts`(한 줄: `Deno.exit(await main(Deno.args))`)가 바탕이다. driver, hooks가 든 `waitUntilIdle`, `runSteps`, 비용 상한 `createSpendGuard`, save는 그대로 둔다. 아래 일곱 곳만 바꾼다.

| 곳 | landed | 이 task가 바꾸는 것 |
|---|---|---|
| core 띄우기 (`runner/trial.ts`의 `runTrial`) | `bootCore(run, { settings: evalCoreSettings(), env: await restoreCoreEnv(scenario.world) })` 뒤 같은 함수 안에서 `beginRestore` → `restoreWorld` → `scenario.setup` → `endRestore` | `variant.boot(run, { settings, env })`. 되살리기 앞부분(`createRun` → boot → `beginRestore` → `restoreWorld` → `scenario.setup` → `endRestore`)을 `runner/world.ts`의 `prepareTrialWorld(deps, scenario)`로 떼어 낸다. **boot 옵션(`evalCoreSettings()`, `restoreCoreEnv(scenario.world)`의 env)을 trial과 똑같이 만든다**(함수 하나 `bootOptionsOf(scenario)`를 둘이 같이 쓴다). 이유: gate의 dry run이 trial과 다른 환경으로 돌면 active app 재료의 되살리기가 dry run에서만 통과하거나 깨진다 |
| 버전·출처 (`runner/trial.ts`, `runner/cli.ts`) | `seenComponents(records)`, `coreVersion()`, `captureSource()`, `checksVersion()` | `seenComponents(records, variant.versionDeps)`, `coreVersion(variant.versionDeps)`, `captureSource(variant.versionDeps)`. `checksVersion`, `scenarioHash`, criterion, judge는 `variant.graderDeps`(지금 checkout). `TrialResult.components`를 채운다(아래) |
| coding driver (`runner/trial.ts`) | `TrialDeps.repoRoot`를 `prepareCodingAgent({ root })`, `startCodingDriver({ root })`에 넘기고 `hookRoot`(사람이 hook을 설치한 주 checkout), `binDir = ${EVAL_DIR}/bin` | `repoRoot`에 `variant.root`를 넘긴다. `hookRoot`는 그대로 주 checkout이다. **hook은 variant로 가지 않는다**: 사람이 설치한 hook은 `<hookRoot>/.dev-data/eval/bin/lophn`을 절대 경로로 직접 부르고, 그 wrapper는 PATH를 보지 않고 hookRoot의 `packages/coding-agent/cli/main.ts`를 연다(`wrapper.ts`). 그래서 variant trial에서도 `lophn hook claude <Event>`는 주 checkout의 CLI가 처리하고 `LOPHN_DAEMON_URL`(plan env)로 variant core에 닿는다. agent가 치는 `lophn`만 PATH 앞(`evalPlan`)의 variant wrapper(`root`)로 간다. hook·CLI 코드를 고친 experiment는 이 길로 재지 못한다("알려진 미완 동작", planner가 정할 것). `binDir`은 variant마다 따로 둔다(`${EVAL_DIR}/bin/<root 경로의 sha256 앞 12자>`). 이유: `ensureWrapper(binDir, root)`는 내용이 다르면 wrapper를 다시 쓰므로, 한 `binDir`을 checkout 둘이 쓰면 동시에 도는 trial의 wrapper가 서로를 덮는다. 지금 checkout이 variant이면 기존대로 `${EVAL_DIR}/bin`. pool을 띄우기 전에 coding 시나리오가 있으면 `ensureWrapper(binDir, variant.root)`와 `ensureWrapper(<hookRoot>/.dev-data/eval/bin, hookRoot)`를 한 번 부른다. 이유: trial마다 `prepareCodingAgent`가 같은 호출을 하지만 내용이 같으면 쓰지 않으므로, 병렬 trial 둘이 처음에 같은 file을 동시에 쓰다 hook이 반쯤 쓰인 wrapper를 여는 일을 없앤다 |
| trial 실행 (`runner/trials.ts`의 `runTrials`) | 차례로 돈다. `cli.ts`가 "coding 시나리오의 trial은 차례로만 돈다" 안내를 찍는다 | `trials.ts`, `trials_test.ts`와 그 안내 줄을 지운다. `createPool`로 돈다(kind별 한도 judgment 4, coding 2, 예산). `createCap`은 남겨 pool의 `Budget`으로 쓴다. `runTrials`가 하던 비용 더하기는 `Job.run`의 `cost_usd`가 한다(`metrics.cost_usd`뿐이다. judge item과 사람 역할의 `cost_usd`는 이제 key 호출이 아니므로 칸 자체를 지운다. 아래 "`cost_usd` 지우기"). `runTrials`가 한 번 찍던 "비용 모르는 call 있음: 합계 비용이 모자랄 수 있다"(`metrics.unpriced_calls > 0`)는 `runScenario`가 이어받아 시나리오당 한 번 찍는다 |
| **judge** (`runner/trial.ts`의 judge check 반복) | `judgeItem({ fetch, apiKey: deps.key }, ...)` | **ex-judge-agent가 이 블록을 이미 고친다**(채점 대기 item을 `writePending`으로 두고 `CheckResult`는 `pass: false, pending: true, reason: "채점 대기"`). 이 task는 그 블록을 다시 쓰지 않고 합친다. 이 task가 더하는 것: ① run 요약을 쓰기 직전에 `foldJudge(results, await readPending(evalDir, runId))`로 이미 들어온 채점을 합친다(`runScenario`). ② `cli.ts`의 `passed()`와 요약 줄이 `CheckResult.pending === true`인 judge check를 떨어졌다고 세지 않고 "채점 대기 N건"을 따로 적는다(trial 통과의 정의는 `passed()`가 읽는 `CheckResult.pending`이다. `JudgeItem.state === "pending"`은 item 쪽 값이다). ③ judge 비용 합산 줄을 지운다(비용 0). 죽은 `cost_usd` 칸을 지운다. 아래 "`cost_usd` 지우기"의 목록이 현재 소비처 전부다 |
| **사람 역할** (`runner/trial.ts`의 `createHumanRole`) | `createHumanRole({ port, fetch, apiKey, clock, spec })` | **ex-human-agent가 이 호출을 이미 고친다**(fetch·apiKey를 빼고 `evalDir`, `run`, `trial`, `log`를 준다). 이 task는 다시 쓰지 않는다. `runSteps`의 `hooks.act`(`human.tick`)는 그대로다: 질문이 새로 오면 `tick`이 "답 대기"로 두고 `답 대기 <key>` 줄을 찍으며, 답 file이 들어오면 `askAnswer`로 보낸다. 답을 기다리는 동안은 `act` 때문에 조용함이 아니고, 기다림의 상한은 지금 시간 상한(coding은 `CODING_TRIAL_LIMIT_MS`)뿐이다. 이 task가 하는 것: 비용 합산 줄에서 사람 역할 `cost_usd`를 뺀다(0) |
| trial 뒤: 되풀이 (`runner/trial.ts`) | 없음 | `queueRepeats({ evalDir: deps.evalDir, run: deps.runId, clock, criterion: await loadCriterion(parseRef(REPEAT_KIND, "criterion")), judge: deps.judge }, trial)`를 부르고 돌려받은 `RepeatFinding[]`을 `writeFullRecord`로 `.dev-data/eval/<runId>/trial-<i>.repeat.json`에 남긴다. 통과 판정에는 안 든다 |
| 입구 (`run.ts`) | `Deno.exit(await main(Deno.args))` | 첫 인자가 `experiment`, `gate`이면 `experiment/mod.ts`로 보낸다. 아니면 기존 `main` 그대로. `cli.ts`의 요약 줄은 trial 통과 수에 "채점 대기 N건"을 따로 적는다(`passed()`는 `CheckResult.pending`인 judge check를 떨어졌다고 세지 않는다) |
| 공용 값 (`runner/cli.ts`의 `REPO_ROOT`, `REGISTRY_DIR`, `RUNS_DIR`, `EVAL_DIR`, `EVAL_TMP`, `useEvalTmp()`, `mainCheckout()`) | `main` 안에서만 쓴다 | `runner/paths.ts`로 옮겨 `cli.ts`와 `runner/experiment.ts`가 같이 쓴다. **experiment도 coding 시나리오가 하나라도 있으면 gate의 dry run과 `createRun` 앞에서 `useEvalTmp()`를 부른다**(`TMPDIR`=`/tmp/lophn-eval`, 사람이 `TMPDIR`를 정했으면 건드리지 않는다). 이유: trial 폴더를 짧은 전용 폴더에 두어야 한다. 프로세스 전체 env를 바꾸므로 pool을 띄우기 전에 한 번이다. coding 시나리오 hook용 `hookRoot = await mainCheckout()`도 experiment가 쓴다 |

- **`TrialResult.components`**: ex-spec이 `tests/eval/types.ts`에 `TrialResult.components?: VersionRef[]`를 더한다(그 trial의 진짜 model이 본 component). landed `runTrial`이 돌려주는 `TrialOutcome.components`(= `seenComponents` 결과 + `cli`)가 이미 trial마다 있다. 그것을 `runTrial`이 만드는 `TrialResult.components`에 넣는다. `RunRecord.components`는 지금처럼 trial들의 합집합이다. 이유: ex-select와 ex-trials가 run 전체 합집합 대신 trial마다 본 것을 쓴다.
- **`cost_usd` 지우기** (`grep -rn "cost_usd" tests/eval --include=*.ts`로 확인한 현재 소비처 전부). 지우는 칸: `JudgeItem.cost_usd`, `HumanRecord.cost_usd`, `HumanRecord.answers[].cost_usd`, `HumanSummary.cost_usd`(`types.ts`). 남는 칸: `Metrics.cost_usd`(role agent의 `modelCallList` cost 합. `collect/metrics.ts`, `scorecard/{markdown,diff}.ts`, `checks/fixtures.ts`, `scorecard_test.ts`의 `Metrics` literal은 그대로).
  - 고칠 곳: `judge/run.ts`(ex-judge-agent가 fetch와 함께 지운다. 남았으면 지운다), `judge/run_test.ts:114`, `judge/definition.ts`(`price_usd_per_mtok`이 있으면 쓰는 곳이 없어진다), `human/answer.ts`(ex-human-agent가 지운다), `human/role.ts`(54, 117, 119), `human/human_test.ts:247`, `runner/cli.ts`(192 사람 역할 줄의 `$…`, 370~371 합계), `runner/trials.ts`(지운다), `runner/trials_test.ts`(지운다), `runner/trial.ts`(77, 82 `humanSummary`, 152 `humanSpend`), `runner/spend.ts`(`createSpendGuard`의 `humanSpend` 인자와 주석), `scorecard/markdown.ts`(74 `judgeCost`와 "judge 비용 합" 줄), `experiment/spec/`(`outcomeOf`의 합). 끝에 `grep -rn "cost_usd" tests/eval --include=*.ts`에서 `Metrics`와 `Outcome`/`Job`의 role agent 비용만 남는다.
  - **돈의 출처는 그대로 있다.** trial 상한(`--trial-budget`, `createSpendGuard`)의 `roleSpend`는 `roleSpendUsd(core)`(role agent `modelCallList`의 cost 합)이고 `humanSpend`만 빠진다. experiment 예산(`--budget`)은 pool의 `Budget`이 `Job.run`의 `cost_usd` = `Metrics.cost_usd`(role agent)를 더한다. 두 상한 모두 role agent USD를 세므로 제거로 깨지지 않는다. 바뀌는 것은 의미뿐이다: judge와 사람 역할 호출은 key 호출이 아니므로 상한에 안 든다(`runner/spend.ts`의 주석 "role agent, judge, 사람 역할 비용 상한"과 `runner/cap.ts`의 "대상 model과 judge 비용의 합" 주석을 role agent로 고친다). coding agent는 처음부터 안 센다.
- **registry 쓰기를 직렬로 한다** (`runner/mutex.ts`, 새 file): `serial<T>(fn: () => Promise<T>): Promise<T>`. trial이 동시에 돌면 `seenComponents`가 `resolveVersion`으로 같은 registry file을 동시에 쓴다(ev-versions "같은 file을 동시에 쓰는 일은 막지 않는다"). trial 안의 `seenComponents`와 `measureCli`·`resolveVersion` 호출을 모두 `serial`로 감싼다. 시작할 때 등록(`registerAuthored`)은 차례로 하므로 따로 감싸지 않는다.
- **save** (landed `runTrial`): `deps.saved.length === 0`일 때 통과한 첫 trial만 저장한다. 동시 trial에서는 이 확인과 저장이 겹치므로 `runTrial`의 저장 구간을 `serial`로 감싼다. experiment에서는 save하지 않는다(`saveEnabled: false`). 이유: 새 산출물은 후보라 experiment가 만들 필요가 없다(roadmap "이어 돌리기"는 이 계획 밖).
- **run 읽기는 JSON 안의 `id`로** 한다. `readRuns`가 돌려준 `RunRecord.id`를 키로 쓴다. 파일 이름에서 id를 만들지 않는다(eval-base runner의 파일 이름이 `RunRecord.id`와 다를 수 있다).

## 할 일

### 1. runner 바꾸기 (`tests/eval/runner/**`, `run.ts`)

1. `world.ts`: `bootOptionsOf(scenario, model)`와 `prepareTrialWorld(deps, scenario)`. 위 표대로 trial에서 떼어 낸다. boot나 되살리기가 실패하면 `explainBreak(variant, "boot" | "restore", message)`로 이유를 만들어 던진다(runner는 이유를 찍고 멈춘다).
2. `mutex.ts`: `serial`.
3. `trial.ts`: 위 표대로 바꾼다. 반환의 `cost_usd`는 `metrics.cost_usd`(role agent)다. judge와 사람 역할의 `cost_usd` 칸은 지웠으므로 합에 더하지 않는다(pool의 `Job.run`이 쓴다). `spend.ts`는 `humanSpend` 인자를 뺀다.
   - repeat 진단: 위 표대로 `queueRepeats`를 부른다. `result.repeats`는 `.repeat.json`의 `RepeatFinding[]`을 모은 것이고, 채점 상태는 16번에서 `readPending`의 `kind: "diagnosis"` entry를 `finding.key`로 이어 최신 item으로 바꾼다.
4. `scenario.ts`(새): `runScenario(args)` — 시나리오 하나의 모든 trial을 pool로 돌려 `RunRecord`를 만든다. 인자는 `{ scenario, variant, pool, next, model }`이고 `next(results: TrialResult[]): number`는 "지금까지 결과를 보고 더 돌릴 trial 수"다. 흐름: `next([])`개를 한꺼번에 `pool.submit` → 끝난 결과로 `next(results)`를 다시 물어 0이 될 때까지 더 낸다. 한 trial은 `Job`(`kind: trialKindOf(scenario)`, `id: "<시나리오 id>#<index>"`)이다. `skipped`인 trial은 기록에 넣지 않는다. `failed`(core 오류 등)는 이유를 찍고 그 시나리오를 멈춘다. `RunRecord` 조립은 요약을 쓰기 직전에 `foldJudge`로 들어온 채점을 합친 `trials`를 쓴다. 조립(components 합집합, grader, source)은 landed `cli.ts`의 `main` 안에서 `RunRecord`를 만드는 부분(components 합집합, grader, source)을 옮긴다. `deno task eval`에서는 `next = (results) => results.length === 0 ? --trials : 0`이다.
5. `cli.ts`: 시나리오를 고르고 등록하는 앞부분(`registerAll`, `validateFixtures`)은 그대로 두고, `runTrials` 자리를 `createPool({ budget: createCap(--budget) })`와 시나리오별 `runScenario`를 `Promise.all`로 잇는 것으로 바꾼다. 요약 줄과 상한 알림은 `pool.halted()`로 찍는다. 종료 코드와 `--trial-budget`은 그대로다. 요약 줄의 judge 비용 합은 0이 되므로 빼고, 채점 대기 건수를 적는다.
6. `trials.ts`를 지운다. 그 test(`누적 비용이 상한을 넘으면…`)도 지운다. 같은 규칙을 `ex-parallel`의 test가 본다.
7. `run.ts`: `Deno.args[0]`이 `experiment`이면 `runExperimentCommand(Deno.args.slice(1))`, `gate`이면 `runGateCommand(...)`, 아니면 기존 `cli.ts`의 main. 종료 코드를 `Deno.exit`에 넘긴다.
8. SIGINT, SIGTERM: 첫 신호는 `pool.stop()`을 부르고 "새 trial을 띄우지 않는다. 도는 trial을 기다린다"를 찍는다. 둘째 신호는 곧바로 끝낸다(`Deno.exit(130)`). 이유: runner가 "멈추라고 요청"할 때 도는 trial의 core process가 남지 않게 한다. 신호 처리는 pool을 만드는 쪽(`cli.ts`와 experiment 흐름)에서 건다.
9. `replay.ts`(새): ex-assembly의 `ReplayPort`를 구현한다. `run({ scenario, checkout, model, endpoint })`는 `prepareTrialWorld`로 되살린 뒤 `attachRealModels(core, { key: "replay", model, real, endpoint })`로 `real` 참가자의 model이 `endpoint`(fake provider)를 향하게 하고, 시나리오의 `steps`를 trial과 같은 `runSteps`로 돌려 쉴 때까지 기다리고, core를 끄고 root를 지운다. judge와 check는 돌리지 않는다. `checkout`이 null이면 지금 checkout, 아니면 그 path로 `resolveVariant`한 variant의 core다. coding agent가 든 시나리오는 재생하지 않는다(그 entry는 건너뛰고 한 줄을 찍는다).

### 2. `eval:experiment <id>` (`tests/eval/experiment/mod.ts`, `runner/experiment.ts`)

인자(`node:util`의 `parseArgs`): `<id>`(위치 인자, 필수), `--checkout <path>`, `--budget <usd>`(기본은 spec의 `budget_usd`), `--skip-gate`, `--prefix-only`, `--base <rev>`(gate가 바뀐 file을 정하는 기준). **`--model`은 없다**: model은 `spec.model`이다. 잘못된 인자는 2.

순서(앞 단계가 실패하면 거기서 끝낸다. 실패는 이유를 찍고 1):

1. `readSpec(<지금 checkout>/tests/eval/experiments, id)` → `{ spec, hash }`.
2. `resolveVariant({ checkout, current })`.
3. 기준과 후보 버전: `baseline = currentVersions(variant.graderDeps)`, `candidate = currentVersions(variant.versionDeps)`(variant가 지금 checkout이면 같은 값을 쓴다).
4. `discoverScenarios()`, `readRuns(tests/eval/runs)` → `checkSpecAgainst(spec, { scenarios, runs, versions: baseline })`.
5. **spec이 고침보다 먼저인지**: `runner/lock.ts`의 `collectLockFacts(...)`가 git으로 `LockFacts`를 모아 `checkSpecLocked`에 넘긴다. 이유: ex-spec은 git을 부르지 않고 사실만 판정한다. 모으는 법(지금 checkout `git`과 variant `git -C <variant.root>`):
   - `spec_commit`: `git log -1 --format=%H -- tests/eval/experiments/<id>/spec.json`(없으면 null)
   - `spec_dirty`: `git status --porcelain -- tests/eval/experiments/<id>`가 비지 않았다
   - `spec_commit_on_current`: 지금 checkout에서 `git merge-base --is-ancestor <spec_commit> HEAD`
   - `variant_has_spec_commit`: variant에서 같은 명령
   - `variant_spec_same`: `git -C <variant> show HEAD:tests/eval/experiments/<id>/spec.json`이 `git show <spec_commit>:...`와 byte로 같다
   - `cases_missing_at_spec_commit`: spec의 `cases` 시나리오마다 `discoverScenarios`가 준 file path가 `git cat-file -e <spec_commit>:<path>`로 없는 것의 id
   variant가 지금 checkout이면 variant 쪽 사실도 지금 checkout에서 모은다. 결과의 `spec_commit`은 `VerdictInput.spec_commit`에 쓴다.
6. **바뀐 것 확인** (`runner/change.ts`, 순수 함수 `checkChange(change, changed)`): `changed = changedComponents(baseline, candidate)`.
   - spec의 `change.from`(kind·name·n)과 같은 항목이 `changed`에 없으면 "variant가 spec의 X@a → X@b가 아니다"를 찍고 1. 이유: 다른 것을 시험하는 돈을 쓰지 않는다.
   - 같은 kind·name인데 `to.n`이 spec의 `change.to.n`과 다르면 막지 않고 `[warn]`만 찍는다(ex-spec "정한 것": `to`의 n은 짐작이다). 다른 항목이 더 있으면 `[change]` 줄에 `mixed`로 찍는다(막지 않는다. `decide`가 `mixed`를 계산한다).
7. **고르기**: `current = { scenarios, versions: baseline, judge: <loadJudgeDefinition()의 ref>, model: spec.model }`로 `selectRuns(spec, runs, current)`. `entries`가 비면 1. `keep`, `excluded`는 찍는다.
8. **이어 돌리기**: `readResult(dir, id)`. 판정이 `adopt`나 `reject`이면 "판정이 이미 났다. 새 spec(새 id)을 쓴다"를 찍고 1(`writeResult`가 어차피 거절한다). `inconclusive`이면 그 `scenarios[].variant_runs`의 run id를 `runs`에서 찾아(`RunRecord.id`로) 시나리오마다 앞서 돈 variant trial을 이번 결과에 합친다. 그 trial들의 `outcomeOf`가 아래 `next`의 `variant`에 먼저 든다. 앞서 `채점 대기`였던 judge check가 그 사이 `deno task eval:judge <run> set`으로 채점됐으면 `foldRun`이 run 요약을 이미 고쳐 두었으므로(요약이 아직 없던 때 들어온 채점은 `runScenario`가 요약을 쓸 때 합쳤다) `outcomeOf`가 새 값을 본다(`readRuns`는 늘 파일에서 새로 읽는다). 그러면 `nextTrials`가 target·guard를 더 돌리라고 할 수 있다(앞서 돈 trial의 `outcomeOf(t, 그 run의 components)`). 이것이 "채점 뒤 같은 experiment를 이어 돌린다"(ex-verdict)의 몸이다.
   - **돌 것이 없으면 건너뛴다**: 모든 entry의 `next`가 0이면(판정에 필요한 trial이 다 있고 채점 대기만 남았거나, 채점이 다 들어와 다시 판정만 하면 되는 경우) 9번 gate, 13번 key, 15번 실행을 건너뛰고 16번 판정으로 간다. 이유: 새 trial이 없으면 gate와 key가 필요 없고, 판정만 다시 계산하면 된다.
9. **gate**(`--skip-gate`가 아니면): `runGate({ checkout: variant.root, base, scenarios: <entries의 시나리오 전부> }, defaultGateDeps({ validateFixtures, dryRun, catalogRoot: <지금 checkout> }, variant.root))`. `dryRun`은 `prepareTrialWorld`를 쓰는 함수(끝나면 core를 끄고 run을 지운다). 단계마다 한 줄을 찍는다. 실패하면 진짜 model은 한 번도 부르지 않은 채 1.
10. **경고**: `loadChangedText(registryDir, spec.change)`가 null이면 "내용을 못 봐서 경고를 못 낸다" 한 줄. 아니면 `findOverfit(changed, <entries의 시나리오>, extraNames)`. `extraNames`는 시나리오 `world` 재료마다 `loadMaterial(...)`의 `manifest.ids` 키(앱·project·Operator·context 이름)를 시나리오 id별로 모은 것이다. `formatWarnings`로 찍고 막지 않는다. 결과는 `ExperimentResult.overfit`에 남긴다.
11. **assembly**: `spec.change.from.kind === "assembly"`이면 entries의 기준 run마다(entry당 첫 run의 trial 0) `loadRecordedTrial(".dev-data/eval", run, 0)` → `measureAssembly({ port: replayPort }, { run, trial, scenario, model: spec.model, checkout: variant.isCurrent ? null : variant.root })`, `formatAssembly`로 찍는다. 기록이 없는 run은 이유와 함께 건너뛴다. 결과는 `ExperimentResult.assembly`. 진짜 model을 부르지 않는다. `--prefix-only`이면 `result.json`을 쓰지 않고 0으로 끝난다.
12. **어림**: `estimateTrials(entries.map((entry) => ({ entry, flaky })), spec.trials)`(`flaky = flakyScenarios(runs, scenarios).has(id)`)를 찍는다. `usd.worst`가 예산보다 크면 "예산 부족할 수 있음"을 더한다. 막지 않는다(상한은 pool이 지킨다).
13. **key**: `readAnthropicKey(Deno.env)`가 없으면 "ANTHROPIC_API_KEY가 없다"를 찍고 1. (`deno task eval`은 key가 없으면 0이지만, 사람이 확정해 돌리는 experiment는 돌지 않은 것을 성공으로 보이면 안 된다.) key는 core의 role agent(`attachRealModels`)만 쓴다. judge와 사람 역할은 key를 쓰지 않는다. coding agent 준비(`prepareCodingAgent`)는 landed `runTrial`이 trial마다 하므로 따로 부르지 않는다(`root: variant.root`만 바뀐다).
14. **등록**: `repeat-kind@1` criterion을 `registerAuthored`로 등록한다(`kind: "criterion"`, `hashText(criterionContent(criterion))`). 시나리오·재료·judge criterion 등록은 landed `registerAll`과 같다.
15. **실행**: `pool = createPool({ budget: createCap(budget) })`, SIGINT 연결. entries마다 `next = (results) => nextTrials({ role, checks, baseline: entry.baseline, variant: [...prior, ...results.map((t) => outcomeOf(t, runComponents))], flaky }, spec.trials)`로 `runScenario`를 `Promise.all`로 돌린다(`prior`는 8번의 앞서 돈 variant outcome. `runComponents`는 이번 `RunRecord.components`로 `TrialResult.components`가 없는 trial의 대비다). coding 시나리오가 있으면 이 앞에서 `useEvalTmp()`와 `ensureWrapper` 둘을 한 번씩 부른다(위 표). 시나리오 코드는 지금 checkout(`graderDeps`)에서, core는 `variant`에서 뜬다. 새 run은 `tests/eval/runs/`에 eval-base와 같은 꼴로 쓴다. `saveEnabled: false`. trial이 끝날 때마다 채점 대기 item이 "채점 대기" file에 쌓이고 `채점 대기 <key>` 줄이 찍힌다. 이 process는 채점을 기다리지 않는다(돌리는 agent가 `deno task eval:judge <run>`으로 하고, 그동안 이 process는 다음 trial을 돈다). 질문은 기다린다: `답 대기 <key>` 줄이 찍히면 돌리는 agent가 `deno task eval:answer <run> set <key>`로 답한다(그 process의 `tick`이 제품으로 넘긴다). 안 오면 지금 시간 상한(`CODING_TRIAL_LIMIT_MS`)에서 timeout이 된다.
16. **판정**: entries마다 `VerdictEntry`(`variant_runs` = 앞서 돈 run id + 이번 run id, `variant` = 그 trial들의 `outcomeOf`, `remaining` = `next`를 같은 상태로 다시 부른 값)를 만들고 `VerdictInput`(`spec`, `spec_hash`, `spec_commit`, `changed`, `entries`, `keep`, `excluded`, `stopped_by_budget: pool.halted() === "budget"`, `decided_at: clock.now()`)으로 `decide(input)`를 부른다. 진단은 `VerdictInput`의 `overfit`, `repeats`(이전 `inconclusive`의 것에 이번 것을 이은 목록), `assembly`에 담아 넘기고 `recordVerdict(dir, input)`이 `decide` 뒤 `writeResult`로 쓴다(`VerdictInput`이 진단 칸을 받으므로 `decide`와 `writeResult`를 따로 부르지 않는다. 판정이 이미 난 result는 `conflict`로 돌아온다). 신호로 멈춰 `remaining`이 남았으면 `decide`가 `inconclusive`를 내게 그대로 넘긴다. `result.repeats`는 `findRepeatGroups`가 찾은 묶음마다 `RepeatFinding`(item은 채점 대기 또는 채점된 `JudgeItem`)이다. 채점 대기는 variant run마다 `outstanding(await readPending(evalDir, run))`로 센다(run 요약에도 `pending`이 남아 있어야 한다). 하나라도 남으면 `decide`가 `inconclusive`를 내고 `reasons`에 "채점 대기: ..."가 든다(ex-verdict). 그때 run마다 `[pending] <run> <건수>`와 다음 할 일 두 줄(`deno task eval:judge <run>`, 그 뒤 `deno task eval:experiment <id>`)을 찍는다. 마지막 줄에 판정을 찍는다. 종료 코드는 채택·기각·판정 불가 모두 0이다. 이유: 해석은 experimenter 몫이다. 판정을 코드로 막지 않는다.

### 3. `eval:gate <id>`

인자: `<id>`, `--checkout <path>`, `--base <rev>`. 위 1~7번과 9번(key 없음, 진짜 model 없음)만 돈다. 통과하면 0, 실패하면 1.

### 4. 찍는 글 (runner, 곧 eval을 돌리는 agent가 읽는다. 한 줄에 사건 하나, 접두 고정)

```
[variant] /path/to/worktree (core@31)            [change] instruction:lophn@3 -> @4  mixed: -
[select] target L4-app@1  case L4-todo@1  guard L5@1 ...
[gate] check ok 41s    [gate] e2e skipped (고른 e2e 없음)    [gate] dry-run L4-app ok
[warn] 경고: ...                               [assembly] <layer> 0.93 -> 0.90
[estimate] trials 8..24 (likely 12) $8.40 (budget $100)
[trial] L4-app#0 start    [trial] L4-app#0 pass $0.012    [trial] L4-app#1 fail (check-id) $0.011    [trial] L4-app#2 pending (check-id) $0.012
채점 대기 <key>   답 대기 <key>   [pending] <run> 2건
[budget] $12.31/100.00
[halt] budget | stopped        [verdict] adopt | reject | inconclusive (채점 대기 포함)
```

접두와 줄 모양은 `ex-skills`가 이 글을 읽는 법을 쓰므로 바꾸지 않는다. 대답 글, 요청 body, key는 찍지 않는다.

## 정한 것

- 순서는 "spec → 버전 확인 → 고르기 → gate → ..."다. 이유: gate의 dry run이 고른 시나리오를 필요로 하고, 고르기는 읽기뿐이라 돈이 안 든다.
- `eval:experiment`가 gate를 직접 돌린다(`--skip-gate`로 건너뛴다). 이유: gate 없이 진짜 model을 부르지 않는다는 보증을 입구가 가진다. 건너뛰는 것은 방금 `eval:gate`가 통과했을 때 중복을 피하려는 것이다.
- `deno task eval`도 pool로 돈다. 이유: 코드 길이 하나. `--trials`가 N이면 N개가 동시에 도는 것은 늘 바라던 동작이다.
- experiment의 종료 코드는 판정을 담지 않는다. 판정은 `result.json`과 마지막 줄에 있다.
- 이어 돌리기: `inconclusive` result가 있으면 이어서 돈다. 이유: 예산이나 신호로 끊긴 experiment를 새로 시작하면 이미 쓴 run이 기준 run으로 들어간다(ex-verdict 계약).
- `repeat` 진단 item은 experiment에서만이 아니라 `deno task eval`에서도 만든다. 이유: 같은 trial 함수를 쓴다. 호출이 아니라 item을 두는 것이라 비용이 없다.
- runner는 judge와 사람 역할을 API로 부르지 않는다(사람 결정). 채점은 돌리는 agent가 하고, process는 채점을 기다리지 않는다. 이유: 채점을 기다리게 하면 trial 병렬이 막히고 agent가 채점할 때까지 core가 떠 있어야 한다. 채점 대기는 `inconclusive`로 남고 같은 명령을 다시 돌리면 이어진다. 질문은 trial 안에서 session이 멈춰 기다리므로 기다린다.
- 옛 길은 남기지 않는다: `judgeItem`의 fetch 호출, `createHumanRole`의 fetch·apiKey, `TrialDeps`의 judge 호출은 모두 지운다(AGENTS.md "호환성").
- `result.json`은 `writeResult`로 쓴다. 판정이 난 result는 덮이지 않는다(ex-spec).

## 끝남

- `deno task check`가 통과한다.
- 위험 test(2개, `tests/eval/runner/`의 `_test.ts`, 순수):
  1. "variant가 바꾼 component가 spec의 X@a → X@b가 아니면 시작하지 않고, `to`의 n이 짐작과 다르거나 다른 component까지 바뀌었으면 막지 않고 알려 준다": `checkChange`에 `changedComponents`의 결과 모양 목록과 `spec.change`를 넣는다. 다른 것을 시험하는 trial에 돈을 쓰거나 결과를 엉뚱한 component 탓으로 읽게 된다.
  2. "registry를 쓰는 호출은 동시에 겹치지 않고 순서대로 돈다": `serial`에 손으로 푸는 promise 둘을 넣는다. 병렬 trial이 같은 registry file을 동시에 쓰면 버전 표가 깨진다(깨진 표는 모든 run 기록을 못 쓰게 한다).
- `runner/trials_test.ts`(`runTrials`의 비용 상한 test)는 지웠다. 나머지 runner test(`idle` 등)는 그대로 통과한다.
- 새 subprocess·서버·브라우저를 띄우는 test는 만들지 않는다.
- 손 확인(진짜 provider 없이):
  - `deno task eval:gate <id>`를 임시 spec(`tests/eval/experiments/<임시 id>/spec.json`, 커밋하지 않는다. 그래서 5번 lock 검사에서 걸리는 것도 확인한다)과 worktree 하나로 돌려 세 단계가 차례로 찍히고, check가 깨진 worktree에서는 e2e와 dry run이 안 도는 것을 본다. lock 검사를 통과시켜 보려면 spec과 case 시나리오를 먼저 commit한 임시 branch를 쓴다.
  - key 없이 `eval:experiment <id>`가 gate까지 돌고 key 안내와 함께 1로 끝나는지 본다. 모르는 id는 1(spec 없음), 인자 오류는 2.
  - 진짜 provider로 도는 확인은 하지 않는다. lead가 첫 experiment 때 한다(예산 안에서).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `deno.json`의 `eval:experiment`, `eval:gate` task, `fmt.exclude`에 `tests/eval/experiments/`. `eval:judge`, `eval:answer`는 ex-judge-agent·ex-human-agent가 만든 입구라 lead가 같이 올린다
- 안 쓰게 된 export: `runTrials`(지웠다)
- 정한 것: landed export와 달라 맞춘 이름, 종료 코드, 줄 모양을 바꾼 것, ec-driver의 root 인자 이름과 `binDir` 규칙
- 넘길 줄: wave 2 조각의 export가 모자라 `runner/`에 둔 이음 코드
- 계약 바꾸기 요청: `tests/eval/types.ts`는 죽은 `cost_usd` 칸을 지우는 것 말고 고치지 않는다(`TrialResult.components`, `JudgeItem.state`·`model`, `CheckResult.pending`은 ex-spec이 더한다).
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: coding agent의 hook은 variant가 아니라 주 checkout의 CLI로 돈다(표의 "coding driver"). `packages/coding-agent/cli`나 hook route를 고치는 experiment는 이 길로 못 잰다(planner가 정한다). 첫 신호 뒤 도는 coding trial은 최대 90분(`CODING_TRIAL_LIMIT_MS`)을 끝까지 돈다. 둘째 신호의 `Deno.exit(130)`은 도는 core와 Claude Code child를 직접 정리하지 않는다(driver `stop()`을 부르지 않는다). 동시에 도는 coding trial 둘이 한 Claude Code 로그인을 같이 쓰는 것은 확인한 적이 없다. 질문에 답이 안 오면 시간 상한까지 기다린다(그 trial은 timeout으로 떨어진다). 채점은 process 밖이라 experiment 하나가 "돌림 → 채점 → 다시 돌림"으로 최소 두 번 명령을 부른다. 이어 돌리기(앞 단위의 새 산출물을 뒤 단위가 받는 것)는 없다. assembly 재생은 coding agent가 든 시나리오에서 하지 않는다.
