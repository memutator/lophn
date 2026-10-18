# ex-cli

`deno task eval:experiment <id>`와 `deno task eval:gate <id>`를 만든다. wave 2 조각(spec, select, trials, verdict, variant, gate, parallel, overfit, assembly, repeat)을 runner에 잇는다: spec 읽기와 검사 → 버전 확인 → 고르기 → gate → 경고 → 병렬 실행(trial 정책) → 판정 → `result.json`. 새 규칙은 거의 없고 잇는 일이다. 같이, `deno task eval`의 trial 실행을 병렬 pool로 바꾸고 trial이 variant checkout의 core를 쓰게 한다.

- 단위: ex-cli (wave 3)
- 선행: ex-select, ex-trials, ex-verdict, ex-variant, ex-gate, ex-parallel, ex-overfit, ex-assembly, ex-repeat
- 소유(이 task만 고친다):
  - `tests/eval/run.ts`
  - `tests/eval/runner/**`
  - `tests/eval/experiment/mod.ts`
- 읽을 것:
  - 설계 정본: `project-docs/products/roadmap/eval.md`의 "experiment"(표, "trial 수", "특정 시나리오에 맞추지 않기"), "역할과 흐름"(gate, program이 하는 일), "병렬과 의존", "공통 수치"의 assembly 단락, "지켜야 할 것"
  - 계획: `project-docs/plan/eval-experiment/README.md`("정한 것" 전부), `project-docs/plan/eval-coding/README.md`
  - eval-base brief: `ev-runner.md`(이 task가 고치는 코드의 원래 모양), `ev-versions.md`, `ev-collect.md`(`writeFullRecord`), `ev-scorecard.md`(`readRuns`, `pick.ts`의 `Current`), `ev-restore.md`, `ev-provider.md`(`attachRealModels`의 `endpoint`), `ev-judge.md`
  - eval-coding brief: `ec-runner.md`(landed 코드가 정본이다. 이 task가 합치는 바탕: `runner/idle.ts`의 hooks, `runner/spend.ts`, `runner/steps.ts`, `runner/trial.ts`의 driver·사람 역할·save), `ec-driver.md`(`prepareCodingAgent`, `startCodingDriver`, `repoRoot`, `binDir`), `ec-restore.md`(`restoreWorld(ctx, refs, options?)`, `restoreCoreEnv(refs, root?)`)
  - eval-experiment brief: `ex-spec.md`, `ex-select.md`, `ex-trials.md`, `ex-verdict.md`, `ex-variant.md`, `ex-gate.md`, `ex-parallel.md`, `ex-overfit.md`, `ex-assembly.md`, `ex-repeat.md`
- 계약:
  - 쓰는 것. 아래 이름은 각 brief가 정한 것이다. landed 코드와 다르면 landed 코드를 따르고 "정한 것"에 적는다.
    | 출처(`tests/eval/experiment/<폴더>/mod.ts`) | export |
    |---|---|
    | `spec` (ex-spec) | `readSpec(dir, id): Promise<Result<{ spec, hash }>>`, `readResult(dir, id): Promise<Result<ExperimentResult \| null>>`, `writeResult(dir, result)`, `checkSpecAgainst(spec, { scenarios, runs, versions })`, `checkSpecLocked(facts: LockFacts): Result<{ spec_commit }>`, `outcomeOf(trial)`, `EXPERIMENTS_DIR`, type `ExperimentSpec`, `ExperimentResult`, `PlanEntry`, `Outcome`, `LockFacts`, `OverfitWarning`, `AssemblyReport` |
    | `select` (ex-select) | `selectRuns(spec, runs, current): Result<Plan>`(`Plan = { entries: PlanEntry[]; keep; excluded }`), `changedComponents(baseMap, variantMap): { from; to }[]`. `current`는 ev-scorecard `pick.ts`의 `Current` |
    | `trials` (ex-trials) | `nextTrials(state: TrialState, policy): number`, `flakyScenarios(runs, scenarios): Set<string>`, `estimateTrials(entries, policy): Estimate` |
    | `verdict` (ex-verdict) | `decide(input: VerdictInput): Result<ExperimentResult>`, type `VerdictEntry`, `VerdictInput` |
    | `variant` (ex-variant) | `resolveVariant`, `explainBreak`, `Variant`(`root`, `isCurrent`, `versionDeps`, `graderDeps`, `boot`) |
    | `gate` (ex-gate) | `runGate`, `defaultGateDeps`, `GateReport` |
    | `parallel` (ex-parallel) | `createPool`, `trialKindOf`, `Pool`, `Job`, `JobResult`, `Budget` |
    | `overfit` (ex-overfit) | `loadChangedText(registryDir, change)`, `findOverfit(changed, scenarios, extraNames?)`, `formatWarnings(warnings)` |
    | `assembly` (ex-assembly) | `loadRecordedTrial(dir, run, index)`, `measureAssembly(deps: { port: ReplayPort; startFake? }, args)`, `formatAssembly(report)`, type `ReplayPort`. **`ReplayPort`는 이 task가 구현한다**(아래) |
    | `repeat` (ex-repeat) | `REPEAT_KIND`, `findRepeatGroups(trial, minCount?)`, `judgeRepeats(deps, trial, opts?): Promise<{ findings: RepeatFinding[]; cost_usd }>`, type `RepeatFinding` |
    | eval-base | `tests/eval/versions/mod.ts`의 `currentVersions`, `readEntries`, `contentFiles`, `registerAuthored`, `criterionContent`, `hashText`, `judgeContent`, `coreVersion`, `checksVersion`, `captureSource`, `seenComponents`, `denoGit`. `tests/eval/scorecard/runs.ts`의 `readRuns`, `pick.ts`의 `Current`. `tests/eval/runner/`의 기존 `discoverScenarios`, `createCap`. `tests/eval/provider/mod.ts`의 `readAnthropicKey`, `attachRealModels`. `tests/eval/collect/mod.ts`의 `writeFullRecord`. `tests/eval/judge/mod.ts`의 `loadJudgeDefinition`. `tests/eval/criteria/mod.ts`의 `loadCriterion`. `tests/eval/restore/mod.ts`의 `beginRestore`, `restoreWorld`, `endRestore`, `agentRefOf`와 `manifest.ts`의 `loadMaterial` |
    | eval-coding | `tests/eval/restore/mod.ts`의 `restoreCoreEnv(refs, root?)`, ec-runner가 만든 `runner/`의 `waitUntilIdle`(hooks), `runSteps`, `createSpendGuard`, `TRIAL_CAP_USD`, ec-driver의 `prepareCodingAgent`, `startCodingDriver` |
  - 내놓는 것:
    - `tests/eval/experiment/mod.ts`: `runExperimentCommand(args: string[]): Promise<number>`, `runGateCommand(args: string[]): Promise<number>`(종료 코드를 돌려준다).
    - `deno task`(lead가 등록): `"eval:experiment": "deno run --allow-all --env-file=.env tests/eval/run.ts experiment"`, `"eval:gate": "deno run --allow-all tests/eval/run.ts gate"`. `eval:gate`는 `--env-file`이 없다. gate는 key를 읽지 않는다.

## 이 task가 eval-base `ev-runner`와 eval-coding `ec-runner`에서 바꾸는 것

ev-runner가 만든 것과 ec-runner가 이은 것(driver, 사람 역할, hooks가 든 `waitUntilIdle`, `runSteps`, 비용 상한 `createSpendGuard`, save)은 그대로 둔다. 아래 여섯 곳만 바꾼다.

| 곳 | 원래 | 이 task가 바꾸는 것 |
|---|---|---|
| core 띄우기 (`runner/trial.ts`) | `bootCore(run, { settings, env })`(`env`는 ec-runner의 `restoreCoreEnv`) | `variant.boot(run, { settings, env })`. 되살리기 앞부분(`createRun` → boot → `beginRestore` → `restoreWorld` → `scenario.setup` → `endRestore`)을 `runner/world.ts`의 `prepareTrialWorld(deps, scenario)`로 떼어 낸다. **boot 옵션(settings, ec-runner의 `coding-agent.default_*` 설정, `restoreCoreEnv(refs)`의 env)을 trial과 똑같이 만든다**(함수 하나 `bootOptionsOf(scenario, model)`를 둘이 같이 쓴다). 이유: gate의 dry run이 trial과 다른 환경으로 돌면 active app 재료의 되살리기가 dry run에서만 통과하거나 깨진다 |
| 버전·출처 (`runner/trial.ts`, `runner/cli.ts`) | `seenComponents(sessions)`, `coreVersion()`, `captureSource()` | `seenComponents(sessions, variant.versionDeps)`, `coreVersion(variant.versionDeps)`, `captureSource(variant.versionDeps)`. `checksVersion`, `scenarioHash`, criterion, judge는 `variant.graderDeps`(지금 checkout). `TrialResult.components`를 채운다(아래) |
| coding driver (`runner/trial.ts`) | `prepareCodingAgent`, `startCodingDriver`가 지금 checkout을 가리킨다 | ec-driver의 checkout root 인자(`PrepareDeps.repoRoot`, `DriverDeps.repoRoot`. landed 이름을 따른다)에 `variant.root`를 넘긴다. `binDir`은 variant마다 따로 둔다(`.dev-data/eval/bin/<root 경로의 sha256 앞 12자>`). 이유: `ensureWrapper(binDir, repoRoot)`는 내용이 다르면 wrapper를 다시 쓰므로, 한 `binDir`을 checkout 둘이 쓰면 동시에 도는 trial의 wrapper가 서로를 덮는다 |
| trial 실행 (`runner/trials.ts`의 `runTrials`) | 차례로 돈다. ec-runner는 coding 시나리오의 trial을 차례로만 돌고 안내를 찍는다 | `runTrials`와 그 test, 그 안내 줄을 지운다. `createPool`로 돈다(kind별 한도 judgment 4, coding 2, 예산). `createCap`은 남겨 pool의 `Budget`으로 쓴다 |
| trial 뒤 (`runner/trial.ts`) | judge까지 | `judgeRepeats`를 부르고, 비용을 trial 비용(`Job.run`의 `cost_usd`)에 더하고, 결과를 `writeFullRecord`로 `.dev-data/eval/<runId>/trial-<i>.repeat.json`에 쓴다(통과 판정에는 안 든다) |
| 입구 (`run.ts`) | `deno task eval` 하나 | 첫 인자가 `experiment`, `gate`이면 `experiment/mod.ts`로 보낸다. 아니면 기존 eval 인자 읽기(`runner/cli.ts`) 그대로 |

- **`TrialResult.components`**: ex-spec이 `tests/eval/types.ts`에 `TrialResult.components?: VersionRef[]`를 더한다(그 trial의 진짜 model이 본 component). trial 함수가 `seenComponents`(와 ec-runner가 더하는 `cli`) 결과를 이 칸에 넣는다. `RunRecord.components`는 지금처럼 trial들의 합집합이다. 이유: ex-select와 ex-trials가 run 전체 합집합 대신 trial마다 본 것을 쓴다.
- **registry 쓰기를 직렬로 한다** (`runner/mutex.ts`, 새 file): `serial<T>(fn: () => Promise<T>): Promise<T>`. trial이 동시에 돌면 `seenComponents`가 `resolveVersion`으로 같은 registry file을 동시에 쓴다(ev-versions "같은 file을 동시에 쓰는 일은 막지 않는다"). trial 안의 `seenComponents`와 `measureCli`·`resolveVersion` 호출을 모두 `serial`로 감싼다. 시작할 때 등록(`registerAuthored`)은 차례로 하므로 따로 감싸지 않는다.
- **save** (ec-runner가 이은 것): ec-runner는 "이 run에서 아직 저장한 trial이 없으면" 첫 통과 trial만 저장한다. 동시 trial에서는 이 확인이 겹치므로 `runScenario` 안의 작은 상태(저장했나)를 `serial`로 지킨다. experiment에서는 save하지 않는다(`saveEnabled: false`). 이유: 새 산출물은 후보라 experiment가 만들 필요가 없다(roadmap "이어 돌리기"는 이 계획 밖).
- **run 읽기는 JSON 안의 `id`로** 한다. `readRuns`가 돌려준 `RunRecord.id`를 키로 쓴다. 파일 이름에서 id를 만들지 않는다(eval-base runner의 파일 이름이 `RunRecord.id`와 다를 수 있다).

## 할 일

### 1. runner 바꾸기 (`tests/eval/runner/**`, `run.ts`)

1. `world.ts`: `bootOptionsOf(scenario, model)`와 `prepareTrialWorld(deps, scenario)`. 위 표대로 trial에서 떼어 낸다. boot나 되살리기가 실패하면 `explainBreak(variant, "boot" | "restore", message)`로 이유를 만들어 던진다(runner는 이유를 찍고 멈춘다).
2. `mutex.ts`: `serial`.
3. `trial.ts`: 위 표대로 바꾼다. 반환의 `cost_usd`는 role agent + judge + 사람 역할 + repeat 진단 비용의 합이다(pool의 `Job.run`이 쓴다).
   - repeat 진단: `judgeRepeats({ fetch, apiKey, criterion: await loadCriterion(parseRef(REPEAT_KIND, "criterion")), judge: await loadJudgeDefinition() }, trial)`. 묶음이 없으면 judge를 부르지 않는다(ex-repeat). `RepeatFinding`에는 시나리오와 trial 칸이 없으므로 `finding.item.check`를 `<시나리오 id>#<trial index>/<원래 check>`로 바꿔 넣는다. 이유: `result.json`의 `repeats`에서 어느 trial의 것인지 알아야 한다.
4. `scenario.ts`(새): `runScenario(args)` — 시나리오 하나의 모든 trial을 pool로 돌려 `RunRecord`를 만든다. 인자는 `{ scenario, variant, pool, next, model }`이고 `next(results: TrialResult[]): number`는 "지금까지 결과를 보고 더 돌릴 trial 수"다. 흐름: `next([])`개를 한꺼번에 `pool.submit` → 끝난 결과로 `next(results)`를 다시 물어 0이 될 때까지 더 낸다. 한 trial은 `Job`(`kind: trialKindOf(scenario)`, `id: "<시나리오 id>#<index>"`)이다. `skipped`인 trial은 기록에 넣지 않는다. `failed`(core 오류 등)는 이유를 찍고 그 시나리오를 멈춘다. `RunRecord` 조립(components 합집합, grader, source)은 ev-runner "할 일 5-6"에 있던 코드를 옮긴다. `deno task eval`에서는 `next = (results) => results.length === 0 ? --trials : 0`이다.
5. `cli.ts`: 시나리오를 고르고 등록하는 앞부분(ev-runner "할 일 5-1~3")은 그대로 두고, `runTrials` 자리를 `createPool({ budget: createCap(--budget) })`와 시나리오별 `runScenario`를 `Promise.all`로 잇는 것으로 바꾼다. 요약 줄과 상한 알림은 `pool.halted()`로 찍는다. 종료 코드와 ec-runner가 더한 옵션(`--trial-budget`)은 그대로다.
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
8. **이어 돌리기**: `readResult(dir, id)`. 판정이 `adopt`나 `reject`이면 "판정이 이미 났다. 새 spec(새 id)을 쓴다"를 찍고 1(`writeResult`가 어차피 거절한다). `inconclusive`이면 그 `scenarios[].variant_runs`의 run id를 `runs`에서 찾아(`RunRecord.id`로) 시나리오마다 앞서 돈 variant trial을 이번 결과에 합친다. 그 trial들의 `outcomeOf`가 아래 `next`의 `variant`에 먼저 든다.
9. **gate**(`--skip-gate`가 아니면): `runGate({ checkout: variant.root, base, scenarios: <entries의 시나리오 전부> }, defaultGateDeps({ validateFixtures, dryRun, catalogRoot: <지금 checkout> }, variant.root))`. `dryRun`은 `prepareTrialWorld`를 쓰는 함수(끝나면 core를 끄고 run을 지운다). 단계마다 한 줄을 찍는다. 실패하면 진짜 model은 한 번도 부르지 않은 채 1.
10. **경고**: `loadChangedText(registryDir, spec.change)`가 null이면 "내용을 못 봐서 경고를 못 낸다" 한 줄. 아니면 `findOverfit(changed, <entries의 시나리오>, extraNames)`. `extraNames`는 시나리오 `world` 재료마다 `loadMaterial(...)`의 `manifest.ids` 키(앱·project·Operator·context 이름)를 시나리오 id별로 모은 것이다. `formatWarnings`로 찍고 막지 않는다. 결과는 `ExperimentResult.overfit`에 남긴다.
11. **assembly**: `spec.change.from.kind === "assembly"`이면 entries의 기준 run마다(entry당 첫 run의 trial 0) `loadRecordedTrial(".dev-data/eval", run, 0)` → `measureAssembly({ port: replayPort }, { run, trial, scenario, model: spec.model, checkout: variant.isCurrent ? null : variant.root })`, `formatAssembly`로 찍는다. 기록이 없는 run은 이유와 함께 건너뛴다. 결과는 `ExperimentResult.assembly`. 진짜 model을 부르지 않는다. `--prefix-only`이면 `result.json`을 쓰지 않고 0으로 끝난다.
12. **어림**: `estimateTrials(entries.map((entry) => ({ entry, flaky })), spec.trials)`(`flaky = flakyScenarios(runs, scenarios).has(id)`)를 찍는다. `usd.worst`가 예산보다 크면 "예산 부족할 수 있음"을 더한다. 막지 않는다(상한은 pool이 지킨다).
13. **key**: `readAnthropicKey(Deno.env)`가 없으면 "ANTHROPIC_API_KEY가 없다"를 찍고 1. (`deno task eval`은 key가 없으면 0이지만, 사람이 확정해 돌리는 experiment는 돌지 않은 것을 성공으로 보이면 안 된다.) coding 시나리오가 있으면 `prepareCodingAgent`를 한 번 부른다(ec-runner가 하는 길 그대로, `repoRoot: variant.root`).
14. **등록**: `repeat-kind@1` criterion을 `registerAuthored`로 등록한다(`kind: "criterion"`, `hashText(criterionContent(criterion))`). 시나리오·재료·judge criterion 등록은 ev-runner 앞부분과 같다.
15. **실행**: `pool = createPool({ budget: createCap(budget) })`, SIGINT 연결. entries마다 `next = (results) => nextTrials({ role, checks, baseline: entry.baseline, variant: [...prior, ...results.map(outcomeOf)], flaky }, spec.trials)`로 `runScenario`를 `Promise.all`로 돌린다(`prior`는 8번의 앞서 돈 variant outcome). 시나리오 코드는 지금 checkout(`graderDeps`)에서, core는 `variant`에서 뜬다. 새 run은 `tests/eval/runs/`에 eval-base와 같은 꼴로 쓴다. `saveEnabled: false`.
16. **판정**: entries마다 `VerdictEntry`(`variant_runs` = 앞서 돈 run id + 이번 run id, `variant` = 그 trial들의 `outcomeOf`, `remaining` = `next`를 같은 상태로 다시 부른 값)를 만들고 `VerdictInput`(`spec`, `spec_hash`, `spec_commit`, `changed`, `entries`, `keep`, `excluded`, `stopped_by_budget: pool.halted() === "budget"`, `decided_at: clock.now()`)으로 `decide(input)`를 부른다. 이어 `result.overfit`, `result.repeats`(이전 `inconclusive`의 것에 이번 것을 이은 목록), `result.assembly`를 채운 뒤 `writeResult(dir, result)`로 쓴다(`recordVerdict`를 쓰지 않는다. 진단 칸을 쓰기 전에 채워야 한다). 신호로 멈춰 `remaining`이 남았으면 `decide`가 `inconclusive`를 내게 그대로 넘긴다. 마지막 줄에 판정을 찍는다. 종료 코드는 채택·기각·판정 불가 모두 0이다. 이유: 해석은 experimenter 몫이다. 판정을 코드로 막지 않는다.

### 3. `eval:gate <id>`

인자: `<id>`, `--checkout <path>`, `--base <rev>`. 위 1~7번과 9번(key 없음, 진짜 model 없음)만 돈다. 통과하면 0, 실패하면 1.

### 4. 찍는 글 (runner(Haiku)가 읽는다. 한 줄에 사건 하나, 접두 고정)

```
[variant] /path/to/worktree (core@31)            [change] instruction:lophn@3 -> @4  mixed: -
[select] target L4-app@1  case L4-todo@1  guard L5@1 ...
[gate] check ok 41s    [gate] e2e skipped (고른 e2e 없음)    [gate] dry-run L4-app ok
[warn] 경고: ...                               [assembly] <layer> 0.93 -> 0.90
[estimate] trials 8..24 (likely 12) $8.40 (budget $100)
[trial] L4-app#0 start    [trial] L4-app#0 pass $0.012    [trial] L4-app#1 fail (check-id) $0.011
[budget] $12.31/100.00
[halt] budget | stopped        [verdict] adopt | reject | inconclusive
```

접두와 줄 모양은 `ex-skills`가 이 글을 읽는 법을 쓰므로 바꾸지 않는다. 대답 글, 요청 body, key는 찍지 않는다.

## 정한 것

- 순서는 "spec → 버전 확인 → 고르기 → gate → ..."다. 이유: gate의 dry run이 고른 시나리오를 필요로 하고, 고르기는 읽기뿐이라 돈이 안 든다.
- `eval:experiment`가 gate를 직접 돌린다(`--skip-gate`로 건너뛴다). 이유: gate 없이 진짜 model을 부르지 않는다는 보증을 입구가 가진다. 건너뛰는 것은 방금 `eval:gate`가 통과했을 때 중복을 피하려는 것이다.
- `deno task eval`도 pool로 돈다. 이유: 코드 길이 하나. `--trials`가 N이면 N개가 동시에 도는 것은 늘 바라던 동작이다.
- experiment의 종료 코드는 판정을 담지 않는다. 판정은 `result.json`과 마지막 줄에 있다.
- 이어 돌리기: `inconclusive` result가 있으면 이어서 돈다. 이유: 예산이나 신호로 끊긴 experiment를 새로 시작하면 이미 쓴 run이 기준 run으로 들어간다(ex-verdict 계약).
- `repeat` 진단은 experiment에서만이 아니라 `deno task eval`에서도 돈다. 이유: 같은 trial 함수를 쓴다. 비용은 Haiku 호출 한두 번이고 묶음이 없으면 0이다.
- `result.json`은 `writeResult`로 쓴다. 판정이 난 result는 덮이지 않는다(ex-spec).

## 끝남

- `deno task check`가 통과한다.
- 위험 test(2개, `tests/eval/runner/`의 `_test.ts`, 순수):
  1. "variant가 바꾼 component가 spec의 X@a → X@b가 아니면 시작하지 않고, `to`의 n이 짐작과 다르거나 다른 component까지 바뀌었으면 막지 않고 알려 준다": `checkChange`에 `changedComponents`의 결과 모양 목록과 `spec.change`를 넣는다. 다른 것을 시험하는 trial에 돈을 쓰거나 결과를 엉뚱한 component 탓으로 읽게 된다.
  2. "registry를 쓰는 호출은 동시에 겹치지 않고 순서대로 돈다": `serial`에 손으로 푸는 promise 둘을 넣는다. 병렬 trial이 같은 registry file을 동시에 쓰면 버전 표가 깨진다(깨진 표는 모든 run 기록을 못 쓰게 한다).
- eval-base `ev-runner`의 `runTrials` test는 지웠다. 나머지 runner test(`idle` 등)는 그대로 통과한다.
- 새 subprocess·서버·브라우저를 띄우는 test는 만들지 않는다.
- 손 확인(진짜 provider 없이):
  - `deno task eval:gate <id>`를 임시 spec(`tests/eval/experiments/<임시 id>/spec.json`, 커밋하지 않는다. 그래서 5번 lock 검사에서 걸리는 것도 확인한다)과 worktree 하나로 돌려 세 단계가 차례로 찍히고, check가 깨진 worktree에서는 e2e와 dry run이 안 도는 것을 본다. lock 검사를 통과시켜 보려면 spec과 case 시나리오를 먼저 commit한 임시 branch를 쓴다.
  - key 없이 `eval:experiment <id>`가 gate까지 돌고 key 안내와 함께 1로 끝나는지 본다. 모르는 id는 1(spec 없음), 인자 오류는 2.
  - 진짜 provider로 도는 확인은 하지 않는다. lead가 첫 experiment 때 한다(예산 안에서).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `deno.json`의 `eval:experiment`, `eval:gate` task, `fmt.exclude`에 `tests/eval/experiments/`
- 안 쓰게 된 export: `runTrials`(지웠다)
- 정한 것: landed export와 달라 맞춘 이름, 종료 코드, 줄 모양을 바꾼 것, ec-driver의 root 인자 이름과 `binDir` 규칙
- 넘길 줄: wave 2 조각의 export가 모자라 `runner/`에 둔 이음 코드
- 계약 바꾸기 요청: `tests/eval/types.ts`에 칸이 필요한 것이 있으면 여기 적는다. 이 task는 `types.ts`를 고치지 않는다(`TrialResult.components`는 ex-spec이 더한다).
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: coding agent가 쓰는 hook·skill 설치(ec-driver의 결정 2)가 한 checkout의 wrapper 절대 경로로 박히면 다른 checkout의 variant에서는 hook이 그 wrapper를 부른다(`lophn` 꼴로 PATH를 쓰는 설치면 괜찮다). 이어 돌리기(앞 단위의 새 산출물을 뒤 단위가 받는 것)는 없다. assembly 재생은 coding agent가 든 시나리오에서 하지 않는다.
