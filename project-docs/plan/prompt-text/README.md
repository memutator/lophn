# prompt-text: model이 받는 글을 코드에 맞춘다

- 목표: role 지침, coding agent skill, 앱 template, SDK guide, 받은 turn의 입력 글을 지금 코드와 맞게 고친다. eval이 재기 전에, 틀린 줄로 알고 있는 것을 없앤다.
- 재료:
  - `project-docs/issues/coding-agent.md`
    - "앱 template의 AGENTS.md가 없는 skill과 tool을 가리킨다"
    - "repair skill이 지운 reproduction test를 요청하게 한다"
  - `project-docs/issues/problems.md`
    - "앱이 문제를 보고할 자리(observation)를 정하는 지침이 없다"
    - "앱 template의 `withStore`가 업무 code의 예외까지 `store_unavailable`로 바꿔 원인을 지운다"
    - "고친 release 없이 resolved로 바꾸면 같은 release의 새 발생이 묻힌다" 중 지침 줄만. program이 막는 것은 계획 `reuse-diagnose`가 한다.
  - `project-docs/issues/agent-definition.md`
    - "Project Manager 지침이 경계와 계약 위반 판단을 정하라고도 하고 물으라고도 한다"
    - "role 지침 세 곳이 코드에 없는 것을 말한다"
  - `project-docs/issues/agent-call.md`: "받은 turn의 입력과 뒤 turn의 history가 bytes로 다르다"
  - `project-docs/products/AGENT-ROLE.md`, `project-docs/architecture/agent-definition.md`, `project-docs/architecture/coding-agent.md`
- 범위 밖:
  - resolved 조건을 program이 막는 것, 새 agent tool, cap-fs·cap-net·cap-secret, skill의 SDK 목록에 cap 셋을 더하는 것. 모두 계획 `reuse-diagnose`가 한다.
  - eval. 계획 `eval-base`가 한다.
- 돌리는 방식: **worker를 쓰지 않는다.** lead가 lead worktree에서 task를 차례로 직접 고친다(사람이 정함: 패치가 좁은 계획은 lead 혼자 한다). orchestrate skill의 "lead는 기능 코드를 직접 짜지 않는다"는 이 계획에 적용하지 않는다. `tasks/*.md`와 `status.md`는 다른 계획과 소유를 가르고 끝남을 적으려고 둔다.
- 단위: `tasks/*.md`의 "단위"가 정한다. task id는 `pt-`로 시작한다.
- 순서: wave 하나. task끼리 소유가 겹치면 선행으로 줄 세운다.
- 시작 조건: 없음. 계획 `settings-mcp`, `eval-base`와 같이 돌아도 소유가 겹치지 않는다.

## 정한 것

- PM 판단: 경계와, 계약 위반 때 계약과 문서 중 무엇을 고칠지는 PM이 정하고 이유를 대답에 남긴다. 용어의 뜻만 사람이 정한다(사람). AGENT-ROLE C6의 "(정하는 내용은 제안)"을 뗀다.
- observation: 앱을 만들거나 기능을 더하는 ticket에 App Engineer가 보고할 실패 분기와 이름을 적는다. coding agent는 그 자리에 `reportProblem`을 두고 원인마다 이름을 나눈다(사람). AGENT-ROLE의 App Engineer 절에 이 줄을 더한다.
- resolved: App Engineer 지침에 "고친 release가 active가 된 뒤에만 `problem.set_state`로 resolved"를 쓴다(사람). program이 막는 것은 `reuse-diagnose`가 한다.
- reproduction test는 runner를 줄일 때 지운 길이라 되살리지 않는다. protocol과 core에 남은 `reproduction`만의 칸과 갈래를 지운다. repair skill은 ticket의 check를 따르고, check가 돌지 않으면(`unavailable`) 돌리지 못한 것과 이유를 보고에 적게 한다(agent). `test_command`도 지금은 runner가 돌리지 않는다. 그것을 살릴지는 `project-docs/issues/coding-agent.md`의 "ticket의 `test_command` check를 runner가 돌리지 않는다"에서 사람이 정한다. 이 계획은 지금 코드에 맞는 글만 쓴다.
- `withStore`: `try`를 `openStore()`와 `ensureSchema`에만 건다. 업무 일의 예외는 그대로 던져 진입점이 stack과 함께 보고하게 한다(agent, 이슈 추천).
- 앱 template `AGENTS.md`의 managed 절은 지금 있는 것만 가리킨다: skill 둘, `lophn ticket show`, 내장 SDK의 설치 사본 `guide.md`, 의존 변경은 App Engineer에게 청하기(agent, 이슈 추천).
- 받은 turn의 입력과 history가 같은 bytes가 되게 한다. 이때 답 방식은 지우지 않는다. 결과를 받는 call은 받은 agent가 답해야 하는데(AGENT-ROLE T11), 그것을 알려 주는 것이 `reply` 속성과 "answer with the reply tool" 줄이기 때문이다. 배달할 때 받은 봉투에 call의 답 방식, reaction의 event type, 실패한 답의 이유를 같이 남기고, history는 그것으로 같은 속성과 줄을 만든다. 저장 꼴이 바뀌므로 schema step을 그 자리에서 고치고 개발 data를 지운다. 다른 module의 표를 SQL로 읽지 않는다(agent, 이슈의 둘째 안).

## 사람이 정할 것

없음.

## lead가 할 일

- task마다 고친 뒤 `deno task check`, 끝내기 전에 `deno task check:full`.
- 고친 지침 file은 영어 그대로 둔다(role prompt는 영어다).
- 끝나면 다음을 한다.
  - 닫은 이슈를 `project-docs/issues/archived/`로 옮긴다. "고친 release 없이 resolved…" 이슈는 `reuse-diagnose`가 닫으므로 남긴다.
  - `project-docs/products/change-log/0.3.0.md`에 항목 하나를 덧붙인다.
  - 지침 내용이 바뀌었으면 `project-docs/architecture/agent-definition.md`와 `project-docs/architecture/coding-agent.md`를 맞춘다.
  - `land.sh`로 main에 올린다.
