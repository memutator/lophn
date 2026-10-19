# de-shell-artifact-data

shell가 artifact를 다루는 길(IPC, main의 봉한 view, preload, 목록, 대화 글의 link, annotation target)을 project 단위에서 domain 단위로 바꾼다. artifact 신원은 `{domain, name}`이고 자리는 `<data>/domains/<dom>/artifacts/<name>/`이다. 사람의 폴더에 있는 `.html`은 domain이 없으므로 그대로 `{project, path}`다. 화면 모양은 바꾸지 않는다(목록은 지금처럼 한 줄 목록이고 domain 묶음은 사람이 고른 뒤 `de-shell-artifact-domain`이 한다). project의 domain 목록을 renderer가 읽는 길(`WorkspaceSource.domains`)도 이 task가 놓는다.

- 단위: shell (wave 2)
- 선행: de-routing-events
- 소유(이 task만 고친다):
  - `packages/shell/ipc/artifact.ts`
  - `packages/shell/ipc/annotation.ts`
  - `packages/shell/main/artifact/`
  - `packages/shell/main/desktop/wiring/{artifact,annotate}.ts`
  - `packages/shell/preload/{artifact-api,artifact}.ts`
  - `packages/shell/preload/annotate/`
  - `packages/shell/renderer/artifact/`
  - `packages/shell/renderer/conversation/{agent-thread,agent-view}.tsx`
  - `packages/shell/renderer/conversation/message-list/{artifact-text,message-body}.tsx`
  - `packages/shell/renderer/workspace/{workspace.tsx,use-tab-host-slices.ts}`
  - `packages/shell/renderer/workspace/{source,core-source,fake-source}.ts`
  - `packages/shell/renderer/workspace/kinds/{artifact,agent,document-editor}.tsx`
  - `packages/shell/renderer/workspace/kinds/host.ts`
  - `packages/shell/renderer/workspace/sidebar/{artifact-panel,project-sidebar}.tsx`
  - `packages/shell/renderer/desktop/entry.tsx`
  - `tools/wireframes/pages/screens/artifact.tsx`
  - `tools/wireframes/pages/screens/artifact/`
  - `tools/wireframes/mock/artifact/`
- 읽을 것:
  - architecture: `project-docs/architecture/artifact.md`(전체. "자리는 …", "봉한 scheme은 …", "annotation의 신원은 shell main이 view의 source로 정한다"), `project-docs/architecture/annotation.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/main`, `packages/shell/ipc`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > artifact", `project-docs/products/roadmap/domain.md`의 "정한 것 (agent) > artifact 신원"
  - 본보기(코드): `packages/shell/main/artifact/{list,source,registry}.ts`, `packages/shell/ipc/artifact.ts`(`artifactSourceSchema`, `artifactListSchema`), `packages/shell/renderer/artifact/use-artifact-list.ts`, `packages/shell/renderer/conversation/message-list/artifact-text.tsx`
- 계약:
  - 쓰는 것: `packages/protocol/domains/{paths,artifact,values}.ts`의 `domainArtifactsFolder`, `DOMAIN_ARTIFACTS_FOLDER`, `ARTIFACT_ENTRY`, `parseArtifactMeta`, `artifactMentions(text, known)`, `artifactNameSchema`(전부 import 없음. shell main이 import한다), `de-routing-events`가 바꾼 `annotationTargetSchema`(`{kind: "app", app}` | `{kind: "artifact", domain, name}` | `{kind: "file", project}`), core read `domain.list`
  - 내놓는 것
    - IPC: `artifactSourceSchema` = `{kind: "artifact", domain: dom_…, name}` | `{kind: "file", project: prj_…, path}`, `artifactListSchema` = `{domain: dom_…}`. 목록 줄은 renderer가 `domain`을 붙여 쓴다(`ArtifactListItem & {domain}`).
    - `ArtifactsSlice`(`workspace/kinds/host.ts`): `{items: readonly (ArtifactListItem & {domain: string})[], names: readonly {domain, name}[], reload()}`.
    - `WorkspaceSource.domains(project) → Promise<Result<readonly DomainView[]>>`와 fake. `DomainView = {id, name, title, purpose, status}`다(`de-shell-domain-list`가 쓴다).

## 할 일

1. IPC·main: `ipc/artifact.ts`의 source·list schema를 위 계약으로 바꾸고 domain id regex(`dom_` + ULID)를 사본으로 둔다(main이 protocol의 zod를 못 쓴다). `main/artifact/list.ts`·`source.ts`는 폴더를 `domainArtifactsFolder(dataRoot, domain)`로 푼다(`join(dataRoot, "projects", …)` 없앤다). `registry.ts`의 같은 source 비교와 view 신원을 `domain`으로 바꾼다. `main/desktop/wiring/{artifact,annotate}.ts`가 annotate target을 view의 source로 만든다: artifact view는 `{kind: "artifact", domain, name}`, `.html` file view는 `{kind: "file", project}`다(page가 보낸 값은 쓰지 않는다). `ipc/annotation.ts`의 target 사본도 맞춘다. `source_test.ts`·`paths_test.ts` 등 main test의 root를 `domains/<dom>/artifacts`로 바꾼다. 봉한 view의 경계 test(폴더 밖, symlink, 4 MiB)는 지우지 않고 새 root로 옮긴다.
2. preload: `artifact-api.ts`·`artifact.ts`·`annotate/`가 새 모양을 따라간다(type만).
3. renderer 목록과 link: `artifact/use-artifact-list.ts`는 `domains: readonly string[]`을 받아 domain마다 `api.list({domain})`를 읽어 domain 순서(주어진 순서), 이름 순으로 낸다. `use-tab-host-slices.ts`가 project의 domain id(`WorkspaceSource.domains`)로 부른다. `message-list/artifact-text.tsx`는 `artifactMentions(text, known)`의 새 규칙(`…/domains/<dom>/artifacts/<name>` path 조각)과 `NAMED` 정규식을 쓰고, 모르는 `(domain, name)`이 나오면 목록을 이름당 한 번 다시 읽는다. `kinds/artifact.tsx`의 탭과 `openArtifact(domain, name)`, `kinds/document-editor.tsx`의 `.html` 열기(`{kind: "file", project, path}`), `sidebar/artifact-panel.tsx`(`domains` prop, `onOpen(domain, name)`), `project-sidebar.tsx`, `workspace.tsx`가 따라간다. 탭 key에 domain이 든다.
4. `WorkspaceSource.domains`: `workspace/source.ts`에 type, `core-source.ts`에 core `domain.list` 읽기(`{owner: {kind: "project", id}, status: "active"}`), `fake-source.ts`와 fake data에 domain 둘짜리 project 하나(이름은 gallery용이다). `desktop/entry.tsx`의 provider를 맞춘다.
5. wireframe: `pages/screens/artifact.tsx`와 `artifact/`, `mock/artifact/`의 fake api·목록을 새 모양으로 맞춘다(그리는 화면은 같다).
6. 위험 test는 위 경계 test를 옮기는 것으로 충분하다. 새 e2e·browser test는 만들지 않는다.

## 정한 것

- `.html` file annotation의 받는 쪽은 그 project의 PM이다(core가 정한다). 이 task는 target만 만든다.
- 대화 글의 artifact link는 path에 든 domain id로 만든다. 아직 목록에 없는 domain의 path는 link로 만들지 않는다(project의 domain 목록 밖이다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "봉한 artifact view는 그 domain의 artifacts 폴더 안 일반 file만 준다. `..`, symlink, 4 MiB 넘는 file, 다른 domain 폴더는 열지 못한다" — `packages/shell/main/artifact/paths_test.ts`·`source_test.ts`(root만 옮긴다)
- 남지 않음: `grep -rn "protocol/projects/artifact" packages/shell tools/wireframes`가 0줄이다. `grep -rnw "ARTIFACTS_FOLDER" packages/shell`이 0줄이다. `grep -rn "\"projects\", " packages/shell/main/artifact`가 0줄이다.
- (화면) `deno task wireframes`가 되고 gallery의 `artifactArea`가 그대로 그려진다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `packages/protocol/projects/artifact.ts`의 모든 export(cleanup이 지운다), `artifactNameSchema`(`projects/values.ts`)
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: Artifacts 목록은 domain을 구분해 보이지 않는다(`de-shell-artifact-domain`)
