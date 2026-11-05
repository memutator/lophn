# screen-thread

채팅 화면의 대화 쪽이 acp-more 계약을 그리고 보낸다. lophn agent와 harness GUI가 같이 쓰는 화면이다. 사람이 찾은 화면 결함(README 정한 것 14) 가운데 대화 쪽을 고친다:

- `info` notice가 아예 안 그려진다. 명령 출력, compaction, 재시도가 다 사라진다.
- 명령을 고르면 무조건 prompt로 간다.
- `/` palette 순위·묶음·아이콘이 나쁘다.
- harness 아이콘 대신 글자 "C"가 보인다.
- tool 줄을 펼쳐도 입력·출력 본문이 없다(harness).
- plan 승인 카드가 없다.

정한 것 15·16대로 명령 세 갈래(화면 동작은 `opens`만 보고, CLI 명령은 보내고 출력 블록을 그리고, TUI 전용은 숨김), palette, `command_output`·`info` 블록, vendor 얼굴, tool 본문 펼치기, plan 승인 카드를 넣는다. composer dock(todo, subagent, task, 대기열, 켜고 끄기, goal, role, 사용 한도)은 `screen-dock`(wave 6), thread index는 `thread-index`(wave 7)다. 그 자리도 미리 두지 않는다.

- 단위: screen (wave 5)
- 선행: acp-more
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/{agent-view.tsx,agent-view.module.css,agent-thread.tsx,agent-view-model.ts,thread-layout.ts,thread-layout_test.ts,use-slash-menu.tsx,use-model-picker.ts}`
  - `packages/shell/renderer/conversation/{agent-tab-source.ts,agent-tab-gui-source.ts,agent-tab-fake-source.ts,agent-tab-fake-commands.ts,agent-tab-fake-models.ts}`
  - `packages/shell/renderer/conversation/{slash-menu,composer,thread,activity,status-view,header}/`
  - `packages/shell/renderer/conversation/message-list/agent-turn.tsx`
  - `packages/shell/renderer/parts/avatar/`
  - `packages/shell/renderer/icons/conversation.ts`
  - `packages/design/i18n/catalog/conversation.ts`(여러 task가 key만 더한다)
  - `tools/wireframes/pages/screens/{harness-gui.tsx,conversation.tsx}`, `tools/wireframes/pages/screens/agent-tab/`, `tools/wireframes/mock/agents-data.ts`
- 읽을 것:
  - 점검 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/`:
    - `ui-reference.md` §0(먼저 고칠 것), §1(palette), §2(명령 출력), 부록 A
    - `audit-claude.md` §4 화면, §5.4 B·C
    - 각 `audit-{codex,opencode,omp}.md`의 "adapter·화면에서 고칠 것" 화면 줄
  - `packages/shell/renderer/parts/vendor-icon/vendor-icon.tsx`의 `harnessVendorOf`
  - architecture: `project-docs/architecture/agent-chat.md`, `harness-gui.md`, `acp.md`
  - ui-design skill(바뀌는 화면마다 gallery page)
- 계약:
  - 쓰는 것:
    - acp-more: 명령 칸(`source`, `aliases`, `opens`), `command_output`, `info.level`, `turn` 없는 notice, tool `body`, plan 승인 subject, meta `harness`
    - core-commands가 채우는 lophn 명령의 `opens`(fake source는 같은 값을 손으로 적는다)
  - 내놓는 것:
    - `AgentProfile`에 vendor 얼굴
    - screen-dock과 thread-index가 고칠 `agent-view.tsx`는 지금 꼴대로 둔다(`message-list/thread-scroll.tsx`는 이 task가 고치지 않는다)

할 일: (살 단계가 채운다)
