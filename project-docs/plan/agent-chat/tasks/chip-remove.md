# chip-remove

production에서 한 번도 보이지 않는 `ProgressChip`, Tasks popover, `TaskView`, fake `TASKS`, 화면 값의 `tasks` 칸을 지운다(roadmap 8, AGENTS.md "죽은 코드는 지운다").

정한 것: `AgentHeader`의 `progress` 자리도 쓰는 곳이 없어져 같이 지운다. `tools/wireframes/pages/screens/agent-chat.tsx`는 어디서도 import하지 않는 page라 통째로 지운다(planner).

- 단위: chip-remove (wave 1)
- 선행: chat-protocol, chat-md. `chat-protocol`과 `agent-tab-core-source-thread.ts`를 같이 고치고, `chat-md`가 key를 더하는 conversation wording catalog에서 key를 지운다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/activity/progress-chip.tsx` (지운다)
  - `packages/shell/renderer/conversation/activity/model.ts`
  - `packages/shell/renderer/conversation/activity/activity.module.css`
  - `packages/shell/renderer/conversation/agent-tab-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-data.ts`
  - `packages/shell/renderer/conversation/agent-tab-fake-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`
  - `packages/shell/renderer/conversation/agent-view.tsx`
  - `packages/shell/renderer/conversation/header/agent-header.tsx`
  - `tools/wireframes/pages/screens/agent-chat.tsx`
  - `packages/design/wording/catalog/{conversation,conversation.placeholders}.ts` (공용, key만 지운다)
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/agent-chat.md` 8, `project-docs/plan/agent-chat/README.md` "정한 것"의 `ProgressChip` 줄
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `design`. `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/design`(문구는 wording key), `tools`
  - skill: `.claude/skills/wording/SKILL.md`("key를 지우기 전에", "손으로 생성물을 고치지 않는다"), `.claude/skills/ui-design/SKILL.md`("확인")
  - 코드: `packages/shell/renderer/conversation/activity/progress-chip.tsx`, `packages/shell/renderer/conversation/activity/model.ts`, `packages/shell/renderer/conversation/activity/activity.module.css`, `packages/shell/renderer/conversation/agent-tab-source.ts`(`TaskView`, `ThreadView`, `EMPTY_THREAD`), `packages/shell/renderer/conversation/agent-tab-data.ts`(`TurnEnded` 접기), `packages/shell/renderer/conversation/agent-tab-fake-source.ts`, `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`(맨 끝 thread 값), `packages/shell/renderer/conversation/agent-view.tsx`, `packages/shell/renderer/conversation/header/agent-header.tsx`, `tools/wireframes/pages/screens/agent-chat.tsx`, `packages/design/wording/catalog/conversation.ts`
- 계약:
  - 쓰는 것: 없음.
  - 내놓는 것: 화면 값(`ThreadView`, `EMPTY_THREAD`, fake source)에 `tasks`가 없고 `AgentHeader`에 `progress` 자리가 없다. wave 3 화면 task는 이 모양 위에서 고친다.

## 할 일

근거는 모두 roadmap 8과 AGENTS.md "죽은 코드는 지운다"다. production의 thread 값은 늘 `tasks: []`(`agent-tab-core-source-thread.ts`, `agent-tab-data.ts`)라 chip이 그려진 적이 없다. 줄 번호는 brief를 쓸 때의 main 기준이다. `chat-protocol`이 먼저 들어와 `agent-tab-core-source-thread.ts`의 줄이 밀릴 수 있으니 글로 찾는다.

1. `packages/shell/renderer/conversation/activity/progress-chip.tsx`를 지운다(`ProgressChip`, Tasks popover, `MARK`).
2. `packages/shell/renderer/conversation/activity/model.ts`: `TaskState`, `TaskView`(19~25줄)를 지운다. 머리 주석과 `ViewDetail`, `ToolLineDetail`, `ToolLineView`는 그대로다.
3. `packages/shell/renderer/conversation/activity/activity.module.css`: chip만 쓰던 `.tasks`, `.tasksHead`, `.taskList`, `.taskMark`, `.task[data-state="done"|"now"|"later"]`(99~137줄)를 지운다. design `reading.module.css`의 `.task`·`.taskMark`(markdown task list)는 다른 file이라 건드리지 않는다.
4. `packages/shell/renderer/conversation/agent-tab-source.ts`:
   - 내보내지 않는 `interface TaskView`(247~251줄)를 지운다.
   - `ThreadView`의 `tasks` 칸과 그 doc 주석, `EMPTY_THREAD`의 `tasks: []`를 지운다.
   - `ThreadView` 위 주석 "시간순 줄, 지금 turn, 할 일, 다음 turn 줄, 사람이 답할 것"에서 "할 일"을 뺀다.
5. `packages/shell/renderer/conversation/agent-tab-data.ts`: `TurnEnded` 접기의 `tasks: []`(198줄)를 지운다.
6. `packages/shell/renderer/conversation/agent-tab-core-source-thread.ts`: 맨 끝 `value: { entries: out, turn, tasks: [], queued, pending }`(656줄)에서 `tasks: []`를 뺀다. `readBody`는 `chat-protocol`이 고친 그대로 둔다.
7. `packages/shell/renderer/conversation/agent-tab-fake-source.ts`: fake `TASKS`(179~184줄), `SceneData.tasks`(286줄), report scene의 `tasks: TASKS`(360줄), thread를 만들 때의 `tasks: data.tasks ?? []`(863줄), `stop`의 `tasks: []`(1054줄)를 지운다.
8. `packages/shell/renderer/conversation/agent-view.tsx`: `ProgressChip` import(16줄)와 `AgentHeader`의 `progress={…}`(492줄)를 지운다.
9. `packages/shell/renderer/conversation/header/agent-header.tsx`: `AgentHeaderProps.progress`와 그 doc 주석 "진행 chip 자리(thread의 것)."(58~59줄), render의 `{props.progress}`(171줄)를 지운다. `detail`과 `ReactNode` import는 남는다.
10. `tools/wireframes/pages/screens/agent-chat.tsx`를 통째로 지운다. 어디서도 import하지 않는다(`grep -rn "agent-chat" tools packages --include=*.ts --include=*.tsx --exclude-dir=dist --exclude-dir=node_modules`가 0줄, gallery `pages/index.ts`의 `GROUPS`에도 없다). 그래서 gallery page 목록에서 뺄 것이 없다.
11. wording(근거: `wording` skill "key를 지우기 전에"):
    - chip만 쓰던 key 둘 `conversation.label.tasks`, `conversation.label.tasks-progress`를 `packages/design/wording/catalog/conversation.ts`에서 지운다. 앞부분 `conversation.label.task`와 template 호출(``t(`conversation.label.${…}`)``)을 `packages`, `tools`에서 grep해(catalog와 `.placeholders.ts` 제외) progress-chip 밖에 쓰는 곳이 없음을 확인했다. 지우기 전에 한 번 더 본다.
    - `deno task wording`으로 `conversation.placeholders.ts`를 다시 만든다. 손으로 고치지 않는다.
    - `chat-md`가 같은 wave에 같은 catalog에 key를 더한다. 충돌이 나면 영역 file(`conversation.ts`)만 풀고 `deno task wording`을 다시 돌린다.

## 끝남

- `deno task check`가 통과한다.
- `deno run --allow-read tools/check-wording.ts`가 통과한다.
- `deno task wireframes`가 되고, `deno run -A packages/shell/renderer/build.ts`가 선다.
- 위험 test: 없음. 죽은 화면 코드를 지우는 일이다(`write-test`: 화면, 문구는 test하지 않는다).
- 남지 않음:
  - `grep -rnw "ProgressChip\|TaskView\|TaskState\|TASKS" packages tools --include=*.ts --include=*.tsx --exclude-dir=dist --exclude-dir=node_modules`가 0줄이다.
  - `grep -rn "progress-chip\|conversation.label.tasks\|tasksHead\|taskList" packages tools --include=*.ts --include=*.tsx --include=*.css --exclude-dir=dist --exclude-dir=node_modules`가 0줄이다.
  - `grep -rnw "tasks" packages/shell/renderer/conversation`과 `grep -rn "props.progress" packages/shell/renderer/conversation`이 0줄이다.
  - `tools/wireframes/pages/screens/agent-chat.tsx`가 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. wording 생성물(`conversation.placeholders.ts`)을 다시 만들었음을 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). 이 task로 쓰는 곳이 없어지는 것: `Quiet`(`packages/shell/renderer/conversation/message-list/agent-turn.tsx`, `agent-chat.tsx`만 썼다), `sessionsOf`(`tools/wireframes/mock/agents-data.ts`, `agent-chat.tsx`만 썼다), `ToolRow`의 export(`activity/tool-line.tsx` 안에서만 쓰게 된다). 셋 다 소유 밖이라 지우지 않고 적는다.
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
