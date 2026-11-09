# eval 돌리기 reference

설계(무엇을 지키고 왜 이 모양인가)는 `project-docs/architecture/eval.md`다. 이 문서는 eval을 돌리고 고치는 쪽이 찾는 것: 명령과 인자, 흐름, 코드 자리, 폴더, 시나리오·재료·check를 더하는 규칙이다. runner의 절차는 `SKILL.md`가 맡는다.

## 명령

```
npm run eval -- --scenario <id> [--scenario <id>...] | --all
                [--model <name>] [--effort <value>] [--trials N] [--budget <usd>] [--trial-budget <usd>] [--keep]
npm run eval:experiment -- <id> [--checkout <path>] [--base <rev>] [--budget <usd>]
npm run eval:gate -- <id> [--checkout <path>] [--base <rev>]
npm run eval:judge -- <run> [show <key> | set <key> --model <name>]
npm run eval:scorecard                   # tests/eval/scorecards/<날짜>.md를 쓴다
npm run eval:scorecard -- diff <runA> <runB>   # 두 run의 버전·결과 차이를 stdout으로
```

- 기본값: `--model claude-sonnet-5-5`, `--trials 1`, `--budget 50`(run 상한 USD), `--trial-budget 50`(trial 하나의 참가자 agent 비용 상한 USD). `--effort`가 없으면 catalog 기본값으로 돈다.
- `eval`과 `eval:experiment`는 `.env`를 읽는다(`ANTHROPIC_API_KEY`). `eval:gate`는 읽지 않는다. key가 없으면 `eval`은 trial을 돌지 않고 0, `eval:experiment`는 1로 끝난다.
- `eval:experiment`는 `--skip-gate`와 `--prefix-only`(assembly prefix 재기까지만)도 받는다. runner는 `--skip-gate`를 쓰지 않는다.
- 종료 코드: 인자 오류 2, 실패 1, 판정(adopt, reject, inconclusive)은 모두 0이다. `eval:judge`는 정상 0, 없는 run·key나 덮기 거절 1, 인자 오류 2.
- `--keep`: trial이 끝나도 world(임시 data root)를 지우지 않고 core만 끈다. 끝에 `world를 남겼다: LOPHN_DEV_HOME=<home> npm run dev`가 찍힌다. 그 명령으로 데스크톱 앱에서 연다(fake provider는 없다). 다 본 뒤 그 폴더를 지운다.

## 흐름

```
npm run eval -- ...
  discover          시나리오 file(scenarios/**/*.scenario.ts의 default export) 찾기
  버전 등록·확인      재료 hash, 시나리오·criterion·judge를 registry에 올린다. n이 어긋나면 여기서 멈춘다
  fixture 확인       right는 모든 program check 통과, wrong은 적은 check가 떨어져야 한다
  key가 없으면       0으로 끝난다
  시나리오는 동시에, trial은 pool(동시 4)로. 예산은 trial을 띄울 때마다 본다
    trial 하나
      새 data root·core 띄움 · 재료 되살리기
      real 참가자마다 workspace session을 열고 session model을 붙임
      t0 ─────────────────────────────────────────────
      단계 실행: say · untilIdle (쉬는 동안 trial 비용 상한을 본다)
      수집(root에서 call의 받는 session까지, t0 뒤 turn이 생긴 다른 session도) · 수치
      program check
      judge item을 채점 대기 file로 (premise가 통과하고 idle로 끝났을 때만)
      같은 tool·인자 3번 이상이면 진단 item(repeat-kind)
      본 component 버전을 재서 registry에 올림
      전체 기록 쓰기
    채점된 item을 check에 접기 → run 요약 tests/eval/runs/<run id>.json
npm run eval:experiment -- <id>
  spec 읽기 → variant 정하기(--checkout) → spec이 지금 checkout과 맞는지 → spec 잠금(git) →
  바뀐 component가 spec의 X@a → X@b인지(섞인 것은 mixed) → run 고르기(target·case·guard, keep, excluded) →
  이어 돌리기 확인(판정이 난 result는 막고, inconclusive는 이어 돈다) →
  gate: check → 고른 e2e → dry run →
  overfit 경고 · assembly 재기 →
  trial 정책으로 pool에서 trial → 판정 default@1 → tests/eval/experiments/<id>/result.json
```

## 코드 자리

| 자리 | 하는 일 |
|---|---|
| `tests/eval/types.ts` | 계약 type과 constructor. 버전, 참가자와 단계(`say`, `untilIdle`), check, 시나리오(`world`, `real`, `steps`, `checks`, `fixtures`), 수집 기록, 수치, trial·run 기록, 재료, scorecard 행 |
| `tests/eval/versions/` | hash 규칙, registry 읽기·쓰기, file을 component로 가르기(`classifyPath`, `TOOL_FILES`), 지금 checkout의 버전과 본 component, 작성자가 n을 정하는 것의 hash, git 출처(`captureSource`) |
| `tests/eval/registry/` | `<kind>/<name>.json`. n → hash, 글 component·criterion·judge는 내용도. commit한다 |
| `tests/eval/materials/<이름>/<n>/` | `material.json`(kind, 고정 id, needs, content_hash)과 `files/`. commit한다 |
| `tests/eval/restore/` | 재료 읽기와 hash 확인, 종류별 되살리기(`apps.ts`, `projects.ts`, `agents.ts`) |
| `tests/eval/provider/` | `.env` key 읽기, core 설정(`EVAL_MODEL_ATTEMPTS`), `real` 참가자에게만 session model 붙이기(`attachRealModels`) |
| `tests/eval/collect/` | 제품 읽기 route로 session·turn·model call·tool call·call 읽기, 요청 body blob 읽기(`blob.ts`의 `diskBlobReader`), 공통 수치(`metrics.ts`), 전체 기록 쓰기 |
| `tests/eval/checks/` | program check builder(`calls.ts`, `tools.ts`), 기록 helper, fixture builder, fixture 확인(`validateFixtures`), check 실행(`runProgramChecks`) |
| `tests/eval/judge/`, `tests/eval/criteria/` | judge 정의(`judge.json`, `prompt.md`), judge 입력 조립, 채점 대기 file(`pending.ts`), 답의 enum·인용 검사(`grade.ts`), check에 접기(`foldJudge`), 채점하는 agent에게 줄 글(`show.ts`), CLI(`main.ts`). criterion은 `criteria/<name>.json`(진단 `repeat-kind` 포함) |
| `tests/eval/experiment/` | experiment 조각. spec·result 꼴과 읽기·검사·잠금(`spec/`), run 고르기(`select/`), trial 정책(`trials/`), 판정 `default@1`(`verdict/`), 다른 checkout(`variant/`), gate(`gate/`), 동시 수와 예산의 pool(`parallel/`), 시나리오 고유 단어 경고(`overfit/`), prefix 재기(`assembly/`), 되풀이 진단(`repeat/`), CLI 입구(`mod.ts`) |
| `tests/eval/experiments/<id>/` | `spec.json`(사람이 쓰고 commit), `result.json`(program의 판정), `run.md`(runner), `report.md`(experimenter). commit한다 |
| `tests/eval/runner/` | CLI(`cli.ts`, `experiment.ts`), 시나리오 찾기, 쉼 판정(`idle.ts`), 단계(`steps.ts`), trial 하나(`trial.ts`)와 그 world(`world.ts`), 시나리오 하나의 trial들(`scenario.ts`), run 비용 상한(`cap.ts`), trial 비용 상한(`spend.ts`), registry 쓰기 줄 세우기(`mutex.ts`), spec 잠금 사실(`lock.ts`), 종료 신호(`signals.ts`), replay port(`replay.ts`) |
| `tests/eval/scenarios/<workspace 종류>/` | 판단 case. 폴더는 말 상대(진짜 model을 받는 참가자)의 workspace 종류다: `home/`, `project/`, `app/`. 같은 폴더의 `common.ts`는 시나리오가 아니다(참가자 이름과 judge 입력 helper) |
| `tests/eval/scorecard/` | run 요약 읽기, 시나리오마다 run 고르기와 낡음(`pick.ts`), markdown, run diff |
| `tests/eval/runs/`, `tests/eval/scorecards/` | run 요약과 날짜가 붙은 scorecard. commit한다 |
| `.dev-data/eval/<run>/` | trial마다 전체 기록(`trial-N.json`: 대답 글, 요청 body, diff), `trial-N.core.log`, 되풀이 진단(`trial-N.repeat.json`), 채점 대기(`judge/<key>.json`). git 밖 |

## 수치와 한도

- 쉼: 조용함(도는 session도, turn이 안 된 입력도 없음)이 1초 이어지면 idle. 250ms마다 읽는다. 한 단계의 기다림 한도 300초, turn이 되지 않은 입력의 한도 300초(timeoutMs와 stuckMs).
- trial 비용 상한은 30초마다 model call 기록의 비용을 다시 더해 본다.
- 판단 case는 core 설정 `lophn-agent.run.model_attempts`를 15로 돈다(`EVAL_MODEL_ATTEMPTS`).
- experiment pool의 동시 수는 4다. 예산 추정(`[estimate]`)은 기준 trial의 평균 비용으로 어림한다.
- gate 단계 한도: check 20분, e2e 15분.
- spec의 `trials`는 `1 <= base <= max <= 5`, `budget_usd`는 0보다 크다.

## judge 입구

- 대기 목록의 줄: `key	kind	check	criterion@n	대기|오류|채점됨`. key는 `t<trial>-<check id>`(특수 문자는 `_`), kind는 check나 diagnosis.
- `show <key>`의 stdout 전문이 subagent의 prompt다(question, allowed_verdicts, input, `prompt.md`).
- `set <key> --model <name>`은 stdin의 `{"verdict": "...", "quote": "..."}`를 받는다. enum 밖이거나 인용이 입력에 없으면 `error`로 기록하고, `대기`·`오류`만 덮는다. 쓰면 run 요약과 전체 기록의 judge item과 check가 같이 접힌다. run 요약이 아직 없으면(runner가 시나리오 끝에 쓴다) 대기 file만 고친다.
- judge 버전은 `judge.json`의 `n`과 `prompt.md`다. 바꾸면 commit된 run이 모두 낡음이다.

## 더하고 고치는 법

- **시나리오**: `scenarios/<workspace 종류>/<id>.scenario.ts`에 `export default`로 `Scenario` 하나. 내용(world, real, steps, checks, fixtures)이 바뀌면 `n`을 올린다(registry가 같은 n의 다른 내용을 거절한다). 사람 말은 평범한 말로 쓴다. fixture는 check마다 right·wrong을 둔다. 파일 머리 주석에 AGENT.md의 출처를 적는다.
- **check**: `checks/`의 builder를 쓴다. 정해진 tool 이름 하나를 요구하지 말고 재려는 판단을 잰다(여러 이름 중 하나를 받는 형태가 있다). check 코드를 고치면 `checks` 버전이 올라 commit된 run이 낡음이 된다.
- **criterion**: `criteria/<name>.json`(`name`, `n`, `question`, `verdicts`(`cannot_tell` 포함), `pass`). 바꾸면 n을 올린다.
- **재료**: `materials/<이름>/<n>/`에 `material.json`과 `files/`. content hash는 `files/` 전체로 계산해 `content_hash`에 적는다. 옛 판은 지우지 말고 새 n을 만든다. 되살리는 route가 바뀌면 `restore/`를 같은 변경에서 고친다.
- **formatter 제외**: 재료, registry, runs, experiments는 formatter 제외 목록(`biome.json`의 `files.includes`)에 있다. 쓰는 쪽이 `JSON.stringify(v, null, 2) + "\n"`로 쓰고 쓴 byte로 hash를 재기 때문이다.
- **experiment spec**: `experiments/<id>/spec.json`을 쓰고 commit한 뒤에 variant를 만든다. variant는 그 commit 위에 쌓는다. spec의 `from`은 기준(main) checkout의 지금 버전이어야 한다.

## variant와 gate

- `--checkout <path>`는 git checkout의 최상위(예: worktree)여야 하고 core 입구가 있어야 한다. 준비: variant에서 `npm ci --prefer-offline`, E2E 의존 cache(`.dev-data/e2e/npm-cache`)가 비었으면 `npm run e2e:deps`.
- variant의 workspace 지침은 그 checkout의 Electron Node로 띄운 작은 script로 읽는다.
- gate: (1) variant에서 `npm run check`, (2) 바뀐 file(`--base` 또는 main과의 merge-base 기준)의 module이 걸린 boundary를 contract로 선언한 e2e만(`project-docs/module-catalog.yaml`, `boundary-catalog.yaml`을 지금 checkout에서 읽는다. 테스트의 `contract:` 주석에서 boundary ID를 읽고, 못 읽으면 늘 고른다. 지침·skill 글만 바뀌면 고르지 않고, 테스트 지원·package manifest가 바뀌면 전부 고른다), (3) 고른 시나리오의 fixture 확인과 dry run. 앞이 떨어지면 뒤는 돌지 않는다.
- variant에서 boot나 restore가 실패하면 오류가 "variant의 core로 ... 멈췄다. 지금 checkout의 protocol·route와 달라서일 수 있다"고 알린다. grader는 지금 checkout의 protocol로 부르기 때문이다.

## assembly 재기

바꾼 것이 assembly일 때만. 기준 run의 trial 0 기록에서 model 답을 뽑아 fake provider 서버로 되돌려 주고, 같은 시나리오를 variant core로 다시 돌려 요청 body의 cache 경계마다 prefix hash를 견준다. layer 이름: `workspace_kind`, `instructions`, `skills`, `workspace`, `blockN`(body만으로 붙인다). 출력 줄은 `[assembly] ...`다. 기록이 없거나 다시 조립할 수 없으면 `not_replayable`이다.

## stdout과 폴더

stdout 줄의 읽는 법은 `SKILL.md`의 "stdout 줄". `[estimate] trials a..b (likely n) $x (budget $y)`는 돌리기 전 어림이고 최대치가 예산을 넘으면 "예산 부족할 수 있음"이 붙는다. 한 번에 한 시나리오의 end 줄: `<id>@<n>: <통과>/<trial> trial 통과, 떨어진 check ..., 채점 대기 N건(npm run eval:judge -- <run>), $비용 (<run id>)`.
