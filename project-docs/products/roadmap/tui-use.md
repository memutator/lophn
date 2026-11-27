# TUI use: agent가 터미널의 대화형 프로그램을 보고 다룬다

상태: 로드맵. 2026-11-27 사람이 조사를 시켰고(`feature-cleanroom` workflow, harness-lab `_report/tui-use/`) planner가 정리했다. 제품 결정은 2026-11-27 사람이 내렸다("정한 것"). "(agent)"라고 적은 것은 planner의 기술 결정이다. 구현은 "구현 범위"를 따른다.
배경 문서: `project-docs/architecture/{terminal-agent,browser-tab,workspace-layout,approval,project-command}.md`, `project-docs/products/roadmap/{browser-tab,computer-use}.md`, `project-docs/PRODUCT.md`.

## 사람의 말 (원문)

2026-11-27:

> 이미 tui use는 빈 보고서 폴더로 READEME.md랑 스켈레톤은 있거든? 그거 삼아서 그 조사 좀 해줘
> 그리고 tui use 를 좀 집중해서? 본격적으로 다루는 레포들도 추가로 조사한다음에 그것도 같이 조사하고

design에서 세 질문(다룰 터미널의 범위, 열기·키 입력 허락, 비밀번호 prompt)에 (2026-11-27):

> 전부 다 추천대로

## 무엇인가

agent가 대화형 터미널 프로그램(`vim`, `htop`, `lazygit`, `psql`, `gdb`, `git rebase -i`, REPL, 다른 CLI의 TUI)을 띄우거나 사람이 넘겨준 터미널에 붙어, 렌더된 화면을 읽고 키를 보내는 일을 여러 turn에 걸쳐 되풀이한다. `lophn browser`의 터미널판이다.

- 비대화형 명령은 지금처럼 `shell.run`이 한다. TUI use는 `shell.run`으로 안 되는 것(화면을 그리고 키를 기다리는 프로그램)만을 위한 길이다.

## 왜

- lophn agent의 `shell.run`은 명령을 끝까지 돌리고 출력을 받는다. 키를 기다리는 프로그램(대화형 rebase, `psql`, debugger, 설치 마법사, 다른 CLI의 TUI)은 멈추거나 쓸 수 없다.
- coding agent(harness)도 `lophn` CLI로 같은 길을 쓸 수 있으면, 사람이 터미널에서 하던 대화형 일을 agent에게 맡길 수 있다.
- lophn은 이미 터미널을 core가 갖고(창이 없어도 돈다) 화면 사본을 만든다. 모델에게 여는 층만 없다.

## 지금 코드 (main `1e1434cf9`, 터미널 쪽은 조사 기준 `bbb4ce508`과 같다)

- **있다.** core의 PTY host(`packages/core/terminals/host/`)가 `node-pty`로 터미널을 열고 앱 Quit 뒤에도 든다. `@xterm/headless` 화면(`screen.ts`)은 parse barrier(`write("", cb)`), 전각 continuation 셀 건너뛰기, 셀 run의 `inverse`, `cursor`, scrollback cache를 이미 갖는다. Windows ConPTY 프레임 묶기(`conpty-sync.ts`), project command용 `dedicated` PTY와 프로세스 그룹 종료·종료 뒤 화면 보존(`terminal-agent.md` 92~96), foreground process 감지, 크기 경합의 `remote_size`가 있다.
- **있다.** agent 탭 모델: `tab open|show|close|list|give`, 탭 주인(`owner`), 사람이 넘긴 탭(`handed_tab`), take control, `<lophn-untrusted>`, known-value redaction(`browser-tab.md` 34·40·50, `workspace-layout.md` "탭의 주인").
- **없다.**
  1. 터미널 route는 모두 사람 자격(`actors: ["user"]`, `packages/protocol/coding-agent/terminals.ts`)이고, `terminals/input`은 기기 허락이나 shell focus 없이는 `forbidden`이다. agent가 터미널을 열고 읽고 치는 길이 없다.
  2. 화면이 DECCKM(`?1`), bracketed paste(`?2004`), mouse tracking(`?1000/1002/1003`), Kitty keyboard flag, alt screen을 추적해 내보내지 않는다(`?25`와 mouse encoding만 본다).
  3. DA/DSR/OSC 10·11 질의 회신을 desktop xterm이 붙어 있을 때만 한다. 창 없는·숨은 탭의 `vim`·`less`는 시작에서 몇 초 멈춘다.
  4. 이름 키(`Enter`, `C-c`, `Up`) 인코더, 모드를 보는 paste, 마우스 인코더가 없다. `commandInput`은 개행이 있으면 모드와 상관없이 bracketed paste로 감싸고 안의 `\x1b[201~`를 지우지 않는다.
  5. 기다리기(`wait`)가 없다. `service.ts`의 300ms `quiet()`는 초기 prompt용 내부 helper다.
  6. 터미널 탭에 take control, untrusted 감싸기, redaction이 없다. `UNTRUSTED_SOURCES`에 터미널이 없다.
  7. 모델에 맞는 화면 꼴이 없다. `terminal_view/snapshot`은 폰 렌더러용 run JSON이고 `terminals/snapshot`은 ANSI serialize다.
- `lophn` tool은 내장 명령에 `--on`을 받지 않는다: "다른 기계의 터미널·file·job은 범위 밖이다"(`packages/core/lophn-agent/tools/lophn/tool.ts`).

## 다른 제품은 (조사 요지, 26개)

- **바탕은 같다.** PTY + headless VT emulator + emulator가 프로그램의 질의(DA/DSR/색)에 바로 답하기. 답하지 않으면 `vim`·`mc`가 멈춘다.
- **화면은 "보이는 화면의 평문 + 커서·모드·크기 + 반전(선택) 구간"으로 수렴했다.** DOM처럼 요소 `ref`를 붙이던 도구(`pilotty`, `agent-tui`)는 그것을 버렸다. scrollback은 달라고 할 때만, 잘라서. PNG는 일부 도구의 선택 기능이다.
- **입력은 넷으로 나눈다**: 글 치기(`type`), 붙여넣기(`paste`), 이름 키(`press`), 마우스. 보내기 직전에 프로그램이 켠 모드를 읽어 바이트를 정한다.
- **기다리기**는 sleep이 아니라: 보내기 직전에 화면을 기준으로 잡고, 글·정규식이 뜨거나 화면이 멈추거나 프로세스가 끝나면 깨고, 시간이 다 되어도 최신 화면을 같이 돌려준다.
- **표면은 CLI + 짧은 skill**이 다수다. 도구 schema가 크면 매 turn 토큰을 먹는다.
- **갈리는 곳**: 독립 도구는 agent가 띄운 전용 터미널만 다루고 권한 경계가 없다. 앱 안 기능(cmux, termio, herdr, paseo, orca, Warp)은 사람이 연 터미널에도 붙는다. Warp만 쓰기 승인(처음 쓸 때 묻기 / 늘 묻기 / 늘 허락)과 사람이 바로 끼어들기를 둔다.

## 표준을 그대로 가져올 수 없는 곳

1. **사람의 터미널에 마음대로 붙지 않는다.** `terminal-agent.md`의 비목표("사람 터미널의 agent에 메시지를 넣지 않는다")와 탭 주인 규칙. browser처럼 "agent가 연 탭 + 사람이 넘긴 탭"으로 좁힌다(정한 것 1).
2. **`shell.run` 승인을 돌아가는 뒷문이 되면 안 된다.** 대화형 shell을 하나 열어 주면 그 안에서 무엇이든 칠 수 있다. 독립 도구에는 이 문제가 없다(권한이 없다). lophn은 열기를 기존 shell 판정에 태운다(정한 것 2).
3. **비밀번호에는 browser의 origin 같은 것이 없다.** 터미널의 prompt가 진짜 `sudo`인지 프로그램이 꾸민 것인지 알 수 없어 저장한 login을 채우는 `fill-login`을 옮기지 못한다(정한 것 3).
4. **다른 컴퓨터의 터미널은 범위 밖이다.** cmux·termio는 원격 터미널을 다루지만 lophn은 내장 명령의 `--on`을 막아 두었다. 첫 판은 이 컴퓨터만 한다(agent, 기존 경계).
5. **새 MCP나 model tool을 두지 않는다.** browser use와 같이 `lophn` 명령 + skill이다(사람, changelog 0.22.0의 browser 결정과 같은 길).

## 제안 모양

### 명령

- 열기: `lophn tab open --terminal [--command "<명령줄>"] [--cwd <dir>] [--cols N --rows N] [--as ...]`. `--command`가 있으면 login shell로 그 명령 하나를 돌리고 끝나면 탭에 마지막 화면이 남는다(project command의 `dedicated` PTY와 같은 꼴). 없으면 대화형 shell이다. 닫기·보이기·목록·주기는 지금 `tab close|show|list|give`.
- 다루기: `lophn terminal read|snapshot|act|wait|resize <tab>` (browser 명령과 짝).
  - `snapshot`: 보이는 화면의 평문 + `{columns, rows, cursor, modes, alt_screen, state, exit_code, title, highlights[]}`. `--scrollback N`(≤ 500줄)과 `--ansi`는 달라고 할 때만. 32 KiB 넘으면 아래 행을 남기고 자른다.
  - `act type|paste|press|mouse` (+ `--wait-idle`/`--wait-text`로 보내기 전 기준을 잡고 기다린 뒤 화면까지).
  - `wait --text|--regex|--idle-ms|--await-change|--exit`, 기본 10초 상한 25초, 시간이 다 되어도 최신 화면.
- 결과는 known-value redaction을 거치고 `<lophn-untrusted source="terminal.<명령>">`로 감싼다.

### 화면

- agent가 연 터미널 탭은 `--url` browser 탭처럼 기본이 접힌 work 탭이다(`--as`로 바꾼다, `tab show`로 펼친다). 창이 없어도 core가 터미널을 열고 명령이 된다.
- agent가 다루는 터미널 탭 머리에 "<이름> is controlling this terminal"과 [Take control](넘긴 탭이면 [Take back]). 사람이 가져가면 agent의 `act`·`resize`는 `conflict`, 읽기와 `wait`는 된다. [Hand back]으로 돌려준다.
- 사람이 펼쳐 보기만 할 때는 PTY 크기를 바꾸지 않는다. 가져갈 때만 크기를 잡는다.

## 정한 것

### 제품 (사람)

1. **agent가 다루는 터미널은 agent가 스스로 연 터미널과 사람이 넘겨준 터미널뿐이다.** browser 탭과 같은 규칙이다. 사람이 손으로 연 터미널은 넘기기 전에는 agent에게 없는 것(`not_found`)이다. "내 터미널의 gdb 좀 봐줘"는 사람이 그 탭을 한 번 넘겨서 한다. (사람, 2026-11-27)
2. **허락은 열 때 한 번, 지금의 명령 실행 판정과 같이 받는다.** 명령을 주고 열면(`vim 파일`) 그 명령으로 `shell.run`과 똑같이 판정하고, 명령 없는 대화형 shell은 늘 묻는다. 사람이 넘긴 터미널은 넘긴 것이 허락이다. 열린 뒤의 키 입력은 묻지 않고, 사람이 언제든 가져가서 멈춘다. (사람, 2026-11-27)
3. **비밀번호·2FA prompt는 사람이 직접 친다.** agent는 탭을 펼치고(`tab show`) 사람에게 쳐 달라고 한다. 저장한 login을 채우거나 보호 입력 창으로 받아 대신 쳐 주는 길은 첫 판에 없다. (사람, 2026-11-27)

### 기술 (agent)

1. **VT 엔진은 지금의 `@xterm/headless`를 쓴다.** desktop 렌더러와 글자 폭이 같고 parse barrier·전각 처리가 이미 있다. 모드 추적만 `screen.ts`에 더한다. (agent)
2. **창이 붙지 않은 동안은 PTY host의 headless 화면이 DA/DSR/OSC 10·11에 답한다.** desktop xterm이 붙어 있으면 그쪽만 답한다(두 번 답하지 않게). (agent)
3. **표면은 `lophn terminal` 명령 그룹 + `tab open --terminal`.** `terminal`은 `RESERVED_APP_SLUGS`에 더한다. 새 model tool, MCP 없음. spec이 쓰는 그룹 이름 `tui`는 쓰지 않는다: 사람은 이것을 터미널 탭으로 보고, `tab list`의 kind도 `terminal`이다. (agent)
4. **화면 꼴은 평문 + 메타 + 반전 구간(`highlights`, 최대 32개).** 요소 `ref`, OCR, PNG는 두지 않는다. 시각 hash는 셀 글자 + `inverse` + 커서 + alt screen으로 잰다. (agent)
5. **입력 넷(`type`/`paste`/`press`/`mouse`)을 core의 순수 인코더 한 벌이 모든 표면에 대해 한다.** 키 이름은 browser `press`(`Control+a`, `ArrowUp`)와 tmux 관례(`C-c`, `Up`, `BSpace`)를 같이 받고, 모르는 키는 지원 목록과 `invalid_input`. `type`은 `\r`를 붙이지 않는다. `paste`는 `?2004h`일 때만 감싸고 안의 `\x1b[201~`·NUL을 지운다. 지금 `commandInput`의 무조건 감싸기도 이 인코더로 고친다. 마우스(SGR 1006)는 작아서 첫 판에 넣는다. (agent)
6. **`wait`는 이벤트로 깬다.** 기준은 보내기 직전, 프로세스 종료는 모든 조건과 같이 본다, 시간 초과는 오류가 아니라 `matched: false`와 최신 화면. CLI·route timeout은 `timeout_ms + 5초` 이상. (agent)
7. **사람이 agent가 다루는 터미널에 키를 치면 곧 take control이 된다.** 키가 섞이면 둘 다 망가진다. [Take control] 단추도 있다. (agent)
8. **다른 컴퓨터의 터미널은 첫 판에 없다.** 내장 명령 `--on` 금지를 그대로 둔다. 폰의 터미널 보기·입력(`remote_grants`)은 지금 그대로이고 agent 쪽 규칙과 섞지 않는다. (agent)
9. **자원 상한**: session마다 살아 있는 agent 터미널 4개, 컴퓨터 전체 16개. 넘으면 `conflict`. (agent)
10. **지침**: 대화형이 아닌 일은 `shell.run`, 화면을 그리고 키를 기다리는 프로그램만 `lophn terminal`. 비밀번호 prompt는 사람에게(정한 것 3). workspace prompt와 harness skill `lophn-agent`에 적는다. (agent)
11. **열기 판정은 새 범주를 만들지 않고 shell 판정을 그대로 부른다.** `--command <명령줄>`은 `GateCall` `shell`(그 명령줄)로, 명령 없는 대화형 shell은 shell 스캐너의 `opaque`로 판정한다. 그러면 `full`에서도 묻고, unattended에서는 `deny`(`no_person`), 팀 자식은 부모에게 묻는다(`approval.md`의 기존 표 그대로). 사람 token(사람의 CLI)은 판정하지 않는다. (agent)
12. **넘길 수 있는 터미널은 사람이 연 이 컴퓨터의 터미널 탭이다.** coding agent가 도는 탭도 사람이 넘기면 된다: `terminal-agent.md`의 비목표는 lophn이 스스로 넣지 않는다는 뜻이고, 사람이 넘긴 탭은 예외로 그 문서에 적는다. project command의 `dedicated` 터미널은 넘기지 않는다(그 명령의 것이다). 넘긴 터미널은 사람의 것이라 agent가 닫지 못하고(`forbidden`), 주인 session이 끝나면 주인만 지우고 탭과 프로세스는 남는다. (agent)
13. **agent가 연 터미널의 수명은 agent가 연 browser 탭의 규칙을 따르고, 프로세스가 끝나면 마지막 화면과 종료 코드를 탭이 닫힐 때까지 든다.** 닫을 때는 `dedicated` PTY와 같은 프로세스 그룹 종료(POSIX `SIGTERM → 3초 → SIGKILL`, Windows `taskkill /T /F`)를 쓴다. (agent)

## 구현 범위

구현자는 이 파일과 `../harness-lab/_report/tui-use/spec.md`만 읽는다. 다른 제품의 source와 harness-lab의 다른 파일은 열지 않는다. 화면 꼴, 모드, 인코딩 표, `wait` 계약, 오류 코드는 spec 제2부를 따르고, 이 파일이 spec과 다르면 이 파일이 이긴다. 특히:

- 명령 그룹은 `lophn terminal`이다(spec의 `tui`). untrusted source 이름도 `terminal.<명령>`이다.
- 열기는 `tab open --terminal [--command "<명령줄>"] [--cwd] [--cols --rows] [--as]`다. spec의 `--program/--args` 직접 실행은 두지 않는다(판정이 명령줄 하나를 shell 스캐너에 태우므로). 기본 크기 120×36, 범위는 spec 2절.
- 허락은 기술 결정 11, 넘기기는 12, 수명은 13이다. spec 7.5 "넘겨받은 탭은 사람에게 반환"은 12와 같다.
- 비밀 입력은 사람이 친다(정한 것 3). 보호 입력 창·저장 login 채우기를 만들지 않는다.

### 만드는 것

1. **화면 모드와 질의 회신** (`packages/core/terminals/host/screen.ts`, host `main.ts`)
   - spec 3.1 `TerminalModes` 전부 추적(DECCKM, bracketed paste, alt screen, 커서, mouse tracking·encoding, Kitty keyboard flag stack).
   - 붙은 desktop xterm이 없을 때 headless의 질의 회신을 PTY에 쓴다. 붙어 있으면 지금처럼 renderer가 답한다(둘이 같이 답하지 않는다).
   - 모델용 투영: 보이는 화면 평문(행 끝 공백 제거, 전각 continuation 건너뛰기), `highlights`, 시각 hash, 선택 scrollback, 32 KiB 절단(아래 행 보존). 폰용 `terminal_view`는 바꾸지 않는다.
2. **입력 인코더** (core 순수 모듈 하나)
   - spec 4절 `type`/`paste`/`press`/`mouse`와 키 문법·DECCKM·Ctrl/Alt·Kitty 규칙. 기존 `service.ts`의 `commandInput`도 이 인코더의 `paste`를 쓴다.
3. **agent 터미널 열기·소유·take control** (core 탭 표, terminals service, protocol)
   - `tab open --terminal`: core가 PTY를 바로 열고(창을 기다리지 않는다) 탭 id를 돌려준다. 창이 있으면 접힌 work 탭으로 보인다(`--as`로 바꾼다). 탭 주인 = 연 session.
   - 사람의 "Hand to"(browser 탭의 넘기기와 같은 세 길)에 터미널 탭을 더한다. `handed_tab`, [Take back].
   - take control 줄 "<이름> is controlling this terminal" + [Take control]/[Hand back]. 사람이 그 탭에 키를 치면 곧 가져간 상태다. 가져간 동안 `act`·`resize`는 `conflict`(고정 문장), `read`·`snapshot`·`wait`는 된다.
   - 사람이 보기만 하는 동안 PTY 크기를 바꾸지 않는다. 가져갈 때(또는 사람이 친 때) 크기를 잡는다.
   - 상한(기술 결정 9), 수명(13), `tab list`·`tab give`·`tab show`·`tab close`가 터미널 탭에도 그대로 된다.
4. **허락** (`tab open` route → 기존 gate)
   - 기술 결정 11. 새 permission 범주·설정을 더하지 않는다.
5. **CLI `lophn terminal read|snapshot|act|wait|resize`** (`packages/cli/commands/terminal.ts`, core route, protocol schema)
   - spec 6절의 칸과 효과, 오류 7코드. 주인(연 session, 넘겨받은 session, 받은 session, 사람 token이면 person)만 부른다. 아니면 `not_found`.
   - 결과 글(화면, 제목, scrollback, highlights)은 known-value redaction을 거치고(알려진 값을 다 모르면 `unavailable`) `<lophn-untrusted source="terminal.<명령>">`로 감싼다. `UNTRUSTED_SOURCES`와 `carriesReason`에 더한다. 오류 문장은 고정 문장이고 감싸지 않는다.
   - `terminal`을 `RESERVED_APP_SLUGS`에.
6. **지침** (workspace prompt `project.md`/`app.md`/`home.md`, `packages/coding-agent/skills/lophn-agent.ts`)
   - 기술 결정 10 두세 줄.

### 만들지 않는 것

- 사람이 넘기지 않은 터미널 읽기, 같은 workspace 터미널 일괄 읽기.
- 키 입력마다 묻기, "늘 묻기/늘 허락" 같은 터미널 전용 승인 설정.
- 비밀번호 대신 치기(보호 입력 창, 저장 login 채우기).
- PNG·screenshot, OCR, 요소 `ref`, 위젯 tree.
- 다른 컴퓨터의 터미널(`--on`), 폰에서 agent 터미널의 take control 새 UI(폰의 기존 터미널 보기는 그대로).
- 새 MCP server나 model tool, 배치 명령(`batch`).
- shell 명령 경계 감지(OSC 133), coding agent 상태로 기다리기.

### 바뀌는 architecture 문서

- `terminal-agent.md`: agent가 다루는 터미널(열기, 넘기기, take control, 질의 회신, 모드, 인코더, `wait`), 비목표 문장에 "사람이 넘긴 탭 예외", 경계와 계약의 route 목록과 actor.
- `workspace-layout.md`: "탭의 주인"·"넘기기"에 터미널 탭.
- `browser-tab.md`: 넘기기·take control이 터미널과 같은 규칙임을 가리키는 한 줄(규칙을 두 곳에 쓰지 않는다).
- `approval.md`: `tab open --terminal`이 shell 판정을 부른다는 것.
- `project-docs/flows/`, `boundary-catalog.yaml`, `module-catalog.yaml`에 해당하는 것, change-log 항목.

### 다 된 것

- 창 없이(또는 접힌 탭으로) agent가 `tab open --terminal --command "vim <file>"`로 열고, `snapshot`으로 화면을 읽고, `press`/`type`으로 편집·저장·종료하고, `wait --exit`로 끝을 받는다. `vim`·`less`가 시작에서 멈추지 않는다.
- 방향키가 DECCKM 켜진 프로그램과 꺼진 shell에서 모두 맞게 들어가고, `paste`가 bracketed paste를 켠 프로그램에서만 감싼다. 모르는 키는 `invalid_input`과 지원 목록.
- 한글이 섞인 화면에서 커서·highlight 열 좌표가 맞는다.
- 명령 없는 대화형 shell 열기는 `full`에서도 묻고, unattended에서는 `no_person`으로 막힌다. `--command`는 `shell.run`과 같은 판정을 받는다.
- 사람이 손으로 연 터미널은 넘기기 전 `not_found`, 넘긴 뒤 다뤄지고, agent가 닫으려 하면 `forbidden`.
- 사람이 탭에 키를 치면 agent의 `act`가 `conflict`, [Hand back] 뒤 다시 된다. 보기만 할 때 PTY 크기가 바뀌지 않는다.
- 결과가 untrusted로 감싸이고 알려진 비밀 값이 가려진다.
- `npm run check` 통과.

## 조사 문서

- `../harness-lab/_report/tui-use/README.md`: 판정 표, 업계가 수렴한 7가지, 갈리는 6축, 구현 함정 8가지.
- `../harness-lab/_report/tui-use/lophn.md`: 지금 lophn과 대조(`bbb4ce508`), 기술 결정 8, 사람 질문 5.
- `../harness-lab/_report/tui-use/spec.md`: clean-room 명세(구현자가 읽는 유일한 조사 파일).
