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

## 앱 template의 AGENTS.md가 없는 skill과 tool을 가리킨다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금:
- core가 새 앱 source에 까는 `packages/core/apps/packages/template/app/AGENTS.md.tmpl`은 coding agent가 앱 root에서 먼저 읽는 file이다. `CLAUDE.md`도 이 file을 가리킨다.
- 이 file의 managed 절이 없는 것을 가리킨다.
  - 배포 skill `lophn-navigate`와 `lophn-save`.
  - 세션 시작 summary(`lophn_session` op `summary`).
  - 설치 catalog `lophn_sdk`.
  - "작업 저장소의 context glossary".
- 배포 skill은 `lophn-build-app`과 `lophn-repair` 둘뿐이다(`packages/protocol/coding-agent/harness-adapter.ts`의 `CODING_SKILL_NAMES`). 나머지 이름은 저장소에서 이 file에만 있다.
- "새 SDK Package는 설치 catalog(`lophn_sdk`)에서 찾고 exact version만 쓴다"는 `lophn-build-app` 5단계와도 어긋난다. 5단계는 blueprint나 의존을 직접 바꾸지 말고 App Engineer에게 `message send`로 청하라고 한다.

영향:
- 모든 앱의 coding agent가 없는 skill과 tool을 찾느라 turn과 token을 쓴다.
- coding agent가 의존을 import map에만 더하면 blueprint와 어긋난다. 그러면 template의 `tests/blueprint_test.ts`와 release 준비(`packages/core/apps/releases/commands.ts`의 "manifest dependencies differ from the blueprint")가 거절한다.

고치려면: managed 절이 지금 있는 것만 가리키게 고친다(작음). 가리킬 것은 다음과 같다.
- skill 둘.
- 일의 시작은 `lophn ticket show`.
- 내장 SDK guide는 `.lophn/import-map.json`이 가리키는 설치 사본의 `guide.md`.
- 의존 변경은 App Engineer에게 청하기.

추천: 이대로.

## repair skill이 지운 reproduction test를 요청하게 한다

```yaml
kind: bug
modules: [packages/coding-agent, packages/protocol, packages/core/problems]
```

지금:
- `packages/coding-agent/guides/skills/lophn-repair/SKILL.md`는 지운 test 종류를 쓰라고 한다.
  - 1단계: ticket의 acceptance 조건에 "원래 증상 reproduction test"가 있다고 한다.
  - 7단계: `app test`로 "원래 증상 reproduction과 app test를 요청"하라고 한다.
- core는 `reproduction` 종류를 받지 않는다. `packages/core/problems/tests/commands.ts`의 `handleRequestTest`가 `invalid_input`("받지 않는 test 종류다")으로 거절한다. app test runner를 다섯 검사로 줄일 때 reproduction test를 지웠다.
- ticket의 check도 `app_test`, `test_command`, `text` 셋이다(`packages/protocol/coding-agent/ticket/values.ts`).
- 그런데 protocol의 `TEST_KINDS`(`packages/protocol/problems/tests.ts`)에는 `reproduction`과 그 schema가 남아 있다.

영향: 문제를 고치는 coding agent가 skill대로 reproduction test를 요청하면 거절당한다. 그러면 고친 것을 보일 길을 skill에서 찾느라 turn을 쓰거나, 수리 전에 실패하는 것을 보이지 않은 채 보고한다.

고치려면(작음):
- skill 1·7단계를 ticket의 check를 따르게 바꾼다. check가 돌지 않으면(`unavailable`) 돌리지 못한 것과 그 이유를 보고에 적는다.
- protocol과 core에서 `reproduction`만을 위해 남은 칸과 갈래를 지운다.
- `test_command`로 바꾸는 길은 막혀 있다. 아래 "ticket의 `test_command` check를 runner가 돌리지 않는다"를 본다.

정한 것: reproduction test는 runner를 줄일 때 지운 길이라 되살리지 않는다. 지워도 잃는 기능이 없다(agent).

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

정할 것: ticket의 `test_command` check를 살릴지 지울지.
