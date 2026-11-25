# coding-agent

lophn과 사람이 쓰는 coding agent(Claude Code, Codex, OpenCode, omp, Antigravity 같은 harness)를 잇는 메커니즘이다. 세 가지다. (1) lophn이 내놓는 명령을 사람 터미널과 agent가 같은 표로 부르는 CLI. (2) 사람 터미널의 coding agent를 위한 제품 감지, 전역 hook 설치·제거, 공유 skill 사본. (3) 정의의 `runtime`이 harness인 lophn agent(harness agent)를 단일 상주 구조화 프로토콜 어댑터(`tab` 모드·`background` 모드)로 돌리고 model catalog를 discovery·cache하는 길과 그 session을 TUI 탭으로 여는 길. 사람이 연 터미널 탭의 coding agent 상태, 탭 icon·점, 알림은 [terminal-agent.md](terminal-agent.md)의 일이다. 사람 터미널에 coding agent를 띄워 일을 맡기던 층(coding session)과 구 일회성 headless 실행기(`claude -p`, `codex exec`, `opencode run`)는 지웠다.

## 문제

- 사람은 lophn 밖에서 자기 coding agent를 쓴다. lophn이 그것을 알아보고, 상태를 보이고, lophn의 앎(앱이 공유한 skill, 다른 agent를 부르는 법)을 줄 길이 없으면 둘이 따로 논다.
- 그 길이 사람 설정을 함부로 고치면 사람의 다른 hook, 주석, 다른 도구의 항목을 잃는다. 묻지 않고 놓거나, 지울 때 사람의 것까지 지우면 신뢰를 잃는다.
- lophn agent를 Claude Code나 Codex로 돌리고 싶다. workflow와 job처럼 사람 없이도 돌아야 하고, 그 agent가 다른 lophn agent를 부르고 답할 수도 있어야 한다. 그러려면 harness가 lophn을 부를 자격이 있어야 하는데, 그 자격이 새어 나가면 안 된다.
- 한 harness session에 background 상주 adapter process와 사람의 TUI process가 같이 쓰면 그 CLI의 대화 기록이 섞이거나 깨진다.

## 목표와 비목표

- 목표
  - lophn 명령 표 하나를 lophn agent(native tool `lophn`), 사람 터미널, harness agent가 같이 쓴다.
  - 사람이 시키지 않으면 사람 home에 쓰지 않고 제품을 띄우지 않는다. 쓸 때는 우리 항목만 바꾸고 나머지는 byte 그대로 둔다.
  - harness agent는 core의 session·turn·기록 모델에 그대로 들어가고, harness는 그 turn에만 쓰이는 자격으로 lophn을 부른다.
- 비목표
  - lophn이 coding agent에게 일을 맡기는 층(coding session, coding token, MCP endpoint)은 두지 않는다. 필요해지면 새로 설계한다.
  - harness의 tool 실행을 lophn Gate나 rewind에 넣지 않는다. harness의 일이다.
  - 화면이나 title을 읽어 상태를 짐작하지 않는다. hook만 쓴다.
  - 사용자 앱과 사람이 쓴 글을 공격자로 보지 않는다. CLI 출력을 data fence로 감싸지 않는다.
  - harness에게 전부 허락(`bypassPermissions`, `danger-full-access`)을 주지 않는다.
  - TUI에서 바뀐 CLI session id(`/clear` 등)를 따라가지 않는다.

## 모델

### CLI의 명령 두 갈래

- **core를 부르는 명령.** 표 하나(`COMMANDS`)에서 나온다. lophn agent의 tool `lophn`도 같은 표를 쓴다. `agent run`, `<app> <command>`, `run wait|show|cancel`([run.md](run.md)), `workflow …`([workflow.md](workflow.md)), 그 밖의 명령이다. 사람이 부르면 공용 ensure([platform.md](platform.md) "core 수명")로 core에 붙고, 없으면 띄운 뒤 control `connect {client: cli}`가 준 user token을 자격으로 쓴다.
- **`local` 명령.** core를 부르지 않는다. `hook`, `harness detect|refresh|install|status|uninstall`이다. 예외는 `harness sync-skills` 하나로, 이것만 user token으로 core를 읽는다.
- `lophn core stop`은 binary만 아는 명령이다(표에 없다). control `stop`만 보내고 core를 띄우지 않는다.

### 사람 터미널의 coding agent 연결

```
Settings › Coding agents ─ coding_agents/list|refresh ─▶ core가 exec ─▶ lophn harness detect|refresh ─▶ 제품마다 감지 결과
Settings › Coding agents ─ coding_agents/hook_status ─▶ core가 exec ─▶ lophn harness status ─▶ 제품마다 hook 상태(모두 dry_run, process 하나)
사람 터미널이나 coding_sessions/open에서 harness를 처음 알아봄 ─▶ lophn harness install --dry_run ─▶ 없으면(opt-out 아님) 자동 install ─▶ HookInstallFinished
[Install hooks] ─ coding_agents/install_hooks ────▶ lophn harness install (누른 것이 허락)
[Uninstall hooks] ─ coding_agents/uninstall_hooks ─▶ lophn harness uninstall (우리 항목만, lophn이 쓴 skill 사본도)
core (기동 뒤, 앱 activation, 설정 바뀜, hook 설치·삭제 뒤)
   ─ exec ─▶ lophn harness sync-skills ─ user token ─▶ core: settings.list, app.skills
   ─▶ hook이 놓인 harness의 skill 폴더에 공유 skill 사본 (표시 file .lophn-shared)
harness ─ 전역 hook ─▶ lophn hook <harness> <event> ─▶ core hook socket (terminal-agent.md)
```

- 지원하는 harness는 25종이다: claude, codex, opencode, pi, omp, cursor, copilot, kimi, kiro, antigravity, grok, droid, amp, devin, qwen, qoder, hermes, muse, codebuddy, command-code, prime-agent, mimocode, cline, letta, kilo. 제품마다 통합 규칙(hook을 놓는 자리와 꼴, event → 신호, hook stdout, session id·이름 경로, resume 인자, skill 폴더, headless 명령)은 adapter 표 한 항목에 있다.
- hook을 놓는 꼴은 다음과 같다. Claude식 json settings(claude, qwen, qoder, codebuddy, command-code, droid, letta), JSONC(devin), 우리 전용 file(grok, copilot, kiro), flat json(cursor), 이름 붙은 hook object(antigravity), 표시한 TOML block(kimi), managed hooks file과 settings 칸(muse), 표시한 YAML block과 허용 목록 사전 기록(hermes), event마다 script file(cline), plugin·extension file(opencode·kilo·mimocode 공통 본문, pi, omp, amp). prime-agent는 hook API가 없어 놓지 않는다.
- hook 상태는 event마다 우리 항목이 있는지로 세 가지다. `unchanged`, `missing`, `failed`(Muse에 다른 managed hooks 경로가 있으면 `conflict`).

### harness agent

harness runtime은 다섯이다: `claude-code`, `codex`, `opencode`, `omp`, `antigravity`. 다섯 모두 단일 상주 구조화 프로토콜 어댑터([harness-gui.md](harness-gui.md))로 돈다. 정의의 `runtime`이 harness인 agent는 lophn session을 갖지만 run-loop가 돌리지 않는다. 사람이 즐겨찾기한 coding agent(`shell.coding_agents.favorites`) 가운데 이 다섯은 정의 file 없이 전역 내장 agent(id `coding_<harness id>`, handle `claude`·`codex`·`opencode`·`omp`·`antigravity`)로 있고, 사람이 만든 custom harness agent 정의도 다섯 runtime과 `harness_config`(model·options)를 모두 쓸 수 있다([agent-definition.md](agent-definition.md)).

실행 모드는 둘이다:
- **`tab` 모드 (`harness_gui = 1`)**: project 터미널의 GUI 탭 팀원([harness-gui.md](harness-gui.md) "팀원"). project에서 연 GUI 탭과 `open: "tab"`으로 열린 project harness agent(내장 coding agent 기본, 또는 agent 정의·workflow step·participant·실행 덮어쓰기가 `open: "tab"`으로 정한 custom harness agent)가 이 모드로 열린다. 그 탭은 해당 session의 agent 정의(`harness_config`·`permissions.deny`)로 CLI를 띄우며, 그 queue는 그 터미널 GUI 탭만 가져가고 TUI 열기는 거절한다. workflow 출처(`workflow_origin`)가 있는 탭은 turn이 끝나도 자동으로 닫지 않고 workflow desk에 남긴다.
- **`background` 모드 (`harness_gui = 0`)**: Home·앱 workspace의 harness agent, `open: "background"`인 harness agent(custom harness agent 기본, 또는 `open: "background"`로 정한 내장 coding agent), 창 없는 무인 Job·Workflow. 터미널 PTY 없이 core 안 상주 ACP adapter(`terminal: null`)로 실행되고, turn이 끝나고 queue가 비면 짧은 linger(15초) 뒤 handle을 닫는다.

```
Router ─ session.transport = harness ─▶ harness queue(core 메모리, run-loop queue와 따로)
 ├─ harness_gui = 1 (tab 모드) ─▶ project GUI 탭(member) ─▶ 상주 adapter(terminal = AcpTerminal)
 └─ harness_gui = 0 (background 모드) ─▶ background 실행기(onQueued + 1초 sweep)
      ─ StartTurn(ledger) + turn 자격 file(LOPHN_AGENT_CREDENTIAL_FILE)
      ─ agent 정의(harness_config, permissions.deny), workspace cwd
      ─ 상주 adapter(terminal = null, resume/forkFrom/launch) ─ ACP send
      ─ message_recorded·tool_ended ─▶ RecordMessage(text, harness_tool) + MessageRecorded
      ─ approval_opened·question_asked ─▶ 자동 거절/미응답 + 이유 기록
      ─ TurnEnded(사람 Stop) ─▶ ACP stop / turn_ended ─▶ FinishTurn + 자격 file 삭제
      ─ session_changed(cli_session, models) ─▶ BindHarnessSession + HarnessCatalogManager passive warming
TurnEnded ─▶ result call이면 마지막 기록 메시지가 답(custom의 자동 답과 같은 길)
```

- turn은 시작 → 기록 → 끝 순서이고 `TurnEnded`는 한 번이다. 기록은 core 안 machine 자격으로 기존 command(StartTurn, RecordMessage, FinishTurn)에 남는다.
- session의 harness와 외부 session id(harness 자신의 session id)는 session 행에 있다(ledger step `lophn-agent.sessions.harness`). harness는 열 때 정해지고 바뀌지 않으며 외부 id는 machine 전용 command `BindHarnessSession`만 쓴다.
- background 모드에서 harness가 쓴 tool은 메시지 part `harness_tool {name, summary, status}`로 남고, 기록마다 `MessageRecorded`(`model_call: null`)가 나가 Home/App 대화가 바로 갱신된다.
- cwd는 session workspace의 폴더다. project는 첫 폴더, 앱은 source 폴더(없으면 첫 폴더), home은 `<data root>/harness-home/<session>/`(turn 시작 때 만들고 지우지 않는다)다.

### Harness Catalog Discovery & Cache

Agent Profile 편집기가 harness runtime의 model과 option 축(`effort`, `speed`, `variant`, `thinking` 등)을 고를 수 있게 core daemon이 `HarnessCatalogManager`를 둔다.
- **기동 시 자동 스폰 금지**: core가 뜰 때 외부 CLI를 임의로 실행하지 않는다.
- **Passive Warming**: 열린 GUI 탭이나 background 실행기가 `session_changed`로 model 목록을 받을 때마다 공짜로 memory·disk cache(`<data root>/cache/harness-catalog.json`)를 갱신한다.
- **Lazy Probe & Refresh**: `harness_catalog/read { harness, workspace?, probe? }`는 cache가 있으면 즉시 `ready`(stale 여부 포함)를 돌려주고, 비었으면서 `probe: true`일 때만 해당 어댑터의 `fetchCatalog`를 in-flight dedup + 20초 deadline으로 한 번 호출한다. `harness_catalog/refresh`는 강제 재조회하고 내용이 바뀌면 `StateChanged { harness_catalog }`를 낸다. `opencode`는 workspace cwd별로, 나머지 넷은 전역 key로 cache한다.
- **User Intent 보존**: probe가 실패하거나 저장된 model id가 목록에 없어도 기존 disk cache와 Agent 정의의 `harness_config`를 지우거나 덮어쓰지 않고 `status: "error"` 값으로 알린다.

### TUI 탭과 hold

background harness session(`harness_gui = 0`)은 `lophn tab open --session <ses> --tui`로 터미널 탭에서도 연다. core가 그 project에 터미널을 열고 그 CLI의 resume 줄을 친 뒤 탭으로 보인다(그 workspace를 보이는 창이 없어도 터미널은 돈다). 상주 background handle이 아직 살아 있으면 `conflict`로 거절하며 유휴 handle을 즉시 닫아(evict) 다음 시도에 열리게 한다. 그 터미널이 그 session을 쥔 동안 그 session의 background turn은 시작하지 않는다. 이 hold는 lease다: core가 열 때 30초 예약을 걸고, 터미널을 쥔 쪽이 쥔 session 목록을 바뀔 때와 3초마다 넣어 10초로 이어 가며, 목록에서 빠지면 바로 푼다. `--tui`로 연 터미널은 그 harness가 foreground에 보였다 떠나면 놓고(CLI가 끝내 안 뜨면 터미널이 끝날 때까지 쥔다), 폰의 `coding_sessions/open`이 resume으로 연 터미널은 터미널이 끝날 때까지 쥔다(한 CLI session에 두 process가 쓰면 대화 기록이 섞이거나 깨진다). core가 다시 뜨면 임대라 저절로 풀린다.

## 지키는 것

1. **CLI의 두 갈래가 섞이지 않는다.** core를 부르는 명령의 표는 하나이고 lophn agent와 binary가 같이 쓴다. `local` 명령은 core를 부르지 않는다. 예외는 `harness sync-skills` 하나다.
2. **CLI가 core에 붙는 자격이 새지 않는다.** 주소는 `LOPHN_DAEMON_URL`, 없으면 identify의 `api_url`이다. `LOPHN_DAEMON_URL`이 있으면 core를 띄우지 않고(기동 중인 core는 ready를 기다린다), 그 주소가 identify가 가리키는 core와 같을 때만(port 비교) connect해서 다른 server에 user token이 가지 않는다. CLI는 shell capability를 요구하지도 받지도 않는다. user token은 출력에 남기지 않고 core의 `not_found` 글은 그대로 돌려준다.
3. **`lophn core stop`은 core를 띄우지 않는다.** 도는 core가 없으면 `unavailable`(exit 5), agent 자격 안에서는 `forbidden`이다.
4. **CLI 출력은 data fence 없이 줄로 쓴다.** `--json`이면 JSON 하나다.
5. **제품 감지는 core가 CLI를 exec해서 한다**(`coding_agents/list|refresh`). 결과는 core 메모리에만 둔다. 처음 읽기는 실행 파일 찾기만 하고, 제품을 실제로 실행하는 version probe는 사람이 다시 감지를 눌렀을 때만 돈다. 사람이 시키지 않았는데 제품을 띄우지 않는다.
6. **앱의 source 폴더는 `app.create`가 commit된 뒤 core가 만든다.** 내장 template을 `<data root>/apps/<app>/source`에 깔고 첫 commit을 만든 뒤(사람의 전역 git 설정은 읽지 않고, 저장소 안에 `user.name`, `user.email`, `commit.gpgsign=false`를 남긴다) core 안 machine 자격으로 `app.connect_source`를 부른다. 폴더가 이미 있으면 덮지 않고 commit이 있을 때만 그대로 잇는다. 깔기나 잇기가 실패하면 앱은 `source_path: null`로 남는다. `app.connect_source`는 git 저장소의 맨 위이고 commit이 있는 폴더만 받는다.
7. **hook은 harness의 사용자 전역 설정에 한 번 놓고, 놓기 전에 사람에게 묻는다.**
   - 사람의 터미널이나 `coding_sessions/open`에서 그 harness를 처음 알아봤을 때(core 실행마다 harness당 한 번, Settings에서 `[Uninstall hooks]`로 opt-out한 harness 제외) core가 `lophn harness install`을 `dry_run`으로 불러 없는지만 보고, 없으면 묻지 않고 바로 설치한 뒤 `HookInstallFinished`를 낸다. 붙은 shell이 없는 화면 없는 VM이나 원격·폰 세션에서도 그대로 설치되며, 붙은 창이 있으면 그 터미널 탭이 있는 창이 성공 toast나 실패 dialog를 보인다. Settings에서 `[Uninstall hooks]`를 누르면 `<data root>/terminal-agents/hooks-opt-out.json`에 영구 opt-out으로 기록하고, `[Install hooks]`를 누르면 opt-out을 푼다.
   - dialog는 harness 이름, 하는 일 한 문장(상태를 보이고 turn 끝을 알린다), 쓸 file 목록이다. Codex는 `config.toml`에 hook trust도 같이 기록한다는 한 문장이 붙는다.
   - Settings › Coding agents의 [Install hooks]는 누른 것이 허락이라 묻지 않는다. 성공은 toast 하나, 실패는 무엇이 왜 실패했는지와 file을 담은 dialog로 보인다.
   - 거절은 기억하지 않고 다음 core 실행에서 다시 묻는다. 묻거나 놓기가 실패해도 터미널은 그대로 돈다(hook이 없어 상태가 unknown이다).
   - `dry_run`은 event마다 우리 항목이 있으면 내용이 달라도 `unchanged`라 lophn이 업데이트돼도 다시 묻지 않는다. 표에 새로 더한 event에 우리 항목이 없거나, plugin file 본문이 지금 원문과 다르면(hook command만 다른 것은 같다고 본다. 2.x용으로 바뀌기 전의 OpenCode plugin도 여기 든다) `missing`이다.
   - 개발 실행만 예외다. PATH의 `lophn`이 없거나 설치된 판이므로 저장소에서 뜬 core는 `npm run dev`가 만드는 launcher(`<저장소>/.cache/dev-cli/lophn`. 설치된 `/usr/bin/lophn`과 같은 본문에 경로만 저장소 소스와 그 저장소의 Electron으로 바꾼 것)가 있을 때만 그것을 쓰고(없으면 CLI를 부르지 않는다. 물려받은 `LOPHN_CLI`는 보지 않는다) 그 경로를 hook command로 넘긴다. 그때의 `dry_run`은 우리 항목의 command가 다르면 놓을 것이 있다고 본다. launcher는 `.dev-data`가 아니라 저장소의 `.cache/`에 두어 schema가 바뀌어 `.dev-data`를 지워도 전역 hook이 가리키는 경로가 남고, 실행마다 다시 쓴다. hook command 경로는 공백·따옴표·`..`가 없는 절대 경로만 받는다.
8. **Codex hook은 trust까지 같이 기록한다.** Codex는 새로 놓이거나 바뀐 hook을 사람이 `/hooks`에서 trust하기 전까지 건너뛴다. 설치가 `~/.codex/config.toml`에 lophn 항목마다 `[hooks.state."<hooks.json 경로>:<event>:<group 번호>:<handler 번호>"] trusted_hash`를 쓴다. hash는 Codex 0.164의 hook hash와 같은 계산이다: 정규화한 handler 하나, matcher, event 이름을 key 정렬 compact JSON으로 sha256한다. lophn의 표만 고치거나 끝에 더하고 나머지 byte(주석, 다른 도구의 표)는 그대로 둔다. 파싱되지 않는 `config.toml`은 건드리지 않고 `failed`다. trust 기록이 없거나 hash가 다르면 `dry_run`이 `missing`이고 file 목록에 `config.toml`이 든다. 사람의 허락은 lophn dialog 한 번이다. Codex가 계산을 바꾸면 기록이 Modified가 되어 사람이 `/hooks`에서 trust하던 때로 돌아갈 뿐이다. `config.toml`(trust)을 `hooks.json`보다 먼저 쓴다. 사이에서 끊겨도 trust 없는 hook이 아니라 없는 handler를 가리키는 기록만 남는다.
9. **전역 설정은 사람의 다른 항목을 보존한다.** 어느 꼴이든 우리 항목만 바꾸고 나머지 byte(주석, 다른 도구의 항목)는 그대로 둔다. 파싱되지 않거나 고칠 수 없는 꼴이면 아무것도 쓰지 않고 `failed`다. cline은 event마다 script 하나라 사람의 script가 이미 있으면 놓지 않는다. hook이 stdout에 정해진 JSON을 내야 하는 harness(antigravity, cursor)는 CLI와 launcher가 같은 표에서 출력하고, lophn 밖에서 불려 바로 끝날 때도 같다. 설정 file은 같은 폴더의 임시 file에 쓰고 rename한다(쓰다 끝나도 반쯤 쓰인 설정이 남지 않는다). symlink인 dotfile은 가리키는 실제 file을 고치고 권한을 지킨다. 읽은 뒤 쓰기 전에 다른 도구가 file을 고쳤으면 읽기부터 한 번 다시 하고, 두 번째도 바뀌었으면 아무것도 쓰지 않고 `failed`다. 지우기도 같다.
10. **전역 hook은 lophn과 상관없는 harness 실행에서도 불리므로 조용히 끝난다.** lophn 터미널이 넣는 `LPN_TERMINAL_HOOK`이 없으면 launcher가 CLI를 띄우지 않고 끝나고, `lophn hook`도 stdin을 읽지 않고 아무것도 보내지 않은 채 성공한다. env가 있어도 stdin이 닫히지 않으면 1초만 기다리고 아무것도 보내지 않은 채 성공한다(stdin 읽기와 socket 쓰기가 그 1초를 나눠 쓴다. harness를 붙잡지 않는다). pi extension과 OpenCode plugin은 그 env가 없으면 hook을 등록하지 않는다. launcher는 CLI를 Electron의 Node로 띄운다(권한 flag 없음).
11. **Settings의 hook 상태는 CLI 한 번으로 읽는다.** `lophn harness status`가 모든 harness의 `install --dry_run`을 한 process에서 돌려 목록으로 낸다. 화면이 열릴 때와 창이 focus를 다시 받을 때마다 읽으므로 harness마다 process를 띄우면 25개가 한꺼번에 뜬다(CPU 약 10초).
12. **[Uninstall hooks]는 놓기의 거꾸로이고 우리 것만 지운다.**
    - 놓을 때와 같은 규칙으로 우리 항목을 알아본다(command가 `lophn hook <harness> `나 개발 경로로 시작, 표시 block, 우리 이름의 file). 사람이 우리 group에 더한 handler, 같은 이름의 사람 cline script, 다른 file을 가리키는 Muse 설정, 사람의 Hermes 승인은 남긴다.
    - 글 형식(JSONC, TOML, YAML)은 우리 줄만 지워 놓기 전 byte로 돌아가고, JSON은 놓을 때처럼 다시 직렬화한다. 우리 것만 남았던 event key와 `hooks`, 우리 이름의 file(`lophn.json`, `lophn-hooks.json`, plugin file, cline script), 비게 된 file(`{}`, 빈 글)은 지운다.
    - Codex는 우리 trust table을 지우고, 우리 group 뒤에 있던 다른 도구의 기록은 당겨진 위치의 key로 옮긴다(key가 바뀌면 Codex가 다시 trust하라고 한다).
    - 사람의 handler가 섞인 Devin 항목처럼 offset으로 안전하게 고칠 수 없거나 파싱되지 않으면 아무것도 쓰지 않고 `failed`다.
    - 누른 것이 허락이라 묻지 않고, 지운 뒤 이 실행에서는 터미널이 그 harness를 알아봐도 다시 묻지 않는다. 다음 실행에서는 거절처럼 다시 묻는다.
13. **coding agent에게 가는 skill은 사람이 승인한 앱 공유의 public skill과 내장 `lophn-agent` 하나다.**
    - 읽는 것은 설정 `coding-agent.shared_apps`(앱 slug 목록. 앱 workspace의 agent가 청한 공유 요청을 사람이 coding agent까지 골라 승인할 때만 더해진다: [approval.md](approval.md))와 core read `app.skills`([app-call.md](app-call.md))다.
    - 쓰는 곳은 hook이 놓인(`unchanged`) harness의 adapter `skill_dir`(사람 home 기준)이다: Claude Code `.claude/skills`, Codex·pi `.agents/skills`, OpenCode `.config/opencode/skills`. 다른 harness는 `skill_dir`이 null이라 사본이 없다. Codex와 pi는 폴더를 같이 쓰므로 하나라도 hook이 놓였으면 둔다. hook이 없는(`missing`) harness의 폴더에서는 lophn이 쓴 사본만 지우고, hook 상태를 못 읽은 폴더(`failed`)는 건드리지 않는다. 그 폴더를 쓸 수 없으면 `unavailable`이다.
    - `lophn-agent` skill은 hook 상태와 상관없이 `skill_dir`을 가진 harness(Claude Code·Codex·OpenCode)의 skill 폴더에 앱 공유 skill과 같은 표시 file로 늘 동기화한다.
14. **사본은 lophn이 쓴 것만 덮고 지운다.**
    - skill 폴더마다 표시 file `.lophn-shared`(JSON `{app, release, files[]}`)를 두고, 표시가 있는 폴더만 덮고 지운다. 같은 이름의 폴더가 사람의 것이면(표시 없음) 건드리지 않고 건너뛰어 `skipped`로 알린다. 표시를 먼저 쓰므로 쓰다 멈춰도 다음에 우리 폴더로 알아본다.
    - 지울 때는 표시 file에 적힌 file만 지우고(recursive가 아니다) 비게 된 폴더만 치워, 사람이 그 안에 넣은 file은 남는다.
    - 폴더 이름은 `[A-Za-z0-9_][A-Za-z0-9_.-]*`, file 이름은 폴더 밖으로 못 나가는 것만 받는다(core가 준 값이라도 사람 home에 쓰는 일이라서다). 같은 이름을 두 앱이 내면 앞의 것(slug 순)만 쓴다. 내용이 같으면 다시 쓰지 않는다.
    - `shared_apps`에서 slug가 빠지거나 앱의 active release가 그 skill을 public으로 내놓지 않으면 `app.skills`가 주지 않아 다음 sync가 사본을 지운다. Settings › Coding agents의 공유 앱 목록에서 앱마다 Remove로 줄이고, 지우기는 쓰기 직전에 값을 다시 읽어 그 slug만 뺀다(같은 값에 승인이 덧붙는다).
15. **사본은 core process가 직접 쓰지 않고 core가 CLI(`lophn harness sync-skills`)를 exec해서 맞춘다.** 사람 home에 쓰는 규칙(표시 file, 우리 것만)은 CLI 한 곳에 있다. core가 exec하는 CLI에는 그 core의 주소(`LOPHN_DAEMON_URL`)를 줘서 그 core에만 붙는다. core가 멈추거나 죽으면 CLI는 실패로 끝나고 core를 다시 띄우지 않는다. 맞추는 때는 넷이다: core가 ready가 된 뒤 한 번, 앱 view의 activation 신호(`AppViewChanged`의 reason `activation`. 앱을 가리지 않으므로 공유하지 않은 앱의 activation에도 돌지만 사본이 같으면 아무것도 쓰지 않는다), `settings` 변경(`StateChanged`)의 id에 `coding-agent.shared_apps`나 `extensions.harness.enabled`가 있을 때, hook을 놓거나 지운 뒤. 한 번에 하나만 돌고 도는 중에 온 요청은 끝난 뒤 한 번 더 돈다. 실패는 log만 남기고 부른 쪽을 막지 않는다. session 시작 hook은 core를 부르지 않으므로 쓰지 않는다.
16. **`harness uninstall`은 lophn이 쓴 사본도 지운다.** 그 harness의 skill 폴더에서 표시 있는 폴더를 치우고 지운 폴더를 출력 file 목록에 더한다. 같은 폴더를 쓰는 다른 harness의 hook이 남았으면 다음 sync가 다시 둔다.
17. **설치는 전에 놓은, 지운 skill의 얇은 사본도 지운다.** 지우는 이름은 정해 둔 목록(`lophn-build-app`, `lophn-repair`)이고 패턴이나 목록 읽기로 고르지 않는다. 폴더에 `SKILL.md` 하나뿐이고, 그 글이 lophn이 쓰던 꼴과 byte까지 같고, `dry_run`이 아닐 때만 file 하나와 빈 폴더 하나를 지운다(recursive가 아니다). 사람이 고친 사본, 다른 file이 든 폴더, 다른 이름의 skill은 남긴다. 출력의 `skill` 칸은 이 지우기만 알린다. 옛 사본이 있는 사람은 `lophn harness install`을 한 번 돌려야 지워진다.
18. **harness 실행은 별도 extension 켜기 설정(`extensions.harness.enabled`) 없이 core에 기본 내장된다.** 다섯 구조화 harness runtime(`claude-code`, `codex`, `opencode`, `omp`, `antigravity`)이 `tab`·`background` 모드로 바로 동작한다. 편집기 `Runs on`의 기본 runtime 선택지는 `Settings › Coding agents`의 `favorites`를 따르되, 나머지 지원 harness도 보조 선택지로 고를 수 있고 이미 저장된 runtime은 즐겨찾기 해제 후에도 보존한다.
19. **harness session의 harness는 열 때 정해 바뀌지 않는다.** runtime이 harness가 아닌 session은 외부 id를 고치지 못한다.
20. **core 안 harness 명령(`harness/bind_session`, `open_member`, `fail_call`)은 machine 전용이고, `harness_catalog/read|refresh`는 사람 자격 전용이다.** 재시작하면 끝나지 않은 harness turn은 interrupted(restarted)로 끝나고 늦은 FinishTurn은 `conflict`다.
21. **harness가 쓴 tool은 lophn이 실행한 것이 아니다.** gate·rewind의 tool-call chain에 들지 않는다.
22. **harness의 permission mode·sandbox는 lophn이 정하지 않는다.** 사람이 그 CLI에 해 둔 기본 설정대로 돈다. lophn이 넣는 것은 `lophn`을 부르는 길(Claude Code `Bash(lophn *)` 허락, Codex `network_access=true`), `harness_config`(model·options), 정의의 deny뿐이다. background 실행에서 정의에 deny가 있는데 옮길 수 없는 adapter(Claude 밖 넷)는 띄우지 않고 그 turn을 `configuration_unavailable`로 끝낸다(대화에 이유 한 줄).
23. **harness는 turn 자격 file로 자기 shell에서 `lophn`을 부른다.**
    - `tab` 모드와 `background` 모드 모두 오래 사는 상주 CLI라 env에 자격 대신 `LOPHN_AGENT_CREDENTIAL_FILE`(secret이 아닌 per-run 경로)을 둔다. core가 turn마다 그 turn의 자격을 0600으로 쓰고 turn이 끝나면 지우고 자격을 끝낸다. 범위는 그 workspace 종류의 `lophn` 명령 route뿐이고(file·rewind·gate·ask route 없음) `TurnEnded`에 끝난다.
    - CLI는 `LOPHN_AGENT_CREDENTIAL_FILE`이 있으면 그 file을 읽고(없으면 2초까지 다시 읽은 뒤) 사람 자격으로 바꾸지 않고 `unauthorized`다(turn 밖). user token으로 `call.reply`·`call.send`는 `forbidden`이다. 사람이 GUI에서 `!`로 친 명령은 이 file 없이 돌아 사람 자격이다.
    - turn 자격은 누가 했는지를 남기는 것이지 가두는 것이 아니다: harness는 사람의 shell을 가져 변수를 지우면 control connect로 사람 자격을 얻는다. 막지 않는다.
    - adapter가 띄우는 process의 env는 core가 읽은 사람의 login shell env이고(harness가 자기 API key를 쓴다), core가 고른 `lophn` launcher의 폴더를 PATH 앞에 두고 `LOPHN_HOME`(그 core의 data root)을 늘 넣는다. lophn user token은 넣지 않는다.
24. **cwd는 session workspace의 폴더이고 폴더가 없으면 띄우지 않는다.** 폴더 없는 project·app에서는 띄우지 않는다.
25. **background harness session은 turn 중에 대기 메시지를 받지 못한다.** ACP `steer` capability가 꺼져 있고 send-now는 `unavailable`이다.
26. **background turn의 끝은 ACP `turn_ended`다.** 실패는 `model_error`, 시작 실패·종료는 `target_unavailable`, 글 없이 끝나면 `no_answer`, 설정·deny·cwd 오류는 `configuration_unavailable`다. 사람이 멈추거나 core가 turn을 닫으면 ACP `stop`을 보내고 `finish`를 다시 부르지 않는다. 사람 메시지의 이미지는 `[image: <mime> not passed to the harness]` 글로 바뀐다.
27. **run-loop는 harness 입력을 돌리지 않는다.** 닿으면 turn을 시작하지 않고 `target_unavailable`로 닫는다. 켤 때 접수만 된 사람 메시지는 harness queue에 되돌린다.
28. **TUI 열기는 조건이 있다.** harness session이 아니거나 GUI 탭 팀원(`harness_gui = 1`)이거나 project workspace가 아니면 `invalid_input`, CLI session id가 아직 없거나(첫 turn 전) turn이 돌거나 상주 background handle이 아직 살아 있거나(유휴 handle이면 즉시 evict를 요청한다) 이미 열려 있으면 `conflict`다. cwd는 session project의 첫 폴더다. TUI process는 lophn 자격을 받지 않고 그 안의 turn은 lophn 기록에 없다. 다음 background turn이 같은 CLI session을 resume하므로 agent는 기억한다.
29. **TUI로 연 터미널이 그 session을 쥔 동안 그 session의 background turn은 시작하지 않는다.** hold된 session은 background 실행기가 건너뛰고 `start`가 `conflict`다. 입력과 call은 queue에 남고(call은 accepted) 풀리면 다음 sweep에 돈다. core는 터미널을 연 순간부터 그 session을 쥐고, CLI가 foreground에 보인 뒤 떠났을 때와 터미널이 끝났을 때 푼다. CLI가 끝내 안 뜨면 터미널이 끝날 때까지 쥔다. 창이나 탭이 닫혀도 터미널이 돌면 쥔다. host 터미널 탭을 `tab close`로 닫으면 PTY도 닫는다.

## 경계와 계약

경계: `coding-agent-cli`(명령 표와 binary), `coding-agent`(hook·감지·공유 skill 사본), `coding-agent-cli-interface`, `coding-agent-harness-api`, `harness-host-interface`, `external-coding-agent`(사람의 coding agent).

- **env.** `LOPHN_DAEMON_URL`(CLI가 붙을 core 주소), `LOPHN_AGENT_CREDENTIAL_FILE`(GUI 탭 팀원과 background harness의 turn 자격 file 경로. secret이 아니다), `LOPHN_AGENT_SHELL`(lophn agent의 shell.run·ACP terminal 표시. 자격이 없으면 CLI가 바로 멈춘다), `LOPHN_SESSION_ID`(background harness CLI에 넣는 lophn session id `ses_…`. 터미널 env는 바깥 `LOPHN_*`를 지우고 탭의 shell에 `term:<탭>`을 넣으며, GUI view가 띄운 CLI도 같은 값을 싣는다), `LOPHN_CLI`(shell과 CLI가 쓰는 개발 launcher 경로. core는 보지 않는다), `LOPHN_HOME`(data root), `LPN_TERMINAL_HOOK`(lophn 터미널이 넣는 hook 표지). CLI exit: success 0, internal 1, invalid_input 2, unauthorized·forbidden 3, failed 4, `unavailable` 5(transport), effect_unknown 6.
- **CLI 명령.** `lophn harness detect|refresh|install [--dry_run]|status|uninstall|sync-skills`, `lophn hook <harness> <event>`, `lophn core stop`, `lophn tab open --session <ses> --tui`, 그 밖은 core를 부르는 명령 표.
- **설정 key.** `coding-agent.shared_apps`(앱 slug 목록), `shell.coding_agents`(즐겨찾기·명령).
- **core route·command.** `app.create`, `app.connect_source`, `app.skills`, `harness_catalog/read|refresh`, Settings › Coding agents의 `coding_agents/list|refresh|hook_status|install_hooks|uninstall_hooks`와 event `HookInstallFinished`, `turns/read`, `agents/read`, `projects/get`, `apps/get`. 기존 command StartTurn, RecordMessage, FinishTurn, machine 전용 `BindHarnessSession`·`OpenHarnessMember`·`FailHarnessMemberCall`. event `TurnEnded`, `MessageRecorded`, `StateChanged`(`settings`, `harness_catalog`), `AppViewChanged`.
- **저장 모양.** session 행의 `harness`, 외부 session id `harness_session`(ledger step `lophn-agent.sessions.harness`), GUI 탭 팀원 표시 `harness_gui`(ledger step `lophn-agent.sessions.gui-member`, `1` = tab 모드, `0` = background 모드). turn 자격 file `<per-run 폴더>/credentials/<터미널 또는 session>`(0700 폴더, 0600 file, turn 동안만). model catalog disk cache `<data root>/cache/harness-catalog.json`. 메시지 part `harness_tool {name, summary, status}`. `<data root>/harness-home/<session>/`, `<data root>/apps/<app>/source`, harness의 사용자 전역 설정(hook), 사람 home의 skill 폴더와 표시 file `.lophn-shared`, `~/.codex/config.toml`의 `[hooks.state."…"] trusted_hash`, 개발 launcher `<저장소>/.cache/dev-cli/lophn`.
- **TUI 열기 요청.** `tabs/open` target `{tui: <ses>}`이면 core가 그 session의 hold를 걸고 그 project에 터미널을 열어(`terminals/open`의 `resume {harness: <adapter id>, external_session}`) resume 줄을 친 뒤, host queue의 `tab_open`(target `{terminal: {terminal_ref}}`)으로 창에 탭을 보인다(key `host:<tab>`). runtime → adapter id 대응은 한 곳에서만 정한다.
- **TUI handoff.** agent가 `tabs/open` target `{coding: {harness, handoff}}`(CLI `lophn tab open --coding <harness> --handoff <글>`)로 사람이 이어서 만질 일을 넘긴다. project와 home workspace의 agent만(앱은 `invalid_input`), 즐겨찾기 가운데 이 컴퓨터에서 감지되고(Settings › Coding agents의 마지막 감지 결과) adapter가 첫 prompt 인자 꼴(`session.prompt`)을 아는 harness만 된다. 하나도 없으면 agent가 사람에게 Settings › Coding agents에서 즐겨찾기하거나 감지를 확인하라고 전하게 하는 `invalid_input`이다. 지침은 harness 이름을 박지 않고 이 오류가 열 수 있는 id를 알려 준다. core는 글을 `<data root>/handoffs/<tab>.md`(0600)에 쓴다. 그다음 core가 그 project(home이면 사람의 home 폴더)에 새 터미널을 열어 사람의 즐겨찾기 명령 뒤에 고정 글 "Read the handoff at <file> and continue the work it describes."만 첫 prompt로 붙여 치고, 그 터미널을 탭으로 보인다. 이 탭은 사람의 터미널이라 lophn session도 hold도 없다.
- **fork한 session의 첫 turn.** fork한 background harness session이 아직 harness session id를 갖지 않았고 원본의 지금 마지막 메시지에서 갈라졌고 harness가 같으면, adapter `start`에 `forkFrom`으로 원본의 harness session id를 넘긴다. Claude Code·Codex·OpenCode는 그 session에서 갈라 시작해 앞 대화를 물려받고, omp·Antigravity는 새로 시작한다. 원본의 중간에서 갈랐으면 싣지 않는다(새로 시작한다).
- **내장 skill `lophn-agent`.** 받은 call의 tag 읽기, `call reply`(승인을 청하는 팀원의 call에는 `--allow`·`--reject`)·`call send`·`call cancel`, `team`, `session list`·`agent list`·`agent card`, 사람의 다른 컴퓨터에 닿는 `--on`(`machine computers`, "Other computers" 절)과 `handoff write`("Handoff note" 절. `machine-a2a.md`), `ext call`을 적고 turn 자격이 있을 때만 쓰라고 한다. harness agent가 치는 binary는 agent 자격이라 `--on`을 `on` 칸을 가진 네 명령의 칸으로만 받는다(`remote.md`의 "`--on`"). `tab open --url|--preview`, `preview`, `browser snapshot → act --ref` 같은 탭 명령은 사람 token(사람의 터미널)으로도 되어 따로 적는다. 사람 token으로 연 탭의 주인은 "person"이다([workspace-layout.md](workspace-layout.md) "agent가 연 탭").
- **hook 설치 출력.** `harness install`의 출력은 event·file 목록과 상태(`unchanged`, `missing`, `failed`, `conflict`, skill 사본의 `skipped`)이고 `dry_run`은 쓰지 않고 같은 판정을 낸다.

## 결정

- **harness는 extension host가 CLI 명령으로 돌린다.** 이유: harness가 programmatic 실행을 공식으로 지원하므로 workflow와 job처럼 사람 없이 돌려도 된다. host는 extension이라 core에는 route로만 붙는다. 이어 가기는 harness 자신의 session id라 TUI 열기와 다음 입력이 같은 대화를 resume한다. (사람, 2026-11-04) 처음에는 extension host가 shell main에 있어 화면 없이 도는 harness turn도 앱이 떠 있어야 했다. 지금은 core가 사람의 login shell env를 읽고 extension host를 core 안에서 돌려 앱 없이 돈다. (사람, 2026-11-17: 일은 core가 한다 / agent)
- **host는 extension `harness`이고 켜기는 extension 설정 하나다.** (agent)
- **harness는 MCP bridge가 아니라 `lophn` CLI를 쓰고, 쓰는 법은 skill로 harness skill 폴더에 배포한다.** 이유: 사람 터미널의 coding agent, lophn agent, harness agent가 같은 명령 표를 쓴다. 버린 안: host tool을 MCP로 넘기기(happy). (사람, 2026-11-04)
- **Codex에는 `network_access=true`를 넣는다.** 이유: 사람의 sandbox가 `workspace-write`이면 그것이 loopback을 포함한 network를 막아(seccomp가 `connect`를 막는다) CLI가 core에 닿지 못한다. 쓰기는 workspace 안 그대로이고 Codex가 돌리는 명령이 인터넷에도 닿는다. 버린 안: sandbox 끄기(emdash·orca), loopback만 여는 옵션(없다). core의 unix socket 하나만 permission profile로 여는 길은 남겨 두었다. (사람, 2026-11-04)
- **harness는 사람의 CLI 권한 설정대로 돈다.** permission mode와 sandbox는 사람이 자기 터미널에서 그 CLI를 쓸 때와 같다. 이유: 권한은 사람이 그 CLI에 정해 둔 것이고 lophn이 따로 정하지 않는다. 넘겨받은 Claude Code가 `lophn` 밖 Bash를 못 돌려 일을 못 하던 것도 이것으로 풀린다. 버린 안: lophn이 harness마다 mode를 고정(acceptEdits, workspace-write). (사람, 2026-11-09) 대가: deny를 옮길 수 없는 harness는 deny가 있으면 띄우지 않는다.
- **즐겨찾기 coding agent는 정의 없이 부른다.** 이유: 사람이 즐겨찾기로 이미 고른 agent를 정의 file을 또 만들어야 부를 수 있으면 agent가 찾지 못한다(handle을 추측하다 멈췄다). 즐겨찾기를 끄면 새로 부를 수 없고 열린 session은 그대로 돈다. (사람, 2026-11-09)
- **handoff는 TUI, 일회성 일은 headless다.** 사람이 이어서 만질 일은 사람의 터미널에 그 coding agent를 띄워 넘기고, 결과만 받으면 되는 일은 `team spawn`·`call send`로 headless로 보낸다. 지침(project prompt, 내장 skill `lophn-agent`, CLI help)이 이 기준을 말한다. (사람, 2026-11-09) handoff 글은 file로 넘기고 터미널에는 고정 글과 경로만 친다: 터미널은 사람의 login shell에 글자를 치는 길뿐이라 agent가 쓴 글을 shell마다 quoting하지 않는다. (agent)
- **harness가 쓴 tool은 `harness_tool` part로만 남기고 gate·rewind chain에 넣지 않는다.** 이유: lophn이 실행한 것이 아니다. (agent)
- **extension tool의 Gate 판정은 호출 route 한 곳에서 한다.** lophn runtime과 harness CLI가 같은 길을 거친다. (agent)
- **coding session 층을 지웠다.** 이유: lophn이 coding agent를 터미널에 띄우고 token·MCP endpoint·메시지 줄로 맡기던 층은 부르는 곳이 없었다. 앱 일은 그 앱 workspace의 lophn agent가 직접 지었고, 그 뒤 role이 없어져 맡길 쪽도 사라졌다. 지운 것: core apps module의 coding 폴더와 표 셋, coding token, `POST /mcp`, Router의 coding transport, shell의 coding 터미널 탭과 대기 목록 항목, CLI의 token 명령(`message send`, `app …`, `package …`). 다시 필요해지면 새로 설계한다. (사람, 2026-10-28) 사람이 연 터미널이 쓰는 hook, 감지, 설치는 남겼다. (사람, 2026-10-26)
- **hook을 앱 폴더가 아니라 사용자 전역 설정에 한 번 놓고 처음 한 번 사람에게 묻는다.** 이유: 열 때마다 앱 폴더에 놓으면 앱 source에 harness 설정이 섞이고(release 제외 목록이 따라온다) 사람이 고친 file을 지키려고 hash 기록이 필요하다. 전역에 한 번 놓고 사람에게 묻는 쪽이 단순하다. orca처럼 전역 hook이 lophn 환경 변수로 켠다. 버린 안: 열 때마다 앱 폴더에 설치(hash, 설치 명령의 권한 계산), "hook은 앱 source 폴더 안에만" 원칙, 설치를 shell main(Node)으로 옮기기(coding-agent 코드를 shell bundle에 넣어야 한다). 전역 설치 CLI의 권한은 그 harness의 hook 설정 폴더와 skill 폴더로 좁혔다. (사람이 방향, 이슈 결정)
- **등록 거절은 기억하지 않고 다음에 다시 묻는다.** `dry_run`은 우리 항목이 있으면 내용이 달라도 `unchanged`라 lophn이 바뀌어도 다시 묻지 않는다. 같은 이유로 판이 바뀌어도 hook을 data step으로 다시 놓지 않는다. (agent)
- **지원하는 harness는 orca, emdash, herdr 가운데 둘 이상이 지원하는 25종이다.** 한 곳만 지원하는 것은 넣지 않는다. Gemini CLI는 Google이 Antigravity로 옮겨 지웠고 호환 장치를 남기지 않는다. (사람, 2026-10-26) OpenClaw는 비교한 도구 어디도 지원하지 않아 지웠다. (agent) hook이 없는 harness(prime-agent)는 foreground 감지와 icon만 한다. (agent)
- **공유 server를 쓰는 harness(Codex 0.156 이상, OpenCode 2.x, kilo, cline)는 lophn 터미널에서 private server 옵션으로 띄운다.** app-server protocol로 붙는 길은 하지 않는다. (사람, 2026-10-26) 이유: 공유 background server에서 도는 session의 hook은 그 server를 띄운 env로 돌아 lophn 터미널을 모른다.
- **hook으로 상태를 안다.** herdr는 화면을 읽어 짐작하고 orca는 hook이 없으면 title 글리프로 짐작하지만 lophn은 짐작하지 않는다. 대가: Claude Code를 Esc로 끊으면 `Stop`이 오지 않는다. 끊김 신호가 없는 harness에 한해 core의 터미널 상태(tracker)는 사람이 친 단독 Esc·Ctrl-C를 보고 unknown으로 내린다. 끊김을 hook으로 알리는 harness(adapter의 `interrupt_keys`가 빈 것)는 이 key를 보지 않는다([terminal-agent.md](terminal-agent.md)). 버린 안: 모든 harness에서 key 판정 삭제(Claude Code가 Esc로 끊어도 Stop을 안 보낸다). (agent)
- **turn 끝 신호는 제품마다 한 event로 정한다.**
  - Claude Code `Stop`·`StopFailure`. Codex `Stop`·`Interrupt`(0.150 이상, interrupted. 0.150 미만은 끊어도 running에 남는데 표가 판을 가르지 못해 감수한다).
  - OpenCode `session.status` idle. 전역 plugin이 root session의 event만 넘기고, 뒤따르는 deprecated `session.idle`은 같은 끝이라 듣지 않는다(둘 다 들으면 `TurnEnded`가 두 번 간다). 2.x는 plugin이 `{id, setup}` default export로 event를 직접 구독하고 `session.execution.started`·`succeeded`·`failed`·`interrupted`가 `session.status` busy·idle로, `permission.asked`·`replied`는 그대로 1.x 모양으로 바뀌어 넘어가므로 tracker는 두 판을 구별하지 않는다. 2.x는 plugin을 공유 background service가 돌려 터미널 env가 닿지 않으므로 터미널이 `opencode --standalone`으로 띄운다.
  - Antigravity는 `SessionStart`, `PreInvocation`, `PreToolUse`(`matcher: "*"`), `PostToolUse`(`matcher: "*"`), `Stop` 다섯 event를 등록한다. stdout은 `PreToolUse`가 완전히 빈 출력(`""`, `{}`나 개행 금지), `Stop`이 `{"decision":"stop"}`, 나머지가 `{}`다. `Stop`은 `fullyIdle === true`일 때만 턴 종료이며, 실패는 `terminationReason`(대소문자 무시)이 `error`이거나 `error`가 비어 있지 않은 문자열일 때만이다(빈 문자열 `error: ""`는 `completed`). `PreToolUse`는 질문 도구만 `waiting`으로 보고, tracker가 `invoke_subagent`·`send_message`·`swarm` 호출의 부모 `conversationId`를 기억해 같은 터미널에서 `lastUserInput`이 빈 다른 `conversationId` hook은 자식 작업으로만 세고 메인 세션 전환과 Recent 저장을 막으며, idle `Stop` 뒤 늦게 온 유령 `PostToolUse`는 다음 `PreInvocation`까지 무시한다.
  - pi `agent_settled`. pi는 `agent_end` 뒤에 retry와 compaction이 남을 수 있어 끝이 확정되는 쪽을 쓴다.
  - plugin·extension 본문은 turn 끝 payload에 마지막 assistant 답(text block만)을 `lophn_message`로 싣는다. OpenCode 계열은 completed idle에서 1.x는 `client.session.messages`, 2.x는 `ctx.session.context`로 읽고(못 읽으면 뺀다), pi는 `agent_end`의 `messages`를 기억했다가 `agent_settled`에, omp·amp는 `agent_end`·`agent.end`의 `messages`에서 뽑는다. (agent)
- **coding agent에게는 사본을 두고 lophn agent에게는 두지 않는다.** 이유: coding agent는 lophn 안에 정의가 없고 사람의 user token으로 부르므로 줄 것은 앎뿐이고, 자기 skill 폴더만 읽는다. lophn agent는 bundle을 바로 읽으면 되고([agent-definition.md](agent-definition.md)) 사본은 동기화가 틀릴 길만 늘린다. 쓸 harness는 hook을 놓은 harness로 정해, 사람이 hook을 허락한 도구에만 lophn이 파일을 둔다. core는 data root 밖을 쓰지 않으므로 사본은 CLI 쪽 코드가 core에서 읽어 쓰고 core가 CLI를 부른다. (agent)
- **lophn이 쓴 사본에는 표시 file을 두고 그것만 덮고 지운다.** 이유: 사람 home에 쓰는 일이라 사람의 것을 건드리지 않아야 한다. (agent)
- **감지 결과는 core 메모리에만 두고 `refresh`일 때만 새로 감지한다.** 이유: 저장하면 표와 무효화 규칙이 늘고 PATH가 바뀌면 낡는다. 대가: core를 다시 켜면 처음 읽을 때 감지를 한 번 더 한다. 실패한 결과는 쥐지 않아 다음 읽기가 다시 감지한다. (agent)
- **CLI 출력을 data fence로 감싸지 않는다.** 이유: 사용자 앱과 사람이 쓴 글은 공격자로 보지 않는다. 막는 것은 AI가 만든 코드와 agent의 실수, 인터넷에서 온 것이다. 줄로 풀어 쓰고 `--json`이면 JSON 하나다. (사람, AGENTS.md "속도")
- **지운 이름의 얇은 skill 사본은 설치가 정리하되 목록으로만 고른다.** 이유: 사람 home에 쓰는 일이라 byte까지 같은 것만 지운다. 옛 사본이 있는 사람은 설치를 한 번 돌려야 한다. (agent)
- **host queue는 harness queue를 일반화하지 않고 같은 꼴로 새로 둔다.** 이유: harness queue는 session마다 turn 입력을 담는 queue라 요청 종류를 실을 자리가 없다. (사람이 확인)
- **TUI는 project workspace의 session만 열고, 첫 turn 전·turn 중이면 `conflict`다. TUI hold는 그 터미널이 그 session을 쥔 동안이다.** 이유: 한 CLI session에 두 process가 쓰지 않게 하려는 것이다. 열기는 core가 거르고 lease는 터미널을 가진 core가 잇는다(전에는 shell main이 TUI 탭 목록을 올려 이었다). (사람이 확인, agent)
- **harness agent의 home은 session마다 빈 폴더다.** 이유: home의 전역 agent를 harness로 두면 cwd가 없어 부를 때마다 실패한다. data root 안 `harness-home/<session>/`을 turn 시작 때 만들고 지우지 않는다. opencode는 git root가 아니면 띄우지 않는다(위 지키는 것).
- **harness session은 steer를 받지 못한다.** ACP `steer` capability를 끄고 send-now를 `unavailable`로 둔다. 이유: headless process는 turn 중 대기 메시지를 받지 못한다.

- 앱이 session을 멈추면(`app_sessions.stop`) turn이 core에서 닫히고 host가 그 turn의 CLI를 끊는다. host는 CLI를 자기 process group의 leader로 띄우므로 group째 SIGTERM을 보내고, 유예(3초) 뒤에도 group에 남은 것이 있으면 SIGKILL을 보낸다(앞서는 SIGTERM만이라 신호를 무시하는 process가 남을 수 있었다). (agent)

- **GUI 탭 팀원은 headless 곁에 따로 선다.** 사람이 실제 CLI로 GUI 길을 써 본 뒤 headless를 걷어낸다. 그동안 표시(`harness_gui`)가 두 길의 queue를 가른다. (사람이 방향, 2026-11-21 / agent)

## 열린 것

열린 이슈는 topic이 `coding-agent`인 이슈다.

- binary `lophn`의 help에 사람 token으로는 거절되는 명령이 보인다(`job.create`, `call.*`, `session.list`, `package.publish`는 actor가 agent만이라 `forbidden`). 사람 터미널의 coding agent에는 아직 신원이 없다. coding agent 신원과 같이 열거나 그때까지 help에서 빼거나 표시한다.
- fork한 session이 원본의 harness session에서 갈라 시작하는 것(`--fork-session`, `--fork`)은 실제 CLI로 돌려 보지 않았다. Codex와 원본 중간에서 가른 fork는 harness 쪽 앞 대화 없이 시작한다.
- opencode agent는 사람의 opencode 권한 설정대로 돌아 shell과 폴더 밖 쓰기를 한다(사람, 2026-11-04: 이대로 둔다). 좁히려면 inline config의 `permission`을 넘긴다.

- TUI에서 `/clear` 같은 것으로 바뀐 CLI session id는 따라가지 않는다.
- 그 터미널의 탭을 보이는 창이 없을 때(폰이나 agent가 연 터미널에 탭이 아직 없다) 처음 알아본 harness의 hook 설치 물음은 답할 곳이 없어 shell 연결이 닫힐 때 거절로 세고, 그 core 실행에서는 다시 묻지 않는다. Settings의 [Install hooks]로는 놓는다.
- 개발 경로를 놓은 뒤 packaged로 돌아가면 `command` 없는 `dry_run`이 `unchanged`라 개발 경로가 전역 설정에 남는다(개발 머신만. 항목을 지우거나 packaged에서 다시 놓는다).
- Codex 0.150 미만은 `Interrupt` hook이 없어 끊어도 running에 남는다.
