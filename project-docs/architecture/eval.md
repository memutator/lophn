# eval

진짜 model로 lophn agent의 판단을 잰다. test가 "코드가 계약대로 도나"를 fake model로 본다면, eval은 "지침과 model이 맡은 일을 맞게 하나"를 본다. 시나리오 하나가 재료로 world를 되살리고, 사람 말 한 줄을 넣고, agent들이 쉴 때까지 기다린 뒤, 남은 기록을 program check와 judge로 채점한다. 결과는 run 요약으로 commit하고 scorecard로 읽는다. 설계의 정본과 아직 만들지 않은 것은 `project-docs/products/roadmap/eval.md`다. 이 문서는 지금 코드가 하는 것만 적는다.

## 흐름

```
npm run eval -- --scenario <id> | --all [--model m] [--effort e] [--trials N] [--budget usd] [--trial-budget usd] [--keep]
  tests/eval/run.ts → runner/cli.ts
    discover          scenarios/**/*.scenario.ts의 default export
    버전 확인          재료 hash(restore), 시나리오·criterion·judge hash(versions)를 registry와 댄다
    fixture 확인       checks/validate.ts: right는 모든 program check 통과, wrong은 적은 check가 떨어져야 한다
    key가 없으면       여기서 0으로 끝난다(진짜 provider를 부르지 않는다)
    시나리오는 동시에, trial은 pool로 (runner/scenario.ts, experiment/parallel, 상한 runner/cap.ts)
      runner/trial.ts
        createRun · bootCore(evalCoreSettings())      tests/support/core, provider/
        restoreWorld(world)                          restore/
        attachRealModels(real 가운데 role agent)      provider/attach.ts
        t0 ─────────────────────────────────────────────
        runSteps: say · untilIdle                    runner/steps.ts, runner/idle.ts
          쉬는 동안 비용 상한(runner/spend.ts)
        collectSessions(roots, t0) · metricsOf · sumMetrics   collect/
        runProgramChecks                             checks/run.ts
        judge item을 채점 대기 file로 (premise가 통과했을 때만)  judge/pending.ts
        queueRepeats (같은 tool·인자 3번 이상이면 진단 item)  experiment/repeat/
        seenComponents(records)                      versions/components.ts
        writeFullRecord → .dev-data/eval/<run>/trial-N.json · core.log
      foldJudge(채점된 item을 check에 접기) → RunRecord 요약 → tests/eval/runs/<RunRecord.id>.json
npm run eval:experiment -- <id> [--checkout <path>] [--base <rev>] [--budget usd]
  runner/experiment.ts
    readSpec · resolveVariant(--checkout)           experiment/spec, experiment/variant
    checkSpecAgainst · checkSpecLocked(git)         spec이 commit됐고 variant가 그 위인가
    changedComponents · checkChange                 바꾼 것이 spec의 X@a → X@b인가, 섞인 것(mixed)
    selectRuns                                      바뀐 component를 본 run만 target·guard로, 나머지는 keep
    runGate: check → 고른 e2e → dry run              experiment/gate (eval:gate <id>는 이것만)
    findOverfit · measureAssembly(녹화 replay)       경고와 진단. 판정에 들지 않는다
    nextTrials(정책)로 pool에서 trial                 experiment/trials, experiment/parallel
    recordVerdict(default@1) → tests/eval/experiments/<id>/result.json   experiment/verdict
npm run eval:judge -- <run> [show <key> | set <key> --model m]   → 채점 대기 item 보기와 답 넣기   judge/main.ts
npm run eval:scorecard              → tests/eval/scorecards/<date>.md     scorecard/main.ts
npm run eval:scorecard -- diff A B  → 두 run의 버전·결과 차이(stdout)
```

## 자리

| 자리 | 하는 일 |
|---|---|
| `tests/eval/types.ts` | 계약. 버전, 참가자(role agent)와 단계(`say`, `untilIdle`), check, 시나리오(`world`, `real`, `steps`, `checks`, `fixtures`), 수집 기록, 수치, trial·run 기록, 재료, scorecard 행의 type과 constructor |
| `tests/eval/versions/` | hash 규칙(`hash.ts`), registry 읽기·쓰기(`registry.ts`), file을 component로 가르기(`files.ts`의 `classifyPath`, `TOOL_FILES`), 지금 checkout의 버전과 본 component(`components.ts`), 작성자가 n을 정하는 것의 hash(`authored.ts`), git 출처(`source.ts`) |
| `tests/eval/registry/` | `<kind>/<name>.json`. n → hash, 글 component·criterion·judge는 내용도. commit한다 |
| `tests/eval/materials/<이름>/<n>/` | `material.json`(kind, 고정 id, needs, content_hash)과 `files/`. commit한다 |
| `tests/eval/restore/` | 재료 읽기와 hash 확인(`manifest.ts`), 종류별 되살리기(`apps.ts`, `projects.ts`, `kinds.ts`, `operators.ts`). 재료는 제품 route로만 되살리고 model을 쓰지 않는다 |
| `tests/eval/provider/` | `.env` key 읽기, core 설정(`EVAL_MODEL_ATTEMPTS`), `real` 참가자에게만 agent 층 model 붙이기 |
| `tests/eval/collect/` | 제품 읽기 route로 session·turn·model call·tool call·call 읽기, 요청 body blob 읽기(`blob.ts`), 공통 수치(`metrics.ts`), 전체 기록 쓰기 |
| `tests/eval/checks/` | program check builder(`calls.ts`, `tools.ts`), 기록 helper(`records.ts`), fixture builder(`fixtures.ts`), fixture 확인(`validate.ts`), check 실행(`run.ts`) |
| `tests/eval/judge/`, `tests/eval/criteria/` | judge 정의(`judge.json`, `prompt.md`), judge 입력 조립(`input.ts`), 채점 대기 file(`pending.ts`), 답의 enum·인용 검사(`grade.ts`), check에 접기(`fold.ts`), 채점하는 agent에게 줄 글(`show.ts`), CLI(`main.ts`). criterion은 `criteria/<name>.json`(진단 `repeat-kind` 포함) |
| `tests/eval/experiment/` | experiment 조각. spec·result 꼴과 읽기·검사·잠금(`spec/`), run 고르기(`select/`), trial 정책(`trials/`), 판정 `default@1`(`verdict/`), 다른 checkout(`variant/`), gate(`gate/`), 동시 수와 예산의 pool(`parallel/`), 시나리오 고유 단어 경고(`overfit/`), prefix 재기(`assembly/`), 되풀이 진단(`repeat/`), CLI 입구(`mod.ts`) |
| `tests/eval/experiments/<id>/` | `spec.json`(사람이 쓰고 commit), `result.json`(program의 판정), `run.md`(runner), `report.md`(experimenter). commit한다 |
| `tests/eval/runner/` | CLI(`cli.ts`, `experiment.ts`), 시나리오 찾기, 쉼 판정(`idle.ts`), 단계(`steps.ts`), trial 하나(`trial.ts`)와 그 world(`world.ts`), 시나리오 하나의 trial들(`scenario.ts`), run 비용 상한(`cap.ts`), trial 비용 상한(`spend.ts`), registry 쓰기 줄 세우기(`mutex.ts`), spec 잠금 사실(`lock.ts`), replay port(`replay.ts`) |
| `tests/eval/scenarios/<group>/` | 판단 case 11개. `lophn/`(5), `project-manager/`(2), `app-engineer/`(2), `operator/`(2). 사람은 개발자가 아니라서 tool 이름과 입출력을 말하지 않는다. 같은 폴더의 `common.ts`는 시나리오가 아니다. 참가자는 role 넷 모두다 |
| `tests/eval/scorecard/` | run 요약 읽기, 시나리오마다 run 고르기와 낡음(`pick.ts`), markdown(`markdown.ts`), run diff(`diff.ts`) |
| `tests/eval/runs/`, `tests/eval/scorecards/` | run 요약과 날짜가 붙은 scorecard. commit한다 |
| `.dev-data/eval/<run>/` | trial마다 전체 기록(대답 글, 요청 body, diff), core.log, 되풀이 진단(`trial-N.repeat.json`), 채점 대기(`judge/<key>.json`). git 밖 |

## 지키는 것

- **진짜 model은 `real` 참가자만 받는다.** 되살리기는 제품 route만 부르므로 model이 필요 없고, core의 전역 기본 model은 처음부터 `null`이다. `attachRealModels`는 기본이 비어 있지 않으면 던지고, `real`에는 agent 층 model만 붙인다. 나머지의 turn은 `failed / configuration_unavailable`로 곧바로 끝나고 provider를 부르지 않는다. 그래서 call을 받아도 그쪽 비용은 0이다. 이 끝남은 정상이고, 쉼 판정과 수치에서 오류로 다루지 않는다.
- **key는 변수로만 든다.** `readAnthropicKey`가 env에서 읽고 `secrets/put`으로 core에 넣는다. 로그, 오류 message, run 기록에 넣지 않는다. core process는 env를 비운 채 뜬다(`tests/support/core`).
- **되살리기의 흔적은 기록에 섞이지 않는다.** runner가 첫 단계 직전 시각을 t0(`TrialRecord.started_at`)으로 남긴다. collect는 runner가 연 session에서 시작해 call의 받는 session을 따라가고, t0 전에 시작한 turn과 그 model·tool call을 버린다.
- **요청 body는 eval의 data root에서만 읽는다.** body를 내놓는 product route가 없다(`blobs/read`가 `model_call/input`을 막는다). `collect/blob.ts`가 `<run.home>/blobs/sha256/..`을 `objectPathFor`로 찾아 읽고, hash가 다르면 `null`이다. 제품에 route를 더하지 않는다.
- **token은 cache를 두 번 빼지 않는다.** 저장된 `usage.input`은 어느 adapter든 cache를 뺀 값이다. `input_total = input + cache_read + cache_write`, cache hit rate = `Σcache_read / Σinput_total`. `cache_in_input`으로 계산하지 않는다.
- **tool 정확도의 분모.** 재시도에 밀린 행은 뺀다. `not_executed` 가운데 `denied`·`rejected`(막힘)는 분모에 들고, 그 밖(멈춤, 대체, 한도, 취소)은 `excluded`로 뺀다.
- **버전은 hash로 고정한다.** 재료, 시나리오, criterion, judge의 n은 쓴 사람이 정하고, registry는 같은 n의 내용이 바뀌면 거절하고("n을 올려라") 지금 가장 큰 n 이하의 새 n도 거절한다. 빈 n을 건너뛴 새 n은 받는다(file의 n이 registry보다 앞서는 일이 흔하다). component·core·`checks`의 n은 registry가 hash마다 붙인다. 같은 내용은 같은 n이고 옛 내용으로 돌아가면 옛 n이다. `tool:X`는 X를 정의하는 source file(`TOOL_FILES`) 전체로 재므로, 한 file의 tool은 같이 오른다. 재료·registry·runs data는 `biome.json`의 `files.includes`에서 뺀다. 쓰는 쪽이 `JSON.stringify(v, null, 2) + "\n"`로 쓰고 쓴 byte로 hash를 재기 때문이다.
- **run은 진짜 model이 본 것만 남긴다.** `components`는 요청 body에 실린 instruction·tool·skill 설명과, turn 중에 `skill.read`로 연 것이다. scorecard는 run이 본 component·재료·시나리오·grader의 n을 지금 checkout과 대어 낡음을 적는다. run이 보지 않은 component가 바뀐 것은 낡음이 아니다.
- **채점 순서.** program check가 먼저다. judge check는 `premise`의 program check가 모두 통과하고 trial이 `idle`로 끝났을 때만 item이 된다. item은 채점 대기 file로 남고(`CheckResult.pending`, scorecard의 "채점 대기"), eval을 돌리는 agent가 `eval:judge`로 verdict와 인용을 넣으면 `foldJudge`가 check에 접는다. verdict는 criterion의 enum이고, 인용이 judge 입력 안에 글자 그대로 있어야 한다. 그 밖의 답은 `error`로 남고 `error`만 다시 채점할 수 있다. 정상으로 채점된 item은 덮지 않는다. 늘 `cannot_tell`을 허용하고, 점수 없이 verdict만 남긴다. 채점한 model은 item마다 `JudgeItem.model`에 남는다.
- **비용 상한.** runner는 끝난 trial의 `cost_usd`(role agent model call의 USD cost)를 더해 `--budget`(`eval` 기본 $50, experiment는 spec의 `budget_usd`, `--budget`으로 덮는다) 이상이면 새 trial을 띄우지 않는다. judge는 eval을 돌리는 agent가 하므로 이 합에 없다. 값을 모르는 call(`unpriced_calls`)이 있으면 한 번 경고한다. 판단 case는 core 설정 `lophn-agent.run.model_attempts`를 15로 낮춰 돈다.
- **`tests/eval`의 `*_test.ts`는 `npm run check`에서 돈다.** 그래서 모두 순수하다. core를 띄우지 않고, process·network·진짜 provider를 쓰지 않는다. runner와 시나리오 file은 test file이 아니다.
- **trial 상한.** role agent의 비용이 trial마다 `--trial-budget`(기본 $50)을 넘으면 그 trial을 timeout으로 끝낸다. 쉬기는 단계마다 기본 300초까지 기다리고, turn이 되지 않은 입력도 300초가 지나면 timeout이다.
- **check는 순서대로.** `runProgramChecks`는 배열 순서대로 하나씩 돈다. check는 trial 기록만 읽고 core나 world를 바꾸지 않는다.
- **요약과 전체 기록.** 요약(`tests/eval/runs/<RunRecord.id>.json`)은 버전, check verdict, judge item(입력, verdict, 인용), 공통 수치다. 대답 글, 요청 body, working tree diff는 `.dev-data/eval/<RunRecord.id>/`에만 둔다. `.dev-data`는 schema가 바뀌면 지우므로, 기준 run을 다시 쓰려면 요약이 그보다 오래 남아야 한다.
  - `--keep`이면 trial이 끝나도 world(임시 data root)를 지우지 않고 core만 끈다. `LOPHN_DEV_HOME=<그 home> npm run dev`가 그 root를 데스크톱 앱으로 연다(fake provider를 심지 않는다). 다 본 뒤 그 폴더는 사람이 지운다.
- **experiment는 commit된 spec으로만 돈다.** `checkSpecLocked`가 spec이 commit됐고 variant checkout이 그 commit 위인지 git으로 본다. 판정이 난 `result.json`은 덮지 않고(`판정이 이미 났다`), `inconclusive`는 같은 명령으로 이어 돈다. 이유: 결과를 본 뒤 규칙이나 target을 고르지 못하게.
- **판정은 program이 한다.** `default@1`: target과 미리 쓴 case가 모두 통과하고 guard가 기준보다 나빠지지 않으면 adopt다. 채점 대기가 남으면 `inconclusive`다.
- **trial 정책.** spec의 `trials`(`1 <= base <= max <= 5`)를 따른다. 처음에는 base번. target이 통과하거나 guard verdict가 기준과 다르면 그 시나리오만 max까지 늘린다. 같은 버전에서 trial끼리 갈린 적이 있는 시나리오는 처음부터 max다. 동시 수는 판단 case 4이고 예산 하나를 같이 쓴다.
- **variant의 core는 그 checkout에서, grader는 지금 checkout에서.** `--checkout`이면 core·instruction·tool 버전은 variant 것이고 check·judge·시나리오는 지금 checkout 것이다.
- **variant는 자기 앱 E2E 의존을 받는다.** variant의 `.dev-data/e2e/npm-cache`가 비었으면 variant에서 `npm run e2e:deps`를 돈다. 지금 checkout 것을 symlink로 이으면 release 준비의 esbuild가 떨어졌다.
- **gate는 싼 것부터.** variant checkout에서 `npm run check`, 바뀐 file의 module에 걸린 e2e(`module-catalog.yaml`), 고른 시나리오의 dry run(되살리기만, 진짜 model 없음) 순이다. 앞이 떨어지면 뒤는 돌지 않는다.
- **경고와 진단은 판정에 들지 않는다.** 바꾼 글의 더해진 줄에 시나리오의 앱·project 이름이나 사람 말 구절이 있으면 `overfit` 경고, 녹화한 model 답을 fake provider로 되돌려 다시 조립한 layer별 prefix 유지율이 `assembly`, 같은 tool·인자 3번 이상 호출의 `repeat-kind@1` 채점이 `repeats`로 `result.json`에 남는다.

## 왜 이 모양인가

- **제품 route로 되살린다.** data root를 복사하면 schema가 바뀔 때마다 재료가 깨진다. trial마다 새 root에서 제품 route로 되살리면 재료는 schema와 상관없는 작은 JSON과 file로 남는다.
- **판단 case는 기록만으로 채점한다.** case가 묻는 것은 "누구에게 무엇을 맡겼나, 무엇을 물었나"다. 그래서 call과 tool call 기록으로 끝나고, check는 world를 묻지 않는다.
- **judge는 eval을 돌리는 agent가 subagent로 한다.** judge를 core의 agent로 돌리면 judge의 비용과 지침이 잴 대상에 섞인다. program이 key로 따로 부르면 key와 비용이 eval에 하나 더 붙는다. item마다 새 subagent(한 type으로 고정, 지금 `haiku-xhigh`)에게 `show`의 글만 주면 돌리는 쪽의 가설이 섞이지 않고, judge 버전은 `judge.json`과 `prompt.md` 두 file로 끝난다. 잃는 것: program만으로는 run이 끝나지 않는다. 절차는 `.claude/skills/eval-run/SKILL.md`.
- **case마다 right/wrong fixture를 둔다.** provider를 부르기 전에 check가 맞는 기록을 통과시키고 틀린 기록을 떨어뜨리는지 본다. check가 틀리면 돈을 쓰기 전에 드러난다.

## 아직 아닌 것

- coding agent를 재는 길이 없다. 제품에 coding session 층이 없어 driver와 수치를 지웠다. 연결을 살리기로 하면 그때 새로 쓴다.
- 앱을 짓고, 진단하고, 산출물을 다음 재료로 넘기는 단위는 Node 앱 모양으로 다시 지을 때 harness도 함께 만든다(사람 역할, 끝난 world를 보는 live check, 시나리오 `setup`·`limits`·`callApi`·`save`). 지금은 판단 case만 돈다. 설계는 `project-docs/products/roadmap/eval.md`에 남아 있다.
- 진짜 cache hit은 assembly 재기 뒤 작은 진짜 run으로 따로 봐야 한다. program이 하지 않는다.
- `npm run eval`(experiment 밖)은 지금 checkout만 돈다. 고친 채 돌리면 working tree diff가 전체 기록에 남고 요약에는 `source.dirty`만 남는다.
