# eval-base: eval의 기초와 책임에 따른 call 판단 case

- 목표: 진짜 model로 lophn agent의 일을 재는 eval 층의 기초를 세우고, 그 위에서 작은 판단 case 17개를 돌린다.
  - 기초: runner(`deno task eval`), 버전 registry, 재료(담기, 되살리기, hash), 진짜 provider 붙이기, run 기록과 공통 수치, program check와 judge check, scorecard와 diff.
- 재료:
  - `project-docs/products/roadmap/eval.md`: 이 계획의 정본이다. domain model, 버전, run, 단위와 의존, check와 judge, 공통 수치, 재료, 판단 case 표, 진짜로 도는 것, 지켜야 할 것, 정한 것.
  - `project-docs/products/AGENT-ROLE.md`: 판단 case의 출처.
  - `project-docs/architecture/testing.md`(test 층, `tests/support`, E2E 실행 폴더), `project-docs/architecture/agent-definition.md`(agent 정의, prompt 조립, tool, model), `project-docs/architecture/agent-call.md`(call), `project-docs/architecture/approval.md`(grant, Gate).
  - 지금 test가 쓰는 길: `tests/support/core/`(core 띄우기, `createRun`, 사람 자격), `tests/support/fake-server/`(fake provider), `tests/e2e/pm-context_test.ts`(context를 만드는 길).
- 범위 밖:
  - 진짜 coding agent, 사람 역할과 요구 카드, 캘린더 단위, 켜진 앱·앱 data·package·call 재료. 계획 `eval-coding`이 한다.
  - experiment(다시 돌릴 run을 본 component로 고르기, trial 정책, 예산, gate의 dry run, runner와 experimenter의 skill, assembly의 prefix 재기, 되풀이를 보는 judge `repeat-kind`). 계획 `eval-experiment`가 한다. 이 계획은 `--trials N`만 둔다.
  - 옛 `eval-base` brief(git `e1787ca94`)는 참조하지 않는다(사람).
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다.
- 단위: `tasks/*.md`의 "단위"가 정한다. task id는 `ev-`로 시작한다.
- 순서: 계약(wave 1) → 버전, 재료, provider, 수집, check, judge(wave 2) → runner, scorecard, 판단 case(wave 3) → 문서(lead).
- 시작 조건: 없음. 다른 열린 계획이 없다.

## 자리

```
tests/eval/
  run.ts            deno task eval의 입구
  types.ts          계약. 모든 ev-* task가 기댄다
  versions/         component·core·재료·시나리오·criterion·judge의 hash 규칙과 registry 읽기·쓰기
  registry/         registry data(이름@n → hash, 글 component와 criterion은 내용도)
  restore/          재료 되살리기와 setup(grant, ticket 같은 준비)
  materials/        재료 data(<이름>/<n>/material.json, files/)
  provider/         .env의 key, secrets/put, provider 붙이기, real 참가자에게 model 붙이기
  collect/          ledger를 읽어 run 기록과 공통 수치를 만든다
  checks/           program check helper, right/wrong fixture 확인
  judge/            judge 호출, judge prompt, 인용 검사
  criteria/         criterion data
  runner/           trial 하나를 돌리는 순서
  scorecard/        scorecard view와 diff
  scenarios/        판단 case. <group>/<id>.scenario.ts가 export default로 Scenario 하나. index file 없음
  runs/             run 요약(commit한다)
  scorecards/       날짜가 붙은 scorecard(commit한다)
.dev-data/eval/     run 전체 기록(대답 글, 요청 body). git 밖
```

## 정한 것

roadmap "정한 것" 가운데 이 계획에 걸리는 것은 다시 적지 않는다. 아래는 이 계획에서 새로 정한 것이다.

- run 요약은 `tests/eval/runs/`에 쓰고 commit한다. 요약은 버전, verdict, judge item(쪼인 입력, verdict, 인용), 공통 수치다. 대답 글과 요청 body 전체는 `.dev-data/eval/`에 둔다(agent). 이유: `.dev-data/`는 schema가 바뀌면 지운다(AGENTS.md "호환성"). 기준 run을 다시 쓰려면 요약이 그보다 오래 남아야 한다.
- 재료 종류는 이 계획에서 앱 등록(source 없이도), project, context, Operator·grant만 만든다. 켜진 앱, 앱 data, package, call은 `eval-coding`이 더한다(agent).
- L4-new는 이 계획에서 `apps-home@1`(앱 가계부, 할일)로 돈다. `eval-coding`이 world를 `reuse-world@1`로 바꾸고 save `calendar-call@1`을 더한다(L4-new@2)(agent).
- 판단 case의 setup에 켜진 앱이 있어야 하는 것(열린 problem 등)은 제품 길로만 만든다. eval 전용 길을 만들지 않는다. 켜진 앱 없이 만들 수 없으면 그 case나 그 setup 줄은 `eval-coding`으로 넘긴다(agent).
- judge는 runner가 Anthropic Messages API를 직접 부른다. model은 `claude-haiku-5-5`이고, verdict는 tool 입력 schema의 enum으로 받는다. `judge@1`은 model, option, prompt file이다(agent).
- variant는 이 계획에서는 지금 checkout(working tree)뿐이다. 고친 채 돌리면 diff를 run 기록에 남긴다. 다른 checkout에서 core를 띄우는 것은 `eval-experiment`가 한다(agent).
- trial은 `--trials N`, 기본 1이다(사람: 늘 3번씩 돌리지 않는다).
- 상한은 판단 case를 한 번 돌릴 때 $50다(사람: 첫 상한은 매우 넉넉하게). runner는 `modelCallList`의 cost와 judge 비용을 더해 넘으면 새 trial을 띄우지 않는다.
- `tests/eval`의 `*_test.ts`는 `deno task check`가 돈다. `NOT_IN_CHECK`에 넣지 않는다. 그래서 그 test는 모두 core를 띄우지 않고, process·network·진짜 provider를 쓰지 않는다. runner(`run.ts`)와 시나리오 file은 test file이 아니라 check가 돌리지 않는다(agent).
- `tests/eval/materials/`, `tests/eval/registry/`, `tests/eval/runs/`는 data라 `deno.json`의 `fmt.exclude`에 넣는다. 쓰는 쪽은 `JSON.stringify(value, null, 2) + "\n"`로 쓰고, hash는 쓴 byte로 잰다. fmt가 byte를 바꾸면 재료 hash가 틀어지기 때문이다(agent).
- model에 보낸 요청 body를 읽는 product route가 없다(`blobs/read`가 `model_call/input`을 막는다). collect는 eval이 만든 data root의 blob file(`<run.home>/blobs/sha256/<앞 2자>/<나머지>`)을 읽기만 한다. 제품에 route를 더하지 않는다(agent).
- token은 코드대로 센다. 모든 adapter의 `usage.input`은 이미 cache를 뺀 값이다. `input_total = input + cache_read + cache_write`, cache hit rate는 `cache_read / input_total`이다(agent).
- `tool:X`의 hash는 X를 정의하는 source file(설명, schema, handler)로 잰다. 그 file은 `runtime`에서 뺀다. 한 file이 tool 여럿을 정의하면 같이 오른다(agent).
- grader 버전: 시나리오 hash는 시나리오 file과 같은 폴더의 helper file이다. `checks@n`은 `tests/eval/checks/**`의 hash이고 registry가 n을 붙인다. 시나리오, criterion, judge, 재료의 n은 쓴 사람이 정하고 registry는 hash만 확인한다(agent).
- 되살리기와 setup이 연 session은 시각으로 가른다. runner가 첫 단계 직전 시각(t0)을 남기고, collect는 runner가 연 session에서 시작해 call의 받는 session을 따라가되 t0 전에 시작한 turn과 그 model·tool call을 뺀다(agent).
- 진짜 model이 없는 참가자의 turn은 곧바로 `failed`/`configuration_unavailable`로 끝난다. 정상이다. 기다리기는 이것과 `waiting`(답을 기다리는 `ask`)을 쉰 것으로 친다. 시간이 다 되면 그 이유를 trial의 `settle`에 남기고 그 trial은 떨어진다(agent).
- 재료 안의 이름: 앱 가계부(slug `ledger`), 할일(slug `todo`), project `tax`(title 세무), `hr`(title 인사), `tax`의 context `receipts`(영수증), Operator `월말정리`(앱 가계부), `세무정리`(project tax, context receipts). 참가자와 setup은 이 이름으로 가리킨다. `call` tool의 `to`가 앱 name과 project name으로 맞추기 때문이다(agent).
- L7은 이 계획에 남긴다. 열린 problem은 등록된 앱에 `observeViewError`로, ticket은 fake App Engineer의 `ticket_create`(`check: {kind: "text"}`)로 만든다(agent).
- T19는 막힌 call이 하나도 없으면 떨어진다. 막힌 call이 없으면 그 규칙을 재지 못했기 때문이다(agent).

## 계약

`tasks/ev-contract.md`가 정본이다. 다른 brief는 그 이름과 칸으로 서로 기댄다.

## 사람이 정할 것

- worker가 계획 중에 진짜 provider를 부르는 것(roadmap "정할 것" 1). 추천은 `claude-haiku-5-5`로만, 계획 전체 $5. 정해질 때까지 worker는 진짜 provider를 부르지 않고 fake provider와 fixture로만 확인한다. lead는 첫 진짜 run 전에 사람에게 `.env`의 key를 받는다.

## lead가 할 일

- merge 때마다 등록 file을 고친다: `deno.json`의 `eval` task(`--env-file=.env`)와 `eval:scorecard` task, `fmt.exclude`에 `tests/eval/materials/`, `tests/eval/registry/`, `tests/eval/runs/`.
- 끝나면:
  - `project-docs/architecture/eval.md`를 새로 쓴다. roadmap의 설계 가운데 이 계획이 만든 것을 실제 코드 path로 옮긴다.
  - `project-docs/architecture/testing.md`에 eval 층과 돌리는 때를 더한다.
  - `project-docs/context-component-registry.yaml`에 `tool-eval`과 `architecture-eval`을 더한다.
  - `project-docs/module-catalog.yaml`의 `tests` notes와 `.claude/skills/write-test/SKILL.md`의 층 목록을 맞춘다.
  - 첫 scorecard(판단 case 17개, `claude-sonnet-5-5`, trial 1)를 commit한다.
  - `project-docs/products/change-log/`의 열린 판에 항목을 덧붙인다.
  - `project-docs/products/roadmap/eval.md`의 "단계"에서 이 계획 몫을 지운다.
