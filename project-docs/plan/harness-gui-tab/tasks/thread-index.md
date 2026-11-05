# thread-index

대화 왼쪽 가장자리에 thread index rail을 둔다(README 정한 것 17). 기준은 Codex 데스크톱의 `AppThreadUserMessageNavigationRail`이다:

- 사람 메시지가 4개 이상일 때만 그린다. 눈금 하나가 사람 메시지 하나다.
- 눈금 길이: 평소 6px, hover한 것 26px, 이웃 20/14/10px.
- hover card: 그 메시지 첫 줄, 답 미리보기 2줄, bookmark 단추. 기존 popover를 쓴다.
- 조작: 누르면 그 turn으로 간다. 끌어서 훑는다. Alt+↑/↓로 앞뒤로 간다.

bookmark는 shell data 쪽 file 하나에 둔다. lophn agent와 harness가 같이 쓰고 session 기준이다. harness 대화는 ledger에 없어서다. rail과 hover card, bookmark 저장(main store, IPC, preload API)을 이 task가 만들고, 대화 화면에 mount하는 것도 이 task가 한다.

- 단위: screen (wave 7)
- 선행: screen-dock
- 소유(이 task만 고친다):
  - `packages/shell/main/thread-bookmarks/`(새로: store, store test, IPC handler)
  - `packages/shell/main/desktop/wiring/thread-bookmarks.ts`(새로. `main/desktop/main.ts`에 넣는 줄은 lead가 넣는다)
  - `packages/shell/ipc/thread-bookmarks.ts`(새로)
  - `packages/shell/preload/thread-bookmarks-api.ts`(새로. `preload/shell.ts`에 노출하는 줄은 lead가 넣는다)
  - `packages/shell/renderer/conversation/thread-index/`(새로: rail, hover card)
  - `packages/shell/renderer/conversation/agent-view.tsx`, `packages/shell/renderer/conversation/message-list/thread-scroll.tsx`(mount와 Alt+↑/↓ 줄만)
  - `packages/shell/renderer/icons/conversation.ts`(bookmark 아이콘)
  - `packages/design/components/overlay/popover/`(지연 없는 hover 열기가 안 될 때만 변형을 더한다)
  - `packages/design/i18n/catalog/conversation.ts`(여러 task가 key만 더한다)
  - `tools/wireframes/pages/screens/{conversation.tsx,harness-gui.tsx,agent-pages.tsx}`(thread index, hover card page)
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/ui-reference.md` §3 전부, 부록 C. 저장 자리는 README 정한 것 17(shell data file)을 따른다. `ui-reference.md`의 ledger 추천은 쓰지 않는다
  - 본보기(저장과 IPC): `packages/shell/main/browser/bookmarks.ts`, `packages/shell/main/browser/bookmark-ipc.ts`, `packages/shell/main/desktop/wiring/bookmarks.ts`(browser bookmark, 이름이 겹치니 쓰지 않는다), 원자 쓰기 `packages/shell/main/workspace/atomic-file.ts`
  - 화면: `packages/shell/renderer/conversation/thread-layout.ts`(사람 메시지 entry), `message-list/agent-turn.tsx`의 `copyText`(답 미리보기), `message-list/follow.ts`(끝 따라가기)
  - architecture: `project-docs/architecture/agent-chat.md`, `harness-gui.md`
  - ui-design skill
- 계약:
  - 쓰는 것:
    - acp-more의 message `origin`, meta `cli_session`·`harness`
    - screen-thread·screen-dock이 남긴 `agent-view.tsx`와 thread layout
  - 내놓는 것:
    - data file `<data root>/shell/thread-bookmarks.json`. 모양은 `{[session key]: [{message key, at}]}`
      - session key: lophn은 `ses_…`, harness는 `<harness>:<cli_session>`
      - message key: lophn은 ACP message id, harness는 `origin`
    - IPC channel과 preload API(`globalThis`에 노출할 이름은 이 task가 정해 보고한다)

## 할 일

줄여 쓴 path: `CV` = `packages/shell/renderer/conversation/`. 수치와 모양의 근거는 `ui-reference.md` §3(Codex rail `RAIL:`·`THR:` 줄)이다.

1. **bookmark store**(main). 새 `packages/shell/main/thread-bookmarks/store.ts`를 만든다. 본보기는 `packages/shell/main/browser/bookmarks.ts`다.
   - file은 `join(dataRoot, "shell", "thread-bookmarks.json")`이다.
     - 모양은 계약대로 `{[session key]: [{message: string, at: string}]}`이고 zod `strictObject`로 읽는다.
     - session의 배열이 비면 그 key를 지운다.
   - 사람이 모은 목록이다. 깨진 file(JSON 아님, schema 불일치)은 `corrupt`로 두고 어떤 쓰기도 덮어쓰지 않는다. 옮겨 읽지도 않는다. browser bookmark와 같은 규칙이다.
   - 쓰기는 `packages/shell/main/workspace/atomic-file.ts`의 `writeFileAtomic`이다. 읽고 고쳐 쓰는 동안 다른 쓰기가 끼지 않게 store 안에서 promise 하나로 줄 세운다(창 둘이 같이 누를 수 있다).
   - 함수는 둘이다:
     - `list(session)` → message key 목록
     - `set(session, message, on)`: 켜면 `at`(clock)과 함께 더한다. 이미 있으면 그대로다. 끄면 뺀다.
   - 시각은 `deps.clock`으로 받는다(AGENTS.md "코드").
2. **IPC와 preload**.
   - `packages/shell/ipc/thread-bookmarks.ts`(main·preload·renderer가 같이 부르므로 type과 상수, zod schema만 둔다):
     - `THREAD_BOOKMARKS_LIST_CHANNEL` `{session}` → `string[]`
     - `THREAD_BOOKMARKS_SET_CHANNEL` `{session, message, on}` → `null`
     - push `THREAD_BOOKMARKS_CHANGED_CHANNEL` `{session}`
     - 답은 browser처럼 `{ok, value} | {ok: false, error: {code, message}}`다. code는 공통 일곱(`corrupt`·`unwritable`는 `unavailable`, schema 어긋남은 `invalid_input`)이다.
     - session·message 길이에 상한을 둔다(예: 512자).
   - `packages/shell/main/thread-bookmarks/ipc.ts`: 본보기는 `browser/bookmark-ipc.ts`다.
     - `checkCaller`로 desktop 창 본문만 받는다. detached 창의 Agent 탭도 받는지 그 창의 origin host를 확인한다.
     - 입력은 `checkInput`으로 본다.
     - 성공한 쓰기 뒤 모든 창에 changed를 보낸다.
   - `packages/shell/main/desktop/wiring/thread-bookmarks.ts`: `wiring/bookmarks.ts`와 같은 꼴의 `register(ctx)`다. `main/desktop/main.ts`의 `add(...)` 줄은 lead가 넣는다.
   - `packages/shell/preload/thread-bookmarks-api.ts`: `createThreadBookmarksApi(ipcRenderer)` → `{list, set, onChanged}`.
     - `globalThis` 이름은 `lophnThreadBookmarks`를 추천한다. 정한 이름을 보고한다.
     - `preload/shell.ts`의 `exposeInMainWorld` 줄은 lead가 넣는다.
3. **rail 자료**(protocol 없이 된다. `ui-reference.md` §3 "lophn에 만들 것" data).
   - 새 `CV/thread-index/model.ts`에 순수 함수 `threadIndexOf(entries)`를 둔다. 입력은 `ThreadView.entries` top level이다.
     - 눈금은 `kind: "message"`이고 `actor: "user"`인 것이다. 숨긴 구간(`hidden.entries`) 안 것과 대기열은 들어오지 않는다.
     - 제목은 사람이 쓴 글의 첫 비지 않은 줄이다(`textOfParts`, `CV/agent-view-model.ts`). 글 없이 이미지·파일만 있으면 "Image"·"File"이다. model이 만든 제목은 쓰지 않는다.
     - 답 미리보기는 그 메시지 뒤, 다음 사람 메시지 전까지의 마지막 agent 메시지 글이다. `CV/message-list/agent-turn.tsx`의 `copyText`와 같은 선택이다.
     - bookmark key는 `origin ?? id`다. lophn은 `origin`이 null이라 ACP id다. harness인데 `origin`이 null인 메시지는 bookmark 단추가 없다. `origin`은 screen-thread가 `ThreadMessage`에 둔다.
   - session key: `meta.harness === null`이면 `session`(`ses_…`), 아니면 `${meta.harness}:${meta.cli_session}`이다. `cli_session`이 null이면 bookmark를 끈다(rail은 그린다).
4. **rail**(새 `CV/thread-index/thread-index.tsx`, `.module.css`).
   - 사람 메시지가 4개 이상일 때만 그린다.
   - 자리는 대화 scroll 영역 왼쪽, 세로 가운데다(Codex `left-3`).
     - 왼쪽 여백(대화 기둥 밖)이 48px보다 좁으면 숨긴다(t3code). 글 위에 눈금이 겹치지 않게 하려는 것이다.
     - 여백은 `ThreadScroll`의 list 폭과 대화 기둥 폭(`page.reading` token)으로 잰다.
   - 눈금은 `button` 하나씩이다. 26px 선을 `scaleX`로 줄인다.

     | 상태 | 길이 |
     |---|---|
     | 평소 | 0.23배, 약 6px |
     | hover | 1배, 26px. 글자색 |
     | 이웃 1칸 | 0.7배 |
     | 이웃 2칸 | 0.4배 |
     | 이웃 3칸 | 0.2배 |

     - 화면에 보이는 사람 메시지 눈금은 글자색에 opacity 0.6이고, 나머지는 설명색에 0.4다.
     - bookmark된 눈금은 opacity 1에 끝 점이다. aria-label에 "bookmarked"를 붙인다.
     - 색과 크기는 `packages/design/tokens.ts` 값을 쓴다. reduced motion이면 transition을 끈다.
   - 보이는 것: list 안 `[data-message][data-actor="user"]` node에 `IntersectionObserver`를 건다. 보이는 것 전부가 "현재"다(Codex `RAIL:1036-1090`).
   - 눈금이 화면 높이의 70%를 넘으면 고르게 sampling한다(Orca). 처음, 끝, 현재, hover한 것은 남긴다.
5. **hover card**(Codex `RAIL:157-548`. 줄 수는 사람이 정한 2줄).
   - 기존 `Popover`(`packages/design/components/overlay/popover/popover.tsx`)를 쓴다.
     - 지금 `hover` 길은 열 때 250ms를 기다린다. 눈금 사이를 훑을 때 card가 끊긴다.
     - 그래서 rail이 `open`·anchor를 직접 쥐는 controlled `Popover` 하나로 연다. hover한 눈금이 바뀌면 anchor만 옮긴다.
     - 그것이 안 될 때만 popover에 "열린 동안 지연 없이 옮기기" 변형을 더한다. 그때는 ui-design skill대로 kit page 견본도 더한다.
   - 폭은 320px이다.
     - 첫 줄: 사람 메시지 첫 줄 truncate · 오른쪽 bookmark `IconButton`. `aria-pressed`, label은 "Bookmark turn"/"Remove bookmark"다.
     - 둘째: 답 미리보기다. `CV/message-list/chat-markdown.tsx`에 2줄 clamp를 건다. 답이 아직 없으면 그 줄이 없다.
   - 아이콘 `bookmark`·`bookmarked`(lucide Bookmark, BookmarkCheck)를 `packages/shell/renderer/icons/conversation.ts`에 더한다.
6. **조작**(Codex `THR:16217-16310`, `RAIL:1160-1329`, Orca 키).
   - 누르면 그 사람 메시지 머리로 smooth scroll한다. reduced motion이면 바로 간다.
   - pointer를 누른 채 위아래로 끌면 지나가는 메시지로 바로 간다.
   - rail 위 wheel은 대화 scroll로 넘긴다.
   - 키보드:
     - rail은 tab stop 하나다. ↑/↓/Home/End로 눈금을 옮기고 그 card를 연다. Enter로 간다.
     - Alt+↑/Alt+↓는 대화 화면 어디서든 이전·다음 사람 메시지로 간다. rail이 자기 `[data-agent-view]` 조상에 keydown을 건다.
     - composer와 카드의 키에 Alt+화살표는 없다(`altKey` grep 결과: `agent-composer.tsx`는 Ctrl/Cmd만 본다). 다시 확인한다.
   - **끝 따라가기와 부딪치지 않게**:
     - `CV/message-list/follow.ts`는 사람의 입력(wheel, 키, scrollbar)으로만 따라가기를 끈다. scroll 위치로는 끄지 않는다.
     - `thread-scroll.tsx`는 render마다 따라가는 중이면 맨 아래로 되돌린다.
     - 그래서 jump는 `ThreadScroll` 안에서 `following.current = false`를 먼저 하고 옮겨야 한다. 밖에서 `scrollIntoView`만 하면 다음 render가 맨 아래로 되돌린다.
7. **mount**. `ThreadScroll`(`CV/message-list/thread-scroll.tsx`)은 `CV/agent-thread.tsx`가 그린다. `agent-thread.tsx`는 소유에 없으니 그 file을 고치지 않고 이렇게 잇는다.
   - `CV/thread-index/`에 React context `ThreadIndexContext`를 둔다. 값은 rail 자료, session key, bookmark 통로다.
   - `CV/agent-view.tsx`가 `AgentThread`를 이 provider로 감싼다. 자식 보기 layer(screen-dock)의 `AgentThread`는 감싸지 않는다. 자식 대화에는 rail이 없다.
   - `thread-scroll.tsx`가 context를 읽어 `.frame` 안에 `<ThreadIndex>`를 그린다. list ref와 jump 함수(6의 따라가기 끄기)를 넘긴다. context가 없으면(다른 곳의 `ThreadScroll`) 그리지 않는다.
8. **bookmark 통로**(renderer). `CV/thread-index/bookmarks.ts`가 `globalThis.lophnThreadBookmarks`를 읽는다(본보기: `packages/shell/renderer/terminal/terminal-gui.tsx`가 `lophnHarnessGuiTab`을 읽는 법).
   - 없으면 null이고 bookmark 단추가 없다. gallery·dev-mock·test가 이렇다.
   - session key가 바뀌면 `list`로 읽고, `onChanged`에서 같은 session이면 다시 읽는다.
   - 누르면 `set` 뒤 바로 화면 값을 바꾼다. 실패하면 되돌린다.
9. **gallery**(ui-design skill). `tools/wireframes/pages/screens/harness-gui.tsx`의 `SCRIPT`에 사람 메시지 6개와 답을 둔다. 메시지에 `origin`을 넣는다. fake bookmark 통로를 page에서 `globalThis.lophnThreadBookmarks`에 둔다(`tools/wireframes/mock/appearance.ts`가 같은 일을 한다). page를 더한다:
   - `harness-gui-thread-index`: rail. 하나는 bookmark됨
   - `harness-gui-thread-index-card`: 눈금 하나에 hover한 card. drive로 pointer를 올린다
   - lophn 쪽은 fake 장면(`agent-tab-fake-source.ts`, 소유 밖)에 사람 메시지가 4개 이상인 것이 있으면 `tools/wireframes/pages/screens/conversation.tsx`로 같은 page를 둔다. 없으면 두지 않는다.
10. 문서: `project-docs/architecture/agent-chat.md`에 thread index(자료, bookmark 자리와 key, 따라가기와의 관계)를 더할 문장을 보고의 "넘길 줄"에 적는다.

## 끝남

- `npm run check`가 통과한다. `node packages/shell/renderer/build.ts`가 선다.
- 위험 test(사용자 data를 잃는 규칙): `packages/shell/main/thread-bookmarks/store_test.ts`. 결과는 이렇다.
  - 깨진 file이 있으면 `set`이 실패하고 file 내용은 그대로다.
  - 한 session의 bookmark를 켜고 꺼도 다른 session의 bookmark가 남는다.
  - 같이 부른 `set` 둘이 둘 다 남는다.
  - fs는 `StoreDeps`로 바꿔 끼운다. 실제 file system은 쓰지 않는다.
- 남지 않음: `grep -rn "pinned-conversation\|localStorage" packages/shell/renderer/conversation/thread-index`가 0줄이다. 저장은 main file 하나다.
- `npm run wireframes`가 되고, 위 두 page가 renderer component로 그려진다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고"대로. "등록할 것"에 `main/desktop/main.ts`의 `add(threadBookmarks.register(ctx))` 줄과 `preload/shell.ts`의 `exposeInMainWorld` 줄(정한 `globalThis` 이름)을 적는다.
