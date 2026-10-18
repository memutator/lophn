# rd-ex-prompts

App Engineer 지침과 coding agent skill 둘을 새 ticket 검증에 맞춘다: App Engineer는 사람의 요구에서 app-api 예시를 뽑아 ticket의 check로 적고, coding agent는 그 예시를 읽어 맞추되 고치지 않는다.

- 단위: rd-ex-prompts (wave 3)
- 선행: rd-ex-shape. check의 이름(`examples`)과 모양이 거기서 정해진다.
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/roles/app-engineer/prompt.md`
  - `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`
  - `packages/coding-agent/guides/skills/lophn-repair/SKILL.md`
- 읽을 것:
  - issue: `project-docs/issues/coding-agent.md`의 "ticket의 `test_command` check를 runner가 돌리지 않는다"(정한 것: 사람의 요구에서 예시를 뽑는다. coding agent는 고칠 수 없다. app-api로 부를 수 없는 것은 `text`다)
  - architecture: `project-docs/architecture/agent-definition.md`(지침은 영어, "일의 흐름은 tool로 만들지 않는다. 지침과 skill이 primitive를 엮는다"), `project-docs/architecture/coding-agent.md`
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `coding-agent-cli`
  - 계획 `prompt-text`와 `rd-app-api-tool`이 이 file들을 먼저 고쳤다. 지금 file을 읽고 맞는 문장 옆에 넣는다.
- 계약:
  - 쓰는 것: ticket check `{ kind: "examples", steps: [{ api, input?, expect }] }`와 비교 규칙(`rd-ex-shape`: expect의 key는 결과에 있고 같아야 하며 결과의 나머지 key는 무시, 배열은 길이가 같고 원소마다 같은 규칙, 나머지는 `===`), `ticket.create`의 check 종류 `app_test` · `examples` · `text`
  - 내놓는 것: 지침·skill 문장

## 할 일

1. `roles/app-engineer/prompt.md`(영어): ticket을 만드는 항목(`ticket.create` 문장)에 다음 뜻을 넣는다.
   - 사람의 요구에서 app-api 예시를 뽑는다: 부르는 app-api(`blueprint.check`·`app.app_api`로 읽은 key), 입력, 기대 결과의 순서. 예: `event.add`로 매주 일정을 넣고 `event.list`를 불러 4주치 행을 기대한다. 이것을 check `examples`로 적는다. 사람이 말하지 않은 값을 지어내지 않는다: 모르면 사람에게 `ask`한다.
   - `expect`에는 결과에서 사람이 요구한 칸만 적는다(앱이 만드는 id·시각은 적지 않는다). 배열은 길이까지 맞아야 한다.
   - app-api로 부를 수 없는 것(화면 모양)과 설정으로 고치는 것은 `text`로 두고 사람이 확인한다. 플랫폼 검사만 필요하면 `app_test`.
   - coding agent는 예시를 고치지 못하고 program이 보고된 release로 예시를 돌린다. 예시가 맞지 않으면 `ticket.verify`로 verified가 되지 않는다. 예시가 틀렸다면 `ticket.update`로 고치고 coding agent에게 다시 맡긴다.
2. `lophn-build-app/SKILL.md`: 1번(ticket 읽기)에 "acceptance 조건이 예시(`examples`)이면 api와 입력, 기대 결과를 그대로 읽는다. 예시는 고치지 않는다. 틀린 것 같으면 `message send`로 App Engineer에게 청한다"를 더하고, 8번(실제 테스트)에 "`app test`는 플랫폼 검사다. 예시는 보고한 뒤 program이 보고한 release로 돌린다. 예시의 api를 그 입력으로 불렀을 때 기대 결과가 나오도록 만든다"를 맞춘다. 지금 8번이 말하는 "ticket의 test 조건을 요청한다"가 옛 `test_command`·reproduction을 가리키면 지운다.
3. `lophn-repair/SKILL.md`: 같은 줄을 repair에 맞게 넣는다(수리 ticket의 예시는 원래 증상을 보이는 호출과 고쳐진 기대 결과다. 6~7번의 "원래 증상 reproduction" 요청 문장이 남았으면 지우고 `app test`와 예시 읽기로 바꾼다. 계획 `prompt-text`가 reproduction을 이미 지웠을 수 있다. 지금 file을 읽는다).
4. 문장이 없는 tool·명령을 가리키지 않는지 확인한다: `ticket show`, `app test`, `app test status`, `app test result`, `message send`는 있다(`lophn-build-app` 명령 목록).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지침이다).
- 남지 않음: `grep -rn "test_command" packages/coding-agent packages/core/agent-roles`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
