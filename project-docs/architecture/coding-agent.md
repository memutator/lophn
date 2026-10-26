# coding-agent

coding agent 연결 장치는 사람이 쓰던 coding agent(`external-coding-agent`)를 lophn이 띄우고, 상태를 알고, 메시지를 넣고, 끝을 아는 메커니즘이다. coding agent는 lophn 밖의 제품이라 lophn이 그 안을 들여다볼 수 없다. 여러 곳에 걸쳐 있다. coding(`packages/core/apps/coding/`, apps module 안)이 session 상태와 줄을 갖고, shell이 터미널을 띄우고, `coding-agent`가 제품별 표와 CLI를 갖고, Router가 call을 닫는다.

지금은 이 장치를 부르는 곳이 없다. App Engineer가 앱을 직접 짓고(`architecture/activation.md`), Router는 받는 곳이 role `coding_agent`로 풀리는 call을 `invalid_input`으로 거절하고 call 행을 쓰지 않는다(`architecture/agent-call.md`). hook, 감지, 설치는 남긴다(사람, 2026-10-26). 사람이 터미널 탭에서 자기 coding agent를 쓰는 길(`project-docs/PRODUCT.md` 6절)은 session이 아니지만, hook을 받아 터미널마다 harness와 상태를 아는 층은 같다([terminal-agent.md](terminal-agent.md)). coding session은 그 층 위에 앱, call, token, 메시지 줄을 얹은 것이다.

## 흐름

```
(지금 부르는 곳 없음) CodingTransport.start {call, app, prompt} ─▶ coding (packages/core/apps/coding)
                                │        앱마다 한 번에 session 하나. 있으면 앱의 줄에 세운다(call은 accepted로 기다림)
                                │        실행 계획(argv, env)을 짜 commit 뒤로 보낸다
                                │                     │
                                │       core-api의 Gateway frame (open / input / stop)
                                │                     ▼
                                │   shell main ── harness install dry_run ─▶ 없으면 사람에게 묻고 install ─▶ 사용자 home 전역에 hook
                                │      │  터미널 탭(PTY)에 제품을 띄움. cwd = 앱 source, env = 앱 하나 범위 token
                                │      ▼
                                │   external-coding-agent
                                │      ├─ harness hook ─▶ lophn hook <harness> <event> ─▶ shell main hook socket(터미널 key)
                                │      │                    ─▶ 터미널의 agent(탭 icon·점·알림) + core `coding_agent_terminals/hook`
                                │      ├─ message send, app 읽기, preview ──────────────┐ coding-agent-cli
                                │      └─ MCP POST /mcp: 앱 tool 목록·호출(preview만) ──┤ (token으로 인증)
                                │                                                       ▼
                                │                          core-api ─▶ coding: hook 신호를 agent event로, 상태 계산
                                │
        session 끝(터미널 exit, 띄우기 실패) ─ 그 command, 같은 tx ─▶ call을 닫고 맡긴 App Engineer
                                                                   (열린 session, 없으면 새 session)에 한 번 알린다
        App Engineer의 reply ─▶ Router ─▶ idle일 때만 PTY에 넣는다(사람이 그 탭에 focus해 있으면 풀릴 때까지 shell main이 쥔다)
```

끝나는 길마다 남는 것은 다르다.

```
끝나는 길                    session           token     call
터미널 process 끝·띄우기 실패  끝                회수      done (알림 "끝났다")
줄에서 띄우지 못함            없음              없음      failed receiver_ended (알림 "시작하지 못했다")
call cancel                  멈춤              회수      cancelled
lophn 꺼짐                   끝(PTY 안 살림)   회수      Router의 켤 때 복구가 failed lophn_restarted
```

## 지키는 것

- **coding agent가 core에 닿는 길은 CLI와 MCP endpoint 둘이고 인증은 같은 앱 하나 범위의 token이다.** token은 session이 끝나면 회수하고, 회수한 token의 새 호출은 거절한다. 다른 앱의 것은 볼 수 없다.
  - hook은 token을 쓰지 않는다. 터미널을 가진 shell main의 socket으로 가고(터미널 key, [terminal-agent.md](terminal-agent.md)), shell main이 coding 터미널의 것만 그 session으로 core에 넘긴다(`codingTerminalHook`, `packages/protocol/coding-agent/terminal-requests.ts`). hook을 터미널 하나가 받으면 사람이 연 터미널과 coding 터미널이 같은 길을 쓴다.
  - MCP endpoint(`POST /mcp`, operation `coding.mcp`)는 그 앱의 tool만 보이고, 호출은 그 앱의 지금 도는 preview로만 간다. preview가 없으면 `unavailable`이고 live 앱은 부르지 않는다([app-call.md](app-call.md)). coding agent는 자기 코드를 harness의 tool 호출로 확인하고, 사용자 data에는 닿지 않는다.
  - CLI 명령은 `message send`, `hook`, `app show`, `app preview start|stop`, `app status`, `app declaration`, `app invocations`, `app logs`, `package list|show`, `harness detect|refresh|install`이다(`CODING_CLI_COMMANDS`, `packages/protocol/coding-agent/cli-commands.ts`). release 명령은 없다. release 준비와 activation은 App Engineer의 일이다.
- **같은 CLI를 사람도 쓴다.** 명령의 `auth`는 `coding_token`, `user`, `local` 셋이다. `user` 명령(`agent run`, `tool call`, `run wait|show|cancel`, `architecture/run.md`와 `workflow start|report|stop|show`, `architecture/workflow.md`)은 `LOPHN_CODING_TOKEN`이 있으면 그것을, 없으면 `<data root>/run/user-token`(core가 켤 때 쓰는 user token, 0600)을 쓴다.
  - coding session 안에서는 coding token이 먼저다. 그래서 run과 workflow route는 앱 하나 범위의 token에는 `forbidden`이다. coding agent가 lophn agent를 부르는 길은 열지 않는다. App Engineer가 coding agent에게 맡기는 흐름이 막혀 있어 괜찮다.
  - `not_found` 글을 "현재 token으로 읽을 수 없다. 없는 대상이거나 이 앱 범위 밖이다"로 바꾸는 것은 coding token(`appScoped`)일 때만이다. user token의 `not_found`는 core의 글 그대로다.
  - user token file이 없으면 lophn이 꺼진 것이라 `unavailable`로 끝난다(exit 5). CLI가 core를 띄우지 않는다.
- **MCP 설정은 그 session의 실행 계획(argv, env)에만 싣고 사람의 전역 설정에 쓰지 않는다.** token 원문은 env `LOPHN_CODING_TOKEN`에만 있고 설정은 그 이름만 가리킨다. argv는 `ps`에 보이기 때문이다. core의 port가 아직 열리지 않았으면 MCP 없이 띄운다.
  - Claude Code: argv 끝(prompt 뒤)에 `--mcp-config <json>`. header의 `${LOPHN_CODING_TOKEN}`은 Claude Code가 env에서 편다. flag가 variadic이라 뒤의 positional을 삼켜 맨 끝에 둔다. `--strict-mcp-config`는 쓰지 않아 사람의 다른 MCP server가 남는다.
  - Codex: 실행 파일 바로 뒤에 `-c mcp_servers.lophn.url=…`, `-c mcp_servers.lophn.bearer_token_env_var="LOPHN_CODING_TOKEN"`.
  - OpenCode: env `OPENCODE_CONFIG_CONTENT`. 사람이 이미 그 env를 쓰면 이 값이 덮는다.
  - pi는 MCP가 없어 잇지 않는다. 그 밖의 harness는 첫 prompt·MCP 칸을 채우지 않아 맡길 수 없다(coding session 경로가 막혀 있어 미리 만들지 않았다).
  - MCP tool의 권한 물음은 다른 권한 물음처럼 터미널 탭에서 사람이 답한다.
- **token 원문은 저장하지 않는다.** commit 뒤에 만들어 실행 계획의 env에만 담는다. 표, 오류, log에 넣지 않고, 그래서 shell main은 이 frame을 renderer로 중계하지 않는다. token이 한 번이라도 새면 그 앱 하나가 열린다.
- **상태는 hook이 알린 event에서만 계산한다.** 화면 출력을 읽어 idle을 짐작하지 않는다. 알려 준 적이 없으면 unknown이다. program은 결정적으로만 판정한다.
- **상태는 running, waiting(권한 물음 대기), idle, unknown 넷이다.** 첫 hook이 오기 전에는 unknown이라 메시지를 넣지 않는다. turn이 끝나면 남은 권한 물음을 `cancelled`로 닫는다. 거절한 물음에는 `PostToolUse`가 오지 않아 닫지 않으면 waiting에 남고 줄이 막힌다. 메시지를 PTY에 넣지 못해도 Router는 이미 배달했다고 본 것이라 되돌릴 길이 없다. 다음 메시지만 허락한다.
- **제품 감지는 shell main이 CLI를 exec해서 하고 core는 보고를 받는다.** core는 사람의 PATH와 실행 파일을 모른다. 처음 읽기는 실행 파일 찾기만 하고, 제품을 실제로 실행하는 version probe는 사람이 다시 감지를 눌렀을 때만 돈다. 사람이 시키지 않았는데 제품을 띄우지 않는다.
- **외부 session ID는 hook이나 session 파일에서 실제로 받은 것만 쓴다.** hook이 없는 제품은 PTY를 띄웠을 때 session 시작을 알리고 ID는 비워 둔다. ID를 짐작해 채우지 않는다.
- **메시지는 idle일 때만 PTY에 넣는다.** 상태가 unknown이거나 turn 끝 신호가 없는 제품이면 넣지 않고 실패로 돌려준다. 도는 중이면 기다렸다가 turn이 끝나면 하나씩 넣는다. 사람이 그 탭에 focus해 있으면 shell main이 풀릴 때까지 쥔다. 사람의 입력과 섞이면 둘 다 망가진다. 붙여 넣기 구간으로 보내고 제출은 마지막 CR 하나로 해서 글 안의 줄바꿈이 제출이 되지 않게 한다.
- **앱의 source 폴더는 `app.create`가 commit된 뒤 core가 만든다.** writer 앞 처리(`packages/core/apps/registration/source-folder.ts`)가 내장 template을 `<data root>/apps/<app>/source`(`appDefaultSource`, `packages/protocol/apps/app-storage.ts`)에 깔고 첫 commit을 만든 뒤(사람의 전역 git 설정은 읽지 않고, 저장소 안에 `user.name`, `user.email`, `commit.gpgsign=false`를 남긴다) core 안 machine 자격으로 `app.connect_source`를 부른다. 폴더가 이미 있으면 덮지 않고, commit이 있을 때만 그대로 잇는다. 깔기나 잇기가 실패하면 앱은 `source_path: null`로 남는다. `app.connect_source`는 git 저장소의 맨 위이고 commit이 있는 폴더만 받는다.
- **앱 하나에 coding session은 한 번에 하나다.** 그동안 온 맡기기는 앱마다 줄에 세웠다가 앞 session이 끝나면 연다. 같은 source 폴더에 둘이 돌면 서로 부딪친다. 줄은 lophn이 꺼지면 비운다.
- **session의 끝은 터미널 process의 exit으로만 안다.** 제품의 `SessionEnd` hook은 끝으로 쓰지 않는다. compact로 시작한 `SessionStart`, clear로 끝난 `SessionEnd`, subagent의 hook도 session 경계가 아니라 버린다. 끝을 hook에 기대면 hook이 없는 제품이나 clear 한 번에 session을 잘못 닫는다. heartbeat가 없다는 이유로 실패 처리하지 않는다.
- **끝나는 길마다 call은 한 번만 닫힌다.** session의 끝을 아는 command(`ApplyCodingSignal`의 `terminal_exited`, 실패한 `terminal_result`)가 같은 tx에서 맡긴 call을 닫고(`closeCall`, `packages/core/apps/coding/close-call.ts`) 맡긴 App Engineer에게 고정 글로 한 번 알린다. domain event를 쓰지 않는다. 같은 끝이 다시 와도 이미 끝난 call(취소, Router가 먼저 닫음)은 닫지도 알리지도 않는다.
  - session이 있었으면 call은 `done`이다. 일을 해냈는지는 program이 판정하지 않는다. App Engineer가 coding agent의 마지막 메시지와 앱 source를 보고 정한다. 줄에서 띄우지 못한 call은 session이 없어 `failed`(`receiver_ended`)이고 다른 글("시작하지 못했다")로 알린다. "끝났다"로 알리면 일이 된 줄 안다.
  - 알림 글이 고정인 것은 writer 앞 처리가 본문 blob을 미리 준비하기 때문이다. lophn은 harness의 대화 글을 받지 않아 "마지막 메시지"는 coding agent가 `lophn message send`로 보낸 것이다. 그 메시지는 이미 따로 App Engineer에게 간다.
  - lophn이 꺼진 사이 열린 채 남은 coding call은 Router의 켤 때 복구가 `failed`(`lophn_restarted`)로 닫고 보낸 session에 한 번 알린다. coding call은 turn이 가져가는 입력이 아니라 `consumed = 0`이다. coding 쪽에 sweep을 또 두면 같은 사실을 알리는 길이 둘이 된다.
- **coding session의 place는 그 앱이고 받는 쪽은 그 앱의 App Engineer다.** 터미널은 app space의 패널 탭으로 열린다. session 끝 알림과 coding agent의 메시지가 모두 그 App Engineer로 간다. 앱마다 App Engineer가 하나라 맡긴 App Engineer와 받는 App Engineer가 같다.
- **call cancel은 session을 멈추고 token을 회수한다.**
- **hook은 harness의 사용자 전역 설정에 한 번 놓고, 놓기 전에 사람에게 묻는다.** 맡길 때와 사람의 터미널에서 그 harness를 처음 알아봤을 때 shell main이 `lophn harness install`을 `dry_run`으로 불러 없는지만 보고, 없으면 놓을 file을 보여 주고 묻는다. 묻는 것은 OS 창이 아니라 lophn 창의 dialog다. shell main이 그 터미널을 고른 창(coding 맡기기처럼 터미널이 아직 없으면 마지막으로 focus를 받은 창, detached 창 제외)에 push하고 그 창의 답을 기다리며(browser bridge와 같은 request id + ack), 답하기 전에 창이 닫히거나 reload되면 거절이다. headless나 창이 없으면 묻지 않고 놓지 않는다. dialog는 harness 이름, 하는 일 한 문장(상태를 보이고 turn 끝을 알린다), 쓸 file 목록이고 Codex는 `config.toml`에 hook trust도 같이 기록한다는 한 문장이 붙는다. Settings › Coding agents의 [Install hooks]는 누른 것이 허락이라 묻지 않는다. 허락하면 놓고, 성공은 toast 하나, 실패는 무엇이 왜 실패했는지와 file을 담은 dialog로 보인다. 거절은 기억하지 않고 다음에 다시 묻는다. 묻거나 놓기가 실패해도 맡기기는 막지 않는다(hook이 없어 상태가 unknown이고 메시지는 실패한다). `dry_run`은 event마다 우리 항목이 있으면 내용이 달라도 `unchanged`라 lophn이 업데이트돼도 다시 묻지 않는다. 표에 새로 더한 event에 우리 항목이 없거나, plugin file 본문이 지금 원문과 다르면(hook command만 다른 것은 같다고 본다. 2.x용으로 바뀌기 전의 OpenCode plugin도 여기 든다) `missing`이다. 개발 실행만 예외다. PATH의 `lophn`이 없거나 설치된 판이라, `deno task dev`가 만드는 launcher(`<저장소>/.cache/dev-cli/lophn`, 설치된 `/usr/bin/lophn`과 같은 본문에 경로만 저장소 소스·사람의 Deno와 cache로 바꾼 것)를 `LOPHN_CLI`로 shell main에 주고, shell main이 그 경로를 hook command로 넘긴다. 그때의 `dry_run`은 우리 항목의 command가 다르면 놓을 것이 있다고 본다. launcher는 `.dev-data`가 아니라 저장소의 `.cache/`에 두어 schema가 바뀌어 `.dev-data`를 지워도 전역 hook이 가리키는 경로가 남고, 실행마다 다시 쓴다.
- **Codex hook은 trust까지 같이 기록한다.** Codex는 새로 놓이거나 바뀐 hook을 사람이 `/hooks`에서 trust하기 전까지 건너뛴다. 그래서 설치가 `~/.codex/config.toml`에 lophn 항목마다 `[hooks.state."<hooks.json 경로>:<event>:<group 번호>:<handler 번호>"] trusted_hash`를 쓴다. hash는 Codex `hook_hash`(rust-v0.164.0 `codex-rs/hooks/src/engine/discovery.rs`, `codex-rs/config/src/fingerprint.rs`)와 같은 계산이다(`packages/coding-agent/harnesses/codex-trust.ts`). 정규화한 handler 하나, matcher, event 이름을 key 정렬 compact JSON으로 sha256한다. lophn의 표만 고치거나 끝에 더하고 나머지 byte(주석, 다른 도구의 표)는 그대로 둔다. 파싱되지 않는 `config.toml`은 건드리지 않고 `failed`다. trust 기록이 없거나 hash가 다르면 `dry_run`이 `missing`이고 file 목록에 `config.toml`이 든다. 사람의 허락은 lophn dialog 한 번이다. Codex가 계산을 바꾸면 기록이 Modified가 되어 사람이 `/hooks`에서 trust하던 때로 돌아갈 뿐이다. orca도 같은 기록을 쓴다.
- **전역 설정은 사람의 다른 항목을 보존한다.** 설치 위치와 꼴은 harness마다 `HARNESS_HOOKS`(`packages/protocol/coding-agent/harness-hooks.ts`)가 정하고, 설치할 event는 `HOOK_EVENT_TABLE`의 key다. 꼴은 Claude식 json settings(claude, qwen, qoder, codebuddy, command-code, droid, letta), JSONC(devin), 우리 전용 file(grok, copilot, kiro V3), flat json(cursor), 이름 붙은 hook object(antigravity), 표시한 TOML block(kimi), managed hooks file과 settings 칸(muse, `LPN_TERMINAL_HOOK`을 env 허용 목록에 더한다), 표시한 YAML block과 허용 목록 사전 기록(hermes), event마다 script file(cline), plugin·extension file(opencode·kilo·mimocode 공통 본문, pi, omp, amp)이다. prime-agent는 hook API가 없어 놓지 않는다. 어느 꼴이든 우리 항목만 바꾸고 나머지 byte(주석, 다른 도구의 항목)는 그대로 둔다. 파싱되지 않거나 고칠 수 없는 꼴이면 아무것도 쓰지 않고 `failed`다(muse에 다른 `managed_hooks_path`가 있으면 `conflict`). cline은 event마다 script 하나라 사람의 script가 이미 있으면 놓지 않는다. 설치를 하는 CLI 실행은 그 harness가 건드리는 폴더·file의 읽기·쓰기 권한만 갖는다(`hookPaths`). hook이 stdout에 정해진 JSON을 내야 하는 harness(antigravity, cursor)는 CLI와 launcher가 같은 표(`HOOK_STDOUT`)에서 출력한다. lophn 밖에서 불려 바로 끝날 때도 같다.
- **coding agent에게 배포하는 skill은 없다. 설치는 lophn이 전에 놓은 지운 skill의 얇은 사본만 지운다.** 지우는 이름은 상수 `RETIRED_SKILL_NAMES`(`lophn-build-app`, `lophn-repair`, `packages/coding-agent/harnesses/install.ts`)이고 패턴이나 목록 읽기로 고르지 않는다. 폴더에 `SKILL.md` 하나뿐이고, 그 글이 lophn이 쓰던 꼴과 byte까지 같고, `dry_run`이 아닐 때만 file 하나와 빈 폴더 하나를 지운다(recursive가 아니다). 사람이 고친 사본, 다른 file이 든 폴더, 다른 이름의 skill은 남긴다. 사람 home에 쓰는 일이라서다. 출력의 `skill` 칸은 이 지우기만 알린다. 지금은 coding session을 여는 길이 없어 설치가 저절로 돌지 않으므로, 옛 사본이 있는 사람은 `lophn harness install`을 한 번 돌려야 지워진다.
- **전역 hook은 lophn과 상관없는 harness 실행에서도 불린다.** lophn 터미널이 넣는 `LPN_TERMINAL_HOOK`이 없으면 launcher가 deno를 띄우지 않고 끝나고, `lophn hook`도 stdin을 읽지 않고 아무것도 보내지 않은 채 성공한다. pi extension과 OpenCode plugin은 그 env가 없으면 hook을 등록하지 않는다. launcher는 `hook`에만 그 env 읽기와 env가 가리키는 socket 경로의 읽기·쓰기를 준다(launch entry를 거치면 hook마다 deno가 두 번 뜬다).
- **첫 prompt는 argv의 한 인자로 넘기고 shell을 거치지 않는다.** quote나 escape를 조합하지 않는다. prompt는 lophn이 붙이는 고정 줄(앱 id, 연결된 source에서 일한다, 선언(`lophn.ts`)이 정본이라 필요하면 코드보다 먼저 직접 고친다, 막히거나 끝나면 `lophn message send`로 알린다)과 `<assignment>`로 싼 맡긴 글(call 본문)이다(`firstPromptOf`, `packages/protocol/coding-agent/launch-plan.ts`). token은 싣지 않는다. argv로 못 넘기는 제품은 session 시작 hook을 받은 뒤 붙여 넣고, 기한이 지나면 넣지 않는다.
- **coding agent의 권한 mode는 lophn이 정하지 않는다.** harness의 권한 물음은 대기 목록에 보이기만 하고 답은 터미널 탭에서 한다. 대기 목록에서 누르면 그 탭으로 focus가 옮겨 간다.
- **coding 탭은 `BROWSER`(browser bridge)를 받지 않는다.** app space 패널에는 browser 탭을 열 pane이 없다. coding agent가 연 URL과 그 탭의 Ctrl/Cmd-click link는 OS browser로 간다([browser-tab.md](browser-tab.md)).
- **터미널을 열고 첫 hook 신호가 없는 coding session은 대기 목록에 "터미널에서 확인이 필요할 수 있다"로 보인다.** Claude Code는 처음 여는 폴더마다 folder trust를 묻고, 고를 때까지 hook이 돌지 않는다. 그래서 첫 신호가 `SessionStarted`인 harness의 coding session이 5초(`STARTING_QUIET_MS`) 안에 신호가 없으면 shell renderer가 항목(`coding_start`)을 넣는다(`packages/shell/renderer/desktop/connection/events/waiting-store.ts`). 세는 길은 둘이다. 터미널을 연 창은 runtime(`TerminalApi.onRuntime`)으로, 뒤에 연 창이나 다시 붙은 창은 snapshot에서 `unknown`이고 SessionStart가 있는 harness인 coding session으로 센다. 어느 길이든 delay와 지우는 조건은 같고, snapshot에서 첫 신호를 들은 session은 다시 세지 않는다. 누르면 그 탭으로 focus가 간다(detached 창의 탭이면 그 창을 앞으로 가져온다). 첫 신호(`SessionStarted` event), `SessionEnded`, 터미널 exit·unknown, 또는 snapshot에서 신호를 들은 session이면 지운다. lophn은 trust 화면을 알아보려고 화면 글자를 읽지 않고, 대신 답하지 않으며, `~/.claude.json`을 쓰지 않는다.
- **lophn이 꺼져도 PTY를 살려 두지 않는다.** 외부 session resume도 없다. 켤 때 끝나지 않은 session 행은 끝으로 표시하고 줄과 대기 입력을 비운다(`recoverCoding`).

## 왜 이 모양인가

- **App Engineer가 coding agent에게 맡기는 흐름을 막았다.** 앱과 그 앱에 필요한 context(사람의 말, domain, 앱 log와 기록)는 App Engineer가 훨씬 잘 닿고, 맡기며 넘기는 문서(ticket)가 context를 잃었다. 개인 앱은 작아 App Engineer가 직접 지어도 된다. 장치는 지우지 않았다. 뒤에 workflow에서 coding agent 같은 다른 harness를 불러와야 할 수 있어 크기는 그때 정한다.
- **coding session의 끝을 domain event로 두지 않는다.** 끝을 아는 command가 같은 tx에서 call을 닫을 수 있다. 예전에는 완료 보고, claim 만료, 보고 없는 끝이 따로 event였고 Reactor handler가 닫았다. ticket을 지워 셋이 "맡긴 call이 닫혔다" 하나가 됐다.
- **통로는 CLI와 앱 tool용 MCP 하나.** lophn 기능 전체를 내던 옛 MCP server와 toolset은 지웠고 되살리지 않는다. 지금 MCP endpoint는 앱 tool을 preview에서 부르는 데만 쓰고, 나머지(메시지, 앱 읽기, preview, hook)는 CLI다. 앱 tool은 harness가 tool로 부르는 것이 자연스럽고 선언이 이미 MCP tool 모양이라 MCP로 냈다. hook도 같은 CLI의 명령이지만 core가 아니라 터미널을 가진 shell main에 간다. 사람이 연 터미널은 core가 모르고 token도 없다. orca(hook script가 loopback POST), emdash(loopback POST, env token), paseo(터미널마다 env token), herdr(unix socket)도 터미널 쪽이 받는다.
- **hook으로 상태를 안다.** herdr는 화면을 읽어 짐작하고 orca는 hook이 없으면 title 글리프로 짐작하지만 lophn은 짐작하지 않는다. 그 대가로 Claude Code를 Esc로 끊으면 `Stop`이 오지 않는다. shell main의 터미널 상태는 사람이 친 단독 Esc·Ctrl-C를 보고 unknown으로 내리지만([terminal-agent.md](terminal-agent.md)), core의 coding session 상태에는 아직 그 규칙이 없어 running에 남는다. turn 끝 신호가 있는 제품은 Claude Code `Stop`·`StopFailure`, Codex `Stop`·`Interrupt`(0.150 이상, interrupted), OpenCode `session.status` idle(전역 plugin이 root session의 event만 넘긴다. 뒤따르는 deprecated `session.idle`은 같은 끝이라 듣지 않는다. 2.x는 plugin이 `{id, setup}` default export로 event를 직접 구독하고 `session.execution.started`·`succeeded`·`failed`·`interrupted`가 `session.status` busy·idle로, `permission.asked`·`replied`는 그대로 1.x 모양으로 바뀌어 넘어가므로 core는 두 판을 구별하지 않는다. 2.x는 plugin을 공유 background service가 돌려 터미널 env가 닿지 않으므로 터미널이 `opencode --standalone`으로 띄운다), pi `agent_settled`다. pi는 `agent_end` 뒤에 retry와 compaction이 남을 수 있어 끝이 확정되는 쪽을 쓴다. plugin·extension 본문은 turn 끝 payload에 마지막 assistant 답(text block만)을 `lophn_message`로 싣는다. OpenCode 계열은 completed idle에서 1.x는 `client.session.messages`, 2.x는 `ctx.session.context`로 읽고(못 읽으면 뺀다), pi는 `agent_end`의 `messages`를 기억했다가 `agent_settled`에, omp·amp는 `agent_end`·`agent.end`의 `messages`에서 뽑는다.
- **hook을 앱 폴더가 아니라 전역에 한 번 놓는다.** 열 때마다 앱 폴더에 놓으면 앱 source에 harness 설정이 섞이고(release 제외 목록이 따라온다), 사람이 고친 file을 지키려고 hash 기록이 필요하다. 전역에 한 번 놓고 사람에게 묻는 쪽이 단순하다. 감지 표는 orca, emdash, herdr 가운데 둘 이상이 지원하는 25종이다(`HARNESS_IDS`). Gemini CLI는 Google이 Antigravity로 옮겨 지웠고 OpenClaw는 지원하는 곳이 없어 지웠다.
- **CLI 출력을 data fence로 감싸지 않는다.** 사용자 앱과 사람이 쓴 글은 공격자로 보지 않는다(AGENTS.md). 줄로 풀어 쓰고 `--json`이면 JSON 하나다.
- **busy 실패 대신 줄에 세운다.** 바쁨으로 돌려주면 다시 맡길 때를 보낸 쪽이 알 길이 없다. 앞 session의 끝은 앞 일을 맡긴 session으로 간다.
- **worktree로 나눠 session 여럿을 돌리지 않는다.** 합칠 쪽이 없다.
- **harness의 권한 물음에 lophn 화면으로 답하지 않는다.** 제품마다 물음의 모양이 달라 그 UI를 두면 쓸데없이 깨지기 쉬운 의존이 생긴다. focus를 옮기는 것은 제품과 상관없다.
- **첫 신호 대기는 core가 아니라 shell renderer가 센다.** core는 터미널이 열린 때 event를 내지 않고 시계를 밀 수 없어 delay를 걸지 못한다. shell은 terminal runtime을 이미 받고, "첫 신호"의 근거는 core의 `SessionStarted` event와 snapshot 하나뿐이다. snapshot이 coding session의 harness를 싣는 것은 뒤에 연 창이 runtime을 받지 않아 harness를 달리 알 길이 없어서다.
- **상태와 call 닫기를 같은 transaction에서 고친다.** session 상태가 writer 쪽 표에 있고 상태를 고치는 일이 call 닫기와 한 transaction이어야 하므로, hook, 터미널 결과, 메시지가 모두 command 하나로 writer에 들어간다.
- **사람은 coding agent와 직접 이야기하지 않는다.** 사람은 App Engineer에게 청하고, coding agent가 사람에게 말을 거는 길은 없다. 막히면 App Engineer에게 메시지를 보낸다. 닫혀 있으면 그 앱의 새 App Engineer session이 받는다.
- **메시지의 답은 App Engineer가 `call`로 보내야 터미널에 간다.** App Engineer가 `to:{session:"<봉투의 coding agent session>"}`, `reply:"conversation"`으로 `call`하면 Router가 열린 coding session을 `open_session`으로 풀고 transport가 PTY에 넣는다. 글로만 답하면(사람에게 한 요약 포함) coding agent는 받지 못한다. 그래서 coding agent가 보낸 call의 봉투가 이 길을 한 줄로 알린다([agent-call.md](agent-call.md)). core는 글을 대신 보내지 않는다. 답할지, 무엇을 답할지는 App Engineer가 정한다.
