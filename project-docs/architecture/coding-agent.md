# coding-agent

lophn과 사람이 쓰는 coding agent(Claude Code, Codex, OpenCode 같은 harness)를 잇는 메커니즘이다. 세 가지다. (1) lophn이 내놓는 명령을 사람 터미널과 agent가 같은 표로 부르는 CLI. (2) 사람 터미널의 coding agent를 위한 제품 감지, 전역 hook 설치·제거, 공유 skill 사본. (3) 정의의 `runtime`이 harness인 lophn agent(harness agent)를 그 harness의 headless 명령으로 돌리는 길과 그 session을 TUI 탭으로 여는 길. 사람이 연 터미널 탭의 coding agent 상태, 탭 icon·점, 알림은 [terminal-agent.md](terminal-agent.md)의 일이다. 사람 터미널에 coding agent를 띄워 일을 맡기던 층(coding session)은 지웠다.

## 문제

- 사람은 lophn 밖에서 자기 coding agent를 쓴다. lophn이 그것을 알아보고, 상태를 보이고, lophn의 앎(앱이 공유한 skill, 다른 agent를 부르는 법)을 줄 길이 없으면 둘이 따로 논다. 그런데 사람의 PATH와 실행 파일, 사람 home의 설정은 core가 모른다.
- 그 길이 사람 설정을 함부로 고치면 사람의 다른 hook, 주석, 다른 도구의 항목을 잃는다. 묻지 않고 놓거나, 지울 때 사람의 것까지 지우면 신뢰를 잃는다.
- lophn agent를 Claude Code나 Codex로 돌리고 싶다. workflow와 job처럼 사람 없이도 돌아야 하고, 그 agent가 다른 lophn agent를 부르고 답할 수도 있어야 한다. 그러려면 harness가 lophn을 부를 자격이 있어야 하는데, 그 자격이 새어 나가면 안 된다.
- 한 harness session에 headless process와 사람의 TUI process가 같이 쓰면 그 CLI의 대화 기록이 섞이거나 깨진다.

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
Settings › Coding agents ─ shell main이 exec ─▶ lophn harness detect|refresh ─▶ 제품마다 감지 결과
Settings › Coding agents ─ shell main이 exec ─▶ lophn harness status ─▶ 제품마다 hook 상태(모두 dry_run, process 하나)
사람 터미널에서 harness를 처음 알아봄 ─▶ lophn harness install --dry_run ─▶ 없으면 lophn 창 dialog로 묻고 install
[Install hooks] ─────────────────────────▶ lophn harness install (누른 것이 허락)
[Uninstall hooks] ───────────────────────▶ lophn harness uninstall (우리 항목만, lophn이 쓴 skill 사본도)
shell main (core ready, 앱 activation, 설정 바뀜, hook 설치·삭제 뒤)
   ─ exec ─▶ lophn harness sync-skills ─ user token ─▶ core: settings.list, app.skills
   ─▶ hook이 놓인 harness의 skill 폴더에 공유 skill 사본 (표시 file .lophn-shared)
harness ─ 전역 hook ─▶ lophn hook <harness> <event> ─▶ shell main hook socket (terminal-agent.md)
```

- 지원하는 harness는 25종이다: claude, codex, opencode, pi, omp, cursor, copilot, kimi, kiro, antigravity, grok, droid, amp, devin, qwen, qoder, hermes, muse, codebuddy, command-code, prime-agent, mimocode, cline, letta, kilo. 제품마다 통합 규칙(hook을 놓는 자리와 꼴, event → 신호, hook stdout, session id·이름 경로, resume 인자, skill 폴더, headless 명령)은 adapter 표 한 항목에 있다.
- hook을 놓는 꼴은 다음과 같다. Claude식 json settings(claude, qwen, qoder, codebuddy, command-code, droid, letta), JSONC(devin), 우리 전용 file(grok, copilot, kiro), flat json(cursor), 이름 붙은 hook object(antigravity), 표시한 TOML block(kimi), managed hooks file과 settings 칸(muse), 표시한 YAML block과 허용 목록 사전 기록(hermes), event마다 script file(cline), plugin·extension file(opencode·kilo·mimocode 공통 본문, pi, omp, amp). prime-agent는 hook API가 없어 놓지 않는다.
- hook 상태는 event마다 우리 항목이 있는지로 세 가지다. `unchanged`, `missing`, `failed`(Muse에 다른 managed hooks 경로가 있으면 `conflict`).

### harness agent

정의의 `runtime`이 `claude-code`, `codex`, `opencode`인 agent는 lophn session을 갖지만 run-loop가 돌리지 않는다. 사람이 즐겨찾기한 coding agent(`shell.coding_agents.favorites`) 가운데 이 셋은 정의 file 없이 전역 내장 agent(id `coding_<harness id>`, handle `claude`·`codex`·`opencode`)로 있다([agent-definition.md](agent-definition.md)). 입력(사람 메시지, call, run, step)은 shell main의 harness host(extension `harness`)가 그 harness의 headless 명령(`claude -p`, `codex exec`, `opencode run`)으로 실행한다. host는 extension context로만 lophn에 닿는다([extension.md](extension.md)).

```
Router ─ session.transport = harness ─▶ harness queue(core 메모리, run-loop queue와 따로)
extension harness(1초마다) ─ 사람 token ─▶ harness/take → harness/start_turn
   ─ agents/read(permissions.deny), projects/get·apps/get(workspace 폴더) ─▶ 권한 flag, cwd
   ─ spawn(<harness headless 명령>, cwd = workspace 폴더, stdin 닫음) ─ 줄마다 parser ─▶ harness/record(글, harness_tool)
   ─ 1초마다 turns/read: core가 닫았으면(멈춤) process를 끈다 ─ process 끝 ─▶ harness/finish_turn
                                          └▶ harness/set_external_id (harness의 session id, resume에 쓴다)
TurnEnded ─▶ result call이면 마지막 기록 메시지가 답(custom의 자동 답과 같은 길)
```

- turn은 시작 → 기록 → 끝 순서이고 `TurnEnded`는 한 번이다. 기록은 core 안 machine 자격으로 기존 command(StartTurn, RecordMessage, FinishTurn)에 남는다.
- session의 harness와 외부 session id(harness 자신의 session id)는 session 행에 있다(ledger step `lophn-agent.sessions.harness`). harness는 열 때 정해지고 바뀌지 않으며 외부 id는 machine 전용 command `BindHarnessSession`만 쓴다.
- harness가 쓴 tool은 메시지 part `harness_tool {name, summary, status}`로만 남는다. 기록마다 `MessageRecorded`(`model_call: null`)가 나가 대화가 바로 갱신된다.
- cwd는 session workspace의 폴더다. project는 첫 폴더, 앱은 source 폴더(없으면 첫 폴더), home은 `<data root>/harness-home/<session>/`(turn 시작 때 만들고 지우지 않는다)다.

### TUI 탭과 hold

harness session은 `lophn tab open --session <ses> --tui`로 터미널 탭에서도 연다. 그 CLI의 resume 줄(`claude --resume <id>`, `codex resume <id>`, `opencode --session <id>`)을 친다. TUI 탭이 있는 동안 그 session의 headless turn은 시작하지 않는다. 이 hold는 lease다: core가 열 때 30초 예약을 걸고, shell main의 surface poller가 매 tick `host/take {workspaces, tui}`에 TUI 탭이 있는 session 목록을 실어 오면 10초로 잇고, 목록에서 빠지면 바로 푼다.

## 지키는 것

1. **CLI의 두 갈래가 섞이지 않는다.** core를 부르는 명령의 표는 하나이고 lophn agent와 binary가 같이 쓴다. `local` 명령은 core를 부르지 않는다. 예외는 `harness sync-skills` 하나다.
2. **CLI가 core에 붙는 자격이 새지 않는다.** 주소는 `LOPHN_DAEMON_URL`, 없으면 identify의 `api_url`이다. `LOPHN_DAEMON_URL`이 있으면 core를 띄우지 않고, 그 주소가 identify가 가리키는 core와 같을 때만(port 비교) connect해서 다른 server에 user token이 가지 않는다. CLI는 shell capability를 요구하지도 받지도 않는다. user token은 출력에 남기지 않고 core의 `not_found` 글은 그대로 돌려준다.
3. **`lophn core stop`은 core를 띄우지 않는다.** 도는 core가 없으면 `unavailable`(exit 5), agent 자격 안에서는 `forbidden`이다.
4. **CLI 출력은 data fence 없이 줄로 쓴다.** `--json`이면 JSON 하나다.
5. **제품 감지는 shell main이 CLI를 exec해서 한다.** core는 감지 결과를 받지 않는다. 처음 읽기는 실행 파일 찾기만 하고, 제품을 실제로 실행하는 version probe는 사람이 다시 감지를 눌렀을 때만 돈다. 사람이 시키지 않았는데 제품을 띄우지 않는다.
6. **앱의 source 폴더는 `app.create`가 commit된 뒤 core가 만든다.** 내장 template을 `<data root>/apps/<app>/source`에 깔고 첫 commit을 만든 뒤(사람의 전역 git 설정은 읽지 않고, 저장소 안에 `user.name`, `user.email`, `commit.gpgsign=false`를 남긴다) core 안 machine 자격으로 `app.connect_source`를 부른다. 폴더가 이미 있으면 덮지 않고 commit이 있을 때만 그대로 잇는다. 깔기나 잇기가 실패하면 앱은 `source_path: null`로 남는다. `app.connect_source`는 git 저장소의 맨 위이고 commit이 있는 폴더만 받는다.
7. **hook은 harness의 사용자 전역 설정에 한 번 놓고, 놓기 전에 사람에게 묻는다.**
   - 사람의 터미널에서 그 harness를 처음 알아봤을 때 shell main이 `lophn harness install`을 `dry_run`으로 불러 없는지만 보고, 없으면 놓을 file을 보여 주고 묻는다. 묻는 것은 OS 창이 아니라 그 터미널을 고른 lophn 창의 dialog이고 창의 답을 기다린다(browser bridge와 같은 request id + ack). 답하기 전에 창이 닫히거나 reload되면 거절이다. headless나 창이 없으면 묻지 않고 놓지 않는다.
   - dialog는 harness 이름, 하는 일 한 문장(상태를 보이고 turn 끝을 알린다), 쓸 file 목록이다. Codex는 `config.toml`에 hook trust도 같이 기록한다는 한 문장이 붙는다.
   - Settings › Coding agents의 [Install hooks]는 누른 것이 허락이라 묻지 않는다. 성공은 toast 하나, 실패는 무엇이 왜 실패했는지와 file을 담은 dialog로 보인다.
   - 거절은 기억하지 않고 다음에 다시 묻는다. 묻거나 놓기가 실패해도 터미널은 그대로 돈다(hook이 없어 상태가 unknown이다).
   - `dry_run`은 event마다 우리 항목이 있으면 내용이 달라도 `unchanged`라 lophn이 업데이트돼도 다시 묻지 않는다. 표에 새로 더한 event에 우리 항목이 없거나, plugin file 본문이 지금 원문과 다르면(hook command만 다른 것은 같다고 본다. 2.x용으로 바뀌기 전의 OpenCode plugin도 여기 든다) `missing`이다.
   - 개발 실행만 예외다. PATH의 `lophn`이 없거나 설치된 판이므로 `npm run dev`가 만드는 launcher(`<저장소>/.cache/dev-cli/lophn`. 설치된 `/usr/bin/lophn`과 같은 본문에 경로만 저장소 소스와 그 저장소의 Electron으로 바꾼 것)를 `LOPHN_CLI`로 shell main에 주고, shell main이 그 경로를 hook command로 넘긴다. 그때의 `dry_run`은 우리 항목의 command가 다르면 놓을 것이 있다고 본다. launcher는 `.dev-data`가 아니라 저장소의 `.cache/`에 두어 schema가 바뀌어 `.dev-data`를 지워도 전역 hook이 가리키는 경로가 남고, 실행마다 다시 쓴다. hook command 경로는 공백·따옴표·`..`가 없는 절대 경로만 받는다.
8. **Codex hook은 trust까지 같이 기록한다.** Codex는 새로 놓이거나 바뀐 hook을 사람이 `/hooks`에서 trust하기 전까지 건너뛴다. 설치가 `~/.codex/config.toml`에 lophn 항목마다 `[hooks.state."<hooks.json 경로>:<event>:<group 번호>:<handler 번호>"] trusted_hash`를 쓴다. hash는 Codex 0.164의 hook hash와 같은 계산이다: 정규화한 handler 하나, matcher, event 이름을 key 정렬 compact JSON으로 sha256한다. lophn의 표만 고치거나 끝에 더하고 나머지 byte(주석, 다른 도구의 표)는 그대로 둔다. 파싱되지 않는 `config.toml`은 건드리지 않고 `failed`다. trust 기록이 없거나 hash가 다르면 `dry_run`이 `missing`이고 file 목록에 `config.toml`이 든다. 사람의 허락은 lophn dialog 한 번이다. Codex가 계산을 바꾸면 기록이 Modified가 되어 사람이 `/hooks`에서 trust하던 때로 돌아갈 뿐이다.
9. **전역 설정은 사람의 다른 항목을 보존한다.** 어느 꼴이든 우리 항목만 바꾸고 나머지 byte(주석, 다른 도구의 항목)는 그대로 둔다. 파싱되지 않거나 고칠 수 없는 꼴이면 아무것도 쓰지 않고 `failed`다. cline은 event마다 script 하나라 사람의 script가 이미 있으면 놓지 않는다. hook이 stdout에 정해진 JSON을 내야 하는 harness(antigravity, cursor)는 CLI와 launcher가 같은 표에서 출력하고, lophn 밖에서 불려 바로 끝날 때도 같다.
10. **전역 hook은 lophn과 상관없는 harness 실행에서도 불리므로 조용히 끝난다.** lophn 터미널이 넣는 `LPN_TERMINAL_HOOK`이 없으면 launcher가 CLI를 띄우지 않고 끝나고, `lophn hook`도 stdin을 읽지 않고 아무것도 보내지 않은 채 성공한다. pi extension과 OpenCode plugin은 그 env가 없으면 hook을 등록하지 않는다. launcher는 CLI를 Electron의 Node로 띄운다(권한 flag 없음).
11. **Settings의 hook 상태는 CLI 한 번으로 읽는다.** `lophn harness status`가 모든 harness의 `install --dry_run`을 한 process에서 돌려 목록으로 낸다. 화면이 열릴 때와 창이 focus를 다시 받을 때마다 읽으므로 harness마다 process를 띄우면 25개가 한꺼번에 뜬다(CPU 약 10초).
12. **[Uninstall hooks]는 놓기의 거꾸로이고 우리 것만 지운다.**
    - 놓을 때와 같은 규칙으로 우리 항목을 알아본다(command가 `lophn hook <harness> `나 개발 경로로 시작, 표시 block, 우리 이름의 file). 사람이 우리 group에 더한 handler, 같은 이름의 사람 cline script, 다른 file을 가리키는 Muse 설정, 사람의 Hermes 승인은 남긴다.
    - 글 형식(JSONC, TOML, YAML)은 우리 줄만 지워 놓기 전 byte로 돌아가고, JSON은 놓을 때처럼 다시 직렬화한다. 우리 것만 남았던 event key와 `hooks`, 우리 이름의 file(`lophn.json`, `lophn-hooks.json`, plugin file, cline script), 비게 된 file(`{}`, 빈 글)은 지운다.
    - Codex는 우리 trust table을 지우고, 우리 group 뒤에 있던 다른 도구의 기록은 당겨진 위치의 key로 옮긴다(key가 바뀌면 Codex가 다시 trust하라고 한다).
    - 사람의 handler가 섞인 Devin 항목처럼 offset으로 안전하게 고칠 수 없거나 파싱되지 않으면 아무것도 쓰지 않고 `failed`다.
    - 누른 것이 허락이라 묻지 않고, 지운 뒤 이 실행에서는 터미널이 그 harness를 알아봐도 다시 묻지 않는다. 다음 실행에서는 거절처럼 다시 묻는다.
13. **coding agent에게 가는 skill은 사람이 승인한 앱 공유의 public skill과, harness extension이 켜졌을 때의 내장 `lophn-agent` 하나다.**
    - 읽는 것은 설정 `coding-agent.shared_apps`(앱 slug 목록. 앱 workspace의 agent가 청한 공유 요청을 사람이 coding agent까지 골라 승인할 때만 더해진다: [approval.md](approval.md))와 core read `app.skills`([app-call.md](app-call.md))다.
    - 쓰는 곳은 hook이 놓인(`unchanged`) harness의 adapter `skill_dir`(사람 home 기준)이다: Claude Code `.claude/skills`, Codex·pi `.agents/skills`, OpenCode `.config/opencode/skills`. 다른 harness는 `skill_dir`이 null이라 사본이 없다. Codex와 pi는 폴더를 같이 쓰므로 하나라도 hook이 놓였으면 둔다. hook이 없는(`missing`) harness의 폴더에서는 lophn이 쓴 사본만 지우고, hook 상태를 못 읽은 폴더(`failed`)는 건드리지 않는다. 그 폴더를 쓸 수 없으면 `unavailable`이다.
    - `lophn-agent` skill은 설정 `extensions.harness.enabled`가 켜졌으면 hook 상태와 상관없이(켜기가 사람의 허락이다) Claude Code·Codex·OpenCode의 `skill_dir`에 앱 공유 skill과 같은 표시 file로 두고, 꺼지면 그 사본만 지운다.
14. **사본은 lophn이 쓴 것만 덮고 지운다.**
    - skill 폴더마다 표시 file `.lophn-shared`(JSON `{app, release, files[]}`)를 두고, 표시가 있는 폴더만 덮고 지운다. 같은 이름의 폴더가 사람의 것이면(표시 없음) 건드리지 않고 건너뛰어 `skipped`로 알린다. 표시를 먼저 쓰므로 쓰다 멈춰도 다음에 우리 폴더로 알아본다.
    - 지울 때는 표시 file에 적힌 file만 지우고(recursive가 아니다) 비게 된 폴더만 치워, 사람이 그 안에 넣은 file은 남는다.
    - 폴더 이름은 `[A-Za-z0-9_][A-Za-z0-9_.-]*`, file 이름은 폴더 밖으로 못 나가는 것만 받는다(core가 준 값이라도 사람 home에 쓰는 일이라서다). 같은 이름을 두 앱이 내면 앞의 것(slug 순)만 쓴다. 내용이 같으면 다시 쓰지 않는다.
    - `shared_apps`에서 slug가 빠지거나 앱의 active release가 그 skill을 public으로 내놓지 않으면 `app.skills`가 주지 않아 다음 sync가 사본을 지운다. Settings › Coding agents의 공유 앱 목록에서 앱마다 Remove로 줄이고, 지우기는 쓰기 직전에 값을 다시 읽어 그 slug만 뺀다(같은 값에 승인이 덧붙는다).
15. **사본은 core가 쓰지 않고 shell main이 CLI를 exec해서 맞춘다.** core는 data root 밖을 쓰지 않는다. 맞추는 때는 넷이다: core가 준비되었을 때 한 번(준비 신호를 main이 받는 길이 없어 1초마다 상태를 보다가 starting을 벗어나 ready이면 부른다), 앱 view의 activation 신호(`AppViewChanged`의 reason `activation`. 앱을 가리지 않으므로 공유하지 않은 앱의 activation에도 돌지만 사본이 같으면 아무것도 쓰지 않는다), `SettingsChanged`의 keys에 `coding-agent.shared_apps`나 `extensions.harness.enabled`가 있을 때, hook을 놓거나 지운 뒤. 한 번에 하나만 돌고 도는 중에 온 요청은 끝난 뒤 한 번 더 돈다. 실패는 log만 남기고 부른 쪽을 막지 않는다. session 시작 hook은 core를 부르지 않으므로 쓰지 않는다.
16. **`harness uninstall`은 lophn이 쓴 사본도 지운다.** 그 harness의 skill 폴더에서 표시 있는 폴더를 치우고 지운 폴더를 출력 file 목록에 더한다. 같은 폴더를 쓰는 다른 harness의 hook이 남았으면 다음 sync가 다시 둔다.
17. **설치는 전에 놓은, 지운 skill의 얇은 사본도 지운다.** 지우는 이름은 정해 둔 목록(`lophn-build-app`, `lophn-repair`)이고 패턴이나 목록 읽기로 고르지 않는다. 폴더에 `SKILL.md` 하나뿐이고, 그 글이 lophn이 쓰던 꼴과 byte까지 같고, `dry_run`이 아닐 때만 file 하나와 빈 폴더 하나를 지운다(recursive가 아니다). 사람이 고친 사본, 다른 file이 든 폴더, 다른 이름의 skill은 남긴다. 출력의 `skill` 칸은 이 지우기만 알린다. 옛 사본이 있는 사람은 `lophn harness install`을 한 번 돌려야 지워진다.
18. **켜기는 설정 `extensions.harness.enabled`(Settings › System › Extensions, 기본 꺼짐)다.** 꺼져 있으면 extension을 load하지 않고, harness runtime session을 열지 않고(`unavailable`), 그 session으로 가는 메시지·call·step도 `unavailable`이며, 새 turn을 여는 host route(`harness/take`, `harness/start_turn`)도 `unavailable`이다. 기록·끝냄·외부 id route는 꺼져 있어도 받아, 끌 때 돌던 turn이 끝난다. 답·reaction·알림은 받아 열린 call이 닫힌다. 편집기의 runtime 고르기는 켜졌을 때만 harness 값을 내고, 이미 harness인 agent는 꺼져 있어도 그 값을 보인다.
19. **harness session의 harness는 열 때 정해 바뀌지 않는다.** runtime이 harness가 아닌 session은 외부 id를 고치지 못한다.
20. **host route는 사람 token(actor user)만, runtime이 harness인 session만 고친다.** memory route라 renderer 통로에는 없다. 재시작하면 끝나지 않은 harness turn은 interrupted(restarted)로 끝나고 늦은 FinishTurn은 `conflict`다.
21. **harness가 쓴 tool은 lophn이 실행한 것이 아니다.** gate·rewind의 tool-call chain에 들지 않는다.
22. **harness의 permission mode·sandbox는 lophn이 정하지 않는다.** 사람이 그 CLI에 해 둔 기본 설정대로 돈다. lophn이 넣는 것은 `lophn`을 부르는 길(Claude Code `Bash(lophn *)` 허락, Codex `network_access=true`)과 정의의 deny뿐이다. 정의에 deny가 있는데 옮길 수 없는 harness(Codex, opencode)는 띄우지 않고 그 turn을 `configuration_unavailable`로 끝낸다(대화에 이유 한 줄).
23. **harness는 turn 자격으로 자기 shell에서 `lophn`을 부른다.**
    - `harness/start_turn`이 그 session·그 turn에만 쓰이는 agent 자격을 내고 host가 spawn env `LOPHN_AGENT_CREDENTIAL`에 넣는다. 범위는 그 workspace 종류의 `lophn` 명령 route뿐이고(file·rewind·gate·ask route 없음) `TurnEnded`에 끝난다.
    - CLI는 그 env가 있으면 그 자격으로만 부르고 control connect를 하지 않는다. 자격이 만료되거나 거절되어도 user 자격으로 바꾸지 않는다. user token으로 `call.reply`·`call.send`는 `forbidden`이다.
    - host는 `LOPHN_CLI`가 절대 경로면 그 폴더를 PATH 앞에 두어 개발 launcher가 `lophn`이 되고, extension이 띄우는 process에는 shell main이 늘 `LOPHN_HOME`(그 shell의 data root)을 넣는다. 띄우는 env는 shell main의 것이고(harness가 자기 API key를 쓴다) lophn user token을 넣지 않는다.
24. **cwd는 session workspace의 폴더이고 폴더가 없으면 띄우지 않는다.** 폴더 없는 project·app에서는 띄우지 않는다. opencode는 spawn cwd가 아니라 그 위 git root를 작업 폴더로 쓰고 directory option이 없어(2.1.4), 폴더가 git 저장소 안이지만 그 root가 아니면 띄우지 않고 이유 한 줄로 turn을 끝낸다. 앱 source 폴더는 늘 git root라 걸리지 않는다. data root가 git 저장소 안이면 home의 opencode도 거절된다.
25. **harness session은 turn 중에 대기 메시지를 받지 못한다.** ACP `steer` capability가 꺼져 있고 send-now는 `unavailable`이다.
26. **turn의 끝은 parser의 끝 event나 exit code다.** 실패는 `model_error`, 시작하지 못하면 `target_unavailable`, 글 없이 끝나면 `no_answer`다. 사람이 멈추거나 core가 turn을 닫으면 host가 process를 끈다. 사람 메시지의 이미지는 `[image: <mime> not passed to the harness]` 글로 바뀐다.
27. **run-loop는 harness 입력을 돌리지 않는다.** 닿으면 turn을 시작하지 않고 `target_unavailable`로 닫는다. 켤 때 접수만 된 사람 메시지는 harness queue에 되돌린다.
28. **TUI 열기는 조건이 있다.** harness session이 아니거나 project workspace가 아니면 `invalid_input`(home은 터미널이 없고 앱의 headless cwd는 터미널 cwd 검사를 지나지 못한다), CLI session id가 아직 없거나(첫 turn 전) turn이 돌거나 이미 열려 있으면 `conflict`다. cwd는 session project의 첫 폴더(headless와 같은 자리)다. TUI process는 lophn 자격을 받지 않고 그 안의 turn은 lophn 기록에 없다. 다음 headless turn이 같은 CLI session을 resume하므로 agent는 기억한다.
29. **TUI 탭이 있는 동안 그 session의 headless turn은 시작하지 않는다.** hold된 session은 `harness/take`가 건너뛰고 `harness/start_turn`이 `conflict`다. 입력과 call은 queue에 남고(call은 accepted) 풀리면 다음 tick에 돈다. shell main은 탭이 창에 생긴 순간부터 그 session을 들고, CLI가 foreground에 보인 뒤 떠났을 때, 탭이 닫혔을 때, 그 창이 닫혔을 때 푼다. CLI가 끝내 안 뜨면 사람이 탭을 닫을 때까지 든다. host 터미널 탭을 `tab close`로 닫으면 PTY도 닫는다.

## 경계와 계약

경계: `coding-agent-cli`(명령 표와 binary), `coding-agent`(hook·감지·공유 skill 사본), `coding-agent-cli-interface`, `coding-agent-harness-api`, `harness-host-interface`, `external-coding-agent`(사람의 coding agent).

- **env.** `LOPHN_DAEMON_URL`(CLI가 붙을 core 주소), `LOPHN_AGENT_CREDENTIAL`(harness turn 자격), `LOPHN_AGENT_SHELL`(lophn agent의 shell.run·ACP terminal 표시. 자격이 없으면 CLI가 바로 멈춘다), `LOPHN_CLI`(개발 launcher 경로), `LOPHN_HOME`(shell의 data root), `LPN_TERMINAL_HOOK`(lophn 터미널이 넣는 hook 표지). CLI exit: success 0, internal 1, invalid_input 2, unauthorized·forbidden 3, failed 4, `unavailable` 5(transport), effect_unknown 6.
- **CLI 명령.** `lophn harness detect|refresh|install [--dry_run]|status|uninstall|sync-skills`, `lophn hook <harness> <event>`, `lophn core stop`, `lophn tab open --session <ses> --tui`, 그 밖은 core를 부르는 명령 표.
- **설정 key.** `extensions.harness.enabled`, `coding-agent.shared_apps`(앱 slug 목록).
- **core route·command.** `app.create`, `app.connect_source`, `app.skills`, harness host route(`harness/take`, `harness/start_turn`, `harness/record`, `harness/finish_turn`, `harness/set_external_id`), `host/take {workspaces, tui}`, `turns/read`, `agents/read`, `projects/get`, `apps/get`. 기존 command StartTurn, RecordMessage, FinishTurn, machine 전용 `BindHarnessSession`. event `TurnEnded`, `MessageRecorded`, `SettingsChanged`, `AppViewChanged`.
- **저장 모양.** session 행의 `harness`, 외부 session id `harness_session`(ledger step `lophn-agent.sessions.harness`). 메시지 part `harness_tool {name, summary, status}`. `<data root>/harness-home/<session>/`, `<data root>/apps/<app>/source`, harness의 사용자 전역 설정(hook), 사람 home의 skill 폴더와 표시 file `.lophn-shared`, `~/.codex/config.toml`의 `[hooks.state."…"] trusted_hash`, 개발 launcher `<저장소>/.cache/dev-cli/lophn`.
- **TUI 열기 요청.** host queue의 `tab_open`(target `{tui}`, payload `resume {harness: <adapter id>, external_session}`)을 renderer가 받아 터미널 탭(key `host:<tab>`)에 resume 줄을 친다. runtime → adapter id 대응은 한 곳에서만 정한다.
- **TUI handoff.** agent가 `tabs/open` target `{coding: {harness, handoff}}`(CLI `lophn tab open --coding <harness> --handoff <글>`)로 사람이 이어서 만질 일을 넘긴다. project workspace의 agent만, 즐겨찾기 가운데 adapter가 첫 prompt 인자 꼴(`session.prompt`)을 아는 harness만 된다. core는 글을 `<data root>/handoffs/<tab>.md`(0600)에 쓰고 payload에는 `handoff {harness, file}`만 싣는다. 창은 사람의 즐겨찾기 명령 뒤에 고정 글 "Read the handoff at <file> and continue the work it describes."만 첫 prompt로 붙여 새 터미널 탭에서 친다. 이 탭은 사람의 터미널이라 lophn session도 hold도 없다.
- **headless 명령.** harness마다 adapter 항목 하나(명령, parser, 권한 표)다. parser는 순수 함수이고 실제 녹화에서 만든 fixture로 본다(Claude Code 2.1.318, codex-cli 0.166.0, opencode 2.1.4).
  - Claude Code: `claude -p --output-format stream-json --verbose --allowed-tools "Bash(lophn *)" [--resume <id>] [--disallowed-tools …] -- <prompt>`. permission mode는 사람의 Claude Code 설정대로이고 `lophn`만 따로 허락한다(deny가 allow보다 앞선다). 정의의 deny `lophn(<slug> <command>)`는 `Bash(lophn <slug> <command>)`와 그 뒤 인자 꼴의 disallow다.
  - Codex: `codex exec --json --skip-git-repo-check -c sandbox_workspace_write.network_access=true -- <prompt>`, 이어 가기는 `codex exec resume … -- <id> <prompt>`. sandbox mode는 사람의 Codex 설정대로다. stdin 끝을 기다리므로 host가 띄우자마자 닫는다.
  - opencode: `opencode run --standalone --format json [--session <id>] <prompt>`. 권한 flag가 없어 사람의 opencode 설정대로 돌고, 그 설정이 `lophn`을 허락해야 부른다. 끝 event가 없어 process의 exit code가 끝이다.
- **내장 skill `lophn-agent`.** 받은 call의 tag 읽기, `call reply`(승인을 청하는 팀원의 call에는 `--allow`·`--reject`)·`call send`·`call cancel`, `team`, `session list`·`agent card`, `ext call`을 적고 turn 자격이 있을 때만 쓰라고 한다. `tab open --url|--preview`, `preview`, `browser snapshot → act --ref` 같은 탭 명령은 사람 token(사람의 터미널)으로도 되어 따로 적는다. 사람 token으로 연 탭의 주인은 "person"이다([workspace-layout.md](workspace-layout.md) "agent가 연 탭").
- **hook 설치 출력.** `harness install`의 출력은 event·file 목록과 상태(`unchanged`, `missing`, `failed`, `conflict`, skill 사본의 `skipped`)이고 `dry_run`은 쓰지 않고 같은 판정을 낸다.

## 결정

- **harness는 shell host가 CLI 명령으로 돌린다.** 이유: harness가 programmatic 실행을 공식으로 지원하므로 workflow와 job처럼 사람 없이 돌려도 된다. core는 사람의 PATH와 실행 파일을 모르므로 host는 shell main에 있고 core에는 route로만 붙는다. 이어 가기는 harness 자신의 session id라 TUI 열기와 다음 입력이 같은 대화를 resume한다. (사람, 2026-11-04)
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
- **hook으로 상태를 안다.** herdr는 화면을 읽어 짐작하고 orca는 hook이 없으면 title 글리프로 짐작하지만 lophn은 짐작하지 않는다. 대가: Claude Code를 Esc로 끊으면 `Stop`이 오지 않는다. 끊김 신호가 없는 harness에 한해 shell main의 터미널 상태는 사람이 친 단독 Esc·Ctrl-C를 보고 unknown으로 내린다. 끊김을 hook으로 알리는 harness(adapter의 `interrupt_keys`가 빈 것)는 이 key를 보지 않는다([terminal-agent.md](terminal-agent.md)). 버린 안: 모든 harness에서 key 판정 삭제(Claude Code가 Esc로 끊어도 Stop을 안 보낸다). (agent)
- **turn 끝 신호는 제품마다 한 event로 정한다.**
  - Claude Code `Stop`·`StopFailure`. Codex `Stop`·`Interrupt`(0.150 이상, interrupted. 0.150 미만은 끊어도 running에 남는데 표가 판을 가르지 못해 감수한다).
  - OpenCode `session.status` idle. 전역 plugin이 root session의 event만 넘기고, 뒤따르는 deprecated `session.idle`은 같은 끝이라 듣지 않는다(둘 다 들으면 `TurnEnded`가 두 번 간다). 2.x는 plugin이 `{id, setup}` default export로 event를 직접 구독하고 `session.execution.started`·`succeeded`·`failed`·`interrupted`가 `session.status` busy·idle로, `permission.asked`·`replied`는 그대로 1.x 모양으로 바뀌어 넘어가므로 shell main은 두 판을 구별하지 않는다. 2.x는 plugin을 공유 background service가 돌려 터미널 env가 닿지 않으므로 터미널이 `opencode --standalone`으로 띄운다.
  - pi `agent_settled`. pi는 `agent_end` 뒤에 retry와 compaction이 남을 수 있어 끝이 확정되는 쪽을 쓴다.
  - plugin·extension 본문은 turn 끝 payload에 마지막 assistant 답(text block만)을 `lophn_message`로 싣는다. OpenCode 계열은 completed idle에서 1.x는 `client.session.messages`, 2.x는 `ctx.session.context`로 읽고(못 읽으면 뺀다), pi는 `agent_end`의 `messages`를 기억했다가 `agent_settled`에, omp·amp는 `agent_end`·`agent.end`의 `messages`에서 뽑는다. (agent)
- **coding agent에게는 사본을 두고 lophn agent에게는 두지 않는다.** 이유: coding agent는 lophn 안에 정의가 없고 사람의 user token으로 부르므로 줄 것은 앎뿐이고, 자기 skill 폴더만 읽는다. lophn agent는 bundle을 바로 읽으면 되고([agent-definition.md](agent-definition.md)) 사본은 동기화가 틀릴 길만 늘린다. 쓸 harness는 hook을 놓은 harness로 정해, 사람이 hook을 허락한 도구에만 lophn이 파일을 둔다. core는 data root 밖을 쓰지 않으므로 사본은 CLI 쪽 코드가 core에서 읽어 쓰고 shell main이 부른다. (agent)
- **lophn이 쓴 사본에는 표시 file을 두고 그것만 덮고 지운다.** 이유: 사람 home에 쓰는 일이라 사람의 것을 건드리지 않아야 한다. (agent)
- **감지 결과는 shell main 메모리에만 두고 `refresh`일 때만 새로 감지한다.** 이유: 저장하면 표와 무효화 규칙이 늘고 PATH가 바뀌면 낡는다. 대가: shell을 다시 켜면 처음 읽을 때 감지를 한 번 더 한다. 실패한 결과는 쥐지 않아 다음 읽기가 다시 감지한다. (agent)
- **CLI 출력을 data fence로 감싸지 않는다.** 이유: 사용자 앱과 사람이 쓴 글은 공격자로 보지 않는다. 막는 것은 AI가 만든 코드와 agent의 실수, 인터넷에서 온 것이다. 줄로 풀어 쓰고 `--json`이면 JSON 하나다. (사람, AGENTS.md "속도")
- **지운 이름의 얇은 skill 사본은 설치가 정리하되 목록으로만 고른다.** 이유: 사람 home에 쓰는 일이라 byte까지 같은 것만 지운다. 옛 사본이 있는 사람은 설치를 한 번 돌려야 한다. (agent)
- **host queue는 harness queue를 일반화하지 않고 같은 꼴로 새로 둔다.** 이유: harness queue는 session마다 turn 입력을 담는 queue라 요청 종류를 실을 자리가 없다. (사람이 확인)
- **TUI는 project workspace의 session만 열고, 첫 turn 전·turn 중이면 `conflict`다. TUI hold는 탭이 있는 동안이다.** 이유: 한 CLI session에 두 process가 쓰지 않게 하려는 것이다. 열기는 core가 거르고 lease는 shell main의 poll이 잇는다. (사람이 확인, agent)
- **harness agent의 home은 session마다 빈 폴더다.** 이유: home의 전역 agent를 harness로 두면 cwd가 없어 부를 때마다 실패한다. data root 안 `harness-home/<session>/`을 turn 시작 때 만들고 지우지 않는다. opencode는 git root가 아니면 띄우지 않는다(위 지키는 것).
- **harness session은 steer를 받지 못한다.** ACP `steer` capability를 끄고 send-now를 `unavailable`로 둔다. 이유: headless process는 turn 중 대기 메시지를 받지 못한다.

## 열린 것

열린 이슈는 topic이 `coding-agent`인 이슈다.

- binary `lophn`의 help에 사람 token으로는 거절되는 명령이 보인다(`job.create`, `call.*`, `session.list`, `package.publish`는 actor가 agent만이라 `forbidden`). 사람 터미널의 coding agent에는 아직 신원이 없다. coding agent 신원과 같이 열거나 그때까지 help에서 빼거나 표시한다.
- fork한 harness session이 외부 session id를 물려받지 않아 harness 쪽 앞 대화를 잃는다. headless resume이 fork를 지원하는 harness(`claude --resume --fork-session` 등)만 id를 물려주는 방안이 있다.
- opencode agent는 사람의 opencode 권한 설정대로 돌아 shell과 폴더 밖 쓰기를 한다(사람, 2026-11-04: 이대로 둔다). 좁히려면 inline config의 `permission`을 넘긴다.
- TUI 탭 hold가 끊기는 두 틈: (1) 그 workspace를 보이는 창이 없어 요청이 host queue에서 30초 넘게 기다리면 예약이 끝나 headless turn이 시작할 수 있고 뒤에 탭이 생기면 겹친다. (2) 창 reload나 앱 재시작으로 layout에서 되살아난 TUI 탭은 생성 보고가 없어 hold되지 않는다. 한 CLI session에 두 process가 쓰면 대화 기록이 섞이거나 깨진다.
- TUI에서 `/clear` 같은 것으로 바뀐 CLI session id는 따라가지 않는다.
- 개발 경로를 놓은 뒤 packaged로 돌아가면 `command` 없는 `dry_run`이 `unchanged`라 개발 경로가 전역 설정에 남는다(개발 머신만. 항목을 지우거나 packaged에서 다시 놓는다).
- Codex 0.150 미만은 `Interrupt` hook이 없어 끊어도 running에 남는다.
