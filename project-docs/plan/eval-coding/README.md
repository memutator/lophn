# eval-coding: 진짜 coding agent와 캘린더 단위

- 목표: App Engineer가 맡기면 lophn이 제품 길대로 진짜 Claude Code를 띄운다. 그 위에서 캘린더 단위를 잰다: L4-new@2, calendar-mvp, calendar-api, calendar-maintain, calendar-diagnose.
  - 더하는 것: 사람 역할(요구 카드), 허락 규칙, 켜진 앱·앱 data·package·call 재료, 끝난 world를 보는 check(앱이 켜졌나, app-api가 기대대로 답하나, 재사용, observation, 진단), coding agent의 token 집계.
- 재료:
  - `project-docs/products/roadmap/eval.md`의 "단위와 의존", "캘린더 단위", "요구 카드", "재사용 확인", "observation 확인", "진단 확인", "진짜로 도는 것", "공통 수치".
  - 계획 `eval-base`의 README와 `tasks/*.md`. 이 계획은 그 계약(`tests/eval/types.ts`)과 runner 위에 선다.
  - `project-docs/architecture/coding-agent.md`, `activation.md`, `app-call.md`, `approval.md`.
  - 지금 test가 쓰는 길: `tests/support/app/activate.ts`(켜진 앱을 제품 길로 만든다), `tests/support/app/patch-*.ts`(bug 심기), `tests/support/coding/`(fake coding CLI), `tests/e2e/reaction_test.ts`(app-api 호출로 problem 터뜨리기).
- 범위 밖:
  - codex와 opencode. Claude Code만 한다.
  - experiment. 계획 `eval-experiment`가 한다.
  - 판단 case 17개 가운데 L4-new 말고는 바꾸지 않는다.
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `ec-`로 시작한다.
- 순서: 계약(wave 1) → driver, token 집계, 사람 역할, 재료 되살리기, 앱 check(wave 2) → 재료 data와 runner(wave 3) → 시나리오(wave 4) → 문서(lead).
- 시작 조건: 계획 `eval-base`가 main에 land한 뒤. wave 3(재료)은 `@me` package를 import한 앱이 app test에서 떨어지는 bug(`project-docs/issues/coding-agent.md`)가 고쳐진 뒤. 그 전에는 brief만 있다. land하면 planner가 `wrap-plan`으로 base를 닫고, 이 brief를 실제 코드와 대조해 맞춘 뒤 lead를 띄운다.

## 정한 것

- **Claude Code를 띄우는 길**: App Engineer의 call로 lophn이 만든 launch plan 그대로, 사용자 환경에서 띄운다. 사람의 HOME, 설치된 Claude Code, 그 로그인을 그대로 쓴다. eval은 로그인, 격리, 비용을 다루지 않고 token만 센다(사람).
- **desktop shell의 몫**: eval에는 desktop shell이 없다. 그래서 eval driver가 shell의 terminal 몫만 한다(agent).
  - launch plan으로 PTY를 열고, App Engineer의 답을 `input` frame으로 넘기고, 끝나면 `coding_agent_terminals/exited`를 보낸다.
  - env는 shell이 만드는 것과 같게 만든다. 가능하면 shell의 env 코드를 그대로 부른다.
- **dev에 없는 것만 채운다**: PATH의 `lophn` wrapper(명령 시각도 찍는다)와 `plan.env`의 daemon 주소(agent).
- **coding agent의 token**: lophn이 이미 usage를 남기는 길(hook 등)이 있으면 그것을 쓴다. 없으면 그 trial의 Claude Code session 기록(JSONL)에서 `message.usage`를 읽는다. 그 trial의 session file만, 읽기만 한다(agent, 사람: token만 집계).
- **coding agent의 model**: `claude-sonnet-5-5`다. 제품 설정 길(Settings의 coding agent 기본 model, 또는 App Engineer call의 option)로 준다(사람: 대상 model은 모두 Sonnet 5.5).
- **사람 역할**: 요구 카드를 받은 `claude-haiku-5-5`가 `ask`에 답한다(사람).
  - 질문, 카드, 앞서 자기가 한 답만 본다. 카드 밖 질문에는 "추천대로 해 줘"라고 답한다.
  - 허락(activation 허락, Gate가 사람에게 묻는 tool)은 시나리오의 허락 규칙대로 program이 제품 route로 답한다(agent).
- **`calendar-call@1`은 손으로 쓴다**: 등록된 캘린더 앱과 App Engineer에게 간 call 본문이다. L4-new@2가 진짜 run에서 낸 것은 `@2` 후보다(agent).
  - 이유: calendar-mvp가 L4-new의 진짜 run 결과를 기다리지 않게 한다.
- **`calendar-app@1`은 worker가 손으로 쓴 기준 앱이다**: 요구 카드대로 만들고, `notify-app`의 app-api와 `@me/date-range`를 쓴다. calendar-mvp가 진짜 run에서 낸 앱은 `calendar-app@2` 후보다(agent).
  - 이유: 뒤 단위(api, maintain, diagnose)가 진짜 run의 질에 흔들리지 않는 고정 전제를 갖게 한다.
- **재사용과 observation 확인은 calendar-mvp의 check다**: calendar-mvp가 만든 앱의 source를 보고, 그 앱에 정해 둔 실패를 일으켜 본다. 따로 단위를 두지 않는다(agent).
  - 이유: 손으로 쓴 `calendar-app@1`로 observation을 재면 App Engineer와 coding agent가 아니라 손으로 쓴 코드를 재게 된다.
- **roadmap의 `reuse-world@1`은 재료 둘로 둔다**(agent):
  - `notify-app@1`: 켜진 알림 앱. app-api `notify.schedule`이 있다.
  - `date-range@1`: `notify-app`이 낸 package `@me/date-range`.
  - 둘 다 worker가 손으로 쓴 source를 제품 길로 켜고 낸다.
- **bug는 재료로 심는다**: `calendar-app@1`에 patch를 얹은 재료 `calendar-app-bug@1`(parent `calendar-app@1`)로 둔다. 일정 data는 재료 `calendar-data@1`(쓰기 app-api 호출 목록)이다(agent).
- **상한**: role agent, judge, 사람 역할은 시나리오 한 trial에 $50다. coding agent는 돈 상한 없이, 멈춘 process를 끊는 시간 상한(trial당 90분)만 둔다(사람: 첫 상한은 넉넉하게, coding agent는 token만).
- **새 criterion**(agent):
  - `card-covered@1`: 요구 카드가 blueprint와 ticket에 담겼나. `all` / `some_missing` / `cannot_tell`.
  - `asked-again@1`: 요청에 이미 있던 것을 다시 물었나. `no_repeat` / `repeated` / `cannot_tell`.
  - `root-cause@1`: 진단 ticket의 goal이 원인을 짚나. `root_cause` / `symptom_only` / `wrong` / `cannot_tell`.

## 돌리기 전에 확인할 것

brief를 쓸 때 코드로 확인하고 brief에 적는다.

- **folder trust와 첫 실행 질문**: 사용자 환경의 Claude Code가 새 trial 폴더마다 folder trust나 권한을 묻는지, 제품 launch plan이 그것을 넘기는지. 제품이 넘기지 못하면 eval이 따로 넘기지 않고 제품 빈틈으로 보고한다.
- **coding agent의 model**: 그 model을 고르는 제품 길.
- **coding token을 받는 길**: activate.ts의 "coding token은 Gateway `coding_terminal` frame으로만 받는다"가 진짜 CLI에서 어떻게 되는지.

## 사람이 정할 것

터미널 앞의 사람 몫. 제품은 이 셋을 터미널 앞의 사람에게 맡긴다(`project-docs/architecture/coding-agent.md`). eval에는 그 사람이 없다. 추천을 기본 길로 brief에 적어 두고, 사람이 정하면 맞춘다.

1. folder trust: Claude Code는 새 폴더마다 trust를 묻고, 그동안 hook이 돌지 않는다. 이 화면을 넘기는 flag는 없고, 믿은 상위 폴더 아래에서는 묻지 않는다. 추천: trial root를 전용 폴더 하나(예: `/tmp/lophn-eval`) 아래에 두고, 사람이 그 폴더를 한 번 믿는다. runner가 `TMPDIR`을 그쪽으로 돌린다.
2. 권한 물음: 추천은 eval 전용 flag 없이 사람의 권한 mode를 그대로 쓴다. 그래도 뜬 물음은 `waiting`으로 남기고 기록한다.
3. hook과 skill: 지금 설치되어 있지 않다. 추천: 사람이 한 번 개발 실행 꼴(main checkout CLI 절대 path)로 설치한다. eval은 `dry_run`으로 확인만 하고 없으면 명령을 찍는다.

## lead가 할 일

- merge 때마다 등록 file을 고친다(`deno.json`, `fmt.exclude`에 새 data 폴더가 생기면 더한다).
- 끝나면:
  - `project-docs/architecture/eval.md`에 coding agent, 사람 역할, 캘린더 단위를 더한다.
  - `project-docs/products/change-log/`의 열린 판에 덧붙인다.
  - roadmap "단계"에서 이 계획 몫을 지운다.
  - 첫 run을 돌린다: calendar-mvp 1 trial, calendar-api, calendar-maintain, calendar-diagnose 각 1 trial, `claude-sonnet-5-5`. 그 요약을 commit한다.

## task

| id | wave | 선행 | 소유 | 하는 일 |
|---|---|---|---|---|
| `ec-contract` | 1 | 없음 | `tests/eval/types.ts`, `tests/eval/checks/validate.ts`(judge 입력 await) | 계약을 늘린다. coding agent와 사람 역할 참가자, 단계(call 본문 보내기, app-api 부르기), `Scenario.human`(카드, 허락 규칙), `save`, coding agent 기록, 재료 종류 `active_app`·`app_data`·`package`·`call` |
| `ec-driver` | 2 | ec-contract | `tests/eval/coding/driver/**` | shell의 terminal 몫. launch plan으로 PTY, input frame, exited, `lophn` wrapper, daemon 주소 |
| `ec-metrics` | 2 | ec-contract | `tests/eval/coding/metrics/**` | coding agent token과 시간, tool 오류 비율, `message send` 수 |
| `ec-human` | 2 | ec-contract | `tests/eval/human/**` | 사람 역할(Haiku와 요구 카드로 `ask`에 답하기)과 허락 규칙 |
| `ec-restore` | 2 | ec-contract | `tests/eval/restore/**` | 재료 종류 넷 되살리기(켜진 앱은 activate 길, 앱 data는 `apps/call_api` 다시 부르기, package는 fake App Engineer의 publish, call은 첫 단계에서 fake lophn이 보낸다)와 save(산출물 → 새 재료 n) |
| `ec-checks` | 2 | ec-contract | `tests/eval/checks/app/**`, `tests/eval/criteria/{card-covered,asked-again,root-cause}.json`, `tests/eval/criteria/mod.ts`(새 criterion 항목) | 끝난 world를 보는 check, 재사용 확인, observation 확인(실패 일으키기), 진단 확인, 새 criterion 셋 |
| `ec-world` | 3 | ec-restore | `tests/eval/materials/{notify-app,date-range,calendar-call}/**` | 알림 앱 source와 app-api `notify.schedule`, package `@me/date-range`, 손으로 쓴 `calendar-call@1` |
| `ec-calendar` | 3 | ec-restore, ec-world | `tests/eval/materials/{calendar-app,calendar-app-bug,calendar-data}/**` | 손으로 쓴 기준 캘린더 앱, bug patch 재료, 일정 data |
| `ec-runner` | 3 | ec-driver, ec-metrics, ec-human, ec-restore | `tests/eval/run.ts`, `tests/eval/runner/**` | runner에 driver, 사람 역할 loop, coding 기록, save를 잇는다. coding session도 기다린다 |
| `ec-scenarios` | 4 | ec-world, ec-calendar, ec-checks, ec-human | `tests/eval/scenarios/calendar/**`, `tests/eval/scenarios/lophn/L4-new.scenario.ts` | L4-new@2, calendar-mvp, calendar-api, calendar-maintain, calendar-diagnose와 fixture |
