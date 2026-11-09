# eval

진짜 model로 lophn agent의 판단을 잰다. test가 "코드가 계약대로 도나"를 fake model로 본다면, eval은 "지침과 model이 맡은 일을 맞게 하나"를 본다. 시나리오 하나가 재료로 world를 되살리고, 사람 말 한 줄을 넣고, agent들이 쉴 때까지 기다린 뒤, 남은 기록을 program check와 judge로 채점한다. 결과는 run 요약으로 commit하고 scorecard로 읽는다. 지침·tool 설명·skill·runtime을 고친 것이 나아졌는지는 experiment가 정한 규칙과 program의 판정으로 가린다. 이 문서는 지금 있는 것만 적는다. 아직 만들지 않은 설계(앱을 짓고 진단하는 단위, 사람 역할)는 `project-docs/products/roadmap/eval.md`에 있다. 돌리는 절차와 폴더, 명령은 skill `eval-run`의 `reference.md`가 맡는다.

## 문제

지침이나 tool 설명, model을 바꿔도 agent가 맡긴 일을 맞게 하는지 알 길이 없다. program이 강제하지 않는 규칙("모호하면 만들기 전에 묻는다", "앱 밖의 일은 home의 lophn에게 넘긴다")은 fake model로는 볼 수 없고, 사람이 눈으로 한두 번 써 보면 우연과 나빠짐을 가르지 못한다. 고친 것을 고친 사람이 직접 채점하면 시나리오 맞춤이 된다. 이 메커니즘이 없으면 지침을 고치는 사람이 "나아졌다"를 숫자로도, 돈을 쓴 만큼 믿을 수 있게도 말하지 못한다.

## 목표와 비목표

- 목표: 같은 시나리오를 같은 world에서 되풀이해 돌려 결과를 숫자로 남긴다. 무엇을 바꿨을 때 결과가 달라졌는지 버전으로 짚는다. 고침의 채택 여부를 돌리기 전에 정한 규칙으로 program이 판정한다. 채점이 돌리는 쪽의 가설에 물들지 않는다.
- 비목표:
  - 코드가 계약대로 도는지는 보지 않는다(test의 일).
  - 앱 화면이 좋은지는 재지 않는다. 사람이 본다.
  - coding agent를 재지 않는다. 제품에 coding session을 띄우는 길이 없다.
  - 앱을 짓고, 진단하고, 산출물을 다음 재료로 넘기는 긴 시나리오는 아직 없다. 지금은 판단 case만 돈다.
  - eval 자체는 check나 land에서 돌지 않는다. 진짜 provider를 부르므로 사람이 정할 때만 돈다(eval의 test는 순수한 것만 두고 check가 돈다).

## 모델

### 시나리오와 trial

시나리오는 이 다섯으로 이루어진다.

- 재료 목록: world를 만드는 `이름@n`들. 재료는 앱 source, project, 사람이 만든 agent 정의 가운데 하나이고 고정 id를 가진다. 되살리는 순서는 재료의 `needs`가 정한다.
- `real` 참가자: 진짜 model을 받는 쪽. 참가자 이름은 call의 `to`와 같은 꼴이다. agent는 정의의 name(`lophn`, `세무정리`), workspace는 앱이면 앱 이름, project면 project 이름, 없으면 home이다.
- 단계: `say`(사람 말 한 줄을 한 참가자에게)와 `untilIdle`(진짜 model을 받은 참가자가 모두 쉴 때까지).
- check: program check(기록만 보고 통과·실패)와 judge check(채점 criterion과 judge에게 줄 입력, 먼저 통과해야 하는 program check `premise`).
- fixture: check마다 맞는 기록 `right`(모두 통과해야 한다)와 틀린 기록 `wrong`(적은 check가 떨어져야 한다).

시나리오는 AGENT.md의 규칙에서 나온 판단 case다(`proposal`이면 "(제안)" 줄에서 나왔다. 떨어지면 model보다 그 줄이나 지침이 틀렸을 수 있다). 지금 case는 넷이고 말 상대(진짜 model을 받는 참가자)의 workspace 종류로 묶인다: home 하나, project 하나, app 둘. 사람 말은 개발자의 말이 아니라 평범한 말이다.

trial은 시나리오를 한 번 돈 것이다. 새 data root와 새 core에서 시작해, 재료를 되살리고, `real` 참가자마다 workspace session을 열어 session model을 붙이고, 시각 t0를 잡은 뒤 단계를 돈다. 끝나면 `idle`(모두 쉬었다)이거나 `timeout`(제때 쉬지 않았다, 비용 상한이 걸렸다, turn이 되지 않는 입력이 남았다)이다.

쉼은 이렇게 정한다. 도는 session도, turn이 아직 가져가지 않은 입력도 없는 조용함이 잠깐(1초) 이어지면 쉰 것이다. 사람의 `ask` 답이나 허락을 기다리며 멈춘 session은 조용함에 든다(정상 끝이다). 한 단계에서 쉬기를 기다리는 한도는 5분이고, turn이 되지 않은 입력이 5분 남아도 timeout이다.

### 수집과 채점

trial이 끝나면 기록을 모은다. 시작 session(runner가 연 것)에서 출발해 보낸 call의 받는 session을 따라가고, 그 밖에 t0 뒤 turn이 생긴 session도 담는다. 기록은 session마다 turn, model call(요청 body 포함), tool call(입력과 출력), 보낸 call(받는 agent, workspace, 상태, 실패 이유)이다. 수치는 token(input·output·cache·reasoning), cost, 시간, tool 호출 정확도와 되풀이, 보낸 call이다.

채점은 두 단이다. program check가 먼저다. judge check는 premise의 program check가 모두 통과하고 trial이 `idle`로 끝났을 때만 judge item이 된다. 그렇지 않으면 judge를 부르지 않고 그 check는 실패로 적는다. judge item은 채점 대기 상태(`pending`)로 file에 남고, eval을 돌리는 agent가 새 subagent에게 질문·허용 verdict·입력만 보여 주어 `{verdict, quote}`를 받아 넣는다. 들어온 답이 검사를 통과하면 `judged`, 아니면 `error`다. 채점이 들어오면 run 요약의 judge item과 check 결과에 접힌다.

judge의 criterion은 이름·n·질문·verdict 목록·통과 verdict로 이루어지고, verdict 목록에는 늘 `cannot_tell`이 든다. 통과로 치는 verdict에는 `cannot_tell`이 들지 않는다. 지금 criterion은 `asks-gap`(요청이 빠뜨린 결정을 물었나), `relay-complete`(넘긴 call 본문이 사람의 요청을 다 옮겼나), `repeat-kind`(되풀이 진단용)이다.

### 버전

모든 것을 `kind:name@n`으로 가리킨다. kind는 이 열다섯이다.

| kind | 무엇 | n을 누가 붙이나 |
|---|---|---|
| material, scenario, criterion, judge | 재료, 시나리오, 채점 질문, judge 지침 | 쓴 사람이 정한다 |
| instruction | workspace 종류(home, project, app)별 지침 글 | registry가 내용 hash마다 붙인다 |
| skill | skill 폴더 전체(SKILL.md는 frontmatter를 뺀 본문) | 위와 같다 |
| skill-description | skill 목록에 실린 한 줄 설명(공백을 접은 글) | 위와 같다 |
| tool | tool 정의 글. 한 source file이 정의한 tool은 같이 오른다. `lophn` tool은 그것이 읽어 주는 명령 이름·설명·help도 함께 잰다 | 위와 같다 |
| assembly | model 요청을 조립하는 코드 | 위와 같다 |
| runtime | agent를 돌리는 코드 | 위와 같다 |
| template | 앱 template 폴더 전체 | 위와 같다 |
| model | 요청한 model 이름 | 위와 같다 |
| core | 제품 코드 나머지(base·protocol·core·sdk와 root의 package manifest) | 위와 같다 |
| checks | check 코드 전체 | 위와 같다 |
| cli | CLI 명령 설명 글 | 위와 같다 |

shell·design package와 test file은 어느 kind에도 들지 않는다. 같은 내용은 같은 n이고, 옛 내용으로 돌아가면 옛 n이다.

run 요약은 이 버전들로 "무엇으로 쟀나"를 남긴다. scorecard와 experiment는 run의 버전을 지금 checkout의 버전과 대어 낡음을 가른다. 낡음의 이유: 시나리오 n, 재료 n, criterion n, judge n(judge check가 있는 시나리오만), checks n, run이 본 component n(다른 component는 상관없다), model 이름, core n.

### experiment

experiment는 고침 하나가 나아졌는지를 가린다. 사람이 돌리기 전에 spec을 쓰고 commit한다.

- spec: 가설, 출발 run, 기준 model, 바꾼 것 `X@a → X@b`, target(나아져야 할 시나리오와 check), 미리 써 둔 같은 규칙의 case, 판정 규칙 이름(`default@1`), trial 정책 `{base, max}`, 예산(USD).
- 바꿀 수 있는 kind는 instruction, skill, skill-description, tool, assembly, runtime, template이다. grader(시나리오, criterion, judge, checks), core, 재료, model, cli는 대상이 아니다.
- 시나리오의 역할은 셋이다. target은 spec이 가리킨 나아져야 할 것, case는 spec이 가리킨 미리 써 둔 것, guard는 나머지 가운데 기준 run이 `X@a`를 본 것이다.
- 기준은 지금(기준) checkout에서 낡지 않은 run 가운데 `X@a`를 본 것이다. `X@a`를 보지 않은 시나리오의 run은 다시 돌리지 않고 `keep`으로 남기고, 낡아서 기준이 못 된 것은 `excluded`로 이유를 적는다.
- 변경된 checkout(variant)은 기준과 다른 checkout이다. 바뀐 component가 spec의 `X@a → X@b` 하나가 아니면 `mixed`로 알린다.

판정 `default@1`. 시나리오마다 상태를 정한다. tally의 통과는 엄격한 과반이다(1번이면 1/1, 3번이면 2/3 이상). 정확히 절반(split)은 통과가 아니다.

| 역할 | 상태 |
|---|---|
| 모두 | 정책이 더 돌리라고 한 trial이 남았거나, variant trial이 없거나, 채점 대기가 남았으면 incomplete |
| target | variant가 통과이고 통과율이 기준보다 높으면 ok, 통과인데 기준 이하이면 not_improved(이미 통과하던 target이라 가설이 틀렸다), 통과가 아니면 fail |
| case | 통과면 ok, 아니면 fail. 기준과 비교하지 않는다(새로 쓴 case는 기준이 없을 수 있다) |
| guard | variant가 fail이고 기준은 fail이 아니면 worse, 그 밖은 ok(통과율이 기준보다 낮으면 weaker로 표시) |

전체: fail·not_improved·worse가 하나라도 있으면 reject(끝나지 않은 것이 있어도), 아니고 incomplete가 있으면 inconclusive, 아니면 adopt다.

trial 정책은 처음에 base번만 돈다. target·case는 통과한 trial이 하나라도 있어야 max까지 늘려 확인하고, 나아지지 않으면 거기서 멈춘다. guard는 variant의 판정이 기준과 다를 때만 max까지 늘린다. 같은 버전에서 trial끼리 pass와 fail이 갈린 적이 있는 시나리오(flaky)는 처음부터 max다. 채점 대기가 남은 trial이 있으면 더 돌리지 않고 채점이 들어온 뒤 다시 정한다.

`inconclusive`는 채점이 들어온 뒤 같은 spec으로 이어 돈다. 끝난 trial은 그대로 두고 판정만 다시 계산한다.

### 진단

판정에 들지 않고 `result`에 남는 것이 셋이다.

- `overfit` 경고: 바꾼 글의 더해진 줄이 시나리오 고유의 이름(앱·project·사람이 만든 agent 이름, 재료 안의 이름. 모든 지침에 나오는 `lophn`은 뺀다)이나 사람 말 세 낱말 구절을 담고 늘었으면 경고다.
- `assembly`: 바꾼 것이 assembly일 때만. 녹화한 model 답을 fake provider로 되돌려 바뀐 checkout의 core로 다시 조립하고, 요청의 cache 경계(layer)마다 앞 call과 prefix가 같은 비율을 기준과 variant에서 견준다. 상태는 ok·diverged·not_replayable이다. judge와 program check는 돌리지 않는다.
- `repeats`: 한 session에서 같은 tool을 같은 입력으로 세 번 이상 부른 곳마다 `repeat-kind` 채점 item을 만든다. 재시도에 밀린 행, 막힘이 아닌 not_executed는 세지 않는다.

## 지키는 것

1. **진짜 model은 `real` 참가자의 session만 받는다.** 되살리기는 제품 route만 부르므로 model이 필요 없고, 전역 기본 model은 처음부터 비어 있다. 전역 기본이 비어 있지 않으면 trial을 시작하지 않는다. session model은 t0 전에 연 `real` 참가자의 session에만 붙인다. 정의에 붙이지 않는 이유는 정의가 전역이라 같은 lophn의 다른 workspace session(call로 열린 받는 쪽)도 model을 받기 때문이다. session model은 call로 연 session에 이어지지 않는다(fork만 잇는다). 나머지 session의 turn은 `failed / configuration_unavailable`로 곧바로 끝나고 provider를 부르지 않는다. call을 받아도 그쪽 비용은 0이다. 이 끝남은 정상이고 쉼 판정과 수치에서 오류로 다루지 않는다.
2. **key는 환경 변수로만 든다.** `ANTHROPIC_API_KEY`를 env에서 읽어 secret으로 core에 넣는다. 로그, 오류 message, run 기록에 넣지 않는다. core process는 env를 비운 채(data root, 홈, PATH 같은 격리 값만) 뜬다. key가 없으면 `eval`은 진짜 provider를 부르지 않고 0으로, `experiment`는 시작 전에 실패(1)로 끝난다.
3. **되살리기의 흔적은 기록에 섞이지 않는다.** 첫 단계 직전 시각이 t0다(`started_at`). t0 전에 시작한 turn과 그 model call·tool call은 기록에서 버린다.
4. **재료는 제품 route로만 되살리고 model을 쓰지 않는다.** 재료의 content hash가 하나라도 다르면 아무것도 되살리지 않는다. agent 정의는 전역이라 workspace 없이 되살린다. 되살리기는 재료 종류(앱 source, project, agent)마다 정한 route 순서다.
5. **요청 body는 eval이 만든 data root에서만 읽는다.** 요청 body를 내놓는 제품 route가 없다(blob read가 model call의 입력을 막는다). eval이 그 root의 content-addressed blob file을 직접 읽고, hash가 다르면 못 읽은 것(`null`)이다. 제품에 route를 더하지 않는다.
6. **token은 cache를 두 번 빼지 않는다.** 저장된 `usage.input`은 어느 adapter든 cache를 뺀 값이다. `input_total = input + cache_read + cache_write`이고 cache hit rate는 `Σcache_read / Σinput_total`이다. provider가 보고한 `cache_in_input`으로 계산하지 않는다.
7. **tool 정확도의 분모.** 재시도에 밀린 행(다른 행의 `retry_of`가 가리키는 행)은 뺀다. `not_executed` 가운데 `denied`·`rejected`(막힘)는 분모에 들고, 그 밖(멈춤, 대체, 한도, 취소)은 `excluded`로 뺀다. 같은 tool·같은 입력의 되풀이도 같은 규칙으로 센다.
8. **버전은 hash로 고정한다.**
   - 쓴 사람이 n을 정하는 것(재료, 시나리오, criterion, judge)은 registry가 같은 n의 내용이 바뀌면 거절하고("n을 올려라"), 지금 가장 큰 n 이하의 새 n도 거절한다. 빈 n을 건너뛴 새 n은 받는다(file의 n이 registry보다 앞서는 일이 흔하다).
   - 그 밖은 registry가 hash마다 n을 붙인다. 같은 내용은 같은 n이다.
   - 재료·registry·runs·experiments는 formatter가 건드리지 않는다. 쓰는 쪽이 정한 모양(들여쓰기 2칸, 끝 줄바꿈)대로 쓰고 쓴 byte로 hash를 재기 때문이다.
   - 시나리오는 시나리오 file 전체의 hash로, 재료는 폴더 전체의 content hash로 잰다.
9. **run은 진짜 model이 본 것만 남긴다.** `components`는 요청 body에 실린 instruction·tool·skill 설명과 turn 중에 `skill.read`로 연 skill, model 이름, assembly, runtime이다. 앱·MCP 같은 world의 tool은 제외한다. run이 보지 않은 component가 바뀐 것은 낡음이 아니다. body를 못 읽으면 component를 가르지 못해 오류다.
10. **채점 순서와 채점의 정직함.**
    - program check가 먼저다. 한 check가 던져도 실패로 적고 다음 check를 막지 않는다. check는 trial 기록만 읽고 core나 world를 바꾸지 않는다.
    - judge check는 premise가 모두 통과하고 `idle`로 끝났을 때만 item이 된다.
    - verdict는 criterion의 enum이어야 하고, 인용은 judge 입력 안에 글자 그대로 있어야 한다. 그 밖의 답은 `error`로 남고, `pending`과 `error`만 다시 채점할 수 있다. 정상 채점은 덮지 않는다. 마음에 드는 verdict를 고르는 일이 되기 때문이다.
    - 늘 `cannot_tell`을 허용하고 점수 없이 verdict만 남긴다. 채점한 model은 item마다 남는다.
    - 채점 대기가 있는 check는 실패가 아니라 정해지지 않은 것이다. trial의 상태도 pending이고, 이미 떨어진 check가 없을 때만 그렇다.
    - 채점하는 agent는 직접 판단하지 않고, 채점 item마다 새 subagent(fork가 아니다)에게 보이는 글만 준다. 한 run 안에서 채점 model이 섞이지 않게 type 하나로 고정한다.
11. **비용 상한.** 끝난 trial의 `cost_usd`(참가자 agent의 model call 가운데 USD로 값이 있는 것)를 더해 run 상한(`eval`은 기본 $50, experiment는 spec의 예산이고 명령에서 덮을 수 있다) 이상이면 새 trial을 띄우지 않는다. trial마다도 참가자 agent의 비용이 상한(기본 $50)을 넘으면 그 trial을 timeout으로 끝낸다. judge는 eval을 돌리는 agent가 하므로 이 합에 없다. 값을 모르는 call이 있으면 한 번 경고한다. 판단 case는 model 호출 횟수 상한(`lophn-agent.run.model_attempts`)을 15로 낮춰 돈다.
12. **요약과 전체 기록.** 요약은 버전, check verdict, judge item(입력, verdict, 인용), 공통 수치이고 commit한다. 대답 글, 요청 body, working tree diff는 `.dev-data/eval/<run id>/`에만 둔다. `.dev-data`는 schema가 바뀌면 지우므로, 기준 run을 다시 쓰려면 요약이 그보다 오래 남아야 한다.
13. **`source.dirty`는 "고친 채 돌렸나"만 말한다.** 제품 코드(packages와 root의 package manifest)의 commit 안 된 변경만 센다. run이 스스로 쓰는 file(runs, registry, scorecards, materials)은 세지 않는다. 고친 채 돌리면 working tree diff가 전체 기록에 남고 요약에는 `dirty`만 남는다. experiment 밖 `eval`은 지금 checkout만 돈다.
14. **world를 남길 수 있다.** `--keep`이면 trial이 끝나도 임시 data root를 지우지 않고 core만 끈다. 개발용 data root 환경 변수로 그 root를 데스크톱 앱으로 연다(fake provider를 심지 않는다). 다 본 뒤 그 폴더는 사람이 지운다.
15. **experiment는 commit된 spec으로만 돈다.** spec이 commit됐고(작업 트리가 그 commit과 같다), 그 commit이 기준 checkout에 있고, variant checkout이 그 위에 쌓였고, variant의 spec이 byte까지 같고, case 시나리오가 그 commit에 있어야 한다. 이유: 결과를 본 뒤 규칙이나 target을 고르지 못하게. 판정이 난 `result`는 덮지 않는다("판정이 이미 났다"). 이 길을 다시 열려면 새 id의 새 spec을 쓴다.
16. **판정은 program이 한다.** `default@1`은 위 표대로 계산한다. 규칙을 바꾸면 이름을 올린다(`default@2`). spec이 규칙을 이름으로 가리키므로 옛 `result`가 어느 규칙으로 계산됐는지 남는다. spec이 돌리기 전 규칙을 정하므로, runner는 target을 고르거나 trial을 골라 다시 돌리지 않는다(떨어진 것만 다시 돌리면 결과를 고르는 일이다).
17. **spec은 repo와 맞아야 돈다.** target과 case의 시나리오와 check가 지금 checkout에 있고, 출발 run은 기준 model이고 target 시나리오이며 `X@a`를 본 run이고, `X@a`가 기준 checkout의 지금 버전이어야 한다. spec 자체는 target 하나 이상, case 하나 이상, target과 case의 시나리오가 겹치지 않음, `1 ≤ base ≤ max ≤ 5`, 예산 0보다 큼, 바꾼 것의 from·to는 같은 kind·name이고 n만 다름을 만족한다. target에 기준 run이 없거나 기준 run이 `X@a`를 보지 않았으면 돌리지 않는다.
18. **variant의 core는 그 checkout에서, grader는 지금 checkout에서.** `--checkout`이면 core·instruction·tool 같은 버전은 variant 것이다. check, judge, 시나리오, registry는 지금 checkout 것이다. registry가 하나뿐인 전역 이름 표라서다. variant 사본에 쓰면 그 worktree를 지울 때 표가 사라진다.
19. **variant는 자기 앱 E2E 의존을 받는다.** variant의 E2E 의존 cache가 비었으면 그 checkout에서 받는다. 지금 checkout 것을 symlink로 이으면 앱 release 준비의 esbuild가 떨어진다.
20. **gate는 싼 것부터, 앞이 떨어지면 뒤는 돌지 않는다.** variant에서 check, 바뀐 file의 module이 걸린 boundary를 contract로 선언한 e2e(contract를 못 읽는 e2e는 늘 고른다, 지침·skill 글만 바뀌면 e2e는 닿지 않으므로 고르지 않는다, 바닥 file이면 전부), 고른 시나리오의 fixture 확인과 dry run(되살리기만, 진짜 model 없음) 순이다. experiment가 돌 일이 남아 있지 않으면 gate도 돌지 않는다.
21. **경고와 진단은 판정에 들지 않는다.** `result`에 남기만 한다.
22. **동시 수와 정리.** 시나리오는 동시에 돌고 trial은 pool(동시 4)에서 도는데 예산 하나를 같이 쓴다. 예산은 trial을 띄우기 직전에 확인한다. 같은 registry file을 쓰는 일은 줄 세운다. 첫 종료 신호는 새 trial을 띄우지 않고 도는 trial을 기다리며, 둘째 신호는 기다리지 않고 core를 끄고 끝낸다.
23. **eval의 test는 순수하다.** eval의 test는 check에서 돈다. core를 띄우지 않고 process·network·진짜 provider를 쓰지 않는다. runner와 시나리오 file은 test file이 아니다.
24. **사람은 개발자가 아니다.** 시나리오의 사람 말은 tool 이름과 입출력을 말하지 않는다. 앱 종류에 매인 예가 지침에 들어가면 시나리오를 베낀 것일 수 있으므로 overfit 경고가 그것을 본다.

## 경계와 계약

eval은 test 층이고(boundary-catalog ID 없음, module-catalog의 `tests`) 제품 코드는 eval을 import하지 않는다. eval은 제품의 공개 route를 부르는 쪽이다.

**부르는 제품 계약**
- 쓰기: 재료 되살리기(앱 등록·source, project 만들기, agent 만들기), workspace session 열기, `say`(사람 메시지), session model 바꾸기, provider 연결과 secret 넣기, core 설정 `lophn-agent.run.model_attempts`.
- 읽기: session snapshot 목록, 받은 메시지, session·turn·model call·tool call 읽기와 tool 입출력 body, call 읽기, agent·앱·project 이름 목록, 모델 기본값 읽기.
- 제품 code를 읽는 예외 둘: 요청 body blob을 data root에서 직접 읽는 것, 버전을 재려고 제품의 source file(지침, skill, tool 정의, template, 코드 group)을 읽는 것.

**저장 모양**
- 재료 `tests/eval/materials/<이름>/<n>/`: `material.json`(`kind`: `app`/`project`/`agent`, 고정 `ids`, `needs`, `content_hash`)과 `files/`.
- registry `tests/eval/registry/<kind>/<name>.json`: `{kind, name, n, hash, content?}`의 배열. 글 kind(instruction, skill, skill-description, template, criterion, judge, cli)는 내용도 남는다. 두 checkout이 같은 registry를 쓴다.
- run 요약 `tests/eval/runs/<run id>.json`: 시나리오, 재료, components, core, grader(criteria, judge, checks) 버전, model, effort, source(commit, dirty), trial별 settle·check 결과·judge item·수치·본 component. commit한다.
- 전체 기록 `.dev-data/eval/<run id>/`: `trial-N.json`(전체 기록, judge, source diff), `trial-N.core.log`, `trial-N.repeat.json`, `judge/<key>.json`(채점 대기와 답, key는 `t<trial>-<check id>`, kind는 `check`/`diagnosis`). git 밖이다.
- experiment `tests/eval/experiments/<id>/`: `spec.json`(사람이 쓰고 commit), `result.json`(program의 판정: decision, reasons, 시나리오별 상태·tally, changed, mixed, keep, excluded, 비용, 예산 중단 여부, `spec_hash`·`spec_commit`, 진단), `run.md`(runner), `report.md`(experimenter).
- scorecard `tests/eval/scorecards/<날짜>.md`: 시나리오마다 유효한 가장 늦은 run(없으면 가장 늦은 run을 낡음으로 표시), check별 통과 수와 이유, 합친 수치, 채점 대기. 두 run을 견주는 diff는 stdout으로 낸다.

**입구**
- `eval`(시나리오 고르기, model, effort, trial 수, run 예산, trial 예산, `--keep`), `eval:experiment`(id, `--checkout`, `--base`, `--budget`), `eval:gate`, `eval:judge`(채점 대기 목록·`show`·`set`), `eval:scorecard`. 인자와 종료 코드는 `eval-run` reference.
- 종료 코드: 인자 오류 2, 실패 1, 판정(adopt·reject·inconclusive)은 모두 0이다. 0이 통과가 아니다.
- stdout 줄(`[trial]`, `[budget]`, `[gate]`, `[pending]`, `[verdict]`, `채점 대기`)은 runner skill이 기대는 계약이다.

**judge 계약**: judge 정의는 `judge.json`(n)과 prompt 글 둘이고 그것이 judge 버전이다. 채점하는 쪽은 질문·허용 verdict·program이 고른 입력만 받는다. 답은 `{"verdict", "quote"}` 하나다.

## 결정

- **제품 route로 되살린다.** 이유: data root를 복사하면 schema가 바뀔 때마다 재료가 깨진다. trial마다 새 root에서 제품 route로 되살리면 재료는 schema와 상관없는 작은 JSON과 file로 남는다.
- **판단 case는 기록만으로 채점한다.** 이유: case가 묻는 것은 "누구에게 무엇을 맡겼나, 무엇을 물었나"다. call과 tool call 기록으로 끝나고 check는 world를 묻지 않는다. 끝난 world를 보는 check는 앱 짓기 case와 함께 지웠다.
- **judge는 eval을 돌리는 agent가 subagent로 한다.** item마다 새 subagent(한 type으로 고정)에게 보이는 글만 주고, 채점 model을 item마다 남긴다. 이유: judge를 core의 agent로 돌리면 judge의 비용과 지침이 잴 대상에 섞인다. program이 key로 따로 부르면 key와 비용이 eval에 하나 더 붙는다. 돌리는 쪽의 가설이 섞이지 않고, judge 버전은 두 file로 끝난다. 잃는 것: program만으로는 run이 끝나지 않는다. 버린 안: runner가 Messages API를 직접 부르는 안(처음 만든 길이고 forced tool_choice로 돌았다. 사람이 agent session이 돌리고 judge도 그 agent가 하기를 원해 지웠다). (사람)
- **case마다 right/wrong fixture를 둔다.** 이유: provider를 부르기 전에 check가 맞는 기록을 통과시키고 틀린 기록을 떨어뜨리는지 본다. check가 틀리면 돈을 쓰기 전에 드러난다.
- **check는 재려는 판단을 잰다. 정해진 이름이 아니다.** 앱 상태를 "읽는 tool로만 답한다"를 재려는 case가 `app.get` 한 이름을 요구해 `app.list`로 읽은 맞는 답을 떨어뜨렸다. 고쳐서 "그 가운데 하나"를 받게 했다. 이유: 지침을 고쳐 그 case를 통과시키면 시나리오 맞춤이다. (agent)
- **재려는 상황이 생겨야 case다.** 막힌 call 뒤 돌려 시키지 않는지를 재는 case에서 model이 막힌 상대에게 call을 시도하지 않아 늘 떨어졌다. 사람 말이 막힌 상대를 이름으로 가리키게 시나리오를 고쳤다. 이유: 목록에 없는 상대를 이름으로 부르면 Router가 grant로 막고, 그 뒤가 재려는 것이다. 버린 안: 막힌 call이 없으면 "재지 못함"으로 두는 check(case가 거의 늘 재지 못함이 되어 guard로 쓸 수 없다). (agent)
- **run 요약은 commit하고 전체 기록은 `.dev-data`에 둔다.** 요청 body는 제품 route가 없어 eval이 만든 data root의 blob file에서 읽고, 제품에 route를 더하지 않는다. (agent)
- **진짜 model은 정의가 아니라 시험하는 session에 붙인다.** 이유: 정의에 붙이면 call로 열린 같은 lophn의 다른 workspace session도 model을 받는다. (agent)
- **호출 횟수 상한을 15로 두어 돈을 막는다.** 일한 시간 한도는 제품에서 지웠고(사람이 한도를 없애라고 했다), 호출 수 상한은 opt-in으로 남겨 eval이 쓴다. (사람, agent)
- **진짜 provider 호출은 사람이 정할 때 돌린다.** 첫 scorecard는 Sonnet 5.5, 상한 $50, trial 1로 돌렸다(사람). 개발의 fake provider나 test의 녹화 재생은 eval이 아니다. (사람)
- **판정은 program이 한다.** experimenter는 해석만 하고, 판정을 뒤집으려면 이유를 적어 사람이 정한다. 이유: 고침이 우연이나 시나리오 맞춤으로 채택되지 않게, 규칙을 돌리기 전에 적고 판정은 program이 한다. (사람)
- **trial은 기본 1번이고 갈릴 때만 늘린다.** 늘 3번씩 돌리지 않는다. 이유: 돈이 든다. target이 통과하거나 guard가 기준과 갈리는 시나리오만 max까지 늘린다. `eval`의 `--trials` 기본도 1이다. (사람)
- **기준 구성은 기준(main) checkout에서 잰 버전이다.** 따로 기준 file을 두지 않는다. (agent)
- **variant는 자기 앱 E2E 의존을 받는다.** 이유: symlink로 이은 의존에서는 같은 test가 variant에서만 떨어졌다. 원인은 모르지만 지금 checkout과 같은 길이라 맞다. 버린 안: symlink를 두고 core에 실제 경로(realpath)를 넘기기. (agent)
- **`source.dirty`는 run이 스스로 쓰는 file과 check가 고치는 lock을 세지 않는다.** 이유: check를 한 번이라도 돌린 checkout의 모든 run이 dirty로 남아 variant와 기준 run을 가를 수 없었다. (agent)
- **재료·registry·지난 기록은 고치지 않고 새 판을 만든다.** 옛 판의 재료와 registry 항목, runs, scorecard, experiments는 "그때 무엇을 썼는지"의 기록이다. 이름이 바뀌어도(role → place 종류, 앱 declaration) 옛 기록을 고치지 않고 다음 진짜 run이 새 이름의 항목을 만든다. 커밋된 run은 낡음으로 보일 수 있다. (agent)
- **앱 source를 가진 재료와 그 시나리오는 Deno에서 Node로 가며 지웠다.** 사람이 Deno를 떠나 앱의 권한을 막지 않기로 해서, 옛 앱 모양에 묶인 case와 그것만 쓰던 harness(사람 역할, 끝난 world를 보는 check)를 옮기지 않고 버렸다. 새 앱 모양으로 다시 지을 때 함께 만든다. (사람)
- **coding agent 갈래를 지웠다.** driver, coding token 수치, call 재료를 지웠다. 이유: 제품에 coding session을 띄우는 길이 없다. 연결을 살리면 그때 새로 쓴다. (agent)
- **화면이 좋은지는 사람이 본다.** screenshot judge를 만들지 않는다. (사람, 2026-10-20)
- **지침에는 앱 종류에 매인 예를 두지 않는다.** 예가 필요하면 eval world에 없는 도메인을 쓴다. 이유: eval이 지침의 예시를 베껴 통과하면 다른 앱에서 설계를 잘하는지 알 수 없다. overfit 경고가 이 규칙의 기계적 보조다. (사람, 2026-10-20)
- **`--keep`으로 trial의 world를 데스크톱 앱으로 열어 볼 수 있다.** 이유: 사람이 eval이 만든 캘린더를 열어 보니 달력이 없는 항목 목록이었다. check와 수치만으로는 결과물의 모양을 못 본다.

## 열린 것

- 판단 case가 넷뿐이다(home 1, project 1, app 2). 현재 시나리오는 재료 둘(`apps-home`, `projects-home`)만 쓰고 `agents-home`, `calendar-*` 재료는 쓰이지 않는다. 지난 experiment `call-list-without-session`의 target·case 시나리오 가운데 지금 없는 것이 있어 그 spec은 그대로 다시 돌릴 수 없다(기록으로만 남는다).
- coding agent를 재는 길이 없다. 앱을 짓고, 진단하고, 산출물을 다음 재료로 넘기는 단위도 Node 앱 모양으로 다시 지을 때 harness(사람 역할, 끝난 world를 보는 live check, 시나리오의 setup·limits·save)와 함께 만든다. 설계는 roadmap `eval.md`에 있다.
- 진짜 cache hit은 assembly 재기 뒤 작은 진짜 run으로 따로 봐야 한다. program이 하지 않는다.
- 판정의 한계: 3번 이하 trial로는 우연과 나빠짐을 완전히 가르지 못한다(기준 통과율이 60% 안팎인 guard는 우연히 worse가 될 수 있다). guard는 check 단위가 아니라 trial 전체의 통과로 세어, 한 check만 나빠지고 다른 check가 가린 경우는 보이지 않는다. 의심되면 `trials.max`를 올린 새 spec을 쓴다. 규칙은 어림하지 않는다.
- judge를 얼마나 믿을지는 experimenter가 본다. 초기 smoke에서 사람 요청을 다 옮긴 call 본문을 일부 빠진 것으로 판정한 적이 있다.
- 열린 이슈 없음(`project-docs/issues`에 eval 주제의 열린 것이 없다).
