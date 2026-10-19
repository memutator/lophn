# af-gallery

wave 1의 Drafts(Experiments) wireframe을 지우고, renderer에 들어간 진짜 component로 그린 Screens 영역 `artifact`로 옮긴다: artifact 탭, 사람의 `.html` 탭, annotate mode, 폴더가 없을 때, sidebar의 artifact 목록, 대화 글의 artifact link. 앱 view는 gallery에 없으므로 view 자리에는 고정 그림을 넣는다.

- 단위: artifact-screen (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tools/wireframes/pages/screens/artifact.tsx`
  - `tools/wireframes/pages/screens/artifact/`
  - `tools/wireframes/mock/artifact/`
  - `tools/wireframes/mock/mock-desktop.tsx`
  - `tools/wireframes/drafts/artifact/`
  - `tools/wireframes/drafts/index.tsx`
- 읽을 것:
  - 스킬: `.claude/skills/ui-design/SKILL.md`("새 화면 만들기"의 4~7, "함정": 앱 view·`<webview>`는 gallery에 없다, page id는 한 번 정하면 바꾸지 않는다)
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "5. shell"(gallery에 더할 것: artifact 탭, [Edit source], project 화면의 artifact 목록, 대화 글의 artifact link, artifact annotate mode, 폴더가 없을 때)
  - 본보기: `tools/wireframes/pages/screens/browser/pages.tsx`(진짜 Workspace를 mock으로 그리고 mount 뒤 `drive`로 상태를 만든다), `pages/screens/project-workspace.tsx`(영역 file이 pages를 모으는 꼴), `tools/wireframes/mock/mock-desktop.tsx`(`TabSpec.kind`, 창 통로 provider 조립), `tools/wireframes/mock/app-space/orders-view.tsx`(view 자리의 고정 그림), `tools/wireframes/mock/drive.ts`
  - 계약: `packages/shell/renderer/artifact/testdata/fake-artifact-api.ts`와 `artifact-api.tsx`(af-artifact-tab), wave 1의 `tools/wireframes/drafts/artifact/`(옮길 page id와 data)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `design`, `tools`(`project-docs/module-catalog.yaml`의 `tools`)
- 계약:
  - 쓰는 것: renderer component(`ArtifactTab` 등), `fakeArtifactApi`, `ArtifactApiProvider`, `AnnotateApiProvider`
  - 내놓는 것: `artifactArea: Area`(`pages/screens/artifact.tsx`). page id는 wave 1의 Drafts와 같다: `artifact-tab`, `artifact-tab-file`, `artifact-annotate`, `artifact-missing`, `artifact-sidebar-list`, `artifact-chat-link`.

## 할 일

1. `mock/mock-desktop.tsx`: `TabSpec.kind`에 `"artifact"`와 그 탭의 필드(project·name 또는 path)를 더하고, 창 통로 provider 조립에 `ArtifactApiProvider`·`AnnotateApiProvider`(가짜 api)를 끼운다(`BrowserApiProvider` 옆).
2. `mock/artifact/`: view 자리에 넣는 고정 그림(`spending` 막대 그래프, token 색)과 가짜 data(artifact 목록, 대화 글, annotate 상태).
3. `pages/screens/artifact.tsx`와 `pages/screens/artifact/`: 위 여섯 page. 진짜 `Workspace`/`ProjectSidebar`/`MessageBody`를 mock으로 그리고, 상태(annotate 켜짐, 폴더 없음)는 fake api 설정과 `useDrive`로 만든다. 화면 root는 `position: absolute; inset: 0`(함정). 문구는 wording key.
4. wave 1 Drafts 여섯 page와 `tools/wireframes/drafts/artifact/`를 지우고 `drafts/index.tsx`에서 항목을 뺀다(옛 draft를 남기지 않는다).
5. 새 영역을 `pages/index.ts`의 `GROUPS`(Screens)에 올리는 일은 lead가 한다. 보고에 `artifactArea` import 줄을 적는다.

## 끝남

- `deno task check`가 통과한다.
- `deno task wireframes`가 되고, gallery의 `artifact` 영역 여섯 page가 renderer component로 그려진다(light·dark). (lead가 `pages/index.ts`에 등록한 뒤 확인한다. 등록 전에는 `?frame=` 주소로 직접 본다.)
- 위험 test: 없음(화면).
- 남지 않음: `grep -rn "drafts/artifact" tools` 0줄.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `tools/wireframes/pages/index.ts`의 `GROUPS`에 `artifactArea`(import 한 줄, Screens의 areas에 한 칸)
- 안 쓰게 된 export: 없음
- 정한 것: 가짜 data
- 넘길 줄: `mock-desktop.tsx`는 다른 계획도 고친다(`TabSpec`, provider 조립)
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: gallery에는 native view가 없어 view 안(page)의 annotate 표지는 고정 그림이다
