# screen-b

사람이 써 보고 찾은 화면 결함(README 정한 것 20, 23, 24, 25, 26) 가운데 model picker, harness session menu와 `/resume`, subagent 보기의 이동을 고친다. model picker 접기와 switch 축은 lophn agent의 picker(대화 composer와 agent 편집의 기본 model 칸)에도 같다.

- 단위: screen (wave 11)
- 선행: screen-a. 같은 `agent-view.tsx`·`agent-tab-gui-source.ts`·`terminal-gui.tsx`를 고친다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/model-picker/{model-picker.tsx,model-picker.module.css,types.ts}`
  - `packages/shell/renderer/conversation/use-model-picker.ts`
  - `packages/shell/renderer/conversation/header/{agent-header.tsx,agent-header.module.css,session-popover.tsx,session-popover.module.css}`
  - `packages/shell/renderer/conversation/{agent-view.tsx,agent-view.module.css}`
  - `packages/shell/renderer/conversation/dock/{child-view.tsx,child-view.module.css}`
  - `packages/shell/renderer/conversation/{agent-tab-gui-source.ts,agent-tab-fake-source.ts,agent-tab-source.ts}`
  - `packages/shell/renderer/terminal/terminal-gui.tsx`(GUI source에 session 목록 IPC를 넘기는 줄만)
  - `packages/shell/renderer/workspace/agents/editor/model-field.tsx`(접기 상태를 넘겨야 하면 그 줄만)
  - `packages/shell/renderer/icons/conversation.ts`
  - `packages/design/i18n/catalog/conversation.ts`(key만)
  - `tools/wireframes/pages/screens/{harness-gui.tsx,agent.tsx,agent-pages.tsx,agent-settings.tsx}`, `tools/wireframes/pages/screens/agent-tab/`
- 읽을 것:
  - 조사 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/round2-screen.md` §1, §6, §7, §8
  - 지금 code: `packages/shell/renderer/shell/card-head.tsx`(`CardHeadSpec.nav`), `packages/shell/renderer/browser/browser-chrome.tsx:266-275`(nav를 덮는 본보기), `packages/shell/renderer/shell/content-card.tsx:317-372`(`CardHead`가 `spec.nav ?? 창 기록`을 쓴다)
  - architecture: `project-docs/architecture/agent-chat.md`, `harness-gui.md`, `acp.md`
  - ui-design skill
- 계약:
  - 쓰는 것(acp-round2가 wave 9에 정한다. main이 정본이다): capability `resume`, 입력 `open_session {session, key, cli_session}`, 갱신 `session_reset`, model 축 `kind: "choice" | "switch"`, `ACP_COMMAND_OPENS`의 `resume`, `HarnessGuiTabApi`의 session 목록 IPC. screen-a가 남긴 화면
  - 내놓는 것: 없음(마지막 화면 task다)

## 할 일

1. **model picker: Roles와 접기**(정한 것 25, 조사 §8)
   - `PickerBody`(`model-picker.tsx`, 지금 188-298줄)의 순서를 바꾼다: Roles(`RolesSection`) → lophn 층 줄 → 검색 → 목록 → 축 → Manage models. Roles는 omp만 있다.
   - `ProviderHeading`을 단추로 바꾼다: chevron, 묶음 이름, model 수. `aria-expanded`.
   - 기본은 지금 model의 묶음만 펼친다. 묶음이 하나뿐이면 늘 펼친다. 검색어가 있으면 접기를 무시하고 맞는 묶음을 다 펼쳐 보인다(접힌 상태는 지우지 않고 검색을 비우면 돌아간다).
   - 펼친 상태는 picker를 닫았다 열어도 그 탭이 열린 동안 남는다(`use-model-picker.ts`의 state, 저장하지 않는다). agent 편집의 `ModelPickerField`(`model-field.tsx`)도 같은 `PickerBody`라 같은 규칙이다. 그쪽 state 자리가 필요하면 `model-field.tsx`에 그 줄만 더한다.
   - 키보드: 묶음 머리는 focus를 받고 Enter·Space로 펼치고 접는다. ↑/↓는 보이는 머리와 줄 사이를 옮긴다(검색칸에서 ↓는 첫 줄로). 머리에서 →는 펼치고 ←는 접는다.
2. **switch 축**(정한 것 24, 조사 §7)
   - `OptionAxes`(지금 73-105줄): `kind: "switch"` 축은 한 줄에 이름과 design `Switch`(`@lophn/ui/input`의 switch)로 그린다. 켜면 값 `on`, 끄면 `off`로 `onOptionChange`. `kind: "choice"`는 지금 segmented 그대로.
   - `PickerAxisView`(`types.ts`)와 `use-model-picker.ts`가 `kind`를 옮긴다. picker 단추에 붙는 축 요약에서 `switch`는 켠 것만 이름으로 붙인다(예: "Sonnet 5.5 · High · Fast").
   - composer chip(`toggles`)은 화면에서 손대지 않는다. adapter가 fast·thinking·speed를 축으로 옮기면 chip은 저절로 Codex plan·OpenCode auto-accept만 남는다.
3. **harness session menu와 `/resume`**(정한 것 23, 조사 §6)
   - `agent-header.tsx`(지금 209-232줄): capability `sessions`가 없고 `resume`이 있으면(harness) `SessionSwitcher`를 목록·바꾸기·새로만 있는 꼴로 그린다(이름 바꾸기·archive·delete·메시지 찾기는 숨긴다. 그 칸은 `sessions`일 때만이다). trigger 글은 지금처럼 face · 제목.
   - `SessionSwitcher`(`session-popover.tsx:132`)의 열림을 바깥에서 열 수 있게 `open`·`onOpenChange`를 받는 controlled 꼴을 더한다(안 주면 지금처럼 스스로 든다).
   - `agent-tab-gui-source.ts`의 `sessions()`(지금 빈 배열)를 acp-round2의 session 목록 IPC로 채운다: `{id, title, updated_at}`을 `SessionEntry {id: cli_session, title, status: "idle", activeAt: updated_at, archived: false}`로. `GuiSourceDeps`에 그 IPC 칸을 더하고 `terminal-gui.tsx`에서 넘긴다. 지금 열린 CLI session(`meta.cli_session`)을 현재로 표시한다.
   - 바꾸기: harness면 `host.switchSession`(lophn session 바꾸기)이 아니라 `source.act(session, {type: "open_session", session, key, cli_session})`를 보낸다. 화면의 session id(`ses_…`)는 그대로이고 `session_reset`이 오면 reducer가 상태를 비워 다시 그린다(acp-round2). 바꾸는 동안 header에 busy 표시.
   - 새로: harness면 `meta.commands`에서 이름이나 별칭이 `new`인 명령을 찾아 `run_command`로 보낸다(Claude `clear`, Codex·OpenCode·omp `new`). 없으면 새로 항목을 숨긴다.
   - `/resume`: `agent-view.tsx`의 `runSlash` 표(`Record<AcpCommandOpens, …>`)에 `resume`을 채운다. session menu를 연다(`open` state를 `agent-view.tsx`가 들고 `AgentHeader`로 넘긴다). acp-round2가 둔 자리표시 줄이 있으면 바꾼다.
   - lophn agent는 지금 session menu 그대로다(`sessions` capability).
4. **subagent 보기를 머리 ←/→로**(정한 것 26, 조사 §1)
   - `dock/child-view.tsx`의 Back 머리 줄을 지운다. 상태·model·경과는 머리 lead로 옮긴다. 아래 steer 줄은 그대로.
   - `agent-view.tsx`: 자식 path(`layer {kind: "child", path}`, 지금 132-137·340-343줄) 옆에 forward stack 하나를 둔다. 뒤로는 path 한 칸 pop하고 뺀 자식을 forward에 쌓는다. 앞으로는 forward에서 꺼내 path에 다시 넣는다. 새 자식을 열면 forward를 비운다. 자식 보기를 닫는 다른 길(layer null)도 forward를 비운다.
   - `AgentHeader`에 `child: {label, model, state, startedAt} | null`과 `nav: {canBack, canForward, onBack, onForward} | null` prop을 더한다(`subagentOfChild`가 값을 만든다). 자식이 열려 있으면 `useCardHead`에 `nav`를 올린다(`browser-chrome.tsx:266-275`와 같은 꼴). 닫혀 있으면 `nav`를 올리지 않아 창 기록(`workspace-window.tsx`의 trail)이 그대로다.
   - lead: 자식이 열려 있으면 `AgentFace · {agent} › {subagent 이름} · subagent`, 뒤에 상태 점·model·경과를 작은 글로. card 밖(detached 창, `inCard` false)이면 `ViewBar` lead 앞에 ← 단추 하나를 둔다.
   - lophn agent 탭도 같은 `agent-view.tsx`라 같은 코드로 된다.
5. **fake와 gallery**(ui-design skill)
   - `agent-tab-fake-source.ts`: harness fake meta에 capability `resume`과 session 목록 셋, `open_session`을 받아 `session_reset` 뒤 다른 대화를 그리는 fake. Claude model에 `switch` 축 둘(Fast, Thinking), Codex 얼굴 장면에 Speed `switch` 축. lophn fake에 provider 묶음 셋 이상.
   - page: `harness-gui-resume`(session menu를 연 모습), `harness-gui-picker`(Roles 맨 위와 접힌 묶음, omp), `harness-gui-picker-switch`(Claude Fast·Thinking switch), `harness-gui-subagent`를 머리 ←/→와 새 제목으로 다시 그린다. lophn은 `new-agent-model-picker`(`agent.tsx`)를 접힌 묶음으로, agent 편집의 기본 model page(`agent-settings.tsx`)가 있으면 같이 본다.
   - 문구는 `conversation.ts` catalog key, 새 lucide 아이콘(chevron 등)은 `icons/conversation.ts`.

## 끝남

- `npm run check`가 통과한다(`npm run check:full`과 두 core boot도).
- 위험 test: 없음(화면이다).
- 남지 않음: `grep -rn "onBack" packages/shell/renderer/conversation/dock/child-view.tsx`가 0줄이다.
- `npm run wireframes`가 되고 위 page들이 renderer component로 그려진다.
- **보고 전에 바꾼 gallery page를 모두 직접 본다**: `npm run wireframes`로 build하고 `tools/wireframes/dist`를 `PYTHONUNBUFFERED=1 timeout 900 python3 -m http.server 0 -d tools/wireframes/dist`로 띄운 뒤, page마다 `timeout 60 google-chrome --headless=new --no-sandbox --disable-gpu --user-data-dir=.dev-data/screen-b/chrome --window-size=1600,1200 --virtual-time-budget=9000 --screenshot=<file>.png "http://127.0.0.1:<port>/index.html#/<page-id>"`(gallery 보기, `?frame=`이 아니다)로 찍고 PNG를 Read로 연다. 잘림·겹침·안 읽히는 글을 고친 뒤 보고한다. 보고에 본 page와 PNG 경로를 적는다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. 특히 `agent-chat.md`에 넣을 문장(picker 접기·switch 축, harness session menu, subagent 보기 이동)을 "넘길 줄"에 적는다.
