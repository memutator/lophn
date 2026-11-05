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
  - `tools/wireframes/pages/screens/{conversation.tsx,harness-gui.tsx}`(thread index, hover card page)
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

할 일: (살 단계가 채운다)
