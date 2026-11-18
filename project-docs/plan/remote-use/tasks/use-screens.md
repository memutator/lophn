# use-screens

화면 둘을 고친다. agent의 Grants 탭에서 다른 기계의 앱을 그 agent에 할당한다. 앱의 Activity에서 다른 기계가 부른 호출에 "어느 기계의 누가"를 보인다. wireframe을 먼저 고치고 그 component를 renderer에 둔다. 승인 카드는 바꾸지 않는다: 할당한 앱 command는 다른 기계의 것도 묻지 않고 돈다(approval은 그대로다).

- 단위: use (wave 3)
- 선행: use-send. 할당의 `machine`·`name` 저장과 `remote` caller 기록이 선 뒤다.
- 소유(이 task만 고친다):
  - `tools/wireframes/pages/screens/agent-settings.tsx`, `tools/wireframes/pages/screens/agent-setup/agent-setup-pages.tsx`, `tools/wireframes/pages/screens/app-space.tsx`
  - `packages/shell/renderer/workspace/agents/{core-grants,source,fake-source,fake-data}.ts`
  - `packages/shell/renderer/workspace/agents/editor/{grants-model.ts,grants-model_test.ts,grants-panel.tsx,grants-panel.module.css}`
  - `packages/shell/renderer/app-frame/app-detail/{reads,model}.ts`, `packages/shell/renderer/app-frame/app-detail/activity/activity-tab.tsx`, `packages/shell/renderer/app-frame/app-detail/testdata/fake-source.ts`
  - `packages/design/i18n/catalog/{agents,app-space}.ts`
  - `project-docs/flows/tests/shell.yaml`
- 읽을 것:
  - skill: `.claude/skills/ui-design/SKILL.md`(wireframe 먼저, 모든 화면의 규칙)
  - 계획 README "정한 것"의 "허락은 부르는 기계에서 본다", "다른 기계의 앱이 무엇을 할 수 있는지는 그 기계에 묻는다"
  - `project-docs/plan/remote-use/tasks/use-contract.md`의 `assignmentEntrySchema`(`machine`, `name`), `remote` caller와 `Requester`
  - architecture: `approval.md`("할당", 지키는 것 20·21), `app-call.md`(caller 일곱), `remote.md`("desktop에서 다른 기계 보기", `one-screen`이 고친 판)
  - 본보기(화면): `tools/wireframes/pages/screens/agent-settings.tsx`의 `new-agent-grants`·`new-agent-grants-app`, `tools/wireframes/pages/screens/app-space.tsx`의 `new-app-activity`
  - boundary·module: `core-api`; module `shell`(renderer)
- 계약:
  - 쓰는 것: `assignmentGet`·`assignmentSet`(줄의 `machine`·`name`), `machines/list`, `one-screen`이 낸 화면의 기계 범위(그 범위의 `apps/list`·`apps/tools`는 그 기계로 간다), `appInvocations`의 caller `remote`
  - 내놓는 것: 없음

## 할 일

1. wireframe 먼저(`ui-design`). 고친 page 가운데 사람에게 보일 것: `agent-settings`의 `new-agent-grants-other-machine`(새 page: "Other computers" 묶음, 기계마다 앱 줄과 command 빼기, 꺼진 기계의 앱은 이름과 "offline" 꼬리표로 남고 빼기는 된다)과 `app-space`의 `new-app-activity`(fake data에 다른 기계가 부른 줄 하나를 더한다). 새 page는 영역 file이 낸다(`pages/index.ts`는 그대로).
2. Grants 탭(`core-grants.ts`, `source.ts`, `grants-model.ts`, `grants-panel.tsx`):
   - 붙일 수 있는 다른 기계의 앱은 `machines/list`의 컴퓨터마다 그 기계 범위로 `apps/list`·`apps/tools`를 읽은 것이다. `public` command만 보인다(받는 기계가 비공개를 거절한다).
   - 저장은 이 기계의 `assignment.set`에 줄 `{app, machine, name, removed_tools}`로 한다. revision 비교와 `conflict`는 지금과 같다.
   - 꺼진 기계는 읽지 못하므로 저장된 줄(`name`)로 그린다.
3. Activity(`reads.ts`, `model.ts`, `activity-tab.tsx`): `remote` caller는 "<기계 이름> · <요청한 쪽>"이다.
   - 기계 이름은 이 기계의 `machines/list`에서 `machine`으로 찾고, 없으면 짧은 id다.
   - 요청한 쪽: `screen`은 "You (screen)", `terminal`은 "You (terminal)", `agent`는 실린 `name`, `app`은 이 기계에 그 앱이 있으면 이름이고 없으면 짧은 id다.
   - `use-contract`가 둔 최소 갈래를 이것으로 바꾼다.
4. 글은 i18n catalog(`agents.ts`, `app-space.ts`)에 두고 박아 두지 않는다.
5. `grants-model_test.ts`가 있는 판정(같은 줄은 `(app, machine)`)이 바뀌면 그 test만 맞춘다. 화면과 문구는 test하지 않는다.

정한 것:
- 다른 기계 앱의 할당 화면은 Grants 탭 안 묶음 하나다: README가 할당 하나에 "어느 기계의"가 붙는다고 했고, 다른 길을 만들지 않는다.
- 폰 화면은 바꾸지 않는다: 폰에는 할당 화면과 호출 기록이 없다.

## 끝남

- `npm run check`가 통과한다. `node packages/shell/renderer/build.ts`가 된다.
- `npm run wireframes`가 되고 gallery의 `new-agent-grants-other-machine`과 `new-app-activity`가 renderer의 component로 그려진다.
- 위험 test: 없음(화면이다. 할당과 판정은 `use-send`가 본다).
- 브라우저·스크린샷을 띄우는 test는 만들지 않는다.
- 남지 않음: `use-contract`가 `reads.ts`에 둔 최소 갈래가 남지 않는다(그 갈래의 주석이나 임시 문구로 grep한다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

## 시작 전에 다시 볼 것

- `one-screen`의 `screen-base`가 낸 화면의 기계 범위(이름과 쓰는 법)와 `screen-lists`가 바꾼 기계 꼬리표 component(같은 것을 쓴다). Grants 탭과 Activity의 그때 file 위치. `use-send`가 정한 꺼진 기계의 줄 모양.
