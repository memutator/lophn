# tr-e2e-app-call-kinds

`app-call_test.ts`와 `kinds_test.ts`를 다시 쓴다(README "정한 것" 표의 두 줄). app-call: agent가 앱 부르기, 큰 changeset, 사람이 부르기, net·secret loopback, 너무 큰 입력. 묻는 단계 둘과 `external_ping`은 뺀다. kinds: kind 위반이면 Gateway가 남지 않는 `KindViolationFound {domain, count}` 하나를 받고 problem과 PM session은 생기지 않는다. 켠 뒤 첫 sync는 기준만 잡는다.

- 단위: e2e (wave 2)
- 선행: tr-support-app.
- 소유(이 task만 고친다):
  - `tests/e2e/app-call_test.ts`
  - `tests/e2e/kinds_test.ts`
  - `tests/support/app/patch-call.ts`
  - `tests/support/app/patch-net.ts`
- 읽을 것:
  - 계획: `project-docs/plan/test-restore/README.md`의 "정한 것" 표 `app-call`·`kinds` 줄. `project-docs/plan/test-restore/survey-e2e.md` 0절 마지막 줄(kind 위반은 남지 않는 event뿐, 켠 뒤 첫 sync는 기준만), 1절 4번 줄(app-call, rewrite)과 16번 줄(kinds, rewrite), 2절 `app/patch-call.ts`·`patch-net.ts` 줄
  - helper 계약: `project-docs/plan/test-restore/tasks/tr-support-app.md`의 "내놓는 것"(`activateTestApp`, `TestApp`. 옛 `gateway` 칸은 없다. `source.ts`의 "(더함)" `sampleDomain(dir)`과 "할 일" 2.3: patch가 앱 domain을 path 끝 조각 대신 이것으로 읽는다), `tests/support/app/deps.ts`(`appCoreEnv`. tr-support-app이 `tests/support/coding/`에서 옮긴다)
  - architecture
    - `project-docs/architecture/app-call.md` 48줄(부른 쪽은 core가 확인한다), 53줄(호출 경로는 묻지 않고 막기만 한다. agent는 할당), 70-71줄(frame 한도를 넘는 응답은 `changeset_dropped: "too_large"`로 성공으로 닫히고, 입력 상한 `CALL_BODY_MAX_BYTES`를 넘는 입력은 보내기 전에 `invalid_input`), 89-94줄(net·secret broker, 값은 supervisor가 붙인다, live 자식만 바깥에 닿는다)
    - `project-docs/architecture/approval.md` 25·27줄(할당한 앱의 tool만 뜨고, 할당한 tool은 바깥 효과도 묻지 않는다. 그래서 `external_ping`의 session-scope 묻기 단계가 없어진다)
    - `project-docs/architecture/kinds.md` 흐름 그림과 41·44·46줄(읽기 앞 sync, 앞 sync에 없던 위반이면 `KindViolationFound {domain, count}`를 Bus에 한 번, agent session은 열리지 않는다, 켠 뒤 그 domain의 첫 sync는 기준만)
    - `project-docs/architecture/testing.md` "case 고르는 규칙"(91줄)
  - changelog: `project-docs/products/change-log/0.6.0.md`의 "problem 모델과 reaction 다섯을 지우고, 앱 log를 앱마다 file로 남긴다"(새 kind 위반은 남지 않는 event라 toast만 뜨고 session은 열리지 않는다. 켠 뒤 첫 sync는 기준만 둔다)와 "approval을 할당, …으로 줄인다"(할당 `{app, removed_tools}`, revision compare)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-runtime`, `app-spi`, `app-capability`, `child-supervision-protocol`, `agent-tools`, `approvals`, `kinds`, `events`, `event-stream`; `project-docs/module-catalog.yaml`의 `tests`
  - 코드
    - app-call: `packages/protocol/approvals/assignment.ts`(`agentAssignmentSet` 입력 `{agent, entries: [{app, removed_tools}]}`, compare `{revision}`. 새 agent는 0), `packages/protocol/apps/calls/invocation.ts`(`appInvocations`, `appInvocation`), `packages/protocol/apps/calls/rewind.ts`(`appRewindPlan`), `packages/core/apps/runtime/entrypoint/limits.ts` 32줄(`CALL_BODY_MAX_BYTES`), `packages/core/apps/permissions/broker/{net-fetch,secrets,access}.ts`(`liveOnly`)
    - kinds: `packages/core/projects/kinds/host/dispatcher.ts` 60줄(`known`, 메모리), 96-112줄(`compare`: 앞이 없으면 기준만, 새 정체성 수가 `count`), 161-166줄(`ask`는 sync 뒤에 묻는다); `packages/core/projects/kinds/host/watch/service.ts` 86-99줄(`domain.create` 등이 감시를 다시 정한다), 140-204줄(`open`: `kindsOf`(= sync) 뒤 kind glob 폴더와 domain 폴더를 보고 `catchUp`(force sync)), 206-222줄; `packages/core/main/daemon/wiring/kinds.ts` 89-96줄(`found` → `ctx.bus.publish(KindViolationFound)`); `packages/protocol/events/transient.ts` 88-94줄; `packages/protocol/projects/kinds-api.ts` 19-40줄(`violationSchema`), 207줄(`kindCheck {domain, query}`. actor에 user가 있다); `packages/protocol/domains/domains.ts` 28-43줄(`domainCreate`의 `id`는 user만 미리 줄 수 있다), `packages/protocol/domains/paths.ts`(`domainFolder`, `domainKindsFile`); `packages/protocol/lophn-agent/agent-sessions.ts` 53-57줄·101줄(`agentSessionList {agent}`)
    - helper: `tests/support/gateway/mod.ts`(`connectGateway(core, {conditions})`, `next("event", match)`, `watch`, `frames`), `tests/support/core/human.ts`(`until`, `openProject`, `openSession`, `say`, `waitTurnEnd`), `tests/support/fake-server/probe.ts`(`toolNames`, `lastToolResult`)
    - 옛 file: `tests/e2e/app-call_test.ts`, `tests/e2e/kinds_test.ts`(이 brief의 할 일이 줄마다 가리킨다)
- 계약:
  - 쓰는 것: tr-support-app의 `tests/support/app/activate.ts`(`activateTestApp`, `TestApp`), `deps.ts`(`appCoreEnv`); `packages/protocol/approvals/assignment.ts`(`agentAssignmentSet`), `packages/protocol/events/transient.ts`(`KindViolationFound`), `tests/support/gateway/mod.ts`(`connectGateway`)
  - 내놓는 것: 없음

## 할 일

### app-call

근거: README 표 `app-call` 줄, `app-call.md` 48·53·70-71·89-94줄, `approval.md` 25·27줄. 단계 다섯은 그대로 두고 준비만 바꾼다.

1. 머리 주석(옛 1-15줄): 세 질문은 그대로 두고, contract에 `approvals`(할당이 agent의 앱 호출을 연다)를 더한다. "fake 대답" 단락에서 `allow-session-scope`(셋)와 grant를 지우고, 행 몫은 `agent-calls-app`의 둘뿐이며 activation helper의 App Engineer 대답은 세지 않는다고 쓴다. "README 정한 것 11" 참조를 지운다.
2. import(옛 16-50줄): `agentGrantsSet`, `approvalsDecideTurn`, `approvalsPending`, `waitPermission`을 지운다. `agentAssignmentSet`(`packages/protocol/approvals/mod.ts`)을 더한다. `appCoreEnv`는 `../support/app/deps.ts`에서 읽는다.
3. 준비(옛 112-134줄): `activateTestApp` 호출과 patch(`callPatch`, `netFetchPatch`)는 그대로다. `let app`을 `const app = await activateTestApp(...)`으로 둔다. 124-134줄의 `agentGrantsSet`을 `c.call(agentAssignmentSet, { agent: operator, entries: [{ app: id, removed_tools: [] }] }, { revision: 0 })`로 바꾼다(Operator는 앱 place라 앱의 domain을 모두 맡는다).
4. 단계
   - `agent-calls-app`(옛 136-166줄), `big-changeset`(168-202줄), `net-fetch-loopback`(226-246줄), `input-too-large`(248-268줄): 그대로다.
   - `call-from-person`(204-224줄): 220-221줄의 `approvalsPending` 단정("route")을 지운다. 사람의 호출은 Gate를 거치지 않고 approvals 대기 목록도 없다.
   - 270-332줄 `allow-session-scope` 두 단계와 `granted`를 지운다. "이 session 동안" 선택지와 할당한 external tool의 묻기가 없다.
5. finally(옛 333-339줄): `app?.gateway.close()` 줄을 지운다.
6. `tests/support/app/patch-call.ts`
   - `external_ping`을 지운다: 머리 7줄, 선언(66-74줄), handler(103줄).
   - 1-3줄 주석의 "platform app test(선언과 등록 handler가 같다, 되돌림)"와 fixture 입력 문장을 지금 사실로 고친다: release 준비의 handler 검사(봉인한 bundle을 preview로 한 번 띄워 선언과 등록 handler를 대조한다, `packages/core/apps/control.ts` 595줄)를 지나야 한다. 되돌림 증명과 fixture 입력은 test runner와 함께 없어졌다.
   - 21줄 `const slug = dir.split("/").at(-1);`을 `const slug = await sampleDomain(dir);`(`./source.ts`, tr-support-app의 "(더함)")로 바꾼다. 이유(tr-support-app "할 일" 2.3): source 폴더가 `<home>/apps/<app id>/source`라 마지막 조각이 `source`이고, 그대로 두면 새 tool의 domain이 `source`가 되어 준비가 `failed {stage: "release"}`로 떨어진다.
7. `tests/support/app/patch-net.ts`
   - 1-10줄 주석을 고친다: "platform app test"는 위와 같이 handler 검사로, 8-10줄의 "test mode"는 "release 준비의 handler 검사와 preview 자식은 handler 본문을 부르지 않거나 broker가 바깥 요청을 거절한다(`liveOnly`, `packages/core/apps/permissions/broker/net-fetch.ts`). 본문은 live에서만 돈다"로.
   - 28줄 `const slug = dir.split("/").at(-1);`을 6과 같이 `await sampleDomain(dir)`로 바꾼다. 그 밖의 코드는 바꾸지 않는다.

### kinds

file을 처음부터 다시 쓴다. 근거: README 표 `kinds` 줄, `kinds.md` 44·46줄, `dispatcher.ts` 96-112줄.

8. 머리 주석(`testing.md` 규칙 1)
   - contract: boundary `kinds`·`events`·`event-stream`(kind 파일이 가리키는 문서에 새 위반이 생기면 kinds worker의 sync 답을 dispatcher가 앞 sync와 메모리에서 견주어 남지 않는 `KindViolationFound {domain, count}`를 Bus로 한 번 내고 Gateway가 받는다. session은 열리지 않는다. 켠 뒤 그 domain의 첫 sync는 기준만 둔다)
   - 현실적 회귀: worker launch spec의 읽기 권한에 project 폴더나 kind 파일이 빠진다, dispatcher가 Bus에 못 내거나 Gateway가 남지 않는 event를 거르지 못한다, 켠 뒤 첫 sync가 있던 위반을 모두 새것으로 알린다, 같은 위반을 sync마다 다시 알린다, 위반이 다시 session을 연다
   - 왜 지금 test로 못 잡나: dispatcher의 비교를 보는 unit이 없고(`packages/core/projects/kinds/host`에는 `handlers_test.ts`뿐이다), kind route → dispatcher → worker process → Bus → Gateway WebSocket은 process를 건너야 보인다
   - fake 대답은 없다. 앱이 없는 project 길이라 `appCoreEnv` 없이 `bootCore(run)`이다. 폴더와 파일은 사람이 editor로 저장하듯 직접 쓴다.
9. 준비: `bootCore(run)`, `connectFakeProvider(core, fake)`(대본은 걸지 않는다. session이 열려 model을 부르면 fake journal에 남는다). project 폴더 `${run.work}/notes-project`에 `notes/a.md`(`---\ntitle: a\n---\n`, `status` 없음)를 쓰고 `openProject(core, folder, "notes-project")`. `connectGateway(core, { conditions: [{ types: ["KindViolationFound"] }] })`.
10. 단계 `first-sync-is-baseline`: 켠 뒤 첫 sync가 본 위반은 알리지 않는다.
    1. `const domain = core.ids.newId("dom")`. `domainFolder(core.run.home, domain)`를 만들고 `domainKindsFile(core.run.home, domain)`에 옛 file의 `KINDS`(35-44줄)를 쓴다. 그 뒤 `domainCreate {id: domain, name: "notes", title: "Notes", purpose: "Notes kept in this project", owner: {kind: "project", id: project}}`.
       - 정한 것: kind 파일과 위반 문서를 domain을 만들기 전에 둔다. 이유: domain을 만들면 감시가 바로 그 domain을 sync해 기준을 잡는다(`watch/service.ts` 140-204줄). 파일이 없는 채로 잡힌 기준은 빈 집합이라 "첫 sync는 기준만"을 볼 수 없다. 미리 두면 core가 위반이 있는 domain을 처음 sync하는 처지(재시작 뒤와 같다)가 core 재시작 없이 된다.
    2. `until("kind 파일이 적용됨", ...)`으로 `kindCheck {domain, query: {}}`(사람 자격)의 `total`이 1이 될 때까지 기다린다. 읽기 앞 sync가 돌았으니 기준이 잡혔다.
    3. 울타리: `gateway.watch([{ types: ["KindViolationFound"] }])`를 한 번 더 보내 `ready`를 받는다(그 전에 Bus가 낸 event frame은 먼저 와 있다. 첫 run에서 이 순서가 맞는지 확인하고, 아니면 보고에 적는다).
    4. 단정
       - route: `kindCheck`의 `violations[0]`에서 `message`를 뺀 것이 `{source: "document", rule: "required", kind: "note", path: "notes/a.md", field: "status"}`(옛 106-113줄과 같다)
       - event: `gateway.frames()`에 `event.type === "KindViolationFound"`인 frame이 없다
11. 단계 `new-violation-notifies-once`: 새 위반은 Gateway에 한 번만 오고 session은 없다.
    1. `notes/b.md`를 a와 같은 내용으로 쓴다.
    2. `until("새 위반이 보임", ...)`으로 `kindCheck {domain, query: {}}`의 `total`이 2가 될 때까지 읽는다. 감시(kind glob 폴더, 500ms 합침)의 force sync가 먼저 잡든, 2초가 지난 읽기 앞 sync가 잡든 같은 `compare`를 지난다. 정한 것: 감시에만 기대지 않는다. 이유: 감시는 domain을 만든 뒤 비동기로 열려(`onCommand` → `refreshAll`) b.md를 쓸 때 아직 열리지 않았을 수 있고, `kinds.md` 41줄대로 감시는 힌트이고 놓쳐도 읽기 앞 sync가 따라잡는 것이 제품 계약이다.
    3. `gateway.next("event", (f) => f.event.type === "KindViolationFound")`로 받고, 울타리(`gateway.watch`)를 한 번 더 둔다.
    4. 단정
       - event: 받은 frame의 `event.subject`가 `domain`, `event.payload`가 `{domain, count: 1}`이고, `frames()`의 `KindViolationFound`가 모두 하나다(기준 단계에서 알렸거나 같은 위반을 다시 알렸으면 둘 이상이다)
       - ledger: `agentSessionList {agent: {role: "project_manager", project}}`의 `sessions`가 비었다
       - fake: `fake.journal()`이 비었다(어떤 turn도 model을 부르지 않았다)
    - problem은 단정하지 않는다. problem 표와 route가 없다(옛 `problemListDomain`). 정한 것: README의 "problem은 생기지 않는다"는 session과 model 요청이 없는 것으로 본다.
12. finally: `gateway?.close()`, `core?.kill()`, `fake.close()`, `run.remove()`.

### 끝으로

13. type check와 실행
    - `deno check tests/e2e/app-call_test.ts tests/e2e/kinds_test.ts tests/support/app/patch-call.ts tests/support/app/patch-net.ts`. 이 file들은 tr-check-enable 전까지 `tools/check.ts`의 `NOT_CHECKED`라 `deno task check`가 type을 보지 않는다.
    - `deno task e2e:deps`를 한 번 돌리고 `deno test --allow-all --no-check tests/e2e/app-call_test.ts`, `deno test --allow-all --no-check tests/e2e/kinds_test.ts`.

## 끝남

- `deno task check`가 통과한다.
- `deno check`, `deno fmt --check`, `deno lint`가 소유 file 넷에서 오류 없이 끝난다.
- `deno task e2e:deps` 뒤 두 e2e file이 각각 세 번 잇달아 통과한다(lead가 merge 전에 열 번 더 돌린다). 끝난 뒤 `/tmp/lophn-e2e-*`와 core process가 남지 않는다.
- 위험 test: 새 unit test는 없다. 두 file이 그 test다. 이름 예:
  - app-call: 옛 이름 "E2E agent·사람 화면의 tool 호출은 core를 지나 앱 process가 실행하고 기록되며, frame 한도를 넘는 write도 성공으로 닫힌다"를 그대로 둔다
  - kinds: "E2E kind 파일이 가리키는 문서에 새 위반이 생기면 Gateway가 KindViolationFound 하나를 받고 session은 열리지 않으며, 켠 뒤 첫 sync가 본 위반은 알리지 않는다"
- 남지 않음
  - `grep -n "agentGrants\|approvalsDecideTurn\|approvalsPending\|waitPermission\|external_ping\|allow-session-scope\|support/coding\|\.gateway" tests/e2e/app-call_test.ts tests/support/app/patch-call.ts`가 0줄이다.
  - `grep -n "problemListDomain\|problems/mod.ts\|reactionSessions\|receivedMessageList" tests/e2e/kinds_test.ts`가 0줄이다.
  - `grep -n "platform app test\|test mode" tests/support/app/patch-call.ts tests/support/app/patch-net.ts`가 0줄이다.
  - `grep -n 'split("/").at(-1)' tests/support/app/patch-call.ts tests/support/app/patch-net.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check(e2e 세 번씩의 걸린 시간 포함)
- 등록할 것: 없음
- 안 쓰게 된 export: 없음이면 "없음"
- 정한 것: 문서에 답이 없어 worker가 정한 것(위 "정한 것" 셋을 그대로 했는지 포함)
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- kinds 울타리: `gateway.watch`의 `ready`가 앞서 낸 event frame 뒤에 오는지 첫 run에서 본 것(아니면 무엇으로 바꿨는지)
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
