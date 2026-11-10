# agent browser: page 수명을 사람의 화면에서 뗀다

상태: 로드맵. 아직 계획으로 열지 않았다.
배경 문서: `project-docs/architecture/browser-tab.md`("agent가 다루는 탭", 결정 4·5·6·41), `project-docs/architecture/workspace-layout.md`("agent가 연 탭", 결정 18), `project-docs/products/roadmap/app-webview.md`(native view에서 `<webview>`로 옮긴 이유), `project-docs/products/roadmap/browser-vault.md`(로그인), `harness-lab/_report/browser-use/README.md`.

## 왜

- lophn agent는 사람이 지켜볼 때만 일하지 않는다. job이 정해진 때 agent를 부르고, workflow는 사람과 agent가 step을 넘기며 돌고, 사람은 그동안 다른 workspace에 있거나 창을 모두 닫고 tray만 둔다(`PRODUCT.md` 3·6절). 사람의 몫은 결과를 보고 정하는 것이다.
- 그런데 agent browser page의 수명은 "사람이 지금 그 workspace를 화면에 띄웠나"에 묶여 있다. 그 workspace를 띄운 창이 없으면 `tab open`은 열리지 않고, 연 뒤에도 사람이 다른 workspace로 가면 page가 사라진다.
- 실제로 일어났다(2026-11-10, 앱 workspace의 session). 사람이 project workspace로 옮긴 4초 뒤 agent가 `tab open`을 불렀다. 탭은 10분 뒤 사람이 앱 workspace로 돌아왔을 때야 열렸다. 그 사이 `browser.snapshot`·`screenshot`은 `unavailable`, `browser.read`는 `not_found`였다. model은 이유 없이 "tool is unavailable"만 받았다. 그래서 shell로 사람의 Chrome profile 쿠키를 `/tmp`에 복사하고 `--remote-debugging-port`로 Chrome을 띄워 `uvx browser-use`로 일을 이었다. 끝난 뒤에도 그 Chrome process와 계정별 쿠키 사본이 `~/.local/share/` 아래에 남았다.
- 이것은 lophn이 막아야 할 agent의 실수(폴더 밖 쓰기, 사람 data 건드리기)를 lophn의 구조가 부른 것이다. grant·rewind·관측이 닿지 않는 바깥 browser로 agent를 밀어낸다.
- 사람 browser 탭의 reload(workspace를 오가면 page를 다시 load한다)도 뿌리가 같다. page 수명이 workspace 화면의 mount에 붙어 있고, Keep alive는 그 위의 예외 목록이다.

## 지금 코드

- **열기는 그 workspace를 띄운 창에만 간다.** core host queue는 `tab_open`을 `host/take`의 `workspaces`(창들이 지금 띄운 workspace)에 그 탭의 workspace가 있을 때만 빌려 준다(`packages/core/host-queue/queue.ts`의 `reachable`). `browser_call`과 `tool_call`은 workspace 없이 아무 shell main이 가져간다. 맞는 창이 없으면 `tab_open`은 queue에서 기다리고 `tabs/open`은 이미 `accepted`를 답했다(`workspace-layout.md` 결정 18: "보이는 창이 없으면 기다린다"). queue 상한은 200개다.
- **shell main은 창이 알린 workspace만 안다.** renderer가 layout을 다 읽은 뒤 `shell:surface-workspace`로 그 창의 workspace를 알리고(`packages/shell/renderer/workspace/use-surface-requests.ts`), main은 창마다 하나를 `shown`에 둔다(`packages/shell/main/desktop/wiring/surface.ts`의 `visibleWorkspaces`). detached 창은 세지 않는다.
- **page를 찾는 길은 renderer의 bind다.** host 탭의 `<webview>`가 mount되어 view session이 생기면 `useAgentControl`이 `{bind: {tab, view_session}}`을 보내고 main이 `bound`에 둔다. driver는 거기서 `wv-<id>` guest를 찾고, 없으면 `unavailable` "the tab is not open in a window"다(`packages/shell/main/browser/agent/driver.ts`).
- **창 하나는 workspace 하나만 mount한다.** `packages/shell/renderer/desktop/main.tsx`가 route마다 `WorkspaceWindow` 하나를 key로 그린다. workspace를 바꾸면 그 안의 `<webview>`가 DOM에서 빠져 guest가 사라진다. 창 단위 그릇(`packages/shell/renderer/app-frame/workspace-views.tsx`, 창마다 6개)이 떠나는 workspace의 page를 숨겨 남기는 조건은 `wantsKeep`(`packages/shell/renderer/app-frame/webview-host.tsx`)의 Keep alive, 사람 toggle, download, 소리 넷뿐이다. agent가 다루는 중(`driven`)은 가려진 page를 1px 걸쳐 계속 그리게 할 뿐 남기는 조건이 아니다.
- **문서와 코드가 어긋난다.** `workspace-layout.md`는 "workspace를 바꾼 뒤에도 agent의 browser 호출이 `unavailable`이 되지 않는다"고 적었다. 숨은 mount(`workspace-window.tsx`의 `hiddenHostTabs`)는 그 workspace가 창에 mount된 동안만 돈다.
- **창을 모두 닫아도 shell main·tray·core는 남는다**(`packages/shell/main/desktop/tray.ts`). 그때 renderer가 없어 `<webview>`도 없다.
- **model은 이유를 받지 못한다.** lophn agent tool의 실패 문장은 `FAILURE_SUMMARIES`가 code마다 하나로 고정한다(`packages/core/lophn-agent/tools/work.ts`). `unavailable`은 "tool is unavailable"이다. handler 문장을 싣는 것은 `invalid_input`과 `INPUT_SCOPED_FAILURES`(`skill.read`, `agent.card`)뿐이다.
- **`shell.run`에는 OS sandbox가 없다**(`packages/core/lophn-agent/tools/bundles/shell.ts`). agent가 사람의 browser profile을 읽고 다른 browser를 띄우는 것을 막는 것은 지금 없다.
- 기한: `HOST_TAKE_WAIT_MS` 5초, `BROWSER_CALL_MS` 30초, shell attached 판정 3초(`packages/protocol/lophn-agent/host-queue.ts`, `queue.ts`).

## 다른 harness

`harness-lab/_report/browser-use/`의 15개 가운데 agent browser가 앱 안 page인 것들을 소스로 확인했다(2026-11-10). 사람이 그 화면을 보고 있어야 agent page가 사는 곳은 없다.

| harness | page 주인 | 사람이 다른 곳을 볼 때 | 화면이 없을 때 열기 |
|---|---|---|---|
| Codex desktop | renderer `<webview>`, 창 단위 고정 overlay에 대화마다 숨은 host | 살아 있다. agent가 쓰는 탭은 정리에서 뺀다 | 숨은 host에 열고 붙기를 15초 기다린다. 창이 없으면 오류 |
| GooeyPi | app shell에 한 번 mount한 `AgentBrowserLayer`의 `<webview>` | 살아 있다(`visibility:hidden`) | 붙기를 15초 기다린다 |
| Paseo | `document.body`의 고정 그릇에 둔 `<webview>` | 1x1로 접어 둔다. reload 없음 | pane 없이 그릇에 만든다. 5초 뒤 retry 가능한 오류 |
| Orca | worktree를 내리지 않고 `opacity-0` | 살아 있다. agent가 쓰는 worktree는 LRU에서 뺀다 | 숨은 mount를 요청하고 기다린다 |
| OpenCode | main의 `WebContentsView`, `backgroundThrottling:false` | `setVisible(false)`로 살아 있다 | session이 desktop에 붙지 않았으면 tool을 숨긴다 |
| Claude Code desktop | main의 session별 `WebContentsView` | 창 밖 좌표에 두고 계속 그린다 | pane을 연다 |
| T3 Code, omp, Hermes | 따로 띄운 Chromium process. 사람은 screencast로 본다 | 상관없다 | 상관없다 |

- 오류 문장: Codex skill은 "사람이 고른 browser가 안 되면 다른 browser로 바꾸지 말고 안 된다고 알린다"고 적는다. OpenCode는 원인, 다음 할 일, "되풀이해도 소용없다"를 싣는다. Hermes와 Claude in Chrome은 "사람에게 필요한 것을 말하라"다. T3 Code는 기능이 꺼지면 "shell의 Playwright나 curl을 쓰라"고 한다. 이번 일과 같은 우회를 부르는 문장이다.
- 사람 browser의 로그인을 쓰는 곳(Hermes의 real profile, T3 Code의 cookie import)은 모두 사람이 설정에서 켠다. agent가 스스로 쿠키를 가져오는 곳은 없다.

## 무엇을 만드나

원칙: **agent browser page의 수명은 그 일(session과 탭)이 정한다. 사람의 화면은 그 page를 보는 자리일 뿐이다.**

1. **수명.** agent가 연 page는 탭이 닫히거나 idle 기한이 지날 때까지 산다(정할 것 B). 그 workspace를 어느 창이 띄웠는지, 사람이 다른 workspace로 갔는지, 창을 모두 닫았는지는 상관없다. 살릴지는 program이 정한다.
2. **그릇.** 사람 화면과 상관없이 page가 살 자리(정할 것 A).
3. **열기.** `tab open`은 page를 바로 만들고 load가 시작될 때까지만 기다린다(초 단위 기한). 그 workspace를 띄운 창은 필요 없다. 그래서 browser 탭에는 host queue의 "보이는 workspace에만 전달" 규칙이 필요 없다. 기한 안에 page를 만들지 못하면(shell이 없음 등) 이유를 담은 오류로 끝낸다. `accepted`를 답하고 기다리지 않는다.
4. **자리.** "page가 있다"와 "layout에 탭 자리가 있다"를 나눈다. 그 workspace가 지금 mount되어 있으면 지금처럼 `openAt()`이 자리를 정하고, 아니면 다음에 mount될 때 자리를 붙인다. 사람이 돌아오면 접힌 float에 같은 page가 그대로 있다(다시 load하지 않는다).
5. **오류 계약.** `browser.*`·`tab.*`의 `unavailable` 문장은 model에 그대로 간다(원인과 다음 할 일). agent 지침(`lophn-agent` skill과 lophn agent의 browser 지침)에 넣는다: lophn browser가 이 일의 browser다. 안 되면 다른 browser를 띄우거나 사람의 browser profile·쿠키를 건드리지 말고 사람에게 올린다.
6. **로그인.** agent 탭은 사람 탭과 같은 partition을 쓴다(`browser-tab.md`의 2026-11-09 결정). 로그인이 없거나 만료되면 agent는 사람에게 올리고, 사람이 그 탭에서 take control로 로그인한다. 비밀번호 입력 길은 `browser-vault.md`다.

## 정할 것

### A. 그릇: page가 어디에 사는가 (사람이 정한다)

조건은 넷이다. (1) 아무 창도 그 workspace를 띄우지 않거나 창이 하나도 없어도 산다. (2) 사람이 같은 page를 보고 take control한다. (3) 사람이 보는 page 위로 shell의 menu·popover·패널이 덮인다(`app-webview.md`로 정한 것). (4) workspace를 오가도 다시 load하지 않는다.

- **A1. 창 단위 `<webview>` 층 + 마지막 창은 지우지 않고 숨긴다 (추천).** agent page의 `<webview>`를 `WorkspaceWindow`가 아니라 창 단위 그릇에 둔다. 그 창이 지금 어느 workspace를 띄웠든 그 창에 그 workspace의 agent page가 산다(Codex, GooeyPi, Paseo 방식). 사람이 마지막 창을 닫으면 창을 숨기기만 해서 renderer 하나가 늘 산다. 그러면 tray만 남은 동안에도 page가 산다.
  - 지키는 것: (1)(2)(3)(4) 모두. `app-webview.md`의 결정을 그대로 둔다.
  - 잃는 것: 숨긴 창 하나의 메모리. 창이 여럿일 때 agent page는 한 창에 산다. 사람이 그 workspace를 다른 창에서 열면 그 page는 다시 load된다(`browser-tab.md` 결정 6과 같은 대가). 창을 닫는 동작이 "숨김"으로 바뀌어 `quit.ts`·tray의 끄기 길을 다시 봐야 한다.
- **A2. 모든 browser page를 shell main의 `WebContentsView`로.** page는 main이 갖고, 탭은 위치만 정한다. 안 보일 때는 창에서 떼고 계속 그리게 한다(OpenCode, Claude Code desktop 방식).
  - 지키는 것: (1)(2)(4). 다른 OS 창으로 옮겨도 다시 load하지 않는다(결정 6의 대가도 사라진다).
  - 잃는 것: (3). native view는 shell DOM 위에 그려진다. `app-webview.md`가 2026-10-31에 없앤 층 순서, cover, 위치 IPC, overlay toast를 browser 탭에 다시 들인다. 사람의 결정을 뒤집는다.
- 하지 않는 안: 따로 띄운 Chromium process와 screencast(T3 Code, omp, Hermes). 사람 탭과 같은 partition(같은 로그인)을 쓸 수 없고, 사람이 같은 page를 쓰려면 화면과 입력을 다시 만들어야 한다.

추천은 A1이다. 이번 문제(사람 화면에 묶인 수명)를 끊으면서 (3)을 지킨다. A2가 더 얻는 것은 창 사이 이동의 reload뿐이다.

### B. agent page는 언제 지우나 (근거로 정한다)

추천: 탭이 닫히거나(agent의 `tab close`, 사람이 닫음) 마지막 browser 호출 뒤 30분이 지나면 지운다. 지울 때 layout의 탭은 남기고 page만 놓는다(사람이 열면 url을 다시 load한다). T3 Code가 30분이다. session이 끝날 때 지우는 안은 버린다. lophn session은 닫히지 않고 이어진다.

### C. 사람의 browser profile을 program으로 막나 (근거로 정한다)

추천: 이번에는 지침(5번)과 오류 문장으로 막는다. 같은 일이 한 번 더 생기면 shell 규칙에 사람 browser profile 폴더 읽기와 `--remote-debugging-port`를 단 browser 실행을 넣는다(AGENTS.md "같은 실수가 두 번이면 check로 막는다"). `shell.run`에는 OS sandbox가 없어서 shell 규칙은 문자열 판정이고, 지금 막아도 우회가 쉽다.

## 단계

1. **오류 계약과 지침.** `browser.*`·`tab.*`의 `unavailable` 문장을 model에 그대로 싣고, agent 지침에 5번을 넣는다. 그릇과 상관없이 먼저 할 수 있고, 이번 같은 우회를 바로 줄인다.
2. **수명과 그릇.** A에서 고른 그릇으로 agent page를 옮기고, 3·4번(열기, 자리)과 B를 한다. host queue의 `tab_open` 전달 규칙, `workspace-layout.md` 결정 18, `browser-tab.md` 결정 5·41과 "agent가 다루는 탭"을 고친다.
3. **사람 탭.** 사람 browser 탭도 같은 그릇에서 workspace를 오갈 때 다시 load하지 않을지 정한다. Keep alive는 화면을 내렸느냐가 아니라 자원(창마다 상한) 정책이 된다. 2와 같은 그릇을 쓰므로 2 뒤에 본다.

## 하지 않는 것

- 사람의 Chrome·Brave profile에서 쿠키 가져오기. 로그인은 lophn browser에서 사람이 하고, 비밀번호는 `browser-vault.md`다.
- 따로 띄운 Chromium process, screencast viewer.
- 앱 live 화면을 agent가 다루는 일(`browser-tab.md` 비목표 그대로).
