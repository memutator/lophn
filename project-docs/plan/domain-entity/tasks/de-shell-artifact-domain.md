# de-shell-artifact-domain

**사람이 `de-drafts`의 `domain-artifacts-*` page 가운데 모양을 고른 뒤에 띄운다(lead가 아래 "고른 모양"을 채운다).** sidebar의 Artifacts 목록이 domain 단위가 되는 화면을 올린다(domain 묶음 또는 domain 배지와 선택). 데이터 길(`{domain, name}` 신원, `useArtifactList(domains)`)은 `de-shell-artifact-data`가 이미 놓았다. 이 task는 그 위의 모양만 바꾼다.

- 단위: shell-domains (wave 5)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/sidebar/{artifact-panel.tsx,artifact-panel.module.css}`
  - `packages/shell/renderer/artifact/`
  - `packages/design/wording/catalog/artifact.ts`
  - `packages/design/wording/catalog/artifact.placeholders.ts`
  - `tools/wireframes/pages/screens/artifact.tsx`
  - `tools/wireframes/pages/screens/artifact/`
  - `tools/wireframes/mock/artifact/`
- 읽을 것:
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`
  - architecture: `project-docs/architecture/artifact.md`("목록은 program이 관례 자리에서 결정적으로 만든다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "화면"
  - 본보기(화면): 사람이 고른 `de-drafts`의 `domain-artifacts-*` page와 `domain-artifacts-single`, `tools/wireframes/pages/screens/artifact.tsx`(sidebar Artifacts list·empty page)
  - 본보기(코드): `packages/shell/renderer/workspace/sidebar/artifact-panel.tsx`, `packages/shell/renderer/artifact/use-artifact-list.ts`
- 계약:
  - 고른 모양: `domain-artifacts-a`(domain 제목 아래 접는 묶음)와 `domain-artifacts-single`(domain이 하나면 묶음 제목 없이). 사람이 2026-10-19에 골랐다.
  - 쓰는 것: `ArtifactsSlice.items`(`ArtifactListItem & {domain}`), `WorkspaceSource.domains(project)`의 `DomainView`(domain 이름·제목·목적)
  - 내놓는 것: `ArtifactPanel({domains, items, onOpen(domain, name)})`. domain이 하나뿐이면 묶음 제목·배지 없이 지금처럼 한 줄 목록이다.

## 할 일

1. `artifact-panel.tsx`를 고른 Draft 모양으로 바꾼다(A: domain 제목 아래 접을 수 있는 묶음, B: 한 목록에 domain 배지와 위쪽 domain select). 줄을 누르면 `onOpen(domain, name)`이다. domain 이름·제목은 `DomainView`에서 온다. artifact가 없는 domain은 묶음에 `artifact.empty.none` 한 줄을 보이거나(A) 목록에서 빠진다(B). Draft가 정한 대로 한다.
2. wording: 새 key를 `artifact` 영역에 더한다(`domain` 영역 key는 읽기만 한다. 그 catalog는 `de-shell-domain-list`만 고친다)(안 쓰는 key는 지우지 않는다. `de-final`이 지운다). `deno task wording`으로 생성물을 맞춘다.
3. wireframe: `screens/artifact/`의 sidebar list·empty page를 새 모양으로 바꾼다. domain 둘 이상과 domain 하나인 상태 둘 다 그린다.
4. 위험 test는 두지 않는다(화면이다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 없음
- (화면) `deno task wireframes`가 되고 gallery의 `artifactArea` sidebar list가 새 모양으로 그려진다. `deno run -A packages/shell/renderer/build.ts`가 선다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`deno task wording`)
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**

## lead가 더함

- 추가 소유: `packages/shell/renderer/workspace/use-tab-host-slices.ts`(창이 읽은 domain 목록을 id가 아니라 `DomainView[]`로 두고 `useArtifactList`에는 id를 준다), `packages/shell/renderer/workspace/workspace.tsx`의 `<ArtifactPanel …>` props 줄만(묶음 제목에 쓸 `DomainView[]`를 넘긴다). `workspace.tsx`의 나머지는 `de-shell-domain-list`의 소유다. 두 task가 같은 file의 다른 줄을 고치므로 충돌은 lead가 푼다.
- 창의 domain 목록은 창이 열릴 때 한 번 읽는다. domain을 새로 만들어도 다시 열기 전에는 Artifacts 묶음에 안 보인다(알려진 미완 동작으로 적는다).
