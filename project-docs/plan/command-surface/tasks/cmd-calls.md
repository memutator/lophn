# cmd-calls

session 사이 tool 넷(`call`, `reply`, `cancel`, `session.list`)을 명령으로 옮긴다.

- 단위: cli (wave 1)
- 선행: cs-foundation. 명령 표와 `lophn` tool이 있어야 한다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/bundles/call.ts`
  - `packages/core/lophn-agent/tools/call/**`
  - `packages/core/router/**`
  - `packages/protocol/lophn-agent/calls.ts`
  - `packages/cli/commands/{call.ts,call_test.ts,session.ts}`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`의 "정한 것" 2~9, 15
  - architecture: `project-docs/architecture/agent-call.md`
  - 본보기: `packages/cli/commands/`의 job 명령과 그 등록
- 계약:
  - 쓰는 것: cs-foundation의 명령 모양
  - 바꾸는 것: `packages/protocol/lophn-agent/calls.ts`의 입력에서 `unattended`를 뺄 수 있다(아래 2)

## 할 일

1. 넷을 명령으로 옮기고 bundle 쪽 정의를 지운다. 이름은 명령 꼴로 한다(예: `call.send`, `call.reply`, `call.cancel`, `session.list`). place 종류는 지금 place 목록 그대로다.
2. 지금 tool이 turn mode(`ctx.mode`)를 보고 봉투에 `unattended`를 찍는 것은 core가 한다. `calls.send`·`calls.reply` route가 부른 agent credential의 turn mode를 읽어 찍는다. 그래서 명령 context에 turn mode가 필요 없다.
3. `dedup`은 명령의 idempotency key(그 tool call의 id)다. run-loop가 실패한 read를 같은 tool call id로 다시 부르는 것과 맞물린다(`architecture/agent-call.md`).
4. binary(사람)에서 `call.send`·`call.reply`는 지금처럼 actor `agent`만 받는 route라 `forbidden`이다. coding agent가 답을 받는 길은 roadmap 15대로 이 계획 밖이다. place 종류는 lophn agent용으로 둔다.
5. 명령 help는 영어다.

## 끝남

- `npm run check:full`이 통과하고 `boot.sh`가 두 번 `exit 0`이다.
- 위험 test: "unattended turn에서 보낸 call과 reply에 core가 unattended 표시를 찍는다"(지금 test를 route 쪽으로 옮긴다)
- 위험 test: "같은 tool call id로 `call.send`를 다시 부르면 call이 하나만 생긴다"
- 남지 않음: `grep -rn "unattendedMark" packages`가 0줄이다.

## 보고

- 바꾼 file, 통과한 check
- 등록할 것: 명령 등록 목록, `TOOL_ORDER`·place 목록에서 뺄 이름, `packages/core/main/agent-tools.ts`에서 뺄 bundle
- 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

## lead가 더함 (cs-foundation merge 뒤)

- 명령 모양: `packages/cli/commands/types.ts`의 `defineCommand({...})`. 칸은 `name`(점 이름), `summary`, `description`, `input`(zod strict object), `positional`(칸 이름), `effect`, `routes: [{name}]`, `places`(`PlaceKind[]`, 빈 목록이면 binary만, 전부면 `PLACE_KINDS`), `run(input, ctx)`. 명령 file은 `JOB_COMMANDS` 같은 배열을 export한다. 본보기는 `packages/cli/commands/job.ts`다.
- `ctx`: `core.read(route, input)`, `core.command(route, input, {key, compare?})`(key는 `lophn` tool에서 tool call id, binary에서 `--idempotency-key`나 무작위), `place`(binary는 undefined, home은 null), `clock`, `signal`. 결과는 `{summary, content, arrayKeys?, text?, failed?, note?}`(`CommandResult`).
- 함정: 내장 tool을 명령으로 옮기면 같은 변경에서 옛 tool 정의와 `packages/core/agent-places/tool-lists.ts`의 그 이름을 지운다. wire 이름이 겹치면 `buildWireTable`이 실패해 그 session의 모든 tool이 "not available"이 된다(`packages/core/main/agent-tools_test.ts`가 잡는다).
- 추가 소유(등록 줄만): `packages/cli/commands/mod.ts`에 이 task의 명령 배열 한 줄, `packages/core/agent-places/tool-lists.ts`에서 옮긴 tool 이름 지우기, `packages/core/main/agent-tools.ts`에서 옮긴 bundle 지우기. 다른 task도 같은 줄을 고치므로 merge 충돌은 lead가 푼다.
