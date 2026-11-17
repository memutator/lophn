# agent browser: page 수명을 사람의 화면에서 뗀다

상태: 단계 1~3을 구현했다(2026-11-10). 단계 4(사람 browser 탭)만 계획으로 열지 않았다. 아래 "왜"는 구현 전 상황이고, "지금 코드"는 구현 전 코드에 지금을 덧붙였다. 설계는 `architecture/browser-tab.md`·`workspace-layout.md`·`platform.md`가 지금 코드를 적는다.
배경 문서: `project-docs/architecture/browser-tab.md`("agent가 다루는 탭", 결정 4·5·6·41), `project-docs/architecture/workspace-layout.md`("agent가 연 탭", 결정 18), `project-docs/architecture/platform.md`("core 수명", autostart), `project-docs/architecture/job.md`, `project-docs/products/roadmap/app-webview.md`(native view에서 `<webview>`로 옮긴 이유), `project-docs/products/roadmap/browser-vault.md`(로그인), `harness-lab/_report/browser-use/README.md`.

## 왜

- lophn agent는 사람이 지켜볼 때만 일하지 않는다. job이 정해진 때 agent를 부르고, workflow는 사람과 agent가 step을 넘기며 돈다. 사람은 그동안 다른 workspace에 있거나 창을 모두 닫았거나 앱을 Quit했다(`PRODUCT.md` 3·6절). 사람의 몫은 결과를 보고 정하는 것이다.
- 그런데 agent browser page의 수명은 "사람이 지금 그 workspace를 화면에 띄웠나"에 묶여 있다. 그 workspace를 띄운 창이 없으면 `tab open`은 열리지 않고, 연 뒤에도 사람이 다른 workspace로 가면 page가 사라진다.
- shell이 아예 없으면 browser를 쓸 수 없다. job은 core만으로 돈다(로그인 시작은 core만 띄우고, 앱을 Quit해도 core는 남는다). 그래서 browser가 필요한 job은 평소 상태에서 실패한다.
- 실제로 일어났다(2026-11-10, 앱 workspace의 session). 사람이 project workspace로 옮긴 4초 뒤 agent가 `tab open`을 불렀다. 탭은 10분 뒤 사람이 앱 workspace로 돌아왔을 때야 열렸다. 그 사이 `browser.snapshot`·`screenshot`은 `unavailable`, `browser.read`는 `not_found`였다. model은 이유 없이 "tool is unavailable"만 받았다. 그래서 shell로 사람의 Chrome profile 쿠키를 `/tmp`에 복사하고 `--remote-debugging-port`로 Chrome을 띄워 `uvx browser-use`로 일을 이었다. 끝난 뒤에도 그 Chrome process와 계정별 쿠키 사본이 `~/.local/share/` 아래에 남았다.
- 이것은 lophn이 막아야 할 agent의 실수(폴더 밖 쓰기, 사람 data 건드리기)를 lophn의 구조가 부른 것이다. grant·rewind·관측이 닿지 않는 바깥 browser로 agent를 밀어낸다. 새벽에 도는 job도 같은 길로 간다.
- 사람 browser 탭의 reload(workspace를 오가면 page를 다시 load한다)도 뿌리가 같다. page 수명이 workspace 화면의 mount에 붙어 있고, Keep alive는 그 위의 예외 목록이다.

## 지금 코드

구현 전의 코드와 지금이다. 문서(architecture)는 지금만 적는다.

- **열기는 그 workspace를 띄운 창에만 갔다. 지금은 browser 탭만 어느 창이든 간다.** core host queue는 `tab_open`을 shell이 알린 보이는 `workspaces`(그때는 `host/take`의 인자, 지금은 `/host-link`의 `visible`)에 그 탭의 workspace가 있을 때만 빌려 줬다. 이제 browser 탭의 `tab_open`·`tab_close`는 workspace를 가리지 않고 아무 shell main이 가져가고, shell main이 그 workspace를 보이는 창, 없으면 가장 최근 일반 창, 그것도 없으면 focus 없이 연 새 창에 보낸다. 다른 target(preview, artifact, session, coding)은 그대로 그 workspace를 보이는 창에만 가고 기다린다(`workspace-layout.md` 결정 18).
- **shell이 없으면 browser 호출이 바로 끝났다. 지금은 열기가 shell을 띄운다.** `tab open --url`은 shell이 없으면 core가 앱을 띄우고 기다린다(조건은 아래 3번). 이미 연 browser 탭에 shell 없이 온 `browser.*`는 page가 사라진 것으로 보고 그 탭을 core 표에서 빼고 `not_found`를 답한다. preview·artifact 탭의 호출은 전과 같이 `unavailable` "the lophn app is not connected"다.
- **core만 뜨는 때가 평소다(그대로).** 로그인 시작(늘 켜 둠 표시를 켠 기계의 OS 등록)은 core만 띄운다(`platform.md` "늘 켜 둠"). 앱의 Quit은 shell만 정리하고 core는 남는다. 켜진 job이나 열린 job run이 있으면 idle-exit가 core를 끄지 않는다(`platform.md` "core 수명", `job.md` 14).
- **browser 엔진과 로그인은 shell main의 것이다(그대로).** partition `persist:lophn-browser`는 shell userData에 있고 Chromium profile은 한 번에 한 process만 연다.
- **창 없이 도는 shell main은 개발용뿐이다(그대로).** `LOPHN_SHELL_HEADLESS=1`은 개발 확인용이다. 제품에 "page만 든 shell"은 없다. 대신 `--agent-window` intent가 일반 창을 focus 없이 연다.
- **shell main은 창이 알린 workspace만 안다(그대로).** renderer가 layout을 다 읽은 뒤 `shell:surface-workspace`로 알리고 main이 창마다 하나를 `shown`에 둔다. detached 창은 세지 않는다. browser 탭 열기는 이 정보가 없어도(보이는 창이 없어도) 가장 최근 일반 창으로 간다.
- **page를 찾는 길은 renderer의 bind다(그대로). 지금은 창 단위로 보고한다.** host browser 탭의 bind와 상태(url, title, loading) 보고를 `WorkspaceViewsProvider`가 하므로 그 workspace가 mount되지 않아도 간다. driver가 page를 못 찾으면 browser 탭에는 "page가 사라졌다, `tab open --url`로 다시 열라"를 `unavailable`로 답한다.
- **창 하나는 workspace 하나만 mount한다(그대로). 지금은 agent page가 workspace를 떠나도 산다.** 떠나는 workspace의 `<webview>`를 남기는 조건 `wantsKeep`에 "agent가 연 browser 탭의 page"(`agent`)가 들었다. 이 page는 6개 상한 밖이고 창마다 12개 상한을 따로 센다(guest가 붙은 것만).
- **숨은 mount는 그 workspace가 mount된 동안만 돈다(preview·artifact 탭은 그대로).** host browser 탭은 창 단위 receiver가 mount와 상관없이 page를 만든다.
- **창을 모두 닫아도 shell main·tray·core는 남는다(그대로).** 그때 renderer가 없어 `<webview>`도 없었다. 지금은 browser 탭 열기가 창을 연다.
- **model이 이유를 받는다.** `browser.*`·`tab.*`의 `unavailable`·`conflict`에 더해 `browser.*`의 `not_found`도 고정 문장이 model에 간다(`carriesReason`). 그 밖의 tool과 code는 공통 문장이다.
- **`shell.run`에는 OS sandbox가 없다(그대로).** agent가 사람의 browser profile을 읽고 다른 browser를 띄우는 것을 막는 것은 지금 없다.
- 기한: `HOST_TAKE_WAIT_MS` 5초, `BROWSER_CALL_MS` 30초, shell attached 판정 3초, browser 탭 열기 10초(앱을 띄웠으면 30초), 앱을 띄우지 못한 뒤 5분(`packages/protocol/lophn-agent/host-queue.ts`, `queue.ts`).

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
- 창에서 떼어 낸 view로 page를 돌리는 곳은 없다. main이 `WebContentsView`를 갖는 OpenCode와 Claude Code desktop도 view를 창에 붙여 둔 채 숨기거나 창 밖 좌표에 둔다. 직접 확인하니 떼어 낸 view는 그리지 않았다(확인한 것).
- 오류 문장: Codex skill은 "사람이 고른 browser가 안 되면 다른 browser로 바꾸지 말고 안 된다고 알린다"고 적는다. OpenCode는 원인, 다음 할 일, "되풀이해도 소용없다"를 싣는다. Hermes와 Claude in Chrome은 "사람에게 필요한 것을 말하라"다. T3 Code는 기능이 꺼지면 "shell의 Playwright나 curl을 쓰라"고 한다. 이번 일과 같은 우회를 부르는 문장이다.
- 사람 browser의 로그인을 쓰는 곳(Hermes의 real profile, T3 Code의 cookie import)은 모두 사람이 설정에서 켠다. agent가 스스로 쿠키를 가져오는 곳은 없다.

## 무엇을 만드나

원칙: **agent browser page의 수명은 그 일(session과 탭)이 정한다. 사람의 화면은 그 page를 보는 자리일 뿐이다. browser는 shell의 기능이고, 창이 없으면 core가 shell을 띄워 창을 연다.**

1. **수명.** (구현) agent가 연 page는 탭이 닫히거나, 그 page가 든 창이 닫히거나, 창마다 12개 상한에서 가장 오래 쓰지 않은 것으로 밀릴 때까지 산다. 그 창이 어느 workspace를 띄웠는지, 사람이 다른 workspace로 갔는지는 상관없다. idle 기한은 두지 않았다. 창이 닫히거나 앱을 Quit하면 page와 함께 탭도 core 표에서 빠지고, 마지막 url을 다시 load하지 않는다(agent가 다시 연다). 처음 안은 탭이 남고 다음 호출이 창을 다시 열어 url을 다시 load하는 것이었는데 "page가 없으면 탭이 없다"로 줄였다.
2. **그릇.** 사람 화면과 상관없이, 창이 하나도 없어도 page가 살 자리(정할 것 A).
3. **core가 shell을 띄운다.** (구현) `tab open --url`이 shell이 붙어 있지 않을 때 오면 core가 앱을 `--agent-window` intent로 띄우고, 앱은 첫 창을 focus 없이 연다. 이미 떠 있는 앱에는 창이 하나도 없을 때만 같은 창을 연다. agent page는 그 창의 창 단위 그릇에 산다. 사람이 나중에 lophn을 쓰면 그 창이 평소의 창이다. 같은 partition이라 사람이 해 둔 로그인이 이어진다.
   - 의존 방향이 새로 생겼다(core → shell). 명령은 인자로 받지 않고 core가 자기 platform 배치에서 정한다(설치본은 core를 띄운 Electron 실행 file, 개발은 build한 shell entry를 더한다). 띄우기는 주입하는 port라 test는 fake를 쓴다.
   - 사람이 쓰는 core를 띄운 쪽(shell main, CLI)이 `LOPHN_LAUNCH_SHELL=1`을 준 core만 띄운다. test·boot·E2E가 띄운 core는 앱을 띄우지 않는다. 한 번에 하나만 띄우고(같이 온 열기는 그 시도를 함께 기다린다) 실패하면(spawn 오류, 30초 안에 shell이 붙지 않음) 5분은 다시 띄우지 않고 바로 실패한다. shell이 붙으면 풀린다.
   - `platform.md`의 "Quit 뒤 shell이 core를 저절로 다시 띄우지 않는다"는 명시 stop 뒤의 일이고 이 일은 그 반대 방향(Quit 뒤 core가 shell을 띄움)이다(E에서 정했고 `platform.md`에 적었다). `Stop lophn`(core stop) 뒤에는 띄울 core가 없다.
4. **열기.** (구현) `tab open --url`은 page가 붙을 때까지(guest의 dom-ready, bind) 기다린 뒤 답한다. 기한은 shell이 붙어 있으면 10초, 앱을 띄웠으면 30초 하나다(앱 시작, 창 열기, page까지). 그 workspace를 띄운 창은 필요 없다. 실패는 `unavailable`과 고정 문장이고 탭이 남지 않는다(shell이 page를 만들었을지 모르면 닫기 요청을 보낸다). 처음 안은 "load가 시작될 때까지만"이었는데 구현은 dom-ready까지 기다린다. 그래서 첫 응답이 기한보다 늦는 site는 실패한다. browser 아닌 target은 전과 같이 `accepted`를 바로 답한다.
5. **자리.** (구현) "page가 있다"와 "layout에 탭 자리가 있다"를 나눴다. 그 workspace가 지금 mount되어 있으면 지금처럼 `openAt()`이 자리를 정하고, 아니면 다음에 mount될 때 자리를 붙인다. 사람이 돌아오면 접힌 float에 같은 page가 그대로 있다(다시 load하지 않는다).
   - layout file은 renderer만 쓴다. 미룬 자리(탭, relation, source)는 page를 만든 창의 renderer 메모리에 있다(shell main이 아니다). 창이 닫히면 page와 같이 사라진다.
   - 한 번도 mount되지 않은 채 page가 놓이면(상한, 그 창을 닫음) 미룬 자리도 버린다. layout에 탭이 남지 않는다. 창 닫힘이나 앱 종료 뒤 layout에 남은 접힌 agent 탭은 mount 때 지금 desk의 것만 뺀다.
6. **오류 계약.** `browser.*`·`tab.*`의 `unavailable`과 `conflict`는 원인과 다음 할 일을 model에 싣는다. `conflict`도 넣는 것은 "stale ref: snapshot을 다시 하라", "사람이 take control했다"를 model이 알아야 다음 행동을 고르기 때문이다(지금은 "tool call conflicted"뿐이다).
   - 싣는 것은 lophn이 쓴 고정 문장뿐이다. handler 문장을 통째로 넘기지 않는다. driver 문장에는 page에서 온 값이 섞여 있고(`navigation failed: ${errorText}`) page는 인터넷이다. 그런 값은 지금처럼 `<lophn-untrusted>` 안에만 싣거나 뺀다(`browser-tab.md` 결정 36).
   - agent 지침(`lophn-agent` skill과 lophn agent의 browser 지침)에 넣는다: lophn browser가 이 일의 browser다. 안 되면 다른 browser를 띄우거나 사람의 browser profile·쿠키를 건드리지 말고 사람에게 올린다.
   - (단계 2에서 더했다) `browser.*`의 `not_found`도 고정 문장이 model에 간다. 없는 탭, 닫힌 탭, 남의 탭이 같은 문장이라 존재가 새지 않고, page가 없어졌으면 다시 열라고 알린다.
7. **로그인.** agent 탭은 사람 탭과 같은 partition을 쓴다(`browser-tab.md`의 2026-11-09 결정). 로그인이 없거나 만료되면 agent는 사람에게 올리고, 사람이 그 탭에서 take control로 로그인한다. 비밀번호 입력 길은 `browser-vault.md`다.
   - 사람이 자리에 없는 job에는 run 도중 사람을 기다리는 길이 지금 없다(job의 hold는 놓친 차례 정책이고 이 용도가 아니다, `job.md`). 추천: 새 장치를 만들지 않는다. agent는 "로그인이 필요하다"를 그 차례의 결과로 남기고 차례를 끝낸다. 사람이 lophn browser에서 로그인하면 partition에 남아 다음 차례가 쓴다.
8. **두 process의 수명 맞추기.** (구현, 일부) 탭 표는 core 메모리에, page는 창에 있다. page가 탭 닫기 말고 없어질 때(상한, page를 든 창이 닫힘) 창이나 main이 `closed`를 보고해 core 표에서 탭을 뺀다. 앱이 끝나 알릴 길이 없으면 shell 없이 온 browser 호출이 그 탭을 빼고 `not_found`를 답한다.
   - 하지 않았다: core가 다시 떠서 표가 사라졌을 때 shell main이 `core_epoch`로 agent page를 모두 놓는 것. 지금은 주인 없는 page가 창이 닫히거나 상한에 밀릴 때까지 남고, layout에 자리가 있던 탭은 사람의 탭으로 남는다.

범위는 `tab open --url`로 연 browser 탭이다. `browser.*`가 같이 다루는 preview 탭과 artifact 탭은 앱·artifact view registry의 `<webview>`로 남고 지금 규칙(그 workspace가 mount되어 있어야 한다)을 따른다. 6번의 오류 문장은 이 둘에도 적용해 "그 workspace를 띄운 창이 없다, 사람에게 올려라"를 model이 받는다. 뺀 이유는 하지 않는 것에 적는다.

## 정할 것

### A. 그릇: page가 어디에 사는가 (정했다: A2, 창이 없으면 core가 창을 띄운다. 구현했다)

조건은 다섯이다.
1. 아무 창도 그 workspace를 띄우지 않아도 산다.
2. 창이 하나도 없어도 쓸 수 있다(3번).
3. 사람이 같은 page를 보고 take control한다. 창 없을 때 연 page를 나중에 연 창에서 다시 load 없이 본다.
4. 사람이 보는 page 위로 shell의 menu·popover·패널이 덮인다(`app-webview.md`로 정한 것).
5. workspace를 오가도 다시 load하지 않는다.

- **A1. main 소유 `WebContentsView`와 ghost 창.** agent page는 shell main이 `WebContentsView`로 갖고, 탭은 위치만 정한다. 사람이 그 page를 보지 않는 동안 view는 main이 하나 두는 ghost 창(frame 없는 투명 1x1 `BrowserWindow`, `showInactive()`, 작업 표시줄 제외, focus 받지 않음)에 page 크기 bounds로 붙어 있다. 사람이 볼 때 그 창으로 view를 옮기고, 안 보게 되면 ghost 창으로 돌려보낸다.
  - 확인한 것(아래 "확인한 것"): ghost 창의 view는 보이는 창과 똑같이 그린다(screenshot, rAF, 입력). 여러 view를 겹쳐 두어도 각각 그린다. view를 옮겨도 다시 load하지 않고 debugger와 ref가 남는다. 창 없는 앱에 second-instance가 와도 된다. display 없는 Linux에서도 된다.
  - 지키는 것: 1, 2, 3, 5. 다른 OS 창으로 옮겨도 다시 load하지 않는다(`browser-tab.md` 결정 6의 대가도 agent page에는 없다). renderer가 필요 없다.
  - 잃는 것: 4. native view는 shell DOM 위에 그려진다. `app-webview.md`가 2026-10-31에 없앤 층 순서, cover, 위치 IPC, overlay toast가 browser 탭에 다시 들어온다. 사람의 결정을 browser 탭에 한해 뒤집는다. 접힌 float(`work`)은 보는 때가 짧지만, `aside`·`glance`로 연 탭과 7번의 take control 로그인은 사람이 그 page를 직접 쓰는 때라 그동안 menu·popover가 page 밑에 깔린다.
  - 크기: browser 탭이라는 kind 하나에 그릇이 둘이 된다(사람 탭 `<webview>`, agent 탭 native view). 주소 줄, popup, DevTools, download, 단축키 전달, take control, 붙이기 규칙이 두 길을 갖는다. 두 길을 오래 두지 않으려면 사람 탭도 같은 그릇으로 옮겨야 하므로(단계 4), A1을 고르는 것은 사실상 "browser 탭 전체를 native view로 되돌린다"를 고르는 것이다. popup·DevTools용 native view 층과 bounds(`main/browser/view-order.ts`, `native-bounds.ts`)는 남아 있어 바닥부터 다시 짜는 것은 아니다.
  - 남은 위험: ghost 창이 사람 눈에 띄는지(1px 점, 작업 표시줄, alt-tab)는 program으로 확인하지 못했다. macOS와 Windows에서는 돌려 보지 않았다.
- **A2. 창 단위 `<webview>` 층, 창이 없을 때는 포기한다.** agent page의 `<webview>`를 `WorkspaceWindow`가 아니라 창 단위 그릇에 둔다. 그 창이 어느 workspace를 띄웠든 거기에 산다(Codex, GooeyPi, Paseo 방식). 창이 하나도 없으면 browser는 지금처럼 `unavailable`이다(이유 문장은 간다).
  - 지키는 것: 1, 3(같은 창 안에서), 4, 5. 2026-10-31 결정을 지키고 그릇이 하나로 남는다. 이번에 실제로 일어난 일(사람이 다른 workspace로 감)은 고친다.
  - 잃는 것: 2를 창 없이는 못 지킨다. 창을 모두 닫았거나 core만 뜬 job이 browser를 쓰려면 core가 창을 띄워야 한다(위 결정). 창이 여럿이면 page는 연 창에 묶이고 다른 창에서 보면 다시 load된다(결정 6). 사람이 그 창을 닫으면 page가 사라진다.
- **안 되는 안(확인으로 버렸다):**
  - 어느 창에도 붙지 않은 view, 숨은 `BrowserWindow`(`show:false`)의 view: 입력, timer, accessibility snapshot은 되지만 그리지 않는다. screenshot이 끝나지 않고 rAF, `IntersectionObserver`, `ResizeObserver`, CSS transition이 멈춘다(lazy load, 가상 목록, 많은 SPA가 여기에 기댄다).
  - 숨은 창의 `<webview>`(앞서 적었던 A3): guest가 그리지 않는다. ghost 창에서도 `<webview>`는 창이 자기만큼 커야 그린다. `<webview>`로는 창 없는 때를 지킬 길이 없다.
  - offscreen rendering: `BrowserWindow`의 것은 다른 창으로 옮길 수 없고, view의 것은 ghost 창에서 깨진다.
  - 따로 띄운 Chromium process와 screencast(T3 Code, omp, Hermes): Chromium profile은 한 process만 열 수 있어 사람 탭과 같은 partition(같은 로그인)을 쓸 수 없다. 사람이 같은 page를 쓰려면 화면과 입력도 다시 만들어야 한다.

A2로 가고, 창이 하나도 없을 때 browser가 필요하면 core가 shell을 띄워 창을 연다(사람, 2026-11-10). 처음에는 A1을 골랐다가 바꿨다. `<webview>`는 보이는 창 안에서만 그리므로(확인한 것) 그 창은 실제로 화면에 뜬다. 앞으로 나오거나 focus를 뺏지 않게 띄우고, 최소화한 채로도 그리는지는 따로 확인한다. 사람이 받아들인 대가는 "job이 browser를 쓸 때 lophn 창이 저절로 열린다"이다. 얻는 것: 2026-10-31 결정을 지키고 browser 탭의 그릇이 하나로 남으며, 창이 보이므로 agent가 사람의 로그인으로 browser를 쓰는 중임이 드러난다. 써 보고 창이 뜨는 것이 거슬리면 그때 A1(ghost 창)로 간다. 그때 버리는 것은 창 단위 그릇이고 core가 shell을 띄우는 길은 그대로 쓴다.

### B. agent page는 언제 지우나 (정했다. 추천에서 줄였다)

구현한 것:
- 탭이 닫히거나(agent의 `tab close`, 사람이 닫음), 그 page가 든 창이 닫히거나, 창마다 12개 상한에서 밀리면 page를 놓는다. 마지막 browser 호출 뒤 30분이 지나면 놓는다는 idle 타이머는 두지 않았다(agent). 자원은 상한이 막고, 쉬는 page를 말없이 놓으면 agent가 탭이 있다고 믿다가 실패한다.
- 놓인 page의 탭은 core 표에서 빠진다. 놓인 탭에 `browser.*`가 오면 마지막 url을 다시 load하지 않고 `not_found`("탭이 없다, `tab open --url`로 다시 열라")다(agent). 되살리면 agent는 옛 form과 scroll이 있다고 믿고, 탭 id를 아는 것과 page가 있는 것이 갈린다. 상한으로 놓은 탭은 그 workspace가 mount될 때 layout에서도 빠진다.
- 12개는 창마다다(shell main 전체가 아니다). 사람의 Keep alive 6개와 따로 센다. 세는 것은 mount되지 않은 workspace에 숨은 page 가운데 guest가 붙은 것뿐이다. 쓴 때는 agent의 browser 호출과 bind다. 보인 때가 아니다.
- session이 끝날 때 지우는 안은 버렸다. lophn session은 닫히지 않고 이어진다.
- core가 띄운 창은 저절로 닫지 않는다. 사람이 돌아와 그 창을 쓰거나 닫는다. page가 든 창을 사람이 닫으면 page와 탭이 없어진다.

버린 추천: idle 30분(T3 Code 방식), 놓인 page의 탭을 남기고 마지막 url을 다시 load하기. 간단하게 먼저 쓰고 틀리면 그때 더한다.

### C. 사람의 browser profile을 program으로 막나 (근거로 정한다)

추천: 이번에는 지침(6번)과 오류 문장으로 막는다. `shell.run`에는 OS sandbox가 없어서 shell 규칙은 문자열 판정이고, 지금 막아도 우회가 쉽다. 그래서 값에 비해 얻는 것이 적다. 같은 일이 한 번 더 생기면 그때 shell 규칙에 사람 browser profile 폴더 읽기와 `--remote-debugging-port`를 단 browser 실행을 넣는다.

### D. 화면 없는 머신 (하지 않는다)

A2는 보이는 창이 있어야 해서 display 없는 Linux에서는 browser를 쓸 수 없다. 그때는 이유 문장으로 끝난다. frame 있는 `BrowserWindow`는 `--ozone-platform=headless`에서 segfault가 났다(확인한 것). 서버에서 browser가 필요해지면 A1(frame 없는 ghost 창은 거기서도 그렸다)과 같이 다시 연다.

### E. 사람이 없을 때 agent가 사람의 로그인으로 browser를 쓴다 (정했다)

`browser-tab.md`의 2026-11-09 결정은 같은 partition의 대가(page 글이 agent를 속이면 사람의 로그인으로 그 site를 건드린다)를 주인 좁히기, untrusted 감싸기, take control로 막는다. take control은 사람이 보고 있어야 쓴다. 이 일은 그 대가를 사람이 Quit한 뒤와 새벽의 job까지 넓힌다.

원칙(사람, 2026-11-10): job을 등록할 때의 승인이 그 job이 browser를 쓰는 것까지 포함한다. `PRODUCT.md`의 "쓸데없는 결정 피로를 줄인다. 결정은 앞에서 몰아서 하고 그 뒤에는 믿고 쓴다" 그대로다. 그래서 무인 실행에 묻는 것을 새로 만들지 않는다.

- job의 browser 사용을 따로 승인받지 않는다. 승인 card에 표시를 더하지도 않는다. (사람)
- 사람이 Quit한 뒤에도 core는 browser가 필요하면 shell을 다시 띄워 창을 연다. Quit은 "화면을 끈다"이고 승인한 job은 계속 돈다(`job.md`). 모두 멈추는 길은 `Stop lophn`이다. (agent: 위 원칙)
- 무인일 때도 사람 탭과 같은 partition(같은 로그인)을 쓴다. 로그인 없는 partition으로 가르지 않는다. (agent: 위 원칙. 로그인이 필요한 일을 무인으로 못 하면 job의 쓸모가 없다)
- 따로 표시를 만들지 않는다. 창이 화면에 뜨는 것이 표시다. (agent)
- 남는 대가: browser로 바깥 site에 한 일은 rewind로 되돌릴 수 없다. 막는 것은 지금처럼 주인 좁히기와 untrusted 감싸기이고, 남는 기록은 session의 tool 기록이다.

## 확인한 것

Electron 44.5.1(Chrome 152), Linux에서 throwaway script로 봤다(2026-11-10). wayland(기본)와 `--ozone-platform=x11` 둘 다 돌렸다. script와 출력은 저장소에 두지 않았다.

| 자리 | screenshot | rAF·observer·transition | 입력, timer, `fetch`, accessibility tree, box model |
|---|---|---|---|
| 어느 창에도 붙지 않은 `WebContentsView` | 끝나지 않는다 | 멈춘다 | 된다(bounds가 0이 아니어야 click이 닿는다) |
| 숨은 `BrowserWindow`(`show:false`)의 view | 끝나지 않는다 | 멈춘다 | 된다 |
| 숨은 창의 `<webview>` guest | 끝나지 않는다(1px 걸치기도 소용없다) | 믿을 수 없다 | 된다 |
| ghost 창(frame 없는 투명 1x1, `showInactive()`)의 view, 1280x800 | 된다. 잘리지 않은 전체 크기 | 된다 | 된다 |
| ghost 창의 `<webview>` | 창이 `<webview>`만큼 커야 된다 | | |
| 보이는 창의 view | 된다 | 된다 | 된다 |

- **view는 `setVisible(true)`로 둔다.** ghost 창 안에서 `setVisible(false)`로 숨긴 view는 screenshot이 끝나지 않거나 들쭉날쭉하다. ghost 창에 `setOpacity(0)`을 주면 그리지 않는다.
- **여러 view.** ghost 창 하나에 view 셋을 같은 자리에 겹쳐 두어도 각각 screenshot이 자기 page로 나오고 rAF가 돈다. 수십 개일 때의 memory와 GPU 값은 보지 않았다.
- **옮기기.** 떼어 낸 view나 숨은 창의 view를 창으로, 창에서 다른 창으로, 다시 떼었다 붙여도 다시 load하지 않는다. page의 JS 상태, 붙여 둔 debugger, 옮기기 전에 얻은 `backendNodeId`가 그대로다. view가 든 창을 닫아도 view의 webContents는 살아 있어 다른 창에 붙일 수 있다.
- **창 없는 앱과 second-instance.** `BrowserWindow`가 하나도 없어도 앱은 살아 있다. single-instance lock을 쥔 창 없는 main에 두 번째 실행이 오면 `second-instance`가 오고, 창을 만들어 있던 view를 붙여도 다시 load하지 않는다.
- **partition.** 같은 partition의 `WebContentsView`와 `<webview>`는 같은 session이다(cookie를 서로 본다). 그래서 agent 탭과 사람 탭의 그릇이 달라도 로그인은 같다.
- **display 없는 Linux.** D에 적었다.
- **조심할 것.** 떼어 낸 view에 첫 load 전에 debugger를 붙이고 `Emulation.setDeviceMetricsOverride`를 부르면 segfault가 난다(load 뒤에는 괜찮다). 한 번도 그리지 않은 page의 첫 `Input.dispatchMouseEvent`가 5초 동안 돌아오지 않은 적이 있다(event는 닿았다).
- **확인하지 못한 것.** ghost 창이 사람 눈에 띄는지(1px 점, 작업 표시줄, alt-tab), macOS dock과 Windows 작업 표시줄, macOS와 Windows에서 ghost 창이 그리는지, 실제 site가 그리지 않는 page에서 얼마나 멈추는지(만든 page 하나로만 봤다).

### 세 번째 확인: `<webview>`가 언제 그리는가 (2026-11-10, Electron 44.5.1, Linux x11과 wayland)

A2를 구현하며 `<webview>` guest가 어떤 창에서 그리는지 다시 봤다(throwaway script, 저장소에 두지 않았다).

- guest는 화면에 보이는 최소화하지 않은 창에서만 그린다. 숨긴 창과 최소화한 창(x11)에서는 그리기를 멈춘다. 다른 창에 완전히 덮여도 그린다(x11).
- 창 안(문서)에서는 "화면 위에 있음"과 "1px 띠가 가려지지 않음"만 믿을 수 있다. 완전히 가려진 것(다른 내용 뒤, opacity 0)이나 viewport 밖에 둔 것은 그리지 않는다. 그래서 숨은 agent page는 그릇의 오른쪽 아래에 1px만 걸쳐 둔다.
- Wayland에서는 `showInactive()`로 연 창이 focus를 가져갈 수 있었다. 창 option `focusable: false`가 이를 막았으나 채택하지 않았다(그 창은 사람이 입력을 받지 못한다. 이유를 기록하지 않았다).
- 확인하지 못한 것: 최소화한 창은 x11에서 쟀고 macOS와 Windows는 돌려 보지 않았다.

## 단계

0. ~~**확인.**~~ 봤다("확인한 것"). A는 A1, E는 위대로 정했다.
1. ~~**오류 계약과 지침.**~~ 구현했다. `browser.*`·`tab.*`의 `unavailable`·`conflict`가 고정 문장을 싣고, agent 지침(workspace prompt 셋, `write-artifact` skill, coding agent의 `lophn-agent` skill)에 6번을 넣었다. "탭이 창에 열려 있지 않다"와 "앱이 붙어 있지 않다" 문장은 지금 동작을 말하므로 2·3단계가 고친다.
2. ~~**창 단위 그릇과 열기.**~~ 구현했다. agent가 연 browser 탭의 `<webview>`가 창 단위 그릇에 살고(창마다 12개, 따로 센다) `tabs/open`은 page가 붙은 뒤에 답한다. 4·5·8번과 B를 줄여서 했다(idle 타이머와 마지막 url 다시 load는 두지 않았다). `workspace-layout.md` 결정 18과 "agent가 연 탭", `browser-tab.md` 결정 5·41과 "agent가 다루는 탭"을 고쳤다.
3. ~~**core가 shell을 띄운다.**~~ 구현했다. 창이 없으면 shell main이 focus 없이 창을 열고(`showInactive`), shell이 없으면 core가 `--agent-window`로 앱을 띄운다(켠 core만, 한 번에 하나, 실패 뒤 5분 쉼). `platform.md`의 launch intent와 core 수명을 고쳤다. macOS·Windows는 돌려 보지 않았다.
4. **사람 탭(나중).** 사람 browser 탭도 같은 창 단위 그릇에 두어 workspace를 오가도 다시 load하지 않게 할지 정한다. Keep alive는 화면을 내렸느냐가 아니라 자원(상한) 정책이 된다.

## 하지 않는 것

- 사람의 Chrome·Brave profile에서 쿠키 가져오기. 로그인은 lophn browser에서 사람이 하고, 비밀번호는 `browser-vault.md`다.
- 따로 띄운 Chromium process, screencast viewer.
- core 안에 browser 엔진 두기. browser는 shell main의 것이다(Chromium profile을 한 process만 연다).
- preview 탭의 수명 바꾸기. 앱 view는 registry, ticket, 앱별 partition, preload가 `<webview>` 붙이기에 묶여 있어(`app-webview.md`) 그릇을 옮기는 값이 크다. preview는 agent가 앱을 만드는 동안 쓰고 대개 사람이 그 workspace에 있다. 창 없이 preview를 다뤄야 하는 일이 실제로 생기면 따로 연다.
- artifact 탭의 수명 바꾸기(사람, 2026-11-10: 이번에는 뺀다). 그래서 agent는 그 workspace를 띄운 창이 없으면 artifact 탭을 열지도 다루지도 못하고, job이 만든 artifact는 화면 확인 없이 나간다. 남는 한계와 고치는 안은 이슈 `agent-artifact-tab-needs-mounted-workspace`다.
- run 도중 사람을 기다리는 새 장치(7번).
- 앱 live 화면을 agent가 다루는 일(`browser-tab.md` 비목표 그대로).
