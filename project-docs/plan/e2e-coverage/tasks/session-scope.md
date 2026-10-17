# session-scope

lophn은 등록된 project 폴더를 읽기만 하고 쓰기 tool이 없다는 것과, 앱 place의 Operator는 앱 source를 읽기만 한다는 것을 `tests/e2e/session_test.ts`에 행 둘로 더한다. 앱을 activate하지 않고 `apps/create`와 `apps/connect_source`만 쓴다(앱 support가 필요 없다).

- 단위: session-scope (wave 2)
- 선행: session-rows. 같은 `tests/e2e/session_test.ts`에 행을 더하므로 순서를 묶는다.
- 소유(이 task만 고친다):
  - `tests/e2e/session_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/agent-roles/place/place-folders.ts`
  - `packages/core/agent-roles/tool-lists.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 6절의 `lophn-reads-not-writes`
  - architecture: `project-docs/architecture/place-session.md`("file tool의 범위는 place가 정한다"와 그 아래 `placeScope` 설명), `project-docs/architecture/approval.md`("lophn agent의 file, shell, web tool도 Gate가 없다. place가 범위다")
  - `project-docs/products/AGENT-ROLE.md`의 P1, P2, P4
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `agent-roles`, `run-loop`
  - 코드: `packages/core/agent-roles/place/place-folders.ts`의 `placeScope`(lophn은 `read: allProjectFolders`, `write: []`. 앱 place의 Operator는 `read: [appSource]`, `write: []`), `packages/core/agent-roles/tool-lists.ts`(lophn은 `WORK_TOOLS`(`file.write`, `file.edit`, `shell.run`)가 없다. model에 보이는 이름은 `.`이 `_`로 바뀐 `file_read`·`file_write`), `packages/core/lophn-agent/run-loop/tool-batch.ts`(목록에 없는 tool 호출은 `failure`·`not_found`로 닫힌다), `packages/core/apps/lookups.ts`의 `activeAppSourcePaths`(active 앱의 source가 runtime의 Deno 권한 합에 든다)
  - route(코드로 확인한 이름): `appCreate {slug, name, description}`(output `app.revision`), `appConnectSource {app, source_path}`(compare `{base_revision}`, `packages/protocol/apps/apps.ts`), `operatorCreate {id: agt_, place: {kind: "app", id}, definition: {name}}`(`packages/protocol/lophn-agent/agent-definitions.ts`, 정의가 거절되면 필수 칸을 `operators.ts`·`agent-values.ts`에서 확인한다)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), 본보기 `tests/e2e/file-write_test.ts`
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`, `tests/support/fake-server/mod.ts`(위 목록 그대로), `appCreate`·`appConnectSource`(`packages/protocol/apps/mod.ts`), `operatorCreate`·`toolCallList`(`packages/protocol/lophn-agent/mod.ts`), `session-rows`가 만든 `tests/e2e/session_test.ts`의 core 띄우기와 helper
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `tests/e2e/session_test.ts`가 main에 있어야 한다(`session-rows`가 land한 뒤). 없으면 시작하지 말고 보고한다. 있으면 그 file의 core 띄우기·`t.step`·helper를 그대로 쓰고 행만 더한다.
2. 행 표. 앱 행의 준비: `appCreate`(slug 예 `scope-app`) → source 폴더 `run.work/app-src`를 만들고 `main.ts`에 `export const v = 1;`를 쓴다 → `appConnectSource`(compare `{base_revision: app.revision}`) → 연결하면 runtime의 폴더 권한 합이 바뀌어 child가 다시 뜨므로 앞서 `runtimePids`로 옛 pid를 모으고 뒤에 `settle(core, 옛 pid)` → `operatorCreate`(place app, definition `{name: "reviewer"}`).

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `lophn-reads-not-writes` | project 폴더 `proj/notes.md`(내용 `alpha`)를 `openProject`로 등록 → `openSession(lophn)` → `say` → `waitTurnEnd` | ① tool 둘 `file_read {path: <절대 경로 proj/notes.md>}`, `file_write {path: <절대 경로 proj/new.md>, content: "x"}` ② text | fake: 첫 요청의 tools 이름에 `file_read`는 있고 `file_write`·`file_edit`·`shell_run`은 없으며, 둘째 요청의 `file_read` tool_result에 `alpha`가 있다 / ledger: `toolCallList`에서 `file_read`는 `success`이고 `file_write`는 `{kind: "failure", code: "not_found"}`다 / disk: `proj/new.md`가 없다 | 후보 `lophn-reads-not-writes`, place-session 41행("lophn은 기획하고 call로 맡기며 직접 쓰지 않는다") |
| `app-operator-reads-not-writes` | 앱 준비 → `openSession(operator)`(`{role: "operator", agent: <agt id>}`) → `say` → `waitTurnEnd` | ① tool 둘 `file_read {path: <절대 경로 app-src/main.ts>}`, `file_write {path: <절대 경로 app-src/main.ts>, content: "changed"}` ② text | fake: 둘째 요청의 `file_read` tool_result에 `export const v = 1;`이 있다 / ledger: `file_read`는 `success`, `file_write`는 `{kind: "failure", code: "forbidden"}`다 / disk: `app-src/main.ts`가 그대로다 | 같은 후보의 앱 Operator 쪽. runtime child의 Deno 권한 합에는 앱 source 쓰기가 들어 있다(App Engineer가 써야 해서) 그래서 막는 것은 file tool의 scope 한 겹이다. 깨지면 Operator가 앱 source를 고친다 |

   - `file_write`의 실패 code가 위와 다르면(예 Deno `NotCapable`로 닫힘) 실제 값을 쓰지 말고 보고한다. 제품 bug 후보다(scope가 먼저 막아야 한다). `file-write_test.ts`의 forbidden 행과 같은 모양이다.
   - lophn의 `file_write` 행에서 "tool 목록에 없음"의 code는 `tool-batch.ts`가 `not_found`로 닫는 것을 코드로 읽은 값이다. 실제로 돌려 다르면 보고하고, 단정은 "success가 아님"까지만 넓힌다.
3. 이 task가 project의 Operator(읽기와 쓰기 모두 가능)를 보지 않는 것은 `file-write-rows`의 scope 행과 겹치기 때문이다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `agent-tools`(file tool의 scope는 role·place에서 나온다. lophn은 읽기만, 앱 Operator는 source 읽기만), `agent-roles`(lophn의 tool 목록에 쓰기 tool이 없다).
- 현실적 회귀: lophn의 tool 목록에 `file.write`·`shell.run`이 섞여 들어오는 것(role 표 변경), 앱 place Operator의 scope가 `write: []`에서 source로 넓어지는 것(runtime의 Deno 권한은 이미 쓰기를 허락하고 있어 아무도 막지 않는다).
- 왜 지금 test가 못 잡나: `placeScope`와 tool 목록은 unit이 값만 본다. 같은 규칙이 runtime child의 Deno 권한 합과 어긋나도(권한은 넓고 scope가 좁다) child 안에서 실제로 쓰기를 시도해 봐야 막힘이 보인다. process를 건너야 한다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/session_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/session_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "lophn은 project 폴더를 읽기만 하고 앱 place의 Operator는 앱 source를 읽기만 한다. 쓰기는 막힌다"

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
