# app-check

끝났다고 말하기 전에 실제 앱으로 확인하는 script를 둔다(README 정한 것 19). E2E 꼴이고 사람이 허락했다. script가 하는 일:

- 개발 앱(Electron, data root는 `.dev-data`)을 띄운다.
- project place의 터미널 탭에서 `claude gui`·`codex gui`·`opencode gui`·`omp gui`를 친다.
- CLI마다 기능 목록을 하나씩 해 보고 화면을 찍는다.

기능 목록도 이 task가 만든다. 정한 것 14-17에서 사람이 찾은 것과 고친 것이 다 들어간다:

- 명령 세 갈래와 그 출력
- `/` palette 순위
- vendor 아이콘
- subagent, todo, background task와 멈추기
- 켜고 끄기, goal, role
- 사용 한도
- thread index와 bookmark
- GUI↔TUI toggle

실제 CLI는 싼 model로 부른다:

- Claude: haiku
- OpenCode: `openrouter/deepseek/deepseek-v4.1-flash-1017`
- Codex·omp: 그 CLI의 가장 싼 model

worker는 실제 CLI와 model provider를 부르지 않는다. 돌리는 것은 lead다. wave 5-7이 다 merge된 뒤에 시작한다.

- 단위: check (wave 8)
- 선행: thread-index. 앞 wave는 모두 먼저 merge된다.
- 소유(이 task만 고친다):
  - `tools/app-check/`(새로: app driver, 실행 script, CLI별 기능 목록)
- 맞출 곳(그 줄만): `tools/dev.ts`(아래 할 일 1의 줄만), `packages/shell/renderer/` 안에서 catalog 글·기존 `data-*`·role·aria-label로 찾을 수 없는 요소의 `data-check="<이름>"` 속성 한 줄씩(wave 8은 이 task 하나라 겹치지 않는다)
- 읽을 것:
  - README 정한 것 14-19
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/`:
    - `audit-{claude,codex,opencode,omp}.md`의 §1·§2(기능표와 명령 분류). 기능 목록의 원천이다
    - `ui-reference.md` §0·§1·§3
  - 앱 띄우기: `tools/dev.ts`(`.dev-data` data root, fake provider, `LOPHN_LIVE_PROVIDER`), 기존 E2E 지원 `tests/support/app/`
  - architecture: `project-docs/architecture/harness-gui.md`, `terminal-agent.md`(탭의 `gui` 함수와 hook socket)
- 계약:
  - 쓰는 것:
    - wave 5-7이 merge된 앱
    - 사람 PATH의 `claude`·`codex`·`opencode`·`omp`
  - 내놓는 것:
    - lead가 돌리는 명령 하나. harness를 골라 돌릴 수 있다. `package.json` script 줄은 lead가 넣는다
    - 화면 사진은 `.dev-data/app-check/<시각>/`에 남는다. 저장소에도 `~/.lophn`에도 쓰지 않는다
    - 기능 목록 줄마다 통과·실패·사진 경로를 담은 보고
    - driver는 Electron `--remote-debugging-port`와 CDP다. 새 의존성은 없다

## 할 일

지금 저장소에는 화면을 모는 driver가 없다. `npm run e2e`는 Electron을 `ELECTRON_RUN_AS_NODE=1`로 node처럼 돌려 core만 보고, Playwright는 의존성에 없다. 그래서 새 의존성 없이 Chromium DevTools Protocol(CDP)로 몬다: Electron 44.5.1은 `--remote-debugging-port`를 받고, Node 24의 전역 `WebSocket`·`fetch`로 붙는다(정한 것: 의존성을 더하지 않는 가장 단순한 길. AGENTS.md "속도"). 앱 띄우기는 `tools/dev.ts`를 그대로 쓴다(renderer·shell build, fake provider, dev `lophn` launcher를 다시 짜지 않는다).

1. `tools/dev.ts`(맞출 곳, 그 줄만):
   - `runDev`를 export한다.
   - `DevOptions`에 `dataRoot?: string`(절대 경로)을 더한다. 주면 `.dev-data` 대신 그 root를 쓰고, `LOPHN_DEV_HOME`과 달리 fake provider를 그대로 심는다. `devHomeOf`의 `~/.lophn` 거절을 이 값에도 건다.
   - `--remote-debugging-port`는 dev.ts에 넣지 않는다. app-check가 `DevOptions.spawn`을 끼워 purpose가 `"shell"`인 plan의 args 앞에 붙인다(`dev_test.ts`가 쓰는 같은 끼움 자리다). 그 spawn은 `defaultSpawn`과 같게 띄우고, 띄운 shell child를 쥐어 끝낼 때 쓴다.
2. `tools/app-check/`를 만든다. file은 넷이다:
   - `main.ts`: 인자, 순서, 보고, exit code.
   - `cdp.ts`: driver.
   - `app.ts`: 준비, 띄우기, 탭 열기, 끄기.
   - `checklist.ts`: 기능 목록과 각 줄의 step.
   인자는 셋이다:
   - `--harness lophn,claude,codex,opencode,omp`: 기본은 다섯 다.
   - `--model <harness>=<model id>`: 여러 번 줄 수 있다. 기본은 `claude=haiku`, `opencode=openrouter/deepseek/deepseek-v4.1-flash-1017`이다. codex·omp는 기본이 없다. 주지 않으면 그 harness의 model을 부르는 줄은 모두 `skip`이고, 이유는 "싼 model을 안 줬다"다. 어느 것이 가장 싼지는 lead가 그 CLI의 model 목록을 보고 정한다.
   - `--only <줄 id,...>`.
   실행은 저장소 root에서 `node tools/app-check/main.ts …`다.
3. 준비(`app.ts`). 시각 폴더 `<root>/.dev-data/app-check/<YYYYMMDD-HHMMSS>/`를 만든다:
   - data root `home/`(0700). 시작 전에 `home/settings.json`에 key 둘을 쓴다:
     - `"extensions.harness-gui.enabled": true`. `packages/core/config/shell-settings.ts`가 정적으로 선언한 key라 file이 거절되지 않는다. 사람이 Settings에서 켜던 것을 대신한다.
     - `"lophn-agent.model.catalog_auto_update": false`
   - 사진 폴더 `shots/<harness>/`
   - 보고 `report.md`·`report.json`

   scratch project는 `os.tmpdir()/lophn-app-check-<시각>/project`에 둔다:
   - `git init`하고 `a.txt`(세 줄)를 둔다.
   - 저장소 안에 두지 않는다. CLI가 lophn의 `AGENTS.md`·`CLAUDE.md`를 읽어 비싸지고 lophn 규칙을 따르게 된다.

   project 등록:
   - `tests/support/core`의 `bootCore`로 그 data root에 core를 한 번 띄운다. 본보기는 `tools/dev.ts`의 `plantFakeProvider`다.
   - `openProject(core, folder, "app-check")`로 project id를 받는다.
   - core를 닫는다.

   fake port는 빈 port를 하나 골라 `LOPHN_DEV_FAKE_PORT`로 준다. 사람의 `npm run dev`가 7499를 쓰고 있어도 겹치지 않게 하려는 것이다.

   마지막으로 사람 전역 설정 file의 hash를 적어 둔다:
   - `~/.claude/settings.json`
   - `~/.codex/config.toml`
   - `~/.config/opencode/opencode.json`, `~/.config/opencode/opencode.jsonc`
   - `~/.omp/agent/config.yml`
   - `~/.lophn/settings.json`

   있는 것만 적는다. 끝날 때 다시 재서 하나라도 바뀌었으면 줄 `guard`를 `fail`로 적는다. CLI가 자기 session file(`~/.claude/projects/…`, `~/.omp/agent/sessions/…`)을 쓰는 것은 그 CLI의 평소 상태라 보지 않는다.
4. 띄우기(`app.ts`):
   - `runDev("dev", …)`를 부른다:
     - `root`: 저장소 root
     - `dataRoot`: 위 `home`
     - `signals: false`
     - `env`: `LOPHN_SHELL_START=project:<id>`(`desktop-window.ts`가 그 작업대부터 연다)와 `LOPHN_DEV_FAKE_PORT`
     - `spawn`: 위 1의 끼움
   - `ELECTRON_NO_SANDBOX`는 사람 env에 있으면 그대로 흘린다(dev.ts가 이미 본다).
   - `LOPHN_SHELL_HEADLESS`는 켜지 않는다. offscreen에서는 화면 사진과 xterm WebGL이 믿을 수 없다(`desktop/headless.ts` 주석). 창은 사람 화면에 뜬다.
   - `http://127.0.0.1:<port>/json/list`를 기다린다(60초). `type: "page"`이고 url이 `lophn-shell://desktop`로 시작하는 target 하나에 WebSocket으로 붙는다.
5. driver(`cdp.ts`)는 함수 몇 개만 둔다:
   - `evaluate(expr)`: `Runtime.evaluate`, `returnByValue`
   - `waitFor(predicate, ms)`: 200ms마다 evaluate
   - `click(selector | 글자)`: `getBoundingClientRect` 가운데에 `Input.dispatchMouseEvent`. Radix 꼴 popover는 `el.click()`으로 안 열려서 진짜 pointer event를 쓴다
   - `hover(…)`: `mouseMoved`
   - `type(text)`: `Input.insertText`
   - `key(name, modifiers)`: `Input.dispatchKeyEvent`의 `keyDown`·`keyUp`, `code`·`windowsVirtualKeyCode`
   - `shot(path)`: `Page.captureScreenshot` png

   잡는 법은 셋이다:
   - 화면 글자는 `packages/design/i18n/catalog/*.ts`의 key로 가져와 쓴다(영어 하나다. 문구가 바뀌어도 script가 따라간다).
   - 있는 `data-*`를 쓴다(예: `data-gui-toggle`).
   - role·`aria-label`을 쓴다.

   셋으로 못 잡는 element에는 `data-check="<이름>"` 속성 한 줄을 그 component에 더한다. 이것은 header의 맞출 곳에 lead가 더해야 하는 줄이다. 더한 곳은 보고의 "넘길 줄"에 적는다. CSS module class 이름(hash가 붙는다)으로는 잡지 않는다.
6. 터미널 탭에서 GUI 열기(`app.ts`의 `openGui(harness)`):
   - `Ctrl+Backquote`(`terminal.focus`, `packages/shell/ipc/keybindings.ts`)로 터미널 탭을 연다. 이미 있으면 그 탭이 앞으로 온다. harness마다 새 탭이 필요하면 place의 탭 `+`(`workspace/place-window.tsx`의 `openTerminalTab`)를 누른다.
   - `.xterm-helper-textarea`에 focus를 주고 2초 기다린다(shell 시작).
   - `type("<harness> gui")`, `key("Enter")`로 친다. `gui` 함수는 `terminal-host/shell-integration.ts`가 깔고 hook socket으로 탭에 닿는다.
   - GUI view의 `[data-gui-toggle="tui"]`(`terminal/terminal-gui.tsx`)가 보일 때까지 30초 기다린다. 안 보이면 사진을 찍고 그 harness의 줄을 다 `fail`로 적은 뒤 다음 harness로 간다.
   - 셀은 WebGL이 그려 DOM에 글자가 없다. 그래서 TUI 쪽은 사진만 찍고 `look`으로 둔다.
7. 싼 model 지킴. harness마다 첫 보내기 전에 GUI의 model 고르기를 열어 `--model` 값을 고른다. model 단추의 글이 그 값으로 바뀐 것을 확인한다. 못 고르면 그 harness에서 model을 부르는 줄을 모두 `skip`으로 적고 보내지 않는다. model을 부르는 줄에는 짧은 prompt만 쓴다(아래 표의 글 그대로). harness 하나에 prompt는 15개를 넘기지 않는다.
8. 지킬 것(어기면 script가 그 줄을 `fail`로 적고 멈춘다):
   - 승인 카드에서는 "한 번 허락"과 "거절"만 누른다. "늘", "이 session 동안", 비슷한 명령 늘 허락(Codex execpolicy·network amendment)은 누르지 않는다(README 정한 것 12). 찾는 단추가 없으면 다른 단추를 누르지 않고 `fail`이다.
   - hook을 깔거나 지우지 않는다(Settings의 connections `install-hooks`). CLI의 설정·권한 명령은 열어 보기만 하고 값을 바꾸지 않는다.
   - omp role은 바꾼 뒤 prompt를 보내지 않는다(그 role의 model이 비쌀 수 있다). model 글만 보고 원래 role로 돌린다(정한 것 18).
   - Codex·Claude TUI가 폴더 trust를 묻는 화면이 나오면 아무것도 고르지 않고 GUI로 돌아간다. 사진은 남긴다.
9. 기능 목록(`checklist.ts`). 줄마다 `{id, harnesses, 할 것, 볼 것, 판정: "auto" | "look", model 부름 여부}`. 한 harness의 줄은 한 대화에서 아래 순서로 돈다. `auto`는 DOM으로 판정해 `pass`/`fail`을 적고, `look`은 사진만 남겨 lead와 사람이 본다. 모든 줄이 끝에 사진 하나를 찍는다(`shots/<harness>/<nn>-<id>.png`).

   | id | 대상 | 할 것 | 볼 것 | 판정 |
   |---|---|---|---|---|
   | `open` | CLI 넷 | 위 6 | 탭이 GUI로 바뀐다. 새 창은 뜨지 않는다(창 target이 하나다) | auto |
   | `face` | 다섯 | 대화 머리와 답의 얼굴을 본다 | harness는 `parts/vendor-icon`의 아이콘(svg)이고 글자 avatar가 아니다. lophn은 lophn 얼굴이다 | auto + look |
   | `model` | 다섯 | 위 7. lophn은 첫 메시지 전 새 session 화면에서 연다 | 목록이 그 CLI의 model 묶음이고, 단추 글이 고른 model이다 | auto |
   | `mode` | 다섯 | mode 메뉴를 연다 | 그 CLI의 mode가 나온다. 바꾸지 않고 닫는다 | look |
   | `palette-exact` | 다섯 | composer에 `/model`을 친다 | 첫 줄이 이름 `model`이다. 설명에 "model"이 든 다른 명령이 위에 오지 않는다(정한 것 16) | auto |
   | `palette-prefix` | 다섯 | `/co`를 친다 | 묶음 머리가 없고, 이름이 `co`로 시작하는 것이 짧은 순으로 위에 온다. 줄마다 출처 배지가 있다 | auto |
   | `palette-groups` | 다섯 | `/`만 친다 | 묶음이 나뉘고, harness 내장 명령은 vendor 아이콘이다 | look |
   | `cmd-screen` | 다섯 | `/model`을 고른다(Enter) | model 고르기가 열린다. 사람 메시지가 thread에 생기지 않는다(prompt로 안 갔다) | auto |
   | `cmd-output` | 다섯 | model을 부르지 않는 CLI 명령 하나를 보낸다. Claude `/mcp`, Codex `/status`, OpenCode `/status`, omp `/context`, lophn `/status` | `command_output` 블록(markdown 또는 고정폭)이 그려지고 사람 메시지로 가지 않는다 | auto |
   | `cmd-hidden` | CLI 넷 | TUI 전용 이름을 친다. Claude `/doctor`, Codex `/theme`, OpenCode `/themes`, omp `/hotkeys` | palette에 없다. omp는 직접 쳐 보내도 model에 가지 않고 "TUI에서만" 알림이 뜬다 | auto |
   | `text` | 다섯 | "Reply with the single word: ok"를 보낸다 | 답이 온다(lophn은 fake의 `fake model: ok`) | auto |
   | `rename` | 다섯 | `/rename app-check` | 머리 제목이 `app-check`다 | auto |
   | `tool-body` | CLI 넷 | "Read a.txt and tell me its first line. Use your file read tool." | tool 줄이 생기고, 펼치면 입력과 출력 본문이 보인다(`not_found`가 아니다) | auto |
   | `approve` | CLI 넷 | "Create b.txt containing the word hi." 승인 카드가 오면 "한 번 허락" | 카드가 오고 허락 뒤 file이 생긴다. 사람 설정이 묻지 않는 harness(omp yolo, OpenCode 기본)는 카드가 없어도 `pass`로 두고 note에 "설정이 묻지 않음"을 적는다 | auto |
   | `todo` | CLI 넷 | "Use your todo tool to make a 3-step todo list for adding a line to a.txt, mark step 1 done, then stop." | composer 위 dock에 todo 셋과 상태가 보인다 | auto |
   | `subagent` | CLI 넷 | "Use one subagent to list the files in this folder, then report." | subagent 줄(이름, 상태, model)이 생긴다. 누르면 자식 대화가 보인다 | auto + look |
   | `task` | Claude, Codex, omp | Claude "Run `sleep 30` in the background with your shell tool and tell me it started.", Codex는 같은 글, omp `!sleep 30` | dock에 도는 task가 보인다. 멈추기를 누르면 `stopped`다 | auto |
   | `bang` | omp | `!echo app-check` | 고정폭 출력 블록이 보이고 model turn이 열리지 않는다 | auto |
   | `toggle` | Codex(plan), omp(fast/slow), OpenCode(auto-accept) | 켜고 끄기를 한 번 바꾸고 되돌린다 | 상태 글이 바뀌었다 돌아온다 | auto |
   | `goal` | goal capability가 있는 것(Codex 확실, 나머지는 merge된 adapter를 보고 정한다) | goal을 "app-check goal"로 두고 지운다 | goal 줄이 나왔다 사라진다 | auto |
   | `role` | omp | role 메뉴를 열어 다른 role을 고른다 | 목록이 omp 설정의 role이고 model 글이 바뀐다. prompt를 보내지 않고 원래 role로 돌린다 | auto |
   | `usage` | 다섯 | `/usage`와 `/context`(있는 것) | 사용 한도 줄(`limits`)과 context 분해(`context.parts`)가 card로 보인다. lophn은 fake라 값이 작다 | look |
   | `plan-card` | CLI 넷 | plan mode로 바꾼다(Claude mode, Codex plan toggle, OpenCode plan agent, omp plan mode). 그리고 "Plan how to add a line to a.txt. Do not change files yet."을 보낸다 | plan 승인 카드에 plan 글과 다음 mode 고르기가 나온다. 거절을 누르고 mode를 되돌린다 | auto |
   | `queue` | 다섯 | 답이 도는 동안 "Then say done."을 보낸다 | 대기열에 보이다가 다음 turn으로 돈다 | auto |
   | `undo-redo` | OpenCode | `/undo` 다음 `/redo` | 마지막 turn이 숨었다가 같은 자리로 돌아온다(`hidden_restored`) | auto |
   | `review` | Codex | `/review` | review 글이 블록으로 그려진다 | auto |
   | `compact` | 다섯 | `/compact` | compaction `info` 줄이 그려진다(지금 bug: 아무것도 안 보임) | auto |
   | `thread-index` | 다섯 | 사람 메시지가 4개 이상인 지금 rail을 본다. 한 눈금에 hover, 누름, `Alt+↑`·`Alt+↓` | 눈금 수가 사람 메시지 수다. hover card에 그 메시지 첫 줄과 답 미리보기 2줄이 있다. 누르면 그 turn으로 간다 | auto + look |
   | `bookmark` | 다섯 | hover card의 bookmark를 누른다 | `home/shell/thread-bookmarks.json`에 그 session key(lophn `ses_…`, harness `<harness>:<cli_session>`) 줄이 생긴다 | auto |
   | `rewind` | 다섯 | 두 번째 사람 메시지로 rewind(대화만) | 그 뒤 메시지가 thread에서 빠진다 | auto |
   | `fork` | 다섯 | 첫 사람 메시지에서 fork | fork된 대화가 열린다(lophn은 새 session, harness는 같은 탭) | auto + look |
   | `to-tui` | CLI 넷 | `[data-gui-toggle="tui"]`를 누른다 | Claude·omp는 modal(`terminal.title.switch`)이 뜨고 `terminal.button.switch`를 눌러야 바뀐다. Codex·OpenCode는 modal 없이 바로 xterm이 보인다 | auto(modal 유무) + look(TUI 화면) |
   | `to-gui` | CLI 넷 | `[data-gui-toggle="gui"]`를 누른다 | 같은 대화가 돌아온다(앞 사람 메시지 글이 thread에 있다). bookmark 표시가 남아 있다(`origin` key) | auto |
   | `tui-first` | CLI 넷 | 새 터미널 탭에서 `<harness>`만 쳐 TUI로 시작한 뒤(prompt는 보내지 않는다) GUI toggle을 누른다 | Codex·OpenCode는 한 번 껐다 켠다는 modal이 뜬다(정한 것 8). toggle 단추가 없으면 `skip`, note는 "사람 hook이 없다. app-check는 hook을 깔지 않는다" | auto |
   | `clear` | 다섯 | `/clear` | 같은 탭에 빈 새 session이 열린다(lophn은 `new`의 별칭) | auto |
   | `guard` | 전체 | 위 3의 hash를 다시 잰다 | 바뀐 file이 없다. `~/.lophn`은 읽지도 쓰지도 않았다 | auto |

   CLI마다 명령 이름(위 `cmd-*`)은 `audit-*.md` §2와 merge된 adapter의 명령 목록(`packages/shell/main/extensions/bundled/harness-gui/<harness>.ts`)을 보고 맞춘다. 안 맞으면 이 표가 아니라 adapter를 따른다. capability가 없는 줄(merge된 adapter가 그 capability를 false로 낸다)은 `skip`이고, note에 capability 이름을 적는다.
10. 보고(`main.ts`):
    - `report.md`는 harness마다 표 하나다(`id | 결과 pass/fail/skip/look | 사진 | note`). 맨 위에 다섯 가지를 적는다: 시각, CLI 판(`<cli> --version`), 고른 model, prompt 수, guard 결과. `report.json`은 같은 내용이다.
    - 끝에 `report.md` 경로를 찍는다. `fail`이 하나라도 있으면 exit 1이다.
    - 한 줄이 throw해도 다음 줄로 간다. 그 줄은 `fail`이고 note는 오류 첫 줄이다.
11. 끄기:
    - harness마다 끝나면 그 터미널 탭을 닫는다. adapter가 CLI를 process group째 끈다(정한 것 11).
    - 다 끝나면 쥔 shell child에 SIGTERM을 보낸다. `runDev`가 돌아오면 fake도 닫힌다.
    - `tests/support/core/process.ts`의 `processesOf(home)`·`waitGone`으로 core process가 남지 않는지 본다. 남았으면 note에 적는다.
    - Ctrl+C에도 같은 끄기를 한다.
12. worker가 돌리는 것은 `node tools/app-check/main.ts --harness lophn`뿐이다. 이것은 fake provider만 부른다. 사진과 보고가 나오고 `guard`가 `pass`인 것까지 본다. CLI 넷은 돌리지 않는다. 실제 CLI와 model을 부르는 run은 lead가 한다.

## 끝남

- `npm run check`가 통과한다.
- worker의 기계에서 `node tools/app-check/main.ts --harness lophn`가 끝까지 돌고 `.dev-data/app-check/<시각>/report.md`와 사진이 남는다. lophn 줄에 `fail`이 없거나, 남은 `fail`이 화면 결함이면 보고의 "알려진 미완 동작"에 줄 id와 사진 경로로 적는다.
- lead의 기계에서 다섯 harness가 끝까지 돈다(lead가 돌린다).
- 위험 test: 없음. 이 script가 사람이 허락한 E2E다. `_test.ts`를 새로 만들지 않는다.
- 남지 않음: 저장소 안에 새 file은 `tools/app-check/`와 dev.ts의 줄뿐이다. `.dev-data/`는 gitignore다. 사람 `~/.lophn`과 전역 harness 설정 file이 그대로다(`guard`).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 더 적을 것:

- lead가 넣는다: root `package.json`의 script `"app-check": "node tools/app-check/main.ts"`. 새 의존성은 없어야 한다. 넣었다면 이유와 정확한 판을 적는다.
- 더한 `data-check` 줄의 file과 이름
- lophn run의 `report.md` 경로
