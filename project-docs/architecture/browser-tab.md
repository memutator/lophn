# browser-tab

workspace 창의 탭으로 인터넷 page를 여는 탭 kind `browser`의 설계다. 사람은 탭에 주소를 적어 page를 보고, popup·DevTools·bookmark를 쓰고, terminal이 연 URL과 Ctrl/Cmd-click한 link도 이 탭으로 받는다. agent는 자기가 연 browser 탭과 앱 preview 탭을 CLI(`lophn browser`)로 읽고 조작한다. lophn이 다루는 것 가운데 가장 믿지 못할 입력이 인터넷 page이므로, page가 닿는 길(navigation, popup, permission, download, IPC)은 shell main의 순수한 규칙이 정하고, Electron 연결은 그 규칙을 부르기만 한다.

page를 그리는 그릇은 둘이다. 보통 탭은 shell renderer 안의 `<webview>`(앱 화면·artifact 화면과 같은 창의 같은 그릇)이고, `window.opener`를 지켜야 하는 크기 준 popup과 DevTools만 native `WebContentsView`다.

## 문제

- 사람은 terminal에서 dev server를 띄우거나 `gh auth login`을 하면 lophn 창과 OS browser를 오가야 했다.
- page는 인터넷이다. 앱 화면과 달리 lophn이 만든 코드가 아니므로, 이동·새 창·권한·download·IPC로 shell이나 사람의 data를 건드리지 못하게 막아야 한다.
- 보이는 page가 shell의 menu·popover·floated 패널 밑에 깔리면 쓸 수 없다.
- terminal이 여는 로그인 URL(OAuth 등)을 잃으면 사람이 다시 할 길이 없다.
- agent가 사람의 dev site를 직접 보고 조작하려면 로그인한 session을 써야 하지만, page 글이 agent를 속이면 그 로그인으로 site를 건드릴 수 있다.

## 목표와 비목표

- 목표: 탭 안에서 일반 page, 크기 준 popup(로그인), DevTools, bookmark, favicon을 쓴다. terminal의 `$BROWSER`와 Ctrl/Cmd-click link가 같은 창에서 탭으로 열린다. agent가 자기가 연 탭을 읽고 조작한다.
- 비목표: tab 수 cap, site 목록, capability 승인, storage mode, 사용자가 쓰지 않는 설정(rea가 모은 것 가운데 dev server와 로그인에 필요한 것만 남겼다). 진짜 폰(emulation은 크기·touch·user agent까지다). localhost·사설 IP 차단. page 쪽 preload나 IPC. 앱 live 화면을 agent가 다루는 일.

## 모델

- **탭.** layout의 browser 탭은 `{key, url, favicon}`만 저장한다. title, history, DevTools 자리는 저장하지 않고 다시 열면 그 url을 load한다. 선택 필드 `keep_alive: true`는 켠 탭만 적는다(없는 옛 파일은 꺼진 탭이다).
- **page 그릇 둘.**
  - guest: 보통 탭의 `<webview>`. 창마다 하나인 webview host에 탭 key당 하나 만들고, 탭 자리는 사각형만 알린다. view session 이름은 `wv-<guest contents id>`이고 main과 renderer가 IPC 없이 같은 이름을 안다. 앱·artifact 화면도 같은 host와 그릇을 쓴다.
  - native view: 크기 준 popup과 DevTools. browser 자기 registry의 항목이고 앱 view registry에 넣지 않는다. 위치는 renderer 사각형을 창 좌표로 바꿔 정하고, 층은 창마다 하나다. popup은 opener의 contents를 그대로 감싼 것이고, DevTools는 page마다 새 native view 하나에 붙는다(`devtools-<page id>`).
- **session.** 모든 browser 탭이 persistent partition 하나(`persist:lophn-browser`)를 쓴다. 앱 저장소 partition과 나뉘어 page가 앱 화면의 cookie·storage를 보지 못한다. 첫 view, 첫 `<webview>` attach, 첫 데이터 지우기 때 한 번 설치한다. 거기서 permission, download, user agent 규칙이 걸린다.
- **사용자 입력(activation).** contents마다 마지막 mouseDown·keyDown 시각이다. 5000ms 안이면 fresh다. popup, download, OS 넘기기가 이것을 본다.
- **여는 길 셋.**
  - 주소 칸: 사람이 적은 글을 main이 정규화하고 navigation 규칙을 지나게 한 뒤 load한다.
  - page 안: link 이동은 navigation 규칙, `window.open`은 popup 규칙을 지난다.
  - terminal: shell 탭이 부른 `$BROWSER <url>`(shim → socket bridge)과 Ctrl/Cmd-click한 link가 같은 판정과 같은 push로 탭을 연다.
- **popup.** `window.open`(입력 5000ms 안):
  - 크기 준 것은 native view로 등록하고(아직 adopt 안 됨) `popup` event를 보낸다. renderer가 transient floated 탭을 열어 adopt한다. dock하면 그 탭은 같은 주소의 `<webview>` 탭으로 다시 열린다.
  - 크기 없는 것(`target=_blank`)은 거절하고 `open-tab` event로 연 탭 바로 뒤에 `<webview>` 탭을 연다.
  - page의 `window.close()`는 `close` event로 renderer가 탭을 지운다.
- **DevTools.** 자리 셋: 탭 안 오른쪽·아래(경계 막대로 크기), floated 패널(transient kind `browser_devtools`, detached 창의 자리 menu에는 없다), 따로 뜬 OS 창. 자리를 바꿀 때 다시 열지 않고 view를 옮긴다.
- **bookmark.** `<dataRoot>/shell/bookmarks.json` 하나. main만 쓴다.
- **terminal bridge(shell 탭만).** 앱이 켜질 때마다 per-run 폴더에 shim과 bridge socket(Windows는 named pipe)을 준비한다. shell 탭을 열 때 main이 탭마다 key(64 hex)를 발급하고 env `BROWSER`(shim 경로)와 `LPN_BROWSER_BRIDGE`(`{"socket","key"}`)를 terminal host의 open 요청에 실어, host가 terminal env 뒤에 덮는다(restart도 같은 env). 요청 한 줄 `{v:1,key,url}`을 받은 main은 key 표와 설정으로 판정해 모든 shell 창에 `shell:terminal-bridge-open`을 push하고, 그 terminal 탭을 가진 창이 탭을 열고 ack하면 `{"result":"pane"}`, 1500ms 안에 ack가 없으면 `{"result":"declined"}`를 shim에 돌려준다. shim은 pane이면 끝나고, 그 밖(declined, 접속 실패, 3000ms)은 bridge env를 지운 채 OS opener(`xdg-open`·`open`·Windows `cmd.exe start`)로 연다. Ctrl/Cmd-click은 `shell:terminal-link`로 main에 오고 같은 판정·같은 push를 쓰며 탭이 안 열리면 main이 OS browser로 연다.
- **agent가 다루는 탭.** 주인(연 session, 사람 token이면 "person")이 host queue의 `browser_call`로 shell main에 요청하고, shell main이 CDP로 그 탭의 guest를 조작한다. 상태(Agent가 다루는 중인가, 사람이 가져갔나)는 shell main 메모리에 탭마다 있고 core는 모른다. 대상은 `tab open`으로 연 browser 탭(host 탭, key가 `host:`로 시작), preview 탭, artifact 탭뿐이다. host browser 탭의 page는 그 탭을 든 창이 사는 동안 어느 workspace를 보이든 산다(결정 5, 41).
- **Keep alive.** workspace를 떠날 때 guest를 지울지 숨겨 둘지: 소리가 나는 중, download를 받는 중, 사람이 탭 menu에서 Keep alive를 켠 탭은 창의 그릇에 숨겨 둔다. 창마다 6개이고 넘치면 오래 안 본 것부터 놓는다. agent가 `tab open --url`로 연 탭의 page는 이 규칙 밖이다(창마다 12개, 따로 센다).

## 지키는 것

### navigation과 guest

1. **navigation 결정은 순수 함수 하나가 한다.** main frame은 http/https(어느 host든, localhost와 사설 IP 포함)와 정확히 `about:blank`만 받는다. 최상위 `data:`·`blob:`은 막는다. subframe은 http/https와 `data:`·`blob:`·`about:`도 받는다. 그 밖의 scheme(`file:`, `lophn-*:`, `chrome:`, `devtools:`, `javascript:`, custom protocol)은 두 frame 모두 막는다. main frame의 userinfo(`user:pass@`) URL은 막는다. main frame 이동은 이동 직전 hook과 redirect hook 모두에서 검사한다.
2. **`<webview>`는 shell 창에서만, 우리 설정으로만 붙는다.** 이 그릇을 켜는 창은 shell 창(project 창, detached 창, 앱 전용 창)뿐이고 secret 입력 창은 끈다. 붙이기 판정은 모든 kind가 한 곳을 지난다. shell 문서(`lophn-shell://desktop`)가 아닌 곳에서 온 붙이기는 거절한다. browser는 `persist:lophn-browser` partition이고 `lophn-*` src가 아닐 때만 받고 첫 src를 navigation 규칙에 지나게 한다(못 지나면 `about:blank`). 앱·artifact는 registry가 받아 준 그 src와 partition일 때만 받고 renderer가 적은 값을 쓰지 않는다. 어느 쪽이든 renderer가 넣은 preload·webpreferences·`disablewebsecurity`·`nodeintegration`·`useragent`·`allowpopups`를 지우고 hardened `webPreferences`로 덮은 뒤 partition·preload를 다시 넣는다(지우면 guest가 다른 session에 붙는다). 붙인 뒤에는 받아 둔 붙이기를 순서대로(FIFO) guest 항목에 묶는다.
3. **page에는 preload도 IPC도 없다.** 뒤로·앞으로·새로 고침·주소 이동·DevTools는 shell의 머리 줄(주소 칸과 단추)이 main IPC로 시킨다. navigate·command·adopt·DevTools 요청은 caller 창이 그 항목의 소유 창일 때만 받는다.
4. **`<webview>`는 다른 부모로 옮기지 않는다.** 옮기면 guest가 다시 만들어져 page가 다시 load되고 opener가 끊긴다. 탭이 모든 desk의 layout에서 사라지거나 Detach될 때만 지운다. desk를 바꾸는 것만으로는 지우지 않아 돌아와도 다시 load하지 않는다. 쌓는 순서는 pane 탭의 `<webview>`가 pane의 경계 잡는 띠 아래·패널 모두 아래이고, floated 탭의 것은 자기 패널 위·다음 패널 아래다(`workspace-layout.md`).
5. **workspace를 떠날 때는 기본적으로 guest를 지운다(돌아오면 다시 load).** 소리가 나는 중, download를 받는 중, Keep alive를 켠 탭은 지우지 않고 숨겨 둔다(창마다 6개, 오래 안 본 것부터 놓는다. `workspace-layout.md`). 살려 둘지는 떠날 때 한 번 정한다. Keep alive의 켜고 끄기는 탭 menu에서 한다. 소리 여부는 떠날 때 한 번 본다. 예외가 하나 있다: agent가 `tab open --url`로 연 탭(key `host:`)의 page는 workspace를 떠나도 지우지 않고 그 탭을 든 창이 사는 동안 둔다. 6개 상한과 따로 창마다 12개까지이고 오래 쓰지 않은 것부터 놓는다(agent의 browser 호출과 bind가 쓴 것이다. `workspace-layout.md`).
6. **다른 OS 창으로 탭을 옮기면 `<webview>` 탭(browser·앱·artifact)은 다시 load되고 그 탭의 DevTools는 닫힌다.** 다시 load 없이 옮길 수 있는 것은 native 항목(popup, DevTools)뿐이다. 소유 창은 항목마다 있고 Detach·Dock이 바꾸므로, popup의 adopt·요청 검사는 옮긴 뒤의 창을 기준으로 한다(`workspace-layout.md`). 앱·artifact 탭은 보내는 창이 element를 지우고 받는 창이 새 view를 연다.
7. **session 설치는 한 번, 모든 browser 탭이 partition 하나를 같이 쓴다.** 앱 저장소 partition과 나뉜다.

### popup

8. **크기 준 popup만 native view로 받아 `window.opener`를 남긴다.** Electron이 새 창 요청에 준 contents를 그대로 감싸야 opener가 남는다. 표준 Electron에는 그 contents를 `<webview>`에 넣는 길이 없다. popup contents는 opener의 session과 webPreferences를 물려받고 features로 바꾸지 못한다. 입력 없는 popup은 거절하고 `popup-blocked`를 알린다.
9. **크기 없는 popup은 거절하고 새 `<webview>` 탭으로 연다.** opener가 끊긴다. Chrome도 `target=_blank`는 기본이 noopener다. 크기 없이 `window.open`을 쓰는 로그인은 깨질 수 있다.
10. **popup view는 renderer가 탭을 만들어 adopt하기 전까지 state를 밀지 않는다.** adopt는 소유 창(opener의 창)에서 한 번만 된다. 다른 창은 `invalid_input`, 두 번째는 `forbidden`이다. adopt되지 않은 view는 그 창이 닫힐 때 같이 지운다. popup은 opener 탭을 닫아도 남는다.

### OS로 넘기기, permission, download

11. **`mailto:`·`tel:`만 OS로 넘기고, main frame에서 사용자 입력 직후일 때만 넘긴다.** subframe은 조용히 막는다. 주소 칸에 적은 `mailto:`는 page 입력이 아니라서 거절한다. main frame의 이 이동은 `will-frame-navigate`가 먼저 오고 거기서 막으면 `will-navigate`가 오지 않으므로, 넘기는 일은 `will-frame-navigate`와 redirect에서 한다.
12. **permission은 clipboard write(`clipboard-sanitized-write`)를 main frame의 http/https가 요청할 때만 허락한다.** 그 밖(clipboard read, media, 위치, 알림, device)은 모두 거절한다.
13. **download는 저장 경로를 정하지 않아 Electron 저장 dialog가 뜬다.** 시작한 contents를 모르거나 입력 직후(fresh)가 아니면 거절한다.
14. **user agent와 요청 header에서 `Electron/x`만 빼고 앱 이름 token(`lophn/x`)은 남긴다.** Chrome인 척하지 않는다. client hints(`sec-ch-ua`)와 page JS의 `navigator.userAgentData`는 Chromium 값 그대로다.
15. **사용자 입력의 시각은 인자로 받는다.** 전역 시계를 읽지 않는다.

### favicon, bookmark, 데이터 지우기

16. **favicon은 main이 그 page의 session으로 받아 data URL로 바꿔 싣는다.** shell CSP가 `img-src 'self' data: blob:`이고 shell 화면이 인터넷에 직접 요청하지 않는다. image type, 받은 byte 48KB, data URL 65536자까지다. 다른 origin으로 가면 비운다.
17. **탭의 favicon은 탭 필드에 두고 layout에도 저장한다.** 탭이 다시 mount될 때(접힘 해제, Float·Dock, desk 전환) 이 값을 이어 받는다(`<webview>`는 favicon을 모른다). main은 favicon을 바뀔 때만 밀므로, mount 여부와 상관없이 창이 state push를 받아 탭의 favicon을 갱신한다. 접힌 float과 다른 desk의 탭은 mount하지 않아 이 값이 접힌 아이콘의 출처이고, workspace를 옮겼다 오거나 다시 시작할 때 page가 아직 없는 탭의 아이콘도 이 값이다. layout의 favicon은 `data:image/`로 시작하는 65536자까지만 받고, 맞지 않으면 renderer가 빼고 저장한다(탭을 잃지 않게). bookmark favicon은 더할 때 한 번 저장한다.
18. **Clear browsing data는 저장소 전체를 지우고 cache를 지운 뒤 열린 page를 다시 load한다.** 지울 종류를 이름으로 고르지 않는다(Electron 44의 이름이 rea·Chrome 문서와 달라 이름을 적으면 덜 지워진다).
19. **bookmark는 `<dataRoot>/shell/bookmarks.json` 하나에 main만 쓴다.** temp 뒤 rename으로 쓰고(폴더 0700·파일 0600) layout과 같은 방식이며, 쓰기를 한 줄로 세워 창 둘의 요청이 서로 덮지 않는다. 바뀌면 열린 모든 shell 창에 `shell:bookmarks-changed`로 알린다.
20. **깨진 `bookmarks.json`(JSON 아님, schema·version 불일치, 모르는 칸)은 어떤 쓰기도 덮어쓰지 않는다.** 목록은 `corrupt` 상태로 보이고 화면은 고치는 길을 열지 않는다. byte 단위로 그대로 남는다.
21. **bookmark url은 http/https이고 userinfo가 없는 것만, `href` 완전 일치로 하나만 둔다.** 1000개, title 200자, url 8192자까지다.

### DevTools

22. **DevTools는 page마다 새 native view 하나에 붙인다.** `<webview>`는 DevTools를 담지 못한다(frontend가 page에 붙지 않는다). 붙은 view는 탭 안, floated 패널, 다른 OS 창으로 옮겨도 끊기지 않는다. 닫을 때는 view를 부순다. 닫은 뒤 같은 view로 다시 열면 붙지 않는다. 열린 상태는 main이 든다(Electron의 열림 질의가 이 방식에서는 늘 false다).
23. **DevTools 경계 막대는 DOM drag다.** 끄는 동안 투명한 막을 page 위에 덮고 DevTools native view를 숨긴다.

### terminal bridge

24. **bridge의 권한 판정은 순수 함수가 한다.** 요청 줄은 JSON 한 줄, `v === 1`, key 64자 hex, 8192 byte 이하만 받는다. browser 탭으로 넘기는 URL은 절대 http/https, userinfo 없음, 8192자 이하다. local은 `localhost`·`*.localhost`·`*.local`·loopback·사설·link-local IPv4와 `::1`·`fc00::/7`·`fe80::/10`이다.
25. **`pane`은 "창이 실제로 탭을 열었다"는 뜻이다.** main은 push만 하고 답하지 않는다. 그 terminal 탭을 가진 창의 renderer가 탭을 연 때만 ack를 보내고, 1500ms(shim의 3000ms보다 짧다) 안에 ack가 없으면 `declined`다. terminal 탭을 가진 창이 없는 때(Settings route, 닫힌 창)의 URL은 OS browser로 간다. detached 창에는 이 hook이 없지만, 뗄 때의 `terminal_ref`가 project 창의 terminal store에 남아 project 창이 URL을 그 terminal 탭 바로 뒤에(group이면 group 뒤에) browser 탭으로 열고 ack한다. 다시 열어 복원한 detached terminal은 어느 창도 ref를 몰라 `declined`(OS browser)다. 조용히 사라지는 URL은 없다. Ctrl/Cmd-click도 탭이 안 열리면 main이 OS browser로 연다. bridge가 준비 실패로 꺼져 있어도 link는 OS browser로 간다.
26. **key는 terminal 탭마다 main이 발급한다.** bridge가 자기 listen에 성공한 뒤에만 key와 env를 만들고, host open이 성공해야 key를 그 terminal 탭에 묶는다. 묶이지 않은 key의 요청은 `declined`다. 탭을 닫아 close가 `exited`로 답할 때 폐기한다. 인증은 key가 표에 있는지만 본다(SID·DACL 검사는 더하지 않는다). 그 터미널의 process는 env로 key를 이미 알고, POSIX socket은 `0700` 폴더 안의 `0600` file이고 Windows는 named pipe다.
27. **env는 `BROWSER`와 `LPN_BROWSER_BRIDGE` 둘이다.** `LOPHN_`로 시작하는 env는 terminal이 지우므로 이름을 `LPN_`으로 했다. host는 strip 뒤에 덮는다. 사용자가 앱 env에 `BROWSER`를 두었으면 넣지 않는다. 그 shell은 key도 없어 Ctrl/Cmd-click link도 OS browser로 간다. 단 `LPN_BROWSER_BRIDGE`가 같이 있으면 바깥 lophn의 shim이라 덮는다.
28. **shim은 앱이 켜질 때 main이 만든다.** 박아 넣는 Electron 실행 경로가 packaged와 dev에서 달라 설치 묶음에 싣지 않는다. POSIX는 per-run 폴더의 sh, Windows는 data root `run\browser-<hash>\browser.exe`이고 둘 다 공통 JS를 Electron Node로 띄워 사용자 PATH의 `node`를 기대하지 않는다. Windows exe는 OS의 .NET Framework 4 `csc.exe`로 build하고 같은 내용이면 다시 쓴다. csc가 없으면 bridge만 끈다. `.cmd`를 쓰지 않는 이유는 cmd.exe가 인자의 `& | % ^`를 명령으로 해석하고(URL이 잘리고 `&` 뒤가 실행됐다) file을 console 코드페이지로 읽어 한글 경로가 깨졌기 때문이다. exe는 자기 child에만 `ELECTRON_RUN_AS_NODE=1`을 두고 인자를 CommandLineToArgvW 규칙으로 다시 묶어 넘긴다. Windows OS fallback은 `cmd.exe start`의 빈 title과 URL을 분리하고 cmd metacharacter를 escape한다. shim은 URL·key를 출력하지 않고, OS opener에 넘길 때 `BROWSER`·`LPN_BROWSER_BRIDGE`·`ELECTRON_RUN_AS_NODE`를 지운다(안 지우면 `xdg-open`이 shim을 다시 부른다).
29. **공통 JS는 CJS·ESM 어느 package 아래서도 돈다.** Windows 개발 실행은 file 폴더가 저장소 data root 아래라 `"type": "module"`을 물려받는다. 그래서 `require` 전역에 기대지 않고 async 안의 dynamic import로 Node 모듈을 읽는다.
30. **per-run 폴더 자리는 core socket 폴더 규칙을 따른다.** POSIX는 공통 directory 아래 `shell-<pid>/`(0700), Windows file은 `<data root>/run/shell-<pid>/`이고 endpoint는 별도 named pipe다. pipe는 file처럼 mkdir·chmod·remove하지 않는다. 두 endpoint의 UTF-8 byte가 플랫폼 한도(Linux 107·macOS 103·Windows 256)를 넘으면 폴더 정리 전에 hook·bridge를 끄고 로그 한 줄만 남긴다. pointer file·TCP fallback은 없다. 앱과 shell 탭은 그대로 뜬다(OS browser). 폴더는 app ready 뒤 single-instance lock을 가진 process만 만든다. 시작할 때 같은 data root의 자기 pid 또는 죽은 pid의 `shell-<숫자>` 폴더만 지우고, 살아 있는 sibling·다른 이름·core socket·다른 data root는 건드리지 않는다. 앱을 끌 때 자기 폴더만 동기로 지운다.
31. **hook 준비는 shim·bridge listen과 분리한다.** 폴더가 준비되면 hook은 자기 endpoint를 독립적으로 연다. shim 쓰기나 bridge listen이 실패해도 hook이 쓰는 폴더는 지우지 않는다.
32. **link를 열 곳은 core 선언 설정 `shell.browser.web_links`·`shell.browser.local_links`(`browser_tab` | `system_browser`, 기본 `browser_tab`)다.** main이 요청마다 `memory:settings/list`로 읽고, 못 읽으면 기본값이다. Settings › Browser › Links가 고친다. key 글자는 core의 선언과 shell의 판정 두 곳에 있다(shell은 core를 import하지 못한다).
33. **탭을 여는 자리는 renderer의 open 규칙이 정한다.** 규칙은 `workspace-layout.md`의 "탭 안에서 연 것의 자리"다. terminal이 보이지 않는 desk에 있으면 그 desk로 넘어가 terminal 탭 바로 뒤에 연다(로그인 URL은 사람이 그 page를 봐야 해서). 그 desk의 view를 hook이 모르므로 반대쪽 pane 규칙은 보이는 desk에만 쓴다. 그냥 click은 text 선택이고 Ctrl/Cmd-click만 link다. OSC 8 자동 링크는 지금도 삼킨다.

### agent가 다루는 탭

34. **`lophn browser snapshot|act|navigate|screenshot|evaluate|logs|wait`는 `tab open`으로 연 browser 탭, preview 탭, artifact 탭만 다룬다.** 주인(연 session, 사람 token이면 "person")만 부른다. 사람이 손으로 연 탭(사람이 연 artifact 탭 포함)과 앱 live 화면은 다룰 수 없다(앱 live 화면은 sender view 신원으로 operation 막기를 건너므로 어떤 bind로도 고르지 않는다). 길은 host queue의 `browser_call`이다(`workspace-layout.md` "agent가 연 탭").
35. **상태는 agent가 연 탭만 core에 알린다.** key가 `host:`로 시작하는 탭의 url·title·loading을 renderer가 `shell:surface-report`로 보내고 main이 `host/report`로 core 표에 둔다. state와 bind는 창 단위로 알려 그 workspace가 mount되지 않은 동안에도 간다. agent와 사람 token은 `lophn browser read <tab>`으로 자기가 연 탭의 마지막 상태를 읽는다. 없는 탭, 닫히거나 page가 없어져 core 표에서 빠진 탭, 남의 탭은 같은 `not_found` 문장 하나다(탭이 있는지 새지 않게). 사람이 손으로 연 탭과 상태가 아직 없는 탭도 `not_found`다.
36. **page에서 온 글은 `<lophn-untrusted source="browser.<명령>">`로 감싼다.** page는 인터넷이다. lophn agent는 tool 이름 규칙으로, binary는 찍는 글에 같은 tag를 둔다. 본문의 `<lophn-`는 escape되어 tag를 닫지 못한다. tag를 만들고 escape하는 곳은 core 밖 공유 protocol 코드 하나다(binary가 core를 import하지 못해서). 반대로 `browser`·`tab` 호출의 `unavailable`·`conflict` 문장과 `browser` 호출의 `not_found` 문장은 감싸지 않고 model에 그대로 간다. 그래서 그 문장은 lophn이 쓴 고정 문장(원인, 다음 할 일, 되풀이해도 되는지)이고 page나 Chromium의 글을 넣지 않는다(net error 이름만 예외). `not_found`는 없는 탭과 남의 탭이 같은 문장이라 존재가 새지 않고, 탭이 닫혔으면 다시 열라고 알려야 해서 싣는다. 이유를 못 받은 agent가 바깥 browser를 띄운 일이 있어서다.
37. **shell main이 CDP로 실행한다.** renderer가 host 탭의 view session을 `shell:surface-report {bind}`로 알리면(host browser 탭은 창 단위로 알려 workspace가 mount되지 않아도 된다) main이 browser 탭은 `wv-<id>`의 guest(`persist:lophn-browser` partition인 것만), preview 탭은 앱 view registry에서 `mode: "preview"`인 view만, artifact 탭은 artifact view registry에 붙은 guest만 고른다. 그 탭의 첫 호출에서 debugger를 붙여 탭이 닫힐 때까지 둔다. 입력은 CDP `Input.*`이다(`sendInputEvent`는 `<webview>` guest에 닿지 않는다). DevTools가 열려 있으면 붙지 못해 `conflict`다. page가 사라진 틈(그 page를 든 창이 닫힘, page가 죽음)에는 browser 탭에는 "page가 없다, `tab open --url`로 다시 열어라"를 `unavailable`로 답한다.
38. **snapshot과 ref.** accessibility tree를 `- <role> "<name>" [ref=eN]` 줄로 쓴다(입력 칸은 `value=`). ref 번호는 탭마다 하나의 counter에서 이어지고(다음 snapshot은 앞 번호 다음부터) 탭은 마지막 snapshot의 ref만 든다. main frame이 이동하면 비운다. 그래서 옛 ref는 새 node를 가리키지 않고 `conflict`다.
39. **dialog는 자동으로 닫는다.** alert·beforeunload는 accept, confirm·prompt는 dismiss이고 그 호출(다루지 않는 사이에 뜬 것은 다음 act·navigate·wait)의 결과에 `dialog`로 적는다.
40. **take control.** agent가 다루기 시작한 탭은 탭 머리(preview는 안내 줄)에 "Agent is controlling this tab"과 [Take control]을 둔다. 사람이 가져오면 agent의 act·navigate·evaluate는 `conflict`이고 snapshot·screenshot·logs·wait·read는 된다. [Hand back]으로 푼다. 상태는 shell main 메모리에 탭마다 있고 core는 모른다.
41. **뒤에 연 탭도 바로 다룬다.** `tab open`은 늘 뒤에 열리므로 host 탭의 browser·preview·artifact 본문은 고르지 않아도 숨은 그릇에 mount된다. agent가 다루는 동안 숨은 guest는 그리기를 이어 가야 screenshot과 입력이 되므로, 다른 내용 뒤가 아니라 창 오른쪽 아래 1px만 걸쳐 둔다(뒤에 두면 Chromium이 그리기를 멈춘다). host browser 탭(`--url`)은 여기에 더해 workspace가 mount되지 않아도 page가 있다. 창이 page를 그 workspace의 pool에 숨은 항목으로 만들어 두고 자리는 다음 mount로 미루며(다시 load하지 않는다), `tabs/open`은 page가 붙은 뒤에 답한다(shell이 있으면 10초, 앱을 띄웠으면 30초, 실패는 `unavailable`이고 탭이 남지 않는다). page는 탭을 닫거나 창이 닫히거나 상한(창마다 12개, 가장 오래 쓰지 않은 것)이 놓을 때까지 있다. 없어지면 탭도 core 표에서 빠지고 뒤의 `browser.*`는 `not_found`다(마지막 url을 되살리지 않는다. agent가 다시 연다). 창이 하나도 없으면 lophn이 창을 focus 없이 열고 앱이 꺼져 있으면 앱을 띄운다(`workspace-layout.md`, `platform.md`). 열린 창이 최소화되어 있으면 그리지 않아 screenshot이 실패한다.
42. **screenshot.** lophn agent는 image content로 받는다. binary는 PNG를 `--out <path>`나 `<os tmpdir>/lophn-screenshots/<tab>-<unix ms>.png`에 쓰고 그 path를 찍는다(harness는 자기 Read tool로 본다). emulation된 page의 screenshot은 CSS px 크기다.
43. **기기 emulation은 preview 탭에만 있고, 고른 기기는 탭 상태에만 있다.** emulation은 driver와 같은 debugger를 owner를 나눠 같이 쓴다(webContents 하나에 debugger 하나). DevTools가 열려 있으면 걸지 못해 Desktop으로 돌아가고 안내를 보인다.

## 경계와 계약

**shell IPC(renderer ↔ main).** preload `window.lophnBrowser`는 shell 창(project 창과 detached 창)에만 있다.
- 요청: `shell:browser-navigate`, `shell:browser-command`(뒤로·앞으로·새로 고침), `shell:browser-adopt`, `shell:browser-clear-data`, `shell:browser-devtools-open|close|window`, `shell:bookmarks-list|add|update|remove`. native 항목의 자리는 `shell:view-bounds`·`shell:views-hidden`.
- push: `shell:browser-state`(url·title·loading·favicon·crash), `shell:browser-event`(kind `popup`, `popup-blocked`, `open-tab`, `close`, `bookmark-key`, `download`, `devtools-closed`), `shell:bookmarks-changed`.
- terminal: `shell:terminal-link`(Ctrl/Cmd-click), `shell:terminal-bridge-open`(push), `shell:terminal-bridge-ack`(invoke).
- agent 쪽: `shell:surface-report {bind}`, `shell:surface-request`·`surface-ack`, `shell:surface-control`·`surface-take`(take control), `shell:surface-emulate`, `shell:surface-workspace`.
- 오류는 공통 일곱 code다. 예: popup adopt의 다른 창은 `invalid_input`, 두 번째는 `forbidden`.

**layout.** browser 탭 `{key, url, favicon}`과 선택 `keep_alive`. 탭은 desk당 1200개 상한(layout 일반 규칙)이 있어 browser 전용 cap은 두지 않는다.

**저장 file.** `<dataRoot>/shell/bookmarks.json`(0600, 폴더 0700, atomic write, version과 알려진 칸만). run 폴더(`shell-<pid>/`)는 앱이 도는 동안만 있는 shim·socket 자리다.

**설정 key.** `shell.browser.web_links`·`shell.browser.local_links`(`browser_tab` | `system_browser`, 기본 `browser_tab`). `shell.devices`(사람이 등록한 기기: 이름, 크기, DPR, OS `ios|android`, 32개까지, 기본 `[]`).

**terminal bridge protocol.** 요청 `{v:1,key,url}` 한 줄 → 답 `{"result":"pane"|"declined"}` 한 줄. env `BROWSER`, `LPN_BROWSER_BRIDGE={"socket","key"}`. ack 대기 1500ms, shim 접속 한도 3000ms.

**host queue의 browser 호출.** memory route `tabs/open`, `tabs/close`, `tabs/show`, `browser/read|snapshot|act|navigate|screenshot|evaluate|logs|wait`(boundary-catalog의 host queue 계약). 호출 기한 30초. act는 `click|type|fill|press|hover|select|scroll` 하나이고 대상은 snapshot의 ref(`e12`). wait는 `--text`나 `--url` 하나와 `timeout_ms`(기본 10초, 최대 25초). `lophn tab open --preview <app> --device <name>`은 emulation 기기를 고른다(없는 이름은 `not_found`). `tabs/open --url`은 page가 붙은 뒤에 답하고 실패는 `unavailable`이다. `tabs/open`의 `relation`(`--as peer|stage|aside|work|glance`)은 연 탭이 연 session에게 무엇인지이고 자리는 core가 고르지 않는다. 작업용 browser 탭(`work`)은 접힌 float이라, 사람 손이 필요하면(로그인, captcha) agent가 `lophn tab show <tab>`(`tabs/show`, 연 쪽만)으로 펴고 `ask`로 알린다.

**오류 code(agent 호출).** 남의 탭·없는 탭은 `not_found`(page가 없어져 core 표에서 빠진 host browser 탭, shell이 없을 때의 host browser 탭도 같다), 낡은 ref·DevTools 열림·사람이 가져간 탭의 쓰기는 `conflict`, shell 없음(preview·artifact 탭)·탭이 창에 없음(preview·artifact 탭)·기한·wait 시간 끝은 `unavailable`, 틀린 url·preview·artifact 탭의 navigate는 `invalid_input`이다.

**기기 emulation.** 사람이 Settings > Browser에 기기를 등록하고 preview 탭 안내 줄의 기기 고르기(Desktop과 등록한 기기)나 `--device`로 고르면 main이 그 guest에 크기·DPR(`mobile`), touch, OS별 고정 user agent를 걸고 page를 다시 load한다.

**shell 설정 UI.** Settings > Browser pane: Links(두 설정), 기기 등록, 데이터 지우기.

## 결정

- **보통 탭을 `<webview>`로 두고 크기 준 popup과 DevTools만 native `WebContentsView`로 둔다(사람, 2026-10-19).** 처음에는 앱 화면과 같이 native view였다. native view는 shell HTML 위에 그려져 toolbar menu, 별 popover, floated 패널이 page 밑에 깔렸고 피하려고 page를 숨기거나 줄였다. `<webview>`는 DOM 안에 그려져 그 위에 DOM이 겹친다. ChatGPT desktop도 `<webview>` 탭이지만 popup을 `<webview>`에 adopt하는 것은 고친 Electron으로 한다. 표준 Electron에는 그 길이 없어 크기 준 popup만 native로 남겼다.
- **dock한 popup은 같은 주소의 `<webview>` 탭으로 다시 연다(사람).**
- **앱 화면과 artifact 화면도 이 그릇을 쓴다(사람, 2026-10-31).** 같은 겹침 문제가 있어 한 그릇으로 모았다. 그래서 native view의 층 순서는 browser의 popup·DevTools만의 것이다. iframe은 preload의 isolated world, 앱별 partition, `sender.id` 신원을 잃고 remote UI는 앱이 자기 DOM·CSS component를 못 쓰게 해서 버렸다(사람). Electron이 `<webview>`를 권하지 않지만 browser 탭이 이미 그 위험을 지고 있어 새 위험이 아니다.
- **DevTools는 Chrome처럼 탭 안에 붙이고 floating·분리를 고른다(사람).** `<webview>`는 DevTools를 담지 못해 native view에 붙이고, 자리를 바꿀 때 다시 열지 않고 view를 옮긴다(실험).
- **favicon을 보인다(사람).** 처음 roadmap의 "favicon 하지 않는다"를 뒤집었다. main이 page session으로 받아 data URL로 싣는다(agent).
- **머리 줄의 bookmark menu와 card 밖 줄의 ⋮ menu는 overlay view로 띄운다(사람).** card의 ⋯ menu는 DOM이라 열려 있는 동안 탭이 native view(DevTools 자리, popup)를 숨긴다. native popup 탭과 DevTools 위에서도 보여야 해서 한 길로 둔다. menu·popover의 overlay view는 창 본문 전체를 덮고 부르는 쪽은 trigger 사각형을 보낸다. 별 popover는 `<webview>` 탭에서는 DOM popover(이름 칸과 [Remove])이고 native popup 탭에서는 overlay(이름과 [Remove])다. 바로 지우는 [Remove]는 secondary(휴지통 아이콘)다. 줄마다 채운 빨강이 서면 과해서다(agent).
- **규칙을 rea `desktop-embeded-browser`에서 TS로 옮겨 짰고 library를 dependency로 넣지 않았다(agent).** CommonJS 그대로는 Result·Clock 같은 lophn 규칙과 맞지 않는다. 같은 때 tab cap, site list, capability 승인, storage mode는 두지 않기로 했다.
- **localhost와 사설 IP를 막지 않는다(agent).** 가장 많이 쓸 곳이 사람의 dev server다. core API는 token으로 막혀 있다.
- **Chrome인 척하지 않고 자기 이름을 단 Chromium 브라우저로 보인다(agent, 실험 2026-11-03).** 사람이 browser 탭에서 Google 로그인이 안 된다고 했다. 이전에는 UA에서 `Electron/x`와 앱 이름 token을 모두 빼고 `sec-ch-ua`에 Chrome brand를 지어 넣었다. 실험에서 accounts.google.com의 이메일 단계는 UA가 순수 Chrome(`... Chrome/x Safari/x`)이면 header·page JS brand를 맞춰도(CDP `Emulation.setUserAgentOverride`), Firefox UA로 바꿔도 "This browser or app may not be secure"로 막았고, `Electron/x`나 `lophn/x` token이 하나라도 남으면 통과했다. Edge·Brave처럼 자기 이름을 단 Chromium으로 보이게 한다. ChatGPT desktop도 UA에 `CodexBrowser` token을 붙인다. `Electron/x`는 계속 뺀다. Electron을 보고 막는 사이트가 있다. 버린 안: Chrome UA 위장, Firefox UA.
- **subresource 요청 guard는 두지 않는다.** 이 partition에는 `lophn-shell`·`lophn-app` protocol handler가 없어 그 요청은 어차피 실패한다.
- **tab 수 cap을 두지 않는다.** layout 파일의 tabs 상한이 이미 있다.
- **DevTools 경계 막대는 DOM drag다(agent).** native view는 pointer를 삼킨다. overlay drag 표면으로 한 시도는 press가 shell에서 시작해 움직임을 받지 못했다. 버린 안: overlay drag 표면.
- **page에 focus가 있을 때 Ctrl/Cmd+D는 main이 `bookmark-key` event로 보낸다(agent).** 작업대 단축키 표에 넣지 않는다. terminal의 Ctrl+D(EOF)와 부딪힌다.
- **다른 OS 창으로 옮기면 `<webview>` 탭은 다시 load한다(사람, `<webview>` 결정의 결과).** 다시 load 없이 옮기는 것은 native 항목뿐이다(agent). detached 창 안 popup은 features 크기를 따르지 않고 기본 창 크기이고, 그 창에서는 DevTools를 floated 패널로 둘 수 없다(agent).
- **bridge는 renderer ack가 있어야 `pane`이다(agent).** push만 하고 `pane`으로 답하면 그 terminal 탭을 가진 창이 없는 때(Settings route, 닫힌 창) URL이 조용히 사라진다. OAuth 로그인 URL을 잃으면 사람이 다시 할 길이 없다.
- **bridge의 범위는 shell 탭이다(agent).** coding 탭은 app space 패널에 붙어 browser 탭을 열 pane이 없다.
- **bridge key는 terminal 탭마다 main이 발급하고 key 표 조회로만 인증한다(agent).** socket이 0700 폴더 안 0600 file이고 key는 그 터미널 process만 안다.
- **per-run 폴더는 data root 아래가 아니라 core socket 폴더 규칙을 따른다(agent).** unix socket 경로 한도(104 byte) 때문이다. Windows file은 data root 아래, endpoint는 named pipe다.
- **link 설정은 renderer가 밀어 넣지 않고 main이 요청마다 읽는다(agent).** 낡은 값을 들 일이 없고 terminal link도 main을 거치므로 판정이 한 곳이다. web과 local을 나눈 것은 ChatGPT를 따랐다. 이미 로그인된 OS browser로 보낼 web link와 탭에 띄울 dev server가 갈린다.
- **bridge는 앱 시작 코드가 아니라 terminal IPC를 만드는 곳에서 만든다(agent).**
- **agent가 연 browser 탭도 사람의 browser 탭과 같은 partition을 쓴다(사람, 2026-11-09).** 사람이 로그인한 dev site와 서비스를 agent가 다시 로그인 없이 쓴다. 대가로 page 글이 agent를 속이면 사람의 로그인으로 그 site를 건드릴 수 있다. 막는 것은 다룰 탭을 주인으로 좁힌 것, untrusted 감싸기, take control이다. `evaluate`도 browser 탭에 준다(agent). 2026-11-10부터 사람이 없는 때(창이 없거나 앱을 끈 채 job이 돌 때)도 쓸 수 있다. job을 등록할 때의 승인이 그 job의 browser 사용을 포함한다고 본다(`PRODUCT.md`의 결정 피로를 줄인다). 그래서 따로 묻거나 설정이나 표시를 두지 않는다. 이 접근은 다음으로 좁힌다: 탭은 연 session만 다루고, 연 창이 사는 동안과 창마다 12개까지만 page가 있고, 앱을 띄우는 것은 browser 탭 열기뿐이며, 창이 화면에 뜬다. 남는 대가는 browser로 바깥 site에 한 일을 rewind로 되돌릴 수 없다는 것이다(사람, 2026-11-10).
- **agent의 browser 조작은 CLI + skill이고 extension tool로 만들지 않는다(사람).** lophn agent, harness agent, 터미널의 coding agent가 같은 구현을 쓴다. host queue는 long-poll이고 browser 호출은 `tool_call`의 결과 길을 같이 쓴다. 새 통로는 없다(사람). long-poll 기다림은 5초(TUI hold 갱신 10초보다 짧게), browser 호출 기한은 30초, wait는 기본 10초·최대 25초다(agent).
- **앱은 preview만 다룬다(agent).** live 화면은 sender view 신원으로 operation 막기를 건너므로 다루지 않는다.
- **기기 emulation은 preview 탭에만 있고 기기 목록은 사람이 등록한 것뿐이다(사람, 2026-11-08).** 일반 기기 표는 두지 않는다. emulation은 shell 본체의 preview 탭에 둔다.
- **Keep alive: 기본은 놓고 신호를 켠 page만 살린다(사람이 추천을 받음, 2026-11-07).** 모두 살리면 자원을 쓰고 program은 page 안의 뜻을 모른다. browser 탭은 builder가 없어 program이 알 수 있는 신호(소리, download)와 사람의 탭별 toggle로 정한다. 상한은 창마다 6개이고 오래 안 본 것부터 놓는다(사람이 추천을 받음). 살려 둘지는 떠날 때 한 번 정한다(agent).
- **agent가 연 browser 탭의 page는 그 탭을 든 창이 사는 동안 산다(사람, 2026-11-10: `<webview>` 유지).** 사람이 보는 workspace에 묶이면 job과 workflow가 사람 없이 browser를 못 쓴다. native view를 숨은 창에 두는 안은 shell DOM 위에 그려져 menu·패널이 page 밑에 깔리고 browser 탭의 그릇이 둘이 되어 버렸다. 대신 창이 하나도 없을 때는 lophn이 창을 연다. 마지막 url 다시 load와 idle 기한은 두지 않는다. 사라진 page는 사라진 탭이고 agent가 다시 연다(agent). 열리는 창은 자동으로 닫지 않는다(agent).

## 열린 것

- **preview 탭에 기기를 건 뒤 DevTools를 열면 emulation이 말없이 풀린다.** debugger가 떨어져 크기·DPR·touch·user agent가 풀리는데 그 사실이 renderer로 가는 길이 없어, 탭은 phone frame과 기기 이름을 그대로 보인다. 반응형 확인을 잘못 믿는다. 이슈 `emulation-lost-on-devtools-open`(추천: main → renderer push 하나를 더해 Desktop으로 돌린다).
- **크기 없이 `window.open`을 쓰는 로그인은 깨질 수 있다.** opener가 끊기는 대가다.
- **coding 탭의 `BROWSER`.** coding 탭은 app space 패널에 붙어 browser 탭을 열 pane이 없어 지금은 OS browser로 간다(roadmap `browser-tab.md`의 "남은 bridge 일").
- **다시 열어 복원한 detached terminal과 host가 죽은 뒤 사람이 다시 시작한 shell은 bridge가 없다.** OS browser로 간다(`workspace-layout.md` 이슈의 terminal 재연결과 함께 풀린다).
- **detached 창에서 DevTools를 floated 패널로 둘 수 없다.**
- **실제로 보이는 창에서의 agent 입력·1px·기기 frame은 사람이 아직 보지 않았다(headless Electron으로만 확인).** Windows bridge의 실기 확인도 별도다.
- **agent page는 보이는 창에서만 그린다.** `<webview>` guest는 화면에 보이는 창(숨기거나 최소화하지 않은)에서만 그린다. 숨기거나 최소화한 창은 그리지 않아 screenshot이 끝나지 않는다(x11에서 쟀다). 다른 창에 덮인 것은 그린다. 창 안에서는 화면에 있거나 1px 띠가 가려지지 않은 것만 믿을 수 있고 완전히 덮거나 viewport 밖에 두면 그리지 않는다. 숨은 page의 1px 띠는 창 오른쪽 아래에 점으로 보일 수 있다(이슈 `agent-browser-page-dot-visible`). macOS와 Windows는 돌려 보지 않았다. Wayland에서는 focus 없이 연 창이 focus를 가져갈 수 있다. 화면이 없는 Linux는 browser를 쓸 수 없다.
- **`tabs/open --url`은 page의 dom-ready까지 기다린다.** 첫 응답이 기한(10초, 앱을 띄웠으면 30초)보다 늦는 site는 실패한다.
- **emulation은 진짜 폰이 아니다.** iOS는 WebKit이다. 실제 폰은 roadmap `mobile.md`.
