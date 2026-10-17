# annotation-archived-app

보관(archive)한 앱은 새 입력을 받지 않는다. 그 앱으로 `annotation.send`를 하면 저장이 `conflict`로 거절되고, App Engineer session도 열리지 않고 메시지도 가지 않는다. `tests/e2e/annotation_test.ts`에 행 하나를 더한다.

- 단위: annotation-archived-app (wave 2)
- 선행: annotation-to-ae. 같은 `tests/e2e/annotation_test.ts`의 core·fake·`ROWS`와 `annotationOf`를 쓴다.
- 소유(이 task만 고친다):
  - `tests/e2e/annotation_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/annotations/commands.ts`
  - `packages/core/apps/annotations/send.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 11절 `annotation-archived-app`
  - architecture: `project-docs/architecture/annotation.md`("보내기는 사람의 동작이라 Gate를 거치지 않고, 사람이 아니면 저장을 거절한다. 보관한 앱이면 저장이 conflict로 거절되고, 전달에 실패하면 방금 저장한 묶음을 지운다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`, `router`, `core-api`
  - 코드: `packages/core/apps/annotations/commands.ts`(`persist`: 앱이 없으면 `not_found`, `status === "archived"`이면 `conflict` "an archived app does not take new input". 묶음을 쓰기 전이다), `packages/core/apps/annotations/send.ts`(저장이 거절되면 전달하지 않는다), `packages/protocol/apps/apps.ts`(`appArchive`: compare `{base_revision}`는 `appCreate`가 돌려준 `revision`), `packages/protocol/lophn-agent/agent-sessions.ts`(`agentSessionList {agent, archived: "include"}`)
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `annotation-to-ae`가 만든 `annotation_test.ts`의 틀(`ROWS`, `annotationOf`, 앱을 `appCreate`로 만드는 방법), `appArchive`(user, compare `{base_revision}`), `annotationSend`, `agentSessionList`
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `annotation-to-ae`가 merge됐다. `ROWS`에 행 하나를 더한다.
2. 행 하나. 새 앱 `C`를 만들고 보관한다. screenshot 없이 보낸다(업로드가 필요 없다).

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `archived-app` | `core.call(appCreate, ...)`(C, 돌려받은 `revision`) → `core.call(appArchive, {app}, {base_revision: revision})` → `core.tryCall(annotationSend, {app: C, session: null, annotations: [annotationOf(core.ids.newId("rel"), null)]})` → `core.call(agentSessionList, {agent: {role: "app_engineer", app: C}, archived: "include"})` | 없음 | route: 보내기의 오류 code가 `conflict`다(`invalid_input`·`not_found`가 아니다. 입력은 맞고 앱이 보관된 것이 이유다) / inbox: C의 App Engineer session이 하나도 없다(저장이 거절되어 전달까지 가지 않았다) | 후보 `annotation-archived-app`(candidates-docs 11절이 적은 264행). 앞 행과 같은 입력이 보관되지 않은 앱으로는 보내진다(`annotation-to-ae`의 행 1·2가 보인다) |

3. 보관한 앱의 오류 code는 `persist` handler에서 읽은 대로 `conflict`다. 다르면(예: `not_found`, 앱이 지워져 보임) 제품 동작이 문서와 다른 것이다. 문서가 정한 것은 `conflict`다.
4. 어긋나면 제품 bug다. 추가 소유 안에서만 고치고 "고치기 전 코드에서 실패"를 보고에 적는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `apps`·`router`(보관한 앱은 새 입력을 받지 않는다. annotation은 App Engineer에게 가는 입력의 한 길이다).
- 현실적 회귀: 보관한 앱의 App Engineer에게 새 session이 열려 입력이 쌓이는 것, 저장은 거절됐는데 메시지가 먼저 가는 것(저장 → 전달 순서가 뒤바뀌는 것).
- 왜 지금 test가 못 잡나: `annotations_test.ts`는 저장 command의 거절만 본다. 보내기 route → 저장 → 전달의 순서에서 전달이 일어나지 않았음(session이 열리지 않음)은 Router 쪽 상태까지 읽어야 보인다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/annotation_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/annotation_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "보관한 앱으로 보낸 annotation은 conflict로 거절되고 App Engineer session이 열리지 않는다"

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
