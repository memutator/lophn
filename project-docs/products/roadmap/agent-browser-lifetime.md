# agent browser: page 수명을 사람의 화면에서 뗀다

상태: 로드맵. 아직 계획으로 열지 않았다.
배경 문서: `project-docs/architecture/browser-tab.md`("agent가 다루는 탭", 결정 4·5·6·41), `project-docs/architecture/workspace-layout.md`("agent가 연 탭", 결정 18), `project-docs/architecture/platform.md`("core 수명", autostart), `project-docs/architecture/job.md`, `project-docs/products/roadmap/app-webview.md`(native view에서 `<webview>`로 옮긴 이유), `project-docs/products/roadmap/browser-vault.md`(로그인), `harness-lab/_report/browser-use/README.md`.

## 왜

- lophn agent는 사람이 지켜볼 때만 일하지 않는다. job이 정해진 때 agent를 부르고, workflow는 사람과 agent가 step을 넘기며 돈다. 사람은 그동안 다른 workspace에 있거나 창을 모두 닫았거나 앱을 Quit했다(`PRODUCT.md` 3·6절). 사람의 몫은 결과를 보고 정하는 것이다.
- 그런데 agent browser page의 수명은 "사람이 지금 그 workspace를 화면에 띄웠나"에 묶여 있다. 그 workspace를 띄운 창이 없으면 `tab open`은 열리지 않고, 연 뒤에도 사람이 다른 workspace로 가면 page가 사라진다.
- shell이 아예 없으면 browser를 쓸 수 없다. job은 core만으로 돈다(로그인 autostart는 core만 띄우고, 앱을 Quit해도 core는 남는다). 그래서 browser가 필요한 job은 평소 상태에서 실패한다.
- 실제로 일어났다(2026-11-10, 앱 workspace의 session). 사람이 project workspace로 옮긴 4초 뒤 agent가 `tab open`을 불렀다. 탭은 10분 뒤 사람이 앱 workspace로 돌아왔을 때야 열렸다. 그 사이 `browser.snapshot`·`screenshot`은 `unavailable`, `browser.read`는 `not_found`였다. model은 이유 없이 "tool is unavailable"만 받았다. 그래서 shell로 사람의 Chrome profile 쿠키를 `/tmp`에 복사하고 `--remote-debugging-port`로 Chrome을 띄워 `uvx browser-use`로 일을 이었다. 끝난 뒤에도 그 Chrome process와 계정별 쿠키 사본이 `~/.local/share/` 아래에 남았다.
- 이것은 lophn이 막아야 할 agent의 실수(폴더 밖 쓰기, 사람 data 건드리기)를 lophn의 구조가 부른 것이다. grant·rewind·관측이 닿지 않는 바깥 browser로 agent를 밀어낸다. 새벽에 도는 job도 같은 길로 간다.
- 사람 browser 탭의 reload(workspace를 오가면 page를 다시 load한다)도 뿌리가 같다. page 수명이 workspace 화면의 mount에 붙어 있고, Keep alive는 그 위의 예외 목록이다.

## 지금 코드

- **열기는 그 workspace를 띄운 창에만 간다.** core host queue는 `tab_open`을 `host/take`의 `workspaces`(창들이 지금 띄운 workspace)에 그 탭의 workspace가 있을 때만 빌려 준다(`packages/core/host-queue/queue.ts`의 `reachable`). `browser_call`과 `tool_call`은 workspace 없이 아무 shell main이 가져간다. 맞는 창이 없으면 `tab_open`은 queue에서 기다리고 `tabs/open`은 이미 `accepted`를 답했다(`workspace-layout.md` 결정 18: "보이는 창이 없으면 기다린다"). queue 상한은 200개다.
- **shell이 없으면 browser 호출은 바로 끝난다.** core는 owner를 확인한 뒤 shell이 붙어 있지 않으면(take가 3초 안에 없음) `unavailable` "the shell is not attached"로 답한다(`packages/core/main/daemon/wiring/host-queue.ts`).
- **core만 뜨는 때가 평소다.** 로그인 autostart는 `--core`로 core만 띄우고 Electron은 끝난다. 앱의 Quit은 shell만 정리하고 core는 남는다. 켜진 job이나 열린 job run이 있으면 idle-exit가 core를 끄지 않는다(`platform.md` "core 수명", `job.md` 14).
- **browser 엔진과 로그인은 shell main의 것이다.** browser 탭은 shell Electron의 guest이고, partition `persist:lophn-browser`는 shell userData(`<data root>/shell/browser`, `packages/shell/main/desktop/paths.ts`의 `browserDataPath`)에 있다. Chromium profile은 한 번에 한 process만 연다. 그래서 사람 탭과 같은 로그인을 쓰는 browser를 열 수 있는 것은 shell main뿐이다. shell main은 data root마다 하나다(`packages/shell/main/desktop/single-instance.ts`).
- **창 없이 도는 shell main은 개발용뿐이다.** `LOPHN_SHELL_HEADLESS=1`은 개발 확인용으로 창을 `show:false`, `offscreen:true`로 연다(`packages/shell/main/desktop/headless.ts`). 제품 실행 intent(`--core`, `--quit`)에는 "page만 든 shell"이 없다.
- **shell main은 창이 알린 workspace만 안다.** renderer가 layout을 다 읽은 뒤 `shell:surface-workspace`로 그 창의 workspace를 알리고(`packages/shell/renderer/workspace/use-surface-requests.ts`), main은 창마다 하나를 `shown`에 둔다(`packages/shell/main/desktop/wiring/surface.ts`의 `visibleWorkspaces`). detached 창은 세지 않는다.
- **page를 찾는 길은 renderer의 bind다.** host 탭의 `<webview>`가 mount되어 view session이 생기면 `useAgentControl`이 `{bind: {tab, view_session}}`을 보내고 main이 `bound`에 둔다. driver는 거기서 `wv-<id>` guest를 찾고, 없으면 `unavailable` "the tab is not open in a window"다(`packages/shell/main/browser/agent/driver.ts`).
- **창 하나는 workspace 하나만 mount한다.** `packages/shell/renderer/desktop/main.tsx`가 route마다 `WorkspaceWindow` 하나를 key로 그린다. workspace를 바꾸면 그 안의 `<webview>`가 DOM에서 빠져 guest가 사라진다. 창 단위 그릇(`packages/shell/renderer/app-frame/workspace-views.tsx`, 창마다 6개)이 떠나는 workspace의 page를 숨겨 남기는 조건은 `wantsKeep`(`packages/shell/renderer/app-frame/webview-host.tsx`)의 Keep alive, 사람 toggle, download, 소리 넷뿐이다. agent가 다루는 중(`driven`)은 가려진 page를 1px 걸쳐 계속 그리게 할 뿐 남기는 조건이 아니다.
- **문서와 코드가 어긋난다.** `workspace-layout.md`는 "workspace를 바꾼 뒤에도 agent의 browser 호출이 `unavailable`이 되지 않는다"고 적었다. 숨은 mount(`workspace-window.tsx`의 `hiddenHostTabs`)는 그 workspace가 창에 mount된 동안만 돈다.
- **창을 모두 닫아도 shell main·tray·core는 남는다**(`packages/shell/main/desktop/tray.ts`). 그때 renderer가 없어 `<webview>`도 없다.
- **model은 이유를 받지 못한다.** lophn agent tool의 실패 문장은 `FAILURE_SUMMARIES`가 code마다 하나로 고정한다(`packages/core/lophn-agent/tools/work.ts`). `unavailable`은 "tool is unavailable"이다. handler 문장을 싣는 것은 `invalid_input`과 `INPUT_SCOPED_FAILURES`(`skill.read`, `agent.card`)뿐이다.
- **`shell.run`에는 OS sandbox가 없다**(`packages/core/lophn-agent/tools/bundles/shell.ts`). agent가 사람의 browser profile을 읽고 다른 browser를 띄우는 것을 막는 것은 지금 없다.
- 기한: `HOST_TAKE_WAIT_MS` 5초, `BROWSER_CALL_MS` 30초, shell attached 판정 3초(`packages/protocol/lophn-agent/host-queue.ts`, `queue.ts`).

## 다른 harness

`harness-lab/_report/browser-use/`의 15개 가운데 agent browser가 있는 것들을 소스로 확인했다(2026-11-10). 사람이 그 화면을 보고 있어야 agent page가 사는 곳은 없다.

| harness | page 주인 | 사람이 다른 곳을 볼 때 | 화면·창이 없을 때 |
|---|---|---|---|
| Codex desktop | renderer `<webview>`, 창 단위 고정 overlay에 대화마다 숨은 host | 살아 있다. agent가 쓰는 탭은 정리에서 뺀다 | 숨은 host에 열고 붙기를 15초 기다린다. 창이 없으면 오류 |
| GooeyPi | app shell에 한 번 mount한 `AgentBrowserLayer`의 `<webview>` | 살아 있다(`visibility:hidden`) | 붙기를 15초 기다린다. 창이 없으면 오류 |
| Paseo | `document.body`의 고정 그릇에 둔 `<webview>` | 1x1로 접어 둔다. reload 없음 | pane 없이 그릇에 만든다. desktop 앱이 없으면 retry 가능한 오류 |
| Orca | worktree를 내리지 않고 `opacity-0` | 살아 있다. agent가 쓰는 worktree는 LRU에서 뺀다 | 창이 없으면(headless serve) page마다 숨은 `BrowserWindow`를 만든다 |
| OpenCode | main의 `WebContentsView`, `backgroundThrottling:false` | `setVisible(false)`로 살아 있다 | session이 desktop에 붙지 않았으면 tool을 숨긴다 |
| Claude Code desktop | main의 session별 `WebContentsView` | 창 밖 좌표에 두고 계속 그린다 | pane을 연다 |
| T3 Code, omp, Hermes | 따로 띄운 Chromium process. 사람은 screencast로 본다 | 상관없다 | 상관없다 |

- 앱 안 page를 쓰는 곳 가운데 창이 하나도 없을 때도 agent browser가 도는 것은 Orca(숨은 `BrowserWindow`)뿐이다. 나머지는 오류이거나 tool을 숨긴다. 창 없이 늘 도는 것은 따로 띄운 Chromium(T3 Code, omp, Hermes)이고, 그 대가로 사람 browser와 로그인이 갈린다.
- 창에서 떼어 낸 view로 page를 돌리는 곳은 없다. main이 `WebContentsView`를 갖는 OpenCode와 Claude Code desktop도 view를 창에 붙여 둔 채 숨기거나 창 밖 좌표에 둔다. 그래서 "어느 창에도 붙지 않은 view"는 선례가 없고 직접 확인해야 한다(열기 전에 확인할 것).
- 오류 문장: Codex skill은 "사람이 고른 browser가 안 되면 다른 browser로 바꾸지 말고 안 된다고 알린다"고 적는다. OpenCode는 원인, 다음 할 일, "되풀이해도 소용없다"를 싣는다. Hermes와 Claude in Chrome은 "사람에게 필요한 것을 말하라"다. T3 Code는 기능이 꺼지면 "shell의 Playwright나 curl을 쓰라"고 한다. 이번 일과 같은 우회를 부르는 문장이다.
- 사람 browser의 로그인을 쓰는 곳(Hermes의 real profile, T3 Code의 cookie import)은 모두 사람이 설정에서 켠다. agent가 스스로 쿠키를 가져오는 곳은 없다.

## 무엇을 만드나

원칙: **agent browser page의 수명은 그 일(session과 탭)이 정한다. 사람의 화면은 그 page를 보는 자리일 뿐이다. browser는 shell main의 기능이고, core는 필요할 때 shell main을 창 없이 띄운다.**

1. **수명.** agent가 연 page는 탭이 닫히거나 idle 기한이 지날 때까지 산다(정할 것 B). 그 workspace를 어느 창이 띄웠는지, 사람이 다른 workspace로 갔는지, 창을 모두 닫았는지, 앱을 Quit했는지는 상관없다. 살릴지는 program이 정한다.
2. **그릇.** 사람 화면과 상관없이, 창이 하나도 없어도 page가 살 자리(정할 것 A).
3. **창 없는 shell.** shell이 붙어 있지 않을 때 `tab open`이나 `browser.*`가 오면 core가 shell main을 창 없이 띄운다(core를 ensure하는 길과 같은 꼴의 실행 intent). 그 shell main은 single-instance lock을 잡고 창 없이 page만 든다(tray 표시는 정할 것 E). 나중에 사람이 lophn을 열면 second-instance 요청이 그 main으로 가서 창을 만들고, agent가 쓰던 page가 그 창에 그대로 있다. 같은 partition이라 사람이 해 둔 로그인이 이어진다.
   - 의존 방향이 새로 생긴다. 지금 core는 shell의 child도 launcher도 아니다(`platform.md`). core가 Electron을 띄우려면 실행 경로를 인자로 받아야 한다(packaged 실행 file, 개발은 `npm run dev`가 넘기는 명령, test는 fake).
   - `platform.md`는 사람이 Quit하거나 명시 stop한 뒤 shell이 core를 저절로 다시 띄우지 않는다고 적는다. 그 반대 방향(Quit 뒤 core가 shell main을 다시 띄움)을 이 일이 새로 허락한다. 사람이 Quit한 뜻과 부딪치므로 E에서 같이 정한다. `Stop lophn`(core stop) 뒤에는 띄울 core가 없어 문제가 없다.
4. **열기.** `tab open`은 page를 바로 만들고 load가 시작될 때까지만 기다린다(초 단위 기한). 그 workspace를 띄운 창은 필요 없다. 그래서 browser 탭에는 host queue의 "보이는 workspace에만 전달" 규칙이 필요 없다. 기한 안에 page를 만들지 못하면(shell을 띄우지 못함 등) 이유를 담은 오류로 끝낸다. `accepted`를 답하고 기다리지 않는다.
5. **자리.** "page가 있다"와 "layout에 탭 자리가 있다"를 나눈다. 그 workspace가 지금 mount되어 있으면 지금처럼 `openAt()`이 자리를 정하고, 아니면 다음에 mount될 때 자리를 붙인다. 사람이 돌아오면 접힌 float에 같은 page가 그대로 있다(다시 load하지 않는다).
   - layout file은 renderer만 쓴다. 미룬 자리(탭, relation, source)는 shell main이 page와 같이 메모리에 든다. shell main이 끝나면 page도 없으므로 같이 사라져도 된다.
   - 한 번도 mount되지 않은 채 page가 놓이면(B의 idle, 창 없는 shell의 종료) 미룬 자리도 버린다. layout에 탭이 남지 않는다. agent가 browser로 한 일의 기록은 session의 tool 기록이고 탭이 아니다.
6. **오류 계약.** `browser.*`·`tab.*`의 `unavailable`과 `conflict`는 원인과 다음 할 일을 model에 싣는다. `conflict`도 넣는 것은 "stale ref: snapshot을 다시 하라", "사람이 take control했다"를 model이 알아야 다음 행동을 고르기 때문이다(지금은 "tool call conflicted"뿐이다).
   - 싣는 것은 lophn이 쓴 고정 문장뿐이다. handler 문장을 통째로 넘기지 않는다. driver 문장에는 page에서 온 값이 섞여 있고(`navigation failed: ${errorText}`) page는 인터넷이다. 그런 값은 지금처럼 `<lophn-untrusted>` 안에만 싣거나 뺀다(`browser-tab.md` 결정 36).
   - agent 지침(`lophn-agent` skill과 lophn agent의 browser 지침)에 넣는다: lophn browser가 이 일의 browser다. 안 되면 다른 browser를 띄우거나 사람의 browser profile·쿠키를 건드리지 말고 사람에게 올린다.
7. **로그인.** agent 탭은 사람 탭과 같은 partition을 쓴다(`browser-tab.md`의 2026-11-09 결정). 로그인이 없거나 만료되면 agent는 사람에게 올리고, 사람이 그 탭에서 take control로 로그인한다. 비밀번호 입력 길은 `browser-vault.md`다.
   - 사람이 자리에 없는 job에는 run 도중 사람을 기다리는 길이 지금 없다(job의 hold는 놓친 차례 정책이고 이 용도가 아니다, `job.md`). 추천: 새 장치를 만들지 않는다. agent는 "로그인이 필요하다"를 그 차례의 결과로 남기고 차례를 끝낸다. 사람이 lophn browser에서 로그인하면 partition에 남아 다음 차례가 쓴다.
8. **두 process의 수명 맞추기.** 탭 표는 core 메모리에, page는 shell main에 있다. 지금은 renderer의 `closed` 보고가 둘을 맞추는데, page가 renderer 없이 살면 그 길이 없다.
   - shell main이 죽거나 끝나면 page가 사라지고 core 표에는 탭이 남는다. 그 탭의 다음 `browser.*`는 B의 "놓인 page"와 같게 다룬다(마지막 url을 다시 load).
   - core가 다시 뜨면 표가 사라지고 shell main에 주인 없는 page가 남는다. shell main은 core에 다시 붙을 때 `core_epoch`가 바뀌었으면 agent page를 모두 놓는다. layout에 자리가 있던 탭은 사람의 탭으로 남는다(artifact 탭이 지금 그렇다, `workspace-layout.md`).

범위는 `tab open --url`로 연 browser 탭이다. `browser.*`가 같이 다루는 preview 탭과 artifact 탭은 앱·artifact view registry의 `<webview>`로 남고 지금 규칙(그 workspace가 mount되어 있어야 한다)을 따른다. 6번의 오류 문장은 이 둘에도 적용해 "그 workspace를 띄운 창이 없다, 사람에게 올려라"를 model이 받는다. 뺀 이유는 하지 않는 것에 적는다.

## 정할 것

### A. 그릇: page가 어디에 사는가 (사람이 정한다)

조건은 다섯이다.
1. 아무 창도 그 workspace를 띄우지 않아도 산다.
2. 창이 하나도 없어도 산다(창 없는 shell, 3번).
3. 사람이 같은 page를 보고 take control한다. 창 없을 때 연 page를 나중에 연 창에서 다시 load 없이 본다.
4. 사람이 보는 page 위로 shell의 menu·popover·패널이 덮인다(`app-webview.md`로 정한 것).
5. workspace를 오가도 다시 load하지 않는다.

- **A1. main 소유 `WebContentsView`.** agent page는 shell main이 `WebContentsView`로 갖고, 탭은 위치만 정한다. 안 보일 때도 `backgroundThrottling:false`로 계속 그리게 한다. 사람이 보는 창이 없을 때 view를 어디에 두는지는 확인 뒤에 정한다: 어느 창에도 붙이지 않거나(선례 없음), main이 숨은 `BrowserWindow` 하나를 두고 거기에 붙인다(Orca 방식). 사람이 볼 때 그 창으로 view를 옮긴다.
  - 지키는 것: 1, 2, 3, 5. 다른 OS 창으로 옮겨도 다시 load하지 않는다(`browser-tab.md` 결정 6의 대가도 agent page에는 없다). renderer가 필요 없어 창 없는 shell이 page만 들면 된다.
  - 잃는 것: 4. native view는 shell DOM 위에 그려진다. `app-webview.md`가 2026-10-31에 없앤 층 순서, cover, 위치 IPC, overlay toast가 browser 탭에 다시 들어온다. 사람의 결정을 browser 탭에 한해 뒤집는다. 접힌 float(`work`)은 보는 때가 짧지만, `aside`·`glance`로 연 탭과 7번의 take control 로그인은 사람이 그 page를 직접 쓰는 때라 그동안 menu·popover가 page 밑에 깔린다.
  - 크기: browser 탭이라는 kind 하나에 그릇이 둘이 된다(사람 탭 `<webview>`, agent 탭 native view). 주소 줄, popup, DevTools, download, 단축키 전달, take control, 붙이기 규칙이 두 길을 갖는다. 두 길을 오래 두지 않으려면 사람 탭도 같은 그릇으로 옮겨야 하므로(단계 4), A1을 고르는 것은 사실상 "browser 탭 전체를 native view로 되돌린다"를 고르는 것이다. popup·DevTools용 native view 층과 bounds(`main/browser/view-order.ts`, `native-bounds.ts`)는 남아 있어 바닥부터 다시 짜는 것은 아니다.
- **A2. 창 단위 `<webview>` 층.** agent page의 `<webview>`를 `WorkspaceWindow`가 아니라 창 단위 그릇에 둔다. 그 창이 어느 workspace를 띄웠든 거기에 산다(Codex, GooeyPi, Paseo 방식).
  - 지키는 것: 1, 3(창이 있을 때), 4, 5.
  - 잃는 것: 2를 지키려면 창 없는 shell이 page를 담을 숨은 창을 만들어야 한다. 사람이 나중에 그 page를 다른 창에서 보면 `<webview>`는 부모를 옮길 수 없어 다시 load된다(결정 6). 이를 피하려면 사람이 처음 여는 창을 그 숨은 창으로 보여 줘야 하고, 창이 여럿이면 여전히 다시 load된다. 사람이 마지막 창을 닫을 때도 지우지 않고 숨겨야 해서 `quit.ts`·tray의 끄기 길이 바뀐다.
- **A3. A2에 숨은 창을 더하고, 옮길 때의 reload를 받아들인다.** 창이 있으면 A2대로 그 창의 창 단위 그릇에 산다. 창이 없으면 숨은 창의 shell 문서가 `<webview>`를 든다. 사람이 나중에 창을 열면 page를 저절로 옮기지 않는다. 탭 자리에는 "agent가 쓰는 중"과 [여기로 가져오기]를 보이고, 가져오면 다시 load한다. agent가 쓰는 동안에는 사람이 누르기 전까지 page가 깨지지 않는다.
  - 지키는 것: 1, 2, 4, 5. 2026-10-31 결정을 뒤집지 않고 그릇이 하나로 남는다.
  - 잃는 것: 3의 일부. 창 없을 때 연 page는 사람이 다시 load 없이 볼 수 없고, 그 page에서 take control하려면 가져와야 한다(로그인 page라면 다시 load해도 잃는 것이 없다). 숨은 창과 그 문서, "가져오기" 화면이 새로 든다.
- 하지 않는 안: 따로 띄운 Chromium process와 screencast(T3 Code, omp, Hermes). Chromium profile은 한 process만 열 수 있어 사람 탭과 같은 partition(같은 로그인)을 쓸 수 없다. 사람이 같은 page를 쓰려면 화면과 입력도 다시 만들어야 한다.

추천은 확인(열기 전에 확인할 것) 뒤에 굳힌다. 지금의 추천은 A1이다. 이 일의 중심 조건은 1·2·3이고(사람이 없는 동안 agent가 일하고 사람이 나중에 같은 page를 본다), A2는 2를 장치 둘(숨은 창, 처음 여는 창 바꿔치기)로 겨우 지키고 창이 여럿이면 지키지 못한다. 다만 A1의 값은 browser 탭 전체의 그릇을 되돌리는 것이므로, 사람이 2026-10-31 결정을 지키려 하거나 확인에서 A1이 막히면 A3이다. 사람에게는 A1(단계 4 포함)과 A3 둘을 크기와 함께 올린다.

### B. agent page는 언제 지우나 (근거로 정한다)

추천:
- 탭이 닫히거나(agent의 `tab close`, 사람이 닫음) 마지막 browser 호출 뒤 30분이 지나면 page를 놓는다. T3 Code가 30분이다. 사람이 take control한 동안과 사람이 그 page를 보고 있는 동안은 세지 않는다.
- layout에 자리가 있으면 탭은 남기고 page만 놓는다(사람이 열면 url을 다시 load한다). 자리가 없으면 5번대로 흔적 없이 놓는다.
- 놓인 page의 탭에 `browser.*`가 다시 오면 마지막 url을 다시 load하고 결과에 다시 load했음을 적는다. 탭 id는 그대로다. 그래서 30분은 자원 정책일 뿐이고 agent가 오래 쉬어도(긴 build, 사람 로그인 기다리기) 탭을 잃지 않는다. 로그인은 partition에 남는다. 잃는 것은 form과 scroll이다.
- agent page는 shell main 전체에서 12개까지 든다. 넘으면 가장 오래 쓰지 않은 것부터 놓는다. 창마다 6개였던 상한(Keep alive)을 대신한다.
- session이 끝날 때 지우는 안은 버린다. lophn session은 닫히지 않고 이어진다.
- 창 없는 shell은 든 page가 모두 놓이고 붙은 창도 없으면 스스로 끝난다(core의 idle-exit와 같은 생각).

### C. 사람의 browser profile을 program으로 막나 (근거로 정한다)

추천: 이번에는 지침(6번)과 오류 문장으로 막는다. `shell.run`에는 OS sandbox가 없어서 shell 규칙은 문자열 판정이고, 지금 막아도 우회가 쉽다. 그래서 값에 비해 얻는 것이 적다. 같은 일이 한 번 더 생기면 그때 shell 규칙에 사람 browser profile 폴더 읽기와 `--remote-debugging-port`를 단 browser 실행을 넣는다.

### D. 화면 없는 머신 (확인할 것)

Linux 서버처럼 display가 없는 곳에서 창 없는 shell(Electron)이 뜨는지 확인하지 않았다(`--ozone-platform=headless` 등). display가 있는 데스크톱에서는 창을 만들지 않으면 된다. 서버에서 job이 browser를 쓰는 것은 이 확인 뒤에 정한다. 그 전에는 shell을 띄우지 못하면 4번의 오류로 끝난다.

### E. 사람이 없을 때 agent가 사람의 로그인으로 browser를 쓴다 (사람이 정한다)

`browser-tab.md`의 2026-11-09 결정은 같은 partition의 대가(page 글이 agent를 속이면 사람의 로그인으로 그 site를 건드린다)를 주인 좁히기, untrusted 감싸기, take control로 막는다. take control은 사람이 보고 있어야 쓴다. 이 일은 그 대가를 사람이 Quit한 뒤와 새벽의 job까지 넓히고, 그때 도는 Electron은 창도 표시도 없다. 그 결정을 내릴 때 없던 상황이므로 다시 묻는다.

- 추천 1: 창 없는 shell도 tray icon은 띄운다(설정 `shell.tray_off`를 따른다). agent page가 있으면 tray가 그것을 보이고, 거기서 lophn을 열거나 끌 수 있다. 사람이 모르는 process가 로그인을 쥐고 도는 일을 없앤다.
- 추천 2: 사람이 Quit한 뒤에도 core는 shell main을 다시 띄운다. Quit은 지금도 "화면을 끈다"이고 job은 계속 돈다(`job.md`). browser만 멈추면 job이 반쯤 도는 상태가 된다. 모두 멈추는 길은 `Stop lophn`이다.
- 추천 3: job의 browser 사용을 따로 승인받지 않는다. job은 등록할 때 사람이 한 번 승인하고, 그 agent가 가진 tool이 승인 범위다. 대신 job 승인 card에 그 agent가 browser tool을 가졌음을 보인다.
- 다른 안: 무인 실행(붙은 창이 없는 동안)의 agent page는 로그인이 없는 다른 partition을 쓴다. 속아도 건드릴 로그인이 없지만, 로그인이 필요한 일은 무인으로 못 하고 사람이 본 page와 agent가 본 page가 달라진다. 이 일의 원칙(사람과 같은 browser)과 어긋나 추천하지 않는다.

## 열기 전에 확인할 것

A를 사람에게 올리기 전에 지금 Electron 판의 개발 앱에서 throwaway로 본다(`app-webview.md`가 한 방식).

- 어느 창에도 붙지 않은 `WebContentsView`에서 CDP `Page.captureScreenshot`이 끝나는가, `Input.*`이 닿는가, rAF와 timer가 도는가. 안 되면 숨은 `BrowserWindow`(`show:false`)에 붙였을 때 되는가. 지금 driver는 그리지 않는 guest에서 screenshot이 끝나지 않는다(`driver.ts`, `browser-tab.md` 결정 41).
- view를 숨은 자리에서 사람의 창으로, 창에서 다른 창으로 옮길 때 다시 load하지 않는가. 붙여 둔 debugger와 snapshot의 ref가 그대로인가.
- A3을 위해: 숨은 창의 `<webview>` guest가 그리기를 이어 가는가.
- 창 없는 Electron이 macOS dock과 Windows 작업 표시줄에 나타나지 않게 뜨는가. 떠 있는 채로 second-instance가 창을 만들 때 평소 실행과 같은가.
- D: display 없는 Linux에서 뜨는가(`--ozone-platform=headless` 등).

## 단계

0. **확인.** 위 "열기 전에 확인할 것"을 spike로 보고 결과를 A에 반영한 뒤 A와 E를 사람에게 올린다.
1. **오류 계약과 지침.** `browser.*`·`tab.*`의 `unavailable`·`conflict`에 고정 문장(원인과 다음 할 일)을 싣고, agent 지침에 6번을 넣는다. 그릇과 상관없어 0과 같이 먼저 할 수 있고, 이번 같은 우회를 바로 줄인다.
2. **수명과 그릇.** A에서 고른 그릇으로 agent page를 옮기고 4·5·8번(열기, 자리, 수명 맞추기)과 B를 한다. host queue의 `tab_open` 전달 규칙, `workspace-layout.md` 결정 18과 "agent가 연 탭", `browser-tab.md` 결정 5·41과 "agent가 다루는 탭"을 고친다.
3. **창 없는 shell.** core가 shell main을 창 없이 띄우는 실행 intent와, 사람이 lophn을 열 때 그 main에 붙어 창을 만드는 길(3번), E에서 정한 표시. `platform.md`의 launch intent와 core 수명을 고친다. D를 여기서 정한다.
4. **사람 탭.** A1이면 선택이 아니라 A1의 나머지다: 사람 browser 탭도 같은 그릇으로 옮겨 그릇을 하나로 만든다. 2와 사이를 오래 두지 않는다. A3이면 사람 탭이 workspace를 오갈 때 다시 load하지 않게 할지만 정한다(창 단위 그릇에 같이 둔다). 어느 쪽이든 Keep alive는 화면을 내렸느냐가 아니라 자원(상한) 정책이 된다.

## 하지 않는 것

- 사람의 Chrome·Brave profile에서 쿠키 가져오기. 로그인은 lophn browser에서 사람이 하고, 비밀번호는 `browser-vault.md`다.
- 따로 띄운 Chromium process, screencast viewer.
- core 안에 browser 엔진 두기. browser는 shell main의 것이다(Chromium profile을 한 process만 연다).
- preview 탭의 수명 바꾸기. 앱 view는 registry, ticket, 앱별 partition, preload가 `<webview>` 붙이기에 묶여 있어(`app-webview.md`) 그릇을 옮기는 값이 크다. preview는 agent가 앱을 만드는 동안 쓰고 대개 사람이 그 workspace에 있다. 창 없이 preview를 다뤄야 하는 일이 실제로 생기면 따로 연다.
- artifact 탭의 수명 바꾸기(사람, 2026-11-10: 이번에는 뺀다). 그래서 agent는 그 workspace를 띄운 창이 없으면 artifact 탭을 열지도 다루지도 못하고, job이 만든 artifact는 화면 확인 없이 나간다. 남는 한계와 고치는 안은 이슈 `agent-artifact-tab-needs-mounted-workspace`다.
- run 도중 사람을 기다리는 새 장치(7번).
- 앱 live 화면을 agent가 다루는 일(`browser-tab.md` 비목표 그대로).
