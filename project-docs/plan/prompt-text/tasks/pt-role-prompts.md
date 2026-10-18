# pt-role-prompts

role 지침 세 곳을 코드에 맞게 고치고, PM이 경계와 계약 위반을 정하게 하고, App Engineer 지침에 observation 줄과 resolved 조건을 더하고, AGENT-ROLE을 맞춘다.

- 단위: pt-role-prompts (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/roles/app-engineer/prompt.md`
  - `packages/core/agent-roles/roles/project-manager/prompt.md`
  - `packages/core/agent-roles/place/place-data.ts`
  - `project-docs/products/AGENT-ROLE.md`
- 읽을 것:
  - 이슈: `project-docs/issues/agent-definition.md`의 "Project Manager 지침이 경계와 계약 위반 판단을 정하라고도 하고 물으라고도 한다", "role 지침 세 곳이 코드에 없는 것을 말한다". `project-docs/issues/problems.md`의 "앱이 문제를 보고할 자리(observation)를 정하는 지침이 없다"(App Engineer 줄만), "고친 release 없이 resolved로 바꾸면 …"(지침 줄만. program이 막는 것은 계획 `reuse-diagnose`)
  - architecture: `project-docs/architecture/agent-definition.md`
  - 사실 확인(읽기만): reaction은 `packages/core/events/reactor/session-opening.ts`(`AppRestartHalted`의 본문은 "The app crashed … so its automatic restart stopped"), ticket의 check는 하나(`packages/protocol/coding-agent/ticket/values.ts`), lophn의 쓰기 tool은 `app.create`뿐(`packages/core/agent-roles/tool-lists.ts`)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: role 지침 글. 지침은 영어 그대로 두고 문장만 바꾼다. AGENT-ROLE은 한국어다.

## 할 일

1. `place/place-data.ts`의 `ROLE_LINE.lophn`을 "Plans work, registers apps, and hands work to others."로 고친다.
2. `roles/app-engineer/prompt.md`:
   - "When you start work"의 reaction 열거 "a repeating problem closed"를 실제 reaction인 "the app stopped restarting after repeated crashes"로 고친다.
   - "acceptance checks" 두 곳("Create tickets" 항목과 "verify it with `ticket.verify`" 항목)을 단수 "the acceptance check"로 고친다.
   - "Create tickets with `ticket.create`" 항목에 observation 줄을 더한다. 앱을 만들거나 기능을 더하는 ticket에는 보고할 실패 분기와 그 이름을 적는다(거절로 끝나는 업무 분기, 외부 호출 실패, 조용히 넘어가는 fallback. 원인이 다르면 이름을 나눈다). coding agent가 그 자리에 `reportProblem`을 둔다.
   - "Use `problem.set_state` only when the evidence supports the new state"에 조건을 더한다. problem을 resolved로 바꾸는 것은 고친 release가 active가 된 뒤에만이다. 고친 release 없이 닫아야 하면(설정을 바꿔 고친 것 같은 경우) 사람에게 `ask`로 묻는다.
3. `roles/project-manager/prompt.md`:
   - "What you do not do"의 첫 항목을 "Do not decide what a term means; only the person defines it. Ask with `ask`…"의 꼴로 줄인다. 경계와 계약·문서 판단을 빼고 용어의 뜻만 남긴다. "If there is no answer, do not submit the related change. Report it as undecided"는 용어 뜻에 맞게 남긴다.
   - "What you do"의 경계 항목과 계약 위반 항목에 각각 "state in your answer what you decided and why"를 더한다. 계약 위반은 계약과 문서 중 무엇을 고칠지 PM이 정한다. 문서가 틀렸으면 사람에게 무엇을 고칠지 알린다는 말과 사람의 문서를 고치지 않는다는 말은 그대로 둔다.
4. `project-docs/products/AGENT-ROLE.md`:
   - C6 끝의 "(정하는 내용은 제안)"을 뗀다.
   - App Engineer 절 끝(A14 뒤)에 A15를 더한다: "앱을 만들거나 기능을 더하는 ticket을 만들 때, App Engineer는 보고할 실패 분기와 이름을 ticket에 적고, coding agent가 그 자리에 `reportProblem`을 둔다." 줄 끝 표시는 붙이지 않는다(정한 것).
   - 문서 안에 App Engineer 줄 수(A1~A14)를 세는 곳이 있으면 맞춘다(`grep -n "A14" project-docs/products/AGENT-ROLE.md`).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(글이다. `packages/core/agent-roles/place/place-info_test.ts`가 `ROLE_LINE` 글을 보는지 돌려서 확인한다).
- 남지 않음: `grep -rn "registers projects\|a repeating problem closed\|acceptance checks" packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 정한 것: 고친 문장의 최종 영어 글, A15의 글
- 무겁게 짠 것 / 알려진 미완 동작: 없으면 "없음"
