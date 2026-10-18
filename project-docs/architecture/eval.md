# eval

진짜 model로 lophn agent의 판단을 잰다. test가 "코드가 계약대로 도나"를 fake model로 본다면, eval은 "지침과 model이 맡은 일을 맞게 하나"를 본다. 시나리오 하나가 재료로 world를 되살리고, 사람 말 한 줄을 넣고, agent들이 쉴 때까지 기다린 뒤, 남은 기록을 program check와 judge로 채점한다. 결과는 run 요약으로 commit하고 scorecard로 읽는다. 설계의 정본과 아직 만들지 않은 것은 `project-docs/products/roadmap/eval.md`다. 이 문서는 지금 코드가 하는 것만 적는다.

## 흐름

```
deno task eval --scenario <id> | --all [--model m] [--trials N] [--budget usd] [--trial-budget usd]
  tests/eval/run.ts → runner/cli.ts
    discover          scenarios/**/*.scenario.ts의 default export
    버전 확인          재료 hash(restore), 시나리오·criterion·judge hash(versions)를 registry와 댄다
    fixture 확인       checks/validate.ts: right는 모든 program check 통과, wrong은 적은 check가 떨어져야 한다
    key가 없으면       여기서 0으로 끝난다(진짜 provider를 부르지 않는다)
    coding 시나리오면   TMPDIR이 비어 있을 때 /tmp/lophn-eval로 둔다(짧은 socket 경로)
    시나리오는 동시에, trial은 pool로 (runner/scenario.ts, experiment/parallel, 상한 runner/cap.ts)
      runner/trial.ts
        createRun · bootCore(evalCoreSettings(), restoreCoreEnv(world))   tests/support/core, provider/, restore/env.ts
        beginRestore → restoreWorld(world) → setup → endRestore   restore/
        attachRealModels(real 가운데 role agent)            provider/attach.ts
        coding이면 prepareCodingAgent · startCodingDriver   coding/driver/
        human이 있으면 createHumanRole(card, approve)        human/ (질문은 답 대기 file)
        t0 ─────────────────────────────────────────────
        runSteps: say · deliver · callApi · untilIdle      runner/steps.ts, runner/idle.ts
          쉬는 동안 human.tick(ask 답, 허락 결정), 비용 상한(runner/spend.ts)
        driver.stop() · collectCoding(traces)              coding/metrics/
        collectSessions(roots, t0) · metricsOf · sumMetrics   collect/
        runProgramChecks (끝난 world를 묻는 live check 포함)  checks/run.ts, checks/app/
        judge item을 채점 대기 file로 (premise가 통과했을 때만)  judge/pending.ts
        queueRepeats (같은 tool·인자 3번 이상이면 진단 item)  experiment/repeat/
        seenComponents(records) (+ cli:claude)            versions/components.ts
        통과한 첫 trial이면 saveMaterials(save)            restore/save.ts → materials/<이름>/<n+1>/
        writeFullRecord → .dev-data/eval/<run>/trial-N.json · core.log
      foldJudge(채점된 item을 check에 접기) → RunRecord 요약 → tests/eval/runs/<RunRecord.id>.json
deno task eval:experiment <id> [--checkout <path>] [--base <rev>] [--budget usd]
  runner/experiment.ts
    readSpec · resolveVariant(--checkout)           experiment/spec, experiment/variant
    checkSpecAgainst · checkSpecLocked(git)         spec이 commit됐고 variant가 그 위인가
    changedComponents · checkChange                 바꾼 것이 spec의 X@a → X@b인가, 섞인 것(mixed)
    selectRuns                                      바뀐 component를 본 run만 target·guard로, 나머지는 keep
    runGate: check → 고른 e2e → dry run              experiment/gate (eval:gate <id>는 이것만)
    findOverfit · measureAssembly(녹화 replay)       경고와 진단. 판정에 들지 않는다
    nextTrials(정책)로 pool에서 trial                 experiment/trials, experiment/parallel
    recordVerdict(default@1) → tests/eval/experiments/<id>/result.json   experiment/verdict
deno task eval:judge <run> [show <key> | set <key> --model m]   → 채점 대기 item 보기와 답 넣기   judge/main.ts
deno task eval:answer <run> [show <key> | set <key> --model m]  → 답 대기 질문 보기와 답 넣기   human/main.ts
deno task eval:attach [session] [--write]  → 도는 Claude Code 화면을 내 터미널에 그린다   coding/driver/attach.ts
deno task eval:scorecard            → tests/eval/scorecards/<date>.md     scorecard/main.ts
deno task eval:scorecard diff A B   → 두 run의 버전·결과 차이(stdout)
```

## 자리

| 자리 | 하는 일 |
|---|---|
| `tests/eval/types.ts` | 계약. 버전, 참가자(role agent와 `CodingParticipant`)와 단계(`say`, `untilIdle`, `deliver`, `callApi`), check, 시나리오(`human`, `save`), 수집 기록, 수치, coding agent·사람 역할 기록, trial·run 기록, 재료, scorecard 행의 type과 constructor |
| `tests/eval/versions/` | hash 규칙(`hash.ts`), registry 읽기·쓰기(`registry.ts`), file을 component로 가르기(`files.ts`의 `classifyPath`, `TOOL_FILES`), 지금 checkout의 버전과 본 component(`components.ts`), 작성자가 n을 정하는 것의 hash(`authored.ts`), git 출처(`source.ts`) |
| `tests/eval/registry/` | `<kind>/<name>.json`. n → hash, 글 component·criterion·judge는 내용도. commit한다 |
| `tests/eval/materials/<이름>/<n>/` | `material.json`(kind, 고정 id, needs, parent, content_hash)과 `files/`. commit한다 |
| `tests/eval/restore/` | 재료 읽기와 hash 확인(`manifest.ts`), 종류별 되살리기(`apps.ts`, `projects.ts`, `context.ts`, `operators.ts`, `active-app.ts`, `app-data.ts`, `package.ts`, `call.ts`), call 본문 보내기(`deliver.ts`), 산출물을 새 재료로 쓰기(`save.ts`), setup helper(`setup.ts`) |
| `tests/eval/coding/driver/` | desktop shell의 터미널 몫. launch plan으로 PTY를 열고(shell의 `createCodingHost` 그대로), `lophn` wrapper(`wrapper.ts`), 보고 뒤 `/exit`와 끊기, folder trust 답하기(`trust.ts`), PTY 입력은 libc `write`로(Deno의 `node:fs`가 node-pty master fd를 몰라 EBADF), attach socket(`screen.ts`, `attach.ts`), hook·skill 설치 확인(`prepare.ts`) |
| `tests/eval/coding/metrics/` | Claude Code session JSONL의 token·tool 오류(`jsonl.ts`), wrapper 기록의 명령(`commands.ts`), `CodingRecord` 합치기(`record.ts`) |
| `tests/eval/human/` | 사람 역할. 질문을 답 대기 file로 두고 답 file을 읽어 `askAnswer`로 넣기(`pending.ts`, `answers.ts`, `role.ts`), 답하는 agent에게 줄 글(`show.ts`, `human.json`, `prompt.md`), 허락 규칙대로 결정하기(`approve.ts`), CLI(`main.ts`) |
| `tests/eval/checks/app/` | 끝난 world를 보는 live check(앱이 켜졌나, app-api가 기대대로 답하나, 재사용, observation, 진단)와 그 judge 입력 |
| `tests/eval/provider/` | `.env` key 읽기, core 설정(`EVAL_MODEL_ATTEMPTS`), `real` 참가자에게만 agent 층 model 붙이기 |
| `tests/eval/collect/` | 제품 읽기 route로 session·turn·model call·tool call·call 읽기, 요청 body blob 읽기(`blob.ts`), 공통 수치(`metrics.ts`), 전체 기록 쓰기 |
| `tests/eval/checks/` | program check builder(`calls.ts`, `tools.ts`), 기록 helper(`records.ts`), fixture builder(`fixtures.ts`), fixture 확인(`validate.ts`) |
| `tests/eval/judge/`, `tests/eval/criteria/` | judge 정의(`judge.json`, `prompt.md`), judge 입력 조립(`input.ts`), 채점 대기 file(`pending.ts`), 답의 enum·인용 검사(`grade.ts`), check에 접기(`fold.ts`), 채점하는 agent에게 줄 글(`show.ts`), CLI(`main.ts`). criterion은 `criteria/<name>.json`(진단 `repeat-kind` 포함) |
| `tests/eval/experiment/` | experiment 조각. spec·result 꼴과 읽기·검사·잠금(`spec/`), run 고르기(`select/`), trial 정책(`trials/`), 판정 `default@1`(`verdict/`), 다른 checkout(`variant/`), gate(`gate/`), 동시 수와 예산의 pool(`parallel/`), 시나리오 고유 단어 경고(`overfit/`), prefix 재기(`assembly/`), 되풀이 진단(`repeat/`), CLI 입구(`mod.ts`) |
| `tests/eval/experiments/<id>/` | `spec.json`(사람이 쓰고 commit), `result.json`(program의 판정), `run.md`(runner), `report.md`(experimenter). commit한다 |
| `tests/eval/runner/` | CLI(`cli.ts`, `experiment.ts`), 시나리오 찾기, 쉼 판정(`idle.ts`), 단계(`steps.ts`), trial 하나(`trial.ts`)와 그 world(`world.ts`), 시나리오 하나의 trial들(`scenario.ts`), run 비용 상한(`cap.ts`), trial 비용 상한(`spend.ts`), registry 쓰기 줄 세우기(`mutex.ts`), spec 잠금 사실(`lock.ts`), replay port(`replay.ts`) |
| `tests/eval/scenarios/<group>/` | 판단 case 17개. `lophn/`(8), `app-engineer/`(3), `project-manager/`(2), `operator/`(4). 캘린더 단위 넷은 `calendar/`(calendar-mvp, calendar-api, calendar-maintain, calendar-diagnose). 같은 폴더의 `common.ts`·`spec.ts`·`dates.ts`는 시나리오가 아니다 |
| `tests/eval/scorecard/` | run 요약 읽기, 시나리오마다 run 고르기와 낡음(`pick.ts`), markdown(`markdown.ts`), run diff(`diff.ts`) |
| `tests/eval/runs/`, `tests/eval/scorecards/` | run 요약과 날짜가 붙은 scorecard. commit한다 |
| `.dev-data/eval/<run>/` | trial마다 전체 기록(대답 글, 요청 body, diff), core.log, 되풀이 진단(`trial-N.repeat.json`), 채점 대기(`judge/<key>.json`), 답 대기(`questions/<key>.json`, `<key>.answer.json`). git 밖 |

## 지키는 것

- **진짜 model은 `real` 참가자만 받는다.** 되살리기가 끝나면 전역 기본 model은 `null`이다(`endRestore`가 되돌리고, `attachRealModels`는 아니면 던진다). project 층도 비운다. `real`에는 agent 층 model만 붙인다. 나머지의 turn은 `failed / configuration_unavailable`로 곧바로 끝나고 provider를 부르지 않는다. 그래서 call을 받아도 그쪽 비용은 0이다. 이 끝남은 정상이고, 쉼 판정과 수치에서 오류로 다루지 않는다.
- **key는 변수로만 든다.** `readAnthropicKey`가 env에서 읽고 `secrets/put`으로 core에 넣는다. 로그, 오류 message, run 기록에 넣지 않는다. core process는 env를 비운 채 뜬다(`tests/support/core`).
- **되살리기의 흔적은 기록에 섞이지 않는다.** runner가 첫 단계 직전 시각을 t0(`TrialRecord.started_at`)으로 남긴다. collect는 runner가 연 session에서 시작해 call의 받는 session을 따라가고, t0 전에 시작한 turn과 그 model·tool call을 버린다.
- **요청 body는 eval의 data root에서만 읽는다.** body를 내놓는 product route가 없다(`blobs/read`가 `model_call/input`을 막는다). `collect/blob.ts`가 `<run.home>/blobs/sha256/..`을 `objectPathFor`로 찾아 읽고, hash가 다르면 `null`이다. 제품에 route를 더하지 않는다.
- **token은 cache를 두 번 빼지 않는다.** 저장된 `usage.input`은 어느 adapter든 cache를 뺀 값이다. `input_total = input + cache_read + cache_write`, cache hit rate = `Σcache_read / Σinput_total`. `cache_in_input`으로 계산하지 않는다.
- **tool 정확도의 분모.** 재시도에 밀린 행은 뺀다. `not_executed` 가운데 `denied`·`rejected`(막힘)는 분모에 들고, 그 밖(멈춤, 대체, 한도, 취소)은 `excluded`로 뺀다.
- **버전은 hash로 고정한다.** 재료, 시나리오, criterion, judge의 n은 쓴 사람이 정하고, registry는 같은 n의 내용이 바뀌면 거절한다("n을 올려라"). component·core·`checks`의 n은 registry가 hash마다 붙인다. 같은 내용은 같은 n이고 옛 내용으로 돌아가면 옛 n이다. `tool:X`는 X를 정의하는 source file(`TOOL_FILES`) 전체로 재므로, 한 file의 tool은 같이 오른다. 재료·registry·runs data는 `deno.json`의 `fmt.exclude`에 있다. 쓰는 쪽이 `JSON.stringify(v, null, 2) + "\n"`로 쓰고 쓴 byte로 hash를 재기 때문이다.
- **run은 진짜 model이 본 것만 남긴다.** `components`는 요청 body에 실린 instruction·tool·skill 설명과, turn 중에 `skill.read`·`guide.read`로 연 것이다. scorecard는 run이 본 component·재료·시나리오·grader의 n을 지금 checkout과 대어 낡음을 적는다. run이 보지 않은 component가 바뀐 것은 낡음이 아니다.
- **채점 순서.** program check가 먼저다. judge check는 `premise`의 program check가 모두 통과하고 trial이 `idle`로 끝났을 때만 item이 된다. item은 채점 대기 file로 남고(`CheckResult.pending`, scorecard의 "채점 대기"), eval을 돌리는 agent가 `eval:judge`로 verdict와 인용을 넣으면 `foldJudge`가 check에 접는다. verdict는 criterion의 enum이고, 인용이 judge 입력 안에 글자 그대로 있어야 통과한다. 그 밖의 답은 `error`로 남고 `error`만 다시 채점할 수 있다. 정상으로 채점된 item은 덮지 않는다. 늘 `cannot_tell`을 허용하고, 점수 없이 verdict만 남긴다. 채점한 model은 item마다 `JudgeItem.model`에 남는다.
- **비용 상한.** runner는 끝난 trial의 `cost_usd`(role agent model call의 USD cost)를 더해 `--budget`(`eval` 기본 $50, experiment는 spec의 `budget_usd`, 기본 $100) 이상이면 새 trial을 띄우지 않는다. judge와 사람 역할은 eval을 돌리는 agent가 하므로 이 합에 없다. 값을 모르는 call(`unpriced_calls`)이 있으면 한 번 경고한다. 판단 case는 core 설정 `lophn-agent.run.model_attempts`를 15로 낮춰 돈다.
- **`tests/eval`의 `*_test.ts`는 `deno task check`에서 돈다.** 그래서 모두 순수하다. core를 띄우지 않고, process·network·진짜 provider를 쓰지 않는다. runner와 시나리오 file은 test file이 아니다.
- **coding agent는 사람 환경의 진짜 Claude Code다.** App Engineer가 맡기면 core가 만든 launch plan 그대로 driver가 PTY로 띄운다. 사람의 HOME, 설치된 Claude Code, 그 로그인을 그대로 쓴다. driver는 dev에 없는 것만 더한다: PATH 앞의 `lophn` wrapper(명령 시각을 기록 file에 적는다)와 `LOPHN_DAEMON_URL`. 상속 env에서 Claude Code 중첩 표시(`CLAUDE_CODE_CHILD_SESSION` 등, 있으면 session 기록을 안 쓴다)와 `ANTHROPIC_API_KEY`(eval의 `.env`에서 온 key라 Claude Code가 그것으로 과금하지 않게)를 지운다. model(`claude-sonnet-5-5`)과 harness는 제품 설정 `coding-agent.default_model`·`default_harness`로 준다.
- **터미널 앞의 사람 몫.** Claude Code는 앱 source마다(자기 `.git`이 있어 상위 폴더 trust가 이어지지 않는다) folder trust를 묻는다. driver가 그 화면만 알아보고, 화면이 1초 그대로인 뒤 아래 화살표를 넣고 커서가 "Yes"일 때만 Enter를 넣는다(`trust.ts`, `CodingTrace.trust_answered`). hook·skill은 사람이 main checkout의 wrapper(`.dev-data/eval/bin/lophn`)로 한 번 설치하고, runner는 `dry_run`으로 확인만 하며 없으면 명령을 찍고 멈춘다. permission 물음은 사람의 권한 설정 그대로이고, 뜨면 session이 `waiting`으로 남아 기록(`permission_requests`)에 든다. eval 전용 flag는 없다.
- **coding agent 수치는 role agent 수치와 섞지 않는다.** `Metrics`는 role agent만 센다. coding agent의 token·tool 오류·명령은 `TrialRecord.coding`에 있다. token은 그 trial의 cwd에 해당하는 Claude Code session JSONL(subagent 포함)을 읽기만 해서 `message.id`로 중복을 빼고 센다. 비용은 세지 않는다.
- **사람 역할은 카드와 허락 규칙만 따른다.** `ask`는 답 대기 file이 되고, eval을 돌리는 agent가 질문마다 새 subagent에게 `eval:answer show`의 글(요구 카드, 앞서 한 답, 질문)만 주어 답하게 한 뒤 `eval:answer set`으로 넣는다. 카드 밖 질문에는 "추천대로 해 줘"다. 답 대기 동안 trial은 기다린다. 허락은 시나리오의 `approve` 규칙대로 program이 제품 route로 낸다. 규칙에 없는 종류는 거절이다. 사람 역할이 있으면 `ask` 대기와 보류 허락은 쉼이 아니다.
- **trial 상한.** role agent의 비용이 trial마다 `--trial-budget`(기본 $50)을 넘으면 그 trial을 timeout으로 끝낸다. coding agent에는 돈 상한이 없고 시간 상한(`CODING_TRIAL_LIMIT_MS`, 90분)만 있다.
- **check 순서가 실행 순서다.** `runProgramChecks`는 배열 순서대로 하나씩 돈다. 끝난 world를 바꾸는 check(observation 확인이 앱에 실패를 일으킨다)는 읽기만 하는 check 뒤에 둔다. live check는 fixture 확인(`core === null`)에서 건너뛴다.
- **산출물은 후보 재료다.** 시나리오의 `save`는 통과한 첫 trial에서만 `tests/eval/materials/<이름>/<n+1>/`에 쓴다. 사람이 보고 commit해야 뒤 단위의 전제가 된다. 뒤 단위는 손으로 쓴 기준 재료(`calendar-app@1`)에서 시작해 앞 run의 질에 흔들리지 않는다.
- **요약과 전체 기록.** 요약(`tests/eval/runs/<RunRecord.id>.json`)은 버전, check verdict, judge item(입력, verdict, 인용), 공통 수치다. 대답 글, 요청 body, working tree diff는 `.dev-data/eval/<RunRecord.id>/`에만 둔다. `.dev-data`는 schema가 바뀌면 지우므로, 기준 run을 다시 쓰려면 요약이 그보다 오래 남아야 한다.

- **experiment는 commit된 spec으로만 돈다.** `checkSpecLocked`가 spec이 commit됐고 variant checkout이 그 commit 위인지 git으로 본다. 판정이 난 `result.json`은 덮지 않고(`판정이 이미 났다`), `inconclusive`는 같은 명령으로 이어 돈다. 이유: 결과를 본 뒤 규칙이나 target을 고르지 못하게.
- **판정은 program이 한다.** `default@1`: target과 미리 쓴 case가 모두 통과하고 guard가 기준보다 나빠지지 않으면 adopt다. 채점 대기가 남으면 `inconclusive`다. 사람이 키를 넣은 trial(`human_input`)은 판정에서 빠진다.
- **trial 정책.** spec의 `trials`(`1 <= base <= max <= 5`)를 따른다. 처음에는 base번. target이 통과하거나 guard verdict가 기준과 다르면 그 시나리오만 max까지 늘린다. 같은 버전에서 trial끼리 갈린 적이 있는 시나리오는 처음부터 max다. 동시 수는 판단 case 4, coding trial 2이고 예산 하나를 같이 쓴다.
- **variant의 core는 그 checkout에서, grader는 지금 checkout에서.** `--checkout`이면 core·instruction·tool 버전은 variant 것이고 check·judge·시나리오는 지금 checkout 것이다. hook과 coding skill 설명은 사람이 한 번 설치한 main checkout 것이라 그것을 고친 experiment는 coding 시나리오로 재지 않는다.
- **gate는 싼 것부터.** variant checkout에서 `deno task check`, 바뀐 file의 module에 걸린 e2e(`module-catalog.yaml`), 고른 시나리오의 dry run(되살리기만, 진짜 model 없음) 순이다. 앞이 떨어지면 뒤는 돌지 않는다.
- **경고와 진단은 판정에 들지 않는다.** 바꾼 글의 더해진 줄에 시나리오의 앱·project 이름이나 사람 말 구절이 있으면 `overfit` 경고, 녹화한 model 답을 fake provider로 되돌려 다시 조립한 layer별 prefix 유지율이 `assembly`, 같은 tool·인자 3번 이상 호출의 `repeat-kind@1` 채점이 `repeats`로 `result.json`에 남는다.

## 왜 이 모양인가

- **제품 route로 되살린다.** data root를 복사하면 schema가 바뀔 때마다 재료가 깨진다. trial마다 새 root에서 제품 route로 되살리면 재료는 schema와 상관없는 작은 JSON과 file로 남는다.
- **판단 case는 기록만으로 채점한다.** case가 묻는 것은 "누구에게 무엇을 맡겼나, 무엇을 물었나"다. 그래서 call과 tool call 기록으로 끝난다. 끝난 world에 묻는 check(앱이 답하나, release가 active인가)는 앱을 만드는 단위만 쓴다(`checks/app/`).
- **judge와 사람 역할은 eval을 돌리는 agent가 subagent로 한다.** judge를 core의 agent로 돌리면 judge의 비용과 지침이 잴 대상에 섞인다. program이 key로 따로 부르면 key와 비용이 eval에 하나 더 붙는다. item마다 새 subagent(한 type으로 고정, 지금 `haiku-xhigh`)에게 `show`의 글만 주면 돌리는 쪽의 가설이 섞이지 않고, judge 버전은 `judge.json`과 `prompt.md` 두 file로 끝난다. 잃는 것: program만으로는 run이 끝나지 않는다. 절차는 `.claude/skills/eval-run/SKILL.md`.
- **coding agent는 사람 환경에서 띄운다.** 격리된 HOME에서 띄우면 로그인과 비용을 eval이 다뤄야 한다. 제품도 사람의 터미널에서 띄우므로 같은 길이 잴 대상에 맞다. eval은 token만 센다.
- **case마다 right/wrong fixture를 둔다.** provider를 부르기 전에 check가 맞는 기록을 통과시키고 틀린 기록을 떨어뜨리는지 본다. check가 틀리면 돈을 쓰기 전에 드러난다.

## 아직 아닌 것

- coding agent는 Claude Code뿐이다. codex와 opencode는 없다.
- 진짜 cache hit은 assembly 재기 뒤 작은 진짜 run으로 따로 봐야 한다. program이 하지 않는다.
- `deno task eval`(experiment 밖)은 지금 checkout만 돈다. 고친 채 돌리면 working tree diff가 전체 기록에 남고 요약에는 `source.dirty`만 남는다.
