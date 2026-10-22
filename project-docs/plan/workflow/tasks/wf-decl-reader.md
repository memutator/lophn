# wf-decl-reader

project의 `workflows/` 폴더에서 선언을 읽어 `WorkflowEntry` 목록으로 만든다. 틀린 선언은 그 workflow만 빼고 이유를 싣는다. 파일 시스템 접근은 port 구현으로 끼운다.

- 단위: workflows (wave 2)
- 선행: wf-contract
- 소유(이 task만 고친다):
  - `packages/core/workflows/declaration.ts`(새 file)
  - `packages/core/main/daemon/wiring/workflows-files.ts`(새 file)
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`(정의 file의 자리와 읽기 규칙), `project-docs/architecture/layers.md`(port는 core module 안, 구현은 wiring)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `workflows`, `project-docs/module-catalog.yaml`의 `packages/core/workflows`(lead가 먼저 등록한다)
  - 제품 결정: roadmap `project-docs/products/roadmap/workflow.md`의 "정의: 선언, `workflow.md`, artifact", "kind", 계획 README의 "선언 읽기"
  - 본보기 코드: `packages/core/lophn-agent/agents/definition-file.ts`(YAML 읽기 옵션 `schema: "core"`와 틀린 칸을 모아 돌려주는 법), `packages/core/projects/kinds/check/kinds-file.ts`(`@std/yaml`의 `parse`)
- 계약:
  - 쓰는 것: `wf-contract`의 `workflowDeclarationSchema`, `WorkflowEntry`, `WorkflowFiles`(port), `@std/yaml`(`deno.json`에 이미 있다)
  - 내놓는 것:
    - 순수 함수 `entryOf(project: prj, key: string, file: DefinitionFile): WorkflowEntry`. `declaration`이 null이면 `no_declaration`, yaml이 안 읽히면 `invalid_yaml`, 칸이 안 맞으면 `invalid_declaration`(message에 첫 틀린 칸), `kind`가 `flow`면 `startable: false`·`not_agent`다. 가리키는 이름이 있는지는 보지 않는다.
    - 순수 함수 `parseDeclaration(file: DefinitionFile)`: 읽은 선언(`WorkflowDeclaration`) 또는 틀린 이유(`reason`, `message`)를 돌려준다. `wf-service`가 시작할 때 `entryOf`로 `startable`을 본 뒤 이것으로 선언을 얻는다.
    - 순수 함수 `stepsOf(declaration)`: 읽은 `agent` 선언의 steps를 `InstanceStep[]`로 옮긴다(`in`·`out`·`next`의 빈 값은 `""`·`[]`). 첫 step은 선언의 첫 key다.
    - 순수 함수 `participantsOf(declaration)`: 읽은 `agent` 선언에서 `{ role, place?, name? }`만 골라 map으로 옮긴다.
    - `workflows-files.ts`: `WorkflowFiles`를 data root의 `workflowsFolder`로 구현한다. 하위 폴더 이름이 `workflowNameSchema`에 안 맞으면 건너뛴다. 폴더가 없으면 빈 목록이다. 읽기만 한다.

## 할 일

1. **`declaration.ts`의 읽기.** `parseDeclaration(file: DefinitionFile)`을 만든다. `file.declaration`이 null이면 `no_declaration`. 아니면 `@std/yaml`의 `parse(text, { schema: "core" })`로 읽고, 던지면 `invalid_yaml`(message는 오류의 첫 줄)이다. 읽은 값을 `workflowDeclarationSchema.safeParse`해 틀리면 `invalid_declaration`이고 message는 첫 issue의 `<점 표기 path>: <이유>`다(path가 비면 `(root)`). 맞으면 선언을 돌려준다. 이유: `core` schema를 쓰면 `2020-01-01`이나 `yes` 같은 값이 날짜·불리언으로 바뀌지 않고 글로 남는다(`definition-file.ts`와 같은 이유). 틀린 칸을 다 모으지 않고 첫 하나만 싣는다: 고치는 쪽(PM)은 `workflow.list`를 다시 부르며 하나씩 고친다.
2. **`entryOf(project, key, file)`.** `parseDeclaration` 결과로 `WorkflowEntry`를 만든다.
   - 읽혔고 `agent`면 `state: "ok"`, `kind: "agent"`, `startable: true`, `problem: null`, `participants`(`participantsOf`), `steps`(`{ name, by, with: with ?? null, next: next ?? [] }[]`, 선언 순서)다. `prompt`·`in`·`out`은 싣지 않는다. 이유: 목록을 읽는 참가자가 다른 참가자의 prompt를 알면 캡슐화가 깨진다(roadmap "agent가 아는 것").
   - `flow`면 `state: "ok"`, `kind: "flow"`, `startable: false`, `problem: { reason: "not_agent", message }`, `participants`·`steps`는 null이다.
   - 못 읽으면 `state: "invalid"`, `kind: null`, `startable: false`, `problem`(위 이유), `participants`·`steps` null이다.
   - `artifacts`는 어느 경우든 `file.artifacts`다. 가리키는 이름이 있는지(`by`·`with`·`next`)는 보지 않는다(계약).
3. **`stepsOf`·`participantsOf`.** 읽은 선언에서 읽는 칸만 골라 옮긴다. `stepsOf(declaration)`은 `InstanceStep[]`(`in`·`out` 없으면 `""`, `next` 없으면 `[]`, `with` 없으면 null, 선언 순서)이고 `participantsOf(declaration)`은 `{ role, place?, name? }`만 담은 map이다. 이유: 선언 schema는 모르는 칸을 통과시키므로(`z.looseObject`) 옮길 때 골라야 모르는 칸이 instance 표에 새지 않는다. 첫 step은 `steps`의 첫 key라는 순서에 기대는데, 정수 꼴 key는 `stepNameSchema`가 이미 막아 JS object의 순서가 보존된다.
4. **`wiring/workflows-files.ts`.** `createWorkflowFiles(dataRoot: string): WorkflowFiles`. `workflowsFolder(dataRoot, project)`를 `Deno.readDir`로 읽어(없으면 빈 목록) 하위 폴더 가운데 `entry.isDirectory`이고 이름이 `workflowNameSchema`에 맞는 것만 `DefinitionFile`로 만든다(이름순). 이유: symlink 폴더는 `isDirectory`가 거짓이라 data root 밖을 가리키는 폴더가 빠진다. `declaration`은 `workflow.yaml`을 `Deno.readTextFile`로 읽고 읽지 못하면(없음 포함) null이다. `artifacts`는 `workflowArtifactFolder(..., view)/index.html`이 일반 file이면 참이다. 읽기만 하고 비동기 API만 쓴다(main thread다).
5. **test는 만들지 않는다.** 순수 함수 둘의 규칙은 schema가 보장하는 것이고 판정하는 코드가 아니다.

## 정한 것

- **`stepsOf`·`participantsOf`는 entry가 아니라 읽은 선언(`WorkflowDeclaration`의 `agent`)을 받는다.** 이유: `WorkflowEntry.steps`에는 `prompt`·`in`·`out`이 없어서(캡슐화) entry로는 `InstanceStep`을 만들 수 없다. `wf-service`는 `entryOf`로 `startable`을 보고 `parseDeclaration`으로 선언을 얻어 둘에 넘긴다. planner가 정한 계약이다.
- **steps가 비어 있는 `agent` 선언은 `invalid_declaration`이다.** 근거: 첫 step이 없어 시작할 수 없다(`wf-contract`의 schema가 막는다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "TODO" packages/core/workflows/declaration.ts packages/core/main/daemon/wiring/workflows-files.ts`가 0줄이다.

## 보고

- 바꾼 file, 통과한 check.
- 등록할 것: lead가 `packages/core/workflows/mod.ts`에 export할 이름(`entryOf`, `parseDeclaration`, `stepsOf`, `participantsOf`). `workflows-files.ts`는 `wf-service`의 wiring이 부른다.
- 안 쓰게 된 export: 없음.
- 정한 것: 위 "정한 것" 밖에 worker가 정한 것.
- 넘길 줄: 없음.
- 계약 바꾸기 요청: 고정 계약을 바꿔야 하면 여기에 적는다.
- **무겁게 짠 것**, **알려진 미완 동작**: 없으면 "없음".
