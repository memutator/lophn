# wf-artifact-tab

renderer의 artifact 탭이 workflow artifact(source 종류 `workflow`)를 열 수 있게 한다. 탭 layout 저장 꼴과 여는 함수를 더한다.

- 단위: shell (wave 3)
- 선행: wf-artifact-source
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/kinds/artifact.tsx`
  - `packages/shell/renderer/artifact/artifact-tab.tsx`
  - `packages/shell/renderer/artifact/testdata/fake-artifact-api.ts`
  - `packages/shell/main/workspace/kinds/artifact.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/artifact.md`의 "흐름"(renderer 쪽: artifact 탭은 keep, annotate는 target이 view의 source로 정해진다), `project-docs/architecture/workspace-layout.md`(탭 kind와 layout 저장)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell/renderer`·`packages/shell/main`
  - 코드:
    - `packages/shell/renderer/workspace/kinds/artifact.tsx`(`openArtifact`, `openArtifactFile`, `sourceOf`, `fromStored`, `toStored`, `keep`)
    - `packages/shell/main/workspace/kinds/artifact.ts`(layout schema와 "정확히 하나" 검사), `packages/shell/main/workspace/kinds/values.ts`(`idOf`)
    - `packages/shell/renderer/artifact/artifact-tab.tsx`(`signatureOf`, `name`, `folder`)
    - `packages/shell/renderer/artifact/testdata/fake-artifact-api.ts`
    - `packages/shell/ipc/artifact.ts`(`wf-artifact-source`가 정한 source schema와 `workflowNameSchema`)
- 계약:
  - 쓰는 것: `wf-artifact-source`의 source 종류 `workflow`
  - 내놓는 것:
    - 탭 key `artifact-workflow:<project>:<workflow>:<view>[:<instance>]`, 탭 필드 `{ project, workflow, view, instance? }`. layout 저장(`main/workspace/kinds/artifact.ts`)은 세 꼴(`domain+name`, `project+path`, `project+workflow+view[+instance]`) 가운데 정확히 하나만 받는다.
    - `openWorkflowArtifact(host, { project, workflow, view, instance? })`를 `kinds/artifact.tsx`에서 내보낸다. workflow 탭(`wf-screen-tab`)이 부른다. 탭 이름은 page의 title을 따른다(없으면 `<workflow>`).
    - Edit source는 입구 file을 연다(지금과 같다). 사람이 annotation을 남기면 target은 file 꼴이라 그 project의 PM에게 간다(`wf-artifact-source`).

## 정한 것

- **세 꼴을 가르는 것은 `workflow` 필드의 유무다.** `project`는 `file` 꼴(`project+path`)에도 있어서, 읽는 쪽(`sourceOf`, `fromStored`)은 `workflow`가 있는지 먼저 본다.
- **layout 검사는 꼴을 하나씩 따로 쓴다.** `workflow` 꼴은 `project`, `workflow`, `view`가 모두 있고 `path`·`domain`·`name`이 없으며, `instance`는 `view === "instance"`일 때만 있고 그때는 꼭 있다. 근거: 지금 `refine` 한 줄은 꼴이 둘이라서만 짧다. 셋이 되면 꼴마다 조건을 읽히게 쓴다.
- **필드에서 `instance`는 없을 때 키 자체가 없다.** `undefined`를 값으로 저장하지 않는다. 근거: layout schema가 `strictObject`다.
- **열기 key의 `instance`는 `view`가 `instance`일 때만 붙는다.** 같은 workflow의 static과 instance artifact, 서로 다른 instance가 각각 탭 하나다.

## 할 일

1. `packages/shell/main/workspace/kinds/artifact.ts`
   - layout에 `workflow`(`ipc/artifact.ts`의 `workflowNameSchema`), `view`(`z.enum(["static", "instance"])`), `instance`(`idOf("wfi", value) !== null`) 선택 칸을 더하고, 세 꼴 가운데 정확히 하나만 받게 `refine`을 고친다. 위쪽 주석도 고친다.
   - 이유: layout 파일에서 읽은 탭이 `restore`에 닿기 전에 모양이 틀리면 거절돼야 한다(strict). 폴더가 없어진 탭은 지금처럼 지킨다(`restore`는 그대로).
2. `packages/shell/renderer/workspace/kinds/artifact.tsx`
   - `openWorkflowArtifact(host, { project, workflow, view, instance? })`를 더한다. `host.openTab({ key, kind: "artifact", title: workflow, fields })`. key와 fields는 위 계약대로다.
   - `sourceOf`에 workflow 꼴을 `file` 꼴보다 먼저 더한다(`project`, `workflow`, `view`가 글이고 `view`가 둘 중 하나, `instance`는 `view`가 `instance`일 때만 글). `fromStored`·`toStored`에도 같은 꼴을 더한다(`title`은 `workflow`). 틀린 조합이면 `null`이다.
   - 이유: `ArtifactTab`은 `source`만 받는다. 저장·복원 길(`fromStored`, `toStored`)과 `keep`이 같은 `sourceOf`를 쓴다.
3. `packages/shell/renderer/artifact/artifact-tab.tsx`
   - `signatureOf`에 workflow 꼴을 더한다(`workflow\n<project>\n<workflow>\n<view>\n<instance ?? "">`). `name`은 workflow면 `source.workflow`다. `folder`는 workflow면 `null`이다(rootNote는 사람의 `.html`만 보인다).
   - 이유: `keeps.take(keepKey, signature)`가 보관한 view를 같은 입력일 때만 이어 쓴다. instance가 다른 탭이 서로의 view를 받으면 안 된다.
4. `packages/shell/renderer/artifact/testdata/fake-artifact-api.ts`
   - `open`이 workflow source도 받는다: `name`은 `source.workflow`, `file`은 `/fake/workflows/${source.workflow}/artifacts/${source.view}/index.html`.
   - 이유: gallery(`wf-screen-tab`)와 test가 이 통로로 workflow artifact 탭을 그린다.
5. `grep -rn 'kind === "artifact"' packages/shell/renderer`와 `grep -rn "fields" packages/shell/renderer/workspace/kinds/artifact.tsx`로 source 종류를 둘로만 가르는 곳이 남았는지 본다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 선다(`check:full`은 renderer build를 보지 않는다).
- 위험 test: 없음(화면과 탭 저장 꼴이다. 저장 꼴은 schema가 보장한다).
- 남지 않음: `grep -rn 'source.kind === "artifact"' packages/shell/renderer`의 모든 줄이 workflow도 다룬다(삼항으로 file을 else에 둔 줄이 없다).

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
