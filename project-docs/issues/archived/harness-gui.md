# harness-gui

닫은 이슈. 열린 것은 `project-docs/issues/harness-gui.md`.

## 창에 CLI session id가 보이지 않아 다시 열 id를 모른다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/renderer]
closed: fixed
guard: 없음
```

지금: 다시 열기는 `claude gui --resume <id>`다(그 CLI 자신의 session id, codex는 thread id, opencode는 session id). adapter 셋(`packages/shell/main/extensions/bundled/harness-gui/claude.ts`, `codex.ts`, `opencode.ts`)은 그 id를 어디에도 내지 않고, `AcpSessionHandle`(`packages/protocol/extensions/acp-session.ts`)에는 창 제목이나 머리에 값을 줄 길이 없다. 창 제목은 harness 이름과 cwd 끝 폴더뿐이다.

영향: 사람이 GUI 창에서 한 대화를 GUI로 다시 열려면 id를 다른 곳(TUI의 `claude --resume` 목록, `~/.claude/projects/` file 이름)에서 찾아야 한다.

고치려면:
- handle에 CLI session id를 알리는 칸(`describe({resume})` 같은 것)을 더하고 창 머리에 "claude gui --resume <id>"를 복사할 수 있게 보인다. 중간(계약 하나, adapter 셋, 창 머리). 추천.
- adapter가 첫 turn 앞에 그 명령을 글로 쓴 agent message를 하나 낸다. 작음. 대화에 lophn이 만든 글이 섞인다.

닫음: 별도 창이 없어졌다(계획 harness-gui-tab). GUI는 그 CLI를 친 터미널 탭 안에서 열리고, tracker가 탭의 CLI session id를 안다. 탭 머리 toggle이 같은 session으로 TUI와 오가고, 머리 session menu와 `/resume`이 그 CLI가 이 폴더에서 가진 지난 session을 보이고 같은 탭에서 바꾼다(`open_session`).

## GUI 창에 남은 채팅 화면 칸 몇이 눌러도 아무 일이 없다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/renderer]
closed: fixed
guard: 없음
```

지금: 창은 lophn 채팅 화면(`AgentView`)을 source(`packages/shell/renderer/conversation/agent-tab-gui-source.ts`)만 바꿔 쓴다. source의 `external`이 lophn 전용 칸은 숨기지만, 아래 칸은 화면에 남고 뒤가 비어 있다.
- 실패한 turn의 Retry: source는 `retry` 입력을 보내지만 `claude.ts`의 입력 switch가 `default`로 버린다(`codex.ts`, `opencode.ts`는 그 turn의 사람 메시지를 다시 보낸다).
- 줄에 선 메시지의 "지금 보내기": source는 `send_queued`를 보내지만 `claude.ts`와 `opencode.ts`가 버린다(SDK와 표준 protocol에 steer가 없다. `codex.ts`는 `turn/steer`로 넣는다).
- 이미지 붙이기: source의 `uploadImage`가 없어 붙이면 오류가 보인다. adapter도 사람 메시지에서 글과 `resource` block만 넘긴다.
- tool 줄 펼치기: `toolCallBody`가 `not_found`라 입력·출력 본문이 없고 제목과 상태만 보인다(ACP는 본문을 싣지 않는다).
- edit 카드의 [Open]과 file 경로 누르기: 창에 file을 여는 host가 없다.

영향: 사람이 누르면 아무 일이 없거나 오류를 본다. 이미지를 보내지 못한다.

고치려면:
- Retry: `claude.ts`도 codex·opencode처럼 그 turn의 사람 메시지를 다시 보낸다. 작음. 추천.
- 지금 보내기: steer가 없는 harness에서는 adapter가 표에 그 능력을 내고 창이 단추를 숨긴다. 작음.
- 이미지: 창의 이미지 올리기를 main으로 받고 adapter가 SDK의 image block으로 넣는다. 중간.
- tool 본문: adapter가 tool 입력·결과를 들고 handle에 본문 읽기를 더한다. 중간.
- [Open]: 창이 OS 기본 앱이나 lophn 문서 탭으로 연다. 작음.
- 당장 고치지 않는 칸은 `external`일 때 숨긴다. 작음.

닫음: 계획 harness-gui-tab. Claude도 `retry`를 그 turn의 사람 메시지로 다시 보낸다. 지금 보내기는 Claude `cancelAsyncMessage`, OpenCode `delivery: "steer"`로 한다. 이미지는 GUI source의 `uploadImage`가 main이 쓴 tmp file의 `file://` link를 싣는다. tool 본문은 ACP tool item `body`다. [Open]과 file 경로는 탭 host의 `openFile`이다. `external` 숨김은 capability 검사로 바뀌었다.

## CLI가 사람에게 묻는 요청이 질문 카드로 오지 않고 turn이 실패한다

```yaml
kind: bug
modules: [packages/shell/main]
closed: fixed
guard: `codex_test.ts`(requestUserInput)
```

지금: `codex.ts`는 승인 두 꼴(`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`) 밖의 서버 요청에 `-32601` 오류로 답한다. 그중 `item/tool/requestUserInput`이 Codex가 사람에게 묻는 요청이다. `opencode.ts`도 모르는 요청에 같은 오류로 답하고 OpenCode의 질문(elicitation) extension을 옮기지 않는다. 두 adapter 모두 `answer` 입력을 버린다. Claude만 AskUserQuestion을 질문 카드로 옮긴다.

영향: Codex나 OpenCode가 진행 중에 사람에게 물으면 창에 질문 카드가 뜨지 않고 그 tool이 오류로 끝나 turn이 실패하거나 엉뚱하게 이어진다.

고치려면:
- 그 요청을 ACP `question_asked`로 내고 `answer` 입력을 요청의 응답으로 돌려준다. 중간(harness마다 요청 꼴이 다르다). 추천.

닫음: 계획 harness-gui-tab. Codex `item/tool/requestUserInput`은 질문 카드이고 답을 질문 id로 돌려준다. OpenCode는 server API로 다시 짜며 `form.created`가 카드를 열고 `form.reply`·`form.cancel`로 답한다. omp `ask`도 질문 카드다.

## `claude`가 끝나면 그 GUI에서 더 이어 갈 수 없다

```yaml
kind: bug
modules: [packages/shell/main]
closed: fixed
guard: `packages/shell/main/extensions/bundled/harness-gui/claude_test.ts` "CLI가 끝난 뒤의 send는 같은 session id로 query를 다시 열어 그 메시지를 넣고, 못 열면 실패한 turn으로 끝난다"
```

지금: `claude.ts`는 SDK의 `for await`가 끝나거나 throw하면 `dead`를 두고 실패한 turn을 하나 낸다(`failure`). 그 뒤의 `send`는 사람 메시지를 보이고 곧바로 같은 오류로 실패한 turn이 된다(`sendText`). `dead`를 되돌리는 곳이 없고, session menu에서 같은 session을 고르면 `openSession`이 아무것도 하지 않는다.

영향: CLI가 죽거나 끝난 뒤에는 사람이 TUI로 넘겼다가 GUI로 다시 와야(새 adapter가 같은 session id로 resume한다) 이어 간다.

고치려면:
- 다음 `send`에서 같은 session id로 `reopen`해 query를 다시 열고 `dead`를 비운 뒤 그 메시지를 넣는다. 작음. 추천.
- GUI에 "CLI가 끝났다"를 보이고 입력창을 막는다. 작음. 이어 가기는 여전히 toggle로만 된다.

닫음: `dead` 뒤의 send는 같은 CLI session id로 query를 다시 열고(`revive`, 메시지가 없던 session은 `sessionId`) 그 메시지를 넣는다. 다시 열기가 실패하면 이유 줄과 함께 실패한 turn이다. `reopen`이 `dead`를 비우고, session menu에서 같은 session을 다시 고르면 다시 연다. 다시 열 때 돌던 `!` 명령은 끝나고 그 결과는 model에게 가지 않는다.

## Codex subagent 이벤트가 lane이 열리기 전이나 다시 연 뒤에 빠진다

```yaml
kind: defect
modules: [packages/shell/main]
closed: fixed
guard: `packages/shell/main/extensions/bundled/harness-gui/codex_test.ts` "spawn item보다 먼저 온 자식 thread 이벤트는 lane이 열릴 때 그 안에 들어간다"
```

지금: `codex.ts`는 `spawnAgent` item이 끝나 자식 thread id를 본 뒤에 자식 lane을 연다. 그 전에 온 자식 thread 이벤트는 모르는 thread라 버린다. 다시 열면(resume) 자식 대화를 `thread/turns/list`로 다시 그리지만 자식 thread를 구독하지 않는다.

영향: 녹화에서는 순서가 맞았지만 보장되지 않는다. 자식의 첫 메시지·tool 줄이 subagent 보기에서 빠질 수 있다. GUI를 다시 연 뒤 아직 도는 subagent는 흘러나오지 않고 끝날 때까지 멈춘 것처럼 보인다.

고치려면: 모르는 thread의 이벤트를 짧게 쌓아 두고 spawn item이 그 thread id를 알리면 lane에 붓는다. resume 때 도는 자식(`agentsStates`)마다 `thread/resume`으로 구독한다. 작음.

닫음: lane이 없는 thread의 이벤트는 thread마다 50개, 모두 200개까지 쌓았다가 spawn item이 그 thread를 알리면 순서대로 붓고, root turn이 끝나면 버린다. 다시 열면 `replayChildren` 뒤에 도는 자식마다 `thread/resume`(`excludeTurns: true`)을 보낸다. `thread/turns/list`와 자식 `thread/resume` 사이에 온 이벤트는 여전히 빠질 수 있다.

## thread index card의 bookmark 단추를 누르면 bookmark되지 않고 다른 메시지로 scroll된다

```yaml
kind: bug
modules: [packages/shell/renderer]
closed: fixed
guard: 없음
```

지금: `packages/shell/renderer/conversation/thread-index/thread-index.tsx`에서 hover card(`IndexCard`)는 rail `div` 안의 `Popover`로 그려진다. `Popover`는 portal로 그리지만(`packages/design/components/overlay/popover/popover.tsx`) React event는 React tree를 따라 올라간다. 그래서 bookmark 단추의 pointerdown이 rail의 `onPointerDown`(`down`)에 닿는다. `down`은 card 위치의 Y로 `positionAt`을 계산해 그 눈금의 메시지로 `go`하고, rail에 `setPointerCapture`를 건다. pointerup과 click이 rail로 가서 단추의 `onClick`(`bookmarks.toggle`)이 돌지 않는다.

영향: GUI와 lophn agent 채팅 화면 모두에서 bookmark를 걸 수 없고, 누를 때마다 엉뚱한 메시지로 scroll된다.

고치려면: `down`과 `move`가 rail DOM 밖(portal 안)에서 온 event를 무시한다(`event.currentTarget.contains(event.target as Node)`가 false면 return). 또는 `IndexCard`의 root에서 pointerdown 전파를 멈춘다. 작음. 앞의 것을 추천한다.

닫음: `thread-index.tsx`의 rail handler(pointer, key, wheel)가 rail DOM 밖(portal의 hover card)에서 올라온 event를 `inRail`로 거른다. bookmark 단추의 click이 단추에 닿는다.

## GUI view가 붙을 때 갱신을 처음부터 하나씩 받아 느리고, 지난 대화가 재생하듯 그려진다

```yaml
kind: bug
modules: [packages/shell/main, packages/shell/ipc, packages/shell/preload, packages/shell/renderer]
closed: fixed
guard: 없음
```

지금: handle은 publish된 갱신을 모두 배열에 쌓는다(`packages/shell/main/desktop/wiring/extensions.ts`의 `createAcp`). 흘러나온 글 조각(`writing_streamed`)도 버리지 않는다. view가 붙으면 `packages/shell/main/terminal/gui.ts`의 `connect`가 쌓인 갱신을 하나에 `webContents.send` 한 번씩 다시 보낸다. renderer는 그것을 `terminal-gui.tsx`의 feed와 `agent-tab-data.ts`에서 두 번 접고, 채팅 화면은 가상화 없이 대화 전체를 그린다.
- 다른 workspace에 갔다 오면 탭이 저장본에서 다시 만들어져 이 replay를 처음부터 받는다.
- restart toggle(TUI→GUI)과 `--resume`은 view가 먼저 붙고, 그 뒤 adapter의 replay(`claude.ts`의 `replay`)가 메시지 하나씩 publish한다. IPC 메시지 하나가 renderer의 task 하나라서 React가 갱신마다 대화 전체를 다시 그린다.

영향: 긴 session에서는 workspace를 오갈 때마다 GUI 탭이 한참 멈춘다. TUI에서 GUI로 넘기면 대화가 한 줄씩 다시 그려진다. handle의 메모리는 session 길이만큼 늘어난다.

고치려면:
- handle이 갱신 배열 대신 `reduceAcp`로 접은 `AcpState`를 들고, attach할 때 snapshot 하나와 그 뒤 갱신을 보낸다. 갱신은 tick마다 배열로 묶어 보내고, renderer는 묶음을 다 접은 뒤 한 번만 알린다. adapter가 지난 대화를 다시 그리는 동안은 묶음 하나로 보낸다. 중간. 추천. emdash(main이 접은 상태와 page), t3code(snapshot 뒤 live, 50ms 묶기), happy(최근 page와 `after_seq`)가 모두 이 꼴이다.
- 채팅 화면 가상화는 lophn agent와 같이 쓰는 화면이라 위를 한 뒤 다시 잰다.

닫음: handle(`packages/shell/main/desktop/wiring/extensions.ts`)이 갱신 대신 `reduceAcp`로 접은 `AcpState`를 쥔다. view가 붙으면 `terminal/gui.ts`가 snapshot 하나를 보내고, 이어지는 갱신은 20ms마다 배열로 묶어 보낸다. renderer feed(`terminal-gui.tsx`)는 묶음을 다 접은 뒤 한 번 알리고, snapshot이 오면 `source.changed`로 화면이 다시 읽는다. 채팅 화면 가상화는 하지 않았다.

## Claude GUI를 다시 열면 토큰 합계와 비용이 0부터 다시 센다

```yaml
kind: bug
modules: [packages/shell/main]
closed: fixed
guard: `packages/shell/main/extensions/bundled/harness-gui/claude_test.ts` resume usage test
```

지금: `claude.ts`의 `totals`·`cost`는 run 메모리에만 있고 `onResult`에서만 더한다. resume, TUI→GUI toggle, `open_session`은 새 run이거나 `resetStats`를 거쳐 0부터 시작하고, `replay`는 transcript의 사용량을 읽지 않는다. transcript에는 assistant entry마다 `message.usage`가 있다. CLI가 resume에 쓰는 `cost-state` entry(`totalCostUSD`, `modelUsage`)도 있다.

영향: GUI의 사용량 칸(input·output·cache token, turn 수, 비용)이 다시 열 때마다 앞 대화를 잃는다. TUI는 같은 session의 비용을 이어 센다.

고치려면: `replay`에서 transcript의 마지막 `cost-state`로 합계와 `cost.base`를 채운다. 없으면 assistant `message.usage`를 `message.id`와 `requestId`로 중복을 빼고 합한다(같은 message가 content block마다 반복된다). 작음. 추천.

닫음: `claude.ts`의 `restoreUsage`가 replay 끝에 transcript의 마지막 `cost-state`(없으면 assistant usage를 `message.id:requestId`로 중복을 빼고 합함)로 합계와 비용을 되살린다. 원본 줄은 SDK `importSessionToStore`로 메모리 store에 읽는다(@alpha). resume한 CLI의 `total_cost_usd`는 session 누적이라 되살린 비용은 `cost.last`에 둔다. 실패하면 조용히 넘어간다.

## 메시지를 보내지 않은 TUI session에서 GUI로 넘기면 resume이 실패한다

```yaml
kind: bug
modules: [packages/shell/main]
closed: fixed
guard: `claude_test.ts`·`codex_test.ts`·`opencode_test.ts`·`omp_test.ts`의 unsaved session test
```

지금: TUI→GUI toggle은 tracker가 아는 TUI session id를 `resume`으로 넘긴다(`packages/shell/main/terminal/gui.ts`의 `open` → `index.ts`의 `gui` → `adapter.start`). 첫 메시지 전의 session은 CLI가 저장하지 않는다.
- Claude: `claude.ts`의 `start`가 없는 id로 `resume`을 열고, `replay`도 그 id를 읽는다. 다시 보내도 같은 id로 다시 열어 계속 실패한다.
- Codex: `codex.ts`의 시작이 `thread/resume`을 그대로 보내고, rollout이 없으면 시작이 실패한다.
- OpenCode는 `api.get`이 실패하면 새 session을 만들지만, 실패한 turn("could not be loaded")을 남긴다.

영향: `claude`·`codex`를 켜고 바로 "Open as chat"을 누르면 GUI를 쓸 수 없다.

고치려면: `start`가 resume 대상이 저장돼 있는지 먼저 보고, 없으면 조용히 새 session을 연다. Claude는 `getSessionInfo`가 없으면 `sessionId: resume`(같은 id, 새 session)으로 연다. Codex는 rollout이 없으면 `thread/start`다. OpenCode는 빈 session이면 실패 줄을 내지 않는다. omp도 `--resume`의 같은 경우를 확인한다. 작음. 추천.

닫음: Claude는 `getSessionInfo`가 없으면 같은 id로 새 session(`sessionId`)을 연다(`start`, `open_session`). Codex는 `thread/resume`이 "no rollout found"면 `thread/start`다. OpenCode는 `api.get`이 404면 실패 줄 없이 새로 연다. omp는 `--resume`으로 띄운 process가 ready 전에 끝나면 `--resume` 없이 다시 띄운다.

## GUI 탭 이름이 shell 제목(`user@host: ~/폴더`)으로 덮인다

```yaml
kind: bug
modules: [packages/shell/renderer]
closed: fixed
guard: `packages/shell/renderer/terminal/model_test.ts` tabName GUI title cases
```

지금: GUI는 ACP session 제목을 `GuiSwitch`의 `onTitle`로 `tab.title`에 쓴다(`packages/shell/renderer/terminal/terminal-gui.tsx`). 그런데 `packages/shell/renderer/workspace/workspace-window.tsx`가 terminal store가 바뀔 때마다 모든 터미널 탭의 `title`을 `terminalTabTitle`(사람 이름 > hook session 이름 > agent가 있는 동안의 마지막 OSC 제목 > 자동 이름)로 다시 쓴다. 이 계산은 GUI 제목을 모른다. GUI 동안 그 터미널의 마지막 OSC 제목은 TUI가 끝난 뒤 shell prompt가 낸 `user@host: 경로`다.

영향: GUI 탭 이름이 session 이름이 아니라 shell 제목으로 보인다. 같은 대화를 TUI로 열면 session 이름이 보인다.

고치려면: GUI 제목을 탭 field(예: `guiTitle`)에 두고, `tabName`이 GUI view일 때 사람 이름 다음으로 그것을 쓰게 한다. 그때는 OSC 제목을 보지 않는다. sidebar의 `otherWorkspaceTerminalTitle`도 같은 계산을 쓴다. 작음. 추천.

닫음: `GuiSwitch`가 ACP session 제목을 탭 field `guiTitle`에 쓰고, `tabName`이 GUI view일 때 사람 이름 다음으로 그것을 쓴다(OSC 제목과 hook session 이름은 보지 않는다). TUI로 가거나 handle이 닫히면 지운다.
