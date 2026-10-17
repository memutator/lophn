# e2e-support-shape

fake server가 내는 SSE의 event 종류와 순서가 녹화·손 fixture(실제 Anthropic stream 모양)와 같은지 보는 unit test 하나를 `tests/support/fake-server/`에 더한다. E2E가 fake의 모양이 어긋나서 애매하게 실패하는 일을 막는다.

- 단위: e2e-support (wave 2)
- 선행: e2e-support-server, harness-wire
- 소유(이 task만 고친다):
  - `tests/support/fake-server/shape_test.ts`
- 읽을 것:
  - `project-docs/products/roadmap/testing.md`("fake 셋"의 마지막 항목: "응답의 꼴이 녹화 fixture와 같은 event 종류를 내는지 unit 하나로 본다")
  - `tests/support/fake-server/`(앞 task가 만든 server. `handle(request)`와 `startFakeServer` 모양), `tests/fixtures/provider/anthropic/`(harness-wire가 만든 fixture)와 `tests/support/wire/`의 `loadFixture`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `models`
- 계약:
  - 쓰는 것: `startFakeServer`·`FakeServer.handle`·`Reply`(`tests/support/fake-server/`), `loadFixture`(`tests/support/wire/`), fixture `anthropic/text-end_turn`, `anthropic/tool-use`, `anthropic/max-tokens`, `anthropic/cut-no-stop`.
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

- 견주는 것은 SSE의 **event 종류의 순서**(`event:` 이름을 중복 없이 처음 나온 순서로 뽑은 목록)와, 각 event의 `data` JSON이 가진 `type` 값이다. 글자 내용과 id, token 수는 견주지 않는다.
- 견주는 쌍: `text` 응답 ↔ `anthropic/text-end_turn`, `tool` 응답 ↔ `anthropic/tool-use`, `cut` 응답(text partial) ↔ `anthropic/cut-no-stop`의 event 종류. `max-tokens`는 server가 낼 응답 종류에 없으므로 견주지 않는다(`raw`로 낼 수 있는지만 본다: `raw` 응답으로 `max-tokens` fixture의 본문을 그대로 내면 `handle`이 그 본문을 byte 그대로 돌려준다).
- 지금 fixture는 harness-wire가 손으로 만든 것이라 "실제 모양"의 근거가 약하다. 사람이 `deno task test:live`로 녹화한 응답을 commit해 같은 이름으로 대체하면 이 test가 진짜 값을 갖는다(live-suite가 같은 저장 꼴을 쓴다). 그 사실을 보고의 "알려진 미완 동작"에 적는다.
- 어긋나면 fake server를 고친다(이 task의 소유가 아니므로 "넘길 줄"에 적고 lead가 `e2e-support-server`를 다시 연다). fixture를 fake에 맞춰 고치지 않는다.

## 할 일

1. `tests/support/fake-server/shape_test.ts`: socket 없이 `handle(new Request("http://x/messages", {method:"POST", body: ...}))`로 `text`, `tool`, `cut`, `raw`를 낸다. SSE 본문을 글로 받아 event 종류 목록을 뽑는 함수를 이 file 안에 둔다(support에 올리지 않는다).
2. 위 쌍을 표 한 줄씩 견준다. 단정은 행마다 (a) event 종류 목록이 같다 (b) `data.type` 집합이 같다. 둘 다 fixture를 기준으로 한다.
3. test 머리 주석에 세 질문의 답을 한 줄씩 남긴다.

## 세 질문

- contract: boundary ID `models`(provider가 보내는 stream의 모양). fake와 실제의 일치가 E2E 판정의 전제다.
- 현실적 회귀: fake server를 고치다가 adapter가 읽는 event를 빼먹어 complete가 partial로 판정되는 것.
- 왜 지금 test로 못 잡나: 앞 task의 자기 점검은 "adapter가 complete로 읽는다"까지만 본다. 실제 stream과 같은 종류인지(예: 실제는 `ping`을 보내고 `message_delta`에 usage가 든다)는 fixture와 견주지 않으면 모른다.

## 끝남

- `deno task check`가 통과한다.
- `deno fmt --check tests`, `deno lint tests`, `deno check <내가 만든 tests/ file>`이 통과한다(이 worktree에 test-tasks가 아직 없으면 fast check는 `tests/`를 보지 않는다. 그래서 직접 돌린다).
- `deno test --no-check --allow-all tests/support/fake-server`가 통과한다.
- 위험 test: 없음(support 점검 하나. 제품의 위험 규칙을 지키는 test가 아니다)

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

