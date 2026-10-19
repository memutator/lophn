# rc-wire

app test harness의 driver가 앱 process에 보내는 호출 body에서 지워진 칸 `context.project`를 지우고, body에 wire type을 걸어 다음 wire 변경을 type check가 잡게 한다. wire 수준 거절이 "handler가 나쁜 입력을 거절함"으로 공짜 통과하지 않게 하고, app test의 fail 이유에 check별 이유를 싣는다.

- 단위: rewind-check (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/work/app-driver.ts`
  - `packages/core/problems/tests/app-test/judge.ts`
  - `packages/core/problems/tests/app-test/generate_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`(changeset, rewind), `project-docs/architecture/coding-agent.md`(ticket check, examples)
  - 계획: `project-docs/plan/rewind-check/README.md`의 "진단"
  - 지금 코드: `packages/core/problems/tests/work/app-driver.ts`의 `rejectsInvalidInput`·`rewind`·`call`(control socket `/_lophn/control/call` 호출 셋), `packages/protocol/apps/calls/process-wire.ts`의 `processCallRequestSchema`·`ProcessCallRequest`, `packages/core/apps/runtime/entrypoint/wire.ts`의 `parseProcessCall`(wire 수준 거절 "call request is invalid"), `packages/core/apps/runtime/entrypoint/invoke.ts`(handler의 입력 거절이 어떤 status·code로 오는지), `packages/core/problems/tests/app-test/judge.ts`(fail·inconclusive 이유)
- 계약:
  - 쓰는 것: `ProcessCallRequest`(`packages/protocol/apps/calls/mod.ts`)
  - 내놓는 것: 없음(동작 고침)

## 할 일

1. `app-driver.ts`의 세 호출 body에서 `project: null,`을 지운다. 세 body를 `satisfies ProcessCallRequest`로 type을 건다(object literal의 남는 칸을 type check가 잡는다). `mode: "test"`, `caller: null` 같은 값이 type에 맞지 않으면 그것도 wire와 다르게 보내던 것이니 wire 계약에 맞춘다. 맞출 수 없으면 보고한다.
2. `rejectsInvalidInput`: 지금은 HTTP 400 + `invalid_input`이면 handler가 거절한 것으로 본다. wire 수준 거절(`parseProcessCall`이 요청 모양을 거절한 것)은 handler 거절이 아니다. `invoke.ts`를 읽어 handler(또는 runtime의 입력 schema 검사)가 나쁜 입력을 거절할 때 오는 응답과 wire 거절을 가르는 가장 단순한 기준을 고른다(예: wire 거절의 message). wire 거절이면 `false`다.
3. `judge.ts`: fail 이유가 check 이름만 싣는다. 바로 아래 inconclusive 갈래처럼 `${check.name}(${check.reason})`을 싣는다. 이유가 길어도 자르지 않는다(지금 `reason`에 길이 상한이 없다).
4. `generate_test.ts` 등에 fail 이유 문자열을 비교하는 fixture가 있으면 맞춘다.
5. 확인: 진단 script(`/home/pyosechang/projects/lophn/.claude/worktrees/plan-rewind-check/.dev-data/rc-diagnose/repro.ts`. git 밖이다)를 이 task의 worktree에 복사해 돌린다. template 앱의 `release prepare` → `app test`가 `pass`인지, `app test result`의 reason이 이제 check 이유를 싣는지 본다. script의 `RC_REPO`는 이 task의 worktree로 준다. commit하지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 — 재발은 `satisfies ProcessCallRequest`가 type check로 막는다. 기존 harness test가 그대로 통과해야 한다.
- 남지 않음: `grep -n "project" packages/core/problems/tests/work/app-driver.ts`에 wire의 `project` 칸이 없다(주석의 "project 목록"은 대역 설명이라 남아도 된다. 대역이 없어졌으면 주석도 고친다).
- 확인 5가 통과한다.

## 보고

- 바꾼 file
- 통과한 check
- 확인 결과(app test result, reason 글)
- 등록할 것: 없음 예상
- 정한 것: wire 거절과 handler 거절을 가른 기준
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
