# coding-agent

App Engineer가 ticket을 외부 coding agent에게 맡기는 길(session, 터미널, CLI, ticket)이다. `project-docs/architecture/coding-agent.md`.

## codex는 새로 놓은 hook을 사람이 `/hooks`에서 trust해야 쓴다

```yaml
kind: bug
modules: [packages/coding-agent]
```

지금: codex는 새로 놓이거나 바뀐 hook을 사람이 codex 안의 `/hooks`에서 trust하기 전까지 건너뛴다(learn.chatgpt.com/docs/hooks). trust 기록은 `~/.codex/config.toml`의 `[hooks.state."...hooks.json:stop:0:0"] trusted_hash`다. `harness install`은 toml을 쓰지 않는다. 설치된 codex 0.161.0 binary에도 `hooks need review before they can run` 문구와 `trusted_hash` 칸이 있다.

영향: codex에 맡기면 첫 번(그리고 hook이 바뀐 뒤)에는 사람이 trust할 때까지 turn 끝 신호가 안 와서 state가 unknown이다.

고치려면:
- 그대로 두고 confirm 화면에서 "codex에서 /hooks로 trust하라"를 알린다(작음).
- `config.toml`에 trust 기록을 쓴다(중간. toml을 고치는 코드와 hash 규칙을 알아야 한다).

## ticket의 `test_command` check를 runner가 돌리지 않는다

```yaml
kind: bug
modules: [packages/core/problems, packages/core/apps, packages/protocol, packages/core/agent-roles, packages/coding-agent]
```

지금:
- ticket의 check는 `app_test`, `test_command`, `text` 셋이다(`packages/protocol/coding-agent/ticket/values.ts`).
- test 접수는 `test_command`를 받지 못한다. `packages/core/problems/tests/lifecycle.ts`의 `productAdmission`이 "app test만 접수하고 test_command는 준비할 수 없다"며 `unavailable`로 둔다.
- runner(`packages/core/problems/tests/work/runner-service.ts`)도 `app_test`가 아닌 요청은 "이 runner가 실행하지 않는다"로 거절한다.
- `ticket.verify`가 읽는 검증 행(`packages/core/apps/tickets/checks.ts`)은 `test_command`라면 그 ticket과 완료 보고에 붙은 행을 찾는다. 그런데 그 행이 생길 길이 없다.
- `app_test`는 다섯 platform 검사(blueprint와 handler, 의존, 빈 migration, migration 올리기, rewind)뿐이라 앱의 업무 규칙을 보지 않는다.

영향:
- App Engineer가 "이 기능은 이렇게 동작해야 한다"를 program이 확인하는 check로 걸 길이 없다.
- `test_command`로 건 ticket은 coding agent가 test를 요청할 수 없어 검증을 통과하지 못한다.
- 수리 ticket에서 원래 증상이 고쳐졌는지(수리 전 실패, 수리 뒤 통과)를 보일 길도 없다.
- 남는 것은 App Engineer가 글로 판단하는 `text`뿐이다.

고치려면:
- 살린다(중간): runner가 release bundle에서 앱의 test 명령을 돌리고, 결과를 검증 행으로 남긴다. 돌릴 때 sandbox와 memory 한도는 `app_test`와 같다. App Engineer 지침과 coding agent skill이 기능 ticket과 수리 ticket에 이 check를 쓴다.
- 지운다(작음): ticket check와 protocol에서 `test_command`를 빼고, 앱 업무의 확인은 `text`로만 한다. 잃는 것은 기능과 수리를 program이 확인할 길이다.
- 추천: 살린다.

정한 것(사람): coding agent가 쓴 test를 돌리지 않는다. code를 쓴 쪽이 기준도 쓰면 자기 채점이 되기 때문이다. 대신 다음처럼 한다.
- App Engineer가 사람의 요구에서 app-api 입력과 기대 결과의 예시를 뽑아 ticket에 적는다.
- coding agent는 그 예시를 고칠 수 없다.
- program이 준비된 release에 그 예시를 불러 결과를 비교한다. 맞아야 검증을 통과한다.
- 반쯤 만든 `test_command`는 지운다.
- app-api로 부를 수 없는 것(화면 모양)은 지금처럼 `text`로 판단하고 사람이 확인한다.
