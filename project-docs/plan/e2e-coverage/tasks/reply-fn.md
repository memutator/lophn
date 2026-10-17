# reply-fn

fake server의 대답을 앞 요청과 journal에서 계산하는 함수로 줄 수 있게 하고(core가 만든 draft·ticket·call id를 다음 tool 인자에 넣는다), 요청을 줄(lane)로 나눠 agent 둘이 동시에 model을 불러도 각자 대답을 받게 한다.

- 단위: reply-fn (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/support/fake-server/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-product.md` §0 사실 1·2, §2 묶음 G1·G2
  - `project-docs/plan/e2e-coverage/research/candidates-invariants.md` 후보 19(`agent-call-roundtrip`)
  - `project-docs/architecture/testing.md`의 "가짜 셋"과 main의 `tests/support/fake-server/`(이 server의 지금 계약)
  - main의 `tests/support/fake-server/{mod,types,reply}.ts`(지금 계약: `startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply` 7종, `JournalEntry`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/fake-server/{mod,types,reply}.ts`(지금 계약: `startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply` 7종, `JournalEntry`)와 `packages/core/lophn-agent/providers/adapters/{messages,stream}.ts`(요청 본문: Anthropic Messages. `messages[].content` block에 `tool_result {tool_use_id, content}`).
  - 내놓는 것: 아래 "내놓는 것" 절

## 내놓는 것

```ts
// tests/support/fake-server/types.ts
type ReplyFn = (request: JournalEntry, journal: readonly JournalEntry[]) => Reply;
type Step = { reply: Reply | ReplyFn; expect?: (request: JournalEntry) => string | null };
type JournalEntry = { /* 지금 칸 */ lane: string | null };   // 어느 줄이 받았나. 줄 없이 기본 줄이 받았으면 null

// FakeServer
script(steps: readonly Step[], lane?: { name: string; match: (request: JournalEntry) => boolean }): void;
// lane 없이 부르면 기본 줄의 queue를 바꾼다(지금과 같다). lane을 주면 그 name의 줄을 더하거나 그 queue를 바꾼다.
// 요청은 등록한 순서대로 match를 검사해 처음 true인 줄로 가고, 어느 줄에도 안 맞으면 기본 줄로 간다. reset()은 줄도 비운다.

// tests/support/fake-server/probe.ts   (요청 본문에서 읽는 것만. 판단은 test가 한다)
systemText(request: JournalEntry): string;                         // system 글(문자열이든 block 배열이든 이어 붙인다)
toolNames(request: JournalEntry): string[];                        // body.tools[].name
lastToolResult(request: JournalEntry, toolUseId?: string): string | undefined;   // 마지막 user message의 tool_result 내용을 글로(없으면 undefined)
lastUserText(request: JournalEntry): string;                       // 마지막 user message의 text block
idIn(text: string, prefix: "tkt" | "cal" | "cbn" | "ctx" | "app" | ...): string | undefined;   // `<prefix>_` + id 문자 26개를 처음 만난 것
```
`e2e-*` 이름과 `startFakeServer`, `Reply`, `journal()`은 그대로다. 바꾸는 것은 `Step.reply`가 함수도 받는 것, `script`의 둘째 인자, `JournalEntry.lane`, 그리고 `probe.ts`뿐이다.

## 할 일

1. `types.ts`, `mod.ts`, `reply.ts`를 위 모양으로 고친다. 함수는 응답을 만들기 직전에 부른다(그 요청이 journal에 들어간 뒤라 인자의 `journal` 마지막이 `request`다). 함수가 던지면 400 차이 오류로 답하고 `mismatch`에 `reply function threw: <message>`를 남긴다(server는 죽지 않는다). 근거: README "정한 것" 11(대답은 3개 이하지만 함수 대답으로 id를 이어 쓰는 길이 필요), `candidates-product.md` §0 사실 1.
2. 줄: queue를 줄마다 따로 둔다. 줄 이름이 같은 `script` 호출은 그 줄의 queue를 바꾼다. 어느 줄도 아닌 요청이 기본 줄 queue에서 꺼내진다. 기본 줄이 비어 있으면 지금처럼 400 + `no scripted reply left`다. 근거: `candidates-product.md` §0 사실 2, `candidates-invariants.md` 후보 19.
3. `probe.ts`를 만든다. 쓰는 곳: lane의 `match`(system 글의 `You are ...`나 `body.tools`에 role마다 다른 tool 이름이 있는지로 가른다. role 표지는 `packages/core/agent-roles/place/place-info.ts:159`와 `agent-roles/roles/*/prompt.md`를 보고 가장 안 흔들리는 것을 고른다. 추천: role 전용 tool 이름(lophn `app_create`, PM `context_draft`, App Engineer `ticket_create`)), 그리고 함수 대답이 앞 tool 결과에서 id를 뽑는 곳.
4. 자기 점검은 `tests/support/fake-server/server_test.ts`에 하나만 더한다(socket 없이 `handle(new Request(...))`). 단정 셋: (a) 함수 대답이 앞 요청의 tool_result에서 id를 뽑아 다음 tool call 인자에 넣는다. (b) 줄 둘에 요청이 어느 순서로 와도 각 줄의 대답을 받고 `lane` 이름이 journal에 남는다. (c) 함수가 던지면 400이고 `mismatch`가 채워진다. `shape_test.ts`는 그대로 통과해야 한다.
5. 새 helper를 더 만들지 않는다. 쓰는 쪽(`pm-context`, `agent-call`, `test-app`)이 필요한 것은 위 `probe.ts` 다섯이 전부다. 모자라면 "계약 바꾸기 요청"에 적는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `models`(제품이 provider에 보내는 요청과 받는 stream 모양을 fake가 맞게 흉내 내야 E2E가 헛걸음하지 않는다).
- 현실적 회귀: 함수 대답이 던져 server가 죽거나 test가 hang하는 것, 줄 구분이 흔들려 한 agent가 다른 agent의 대답을 받는 것, lane 추가가 기본 줄 동작(지금 E2E 전부)을 바꾸는 것.
- 왜 지금 test가 못 잡나: 지금 server는 queue 하나에 값 대답뿐이라 이 두 기능이 없다. `server_test.ts`는 값 대답만 본다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다(`tests/support`는 check에 든다).
- `deno test --no-check tests/support/fake-server`가 통과한다.
- 위험 test: 없음(support의 자기 점검 하나. 제품의 위험 규칙을 지키는 test가 아니다)

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
