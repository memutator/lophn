# `@` 언급: 입력칸에서 파일·폴더·CLI 항목을 붙인다

상태: 로드맵. 2026-11-13 사람이 issue.md("@로 context 첨부 기능")로 내고 범위를 정했다. planner가 조사 둘(CLI·앱 비교, 지금 코드)로 정리했다.
배경 문서: `project-docs/architecture/harness-gui.md`, `project-docs/architecture/acp.md`, `project-docs/architecture/agent-chat.md`.

## 왜

- Claude Code, Codex, OpenCode, omp의 TUI는 `@`로 파일과 그 CLI의 항목을 고른다. harness GUI는 "그 CLI에서 되는 것은 GUI에서도 된다"가 기준인데 `@`가 없다. lophn agent 입력칸도 같다.
- 지금 파일을 붙이는 길은 끌어다 놓기·붙여넣기·첨부 단추뿐이다. 그나마 Claude에는 `file:///…` 글로만 가서 CLI가 읽지 않고, Codex에는 model에 아무 내용도 가지 않는 `mention` item으로 간다.

## 지금 코드

- 입력칸은 harness GUI와 lophn agent가 같이 쓰는 component 하나다(`AgentComposer`, 쓰는 곳 1). 두 쪽은 ACP capability로만 다르다.
- 입력칸은 `<textarea>`다. selection 저장, history ↑↓, Shift+Enter, `/` 메뉴, `!` shell mode, focus 신호가 textarea API(약 27곳)에 기댄다. IME는 native에 맡기고 `isComposing`으로만 막는다. 줄에 선 말 고치기 칸도 따로 textarea다.
- `/` 메뉴는 글이 `/`로 시작할 때만 열리고 입력칸 상자에 붙는다(caret에 붙지 않는다).
- 보낸 말의 파일은 `resource_link` block이고 말풍선 글 위 칩 줄로 따로 그린다. 사람 글은 markdown이 아니라 plain이다.
- 계약 block(`text`, `image`, `resource_link`, `resource`)에는 글 속 위치가 없다. core는 block을 줄로 이어 model에 넘긴다(`Link: <name> <uri>`). 저장된 content는 `schema_version: 1` blob이라 선택 칸을 더해도 migration이 없다. redaction이 글 길이를 바꿀 수 있다.
- 다시 연 대화: lophn agent는 저장한 block을 그대로 돌려준다. harness는 CLI transcript에서 다시 만든다. Codex(`mention` item)와 OpenCode(`files`)는 파일을 되찾지만 위치는 없다. Claude와 omp는 글만 남는다.
- CLI마다 후보 검색: Codex app-server `fuzzyFileSearch`, OpenCode server 파일 검색, Claude CLI control 요청 `file_suggestions`(SDK type에만 있고 공개 method와 응답 꼴이 없다), omp는 없다. Claude는 공개 method `supportedAgents()`, `mcpServerStatus()`, `readMcpResource()`가 있다.
- 보낼 때 CLI가 펼치는 꼴: Claude와 omp는 글 속 `@"경로"`를 CLI가 읽는다. OpenCode는 `files`(mention 범위 포함)를 server가 읽는다. Codex의 `mention`은 model에 내용을 주지 않아 경로를 글로 보낸다.
- lophn 쪽 파일 검색: gitignore를 따르는 걷기(`files()`, project search 안, export 안 됨)가 있다. ripgrep은 없고 파일 이름 fuzzy 검색도 없다.
- 질문하고 답을 받는 읽기의 본보기는 rewind preview다(adapter method → extension → IPC → main → gui source, core는 read route).

## 정한 것

사람(2026-11-13):
- 범위는 파일, 폴더, 그리고 그 CLI의 TUI `@`가 보이는 항목(Claude agent·MCP resource, Codex skill·plugin·app, OpenCode agent 등)이다.
- 언급은 입력칸과 보낸 말풍선 안에서 글 속 칩으로 보인다. 다시 연 대화에서도 칩이다.
- lophn agent 입력칸에도 같이 넣는다.
- 후보는 CLI마다 adapter가 그 CLI의 검색으로 답한다.

planner:
- 검색이 없는 omp와 lophn agent는 lophn 파일 검색(gitignore를 따르는 걷기 + fuzzy 순위)을 쓴다. 근거: 하나는 어차피 필요하고, 같은 것을 둘이 쓴다.
- 계약은 `text` block에 선택 칸 `mentions: [{start, end, uri, name, kind}]`를 더한다. 버린 길: `text`와 `resource_link`를 번갈아 두기(core는 block을 줄로 잇고 화면은 link를 글 위로 올려 순서가 깨진다). redaction 뒤 범위가 글과 맞지 않으면 그 언급은 버리고 글은 둔다.
- 후보는 질문-답 읽기(`mentions(query)`)로 하고 capability `mentions`로 칸을 숨긴다. `/` 명령처럼 session meta로 밀어 두지 않는다(파일 목록은 크고 글자마다 바뀐다).
- 입력칸은 CodeMirror(이미 고정된 판, 편집기에서 widget decoration을 쓴다)로 바꾸고 칩은 atomic range widget으로 한다. 줄에 선 말 고치기 칸도 같은 것을 쓴다. 버린 길: contenteditable을 직접 짜기(IME·selection을 다 새로 짠다).
- 보낼 때: Claude는 글 속 `@"경로"`, omp는 `@경로`, OpenCode는 `files`와 mention 범위, Codex는 경로 글(skill·plugin·app만 그 item으로). lophn agent는 지금처럼 경로를 넘기고 agent가 file tool로 읽는다.
- 다시 열 때: 각 adapter가 transcript에서 언급을 되찾아 범위를 다시 만든다(Claude·omp는 글의 `@` 꼴, Codex는 `mention`·skill item, OpenCode는 `files`). 못 찾으면 글로 둔다.

## 먼저 확인할 것

- Claude `file_suggestions`의 응답 꼴과 SDK 밖에서 control 요청을 보낼 수 있는지. recorder에 장면을 더하고 사람이 녹화를 돌린다(haiku). 안 되면 Claude도 lophn 검색에 agent·MCP 목록을 더한다.
- Claude transcript에 `@"경로"`가 어떤 꼴로 남는지(펼친 내용이 따로 들어가는지). 위 녹화와 같이 본다.
- OpenCode server가 `files`의 mention 범위를 저장해 돌려주는지.

## 일의 모양

계약(`text.mentions`, `mentions` 읽기와 capability)을 먼저 고정하면 나머지가 서로 기대지 않는다: 입력칸(CodeMirror, `@` 메뉴, 칩)과 말풍선 칩, adapter 넷의 검색·보내기·되찾기, core의 lophn 검색과 read route. 계획으로 열 때 이 셋을 wave 2의 task로, 계약과 녹화를 wave 1로 둔다.

## 끝남 기준

- 네 CLI GUI와 lophn agent에서 `@`를 치면 caret 옆에 후보가 뜨고, 고르면 칩이 되며, 보낸 말풍선과 다시 연 대화에도 칩이 남는다.
- model이 그 파일을 실제로 읽는다(Claude·omp는 CLI가 펼치고, OpenCode는 server가 읽고, Codex·lophn agent는 경로를 받아 읽는다).
- IME(한국어)로 치는 중에 `@` 메뉴와 Enter가 엉키지 않는다.

## 하지 않는 것

- 파일 내용 index나 cache. 칠 때마다 걷는다. 느리면 그때 둔다.
- `@`로 고른 파일의 줄 범위(`#L10-20`). OpenCode만 받는다.
- 다른 session·창·browser tab 언급(Claude desktop·Codex desktop에는 있다). CLI의 TUI에 없는 것이다.
