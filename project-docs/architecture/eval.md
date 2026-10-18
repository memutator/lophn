# eval

진짜 model로 lophn agent의 판단을 잰다. test가 "코드가 계약대로 도나"를 fake model로 본다면, eval은 "지침과 model이 맡은 일을 맞게 하나"를 본다. 시나리오 하나가 재료로 world를 되살리고, 사람 말 한 줄을 넣고, agent들이 쉴 때까지 기다린 뒤, 남은 기록을 program check와 judge로 채점한다. 결과는 run 요약으로 commit하고 scorecard로 읽는다. 설계의 정본과 아직 만들지 않은 것은 `project-docs/products/roadmap/eval.md`다. 이 문서는 지금 코드가 하는 것만 적는다.

## 흐름

```
deno task eval --scenario <id> | --all [--model m] [--trials N] [--budget usd]
  tests/eval/run.ts → runner/cli.ts
    discover          scenarios/**/*.scenario.ts의 default export
    버전 확인          재료 hash(restore), 시나리오·criterion·judge hash(versions)를 registry와 댄다
    fixture 확인       checks/validate.ts: right는 모든 program check 통과, wrong은 적은 check가 떨어져야 한다
    key가 없으면       여기서 0으로 끝난다(진짜 provider를 부르지 않는다)
    시나리오마다 trial마다 (runner/trials.ts, 상한 runner/cap.ts)
      runner/trial.ts
        createRun · bootCore(evalCoreSettings())          tests/support/core, provider/settings.ts
        beginRestore → restoreWorld(world) → setup → endRestore   restore/
        attachRealModels(real)                            provider/attach.ts
        t0 ─────────────────────────────────────────────
        say → waitUntilIdle                               runner/idle.ts
        collectSessions(roots, t0) · metricsOf · sumMetrics   collect/
        runProgramChecks                                  checks/run.ts
        judgeItem (premise가 통과했을 때만)                judge/run.ts → Anthropic Messages API
        seenComponents(records)                           versions/components.ts
        writeFullRecord → .dev-data/eval/<run>/trial-N.json · core.log
      RunRecord 요약 → tests/eval/runs/<RunRecord.id>.json
deno task eval:scorecard            → tests/eval/scorecards/<date>.md     scorecard/main.ts
deno task eval:scorecard diff A B   → 두 run의 버전·결과 차이(stdout)
```

## 자리

| 자리 | 하는 일 |
|---|---|
| `tests/eval/types.ts` | 계약. 버전, 참가자와 단계, check, 시나리오, 수집 기록, 수치, trial·run 기록, 재료, scorecard 행의 type과 `say`·`untilIdle`·`refText`·`parseRef` |
| `tests/eval/versions/` | hash 규칙(`hash.ts`), registry 읽기·쓰기(`registry.ts`), file을 component로 가르기(`files.ts`의 `classifyPath`, `TOOL_FILES`), 지금 checkout의 버전과 본 component(`components.ts`), 작성자가 n을 정하는 것의 hash(`authored.ts`), git 출처(`source.ts`) |
| `tests/eval/registry/` | `<kind>/<name>.json`. n → hash, 글 component·criterion·judge는 내용도. commit한다 |
| `tests/eval/materials/<이름>/<n>/` | `material.json`(kind, 고정 id, needs, parent, content_hash)과 `files/`. commit한다 |
| `tests/eval/restore/` | 재료 읽기와 hash 확인(`manifest.ts`), 종류별 되살리기(`apps.ts`, `projects.ts`, `context.ts`, `operators.ts`), setup helper(`setup.ts`: `openProblem`, `openTicket`, `excludeCall`) |
| `tests/eval/provider/` | `.env` key 읽기, core 설정(`EVAL_MODEL_ATTEMPTS`), `real` 참가자에게만 agent 층 model 붙이기 |
| `tests/eval/collect/` | 제품 읽기 route로 session·turn·model call·tool call·call 읽기, 요청 body blob 읽기(`blob.ts`), 공통 수치(`metrics.ts`), 전체 기록 쓰기 |
| `tests/eval/checks/` | program check builder(`calls.ts`, `tools.ts`), 기록 helper(`records.ts`), fixture builder(`fixtures.ts`), fixture 확인(`validate.ts`) |
| `tests/eval/judge/`, `tests/eval/criteria/` | judge 정의(`judge.json`, `prompt.md`), judge 입력 조립(`input.ts`), 호출과 인용 검사(`run.ts`). criterion은 `criteria/<name>.json` |
| `tests/eval/runner/` | CLI, 시나리오 찾기, 쉼 판정, trial 하나, trial 여럿과 비용 상한 |
| `tests/eval/scenarios/<group>/` | 판단 case 17개. `lophn/`(8), `app-engineer/`(3), `project-manager/`(2), `operator/`(4). 같은 폴더의 `common.ts`는 시나리오가 아니다 |
| `tests/eval/scorecard/` | run 요약 읽기, 시나리오마다 run 고르기와 낡음(`pick.ts`), markdown(`markdown.ts`), run diff(`diff.ts`) |
| `tests/eval/runs/`, `tests/eval/scorecards/` | run 요약과 날짜가 붙은 scorecard. commit한다 |
| `.dev-data/eval/<run>/` | trial마다 전체 기록(대답 글, 요청 body, diff)과 core.log. git 밖 |

## 지키는 것

- **진짜 model은 `real` 참가자만 받는다.** 되살리기가 끝나면 전역 기본 model은 `null`이다(`endRestore`가 되돌리고, `attachRealModels`는 아니면 던진다). project 층도 비운다. `real`에는 agent 층 model만 붙인다. 나머지의 turn은 `failed / configuration_unavailable`로 곧바로 끝나고 provider를 부르지 않는다. 그래서 call을 받아도 그쪽 비용은 0이다. 이 끝남은 정상이고, 쉼 판정과 수치에서 오류로 다루지 않는다.
- **key는 변수로만 든다.** `readAnthropicKey`가 env에서 읽고 `secrets/put`으로 core에 넣는다. 로그, 오류 message, run 기록에 넣지 않는다. core process는 env를 비운 채 뜬다(`tests/support/core`).
- **되살리기의 흔적은 기록에 섞이지 않는다.** runner가 첫 단계 직전 시각을 t0(`TrialRecord.started_at`)으로 남긴다. collect는 runner가 연 session에서 시작해 call의 받는 session을 따라가고, t0 전에 시작한 turn과 그 model·tool call을 버린다.
- **요청 body는 eval의 data root에서만 읽는다.** body를 내놓는 product route가 없다(`blobs/read`가 `model_call/input`을 막는다). `collect/blob.ts`가 `<run.home>/blobs/sha256/..`을 `objectPathFor`로 찾아 읽고, hash가 다르면 `null`이다. 제품에 route를 더하지 않는다.
- **token은 cache를 두 번 빼지 않는다.** 저장된 `usage.input`은 어느 adapter든 cache를 뺀 값이다. `input_total = input + cache_read + cache_write`, cache hit rate = `Σcache_read / Σinput_total`. `cache_in_input`으로 계산하지 않는다.
- **tool 정확도의 분모.** 재시도에 밀린 행은 뺀다. `not_executed` 가운데 `denied`·`rejected`(막힘)는 분모에 들고, 그 밖(멈춤, 대체, 한도, 취소)은 `excluded`로 뺀다.
- **버전은 hash로 고정한다.** 재료, 시나리오, criterion, judge의 n은 쓴 사람이 정하고, registry는 같은 n의 내용이 바뀌면 거절한다("n을 올려라"). component·core·`checks`의 n은 registry가 hash마다 붙인다. 같은 내용은 같은 n이고 옛 내용으로 돌아가면 옛 n이다. `tool:X`는 X를 정의하는 source file(`TOOL_FILES`) 전체로 재므로, 한 file의 tool은 같이 오른다. 재료·registry·runs data는 `deno.json`의 `fmt.exclude`에 있다. 쓰는 쪽이 `JSON.stringify(v, null, 2) + "\n"`로 쓰고 쓴 byte로 hash를 재기 때문이다.
- **run은 진짜 model이 본 것만 남긴다.** `components`는 요청 body에 실린 instruction·tool·skill 설명과, turn 중에 `skill.read`·`guide.read`로 연 것이다. scorecard는 run이 본 component·재료·시나리오·grader의 n을 지금 checkout과 대어 낡음을 적는다. run이 보지 않은 component가 바뀐 것은 낡음이 아니다.
- **채점 순서.** program check가 먼저다. judge check는 `premise`의 program check가 모두 통과하고 trial이 `idle`로 끝났을 때만 부른다. verdict는 tool 입력 schema의 enum이고, 인용이 judge 입력 안에 글자 그대로 있어야 통과한다. 늘 `cannot_tell`을 허용하고, 점수 없이 verdict만 남긴다.
- **비용 상한.** runner는 끝난 trial의 `cost_usd`(model call의 USD cost)와 judge 비용을 더해 `--budget`(기본 $50) 이상이면 새 trial을 띄우지 않는다. 값을 모르는 call(`unpriced_calls`)이 있으면 한 번 경고한다. 판단 case는 core 설정 `lophn-agent.run.model_attempts`를 15로 낮춰 돈다.
- **`tests/eval`의 `*_test.ts`는 `deno task check`에서 돈다.** 그래서 모두 순수하다. core를 띄우지 않고, process·network·진짜 provider를 쓰지 않는다. runner와 시나리오 file은 test file이 아니다.
- **요약과 전체 기록.** 요약(`tests/eval/runs/<RunRecord.id>.json`)은 버전, check verdict, judge item(입력, verdict, 인용), 공통 수치다. 대답 글, 요청 body, working tree diff는 `.dev-data/eval/<RunRecord.id>/`에만 둔다. `.dev-data`는 schema가 바뀌면 지우므로, 기준 run을 다시 쓰려면 요약이 그보다 오래 남아야 한다.

## 왜 이 모양인가

- **제품 route로 되살린다.** data root를 복사하면 schema가 바뀔 때마다 재료가 깨진다. trial마다 새 root에서 제품 route로 되살리면 재료는 schema와 상관없는 작은 JSON과 file로 남는다.
- **판단 case는 기록만으로 채점한다.** case가 묻는 것은 "누구에게 무엇을 맡겼나, 무엇을 물었나"다. 그래서 call과 tool call 기록으로 끝난다. 끝난 world에 묻는 check(앱이 답하나, release가 active인가)는 `eval-coding`이 더한다.
- **judge는 runner가 직접 부른다.** judge를 core의 agent로 돌리면 judge의 비용과 지침이 잴 대상에 섞인다. Messages API를 `fetch` 하나로 부르면 judge 버전이 `judge.json`과 `prompt.md` 두 file로 끝난다.
- **case마다 right/wrong fixture를 둔다.** provider를 부르기 전에 check가 맞는 기록을 통과시키고 틀린 기록을 떨어뜨리는지 본다. check가 틀리면 돈을 쓰기 전에 드러난다.

## 아직 아닌 것

- 진짜 coding agent(PTY), 사람 역할과 요구 카드, 켜진 앱·앱 data·package·call 재료, 캘린더 단위, 끝난 world를 묻는 check: 계획 `eval-coding`.
- experiment spec, trial 정책, 병렬 실행, gate의 dry run, 되풀이를 보는 judge: 계획 `eval-experiment`. 지금은 `--trials N`만 있고 trial은 하나씩 돈다.
- variant는 지금 checkout뿐이다. 고친 채 돌리면 working tree diff가 전체 기록에 남고 요약에는 `source.dirty`만 남는다.
