# screens-conversation-view

Agent 탭을 조립하고 옛 대화 화면을 지운다. 앞선 task들이 만든 부품(header, 대화 줄, 카드, composer, rewind panel)을 `AgentView`에 묶고, 호스트가 쓰는 이름(`AgentViewSourceFactory`, `coreAgentViewSourceFactory`, `AgentTab`)을 새 구현으로 가리킨 뒤, 옛 source·core source·부품을 지운다. gallery의 대화 page도 이 task가 한꺼번에 옮긴 component로 갈아탄다.

- 단위: screens-conversation (wave 3)
- 선행: screens-conversation-thread, screens-conversation-cards, screens-conversation-composer, screens-conversation-sessions, screens-conversation-core-source
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/` 의 루트 file: `agent-view.tsx`, `agent-view.module.css`, `agent-view-model.ts`, `agent-thread.tsx`, `agent-notices.tsx`, `agent-notices.module.css`, `agent-source.ts`, `agent-view-data.ts`, `agent-core-source.ts`와 `agent-core-source-*.ts`, `bodies.ts`
  - `packages/shell/renderer/conversation/testdata/` (지운다)
  - 앞선 task가 가진 폴더(`message-list/`, `activity/`, `question-card/`, `approval-card/`, `composer/`, `slash-menu/`, `model-picker/`, `header/`, `rewind/`)의 남은 옛 file을 지운다(선행 task가 merge된 뒤이므로 이 task가 지울 수 있다)
  - `packages/shell/renderer/workspace/agent/` (Agent 탭)
  - `packages/shell/renderer/workspace/visuals/` (추가 소유, lead 승인 2026-10-16: `ownership.md`상 screens-project 몫이나 쓰는 곳이 대화뿐이다)
  - wireframe의 대화 쪽: `tools/wireframes/frames/compositions/agent-tab/`, `tools/wireframes/frames/compositions/agent-chat.tsx`, `tools/wireframes/frames/compositions/conversation.tsx`, `tools/wireframes/frames/compositions/slash-menu.tsx`, `tools/wireframes/frames/compositions/session-switcher.tsx`, `tools/wireframes/frames/compositions/model-picker.tsx`, `tools/wireframes/frames/compositions/agent-pages.tsx`
  - `packages/design/wording/catalog/conversation.ts`와 생성물 `catalog/conversation.placeholders.ts` (wording-split이 만든 영역 file. ownership.md에 없어 추가 소유, lead 승인 2026-10-16)
- 읽을 것:
  - spec: S1 8장, S3 5장, S4 3·7장, S8 3~5장 — 앞선 brief들의 spec 줄
  - inventory: `U1.1#7`(dock·Roles·provider 계정의 흔적), `U1.2#2`(표·차트·도표 시각 블록 지우기), `U1.2#3`(시각 블록의 [Save as document]·`SaveState`·저장된 문서 링크 지우기), `U2.2#18`(시각 블록은 앱 카드만), `U2.1#1`(polling 지우기), `U6.5#3`
  - 지금 코드: `conversation/agent-view.tsx`(667줄: `AgentViewHost`, `AgentViewProps`, `AgentView`), `agent-thread.tsx`(304줄), `workspace/agent/agent-tab.tsx`(`AgentTab`이 `slice.factory`로 source를 얻는다), `workspace/visuals/{registry.ts, block-frame.tsx, app-card-block.tsx, chart-block.tsx, chart-plan.ts, diagram-block.tsx, table-block.tsx, document-block.tsx}`
  - 본보기(화면): `tools/wireframes/frames/compositions/conversation.tsx`(553줄), `agent-chat.tsx`(`ChatShell` 틀), `agent-tab/scenes.tsx`(466줄), `agent-pages.tsx`
- 계약:
  - 쓰는 것: 앞선 task의 component와 `AgentTabSource`·`AgentTabSourceFactory`·`coreAgentTabSourceFactory`, `useAgentTabData`, `useWaiting`(질문·승인 카드를 이 session의 대기 항목에서)
  - 내놓는 것(호스트가 기대는 이름을 유지한다):
    - `AgentView`, `AgentViewHost`(칸을 더하기만 한다: 새 `openFile(path: string)`. 지금 호스트가 채우는 `openResult`, `openPermissions`, `openAgentSettings`, `openForked`, `showUsage`, `closeTab`, `attach`, `openConnections`는 그대로 둔다)
    - `AgentTab` props는 더하기만 한다.
    - `conversation/agent-source.ts`: 옛 interface를 지우고 `AgentViewSourceFactory = AgentTabSourceFactory`와 호스트가 쓰는 type만 다시 내보내는 얇은 file이 된다(호스트가 새 이름으로 갈아탄 뒤 cleanup이 지운다).
    - `conversation/agent-core-source.ts`: `coreAgentViewSourceFactory(core)`를 `coreAgentTabSourceFactory`의 재export 한 줄로 바꾼다(`desktop/entry.tsx`가 이 이름과 경로를 쓴다).

## 할 일

1. `agent-view.tsx`를 새로 조립한다. 위에서 아래로 header(sessions task) → 대화 줄(thread task의 turn·chip·call 블록·tool 줄·편집 카드·오류 메시지, 시각 블록은 앱 카드만) → composer 위 영역(질문·승인 카드는 cards task, "Next turn" 줄은 composer task) → composer. rewind·권한·recap은 대화 화면 안 panel 층으로 연다. 읽기는 `useAgentTabData`, 대기 항목은 `useWaiting()`에서 이 session 것만 거른다. 근거: `U2.1#1`.
2. `agent-view-model.ts`와 `agent-thread.tsx`를 새 `ThreadEntry`로 다시 쓴다. 사용자 달력의 Today·Earlier 가름, 시각 글 바꾸기, 전달 상태 표시(보내는 중·접수됨·못 보냄·접수 확인 안 됨)는 옛 규칙을 옮긴다. `saveVisual`, `visualSaveState`, `SaveRequest` 쓰는 곳은 지운다.
3. `workspace/agent/agent-tab.tsx`를 고친다. 같은 agent와 place의 탭이 하나의 source를 쥐는 규칙과 탭 제목을 agent 이름으로 알리는 규칙은 그대로다. `place`에 `lophn`(place 없음)도 받는다.
4. 이름을 가리킨다. `AgentViewSourceFactory`를 `AgentTabSourceFactory`의 별칭으로, `coreAgentViewSourceFactory`를 재export로 바꾸고, 옛 interface `AgentViewSource`와 쓰던 type을 지운다. 호스트 file(`workspace/kinds/host.ts`, `app-frame/agent-pane.tsx`, `desktop/entry.tsx`·`main.tsx`·`dev-mock/mod.ts`)은 이 task가 고치지 않는다. 그 file들이 컴파일되게 이름과 인자 모양만 유지한다.
5. 옛 file을 지운다: `agent-view-data.ts`(3초 polling `POLL_MS`·`intervalTicks`), `agent-core-source-{commands,env,face,link,model,notices,rewind,thread,values}.ts`, `testdata/`, 선행 task 폴더의 쓰이지 않게 된 옛 file(`message-list/`의 옛 turn, `rewind/rewind-menu.tsx`, `approval-card`의 옛 모양 등). 지우기 전에 `grep`으로 호스트 쪽 import가 없는 것을 확인한다.
6. 시각 블록을 앱 카드로 줄인다. `workspace/visuals/`에서 `chart-block.tsx`, `chart-plan.ts`, `diagram-block.tsx`, `table-block.tsx`, `document-block.tsx`와 `registry.ts`의 해당 갈래, `block-frame.tsx`의 `SaveState`·`SaveRequest`·저장 단추를 지운다. `app-card-block.tsx`와 앱 카드를 그리는 `registry.ts`·`block-frame.tsx`의 최소 부분만 남긴다. 근거: `U1.2#2`, `U1.2#3`, `U2.2#18`.
7. 이름 흔적을 지운다. `conversation.title.dock`, `conversationIcons.dock`(`packages/shell/renderer/icons/`는 screens-workspace 소유이므로 목록만 보고에 적는다), `conversation.*save-visual*` wording key. `roles.*`(298키)와 `settings.accounts.*`는 다른 단위(screens-agents, screens-workspace)가 쓸 수 있으므로 이 task에서 지우지 않는다(보고의 안 쓰게 된 것에 적는다). 근거: `U1.1#7`.
8. gallery를 옮긴 component로 바꾼다.
   - `conversation.tsx`의 `Conversation`이 renderer `AgentView`를 `createFakeAgentTabSource({ scene })`로 그린다(`tab.sub`가 scene을 고른다). export 이름과 props(`Conversation`, `TabState`, `SessionHandlers`)는 `project-app.tsx`가 쓰므로 유지한다.
   - `agent-chat.tsx`는 다른 단위의 page(`contexts/pm-session.tsx`, `app-space/side-pane.tsx`)가 `ChatShell`, `AgentTurn`, `Said`, `Quiet`, `UserMessage`, `ToolRow`를 import하므로 이 이름·props를 유지한 채 안을 renderer component로 바꾼 얇은 adapter로 둔다.
   - `agent-tab/call-block.tsx`도 `app-space/side-pane.tsx`가 쓰므로 renderer `CallBlock`의 재export로 둔다. `agent-tab/`의 나머지(`cards.tsx`, `data.ts`, `queued.tsx`, `permissions-view.tsx`, `recap.tsx`, `rewind-panel.tsx`, `sender.tsx`, `app-card.tsx`, `error-message.tsx`)는 지운다. `scenes.tsx`는 `createFakeAgentTabSource({ scene })`로 그리는 얇은 file이 된다. `agent-pages.tsx`의 export 이름은 그대로 둔다.
   - `slash-menu.tsx`, `session-switcher.tsx`는 지운다. `model-picker.tsx`는 `agent-setup/`(screens-agents)가 `ModelField`, `OptionAxes`를 import하므로 renderer `conversation/model-picker/`의 재export로 두고 `FavoritesContext`·`FAVORITE_START`도 함께 내보낸다(`project-app.tsx`가 쓴다).
   - 공용 file인 `agents-data.ts`, `agent-avatar.tsx`, `models-data.ts`, `model-options.ts`, `agents.module.css`, `compose.module.css`는 고치지 않는다(lead 몫).

- (lead가 더함, screens-conversation-sessions가 넘긴 것) 새 header는 옆 file로 만들어졌다. `header/agent-view-bar.tsx`(`AgentHeader`, `AgentHeaderHost`)와 `header/session-switcher.tsx`(`SessionSwitcher`, `AgentFace`, `QueuedCodingView`)다. 옛 `header/agent-header.tsx`·`session-popover.tsx`(+css)·`types.ts`, `rewind/rewind-menu.tsx`·`rewind/hidden-range.tsx`(+css)를 지운 뒤 새 file을 brief 이름(`agent-header.tsx`, `session-popover.tsx`)으로 옮긴다. `AgentHeader`에는 `source`, `host`, `onChanged`, `session`, `sessions`, `now`를 넘기고 `progress`·`detail`(`ViewDetailSelect`) slot을 채운다. `RewindPanel`(`session-rewind/rewind-panel.tsx`)에는 `source`와 `excerpt`를 넘긴다. 옛 file과 같이 지울 wording key: `conversation.button.{restore,rewind,redo,summarize-go,summarizing,usage}`, `conversation.label.{rewind-restore-all,rewind-messages-only,rewind-summarize,rewind-point}`, `conversation.rewind.hint-*`, `conversation.rewind.summary-failed`, `conversation.rewind-block.*`. `AgentTabSource.unarchiveSession`은 S8에 없으니 interface와 fake·core source에서 지운다. 기다리는 coding 맡기기(`queuedCoding`)는 사람 화면이 읽을 route가 아직 없어 빈 채로 둔다.

- (lead가 더함, screens-conversation-thread가 넘긴 것) 새 component: `message-list/agent-turn.tsx`(`AgentTurn`은 `agent: {name, profile}`를 받는다. gallery adapter가 맞춘다), `thread/{sender-chip,received-message,call-block,provider-error}.tsx`, `activity/file-edit-card.tsx`(Undo 없음, [Open]은 `onOpen`), `file-links.tsx`(`FileLinks`, `onOpenFile(path)`). view가 한다: `ThreadMessage.actor === "received"`면 `ReceivedMessage`, `replyTo`는 같은 call id의 `CallView.task` 글을 찾아 넘긴다, `UserMessage`에 `steer = delivery === "steer"`, `ThreadCall`은 `CallBlock`으로, `AgentViewHost.openFile(path)`를 더한다. 옛 `MessageTurns`·`TurnItem`, `UserBody`·`MachineFact`, `activity/edit-card.tsx`·`EditView`, `result-links.tsx`(+css), call용 `ToolLine` 쓰임을 걷고, 그때 `conversation.label.{send-correction,send-request,correction}`도 지운다. `ThreadMessage`에 결과 링크 칸이 없으니 `FileLinks`는 편집 카드 경로로만 쓰고 결과 링크는 그리지 않는다(lead 결정).
- (lead가 더함, screens-conversation-core-source가 넘긴 것) `coreAgentTabSourceFactory(core)`로 바꾸고 옛 `agent-core-source*.ts`를 지운다(옛 `ConfirmationRequest`·`OpenConfirmation`, `confirmWithoutWindow`·`openConfirmation` 쓰임도 같이). `unarchiveSession` 줄은 interface와 함께 지운다. 추가 소유(lead 승인): `renderer/desktop/waiting/decide.ts`. 지금 `approvals/decide` command를 envelope 없이 보내 `invalid_input`으로 거절된다. `{input, idempotency_key, compare, prepared: []}`로 보내고, 대화 source의 허락 결정과 한 helper로 합친다.
- (lead가 더함, screens-project-window가 넘긴 것) project sidebar의 session 줄(`workspace/sidebar/panel-sessions.ts`)은 `useSessions`에 제목·시각이 없어 "New session"·`at: 0`이다. 대화 source가 제목을 주면 그 file의 줄만 채운다(추가 소유, lead 승인).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "intervalTicks\|POLL_MS\|AgentViewSource\b\|SaveRequest\|\"correction\"" packages/shell/renderer/conversation packages/shell/renderer/workspace/agent packages/shell/renderer/workspace/visuals`가 0줄이다(호스트 file 안의 `AgentViewSourceFactory` 이름은 남는다. 이 grep에는 `\b`로 걸리지 않는다).
- (화면) `deno task wireframes`가 되고, gallery의 `new-agent-conversation`, `new-agent-queued-message`, `new-agent-sender-chips`, `new-agent-call-open`, `new-agent-call-replies`, `new-agent-question`, `new-agent-question-answered`, `new-agent-question-ended`, `new-agent-approval`, `new-agent-approval-deny`, `new-agent-approval-settings`, `new-agent-approval-states`, `new-agent-commands`, `new-agent-commands-filtered`, `new-agent-recap`, `new-agent-permissions`, `new-agent-model-picker`, `new-agent-request-error`, `new-agent-rewind`, `new-agent-sessions`, `new-agent-sessions-edit`, `new-agent-session-archived`가 옮긴 component로 그려진다.

## 보고

- 바꾼 file
- 등록할 것: gallery `pages.ts`는 바뀌지 않는다. `desktop/dev-mock/mod.ts`의 `agentViewSource` 조립이 새 factory를 쓰는지 lead가 확인. 영역 `conversation`의 지운 key(생성물 `*.placeholders.ts`는 이 task가 `generate.ts`로 갱신한다).
- 안 쓰게 된 export: `AgentViewHost.openResult`(호스트가 `openFile`로 갈아타면), `AgentViewSourceFactory`·`coreAgentViewSourceFactory` 이름(cleanup이 새 이름으로 바꾼다), `roles.*`·`settings.accounts.*` key, 아이콘 `conversationIcons.dock`·`lophnSpaceIcons.roles`
- 정한 것: panel 층(rewind·권한·recap)이 서로 겹칠 때 하나만 여는 규칙, 호스트 인자 `assignment` 칸 이름을 그대로 둔 것
- 계약 바꾸기 요청(wave 3): 없으면 없음
