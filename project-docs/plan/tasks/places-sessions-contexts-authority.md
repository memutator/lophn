# places-sessions-contexts-authority

context 쓰기를 "그 context가 속한 project의 Project Manager 또는 사람"에게만 열고, 위반을 agent에게 넘기던 옛 길(assignment 표를 직접 읽고 Run을 만들던 것)을 지운다. 새 위반이 생기면 domain event `ContextViolationFound`를 같은 tx에서 남기는 것까지 한다.

- 단위: places-sessions (wave 3)
- 선행: 없음. 계약 고정 뒤 열린다.
- 소유(이 task만 고친다):
  - `packages/core/projects/contexts/ledger/{deps,adapter,adapter-run,rows-events,schema}.ts`
  - `packages/core/projects/contexts/api/{state,commands-lifecycle,commands-bundle,commands-bundle-views,commands-glossary,commands-glossary-rules,commands-views,commands-views-rules,commands-violations,commands-violations-evidence,reads-lists,violation-message}.ts`
  - `packages/core/projects/contexts/handoff.ts` (지우기)
  - `packages/core/projects/contexts/register.ts`
  - `packages/core/projects/contexts/worker/files.ts`, `watch/fs.ts` (경로 규칙 한 줄)
- 읽을 것:
  - inventory(lead가 맞추며 더함): `I2.10#22`
  - spec: S4 2·4·11장 13(Project Manager는 project마다 하나, 자기 project의 context만) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S1 5장(`ContextViolationFound`: 위반이 새로 생김, 집합 비교) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - spec: S8 2장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - inventory: `I1.10#17`(core 쪽), `I2.4#2`, `I2.10#24`, `I2.10#25`, `I2.10#27`
  - 요구: req-0005·0006(계약 경로), req-0020(위반), req-0026(Project Manager가 saved view를 둠), req-0035 — `/home/pyosechang/projects/lophn/project-docs/requirements/core-contexts.yaml`, `core-lophn-agent.yaml`
  - 규칙: `dev/code-map.md`(domain module끼리 직접 import하지 않는다)
  - 지금 코드: `contexts/ledger/deps.ts`(250~300행 `startHandOffRun`, `isContextEngineer`), `contexts/api/commands-violations.ts`, `contexts/handoff.ts`
- 계약:
  - 쓰는 것: `core/projects/ports.ts`(`ContextAuthority`), `protocol/projects/context-api.ts`(`SAVED_VIEW_AUTHORS`, 옛 route·event 정의), `protocol/events`의 `ContextViolationFound`(contract-events). event payload는 그 정의를 따른다.
  - 내놓는 것: `createContextsRegistration()`(이름 그대로, 의존에 `ContextAuthority`를 받는다)

## 할 일

1. 권한 (`I2.4#2`): `ContextAuthority.canWrite(actor, project)`를 받아 쓴다. actor는 `agent:ses_…`이거나 사람이다.
   - `commands-lifecycle.ts`의 `canCreate`, `commands-bundle.ts`의 `isEngineer`, `commands-glossary-rules.ts`, `commands-views-rules.ts`, `state.ts`의 actor 모양, `ledger/adapter.ts`의 `mapActor`/`isContextEngineer`, `ledger/deps.ts`의 `isContextEngineer`, `register.ts`의 `isContextEngineer: () => false`를 걷어내고 "role이 Project Manager이고 place의 project가 그 context의 project인가"로 바꾼다. 다른 project의 context는 `forbidden`이다. `assignments` 표를 직접 읽던 SQL(`ledger/deps.ts`)을 없앤다(domain module끼리 직접 import하지 않는다).
   - 사람은 항상 통과한다(만들기, 보관, saved view, 용어집 지우기 등 옛 actor 규칙은 그대로).
2. 위반 넘김 지우기 (`I1.10#17`): `handoff.ts`(요청 글 만들기), `api/commands-violations.ts`의 `handOffViolations`, `api/commands-violations-evidence.ts`, `ledger/deps.ts`/`adapter-run.ts`/`api/state.ts`의 `startHandOffRun`, `ledger/rows-events.ts`의 `loadHandedOffEvents`, `api/reads-lists.ts:44`의 `handed_off`(위반 읽기에서 "이미 넘겼는지" 칸)를 지운다. 위반을 agent에게 넘기는 일은 이제 Reactor가 Project Manager를 부르는 것(S1 5장)이다. 사람의 "누르면 부르기"는 router-run-loop-input의 `startRequest`가 맡는다.
3. 새 위반 event: `recordViolations`가 이전 검사와 위반 집합(`kind`, `rule`, `path`, `section`)을 비교해, 이전에 없던 위반 키가 하나라도 생기면 `ContextViolationFound`를 같은 tx에서 남긴다. 개수 증가로 판정하지 않는다(고쳐진 위반 하나와 새 위반 하나가 한 scan에 겹쳐도 개수는 같다). 위반이 줄거나 고쳐지는 것은 event가 아니다. subject는 context이고 payload는 contract-events가 정한 것이다(project, context, 위반 근거). 옛 `ContextViolationsRecorded`와 `ContextViolationsHandedOff` 쓰임은 지운다. 위반 수의 마지막 기록(index)은 그대로 쓴다.
4. saved view 출처 (`I2.10#24`): `ledger/schema.ts`의 `saved_views.origin` CHECK를 `('user','project_manager')`로 바꾸고 `api/commands-views.ts:58-66`, `commands-bundle-views.ts`(32, 41행의 `"engineer"`)를 새 값 `SAVED_VIEW_AUTHORS`로 바꾼다. Project Manager가 saved view를 두는 것은 판의 `saved_views` 선언 안이다(req-0026).
5. context 보관 (`I2.10#25`): 새 요구에 보관 규칙이 없고 지운다는 기록도 없다. `contexts.status = 'archived'`, `commands-lifecycle.ts`, `watch/service.ts`(보관된 context를 건너뜀)는 그대로 둔다. 바꾸지 않는다고 보고에 적는다.
6. 경로 규칙 (`I2.10#27`): 계약이 가리키는 파일 읽기는 project 폴더 기준 상대 경로이고 지금은 `.git`만 건너뛴다(`worker/files.ts:40`의 `SKIPPED_NAMES`). 문서에 `.gitignore`가 영향을 주는지 답이 없다. 추천: `.gitignore`는 보지 않는다. 계약이 경로로 명시한 파일이고 키워드 검색(`req-1476~1480`)과 달리 훑기가 아니기 때문이다. 코드를 바꾸지 않고 `worker/files.ts`와 `watch/fs.ts`에 이유 주석 한 줄만 둔다. 이 판단을 보고 "정한 것"에 적는다.
7. test: `contexts_authority_test.ts` 한 파일. 기존 `api/state.ts`의 메모리 상태 대역으로 표를 돈다.
   - "다른 project의 Project Manager는 이 context를 만들거나 고치거나 판을 올리지 못한다"
   - "새 위반 키가 생기면 ContextViolationFound가 한 번 남고, 위반이 고쳐지기만 하면 남지 않는다"
8. (lead가 맞추며 더함 (`I2.10#22`)) 위반 알림 event. event 모양은 contract-events의 `ContextViolationFound`다. 여기서는 내기만 한다

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "다른 project의 Project Manager는 context를 쓰지 못한다", "새 위반이 생길 때만 ContextViolationFound가 남는다"
- 남지 않음: `grep -rn "context_engineer\|isContextEngineer\|startHandOffRun\|assignments\|\"engineer\"" packages/core/projects/contexts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `wiring/projects.ts`에서 `ContextAuthority`를 lophn-agent(`places/`)의 Project Manager 판정에 끼운다. `createContextsRegistration()` 호출처(`projects/register.ts`는 places-sessions-projects가 고친다)
- 안 쓰게 된 export: `protocol/projects/context-api.ts`의 `contextHandOffViolationsRoute`, `violationsHandOff*`, `contextViolationsRecordedEvent`, `contextViolationsHandedOffEvent`, `SAVED_VIEW_ORIGINS`
- 정한 것: 위반 집합 비교 규칙, `.gitignore`를 보지 않는 것, 보관을 건드리지 않는 것
- 계약 바꾸기 요청(wave 3): `ContextAuthority`의 actor 모양이 모자라면 여기에 적는다
