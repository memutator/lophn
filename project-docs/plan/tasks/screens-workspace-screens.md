# screens-workspace-screens

Lophn Workspace의 Projects 화면과 Apps 화면, 런처(project 카드, 등록 dialog, Apps 묶음, 빈 상태), 시작 실패 화면을 wireframe 코드에서 renderer로 옮긴다. tracking·문서 수·문서 정리·export·짧은 이름(slug)을 지우고, 목록 끝의 + 등록, 하위 폴더 중첩, "Folder not found" 상태와 새 위치 고르기를 새로 얹는다.

- 단위: screens-workspace (wave 3)
- 선행: screens-workspace-settings, screens-data-waiting (앞 task와는 `catalog/workspace.ts`를 같이 고치므로 순서를 건다. `screens-data-waiting`은 런처 위쪽 바에 `WaitingLayer`(대기 pill과 panel)를 꽂기 때문이고 옛 `SpaceDecisions`가 런처에서 갈아타진다. `LophnSpace`가 `ProjectsScreen`·`AppsScreen`을 부르는 props 변경은 `screens-workspace-space`가 맞춘다. 이 task는 두 component의 export 이름을 유지하고 안 쓰게 된 prop은 type에서 지우지 않는다)
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/lophn-space/projects/`
  - `packages/shell/renderer/desktop/lophn-space/apps/`
  - `packages/shell/renderer/desktop/launcher/`
  - `tools/wireframes/frames/compositions/workspace/{projects-screen,apps-screen,register-panel,subfolder-picker,launcher-pages,start-failure-page}.tsx`
  - `packages/design/wording/catalog/workspace.ts` (wording-split이 만든 file. 이 task의 key는 `launcher.*`, `projects.*`, `apps.*`다. key는 이름순으로 끼운다)
  - `packages/design/wording/catalog/workspace.placeholders.ts` (`generate.ts`가 만드는 생성물)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `U6.7#4`
  - spec: S8 2장(Project Manager는 project 등록 때 생긴다), S4 2장(place 정보에 폴더 설명·하위 폴더) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`, `agent-definition.md`
  - inventory: `U2.5#2`, `U2.5#3`, `U2.6#1`, `U1.5#12`, 그리고 contract 단위에서 화면 몫으로 넘어온 `U2.6#2`(시작 실패 화면. IPC와 `shell/ipc/core.ts`는 contract-shell), `U3.5#3`(폴더를 찾을 수 없음. 폴더 고르기 IPC는 contract-shell)
  - 결정: `../README.md` 3장 #18·#23·#57(이름). `ui-inventory.md` 6.7(Projects: + 단추, 하위 폴더 중첩)
  - 본보기(화면):
    - `tools/wireframes/frames/compositions/workspace/projects-screen.tsx` (`ProjectsScreen`) → `projects/projects-screen.tsx`, `projects/project-detail.tsx`
    - `tools/wireframes/frames/compositions/workspace/subfolder-picker.tsx` → 새 `projects/subfolder-picker.tsx`
    - `tools/wireframes/frames/compositions/workspace/register-panel.tsx` → `launcher/register-dialog.tsx` (런처와 Projects의 + 단추가 같이 쓴다)
    - `tools/wireframes/frames/compositions/workspace/apps-screen.tsx` → `apps/apps-screen.tsx`
    - `tools/wireframes/frames/compositions/workspace/launcher-pages.tsx` → `launcher/launcher.tsx`, `project-card.tsx`, `apps-section.tsx`
    - `tools/wireframes/frames/compositions/workspace/start-failure-page.tsx` → `launcher/start-failure/`
    - `tools/wireframes/frames/compositions/workspace/data.ts` (가짜 data. 다른 task의 composition도 읽으니 지우지 않는다)
- 계약:
  - 쓰는 것:
    - `protocol/projects`의 project 읽기·`create`·`update`·`archive`·`unarchive` route(`project-routes.ts`)와 contract-platform(wave 2)이 `core/projects/registry`와 함께 둔 새 모양: 이름 하나(slug 없음), 목적, 폴더와 폴더 설명, 하위 폴더와 설명(req-1524), 폴더가 사라졌는지.
    - `shell/ipc/folder-picker.ts`의 `FolderPickerApi.pick({ purpose?: "register" | "relocate" })`(contract-shell). 등록 폴더 추가는 `register`, 사라진 폴더의 새 위치는 `relocate`다. 하위 폴더 고르기가 등록 폴더 안으로만 열리는 것은 이 task가 그리는 목록 dialog에서 한다(OS dialog가 아니다).
    - `WaitingLayer`(screens-data-waiting).
    - 앱 목록·보관: `protocol/apps`의 기존 읽기·보관 route.
    - 시작 실패 세 경우(높은 schema, hash가 다른 이력, 손상 원본): contract-shell이 `shell/ipc/core.ts`에 둔 연결 상태 type.
    - ui-chrome(wave 2)의 design `Toast`, 위쪽 바.
  - 내놓는 것 (`lophn-space.tsx`·`main.tsx`가 import한다. 이름을 유지한다): `ProjectsScreen`, `AppsScreen`, `Launcher`, `RegisterDialog`, 타입 `LauncherSource`·`AppsSource`, fake `fakeApps`(`apps/testdata/fake-apps.ts`)와 launcher fake(`dev-mock/launcher.ts`가 쓰는 것). `ProjectsScreen`의 새 source는 `projects/source.ts`의 `ProjectsSource`이고 `ProjectsScreen`이 `source` prop으로 받는다. `OrganizeSource` prop과 `lophn: LophnSource` prop은 안 쓰게 되지만 type에서 지우지 않고 보고에 적는다.

## 할 일

1. **Projects 화면** — `projects/projects-screen.tsx`(156줄), `project-detail.tsx`(326줄), 새 `projects/source.ts`·`core-source.ts`·`testdata/fake-projects.ts`. (`U2.5#2`)
   - 지금 화면은 `OrganizeSource`(wave 1이 지운 `organize/`)와 `DocumentPanel`·`ExportPanel`에 기대 있다. 그것들을 import하는 줄과 `documents.module.css` 참조(`documents/`도 지워졌다)를 모두 걷고 새 `ProjectsSource`로 바꾼다.
   - 왼쪽 목록: project 카드(이름, 목적, 폴더 사라짐이면 `StatusMark` "Folder not found"), 마지막 카드 아래 동그란 + 단추("Register project", 누르면 등록 dialog), "Archived" 묶음(이름, 다시 꺼내기 단추).
   - 상세: 이름 하나(slug 칸 없음), 목적, 폴더마다 경로와 폴더 설명, 폴더 안 하위 폴더 목록(경로, 설명 입력, [Remove], 뺐을 때 "removed from the project. The folder itself is untouched." + [Undo]), [Add subfolder], 보관 단추. tracking, 문서 수, 문서 정리, export는 없다(`ExportPanel`, `DocumentPanel`, `takenNames` 계열 모두 지운다). 저장은 [Save changes]다.
   - 하위 폴더 더하기 dialog(`subfolder-picker.tsx`): 폴더 고르기가 그 등록 폴더 안으로만 열리고 등록 폴더가 트리의 맨 위다. 등록 폴더가 사라졌으면 [Add subfolder]는 꺼지고 "Choose the folder's new location before adding subfolders."를 보인다.
   - 폴더가 사라진 project: 목록 카드와 상세에 "Folder not found"와 [Choose new location](`pick({ purpose: "relocate" })`)을 보이고, 화면 위쪽에 design `Toast`를 띄운다 — "A registered folder is missing", "<경로> was moved or deleted. Work that needs this folder waits until you choose its new location." [Choose new location]. 새 위치를 고르면 이어진다. (`U3.5#3`)
   - `ProjectsSource`: 목록(보관 포함), 상세 읽기, 이름·목적·폴더 설명 저장, 하위 폴더 더하기·고치기·빼기, 새 위치 고르기, 보관·다시 꺼내기, 등록(`LauncherSource.register`와 같은 input)을 가진다. `core-source.ts`는 계약 route를 부른다. 계약에 route가 없는 method(하위 폴더, 새 위치)는 contract-platform이 `core/projects/registry`에 둔 route 이름을 쓰고, 계약에도 없으면 `{ ok: false, code: "unavailable" }`로 두고 "계약 바꾸기 요청"에 적는다.
2. **Apps 화면** — `apps/apps-screen.tsx`(195줄), `model.ts`, `source.ts`, `core-source.ts`. (`U2.5#3`) 목록과 보관·다시 꺼내기만 둔다(wireframe `apps-screen.tsx`). 앱 등록은 이 화면의 일이 아니다. 앱 행의 열기는 그 앱의 앱 공간(`onApp`)으로 간다. 남아 있는 앱 상태 해석(`appStatus` 등 `model.ts`)은 `app-frame/app-bar.tsx`가 import하므로 이름을 유지한다.
3. **런처** — `launcher/launcher.tsx`(276줄), `project-card.tsx`, `apps-section.tsx`, `model.ts`, `source.ts`, `core-source.ts`, `register-dialog.tsx`(243줄). (`U2.6#1`)
   - project 카드: 이름, 목적, 폴더 개수("1 folder" / "N folders"), 폴더가 사라졌으면 "Folder not found". tracking 상태 줄, 패턴과 gitignore 줄, 문서 수, project id 줄을 뺀다(`cardStatus`·`TrackingRule`·`useGitignore`·`documentCount`·`name`(slug) 지운다).
   - 등록 dialog: 이름, 목적, 폴더와 폴더 설명(폴더 추가·제거). 짧은 이름(slug) 고르기를 뺀다(`takenNames`, `shortNameOf`, `SHORT_NAME_MAX`, `registerFailure`의 slug 겹침 처리).
   - 위쪽: 왼쪽 `Wordmark`, 오른쪽 "Lophn Workspace" 단추(이름은 기존 key `launcher.button.lophn`을 쓴다. 글은 screens-data가 `U2.1#7`로 바꾼다). 섹션 머리: "Projects (N)"와 등록 `IconButton`("Register project"), "Apps (N)".
   - 빈 상태: 프로젝트도 앱도 없으면 `EmptyState` — "Nothing to open yet. Register a project or an app in Lophn Workspace." + [Lophn Workspace].
   - 대기 개수 pill은 `WaitingLayer`를 위쪽 바 오른쪽에 꽂는다(Lophn Workspace 단추 왼쪽). 옛 `SpaceDecisions` import를 걷는다. `onOpenSession(session)`·`onAnswerInTerminal(session)`은 `Launcher` prop으로 호스트에서 받아 넘긴다(호스트는 `screens-workspace-space`가 라우팅한다).
4. **시작 실패** — `launcher/start-failure/start-failure.tsx`, `model.ts`. (`U2.6#2`) 연결 실패를 세 경우로 나눈다: 더 높은 schema("This data is from a newer lophn"), hash가 다른 이력("The saved history does not match"), 손상 원본("Your data can't be read"). 셋 모두 제목, "lophn did not start. It left your data …" 설명, update 안내, 접힌 자세히(검사 내용 한 줄)를 보인다. 어느 경우인지는 contract-shell의 연결 상태 type으로 가른다. 지금 쓰이지 않는 `failed-schema` 갈래를 이 세 경우로 대체한다.
5. **fake source** — `launcher`(`dev-mock/launcher.ts`가 쓰는 것), `projects/testdata/fake-projects.ts`, `apps/testdata/fake-apps.ts`를 wireframe `workspace/data.ts`(`PROJECTS` phroner·grocery-budget, `ARCHIVED_PROJECTS`, `APPS`, `MISSING_FOLDER`)로 채운다. 폴더가 사라진 상태는 fake 설정 인자로 고른다.
6. **글을 wording key로 바꾼다.** 박아 둔 영어 글을 `catalog/workspace.ts`의 `launcher.*`, `projects.*`, `apps.*` key로 만든다(글이 바뀌지 않은 곳은 기존 key를 그대로 쓴다). 그 영역에서 참조가 0이 된 key(export, step, file·place·move·rename·document, tracking 계열 `projects.*` — `U1.5#12`)는 `grep -rn "<key>" packages tools`로 0줄임을 확인하고 지운다. 다른 영역 key는 건드리지 않는다. 만든 뒤 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 `catalog/workspace.placeholders.ts`를 다시 만든다.
7. **CSS** — `launcher.module.css`, `lophn-space/projects/*.module.css`, `apps/*.module.css`를 wireframe의 `workspace.module.css`(741줄) 규칙으로 맞춘다. 행동 단추는 줄 오른쪽 끝(6.1).
8. **gallery를 옮긴 component로 그린다.** `projects-screen.tsx`(`ProjectsScreen`, props `selected`·`missingFolder`·`editSubfolders`), `apps-screen.tsx`(`AppsScreen`), `register-panel.tsx`(`RegisterPanel`), `subfolder-picker.tsx`(`SubfolderPicker`), `launcher-pages.tsx`(`LauncherProjects`·`LauncherEmpty`·`LauncherRegister`), `start-failure-page.tsx`(`StartFailures`)는 export 이름과 props를 그대로 두고 본문을 renderer component + fake source로 바꾼다. `missingFolder`는 fake의 사라진 폴더 설정으로, `editSubfolders`는 mount 뒤 click(첫 하위 폴더 설명 입력, 마지막 [Remove])으로 만든다. click helper가 필요하면 `workspace/drive.ts`에 작게 둔다. `workspace/pages.tsx`, `workspace-page.tsx`, `settings-shell.tsx`는 `screens-workspace-space`가 고친다. `StartFailures`는 세 경우를 한 창에 나란히 놓는 모양을 유지하되 각 경우의 body는 renderer `start-failure.tsx`이다.
9. (lead가 맞추며 더함 (`U6.7#4`)) Projects: 목록의 마지막 카드 아래에 동그란 + 단추로 등록한다. 등록 폴더 아래에 하위 폴더가 중첩으로 보인다(req-1524). Folders 머리 아래에 여백을 둔다

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면 task. 등록 폴더 밖으로 나가는 경로 거절은 B8의 위험 test 몫이다)
- 남지 않음: `grep -rn "OrganizeSource\|DocumentPanel\|ExportPanel\|takenNames\|shortNameOf\|useGitignore\|documentCount" packages/shell/renderer/desktop/lophn-space/projects packages/shell/renderer/desktop/launcher`가 0줄이다.
- (화면) `deno task wireframes`가 되고, gallery의 `new-workspace`, `new-workspace-folder-missing`, `new-workspace-subfolder-add`, `new-workspace-subfolder-edit`, `new-workspace-apps`, `new-launcher-projects`, `new-launcher-empty`, `new-launcher-register`, `new-start-failure`가 옮긴 component로 그려진다. (Workspace 바깥 틀과 sidebar는 `pages.tsx`의 `WorkspaceWithoutProject`가 아직 look-alike다. space task가 바꾼다)

## 보고

- 바꾼 file
- 등록할 것: 영역 `workspace`의 새 key와 지운 key(`generate.ts`로 영역 file만 만든다). `desktop/entry.tsx`·`desktop/dev-mock/launcher.ts`·`dev-mock/mod.ts`가 만드는 source(`coreLauncherSource`, 새 `ProjectsSource`의 core·fake factory 이름) — screens-workspace-space가 잇는다.
- 안 쓰게 된 export: `OrganizeSource`를 받던 props, `ProjectCard`의 tracking 칸 등 (남이 쓰던 것은 지우지 않았다)
- 남긴 prop: `ProjectsScreenProps`의 `lophn`, `LauncherProps`에서 안 쓰게 된 것
- 정한 것: `ProjectsSource`의 method 이름, 사라진 폴더를 알아내는 방법, 시작 실패 세 경우를 가르는 값
- 계약 바꾸기 요청(wave 3): registry 계약에 하위 폴더·새 위치 route나 "폴더가 사라졌음" 칸이 모자라면 적는다
