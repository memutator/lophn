# harness-wire-idle

model 호출 하나가 120초 동안 byte를 하나도 받지 못하면 그 호출을 끊고 `temporary` 실패로 돌려주는 idle timeout을 `providers/invoke.ts`에 넣는다(의심 C). 시간은 주입 가능한 timer로 다뤄 test가 실제로 기다리지 않는다.

- 단위: harness-wire (wave 2)
- 선행: harness-wire
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/providers/invoke.ts`
  - `packages/core/lophn-agent/models/{resolve,binding}.ts`
  - `packages/core/lophn-agent/providers/work.ts`
  - `packages/core/lophn-agent/run-loop/core-ports.ts`
  - `packages/core/lophn-agent/session/compactor.ts`
  - `tests/harness/wire/idle_test.ts`
- 읽을 것:
  - `project-docs/plan/testing/README.md`의 "정한 것" 5
  - `project-docs/products/roadmap/testing.md`("harness loop" 표의 무응답 행, "정할 것" 5)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `models`, `run-loop`(loop는 이 결과를 `temporary`로만 본다)
  - `packages/core/lophn-agent/providers/invoke.ts`(`createInvokeModelCall`, `abortOutcome`), `providers/adapters/transport.ts`(`createFetchTransport`), `models/resolve.ts`(`createModelResolver`의 `timeoutMs`), `run-loop/core-ports.ts`(`timeoutMs`가 `ModelCallInput`으로 가는 곳), `run-loop/limits.ts`(`stall_ms`)
  - 앞 task가 만든 `tests/support/wire/`(`replayFetch`, `wireBinding`, `callWire`)
- 계약:
  - 쓰는 것: `InvokeDeps`(`providers/invoke.ts`), `ModelResolverDeps`(`models/resolve.ts`), `replayFetch`·`wireBinding`·`callWire`(`tests/support/wire/`).
  - 내놓는 것: `providers/invoke.ts`의 `MODEL_IDLE_MS = 120_000`(export). `InvokeDeps.idle?: { ms?: number; timer?: (ms: number, signal: AbortSignal) => Promise<"elapsed" | "aborted"> }`, `createModelResolver`의 deps에 같은 `idle?`. 없으면 `ms`는 `MODEL_IDLE_MS`, `timer`는 `setTimeout` 기반(signal이 중단되면 `clearTimeout`하고 `"aborted"`).

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

- 위치는 `providers/invoke.ts`다(README 초안은 harness-loop였다). 이유: 호출당 idle은 "그 호출이 byte를 받는가"의 문제이고 byte를 받는 곳은 `invoke.ts`다. loop(`turn.ts`)는 호출이 끝나서 돌아온 결과만 본다. `run-loop/limits.ts`의 `stall_ms`(300초, complete가 와야 되돌아감)는 그대로 둔다. 그 위에 호출 하나의 idle이 더 짧게 끊는다.
- 시작은 `transport.send` 전이다. 끝은 호출이 끝날 때까지다. 기한을 새로 거는 때: 처음(fetch를 부르기 직전), 그리고 stream에서 `reader.read()`가 값을 줄 때마다(`: ping` 주석, `event: ping`, 어떤 byte든). 응답 header만 오고 body가 안 오는 경우도 같은 기한이다.
- 기한이 차면 호출의 abort signal에 합쳐 끊는다(사람 취소 signal과 따로 만든 controller). 끊긴 호출의 결과는 **받은 글이 있어도** `failed`/`temporary`(`retry_at` null, `http_status` null)다. 지금 `abortOutcome`은 기한이 지나 끊긴 호출을 글이 있으면 partial로 돌려준다. idle은 그 길로 가지 않는다(README "정한 것" 5: 첫 byte 전과 stream 중간 모두 temporary로 retry). 사람이 멈춘 abort는 지금처럼 `cancelled`다.
- 기존 `timeoutMs`(호출 전체 기한)는 지운다. 제품이 늘 `null`로 넘기는 죽은 인자이고, 호출 하나의 기한은 이제 idle 하나가 맡는다(AGENTS.md "죽은 코드는 지운다"). 길: `models/resolve.ts`의 `ModelResolverDeps.timeoutMs` → `models/binding.ts`의 `timeoutMs` → `run-loop/core-ports.ts`, `session/compactor.ts` → `providers/work.ts`의 `timeoutMs` → `providers/invoke.ts`의 `AbortSignal.timeout`과 `abortOutcome`의 기한 가지. (planner)
- 값 120초는 README "정한 것" 5의 추천값이다. 제품 동작이라 사람이 바꿀 수 있다. 설정 key로 열지 않는다(상수).
- timer는 호출이 끝나면 반드시 정리한다(`clearTimeout`). 안 지우면 Deno의 sanitizer가 test를 실패시킨다. sanitizer를 끄지 않는다.

## 할 일

1. `providers/invoke.ts`: 위 "정한 것"대로 idle 기한을 넣는다. `idle.timer`를 기한마다 새로 부르고(이전 기한은 그 timer의 signal을 abort해 접는다) `"elapsed"`가 오면 idle controller를 abort한다. fired 여부를 기억해 결과를 `temporary`로 만든다. 근거: `models` boundary, README "정한 것" 5.
2. `models/resolve.ts`: `ModelResolverDeps`에 `idle?`를 더해 `createInvokeModelCall({..., idle})`로 넘긴다.
2a. `timeoutMs`를 위 "정한 것"의 길을 따라 모두 지운다. `grep -rn timeoutMs packages/core/lophn-agent/{providers,models,run-loop,session}`이 이 기한과 상관없는 것(`run-loop/redact-link.ts` 등)만 남긴다.
3. `tests/harness/wire/idle_test.ts`에 table을 쓴다. 시간은 `idle.timer`를 직접 꽂아 다룬다: 기한마다 부른 `(ms, signal)`을 기록하고 test가 마지막(살아 있는) 기한을 `fire()`로 푼다. `replayFetch`의 stream은 test가 chunk를 한 덩이씩 밀어 넣을 수 있어야 한다(필요하면 `tests/support/wire/`에 그 도우미를 더하지 말고 이 test file 안에 둔다. 그 폴더는 앞 task의 소유다).

| 행 | replay가 내는 것 | 기대(바깥 결과) |
|---|---|---|
| header 전 무응답 | `fetch`가 풀리지 않는다(abort되면 reject) | 기한 1개가 `MODEL_IDLE_MS`로 걸렸다. `fire()` 뒤 `outcome`이 failed/`temporary`, `retry_at` null. `fetch`가 받은 signal이 aborted |
| stream 중간 멈춤 | anthropic `text-end_turn` 앞부분 chunk 몇 개를 주고 더는 안 준다 | `fire()` 뒤 `outcome`이 failed/`temporary`(partial이 아니다). 받은 글이 있어도 같다 |
| ping만 계속 | chunk마다 `: ping` 주석 event를 주고 마지막에 `text-end_turn`의 나머지를 준다 | chunk 수 + 1번 기한이 걸렸고(매번 이전 기한이 접혔다) `fire()`를 안 눌러도 `outcome`이 complete. 접힌 옛 기한을 `fire()`해도 영향이 없다 |
| 사람 취소 | idle이 차기 전에 호출자의 signal을 abort | `outcome`이 cancelled(temporary가 아니다) |
| 기본 값 | `idle` deps를 안 준 binding | 걸린 첫 기한이 120000ms다 (기본 timer를 쓰는 행이므로 `fetch`를 즉시 끝나게 하고 timer는 호출이 끝날 때 정리되는 것만 본다) |

   각 행의 fake 대답은 1개, 단정은 3개 이하다.
4. 의심 C의 "고치기 전 실패 확인": 첫 두 행을 `invoke.ts`를 고치기 전에 돌려 실패하는 것을 확인하고(`MODEL_IDLE_MS`가 없어 컴파일이 안 되면 그 출력을 적고, 이름만 임시로 둔 채 돌려 값 단정이 실패하는 것을 적는다) 보고에 적는다.
5. test 머리 주석에 세 질문의 답을 한 줄씩 남긴다.

## 세 질문

- contract: boundary ID `models`(호출 하나의 실패 분류). loop 쪽 `run-loop`의 retry 규칙과 맞물린다.
- 현실적 회귀: reasoning model이 첫 글 전에 길게 생각하는 동안 provider가 아무것도 안 보내거나 연결이 반쯤 죽었을 때 turn이 `stall_ms` 300초를 다 기다리는 것. 반대로 ping은 오는데 끊어 버리는 것.
- 왜 지금 test로 못 잡나: 제품에 호출당 timeout이 없고(`timeoutMs`가 늘 null) adapter·invoke에 test가 없다.

## 끝남

- `deno task check`가 통과한다.
- `deno fmt --check tests`, `deno lint tests`, `deno check <내가 만든 tests/ file>`이 통과한다(이 worktree에 test-tasks가 아직 없으면 fast check는 `tests/`를 보지 않는다. 그래서 직접 돌린다).
- `deno test --no-check --allow-all tests/harness/wire`가 통과한다(앞 task의 table도 그대로 초록).
- 의심 C: 위 4번을 확인했다.
- 위험 test: "byte가 120초 오지 않으면 그 호출이 끊겨 temporary로 돌아오고, ping이 오는 동안은 끊기지 않는다"
- 남지 않음: 테스트가 끝난 뒤 timer가 남지 않는다(sanitizer 통과, 끄지 않았다).

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

