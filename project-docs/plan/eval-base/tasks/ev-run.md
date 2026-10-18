# ev-run

`deno task eval`의 진입(`tests/eval/run.ts`)과 scorecard 쓰기를 만든다. provider를 부르기 전에 grader 자체 점검과 재료 hash 확인을 끝내고, key와 돈 상한을 지키고, trial을 돌려 scorecard와 전체 record를 남긴다. 첫 case `L6`을 같이 만들어 이 흐름이 처음부터 끝까지 도는 것을 fake로 확인한다.

- 단위: ev (wave 4)
- 선행: ev-driver, ev-checks, ev-material
- 소유(이 task만 고친다):
  - `tests/eval/{run,scorecard,models}.ts`
  - `tests/eval/cases/L6.ts`
- 읽을 것:
  - 계획: `project-docs/plan/eval-base/README.md`(전부, 특히 "사람이 정할 것"), `project-docs/products/roadmap/eval.md`의 "끝남 기준", "지켜야 할 것", "정할 것" 3·6·7·8, "기초 모양"(scorecard 줄)
  - 조사: `project-docs/plan/eval-base/research/infra.md` 1절(`tests/live/run.ts`의 key gate, 상한 모양), 3절(model catalog는 `packages/core/lophn-agent/models/snapshot.json`의 `provider_definition`, `model_name`), 9절(`.env`·`.env.example`)
  - 본보기: `tests/live/run.ts`(key가 없으면 이유를 찍고 0으로 끝낸다), `tests/live/budget.ts`
  - 계약: `tests/eval/types.ts`(`ScorecardLine`, `Scenario`, `RunRecord`), `tests/eval/drive.ts`(`runTrial`), `tests/eval/grade.ts`·`load.ts`(`gradeRecord`, `selfCheck`, `loadScenarios`), `tests/eval/material/*.ts`(`verifyMaterial`), `tests/eval/collect.ts`(`meanMetrics`)
- 계약:
  - 쓰는 것: 위 module들
  - 내놓는 것:
    - `deno run --allow-all --env-file=.env tests/eval/run.ts [옵션]`. 옵션:
      - `--case <id>[,<id>…]` (기본: 모든 case. roadmap의 `--scenario`와 같은 것이다. 이름은 `--case` 하나만 받는다)
      - `--model <model_name>` (진짜 모드에서 필수. 예: `claude-haiku-5-5`)
      - `--trials <N>` (기본: 시나리오의 `trials`)
      - `--cap <USD>` (기본 1. 이번 실행 전체의 상한)
      - `--fake` (진짜 provider 없이 fake server로 돌린다. 모든 session이 text 한 줄(`ok`)로만 답한다. case별 대본은 없다)
      - `--check` (자체 점검과 재료 hash 확인만 하고 끝낸다)
    - `scorecard.ts`: `writeScorecard(args): Promise<string>`(markdown 쓰고 경로를 돌려준다), `lineOf(scenario, records): ScorecardLine`
    - `models.ts`: `providerOf(model_name): { definition: "anthropic" | "openai"; env: string }`(snapshot 조회)
    - `cases/L6.ts`: 첫 case. 다른 case 파일이 따라 쓰는 본보기다.

## 할 일

1. `models.ts`: `snapshot.json`에서 `model_name`이 같고 `provider_definition`이 `anthropic`·`openai`인 항목을 찾아 provider와 key env 이름(`ANTHROPIC_API_KEY`·`OPENAI_API_KEY`)을 돌려준다. 없으면 오류(어떤 model이 가능한지 담아).
2. `run.ts` 순서(앞 단계가 실패하면 뒤로 가지 않는다. 돈 쓰기 전에 모두 끝난다):
   1. 옵션을 읽는다. 시각은 `systemClock`을 한 곳에서 받아 아래에 넘긴다.
   2. `loadScenarios()`로 case를 모으고 `--case`로 거른다. 없는 id면 오류.
   3. `selfCheck(selected)`: 문제가 있으면 모두 찍고 exit 1. 이것이 `wrong`/`right` 확인이다.
   4. 고른 case의 `world`에 든 재료와 `needs`를 모아 `verifyMaterial`을 한다. hash가 다르면 어느 재료인지 찍고 exit 1. 재료 폴더가 없는 world(`[]`)는 건너뛴다.
   5. `--check`면 여기서 0으로 끝난다.
   6. 진짜 모드: `providerOf(model)`의 key env가 비면 이유를 찍고 exit 0(`tests/live/run.ts`와 같다). `--fake`는 key가 필요 없다.
   7. 시작 알림 한 줄: model, case 수 × trial 수, 상한. `git rev-parse HEAD`로 lophn commit을 읽는다.
   8. case 순서대로, trial마다 `runTrial`을 부른다. `spend`는 실행 전체가 하나의 합이다. `left()`가 0 이하가 되면 남은 trial을 돌리지 않고 이유와 함께 끝낸다. trial이 던지면(준비 실패) 그 trial을 `error`로 기록하고 다음으로 간다. 세 번 연속 던지면 멈춘다. 진행 한 줄씩 찍는다: `[3/51] L4-app t1 pass 24s $0.004`.
   9. trial마다 `gradeRecord`로 채점하고 `RunRecord`와 채점을 `.dev-data/eval/<날짜>/<case>-<model>-t<k>.json`에 쓴다. 대답 글 같은 전체 record는 git 밖이다.
   10. 진짜 모드면 `tests/eval/scorecards/<날짜>-<model>.md`를 쓴다(폴더는 만든다. 이미 있는 file은 덮지 않고 오류. `-2` 같은 꼬리를 붙이지 않는다). `--fake`는 scorecard를 쓰지 않고 요약만 찍는다. `--fake`는 trial이 끝까지 돌았는지(재료 되살리기, setup, session model, 기다림, collect, 정리)와 grader가 판정(통과든 실패든)을 냈는지만 본다. 판정이 어느 쪽인지는 보지 않는다. trial이 던지거나 grader가 던지면 exit 1.
   - 종료 코드: case가 떨어진 것은 exit 0이다(eval은 아무것도 막지 않는다). selfCheck·hash·`--fake` 불일치·준비 오류는 1.
3. `scorecard.ts`: markdown. 위에서부터 ① 머리: 날짜, model, 상한과 쓴 돈, lophn commit, `sdk_hash`·`template_hash`(첫 record의 `env`) ② 재료 표: `이름@n`, hash 앞 12자 ③ case 표: 통과 `n/trials`, `(제안)` 표시, tool 정확도(형식 오류율, 성공률, 막힘률, 되풀이 수, `repeated_tool_failure` 수), 잘림, token(input, output, cache read, cache write), 비용, 시간(turn_ms 평균), agent call 수 ④ 떨어진 check 표: case, check id, 몇 번, 이유(중복 없이). `known_gap`이 있는 check는 "제품 탓"으로 따로 모은다 ⑤ 준비 오류가 있었으면 그 목록. 숫자와 떨어진 이유만 둔다. 대답 글은 싣지 않는다.
4. `cases/L6.ts`(roadmap 표의 L6): `export default`로 `Scenario`. 대상 lophn, world `[]`, 사람 말 `Operator는 뭐고 누가 만들어?`, check 셋(`usedTool("reads-guide", "guide.read", {min:1})`, `noCalls("no-call")`, `neverTool("no-app-create", "app.create")`), `proposal: true`, `trials: 3`. `wrong`은 `call`을 하나 보낸 record(`no-call`이 떨어진다). `right`는 `guide_read`만 있는 record. 이 file이 다른 case의 모양이다. 모든 case file의 같은 줄 수와 꼴을 지킨다.
5. 확인:
   - `deno run -A tests/eval/run.ts --check`가 0으로 끝난다.
   - `deno run -A tests/eval/run.ts --fake --case L6`이 core를 띄워 trial 3번을 끝까지 돌고(판정은 실패여도 된다. 대본이 없어 `guide.read`를 안 부른다) 0으로 끝난다. `.dev-data/eval/<날짜>/`에 record가 생겼다. scorecard 파일은 생기지 않는다.
   - scorecard 쓰기는 진짜 호출 없이 확인한다: scratch(`.dev-data/ev-run/`, commit하지 않는다)에서 위 `--fake` 결과 record로 `writeScorecard`를 임시 폴더에 불러 markdown을 눈으로 본다.
   - key 없이 진짜 모드(`--model claude-haiku-5-5`, env 비움)를 돌려 이유를 찍고 0으로 끝나는지 본다. **진짜 provider를 부르지 않는다. 진짜 key를 읽지 않는다. `.env`를 열지 않는다.**
   - 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 남지 않았다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 이 file들은 `tests/eval`이라 check의 test discovery 밖이고, 막을 위험은 코드 구조로 지킨다(기본 상한 1달러, `--fake`는 key를 읽지 않음, 돈 쓰기 전에 selfCheck와 hash 확인이 끝난다).
- 남지 않음: `grep -rn "Deno.env.get" tests/eval`의 결과가 `run.ts`의 key 읽기 한 곳뿐이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것(lead가 한다):
  - `deno.json` tasks에 `"eval": "deno run --allow-all --env-file=.env tests/eval/run.ts"`
  - `tools/check.ts`의 `NOT_IN_CHECK`에 `"tests/eval"`
  - `deno.json`의 `exclude`와 `tools/check.ts`의 `DENO_EXCLUDED`에 `tests/eval/materials`(ev-material 보고와 같다)
  - `.env.example` 머리 주석에서 "나중의 eval"을 `deno task eval`로
- 정한 것: 상한 기본값, 연속 오류 한도, scorecard 열 구성
- 계약 바꾸기 요청: `ScorecardLine`을 바꿔야 하면 여기 적는다
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: 진짜 provider로는 돌려 보지 않았다는 것
