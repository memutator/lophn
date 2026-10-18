# ec-fix-apptest

coding agent가 `lophn app test`를 맞게 부르지 못한다. 첫 진짜 run(calendar-diagnose)에서 Claude Code가 입력을 칸마다 맞춰 보며 거듭 떨어졌다. 원칙(사람): **결정적으로 정해지는 값은 program이 채우고, agent에게는 판단이 필요한 것만 받는다.** 결정적인 것은 싸고 빠르다.

- 단위: ec-fix-apptest (wave 6)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/problems/tests.ts`(test 요청 입력 schema)
  - `packages/core/problems/tests/**`
  - `packages/coding-agent/cli/commands/app.ts`(`app test` 명령)
  - `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`, `packages/coding-agent/guides/skills/lophn-repair/SKILL.md`(`app test` 줄만)
- 읽을 것:
  - 첫 run에서 Claude Code가 받은 오류(차례대로): `invalid_input: target.release: 입력이 맞지 않다` / `not_found: 현재 token으로 읽을 수 없다`, `invalid_input: ticket: 입력이 맞지 않다`, `ticket.check_index`, `ticket.check_hash`, `ticket.completion_seq`.
  - `packages/protocol/problems/tests.ts`: 요청 입력의 `target`(`bundle_hash`, `release` nullable이지만 key는 필수), `ticket`(`ticketTestLinkInputSchema.nullable()`, key 필수. 칸은 `ticket`, `check_index`, `check_hash`(RFC 8785 canonical JSON sha256), `completion_seq`)
  - `packages/core/problems/tests/request-ports.ts`(ticket 연결을 같은 tx에서 대조하는 곳), `examples-request.ts`, `reads.ts`
  - skill: build-app 7~8단계, repair 6~7단계("`target.bundle_hash`와 `test`에 준비에서 읽은 값을 넣어 요청한다")
  - `tests/support/app/activate.ts`(test가 이 값들을 core에서 읽어 채우는 길)
- 계약: test 요청 입력 schema(protocol)를 바꾼다. 쓰는 쪽(CLI, core, `tests/support/app/activate.ts`와 그 밖 test, desktop이 있으면 그것)을 같은 변경에서 고친다. 호환 길은 두지 않는다.

## 할 일

1. 요청 입력에서 core가 결정적으로 정할 수 있는 칸을 찾아 빼거나 선택으로 바꾸고 core가 채운다. 적어도:
   - `target.release`와 `ticket`은 key가 없어도 된다(없으면 `null`). 지금은 `null`을 넣어야 하는데 agent는 그것을 모른다.
   - `ticket` 연결의 `check_hash`, `completion_seq`는 ticket의 지금 상태에서 core가 읽어 채운다. `check_index`는 ticket check가 하나면 core가 정한다. 여럿이면 agent가 고르는 값으로 남긴다.
   - `target.bundle_hash`와 `test`도 그 앱의 마지막으로 끝난 release 준비에서 core가 정할 수 있으면 선택으로 바꾼다(준비가 여럿이면 agent가 주는 값을 쓴다).
   각 칸마다 "결정적인가"를 보고 바꾼 것과 남긴 것을 보고에 적는다.
2. ticket 연결 대조(같은 tx에서 보고 상태와 맞는지)가 지키던 것을 잃지 않는다. core가 채우면 채운 값이 그 tx의 상태라 대조는 그대로 맞다. agent가 값을 준 경우의 대조는 그대로 둔다.
3. skill의 `app test` 줄을 새 입력에 맞춘다(필요한 최소 입력만). skill은 사람의 `~/.claude`에 설치된 사본이 있으니, 바뀌면 보고에 "다시 설치 필요"를 적는다.
4. CLI 오류 글이 무엇이 빠졌는지 칸 이름과 기대 꼴을 말하는지 본다. 결정적으로 고칠 수 있으면 고친다.

## 끝남

- `deno task check:full`이 통과한다. core가 두 번 뜬다.
- 확인(probe, commit하지 않음): fake provider로 앱 하나를 activate 길로 release 준비까지 한 뒤, coding token으로 `lophn app test --input '{"kind":"app_test","request_key":"t1","app":"<id>"}'`처럼 최소 입력으로 요청이 접수되고 `app test status`·`app test result`가 결과를 준다. 진짜 provider와 진짜 claude는 쓰지 않는다.
- 위험 test: 기존 test가 보던 ticket 연결 대조가 그대로 통과한다. 새 test는 "core가 채운 연결로 보고 상태가 바뀐 뒤 요청하면 거절된다"가 이미 있는 test로 덮이지 않을 때만 하나.

## 보고

- 바꾼 file
- 통과한 check
- 칸마다 결정적인가와 바꾼 것·남긴 것
- skill 다시 설치 필요 여부
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
