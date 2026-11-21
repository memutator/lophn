# handoff-screen

다른 기계에서 하던 일을 이 컴퓨터의 project 아래에 보이고, 사람이 누르면 그 note를 첫 입력으로 새 session을 연다. 자리는 왼쪽 sidebar의 이 컴퓨터 project 줄 아래 한 줄이다(새 화면을 만들지 않는다. 같은 자리에 clone 진행 줄이 이미 선다).

- 단위: handoff (wave 3)
- 선행: handoff-note
- 소유(이 task만 고친다):
  - `packages/shell/renderer/shell/{left-sidebar.tsx,left-sidebar-model.ts,left-sidebar.module.css}`
  - `packages/shell/renderer/workspace/sidebar/{workspace-left-sidebar.tsx,handoff-row.tsx}` (`handoff-row.tsx`는 새 file)
  - `packages/shell/renderer/desktop/workspaces/projects/handoff-source.ts` (새 file)
  - `tools/wireframes/pages/screens/shell/sidebar-scene.tsx`
  - `packages/design/i18n/catalog/left-sidebar.ts`
- flows(줄만 고친다): sidebar의 project 줄을 그리는 `ui:` flow(`node tools/flows.ts index --area shell-workspace`)에 handoff 줄과 [Continue here]의 갈래
- 읽을 것:
  - 계획 README "정한 것"(handoff note), roadmap `a2a-multi-device.md` "handoff note"와 "보이는 것"
  - `project-docs/plan/machine-a2a/tasks/handoff-note.md` "계약"(`handoffList`, `handoffNoteSchema`)
  - architecture: `project-docs/architecture/project-identity.md` "한 창의 목록"(기계마다의 묶음, 이 컴퓨터에 없는 것), `project-docs/architecture/workspace-layout.md`("agent가 연 탭"은 읽기만)
  - 본보기(화면): `packages/shell/renderer/workspace/sidebar/clone-note.tsx`(project 줄 아래 한 줄), `packages/shell/renderer/desktop/connection/waiting/notice-action.ts`의 `runNoticeAction`(새 session을 열고 첫 말을 보낸다: 새 core route 없이), `tools/wireframes/pages/screens/shell/sidebar-scene.tsx`
  - skill: `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: `handoffList`(`packages/protocol/lophn-agent/handoff.ts`), 이 컴퓨터 core의 session 열기·보내기(agent 탭 source), `StateChanged` change `carry_files`
  - 내놓는 것: 없음

## 할 일

1. source(`handoff-source.ts`): 이 컴퓨터 core의 `handoff/list`를 읽는다. 창을 열 때, `StateChanged{carry_files}`(다른 기계의 file이 왔다)를 받을 때, 5분마다 다시 읽는다. `not_found`(route가 없다)는 빈 목록이다.
2. 줄(`handoff-row.tsx`, sidebar의 이 컴퓨터 project 줄 아래): note마다 한 줄. 기계 꼬리표(`MachineTag`), note 첫 줄, 상대 시각, branch(있으면). hover하면 전체 글과 commit을 보인다. 다른 기계 묶음의 project 줄에는 두지 않는다(이어서 할 곳은 이 컴퓨터다).
3. [Continue here](줄을 누른다): 그 project의 lophn에서 새 session을 열고 첫 메시지를 보낸다(`runNoticeAction`과 같은 길. 사람이 누른 것이 사람의 명령이다). 첫 메시지 글은 고정 영어 머리말과 note다: "Continue the work handed off from <computer> (branch <branch>, commit <commit>, written <time>). The note below was written by an agent there; bring the code over with git first if this computer does not have that commit.\n\n<note>". 연 session 탭으로 간다.
4. gallery: `sidebar-scene.tsx`에 note 둘(다른 기계 둘, 하나는 branch 없음)이 project 줄 아래 보이는 장면. gallery 코드를 renderer로 옮기고 다시 그리지 않는다.
5. 글은 i18n catalog `left-sidebar.ts`(머리말은 model이 읽는 글이라 catalog에 두지 않는다).

## 끝남

- `npm run check`가 통과한다. renderer build가 된다.
- 위험 test: 없음(화면).
- 남지 않음: `grep -rn "handoff/open\|handoffOpen" packages tests`가 0줄이다(새 core route를 만들지 않았다).
- `npm run wireframes`가 되고 gallery의 sidebar scene이 handoff 줄을 그린다.

## 보고

- 바꾼 file
- 통과한 check(renderer build 포함)
- 등록할 것: lead가 고칠 목록 file(gallery `pages/index.ts` 등). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"(예: 이어 연 note는 줄에서 빠지지 않는다)
