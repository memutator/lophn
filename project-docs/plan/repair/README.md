# repair: 진짜 model eval이 찾은 것과 작은 열린 이슈를 고친다

- **목표:**
  - test-restore 뒤 진짜 model eval(시나리오 스물, trial 한 번씩)에서 떨어진 여섯 가운데 eval 쪽과 제품 쪽 원인을 고치고 다시 잰다.
  - 작은 열린 이슈 넷(turn 준비 예외 기록, `attached` 지우기, grant read의 SQL, core main bare fetch check)을 닫는다.
- **재료:**
  - 떨어진 여섯의 원인 풀이(2026-10-20, planner worker). 아래 "정한 것"에 옮겼다. run 기록은 `tests/eval/runs/<run>.json`과 main checkout의 `.dev-data/eval/<run>/trial-0.json`이다.
  - 이슈: `project-docs/issues/eval.md`(월말정리), `agent-definition.md`(turn 준비, `attached`), `approval.md`(grant read), `mistakes.md`(core main fetch)
  - architecture: `eval.md`, `activation.md`(examples, `rewind_unproven`), `agent-call.md`, `event.md`, `approval.md`, `agent-definition.md`, `domain.md`
- **범위 밖:** `events` 점검의 Reactor backoff(이슈가 "필요해질 때"라고 정했다), docx reader, `shell.run`.
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `rp-`로 시작한다. brief는 짧다. 할 일의 근거는 이 README의 "정한 것"이다.
- **시작 조건:** 열린 다른 계획이 없다(main `01d81e8bd` 이후).

## 정한 것

- **calendar-api의 `list-after-add`를 지운다(agent).** "다음 주 화요일에 넣고 이번 주 일정 알려 줘"에서 다음 주 일정은 이번 주 목록에 나오지 않으니 add 뒤 list 순서가 필요 없다. 두 run에서 같은 check가 떨어졌고 모델은 맞게 했다.
- **calendar-mvp의 `asked-again` 입력을 고친다(agent).** `askedAgainInput(AE)`가 lophn session의 보낸 call에서 요청을 찾는데 calendar-call은 `deliver` step으로 와서 "(no request)"가 judge에 갔다. 전달한 call 본문을 넘긴다.
- **`observe-names-in-ticket`은 앱이 보고한 problem 이름만 센다(agent).** platform problem(`rewind_unproven` 등)까지 ticket에 적으라고 요구했다.
- **O4를 돌고 있는 앱 위에 다시 짓는다(agent).** 지금 world는 가계부가 꺼져 있고 합계 tool이 없어 "앱 tool 결과가 이상하다"를 볼 수 없다(시나리오 머리 주석이 이미 인정한다). `calendar-app-bug@2`처럼 bug가 심긴 돌고 있는 앱과 그 앱 place의 Operator로 다시 쓴다.
- **월말정리 Operator를 앱 place에 둔다**(`issues/eval.md`의 추천). `operators-home@5`, `restoreOperators`가 app place를 푼다.
- **C9-other는 "다른 project의 Operator를 다루지 않는다"만 잰다(agent).** AGENT-ROLE C9와 PM 지침("Do not plan beyond this project")이 그것만 말한다. 그 project의 PM에게 넘기기(`call-to-hr-pm`, `relays-request`)는 지침에 없고 세 지침 판에서 0/5였다. 넘기기를 바라게 되면 그때 지침 줄과 check를 같이 더한다.
- **save가 부모의 needs를 잇는다(agent).** run이 저장한 자식 재료(`parent`)가 `needs: []`라 혼자 풀면 앱이 빠진다.
- **App Engineer 지침에 read tool 결과 모양을 적는다(agent).** calendar-mvp에서 AE가 examples `expect`를 맨 배열로 써서 examples가 떨어졌고, 그 뒤 ticket이 verify 실패로 끝났다. read tool 결과는 `{rows, coverage, ...}`다(`packages/sdk/cap-tool/results.ts`). AE가 볼 수 있는 글 어디에도 이 모양이 없다.
- **두 AE session이 같은 ticket을 서로 반대로 고친 것을 조사해 고친다(agent).** examples 실패로 열린 `rewind_unproven` reaction이 같은 앱에 AE session을 하나 더 열었다. 고치는 길이 제품 동작을 고르는 것이면 lead가 planner에게 묻는다.
- **rework의 `app test`가 시작하지 않은 것을 조사해 고친다(agent).** 요청은 받았는데 `started_at`이 null로 남았다. 같은 commit을 다시 준비한 것이 의심된다(확인 전).
- **L6, A12는 고치지 않고 다시 잰다(agent).** 한 번 run으로는 model 탓인지 모른다. wave 2에서 trial 셋씩 돈다.
- **run이 저장한 `calendar-call@4`, `calendar-app@3`은 쓰지 않는다(agent).** 앞 run의 질에 난이도가 흔들린다(`architecture/eval.md`). main checkout의 `.dev-data/eval-saved/`로 옮겨 두었다.
- **core main graph의 bare `fetch(`를 check로 막는다**(`issues/mistakes.md`의 "막기"). 주석들이 말하는 "EXTERNAL_FETCH tripwire"를 실제 check로 만든다.

## 순서

- wave 1: task 열. 선행은 tasks의 brief가 정한다.
- wave 2(lead): 진짜 model로 다시 잰다. 바꾼 시나리오(calendar 넷, operator 넷, C9-other)와 L6, A12를 trial 셋씩 eval-run skill로 돌린다. **사람이 lead session에 직접 허락해야 돈다**(권한 분류기가 다른 session의 허락을 받지 않는다). 허락이 없으면 돌리지 않고 마무리한다.

## lead가 할 일

- merge할 때마다 바뀐 곳의 test를 돌린다. e2e file을 고친 task(`rp-attached-remove`)는 그 file들을 돈다.
- 마지막 land는 e2e 포함이다.
- 다 끝나면: 이슈 닫기(`issue` skill), `architecture/eval.md`·`agent-definition.md`·`approval.md` 중 바뀐 곳, changelog 새 판 `0.6.0`(`_template.md` 꼴로 연다), 계획 폴더 지우기.
- 사람에게 묻는 것: push. 그 밖은 planner(`lophn-7e`)에게 묻는다.
