# e2e-support-server

core E2E와 `deno task dev`가 provider 자리에 쓰는 fake server를 `tests/support/fake-server/`에 새로 만든다(loopback, port 0, 응답 7종, 받은 요청 journal, 기대와 다른 요청에는 차이를 담은 HTTP 오류). 한 protocol(anthropic-messages)만 말한다.

- 단위: e2e-support (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/support/fake-server/`
- 읽을 것:
  - `project-docs/products/roadmap/testing.md`("fake 셋"의 fake server, "case 고르는 규칙" 9)
  - `project-docs/plan/testing/research/research-hermes.md`(fake server의 응답 종류와 main/aux 분리. 우리는 aux가 없다), `research-cli.md`(Goose의 "기대와 다른 요청에 차이를 담은 HTTP 오류")
  - `packages/core/lophn-agent/providers/adapters/{messages,stream}.ts`(Anthropic SSE event 이름과 모양을 읽는 쪽. server는 이 parser가 읽는 event만 낸다), `providers/invoke.ts`(요청을 보내는 쪽: path `/messages`, 본문 `stream: true`, header `x-api-key`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `models`
- **`tools/fake-provider/`는 열지 않는다.** 옮기지 않고 새로 만든다(clean room, README "정한 것" 8). 그 file들은 dev-fake task가 지운다.
- 계약:
  - 쓰는 것: 없음(`Deno.serve`와 표준 API만). adapter parser는 읽기만 하고 import하지 않는다.
  - 내놓는 것(아래 모양. 이름은 `e2e-support-core`, `e2e-support-shape`, `e2e-*`, `dev-fake`가 이대로 부른다. 바꾸면 보고의 "계약 바꾸기 요청"에 적고 lead가 다른 brief를 고친다):

```ts
// tests/support/fake-server/mod.ts
startFakeServer(options?: { fallback?: Reply }): Promise<FakeServer>

type FakeServer = {
  url: string;                          // "http://127.0.0.1:<port>" (providers/connect의 endpoint)
  script(steps: readonly Step[]): void; // 이 test의 queue. 앞에 있던 queue를 대체한다
  reset(): void;                        // queue와 journal을 비운다. test마다 부른다
  journal(): readonly JournalEntry[];   // 받은 요청 전부. 실패한 것(차이 오류)도 든다
  arrived(n: number): Promise<JournalEntry>; // n번째(1부터) 요청이 들어온 때 풀린다
  aborted(n: number): Promise<void>;    // n번째 요청의 연결을 client가 끊은 때 풀린다
  handle(request: Request): Promise<Response>; // Deno.serve가 부르는 함수. socket 없이 직접 부를 수 있다
  close(): Promise<void>;
};

type Step = { reply: Reply; expect?: (request: JournalEntry) => string | null };
// expect가 문자열을 돌려주면 그것이 "차이 설명"이다. null이면 기대대로다.

type Reply =
  | { kind: "text"; text: string; usage?: { input: number; output: number } }
  | { kind: "tool"; calls: { id: string; name: string; arguments: string }[]; text?: string }
  | { kind: "error"; status: number; headers?: Record<string, string>; body?: string }
  | { kind: "silent" }                       // 연결을 열고 아무 byte도 안 준다. client가 끊을 때까지
  | { kind: "cut"; partial: Partial }        // 일부 event 뒤 message_stop 없이 연결을 닫는다
  | { kind: "stall"; partial: Partial }      // 일부 event 뒤 더는 안 주고 client가 끊을 때까지 둔다
  | { kind: "raw"; status: number; headers: Record<string, string>; chunks: string[]; end?: "close" | "hold" };
type Partial = { text: string } | { tool: { id: string; name: string; arguments: string } };
// tool partial은 arguments의 앞 절반만 보낸다(JSON이 끝나지 않는다).

type JournalEntry = {
  n: number;                       // 1부터
  method: string; path: string;
  headers: Record<string, string>; // 받은 그대로(소문자 이름). x-api-key도 든다
  body: unknown;                   // JSON이면 파싱한 값, 아니면 원문 글
  step: number | null;             // 쓴 step 번호(0부터). 못 쓰면 null
  mismatch: string | null;         // 차이 오류로 답했으면 그 설명
};
```

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

- 한 protocol(anthropic-messages)만 말한다. path는 `/messages`다. 이유: core E2E는 protocol 판정이 아니라 process 경계를 건너는 flow를 본다. protocol 판정은 harness wire가 맡는다. 다른 protocol이 필요해지면 더한다. "provider마다 따로 만드는 fake server"(roadmap "하지 않는 것")가 아니라 한 server에 protocol 하나다.
- 기대와 다른 요청(`expect`가 문자열을 돌려줌)과 queue가 빈 요청(`fallback`이 없을 때)은 **HTTP 400**에 Anthropic 오류 모양 본문 `{"type":"error","error":{"type":"invalid_request_error","message":"<차이 설명>"}}`으로 답한다. 이유: 500 계열은 제품이 `temporary`로 보고 retry해 test가 헷갈린다. 400은 `invalid_request`로 바로 turn이 실패한다. 설명은 journal에도 남는다.
- `fallback`은 queue가 비었을 때 낼 `Reply`다. `deno task dev`가 queue 없이 늘 같은 대답을 내려고 쓴다(`dev-fake`). test는 쓰지 않는다.
- 응답 stream의 event 종류와 순서는 Anthropic Messages 실제 stream(`message_start` → `content_block_start` → `content_block_delta` → `content_block_stop` → `message_delta`(stop_reason, usage) → `message_stop`)이다. text 응답의 stop_reason은 `end_turn`, tool 응답은 `tool_use`다. 같은 모양인지는 뒤의 `e2e-support-shape`가 fixture와 견준다. 이 task는 위 순서를 `providers/adapters/messages.ts`의 `applyFrames`가 complete로 판정하는 것까지 직접 확인한다.
- port는 `Deno.serve({hostname: "127.0.0.1", port: 0})`다. 고정 port를 쓰지 않는다. `close()`는 열린 연결(`silent`, `stall`)도 끊고 기다린다.
- 같은 server는 suite당 하나(file당 `startFakeServer` 한 번)이고 test마다 `reset()`한다. queue는 하나다(session별 queue는 다음 계획).

## 할 일

1. `tests/support/fake-server/`에 위 모양으로 만든다. file은 작게 나눈다: `mod.ts`(서버와 journal), `reply.ts`(`Reply` → `Response`, 특히 SSE event 만들기), `types.ts`. 근거: roadmap "fake 셋"의 fake server 항목, "지켜야 할 것"(support는 띄우기와 연결만).
2. 요청 처리: 요청을 받으면 journal에 넣는다(본문은 JSON 파싱, 실패하면 원문). 다음 step을 꺼내 `expect`를 불러 보고, 차이가 있으면 400을 준다. 없으면 `Reply`를 낸다. `request.signal`의 abort를 보고 `aborted(n)`을 푼다(`silent`·`stall`·`cut` 도중과 응답이 끝난 뒤 모두).
3. 응답 7종: `text`, `tool`(인자 문자열 그대로), `error`(status, header, 본문), `silent`, `cut`, `stall`, `raw`. 각각이 client에 어떻게 보이는지 아래 단정으로 확인한다.
4. 자기 점검용 test 하나 `tests/support/fake-server/server_test.ts`(socket 없이 `handle(new Request(...))`로 부른다. 새 server 띄우는 test를 더 만들지 않는다):
   - `text` 응답 stream을 실제 adapter parser(`createSseParser` + `applyFrames` + `judge`, `providers/adapters/{stream,messages}.ts`)로 읽으면 complete, 글이 같다.
   - `tool` 응답이 complete이고 tool 인자가 보낸 문자열 그대로다.
   - `cut` 응답은 partial 판정이다. 그리고 queue가 비었을 때 400 + journal의 `mismatch`가 채워진다.
   (이 test는 harness와 같이 check에 든다. `tests/support`가 `test-tasks`에서 check에 든다. 단정 3개.)
5. test 머리 주석에 세 질문의 답을 한 줄씩 남긴다.

## 세 질문

- contract: boundary ID `models`(제품이 provider에 보내는 요청과 받는 stream 모양). 이 fake가 실제 모양과 어긋나면 core E2E가 헛걸음이다.
- 현실적 회귀: fake가 adapter가 읽는 event와 어긋나 E2E가 애매한 이유로 실패하는 것, journal이 비어 있어 "model 요청이 안 갔다"를 못 잡는 것.
- 왜 지금 test로 못 잡나: 지금 쓰이는 fake가 없다(`tools/fake-provider/`는 test도 쓰는 곳도 없다). 이 server가 만들어진 뒤에야 위 단정이 가능하다.

## 끝남

- `deno task check`가 통과한다.
- `deno fmt --check tests`, `deno lint tests`, `deno check <내가 만든 tests/ file>`이 통과한다(이 worktree에 test-tasks가 아직 없으면 fast check는 `tests/`를 보지 않는다. 그래서 직접 돌린다).
- `deno test --no-check --allow-all tests/support/fake-server`가 통과한다.
- 위험 test: 없음(support의 자기 점검 하나. 제품의 위험 규칙을 지키는 test가 아니다)
- 남지 않음: `grep -rn "fake-provider" tests`가 0줄이다.

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

