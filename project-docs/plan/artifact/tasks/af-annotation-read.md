# af-annotation-read

`annotations.get`(그래서 `image.read "annotation:<id>"`)을 project place의 PM과 Operator에게도 주고, agent의 project로 거른다. App Engineer와 coding agent의 앱 범위, 사람의 전체 범위는 그대로다.

- 단위: artifact-annotation (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/server/identity.ts`
  - `packages/core/agent-roles/credentials.ts`
  - `packages/core/apps/annotations/reads.ts`
  - `packages/core/apps/annotations/annotations_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/annotation.md`("App Engineer는 공통 이미지 읽기 tool로 screenshot을 본다": `annotations.get`은 core가 agent 자격의 앱으로 거른다, 다른 앱 것은 not_found)
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "4. artifact annotation"의 screenshot 읽기, `project-docs/plan/artifact/README.md`의 "정한 것"(`annotations.get`)
  - 본보기: `credentials.ts:73`(`annotationsGet`은 `app_engineer`에게만), `credentials.ts:82`(`agentConditions`: `app_engineer`일 때만 `app` 조건), `core/apps/annotations/reads.ts:22`(`boundApp`)와 `:56`(범위 밖은 없는 것과 같다), `packages/protocol/server/identity.ts:40`(`credentialConditionsSchema`), `core/lophn-agent/tools/file/image.ts:35`(`annotation:<id>`를 `annotationsGet`으로 읽는다)
  - 계약: wave 1 `af-annotation-target`이 만든 읽기 값(`target`)과 `reads.ts`의 앱 범위 거르기
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `apps`, `protocol`
- 계약:
  - 쓰는 것: `Annotation.target`(`{ kind: "app", app }` | `{ kind: "artifact", project, name }`)
  - 내놓는 것: `credentialConditionsSchema`에 `project: idSchema("prj").optional()`. 값이 있는 agent 자격은 그 project 하나에 묶인 것이다.

## 할 일

1. `identity.ts`: 조건 `project`를 더한다.
2. `credentials.ts`
   - `agentConditions`: `place.kind === "project"`이고 role이 `project_manager` 또는 `operator`이면 `project: place.id`를 조건에 넣는다(`app_engineer`의 `app` 조건은 그대로).
   - `roleOperations`: `annotationsGet.name`을 `project_manager`와 `operator`에게도 준다. role만으로는 Operator의 place를 알 수 없어(앱 place의 Operator도 같은 role이다) 범위는 아래 읽기 규칙이 닫는다.
3. `reads.ts`의 `boundApp`을 호출자 범위(`app` | `project` | 전체)로 넓힌다.
   - coding agent·`app` 조건 agent: 앱 target에서 그 앱인 것만(wave 1 그대로).
   - `project` 조건 agent: `target.kind === "artifact"`이고 `project`가 같은 것만. 앱 target과 다른 project의 artifact는 없는 것과 같다(`not_found`).
   - **agent인데 `app`도 `project`도 조건에 없는 호출자(앱 place의 Operator, lophn)는 `forbidden`이다.** 지금 코드는 묶이지 않은 호출자를 전체 범위로 보므로(사람) 이 분기를 빠뜨리면 새로 연 operation이 앱 place Operator에게 모든 annotation을 연다. 사람(`actor` agent가 아님)과 machine은 전체다.
4. `annotations_test.ts`에 위험 test 한 건을 표 행으로 더한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "project 조건 agent는 자기 project의 artifact annotation만 읽고, 다른 project의 artifact·앱 annotation은 `not_found`이며, 앱에도 project에도 묶이지 않은 agent는 읽지 못하고, 사람은 모두 읽는다".
- 남지 않음: `grep -rn "boundApp" packages/core`가 새 이름(또는 넓힌 함수) 하나로만 남는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 묶이지 않은 agent를 `forbidden`으로 닫은 것
- 넘길 줄: `credentials.ts`의 `annotationsGet` 줄은 domain-place(App Engineer 지움)도 건드린다. `identity.ts`의 `project` 조건은 domain-tools, domain-place가 같은 이름을 더할 수 있다(같은 칸이면 하나로 합친다).
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
