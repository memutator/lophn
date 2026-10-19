# de-coding-routing

coding agent 쪽을 예전 길로 되돌린다: coding session의 place는 앱이고(`{kind: "app", id}`), 완료 보고·claim 만료·보고 없는 끝·coding agent의 메시지는 그 앱의 App Engineer(열린 session, 없으면 새 session)가 받는다. 터미널은 app space에 열린다(shell 쪽은 `de-shell-app-space`). coding agent가 읽는 안내 글(CLI 메시지, 두 skill, 앱 template의 `AGENTS.md`)이 Project Manager를 부르던 말을 App Engineer로 되돌린다.

- 단위: routing (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/tickets/`
  - `packages/core/router/`
  - `packages/core/main/daemon/wiring/{coding-sessions,router-registration,router-registration_test,session-snapshots}.ts`
  - `packages/core/server/identity/registry.ts`
  - `packages/core/storage/ledger/target-authorization.ts`
  - `packages/coding-agent/`
  - `packages/protocol/coding-agent/`
  - `packages/core/apps/packages/template/app/AGENTS.md.tmpl`
  - `tests/support/coding/hand-off.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md`("coding session의 place는 …", "사람은 coding agent와 직접 이야기하지 않는다", "메시지의 답은 … `call`로 보내야"), `project-docs/architecture/agent-call.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-tickets`, `coding-agent`, `project-docs/module-catalog.yaml`의 `packages/coding-agent`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > 되돌리기 > coding", `project-docs/products/roadmap/domain.md`의 "role과 place" 표(coding agent 줄)
  - 본보기(git): `ca54aa272`(app 일을 PM으로 보낸 diff를 거꾸로 읽는다), `a3499acbd`(coding agent 안내 글을 PM으로 바꾼 diff를 거꾸로 읽는다)
- 계약:
  - 쓰는 것: `AgentRef`의 `app_engineer`와 `Place`의 `app`(`de-place-restore`)
  - 내놓는 것: `codingPlace(sql, app)`(`apps/tickets/coding/store.ts`)는 `{kind: "app", id: app}`을 낸다(앱이 없으면 null). `close-call.ts`·`message.ts`는 `to: {kind: "open_session_or_new", session, agent: {role: "app_engineer", app}}`로 보낸다.

## 할 일

1. `apps/tickets/coding/store.ts`의 `codingPlace`가 앱 place를 낸다(`appProjectOf` 쓰지 않는다). `close-call.ts`·`message.ts`의 `appProjectOf`와 `internal` 오류("the app has no project")를 없애고 대상을 `app_engineer`로 되돌린다. `events.ts`·`launch.ts` 등 `codingPlace`를 쓰는 곳이 앱 place를 받는다. 앱 id가 곧 place라 `coding_test.ts`·`store_test.ts`의 기대를 맞춘다.
2. `apps/tickets/coding/scaffold-source.ts`: `sourcelessAppNamed`의 SQL이 `project` 열을 읽지 않는다(`select id, slug, name, revision …`)와 `ScaffoldTarget`의 `project` 칸을 없앤다. 기본 source 자리는 `appDefaultSource(dataRoot, app)`에 **앱 id**를 준다(helper는 `de-apps-storage`가 앱 id를 받는 `<data>/apps/<app>/source`로 바꾼다. 그 helper가 아직 project id를 기대하더라도 인자만 앱 id로 넘기고, 시험은 helper를 직접 부르지 말고 `scaffold` 흐름을 쓴다).
3. `apps/tickets/` 안의 "Project Manager"를 부르던 주석·오류 문구(`commands.ts`, `checks.ts`, `checker/*`, `model.ts`, `reads.ts`, `report.ts`, `tickets_test.ts`)를 `ca54aa272`의 역으로 App Engineer로 되돌린다. `wiring/coding-sessions.ts`(call을 닫으며 맡긴 쪽에게 가는 입력의 고정 문구 주석), `router-registration.ts`(`codingPlace(view.sql, coding.app)`이 앱 place를 준다), `session-snapshots.ts`, `server/identity/registry.ts`·`storage/ledger/target-authorization.ts`의 주석을 같이 되돌린다. `router/`는 `de-place-restore`가 앱 place 갈래를 되살렸으니 `reads.ts`·`environment.ts`의 남은 PM 문구만 고친다.
4. coding agent 글: `packages/coding-agent/cli/commands/{message,package}.ts`, `packages/coding-agent/guides/skills/{lophn-build-app,lophn-repair}/SKILL.md`, `packages/protocol/coding-agent/{message.ts,ticket/claims.ts,ticket/values.ts}`, 앱 template `AGENTS.md.tmpl`의 "Project Manager"를 `a3499acbd`의 역으로 "App Engineer"로 되돌린다. 두 skill과 template에 tool 선언에 `domain`이 필요하다는 말 한 줄을 더한다("tool마다 `domain`: 이 앱의 domain 이름. 앱 이름의 domain이 있다. 다른 domain이 필요하면 App Engineer에게 청한다"). `app-api`라는 말은 새로 쓰지 않는다(`tool`이라고 쓴다. 옛 말은 `de-names-tool`이 지운다).
5. `tests/support/coding/hand-off.ts`의 PM 문구를 맞춘다(`c55d0f954`가 바꾼 줄).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(옛 길을 되돌린 것이고 `coding_test.ts`·`tickets_test.ts`가 기대를 맞춘다)
- 남지 않음: `grep -rn "appProjectOf" packages/core/apps/tickets packages/core/router`가 0줄이고, `grep -rln "Project Manager" packages/coding-agent packages/protocol/coding-agent packages/core/apps/tickets`에서 coding agent가 메시지를 보내거나 완료를 보고하는 쪽으로 PM을 부르는 문구가 없다(PM이 project 일을 한다는 문장은 있어도 된다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `appProjectOf`를 쓰던 import(남이 쓰는 export는 지우지 않는다)
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: scaffold의 기본 source 자리는 `de-apps-storage`가 helper를 바꾼 뒤에야 `<data>/apps/<app>/source`가 된다
