# agent platform: 사람이 정한 agent를 앱, workflow, 다른 harness와 잇는다

상태: 로드맵. 2026-11-02~03 사람이 방향을 냈다(모바일 대화). 같은 대화에서 쓴 초안 여섯(app-context, harness-gui, bare-agent, harness-agent, agent-card, remove-domain)을 이 문서 하나로 합치고, 다른 문서·계획·이슈와 대조해 겹침과 모순을 정리했다(2026-11-03). 아래 "단계" 하나가 계획 하나다. 단계 1은 계획 remove-domain으로 열어 land했고(2026-11-04, `project-docs/products/change-log/0.17.0.md`) 아래 "지금 코드"의 domain과 kind 절은 그 앞 기준이다. 단계 2는 계획 content-block으로 열어 land했다(2026-11-04, `project-docs/products/change-log/0.17.0.md`). 단계 3은 계획 bare-runtime으로 열어 land했다(2026-11-04, `project-docs/products/change-log/0.17.0.md` "bare runtime"). 단계 4는 계획 `project-docs/plan/agent-card/`, 단계 5는 `project-docs/plan/agent-screen/`으로 열었다(2026-11-04). 아래 "지금 코드"의 정의 칸, P4, result 답 줄은 그 앞 기준이다.
배경 문서: `project-docs/PRODUCT.md`, `project-docs/products/AGENT.md`, `project-docs/architecture/agent-definition.md`, `project-docs/architecture/agent-call.md`, `project-docs/architecture/run.md`, `project-docs/architecture/app-call.md`, `project-docs/architecture/annotation.md`, `project-docs/architecture/place-session.md`, `project-docs/architecture/approval.md`, `project-docs/architecture/coding-agent.md`, `project-docs/architecture/terminal-agent.md`, `project-docs/architecture/ui-kit.md`, `project-docs/products/roadmap/workflow.md`, `project-docs/products/roadmap/subscription-oauth.md`.

## 왜

사람의 말 (요지):

- **앱 안의 agent (2026-11-02).** 채팅 화면 밖, 사용자가 만든 앱 안에서도 lophn agent를 쓴다. 예: 코딩 테스트 문제 풀이 앱에 attempt list와 코드를 쓰는 textarea가 있다. 사람이 그것을 채팅에 복사해 붙이지 않는다. 앱이 lophn agent SDK로 앱 context를 prompt로 어떻게 조립할지 정해 둔다. agent 응답도 마찬가지다. 외부 client와 붙을 일이 없고 lophn이 호스트하는 앱뿐이라 자체 규격이면 된다.
  - 덧붙임(2026-11-04): 채팅 화면을 앱 안에 둘 필요는 없다. 앱 place에서는 지금도 lophn agent 대화 화면을 쓴다. 이 규격은 agent가 앱 화면에 결과를 내고(예: textarea에 주석 달기) agent도 앱의 client가 되게 하려는 것이다.
- **사람이 정한 agent (2026-11-02).** agent 정의에서 내장 tool과 system prompt를 덜어낼 수 있게 한다. 사람이 완전히 customize한다. 그래도 lophn 명령은 등록할 수 있다. 코딩 테스트 코치 agent에게 lophn tool, prompt, skill은 방해이고 비용이다. Codex, Claude도 programmatic 호출은 되지만 자기 규칙으로 돈다. lophn은 사람이 정한 규칙에만 맞춘 agent를 만든다.
- **third-party harness (2026-11-02).** 터미널에서 `claude gui`처럼 치면 따로 번들된 lophn GUI가 떠서 CLI 대신 GUI로 본다. 화면은 lophn agent 대화 화면과 비슷하고, ACP(Agent Client Protocol) 규칙이 있으면 extension하기 쉽다. 그리고 third-party harness도 lophn agent로 등록해 programmatic 호출과 TUI 열기를 한다. workflow에서 쓰기 위해서다. 그것을 위한 lophn 자체 A2A를 제대로 갖추고, 실행은 CLI 명령이 맡는다. 개발과 유지보수 책임은 lophn이 진다.
- **agent 사이 (2026-11-02).** A2A를 다시 세운다. lophn끼리도, lophn ↔ third-party도. home에도 agent를 둔다. 전역으로 도는 agent다(예: home의 Image Generator를 어디서든 부른다). 중요한 것은 그 agent의 시야를 어디까지 허용하느냐다. 그래서 명함 규격과 modality가 중요하고, 명함에 skill diff를 보인다. 서로 내부 구현은 몰라도 modality와 skill diff로 다른 agent에게 무엇을 기대할지 안다.
- **별도 설치 (2026-11-02).** third-party GUI 같은 기능은 대다수 사용자에게 필요 없다. lophn 하나에 다 두지 말고 따로 설치하게 하고 싶다. 지금 그런 구조가 없다.
- **domain 지우기 (2026-11-03).** domain은 직관적이지 않고 쓰임이 없다. 덜어낸다. `kinds.yaml` 같은 것도 다 필요 없다.

## 지금 코드 (main `3baa6febf`)

### agent 정의와 prompt

- agent는 전역이고 place는 session이 갖는다(사람, 2026-10-28, `architecture/place-session.md`). 정의는 전역에 하나이고 place 칸이 없다. session을 열 때 agent 하나와 place 하나를 정한다(`products/AGENT.md` P2, P3).
- 정의 칸은 `name`, `profile`, `model`, `skills_off`, `domains`, `mcp_off`, `mcp_servers`, `apps`, `permissions`, `skip`이고 schema는 strict다(`packages/protocol/lophn-agent/agent-values.ts`). 한 줄 목적 칸은 없다.
- 같은 place 종류의 session은 agent가 누구든 같은 tool 목록, 지침, 내장 skill, credential 상한, file 범위를 받는다(P4). tool 목록은 `packages/core/agent-places/tool-lists.ts`가 고정하고, credential 상한은 그 목록에서 계산한다(`packages/core/agent-places/credentials.ts`의 `placeOperations`). 내장 skill은 끌 수 없고 system 1층은 늘 제품 고정 규칙 + place 종류 지침이다(`architecture/agent-definition.md`).
- 첫 요청의 내장 tool 정의는 0.9.0 뒤 home 2,988 / project 3,929 / app 4,145 token이다(o200k, `products/change-log/0.9.0.md`). 0.14.0이 명령을 `lophn` tool 하나로 옮긴 뒤로는 재지 않았다.
- place 정보에는 잘 안 바뀌는 목록만 넣는다. 앱 화면 상태는 넣지 않고, 화면에서 본 것은 annotation이나 메시지로만 들어온다(`architecture/agent-definition.md`).
- 사람 메시지와 call 본문·답은 content block 배열이다(단계 2가 land함). 붙인 이미지는 image block으로 model에 바로 간다(`packages/protocol/lophn-agent/content-block.ts`, `architecture/agent-call.md`). 그 전에는 글 끝의 `Attached image: ... "attachment:<id>"` 줄을 agent가 `image.read`로 열었다.

### session에 들어오는 입력: call, run, step

- call의 받는 곳 `to`는 `{session}`이나 `{agent, place?}`(+ `fallback`)이고 place가 없으면 home이다. agent 이름은 전역에 하나다. 보낸 이(`from`)는 사람, program, agent session 셋이다(`packages/protocol/lophn-agent/calls.ts`).
- 받는 곳 type은 `new_session`, `open_session`, `open_session_or_new`뿐이고 coding agent는 없다(`callTargetSchema`). "Router는 받는 곳이 `coding_agent`로 풀리는 call을 거절한다"(2026-10-21, `roadmap/problem-ticket.md`)가 지금은 이 꼴이다.
- call을 판정하지 않는다. 사람이 workflow에서 "call 금지 같은 딱딱한 규칙을 두지 않는다"고 정했다(`architecture/agent-call.md` "왜").
- 본문은 text 하나(`body`)와 refs다. refs는 근거 링크(`file` path, `session`, `annotation`)일 뿐 읽기 허락이 아니다. 보낸 쪽 대화 원문은 넘기지 않는다. 본문은 받는 session 기록(받은 메시지 봉투)에 있고 `agent_calls` 행에는 없다. 받은 메시지는 받은 turn과 뒤 이력에서 같은 bytes로 싼다(cache).
- 받은 메시지는 허락이 아니다. 받은 agent는 자기 할당으로만 일한다(`products/AGENT.md` T6).
- `result`의 답은 받은 agent가 reply로 직접 보내야 done이다. lophn session은 저절로 끝나지 않아 program이 끝을 모른다.
- place prompt의 "Agents you can call"은 agent 이름만 싣고, 열린 session 목록은 `session.list` 결과(`ListSendableSessions`: agent, session, 이름, place, 상태)로만 준다. 명함은 없다. 이 목록이 넘기기를 좌우한다는 것을 eval experiment `tests/eval/experiments/call-list-without-session`(기각)이 봤다.
- 봉투의 여는 방식 칸(tab, tui, headless)은 transport마다 값이 하나뿐이라 뺐다(`architecture/agent-call.md` "왜").
- flow·job이 agent를 부르는 것은 call이 아니라 run이다(`products/AGENT.md` W6, R8, `architecture/run.md`). workflow는 step 입력을 넣는다. run 입력과 step 입력은 unattended다.

### place

- place 종류는 `home`, `project`, `app`이다(`packages/protocol/lophn-agent/places.ts`). home은 place가 없는 것이다.
- home session은 등록된 모든 project 폴더를 읽기만 하고 직접 쓰지 않는다. 기획하고 call로 맡긴다(`architecture/place-session.md`).
- project는 사람의 폴더 없이도 등록된다(`products/AGENT.md` P10).
- 앱 일(설계, 선언, 구현, release)은 그 앱 place의 session이 한다. app place의 tool 목록은 앱을 짓는 tool이다.

### 앱

- 선언은 두 층이다(사람, 2026-11-01, `products/change-log/0.14.0.md`, `architecture/app-call.md`). operation `{name, title, effect}`은 화면과 그 앱 place의 preview만 부른다. agent, 다른 앱, job, flow가 부르면 `denied(gate_blocked)`다. command `{name, description, inputSchema, effect, public, domain}`는 agent가 `lophn <domain> <command>`로 부른다.
- 화면이 lophn에 닿는 길은 bridge `lophnApp.callOperation`이다. `@lophn/app-ui`(`packages/sdk/app-ui/mod.ts`)가 `OperationButton`, `useOperation`, `AppErrorBoundary`, `useTabHead`를 낸다. 앱 화면에 lophn 대화를 붙이는 component는 없다.
- 사람이 화면에서 annotation을 보내면 화면 상태(screenshot, component stack)가 그 앱 place session에 간다(`architecture/annotation.md`). 사람이 보낼 때만이다.
- 새 sdk package는 `packages/core/apps/packages/vendor.ts`, template `package.json.tmpl`, `packages/core/package.json`에 같이 올려야 하고, 이미 있는 앱은 의존을 더해야 한다. pin 하나를 빠뜨린 일이 있었다(`issues/mistakes.md`).

### coding agent와 터미널

- coding session 층을 지웠다(사람, 2026-10-28). "다시 필요해지면 새로 설계한다"(`architecture/coding-agent.md` "왜"). "lophn은 coding agent에게 일을 맡기지 않는다"(`products/AGENT.md` P6, `PRODUCT.md`). `PRODUCT.md`는 "coding agent 같은 다른 harness를 workflow 참가자로 두기"를 MVP 다음("그다음")에 둔다.
- core는 사람의 PATH와 실행 파일을 모른다. 제품 감지는 shell main이 CLI를 exec해서 한다. 사람이 시키지 않았는데 제품을 띄우지 않는다(`architecture/coding-agent.md`).
- 터미널 coding agent는 사람이 PTY에서 돌린다. renderer는 raw byte를 xterm으로 그린다. 상태는 terminal-host 감지와 harness hook으로 shell main이 정하고 shell 내부 IPC(`packages/shell/ipc/terminal.ts`, `packages/shell/ipc/coding.ts`)로 간다.
- shell 시작 층은 bash·zsh·fish에서 `codex`·`opencode`·`kilo`·`cline`만 감싼다. `claude` 함수는 없다(`packages/shell/terminal-host/shell-integration.ts`).
- harness마다 통합 규칙(hook 꼴, event → 신호, session id 경로, resume 인자)은 `HARNESS_ADAPTERS`(`packages/protocol/coding-agent/harness-adapter.ts`) 한 항목에 있다. 감지와 hook 설치는 `packages/coding-agent/harnesses/`, 터미널의 harness 상태는 `packages/shell/main/terminal/agent/`다.
- coding agent가 `lophn` binary로 부르는 core 명령은 user token(사람의 모든 권한)을 쓴다.
- 대화 화면 부품은 `AgentTabSource` 위에 선다(`packages/shell/renderer/conversation/agent-tab-source.ts`).
- ACP 정의는 없다. `acp`는 OpenCode 하위 명령 이름으로만 나온다. Gemini CLI는 감지 표에서 지웠다(Google이 Antigravity로 옮김, `architecture/coding-agent.md`).
- workflow는 서드 파티 harness 참가자를 선언으로 받되 넘기지 못한다(`not_handed`·`harness`, `architecture/workflow.md`, `roadmap/workflow.md`).

### domain과 kind

단계 1(계획 remove-domain)이 land해 아래는 지금 없다(2026-11-04). 무엇을 어디로 옮겼는지는 `products/change-log/0.17.0.md` "domain과 kind를 지우고 경계를 그릇으로 접었다"다.

- domain은 그릇(project·app) 안의 책임 경계이고 id는 `dom_`이다. 값은 `packages/protocol/domains/`, core module은 `packages/core/domains/`(표 `domains`)다.
- 쓰는 곳이 넓다. test가 아닌 file로 `packages/core` 101개, `packages/shell/renderer` 43개이고 protocol, cli(`domain.ts`, `kind.ts`, `app-command.ts` 등), design i18n에도 있다. 문서는 `PRODUCT.md`, `products/AGENT.md`, `boundary-catalog.yaml`, `module-catalog.yaml`, architecture 대부분이다.
- 앱을 만들면 같은 tx에서 앱 slug 이름의 domain 하나가 생긴다. 그래서 대부분 그릇과 domain이 1:1이다.
- domain마다 `<data>/domains/<dom>/`에 `DOMAIN.md`, `kinds.yaml`, `skills/`, `artifacts/`가 있다. 사람의 data root에 domain 폴더가 4개 있다(2026-11-02, 폴더 수만 셌다).
- 오른쪽 sidebar에 Domain panel이 있다. project는 `packages/shell/renderer/workspace/sidebar/domain-panel.tsx`, app은 `app-panel.tsx`의 Domain tab(`packages/shell/renderer/app-frame/app-detail/domains-section.tsx`)이다.
- domain이 단위인 장치: command의 `domain` 칸과 명령 이름, `RESERVED_DOMAIN_NAMES`, 다른 domain의 비공개 command 거르기, `DOMAIN.md` 지침 층, domain skill 층, 사용 관계와 `removed_public_tools`·`removed_public_skills`, kind 파일·kinds worker·위반 toast·`kind.list`·`kind.check`, artifact 자리와 신원(`{domain, name}`), annotation을 받는 쪽, 정의의 `domains`, 정의 `permissions.deny`의 `lophn(<domain> <command>)`(0.15.0), place 정보의 Domains 절. 자리는 `architecture/domain.md` 첫 절이다.
- test와 eval도 쓴다: `tests/e2e/kinds_test.ts`, `tests/support/app/patch-domain.ts`, `tests/eval/restore/kinds.ts`, material `tax-kinds`, scenario O6·L5·L4-app, eval registry의 `kind.*`·`domain.*` tool과 skill. 사람이 둔 untracked 자료 `tests/eval/materials/calendar-app-dev`·`calendar-app-user`도 `domain`을 쓴다.
- 앞선 선언 변경은 ledger의 옛 release 선언을 schema step으로 옮겼고 "봉인된 옛 bundle은 새 판에서 뜨지 않는다"고 했다(`products/change-log/0.14.0.md`).

## 모양

```
 들어오는 길                            runtime (정의 칸)                       도는 곳
 ──────────                             ─────────────────                       ──────
 Agent 탭 (사람)                  ─┐   lophn      지금 그대로            ─▶  lophn run-loop (agent runtime child)
 call (agent)                         ─┤   bare       정의가 고른 것만        ─▶  lophn run-loop
 run (job, flow, `lophn agent run`)   ─┤   <harness>  claude-code, codex …  ─▶  harness host (shell 쪽) ─ lophn A2A, headless CLI 명령 ─▶ harness
 step 입력 (workflow)                 ─┘
 터미널 `<harness> gui` (사람)        ──── lophn GUI가 ACP client ─ ACP(CLI process의 stdio) ─▶ harness

 주고받는 단위   content block (text, image, resource): 사람 입력, call 본문과 답, 앱 context, harness prompt
 고르는 단위     명함: 목적, runtime, modality, 답 방식, 차이(skill, tool)
 시야            부른 쪽이 고른 place의 규칙 + 실어 보낸 content
 앱 화면         agent가 client: 화면 context 읽기, 화면 action (주석 달기 …)
 경계            그릇(project, app). domain은 없다
```

## 단계

| 단계 | 할 일 | 선행 | 이 자리인 이유 |
|---|---|---|---|
| 1 domain 지우기 (끝남) | domain, kind, `DOMAIN.md` 층, domain skill 층을 지우고 경계를 그릇으로 접는다. migration, Domain panel 지우기 | 없음 | 빼는 일이 먼저다. 뒤 단계가 고칠 자리(정의 칸, prompt 층, skill 층, command 이름)가 줄어든다 |
| 2 content block | protocol에 block type 하나. call 본문과 답, 사람 입력의 첨부 줄을 옮긴다 | 1의 `rd-layers` | 3~7이 모두 이 단위로 주고받는다 |
| 3 runtime 칸과 bare (끝남) | 정의에 `runtime`, `description`. bare 조립. 답 규칙 | 1, 2의 `cb-core`(같은 run-loop file) | 1이 정의 칸과 prompt 조립을 먼저 줄인다 |
| 4 명함 | 명함 읽기, 차이 계산, modality 검사, 결과를 content로 돌려주기 | 2, 3 | 명함의 runtime·modality 칸이 2·3의 값이다 |
| 5 앱 화면의 client인 agent | `@lophn/agent`: 화면 context, 화면 action, agent가 열린 화면에 붙는 길 | 1, 2, 3 | 코치 agent가 bare이고, 화면 context가 content block이고, 앱 command 이름이 1의 규칙이다 |
| 6 harness host와 gui | shell 쪽 harness host(PATH의 CLI 띄우기), ACP client, session 기록, `<harness> gui` | 2, 3 | 7이 같은 host와 session 기록을 쓴다 |
| 7 harness agent | lophn A2A로 harness를 agent로 쓴다: call, run, step 입력을 headless CLI 명령으로 실행하고 답을 받는다. workflow harness 참가자, TUI resume, harness가 `lophn` CLI로 답하고 부르기 | 4, 6 | `roadmap/workflow.md`의 harness 참가자와 `issues/coding-agent.md`를 닫는다 |

1과 2는 둘 다 계획으로 열었다. 2의 core task는 prompt 조립·run-loop·router file을 1과 같이 고치므로 1의 `rd-layers`가 land한 뒤 돌았다. 1, 2, 3은 끝났다(2026-11-04). 3 뒤에 4·5·6을 나란히, 마지막에 7이다. 1과 3은 같은 prompt 조립 file(`packages/core/lophn-agent/prompt-assembly/`)을 고치므로 차례로 land한다. 4가 명함을 prompt에 싣기로 하면 4도 그 차례에 든다.

## 다른 계획, roadmap, 이슈

| 무엇 | 지금 | 이 문서와의 관계 | 할 것 |
|---|---|---|---|
| `roadmap/workflow.md` 남은 일 1 | 열지 않음 | 서드 파티 harness 참가자(`not_handed`·`harness`) | 7이 닫는다 |
| `roadmap/workflow.md` "domain을 둔 가장 큰 이유가 추상화와 캡슐화", `PRODUCT.md` "domain처럼 workflow도 캡슐화를 지킨다" | | domain이 원칙의 근거다 | 1이 원칙("agent는 상대의 in/out만 알면 된다")을 앱 경계로 고쳐 쓴다 |
| `roadmap/problem-ticket.md` B | 보류 | PTY 일회 실행, call 본문이 첫 prompt | 7이 headless CLI 명령으로 받는다 |
| `roadmap/harness-config.md` 남은 단계 3·4·5·7 | 열지 않음 | 5가 `lophn(<domain> <command>)`, 정의의 `domains`, `DOMAIN.md`를 쓴다 | 1 뒤에 연다. 1이 그 표기를 고친다 |
| `roadmap/eval.md`, `roadmap/artifact.md`, `roadmap/app-preview.md` | | domain과 kind를 말한다 | 1이 고친다 |
| `roadmap/domain.md` | | 이 문서가 뒤집는다 | 1이 지운다 |
| `roadmap/command-surface.md` 정한 것 15 | 끝남 | "coding agent가 답을 받는 길은 이 roadmap에서 다루지 않는다" | 7이 연다 |
| `issues/coding-agent.md` "binary help에 사람 token으로는 거절되는 명령이 보인다" | 열림 | coding agent의 신원이 정해지기를 기다린다 | 7이 닫는다 |
| `issues/coding-agent.md` "coding agent에게 준 공유 skill을 끄는 화면이 없다" | 열림 | 명함의 차이, third-party 능력 선언과 같은 자리다 | 4·7을 열 때 본다 |
| `issues/place-session.md` "`shell.run`이 file 범위와 rewind를 거치지 않는다" | 열림 | 대안으로 `kind.list` 집계를 든다 | 1이 고친다 |
| `issues/layers.md` | 열림 | 범위 줄에 domain이 있다 | 1이 고친다 |

## 정리한 겹침과 모순

초안 여섯 사이, 그리고 초안과 지금 코드·문서 사이에서 부딪친 것과 정리한 쪽이다.

| # | 부딪친 것 | 정리 |
|---|---|---|
| 1 | ChatPanel 자리: app-context 본문은 `@lophn/app-ui`, 같은 문서의 정한 것은 `@lophn/agent` | ChatPanel을 두지 않는다. 대화는 지금의 Agent 탭이다(사람, 2026-11-04). SDK는 `@lophn/agent` |
| 2 | 앱 안 agent의 응답을 "앱 operation 호출"로 적었다. operation은 화면과 preview만 부르고 agent가 부르면 `denied`다(사람, 2026-11-01) | 화면 action(화면이 열린 동안 화면 code가 처리)과 앱 command(지금 길) 둘(정한 것 25) |
| 3 | bare가 "앱 operation"을 고른다고 적었다 | 앱 command |
| 4 | bare 초안은 `base: lophn \| bare`, harness 초안은 `runtime: lophn \| claude-code …`, 명함은 두 값을 한 칸에 섞었다 | 칸 하나 `runtime: lophn \| bare \| <harness>`. 두 칸이면 `runtime: codex` + `base: bare` 같은 뜻 없는 조합이 생긴다 |
| 5 | harness 실행 길이 둘: gui 초안은 ACP, agent 초안은 headless CLI(`claude -p`, `codex exec`) | 둘 다 둔다(사람, 2026-11-04). 사람이 보는 gui는 ACP, agent로 쓰는 길(call, run, step)은 lophn A2A이고 headless CLI 명령으로 실행한다. 처음 정리의 "ACP 하나"는 사람의 뜻("lophn ↔ third-party도 A2A", "실행은 cli command")과 달랐다 |
| 6 | harness 출력을 옮기는 자리: gui 초안은 renderer의 source, agent 초안은 core Router 쪽 실행 | harness host(shell 쪽)가 ACP update와 headless 출력을 lophn session 기록으로 옮기고 대화 화면은 lophn session과 같은 source로 읽는다("core는 사람의 PATH와 실행 파일을 모른다") |
| 7 | 끝과 답: bare 초안은 "마지막 응답이 reply", harness 초안은 "headless 출력 끝이냐 hook이냐" | reply 명령을 모르는 runtime(bare, harness)은 `result` call을 받은 turn이 끝날 때 마지막 응답이 답이다. harness turn의 끝은 ACP `session/prompt` 응답이다. lophn runtime은 지금처럼 reply 명령 |
| 8 | harness 초안은 call만 말했다. workflow는 step 입력을 넣고 flow·job은 run을 연다(W6, R8) | harness session도 lophn session처럼 입력함의 call, run 입력, step 입력을 다 받는다 |
| 9 | app-context 초안의 `callAgent`와 "`@lophn/flow`는 `@lophn/agent`의 call type을 쓴다" vs flow가 agent를 부르는 것은 run이고, 앱 code가 call을 보내면 보낸 이가 넷째(앱)가 된다 | `callAgent`를 뺀다. 사람의 요구에 없다 |
| 10 | 명함 초안의 "refs는 call 동안의 읽기 grant, 결과는 부른 쪽 place에 놓인다" vs refs는 근거 링크일 뿐이고 home은 직접 쓰지 않는다 | grant 장치를 만들지 않는다. 넘길 것은 content block(blob)으로 싣고, 결과도 content로 돌아와 부른 쪽이 자기 place에 쓴다 |
| 11 | 명함 초안의 발견 범위("home agent는 어디서나, project·app agent는 그 place 안") vs agent는 전역이고 place는 session이 갖는다(사람, 2026-10-28) | 발견 범위 칸을 두지 않는다. 어느 agent든 어디서나 부르고, 부른 쪽이 place를 고른다(없으면 home). "어디서든 부르는 home의 Image Generator"는 지금 모델로 된다 |
| 12 | 명함 초안의 "부른 쪽 place는 보지 않는다" vs home은 모든 project 폴더를 읽는다 | 시야 = 부른 쪽이 고른 place의 규칙 + 실어 보낸 content. place 없이 부른 session(home)의 읽기 범위는 사람이 정할 것 2 |
| 13 | 명함 차이의 기준 "기본 lophn agent"가 흐렸고 skill만 셌다 | 기준은 정의 칸이 빈 lophn agent다. 같은 place 종류면 내장이 같아(P4) 차이는 정의가 바꾼 것뿐이고 place와 상관없다. skill만이 아니라 tool(할당한 앱 command, MCP)도 싣는다. Image Generator의 능력은 tool인 경우가 많다 |
| 14 | harness가 붙으면 transport가 둘 이상이 되어 여는 방식 칸을 뺀 이유("값이 하나뿐")가 풀린다 | 그래도 되살리지 않는다. 입력은 늘 사람 없이 받을 수 있고, TUI·GUI는 사람이 나중에 그 session을 여는 view다 |
| 15 | bare agent에는 `image.read`가 없어 지금의 첨부 줄로는 이미지를 못 본다 | 2에서 이미지를 image block으로 model에 바로 싣는다 |
| 16 | 앱 context를 둘 자리가 정해지지 않았다 vs place 정보에는 앱 화면 상태를 넣지 않는다 | agent가 tool로 읽고 그 turn의 tool 결과로 받는다. place 정보에 넣지 않는다(정한 것 24) |
| 17 | app-context 초안은 context 선언을 `@lophn/declaration`에 둔다고 적었다 | 화면 code의 hook만. 선언은 읽는 곳이 생기면 더한다 |
| 18 | app-context 초안의 "앱 `package.json`에 적은 앱만 사본을 받으니 따로 설치할 구조가 필요 없다" vs 새 sdk package는 vendor, template pin, core 의존에 같이 올리고 이미 있는 앱은 의존을 더해야 한다 | 할 일로 적었다(정한 것 23) |
| 19 | app-context 초안의 "앱이 화면 상태를 agent에게 내미는 길은 없다" vs annotation이 그 길이다(사람이 보낼 때) | 지금 코드를 고쳐 적었다. annotation과 agent가 읽는 길의 관계는 5를 열 때 정한다 |
| 27 | app-context 초안은 앱이 ChatPanel로 context를 prompt에 밀어 넣는 꼴이었다 vs 사람의 뜻은 agent가 화면에 결과를 내고 agent가 앱의 client가 되는 것이다(사람, 2026-11-04) | agent가 열린 화면의 context를 읽고 화면 action을 부른다(정한 것 24, 25) |
| 20 | bare 초안의 비용 근거 "9~13k token"은 0.9.0 전 값이다 | 3을 열 때 다시 잰다. 사람이 든 이유는 비용과 "방해" 둘이다 |
| 21 | gui 초안의 `claude gui` 예 vs `claude` 함수가 없다 | 6이 더한다 |
| 22 | gui 초안의 "Gemini CLI는 ACP를 직접 말한다" vs lophn은 Gemini CLI를 감지 표에서 지웠다 | ACP를 직접 말하는 것으로 확인한 것은 OpenCode(`opencode acp`)뿐이다. 나머지는 "확인할 것" |
| 23 | harness 초안의 headless CLI와 `roadmap/problem-ticket.md` B(PTY 일회 실행, call 본문이 첫 prompt)가 같은 생각이다 | 7이 그 생각을 받는다. PTY 대신 headless 명령의 구조 출력이다 |
| 24 | harness 초안은 "unattended면 harness 권한 mode를 정의에 미리 정한다"를 열어 두었다 vs "정의에 권한 칸은 없다"(P2) | gui(ACP)는 권한 요청을 lophn이 판정한다. headless 실행은 도중에 묻지 못하므로 권한을 띄울 때의 flag로 정한다. 그 값을 어디서 정하나는 7을 열 때 정한다 |
| 25 | domain 초안의 migration은 표와 `domains/<dom>/` 폴더뿐이었다 | 정의의 `domains`·`permissions.deny`, 앱 선언의 `domain` 칸과 봉인한 bundle·ledger 선언, layout의 artifact tab key, annotation 행, `coding-agent.shared_apps` 공유 skill, 폴더 없는 project까지 넓혔다(정한 것 10) |
| 26 | domain 초안의 "지금 코드"와 고칠 문서는 core와 architecture 문서뿐이었다 | shell, protocol, cli, i18n, `PRODUCT.md`, `products/AGENT.md`, catalog, roadmap, 이슈, test, eval까지 넓혔다(정한 것 11) |

## 뒤집는 기존 결정

| 무엇 | 어디 | 누가 | 뒤집는 단계 |
|---|---|---|---|
| "lophn은 coding agent에게 일을 맡기지 않는다" | `products/AGENT.md` P6, `PRODUCT.md`, `architecture/terminal-agent.md` | | 6, 7 |
| coding session 층 삭제 | `architecture/coding-agent.md` "왜" | 사람, 2026-10-28 ("다시 필요해지면 새로 설계한다") | 6, 7 |
| coding agent에게 맡기는 call 거절(workflow 때문에 보류해 둔 것) | `roadmap/problem-ticket.md` 정한 것 | 2026-10-21 | 7 |
| 같은 place 종류면 같은 tool 목록·지침·내장 skill이고 사람은 목록을 넓히거나 좁히지 않는다, 내장 skill은 끌 수 없다 | `products/AGENT.md` P4, `architecture/agent-definition.md` | 사람, 2026-10-28 | 3 (bare만. credential 상한은 그대로). 뒤집었다(2026-11-04) |
| `result`의 답은 reply 명령으로만 done | `architecture/agent-call.md` | | 3 (bare, harness만). bare는 뒤집었다(2026-11-04). harness는 7 |
| 경계는 그릇이 아니라 domain이고 모든 앱은 domain을 하나 이상 갖는다 | `architecture/domain.md` "왜", `roadmap/domain.md`, `products/AGENT.md` P11·P12·H6·C1~C3·C24~C29, `PRODUCT.md` | 사람·planner 2026-10-19, 사람 2026-10-28 | 1 |
| workflow 캡슐화의 근거가 domain | `roadmap/workflow.md`, `PRODUCT.md` | 사람 | 1 (원칙은 앱 경계로 남긴다) |
| kind 파일과 위반 알림 | `architecture/kinds.md`, `PRODUCT.md` MVP | | 1 |

## 정한 것

### 함께

1. **앱 ↔ lophn은 자체 규격이다(사람, 2026-11-02).** 앱과 lophn 양쪽이 모두 lophn 것(판 고정 sdk 사본, lophn 호스트)이라 표준이 주는 상호운용 이득을 받을 상대가 없다. lophn만의 뜻(place, approval, unattended)을 그대로 담는다.
2. **ACP는 외부 CLI ↔ lophn GUI 경계에만 쓴다(사람·agent, 2026-11-02).** agent 사이(lophn끼리, lophn ↔ third-party harness)는 lophn 자체 A2A다(사람, 2026-11-02·04). 두 경계는 따로다.
3. **새 이름에 "ACP"를 쓰지 않는다(agent).** Agent Client Protocol, IBM Agent Communication Protocol과 겹친다.
4. **content block은 MCP ContentBlock 꼴(text, image, resource_link, resource)을 빌린다(agent).** ACP의 content block이 MCP 꼴이라 harness 쪽이 그대로 이어지고, MCP tool 결과도 같은 꼴이다.
5. **plugin system은 지금 만들지 않는다(agent).** 따로 설치할 기능이 둘 이상 생긴 뒤 공통 모양을 보고 뽑는다(AGENTS.md "속도").

### 1 domain 지우기

6. **domain을 지운다(사람, 2026-11-03). 경계는 그릇(project·app)이다(agent).** 그릇 하나 안의 여러 업무를 나누던 일은 project나 앱을 나눠서 한다. "agent는 상대의 in/out만 알면 된다"는 원칙은 앱 경계(public command)로 남긴다.
7. **kind는 대체 없이 지운다(사람, 2026-11-03).**
8. **앱 command는 `lophn <앱 slug> <command>`이다(agent).** 비공개 command는 그 앱 place만, public은 할당받은 쪽이 본다. 할당에서 뺀 command는 `permissions.deny`에 `lophn(<앱 slug> <command>)`로 적는다.
9. **`DOMAIN.md` 층은 지우고 domain skill 층은 그릇 자리의 data skill 층(`place-data`, `<data>/projects/<prj>/skills/`, `<data>/apps/<app>/skills/`)으로 바꾼다(agent).** 지침은 project의 `LOPHN.md`, 앱 source의 `AGENTS.md`가 이미 있다. 폴더 없는 project(P10)는 domain skill이 유일한 skill 자리였고 사람의 project 폴더에 skill을 써 넣지 않으므로 `.lophn/skills`로 옮기지 않는다(2026-11-04, 계획 remove-domain 정한 것 4). artifact는 data root의 그릇 자리(`<data>/projects/<prj>/`, `<data>/apps/<app>/`)로 간다. 폴더 없는 project가 있어(P10) project 폴더 안에 두지 못한다. project의 `workflows/`도 같은 자리에 있다. 나머지 장치는 이렇게 옮긴다.

   | 지금 | 바꾼 뒤 |
   |---|---|
   | command의 `domain` 칸, `lophn <domain> <command>` | 칸을 지운다. `lophn <앱 slug> <command>` |
   | 비공개 command 경계 = domain | 경계 = 앱 |
   | `artifacts/`, artifact 신원 `{domain, name}` | data root의 그릇 자리, 그릇과 이름 |
   | `kinds.yaml`, kinds worker, `kind.*` 명령 | 통째로 지운다 |
   | 사용 관계, `removed_public_tools`·`removed_public_skills` | 쓰는 쪽을 앱·project 단위로 센다 |
   | annotation을 받는 쪽(`ownerOfDomain`) | 그릇 place의 lophn session |
   | lophn 지도 | 앱과 그 public command 목록 |
   | 정의의 `domains`, place 정보의 Domains 절 | 지운다 |

10. **migration을 같은 변경에 넣는다(agent).** AGENTS.md "호환성"이다.
    - ledger(새 schema step): `domains` 표와 domain을 가리키는 열, release 선언 안의 `domain` 칸, annotation 행의 artifact 신원.
    - data root(소유 wiring의 `dataSteps`): `domains/<dom>/`의 `artifacts/`·`skills/`를 그릇 자리로, `agents/*.md`의 `domains` 칸 지우기와 `permissions.deny`의 `lophn(<domain> <command>)`를 `lophn(<slug> <command>)`로, 저장한 layout의 artifact tab key. 정의 schema가 strict라 남은 칸이 있으면 정의를 읽지 못한다.
    - `coding-agent.shared_apps`의 공유 skill도 본다.
    - 봉인한 옛 bundle과 앱 source의 `lophn.ts`를 어떻게 할지는 "계획을 열 때 정할 것"이다.
11. **옛 test와 문서는 고치지 않고 지운다. 걸친 문서는 같은 변경에서 고친다(agent).**
    - 지운다: `architecture/domain.md`, `architecture/kinds.md`, `roadmap/domain.md`, kind·domain test와 eval 자료. 사람이 둔 untracked 자료는 사람에게 묻는다(사람이 정할 것 6).
    - 고친다: `PRODUCT.md`, `products/AGENT.md`, `boundary-catalog.yaml`, `module-catalog.yaml`, domain을 말하는 architecture 문서, 위 "다른 계획, roadmap, 이슈"의 열린 roadmap과 이슈.
    - change-log는 기록이라 두다.

### 2 content block

12. **넘길 것은 content로 싣는다. call에 읽기 grant를 만들지 않는다(agent).** refs는 근거 링크로 남는다. 부른 쪽이 봉투에 무엇을 싣는지가 곧 불린 agent에게 여는 시야다.
13. **봉투는 넓히고 판을 나누지 않는다(agent).** 받은 메시지 봉투와 기록(`messages`)의 저장 모양이 바뀌면 ledger migration을 같이 넣는다. 받은 turn과 뒤 이력이 같은 bytes를 만드는 규칙은 그대로다.

### 3 runtime 칸과 bare

14. **정의에 칸 하나 `runtime: lophn | bare | <harness>`를 둔다(agent).** 없으면 `lophn`이다. 없어도 되는 칸이라 옛 정의 파일을 옮기지 않는다.
15. **bare는 제품 규칙, place 지침, 내장 skill, 내장 tool 없이 정의 본문과 정의가 이름으로 고른 tool만 싣는다(agent).** 고를 수 있는 것은 그 place 종류 목록 안의 tool과 명령, 할당한 앱 command, MCP다. place 종류 목록이 상한이고 credential 상한(`placeOperations`)은 그대로다. bare도 다른 agent처럼 어느 place에서든 연다(P3). lophn runtime에는 항목별 끄기를 두지 않는다. 끄면 무엇이 깨지는지 사람이 모르기 때문이다.
16. **안전 경계는 prompt를 빼도 그대로다(agent).** Gate, sandbox, approval, deny 규칙은 program에 있다(`architecture/approval.md`).
17. **reply 명령을 모르는 runtime(bare, harness)은 `result` call을 받은 turn이 끝날 때 마지막 응답이 답이다(agent).** 사람이 reply를 고른 tool에 넣는 것을 잊어 workflow가 멈추는 일을 막는다.
18. **정의에 한 줄 목적 칸 `description`을 더한다(agent).** 명함의 첫 줄이다.

### 4 명함

19. **명함으로 고르고 content block으로 주고받는다(agent).** lophn끼리와 third-party에 같다.

    | 칸 | 내용 | 누가 쓰나 |
    |---|---|---|
    | 이름, 한 줄 목적 | 무엇을 기대해도 되나 | 사람(`description`) |
    | runtime | lophn / bare / harness 이름 | program |
    | modality | 입력·출력 각각 text, image, file … | 사람이 선언, program이 검사 |
    | 답 방식 | 받는 `none` / `result` / `conversation` | 정의 |
    | 차이 | 정의 칸이 빈 lophn agent 대비 + / − (skill, tool) | program이 계산 |

20. **차이는 program이 계산한다(agent).** 사람이 쓰면 실제와 어긋난다. 차이는 정의가 바꾼 것(할당한 앱의 command와 public skill, 정의 층 MCP server, `skills_off`, runtime)이고, bare는 `− lophn 내장`으로 보인다. prompt 원문은 보이지 않는다. third-party는 잴 기준이 없어 사람이 선언한 능력과 modality만 싣고, runtime 칸이 "내부 규칙은 그쪽 것"임을 알린다.
21. **agent는 전역이다(사람, 2026-10-28). 명함에 발견 범위를 두지 않는다(agent).** 어느 agent든 어디서나 부르고, 부른 쪽이 place를 고른다(call은 없으면 home). 불린 agent의 시야는 그 place의 규칙과 실어 보낸 content다. "call을 판정하지 않는다"(사람)도 그대로다.
22. **받지 못하는 modality면 Router가 보낼 때 `invalid_input`이다(agent).**

### 5 앱 안 agent

23. **앱 쪽 SDK는 새 package `@lophn/agent` 하나다(agent).** 화면 context hook(`useAgentContext`)과 화면 action을 담는다. 대화 화면 component는 없다. 대화는 지금의 Agent 탭에서 한다(사람, 2026-11-04). `@lophn/app-ui`에 넣지 않는 이유: UI가 아니고(content block type, context, action), 앱마다 쓰는지가 갈린다. 새 package라 template `package.json.tmpl`·`lophn.ts.tmpl`, `FIXED_UI_DEPENDENCIES`, lockfile에 같이 올리고(core가 import하지 않으면 `packages/core/package.json`에는 두지 않는다), 이미 있는 앱에는 앱 agent가 의존을 더한다.
24. **agent가 앱 화면의 client다(사람, 2026-11-04).** 앱이 context를 prompt에 밀어 넣지 않는다. 화면이 열린 동안 agent가 화면이 낸 context를 tool로 읽고(결과는 content block), 화면 action을 부른다. context는 화면 code의 hook으로 정하고 선언에 두지 않는다(agent). place 정보에 넣지 않는다(`architecture/agent-definition.md`). 읽은 값은 그 turn의 tool 결과라 prompt 앞부분을 바꾸지 않는다.
25. **agent의 결과가 앱에 닿는 길은 둘이다(agent).** 화면 action은 화면이 등록하고 그 화면이 열린 동안만 부를 수 있으며 화면 code가 처리한다(예: textarea의 한 줄에 주석 달기). Gate는 없다(사용자 앱은 공격자가 아니다). 앱 data를 바꾸는 일은 지금처럼 할당한 앱 command다. operation은 agent에게 열지 않는다.

### 6·7 harness

26. **harness를 띄우는 길은 둘이다(사람, 2026-11-04).** 사람이 보는 `<harness> gui`는 lophn GUI가 ACP client가 되어 harness CLI를 ACP 모드 process로 띄우고 stdio로 ACP를 말한다. agent로 쓰는 길(call, run, step)은 lophn A2A다: 받은 입력(content block)을 prompt로 harness의 headless CLI 명령(`claude -p`, `codex exec` 등, 구조 출력)을 실행하고 그 결과가 답이다. 둘 다 CLI 명령이 실행을 맡는다("실행은 cli command가 맡는다"). harness가 programmatic 실행을 공식으로 지원하므로 사람 없이(workflow, job) 돌려도 된다(사람, 2026-11-04).
27. **harness host는 shell 쪽에 둔다(agent).** core는 사람의 PATH와 실행 파일을 모르고(`architecture/coding-agent.md`), TUI resume은 terminal-host가 한다. session 기록(입력함, call 행, 이력)은 core가 갖고, host는 core에 runtime으로 붙는다.
28. **renderer는 ACP도 headless 출력 꼴도 모른다(agent).** host가 ACP session update와 headless 구조 출력을 lophn session 기록으로 옮기고, 대화 화면은 lophn session과 같은 source로 읽는다.
29. **lophn A2A는 지금 call 봉투를 넓힌 것이다(agent).** 새 protocol을 따로 만들지 않는다. harness session도 lophn session처럼 입력함의 call, run 입력, step 입력을 받고 같은 실패 규칙을 쓴다.
30. **harness가 lophn에 답하고 다른 agent를 부르는 길은 `lophn` CLI 명령이다(사람, 2026-11-02 "실행은 cli command가 맡는다").** headless 실행이면 마지막 출력이 답이고(정한 것 17과 같은 규칙), harness가 `lophn call reply`를 부르면 그것이 먼저다.
31. **gui(ACP)의 권한 요청은 lophn이 판정한다(agent).** deny 규칙은 늘 막고, `ask`는 대화 화면에 묻는다(`architecture/approval.md` turn mode). headless 실행은 도중에 묻지 못하므로 띄울 때 권한 flag를 넘긴다. 정의에 harness 권한 칸을 더하지 않는다(P2). harness가 자기 설정으로 허락한 tool 호출은 lophn이 보지 못한다. 명함이 이것을 알린다.
32. **TUI 열기는 같은 harness session을 터미널 탭에서 resume하는 것이다(agent).** resume 인자는 `HARNESS_ADAPTERS`에 있다. headless 실행의 session id도 같은 인자로 이어 간다(`conversation` 답 방식).

## 정할 것

### 사람이 정할 것

1. **harness 기능(6·7)의 배포.** 사람은 별도 설치를 원했다.
   - 추천: 지금은 같은 release에 넣고 기본은 꺼 둔다. 설정에서 켜는 것이 "설치"이고 켰을 때만 code를 load한다. MVP 뒤 protocol이 굳으면 별도 배포로 뺀다.
   - 이유: 따로 배포하면 lophn과 판이 어긋나 protocol을 공개 계약으로 굳혀야 한다. AGENTS.md "protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다, `v2`를 만들지 않는다"와 MVP 이전의 설계 자유에 부딪친다.
   - 빼기 쉽게: harness host는 core에 공개 면(protocol route, `lophn` CLI)으로만 붙고 core 내부를 import하지 않는다. `tools/check-deps.ts`로 막는다.
2. **place 없이 부른 session(home)의 읽기 범위.** home은 등록된 모든 project 폴더를 읽는다. Image Generator를 place 없이 불러도 그렇다. 추천: 그대로. 읽기는 AGENTS.md가 막는 것(데이터 잃기, 폴더 밖 쓰기, 틀린 되돌리기, 인터넷에서 온 것) 밖이고, bare면 file tool이 없다.
3. ~~"실행은 cli command가 맡는다"의 뜻~~ 정했다(사람, 2026-11-04): ACP는 규격이고 실행은 CLI process다. gui는 ACP, agent 사이는 lophn A2A(headless CLI 명령). 정한 것 26.
4. ~~사람 구독으로 harness를 사람 없이 돌리는 것~~ 정했다(사람, 2026-11-04): 허용한다. harness가 programmatic 실행을 공식으로 지원한다.
5. **내용이 있는 `DOMAIN.md`(1).** 사람의 data root에 domain이 4개 있다. 추천: 지우지 않고 그릇 자리의 파일로 옮긴 뒤 사람에게 알린다. 그릇 지침에 붙이면 사람이 모르게 prompt가 바뀐다.
6. **사람이 둔 untracked eval 자료의 `domain`.** `tests/eval/materials/calendar-app-dev`, `calendar-app-user`를 1이 같이 고쳐도 되나.

### 계획을 열 때 정할 것

- **1:** 계획 `remove-domain`의 정한 것이 정했다.
- **2:** 계획 `content-block`이 정했다(`project-docs/products/change-log/0.17.0.md`의 content block 항목).
- **3:** 계획 `bare-runtime`의 정한 것이 정했다.
- **4:** 계획 `agent-card`의 정한 것이 정했다.
- **5:** 계획 `agent-screen`의 정한 것이 정했다.
- **6:** ACP adapter 번들(추천: 판을 고정해 번들한다. AGENTS.md "의존성은 판을 정확히 고정한다"). `gui` 진입이 shell 함수(`claude` 함수를 더한다)인가 `lophn gui <harness>`인가. gui로 연 session의 place(터미널 cwd가 이은 project 폴더 안이면 그 project). harness 정의를 사람이 등록하나, 켜면 감지한 harness마다 생기나. 앱 context를 ACP resource block으로 넘기나.
- **7:** harness마다 headless 명령과 구조 출력 꼴, 권한 flag를 어디서 정하나(정의 칸 없이, P2). `conversation` 답 방식과 headless session id 잇기. run의 답(R8 "답은 run 기록에 남고 code가 받는다")을 harness turn 끝에서 만드는 법. harness가 `lophn` CLI를 쓸 자격(user token은 사람의 모든 권한이라 쓰지 않는다. session 범위 agent 자격을 env로 넣는 쪽). workflow `not_handed`·`harness` 참가자를 넘기는 법.

## 확인할 것 (바깥 사실, 계획을 열 때)

- harness마다 ACP를 말하나. OpenCode는 `opencode acp`가 있다. Claude Code·Codex는 adapter(`claude-code-acp`, `codex-acp`)가 있다고 알고 있다.
- ACP로 연 session을 그 harness의 TUI에서 resume할 수 있나(Claude Code `--resume`, Codex).
- ACP content block이 MCP ContentBlock과 같은 꼴인지, 고정할 판.

## 하지 않는 것

- plugin system(정한 것 5).
- 앱 ↔ lophn을 A2A, AG-UI 같은 표준에 맞추기(정한 것 1). CopilotKit의 readable/action, AG-UI는 모양 참고로만 본다.
- agent에게 operation 열기(정한 것 25).
- 앱 화면 안 ChatPanel(겹침 1, 27).
- 앱 code가 agent를 부르는 `callAgent`(겹침 9).
- call의 읽기 grant(정한 것 12).
- 명함의 발견 범위(정한 것 21).
- 봉투의 여는 방식 칸 되살리기(겹침 14).
- 정의의 harness 권한 칸(정한 것 31).
