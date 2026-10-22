# wf-artifact-source

봉한 view가 workflow artifact를 source로 열 수 있게 한다. source 종류 `workflow`를 더하고, root를 풀고, annotation target을 정하고, instance가 바뀌면 view를 다시 load하는 입구를 만든다.

- 단위: artifact (wave 2)
- 선행: wf-contract
- 소유(이 task만 고친다):
  - `packages/shell/ipc/artifact.ts`
  - `packages/shell/main/artifact/source.ts`
  - `packages/shell/main/artifact/source_test.ts`
  - `packages/shell/main/artifact/registry.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/artifact.md`의 "흐름"과 "지키는 것"(root 안 file만 준다, root마다 host가 다르다, annotation 신원은 main이 view의 source로 정한다, 같은 창에서 같은 source는 view 하나, 파일이 바뀌면 다시 load)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/main`·`packages/shell/ipc`
  - 코드:
    - `packages/shell/main/artifact/source.ts`: `resolveSource`의 `artifact` 분기가 본보기다(이름 검사, realpath, 폴더 밖 symlink 거절, 입구 lstat)
    - `packages/shell/main/artifact/source_test.ts`: 첫 test가 본보기
    - `packages/shell/main/artifact/registry.ts`: `createArtifactViews`, `sameSource`, `annotatePort`의 `target`, `open`의 `watch`
    - `packages/shell/ipc/artifact.ts`: `artifactSourceSchema`
  - 계약 task: `wf-contract.md`의 "paths" 절(`workflowsFolder`, `workflowArtifactFolder`, `WORKFLOW_ARTIFACT_ENTRY`), `wf-artifact-serve.md`(`scope`, `registerRoot`를 받는 쪽)
- 계약:
  - 쓰는 것: `wf-contract`의 `workflowArtifactFolder`·`WORKFLOW_ARTIFACT_ENTRY`(`packages/protocol/workflows/paths.ts`, import 없음), `architecture/artifact.md`
  - 내놓는 것(`wf-artifact-serve`, `wf-artifact-tab`이 기대는 모양):
    - `artifactSourceSchema`에 셋째 종류 `{ kind: "workflow", project: prj, workflow: workflowName, view: "static" | "instance", instance?: wfi }`. `instance`는 `view`가 `instance`일 때만 있고 그때는 꼭 있다. `workflowName`·`wfi` 규칙은 `ipc/artifact.ts`에 사본으로 둔다(shell main은 zod를 싣는 protocol file을 import하지 못한다).
    - `resolveSource`가 `workflowArtifactFolder(dataRoot, project, workflow, view)`를 root로 푼다. 입구는 `index.html`이고, root가 그 project의 `workflows/` 폴더 밖을 가리키는 symlink면 닫는다(`artifact`와 같은 검사). `ResolvedSource`에 `scope: string | null`을 더한다(`instance` view면 instance id, 아니면 null).
    - `createArtifactViews`의 `ArtifactViewsDeps.registerRoot(root, scope)`로 scope를 넘긴다(root가 같고 instance가 다르면 host가 달라야 한다. 구현은 `wf-artifact-serve`의 `roots.ts`).
    - `views.reloadInstance(instance: wfi)`: source가 그 instance인 열린 view의 contents를 `reload()`한다(`watchFolder`의 150ms 모음과 같은 reload).
    - annotation target: source가 workflow면 `{ kind: "file", project }`다(사람의 `.html`과 같은 길로 그 project의 PM이 받는다).
    - `same source`는 `(project, workflow, view, instance)`가 모두 같을 때다.

## 정한 것

- **`ipc/artifact.ts`가 `workflowNameSchema`를 export한다.** `artifactNameSchema`와 같은 slug 규칙(protocol `workflowNameSchema`와 같다)의 사본이다. `wf-artifact-tab`이 main의 layout schema에서 쓴다. 근거: 이름 규칙 사본을 한 곳에만 둔다.
- **`view`와 `instance`의 짝은 schema의 `refine`으로 본다.** 확인함: zod 4.6.5에서 `.strict().refine(...)`을 단 object도 `discriminatedUnion`의 member가 된다.
- **`resolveSource`도 같은 짝을 한 번 더 본다**(`view: "instance"`인데 `instance`가 없거나 `static`인데 있으면 `invalid_input`). 근거: `artifact` 분기가 이름을 schema와 별도로 다시 검사하는 것과 같다.
- **`source.ts`의 자체 `ArtifactSource` type에 member를 더한다.** ipc의 type으로 바꾸지 않는다. 근거: 기존 test가 id 모양이 아닌 값(`"p"`)을 넘긴다.
- **watch는 workflow root도 recursive다.** 근거: artifact가 `data/*.json`을 읽어 그리므로 하위 폴더 변경도 다시 load해야 한다.

## 할 일

1. `packages/shell/ipc/artifact.ts`
   - `workflowInstanceId`(`^wfi_<ULID>$`, 파일 위쪽 `projectId`·`domainId` 옆)와 export하는 `workflowNameSchema`를 더한다.
   - `artifactSourceSchema`의 `discriminatedUnion`에 `kind: "workflow"`, `project`, `workflow`, `view: z.enum(["static", "instance"])`, `instance: workflowInstanceId.optional()`인 `.strict()` object를 더하고, `refine`으로 `(view === "instance") === (instance !== undefined)`를 건다.
   - 위쪽 주석("artifact는 domain의 …")에 workflow 한 줄을 더한다.
   - 이유: main, preload, renderer가 같은 schema를 쓴다. `ArtifactViewState.source`도 이 schema라 preload가 새 source를 그대로 받는다.
2. `packages/shell/main/artifact/source.ts`
   - `ArtifactSource` union에 workflow member를 더한다. `ResolvedSource`에 `scope: string | null`을 더하고, 기존 두 분기(`artifact`, `file`)는 `scope: null`로 돌려준다.
   - `resolveWorkflow(dataRoot, source, fs)`를 `resolveArtifact` 꼴로 더하고 `resolveSource`가 `source.kind === "workflow"`에서 부른다. 순서:
     - `workflowNameSchema`와 `view`·`instance` 짝을 본다(틀리면 `invalid_input`).
     - `root = realpath(workflowArtifactFolder(...))`.
     - `root`가 `realpath(workflowsFolder(dataRoot, project)) + sep`로 시작하지 않으면 `not_found`. 중간 폴더(`artifacts/`)가 symlink여도 realpath가 풀어서 걸린다.
     - `join(root, WORKFLOW_ARTIFACT_ENTRY)`가 `lstat` 일반 file이 아니면 `not_found`.
     - `ok({ root, entry, file, name: source.workflow, scope: view === "instance" ? instance : null })`.
   - 이유: AI가 쓴 page의 root가 사람의 다른 폴더를 가리키지 못해야 한다(`architecture/artifact.md` "봉한 scheme은 root 안의 일반 file만 준다"). 폴더 경계는 `workflows/`다.
3. `packages/shell/main/artifact/registry.ts`
   - `ArtifactViewsDeps.registerRoot(root: string, scope: string | null): string`으로 고치고, `open`에서 `deps.registerRoot(root, resolved.value.scope)`로 부른다. `reload`가 쓰는 `entry.host`는 그대로다.
   - `sameSource`를 세 종류로 넓힌다(workflow는 `project`, `workflow`, `view`, `instance ?? null`이 모두 같을 때).
   - `annotatePort`의 `target`: workflow면 `{ kind: "file", project: entry.source.project }`. 이유: `architecture/artifact.md` "annotation의 신원"의 `file` 길이 그 project의 PM에게 간다(`deliverFile`). core와 `ipc/annotation.ts`의 `AnnotateTarget`은 바꾸지 않는다.
   - `open`의 `watch.recursive`를 `source.kind !== "file"`로 고친다.
   - `reloadInstance(instance: string): void`를 `createArtifactViews`의 반환 object에 더한다. `entries`를 돌며 `source.kind === "workflow" && source.instance === instance && health === "ok"`인 것만 `contents.reload()`한다(watch 콜백과 같은 조건). 이유: instance가 바뀌어도 다른 instance의 view와 static view는 다시 load하지 않는다.
4. `packages/shell/main/artifact/source_test.ts`에 test 하나를 더한다(아래 "끝남"의 위험 test). 준비는 첫 test처럼 임시 `root`에 `projects/prj_a/workflows/<name>/artifacts/{static,instance}`를 만든다.
5. `wiring/artifact.ts`는 이 task의 소유가 아니다(`wf-artifact-serve`). `registerRoot: roots.register`는 인자를 하나 받는 함수여도 새 type에 대입되므로 이 task만으로도 `deno check`가 통한다. 건드리지 않는다.

## 끝남

- `deno task check`가 통과한다(shell main의 `tsc`와 `*_test.ts`가 돈다).
- 위험 test(`source_test.ts`, 새 `test` 하나, 표로 여러 경우): "workflow artifact는 그 project의 `workflows/` 밖으로 root를 풀지 못한다."
  - workflow 이름이 slug가 아니면(`../x`) `invalid_input`
  - `instance` view인데 `instance`가 없으면 `invalid_input`
  - `artifacts/static`이 `workflows/` 밖 폴더(`index.html`이 있다)를 가리키는 symlink면 `not_found`
  - 다른 project의 workflow artifact를 가리키는 symlink도 `not_found`
  - 정상 workflow는 `entry === "index.html"`이고 `scope`가 `instance` view에서만 instance id다
  - 근거: 새 root 종류이고, root를 정하는 이 함수가 sandbox의 바깥 경계다. serve는 root 안만 본다.
- 남지 않음: `grep -n 'kind === "artifact"' packages/shell/main/artifact/registry.ts packages/shell/main/artifact/source.ts`의 줄이 모두 workflow를 같이 다룬다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(예상). 있으면 적는다.
- 안 쓰게 된 export: 없음(예상)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
