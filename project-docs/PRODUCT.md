# lophn

lophn은 사람이 자기 도메인과 업무 규칙을 담은 software를 agent에게 시켜 만들고, 오래 쓰고, 유지하게 해 주는 로컬 데스크톱 작업 공간이다.

## 1. 왜 지금인가

**구현 비용이 내려갔다.** coding agent로 바이브코딩을 하면서 software를 구현하는 비용이 크게 낮아졌다. 구현은 이제 개발자만의 일이 아니다.

**그래서 내 needs에 맞춘 작은 앱이 가장 값어치 있다.** 개인이 바이브코딩으로 Adobe 같은 대형 SaaS를 대체하기는 아직 어렵다. 그보다 비용 대비 효용이 가장 큰 지점은 내 needs에 맞춘 micro 앱이다.
- 지금까지 앱은 자기 도메인 안에서 범용으로 만들어야 했다. VS Code도 모든 개발자의 요구를 들어줄 수는 없고, 그 마찰은 사용자 몫이었다.
- 이제는 내 도메인, 내 업무 규칙, 내 취향만을 위한 앱을 만들 수 있다.

**하지만 앱이 늘면 유지 비용이 커진다.** 앱 하나는 싸지만 여럿이 모여 나만의 앱 생태계가 되면 다르다. 앱이 조용히 깨지고, 왜 깨졌는지 모르고, 앱끼리 재료를 나누지 못해 두 번째 앱도 처음처럼 비싸다. 개발자에게도 무거운 일이고, 소프트웨어 공학을 모르는 사람에게는 더 그렇다.

**그리고 사람에게는 채팅 화면만으로는 모자라다.** 지금까지의 개인 AI 비서(Hermes, Grok bot 같은 것)는 채팅 화면이 중심이었다. 하지만 사람에게는 여전히 UI가 필요하다.

## 2. lophn의 도메인: 메타 소프트웨어 엔지니어링

lophn은 사용자의 도메인에 기대지 않는다. lophn의 도메인은 사용자가 자기 도메인의 software를 만들고 쓰고 유지하는 작업 공간을 만드는 것이다.

| 층 | 무엇 | 누구의 것 |
|---|---|---|
| 사용자의 도메인 | 캘린더, 거래처, 견적, 내 문서의 계약. 앱, domain(kind 파일, `DOMAIN.md`, skill, artifact, 앱 tool), 사용자 package, 사람과 agent가 step을 넘기며 도는 workflow로 만들어진다 | 사용자가 온전히 소유한다. 범용화나 정규화를 신경 쓰지 않고 그 사람에게 맞춘다 |
| lophn의 도메인 | 그 software를 만들고, 고정하고, 관측하고, 고치고, 되돌리고, 권한을 주는 일. release, preview, invocation, 앱 log, grant, event | lophn |

- 사용자의 도메인은 그릇 안에 domain으로 나뉜다. 그릇은 project(폴더 작업 공간)와 app(software 작업 공간)이고, domain은 그 안의 책임 경계다. 그릇 하나에 domain이 여럿 있을 수 있고, 모든 앱은 domain을 하나 이상 가진다. 다른 그릇의 domain은 같은 것을 또 만들지 않고 공개 tool로 참조한다(`architecture/domain.md`).
- 도메인 쪽은 미리 범용으로 만들어 두지 않는다. 필요할 때 agent가 만들어 붙인다. 다른 software의 extension처럼 쓰지만, lophn이 따로 extension이라는 개념을 두는 것은 아니다. 구현 비용이 내려갔으니 그때그때 만들어 쓰면 된다.
- 개발자라면 CLI와 script를 직접 만들고 유지했을 일을, 코드를 모르는 사람도 할 수 있게 한다.
- 앱 마켓을 열지 않는 이유도 여기 있다. 앱을 배포하고 그 책임을 지는 것보다, 한 사람에게 맞춘 앱을 만들고 쓰게 하는 것이 lophn의 일이다.

```
사람 ─도메인 이야기─▶ lophn agent ─구현과 유지보수─▶ 사용자의 program(앱, script)
 ▲ ▲                                                       │ │
 │ └──────── GUI ◀──────── agent ◀──────── tool ───────────┘ │
 └──────────────────── 앱 화면에서 직접 씀 ────────────────────┘
```

- 사람은 앱 화면을 열어 program을 직접 쓴다.
- agent도 program을 tool로 쓰고, 그 결과를 GUI로 사람에게 보인다.

## 3. 책임 분배: human, agent, program

agent에 대한 기대가 너무 크다. AI면 다 된다고 여기는 사람이 많다. lophn은 사람, agent, program이 각자 자기 자리를 지키는 것이 중요하다고 본다.

- **program**은 싸고 빠르고 결정적으로 할 수 있는 일을 맡는다. LLM이 똑똑해져도 compiler를 대체할 이유는 없다. Claude Code에 돈을 내는 것도 model만이 아니라 그것을 둘러싼 software 덕분이다.
- **사람**은 무엇을 만들지 정하고, 결과를 검증할 수 있게 해 두고, 결정한다. 바이브코딩 시대에도 이것은 사람만의 능력이자 책임이다.
- **agent**는 의미를 판단하고, 사람의 말을 software로 옮기고, 돌본다.

lophn 안에서는 이렇게 나뉜다.

| 주체 | 맡는 일 |
|---|---|
| 사람 | 도메인을 이야기한다. 무엇을 만들지와 취향을 정한다. 앞에서 한 번 허락한다(grant). 결과를 확인한다. workflow에서는 step을 맡아 agent와 논의하는 참가자다 |
| lophn agent | 무엇을 만들고 고칠지 정하고, 짓고, 쓰고 돌본다. agent는 lophn과 사람이 만든 agent이고, 하는 일은 session이 일하는 place가 정한다: home에서는 기획하고 맡기며 경계를 넘는 판단을, project에서는 그 project와 domain을, 앱에서는 그 앱의 코드와 domain을 맡는다. 개인 앱은 그 앱 place의 session이 직접 설계하고 짓고 고친다. 길고 복잡한 coding agent의 일은 하지 않는다 |
| coding agent | 길고 복잡한 코딩을 맡는다. 사람이 원래 쓰던 Claude Code, Codex 등이다 |
| lophn program | 결정적인 판정을 맡는다: release 고정과 검사, 관측과 앱 log, grant 판정, invocation 기록과 rewind, event. workflow에서는 판정하지 않고 말한 대로 기록하고 보이고 전한다(아래) |

### 책임은 일마다 근거를 따져 나눈다

agent가 세상을 아는 길은 사람과 program 둘뿐이다. 그래서 어떤 사실이 필요할 때 그것을 사람에게 들을지 program에게 들을지를 정해야 한다. 이것은 정해진 공식이 아니다. 그 일에서 누가 무엇을 이미 알고, 그 일이 얼마나 자주 일어나고, 각자에게 맡기면 무엇이 드는지를 그때그때 견줘 가장 말이 되는 쪽에 둔다.

예: pdf 문서의 목차.
- pdf의 목차는 program이 결정적으로 뽑지 못한다. 그래서 그 project place의 agent가 만든다.
- 그럼 pdf가 바뀌었을 때 목차를 다시 만들어야 한다는 것은 누가 알아야 할까. 처음에는 program이 파일 hash로 바뀜을 감지하고, agent를 불러, 목차가 정말 바뀌었는지 확인하게 하는 안이 나왔다.
- 하지만 hash가 바뀌었다고 목차가 바뀐 것은 아니다. 다시 저장만 해도 hash는 바뀐다. 게다가 바뀜을 감지하려면 file watch나 주기 검사 같은 장치를 따로 둬야 하고, 그 뒤에 agent 호출과 확인이 또 붙는다.
- pdf는 잘 바뀌지 않고, 바꾼 사람은 자기가 무엇을 바꿨는지 이미 안다. "pdf 바꿨으니 목차 새로 뽑아줘" 한마디가 가장 정확하고 가장 싸다.
- 그래서 목차를 다시 만드는 계기는 사람의 요청이다. program은 감지하지 않는다.

같은 질문이라도 근거가 다르면 답이 다르다. 사람이 고친 문서가 kind 계약을 깨는 일은 고친 사람이 자기가 계약을 깼는지 모를 수 있다. 그런 일은 program이 결정적으로 검사하는 쪽이 맞다.

### workflow에서 lophn program은 최대한 약하다

사람과 agent 여럿이 step을 넘기며 도는 일(workflow)은 그 project place의 agent가 정의하고, 사람이나 job이 instance로 시작한다(`architecture/workflow.md`). agent가 쓴 code가 agent와 앱 tool을 불러 가며 이끄는 workflow(flow)도 같다.
- lophn program은 workflow 안의 agent와 program이 하는 말을 믿고, 기록하고, 보이고, 다음 담당에게 전할 뿐이다. step이 통과했는지 모르고, 순서를 강제하지 않는다.
- 아무리 정형화된 일이라도 예외 처리는 program이 할 수 없다. 그래서 정책과 예외(순서 바꾸기, 다시 하기, 뒤 step 고치기)는 workflow 안의 agent가 instance를 고쳐 다룬다.
- 진짜 결정적이고 딱딱한 제약이 필요하면 그것은 그 workflow가 쓰는 program의 책임이다. lophn core는 workflow의 domain을 모른다.
- agent는 자기 step의 prompt와 in/out만 받는다. domain처럼 workflow도 캡슐화를 지킨다.

## 4. 핵심은 추상화

바이브코딩 사용자 대부분은 소프트웨어 공학을 모른다. lophn은 두 축으로 그것을 추상화한다.

**축 1. 소프트웨어 공학을 agent와 program이 맡는다.** 사람이 release, migration, 의존성, 오류 추적, 권한을 몰라도 software가 오래 돌아가게 한다.
- 앱에 관측을 심어 깨지면 사람보다 먼저 안다.
- 재료를 재사용해 두 번째 앱이 첫 번째보다 싸다.
- lophn agent, coding agent, lophn process가 함께 고친다.
- 쓸데없는 결정 피로를 줄인다. 결정은 앞에서 몰아서 하고 그 뒤에는 믿고 쓰며, 실수는 묻는 것으로 막지 않고 rewind로 복구한다.

**축 2. agent의 결과를 GUI로 추상화한다.** 사람에게 최종적으로 오는 interface가 채팅 화면에 갇혀서는 안 된다. 그렇다고 ERP 화면을 다시 만드는 것도 아니다. 예를 들어 ERP를 agent에게 시킨다면, 사람에게는 agent의 결과를 추상화한 새로운 GUI가 필요하다. 앱에 대해서도 사람에게 필요한 것은 로그 화면이 아니다. 앱 개발에서도 사람에게 필요한 것은 작업 목록이 아니라 내 앱에서 무엇이 달라졌는지다. 설계 메모나 agent끼리 주고받는 call처럼 agent가 만들고 읽는 것은 사람 화면에 따로 보이지 않는다. 사람이 맡긴 workflow instance의 진행은 보인다. workflow가 project 창 layout의 맨 위 단위(desk)이고, 정의할 때 고르면 node로 그린 artifact가 그 상태를 보인다.

## 5. 하지 않는 것

| 하지 않는 것 | 이유 |
|---|---|
| coding agent 만들기 | 길고 복잡한 코딩은 사람이 원래 쓰던 coding agent가 한다. 개인 앱은 작아서 그 앱 place의 lophn agent가 직접 짓고, 그 앱과 context에 가장 잘 닿는 것도 그 session이다 |
| 채팅 중심 비서 | 사람에게는 UI가 필요하다(4절 축 2) |
| 앱 마켓 | 한 사람에게 맞춘 앱이 목적이다(2절) |
| 사용자 도메인을 범용 모델로 미리 만들기 | 필요할 때 agent가 그 사람에게 맞춰 만든다(2절) |
| 원격, 여러 사람용 서비스 | 자기 컴퓨터에서 도는 개인 작업 공간이다 |

## 6. 지금 범위와 그다음

**MVP**
- 데스크톱 앱(shell)과 로컬 core
- lophn agent: lophn과 사람이 만든 agent. 정의는 전역이고 session이 place(home, project, app)를 갖는다
- coding agent: 사람이 터미널 탭에서 쓰는 coding agent의 상태(icon, 점, 알림)와 hook 설치. lophn agent는 coding agent에게 일을 맡기지 않는다
- 앱: 그 앱 place의 session이 직접 짓기(선언, 코드, 앱 test), release 준비와 검사, preview, activation, 실행, data, 앱 log, 사람이 넣는 앱 secret과 OAuth sign-in(값은 앱에 주지 않는다)
- domain: kind 파일과 검사, `DOMAIN.md`, skill, artifact, 앱 tool의 domain
- grant와 approval, event, rewind
- workflow: project에 정의(`workflow.yaml`, `workflow.md`, 고르는 artifact), instance와 report, 사람 step, workflow마다의 desk. project place의 agent가 쓴 code(`flow.ts`)가 agent와 앱 tool을 부르는 flow
- job: agent가 만들어 정해진 때 agent 호출, 앱 tool 호출, workflow 시작을 돌린다. 놓친 차례를 사람에게 묻고(hold), 사람은 화면에서 보고 끄고 지운다(`architecture/job.md`)

**그다음**
- agent의 결과를 추상화한 GUI(4절 축 2). MVP에서는 채팅 안에서 앱의 부품을 가져다 쓰는 데까지 간다.
- coding agent 같은 다른 harness를 workflow 참가자로 두기(`products/roadmap/workflow.md`)

## 7. 다른 문서

| 문서 | 다루는 것 |
|---|---|
| `products/AGENT.md` | agent와 place, place마다의 책임, session 사이의 call과 사람에게 올림(escalate) 정책 |
| `boundary-catalog.yaml` | lophn을 이루는 경계와 공개 계약 |
| `module-catalog.yaml` | 코드 module ↔ 경계 |
| `architecture/` | 여러 module에 걸친 메커니즘과 그 이유 |
| `products/roadmap/` | 아직 계획으로 열지 않은 큰 일 |
| `plan/` | 진행 중인 계획 |
| `issues/` | 열린 bug, defect, mistake |
| `products/change-log/` | 판마다 바뀐 동작·계약과 결정 |
