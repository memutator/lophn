# workflow: 사람과 agent가 step을 넘기며 도는 일을 정의하고 instance로 본다

상태: 로드맵. 2026-10-20 사람이 방향을 내고 planner가 정리했다. 2026-10-22 사람이 모양을 다시 정했다.
- 정의는 셋이고 project에서 PM이 만든다: 선언, `workflow.md`, 고르는 artifact.
- kind를 구분한다.
- instance와 step 상태를 추적하고 화면에 보인다.
- 사람도 참가자다.
- workflow에도 domain의 캡슐화를 지킨다.
- lophn program은 최대한 약하게 둔다. 정책과 예외, instance 고치기도 workflow 안의 agent가 한다.
- shell에서 workflow가 layout의 최상위 객체다.
- node 시각화는 kit에 두어 domain에서도 다시 쓴다.

계획 `workflow`의 옛 brief(연락처 모양)는 이 모양과 맞지 않는다. 미결정은 "정할 것"에 둔다.
배경 문서: `project-docs/architecture/agent-call.md`, `project-docs/architecture/agent-definition.md`, `project-docs/architecture/approval.md`, `project-docs/architecture/run.md`, `project-docs/architecture/domain.md`, `project-docs/architecture/artifact.md`, `project-docs/architecture/workspace-layout.md`, `project-docs/products/AGENT-ROLE.md`, `project-docs/products/roadmap/headless-schedule.md`.

## 왜

- 큰 일은 사람과 agent 여럿이 역할을 나눠 넘기며 돈다. 이 저장소의 eval loop가 그 예다(아래).
- lophn에는 이것을 만들 길이 없다.
  - 누가 어떤 step을 맡고 결과가 어디로 가는지 적을 곳이 없다.
  - 한 번 돌린 것(instance)이 지금 어느 step에 있는지 추적하고 볼 곳이 없다.
  - 사람이 참가자로 끼어 agent와 논의하는 길이 없다.
  - 사람이 workflow 단위로 일을 펼쳐 놓고 오가는 화면이 없다.
- 그러면서 lophn program은 약해야 한다. program이 workflow의 규칙("끝내기 전에는 call 금지", "이 결과면 통과")을 알면 그 코드는 domain에 기댄다. agent 성능이 오를수록 덜어내야 할 규칙이라 유지보수가 어렵고 반감기가 짧다.

## 예: eval loop

| 참가자 | 하는 일 | 규칙이 있는 곳 |
|---|---|---|
| planner(와 사람) | spec(가설, target, 예산, trial)을 쓰고 commit한다 | program: commit 안 된 spec은 돌지 않는다(`checkSpecLocked`) |
| runner | eval CLI를 돌리고, 질문 답과 채점을 새 subagent에게 시키고, `run.md`에 사실만 적는다 | skill 글(`.claude/skills/eval-run/SKILL.md`): 해석하지 않는다, 떨어진 trial만 다시 돌리지 않는다 |
| judge | item 하나를 `show` 글만 보고 채점한다. item마다 새 `haiku-xhigh`다 | program: enum과 인용을 검사하고, `오류`인 item만 다시 채점하게 한다 |
| experimenter | 판정을 해석해 `report.md`를 쓰고 다음 spec 초안을 쓴다 | skill 글(`.claude/skills/eval-experiment/SKILL.md`): 판정을 뒤집지 않는다, eval을 돌리지 않는다 |
| program | 판정 `default@1`, trial 정책, 예산 상한을 맡는다 | `tests/eval` 코드 |

- 결정적 처리와 검증(판정, 채점 검사, 예산)은 eval 전용 program(`tests/eval`)이 한다. lophn core에는 eval을 아는 코드가 없다.
- lophn의 workflow로 옮기면 step은 셋이다: spec(사람과 experimenter) → run(runner) → report(experimenter). judge는 step이 아니다. runner가 자기 skill대로 item마다 부르는 runner 안의 일이다.

## 모양

### 원칙: lophn program은 최대한 약하다

- lophn은 workflow 안의 agent와 program이 하는 말을 믿고, 기록하고, 보여 주고, 말한 곳에 전해 줄 뿐이다.
- step이 통과했는지, 결과가 맞는지 모른다. report 글을 해석하지 않는다.
- 순서를 강제하지 않고 call을 막지 않는다.
- 정책과 예외 처리를 lophn에 두지 않는다.
  - 어느 session으로 넘길지, 순서를 바꿀지, step을 다시 할지, 뒤 step을 고칠지는 workflow 안의 agent가 정한다.
  - 아무리 정형화된 일이라도 예외는 program이 다룰 수 없다. 그래서 agent를 쓴다.
- 결정적이고 딱딱한 제약이 필요하면 그 workflow의 program이 진다. eval의 "commit 안 된 spec은 돌지 않는다"를 `checkSpecLocked`가 지는 것과 같다.

### 정의: 선언, `workflow.md`, artifact

- 자리는 project의 `<data>/projects/<prj>/workflows/<name>/`이다. Operator 정의(`agents/`) 옆이다.
- 만들고 고치는 것은 그 project의 PM이다. project 안의 domain 여럿에 걸쳐도 workflow는 하나다.

**1. 선언(`workflow.yaml`)**
- API처럼 agent를 부르는 모양으로 쓴다. step마다 누가 맡는지, 그 참가자에게 줄 prompt, 받는 것과 내는 것, 다음이 어디인지를 적는다.
- lophn은 이해해야 하는 범위만 읽는다. 참가자, step의 담당, prompt, 다음이다. 나머지 칸은 workflow의 것이고, lophn은 모르는 칸을 틀렸다고 하지 않는다.
- 참가자마다 알아야 하는 것은 여기서 step의 `prompt`로 선언하고, 그것으로 전해진다.

**2. `workflow.md`**
- 1을 자연어로 쓴 글이다. 사람과 PM이 읽는다.
- 참가자 모두가 읽는 것이 아니다(캡슐화). 어떤 참가자가 읽어야 하면 1에서 그 참가자의 prompt가 그렇게 말한다.

**3. artifact (고른다)**
- 두 가지다.
  - 정적 artifact: workflow의 내용을 node로 그린 것
  - instance artifact: 한 instance의 실제 상태를 반영해 그린 것
- 모든 workflow에 필요하지 않다. workflow를 만들 때 PM이 사람에게 물어 정한다.
- 그림은 PM이 짠다. lophn은 instance artifact에 그 instance의 상태(step, report, 고친 기록)를 data로 줄 뿐이다.
- node를 그리는 방식은 kit component 하나다. PM의 artifact는 그 component에 data를 넘긴다. domain도 같은 component를 쓴다(아래 "node 시각화").

```yaml
kind: agent
participants:
  me: {role: human}
  experimenter: {role: operator, name: experimenter}
  runner: {role: operator, name: eval-runner}
steps:
  spec:
    by: me
    with: experimenter
    prompt: "사람과 다음 실험을 논의해 spec을 쓰고 commit한다."
    in: "지난 report.md"
    out: "commit한 spec 경로"
    next: [run]
  run:
    by: runner
    prompt: "spec대로 eval을 돌리고 run.md에 사실만 적는다. 채점은 item마다 judge에게 맡긴다."
    in: "spec 경로"
    out: "run.md 경로"
    next: [report]
  report:
    by: experimenter
    prompt: "판정을 해석해 report.md와 다음 spec 초안을 쓴다. 판정은 뒤집지 않는다."
    in: "run.md 경로"
    out: "report.md와 다음 spec 초안"
    next: [spec, end]
```

- step의 칸:
  - `by`: 맡는 참가자
  - `with`: 사람 step에서 사람과 맞닿아 논의하고 결과를 내는 agent
  - `prompt`: 그 참가자에게 전할 것
  - `in`, `out`: 받는 것과 내는 것. 자연어다
  - `next`: 다음 후보 step. 끝이면 `end`
- 참가자는 있는 agent(Operator, Project Manager, App Engineer, lophn), 사람, coding agent 같은 서드 파티 harness다.
  - harness 참가자는 설계에 두고 실제 구현은 미룬다.
  - 다른 project나 앱의 agent도 참가자일 수 있다.
- 선언은 틀이다. instance는 시작할 때 선언의 step을 옮겨 자기 step으로 갖고, 그 뒤로는 그 step을 agent가 고친다(아래 "instance 고치기").

### kind

선언의 `kind` 칸이 가른다. kind마다 나머지 칸이 다르다.

- **`agent`:** 참가자가 step을 맡고 결과를 report하면 lophn이 다음 담당에게 전해 준다. 위 eval이 이것이다.
- **`flow`:** program이 앱 tool과 agent 호출(run)을 섞어 부른다. agent 호출은 비결정적 함수다. `headless-schedule.md`에서 옮겨 왔다.
  - 선언은 driver program을 가리키고, program이 agent처럼 report를 낸다.
  - 기록, 화면, instance 고치기는 `agent`와 같다. 세부는 flow를 열 때 agent가 정한다.
- run과 job은 kind가 아니다. workflow를 시작하는 길이다(`headless-schedule.md`).

### instance와 report

- **시작.**
  - 사람이 화면이나 CLI로 instance를 시작하고 입력을 자연어로 준다.
  - 어느 step부터인지는 시작하는 쪽이 고르고, 고르지 않으면 첫 step이다.
  - 나중에 job도 시작한다.
- **report.** step을 맡은 agent와 workflow의 program이 step마다 report를 낸다. agent는 tool로, program은 CLI로 낸다.
  - report는 자연어 글이고, 다음 step 이름(`next`)을 붙일 수 있다.
  - 진행 중 글도 된다. runner는 "30개 중 17개 채점"을 report로 낼 수 있다.
  - "끝났다", "실패했다"도 report 글이 말한다. lophn이 판정하지 않는다.
- **넘기기.**
  - report에 `next`가 있으면 lophn은 그 step의 담당에게 step 메시지를 넣는다.
  - 어느 session으로 넣을지도 넘기는 쪽이 report에 적는다. 새 session이거나 이 instance에서 그 참가자가 쓰던 session이다. 적지 않으면 새 session이다.
  - `end`면 instance를 끝났다고 적는다.
  - 어느 경우든 누가 그렇게 말했는지 같이 적는다.
- **상태.**
  - instance마다 report와 고친 기록이 줄로 남는다.
  - 사람은 화면에서 instance를 멈출 수 있다.

### instance 고치기

- instance의 상태는 workflow 안의 agent가 고친다. 지금 step, 뒤 step(담당, prompt, `in`, `out`, `next`), 새 step 더하기, step 다시 하기, 끝이 모두 그렇다.
- 누가 고치는지는 workflow가 정한다.
  - coordinator 참가자를 둘 수 있다.
  - coordinator 없이 지금 step을 맡은 agent가 뒤 step을 고칠 수도 있다.
  - lophn에 coordinator라는 특별한 칸은 없다.
- lophn은 누가 무엇을 고쳤는지 기록하고 고친 대로 따른다. 고칠 자격을 판정하지 않는다.
- agent는 instance 상태를 늘 받지 않는다. 고칠 일이 있을 때 tool로 읽고 고친다.
- 사람이 순서를 바꾸고 싶으면 그 agent에게 말한다. 화면에 step 옮기기 단추를 따로 두지 않는다.

### agent가 아는 것 (캡슐화)

- domain처럼, agent는 자기 일의 in/out만 알면 된다.
- 자기 step이 오면 메시지 하나를 받는다. 들어 있는 것:
  - workflow와 instance
  - step 이름
  - 선언에 적힌 그 step의 `prompt`
  - 받는 것(앞 step의 report 글)과 낼 것
  - 다음 후보 step 이름
- `workflow.md`, workflow 전체 그림, 다른 참가자는 모른다. system prompt에 workflow를 싣지 않는다.
- step 안에서 무엇을 하고 누구를 부르는지는 그 agent의 일이다. 선언은 그것을 모른다.

### 사람 step

- 사람은 승인 단추가 아니라 실제로 논의하는 참가자다.
- 사람 step이 오면 lophn은 step 메시지를 `with`의 agent에게 넣고, 화면에 사람 차례를 보인다. 사람은 그 agent와 대화로 논의한다.
- 결과는 사람과 맞닿은 agent(`with`)가 report로 낸다.

### 묻기

- instance 안의 agent step은 묻지 않는다(unattended).
  - 사람이 instance를 시작한 것이 그 사슬을 맡긴 것이다.
  - 지금 run 입력이 싣는 unattended 표시(`architecture/approval.md` turn mode)를 쓴다. approval 설계는 바꾸지 않는다.
- 사람 step의 대화에서 사람이 보낸 메시지가 연 turn은 지금처럼 attended다. 사람이 거기 있다.

### 화면과 shell

- **workflow가 layout의 최상위 객체다.**
  - workflow마다 자기 pane, tab, float, detached, minimized를 갖는다. 지금은 project 창 하나가 layout 하나다(`architecture/workspace-layout.md`).
  - title bar 가운데의 selector로 workflow를 바꾼다. 바꾸면 그 workflow의 layout으로 통째로 바뀐다.
  - workflow에 들지 않는 일(파일, terminal, 대화)을 위한 default desk를 하나 둔다.
- **project sidebar는 VS Code처럼 activity bar로 바꾼다.**
  - 왼쪽 끝에 icon 세로 줄을 늘 두고, 누르면 그 panel을 연다. 열린 icon을 다시 누르면 panel을 접는다.
  - 지금은 sidebar 위의 icon segmented control(`project-sidebar.tsx`의 `TABS`: explorer, agent, artifact, domain)과 접힌 rail(`rail.tsx`)이다. workflow가 더해지면 icon이 너무 많아 segmented control로는 감당하지 못한다.
  - 처음 줄은 Explorer, Agents, Artifacts, Domains, Workflows다.
- **workflow의 layout에서 보는 것:** instance, 사람 step의 대화, artifact(있으면).
- **artifact가 없는 workflow는 lophn의 기본 view로 본다.** instance 목록과 step마다의 report 줄이다.
- 모양은 계획에서 wireframe으로 정한다(`ui-design` skill).

### node 시각화 (kit)

- node 시각화는 `@lophn/ui`(`packages/design`)의 component 하나다. workflow와 domain이 같이 쓴다.
  - 지금 kit의 `GraphDiagram`(`@lophn/ui/data`)을 키운다. node(id, label), edge(from, to, label), 왼쪽에서 오른쪽으로 층을 쌓는 결정적 배치는 이미 있다.
  - 두 쪽이 같이 쓰는 것을 더한다. 예: node마다 상태 표시와 짧은 글(마지막 report)이다.
  - 상태 값의 뜻은 component가 모른다. 넘겨받은 이름과 글을 보일 뿐이다.
- 쓰는 곳은 셋이다.
  - lophn 화면(renderer): 지금처럼 import한다.
  - 사용자 앱: 지금처럼 kit의 판 고정 사본으로 쓴다.
  - artifact: 아래 길로 쓴다.
- **artifact에서 쓰는 길.**
  - 지금 artifact는 봉한 view라 kit을 import하지 못하고 token CSS만 받는다.
  - artifact view가 판을 고정한 kit browser build를 가상 path로 내준다. 지금 token CSS를 넣는 길, 가상 `data/_entries.json`과 같은 방식이다.
  - PM의 artifact HTML은 그것을 불러 node와 상태 data만 넘긴다.
  - 그래서 workflow의 정적·instance artifact와 domain artifact가 같은 node 그림을 쓴다.
- kit component가 바뀌면 gallery(`tools/wireframes`의 kit page)도 같이 고친다(`ui-design` skill).

### lophn이 하지 않는 일

- step 통과 판정, 결과 검증, report 글 해석
- 순서 강제, 넘기기 정책, 예외 처리, 선언 밖 call 막기
- workflow 그림 그리기. PM의 artifact가 그린다. lophn의 기본 view는 목록과 글뿐이다
- workflow 전용 판정과 검증을 core에 두기. workflow의 program이 한다
- 비용 관측과 상한

### 결정적 처리와 검증

- workflow에 필요한 결정적 처리와 검증은 그 workflow 쪽 program이 한다. eval의 `tests/eval`과 같다.
- 그 program은 lophn agent가 직접 짠다. 길고 복잡한 것은 coding agent의 일이다(2026-10-21, `problem-ticket.md`).
- 지금 lophn agent가 coding agent에게 맡기는 길은 없다. Router가 받는 곳이 `coding_agent`인 call을 거절한다. harness 참가자를 구현할 때 이 길도 같이 연다.

## 지금 코드

- **Operator 정의**
  - `<data>/projects/<prj>/agents/<agt_id>.md` 또는 `<data>/apps/<app>/agents/<agt_id>.md`다(`packages/protocol/lophn-agent/operators.ts`의 `operatorDefinitionSchema`).
  - 만들고 고치는 쪽은 사람(UI)과, 자기 place 안의 PM과 App Engineer(`operator.create`, `operator.update`)다.
- **file 쓰기 범위.**
  - PM은 project 폴더와 그릇의 domain 폴더를 file tool로 쓴다(`placeScope`, `packages/core/agent-roles/place/place-folders.ts`).
  - project의 data 폴더(`agents/`가 있는 곳)는 범위 밖이다.
  - workflow를 읽는 코드는 없다.
- **입력 넣기.**
  - 사람 메시지, agent call, program 알림은 모두 Router 한 입구로 session에 들어간다(`architecture/event.md`).
  - run은 `SendMessage`에 `unattended: true`를 실어 넣고, 그 turn과 그 turn이 보낸 call 사슬이 unattended가 된다. 이 표시는 지금 run만 싣는다(`architecture/run.md`, `architecture/approval.md`).
- **run.**
  - CLI(`lophn agent run`)가 시작한다.
  - run은 그 입력을 가져간 turn이 끝나면 닫히고, 뒤에 온 답은 session에만 남는다(`architecture/run.md`).
- **call.**
  - tool `call`의 `to`는 셋이다: 열린 session, `{role, place?, name?}`의 새 session, 열린 session이 없으면 새 session.
  - 받는 곳이 `coding_agent`로 풀리면 Router가 거절한다(`architecture/agent-call.md`).
  - 부르는 것 자체는 묻지도 막지도 않는다. 받은 agent는 자기 할당으로만 일한다(AGENT-ROLE T5, T6).
- **artifact.**
  - agent가 domain의 `<data>/domains/<dom>/artifacts/<name>/`에 `index.html`과 `data/*.json`을 file tool로 쓴다.
  - shell main이 봉한 view(`lophn-artifact://`)로 그리고, 폴더가 바뀌면 다시 load한다.
  - `data/_entries.json`은 program이 만드는 가상 목록이다.
  - 사람의 폴더에 있는 `.html`도 같은 view로 연다(`architecture/artifact.md`).
  - artifact 문서에는 token 전체와 appearance CSS를 넣는다(`packages/shell/main/desktop/wiring/appearance.ts`). kit component는 받지 못한다. CSP는 `script-src 'self' 'unsafe-inline'`이다(`packages/shell/main/artifact/serve.ts`).
  - workflow 자리의 artifact는 없다.
- **kit의 node 도표.**
  - `GraphDiagram`(`packages/design/components/data/chart/graph-diagram.tsx`)이 있고 `@lophn/ui/data`로 나간다.
  - 입력은 node `{id, label}`와 edge `{from, to, label?}`다(`types.ts`). 배치는 d3-shape를 쓴 왼쪽→오른쪽 층 배치이고 순수 함수다(`graph-layout.ts`).
  - node 상태 표시는 없다. 쓰는 곳은 gallery뿐이다(`tools/wireframes/pages/kit/data/`).
- **workspace layout.**
  - project 창 하나가 layout 하나다: pane(1-2)의 탭, floats(접으면 minimized), detached 창.
  - project마다 `layout.json` 하나에 저장한다.
  - 상단 bar 왼쪽에 breadcrumb과 접힌 패널 span이 있다.
  - "탭 하나는 한 곳에만 있다"를 model 함수와 위험 test가 지킨다(`architecture/workspace-layout.md`).
- **화면.** call 진행은 사람 화면의 대상이 아니다(`architecture/event.md`). 사람에게 가는 것은 앱 화면과 agent 결과(대화)다.

## 무엇을 만드나

1. **정의 읽기.** project의 `workflows/<name>/`(선언, `workflow.md`, artifact)를 읽는다. PM의 file 쓰기 범위에 더한다.
2. **instance와 report 기록.** instance 표(선언에서 옮긴 자기 step), report와 고친 기록의 줄. 시작은 화면과 CLI다.
3. **report 길.** agent의 tool, program의 CLI.
4. **instance 읽기·고치기 tool.** 참가자 agent가 쓴다.
5. **넘기기.** report의 `next`와 session을 보고, 그 step의 담당에게 step 메시지(그 step의 prompt 포함)를 unattended로 넣는다.
6. **사람 step.** `with`의 agent에게 넣고 화면에 사람 차례를 보인다.
7. **artifact.** workflow 자리의 artifact를 봉한 view로 열고, instance artifact에 instance 상태를 data로 준다. artifact가 없을 때는 기본 view로 보인다.
8. **node 시각화 kit.** kit의 `GraphDiagram`을 workflow와 domain이 같이 쓰게 키우고, artifact view가 kit build를 내주게 한다. gallery도 고친다.
9. **shell.** workflow별 layout, title bar 가운데 selector, default desk.
10. **PM 지침.** workflow를 만들고 고치는 법. 만들 때 artifact를 둘지 사람에게 묻는다.
11. **뒤로 미루는 것.** flow(아래 "정할 것" 1을 정한 뒤), 서드 파티 harness 참가자.

## 정한 것 (사람)

2026-10-20
- 딱딱한 규칙을 program에 두지 않는다. agent 성능이 오를수록 덜어내야 하고, 유지보수가 어렵고, 코드의 반감기가 짧다.
- 결정적 처리와 검증은 agent가 짜게 한다. 그래야 lophn이 domain에 기대지 않는다. 2026-10-21에 바꿨다: lophn agent가 직접 짠다.
- workflow file 안에서 일회용 agent를 정의하지 않는다. 참가자는 있는 agent다. 2026-10-22에 사람과 서드 파티 harness를 더했다.
- flow도 workflow의 kind로 둔다.
- workflow 안에서는 묻지 않는다. workflow로 쓴다는 것은 바깥 효과까지 책임지겠다는 뜻이다.

2026-10-22. 10-20의 "lophn은 연락처를 알려 주는 데까지"와 "상태를 두지 않는다"는 아래로 바뀌었다.
- workflow 선언을 domain 밑에 두지 않는다. workflow는 여러 domain에 걸치는 일이 더 많다.
- 선언에 kind 구분을 둔다.
- workflow는 instance가 된다. workflow에 정의된 대로 step마다 상태를 갖고, 추적되고, 화면에 보인다.
- 그래도 lophn program은 강하게 제약하지 않는다. 최대한 약하게 둔다.
  - lophn은 workflow 안의 agent와 program의 말을 믿기만 한다. 통과했는지도 모른다.
  - 진짜 결정적이고 딱딱한 제약이 필요하면 그것은 workflow에서 다뤄지는 program의 책임이다.
- 진행은 agent가 받은 대로 쓰는 자연어 칸으로 보인다. lophn이 그 뜻을 이해할 필요가 없다.
- "같은 참가자가 다시 step을 받을 때 session을 이어 쓸지" 같은 정책은 workflow에서 정한다. lophn이 정하지 않는다.
- instance 상태는 workflow 안에서 고친다. coordinator가 고칠 수도 있고, 그 step을 진행 중인 agent가 뒤 step을 고칠 수도 있다. 사람이 화면에서 step을 옮기는 길을 따로 두지 않는다.
- program이 약해야 하는 까닭: 아무리 정형화된 작업이라도 예외 처리를 program이 할 수 없다. 그래서 agent를 쓴다. 이 원칙은 workflow의 모든 정책과 예외에 같이 적용한다.
- 사람도 workflow의 참가자다. 승인 단추가 아니라 실제로 논의한다. 사람 step의 결과는 사람과 맞닿은 가장 가까운 agent가 낸다.
- 연락처를 늘 싣지 않는다.
  - domain을 둔 가장 큰 이유가 추상화와 캡슐화다.
  - agent는 어디까지 알면 되는지, 상대의 in/output이 무엇인지만 알면 되고, 그 domain을 전부 알지 않아도 동작한다.
  - workflow가 이 철학을 깨면 안 된다.
- coding agent 같은 서드 파티 harness를 참가자로 둘 수 있게 한다. 실제 구현은 미룬다.
- 비용은 다루지 않는다.
- approval은 끝났다. 바꾸지 않는다.
- workflow 정의는 셋이다.
  1. programmatic하게 선언하는 것.
     - API처럼 agent를 부르고 작성한다.
     - 모두 lophn이 이해할 수 있어야 하는 것은 아니다. lophn이 이해해야 하는 범위 안에서만 이해하면 된다.
  2. `workflow.md`.
     - 1을 자연어로 쓴 글이다.
     - 모든 참여자가 읽어야 하는 것은 아니다(캡슐화).
     - 참여자마다 알아야 하는 prompt는 1에서 선언되고, 그것으로 전달된다.
  3. workflow artifact. 정적인 것(workflow 내용을 node처럼 시각화)과 instance의 실제 상태까지 반영해 보이는 것 둘이다.
- 모든 workflow에 3이 필요한 것은 아니다. workflow를 만들 때 정한다. PM이 물어보면 된다.
- workflow를 만드는 것은 PM의 책임이다.
- shell에서 workflow가 layout의 최상위 객체다.
  - workflow 자체가 pane, tab, float, detached, minimized를 갖는다.
  - title bar 중앙의 별도 selector로 전환한다.
- workflow의 node 시각화 방식을 domain에도 적용한다. 그래서 우리 kit에서 재사용 가능하게 만든다.
- sidebar는 VS Code 같은 activity bar(리본)로 바꾼다. 항목이 너무 많아져 segmented toggle로는 감당하지 못한다.

## 정한 것 (agent)

- **workflow는 project에 산다.** 근거:
  - workflow를 만드는 것은 PM의 책임이다(사람).
  - 참가자인 Operator 정의도 그릇에 산다.
  - domain에 두지 않는 까닭은 그대로다: 여러 domain에 걸치고, domain을 archive하면 같이 사라지고, domain이 0개인 project에는 둘 곳이 없다.
  - 앱의 agent는 참가자로 부른다. 앱 그릇에는 workflow를 두지 않는다.
  - lophn이 갖는 전역 자리도 두지 않는다.
- **workflow 하나가 폴더 하나다.** 선언, `workflow.md`, artifact가 함께 산다.
- **선언은 YAML file(`workflow.yaml`)이다.**
  - lophn은 자기가 읽는 칸만 검사하고, 나머지 칸은 두고 읽지 않는다.
  - kind는 `agent`와 `flow` 둘이고 꼭 적는다. 빠지면 기본값으로 읽지 않는다.
- **lophn이 아는 구조는 넘기는 데 드는 것뿐이다.**
  - 아는 것: 참가자, step의 `by`·`with`·`prompt`, step 이름, report의 `next`와 session.
  - `in`, `out`, report 글은 자연어이고, 보이고 전하기만 한다.
  - 담당이 없는 step처럼 넘길 수 없는 말을 받으면 그대로 기록하고 화면에 보인다. 고치는 것은 agent의 일이다.
- **step 메시지에는 그 step의 것만 싣는다.** prompt, 받는 것, 낼 것, 다음 후보다. `workflow.md`와 다른 step은 싣지 않는다.
- **step 안에서 갈라지는 일(item마다 judge)은 선언에 두지 않는다.** 담당의 일이다. 보이고 싶으면 담당이 report 글로 적는다.
- **instance 안의 agent step은 unattended다.** 사람이 instance를 시작한 것이 사슬을 맡긴 것이고, run이 쓰는 표시가 이미 있다.
- **시작을 위한 칸을 따로 두지 않는다.** 시작하는 쪽이 step을 고르지 않으면 첫 step이다.
- **틀린 선언은 그 workflow만 빼고 이유를 보인다.** agent는 읽기 tool로, 사람은 화면으로 본다.
- **instance는 여럿이 동시에 돌 수 있다.** instance끼리 섞이지 않게 step 메시지에 instance를 싣는다.
- **artifact가 없는 workflow는 lophn의 기본 view로 본다.** 사람이 instance 상태를 볼 길이 늘 있어야 한다(사람: instance는 추적되고 화면에 보인다). 기본 view는 목록과 글뿐이다.
- **instance artifact에 lophn은 상태를 data로만 준다.** 지금 artifact의 가상 `data/_entries.json`과 같은 길이다. 그림은 PM이 짠다.
- **node 시각화는 kit의 `GraphDiagram`을 키워 쓴다.** 근거: 같은 일을 하는 component가 이미 kit에 있고, kit은 renderer와 사용자 앱이 같이 쓰는 자리다(`architecture/ui-kit.md`). 새 component를 따로 두면 domain과 workflow의 그림이 갈라진다.
- **artifact에는 kit build를 가상 path로 내준다.** 근거: 사람이 artifact는 PM이 만든다고 했고, PM이 그림을 매번 손으로 짜면 domain과 workflow의 그림이 같아지지 않는다. token CSS를 이미 같은 방식으로 넣고 있다. artifact가 data만 쓰고 lophn 화면이 그리는 안은 artifact의 자유를 없애고, domain artifact에는 쓸 수 없다.
- **workflow에 들지 않는 일을 위한 기본 layout을 하나 둔다.** project 창의 지금 일(파일, terminal, 대화)은 workflow 없이도 돌아야 한다.

## 정할 것

1. **결정적 program이 사는 곳.** lophn agent가 직접 짠다는 것은 정했다(2026-10-21). 사는 곳은 정하지 않았다.
   - 앱이면 release와 App Engineer가 따라온다. 대신 program이 agent를 부르는 SDK(`cap-agent`)와, 앱 tool의 120초 제한과 write 직렬화 밖에서 도는 entry가 필요하다(`headless-schedule.md` "지금 코드").
   - 앱이 아니면 고정, 관측, 고칠 주인을 무엇이 맡는지 정해야 한다.
   - program이 report를 내는 CLI의 자격도 같이 정한다.

## 단계

- `headless-schedule.md`의 1단계(headless run)는 land했다. instance의 unattended는 그 표시를 쓴다.
- 계획 둘로 연다. 옛 `workflow` brief는 지운다.
  - `workflow`: 정의 읽기, instance와 report, instance 고치기, 넘기기, 사람 step, 기본 view, artifact 열기와 instance data, node 시각화 kit과 artifact의 kit build, PM 지침.
  - `workflow-shell`: workflow별 layout, title bar selector, default desk. workspace layout의 저장 꼴과 위험 test가 바뀌는 일이라 따로 연다. 화면 모양은 wireframe으로 정한다(`ui-design` skill).
- flow는 "정할 것" 1을 정한 뒤, 서드 파티 harness 참가자는 그 뒤에 따로 연다. job이 instance를 시작하는 것은 `headless-schedule.md`의 job 계획과 맞춘다.

test(AGENTS.md "속도", `write-test` skill):
- instance의 unattended가 할당을 넓히지 않는다. step을 받은 agent는 그래도 자기 할당에 없는 앱 tool을 쓰지 못한다.
- project의 `workflows/`는 그 project의 PM만 file tool로 쓴다. Operator는 쓰지 못한다.
- workflow를 바꾸고 돌아와도 탭이 사라지거나 두 자리에 있지 않다. workspace layout의 "탭 하나는 한 곳에만" 위험 test를 workflow 층까지 넓힌다.

계획 끝에 고칠 것:
- 새 architecture 문서(workflow)
- `architecture/approval.md`, `architecture/agent-call.md`(unattended 표시를 싣는 곳에 workflow step 메시지를 더한다)
- `architecture/agent-definition.md`(project의 `workflows/`)
- `architecture/artifact.md`(workflow 자리의 artifact, instance data, kit build)
- `architecture/ui-kit.md`(node 시각화 component, artifact가 kit을 받는 길)
- `architecture/workspace-layout.md`(workflow 층)
- `architecture/event.md`(사람 화면에 workflow instance)
- `project-docs/products/AGENT-ROLE.md`(workflow 참가자, 사람 참가자, PM의 workflow 책임)
- changelog 열린 판

## 끝남 기준

- lophn 저장소 project에서 PM이 eval workflow(선언, `workflow.md`, 사람이 고르면 artifact)를 만들고 사람이 instance를 시작하면 아래가 된다.
  - spec step에서 사람은 experimenter와 대화로 논의하고, experimenter가 낸 report로 run step이 runner에게 간다.
  - runner가 받은 step 메시지에는 선언의 run step `prompt`가 있고 `workflow.md`는 없다.
  - runner가 낸 report 글("30개 중 17개 채점" 같은 것)이 instance artifact, 또는 artifact가 없으면 기본 view에 그대로 보인다.
  - 정적·instance artifact의 node 그림은 kit component로 그려진다. domain artifact도 같은 component를 불러 node를 그릴 수 있다.
  - runner가 `next: report`로 report하면 report step이 experimenter에게 간다. `end`면 instance가 끝났다고 보인다.
  - 선언에 없는 흐름도 agent가 instance를 고치면 그대로 간다. 예: experimenter가 report를 쓰다가 run을 한 번 더 돌리기로 하고 instance에 run step을 다시 넣으면, lophn은 runner에게 넘기고 고친 기록을 보인다.
  - 사람이 화면에서 instance를 멈출 수 있다.
- title bar selector로 eval workflow와 default desk를 오가면 각자의 layout(pane, tab, float, detached, minimized)이 그대로 돌아온다.
- runner와 experimenter의 system prompt에 workflow가 없다.
- lophn core에 eval을 아는 코드와 report 글을 해석하는 코드가 없다.

## 하지 않는 것

- **step 통과 판정, 결과 검증, 순서 강제.** lophn은 report를 믿는다. 딱딱한 제약은 workflow의 program이 진다.
- **넘기기 정책과 예외 처리.** session 고르기, 순서 바꾸기, 다시 하기, instance 고칠 자격 판정을 lophn에 두지 않는다. workflow 안의 agent가 한다.
- **사람의 step 옮기기 단추.** 사람은 agent에게 말한다.
- **workflow 그림 그리기.** PM의 artifact가 그린다.
- **workflow를 agent prompt에 늘 싣기, 연락처.** agent는 자기 step의 prompt와 in/out만 받는다.
- **선언의 반복·갈라짐 문법.** step 안의 일은 담당의 일이다.
- **call 막기.** 선언 밖 call도 묻지도 막지도 않는다. 받은 agent의 동작은 그 agent의 할당이 거른다.
- **비용 관측과 상한.**
- **approval 바꾸기.**
- **workflow file 안의 일회용 agent.**
