# secret-rows

`tests/e2e/secret_test.ts`에 행 넷을 더한다: key가 file·shell 출력에 들어 있어도 model 요청과 ledger에서 지워진다, key를 바꾸면 다음 turn은 새 key를 쓰고 옛 key는 어디에도 없다, key를 지우면 다음 turn은 요청을 안 보낸다, provider 오류 본문이 key를 되울려도 ledger·log에 안 남는다.

- 단위: secret-rows (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/secret_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/run-loop/runtime-redaction.ts`
  - `packages/core/lophn-agent/run-loop/runtime-secret.ts`
  - `packages/core/lophn-agent/run-loop/blobs.ts`
  - `packages/core/secrets/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-invariants.md` 후보 11, 12; `candidates-bugs.md` 후보 `secret-redaction-in-content`, `secret-rotate-delete`; `candidates-product.md` 후보 `secret-tool-result`, `secret-provider-error`
  - architecture: `project-docs/architecture/agent-definition.md`("provider API key는 ... 값은 ledger, event, log, 오류, model 입력에 없다", "shell은 환경 변수 허용 목록만 넘긴다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `secrets`, `models`, `agent-tools`, `run-loop`
  - 코드: `packages/core/lophn-agent/run-loop/{runtime-redaction,runtime-secret,blobs}.ts`, `packages/core/secrets/`, `packages/protocol/secrets/secret-file.ts`(`secretDelete`, `secretStatus`, `SECRET_FILE_NAME`), `packages/core/lophn-agent/tools/shell/env.ts`, `project-docs/plan/testing/research/facts-main.md` 11절
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
  - `PLAN-remove-keychain`이 land했다면 secret 이름과 route를 다시 확인한다(README "돌리기 전에").
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), 이 file의 `filesWith(dir, key)`(secrets.json을 뺀 모든 file에서 key를 찾는다)와 route 출력 모음, `secretDelete`·`SECRET_FILE_NAME`(`packages/protocol/secrets/mod.ts`), `Core.upload(name, bytes)`(secrets/put).
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `tests/e2e/secret_test.ts`가 main에 있어야 한다(계획 `testing`의 `e2e-secret`가 land한 뒤). 없으면 시작하지 말고 보고한다. 이 brief의 "지금 모양"은 branch `e2e/e2e-secret`에서 본 것이므로 main의 file을 먼저 읽고 어긋나면 main을 따른다. 이 file은 merged라 main에 있다. 지금 한 `Deno.test`의 단계(연결 → turn → header 확인 → route 출력 → `stop()` → disk scan)를 file 안 helper 하나(`withKeyedCore`)로 빼고 행마다 `Deno.test`를 하나씩 둔다. 지금 test의 단정은 바꾸지 않는다.
2. 행 표. key는 행마다 `core.ids`에서 만든 임의 값이다(`sk-e2e-...`). 모든 행의 마지막 단정은 `await core.stop()` 뒤 `filesWith(run.dir, key)`가 빈 배열이다(core.log 포함).

| 행 | 준비 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|---|
| `key-in-content` | `connectFakeProvider(key)`, project 폴더에 `.env`(`API_KEY=<key>`) 둠, `openProject`, `openSession(PM)` | `say` → `waitTurnEnd` → route 출력 모음 | ① tool `file_read {path: ".env"}` + `shell_run {command: "cat <home>/secrets.json; env"}` ② text | fake: 둘째 요청 본문 전체에 key가 없고(첫 요청 header에는 있다) `LOPHN_` 접두 환경 변수 이름도, user token(`core.token`) 값도 없다(shell은 환경 변수 허용 목록만 넘긴다) / ledger: `toolCallList`·`modelCallList`·`receivedMessageList`·tool 결과 blob(`turn-body` read)에 key가 없다 / disk: `secrets.json`을 뺀 `run.dir` 전체에 key가 없다 | 후보 11. redaction 한 겹이 유일한 방어(README 정한 것 7) |
| `key-rotated` | `connectFakeProvider(K1)` | `say` → `waitTurnEnd` → `core.upload("provider.<provider id의 pvd_ 뒤>", K2)` → `say` → `waitTurnEnd` | ① text ② text | fake: 첫 요청 `x-api-key`가 K1, 둘째가 K2 / disk: `secrets.json`에 K2만 있고 `secrets.json` 밖 어디에도 K1·K2가 없다 / ledger: `providerRead`·`modelCallList` 출력에 둘 다 없다 | `secret-rotate-delete`. secret 길을 이번 판에 세 번 갈아엎었다 |
| `key-deleted` | `connectFakeProvider(K1)` | `say` → `waitTurnEnd` → `core.call(secretDelete, {name})` → `say` → `waitTurnEnd` | ① text (②는 오면 안 된다. 일부러 두지 않는다) | fake: journal이 1개로 그대로 / ledger: 둘째 turn이 `failed`이고 이유가 credential 계열(값은 `turn-values.ts`의 failed 이유에서 읽는다) / disk: `secrets.json`에 key가 없다 | 후보 12 |
| `error-echo` | `connectFakeProvider(key)`, `openSession(lophn)` | `say` → `waitTurnEnd` → 출력 모음 | ① `{kind: "error", status: 401, body: JSON.stringify({type: "error", error: {type: "authentication_error", message: "invalid x-api-key: " + key}})}` | fake: journal이 1개(retry 없음) / ledger: turn이 `failed`이고 `modelCallList`·`agentSessionRead`·`receivedMessageList` 출력에 key가 없다 / disk: `core.log`를 포함해 `secrets.json` 밖 어디에도 key가 없다 | `secret-provider-error`. 오류 문장은 고정 문장이어야 한다 |

3. `key-in-content`에서 shell이 `secrets.json`을 읽을 수 있는 것은 그대로다(README 정한 것 7). 이 행은 "읽혀도 새지 않는다"만 단정한다.
4. 단정이 어긋나면 제품 bug다(secret이므로 가장 위험). 추가 소유 안에서 고치고 "고치기 전 코드에서 실패"를 보고에 적는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `secrets`(값은 `secrets.json`에만 있고 전송 직전에 붙으며 ledger·event·log·오류·model 입력에 없다), `models`(오류는 고정 문장), `run-loop`(child가 보낼 글을 core의 redaction 길로 지운다).
- 현실적 회귀: tool 결과나 provider 오류 본문이 key를 되울려 blob·ledger에 남는 것, 바꾼 key가 옛 key로 전송되는 것, 지운 key로 인증 없는 요청이 나가는 것, redaction 요청이 실패하는데 글을 그냥 보내는 것.
- 왜 지금 test가 못 잡나: 지금 `secret`은 key가 content로 흐르지 않는 turn 하나의 header 위치만 본다. redaction 길(child → 감독 pipe → core)과 바꾸기·지우기는 process를 건너야 하고 unit(`product-redactor_test`, `secret-refs_test`)은 함수만 본다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/secret_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/secret_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "provider key는 content·오류·교체 어느 길로도 secrets.json 밖에 남지 않고, 지운 key로는 요청이 나가지 않는다"

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
