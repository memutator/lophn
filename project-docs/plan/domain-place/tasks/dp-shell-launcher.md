# dp-shell-launcher

launcher에서 폴더 없이 project를 등록할 수 있게 하고(등록 dialog와 project 상세에서 마지막 폴더도 뺄 수 있다), 폴더 없는 project의 `LOPHN.md` 편집 경로를 `<data>/projects/<prj>/LOPHN.md`로 연다. 앱 카드에는 그 앱이 속한 project 이름을 보인다. 사람이 project를 만드는 흐름(화면)을 바꾸는 일이다. lead는 띄우기 전에 사람에게 이 변화를 알리고 확인한다(plan README "사람에게 묻는 것").

- 단위: shell-place (wave 2)
- 선행: dp-shell-agents. 같은 `packages/shell/main/editor/instructions.ts`에서 앱 층을 먼저 지운다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/launcher/`
  - `packages/shell/renderer/apps/`
  - `packages/shell/main/editor/instructions.ts`
  - `packages/shell/main/desktop/wiring/editor.ts`
  - `packages/design/wording/catalog/workspace.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/workspace-layout.md`, `project-docs/architecture/place-session.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `projects`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 본보기(화면): `tools/wireframes/pages/screens/launcher.tsx`와 `launcher/`(gallery의 launcher 화면. 이 task는 새로 그리지 않고 그 화면의 폴더 영역 문구만 맞춘다)
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > folder 0개인 project", `project-docs/products/roadmap/domain.md`의 "폴더"
  - 쓰는 규칙: `.claude/skills/wording/SKILL.md`, `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: `project.create`가 `folders: []`를 받는다(`dp-project-folderless`), 앱 record의 `project`(`dp-app-project`)
  - 내놓는 것: 등록 dialog가 폴더 0개로 `register`를 보낸다. 지침 편집 IPC가 폴더 없는 project에 대해 `<dataRoot>/projects/<prj>/LOPHN.md` 경로를 낸다.

## 할 일

1. `packages/shell/renderer/desktop/launcher/register-dialog.tsx`: `submit`의 `folders.length === 0` 거절(68째 줄)과 `touched && folders.length === 0` 오류(203~209째 줄)를 지운다. 빈 목록 안내(`launcher.empty.no-folders`, 155~160째 줄)는 "폴더가 없다. 앱 data만 있는 project로 만들 수 있다"는 뜻으로 고친다. `launcher.error.folder-required`와 안 쓰는 key는 지운다(`packages/design/wording/catalog/workspace.ts` 46, 48째 줄). `deno task wording`으로 생성물을 맞춘다.
2. `packages/shell/renderer/desktop/launcher/projects/project-detail.tsx`: 마지막 폴더 지우기를 막는 `disabled={draft.folders.length === 1}`(188째 줄)를 지운다. 폴더 없는 project도 상세가 열린다.
3. `packages/shell/main/editor/instructions.ts`의 `pathOf`: project 층에서 `firstFolder`가 null이면 `join(dataRoot, "projects", place.place, "LOPHN.md")`를 낸다. 폴더가 있으면 첫 폴더(그대로). `wiring/editor.ts`(62째 줄 `firstFolder`)는 활성이 아닌 project도 null을 내는 지금 규칙을 그대로 둔다.
4. `packages/shell/renderer/desktop/launcher/apps-section.tsx`와 `packages/shell/renderer/apps/{source.ts,core-source.ts}`: `AppRow`에 `project`(이름)를 더해 앱 카드에 한 줄로 보인다. project 이름은 launcher가 이미 읽는 project 목록(`packages/shell/renderer/desktop/launcher/model.ts`)에서 찾는다. 앱을 project 안으로 옮기는 화면은 만들지 않는다.
5. 화면 위치: launcher의 gallery page(`tools/wireframes/pages/screens/launcher.tsx`, `launcher/`)는 이 task가 소유하지 않는다. 폴더 영역 문구가 바뀌어 wireframe과 어긋나면 보고에 적는다.
6. 위험 test는 두지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(화면·문구다)
- 남지 않음: `grep -rn "folder-required" packages`가 0줄이다.
- (화면) `deno task wireframes`가 된다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`deno task wording`)
- 안 쓰게 된 export
- 정한 것: 앱 카드에 project 이름을 한 줄 보인다(roadmap에 화면 모양이 없어 추천안으로 정했다)
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 폴더 없는 project에서 PM은 `LOPHN.md`를 file tool로 쓰지 못하고 사람이 편집기로 쓴다(`dp-agent-roles-scope` 보고 참고)
