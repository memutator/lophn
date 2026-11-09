# agent platform: ACP, A2A, 사람이 정한 agent, third-party harness

상태: 로드맵. 2026-11-02~04 사람이 방향을 냈다. 단계 1~4, 6, 7, 9는 land했다(`project-docs/products/change-log/0.18/`). 2026-11-04 사람의 원문과 다시 맞춰 고쳐 썼다: 처음 정리는 ACP를 표준 Agent Client Protocol로 잘못 읽었고, A2A 재정립, 시야, 별도 설치, 앱의 prompt 조립 정의를 빼거나 뒤집었다. 그 정리는 git 기록에 있다.

## 사람의 말 (원문)

2026-11-02:

> App context Protocol을 정의하고 싶어
> 1. 단순 채팅 화면 이외에서 사용자 정의 앱에서도 login agent를 쓰기 위해서
> \- 예를 들어보자, 사용자가 코딩 테스트 문제 풀이 앱을 만들었어. 거기에 attempt list가 있고, 코드를 작성하는 Textarea 같은 게 있을 거 아냐. 그걸 복사붙여넣기 하는 게 아닌거지. 우리 lophn agent sdk로 어떻게 앱 컨텍스트를 프롬프트로 조립할 지를 정의해놓을 수 있다는거지. 에이전트 응답도 마찬가지고
> 2. Third party cli gui
> 터미널에서 claude gui 이렇게 치면 따로 번들된 우리 gui가 실행되어서 Cli 대신에 gui처럼 볼 수 있다는거지. 기본적으로 우리 login agent 채팅 화면과 비슷하지만 acp 규칙이 있으면 extension하기 쉽겠지? 물론 이 개발 및 유지보수 책임은 lophn agent야

> 그럼 어짜피 외부 client이랑 붙일 것도 아니고 사용자 정의 앱, lophn에서 호스트 할 앱이니까 자체 규격의 프로토콜을 가져도 상관 없겠지? 그게 맞겠지?

> agent definition에서 경우에 따라 내장 툴, 시스템 프롬프트를 덜어낼 수도 있음. 사용자가 완전히 커스터마이징이 가능하다는거지. 로픈 에이전트는 또 click command는 등록할 수 있으니까
> 그리고 또 third party agent harness도 우리 agent로 등록해서 프로그램틱 호출, tui 열기가 가능하게 할거야 워크플루우에서 쓰기 위해서. 그걸 위한 우리 자체 a2a 프로토콜도 제대로 갖추고 그 실행은 cli command가 맡는거고
> 굳이 빌트인더 다 덜어내게 하기 위한 목적은 앞선 예시에서 코딩 테스트 코치 에이전트는 굳이 lophn 툴들이나 프롬프트 스킬 따위가 필요 없다는거야. 그건 오히려 방해가 되고 비용의 문제도 있으니까. 프로그램틱 호출은 다른 애(codex, claude)들도 가능하지만 걔네들은 자기 자체의 규칙만으로 움직이잖아. 우리는 그냥 아예 사용자 정의 규칙에 맞춤할 수 있는거지

> A2A 프로토콜도 재정립이 필요할 것 같아. Lophn끼리도 그렇고 Lophn<->third party agent끼리도 그렇고. 게다가 이번에 workspace: home을 신설하면서 home에서도 agent를 둘 수가 있거든. 전역적으로 동작하는 agent야. Image Generator agent를 두면 어디서든 걔를 호출 할 수 있잖아. A2a애서 중요한 건 이 에이전트의 시야를 어디까지 허용할까가 중요하거든
> 그래서 명함의 규격도 중요하거든. 그리고 모달리티도 중요하고. 명함에서는 skille.diff 를 보여주는 게 좋을 거 같아. Agent간 추상화가 필요하다는거야. 서로 내부 구현은 몰라도 모달리티 스킬 차이 디프를 가지고 agent가 다른 agent에게 무엇을 기대할 수 있는 지를 알게 하는 것

> 그리고 저걸 lophn agent Sdk로 묶을 거 아니야 그치?

> 그리고 서드파티 gui도 그렇고 일반적인 사용자들 대다수에게는 크게 팔요하지 않는 기능일지도 몰라 그래서 lophn 하나에 다 두는 것보다도 별도로 설치하게끔. 근데 지금 그런 구조가 없거든

2026-11-03:

> 그리고 우리 harness에서 domain이라는 개념이 너무 직관적이지 않고 쓰임이 없는 거 같아서 덜어내고 싶어. kind.yaml 이런 거 다 필요 없을 거 같은데

2026-11-04:

> acp라고 꼭 채팅화면에 그거 할 필요가 없어, 기존에도 app에서 lophn agent 채팅 화면을 쓸 수 있기 때문에

> 그리고 lophn Claude code는 acp가 아니라 a2a protocol이야

> acp가 꼭 app 화면 내에서도 쓰이는 게 아니라 채팅 화면에서도 쓰일 수가 있어. 우리 lophn agent도 해당 프로토콜에 맞춰서 수정해야한다고. 지금은 renderer가 다 알아서 그리는 게 아니라 그런 lophn acp protocol이 정립되어 있으면 third-party-cli에다 gui를 덮어씌우기도 쉽다는 말이라고

> agent도 client는 그냥 빼자

> 경우에 따라는 그냥 일반적인 lophn agent, bare에 따라야. 그니까 bare이면 기본적으로 다 덜어져 있는 상태고 거기에다 사용자가 추가할 뿐인거야

> (별도 설치) 구조도 만들어놓자

> 일단 기본적으로 workspace : workspace 으로 endpoint 정책을 정하고 세부적으로 agent : agent 정하는 게 어때? 왜냐하면 A, B, C, D, E 각각의 workspace에 10개의 agent가 있다고 칠 때, agent마다 정책을 고르면 경우의 수가 너무 많아서 workspace 간의 정책으로 쉽고 크게 제한할 수 있다는 논리지

## 뜻 (사람이 확인한 것)

- **ACP(App Context Protocol)는 lophn 자체 규격이다.** agent와 그것을 보이는 화면 사이의 규격이다. 표준 Agent Client Protocol이 아니다. agent 쪽이 내놓는 것(turn, 메시지와 content block, tool 진행, 묻기, 흘러나오는 글)과 화면이 보내는 것(입력, 앱 context)을 정한다. 지금은 renderer가 session 기록을 제 나름대로 해석해 그린다. 규격이 서면:
  - lophn 채팅 화면은 ACP만 보고 그린다. lophn agent도 이 규격에 맞춰 고친다.
  - 사용자 앱 화면도 ACP의 화면이다. 앱이 SDK로 앱 context를 prompt로 어떻게 조립할지 정해 보내고, agent 응답을 받아 자기 식으로 그린다(예: 코드 textarea의 줄에 주석).
  - third-party CLI의 출력을 ACP로 옮기면 같은 채팅 화면이 그 위에 GUI를 덮는다(`claude gui`).
  - agent가 앱 live 화면을 읽거나 조작하는 길은 두지 않는다. 자기 앱의 preview를 테스트하려고 다루는 것은 연다(사람, 2026-11-08: 앱을 CDP로 테스트한다. 계획 `browser-use`의 preview 탭과 `lophn browser`). agent는 자기가 연 browser 탭과 preview 탭만 다룬다(`architecture/browser-tab.md` "agent가 다루는 탭").
- **A2A는 agent와 agent 사이의 lophn 자체 규격이다.** lophn끼리, lophn ↔ third-party harness. home의 전역 agent(Image Generator)를 어디서든 부른다. 핵심은 불린 agent의 시야다. 시야는 workspace와 workspace 사이의 정책이 크게 정하고 agent와 agent 사이의 정책이 예외로 덧쓴다. 명함에 modality와 skill diff를 싣고, 내부 구현을 몰라도 무엇을 기대할지 안다. third-party harness는 CLI 명령으로 실행한다.
- **bare:** 기본으로 다 덜어진 상태이고 사람이 더한다(tool, lophn 명령, 앱 command, MCP, skill). lophn agent는 지금 그대로다.
- **SDK:** 위 것을 lophn agent SDK로 묶는다.
- **별도 설치:** 대다수에게 필요 없는 기능(third-party GUI 등)은 lophn 본체와 따로 설치한다. 그 구조를 만든다.
- **domain과 kind를 지운다.**

## 단계

| 단계 | 할 일 | 선행 | 상태 |
|---|---|---|---|
| 1 | domain과 kind 지우기 | 없음 | 끝남(계획 remove-domain) |
| 2 | content block: call 본문과 답, 사람 메시지가 block으로 | 없음 | 끝남(계획 content-block) |
| 3 | bare runtime: 정의 본문과 고른 tool만 | 1, 2 | 끝남(계획 bare-runtime, bare가 skill도 더하기는 계획 agent-card) |
| 4 | ACP 규격과 채팅 화면: protocol에 ACP를 정하고 lophn agent가 내놓는 것과 채팅 화면이 그리는 것을 ACP로 | 2 | 끝남(계획 acp) |
| 5 | 앱 화면의 ACP: SDK(`@lophn/agent`)로 앱이 context의 prompt 조립을 정하고 agent 응답을 받아 그린다 | 4 | 끝남(계획 app-agent, `project-docs/architecture/app-call.md`의 "앱 화면의 agent session"). 옛 계획 agent-screen은 agent가 client인 꼴이라 지웠다 |
| 6 | 별도 설치 구조: 본체와 따로 설치하고 켜는 기능 묶음 | 없음 | 끝남(계획 extension, `project-docs/architecture/extension.md`). 설치본에 넣는 일은 첫 extension(harness)과 같이 했다(`packages/shell/main/build.ts`, `tools/package/main.ts`) |
| 7 | harness agent(A2A): Claude Code, Codex, OpenCode를 정의의 runtime으로 두고 call, run, step 입력을 CLI 명령(headless)으로 실행한다. TUI 열기, workflow 참가자 | 3 | 끝남(계획 harness-agent). TUI 열기 화면은 단계 8과 같이(지금은 같은 session id로 각 CLI의 resume) |
| 8 | third-party CLI GUI: `claude gui`로 그 harness session을 채팅 화면으로 본다. CLI 출력을 ACP로 옮긴다. 6의 구조로 설치한다 | 4, 6, 7 | 끝남(계획 harness-gui: extension과 adapter 셋. 계획 harness-gui-tab: 아래 정한 것 8~12, 터미널 탭 안 GUI, TUI toggle, CLI 기능, ACP session 기능, omp. `project-docs/architecture/harness-gui.md`) |
| 9 | A2A 명함과 시야: 명함(목적, runtime, modality, 답 방식, skill diff), workspace 정책과 agent 예외, home 좁히기 | 2, 3 | 끝남(계획 agent-card, `project-docs/architecture/agent-call.md`의 call 정책, `agent-definition.md`의 명함) |

4가 5와 8의 바탕이다. 7은 4 없이 먼저 갈 수 있다(기록은 지금 session 기록으로 남고 4가 그것을 ACP로 낸다).

## 정한 것

1. ACP와 A2A는 lophn 자체 규격이고 이름은 사람이 부른 대로다. 표준 Agent Client Protocol, A2A 표준에 맞추지 않는다(사람, 2026-11-02·04).
2. content block은 MCP ContentBlock 꼴을 빌린다. ACP와 A2A가 같은 block을 쓴다(agent, 단계 2에서 land).
3. third-party harness의 실행은 CLI 명령이다. agent로 쓸 때는 headless 명령(`claude -p`, `codex exec`, `opencode run`)이고 사람 없이 돌려도 된다. harness가 programmatic 실행을 공식으로 지원한다(사람, 2026-11-04).
4. harness host는 shell 쪽이다. core는 사람의 PATH와 실행 파일을 모른다(agent, `architecture/coding-agent.md`).
5. "click command는 등록할 수 있다"는 내장을 덜어낸 agent에게도 lophn 명령을 붙일 수 있다는 것이다. bare의 `tools`가 그것이다(agent).

## 정한 것 (시야, 2026-11-04)

6. 시야는 workspace 정책이 크게 정하고 agent 정책이 예외로 덧쓴다(사람). 기본은 모두 허용이고 사람이 workspace 규칙으로 크게 거절하고 agent 예외로 푼다(사람, 2026-11-04). 판정은 agent 예외 → workspace 규칙 → 기본(허용) 순서이고 거절은 `forbidden`이다. 먼저 있던 기본 거절 표(다른 project·다른 앱으로 거절)는 agent의 추천이었고, lophn의 container 넘는 위임(project → 앱의 lophn)을 막아 2026-11-04에 되돌렸다.
7. 다른 workspace에서 불려 home에 열린 session은 폴더를 읽지 않고 실어 보낸 것만 본다(사람이 추천을 받음).

## 정한 것 (단계 8 다음 판, 2026-11-05)

8. GUI는 lophn 터미널 탭 안에서 연다. `claude gui`를 친 그 탭이 GUI로 바뀐다. lophn 밖 터미널에서는 하지 않는다(사람, 2026-11-05). 첫 판의 별도 창(`lophn gui`, open intent, `gui-window.ts`)은 이것으로 바꾼다.
9. 탭은 같은 대화를 GUI와 그 CLI 자신의 TUI 사이에서 toggle한다(사람, 2026-11-05). Claude는 TUI(interactive)와 SDK(stream-json)가 다른 mode의 process이고 둘이 붙을 local server가 없어, 전환이 그 process를 끄고 같은 session id로 resume한다. 전환 전에 "process가 꺼졌다가 다시 켜진다"를 modal로 알린다(사람, 2026-11-05). Codex(0.156+)와 OpenCode(2.x)는 TUI가 background server의 client라, GUI가 그 server에 같이 붙을 수 있으면 끄지 않고 넘기고 못 붙으면 Claude처럼 넘긴다(agent, 붙을 수 있는지 확인 전. lophn 터미널은 hook 때문에 이 둘을 탭 전용 server로 띄운다). 탭 안 claude의 session id는 terminal-agent가 hook으로 이미 안다.
10. GUI에는 그 CLI에서 되는 기능을 다 넣는다: slash 명령, model 고르기, rewind, fork 등. 기준은 Claude 데스크톱·Codex 데스크톱 앱이 하는 것이다(사람, 2026-11-05. 재료 `/home/pyosechang/projects/harness-lab/chat-ui-ux-report.md`). 첫 판이 숨긴 것(harness-gui 계획의 정한 것 6: model 고르기, rewind, 권한 화면, slash 목록)을 되돌린다. 세 CLI 모두 model 바꾸기를 경계에서 지원한다(Claude SDK `setModel`·`supportedModels`·`setPermissionMode`, Codex `turn/start`의 `model`과 model 목록, OpenCode `session/new`의 `configOptions`).

11. 대화 밖 session 기능(model 목록·고르기, mode, 명령 목록·실행, rewind, fork, compact, 사용량, session 제목, CLI session id)을 ACP의 입력과 갱신으로 올린다. 지금은 `acp.md`가 ACP 입력을 대화 조작뿐으로 두고 session 관리를 core route로 보내서, core가 없는 harness GUI가 그 기능을 쓸 길이 없다. lophn core는 새 입력을 지금 route로 옮기고, harness adapter는 각 CLI 경계 호출로 옮긴다. 채팅 화면은 ACP 하나로 그린다(사람, 2026-11-05).
12. 대상에 omp를 더한다(`omp gui`)(사람, 2026-11-05).

## 정한 것 (시야 다음 판, 2026-11-05)

13. workspace마다 private을 고른다. private workspace(project, 앱)는 다른 workspace(home 포함)와 call을 주고받지 않고 통째로 떨어진다. 방향(들어오는 call, 나가는 call)은 나누지 않는다(사람, 2026-11-05: 방향을 따지면 경우가 너무 많아진다). 기본은 public이고 home은 private이 될 수 없다. 판정은 agent 쌍 → workspace 쌍 → private → 기본(허용)이라 쌍 규칙이 private의 예외다(agent 추천을 사람이 받음).

## 계획

- 없음. 단계 1~9가 모두 끝났다. harness GUI의 열린 이슈는 `node tools/records.ts issues --topic harness-gui --status open`.
