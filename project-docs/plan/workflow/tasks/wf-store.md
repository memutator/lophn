# wf-store

instance와 줄의 표, 그 표를 읽고 쓰는 함수, 읽기 route 둘(`ReadWorkflowInstance`, `ListWorkflowInstances`)의 handler를 만든다. 표가 정본이다.

- 단위: workflows (wave 2)
- 선행: wf-contract
- 소유(이 task만 고친다):
  - `packages/core/workflows/schema.ts`(새 file)
  - `packages/core/workflows/rows.ts`(새 file)
  - `packages/core/workflows/store.ts`(새 file)
  - `packages/core/workflows/reads.ts`(새 file)
- 읽을 것:
  - architecture: `project-docs/architecture/run.md`("지키는 것"의 정본은 표, 읽기, "왜 이 모양인가"의 Bus는 신호일 뿐), `project-docs/architecture/layers.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `workflows`, `project-docs/module-catalog.yaml`의 `packages/core/workflows`(lead가 먼저 등록한다)
  - 본보기 코드: `packages/core/runs/schema.ts`(DDL, CHECK, 끝난 행을 막는 trigger), `packages/core/runs/store.ts`(`runFromRow`, `nextStateSeq`, `listRuns`), `packages/core/runs/reads.ts`(`PAGE`, `next_cursor`), `packages/core/runs/store_test.ts`(INTEGER가 bigint로 오는 이유)
  - 제품 결정: 계획 README의 "정한 것"(기록 표, 줄 종류)
- 계약:
  - 쓰는 것: `wf-contract`의 값·읽기 route. 본보기는 `packages/core/runs/{schema,store,reads}.ts`
  - 내놓는 것(`wf-commands`가 기대는 것):
    - 표 `workflow_instances(id PK, project, workflow, input, state CHECK in (running, ended, stopped), participants json, steps json, current_step, human_turn 0|1, started_by json, created_at, finished_at, state_seq)`. `project`는 prj id, `workflow`는 name. 둘 다 `NOT NULL`이고 project 이름은 칸이 없다.
    - 표 `workflow_lines(instance, seq, at, kind CHECK in (started, report, edit, handed, not_handed, ended, stopped, lophn_restarted), by json, step, body, data json, PRIMARY KEY (instance, seq))`. `body`는 report·started의 글, `data`는 kind별 나머지 칸(위 줄 표). 줄은 고치거나 지우지 않는다(trigger). index `(instance, kind)`.
    - 다른 module의 표(session, message, project)에는 물리 FK가 없다. id만 적는다.
    - 함수: `insertInstance`, `loadInstance`, `updateInstance(state, current, steps, finished_at, state_seq 증가)`, `appendLine`(seq를 instance 안에서 이어 센다), `loadLines(after, limit)`, `lastReports`, `lastLine`, `listInstances(project, workflow?, state?, after, limit)`, `runningInstances()`(모든 project의 `running` instance. `wf-service`의 `WorkflowStore.running()`이 쓴다).
    - 읽기 handler 둘은 `wf-contract`의 route 모양대로 낸다. `ReadWorkflowInstance`의 `cursor`는 마지막 seq 글이다.

## 할 일

1. **`schema.ts`.** `workflowsSchemaSteps`에 schema step 하나(id `workflows.tables`)를 둔다. 계약의 두 표와 index `(project, workflow, id)`, `(state, id)`(instance), `(instance, kind)`(줄)를 만든다. `state`·`kind`의 CHECK 목록은 `WORKFLOW_STATES`·`WORKFLOW_LINE_KINDS`(`protocol/workflows`)에서 만든다. `CHECK ((state = 'running') = (finished_at IS NULL))`, `CHECK (human_turn IN (0, 1))`를 둔다. 줄 표에는 `BEFORE UPDATE`와 `BEFORE DELETE` trigger를 두어 `RAISE(ABORT, ...)`로 막는다. 이유: 줄은 기록이라 고치지 않는다. instance 표에는 끝난 행을 막는 trigger를 두지 않는다(runs와 다르다). `ended`는 기록일 뿐이라 `running`으로 돌아올 수 있고, 막을 것은 `stopped`의 넘기기인데 그것은 `wf-commands`가 거절한다. `STRICT` 표로 만들고 주석은 "왜"만 쓴다(`runs/schema.ts` 꼴). 다른 module의 표(session, message, project)에는 FK를 두지 않는다.
2. **`rows.ts`.** 행과 값 사이 변환을 모은다: `instanceFromRow`, `lineFromRow`는 `workflowInstanceSchema`·`workflowLineSchema`로 `safeParse`해 틀리면 `internal`(`invalid stored workflow`)이다. 줄을 칸으로 가르는 `lineColumns(line)`은 `step`, `body`(report·started의 글), `data`(나머지 칸)로 나눈다. `current`는 `current_step`이 null이면 null이고 아니면 `{ step, human_turn }`이다. INTEGER 칸(`human_turn`, `state_seq`, `seq`)은 `Number()`·`String()`으로 읽는다. 이유: `createSql`은 INTEGER를 bigint로 줘서 `=== 1`로 비교하면 늘 거짓이다(`runs/store_test.ts`가 한 번 겪은 일).
3. **`store.ts`.** 계약의 함수들. 모두 `Pick<Sql, "get" | "all" | "run">` 같은 좁은 type을 받아 tx와 snapshot이 같이 쓴다.
   - `insertInstance`는 `state: running`, `finished_at: null`로 넣고 `state_seq`는 표 안의 `max + 1`이다(`nextStateSeq`, 기록 event를 남기지 않는다). `updateInstance`도 같은 방법으로 `state_seq`를 올린다. 이유: `compare.state_seq`로 같은 instance를 동시에 고치는 일을 가린다.
   - `appendLine`의 seq는 `coalesce(max(seq), 0) + 1`(그 instance 안에서)이다. 한 tx 안에서 줄을 여럿 남겨도 이어진다.
   - `loadLines(sql, instance, { after, limit })`는 `seq > after` 오름차순이고 `limit: null`이면 끝까지다(`wf-service`의 전체 읽기용).
   - `lastReports`는 `kind = 'report'`인 줄 가운데 step마다 `seq`가 가장 큰 것이다.
   - `same` session 풀이는 만들지 않는다. `wf-service`가 읽은 줄에서 푼다.
   - `listInstances`는 새것이 앞(`ORDER BY id DESC`), `cursor`는 page 마지막 id(`id < after`)다. `runningInstances`는 `state = 'running'` 전부다.
4. **`reads.ts`.** `createWorkflowReads()`가 `{ read, list }`를 낸다(`runs/reads.ts` 꼴). `ReadWorkflowInstance`는 없으면 `not_found`, 있으면 `instance`, `last_reports`, `lines`(seq 오름차순 200개, `cursor` 이후), `next_cursor`(더 있으면 page 마지막 seq, 없으면 null), `as_of_seq`를 낸다. `ListWorkflowInstances`는 50개씩이고 한 줄마다 `lastLine`을 붙인다. 이유: 화면과 artifact가 줄을 다 읽지 않고 step 옆 글과 목록을 그리게 하려는 것이다(계약).
5. **test는 만들지 않는다.** 이 task의 규칙은 표 모양과 읽기뿐이고 상태 전이의 거절은 `wf-commands`의 위험 test가 본다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "TODO" packages/core/workflows/{schema,rows,store,reads}.ts`가 0줄이다.

## 보고

- 바꾼 file, 통과한 check.
- 등록할 것: lead가 `packages/core/workflows/mod.ts`에 export할 이름(`workflowsSchemaSteps`, `createWorkflowReads`, `runningInstances` 등). `register.ts`는 `wf-commands`가 쓴다.
- 안 쓰게 된 export: 없음.
- 정한 것: 문서에 답이 없어 정한 것.
- 넘길 줄: 없음.
- 계약 바꾸기 요청: 표 칸이나 함수 모양을 바꿔야 하면 고치지 말고 여기에 적는다.
- **무겁게 짠 것**: 없으면 "없음".
- **알려진 미완 동작**: 없으면 "없음".
