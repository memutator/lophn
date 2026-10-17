# e2e-secret

API key로 provider를 연결하면 key가 model 요청 header에만 실리고, data root의 `secrets.json`을 뺀 나머지(ledger, log, event·route 출력)에는 남지 않는 것을 core 전체로 본다.

- 단위: e2e (wave 2)
- 선행: e2e-support-server, e2e-support-core
- 소유(이 task만 고친다):
  - `tests/e2e/secret_test.ts`
- 읽을 것:
  - `project-docs/products/roadmap/testing.md`("core E2E 후보" 6번)
  - `project-docs/plan/testing/research/facts-main.md` 4절(provider 연결: `secrets/put` → `providers/connect`), 11절(secret: `secrets.json` 0600, known registry, redaction, 값이 ledger·log에 안 남는 장치)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `secrets`, `models`, `supervision`
  - 코드: `packages/core/secrets/{file-store,file-attach,routes}.ts`, `packages/core/lophn-agent/run-loop/runtime-secret.ts`(감독 pipe `secret_send_request`), `packages/core/lophn-agent/providers/adapters/auth-transport.ts`(header를 붙이는 한 자리), `packages/protocol/secrets/secret-file.ts`
  - 앞 task가 만든 `tests/support/fake-server/`, `tests/support/core/`(`Core.upload`, `connectFakeProvider`의 `key` 옵션, `Core.logPath`)와 그 brief
- 계약:
  - 쓰는 것: fake-server(`journal`), core support(`createRun`, `bootCore`, `connectFakeProvider(core, fake, {key})`, `openSession`, `say`, `waitTurnEnd`), route `secrets/status`, `providers/read`, `providers/list`, `model-calls/list`, `messages/list`, `tool-calls/list`.
  - 내놓는 것: 없음(test만).

## 지켜야 할 것(계획 공통)

- `~/.lophn`, OS keychain, 사람의 전역 harness 설정을 건드리지 않는다. E2E data root는 `.dev-data/e2e/<run>/home`뿐이다.
- 진짜 model provider는 `deno task test:live`에서만, 사람이 key를 줄 때만 부른다. worker와 lead는 live를 돌리지 않는다(key 없는 실행으로 gate만 확인한다).
- 전역 mutable 상태를 두지 않는다. 고정 port와 고정 path를 쓰지 않는다. 병렬로 돌아야 한다. sanitizer를 끄지 않는다. sleep으로 기다리지 않는다(gate, 가짜 clock, 신호).
- `tests/support`에는 띄우기와 연결만 둔다. flow의 단계는 test file에 그대로 쓴다. 공통 불변식은 함수 하나로 둔다.
- case 하나는 단계 6, fake 대답 3, 단정 3 이하다. 화면 문구는 단정하지 않는다.
- 의심 A~D를 고칠 때는 먼저 그 행이 고치기 전 코드에서 실패하는 것을 확인하고 보고에 적는다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다.

## 정한 것

- 이 계획은 main checkout에서 따로 도는 `PLAN-remove-keychain.md`(MCP secret을 `secrets.json`으로 옮김)와 같은 file을 안 건드리지만, 그 계획이 land한 뒤 rebase하면 secret route 이름·file 모양이 바뀌었을 수 있다. 이 flow는 provider key만 본다. rebase 때 `secrets/put`·`providers/connect`·`secrets.json` 이름을 코드로 다시 확인한다.
- key는 test가 만든 문자열(`sk-e2e-` + `createIdSource`로 만든 id의 꼬리)이다. 진짜 key가 아니다. role은 `lophn`이다(place가 없어 project 폴더도 필요 없다).
- `connectFakeProvider(core, fake, {key})`는 loopback http endpoint에 `auth_kind: "api_key"`로 연결한다. `providers/connect`가 이 조합(loopback + api_key)을 받는지는 `e2e-support-core`가 코드로 확인했을 것이다. 거절되면 고치지 말고 "계약 바꾸기 요청"에 적는다(이 flow가 loopback을 쓰는 것은 제품에 test 전용 길을 더하지 않는다는 README "정한 것" 11과 같은 뜻이다: 정의는 사람이 `providers/connect`로 직접 주는 custom provider다).
- 흔적을 찾는 곳은 세 군데다: (1) `run.home` 아래 모든 file(`lophn.db`와 `-wal`/`-shm`, `logs/`, `derived/` 포함) 중 `secrets.json`을 뺀 것과 `run.dir/core.log` — byte로 `key`가 들어 있는지, (2) route 출력(JSON 글로 만들어 찾는다), (3) fake가 받은 요청 본문.

## 할 일

1. 준비: `createRun` → `startFakeServer` → `bootCore` → `connectFakeProvider(core, fake, {key})` → `openSession(lophn)`.
2. fake 대답(1개): `{kind:"text", text:"ok"}`. `say` → `waitTurnEnd`.
3. 단정(3개, 서로 다른 곳):
   - fake가 받은 요청: `journal()[0].headers["x-api-key"]`가 `key`이고, 같은 요청의 본문(`JSON.stringify(body)`)과 다른 header에는 `key`가 없다.
   - disk: `secrets.json`은 `key`를 담고(양성 대조) mode가 0600이다. 그 밖에 `run.home`의 모든 file과 `core.log`에는 `key`가 byte로 없다.
   - route 출력: `providers/read`, `providers/list`, `model-calls/list`, `messages/list`, `tool-calls/list`, `secrets/status`의 결과를 글로 만들어 보면 `key`가 없다(`secrets/status`는 이름과 설정 여부만 담는다).
4. test 머리 주석에 세 질문의 답을 한 줄씩 남긴다.

## 세 질문

- contract: boundary ID `secrets`(값은 `secrets.json`에만 있고 전송 직전에만 붙는다), `models`(`ModelCall` 기록에는 header·credential이 없다).
- 현실적 회귀: transport나 log 수정이 header 값을 기록에 흘리는 것, 새 route 출력에 secret 이름 옆 값이 붙는 것, 알려진 값 registry가 준비되기 전에 값을 child로 주는 것.
- 왜 지금 test로 못 잡나: `file-store_test.ts`·`product-redactor_test.ts` 등은 저장·가림 함수만 본다. key가 child process에서 실제 HTTP header로 나가는 길과 그 뒤 ledger·log에 남은 것은 process를 건너고 disk 전체를 봐야 알 수 있다.

## 끝남

- `deno task check`가 통과한다.
- `deno fmt --check tests`, `deno lint tests`, `deno check <내가 만든 tests/ file>`이 통과한다(이 worktree에 test-tasks가 아직 없으면 fast check는 `tests/`를 보지 않는다. 그래서 직접 돌린다).
- `deno test --allow-all --no-check tests/e2e/secret_test.ts`를 **10번 연속** 통과한다(결과를 보고에 적는다). 끝난 뒤 `.dev-data/e2e/`가 비어 있다.
- 위험 test: "provider key는 model 요청 header에만 있고 secrets.json 밖의 어디에도 남지 않는다"
- 남지 않음: `grep -rn "sk-ant-\|sk-proj-" tests/e2e/secret_test.ts`가 0줄이다(진짜 key 꼴을 쓰지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"

