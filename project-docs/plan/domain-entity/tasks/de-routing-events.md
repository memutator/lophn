# de-routing-events

"누가 받는가"의 첫 절반이다. 앱 일(문제 열림·다시 열림, 재시작 멈춤, activation 실패)과 앱 화면 annotation이 그 앱의 App Engineer에게 가게 되돌리고, artifact annotation의 신원을 `{domain, name}`으로 바꾸어 받는 쪽을 그 domain 그릇의 PM 또는 App Engineer로 정한다. reactor가 domain event를 그 domain 그릇의 agent에게 보낼 수 있게 `agentOfDomain` 의존을 만든다(`KindViolationFound`·`PublicToolsChanged`의 payload와 그 case는 각각 `de-kinds-domain`, `de-public-tools`가 그 위에서 고친다).

- 단위: routing (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/events/`
  - `packages/core/apps/annotations/`
  - `packages/protocol/apps/annotation.ts`
  - `packages/core/lophn-agent/session/rewind/artifact-writer.ts`
  - `packages/core/lophn-agent/session/rewind/artifact-writer_test.ts`
  - `packages/core/main/daemon/wiring/{router,annotations}.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/annotation.md`(전체), `project-docs/architecture/artifact.md`("annotation을 받는 쪽은 그 폴더에 마지막으로 쓴 session이다"), `project-docs/architecture/agent-call.md`, `project-docs/architecture/event.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `events`, `router`, `project-docs/module-catalog.yaml`의 `packages/core/events`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > 되돌리기", "artifact", `project-docs/products/roadmap/domain.md`의 "정한 것 (agent) > annotation"
  - 본보기(git): `ca54aa272`(앱 일을 PM으로 보낸 diff. 이 중 `core/events`, `wiring/router.ts`, `core/apps/annotations/{blobs,ports,send}.ts`를 거꾸로 읽는다), `ecda3b15e`(앱 target 읽기)
- 계약:
  - 쓰는 것: `AgentRef`의 `app_engineer`(`de-place-restore`), `domainOwnerOf`·`domainsOfOwner`(`packages/core/domains/lookups.ts`), `domainArtifactsFolder`(`packages/protocol/domains/paths.ts`)
  - 내놓는 것
    - `NewWorkDeps`(`events/reactor/session-opening.ts`)가 `appProject(app)`을 잃고 `agentOfApp(app) → Result<AgentRef>`(항상 `{role: "app_engineer", app}`, 앱이 없으면 `not_found`)와 `agentOfDomain(domain) → Promise<Result<AgentRef>>`(domain의 owner가 project면 `{role: "project_manager", project}`, 앱이면 `{role: "app_engineer", app}`, owner가 보관·없음이면 `not_found`)를 받는다. wiring `router.ts`가 꽂는다.
    - `annotationTargetSchema`(`packages/protocol/apps/annotation.ts`): `{kind: "app", app}` | `{kind: "artifact", domain, name}` | `{kind: "file", project}`(사람의 폴더에 있는 `.html`. 옛 `artifact`의 `name: null`이다). `annotation.send`의 refine은 app만 release와 screen이 있다고 본다.
    - `AnnotationDelivery`(`apps/annotations/ports.ts`): `deliver({app, …})`는 그 앱의 App Engineer에게, `deliverArtifact({domain, name, session, text, annotations})`는 아래 순서로 정한 쪽에, `deliverFile({project, session, text, annotations})`는 그 project의 PM에게 보낸다.

## 할 일

1. reactor: `events/reactor/session-opening.ts`에서 `ProblemOpened`·`ProblemReopened`·`ReleaseActivationFailed`·`AppRestartHalted`가 `to: {kind: "new_session", agent: await agentOfApp(app)}`로 간다(문구는 "for this app" 그대로). `projectOf`는 `agentOf(deps, event)`가 된다. `KindViolationFound`와 `PublicToolsChanged`의 case는 이 task가 건드리지 않고 type이 서 있게만 한다(둘의 payload는 아직 `project`를 싣고 있어 `agentOfDomain`을 쓰지 않는다. 각 task가 payload를 바꿀 때 고친다).
2. wiring `router.ts`: `appProject` 연결을 `agentOfApp`·`agentOfDomain`으로 바꾼다(`agentOfDomain`은 `domainOwnerOf`로 owner를 읽는 `ledgerSnapshot` 읽기). `annotationDelivery.deliver`는 새 session을 `{role: "app_engineer", app: input.app}`로 열고, 지정된 session이 그 앱 App Engineer의 열린 session이 아니면 `conflict`다("not an open session of this app's engineer"). `deliverArtifact`는 받는 쪽 후보를 (a) `domainArtifactsFolder(root, domain)`의 realpath를 root로 `lastArtifactWriter`가 찾은 열린 session, (b) 입력 session(그 domain owner의 열린 PM 또는 App Engineer여야 한다), (c) 그 owner의 새 session 순서로 고른다. `deliverFile`은 옛 사람 `.html` 갈래(그 project의 PM, 입력 session은 그 project의 열린 PM이어야 한다)다.
3. `lophn-agent/session/rewind/artifact-writer.ts`의 `lastArtifactWriter`는 입력에 `owner: {kind, id}`와 허용 role을 받아 `s.place_kind = ? and s.place_id = ?`, project면 `role in ('project_manager','operator')`, 앱이면 `role in ('app_engineer','operator')`로 고른다(지금은 `place_kind = 'project'` 고정). `artifact-writer_test.ts`에 앱 owner 사례를 더한다.
4. `core/apps/annotations/`: 저장 표(`schema.ts`)의 `target_kind`가 `app | artifact | file`이고 열 `project`(file용)·`domain`(artifact용)·`artifact`(name)이 각 갈래의 짝을 지킨다(check 제약). 개발 data는 새로 만든다. `commands.ts`·`store.ts`·`message.ts`·`send.ts`·`blobs.ts`가 새 target을 쓰고, 앱 갈래의 받는 쪽 문구를 App Engineer로 되돌린다. `reads.ts`(`annotations.get`)의 호출자 범위: 자격 조건 `app`(App Engineer, coding session)은 그 앱의 app target, 자격 조건 `project`(프로젝트 place의 PM·Operator)는 그 project의 file target과 그 project가 owner인 domain의 artifact target, 둘 다 없는 agent는 forbidden이다. artifact target이 어느 project의 domain인지는 `ports`에 `domainOwner(domain)` 읽기를 더해 wiring이 `domainOwnerOf`로 꽂는다(annotations module은 domains를 import하지 않는다). 앱 place의 Operator는 읽을 수 없다(조건 없음). `annotations_test.ts`를 맞춘다.
5. `message.ts`의 사람 메시지 글(`artifact: target.name ?? undefined` 줄 근처)이 새 target을 쓴다. 보내는 글에 domain 이름은 싣지 않는다(path가 `domains/<dom>/artifacts/<name>`이다).
6. 시험을 새 모양으로 고친다. 위험 test는 아래.

## 정한 것

- 사람의 `.html` annotation은 domain이 없으므로 `file` 갈래로 가른다. project의 PM이 받는 규칙은 그대로다(옛 `artifact` + `name: null`).
- 앱 annotation은 coding agent가 직접 받지 않고 ticket 근거로만 읽는다(그대로).

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - "artifact annotation은 그 domain 폴더에 마지막으로 쓴 열린 session이 받는다. 다른 domain·다른 그릇의 같은 이름 artifact에 쓴 session은 받지 않는다" — `packages/core/lophn-agent/session/rewind/artifact-writer_test.ts`
  - "`annotations.get`: PM·Operator는 자기 project가 owner인 domain의 artifact annotation만 읽고 다른 project 것은 `not_found`다. App Engineer는 자기 앱의 app annotation만 읽는다" — `packages/core/apps/annotations/annotations_test.ts`
- 남지 않음: `grep -rn "appProject\b\|agentOfApp" packages/core/events packages/core/main/daemon/wiring/router.ts`에서 `appProject`가 0줄이다. `grep -rn "role: \"project_manager\"" packages/core/events/reactor/session-opening.ts`는 `KindViolationFound`·`PublicToolsChanged` case 두 곳만 남는다(보고에 적는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것
- 넘길 줄: 새 target 모양 때문에 최소로 고친 shell·test file:줄(`packages/shell/main/desktop/wiring/annotate.ts`, `tests/e2e/annotation_test.ts` 등)
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 위 두 event case는 `project`를 싣는다(`de-kinds-domain`, `de-public-tools`가 고친다)
