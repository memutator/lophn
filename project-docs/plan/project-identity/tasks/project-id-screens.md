# project-id-screens

desktop 화면에 project id를 보인다. 등록 dialog는 고른 폴더를 `project.match`로 읽어, git 폴더면 "Same project on my other computers"(기본 켬)를 보이고 등록 뒤 켜져 있으면 `project.create_identity`를 부른다. 이미 id가 있는 저장소, 이 기계에 이미 등록된 저장소, 폴더를 잃은 project와 같은 remote인 저장소(relink 제안), git이 아닌 폴더를 각각 한 줄로 알린다. project 상세에는 "Other computers" 줄이 상태마다 글과 단추 하나를 보인다. 새 화면은 만들지 않는다.

- 단위: project-id-screens (wave 2)
- 선행: project-id-core
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/workspaces/projects`
  - `packages/shell/renderer/desktop/workspaces/register-dialog.tsx`
  - `packages/shell/renderer/desktop/workspaces/register-dialog.module.css`
  - `packages/shell/renderer/desktop/workspaces/source.ts`
  - `packages/shell/main/desktop/core/allowlist.ts`(`RENDERER_MEMORY_ROUTES`에 네 줄과 주석 한 줄만)
  - `packages/design/i18n/catalog/workspace.ts`(key만 더한다)
  - `tools/wireframes/pages/screens/shell/project-identity-scene.tsx`(새 file)
  - `tools/wireframes/pages/screens/shell.tsx`(page 한 항목과 import만)
- 읽을 것:
  - 계획: `project-docs/plan/project-identity/README.md`의 "정한 것"(만드는 때, Restore, 충돌, fork, 한 기계에 한 id, git이 아닌 폴더)과 "다른 계획이 기대는 계약" 3·4
  - 앞 task의 결과: `packages/protocol/projects/identity-api.ts`(`projectIdentityApi`의 `identity`·`createIdentity`·`renewIdentity`·`match`, `projectIdentityStatusSchema`, `projectMatchSchema`), `ProjectRecord`의 `identity`·`repo`·`remote`. handler는 같은 wave의 `project-id-sync`가 짓는다. 이 task는 route 이름과 출력 모양만 쓰고 fake source로 그린다.
  - skill: `.claude/skills/ui-design/SKILL.md`(모든 화면의 규칙: 단추는 줄 오른쪽 끝, 글자 단추 앞 행동 아이콘, `danger`는 되돌릴 수 없는 일에만, 알림은 toast, 문구는 i18n key)
  - 지금 코드: `register-dialog.tsx`(폴더 고르기, `RegisterSource`), `workspaces/source.ts`(`ProjectDraft`, `RegisterSource`), `projects/source.ts`(`ProjectsSource`, `ProjectItem`), `projects/core-source.ts`(`createProject`, `write`, `call` 꼴), `projects/project-detail.tsx`(`ProjectForm`에 `iconField`를 넘기는 꼴), `projects/project-form.tsx`(폴더 줄과 [Relocate]), `projects/testdata/fake-projects.ts`(gallery와 test의 가짜 통로), shell main `allowlist.ts`의 `RENDERER_MEMORY_ROUTES`
  - gallery: `tools/wireframes/pages/screens/shell.tsx`와 `shell/workspaces-scene.tsx`(fake source로 실제 component를 그리는 꼴), `tools/wireframes/mock/drive.ts`(`useDrive`로 dialog를 열고 폴더를 고른 상태 만들기)
  - i18n: `packages/design/i18n/catalog/workspace.ts`의 `home.*`(등록 dialog)과 `projects.*`(상세) key 꼴
- 계약:
  - 쓰는 것: memory route `projects/identity`, `projects/create_identity`, `projects/renew_identity`, `projects/match`, command `project.relink_folder`(relink 제안)
  - 내놓는 것: 없음(화면). 다음 task가 쓰도록 `ProjectItem`에 `identity: string | null`과 `repo`를 옮겨 둔다.

## 할 일

1. `allowlist.ts`의 `RENDERER_MEMORY_ROUTES`에 `memory:projects/identity`, `memory:projects/create_identity`, `memory:projects/renew_identity`, `memory:projects/match`를 더하고 주석 목록에 한 줄("project id file 상태와 만들기·나누기, 등록 전 폴더 읽기. project 등록 dialog와 상세").
2. 통로: `ProjectsSource`에 `identity(project)`, `createIdentity(project)`, `renewIdentity(project)`(셋 다 화면 쪽 `IdentityStatus`를 돌려준다. 칸은 `projectIdentityStatusSchema`를 camelCase로)와 `RegisterSource`에 `match(path)`(화면 쪽 `FolderMatch`), `ProjectDraft`에 `shareIdentity: boolean`. `core-source.ts`가 memory route로 짓고(`register`는 `project.create`가 성공하고 `shareIdentity`면 이어서 `create_identity`를 부르며, 그 실패는 등록을 되돌리지 않고 결과에 실어 상세의 줄이 보이게 한다), `fake-projects.ts`가 메모리로 짓는다(상태마다 하나씩 고를 수 있는 option).
3. 등록 dialog: 첫 폴더를 고르면 `match`를 부르고 그 결과로 폴더 목록 아래에 한 줄을 보인다.
   - git이고 file 없음: 켬 줄 "Same project on my other computers"(기본 켬)와 note "Adds .lophn-project.json to this folder. Commit it so your other computers get it."
   - file 있음(같은 id의 project가 이 기계에 없다): note "This repository is already a lophn project. Your other computers see it as the same project." 켬 줄 없음.
   - `same`이 있다: note "This repository is already registered here as <title>." 등록하면 "another copy"가 된다는 한 줄.
   - `suggestions`에 폴더를 잃은 project가 있다: note "<title> lost its folder, and this looks like the same repository." 단추 [Relink <title> here](그 project의 잃은 폴더를 이 path로 `relink_folder`하고 dialog를 닫는다).
   - git이 아님: note "Not in git, so this project stays on this computer."
   - `match`가 실패하면 줄을 그리지 않는다(등록은 막지 않는다).
4. 상세의 "Other computers" 줄(`projects/identity-row.tsx`. `ProjectDetailDialog`가 열 때 `identity`를 한 번 읽고 `ProjectForm`에 `iconField`처럼 넘긴다). 상태마다 글 하나와 오른쪽 끝 단추 하나:
   - `none`: "Not set up for your other computers" [Set up] → `createIdentity`
   - `uncommitted`: "Not committed yet. Commit .lophn-project.json so your other computers get it."
   - `ignored`: ".gitignore excludes .lophn-project.json, so it does not reach your other computers."
   - `committed`: "The same project on your other computers"
   - `conflict`: "Two computers set this up separately. lophn keeps the older one." [Resolve] → `createIdentity`
   - `missing`: ".lophn-project.json is missing from the folder." [Restore] → `createIdentity`
   - `unreadable`: "lophn cannot read .lophn-project.json. Fix or delete it."
   - `duplicate_of`가 있음: "Another copy of <title> on this computer." [Separate project]
   - `committed`·`uncommitted`에도 줄 끝 menu에 [Separate project]. 누르면 확인 dialog("This folder gets a new id and becomes a different project on your other computers. Commit the change in this repository.")를 거쳐 `renewIdentity`. `secondary`다(되돌릴 수 없는 파괴가 아니다).
   - `repo`가 `none`: "Not in git, so this project stays on this computer." 단추 없음. 폴더를 못 찾으면 줄을 그리지 않는다(폴더 줄이 이미 알린다).
   - 단추의 실패는 이 dialog의 다른 오류처럼 toast로 보이고 줄을 다시 읽는다.
5. 새 문구 key를 `workspace.ts`에 더한다(이웃 key의 꼴: `home.label.share-identity`, `home.note.identity-adds-file`, `projects.label.other-computers`, `projects.state.identity-*`, `projects.button.identity-set-up|resolve|restore|separate` 같은 이름).
6. gallery: `shell/project-identity-scene.tsx`에 등록 dialog 셋(git·켬, relink 제안, git이 아님)과 상세 줄 여섯(`none`, `uncommitted`, `committed`, `conflict`, `missing`, duplicate)을 fake source와 drive로 그리는 page를 만들고 `shell.tsx`에 `shell-project-identity`로 올린다(page id는 바꾸지 않는다).

## 끝남

- `npm run check`가 통과한다.
- `npm run wireframes`가 되고, gallery의 `shell-project-identity`가 실제 dialog로 위 상태를 그린다.
- 위험 test: 없음(화면과 문구. 규칙은 core가 지킨다).
- 남지 않음: 없음.
- flows catalog: 사람이 등록 dialog에서 켜고 등록하는 journey 줄, 상세의 [Set up]·[Resolve]·[Restore]·[Separate project] 줄(entry는 `route:projects/create_identity`·`route:projects/renew_identity`, area `shell-workspace`), renderer allowlist 줄, gallery page를 가리키는 `observe: [screen:shell-project-identity]`를 `project-docs/flows/`에서 고친다(자기 줄만). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: gallery 그림의 path(등록 셋, 상세 여섯), 사람에게 보일 문구 목록(lead가 사람에게 보이고 고친다), 넘길 줄(`allowlist.ts`, `shell.tsx`).
