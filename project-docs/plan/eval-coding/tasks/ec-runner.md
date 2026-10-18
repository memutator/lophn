# ec-runner

land한 eval-base runner(`tests/eval/runner/`, `tests/eval/run.ts`)에 진짜 coding agent를 잇는다. coding session도 기다리고, App Engineer가 맡긴 coding session을 eval driver가 PTY로 띄우고, 기다리는 동안 사람 역할이 `ask`와 허락에 답하고, coding agent 기록을 trial에 담고, 새 단계(call 본문 보내기, app-api 부르기)를 돌리고, 통과한 trial의 산출물을 후보 재료로 쓴다. 새 규칙은 거의 없고 앞선 task가 내놓은 것을 잇는 일이다.

- 단위: ec-runner (wave 3)
- 선행: ec-driver, ec-metrics, ec-human, ec-restore. 넷 모두 merge된 export를 읽어 잇는다(ec-contract와 eval-base의 runner는 그보다 앞서 merge되어 있다).
- 소유(이 task만 고친다):
  - `tests/eval/run.ts`
  - `tests/eval/runner/**`
- 읽을 것:
  - 설계: `project-docs/products/roadmap/eval.md`의 "시나리오"(꼴, 캘린더 단위), "진짜로 도는 것"(eval driver, 사람 역할, 허락 규칙, 전제 재료), "병렬과 의존"(coding agent trial은 무거워 동시에 1~2개), "재료"(자리와 조립, 결과 저장), "공통 수치"
  - 계획: `project-docs/plan/eval-coding/README.md`의 "정한 것"(driver, 상한, coding agent model), "돌리기 전에 확인할 것"
  - land한 eval-base 코드(이 task가 늘리는 바탕. 정본이다): `project-docs/architecture/eval.md`, `tests/eval/runner/{idle,trial,trials,cap,cli,discover,mod}.ts`와 `idle_test.ts`·`trials_test.ts`, `tests/eval/run.ts`(`Deno.exit(await main(Deno.args))`), `tests/eval/types.ts`, `tests/eval/collect/read.ts`(`collectSessions`의 `roots`와 `since`), `tests/eval/provider/attach.ts`(`attachRealModels`는 role agent만 받는다), `tests/eval/versions/{components,registry}.ts`(`measureCli`, `resolveVersion`), `tests/eval/restore/mod.ts`, `tests/eval/checks/run.ts`(`runProgramChecks`는 이미 배열 순서대로 하나씩 돈다)
  - 같은 계획의 brief: `ec-driver.md`, `ec-metrics.md`, `ec-human.md`, `ec-restore.md`, `ec-contract.md`. merge된 실제 export를 따른다. 아래 이름과 다르면 실제 이름으로 맞추고 보고에 적는다.
  - architecture: `project-docs/architecture/coding-agent.md`(coding session, 터미널, 완료 보고가 call을 닫는 길), `project-docs/architecture/approval.md`(request 두 길)
  - 이미 있는 길:
    - `tests/support/app/activate.ts`: 앱을 제품 길로 켜는 순서(ticket → coding agent → release → 검증 → activation 허락 → 앱 process). 진짜 coding agent는 그 가운데 "coding agent(CLI)의 claim·release 준비·app test·보고" 몫만 진짜가 된다.
    - `tests/support/core/mod.ts`의 `bootCore(run, { settings })`: 설정 file을 새 root에 쓴다. 선언 안 된 key가 하나라도 있으면 file 전체가 거절된다.
    - `packages/core/apps/tickets/coding/settings.ts`: `coding-agent.default_harness`, `coding-agent.default_model`. call에 실행 옵션이 없을 때 쓰는 Settings 기본이다(`packages/core/main/daemon/wiring/coding-sessions.ts`의 `defaults()`가 읽는다).
    - `packages/protocol/apps/calls/call.ts`: `appCallApi`(입력 `target`, `api`, `input?`, `caller`)
    - `packages/protocol/events/snapshot.ts`: `sessionSnapshotsList`의 coding session(`agent.role: "coding_agent"`, `state`: `running`/`waiting`/`idle`/`unknown`). `unknown`은 harness 신호를 아직 못 받았다는 뜻이다(`stateOf`, `packages/core/apps/tickets/coding/store.ts`).
    - `packages/protocol/approvals/requests.ts`: `approvalsPending`. 보류 request(activation)는 아무도 기다리지 않아 session 상태에 안 드러난다.
- 계약:
  - 쓰는 것(eval-base의 확정된 export. land한 runner가 이미 쓰는 것은 다시 적지 않는다. 아래는 이 task가 새로 기대는 것이다. 이름은 같은 계획의 brief 기준이고, merge된 실제 export가 다르면 실제 이름을 따르고 보고에 적는다):
    - ec-contract `tests/eval/types.ts`(`ec-contract.md`):
      - `Scenario.human?: HumanSpec`(`{ card: string; approve: ApproveRule }`), `Scenario.save?: Save`
      - `Scenario.real: (Participant | CodingParticipant)[]`와 `isCodingAgent(p)`. 이 helper를 `types.ts`에서 import해서 쓴다. 직접 `role === "coding_agent"`로 가르거나 cast하지 않는다.
      - `Step`: `{ kind: "deliver"; material: string }`(재료 이름, 예 `"calendar-call"`)과 `{ kind: "callApi"; app: string; api: string; input?: unknown }`(`app`은 app.name)
      - `JudgeCheck.input`은 `string | Promise<string>`이다(live 입력이 route를 읽는다). runner가 `await`한다.
      - `TrialRecord.coding?: CodingRecord[]`, `TrialRecord.human?: HumanRecord`, `TrialResult.coding?: CodingSummary[]`, `TrialResult.human?: HumanSummary`(`{ answered, fallback, decisions, cost_usd }`. 요약만 담는다. 터미널 글과 답 글은 없다), `Save`·`SaveSource`(`active_app`과 `call`만)
    - ec-driver `tests/eval/coding/driver/mod.ts`:
      - `prepareCodingAgent(deps: { core: Core; repoRoot: string; binDir: string; model: string; clock: Clock; install: "check" | "install" }): Promise<{ wrapper: string; claude: string; version: string }>`. 설정 `coding-agent.default_harness`·`default_model`을 `settingsUpdate`로 넣고 진짜 claude를 `harnessReport`하고 hook·skill 설치를 확인한다. 설치가 없으면 놓을 file과 사람이 칠 명령을 담아 던진다.
      - `startCodingDriver(deps: { core: Core; clock: Clock; binDir: string; outDir: string; repoRoot: string; timeoutMs?: number; noSessionStartMs?: number }): CodingDriver`. `CodingDriver = { active(): number; traces(): CodingTrace[]; stop(): Promise<CodingTrace[]> }`. Gateway 연결을 이 driver가 연다. `repoRoot`는 `lophn` wrapper가 가리키는 checkout이다(지금 checkout. `eval-experiment`가 다른 checkout을 줄 때 바뀐다).
    - ec-driver의 attach(사람이 선택한 길): coding session이 열리면 driver가 `DriverDeps.log`로 `deno task eval:attach <session> [--write]` 한 줄을 직접 찍는다. runner는 `startCodingDriver`에 자기 `log`를 넘기기만 한다. 사람이 `--write`로 입력했으면 `CodingRecord.human_input`이 참이다(ec-contract). `CodingSummary`에도 남는다.
    - ec-metrics `tests/eval/coding/metrics/mod.ts`: `collectCoding(deps: { home: string }, traces: CodingTrace[]): Promise<CodingRecord[]>`, `codingTotals(records): CodingUsage | null`. `home`은 사람의 HOME이다(driver가 HOME을 바꾸지 않으므로 Claude Code의 JSONL이 거기 있다).
    - ec-human `tests/eval/human/mod.ts`: `createHumanRole({ port, fetch, apiKey, clock, spec })` → `{ tick(): Promise<{ acted: number }>; record(): HumanRecord }`. (`ec-human.md`)
    - ec-restore `tests/eval/restore/mod.ts`:
      - `restoreCoreEnv(refs: string[], root?: string): Promise<Record<string, string>>`: `bootCore(run, { settings, env })`의 `env`다. 켜진 앱 같은 재료가 있으면 release 준비에 필요한 deno dir 등을 준다.
      - `deliverCall(ctx: SetupContext, ref: string): Promise<Result<{ call: string }>>`: `ref`는 world의 `이름@n`. fake lophn이 그 call 재료의 본문을 보낸다. 돌려주는 `call`은 call id다.
      - `saveMaterials(deps: { core: Core; world: WorldIds; refs: string[]; trial: TrialRecord; root?: string }, save: NonNullable<Scenario["save"]>, from: { scenario: string; trial: number; run: string }): Promise<Result<{ name: string; n: number }[]>>`
      - `endRestore`가 restore가 연 Gateway와 fake를 모두 닫는다(driver가 같은 `coding_terminal` frame을 두 번 받지 않게).
    - `packages/protocol/lophn-agent/calls.ts`의 `callRead`(`record.receiver_session`)
    - `tests/eval/versions/mod.ts`(land): `measureCli(name, versionText): Promise<Measured>`, `resolveVersion(dir, measured): Promise<{ref, created}>`. `mod.ts`가 registry 폴더 상수를 내놓지 않으므로 `TrialDeps`에 `registryDir`을 더하고 `cli.ts`의 `REGISTRY_DIR`을 넘긴다.
  - 내놓는 것:
    - `tests/eval/run.ts`의 옵션이 늘어난다: `--trial-budget <usd>`(기본 50, trial 하나의 role agent·judge·사람 역할 비용 상한). 나머지 옵션, 종료 코드는 `ev-runner.md` 그대로다.
    - `tests/eval/runner/`의 export가 늘어난다: `waitUntilIdle`의 새 옵션(아래), `runSteps`, `createSpendGuard`, `CODING_TRIAL_LIMIT_MS`, `TRIAL_CAP_USD`. `eval-experiment`가 다시 쓴다.

## 할 일

1. `runner/idle.ts`의 `waitUntilIdle`을 늘린다. land한 `waitUntilIdle(read, deps: { clock, sleep }, options: { timeoutMs = 300_000, quietMs = 1_000, pollMs = 250 })`의 규칙(조용함이 `quietMs` 동안 이어져야 idle, `timeoutMs`를 넘으면 timeout, 반환 `IdleResult`)은 그대로 두고 아래를 더한다. `Snapshot`은 지금 `{ running: string[]; waiting: { session; questions: number; permissions: number }[]; unstarted: { session; message }[] }`다. `hooks`가 없으면 eval-base의 동작과 같아야 한다(판단 case는 `waiting`을 조용함으로 친다).
   - `Snapshot`에 선택 칸 `pendingApprovals?: number`(없으면 0. 지금 `idle_test.ts`의 `quiet` 값이 그대로 유효해야 한다)(`approvalsPending`의 개수)를 더한다. `readSnapshot(core, options?)`가 채운다. `hooks.act`가 있을 때만 읽는다.
   - `running`에 coding session도 넣는다: `agent.role === "coding_agent"`이고 `state`가 `running` 또는 `unknown`. 이유: coding agent가 일하는 동안 role agent는 모두 쉬므로, 안 넣으면 trial이 coding agent를 기다리지 않고 끝난다. `unknown`은 터미널이 막 열려 첫 hook 신호가 오기 전이거나 신호가 영영 안 오는 것이다. coding session은 App Engineer의 `call`이 만드는 순간부터 snapshot에 있어, 터미널이 뜨기 전의 틈도 이것으로 덮인다. 영영 안 오면 driver의 `noSessionStartMs` watchdog이 끊는다(없으면 `timeoutMs`). `receivedMessageList`는 coding session에는 읽지 않는다(`ev-runner.md` 그대로).
   - `IdleOptions`에 `hooks?: { act?(): Promise<boolean>; over?(): Promise<string | null>; graceMs?: number }`를 더한다(`stuckMs`도 같은 options에 든다):
     - `act`: `waiting`이 있거나 `pendingApprovals > 0`일 때 poll마다 부른다. 사람 역할 `tick()`을 감싼 것이다(`acted > 0`이면 참). 있으면 `waiting`과 `pendingApprovals > 0`은 조용함이 아니다(사람이 답할 때까지 기다린다). 없으면 `waiting`은 조용함이다. `act`가 참이면 조용함 시계를 처음부터 다시 잰다.
     - `graceMs`: `act`가 참이면 조용함이 이만큼(`quietMs` 대신) 이어져야 idle이다. 기본은 `quietMs`다. 이유: 활성화 허락을 낸 뒤 앱 process가 뜨고 release가 끝나기까지 role agent도 coding agent도 일하지 않는 사이가 있다(coding 시나리오는 10_000을 준다).
     - `over`: poll마다 부른다. 문자열을 돌려주면 그 이유를 stdout에 한 줄 찍고 `{ kind: "timeout", ... }`로 끝낸다. 비용 상한이 쓴다(아래 2).
   - `stuckMs`(기본 300_000): `receivedMessageList`에서 `turn === null`인 입력은 처음 본 때부터 `stuckMs`가 지나면 `timeoutMs`와 상관없이 timeout으로 끝낸다. 이유: `project-docs/issues/agent-definition.md`의 turn 준비 예외(기록 없이 영영 시작 안 하는 입력)를 90분 기다리지 않고 잡으려는 것이다. 처음 본 때는 message id마다 `Clock`으로 재고 입력이 사라지면 지운다.
   - `timeoutMs`의 coding 시나리오 값은 `CODING_TRIAL_LIMIT_MS = 90 * 60_000`(trial의 t0부터 잰 남은 시간). 판단 case는 기본 300_000 그대로다.
   - 반환 `Settle` 모양은 늘리지 않는다. timeout 이유(비용 상한 등)는 stdout에만 찍는다.
2. `runner/spend.ts`: 돈 상한.
   - `TRIAL_CAP_USD = 50`. role agent, judge, 사람 역할의 비용만 센다. coding agent는 세지 않는다(roadmap: token만 집계).
   - `createSpendGuard(deps: { limitUsd: number; roleSpend: () => Promise<number>; humanSpend: () => number; clock: Clock; everyMs?: number }): { over(): Promise<string | null> }`. `everyMs`(기본 30_000)가 지나야 `roleSpend()`를 다시 읽는다. 그 사이는 앞 값을 쓴다. `roleSpend() + humanSpend() > limitUsd`이면 `"trial 비용 $<합> > 상한 $<limit>"`를 돌려준다.
   - `roleSpendUsd(core): Promise<number>`: `sessionSnapshotsList({})`의 coding이 아닌 session마다 `modelCallList({ session })`을 읽어 `cost.kind`가 `reported`·`estimated`·`free`이고 `currency`가 USD인 것의 `amount`를 더한다. `tests/eval/collect/metrics.ts`의 `metricsOf`가 같은 규칙(`cost_usd`는 USD cost만)을 이미 쓰니 그 규칙에 맞춘다. 요청 body를 읽는 `collectSessions`는 부르지 않는다(주기적으로 읽기에 무겁다). 이유: roadmap의 trial 한 번 $50는 role agent·judge·사람 역할 몫이고, 돈이 새는 쪽이 이 셋이다.
   - judge 비용은 trial 끝 judge 호출 뒤에 `JudgeItem.cost_usd`로 `runTrials`(`runner/trials.ts`)가 trial 뒤에 `cap.add(metrics.cost_usd + judge 비용)`으로 더한다(그대로).
3. `runner/steps.ts`: `runSteps(ctx): Promise<void>`(`ctx`는 core, 시나리오, `roots`, `SetupContext`(`ctx.setup`), 사람 역할, driver, 시계를 든 객체다). land한 `runTrial`의 step 반복(`say`면 session을 열고 보내고, 나머지는 `waitUntilIdle`)을 trial.ts에서 꺼낸 것이다. 지금 코드는 `say`가 아닌 step을 모두 `untilIdle`로 취급하므로 새 종류를 분기해야 한다. `runSteps`는 `Settle`을 돌려준다. 종류마다:
   - `say`: 그대로(`openSession` + `say`, 참가자마다 session 하나, `roots`에 쌓는다).
   - `untilIdle`: `waitUntilIdle`에 `hooks`를 넘긴다(아래 4의 `hooksOf`). timeout이면 남은 step을 건너뛴다.
   - `deliver`: `scenario.world`에서 `parseRef(text, "material").name === step.material`인 항목을 찾아(없으면 던진다) 그 `이름@n`을 `deliverCall(ctx.setup, ref)`에 준다. `!ok`이면 이유를 담아 던진다. 돌려받은 `call`로 `callRead({ call })`를 읽어 `record.receiver_session`을 `roots`에 쌓는다(`null`이면 call의 `state`와 `fail_reason`을 담아 던진다). fake lophn의 session은 `roots`에 넣지 않는다. 이유: 그 session의 fake model call이 `Metrics`와 `seenComponents`에 섞이면 안 된다(fake는 진짜 model이 본 component가 아니다). collect는 받는 쪽 session에서 시작해 call을 따라간다. `since`(t0)는 첫 step 직전이라 `deliver`가 보낸 call과 그 뒤 turn은 기록에 든다.
   - `callApi`: `appCallApi({ target: { mode: "live", app: world.apps[step.app], release: null }, api: step.api, input: step.input, caller: { kind: "person", view_session: "eval" } })`(사람 자격, `tests/e2e/reaction_test.ts`의 `crash`와 같은 모양). route 오류(`invalid_input`, `not_found`, `unavailable`)와 outcome `denied`·`unknown`은 던진다. 앱 handler가 `failed`로 답한 것은 던지지 않는다. 이유: calendar-diagnose는 일부러 bug를 터뜨린다. 결과(`outcome.status`)는 stdout에 한 줄 찍는다. 앱 이름을 못 풀면 던진다.
   - `callApi` 뒤에 ProblemOpened가 App Engineer 입력이 되기까지 짧은 틈이 있다. 다음 `untilIdle`의 `quietMs`가 이 틈을 넘도록 coding 시나리오는 `quietMs = 3_000`으로 돈다(아래 4).
4. `runner/trial.ts`의 `runTrial(deps: TrialDeps, scenario, index)`를 바꾼다. 지금 순서(`createRun` → `bootCore` → `beginRestore`·`restoreWorld`·`setup`·`endRestore` → `attachRealModels` → t0 → steps → `collectSessions` → `runProgramChecks` → judge → `seenComponents` → `writeFullRecord` → finally)에서 다음만 다르다. `TrialDeps`에 `registryDir`, `trialBudgetUsd`, `repoRoot`, `binDir`을 더하고 `cli.ts`가 만든다. `coding = scenario.real.some(isCodingAgent)`로 가른다.
   1. 부팅: `bootCore(run, { settings: evalCoreSettings(), env: await restoreCoreEnv(scenario.world) })`. coding agent의 model과 harness 기본은 부팅 설정이 아니라 `prepareCodingAgent`가 제품 설정 길(`settingsUpdate`)로 넣는다(아래 4).
   2. 되살리기와 setup, `endRestore(ctx)`는 그대로. restore가 연 가짜 터미널과 Gateway는 `endRestore`가 닫는다.
   3. `attachRealModels(core, { key, model, real })`의 `real`은 `scenario.real.filter((p) => !isCodingAgent(p))`를 `agentRefOf`로 푼 role agent만이다. coding agent에는 agent 정의가 없어 붙일 model이 없다.
   4. `coding`이면 `attachRealModels` 뒤, t0 앞에: `prepared = await prepareCodingAgent({ core, repoRoot, binDir, model, clock, install: "check" })`, `driver = startCodingDriver({ core, clock, binDir, outDir, repoRoot, timeoutMs: CODING_TRIAL_LIMIT_MS })`. `model`은 `--model` 값(기본 `claude-sonnet-5-5`). `repoRoot`는 지금 checkout, `binDir`은 `.dev-data/eval/bin`, `outDir`은 `.dev-data/eval/<runId>/trial-<index>/`(wrapper 기록 file이 여기에 쌓인다). 이유: 되살리기가 쓰는 가짜 터미널과 진짜 터미널이 섞이지 않게 되살리기가 끝난 뒤에만 붙인다. `prepareCodingAgent`가 던지면(claude를 못 찾음, hook·skill 설치 없음) 이유를 그대로 찍고 1로 멈춘다. `install`은 `"check"`뿐이다(아래 "정한 것"). 시나리오에 `human`이 있으면 `human = createHumanRole({ port: core, fetch: globalThis.fetch, apiKey: key, clock, spec: scenario.human })`.
   5. t0와 `runSteps`. `hooksOf`:
      - `act`: `human === undefined ? undefined : async () => (await human.tick()).acted > 0`
      - attach 명령은 runner가 찍지 않는다. driver가 session을 열 때 `log`로 찍는다(위 계약). 그래서 `poll` hook은 두지 않는다.
      - `over`: `createSpendGuard({ limitUsd: trialBudget, roleSpend: () => roleSpendUsd(core), humanSpend: () => human?.record().cost_usd ?? 0, clock }).over`
      - `graceMs`: coding이면 10_000, 아니면 없음. `quietMs`는 coding이면 3_000.
   6. 터미널이 남은 채 쉬는 경우(coding만). `untilIdle`이 `idle`로 끝났는데 `driver.active() > 0`이면 완료 보고 없이 CLI가 멈췄거나 보고 뒤 process가 안 끝난 것이다. `await driver.stop()`으로 끊고(core가 `CodingSessionEndedUnreported`로 App Engineer에게 알려 새 turn이 열릴 수 있다) 같은 `untilIdle`을 한 번 더 기다린다. 이 뒤 driver는 닫혔으므로 새로 맡긴 coding session은 띄워지지 않는다(그 session은 `unknown`이 되어 남은 시간 상한에 걸린다). 이유: 보고 없이 끝난 coding agent도 trial이 끝나야 하고, App Engineer의 반응이 기록에 남아야 한다.
   7. 끝나면(timeout이어도) `traces = await driver.stop()`(이미 멈췄으면 그 결과). 그다음 `finished_at`, `collectSessions(...)`. `roots`는 runner가 연 session(지금 `sessions` Map의 값)과 `deliver`가 찾은 받는 쪽 session이다. coding session은 `agentSessionRead`로 읽히지 않아 collect가 건너뛴다(`collect/read.ts`). coding 기록은 `records = await collectCoding({ home: Deno.env.get("HOME") }, traces)`. `TrialRecord.coding = records`, `TrialRecord.human = human?.record()`. `metrics`(role agent 몫)는 그대로 `sumMetrics`다. coding agent 수치는 `TrialRecord.coding`에만 둔다(섞지 않는다).
   8. `runProgramChecks`와 judge는 그대로. 단 judge check의 입력은 `await check.input({ trial, core })`다(`input`이 Promise일 수 있다). check의 `core`는 아직 살아 있다(끝난 world를 보는 check가 있다).
   9. `seenComponents(sessions)`의 결과에 coding이면 `resolveVersion(registryDir, await measureCli("claude", prepared.version)).ref`(`kind: "cli"`)를 더한다. 이유: harness를 component로 매기는 규칙(roadmap "버전")이고, 값은 `claude --version`이 이미 `prepareCodingAgent`에서 나왔다.
   10. 저장: trial이 통과했고(`settle.kind === "idle"`, 모든 check pass) `scenario.save`가 있고 이 run에서 아직 저장한 trial이 없으면 `saveMaterials({ core, world: ctx.world, refs: scenario.world, trial: trialRecord }, scenario.save, { scenario: "<id>@<n>", trial: index, run: runId })`. `!ok`이면 이유를 찍고 그 trial을 통과가 아닌 것으로 되돌리지는 않는다(점수가 아니라 후보 쓰기의 실패다). 저장은 core를 끄기 전, 그리고 check 뒤에 한다. 쓴 `이름@n`은 stdout에 `후보: calendar-app@2`로 찍는다. 이유: 사람이 보고 commit해야 뒤 단위의 전제가 된다(roadmap). 통과한 첫 trial만 쓰는 것은 `--trials 3`이 같은 산출물 후보를 셋 만들지 않게 하려는 것이다.
   11. `TrialResult`: `coding = records.map(({ tail: _, ...rest }) => rest)`(`CodingSummary`), `human`은 `HumanSummary`(`answered` = `answers`의 수, `fallback` = `error`가 있는 답의 수, `decisions` = `decisions`의 수, `cost_usd`)로 줄인다. 질문·답 글은 `.dev-data/eval`의 전체 기록에만 둔다.
   12. `writeFullRecord`로 쓰는 전체 기록에 `human`(질문과 답, 결정)과 `coding`(`tail` 포함)을 넣는다. Claude Code의 session JSONL은 복사하지 않는다(사람의 HOME 아래 파일이고 길다).
   13. `finally`: `driver?.stop()`, `core.stop()`, `run.remove()`. 각각 실패해도 다음을 한다.
5. `runner/cli.ts`(`main`, `registerAll`, 시나리오마다 요약 줄을 찍는 부분)와 `run.ts`(한 줄 진입이라 바꿀 일이 거의 없다):
   - `--trial-budget <usd>`(기본 `TRIAL_CAP_USD`). `--budget`(run 전체 상한)은 그대로다.
   - 신뢰된 폴더(folder trust 추천 길): 고른 시나리오 중 `coding`이 있으면 `main`이 시나리오를 고른 직후 한 번 `EVAL_TMP = "/tmp/lophn-eval"`(짧은 전용 폴더. unix socket 경로가 108자를 넘지 않게 짧다)를 만들고 `TMPDIR`가 비어 있으면 그 값으로 둔다. `createRun`이 `Deno.makeTempDir`을 쓰므로 trial root가 그 아래에 생긴다. 이유: 새 폴더마다 Claude Code가 folder trust를 묻는데, 조상 폴더가 신뢰돼 있으면 안 뜬다(`ec-driver.md`가 확인했다). 이 폴더를 사람이 Claude Code에서 한 번 열어 신뢰하면 된다. 폴더를 처음 만들었다면 그 한 줄 안내를 찍는다. `TMPDIR`가 이미 있으면 건드리지 않는다(사람이 정한 것이다). 프로세스 시작 때 한 번 하는 환경 설정이고 trial 코드는 `createRun`을 그대로 쓴다. (사람의 결정 대기: 사람이 다르게 정하면 이 줄만 바꾼다. `Deno.env.set`이 `makeTempDir`에 먹지 않으면 `TMPDIR=/tmp/lophn-eval deno task eval`로 안내하는 것으로 바꾸고 보고에 적는다.)
   - 시나리오를 고른 뒤 `coding`인 시나리오가 있고 `--trials`가 둘 이상이면 trial은 차례로만 돈다(병렬은 `eval-experiment`). 한 줄 안내만 찍는다.
   - 시나리오마다 요약 줄에 coding과 사람 역할 몫을 더한다: `codingTotals(records)`의 token(input, output, cache read), 터미널 수와 걸린 분, 터미널에서 permission 물음이 뜬 수(`CodingRecord.permission_requests`의 합), 사람이 개입했나(`CodingRecord.human_input`이 하나라도 참이면 `사람 개입: 있음`, 아니면 `없음`. 개입한 trial은 자동 run의 결과로 읽지 않는다는 표시다), 사람 역할이 답한 질문 수와 default로 메운 수, 결정 수, 후보로 쓴 재료.
   - 재료의 hash 확인과 `registerAuthored`는 새 재료 종류(`active_app`, `app_data`, `package`, `call`)도 같은 길이다. `world`가 가리키는 재료만 확인하므로 코드를 늘리지 않는다.
   - key가 없으면 "ANTHROPIC_API_KEY가 없어 진짜 provider를 부르지 않는다"로 끝나는 것은 그대로다. coding agent는 사람의 Claude Code 로그인을 쓰므로 key와 상관없지만, role agent·judge·사람 역할이 key를 쓰므로 key 없이 coding trial을 돌리지 않는다.
6. 시간과 id는 인자로 받는다(`Clock`, `IdSource`, `sleep`). key는 변수로만 들고 있고 찍거나 쓰지 않는다.
7. 진짜 provider와 진짜 claude 없이 손으로 확인한다: `ANTHROPIC_API_KEY`를 비운 채 `deno run --allow-all tests/eval/run.ts --all`로 fixture 확인이 돌고 0으로 끝나는지 본다. 진짜 key로 coding trial을 도는 확인은 lead가 한다(README "lead가 할 일").

## 정한 것

- **driver는 되살리기가 끝난 뒤, t0 전에 붙인다**. README는 "App Engineer가 맡길 때 driver를 붙인다"고 적었다. 그 시점에 붙이려면 call을 가로채는 길이 따로 필요하다. 붙여 두고 `open` 요청이 오면 연다가 더 단순하다. 이유: 요청이 와야만 동작하고, 되살리기의 가짜 터미널과는 시간으로 갈라진다.
- **터미널 쪽 결정 셋은 사람의 답 대기이고 추천안을 기본 길로 쓴다**(planner 추천, 사람이 확정하면 바뀔 수 있다): (1) folder trust는 신뢰된 전용 폴더(`/tmp/lophn-eval`) 아래에서 trial을 돌린다(위 5). (2) permission 물음은 사람의 Claude Code 권한 설정 그대로다. eval 전용 flag를 두지 않으며, 그래도 뜬 물음은 session을 `waiting`으로 두고 기록에 남는다. (3) hook·skill은 사람이 개발 형태로 한 번 설치하고 eval은 `install: "check"`로 있는지만 본다. 없으면 `prepareCodingAgent`가 명령을 담아 던지고 runner는 그대로 찍고 멈춘다.
- **조용함의 정의에 사람 역할을 넣는다**. 사람 역할이 있으면 `waiting`(`ask`, turn 안 허락)과 보류 approval은 조용함이 아니다. 없으면 eval-base 그대로다(L1, A1-ask는 답 없는 `ask`로 끝나는 것이 정상이다).
- **timeout 이유는 `Settle`에 안 담는다**. `Settle`을 늘리면 계약이 바뀐다. 비용 상한과 시간 상한은 둘 다 `timeout`이고 이유는 stdout에 있다.
- **비용 상한은 trial마다**, run 전체 `--budget`은 그대로다. 이유: roadmap이 시나리오 한 trial $50, 판단 case 한 번 돌릴 때 $50로 갈라 적었다.
- **통과한 첫 trial만 후보로 쓴다**. 이유는 4의 10번.
- **coding agent 수치와 role agent 수치를 섞지 않는다**. roadmap의 공통 수치 표가 칸을 따로 둔다.
- **fake lophn session은 collect의 root가 아니다**. 받는 쪽 session에서 시작한다(위 3의 `deliver`).
- **사람 역할이 쓰는 `fetch`는 `globalThis.fetch`**, key는 judge와 같은 `ANTHROPIC_API_KEY`다.


## 끝남

- `deno task check`가 통과한다. `tests/eval/runner/*_test.ts`도 check에서 돈다. 그래서 test는 순수해야 한다(core 부팅, subprocess, 네트워크, 진짜 provider 없음).
- 위험 test(2개, 기존 `tests/eval/runner/idle_test.ts`에 더한다):
  - "사람 역할이 있으면 `ask`를 기다리거나 보류 허락이 남은 동안 idle로 끝나지 않고, 사람 역할이 처리한 뒤 `graceMs`가 지나야 idle이 된다. 사람 역할이 없으면 `waiting`은 그대로 조용함이다": `idle_test.ts`의 `harness`(`manualClock`, 가짜 `read`·`sleep`)에 `act`를 가짜로 넣는다. 보류 허락(activation)은 session 상태에 안 드러나서, 이것을 놓치면 앱이 켜지기 전에 trial이 끝나 가짜 실패가 난다.
  - "turn이 되지 않은 입력은 `stuckMs`에, 그 밖의 기다림은 `timeoutMs`에 끊고, `over`가 문자열을 주면 바로 끊는다": 같은 `harness`. 90분 상한 때문에 turn 준비 예외가 90분 뒤에야 보이는 일을 막는다.
- 새 subprocess·서버·브라우저를 띄우는 test는 만들지 않는다. driver, 진짜 claude, core를 띄우는 길은 손 확인뿐이다.
- 남지 않음: `grep -rn "api.anthropic.com" tests/eval/runner tests/eval/run.ts`는 0줄이다(Anthropic 호출은 judge와 human의 몫).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`deno.json`의 `eval` task는 eval-base가 이미 등록했다)
- 안 쓰게 된 export
- 정한 것: 위 "정한 것" 밖에서 worker가 정한 것, 기대한 export와 달라 맞춘 이름(ec-contract, ec-driver, ec-metrics, ec-restore, ec-human 각각)
- 넘길 줄: 다른 task의 export가 모자라 runner에 둔 이음 코드
- 계약 바꾸기 요청: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 병렬 trial 없음. coding session이 `unknown`에서 영영 안 나오면(Claude Code의 folder trust 질문이나 첫 실행 질문이 터미널에서 막는 경우. 제품 launch plan은 그것을 넘기지 않는다) driver의 `noSessionStartMs`(기본 120초)가 터미널을 끊어 `no_session_start`로 남지만, 그 뒤 trial이 무엇을 하는지는 시나리오마다 다르다. 제품 빈틈이면 eval이 넘기지 말고 보고한다(README "돌리기 전에 확인할 것"). 활성화 허락 뒤 앱이 뜨기까지는 `graceMs`와 check 쪽 기다림에 기댄다. 사람의 Claude Code 권한 물음이 터미널에 뜨면(추천안은 eval 전용 flag를 두지 않는다) coding session이 `waiting`으로 남고 사람 역할은 터미널 입력을 하지 않는다. 그 trial은 시간 상한까지 가고 기록에만 남는다.
