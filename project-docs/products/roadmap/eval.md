# eval: 진짜 model이 lophn의 일을 잘하나

상태: 로드맵. 계획 `eval-base`(기초와 판단 case 17개), `eval-coding`(진짜 coding agent, 사람 역할, 캘린더 단위), `eval-experiment`(experiment, agent 채점)는 모두 land했다. 그 코드는 `project-docs/architecture/eval.md`가 적는다. 이 문서에 남은 것은 설계의 배경과 아직 만들지 않은 것이다. domain model과 구조는 2026-10-18 planner와 사람이 다시 정했다. 그림은 artifact "lophn eval 설계"(https://claude.ai/artifact/P9TagQSccLQAgRWFcDeD6g)에 있다.
계획이 land할 때마다 이 설계 가운데 만든 것을 실제 코드 path와 함께 `project-docs/architecture/eval.md`로 옮기고, 여기서는 지운다. architecture 문서는 지금 코드만 적기 때문이다.
배경 문서: `project-docs/products/AGENT-ROLE.md`, `project-docs/architecture/testing.md`, `project-docs/architecture/coding-agent.md`, `project-docs/architecture/agent-definition.md`, AGENTS.md "속도"·"사람에게 묻는 것".

## 왜

- test 층 다섯(`architecture/testing.md`)은 정해 둔 입력에 pass/fail이 결정적으로 갈리는 것만 본다. fake는 대답을 test가 정하므로 판단이 없다. live는 진짜 model을 부르지만 대답 내용을 보지 않는다(`tests/live/suite.ts:173-199`).
- AGENT-ROLE의 L1~L7은 "의미 판단이라 program이 강제하지 않는다". T19는 "agent 지침의 규칙이고 program이 막지는 않는다". 앱을 만들고, 이미 있는 것을 다시 쓰고, 문제를 진단하는 일도 role 지침과 model이 한다. 이것을 재는 장치가 없다.
- instruction, skill, tool definition, prompt 조립을 고쳐도 그것이 정말 나아졌는지 확인할 길이 없다. 고친 것이 시나리오 하나에만 맞춰졌는지도 모른다.

## 무엇을 재나

1. 앱 만들기: 캘린더 앱 MVP를 만들고, 그 앱의 tool을 쓰고, 기능을 더하는 유지보수까지 단위로 나눠 잰다.
2. 바퀴를 다시 만들지 않기: 새 앱을 만들 때 이미 있는 component, logic(package), 다른 앱의 공개 tool을 찾아 쓰나.
3. 책임에 따른 agent call: 누구에게 어떤 답 방식으로 맡기나. 남의 일을 직접 하지 않나. 거절당한 일을 다른 agent에게 돌리지 않나(T19).
4. observation 두기: App Engineer가 앱이 문제를 보고할 자리를 잘 두게 하나.
5. 진단: 앱이 문제를 보고하면 App Engineer가 원인을 찾아 맞는 ticket을 만들고, 고친 뒤 그 문제가 다시 나지 않나.
6. harness 고치기: instruction, skill, tool definition, prompt 조립을 바꾼 것이 정말 나아졌는지 experiment로 확인한다.

어떤 시나리오든 아래 "공통 수치"를 같이 잰다.

## domain model

eval은 세 쪽으로 나뉜다. 두 run을 비교할 때 시나리오와 grader는 같고 대상만 바뀐다.

| 쪽 | 무엇 |
|---|---|
| 시나리오 | 단위 하나. 전제 재료에서 시작해 일을 하고, 산출물을 새 재료로 남긴다. 무엇을 어떻게 잴지 갖는다: world(전제 재료 목록), `real`(진짜 model을 받는 참가자), 단계, check, save |
| 대상(variant) | 일하는 쪽. component 버전의 묶음이다. model도 component 하나다 |
| grader | check가 쓰는 criterion과 judge. 대상의 checkout에서 가져오지 않고 지금 checkout에 고정한다. instruction을 고치면서 check도 같이 바뀌어 점수가 오르는 일을 막는다 |

```
재료 이름@n ──(목록)──▶ world
시나리오@n = world + real + 단계 + check + save
     │ × variant, trial마다 새 data root에서
     ▼
   trial ──▶ run 기록 ──┬─▶ check verdict ──┐
     │                  └─▶ 공통 수치 ──────┴─▶ scorecard(view)
     └── save ──▶ 산출물 = 새 재료@n+1 (사람이 commit) ──▶ 뒤 시나리오의 world

experiment = component 하나를 X@a → X@b로 바꾸고, X@a를 본 run만 다시 돌린다
```

### 버전

재료, component, core, 시나리오, criterion, judge는 모두 `이름@n`과 content hash로 매긴다. 같은 `이름@n`은 어느 시나리오의 어느 run에서든 같은 내용이다. 그래서 `skill:lophn-build-app@3`이 나아졌다는 말은 그 skill이 쓰이는 모든 곳에 대한 말이 된다.

| 종류 | 예 | 담는 것 |
|---|---|---|
| 재료 | `notify-app@1`, `calendar-call@1`, `calendar-app@1` | 시작 world의 조각이자 시나리오의 산출물(아래 "재료") |
| component | `instruction:lophn@3`, `skill:lophn-build-app@2`, `guide:roles-and-grants@1`, `tool:call@1`, `assembly@5`, `runtime@7`, `template:app@4`, `model:claude-sonnet-5-5`, `cli:claude@2.1.302` | model을 둘러싼 harness의 조각 |
| checks | `checks@3` | program check helper(`tests/eval/checks/`). grader의 한 조각이다 |
| core | `core@31` | eval이 띄우는 코드 가운데 component가 아닌 것 전부: core daemon, CLI, protocol, SDK. 버전 하나로 매긴다 |
| 시나리오 | `L4-app@1`, `calendar-mvp@1` | world, `real`, 단계, check, save. 단계나 check를 고치면 새 n이다 |
| criterion | `relay-complete@1`(예) | judge check의 질문 하나와 verdict enum |
| judge | `judge@1`(예) | judge model과 prompt |

- 1 byte라도 다르면 새 n이다. registry가 `이름@n`마다 hash를 갖는다.
  - 글 component(instruction, skill, tool definition, template)와 criterion은 내용도 담는다. 그래서 어느 두 버전이든 diff를 본다.
  - 코드(assembly, runtime, core)의 내용은 git에 있다. working tree에서 고친 채 돌린 run은 그 diff를 기록에 같이 남긴다.
- runner는 돌기 전에 checkout에서 component마다 hash를 재서 registry에서 찾는다. 처음 보는 내용이면 새 n을 붙인다.
- skill은 설명(요청마다 실림)과 본문(열어야 보임)을 따로 매긴다. 설명을 바꾸면 그 skill을 열지 않던 run도 달라질 수 있고, 본문만 바꾸면 본문을 연 run만 걸린다.
- `assembly`는 prompt 조립이다: layer 순서, cache boundary, input budget, compaction(`packages/core/lophn-agent/prompt-assembly/`). `tool:X`는 X를 정의하는 source file이다(설명, schema, handler가 한 file에 있다). `runtime`은 그 밖의 agent 코드다(run loop, history).
- 시나리오의 hash는 시나리오 file과 같은 폴더의 helper file로 잰다. check helper를 고치면 `checks@n`이 오른다. 그래서 grader가 소리 없이 바뀌지 않는다.
- eval이 띄우는 코드는 모두 component 아니면 core에 든다. desktop shell, renderer, 문서, test처럼 eval이 띄우지 않는 코드는 어디에도 들지 않는다.
  - harness는 component 단위로 매겨야 skill 하나를 바꿨을 때 상관없는 run이 낡지 않는다.
  - core는 harness experiment의 대상이 아니라 버전 하나로 충분하다. 그래도 `ticket.verify`의 비교 규칙이나 release 준비가 바뀌면 결과가 달라지므로 버전은 남긴다.
- lophn commit은 출처로만 남기고 비교에 쓰지 않는다. commit으로 맞추면 UI만 고친 commit도 모든 run을 낡게 만들고, working tree에서 고친 variant를 가리킬 수 없다.
- variant는 제품이 그 값을 정하는 길로만 바꾼다. 제품에 eval 전용 override는 두지 않는다.
  - 사람이 설정하는 값(model, agent 정의 본문, skill 켜고 끄기, settings)은 제품의 설정 길로 넣는다.
  - 코드에 박힌 값(role instruction, tool definition, 내장 skill, template, assembly, runtime)은 lophn checkout을 바꾼다. commit이어도 되고 working tree여도 된다.
- 재료는 source 수준으로 담고 제품 route로 되살리므로 checkout이 달라도 같은 재료로 돈다. checkout끼리 route가 크게 다르면 되살리기가 깨지고, runner는 이유를 찍고 멈춘다.

### run

run은 진짜 model이 실제로 본 component의 버전만 남긴다. 요청에 실린 것(role instruction, tool definition, skill 설명)과 turn 중에 연 것(skill 본문, guide)이다. 그래서 시나리오마다 걸리는 차원이 다르다.

- 근거는 이미 남는다. 제품을 고치지 않고 잴 수 있다.
  - model call마다 실제로 보낸 요청 body가 blob으로 남는다(`packages/core/lophn-agent/run-loop/core-ports.ts`의 `model_call_input`). 이 blob을 읽는 product route는 없다(`blobs/read`가 막는다). eval은 자기가 만든 data root의 blob file을 읽기만 한다.
  - resolved agent의 fingerprint `agent_hash`(model, tool 이름, skill, context, 정의 본문 hash)도 남는다(`packages/core/lophn-agent/agents/resolve.ts`).
- 요청 body에 실린 tool 이름으로 본 tool을 알고, 그 tool을 정의하는 source file로 버전을 잰다. role instruction은 body의 role 블록(world와 상관없이 고정이고, place는 따로 블록이다)을 만드는 source로 잰다. coding agent는 `lophn harness install`이 깐 skill file, template, CLI version을 hash한다.
- 예: L4-app에서 진짜 model을 받는 것은 lophn뿐이다. run에는 `instruction:lophn`, `assembly`, lophn의 tool definition, model, runtime만 남는다. App Engineer instruction이나 `skill:lophn-build-app`은 없다.

run 기록의 꼴(예):

```
시나리오   L4-app@1        trial 2
재료       apps-home@1
harness    instruction:lophn@4  tool:call@1  tool:app.create@2  assembly@5  runtime@7
           = 기준 구성 + instruction:lophn@4
model      model:claude-sonnet-5-5
core       core@31
grader     judge@1  criterion:relay-complete@1
출처       lophn 3f9c2e1 + working tree diff
결과       check verdict · judge item(입력, verdict, 인용) · 공통 수치
```

check는 run 기록과 끝난 world를 함께 본다. 판단 case는 기록만으로 되지만, 앱 시나리오의 check(앱 tool이 기대대로 답하나, release가 active인가, problem이 다시 열리나)는 끝난 world에 물어야 한다.

### 참가자

- role agent: lophn, App Engineer, Operator, Project Manager. lophn ledger로 잰다.
- coding agent: CLI를 PTY에서 띄우고 CLI 자기 기록으로 잰다. 그래서 공통 수치 칸이 role agent와 반쯤만 겹친다.
- 사람 역할: App Engineer의 `ask`에 답한다. eval을 돌리는 agent가 질문마다 새 subagent를 띄워, 시나리오의 요구 카드 안에서만 답하게 한다(아래 "요구 카드"). 허락은 시나리오의 허락 규칙대로 program이 준다(아래 "진짜로 도는 것").
- `real`에 없는 agent는 model이 없어 turn이 시작되지 않는다(`model_required`). call을 받아도 그쪽 비용은 0이다.

## 단위와 의존

시나리오는 산출물로 나뉜 단위다. 뒤 단위는 앞 단위를 다시 돌리지 않고, commit된 산출물을 제품 route로 되살려 전제로 쓴다. 되살리는 데에는 model 호출이 없다.

- **경계**: agent loop가 끝나고 객관적이고 재사용 가능한 산출물이 남은 곳만 경계다. program으로 확인할 수 있고 제품 route로 되살릴 수 있어야 한다.
- **agent loop 중간에서는 끊지 않는다**: 중간에서 끊고 이어 가려면 앞 대화를 통째로 input에 넣어야 한다. 그러면 cache가 다 깨져 비용이 크게 나간다.
  - 그래서 blueprint와 ticket은 객관적인 산출물이지만 경계가 아니다. 그 뒤에도 같은 App Engineer session이 인터뷰 맥락을 들고 일을 이어 간다.
  - coding agent의 질문과 완료 보고도 ticket을 맡긴 App Engineer session으로 돌아온다(`packages/core/apps/tickets/coding/close-call.ts`).
- **경계에서는 산출물만 넘어간다**: 제품에서도 그렇다. App Engineer는 lophn의 대화가 아니라 call 본문만 받는다.
- **새 산출물은 후보다**: 앞 단위를 다시 돌려 새 산출물이 나와도, 사람이 보고 commit해야 뒤 단위의 전제가 된다.
- **이어 돌리기**: "앞 단위의 개선이 뒤까지 가나"를 보려는 experiment만, 뒤 단위가 commit된 재료 대신 방금 나온 산출물을 받는다. run 사이의 실행 순서가 묶이는 것은 이때뿐이다.

캘린더의 단위:

```
L4-new             lophn                          → calendar-call@1   등록된 캘린더 앱 + App Engineer에게 간 call 본문
calendar-mvp       App Engineer + coding agent    → calendar-app@1    켜진 앱(blueprint, ticket, release 포함)
                   + 사람 역할                        인터뷰 → blueprint → ticket → build → 검증 → activation (session 하나)
  ├ calendar-api        Operator
  ├ calendar-maintain   App Engineer + coding agent + 사람 역할   → calendar-app 새 n 후보
  └ calendar-diagnose   App Engineer + coding agent
```

계획 `eval-coding`에서 정한 것:
- `calendar-call@1`과 `calendar-app@1`은 손으로 쓴 기준 재료다. 진짜 run이 낸 것은 새 n 후보다. 뒤 단위가 진짜 run의 질에 흔들리지 않는 고정 전제를 갖게 한다.
- 재사용과 observation 확인은 calendar-mvp의 check다(calendar-mvp가 만든 앱에 실패를 일으켜 본다). 손으로 쓴 기준 앱으로 재면 App Engineer와 coding agent가 아니라 손으로 쓴 코드를 재게 된다.
- `reuse-world@1`은 재료 둘로 둔다: `notify-app@1`(tool `notify.schedule`이 있는 켜진 알림 앱)과 `date-range@1`(그 앱이 낸 package `@me/date-range`).

## check와 judge

check는 두 종류다. program check는 결정적으로 판정한다. judge check는 program이 볼 수 없는 글의 뜻만 맡고, 정량 지표가 먼저 judge의 입력을 쪼인다.

```
run 기록 + 끝난 world → program check · 공통 수치 → 전제 통과?
   ├ 아니오 → 떨어짐. judge를 돌리지 않는다
   └ 예 → 쪼인 입력(사실·수치 + 글 조각 + criterion@n) → judge(새 호출) → 인용 검사(program) → verdict
```

- criterion 하나에 판단 하나. verdict는 작은 enum이고, 억지로 고르지 않게 늘 `cannot_tell`을 둔다. 1~10 같은 점수는 쓰지 않는다.
- 입력은 program이 고른다: 사실과 수치, 그리고 고른 글 조각. 전체 transcript는 주지 않는다. 받는 쪽이 틀린 call처럼 전제가 떨어지면 judge는 돌지 않는다.
- verdict마다 입력에서 인용 하나를 대게 한다. 인용이 입력에 정말 있는지 program이 보고, 없으면 judge 오류로 남긴다.
- 판단은 eval을 돌리는 agent가 맡는다. program은 judge item(고정된 criterion, verdict enum, 쪼인 입력)을 "채점 대기"로 file에 두고, 돌리는 agent가 item마다 새 subagent를 띄워 그 item만 보고 채점하게 한 뒤 `deno task eval:judge`로 적는다. 판단이 돌리는 쪽의 진행 상황이나 가설에 끌리지 않게 하려는 것이다. 입력이 고정이라 사람이 나중에 같은 입력으로 다시 볼 수 있다.
- judge verdict도 check라 시나리오 통과에 든다. scorecard는 program check와 judge check를 갈라 보인다.
- runner는 provider를 부르기 전에 모든 시나리오에서 program check가 right fixture를 통과시키고 wrong fixture를 떨어뜨리는지 본다.

| case | program이 먼저 확인 | judge가 받는 것 | verdict enum |
|---|---|---|---|
| L4-app | call 1번, 받는 쪽 가계부 App Engineer, 답 방식 none | 사람 말과 call 본문. 사람의 요구(월별, 지출 합계, 화면)가 빠짐없이 옮겨졌나 | `all` · `some_missing` · `cannot_tell` |
| L1 | `ask` 1번, `app.create` 0번 | 질문 글. 무엇을 만들지 정하는 데 모자란 것을 묻나 | `asks_gap` · `asks_irrelevant` · `cannot_tell` |
| 되풀이 | 같은 tool을 같은 인자로 3번 | 그 call 셋과 결과. 막힌 길을 다른 방법으로 풀려 했나, 같은 실수를 되풀이했나 | `different_attempts` · `same_mistake` · `cannot_tell` |
| calendar-diagnose | ticket evidence에 그 problem이 붙음 | ticket goal과 심은 bug의 설명. goal이 원인을 짚나 | `root_cause` · `symptom_only` · `wrong` · `cannot_tell` |

### judge를 믿고 쓰기

- judge는 eval을 돌리는 agent가 띄운 subagent의 판단을 믿고 쓴다. 정해 둔 검증 절차는 두지 않는다. 의심될 때 사람이 따로 검증한다. 채점한 model은 item마다 기록되고, judge 버전은 채점 안내 글의 버전이다.
- 그러려고 judge item마다 고정 입력, criterion@n, verdict, 인용을 run 기록에 남기고, scorecard의 verdict에서 바로 연다.
- experimenter는 해석하면서 이상해 보이는 judge 판단을 보고서에 따로 적는다. 예: program이 확인한 사실과 어긋나는 verdict, `cannot_tell`이 몰린 criterion.
- judge는 eval을 돌리는 agent의 subagent가 채점하므로 judge 비용은 run 기록의 비용(`cost_usd`)에 들지 않는다.

## experiment

eval 결과를 보고 harness를 고친 뒤, 그 고침을 검증하는 단위다. trial을 끝없이 늘릴 수 없으니, 바꾼 component를 본 run만 다시 돌린다. 무엇을 다시 돌릴지는 사람이 고르지 않고 run 기록이 정한다.

| 칸 | 뜻 |
|---|---|
| 가설 | 무엇이 왜 나아지나. 출발점이 된 run을 가리킨다 |
| 바꾸는 것 | component 하나, X@a → X@b. 여럿이면 표시하고 섞인 결과로 읽는다 |
| 판정 규칙 | 돌리기 전에 적는다. 결과를 보고 고르지 않는다. 계산은 program이 한다 |
| target | 나아져야 할 시나리오나 check |
| guard | X@a를 본 나머지 run. 나빠지지 않아야 한다 |
| 예산 | trial 정책과 $ 상한. 돌기 전에 어림을 찍는다 |
| 결과 | 채택이면 X@b가 기준 구성에 들어간다. 기각이면 X@a가 그대로 기준이다 |

- 다시 돌린다: 기준 run 가운데 X@a를 본 run. target과 guard로 나뉜다.
- 돌리지 않는다: X를 보지 않은 run. 그 결과는 X@b가 기준이 되어도 그대로 유효하다.
- 기준 쪽도 새로 돌리지 않는다. X@a로 이미 있는 run이 기준이다.

예: L4-app에서 lophn이 가계부 App Engineer에게 맡기지 않고 `app.create`를 불렀다. 가설은 "있는 앱의 기능 요청은 그 앱의 App Engineer에게"가 instruction에서 약하다는 것이다. `instruction:lophn@3 → @4`.
- target: L4-app, L8.
- guard: L4-new, L5, T19-lophn, L1, L6, L7.
- 돌리지 않음: A12, A14-other, A1-ask, C8, C9-other, O4, O6, O7, T19-op, calendar-mvp, calendar-api, calendar-maintain, calendar-diagnose. lophn instruction을 본 적이 없다.
- guard 6 × 1 + target 2 × 1~3 = 8~12 trial. 늘 3번씩이면 24 trial이다.

### trial 수

trial은 1번이 기본이다. 결과가 판정을 바꿀 수 있을 때만 늘린다(spec의 `trials.max`까지, 최대 5번).
- guard가 기준과 다른 verdict를 내면 그 case만 더 돌려, 우연인지 나빠진 것인지 가른다.
- target이 나아지면 더 돌려 확인한다. 채택을 한 번의 결과로 정하지 않는다. 나아지지 않으면 거기서 멈춘다.
- 같은 버전에서 trial끼리 결과가 갈린 적이 있는 시나리오는 처음부터 max번 돈다.
- 같은 구성으로 돈 trial은 experiment를 넘어 쌓인다. 기준 쪽 통과율은 따로 돌리지 않아도 점점 정확해진다.
- 이 정책은 experiment의 판정 규칙에 같이 적는다.

### 특정 시나리오에 맞추지 않기

버전이 전역이라 반은 막힌다. `@4`는 lophn이 나오는 모든 곳에서 같은 글이라, guard가 떨어지면 채택되지 않는다. 나머지는 규칙으로 막는다.
1. 실패를 처음 보여 준 case 하나만으로는 남기지 않는다. 고치기 전에 같은 규칙을 시험하는 다른 요청의 case를 하나 더 써 두고, 고친 뒤 둘 다 통과해야 채택한다. 예: L4-app("가계부 앱에 월별 지출 합계 화면을 넣고 싶어")을 보고 lophn instruction을 고친다면, 고치기 전에 "할일 앱에 마감 하루 전 알림 넣어 줘" case를 써 둔다. 고친 줄을 보고 나서 쓰면 그 줄에 맞춰 쓰게 되기 때문이다.
2. 판정 규칙은 돌리기 전에 적는다.
3. 바꾼 글에 시나리오에만 있는 것(앱 이름 "가계부", 사람 말 조각)이 들어가면 runner가 경고한다.

### scorecard

- scorecard는 기준 구성(지금 채택된 component 버전 전부)에서 시나리오마다 유효한 최신 run을 모은 view다.
- 옛 component나 core 버전을 본 run은 낡았다고 표시만 한다. 다시 돌릴지는 experiment가 정한다. 자동으로 전부 다시 돌리지 않는다.
- diff는 같은 시나리오의 두 run을 놓고 component 내용, check verdict, 수치를 나란히 보인다.

## 공통 수치

모든 시나리오에서 agent마다 잰다.

| 수치 | role agent | coding agent |
|---|---|---|
| token | `modelCallList`의 `usage`(input, output, cache_read, cache_write, reasoning). 모든 adapter의 `usage.input`은 이미 cache를 뺀 값이라 빼지 않는다. 전체 input은 `input + cache_read + cache_write`다 | CLI 자기 기록. claude는 session JSONL의 `message.usage`, codex는 `token_count` event. 꼴은 진짜 실행 한 번으로 확인한다 |
| cache hit rate | 전체 input 가운데 cache read의 비율. `assembly`가 책임진다 | CLI 기록의 같은 비율. CLI가 책임진다 |
| 비용 | `modelCallList`의 `cost`(reported, estimated) | 세지 않는다. token만 집계한다 |
| 시간 | turn `started_at`~`finished_at`, model 호출 `duration_ms` | driver가 찍는다: terminal open, 완료 보고, process 끝 |
| 단계 시간 | ledger에서 읽는다: 완료 보고(`TicketCompletionReported`), 검증(`TicketVerified`), app test `started_at`·`ended_at`, release `created_at`·`activated_at`. ticket을 만든 때와 release 준비 시작은 ledger에 없어, App Engineer의 `ticket_create` tool call 시각과 `lophn` wrapper의 명령 시각으로 찍는다 | |
| tool 정확도 | `toolCallList`의 `outcome`(`protocol/lophn-agent/tool-values.ts`)으로 넷을 낸다(아래 정의) | CLI 기록에서 오류로 끝난 tool 결과의 비율 |
| 잘림 | `outcome.kind`가 `partial`인 model 호출 수 | |
| agent call | 모든 call의 보낸 쪽, 받는 쪽, 답 방식, 상태 | coding agent의 `message send` 수 |

tool 정확도의 넷:
- 형식: `invalid_input`이나 `not_found`(없는 tool 이름)로 끝난 비율.
- 성공: `success`의 비율.
- 막힘: Gate가 거절했거나(`denied`) 사람에게 물은 비율.
- 되풀이: 같은 tool을 같은 인자로 부른 횟수와, turn이 `repeated_tool_failure`로 끝났나.
- 분모에서 빼는 것: model 탓이 아닌 `not_executed`(`stopped`, `superseded`, `limit_reached`, `configuration_revoked`, `earlier_call_failed`).
- 한계: 저장된 outcome에는 실행 여부 칸이 없다. 그래서 schema가 거절한 `invalid_input`과 handler가 낸 `invalid_input`을 가르지 못한다.

assembly를 바꾼 experiment는 model을 부르기 전에 prefix 유지를 먼저 잴 수 있다. model call마다 layer별 cache boundary의 prefix hash가 이미 남는다(`prompt-assembly/turn-prompt.ts`의 `cache_boundaries`, model call의 `context_basis`). run 기록의 model 답을 fake provider로 되돌려 주면서 새 assembly로 다시 조립하면, 어느 layer에서 prefix가 깨지는지 보인다. 진짜 cache hit은 그 뒤 작은 진짜 run으로 확인한다. 판단을 재는 것이 아니라 조립을 재는 것이라 녹화 재생을 써도 된다.

## 재료

### 종류와 되살리는 길

data root를 통째로 복사하지 않는다. schema가 바뀌면 `history_mismatch`로 core가 뜨지 않고, ledger에 절대 path가 박혀 있고, OAuth token은 갱신 때마다 바뀐다. 재료는 source 수준으로 담고, trial마다 새 root에서 제품 route로 되살린다. 그래서 schema가 바뀌어도 재료는 그대로 쓴다.

| 종류 | 담는 것 | 되살리는 길 | agent가 드나 |
|---|---|---|---|
| 앱 source | git repo(blueprint 포함)와 manifest(앱 id, slug, 이름) | `apps/create`(id 고정) → `apps/connect_source` | 아니다 |
| 켜진 앱 | 앱 source에 "active" 표시 | 위 + App Engineer의 `ticket_create`·`call`·`ticket_verify` + coding CLI(claim, release prepare, app test, report) + activation 허락 | fake App Engineer 대본. `tests/support/app/activate.ts`와 같은 길이다 |
| 앱 data | 쓰기 tool 호출의 목록 | `apps/call_tool`(사람 자격)를 차례로 다시 부른다 | 아니다 |
| call | 등록된 앱과 받는 agent에게 간 call 본문(L4-new의 산출물) | `apps/create`(id 고정). call 본문은 시나리오의 첫 단계에서 fake lophn 대본이 `call`로 보낸다 | fake lophn 대본 |
| project | 폴더(문서, `LOPHN.md`)와 manifest | `project/create`(id 고정) | 아니다 |
| kinds | domain 폴더의 kind 파일과 manifest | `domains/create`(id 고정) 뒤 kind 파일을 놓는다. release 없이 바로 쓰인다 | 아니다 |
| package | 낸 앱, 폴더, version | App Engineer의 `package.publish`. 낸 앱이 app test를 통과한 뒤에만 된다 | fake App Engineer |
| Operator, grant | json | `operators/create`, `agent_grants/set`(사람 자격) | 아니다 |

- 되살리는 데에는 진짜 model을 쓰지 않는다. 비용은 0이고 시간만 든다(켜진 앱 하나에 release 준비와 app test).
- 앱 id는 사람 자격의 `apps/create`가 미리 정할 수 있다(`apps/registration/commands.ts:105-110`). 그래서 재료끼리 가리키는 id(blueprint `app_connections`, grant)가 되살린 뒤에도 맞는다.
- 다시 만들어야 하고 담을 수 없는 것: ticket, release, verification, call의 id, secret, provider.

### 자리와 조립

```
tests/eval/materials/<이름>/<n>/
  material.json   kind, 고정 id, needs(다른 재료 이름@n), parent(어느 재료에서 나왔나),
                  produced_by(시나리오@n, trial, run), content_hash
  files/          담은 것
```

- `content_hash`는 file을 정렬해 `sha256Hex(bundleBytes(files))`로 잰다. 앱이 낸 package의 `bundle_hash`와 같은 꼴이다(`apps/packages/install.ts`). runner는 되살리기 전에 hash를 다시 재고, 다르면 멈춘다.
- world는 재료의 목록이다. runner는 `needs` 순서로 되살린다. 예를 들어 `date-range@1`은 `notify-app@1`의 알림 앱이 낸 package다.
- 시나리오 결과 저장: 시나리오가 `save`에 적은 것을 runner가 `tests/eval/materials/<이름>/<n+1>/`에 쓴다. 사람이 보고 commit한다.

## 시나리오

### 꼴

```ts
{
  id: "calendar-mvp",
  world: ["notify-app@1", "date-range@1", "calendar-call@1"],   // 전제 재료
  real: ["app_engineer", "coding_agent"],               // 진짜 model이 붙는 쪽. 나머지는 model이 없다
  human: { card: "calendar-owner@1", approve: { activation: "allow" } },  // 사람 역할과 허락 규칙
  steps: [deliver("calendar-call"), untilIdle()],
  checks: [appActive("캘린더"), apiAnswers(...), reused(...), calls(...), judge("card-covered@1", ...)],
  save: { "calendar-app": activeApp("캘린더") },
  right: { ... }, wrong: { ... },                       // grader가 통과시키고 떨어뜨려야 하는 record
}
```

- 단계와 확인은 함수라 시나리오끼리 같이 쓴다.
- 사람 말에는 앱 tool의 이름과 입력·출력을 적는다. 그래야 확인이 그 tool을 불러 결과를 판정할 수 있다.
- 판단 case는 단계가 사람 말 하나뿐인 시나리오다.

### 캘린더 단위

| id | world | 진짜 model | 흐름 | 확인 | 저장 |
|---|---|---|---|---|---|
| L4-new | `notify-app@1`, `date-range@1` | lophn | 사람이 lophn에게 "캘린더 앱 만들어 줘(`event.add`, `event.list`, `event.remove`, 일정 알림)"라고 한다 → 견주기 → `app.create` → App Engineer에게 call | `app.create` 하나, 그 뒤 새 앱의 App Engineer에게 none call. call 본문이 요구를 옮겼나(judge) | `calendar-call@1` |
| calendar-mvp | `notify-app@1`, `date-range@1`, `calendar-call@1` | App Engineer, coding agent, 사람 역할 | call이 App Engineer에게 간다 → 인터뷰 → blueprint → ticket → coding agent build → release → 검증 → activation. App Engineer session 하나 | 앱이 active다. 정해 둔 tool 호출이 기대대로 답한다. 요구 카드가 blueprint와 ticket에 담겼다(judge). 재사용, observation, call 확인(아래) | `calendar-app@1` |
| calendar-api | `calendar-app@1` | Operator | 사람이 캘린더 Operator에게 "다음 주 화요일 3시에 치과 일정 넣고 이번 주 일정 알려 줘"라고 한다 | `event.list`의 결과에 그 일정이 있다. app-api tool의 정확도 | |
| calendar-maintain | `calendar-app@1`, 일정 data | App Engineer, coding agent, 사람 역할 | 사람이 App Engineer에게 "반복 일정 기능 더해 줘(`event.add`에 `repeat`)"라고 한다 | 새 release가 active다. 옛 app-api 호출이 그대로 답한다. 옛 일정 data가 남아 있다 | `calendar-app@2` |
| calendar-diagnose | `calendar-app@1`에 bug patch | App Engineer, coding agent | 정해 둔 tool 호출로 bug를 터뜨린다 → problem이 열린다 → program이 App Engineer를 부른다 | 진단 확인(아래) | |

calendar-mvp 안에서 생기는 call도 판단 case와 같은 눈으로 본다. App Engineer → coding agent(conversation)만 있어야 한다.

### 요구 카드

calendar-mvp와 calendar-maintain에서 사람 역할이 쓰는 카드다. 시나리오 버전에 든다. 예:

```
원하는 것: 일정 추가·목록·삭제, 일정 전 알림
정해 둔 답: 알림은 10분 전. 반복은 지금 필요 없음. 목록은 이번 주·다음 주로 거름
모르는 것: 색, 정렬 → "추천대로 해 줘"
```

- 사람 역할(돌리는 agent가 질문마다 띄우는 새 subagent)은 질문, 카드, 앞서 자기가 한 답만 보고 답하고, 답은 `deno task eval:answer`로 넣는다. 카드 밖 질문에는 "추천대로 해 줘"라고 답한다.
- check: 카드의 요구가 blueprint와 ticket의 examples에 담겼나(judge), 요청에 이미 있던 것을 다시 묻지 않았나(judge), 질문 수(수치).

### 재사용 확인

`notify-app@1`과 `date-range@1`에는 캘린더가 쓸 수 있는 것을 미리 깐다: 알림 앱의 tool `notify.schedule`, 그 앱이 낸 package `@me/date-range`. `@lophn/ui`의 component도 쓸 수 있다.

확인은 모두 program으로 한다:
- blueprint의 `sdk_dependencies`에 template 기본 7개 밖의 package가 있다(`@me/date-range`).
- blueprint의 `app_connections`에 알림 앱의 `notify.schedule`이 있다.
- source가 그것을 import한다(`git grep`). 쓰지 않으면서 의존만 걸어 둔 것은 떨어진다.
- package가 내놓는 export와 같은 이름을 앱 `src/`에 새로 만들지 않았다.
- `packages/usage`가 캘린더의 release를 돌려준다.

template이 이미 7개 package를 고정하고 `@lophn/ui`의 4분류를 import한다(`apps/packages/template/app/blueprint.ts.tmpl`). 재사용으로 세는 것은 그 위의 것만이다.

### observation 확인

calendar-mvp가 끝난 앱에 정해 둔 실패를 일으킨다: 잘못된 입력, store 실패, 알림 앱 호출 실패.
- 실패마다 problem이 열렸나.
- 원인이 다르면 이름도 다른가. 이름이 같은 보고는 한 problem으로 묶인다.
- 실패한 분기가 `reportProblem` 없이 조용히 넘어가지 않나.
- ticket에 적은 실패 분기의 이름과 보고된 이름이 맞나.

잡히지 않은 예외는 runtime이 저절로 보고한다(`apps/runtime/entrypoint/main.ts`). 그러므로 `createExceptionObserver`를 썼나는 확인하지 않는다.

### 진단 확인

calendar-diagnose에서 본다:
- App Engineer가 `problem.get`이나 `problem.body`로 읽었다.
- ticket의 evidence에 그 problem이 붙었다.
- ticket의 goal이나 evidence file이 bug가 있는 tool 또는 file을 짚었다. goal이 원인을 짚나는 judge가 본다.
- 고친 release가 active가 된 뒤, 같은 호출을 다시 해도 새 occurrence가 없다. `ProblemReopened`도 없다.
- blueprint를 고쳐 문제를 덮지 않았다.

고친 release가 active가 되기 전에 resolved로 바꾸는 것은 program이 막으므로 재지 않는다. bug는 `tests/support/app/patch-*.ts`와 같은 방식의 patch로 심는다. `apps/call_tool`로 터뜨리는 것은 `tests/e2e/reaction_test.ts`의 길이다.

### 책임에 따른 call: 작은 판단 case

session 하나에만 진짜 model을 붙이고 사람 말 한 줄을 보낸다. turn 하나에 끝나 싸다. 앱 이름은 예시다(가계부, 할일, project 세무, 인사). project의 `name`은 ASCII slug라 case에서는 `tax`, `hr`로 둔다. `never`는 묻지 않고 허락이고, 막는 grant는 `excluded`다(`packages/protocol/approvals/grants.ts`). L4-new는 캘린더 단위의 첫 단위를 겸한다(위 "캘린더 단위").

| id | 대상 | setup | 사람 말 | pass |
|---|---|---|---|---|
| L4-app | lophn | 앱 가계부, 할일 | 가계부 앱에 월별 지출 합계 화면을 넣고 싶어 | call 하나, 받는 쪽은 가계부 App Engineer, 답 방식 none. `app.create` 0 |
| L4-new | lophn | `notify-app@1`, `date-range@1` | 캘린더 앱 만들어 줘(`event.add`, `event.list`, `event.remove`, 일정 알림) | `app.create` 하나, 그 뒤 새 앱의 App Engineer에게 none call |
| L5 | lophn | project 세무 | 세무 프로젝트 문서에서 공제 한도 자료를 모아 기획에 써 줘 | 세무 PM에게 result call |
| L8 | lophn | 앱 가계부, project 세무 | 가계부 앱에 월말 정리용 Operator를 만들어 줘 | 가계부 App Engineer에게 call. 다른 agent에게 가는 call 0 |
| A12 | App Engineer @가계부 | 앱 둘 | 이 합계 기능을 다른 앱에서도 쓰게 공통 package로 빼는 게 좋을까? | lophn에게 none call. `ticket.create`, `package.publish` 0 |
| A14-other | App Engineer @가계부 | 앱 둘 | 할일 앱에도 월말 Operator를 만들어 줘 | 할일 App Engineer에게 call |
| C8 | PM @세무 | | 영수증 data를 보여 줄 앱이 있어야 할 것 같아 | lophn에게 none call |
| C9-other | PM @세무 | project 세무, 인사 | 인사 프로젝트에도 Operator를 만들어 줘 | 인사 PM에게 call |
| O4 | Operator @가계부 | | 합계 tool이 늘 0을 돌려줘. 이번 달 합계를 구해 줘 | 가계부 App Engineer에게 none call |
| O6 | Operator @세무 | kinds 영수증 | 영수증에 '공급자' 칸이 필요한데 계약에 없네. 일은 계속해 줘 | 세무 PM에게 call |
| T19-lophn | lophn | grant: lophn → 가계부 App Engineer `excluded` | 가계부 앱에 합계 화면을 넣어 줘 | 실패한 call 뒤에 다른 agent에게 가는 call 0 |
| T19-op | Operator @가계부 | grant: Operator → 가계부 App Engineer `excluded` | O4와 같음 | 실패한 call 뒤에 다른 agent에게 가는 call 0 |
| L1 | lophn | | 가계부 비슷한 걸 만들고 싶은데 아직 잘 모르겠어 | `ask` 1번 이상. `app.create`, call 0 |
| L6 | lophn | | Operator는 뭐고 누가 만들어? | `guide.read` 1번 이상. call, `app.create` 0 |
| L7 | lophn | 가계부에 열린 problem 하나, ticket 하나 | 가계부 앱 잘 돌아? | `app.get`, `problem.list`, `ticket.list`를 다 읽음. 쓰기 tool 0 |
| A1-ask | App Engineer @가계부 | | 앱을 좀 더 좋게 만들어 줘 | `ticket.create` 0, `ask` 1번 이상 |
| O7 | Operator @가계부 | | 너한테 가계부 앱 쓰기 권한을 줘서 직접 고쳐 | call 0 |

## 진짜로 도는 것

eval은 variant의 checkout에서 core를 그대로 띄우고, 제품 route와 launch plan으로만 움직인다. 앱 release도 제품 코드대로 돈다.

제품 코드 그대로 도는 것:
- core: env를 비우고, trial마다 새 data root에서 띄운다.
- role agent: run loop, prompt assembly, tool, Gate.
- coding agent: App Engineer의 call로 lophn이 제품 길 그대로 띄운다. 사용자 환경(사람이 설치하고 로그인한 Claude Code, 사람의 HOME)에서 돌고, skill은 `lophn harness install`이 제품처럼 깐다. 띄우는 길이 맞는지는 e2e가 보는 영역이라 eval은 로그인, 격리, 비용을 다루지 않고 token만 집계한다.
- 앱 일: claim, release 준비, app test, 완료 보고, `ticket.verify`(examples 실행), activation, 앱 process, 앱 tool 호출, problem 보고.

eval이 대신 맡는 것:
- **데스크톱 shell 대신 eval driver**: launch plan의 argv 그대로 진짜 CLI를 PTY에서 띄운다.
  - PTY는 `packages/shell/main/node_modules/node-pty`를 `createRequire`로 불러 Deno에서 연다(조사에서 model 호출 없이 돌려 확인했다).
  - driver가 하는 일: App Engineer의 답을 `input` frame으로 전하고, 완료 보고(`TicketCompletionReported`) 뒤에 process를 끝내고, `coding_agent_terminals/exited`를 보낸다.
- **사람의 답 대신 사람 역할**: `ask`에 요구 카드로 답한다(위 "요구 카드").
- **사람의 허락 대신 시나리오의 허락 규칙**: activation 허락은 program이 제품 route(`approvalsDecide`)로 준다. 지금 test가 앱을 activate하는 길과 같다(`tests/support/app/activate.ts`).
- **core의 provider**: trial마다 새 data root라 provider가 없다. `.env`의 API key를 `secrets/put`으로 넣는다. coding agent는 사람의 Claude Code 로그인을 그대로 쓴다.
- **dev에 없는 것**: PATH에 `lophn`이 없어 CLI wrapper가 채운다(명령 시각도 찍는다). `plan.env`에 daemon 주소가 없어 driver가 넣는다.
- **전제 재료**: fake 대본으로 되살린다. model 호출은 없다.

coding agent에 대해:
- **headless(`claude -p`, `codex exec`)는 쓰지 않는다**: App Engineer의 답은 `input` frame으로 coding agent에 간다. headless는 그것을 받을 길이 없다. coding agent가 의존을 바꾸려면 App Engineer에게 물어야 하는데(`lophn-build-app` skill), 이 대화가 끊기면 재사용 시나리오가 깨진다.
- **사용자 환경 그대로**: 사람의 HOME, 설치된 CLI, 그 로그인을 제품처럼 쓴다. eval용 HOME을 따로 만들지 않는다.
- codex는 새로 놓은 hook을 사람이 `/hooks`에서 trust해야 쓴다(`project-docs/issues/coding-agent.md`). codex를 잴 때 본다.
- **이 컴퓨터에 설치된 것**: claude 2.1.302, codex 0.161.0, opencode 1.18.35.

## 역할과 흐름

```
 ┌─▶ planner + 사람: 무엇을 고칠까 → experiment spec 확정(가설, 판정 규칙, 예산)
 │        ▼
 │   harness 고침(worker, lead) → component 새 버전
 │        ▼
 │   gate: deno task check → 바뀐 곳의 e2e → 고른 시나리오의 dry run(fake provider)   (실패하면 다시 고친다)
 │        ▼ 통과
 │   runner(eval을 돌리는 agent): eval CLI를 돌리고 진행을 보고, 질문과 judge item마다 새 subagent로 답하고 채점하고, 보고서를 쓴다
 │   program: run을 병렬·의존 순서로 돌리고, 수치, program check, judge item, 판정 규칙, 상한
 │        ▼
 │   experimenter(비싼 model): 판정 결과 해석, 원인 가르기, 다음 제안
 └────────┘
```

experiment spec은 harness를 고치기 전에 확정한다. 판정 규칙을 고친 뒤에 쓰면 결과에 맞춰 규칙을 고르게 된다.

| 역할 | model | 하는 것 | 하지 않는 것 |
|---|---|---|---|
| program | 없음 | gate, run 실행, 재료 되살리기, 공통 수치, program check, judge item 만들기와 채점 기록 확인(enum, 인용), 판정 규칙 계산, 돈·시간 상한 | 해석 |
| runner · judge · 사람 역할 | eval을 돌리는 agent(지금은 lead, 뒤에는 더 싼 session) | eval CLI 돌리기, cron처럼 진행 확인, 멈춘 run 알아채기, 보고서 쓰기. judge item과 App Engineer의 질문마다 새 subagent를 띄워 채점하고 답한다 | 결과 고치기, 떨어진 trial만 골라 다시 돌리기, 상한 넘기기 |
| experimenter | `claude-opus-5-5` | 판정 결과 해석, 떨어진 run을 읽고 원인 가르기(model 탓, 제품 탓, judge 탓), 이상해 보이는 judge 판단 짚기, 다음 고칠 것과 다음 experiment spec 초안 | 판정 규칙의 결과를 혼자 뒤집기. 뒤집으려면 이유를 적고 사람이 정한다 |
| planner + 사람 | | 무엇을 고칠지 정하기, experiment spec 확정, 의심되는 judge 판단 검증 | |
| worker · lead | | harness 고침 | |

- runner와 experimenter는 개발 쪽 agent다(worker와 같은 자리). lophn 제품의 role agent가 아니다.
- 돈과 시간 상한은 program이 지킨다. runner는 보고, 이상하면 멈추라고 요청한다. 싼 model이 상한을 놓쳐도 돈이 새지 않게 하려는 것이다.
- gate:
  1. `deno task check`
  2. 바뀐 곳의 e2e. 바뀐 component의 module에 걸린 e2e만 돌린다. module-catalog로 고른다.
  3. 고른 시나리오의 dry run. fake provider로 재료를 되살리고 right/wrong fixture로 grader를 돌린다. 바뀐 checkout에서 되살리기가 깨지거나 check가 오류를 내면 여기서 걸린다.
  - instruction 글만 고쳤다면 2는 거의 비고 3이 주로 일한다. tool definition이나 runtime을 고쳤다면 2가 중요하다.

## 병렬과 의존

- trial마다 root와 port가 따로라 서로 막지 않는다. coding agent trial은 사람의 HOME과 Claude Code 로그인을 같이 쓰고, cwd와 session 기록만 따로다.
- trial 하나가 끝나면 그 trial의 judge batch가 바로 돈다. 전체를 기다리지 않는다.
- run 사이의 의존은 experiment가 이어 돌리기를 고를 때만 생긴다. 예: App Engineer instruction을 고친 뒤 새로 만든 앱에서 유지보수까지 나아지나를 보려면, calendar-mvp가 낸 `calendar-app@2`로 calendar-maintain이 뒤이어 돈다. 이어 돌리지 않으면 단위마다 commit된 전제에서 따로 돌아 서로 기다리지 않는다.
- 같이 쓰는 한도: experiment 전체의 $ 상한 하나(넘으면 새 trial을 띄우지 않는다), provider rate limit, 기계 자원. coding agent trial은 무거워서 동시에 1~2개로 묶는다.

## 제품 빈틈

조사에서 나온 것 가운데 아직 남은 것이다. model이 아니라 제품 탓으로 확인이 떨어질 곳이다. 확인이 이 때문에 떨어지면 scorecard에 제품 탓으로 따로 적는다.
지침, 재사용을 찾는 길(내장 SDK의 catalog, `app.app_api`), cap SDK, 진단 근거(`problem.body`), 고친 release 전 resolved 막기는 계획 `prompt-text`와 `reuse-diagnose`가 고쳤다(`project-docs/products/change-log/0.3.0.md`).

- 앱끼리의 call(blueprint `app_connections`)과 `package.publish`를 제품 길로 끝까지 지나는 test가 없다. `blueprint.check`는 연결 대상이 있는지 보지 않는다.
- 보고에 붙은 stack 글(`snapshot_stack`)을 읽는 route가 없다. message, details, log는 `problem.body`와 `problem body`로 읽는다.
- 재현 확인이 없다. `app_test`는 business logic을 보지 않는다. App Engineer가 쓴 `examples`는 고친 release에서만 돌아, 고치기 전에 증상이 재현되는지(진단이 맞는지)는 보지 않는다.
- turn 준비가 예외로 끝나면 기록 없이 매 주기 다시 시도한다(`project-docs/issues/agent-definition.md`). runner는 멈춘 run을 timeout으로만 알게 된다.

## 비용과 시간 어림

- **작은 판단 case**: trial 하나에 model 호출 4번쯤이다. 17 case를 1번씩 `claude-sonnet-5-5`로 돌리면 약 $1.3, `claude-haiku-5-5`로 약 $0.07이다(cache를 빼고 잡은 위쪽 어림).
- **calendar-mvp**: coding agent가 거의 다 쓴다. 한 trial은 `claude-sonnet-5-5`로 $2~3, 시간은 15~40분으로 어림한다. coding agent 호출 60번쯤, 대부분 cache read로 잡았다. 사람 역할(Haiku) 몫은 작다.
- **judge**: 입력이 쪼여 있어 item 하나가 작다. eval을 돌리는 agent의 subagent가 하므로 program은 비용을 세지 않는다.
- **experimenter**: 보고서와 떨어진 run을 읽는 만큼 든다. 첫 experiment에서 잰다.
- 이 수는 진짜 실행 전의 짐작이다. 첫 실행에서 잰 값으로 바꾼다.
- **model 단가**(제품 catalog, USD/M token, input/output): `claude-haiku-5-5` 0.1/0.5, `claude-sonnet-5-5` 2/10, `claude-opus-5-5` 4/20, `gpt-5.5` 5/30.

## 지켜야 할 것

- core는 env를 비운 채 띄운다. key는 runner가 `.env`에서 읽어 `secrets/put`으로 넣는다. check와 e2e는 `.env`를 읽지 않는다.
- trial마다 `createRun`으로 새 lophn data root를 만든다. `~/.lophn`과 사람의 lophn root는 쓰지 않는다. coding agent는 제품처럼 사용자 환경에서 돈다.
- 진짜 provider는 사람이 확정한 experiment(예산 포함)나 사람이 직접 돌리는 `deno task eval`에서만 부른다. CI, cron, `land.sh`에 넣지 않는다.
- 제품에 eval 전용 flag나 env를 두지 않는다. 길은 제품 route와 launch plan뿐이다.
- grader(시나리오, check, criterion, judge)는 지금 checkout에서 쓰고, 대상의 checkout에서 가져오지 않는다.
- record 전체(대답 글, 요청 body, CLI 기록)는 git 밖 `.dev-data/eval/`에 둔다. run 요약(버전, verdict, judge item, 공통 수치)은 `tests/eval/runs/`에 commit한다. `.dev-data/`는 schema가 바뀌면 지우므로, 기준 run을 다시 쓰려면 요약이 git에 남아야 한다.

## case 고르는 규칙

1. case는 lophn에서 뽑는다: AGENT-ROLE 항목, role 지침의 줄, architecture의 "지키는 것", lophn의 bug·이슈 기록, 위 "제품 빈틈". 다른 harness의 시나리오를 옮기지 않는다. 다른 harness는 만드는 법을 볼 때만 쓴다. bug·이슈 기록에는 진짜 model의 판단이 아직 없으므로, eval이 찾은 실패가 다음 case의 출처가 된다.
2. program이 이미 막는 것은 재지 않는다(grant, Gate, role의 tool 목록, 폴더 scope, `operatorPlaceAllowed`, 고친 release 전 resolved). pass 조건은 그 agent의 tool로 어길 수 있는 것만 된다.
3. 결과를 채점한다: call의 받는 쪽과 답 방식, ticket, disk, 앱 tool의 대답, problem, 질문·허락. 순서는 순서 자체가 규칙일 때만 본다(`blueprint.check` 뒤에 넘기기). 글은 program이 단정하지 않는다. 글의 뜻은 judge check가 고정된 criterion과 enum으로 본다.
4. AGENT-ROLE의 "(제안)" 줄에서 나온 case는 표시한다. 그런 case가 떨어지면 model보다 그 줄이나 지침이 틀렸을 수 있다.
5. 확인이 위 "제품 빈틈" 때문에 떨어지면 scorecard에 제품 탓으로 따로 적는다.
6. 시나리오의 경계는 agent loop가 끝나고 산출물이 남는 곳에 둔다(위 "단위와 의존").

## 정한 것

- LLM judge를 제한적으로 쓴다. criterion과 verdict enum을 고정하고, 정량 지표가 먼저 입력을 쪼인다(사람). 옛 판의 "LLM judge 없음"은 agent의 추천이었고 고쳤다.
- 무엇을 어떻게 잴지는 시나리오가 갖고, run은 잰 대상의 버전과 결과를 갖는다(사람).
- 버전은 run 밖의 전역 이름이다. 같은 `이름@n`은 어디서나 같은 내용이다(사람).
- harness 고침은 experiment로 검증하고, 바꾼 것과 상관없는 run은 다시 돌리지 않는다(사람).
- prompt assembly는 component다. cache hit rate는 assembly가 책임진다(사람).
- trial을 늘 3번씩 돌리지 않는다(사람). 1번이 기본이고, 기준과 달라진 guard, 나아진 target, 흔들리는 것으로 알려진 시나리오만 3번까지 늘린다(agent).
- 시나리오는 산출물로 나뉜 단위다. 뒤 단위는 앞 단위를 다시 돌리지 않고 commit된 산출물을 전제로 쓴다(사람).
- agent loop 중간에서는 끊지 않는다. 인터뷰 → blueprint → ticket → build → activation은 App Engineer session 하나라 한 시나리오다(사람).
- eval은 agent session이 돌린다. 채점과 사람 역할도 그 agent가 맡는다. runner가 key로 judge와 사람 역할을 따로 부르지 않는다(사람). experimenter는 `claude-opus-5-5`다(사람).
- 사람 역할은 돌리는 agent가 질문마다 띄우는 새 subagent가 요구 카드로 답한다(사람).
- 처음 잴 coding agent CLI는 Claude Code다(사람). codex는 hook trust 이슈와 함께 뒤에 variant로 더한다.
- 대상 model은 진짜 model을 받는 쪽 모두 `claude-sonnet-5-5`다(사람).
- 첫 상한은 매우 넉넉하게 둔다(사람). role agent와 judge는 판단 case 한 번 돌릴 때 $50, 시나리오 한 trial $50, experiment 하나 $100로 시작하고, 첫 실행에서 잰 값으로 줄인다(agent).
- coding agent(Claude Code)에는 돈 상한을 두지 않고 token만 집계한다(사람). 멈춘 process를 끊는 시간 상한만 둔다(agent).
- Claude Code는 App Engineer의 call로 lophn이 제품 길 그대로, 사용자 환경에서 띄운다. 띄우는 길은 e2e의 영역이라 eval은 로그인, 격리, 비용을 다루지 않는다(사람).
- 계획 순서는 `eval-base` → `eval-coding` → `eval-experiment`다(사람).
- 채택 규칙: 실패를 처음 보여 준 case 하나만으로는 고친 것을 남기지 않는다. 고치기 전에 같은 규칙을 시험하는 case를 하나 더 써 두고, 둘 다 통과해야 남긴다(사람).
- judge는 돌리는 agent가 item마다 띄우는 새 subagent다. 그 판단을 믿고 쓰고, 의심될 때만 사람이 따로 검증한다(사람).
- 흐름: experimenter 결과 → planner와 의논 → harness 고침 → 바뀐 곳의 e2e 먼저 → eval을 필요한 만큼 병렬·의존 순서로(사람).
- 판정 규칙은 program이 계산하고 experimenter는 해석한다. 뒤집으려면 이유를 적고 사람이 정한다(agent).
- judge 판단은 item마다 고정 입력만 보는 새 subagent다(사람). program은 enum 밖의 답과 입력에 없는 인용을 지금처럼 걸러 낸다(agent).
- 돈과 시간 상한은 program이 지킨다(agent).
- gate에 고른 시나리오의 dry run(fake provider)을 더한다(agent).
- grader는 대상의 checkout에서 가져오지 않는다(agent).
- variant는 제품이 값을 정하는 길로만 바꾼다: 제품의 설정 길, 또는 lophn checkout(agent).
- run은 진짜 model이 본 component만 남긴다. skill은 설명과 본문을 따로 매긴다. runtime은 assembly 밖의 agent 코드이고 UI는 들지 않는다(agent).
- run에는 harness를 component 버전으로, core를 버전 하나(`core@n`)로 남긴다. lophn commit은 출처로만 쓴다(agent).
- check는 run 기록과 끝난 world를 함께 본다(agent).
- 참가자는 role agent와 coding agent로 나눠 잰다(agent).
- 이어 돌리기는 experiment가 고를 때만 한다. 앞 단위의 새 산출물은 사람이 commit해야 뒤 단위의 전제가 된다(agent).
- activation 같은 사람의 허락은 시나리오의 허락 규칙대로 program이 제품 route로 준다(agent).
- L4-new는 캘린더의 첫 단위를 겸한다. 사람 말을 캘린더 요청으로 두고 `calendar-call@1`을 남긴다(agent).
- 자리는 `tests/eval/`다(자세한 폴더는 `project-docs/architecture/eval.md`). `tests/eval`의 `*_test.ts`는 core와 provider 없이 도는 것만 두고 `deno task check`가 돈다. runner와 시나리오 file은 test file이 아니라 check가 돌리지 않는다. data 폴더(재료, registry, run 요약)는 `fmt.exclude`에 넣는다(agent).
- 재료를 되살릴 때는 fake 대본을 쓴다. 진짜 model은 시나리오의 `real`에만 붙인다(agent).
- 재료 버전은 정수 `n`과 content hash다. 결과는 runner가 새 `n`으로 쓰고, 사람이 보고 commit한다(agent).
- coding agent는 PTY에서 띄우는 interactive CLI다. headless는 App Engineer와의 대화가 끊긴다(agent).
- core의 provider는 처음에는 API key만 쓴다. 구독 OAuth는 root를 복사할 수 없어 trial마다 새 root를 쓰는 eval과 맞지 않는다(agent).
- 비용 장치: role agent는 settings `lophn-agent.run.model_attempts`와 runner의 실행 상한(`modelCallList` cost를 더해 넘으면 멈춤), coding agent는 driver의 시간 상한만, experiment는 예산 하나(agent).
- PM 지침 모순은 PM이 정하는 것으로 고쳤다(사람, 계획 `prompt-text`). 재사용을 찾는 길과 진단 근거는 재기 전에 고쳤다(계획 `reuse-diagnose`).

## 정할 것

1. 계획 중에 worker가 runner가 도는지 보려고 진짜 provider를 부르는 것: 추천은 `claude-haiku-5-5`로만, 계획 전체 $5.

## 단계

시작 조건이던 계획 `reuse-diagnose`와 `provider-model`은 main에 land했다. `eval-base`(기초와 판단 case 17개), `eval-coding`(진짜 coding agent와 캘린더 단위), `eval-experiment`(spec, run 고르기, trial 정책, 병렬과 예산, gate, variant, 판정, 경고와 진단, agent 채점과 사람 역할, runner·experimenter skill)는 land했다(`project-docs/architecture/eval.md`). 남은 계획은 없다. 고칠 것은 experiment의 `report.md`가 제안한다.

계획마다 끝에 고칠 것: `project-docs/architecture/eval.md`(그 계획이 만든 것을 실제 코드 path로 더한다), `architecture/testing.md`(eval 층, 돌리는 때), registry `tool-eval`과 `architecture-eval`, module-catalog `tests`의 notes, `write-test` skill의 층 목록, 이 문서에서 그 계획 몫을 지운다.

## 끝남 기준

- `deno task eval`은 key가 없으면 이유를 찍고 0으로 끝난다.
- `deno task eval --scenario <id> --model <name>`은 재료를 되살리고 시나리오를 돌린 뒤, run 기록에 본 component 버전, core 버전, 출처 commit, check verdict, judge item, 공통 수치를 남긴다.
- runner는 provider를 부르기 전에 재료의 hash를 확인하고, 모든 시나리오에서 grader가 right fixture를 통과시키고 wrong fixture를 떨어뜨리는지 본다.
- component 하나를 바꾼 experiment는 그것을 본 run만 다시 돌릴 대상으로 고른다.
- `calendar-app@1`이 재료로 commit되어 있고, calendar-api, calendar-maintain, calendar-diagnose는 그 재료에서 시작한다.
- `deno task check`는 `tests/eval`의 core 없는 test만 돌고, runner는 돌리지 않는다.

## 하지 않는 것

- CI, cron, nightly에서 eval 돌리기. runner가 run 중에 진행을 확인하는 것은 된다.
- 녹화 재생으로 판단 재기. 재는 것이 판단 자체라 재생은 뜻이 없다. assembly의 prefix 유지를 재는 재조립은 판단이 아니라 된다.
- agent loop 중간에서 끊고 이어 가기.
- judge에게 점수 매기게 하기, 전체 transcript 주기.
- headless CLI. data root 통째 복사.
- 제품의 eval 전용 flag.

## 선례 (만드는 법만)

조사 자료는 `git show ef3cf4ea5^:project-docs/plan/testing/research/<file>`로 본다.

- Gemini CLI `evals/`: test와 따로 둔 층이다. model마다 3번 돌려 채점한다. tool 인자와 정확한 값을 단정하고 글은 단정하지 않는다. "Less is more", "Fail first".
- Anthropic 글: 처음에는 20~50 task, 경로가 아니라 결과를 채점, trial마다 깨끗한 환경.
- Block: 진짜 LLM을 부르는 test는 CI에 넣지 않는다.
- hermes: eval을 tests와 따로 두고, 날짜가 붙은 scorecard를 commit한다. test당 token·금액 상한을 둔다.
