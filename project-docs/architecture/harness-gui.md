# harness-gui

lophn 터미널 탭에서 `claude --gui`(`codex --gui`, `opencode --gui`, `omp --gui`, `agy --gui`)를 치면 그 탭이 채팅 화면으로 바뀌고, 탭 머리의 toggle로 같은 대화를 GUI와 그 CLI 자신의 TUI 사이에서 오간다. `--gui`는 `--` 앞의 어느 위치에 와도 인식하며 함께 준 CLI flag(예: `--dangerously-skip-permissions`, `--model`, `--effort`, `--add-dir`, `--auto`, `--full-auto`, resume 인자 등)도 GUI와 GUI↔TUI 전환에 같이 적용된다. 뒤에서는 사람이 설치하고 로그인한 그 CLI가 돌고, extension `harness-gui`의 adapter가 CLI의 이벤트를 lophn ACP 갱신으로, 화면의 ACP 입력을 CLI 호출로 옮긴다. 화면은 lophn 채팅 화면이 ACP만 보고 그린다. 그 session은 CLI 자신의 session이고 대화는 lophn ledger에 옮기지 않는다. project 터미널의 GUI 탭은 lophn 팀원이다: 다른 agent가 부르고 그 탭이 자기 이름으로 부른다(아래 "팀원").

구현 쪽 참고(어느 file이 무엇을 하는지, CLI별 호출 세부)는 harness-gui skill의 reference에 있다.

## 문제

Claude Code, Codex, OpenCode, omp, Antigravity(`agy`)는 터미널 TUI로 쓴다. 사람은 같은 CLI의 대화를 lophn 채팅 화면(승인 카드, subagent, todo, 사용량, rewind 같은 칸이 있는 화면)으로 보고 싶고, 필요하면 다시 CLI 자신의 TUI로 돌아가고 싶다. 이 메커니즘이 없으면 두 가지를 잃는다.
- 사람이 CLI에서 하던 일(model·mode 바꾸기, 명령, rewind, fork, resume, `!` shell)을 채팅 화면에서 할 수 없고, 화면을 CLI마다 따로 짜야 한다.
- GUI와 TUI가 서로 다른 대화가 되면 사람은 어느 쪽이 진짜인지 잃는다. 사람의 CLI 설정과 login, session은 그 CLI의 것인데 lophn이 대신 쥐면 어긋난다.

## 목표와 비목표

- 목표: 그 CLI에서 되는 채팅 기능은 GUI에서도 된다(기준은 각 데스크톱 앱). 같은 대화를 GUI와 TUI 사이에서 오간다. 화면은 lophn agent와 같은 하나를 쓴다. 긴 session도 workspace를 오가거나 창을 다시 load해도 멈추지 않는다.
- 비목표: 
  - GUI 대화를 lophn ledger에 옮기지 않는다. CLI 자신의 session이다. project 탭의 팀원 session에는 turn의 경계와 받은 입력, 받은 result call에 답한 글만 남는다(사람이 친 글과 tool 내용은 남기지 않는다).
  - lophn project가 아닌 폴더에서도 돈다(친 그 폴더에서).
  - TUI 화면을 긁지 않는다. 각 CLI의 공식 GUI 경계를 쓴다.
  - 사람의 CLI 설정 file을 바꾸지 않는다.
  - lophn 밖 터미널과 Home workspace의 터미널은 다루지 않는다.
  - Windows에서 toggle은 없다(TUI 끄기 signal이 없다).

## 모델

**탭 하나가 handle 하나다.** 탭에서 `<harness> gui`를 치면 extension이 ACP session handle 하나를 열고 adapter를 시작한다. handle의 `id`(`win_…`)는 lophn session id가 아니다. handle은 adapter가 publish한 갱신을 접은 ACP 상태 하나만 쥔다. 탭의 view는 `gui`와 `tui` 둘이다.

```
탭 ── view: tui ◀──toggle──▶ gui
        │                      └ handle(접은 ACP 상태) ◀─ publish ─ adapter(run) ◀─▶ CLI process
        └ PTY의 CLI TUI (사람의 CLI)
```

**handoff 둘.** adapter는 GUI와 TUI를 어떻게 오가는지가 둘 중 하나다.
- restart(Claude Code, omp, Antigravity): 한 번에 한쪽 process만 산다. 넘길 때 앞 process를 끄고 같은 CLI session id로 다른 쪽을 띄운다. 돌던 turn과 background task, 줄에 선 입력은 modal로 알리고 확인받는다.
- shared(Codex, OpenCode): 탭 전용 server를 띄우고 GUI와 TUI가 같은 server에 같이 붙는다. 넘길 때는 보이는 쪽만 바뀐다. 그냥 `codex`·`opencode`로 시작한 TUI(server에 안 붙은 것)는 GUI로 처음 넘길 때 한 번 restart처럼 넘긴다. shared 대화의 CLI session id가 바뀌면(fork, `/new`, fork하는 rewind) 붙은 TUI client만 끄고 새 id로 다시 붙인다.

**열기.**
```
`<harness> gui` ─ 터미널 함수가 그 탭의 hook endpoint로 요청 ─ core가 key로 터미널을 찾는다
  ─ core 안 extension host의 extension이 handle을 열고 adapter를 시작(그 탭에 TUI가 돌면 먼저 끈다)
  ─ core가 handle을 그 터미널에 쥐고 view를 gui로 둔다 ─ StateChanged{coding_sessions}
  ─ 그 터미널을 그린 화면(desktop 탭, 폰)이 coding_sessions/list의 view를 보고 채팅 화면으로 바꾼다(창의 답을 기다리지 않는다)
```
터미널이 끝나거나 다시 시작하면 handle을 닫는다. `harness-gui`는 본체에 기본으로 늘 켜지는 내장(`builtin: true`) extension이라 별도 설치나 켜기 설정이 없다. handle은 창과 상관없이 core에 있어 창이 없어도 열리고 앱을 Quit해도 산다.

**toggle.**
- GUI→TUI: restart는 돌던 turn을 멈추고 process가 끝난 뒤 handle을 닫고 PTY에 그 CLI의 TUI 명령(GUI에서 고른 model·mode 같은 값을 실은 resume)을 친다. shared는 TUI client가 foreground에 없을 때만 TUI 명령을 친다.
- TUI→GUI: restart는 TUI를 끄고 새 handle과 resume으로 연다. shared는 view만 바뀐다.
- run의 model·effort·mode는 터미널마다 메모리에 들고 있다가 같은 터미널의 다음 run(resume, TUI→GUI, `<harness> gui`를 다시 칠 때)에 넘긴다. TUI에서 바꾼 값은 읽지 못하고 core를 다시 켜면 잃는다.

**화면.** 탭의 GUI view는 lophn 채팅 화면이다. core route로 붙는다: `acp/snapshot`으로 접은 상태 하나를 읽고 이어서 `AcpUpdated`를 받아(core가 handle마다 20ms 모아 낸다) 접은 상태로 그린다. GUI source는 adapter의 capability·명령 표·model 축·mode를 그대로 내고 화면은 없는 기능의 칸을 숨긴다.

**화면이 보는 coding session.** desktop 탭과 폰이 같은 core route로 이 대화를 보고 답한다. 폰은 lophn agent와 같은 화면과 승인·질문 card를 쓴다. handle, adapter, CLI는 core의 것이고(extension host와 PTY host가 core의 자식이다) 사본은 없다.
- **내보내기.** core가 handle마다 붙어 snapshot을 먼저 받고 이어서 20ms 묶음의 update를 받는다. update는 제품 redactor를 지나 하나씩 `AcpUpdated`로 나가고, handle이 열리거나 닫히면 `StateChanged{coding_sessions, id: session}`이 화면에게 snapshot을 다시 읽게 한다. 알려진 secret을 아직 다 모르면 update를 내지 않고 다시 읽게 한다. session id는 `ses_<터미널 ULID>`(`guiSessionId`, protocol)이고 ledger에는 행이 없다.
- **읽고 보내기.** `acp/snapshot`은 handle의 상태에서 tool 본문을 빼고 redactor를 지난 것이다(알려진 secret을 아직 다 모르면 `unavailable`). `acp/send`는 입력 전체를 그대로 handle에 넘긴다(`acp.md`). 승인 card의 `decide`도 ACP 입력이라 handle로 가고 core의 turn request는 건드리지 않는다. 결과는 adapter가 내는 update로 돌아온다. handle이 없으면 `not_found`다.
- **본문과 그림.** 펼친 tool 줄의 본문은 `acp/tool_body {session, tool_call, part}`로 읽는다. core가 handle에서 읽어 같은 redactor로 거른다. 붙인 그림은 `acp/image_upload`가 그 탭의 임시 폴더에 쓰고 경로를 준다. 화면은 그 경로의 `file://` resource_link를 message에 싣는다. 대화의 그림 link는 `acp/image_read`로 그 폴더 바로 아래의 그림만 읽는다. desktop과 폰이 같은 route를 쓴다. handle이 없는 session은 `not_found`다.
- **목록.** `coding_sessions/list`는 `{sessions}`다. 줄은 core의 tracker가 아는 터미널 coding agent(`terminal-agent.md`)와 GUI handle로 만든다(GUI view는 handle의 turn과 pending이 상태다). 줄마다 view(`gui`|`tui`), handoff, `switch`(null이면 바꿀 수 있고, 아니면 이유 `no_session`·`not_running`·`unsupported_os`)가 있다. desktop 탭도 이 목록의 view로 GUI와 xterm 가운데 무엇을 그릴지 정한다.
- **지난 session과 rewind 미리보기.** `coding_sessions/cli_sessions`와 `coding_sessions/rewind_preview`가 adapter의 선택 읽기를 낸다. desktop 탭만 쓴다(기기 route 목록에 없어 폰은 그 칸을 capability로 숨긴다).
- **view 바꾸기.** TUI→GUI는 도는 CLI를 끝내고 다시 띄워 도는 turn이 끊기고 그 터미널을 그린 모든 화면이 chat 화면으로 바뀐다. GUI→TUI는 도는 turn과 background task와 줄 선 메시지가 멈춘다. 그래서 `coding_sessions/switch_plan`이 무엇이 멈추는지 말하고, 사람이 확인한 뒤에만 `coding_sessions/switch`를 부른다. `confirmed: true`가 없으면 `invalid_input`이다. 사람이 본 `stops`를 같이 실어 보냈는데 그 사이 멈출 일이 달라졌으면 `conflict`(`details.reason: stale_plan`)로 거절한다. 같은 `key`는 한 번만 바꾼다. desktop 탭 머리의 toggle도 같은 route다. 거절은 그 code와 `details.reason`(`no_session`·`not_running`·`unsupported_os`·`failed`·`stale_plan`)이다.
- **열기.** `coding_sessions/open {project, harness, agent?, resume?, key}`는 컴퓨터에 coding session을 새로 열거나 저장된 harness agent session을 이어 연다. harness는 GUI harness 가운데 하나다. `agent`를 주면(project workspace만, `resume`과 함께 쓰지 않는다) 그 custom harness agent 프로필의 팀원 session(`harness_gui = 1`)을 미리 만들어 연 터미널에 묶고, GUI handle이 설 때 그 agent 정의의 `harness_config`·`permissions.deny`를 싣고 `coding_sessions/list`에 `agent`·`agent_name`을 낸다(사람이 직접 연 탭이라 turn이 끝나도 자동으로 닫지 않는다). `resume`은 그 project의 ledger harness agent session이다(그 CLI session id는 core가 싣는다). core는 그 session이 그 harness의 것인지, 저장된 CLI session이 있는지, 같은 CLI session이 이미 터미널에 열려 있지 않은지, TUI가 hold하거나 background turn·handle이 살아 있는 session이 아닌지를 먼저 보고(`not_found`·`invalid_input`·`conflict`), GUI handler가 아직 준비되지 않았으면 터미널을 열지 않고 `unavailable`이며, 그 project에 새 터미널을 열어 사람이 치는 것과 같은 `<harness> --gui [--resume <id>]`(Settings › Coding agents에 저장한 command·flag가 있으면 함께 적용)를 친다(hook → handle의 같은 길). 그 project를 보이는 창이 있으면 탭으로도 보인다. 창이 없어도 열린다. 답은 친 뒤 바로 그 터미널의 session이고, handle은 CLI가 뜬 뒤에 선다(폰은 `StateChanged{coding_sessions}`마다 snapshot을 읽어 1분까지 기다린다). 이어 연 session은 그 터미널이 끝날 때까지 hold해 background 실행기가 같은 CLI session에 둘째 process를 띄우지 않는다.

**팀원.** project 터미널의 GUI 탭은 lophn 팀원 session 하나다(Home과 앱 workspace의 탭은 아니다). 다른 agent가 `session list`에서 보고 call을 보내며, 그 탭의 CLI가 그 session의 agent로 `lophn`을 부른다.
```
GUI handle이 CLI session id를 알림 ─ core(terminal-agents/member) ─ 같은 project·harness·CLI session의 열린 팀원? ─ 있으면 잇고 없으면 harness/open_member
call·reply·알림 ─ Router(transport harness) ─ harness queue ─ 탭이 쉬고 줄 선 것도 turn을 기다리는 메시지도 없으면
   ─ 하나를 꺼내 StartTurn(ledger) ─ ACP send(lophn tag로 싼 글) ─ 그 message id를 가져간 ACP turn에 ledger turn을 묶음
   ─ turn 끝 ─ result call이면 마지막 agent 글을 RecordMessage ─ FinishTurn ─ core의 자동 답(custom-reply)이 reply
            └ 답 글 없이 끝남(멈춤, 실패, handle 닫힘, 30초 안에 turn이 열리지 않음) ─ harness/fail_call ─ 보낸 쪽에 receiver_ended
묶인 탭이 없는 팀원에게 입력 ─ core가 그 project에 터미널을 열고 `<cli> --gui [--resume <CLI session>]` ─ 그 handle이 서면 그 팀원으로 묶음
```
- **session.** ledger session 행 하나다. agent는 그 harness의 내장 coding agent(`coding_<harness>`), workspace는 그 탭의 project, `harness`는 그 CLI(다섯 모두), `harness_gui`가 켜져 있다. 묶음(session↔터미널)은 core 메모리이고 터미널이 끝나면 풀린다. session은 열린 채 남는다. CLI session id가 바뀌면(fork, `/new`) 같은 session에 새 id를 적고, 새 터미널에서 같은 CLI session을 resume하면 그 session을 잇는다.
- **queue.** 팀원 session(`harness_gui = 1`)의 harness queue는 그 GUI 탭만 가져간다. background 실행기는 건너뛰고 `tabs/open --tui`는 거절한다.
- **turn 자격.** 탭의 CLI env에는 secret이 아닌 `LOPHN_AGENT_CREDENTIAL_FILE` 경로가 있다(per-run 폴더 안 0700 `credentials/`의 터미널마다 file). core가 그 탭의 turn마다(사람이 친 turn도) 그 turn의 자격을 0600으로 쓰고 turn이 끝나면 지우고 자격을 끝낸다. 넣은 입력의 turn은 ledger turn의 자격이고, 사람이 친 turn은 ledger turn 없이 자격만 낸다. CLI는 file이 비었으면 사람 자격으로 바꾸지 않고 `unauthorized`다. 사람이 GUI에서 `!`로 친 명령은 그 file 없이 돌아 사람 자격이다(adapter가 띄우면 비운 env, CLI·server가 띄우면 맨 앞 `unset …; `. fish는 `unset`을 몰라 그 shell의 `!`는 실패한다). turn 자격은 누가 했는지를 남기는 것이지 가두는 것이 아니다: coding agent는 사람의 shell을 가져 변수를 지우면 사람 자격을 얻는다(background 실행과 같다).
- **받은 메시지로 그림.** core가 넣은 send(글이 lophn tag)는 adapter가 사람 메시지로 내도 입구가 받은 메시지로 바꾸고 CLI message id(rewind 시점)를 붙이지 않는다.
- **띄우는 옵션.** 팀원 탭과 background 실행 모두 adapter가 `lophn`을 부를 길을 연다: Claude는 `Bash(lophn *)` 허락과 정의의 deny, Codex는 app-server에 sandbox network 허락. Agent 정의의 `harness_config`(model·options)는 `launch` 번들로 넘겨지며 우선순위는 명시적 CLI flag(`args`) > 이전 run `carry` > `launch` > CLI 기본값이다.
- **열기.** 묶인 탭이 없는 팀원(탭을 닫았거나 core가 다시 켜졌거나, project에서 부른 내장 coding agent의 새 session)에게 입력이 오면 core가 그 project에 터미널을 열어(팀원 session에 `worktree_id`가 묶여 있으면 해당 worktree 경로와 환경 변수로, [worktree.md](worktree.md)) CLI session을 resume하거나 새로 띄운다. 열지 못하거나 60초 안에 GUI가 서지 않거나 GUI 전에 터미널이 끝나면 기다리던 call을 실패로 돌려준다. 늦게 서는 터미널은 끝날 때까지 그 팀원의 것이라 둘째 탭을 열지 않는다. 묶인 탭이 restart harness의 TUI를 보이는 동안은 새로 열지 않고 기다린다.
- **background 모드.** 터미널 없는 실행(`terminal: null`, `harness_gui = 0`)도 같은 다섯 상주 어댑터 계약을 그대로 쓴다. `fetchCatalog`로 model·option 축을 조회해 `HarnessCatalogManager`에 캐시하고, 열린 탭이나 background handle이 model 목록을 받을 때마다 passive warming으로 캐시를 갱신한다.
- **닫기.** core가 연 터미널은 project마다 한꺼번에 8개까지 일한다(GUI를 띄우는 중이거나 turn이 도는 탭만 센다. 쉬는 탭과 사람이 연 탭은 세지 않는다). 아홉째가 필요한 입력은 자리가 날 때까지 줄 서고(30분 안에 나지 않으면 실패로 돌려준다), 자리는 turn이 끝나거나 터미널이 끝나면 난다. core가 call을 받으려고 연 탭은 그 turn이 끝나고 queue가 비면 닫는다. 답을 기다리는 열린 call이 있거나 도는 workflow step을 맡은 session의 탭은 닫지 않는다(닫으면 답이 올 때마다 `--resume`으로 다시 띄운다). `team spawn`으로 열린 팀원(팀 상한이 따로 있다)과 사람이 그 탭에서 turn을 돌렸거나 터미널에 친 탭은 두고, 사람이 연 탭은 닫지 않는다. session은 남아 다음 call에 다시 열린다.
- **끝내기.** 사람이 사이드바 Recent에서 그 터미널 coding session 줄을 지우면(`coding_sessions/forget`) 그 팀원 session을 보관한다.
- **보이기.** 팀원 session은 그 터미널 탭이 자리다. 화면의 session 목록·snapshot·event, 앱의 session 목록, attention, Agent 탭 열기에는 나오지 않는다. agent가 읽는 `session list`·`team read`에는 그 탭의 상태(사람의 승인을 기다리면 waiting)와 제목으로 서고, 묶인 탭이 없으면 idle이다.

**adapter 다섯의 모양.**

| harness | 붙는 경계 | handoff | TUI 끄기 |
|---|---|---|---|
| Claude Code | Agent SDK(streaming input, 사람 PATH의 `claude`) | restart | SIGINT를 0·300·900ms에 보내고 foreground가 끝나기를 기다림 |
| Codex | `codex app-server`(탭 전용 unix socket, WebSocket) | shared | PTY에 Ctrl+C를 700ms 간격으로 최대 넷 |
| OpenCode | `opencode serve`(탭 전용, HTTP·SSE, 판 2.1.4 녹화) | shared | PTY에 `/exit`와 Enter |
| omp | `omp --mode rpc-ui`(RPC, 18.8.7 기준) | restart | SIGTERM |
| Antigravity | `agy acp`(ACP stdio JSON-RPC, 1.5.9 녹화) | restart | PTY에 Ctrl+C를 400ms 간격으로 최대 넷 |

adapter마다 다른 설계는 이렇다. CLI 호출 이름은 reference에 있다.
- **Claude Code**
  - 새 session은 미리 정한 id로 열어 첫 turn 전에 CLI session id를 안다.
  - permission mode는 넘기지 않는다(사람 설정, 첫 turn 전에는 사람의 Claude 설정의 기본 mode를 보인다). `bypassPermissions`는 쓰지 않는다.
  - 승인 카드: "이 session 동안"은 SDK 제안의 저장 위치를 그 session으로 바꿔 돌려주고(그대로면 그 폴더의 local 설정 file에 영구히 적힌다), always는 제안이 session 밖을 가리킬 때만 영구라고 내놓는다. 이 session의 규칙과 폴더는 다시 열 때 넣는다.
  - 도는 중 보낸 메시지는 CLI의 queue에 선다. steer는 보낼 때의 priority가 `next`일 때만이다(`later`·`now`는 늘 다음 turn). 줄의 항목은 priority를 들고 있어 고치기·옮기기가 그대로 다시 넣는다. SDK mode의 CLI는 TUI와 달리 도는 foreground tool을 스스로 background로 옮기지 않으므로, steer를 넣고 root에서 3초 넘게 돈 Bash·PowerShell·Agent·Task를 tool_use id로 background로 보낸다(Claude desktop과 같다). 지금 보내기는 도는 그 tool들을 바로 background로 보낸다.
  - rewind는 파일 되돌리기와 transcript를 잘라 새 session으로 다시 열기다. 잘린 구간은 숨기고 새 `cli_session`을 낸다. `!`는 adapter가 직접 shell을 돌려 tool item으로 그리고, 끝나면 CLI에 사람 메시지(`shouldQuery: false`)로 넣는다(Claude 데스크톱 앱과 같다).
  - SDK mode의 CLI는 todo tool flag가 있어야 TaskCreate 같은 todo tool을 낸다. adapter가 flag를 켜고 그 결과를 `plan_changed`로 낸다.
  - 사용량·비용은 다시 열 때 transcript에서 되살린다. 합칠 때 같은 API 메시지의 중복은 뺀다. 저장되지 않은 session(첫 메시지 전의 TUI)은 resume하지 않고 같은 id로 새 session을 연다. 다시 열 때 사람 메시지의 그림(transcript에 base64로만 남는다)은 탭의 임시 폴더에 새 이름으로 다시 써서 live와 같은 `file://` link로 싣는다. 쓰지 못한 그림은 `[image]` 한 줄로 남는다. `/` 목록에 `remote-control`(`rc`)을 두지 않는다.
  - CLI가 끝나면(`dead`) 다음 send는 같은 session id로 다시 열어 그 메시지를 넣는다. 못 열면 실패한 turn이다.
  - 상위 session 표지를 지우면 CLI가 transcript의 entrypoint를 `sdk-cli`로 쓴다. 그래서 programmatic 밖 session 목록에는 GUI session이 없고 resume은 id로 한다.
- **Codex**
  - sandbox와 승인 정책은 사람 설정이 `never`이거나 `danger-full-access`일 때만 `on-request`·`workspace-write`로 덮는다.
  - 다른 client(TUI)가 보낸 사람 메시지도 그린다(자기가 보낸 것은 `clientUserMessageId`로 가른다).
  - 승인은 요청이 허락한 결정만 내놓는다(이 session 동안은 `acceptForSession`이 있을 때만). 거절해도 turn은 이어 간다. 다른 client가 먼저 답하면 카드를 답 없이 닫는다. turn이 끝날 때 `cancel`을 보내지 않는다(남의 turn까지 멈춘다). 사람이 멈출 때만 아직 열린 승인에 `cancel`이다. 영구 결정(execpolicy·network amendment)은 영구라고 표시한다.
  - 질문(`item/tool/requestUserInput`)은 질문 카드이고 답은 질문 id로 돌려준다. 이 tool은 plan mode에서만 켜진다. async 질문(`request_user_input_async`)은 server 요청 없이 `questions`를 단 `agentMessage` 하나로 온다: 글은 보통 메시지로 그리고 같은 질문을 카드로도 낸다. 기다리는 요청이 없으니 답은 새 사람 메시지(`> 질문\n\n답`)로 보내고(도는 turn이면 steer), 사람이 카드 대신 메시지를 보내도 카드는 닫힌다. 카드는 turn이 끝나도 남는다(`turn_ended`가 지우므로 그 뒤에 다시 낸다). 옛 turn을 다시 그릴 때는 카드를 만들지 않는다. MCP elicitation은 거절하고 notice를 낸다.
  - rewind는 마지막 메시지만(파일은 그대로), 이미지는 아직 끈다. turn이 없는 thread는 resume할 수 없어 첫 메시지 전에는 TUI로 넘어가지 못한다(notice). 첫 메시지 전의 TUI thread는 GUI로 열 때 새 thread로 시작한다.
  - plan mode의 "Implement" 카드는 실제 `plan` item으로는 아직 확인하지 않았다.
- **OpenCode**
  - 사람의 OpenCode 설정을 바꾸지 않는다. 기본 설정은 shell과 edit를 묻지 않아 ask 규칙이 없으면 승인 카드가 뜨지 않는다. always는 그 project의 OpenCode 규칙에 영구로 저장된다고 적어 내놓는다. 이 session 동안은 session의 권한에만 넣는다.
  - TUI client는 password를 0600 file로 server에 넘긴다(터미널 env는 PASSWORD 이름을 지운다). stdin을 열어 둔 것이 server의 lease다.
  - 새 session의 model은 server의 기본 model이다("최근 model"은 client 쪽 file이라 server가 내놓지 않는다). server의 판이 녹화한 판과 다르면 notice를 낸다.
  - auto-accept toggle은 승인 요청에 카드 없이 한 번만 답한다. always·session 규칙은 보내지 않는다. 상태는 run에만 있다.
  - 녹화한 판은 codemode라 실제 `todowrite`를 보지 못했다.
- **omp**
  - 승인 mode는 넘기지 않아 사람 설정이 없으면 yolo라 승인 카드가 뜨지 않는다. 승인 mode를 바꾸면 omp를 그 mode로 다시 띄운다. plan mode(RPC 없음)와 파일 rewind는 없다.
  - role은 사람의 `modelRoles`를 읽기만 하고 session 안의 `/switch @role`만 보낸다(설정은 쓰지 않는다).
  - 두 process가 한 session을 쓰면 omp가 새 id의 다른 file로 옮겨 대화가 갈라지므로, TUI는 SIGTERM으로 끄고 foreground가 끝난 뒤에만 GUI를 시작한다.
  - 없는 경로로 session을 바꾸면 omp가 오류 없이 새 빈 session을 연다. 바꾼 뒤 id를 확인하고 틀리면 앞 session으로 돌아가 warning을 낸다.
  - 저장되지 않은 session의 `--resume`은 ready 전에 끝난다. 그때는 `--resume` 없이 다시 띄우고 앞 대화는 다시 그리지 않는다.
  - 다시 열 때 사람 메시지의 그림은 Claude와 같이 탭의 임시 폴더에 다시 써서 link로 싣는다.
  - lophn의 omp hook은 session switch·branch도 알려 `/new`·`/resume`·`/branch`·`/fork` 뒤의 새 id를 tracker가 안다.
- **Antigravity**
  - 사람이 설치한 `agy`의 내장 ACP server(`agy acp`)에 붙는다. ACP 쪽은 전송(NDJSON·프레임 상한·타임아웃·프로세스 그룹 종료) · 프로토콜 런타임(`initialize` 응답 구조 판별·replay 게이트·mid-turn steer 레인) · `AntigravityDialect` · 상태 투영의 4계층으로 나누고, `antigravity` adapter는 그 위의 얇은 연결이다. ACP session id가 TUI의 conversation id라 `agy --conversation <id>`로 같은 대화를 TUI에서 잇는다. 대화는 agy 자신의 `~/.gemini/antigravity-cli/`에 있다.
  - restart다. agy process 둘이 같은 대화를 열어도 오류 없이 서로의 변경을 보지 못하고, 둘이 같이 붙을 local server가 없다.
  - 없는 id로 `session/load`하면 agy가 오류 없이 빈 session을 연다. 그래서 다시 열기 전에 그 대화 file이 있는지 보고, 없으면(첫 메시지 전의 TUI) 새 session으로 연다.
  - `session/load` 중에는 라이브 갱신(`writing_streamed` 포함)을 내지 않고 완료 항목으로 메모리에 접는다. `agy acp`는 load 응답 뒤에도 과거 업데이트를 흘리므로 200ms 정적 대기(불완전 바이트 수신도 활동으로 간주)까지 모은 뒤 handle에 한 번에 commit해 `StateChanged{coding_sessions, id}`로 화면이 snapshot을 한 번 읽게 한다. 첫 live prompt 전까지 늦은 과거 대화 조각은 버리고 메타(config·명령·mode·usage·session_info)만 통과시킨다. 이미 상태를 가진 revive는 `session/resume`을 먼저 쓴다.
  - 도는 turn에 보낸 steer는 `agy` 1.5.0 이상에서 `session/cancel` 없이 mid-turn `session/prompt`로 바로 보낸다(1.5.0 미만은 capability `steer`를 끄고 큐만 쓴다). 일반 전송과 steer 모두 보내는 순간 본문에 넣고 큐에서 빼며 live 구간의 `user_message_chunk` 에코는 무시한다. 앞 prompt가 `end_turn`으로 먼저 답해도 남은 prompt가 있는 동안 턴을 닫지 않고, 거절되거나 턴 끝과 엇갈리면 같은 id로 다음 턴 맨 앞에 다시 넣는다. 다음 turn으로 보낸 것은 adapter 줄에 섰다가 turn 뒤에 간다.
  - 승인은 agy가 준 선택지만 낸다(녹화한 계정은 한 번 허용과 거절뿐). "늘"은 agy 설정에 영구로 남으므로 영구라고 적는다. "이 session 동안"은 없다. 질문은 ACP elicitation form과 `interaction_*` 요청이고 선택지와 자유 답을 받는다(자동 승인 금지). 사람이 TUI를 `--dangerously-skip-permissions`로 직접 띄웠으면 TUI↔GUI 전환(`agy acp --dangerously-skip-permissions`, TUI 복귀 명령)에서 그 flag를 이어 간다.
  - model·생각 단계·mode(default, accept-edits, plan)는 agy의 config option이다. 생각 단계는 그것이 있는 model에서만 보인다. 명령은 3분류한다: 호스트 UI/로컬(`resume`), 유지보수 화이트리스트(`compact` — 사용자 메시지 없이 `command_output` 한 줄, 턴 중 큐 강제), 나머지 대화형/agent 명령(`/swarm`, `/plan`, `/goal`, `/grill-me`, `/browser`, `/schedule`, `/learn`, skill 등 — 사용자 메시지로 기록하고 원문 그대로 `session/prompt` 전송, 턴 중 큐 강제). `logout`은 목록에서 빼고 직접 쳐도 막는다.
  - subagent·swarm(`invoke_subagent`, `start_subagent`, `swarm` add 등)은 `detail.kind = "subagent"`와 `tasks`로 입력창 위 Running dock에 올린다. 정상 `end_turn`에 아직 도는 비동기 도구·subagent(데몬 명령과 `CronExpression`이 있는 반복 `schedule` 제외)는 취소하지 않고 running으로 유지하며 사후 `tool_call_update`와 자발적 wakeup을 이어 그린다. 자식 대화는 agy 로컬 brain 기록(`subagents/*.json`, `logs/transcript.jsonl`)을 symlink를 따르지 않고 바이트 상한 안에서 읽기만 해 `children`·`child_update`로 내며, 파일이 없거나 모양이 바뀌면 조용히 건너뛰고 카드는 유지한다. `stop_child`·`steer_child`는 ACP에 길이 없어 false다.
  - ACP에 없어 칸을 숨기는 것: rewind, fork, rename, todo, `stop_child`·`steer_child`, `!` shell, 비용.

**subagent와 background task.** 넷 모두 자식을 lane으로 나눠 `child_update`로 내고 subagent 줄이 detail을 채운다. 멈추기·끼어들기는 `stop_child`·`steer_child`, 도는 background 일은 `tasks`다. Claude는 `run_in_background` 없이도 Agent를 비동기로 띄우므로 background인지를 입력이 아니라 tool 결과로 가르고, 그 Agent 줄은 task 알림이 끝낼 때까지 running이다(다시 그릴 때는 알림이 없어 done). subagent 안에서 시작한 task는 root에 안내를 내지 않는다. Codex는 lane이 열리기 전에 온 자식 이벤트를 짧게 쌓았다가(thread마다 50개, 모두 200개) lane이 열리면 붓고, root turn이 끝나면 버린다. omp의 task tool은 곧바로 "Spawned agent"로 끝나므로 lifecycle 이벤트가 나중에 채운다.

**명령과 `!`.** `/` 명령은 prompt가 아니라 `run_command`로 adapter가 처리하고 출력은 `command_output` notice로 보인다. 출처는 CLI 자신의 목록과 adapter가 더한 줄이고, 화면이 대신하는 줄과 TUI 전용 줄은 뺀다. `!`는 `by: "user"` tool item이고 turn을 열지 않는다(Claude는 turn이 돌면 끝난 뒤). 도는 `!`는 `stop_shell`로 멈춘다(Codex는 그 shell 하나만 멈추는 API가 없어 turn 중이면 그 turn을 멈춘다).

## 지키는 것

1. **harness는 `claude`, `codex`, `opencode`, `omp`, `antigravity` 다섯이다.** 목록은 한 곳이고 터미널 함수와 adapter 표가 같은 목록을 쓴다. `antigravity`의 터미널 명령은 `agy`다.
2. **handle 하나는 터미널 탭 하나다.** `id`(`win_…`)는 lophn session id가 아니다. `close()`는 탭과 extension이 같이 쓰는 한 길이고 두 번 불러도 `onClose`는 한 번이다.
3. **handle은 접은 ACP 상태 하나만 쥔다.** 갱신과 글 조각은 쌓지 않는다. adapter는 화면이 붙기를 기다리지 않고 바로 publish한다. 붙는 쪽(core)은 snapshot을 먼저 받고 이어서 갱신을 받는다(늦게 붙어도 같은 상태). 갱신은 handle마다 20ms 동안 모아 한 번에 낸다.
4. **탭의 view는 core가 메모리에 들고 저장하지 않는다.** 저장본에서 다시 만들어진 탭(다른 workspace에 갔다 옴, 창 다시 load, 앱을 다시 켬)은 `coding_sessions/list`에서 그 터미널의 view를 읽어 되찾는다. 탭을 다른 창으로 옮겨도 handle은 core에 있어 그대로다. core가 끝나면 PTY, CLI process, handle이 모두 끝나 남지 않는다.
5. **TUI 끄기와 쳐 넣기는 core가 한다.** core는 PTY에 글을 쳐 넣고 이미 도는 shell이라 첫 출력을 기다리지 않는다. PTY host의 `signal` 요청은 foreground process group에 SIGINT·SIGTERM을 보낸다(Linux만, foreground가 shell이면 아무것도 안 한다). foreground가 끝난 것은 250ms마다 보는 foreground 변화로 안다(toggle이 이 간격만큼 기다린다). foreground 끝나기를 기다리는 한도는 5초이고 SIGKILL은 없다.
6. **한 CLI session을 두 process가 동시에 쓰지 않는다.** restart handoff는 앞 process가 끝난 뒤에만 다음을 띄운다. 탭에 TUI가 보이면 adapter의 `start`는 `conflict`다.
7. **adapter는 harness마다 하나이고 `Result`로 시작한다.** `start`가 실패하면 GUI view는 그대로 두고 오류를 실패한 turn으로 보인다. `start`나 그 앞의 TUI 끄기가 던져도(예상하지 못한 오류) handle을 빈 GUI로 두지 않고 `internal` 실패(credential을 가린 글)로 같게 보인다. 사람이 TUI로 넘기거나 탭을 닫는다.
8. **extension은 `ctx`로만 닿는다**([extension.md](extension.md)). CLI는 `ctx.spawn`으로 띄우고 사람의 설정과 login을 그대로 쓴다. `harness-gui`는 `builtin: true` 내장 extension으로 core 기동 시 자동으로 activate되어 탭 요청 handler(`onTab`)를 건다. 아직 준비되지 않았으면(기동 중 등) `failed` / `unavailable`로 답한다.
9. **CLI는 사람의 login shell env로 띄운다.** OS 서비스나 앱이 띄운 core의 env에는 사람의 shell 설정(nvm의 PATH, rc file의 API key)이 없다. login shell env는 core가 한 번 읽고 harness-gui가 아니라 extension spawner가 쓴다([extension.md](extension.md) 16). GUI 열기는 그 읽기가 끝나기를 기다리고, spawn이 login env < 탭 hook env < adapter가 넘긴 key 순서로 합친다. 상위 session 표지(`CLAUDE_CODE_ENTRYPOINT` 포함)는 지운다. 탭 hook env 덕에 GUI가 띄운 CLI의 hook도 같은 탭으로 와 상태 점이 맞는다. 같은 칸에 session 표지 `LOPHN_SESSION_ID=term:<탭>`도 실려 앱이 CLI의 process를 그 탭의 session에 잇는다(GUI가 띄운 CLI는 탭의 shell이 아니라 core(extension host)의 자식이라 shell pid로 찾을 수 없다). 앱이 보는 터미널 session 목록(`workspace-session.md`)은 GUI view의 탭을 handle의 ACP 상태(제목, CLI session id, turn 단계)로 채운다. core가 물려받은 표지는 지운다. CLI는 떼어 띄우고 process group째 끈다.
10. **터미널 함수는 `--` 앞의 `--gui` flag를 가로챈다.** bash·zsh·fish와 PowerShell 7·5.1 시작 층의 `claude`·`codex`·`opencode`·`omp`·`agy` 함수는 `--` 앞에 `--gui` flag가 있으면 `--gui`만 뺀 나머지 인자를 `lophn hook <harness> lophn-gui -- <args...>`로 넘긴다. 아니면 인자를 그대로 원래 명령에 넘긴다. `lophn hook`은 resume 인자(`--resume`, `--conversation`, `resume <id>`, `-s`, `-r`)와 나머지 CLI flag(`args`)를 분리하고 친 곳의 cwd를 더해 그 탭의 hook socket으로 보낸다. id는 `[A-Za-z0-9._:-]` 200자까지다. PowerShell 함수는 profile 뒤에 읽고 사용자 alias·function·execution policy는 바꾸지 않는다. 터미널 env에서는 `LOPHN_*`가 빠지므로 lophn CLI 경로는 core가 시작 층 file을 쓸 때 넣는다. `lophn hook`은 stdin 앞의 BOM을 뗀다(PowerShell `$OutputEncoding`이 BOM 있는 UTF-8이면 파이프 글에 붙는다). Windows PowerShell 7·5.1에서 실기로 확인했다.
11. **GUI view는 터미널 탭의 한 화면이고 접은 상태에서 한 번에 그린다.** 받은 snapshot에서 시작해 갱신 묶음을 접고, live 구간에서도 화면(desktop GUI 탭, lophn agent 탭, 폰)은 받은 `AcpUpdated`를 한 프레임 동안 모아 한 번에 접어 그린다(`AcpUpdated` 이벤트 모양은 그대로 둔다). 화면이 붙은 뒤에 snapshot이 오면(창 다시 load, replay 완료) 화면이 새로 읽는다. 지난 대화를 불러오는 `session/load` 중에는 라이브 `AcpUpdated`나 `writing_streamed`를 내지 않고 메모리에서 완료 항목으로 접은 뒤 handle에 한 번에 commit해 `StateChanged{coding_sessions, id}`로 화면이 snapshot을 한 번 읽게 한다. adapter는 `seq`를 1부터 빈틈없이 붙이고, 같은 탭에서 다른 CLI session으로 바꿀 때(resume)는 `session_reset`으로 접은 상태를 비운 뒤 다시 그린다.
12. **GUI 동안 탭 이름은 ACP session 제목(없으면 harness 이름)이고 사람이 붙인 이름이 먼저다.** GUI 동안은 TUI가 터미널 제목을 알리지 않고 그 터미널의 마지막 OSC 제목은 shell prompt의 것이므로 쓰지 않는다. 제목은 탭의 GUI 제목 칸에 두고 GUI view일 때만 쓴다. TUI로 가거나 handle이 닫히면 지운다. 다른 workspace의 탭 줄(저장본이라 view가 없다)은 agent TUI가 foreground에 없으면 그 workspace가 저장한 이름을 OSC 제목보다 먼저 쓴다.
13. **GUI 화면의 session key는 탭이 사는 동안 같고 ACP 입력의 session 검사를 통과해야 한다.** 터미널 ref(`trm_<ULID>`)의 ULID로 만든 `ses_<ULID>`다(`guiSessionId` 한 곳. 폰이 보는 coding session의 id도 같다). 그래서 탭이나 GUI↔TUI를 오가도 창의 draft 저장소가 쳐 둔 글과 읽던 위치를 돌려준다. (handle id로 만든 `ses_win_…`은 schema에 떨어져 main이 모든 입력을 거절한 적이 있다.)
14. **restart toggle에서 GUI 줄에 남은 메시지는 버려지지 않는다.** modal이 "보내지 않는다"고 알리고, 바꾸면 그 글을 입력칸에 되돌린다. GUI → TUI에서 CLI가 8초 안에 멈추지 않거나 `stop()`이 던지면 TUI 명령을 치지 않고 toggle을 실패로 알린다(앞 process가 끝났는지 모르면 같은 session을 둘이 쓰지 않게 TUI를 띄우지 않는다).
15. **GUI view인 탭을 골라도 '보고 있음'이다.** GUI view에서는 터미널 탭 화면이 서지 않으므로 화면이 고른 GUI 탭을 main의 터미널 focus 표에 적는다(보고 있으면 끝난 turn의 점과 알림이 사라진다).
16. **채팅 화면은 하나이고 칸은 capability로 가린다.** GUI source는 adapter가 낸 capability·명령 표·model 축·mode를 그대로 내고 화면은 lophn agent와 같은 검사로 없는 기능의 칸을 숨긴다([agent-chat.md](agent-chat.md)). 머리 session menu의 목록은 그 CLI의 지난 session이고 id는 CLI session id다. tool 본문은 handle만 쥐고 창으로 가는 snapshot·갱신에서는 뺀다(사람이 친 명령은 명령 글만 남긴다). 화면은 tool 줄을 펼칠 때 그 tool 하나의 본문 한 쪽을 읽는다(`acp/tool_body`). 이미지는 core가 tmp file로 써(`acp/image_upload`) `file://` link로 싣는다. 화면은 그림 확장자의 그 link를 core에 다시 읽혀(`acp/image_read`. 그 탭의 tmp 폴더 바로 아래, bytes가 그림일 때만) 그림으로 그리고 누르면 modal로 크게 보인다. 못 읽으면 chip이다. source가 답하지 못하는 읽기(call, envelope)는 `unavailable`이나 `not_found`다. 승인 카드의 always는 "Allow for this session"이고 adapter가 그 CLI session 안으로 좁힌다.
17. **입력의 `session`은 GUI view가 만든 값이다.** adapter는 보지 않는다. 사람 메시지는 `send` 입력의 `id`로 `message_added`가 된다. turn·tool·승인 id는 adapter가 `ctx.ids`로 만들어 CLI의 id와 짝짓는다.
18. **사람이 치지 않은 user 글은 받은 메시지다.** adapter는 `<lophn-call>`·`<lophn-reply>` tag(`from="human"`은 사람)와 lophn의 notice·reaction·step 꼬리표, Claude transcript의 `origin.kind`(human 밖: 다른 session)를 가려 `actor: "received"`, sender(`program`이나 이름만 있는 `agent`), `call`·`reply_to`로 그린다. live와 다시 열기가 같은 판정을 쓴다. Claude의 task 알림(background task가 끝났다는 user 글)은 live와 다시 열기 모두 줄로 그리지 않는다. steer 꼬리표는 사람 메시지로 남는다. 받은 메시지는 `origin`이 없어 rewind 시점이나 bookmark가 되지 않는다. Codex·OpenCode·omp·Antigravity는 출처 칸이 없어 tag만 본다. OpenCode는 다른 client(TUI, lophn)가 보낸 lophn call을 줄에 세우지 않고 들고 있다가 전달될 때 받은 메시지로 그린다. 모르는 꼴은 사람 메시지로 둔다. GUI source에는 `envelope` 읽기가 없어 보낸 쪽 chip은 이름만 보이고 열리지 않는다.
19. **도는 중에 다음 turn으로 보낸 말은 대화에 보낸 말로 그리지 않는다.** 줄 끝의 "보내는 중" 항목으로 보이고 줄에 서면 거기서 보인다. 못 보냄·접수 확인 안 됨은 다시 보내기 단추가 있는 대화 줄에 남는다. 줄의 항목 옮기기와 turn 뒤 다시 보내기는 adapter들이 같이 쓰는 code 하나이고, 다시 넣기와 omp의 고치기만 harness마다 다르다.
20. **"이 session 동안"은 그 CLI session 안에서만이다.** 사람의 설정 file에 쓰지 않는다. 영구가 되는 선택(always, execpolicy, network amendment)은 영구라고 적어 내놓는다. adapter는 사람의 CLI 설정을 바꾸지 않는다(Codex만 사람 설정이 full access일 때 정책을 덮는다).
21. **GUI 안의 key는 그 CLI의 key다.** harness-gui manifest의 `contributes.keybindings`가 harness마다 keymap을 context `agentView:<harness>`에 낸다. GUI 탭은 바깥 `agentView` 안쪽에 `agentView:<harness>`를 달아, keymap이 agent 화면 기본 key보다 먼저이고 그 keymap의 Ctrl+글자 머리는 lophn 탭·창 key보다 먼저다. 동작은 공통 command(`agent.cycle-mode`, `agent.send-now`, `agent.queue`, `agent.rewind`, `agent.history-*`, `agent.background`, `agent.toggle-details`, `agent.clear-input`, `agent.interrupt`, `agent.newline`)이고 handler는 채팅 화면에 있다.
    - 같은 Shift+Tab이 Claude와 Antigravity에서는 mode, omp에서는 thinking 단계를 돈다(그 source의 mode). agy에서 Ctrl+R은 artifact review라 GUI에서 history 검색 key를 걸지 않는다.
    - Ctrl+C는 글을 골랐으면 복사, 입력칸에 글이 있으면 지우기, 비었고 turn이 돌면 멈추기다. Esc는 turn이 돌면 바로 멈추고, 쉬는 동안 Esc Esc(OpenCode는 `Ctrl+X U`)가 마지막 사람 메시지의 rewind를 연다.
    - 입력 history(↑↓)와 Ctrl+R 검색은 이 session에서 보낸 사람 메시지다(CLI history file은 읽지 않는다). Ctrl+R은 GUI에 focus가 있으면 늘 검색을 열어 창 Reload로 새지 않는다.
    - 사람이 Settings에서 `agent.*` 키를 바꾸면 네 harness keymap의 그 command 키를 모두 대신한다. CLI의 key 설정 file은 읽지 않는다.
    - 대화 scroll(PageUp·PageDown·Ctrl+Home·Ctrl+End, `agent.scroll-*`)은 harness keymap이 아니라 agent 화면 기본 key라 네 harness가 같다.
    - 도는 tool을 background로 보내기는 ACP 입력 `background_tool`과 capability `background`다. Claude와 OpenCode만 true이고 Codex·omp·Antigravity는 false다.
22. **편집 카드의 Open은 절대 경로로 연다.** ACP edit detail의 `document`가 절대 경로이고 `path`는 cwd 상대의 보이는 이름이다. adapter는 `document`를 늘 절대 경로로 낸다.
23. **저장되지 않은 session이라고 GUI가 실패하지 않는다.** 첫 메시지 전의 TUI session은 CLI가 저장하지 않으므로 resume하지 않고 실패 줄 없이 새 session으로 연다(Claude는 같은 id).
24. **CLI 하나의 이상이 앱이나 GUI 줄 전체를 멈추지 않는다.** 읽지 못하는 frame과 너무 큰 frame(64 MiB)은 그 줄만 버리고 경고를 한 번만 낸다(Codex·omp·OpenCode·Antigravity, Claude는 SDK가 읽는다). CLI에 보내는 요청은 30초 기한이 있고 일이 끝나야 답하는 요청(turn 시작, shell 명령, compact 등)은 뺀다. 답 없는 CLI가 입력 줄이나 handler를 붙들지 않는다.
25. **adapter가 실패하면 CLI를 남기지 않는다.** 시작이 중간에 실패하거나 연결을 잃으면 띄운 CLI를 끈다. stop은 정중한 단계(abort, session id 읽기)를 3초만 기다린 뒤 닫는다(Claude·omp·Antigravity). 오류 글과 stderr 꼬리는 credential을 가려서 화면에 보인다.
26. **Claude의 rewind·fork가 새 CLI를 띄우지 못하면 앞 session을 지킨다.** 앞 session과 숨긴 구간으로 돌아가고 경고로 알린다.
27. **OpenCode의 event stream이 끊겨도 session은 산다.** 0.5초에서 10초까지 늘리며 다시 구독하고, 끊긴 사이 끝난 turn은 닫고 도는 turn에는 출력이 빠졌을 수 있다고 알린다. 끊긴 사이 뜬 승인은 다시 읽는다. event 없이 이어 실패하면 그때 실패로 끝낸다.
28. **화면의 입력은 handle이 받는다.** core는 coding session의 `acp/send`를 core route로 나누지 않고 handle에 그대로 넘긴다. handle이 없으면 `not_found`다. 같은 `key`의 입력은 session마다 200개를 기억해 handle에 한 번만 넘긴다(폰은 다시 붙은 뒤 같은 입력을 다시 보내고 adapter는 key를 거르지 않는다).
29. **화면으로 나가는 대화는 redaction을 거친다.** snapshot, update, tool 본문의 모든 글을 내기 전에 제품 redactor로 거른다. desktop 탭과 폰이 같은 길이다. 알려진 secret을 아직 다 모르면 내지 않는다(snapshot은 `unavailable`, update는 버리고 화면이 다시 읽게 한다).
30. **handle은 화면 연결과 상관없이 산다.** desktop이나 폰이 떨어져도 handle과 CLI는 돌고, 다시 붙은 화면은 `coding_sessions/list`와 `acp/snapshot`을 다시 읽는다.
31. **폰이 TUI session을 GUI로 바꾸는 것은 사람이 확인한 뒤에만이다.** 도는 turn이 끊기는 되돌릴 수 없는 일이라 route가 `confirmed: true`를 요구하고 폰이 부르는 길도 같다.
32. **팀원의 입력은 하나씩, 탭이 쉴 때만 넣는다.** 도는 turn에 끼우지 않는다(입력 하나가 turn 하나). Claude가 줄 선 메시지 여럿을 한 turn에 묶지 않게 하고 turn과 call의 짝이 정확하다.
33. **call의 답은 그 call이 연 turn의 마지막 agent 글뿐이다.** ledger turn은 넣은 입력이 첫 사람·받은 메시지인 ACP turn에만 묶는다(그 turn 중 사람의 steer는 그대로 call의 turn이다). 사람 메시지가 연 turn이 그 입력을 가져갔으면(adapter가 줄을 묶었다) 그 turn의 글은 답이 아니고 ledger에 남기지 않으며 call은 실패로 돌아간다(그 turn에서 harness가 `lophn call reply`로 답했으면 그것). 사람이 친 글이 아직 turn에 들지 않았으면 넣지 않고, ledger turn을 연 사이 사람 turn이 열렸으면 다시 쉴 때 넣는다.
34. **turn 자격은 그 turn에만 산다.** file은 turn이 끝나면 지워지고 자격도 끝난다. 늦게 온 자격, 터미널 끝, handle 닫힘도 file과 살아 있는 자격을 남기지 않는다. 자격은 그 session과 그 project 조건에 묶인다. CLI는 file이 비면 사람 자격으로 바꾸지 않는다.
35. **call은 영영 기다리지 않는다.** 가져간 turn이 답 없이 끝나거나, 30초(사람 turn이 도는 동안은 다시 잰다) 안에 turn이 열리지 않거나(adapter 줄에 남았으면 뺀다), 탭을 열 수 없으면 보낸 쪽에 `receiver_ended`로 돌아간다. 탭이 닫혀도 queue에 남은 call은 다시 연 탭으로 간다. 아직 가져가지 않은 call은 restart 탭이 TUI를 보이는 동안 기다린다.
37. **core가 연 탭은 한정된다.** project마다 한꺼번에 일하는 탭이 8개까지이고 넘는 입력은 줄 서며, 할 일이 끝나면 닫는다(위 "닫기").
36. **팀원 session은 한 번만 보인다.** 그 터미널 탭이 자리다(위 "보이기").

## 경계와 계약

- **extension 계약**: 탭 요청은 extension이 건 `onTab` handler가 받는다(`gui`, 지난 session 읽기, rewind 미리보기). `ctx.acp.open`이 handle을 연다. 터미널 쪽은 `AcpTerminal`(그 탭의 harness, session id, 상태, cwd, 글 쳐 넣기, signal, foreground 끝남 구독)을 준다. 계약은 ACP session 계약([acp.md](acp.md))과 extension 계약([extension.md](extension.md))이다. `builtin: true` 내장 extension으로 설정 없이 늘 켜진다.
- **adapter 계약**: harness마다 하나. 시작하면 run을 돌려준다(`Result`). 시작 때 cwd, resume id, handle, 탭 terminal, spawn, clock, ids를 받는다. adapter는 `handoff`(restart | shared)와 TUI를 끄는 길(`exitTui`)을 선언한다. run은 사람의 입력을 받고, session id를 알리고, TUI 명령(`tuiCommand`)과 도는 일(`running`)을 알리고, 멈춘다(`stop`). 지난 session 목록과 rewind 미리보기는 선택 읽기이고 없으면 `[]`·`null`이다.
- **화면의 route**: desktop 탭과 폰이 같이 쓴다. `coding_sessions/list|switch_plan|switch|open`, desktop만 `coding_sessions/cli_sessions|rewind_preview`, 기존 `acp/snapshot|send`, coding session의 `acp/tool_body|image_upload|image_read`, event `AcpUpdated`와 `StateChanged{coding_sessions}`. harness GUI만의 IPC channel은 없다(GUI 탭의 focus는 터미널 focus 표 `shell:terminal-focus`를 쓴다).
- **터미널 hook**: 터미널 함수가 `lophn hook <harness> lophn-gui`로 `{resume}`을 보낸다. core의 hook ingress가 key로 터미널을 찾아 GUI로 넘긴다.
- **ACP**: 채팅 화면은 ACP만 본다. 대화 밖 session 기능(model·mode, 명령, rewind, fork, compact, rename, `!`, resume, 사용량, 제목, toggle)도 ACP의 입력과 갱신이다. 입력 `send`, `set_model`, `set_mode`, `run_command`, `rewind`, `fork`, `compact`, `rename`, `set_toggle`, `use_role`, `run_shell`, `stop_shell`, `open_session`, `refresh_usage`, `stop_child`, `steer_child`, `stop_task`, `background_tool`, 갱신 `session_changed`, `session_reset`, `command_output`, `child_update`, `tasks_changed`, `plan_changed`, `hidden_added`·`hidden_restored`, `tool_detail_changed`, `origin_set`, `message_queued`·`message_taken`.
- **팀원**: env `LOPHN_AGENT_CREDENTIAL_FILE`. 화면 route `coding_sessions/forget`(사람만, 그 팀원 보관). 탭 요청 `AcpTabRequest.member {deny}`와 adapter의 `member`. machine command `harness/open_member`(`OpenHarnessMember`), `harness/fail_call`(`FailHarnessMemberCall`). core 안 port `HarnessMembers`(harness wiring이 낸다). session 행 `harness_gui`(ledger step `lophn-agent.sessions.gui-member`, `harness`에 omp·antigravity를 더하며 표를 다시 짰다).
- **저장 모양**: GUI session은 CLI 자신의 file이 가진다. lophn은 view와 handle을 저장하지 않는다. 사람이 만든 thread bookmark는 shell data file(`<data root>/shell/thread-bookmarks.json`) 하나다(harness 대화가 ledger에 없으므로). 이미지(사람이 붙인 것, 폰이 보낸 것, 다시 연 대화에서 다시 쓴 것)는 `<os tmp>/lophn-gui/<터미널 ref>/`의 0700 폴더 아래 0600 file이다.

## 결정

- **CLI 코어는 두고 화면만 바꾼다.** Claude·Codex 데스크톱이 같은 꼴이라 session·resume·설정은 CLI의 것을 쓴다. 그래서 lophn ledger에 기록하지 않고 lophn project가 아닌 폴더에서도 돈다. (사람, 2026-11-04 "CLI 화면을 대체하는 GUI")
- **기능 묶음은 본체와 따로 켜는 extension이다.** 대다수에게 필요 없는 기능이다. (사람, 2026-11-04)
- **각 CLI의 공식 GUI 경계로 붙는다.** Claude Code는 Agent SDK, Codex는 `codex app-server`, OpenCode는 자기 server API, omp는 `omp --mode rpc-ui`, Antigravity는 `agy acp`다. TUI 화면을 긁지 않는다. (agent)
- **GUI는 lophn 터미널 탭 안에서만 열고 친 그 탭이 GUI로 바뀐다.** 첫 판은 session 하나에 lophn 창 하나(agent)였는데 사람이 원한 것은 그 탭이 바뀌고 toggle되는 것이었다. lophn 밖 터미널과 Home workspace에서는 하지 않는다. (사람, 2026-11-05)
- **같은 대화를 GUI와 TUI 사이에서 toggle한다.** Claude·omp·Antigravity는 process를 끄고 같은 session id로 다시 띄우며 modal로 알린다(사람, 2026-11-05). Codex·OpenCode는 탭 전용 server에 둘이 같이 붙는다(agent, 사람이 받음). 이유: 이 둘은 한 server에 client 여럿이 붙는 경계가 있어 끄지 않아도 된다.
- **GUI에는 그 CLI에서 되는 채팅 기능을 다 넣고 기준은 각 데스크톱 앱이다.** 대상은 Claude Code, Codex, OpenCode, omp다. (사람, 2026-11-05) Antigravity(`agy`)를 더했다. (사람, 2026-11-16)
- **대화 밖 session 기능도 ACP의 입력과 갱신이다.** 화면을 lophn agent와 harness가 같이 쓰고 칸은 capability만 보고 가린다. 첫 판의 "external이면 lophn 전용 칸을 숨김"은 capability 검사로 바꿨다. 채팅 화면을 다시 짜지 않는다. (사람, 2026-11-05)
- **Claude는 stream-json을 직접 말하지 않고 Agent SDK를 쓴다.** 이유: 승인·멈추기·resume을 Anthropic이 맞춰 둔 것을 쓰고 CLI 판이 바뀌면 SDK 판을 올린다. 비용은 개발 `node_modules`의 SDK와 peer dependency(약 40MB)와 bundle의 1.3MB이다. SDK의 OS별 claude 사본(linux-x64 약 323MB)은 받지 않고 사람의 `claude`를 쓴다. (사람, 2026-11-05)
- **OpenCode는 `opencode acp`를 버리고 데스크톱 앱처럼 server API를 쓴다.** (사람, 2026-11-05)
- **`<harness> gui`는 앱 argv가 아니라 그 탭의 hook socket으로 터미널을 가진 쪽(지금은 core)에 닿는다.** 이유: 첫 판의 data root·argv 정렬 bug가 생길 자리가 없다. (agent)
- **권한은 사람 설정을 따른다.** Codex는 thread마다 정책을 받고 full access를 금했으므로 `never`·`danger-full-access`일 때만 `on-request`·`workspace-write`로 덮는다. OpenCode의 권한은 사람이 쓴 규칙표라 adapter가 덮으면 사람의 규칙을 바꾸게 된다. Antigravity는 ACP mode에 bypass가 없어 사람이 TUI에서 직접 켠 `--dangerously-skip-permissions` flag만 TUI↔GUI 전환에서 그대로 이어 간다. 영구 규칙이 되는 선택은 영구라고 적어 내놓는다. (agent)
- **"이 session 동안"은 그 CLI session 안이다.** Claude는 SDK 제안의 저장 위치를 session으로 바꾸고(그대로면 그 폴더의 local 설정 file에 영구), Codex는 `acceptForSession`, OpenCode는 session의 권한에만 넣는다. (agent)
- **handle이 접은 상태를 쥔다.** adapter는 GUI view가 붙기를 기다리지 않고 바로 publish한다. 처음 판은 갱신을 모두 쌓아 붙을 때마다 하나씩 다시 보냈는데, 긴 session은 workspace를 오갈 때마다 멈췄고 TUI→GUI 때 대화가 한 줄씩 다시 그려졌다. emdash·t3code·happy가 모두 접은 상태와 snapshot, 묶은 갱신으로 같은 문제를 푼다. (사람이 써 보고 찾음)
- **harness-gui는 본체에 기본으로 늘 켜지는 내장(`builtin: true`) extension이다.** 처음에는 opt-in extension으로 두고 꺼진 상태에서 Settings › Extensions를 여는 흐름(`TerminalGuiOff`, `extension-settings`, `extension_off`)을 두었으나, 터미널 탭의 채팅 전환과 폰 coding session이 기본 기능이 되며 별도 설치·켜기 단계와 꺼짐 상태 UI·event·intent를 모두 없앴다. `harness` extension은 계속 설정으로 켜고 끈다. (2026-11-20)
- **GUI 안의 CLI key는 lophn 탭·창 key보다 이긴다.** Ctrl+C는 글을 골랐으면 복사이고 아니면 CLI 동작이다. CLI key 설정 file은 읽지 않는다. (사람)
- **Settings에서 바꾼 `agent.*` 키는 네 harness keymap을 함께 대신한다.** harness마다 따로 바꾸기는 하지 않는다. (agent)
- **입력 history는 그 GUI session에서 보낸 사람 메시지다.** CLI history file은 읽지 않는다. (agent)
- **scroll key는 입력칸에 focus가 있어도 대화를 움직인다.** 여러 줄 draft에서 PageUp·PageDown·Ctrl+Home·Ctrl+End로 caret을 옮기던 것은 잃는다. 입력칸이 짧고 CLI TUI도 그렇다. (agent)
- **Claude steer는 Claude desktop과 같은 detach다.** id 없는 `backgroundTasks()`는 task만 등록하고 tool 호출을 풀지 못했고, control 요청 `interrupt {send_now}`는 tool을 멈췄다(녹화로 확인). (agent)
- **shell mode(`!`)는 harness 넷과 lophn agent 모두에 둔다.** Claude `!`는 데스크톱 앱처럼 adapter가 돌리고 `shouldQuery: false` 사람 메시지로 넣는다. (사람이 방향, agent가 모양) Antigravity는 결과를 model에 보내지 않고 대화에 넣는 ACP 길이 없어 `!`를 두지 않았다. (agent)
- **fast·thinking·Speed는 composer chip이 아니라 model picker의 축이다.** Roles가 맨 위이고 provider 묶음을 접는다. lophn agent도 같다. (사람, 2026-11-05)
- **Antigravity는 agy 안의 `agy acp`로 붙는다.** t3code·orca는 Google의 별도 `agy-acp-server`를 쓰는데 그 server의 대화는 TUI와 다르다(orca 주석). 내장 `agy acp`는 TUI와 같은 대화 store를 쓰고 ACP session id가 conversation id다. ACP에 없는 TUI 기능(rewind, fork, rename, `!`)은 GUI에 없다. (agent)
- **Antigravity는 restart로 넘긴다.** agy process 둘이 같은 대화를 열면 오류 없이 서로를 보지 못하고, 둘이 붙을 local server가 없다(`agy remote-control`은 Google을 거치는 중계다). (agent)
- **omp role은 "이 session만 이 role의 model로"만 넣고 사람의 `~/.omp` 배정은 바꾸지 않는다.** (사람, 2026-11-05)
- **thread index는 사람 메시지 4개부터 보이고 bookmark는 shell data file 하나에 둔다.** harness 대화는 ledger에 없다. (사람, 2026-11-05)
- **subagent 보기는 탭 머리 ←/→로 오간다.** 따로 둔 Back 줄이 없다. (사람, 2026-11-05)
- **Codex의 `!` Stop은 turn 중이면 그 turn을 멈춘다.** shell 하나만 멈추는 API가 없다. (agent)
- **받은 메시지의 ACP sender 확장과 A2A 화면은 하지 않았다.** 모양은 사람이 정한다.
- **앱을 몰아 확인하는 script는 만들지 않는다.** 실제 앱 확인은 사람이 한다. (사람, 2026-11-05)
- **handle은 core에 두고 desktop과 폰이 같은 route로 붙는다.** 처음에는 handle, adapter, CLI가 shell main의 자식이라 desktop 창은 IPC로 붙고 폰에는 core가 접은 사본을 `/host-link`로 받아 중계했다(사본이 접는 곳이 하나 더 있고 연결이 끊기면 사라졌으며 컴퓨터의 앱이 떠 있어야 했다). PTY host와 extension host를 core의 자식으로 옮기며 handle도 core에 두었다. 이제 desktop과 폰이 같은 `acp/snapshot`·`acp/send`·`AcpUpdated`와 `coding_sessions/*`를 쓰고, snapshot과 event의 순서가 core 한 곳에서 정해지며, 앱 없이 열리고 앱을 Quit해도 산다. 창의 ack(1.5초 안에 그 탭을 가진 창이 받아야 GUI view가 섰다)는 없앴다: view는 core가 들고 화면은 그것을 읽는다. 버린 안: desktop은 IPC로 두고 폰만 route로(같은 일을 하는 길이 둘). GUI session을 lophn ledger에 기록하지 않는 비목표는 그대로다. (사람, 2026-11-17: 일은 core가 하고 shell은 화면 가운데 하나다 / agent)
- **tool 본문은 대화 상태와 따로 다니고 화면이 줄을 펼칠 때 읽는다.** handle이 본문을 쥐고 창과 core로 가는 snapshot·갱신에서는 뺀다(사람이 친 명령은 그 줄에 명령 글을 보여야 해 입력만 남긴다). 이유: snapshot 크기의 대부분이 본문이라 폰 연결의 frame 한도와 그리기 비용을 키운다. lophn agent session도 본문을 펼칠 때 읽는다. 긴 Claude session 다섯을 다시 열어 잰 snapshot은 본문을 빼면 23~30%로 줄었다. 대가: 펼칠 때마다 한 번 묻는다. 미룬 안: item도 끝에서부터 나눠 받기(ACP 상태와 대화 화면, 숨긴 구간, 검색이 같이 바뀐다. 본문을 빼고도 긴 대화가 느릴 때 한다). (사람이 방향, agent)
- **폰의 그림은 desktop GUI와 같이 그 탭의 임시 폴더 file과 `file://` link로 다닌다.** coding agent는 그림을 경로로 읽으므로 lophn session의 blob(`message-images/upload`)을 쓰지 않는다. 다시 연 대화의 그림도 같은 폴더에 다시 써서 같은 link로 그린다. (agent)
- **TUI로 도는 session을 폰이 GUI로 바꿀 때는 확인을 받는다.** 확인 문구는 "도는 turn이 끊기고 desktop 탭도 chat 화면으로 바뀐다"를 말한다. 이유: 되돌릴 수 없는 중단이고 desktop 화면이 바뀌는 일이라 조용히 하지 않는다. 버린 안: 말없이 바꾸기(desktop에서 쓰던 TUI가 예고 없이 끊긴다), 이미 GUI인 session만 폰에 보이기. (agent, roadmap `mobile.md` 사람이 정할 것 6의 추천대로)
- **폰이 여는 session은 컴퓨터의 그 project에 새 터미널로 열고 되살리기는 ledger의 harness agent session에 한한다.** 이유: handle이 터미널에 묶여 있어(지키는 것 2) 사람이 치는 것과 같은 길을 타야 handle과 adapter를 새로 만들지 않는다. 터미널은 core가 열어 창이 없어도 되고, 그 project를 보이는 창이 있으면 탭으로도 보인다. CLI 자신의 지난 session 목록은 adapter마다 달라 열지 않았다. headless harness agent(`coding_*`, `claude -p`)는 폰의 새 session 목록에 두지 않는다(승인 card가 없다). (agent) 처음에는 handle이 shell main에 있어 창이 있어야 열렸고, 앱이 꺼져 있으면 폰이 앱을 깨웠다(`coding_sessions/wake`). 터미널과 handle이 core로 오며 깨우기는 없앴다. (agent)

- **GUI 탭이 lophn 팀원이 된다.** 사람이 평소 쓰는 coding agent 탭에 call이 들어오고 그 탭이 다른 agent를 부른다. headless 길은 이것이 실제 CLI로 확인된 뒤 걷어낸다. (사람, 2026-11-21 `roadmap/a2a-access.md` 정한 것 10)
- **transport는 `harness`를 그대로 쓰고 팀원은 `harness_gui` 표시가 붙은 ledger session이다.** 버린 안: 새 transport(Router와 화면이 한 벌 더). 표시는 재시작 뒤에도 headless host가 팀원 queue를 가져가지 않게 하려고 행에 둔다. `harness` check가 다섯을 받아야 해서 `sessions`를 다시 짰다. (agent)
- **turn 자격은 file로 준다.** 오래 사는 CLI는 env가 띄울 때 정해진다. 자격 규칙(그 session·그 turn, turn 끝에 끝남)은 그대로다. 버린 안: session 수명의 env token(자격 모델이 바뀐다), MCP 길(CLI + skill 결정을 뒤집는다). (agent, spike)
- **사람이 친 turn은 ledger turn 없이 자격만 낸다.** StartTurn은 입력 메시지가 있어야 하는데, 쓰면 사람이 친 글을 옮기거나 지어낸다. 자격에는 turn id만 있으면 된다. (agent)
- **받은 메시지로 그리기는 extension 입구 한 곳에서 한다(`receivedSends`).** 다섯 adapter가 모두 send id를 message id로 쓴다. (agent)
- **답 못 한 call은 `receiver_ended`로 돌려준다.** 실패 이유 enum을 늘리려면 `agent_calls` 표를 다시 짜야 한다. (agent)
- **팀원은 화면에서 터미널 탭으로만 보인다.** 화면을 구독하는 Bus가 팀원 session의 event를 거른다(`hidingSessions`). 버린 안: 화면 쪽에서 표시로 거르기(session store가 event로 줄을 세워 표시 없는 event가 새 줄을 만든다). (agent)
- **project에서 부른 내장 coding agent는 GUI 탭 팀원으로 연다.** 사람이 지켜보고 끼어들 수 있다. Home·앱 workspace와 사람이 Agent 탭으로 연 session은 headless 그대로다. (agent)
- **core가 coding agent CLI를 스스로 띄우는 것은 사람이 그것을 켰을 때뿐이다(lead, 2026-11-21).** 사람이 연 GUI 탭이 팀원인 것은 사람의 결정이지만, 사람이 없는 곳에 CLI를 띄우는 것은 headless와 같은 허락(`extensions.harness.enabled`)을 받는다.
- **core가 연 탭은 project마다 일하는 것이 8개까지이고 할 일이 끝나면 닫는다(lead, 2026-11-21; 넘으면 줄 서고 열린 call·도는 step이 있으면 닫지 않는다, agent).** 팀(team spawn)은 자기 상한이 있고 사람이 쓴 탭은 사람의 것이라 닫지 않는다.
- **turn 자격은 누가 했는지를 남기는 것이지 가두는 것이 아니다(lead, 2026-11-21).** coding agent는 사람의 shell이라 변수를 지우면 사람 자격으로 control connect를 한다. headless도 같고 막지 않는다.
- **call의 turn 중 사람의 steer는 그 turn을 사람의 것으로 바꾸지 않는다(lead, 2026-11-21).** 마지막 agent 글이 그대로 답이다.

## 열린 것

열린 이슈는 topic이 `harness-gui`인 이슈다.

- 사이드바 Recent의 x가 아직 `coding_sessions/forget`을 부르지 않는다(route만 있다). 그 전까지 팀원 행은 GUI로 연 대화(CLI session)마다 하나 남고 resume은 같은 행을 이어 늘지 않는다.
- 사람이 없는 turn이 harness 자신의 승인 card에 닿으면 사람이 올 때까지 기다린다(자동 허락·거절 없음).
- 팀원 길은 실제 CLI로 돌려 보지 않았다(test는 녹화 재생과 가짜 handle).

- Claude GUI의 `!` 출력은 끝날 때 한 번에 보인다. ACP에 도는 tool의 본문 갱신이 없다. shell은 `/bin/sh`로 박혀 Windows에서 돌지 않는다(defect).

- Claude Agent 줄은 시작 시각을 맞추려고 `task_started`가 올 때까지 늦게 낸다. ACP에 tool item의 `at`을 고칠 갱신이 없다(defect).
- desktop과 폰의 coding session(core의 handle, 폰이 여는 session, view 바꾸기)은 실제 coding CLI와 실제 폰으로 돌려 보지 못했다. type 검사, test(녹화 재생), 개발 core로만 보았다. 실제 desktop에서 폰으로 도는 turn을 끊어 보고, 창이 없을 때의 열기와 되살리기를 한 번 사람이 본다(change-log `mobile-coding-agents`의 checklist). 폰의 대화에는 지난 session 목록과 rewind 미리보기가 없다(기기 route 목록에 없어 칸이 capability로 숨는다). 펼칠 때 읽는 tool 본문, 폰이 붙이는 그림, 다시 연 대화의 그림(Claude, omp)은 test로만 보았다.
- coding session의 입력은 core가 handle에 넘기자마자 성공으로 답해서, 두 기기가 같은 승인에 답하거나 늦은 멈추기가 오면 말없이 버려지거나 다음 turn을 끊는다(이슈 `coding-input-answered-ok-before-applied`). 폰에서 바꾸기를 확인한 뒤 다른 기기가 시작한 turn도 말없이 끊긴다(`coding-switch-confirms-stale-plan`).
- 긴 Claude Code session 하나가 폰에서 빈 대화로 열렸다. 본문을 뺀 snapshot은 작아 frame 한도가 원인이 아닐 가능성이 높고, 후보는 core가 secret을 다 알기 전에 대화를 내지 않는 것이다(이슈 `phone-coding-session-opens-empty`).
- 탭 CLI 아래에서 뜬 다른 harness process(Bash tool이나 `!`로 돌린 `claude -p`)가 hook 환경을 물려받아 그 탭의 session과 recent에 들어가고, GUI toggle이 엉뚱한 session을 열 수 있다(bug). 녹화 도구는 hook 환경을 지우고 띄워 이 일이 없다. 나머지는 hook 줄에 pid를 실어 tracker가 가려야 한다.

알려진 한계다.
- Windows에서는 foreground를 몰라 toggle이 없다.
- Codex: rewind는 마지막 메시지만(파일은 그대로), 이미지는 끈다, 첫 메시지 전에는 TUI로 넘어가지 못한다, plan "Implement" 카드는 실제 `plan` item으로 확인하지 못했다.
- OpenCode: todo는 녹화한 판이 codemode라 실제 `todowrite`로 확인하지 못했다. 판 2.1.4 기준이다.
- omp: 18.8.7 기준이고 plan mode(RPC 없음)와 파일 rewind가 없다. model turn이 없는 session은 저장되지 않아 다시 열면 `!` 기록이 사라진다.
- Antigravity: 1.5.9 기준이다. ACP에 없는 rewind, fork, rename, todo, subagent 대화, background task, `!` shell, 비용이 없다. "늘 허용" 선택지와 질문의 ask-in-chat 꼴은 녹화한 계정에서 보지 못했다. GUI가 띄운 `agy acp` turn에서도 agy hook이 탭에 오는지는 확인하지 못했다.
- Claude: CLI가 줄 선 `later` 여럿을 잇따라 `started`하는지와 비동기 Agent 결과의 실제 순서는 녹화로 확인하지 못했다(SDK 문서에 기댔다). Claude 녹화로 줄 여럿의 지금 보내기와 비동기 Agent를 확인해야 한다.
- Codex의 `thread/turns/list`와 자식 `thread/resume` 사이에 온 자식 이벤트는 빠질 수 있다.
- Claude에서 SDK 사본 없이 사람 `claude`를 쓰므로 CLI 판과 SDK 판이 어긋나면 SDK 판을 올려야 한다.
