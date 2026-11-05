# screen-a

사람이 써 보고 찾은 화면 결함(README 정한 것 20, 21, 27, 28, 29) 가운데 대화 쪽과 터미널 탭을 고친다: vendor 얼굴의 회색 원, `/` 메뉴 스크롤과 가로 스크롤, code block 복사 단추, shell mode composer와 사람 shell 줄, harness rewind 미리보기, 터미널 탭의 "채팅으로 열기". lophn agent와 harness GUI가 같이 쓰는 화면이다.

- 단위: screen (wave 10)
- 선행: acp-round2. 이 task가 쓰는 ACP·IPC 이름은 acp-round2가 정한다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/parts/avatar/{avatar.tsx,avatar.module.css}`
  - `packages/shell/renderer/conversation/slash-menu/{slash-menu.tsx,slash-menu.module.css}`
  - `packages/design/components/reading/code-block/code-block.tsx`, `packages/design/components/reading/reading.module.css`(`.codeBlock`·`.codeHead`·`.codeActions`·`.pre` 절만)
  - `packages/shell/renderer/conversation/thread/`(`command-output.tsx`, `thread.module.css`, 새 `shell-run.tsx`)
  - `packages/shell/renderer/conversation/composer/{agent-composer.tsx,agent-composer.module.css}`
  - `packages/shell/renderer/conversation/{thread-layout.ts,thread-layout_test.ts,agent-thread.tsx,agent-tab-source.ts}`(사람 shell entry와 그 type만)
  - `packages/shell/renderer/conversation/agent-view.tsx`(shell 보내기와 composer에 넘기는 줄만. 다음 wave의 screen-b가 이 file을 크게 고친다)
  - `packages/shell/renderer/conversation/{agent-tab-gui-source.ts,agent-tab-fake-source.ts}`
  - `packages/shell/renderer/conversation/session-rewind/`(harness 미리보기를 그리는 데 필요한 줄만)
  - `packages/shell/renderer/terminal/{terminal-tab.tsx,terminal-gui.tsx}`
  - `packages/shell/renderer/icons/conversation.ts`
  - `packages/design/i18n/catalog/{conversation.ts,project.ts}`(key만 더하고 고친다)
  - `tools/wireframes/pages/screens/{harness-gui.tsx,agent.tsx,agent-pages.tsx,bodies.tsx}`, `tools/wireframes/pages/screens/agent-tab/`, `tools/wireframes/pages/kit/reading/page.tsx`, `tools/wireframes/mock/fake-terminal.ts`
- 읽을 것:
  - 조사 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/round2-screen.md` §2, §3, §4, §5, §6(fork 줄), `round2-core-tab.md` B(터미널 탭)
  - architecture: `project-docs/architecture/agent-chat.md`, `harness-gui.md`, `acp.md`, `terminal-agent.md`
  - 본보기(화면): `tools/wireframes/pages/screens/harness-gui.tsx`(TerminalGui fake API, `steps`), `tools/wireframes/pages/screens/bodies.tsx`(TerminalTab fake bridge)
  - ui-design skill(바뀌는 화면마다 gallery page)
- 계약:
  - 쓰는 것(acp-round2가 wave 9에 정한다. main이 정본이다): capability `shell`, 입력 `run_shell {session, key, command}`, tool item의 `by: "agent" | "user"`, `HarnessGuiTabApi`의 rewind 미리보기 IPC. `ThreadInfo`·`InfoRow`(screen-thread가 둔 것)
  - 내놓는 것: 사람 shell entry(`ThreadShell`)와 `thread/shell-run.tsx`. `useGuiToggle`의 `start()`. 그 밖에 다른 task가 기대는 것은 없다

## 할 일

1. **vendor 얼굴**(정한 것 29, 조사 §3)
   - `avatar.module.css`에 `.avatar[data-kind="vendor"] { background: transparent; border-radius: var(--space-0); }`.
   - `avatar.tsx`의 `VENDOR_PIXELS`를 상자 크기 그대로로 바꾼다(sm 20px `--space-7`, md 24px `--space-8`, lg 48px `--space-11`. token 값을 읽어 쓰고 숫자를 박지 않는다). 주석을 "배경 없이 상자를 채운다"로 고친다.
2. **`/` 메뉴**(정한 것 29, 조사 §2)
   - `slash-menu.tsx`의 `Row`에 ref를 두고 `selected`가 true가 될 때 `scrollIntoView({block: "nearest"})`.
   - `slash-menu.module.css`: `.menu`를 `overflow-x: hidden; overflow-y: auto`로, `.row`에 `min-width: 0`, `.label`을 `flex: 0 1 auto; min-width: 0; max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`. hint·badge는 그대로 `flex: none`. 잘린 이름은 `title` 속성으로 전체를 보인다.
3. **code block 복사 단추**(정한 것 29, 조사 §4)
   - `CodeBlock`은 `language`도 `action`도 없으면 `.codeHead` 줄을 그리지 않는다. 대신 `figure`를 `position: relative`로 두고 복사 단추를 오른쪽 위에 겹친다(`.codeActions[data-floating]`. 평소 흐리게, figure hover·focus-within에 또렷하게). `.pre`의 위 padding은 아래와 같게.
   - `thread/command-output.tsx`의 고정폭 본문은 줄을 바꾼다(`thread.module.css`에 `white-space: pre-wrap` class를 그 `CodeBlock` 둘레에 준다). `CodeBlock`에 wrap prop을 새로 만들지 않는다.
   - kit reading page(`tools/wireframes/pages/kit/reading/page.tsx`)에 언어 없는 code block 예를 하나 둔다.
4. **shell mode composer**(정한 것 21, 조사 §5)
   - `agent-composer.tsx`: 글이 `!`로 시작하고 capability `shell`이 켜져 있으면 shell mode다.
     - 입력 글은 mono 글꼴, 입력칸 테두리는 경고색 계열 token, 입력칸 안 왼쪽에 `Shell` chip(terminal 아이콘), 아래 hint 줄 "Runs in your shell · Esc to leave".
     - 빈 shell mode(`!`만)에서 Esc나 Backspace는 `!`를 지워 mode를 끈다. 도는 turn이 있을 때의 Esc(멈추기)보다 먼저 본다.
     - shell mode에서는 `/` palette와 model·mode 명령 가로채기를 하지 않는다.
     - 보내기(`send`)는 `startsWith("!") && capabilities.shell`이면 새 prop `onShell(command)`(앞 `!`와 앞뒤 빈칸을 뗀 글)를 부른다. 빈 명령이면 보내지 않는다. 첨부는 shell mode에서 끈다.
   - `agent-view.tsx`: `onShell`을 넘긴다. session을 `ensureSession()`으로 얻고 `source.act(session, {type: "run_shell", session, key: newId("shl", now()), command})`를 보낸 뒤 draft 글을 비운다. 실패하면 지금 문제 줄(`setProblem`)을 쓴다.
   - capability `shell`이 꺼진 곳(Home의 lophn agent 등)에서는 `!`가 보통 글이다.
5. **사람 shell 줄**(정한 것 21, 조사 §5)
   - `agent-tab-source.ts`에 `ThreadShell` entry(id, at, command, state, output 꼬리, exit code가 있으면 그것, `body`를 읽을 tool id)를 더한다.
   - `thread-layout.ts`의 `case "tool"`(지금 201줄): `by === "user"`인 tool item은 agent 덩어리·tool 묶음에 넣지 않고 `ThreadShell` entry로 그 `seq` 자리에 둔다. "Worked for"를 붙이지 않는다.
   - `agent-thread.tsx`가 `thread/shell-run.tsx`로 그린다. 사람 줄 자리(오른쪽 정렬, 사람 bubble과 같은 폭 규칙)에 "You ran" 작은 글과 mono `$ <command>` 머리, 바로 아래 출력 블록을 펼친 채로(20줄이 넘으면 `useFold`로 접는다), 끝나면 exit code(0이 아니면 경고색). 출력 글은 item `body.output`(harness)이거나 `toolCallBody`(lophn)로 읽는다. 도는 중이면 spinner.
   - `thread-layout_test.ts`에 case 하나를 더하지 않는다(화면 배치다). 지금 case가 깨지면 맞춘다.
6. **fork·rewind 줄**(정한 것 28): adapter와 core가 내는 "Forked from …"·"Rewound to …"는 `info` notice(turn null)다. `InfoRow`가 그대로 그리는지 fake scene으로 확인만 한다. 제목은 `session_changed`의 title로 머리가 바뀐다. 고칠 것이 없으면 보고에 "확인함"을 적는다.
7. **harness rewind 미리보기**(정한 것 28)
   - `agent-tab-gui-source.ts`의 `rewindPreview`(지금 175줄, 늘 unavailable)를 acp-round2의 IPC로 채운다: `{files: [{path, change}]}`를 `RewindPreviewView {files: [{path, skipped: null}], apps: []}`로 옮긴다. `GuiSourceDeps`에 그 IPC 함수를 받는 칸을 더하고 `terminal-gui.tsx`의 `guiAgentTabSource({...})`(지금 303줄)에서 넘긴다.
   - `rewindPoints`(지금 174줄, unavailable)는 feed 상태에서 top-level 사람 메시지(숨긴 구간 밖, steer 아님) id를 오래된 순으로 돌려준다.
   - rewind panel이 파일이 없는 harness 미리보기(`files: []`)를 "바뀐 파일 없음"으로 그리는지 보고, 모자라면 `session-rewind/`의 그 줄만 고친다.
   - `run_shell`은 다른 입력처럼 `act`가 `deps.input`으로 그대로 보낸다(지금 `act` 그대로면 고칠 것이 없다. 확인한다). core source는 `act`가 `AcpSend`로 그대로 보내 고칠 것이 없다(`agent-tab-core-source.ts:87`).
8. **터미널 탭 "채팅으로 열기"**(정한 것 27, 조사 `round2-core-tab.md` B §5)
   - `terminal-gui.tsx`의 `useGuiToggle`(지금 162줄)이 modal 확인을 거쳐 toggle하는 `start()`를 돌려주게 넓힌다.
   - `terminal-tab.tsx`(지금 101-125줄): 머리 단추 글을 "Chat"에서 "Open as chat"으로 바꾼다(`terminal.button.show-chat` key의 글). `useCardHead`에 `menu`를 더해 항목 하나 `open-chat`("Open as chat", dock 아이콘)을 둔다. 고르면 `toggle.start()`.
   - 보이는 조건: `agent !== undefined && isGuiHarness(agent.harness)`(hook만 들은 것도). 쓸 수 없으면 disabled에 이유를 단다: `foreground`가 아니면 "The CLI is not the foreground process of this terminal", `session`이 없으면 "The CLI has not reported its session yet (after the first message, or install the hook)". 머리 단추도 같은 조건으로 disabled에 tooltip.
   - GUI가 붙은 탭은 같은 자리에 "Open in terminal" 항목을 둔다.
   - main과 extension은 고치지 않는다(`main/terminal/gui.ts`, `harness-gui/index.ts`).
9. **fake와 gallery**(ui-design skill)
   - `agent-tab-fake-source.ts`: harness·lophn fake meta에 capability `shell`. fake `act`가 `run_shell`을 받아 `by: "user"` tool item(출력 몇 줄)을 더한다. harness 장면에 "Forked from …" info 한 줄과 긴 plugin 명령(`/plugin-name:a-very-long-command-name`) 하나.
   - `harness-gui.tsx` page: `harness-gui-shell-mode`(입력칸에 `!ls -la`를 친 모습), `harness-gui-shell-run`(사람 shell 줄과 펼친 출력), `harness-gui-rewind`(Claude rewind panel과 파일 미리보기), `harness-gui-slash-scroll`(↓를 12번 눌러 아래 줄이 보이는 메뉴). 기존 `harness-gui-slash-*`, `harness-gui-command-output`, `harness-gui-terminal-tab`이 새 avatar·메뉴·복사 단추로 그려지는지 본다.
   - 터미널 탭 page(`bodies.tsx`와 `mock/fake-terminal.ts`): foreground Claude TUI가 도는 탭 하나와 ⋯ 메뉴를 연 page(`terminal-open-chat`), session을 모르는 탭의 disabled 항목 page 하나.
   - lophn 쪽은 `agent-tab/` 장면 하나에 shell mode와 사람 shell 줄을 두고 `agent.tsx`·`agent-pages.tsx`에 page를 등록한다.
   - 문구는 `conversation.ts`·`project.ts` catalog key로 둔다. 새 lucide 아이콘(terminal 등)은 `icons/conversation.ts`.

## 끝남

- `npm run check`가 통과한다(`npm run check:full`과 두 core boot도).
- 위험 test: 없음(화면이다).
- 남지 않음: `grep -rn '"Chat"' packages/design/i18n/catalog/project.ts`가 0줄이다.
- `npm run wireframes`가 되고 위 page들이 renderer component로 그려진다.
- **보고 전에 바꾼 gallery page를 모두 직접 본다**: `npm run wireframes`로 build하고 `tools/wireframes/dist`를 `PYTHONUNBUFFERED=1 timeout 900 python3 -m http.server 0 -d tools/wireframes/dist`로 띄운 뒤, page마다 `timeout 60 google-chrome --headless=new --no-sandbox --disable-gpu --user-data-dir=.dev-data/screen-a/chrome --window-size=1600,1200 --virtual-time-budget=9000 --screenshot=<file>.png "http://127.0.0.1:<port>/index.html#/<page-id>"`(gallery 보기, `?frame=`이 아니다)로 찍고 PNG를 Read로 연다. 잘림·겹침·안 읽히는 글을 고친 뒤 보고한다. 보고에 본 page와 PNG 경로를 적는다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 특히 `agent-chat.md`에 넣을 문장(shell mode, 사람 shell 줄, 터미널 탭 메뉴)을 "넘길 줄"에 적는다.

## (lead가 더함)

- lophn agent의 `run_shell`은 명령이 끝날 때까지 답하지 않고, core는 끝난 뒤에야 `by: "user"` tool item을 낸다(core-shell). 그동안 입력칸 위나 thread 끝에 그 명령의 "도는 중" 줄을 보이고, item이 오거나 실패하면 지운다.
- `by: "user"` tool item은 `turn`이 null일 수 있다(acp-round2). `thread-layout.ts`는 turn 없는 그 줄을 agent 덩어리에 넣지 않고 사람 쪽 줄로 둔다("Worked for"를 붙이지 않는다).
