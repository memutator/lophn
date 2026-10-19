# de-shell-domain-list

**사람이 `de-drafts`의 `domain-project-*`, `domain-app-*` page 가운데 모양을 고른 뒤에 띄운다(lead가 아래 "고른 모양"을 채운다).** project 창과 앱 공간에서 그 그릇의 domain을 보이고 만들고 보관하는 화면을 renderer에 올린다. domain 줄에서 `DOMAIN.md`를 편집기로 연다. 화면은 고른 Draft의 코드를 옮긴다(보고 다시 그리지 않는다).

- 단위: shell-domains (wave 5)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/domains/`(새 폴더)
  - `packages/shell/renderer/workspace/sidebar/{project-sidebar.tsx,project-sidebar.module.css,domain-panel.tsx,domain-panel.module.css}`
  - `packages/shell/renderer/workspace/{workspace.tsx,source.ts,core-source.ts,fake-source.ts}`
  - `packages/shell/renderer/app-frame/`
  - `packages/shell/renderer/editor/instructions-entry.tsx`
  - `packages/shell/ipc/instructions.ts`
  - `packages/shell/main/editor/instructions.ts`
  - `packages/design/wording/catalog/domain.ts`
  - `packages/design/wording/catalog/domain.placeholders.ts`
  - `packages/design/wording/catalog/project.ts`
  - `packages/design/wording/catalog/project.placeholders.ts`
  - `packages/design/wording/catalog/app-space.ts`
  - `packages/design/wording/catalog/app-space.placeholders.ts`
  - `tools/wireframes/mock/domain/`
  - `tools/wireframes/pages/screens/domain.tsx`(새 file)
  - `tools/wireframes/pages/screens/domain/`(새 폴더)
- 읽을 것:
  - skill: `.claude/skills/ui-design/SKILL.md`(새 화면 만들기, 확인), `.claude/skills/wording/SKILL.md`
  - architecture: `project-docs/architecture/workspace-layout.md`(sidebar와 탭), `project-docs/architecture/ui-kit.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "화면", "앱의 domain"(마지막 domain은 보관하지 못한다), `project-docs/products/roadmap/domain.md`
  - 본보기(화면): 사람이 고른 `de-drafts`의 page(`tools/wireframes/drafts/domain/pages.tsx`)와 그 전 화면 `tools/wireframes/pages/screens/project-workspace.tsx`, `app-space.tsx`
- 계약:
  - 고른 모양: project는 `domain-project-a`(sidebar 네 번째 탭 Domains. 240px에서 탭 이름 넷이 잘리는 것을 같이 푼다: 탭 이름을 줄이거나 아이콘으로), 빈 상태 `domain-project-empty`, 만들기 `domain-create-dialog`. 앱 공간은 `domain-app-b`(App details의 Domains 절)와 `domain-app-last`(마지막 domain은 Archive를 끄고 tooltip). 사람이 2026-10-19에 골랐다.
  - 쓰는 것: `WorkspaceSource.domains(project)`·`DomainView`(`de-shell-artifact-data`가 놓았다), core command `domain.create`·`domain.archive`·`domain.unarchive`(`de-domain-core`), core read `domain.list`, `domainDocFile`·`DOMAIN_DOC_FILE`(`packages/protocol/domains/paths.ts`)
  - 내놓는 것: `WorkspaceSource`에 `createDomain(owner, {name, title, purpose})`·`archiveDomain(domain)`·`unarchiveDomain(domain)`. `InstructionsPlace`(`ipc/instructions.ts`)에 `{layer: "domain", place: dom_…}`(편집기가 `domainDocFile`을 연다).

## 할 일

1. 고른 Draft 코드를 renderer로 옮긴다: project 창은 `workspace/sidebar/domain-panel.tsx`(A를 골랐으면 네 번째 탭, B를 골랐으면 Agent 탭 위 칩 줄 component), 앱 공간은 `app-frame/` 안(A: 위쪽 바의 칩 줄, B: 앱 상세 패널의 절). fake source와 fake data는 Draft의 `mock/domain/`에서 `workspace/fake-source.ts`와 `app-frame/testdata/`로 옮긴다.
2. core 연결: `workspace/core-source.ts`가 `domain.create`·`archive`·`unarchive`를 부른다. 앱의 마지막 domain의 Archive는 꺼 두고(같은 그릇의 active domain 수로 판단) core가 `conflict`로 거절하면 그 이유를 같은 위치에 보인다. name은 slug 규칙(`slugSchema`와 같은 정규식의 사본)을 입력에서 검사한다.
3. `DOMAIN.md` 열기: 줄의 menu(Open DOMAIN.md)가 `lophnInstructions.open({target: {layer: "domain", place: <domain id>}})`를 부른다. `ipc/instructions.ts`의 target schema에 domain을 더하고 `main/editor/instructions.ts`의 `pathOf`가 `domainDocFile(dataRoot, domain)`을 돌려준다(폴더가 없으면 `makeDir`로 만든다. 첫 저장이 file을 만든다).
4. wording: Draft가 쓰던 `domain` 영역 key를 그대로 쓴다(다른 화면의 key와 같은 영역 file이라 안 쓰는 key는 지우지 않는다. `de-final`이 한꺼번에 지운다). `deno task wording`으로 생성물을 맞춘다.
5. wireframe: 고른 page를 `tools/wireframes/pages/screens/domain.tsx`(영역 `domainArea`)로 올리고 Draft 파일은 지우지 않는다(`de-final`이 한꺼번에 지운다). `tools/wireframes/pages/index.ts`의 `GROUPS`에 영역을 더하는 일은 lead가 한다(보고의 "등록할 것").
6. 위험 test는 두지 않는다(화면이다). 규칙(마지막 domain 보관 거절)은 core가 지킨다(`de-domain-core`).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 없음(Draft는 `de-final`이 지운다)
- (화면) `deno task wireframes`가 되고 gallery에 `domainArea`가 그려진다. `deno run -A packages/shell/renderer/build.ts`가 서고 `deno task dev:mock`에서 project 창 sidebar와 앱 공간이 domain을 보인다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물, gallery `tools/wireframes/pages/index.ts`의 `GROUPS`(`domainArea`)
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
