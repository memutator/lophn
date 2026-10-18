# browser-bridge: terminal이 연 URL을 browser 탭에 띄운다

- 목표: shell 탭의 env에 `BROWSER` shim을 넣고, shim이 Electron main의 unix socket bridge로 URL을 보내 browser 탭에 연다. terminal의 http/https link를 Ctrl/Cmd-click으로 연다. web과 local link를 열 곳을 Settings에서 고른다.
- 재료:
  - `project-docs/products/roadmap/browser-tab.md`: "지금 코드"의 terminal, "무엇을 만드나" 2·4(link 설정), "정한 것". 요구의 정본이다.
  - `../rea/project/desktop-embeded-browser`의 `src/main/bridge.js`, `src/shim/browser-shim.js`, `src/main/policy.js`(`isRelayableUrl`, `parseBridgeRequest`, `PRIVATE_HOST_PATTERNS`), `analysis/embedded-browser-reverse-engineering.md` 2.7절. 코드를 복사하지 않고 계약만 따른다.
  - `project-docs/architecture/browser-tab.md`(`<webview>` 탭, browser kind, 탭 열기, Settings Browser pane), `project-docs/architecture/coding-agent.md`(terminal 탭), `project-docs/architecture/workspace-layout.md`(pane, floats, focus pane).
- 범위 밖:
  - Windows bridge, shell chrome과 app view의 `open-external` 돌리기(roadmap "하지 않는 것").
  - coding 탭의 `BROWSER`. coding 탭은 app space 패널에 있어 browser 탭을 열 pane이 없다(아래 "roadmap과 코드가 다른 곳" 1).
  - detached 창 안의 terminal. 계획 `workspace-detach`가 land한 뒤 따로 잇는다(아래 "workspace-detach와의 접점").
  - host가 죽은 뒤 사람이 다시 시작한 shell(supervisor의 `reopenMessage`)의 bridge. 그 shell은 지금처럼 OS browser를 쓴다.
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `bb-`로 시작한다.
- 단위: `tasks/*.md`의 "단위"가 정한다. 단위마다 task 하나다.

| id | wave | 선행 | 소유 | 하는 일 |
|---|---|---|---|---|
| `bb-policy` | 1 | 없음 | `main/browser-bridge/policy.ts`·`policy_test.ts`, core `config/shell-settings.ts` | 요청 줄 parse, relayable URL, local/web 판정, 설정 값 읽기, `BROWSER` env 규칙(순수 함수와 test 셋). link 설정 두 key 선언 |
| `bb-contract` | 1 | 없음 | `ipc/terminal.ts`, `preload/terminal-api.ts`, `terminal-host/main.ts`, `main/browser-bridge/types.ts`, wireframes의 `fake-terminal.ts`·`coding-terminal.ts` | `openLink`·`onBridgeOpen`·`ackBridgeOpen` 계약, host `open`의 `env`(restart에도 유지), `TerminalBridge` interface |
| `bb-shim` | 2 | bb-policy | `main/browser-bridge/run-dir.ts`·`shim.ts` | per-run 폴더(0700)와 shim 두 file(sh + Electron-as-node JS) |
| `bb-server` | 2 | bb-policy, bb-contract, bb-shim | `main/browser-bridge/{bridge,bridge_test,socket}.ts`, `wiring/bridge.ts`, `wiring/coding.ts`, `main/terminal/{ipc,controller}.ts` | socket 서버, key 표, ack, 설정 읽기, shell 탭 열 때 key 발급·bind·revoke, `openLink` 처리 |
| `bb-renderer` | 2 | bb-contract | `renderer/terminal/{use-bridge-open-requests,xterm-view,terminal-tab}`, `workspace.tsx`(두 곳), `renderer/deno.json`, `deno.lock` | push를 받아 browser 탭 열기와 ack, Ctrl/Cmd-click link |
| `bb-settings` | 2 | bb-policy | `desktop/settings/browser/*`, wording `catalog/browser.*` | Browser pane의 Links 구역(Select 둘) |
| `bb-gallery` | 3 | bb-renderer, bb-settings | wireframes `browser/pages.tsx`, `project-workspace.tsx`, `settings*.tsx` | bridge가 연 탭 page 둘, Links 구역 page 둘 |

- 순서: 판정 함수와 설정 선언, 경계 계약(wave 1) → shim 폴더, socket 서버와 terminal IPC 연결, renderer 탭 열기와 link, Settings Links(wave 2, `bb-server`는 `bb-shim` 뒤) → gallery(wave 3) → 문서(lead).
- 시작 조건: 계획 `browser-tab`이 main에 land했다(`5361104e8`, 지금 main). `browser-tab` 계획 폴더가 남아 있으면 planner가 `wrap-plan`으로 먼저 닫는다. 이 계획의 brief는 그 main의 코드를 열어 확인한 것이다.

## 흐름

```
 shell 탭 열기 (renderer → terminal:open IPC)
   main terminal/ipc.ts ── bridge.issue() ─▶ { key(64 hex), env: { BROWSER: <shim>, LPN_BROWSER_BRIDGE: {"socket","key"} } }
        │  host.request({type:"open", env})   host는 stripPlatformEnv 뒤에 env를 덮는다(restart에도 같은 env)
        └─ 답이 ok ─▶ bridge.bind(key, terminal_ref)

 child 프로세스가 $BROWSER <url> 을 부른다
   shim(sh) ─ELECTRON_RUN_AS_NODE=1─▶ Electron(JS) ── {v:1,key,url}\n ──▶ unix socket (0700 폴더, 0600 socket)
   main bridge.handleLine: parse → key 확인 → 설정(web/local)로 linkTarget → browser_tab이면
        모든 shell 창에 TERMINAL_BRIDGE_OPEN push ─▶ 그 terminal을 가진 창의 Workspace가 browser 탭을 열고 ack ──▶ 첫 ack로 "pane"
   ◀── {"result":"pane"} 이면 끝. "declined"이거나 실패하면 shim이 xdg-open/open으로 연다(bridge env를 지운 env로)

 terminal Ctrl/Cmd-click (xterm web-links addon) ─▶ terminal:link IPC ─▶ bridge.openLink: 같은 판정, 안 되면 main이 OS browser로 연다
```

## 정한 것

roadmap "정한 것"은 다시 적지 않는다. 아래는 이 계획에서 새로 정한 것이다.

- 범위는 shell 탭이다(agent). coding 탭은 `app space`의 오른쪽 패널에 있고(`renderer/app-frame/app-space.tsx`) 그 route에서는 Workspace(pane layout)가 없다. browser 탭을 열 곳이 없어서 env도 넣지 않는다. 아래 "roadmap과 코드가 다른 곳" 1.
- ack를 둔다(agent). main이 push만 하고 `pane`으로 답하면, 그 terminal의 Workspace가 마운트되지 않았을 때(settings·app space route, 닫힌 창) URL이 조용히 사라진다. renderer가 탭을 연 때만 `ackBridgeOpen`을 보내고, main은 `1500ms`(shim의 3000ms보다 짧다) 안에 ack가 없으면 `declined`로 답해 shim이 OS browser로 연다. 그래서 `pane`은 "실제로 열렸다"는 뜻이다.
- key는 main이 발급한다(agent). terminal 탭마다 하나다. `issue()`는 key와 env를 만들 뿐이고 표에는 넣지 않는다. `open`이 성공하면 `bind(key, terminal_ref)`, 탭을 닫아 `close`가 `exited`로 답하면 `revoke`한다. 탭이 스스로 끝난 shell의 key는 닫을 때(또는 앱을 끌 때)까지 남지만 그 terminal의 탭이 없으면 ack가 없어 아무것도 열지 못한다. 다시 시작(`restart`)은 같은 `terminal_ref`라 key가 이어진다. env는 host가 `Session`에 들고 있다.
- env는 `BROWSER=<sh shim 경로>`와 `LPN_BROWSER_BRIDGE=<JSON {"socket","key"}>` 둘이다(agent). `LOPHN_`로 시작하지 않아 `stripPlatformEnv`에 걸리지 않지만, host가 strip 뒤에 덮는다(roadmap). 사용자가 env에 `BROWSER`를 이미 두었으면 넣지 않는다. 단 `LPN_BROWSER_BRIDGE`가 같이 있으면 바깥 lophn의 shim이므로 덮는다(lophn 터미널 안에서 `deno task dev`로 lophn을 띄우는 개발 흐름). 규칙은 `bb-policy`의 `bridgeEnv`다.
- shim은 앱이 켜질 때마다 main이 per-run 폴더에 써 넣는다(agent). file은 둘이다: `browser`(sh, `ELECTRON_RUN_AS_NODE=1 exec '<process.execPath>' '<browser.js>' "$@"`)와 `browser.js`. 설치 묶음에 싣지 않으므로 `tools/package-linux.ts`와 electron-builder 설정은 바뀌지 않는다. packaged와 dev 모두 `process.execPath`가 shim이 부를 Electron이다(terminal host가 이미 같은 방식이라 `RunAsNode` fuse는 이미 켜져 있다).
- 폴더 자리는 core의 socket 폴더 규칙을 따른다(agent): `<XDG_RUNTIME_DIR>/lophn` 또는 `<tmpdir>/lophn-<uid>` 아래 `<data root 해시 12자>/shell-<pid>/`(`b.sock`, `browser`, `browser.js`). roadmap의 후보 "data root 아래 per-run 폴더"는 쓰지 않는다. unix socket 경로 한도(104 byte)를 data root 경로가 넘길 수 있고(`.dev-data/`가 깊은 곳에 있을 때), core가 이미 같은 이유로 정했다. 경로가 한도를 넘으면 bridge를 켜지 않고 로그 한 줄만 남긴다(shell 탭은 지금처럼 OS browser).
- 설정은 main이 요청마다 core에서 읽는다(agent). roadmap은 renderer가 값을 읽어 main에 IPC로 보낸다고 했지만, main에는 `ctx.coreInternal("memory","settings","list")`가 있다. 값을 밀어 넣는 IPC와 낡은 값이 없고, 못 읽으면 기본(`browser_tab`)이다. terminal link도 main을 거치므로(`openLink`) 판정이 한 곳이다.
- 여는 자리 계산은 renderer가 한다(agent). `bridgeAfter(view, terminalKey)`가 `TabHost.openTab`의 `after`로 쓸 key를 낸다: pane이 둘이면 반대쪽 pane의 마지막 탭, 하나면 terminal 탭 자신(바로 뒤), terminal이 floated이면 `after` 없음(focus pane). 모델(`openTabIn`)과 `kinds/browser.tsx`는 고치지 않는다.
- terminal link는 `@xterm/addon-web-links@0.12.0`(`@xterm/xterm@6.0.0`과 짝, 정확히 고정)으로 한다(agent). 줄이 접힌 긴 URL을 직접 짜기보다 낫다. 그냥 click은 무시하고 Ctrl/Cmd-click만 `openLink`로 보낸다. OSC 8은 지금처럼 삼킨다. bind되지 않은 terminal(coding 탭 등)의 link는 main이 바로 OS browser로 연다.
- key 비교는 `Map` 조회다(agent). roadmap은 rea가 `timingSafeEqual`을 쓴다고 적었지만 rea의 `bridge.js`는 `Map.get`이다. socket이 `0700` 폴더 안의 `0600` file이라 같은 사용자만 접속하므로(그 사용자는 key를 env로 이미 안다) 상수 시간 비교를 따로 만들지 않는다.
- `desktop/main.ts`를 고치지 않는다(agent). bridge는 `wiring/coding.ts`의 `register`가 `wiring/bridge.ts`의 `createBridgeWiring`을 불러 만든다. `main.ts`는 계획 `workspace-detach`(`wd-main`, `wd-restore`)가 소유한다. terminal IPC가 같은 file에서 만들어지는 곳이라 어색하지 않다.
- test(AGENTS.md "속도"): 권한 경계의 순수 판정만이다. `policy_test.ts` 셋(요청·URL, local/web과 설정 값, `BROWSER` env 규칙)과 `bridge_test.ts` 셋(key·설정·ack). 실제 unix socket을 열거나 shim·Electron을 띄우는 test는 이 계획에서 만들지 않는다. 필요하면 lead가 사람에게 먼저 묻는다.

## roadmap과 코드가 다른 곳

1. roadmap은 "shell 탭과 coding 탭의 env에 `BROWSER`"라 했다. 코드: coding 터미널은 core 요청으로 main이 만들고(`terminal-host/main.ts`의 `startCoding`, `project: ""`) 탭은 app space 패널에만 붙는다(`workspace.tsx`의 `useTerminalOpenRequests`는 `request.runtime.project`가 project id와 같을 때만 열지만 coding runtime의 project는 늘 `""`다). app space route에는 Workspace가 없어 browser 탭을 열 곳이 없다. 따라서 shell 탭만 한다. 추천안: 나중에 필요하면 app space에서 project 창의 Workspace로 가는 길(누구의 project인가, route 전환을 허락하는가)을 따로 정한 뒤 `terminal-host/launch-plan.ts`가 `plan.env`를 덮은 다음에 같은 env를 더한다(`types.ts`의 `issue()`를 그대로 쓴다).
2. roadmap은 rea가 key를 `timingSafeEqual`로 비교한다고 했다. rea `bridge.js`는 `Map.get`이다. 위 "정한 것"처럼 `Map`으로 한다.
3. roadmap은 "per-run 폴더(data root 아래)"로 읽힌다. 위 "정한 것"처럼 core의 socket 폴더 규칙을 따른다.
4. roadmap은 "renderer가 값을 읽어 main에 IPC로 보낸다"고 했다. 위 "정한 것"처럼 main이 읽는다.
5. roadmap은 "탭을 닫으면 key를 버린다"고 했다. `close`가 `exited`로 답할 때만 버린다. 스스로 끝난 shell의 key는 남는다(위 "정한 것").
6. roadmap은 "terminal이 floated이거나 detached이면 project 창의 focus pane"이라 했다. floated는 한다. detached 창 안의 terminal은 `workspace-detach`가 끝나기 전에는 Workspace가 없다(아래).

## workspace-detach와의 접점

계획 `workspace-detach`(`project-docs/plan/workspace-detach/tasks/`)가 같이 돌 수 있다. 겹치는 곳:

- `renderer/workspace/workspace.tsx`: `bb-renderer`가 두 곳(import 한 줄, `useTerminalOpenRequests` 블록 바로 뒤의 hook 호출 한 블록)만 더한다. `wd-layout`, `wd-contract`, `wd-project-side`, `wd-restore`도 이 file을 고친다. `status.py ready`가 `wd-*` task가 도는 동안 `bb-renderer`를 내지 않는다. 같이 돌았다면 rebase 충돌은 두 쪽을 다 남긴다.
- `tools/wireframes/pages/screens/project-workspace.tsx`: `bb-gallery`와 `wd-gallery`가 page 목록 끝에 항목을 더한다. 두 쪽을 다 남긴다.
- 겹치지 않게 비켜 간 곳: `kinds/browser.tsx`(`wd-browser`가 고친다. `openBrowserTab`을 고치지 않고 탭을 직접 만든다), `kinds/terminal.tsx`·`terminal/store.ts`(`wd-transfer-kinds`. link는 `terminal-tab.tsx`가, key↔ref 대응은 `allTabs`와 `store.get`으로 푼다), `desktop/main.ts`·`desktop/wiring/context.ts`(`wd-main`. `wiring/coding.ts`가 bridge를 만든다), `desktop/entry.tsx`(`wd-window-ui`. `windowBrowserSettings`가 기본 인자로 core 통로를 얻는다).
- detached 창의 terminal: `useBridgeOpenRequests`를 부르는 곳이 Workspace뿐이라 detached 창 안 terminal에서는 push에 아무도 ack하지 않고 `declined`(OS browser)가 된다. 그 창의 `detached-space`가 같은 hook을 `TabHost`로 부르게 하면 잇는다(`host.openTab`은 project 창에 docked로 연다). `workspace-detach`가 land한 뒤 한 줄짜리 후속이다.

## lead가 할 일

- wave 2를 띄우기 전에:
  - `bb-contract`가 merge된 뒤 `ipc/terminal.ts`의 channel 이름 셋(`shell:terminal-link`, `shell:terminal-bridge-ack`, `shell:terminal-bridge-open`)과 `main/browser-bridge/types.ts`의 `TerminalBridge`가 brief와 같은지 본다.
  - `bb-policy`가 merge된 뒤 `policy.ts`의 export 이름(`BRIDGE_ENV`, `parseBridgeRequest`, `isRelayableUrl`, `isLocalHost`, `linkTarget`, `linkPrefsOf`, `bridgeEnv`, `LINK_SETTING_KEYS`, `DEFAULT_LINK_PREFS`)이 brief와 같은지 본다. 다르면 wave 2 brief를 고쳐서 띄운다.
- merge 때마다:
  - wording 생성(`deno task wording`): `bb-settings`가 `catalog/browser.ts`에 key를 더한다.
  - core `shell-settings.ts`에 key가 더해졌으므로(`bb-policy`) Settings의 General에는 `shell.` prefix라 보이지 않는다. 확인만 한다.
  - `deno.lock`: `bb-renderer`가 `@xterm/addon-web-links`를 더한다. 충돌이 나면 `deno task check`로 다시 만든다.
  - gallery `pages/index.ts`, keybindings 표는 바뀌지 않는다.
- wave 2가 끝나면 손으로 확인한다(`deno task dev`, fake model server, 사람의 `~/.lophn`을 건드리지 않고 `.dev-data/`만 쓴다). child process나 socket을 띄우는 test를 새로 만들 일이 생기면 사람에게 먼저 묻는다.
  1. project 창에서 shell 탭을 열고 `echo $BROWSER $LPN_BROWSER_BRIDGE`가 shim 경로와 JSON을 보인다. `ls -ld`와 `ls -l`로 폴더가 `0700`, `b.sock`이 `0600`.
  2. pane 둘: terminal을 왼쪽에 두고 `python3 -m webbrowser https://example.com`을 하면 오른쪽 pane에 browser 탭이 열려 선택된다(`xdg-open`은 GNOME·KDE에서 `$BROWSER`를 안 볼 수 있어 이 확인에는 쓰지 않는다). pane 하나: terminal 탭 바로 뒤에 열린다. terminal을 floated로 만들면 focus pane에 열린다.
  3. `gh auth login --web`(또는 `gh auth login`에서 web을 고름)이 OS browser가 아니라 browser 탭에 GitHub 화면을 열고 로그인이 끝난다.
  4. `npx vite`가 낸 `http://localhost:5173`을 Ctrl-click하면 browser 탭에 page가 뜬다. 그냥 click은 아무 일도 없다(text 선택만).
  5. Settings › Browser › Links에서 web을 System browser로 두면: `gh auth login --web`이 OS browser로 가고, `vite`의 localhost link는 그대로 browser 탭에 뜬다. 되돌리면 둘 다 탭이다.
  6. `BROWSER=firefox deno task dev`처럼 사용자가 `BROWSER`를 둔 채 띄운 앱의 shell 탭은 shim을 받지 않는다(`echo $BROWSER`가 `firefox`).
  7. bridge가 꺼진 상태(`XDG_RUNTIME_DIR`를 아주 긴 경로로 두어 한도를 넘김)에서는 shell 탭이 `$BROWSER` 없이 열리고 앱은 정상이다.
  8. Settings나 app space route에서(Workspace가 없는 때) project의 shell 탭 안에서 시작한 `$BROWSER <url>`이 약 1.5초 뒤 OS browser로 간다. 앱을 끄면 `shell-<pid>` 폴더가 사라진다.
  9. userinfo가 든 URL, `file:` 경로, `mailto:`를 `$BROWSER`로 부르면 OS opener로 간다(탭이 열리지 않는다).
- 끝나면:
  - `project-docs/architecture/browser-tab.md`에 bridge 흐름(위 "흐름"), link 설정, 지키는 것(ack, key는 terminal 탭마다·env 이름·shim 두 file·폴더 자리, `declined`면 shim이 OS opener로 연다, 설정은 main이 요청마다 읽는다)과 "왜 이 모양인가"(ack, `desktop/main.ts`를 건드리지 않은 이유, coding 탭 제외)를 더한다. `project-docs/architecture/coding-agent.md`에는 "coding 탭은 `BROWSER`를 받지 않는다(app space 패널에는 browser 탭을 열 pane이 없다)" 한 줄만 더한다.
  - `project-docs/products/change-log/`의 열린 판에 항목을 덧붙인다.
  - `project-docs/products/roadmap/browser-tab.md`: 이 계획 몫을 지우고, coding 탭 bridge(위 "roadmap과 코드가 다른 곳" 1)와 detached 창 안 terminal을 남은 일로 짧게 적는다. 3(로컬 HTML 미리 보기)도 남아 있으므로 파일은 지우지 않는다.
  - worker 보고의 "무겁게 짠 것"과 "알려진 미완 동작"은 `issue` skill대로 이슈로 올린다.
- 사람에게 묻는 것: socket을 열거나 shim·Electron·child process를 띄우는 test를 새로 만들 때. coding 탭 bridge를 이 계획에 넣을지(추천: 넣지 않는다). `gh auth login --web`은 lead가 손으로 확인한다.
