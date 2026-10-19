# dp-place-events

program과 coding agent가 App Engineer를 부르던 모든 길을 그 앱의 project Project Manager로 돌린다: reaction(problem 열림·다시 열림, 반복 종료, activation 실패), coding 완료·claim 만료·보고 없는 종료, coding agent의 메시지, 앱 화면 annotation. 앱을 받는 곳이 앱의 project를 `appProjectOf`로 찾는다. App Engineer 문구가 남은 core/apps의 오류 메시지와 주석도 같이 고친다.

- 단위: place-core (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/events/reactor/session-opening.ts`
  - `packages/core/router/`
  - `packages/core/apps/tickets/`
  - `packages/core/apps/annotations/`
  - `packages/core/apps/packages/publish.ts`
  - `packages/core/apps/blueprint/reads.ts`
  - `packages/core/storage/ledger/target-authorization.ts`
  - `packages/core/server/identity/registry.ts`
  - `packages/core/approvals/grants/reads_test.ts`
  - `packages/core/main/daemon/wiring/router.ts`
  - `packages/core/main/daemon/wiring/router-registration.ts`
  - `packages/core/main/daemon/wiring/session-snapshots.ts`
  - `packages/core/main/daemon/wiring/coding-sessions.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/annotation.md`, `project-docs/architecture/coding-agent.md`, `project-docs/architecture/app-call.md`, `project-docs/architecture/place-session.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `events`, `app-tickets`, `project-docs/module-catalog.yaml`의 `packages/core/router`, `packages/core/apps`
  - 제품 결정: `project-docs/plan/domain-place/README.md`의 "정한 것 > PM이 App Engineer의 일을 맡는다 / annotation", `project-docs/products/AGENT-ROLE.md`의 A2, A3, A11, K4, T20, E1~E4
- 계약:
  - 쓰는 것: `dp-app-project`의 `appProjectOf(sql, app)`(`packages/core/apps/lookups.ts`)
  - 내놓는 것: 위 길이 모두 `{ role: "project_manager", project }`를 부른다. coding agent 대상(`{ role: "coding_agent", app }`)은 그대로다. `SessionStarted`의 coding session `place`는 앱의 project place(`{ kind: "project", id }`)다.

## 할 일

1. `packages/core/events/reactor/session-opening.ts`: `callOf`의 `engineer(app)`(49째 줄)를 PM 호출로 바꾼다. 앱 id에서 project를 찾는 의존 `appProject(app)`를 `NewWorkDeps`에 더하고(비동기 가능, `events.at`처럼 wiring이 ledger 연결로 꽂는다) `callOf`를 그 결과로 만든다. `ProblemOpened`, `ProblemReopened`, `AppRestartHalted`, `ReleaseActivationFailed`가 대상이다. `ContextViolationFound` 갈래는 건드리지 않는다(`domain-kinds`가 고친다). wiring `router.ts`(`registerNewWorkHandlers`를 부르는 곳)가 새 의존을 꽂는다.
2. `packages/core/apps/tickets/coding/{close-call,message}.ts`: 받는 agent `{ role: "app_engineer", app }`를 `{ role: "project_manager", project: appProjectOf(tx.sql, app) }`로 바꾼다(`close-call.ts` 54째 줄, `message.ts` 39째 줄). project가 없으면(앱 필수 칸이라 일어나지 않는다) `internal`.
3. `packages/core/apps/tickets/coding/events.ts`의 `sessionStarted`(33째 줄): `place: { kind: "app", … }`를 앱의 project place로 바꾼다. `coding/scaffold-source.ts`는 `sourcelessAppNamed`가 `project`도 읽게 하고(`ScaffoldTarget.project`) 기본 source 자리(`scaffold`의 `${dataRoot}/apps/${target.id}/source`, 78째 줄)를 `packages/protocol/apps/app-storage.ts`의 `appDefaultSource(dataRoot, project)`로 바꾼다. 이 파일이 저장 자리를 쓰는 유일한 곳이라 `dp-storage-apps`가 아니라 여기서 한다. wiring `coding-sessions.ts`의 `withScaffoldedSource` 호출을 맞춘다.
4. wiring `router.ts`의 annotation 전달(`annotationDelivery.deliver`, 219~268째 줄): 새 session은 `{ role: "project_manager", project: <앱의 project> }`로 열고, 이미 있는 session은 role이 `project_manager`이고 `project`가 그 앱의 project이며 `open`일 때만 받는다("not an open session of this app's engineer" 메시지는 Project Manager 문구로 고친다). `packages/core/apps/annotations/send.ts`는 주석만 고친다(최소 편집. `artifact` 계획이 같은 file을 고친다). 앱 project를 찾는 길은 wiring이 가진 ledger 연결(`ctx.ledgerPath`)에서 `appProjectOf`로 읽는다.
5. `packages/core/router/reads.ts`의 `placeOf(agent)`(38째 줄)에서 `app_engineer` 갈래를 지운다. wiring `router-registration.ts`의 `describe`(coding session의 `place`, 209째 줄)와 `session-snapshots.ts`(68째 줄)도 앱의 project place로 바꾼다.
6. 오류 메시지와 주석: `packages/core/apps/tickets/commands.ts`(44, 83, 113째 줄의 "only an App Engineer …"), `tickets/{model,reads,report,checks}.ts`, `tickets/checker/*`, `annotations/{ports,blobs,message,reads}.ts`, `apps/packages/publish.ts`(56~60째 줄 "only the App Engineer of the app publishes its packages"), `apps/blueprint/reads.ts`(46째 줄), `storage/ledger/target-authorization.ts`, `server/identity/registry.ts`, `tickets/tickets_test.ts`(194째 줄 test 이름)의 "App Engineer"를 "Project Manager"로 고친다. 권한 판정 자체는 바꾸지 않는다(PM 자격이 `conditions.app`을 갖는 것은 `dp-agent-roles-scope`가 정한다).
7. 시험: `approvals/grants/reads_test.ts`(15, 28~33째 줄)의 `app_engineer` 사례를 `project_manager`로 옮기거나 지운다. 앱 place·App Engineer를 단언하던 test는 지운다.
8. 합집합이 아직 남아 있다: protocol의 `Role`·`Place`는 `dp-place-protocol`이 마지막에 줄인다. 그때까지 `app_engineer`·앱 place가 type에 있어 exhaustive `switch`나 `Record<Role, …>`가 오류를 내면 그 갈래만 새 로직 없이 남긴다(null, 빈 값). 남긴 곳은 보고의 "넘길 줄"에 file:줄로 적는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(권한 판정을 안 바꾼다. 받는 쪽만 바뀐다)
- 남지 않음: 아래가 0줄이다.
  - `grep -rn "app_engineer\|App Engineer" packages/core/events packages/core/router packages/core/apps/tickets packages/core/apps/annotations packages/core/apps/packages/publish.ts packages/core/apps/blueprint packages/core/storage packages/core/server packages/core/approvals`
  - `grep -n "app_engineer" packages/core/main/daemon/wiring/router.ts packages/core/main/daemon/wiring/router-registration.ts packages/core/main/daemon/wiring/session-snapshots.ts`

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것: coding session의 `place`는 앱의 project로 했다 / reactor가 앱 project를 찾는 길
- 넘길 줄: `packages/core/apps/annotations/send.ts`는 주석만 고쳤다(`artifact`와 겹침)
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
