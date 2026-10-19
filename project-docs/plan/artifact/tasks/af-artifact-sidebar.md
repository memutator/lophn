# af-artifact-sidebar

project 창의 sidebar에 Artifacts 모양을 더한다: 그 project의 artifact 목록(이름, 제목, 설명)을 보이고 누르면 artifact 탭을 연다. wave 1 wireframe `artifact-sidebar-list`를 renderer로 옮긴다.

- 단위: artifact-screen (wave 2)
- 선행: af-artifact-tab. 이 task는 그 task가 만든 `useArtifactList`와 `openArtifact`를 import한다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/sidebar/project-sidebar.tsx`
  - `packages/shell/renderer/workspace/sidebar/artifact-panel.tsx`
  - `packages/shell/renderer/workspace/sidebar/artifact-panel.module.css`
  - `packages/shell/renderer/workspace/workspace.tsx`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "1. artifact model"의 수명 표(찾기: 관례 자리 `artifacts/*/index.html`)와 "2. artifact 탭"의 "여는 길"
  - 본보기(화면): wave 1의 `tools/wireframes/drafts/artifact/`(`artifact-sidebar-list`, 옮길 코드), `workspace/sidebar/project-sidebar.tsx:24`(`SidebarTab`, `TABS`, `contextPanel` slot 꼴), `workspace/sidebar/agent-panel.tsx`(목록 줄의 모양), `workspace/workspace.tsx:1149`(`contextPanel` 넘기는 곳)
  - 계약: `packages/shell/renderer/artifact/use-artifact-list.ts`, `renderer/workspace/kinds/artifact.tsx`(`openArtifact`) — af-artifact-tab
  - 문구: `packages/design/wording/catalog/artifact.ts`, `project-workspace.label.sidebar-tab-artifact`(`catalog/project.ts`). 모자라는 key는 `catalog/artifact.ts`에 더한다(허용된 예외).
  - 스킬: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
- 계약:
  - 쓰는 것: `useArtifactList(project)`, `openArtifact(host, project, name)`
  - 내놓는 것: 없음(화면 끝 task)

## 할 일

1. `project-sidebar.tsx`
   - `SidebarTab`과 `TABS`에 `"artifact"`를 더한다. 탭 이름은 `` t(`project-workspace.label.sidebar-tab-${key}`) ``가 만들므로 key가 catalog에 이미 있는지 확인한다(wave 1이 `catalog/project.ts`에 넣었다).
   - `contextPanel`과 같은 방식으로 본문 slot `artifactPanel: ReactNode`를 받아 `tab === "artifact"`일 때 그린다(`ProjectSidebar`는 목록을 직접 읽지 않는다).
2. `artifact-panel.tsx`(+ css): `useArtifactList(project)`로 목록을 읽어 줄마다 이름·제목·설명 한 줄을 그린다. 누르면 `onOpen(name)`. 빈 목록 안내. 탭이 보일 때 한 번 읽고(`reload()`), 다시 읽기 단추는 두지 않는다. 폴더 변경을 실시간으로 따라가지는 않는다(sidebar가 다시 보일 때 읽는다). wireframe의 모양을 그대로 옮긴다.
3. `workspace.tsx`: `<ProjectSidebar … artifactPanel={<ArtifactPanel project={…} onOpen={(name) => openArtifact(host, projectId, name)} />}`를 넘긴다. 이 file에서 그 한 곳만 고친다.

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고, `deno run -A packages/shell/renderer/build.ts`로 bundle이 선다. (gallery page는 wave 3 `af-gallery`가 renderer component로 옮겨 그린다.)
- 위험 test: 없음(화면).
- 남지 않음: 직접 박은 문구가 없다(`deno run --allow-read tools/check-wording.ts`).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 목록을 읽는 때
- 넘길 줄: `project-sidebar.tsx`와 `workspace.tsx`는 domain-kinds(contexts 화면 지움), domain-place도 건드린다(`TABS`, `contextPanel`, sidebar 구성)
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 목록이 폴더 변경을 실시간으로 따르지 않는다

## lead가 더함

- **지우기 단추는 두지 않는다(사람 결정).** Draft의 휴지통 단추는 옮기지 않는다. 화면에서 artifact를 지우는 일은 roadmap에 남긴다. 쓰지 않게 된 `artifact.button.delete` key를 `packages/design/wording/catalog/artifact.ts`에서 지우고 `deno task wording`을 돌린다.
- **Context 탭은 건드리지 않는다.** domain-kinds가 이미 지웠다. Artifacts 탭은 Explorer, Agent 다음 세 번째다.
- **gallery 후속(추가 소유):** `tools/wireframes/drafts/artifact/`, `tools/wireframes/drafts/index.tsx`, `tools/wireframes/pages/screens/artifact.tsx`, `tools/wireframes/pages/screens/artifact/`, `tools/wireframes/mock/artifact/`, `packages/design/wording/catalog/artifact.ts`(+ placeholders)
  - Drafts의 `artifact-sidebar-list`, `artifact-sidebar-empty`를 renderer의 진짜 `ProjectSidebar`·`ArtifactPanel`로 그린 Screens page로 옮긴다(page id는 그대로). 가짜 목록은 `mock/artifact/data.ts`의 `ARTIFACTS`와 `fakeArtifactApi`를 쓴다.
  - `tools/wireframes/drafts/artifact/`를 지우고 `drafts/index.tsx`에서 두 항목과 import를 뺀다. `grep -rn "drafts/artifact" tools --include=*.ts --include=*.tsx`가 0줄이다.
