# tr-eval-prune-coding

eval에서 coding agent 갈래(driver, metrics, type, runner 분기, `eval:attach`)와 막힌 call·call 재료 길(restore `setup`·`call`·`deliver`, material 종류와 save 종류 `call`, 시나리오 `T19-lophn`·`T19-op`)을 지운다. coding 참가자에 묶였던 idle·stuck 한도를 시나리오마다 정하는 칸으로 옮긴다.

- 단위: eval (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/eval/coding` (폴더째 지운다)
  - `tests/eval/types.ts`
  - `tests/eval/runner/{trial,steps,deps,world,cli,experiment,replay,roots,roots_test,spend,paths,mod}.ts`
  - `tests/eval/restore/{setup,call,deliver}.ts` (지운다)
  - `tests/eval/restore/{mod,save,save_test,manifest,manifest_test,materials_test}.ts`
  - `tests/eval/experiment/parallel/{kind,pool,pool_test}.ts`
  - `tests/eval/experiment/overfit/{terms,overfit_test}.ts`
  - `tests/eval/experiment/assembly/replay.ts`
  - `tests/eval/experiment/variant/prepare.ts`
  - `tests/eval/scenarios/lophn/T19-lophn.scenario.ts` (지운다)
  - `tests/eval/scenarios/operator/T19-op.scenario.ts` (지운다)
  - `tests/eval/materials/calendar-call` (지운다)
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것"(지우는 eval, eval runner의 idle·stuck 한도), `project-docs/plan/test-restore/survey-eval.md`의 0(1, 4), 1의 `run.ts, runner/cli.ts`·`runner/trial.ts …`·`types.ts`·`coding/driver/*`·`coding/metrics/*`·`restore/setup.ts`·`restore/call.ts …`·`experiment/*` 줄, 7의 5
  - architecture: `project-docs/architecture/eval.md`(흐름, 자리 표, "trial 상한", coding agent 세 줄. 이 task 뒤 낡는다. 고치는 것은 lead다), `project-docs/architecture/activation.md` 38(동의 뒤 program이 App Engineer를 다시 부르지 않는다)
  - 근거: `packages/core/router/router.ts` 119·128·148(`coding_agent`로 가는 call을 `invalid_input`으로 거절한다. coding session을 띄우는 길이 없다), `project-docs/architecture/approval.md` 73(agent call은 묻지도 막지도 않는다. T19의 막힌 call을 만들 수 없다)
  - module: `project-docs/module-catalog.yaml`의 `tests`(boundary 없음)
  - 코드(main `85f19080e`의 줄):
    - `tests/eval/types.ts` 11(머리 주석), 18(`HarnessId`), 51(`"guide"`), 76-87(`CodingParticipant`, `isCodingAgent`), 92-94(`deliver` step), 157-159(`SaveSource`), 167(`Scenario.real`), 254-314(coding 기록 type), 360(`TrialRecord.coding`), 397(`TrialResult.coding`), 436(`call` 재료), 475-482·491(`codingAgent`, `deliver`, `sentCall`)
    - `tests/eval/runner/steps.ts` 21-26(`CODING_*`), 32-35, 45-64(`wait`), 77-94(`deliver` 갈래), 116-123(`driver.cut`)
    - `tests/eval/runner/idle.ts` 34-59(`IdleOptions`, 기본 `timeoutMs`·`stuckMs` 300_000. 고치지 않는다)
    - `tests/eval/runner/trial.ts` 4-9, 29, 48, 63-66, 94-138, 158, 173, 189-192, 200, 265-275, 337-341, 348
    - `tests/eval/runner/{cli,deps,world,paths,experiment,replay,roots,spend}.ts`(아래 할 일의 줄)
    - `tests/eval/runner/mod.ts` 5(`CODING_TRIAL_LIMIT_MS` re-export)
    - `tests/eval/restore/mod.ts` 15·59-61·84, `tests/eval/restore/save.ts` 3·9·97-130·176-179, `tests/eval/restore/manifest.ts` 25
    - `tests/eval/experiment/parallel/{kind,pool,pool_test}.ts`, `tests/eval/runner/scenario.ts` 51(`trialKindOf(scenario)`. 고치지 않는다)
- 계약:
  - 쓰는 것: tr-support-app이 옮긴 `tests/support/app/deps.ts`(`experiment/variant/prepare.ts`의 주석과 글이 가리키는 path)
  - 내놓는 것(다른 eval task가 기댄다):
    - `types.ts`에서 `CodingParticipant`, `isCodingAgent`, `codingAgent`, `CodingTrace`, `CodingRecord`, `TrialRecord.coding`, `HarnessId` import가 빠진다. `Scenario.real`은 `Participant[]`다. `Step`에 `deliver`가 없다. `SaveSource`는 `{ kind: "active_app"; app }` 하나이고 `sentCall`이 없다. material 종류에 `call`이 없다. `VersionKind`에 `"guide"`가 없다(나머지 guide 정리는 tr-eval-versions). `HumanSpec`·`ApproveRule`·`HumanRecord`는 건드리지 않는다(tr-eval-human).
    - `Scenario.limits?: { idle_ms?: number; stuck_ms?: number }`. `idle_ms`는 trial t0부터 잰 idle 기다림 상한, `stuck_ms`는 turn이 되지 않은 입력의 한도다. 없으면 지금 기본(각 300 s)이다. App Engineer가 앱을 짓는 시나리오(15~60분)가 이 칸을 쓴다. `experiment/parallel/kind.ts`는 `limits`가 있는 시나리오를 무거운 kind로 센다.
      - 읽는 곳은 둘이다. `runner/steps.ts`의 `runSteps`가 `untilIdle` 단계마다 `waitUntilIdle`에 `timeoutMs = max(0, idle_ms - (지금 - t0))`(`idle_ms`가 있을 때만)와 `stuckMs = stuck_ms`(있을 때만)를 준다. `experiment/parallel/kind.ts`의 `trialKindOf`가 `limits !== undefined`면 `"long"`을 낸다(아래 정한 것).
    - `restore/mod.ts`가 `deliverCall`을 내보내지 않고 `call` 재료를 되살리지 않는다.
    - `runner/idle.ts`는 고치지 않는다(tr-eval-human). `runner/steps.ts`는 `readSnapshot(core, { approvals: human !== undefined })`와 `waitUntilIdle(read, deps, { timeoutMs?, stuckMs?, hooks: { act, over } })` 꼴로 부른다.
    - 등록할 것(lead): `deno.json`의 `eval:attach` task를 지운다.

## 할 일

brief는 main `85f19080e` 기준이다. 같은 wave의 tr-eval-prune-checks(`tests/eval/checks/**`, `scenarios/calendar/**`, `scenarios/lophn/L7.scenario.ts`), tr-eval-versions(`tests/eval/versions/**`, `experiment/{spec,gate}`, `experiment/variant/{texts,variant_test}.ts`, `tests/eval/registry/{tool,guide}`), tr-support-app(`tests/support/**`)의 file은 고치지 않는다. 그쪽이 먼저 merge되든 나중에 되든 맞물리게 나눴다(끝남의 type check).

1. 지운다(README "지우는 eval"):
   - `git rm -r tests/eval/coding tests/eval/materials/calendar-call tests/eval/restore/setup.ts tests/eval/restore/call.ts tests/eval/restore/deliver.ts tests/eval/scenarios/lophn/T19-lophn.scenario.ts tests/eval/scenarios/operator/T19-op.scenario.ts`
   - registry의 옛 줄(`tests/eval/registry/material/calendar-call.json`, `registry/scenario/T19-*.json`, `registry/cli/claude.json`)은 history다. 소유 밖이라 그대로 둔다.
   - 사람이 commit하지 않은 `tests/eval/materials/calendar-app-dev/`, `calendar-app-user/`와 저장소 root의 `ISSUE-*.md`는 건드리지 않는다(worktree에는 없다).
2. `tests/eval/types.ts`
   - 머리 주석 11의 `Metrics`/`TrialRecord.coding` 줄, import `HarnessId`(18)를 지운다.
   - `CodingParticipant`·`isCodingAgent`(76-87)를 지우고 `Scenario.real`(167)을 `Participant[]`로 둔다.
   - `Step`의 `deliver`(92-94)와 constructor `codingAgent`·`deliver`·`sentCall`(475-482, 491)을 지운다.
   - `SaveSource`(157-159)를 `{ kind: "active_app"; app: string }` 하나로 둔다. `MaterialKind`(436)에서 `"call"`을 지운다.
   - "coding agent와 사람 역할의 기록"(254-314)에서 `CodingEnd`, `CodingTrace`, `CodingCommand`, `CodingUsage`, `CodingRecord`, `CodingSummary`를 지우고 절 제목을 "사람 역할의 기록"으로 둔다. `TrialRecord.coding`(360)과 `TrialResult.coding`(397)을 지운다.
   - `VersionKind`(51)에서 `"guide"`를 지운다. `"cli"`는 남긴다(registry history, `versions/components.ts`의 `measureCli`가 쓴다).
   - `Scenario`에 `limits?: { idle_ms?: number; stuck_ms?: number }`를 더한다. 주석에 "왜"를 한 줄: 앱을 짓는 시나리오는 기본 300 s보다 오래 돈다.
   - `IntentKind`·`RequestChoice` import(14-15), `ApproveRule`, `HumanSpec`, `HumanRecord`는 고치지 않는다(tr-eval-human). 지금 protocol에 없어 type 오류가 남는다.
3. `tests/eval/runner/steps.ts`
   - `CODING_TRIAL_LIMIT_MS`, `CODING_QUIET_MS`, `CODING_GRACE_MS`(21-26), import `CodingDriver`(9)·`deliverCall`(11)·`callRead`(6)·`isCodingAgent`·`parseRef`를 지운다.
   - `StepsContext`에서 `fake`, `driver`를 지운다(33, 35). `roots` 주석은 "say가 연 session"으로 둔다.
   - `wait`(45-64)를 `scenario.limits`로 바꾼다: `idle_ms`가 있으면 `timeoutMs: Math.max(0, idle_ms - (clock.nowMs() - ctx.startedMs))`, `stuck_ms`가 있으면 `stuckMs: stuck_ms`, `hooks`는 `act`, `over`만. 없는 칸은 넘기지 않아 `waitUntilIdle` 기본(300 s)이 된다.
   - `deliver` 갈래(77-94)와 `driver.cut` 재시도(116-123)를 지운다.
4. `tests/eval/runner/trial.ts`
   - coding import(4-9), `measureCli`·`resolveVersion` import(29의 둘. `seenComponents`는 남는다), `CODING_TRIAL_LIMIT_MS` import(48), `CodingSummary`·`CodingTrace`·`isCodingAgent`·`Participant` import를 지운다.
   - `TrialDeps`에서 `hookRoot`, `binDir`, `home`(64-66)을 지우고 `variant` 주석에서 `lophn` wrapper를 뺀다.
   - `runTrial`: `coding`, `driver`, `cliVersion`과 그 block(94-138), `driver?.stop()`(173, 348), `codingRecords`(189-192, 200, 337-341), `cli` component push(265-275)를 지운다. `live`는 `{ stop: () => held.core?.stop() ?? Promise.resolve() }`꼴. `attachRealModels`의 `real`은 `scenario.real.map((p) => agentRefOf(ctx.world, p))`.
   - `fake` Set(158, 164, 182)을 지운다(아래 7).
5. `tests/eval/runner/deps.ts`: `ensureWrapper`·`mainCheckout`·`binDirOf` import(2, 6, 8), 인자 `coding`(21), wrapper 쓰기(27-34), 칸 `hookRoot`·`binDir`·`home`(47-49)과 12-13 주석을 지운다. 기다릴 것이 없어지면 동기 함수로 두고 부르는 곳(`cli.ts`, `experiment.ts`)의 `await`를 뗀다(lint `require-await`).
6. `tests/eval/runner/world.ts`: `binDirOf`(64-72)와 `sha256Hex` import를 지운다. 49 주석의 "ticket 대본"을 "setup"으로 둔다.
7. `tests/eval/runner/roots.ts`: `extraRoots(snapshots, roots)`로 둔다. `fake` 인자와 `coding_agent` 거르기를 지우고 주석을 맞춘다. `tests/eval/runner/roots_test.ts`는 지운다(정한 것).
8. `tests/eval/runner/paths.ts`: `EVAL_TMP`, `mainCheckout`, `useEvalTmp`와 `dirname` import를 지운다(1, 14-37). `REPO_ROOT`, `REGISTRY_DIR`, `RUNS_DIR`, `EVAL_DIR`는 남긴다(`versions/versions_test.ts`가 `REPO_ROOT`를 쓴다).
9. `tests/eval/runner/cli.ts`: import `codingTotals`(8)·`isCodingAgent`(16)·`useEvalTmp`(21), `coding`/`useEvalTmp`(135-136), `trialDepsOf`의 `coding`(168)을 지운다. `codingLines`(35-79)는 coding 줄을 빼고 사람 역할·후보 줄만 내는 이름(예 `extraLines`)으로 둔다(210).
10. `tests/eval/runner/experiment.ts`: import `isCodingAgent`(56)·`useEvalTmp`(80), `codingIn`(262-263)과 그 두 쓰임(271, 330-331), `trialDepsOf`의 `coding`(461)을 지운다. `touched`(275-276)와 그 쓰임(351, 482-493의 `사람 개입` log, `logged` 471)을 지운다(정한 것). 쓰이지 않게 된 `TrialResult` import도 지운다.
11. `tests/eval/runner/replay.ts`: `isCodingAgent`·`Participant` import(5), 39의 filter를 `scenario.real.map(...)`으로, `fake: new Set()`(48)을 지운다.
12. `tests/eval/runner/spend.ts`: 16의 `coding_agent` 건너뛰기와 6 주석의 coding 말을 지운다.
13. `tests/eval/runner/mod.ts`의 5에서 `CODING_TRIAL_LIMIT_MS`만 지운다. `runSteps` re-export는 남긴다.
14. restore
    - `tests/eval/restore/mod.ts`: `restoreCall` import(15), `case "call"`(59-61), `deliverCall` export(84)를 지운다.
    - `tests/eval/restore/save.ts`: `saveCall`(97-130), import `appList`(3)·`SentCall`(9)을 지우고 `saveMaterials`(176-179)는 `saveActiveApp(deps, spec.app)`만 부른다.
    - `tests/eval/restore/manifest.ts`: `ID_PREFIX`의 `call`(25)을 지운다.
    - `save_test.ts`, `manifest_test.ts`, `materials_test.ts`는 고칠 곳이 없으면 그대로 둔다. 돌려서 통과를 본다.
15. experiment
    - `tests/eval/experiment/parallel/kind.ts`: `TrialKind = "judgment" | "long"`, `DEFAULT_LIMITS = { judgment: 4, long: 2 }`, `trialKindOf(scenario: Pick<Scenario, "limits">)`가 `limits !== undefined`면 `"long"`. 주석은 "앱을 짓는 trial은 core·앱 build·앱 process를 오래 쥐어 적게 동시에 돈다". `runner/scenario.ts` 51은 `Scenario`를 그대로 넘기므로 고치지 않는다.
    - `pool.ts` 47-48의 `coding`을 `long`으로, `pool_test.ts` 16·40·52·98의 `"coding"`을 `"long"`으로 바꾼다.
    - `tests/eval/experiment/overfit/terms.ts`: `CodingParticipant`·`isCodingAgent` import(2-3)를 지우고 `addParticipant(p: Participant)`가 `p.name`을 그대로 넣는다(28-32). `overfit_test.ts`의 coding 참가자 줄(14)과 3 주석의 "name 없는 coding agent 참가자" 구절을 지운다.
    - `tests/eval/experiment/assembly/replay.ts`: `isCodingAgent` import(2)를 지우고 51-55는 `scenario.human !== undefined`만 보며 reason은 `"scenario has a human role; not replayed"`.
    - `tests/eval/experiment/variant/prepare.ts` 36 주석의 `tests/support/coding/deps.ts`를 `tests/support/app/deps.ts`로 둔다.

정한 것:
- **무거운 kind의 이름은 `"long"`이고 동시 수는 2 그대로다.** 이유: 이제 무거운 것은 PTY가 아니라 15~60분 동안 core와 앱 build·process를 쥐는 trial이다. 판단은 `limits`가 있느냐 하나로 한다(계약).
- **`CODING_QUIET_MS`(3 s)와 `CODING_GRACE_MS`(10 s)는 옮기지 않고 지운다.** quiet는 `ProblemOpened`가 Project Manager 입력이 되는 틈이었는데 problem이 없다. grace는 동의 뒤 앱이 뜨는 사이였는데 그 뒤 program이 App Engineer를 다시 부르지 않고(`activation.md` 38) `appActive` check가 60 s를 기다린다(`tests/eval/checks/app/active.ts` 30).
- **`idle_ms`는 `untilIdle`마다 남은 시간으로 준다.** 옛 `CODING_TRIAL_LIMIT_MS`와 같은 계산이다. `idle_ms`가 없으면 `timeoutMs`를 넘기지 않아 단계마다 300 s다(지금 판단 case와 같다).
- **`runner/roots_test.ts`는 지운다.** fake lophn session과 coding session 거르기가 없어지면 `extraRoots`는 이미 아는 root만 빼는 filter다(`write-test`: 사소한 함수는 test하지 않는다).
- **`experiment.ts`의 `touched`(사람 개입 trial 빼기)를 지운다.** `human_input`은 사람이 coding 터미널에 키를 넣은 기록이었다. 다른 사람 개입 기록은 없다.
- **`deliver`가 쓰던 fake lophn session 거르기(`fake`)를 지운다.** t0 뒤에 fake model을 부르는 단계가 `deliver` 하나였다. 되살리기와 setup의 fake turn은 t0 앞이라 collect가 버린다(`architecture/eval.md` "되살리기의 흔적은 기록에 섞이지 않는다").

## 끝남

- `deno task check`가 통과한다. `tests/eval`은 아직 `NOT_CHECKED`라 fmt·lint만 이 file들을 본다(type check와 test는 아래로 본다).
- type check: 아래 명령이 찍는 오류 자리가 모두 이 task 소유 밖이거나 `tests/eval/types.ts`의 `IntentKind`·`RequestChoice` import(14-15)다.
  ```sh
  deno check $(git ls-files 'tests/eval/*.ts' | grep -v '^tests/eval/materials/') 2>&1 \
    | sed 's/\x1b\[[0-9;]*m//g' | grep -oE "at (file://)?[^ ]+:[0-9]+:[0-9]+" \
    | sed "s#at ##; s#file://$PWD/##" | sed -E 's/:[0-9]+$//' | sort -u
  ```
  남아도 되는 곳(다른 task가 고친다): `tests/eval/human/{approve,role}.ts`·`tests/eval/runner/idle.ts`(tr-eval-human), `tests/eval/restore/{active-app,package,env}.ts`·`tests/support/app/activate.ts`(tr-support-app, tr-eval-restore), `tests/eval/versions/*`·`tests/eval/experiment/spec/types.ts`·`experiment/gate/e2e.ts`·`experiment/variant/texts.ts`(tr-eval-versions. `guides.ts`와 `"guide"`), `tests/eval/checks/**`·`tests/eval/scenarios/**`(tr-eval-prune-checks가 merge되기 전). 이 task 소유 file(위 "소유", `types.ts`의 14-15 빼고)에는 0줄이다.
- test: `deno test --no-check --allow-all tests/eval/experiment/parallel tests/eval/experiment/assembly tests/eval/restore/save_test.ts tests/eval/restore/manifest_test.ts tests/eval/restore/materials_test.ts tests/eval/runner/change_test.ts tests/eval/runner/mutex_test.ts`가 통과한다. `overfit_test.ts`는 `versions/components.ts`가 지운 `guides.ts`를 import해 tr-eval-versions merge 전에는 뜨지 않는다. 그 뒤 lead가 돌린다.
- 위험 test: 없음. 지우기와 한도 칸 하나다. 남은 test(`pool_test`, `materials_test`)가 kind 이름과 재료 고리를 본다.
- 남지 않음:
  - `grep -rnE "CodingParticipant|isCodingAgent|codingAgent|CodingTrace|CodingRecord|CodingSummary|CODING_|coding/driver|coding/metrics|deliverCall|restoreCall|sentCall\b|useEvalTmp|mainCheckout|binDirOf|human_input" tests/eval/types.ts tests/eval/runner tests/eval/restore tests/eval/experiment/parallel tests/eval/experiment/overfit tests/eval/experiment/assembly tests/eval/experiment/variant/prepare.ts`가 0줄이다.
  - `grep -n '"guide"\|"call"' tests/eval/types.ts tests/eval/restore/manifest.ts`가 0줄이다.
  - `grep -rn "calendar-call" tests/eval --include=*.ts`는 `scenarios/calendar/calendar-{user,dev}.scenario.ts`의 world 줄뿐이다(tr-eval-calendar-build가 `calendar-blank@1`로 바꾼다).
  - `ls tests/eval/coding tests/eval/materials/calendar-call`이 없다고 답한다. `git status --short tests/eval/registry`가 빈다.
- 진짜 model과 eval은 돌리지 않는다(`deno task eval`, `eval:gate`, `eval:experiment`. 진짜 provider를 부르거나 registry에 쓴다).

## 보고

- 바꾼 file
- 통과한 check(`deno task check`, 위 type check 명령의 출력 전부, test 명령의 결과)
- 등록할 것(lead): `deno.json`의 `eval:attach` task를 지운다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): `tests/eval/versions/components.ts`의 `measureCli`(tr-eval-versions 소유. 그 task도 지우지 않는다. merge 순서와 상관없이 compile되게 둔다), 그 밖에 생기면 적는다.
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것"을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 문서(lead가 끝에 고친다. README "lead가 할 일"): `project-docs/architecture/eval.md`의 흐름 그림(coding·`deliver`·`eval:attach` 줄), 자리 표(`types.ts`, `restore/`, `coding/driver/`, `coding/metrics/` 줄), 지키는 것("coding agent는 사람 환경의…", "터미널 앞의 사람 몫", "coding agent 수치는…", "trial 상한"의 coding 문장, "trial 정책"의 coding trial 동시 수, "variant의 core는…"의 coding 문장, "사람이 키를 넣은 trial"), 왜(coding agent 줄), 아직 아닌 것(coding agent 줄). `.claude/skills/eval-run/SKILL.md`의 "coding agent 시나리오가 든 run", 멈춤 30분, `사람 개입`, `eval:attach`. 고칠 줄을 file:줄로 적는다.
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 적어도 아래는 적는다. 없으면 "없음"
  - calendar-user·calendar-dev의 world가 지운 `calendar-call@3`을 가리킨다(tr-eval-calendar-build가 고친다).
  - 사람의 main checkout에서 commit하지 않은 `calendar-app-dev@1`·`calendar-app-user@1`의 `parent`가 지운 `calendar-call@3`이라 그 checkout에서는 `materials_test.ts`가 떨어진다(restore는 `needs`만 따라가 되살리기는 된다). 사람 재료는 고치지 않는다.
