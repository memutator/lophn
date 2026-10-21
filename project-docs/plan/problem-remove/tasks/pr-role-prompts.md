# pr-role-prompts

App Engineer, PM, lophn 지침과 lophn guide, 내장 skill에서 problem, `problem.*`, kind 위반 reaction, `PublicToolsChanged` reaction 줄을 지운다. lophn의 "앱이 잘 도나"(AGENT-ROLE L7)는 `problem.list` 대신 앱 상태와 log를 읽는다. `PRODUCT_INSTRUCTIONS`의 `<lophn-reaction>`은 `ReleaseActivationFailed` 때문에 남기고 예시만 바꾼다.

- 단위: role-prompts (wave 5)
- 선행: pr-reactions, pr-log-contract. reaction 다섯이 없어지고 새 읽기 tool 이름이 고정된 뒤다.
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/roles/app-engineer/prompt.md`
  - `packages/core/agent-roles/roles/project-manager/prompt.md`
  - `packages/core/agent-roles/roles/lophn/prompt.md`
  - `packages/core/agent-roles/roles/prompts.ts`
  - `packages/core/agent-roles/roles/lophn/guides/domains.md`
  - `packages/core/agent-roles/roles/lophn/guides/features-and-screens.md`
  - `packages/core/agent-roles/roles/lophn/guides/questions-and-decisions.md`
  - `packages/core/agent-roles/roles/lophn/guides/roles-and-grants.md`
  - `packages/core/agent-roles/skills/kinds-yaml/SKILL.md`
- 읽을 것:
  - 제품 결정: `project-docs/plan/problem-remove/README.md` "정한 것 > agent"의 "지침에서 problem과 reaction 줄을 지운다", "lophn의 '앱이 잘 도나'(AGENT-ROLE L7)는 앱 상태와 log를 읽는다", "SDK `reportProblem`은 남기고"(A15는 그대로 맞는 말이 된다)
  - 역할: `project-docs/products/AGENT-ROLE.md`의 L7, A2, A15, A16, A21, C3, C6, C27, E1, E2, E5, E7(이 task 뒤 lead가 고친다. 지침과 어긋나는 줄을 보는 데 쓴다)
  - architecture: `project-docs/architecture/agent-definition.md`("고정 규칙은 영어 고정 본문 하나", `<lophn-reaction>`), `project-docs/architecture/kinds.md`(틀린 kind 파일은 앞의 맞던 것을 계속 쓴다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
  - 계약: `project-docs/plan/problem-remove/README.md` "뼈대 검토에서 정한 것"과 `project-docs/plan/problem-remove/tasks/pr-log-contract.md`의 `text` 꼴(`error <name>[: <message>][ <details JSON>]`(`reportProblem(name, message?, details?)`), `process_exit <근거>: <message>`(근거 `unexpected_exit` | `v8_oom` | `start_failed` | `ready_timeout` | `crash_loop`), `exception <name>: <message>`와 frame 줄, `view_error <observation> <name>: <message>`)과 새 읽기 tool 이름, `project-docs/plan/problem-remove/tasks/pr-agent-tools.md`의 tool 입력(`app.logs`의 `invocation`·`since`·`until`, `app.invocations`의 `status`)
- 계약:
  - 쓰는 것: tool 이름 `app.status`, `app.logs`, `app.invocations`(`pr-log-contract`), 앱 log 줄 꼴(`error <name>[: <message>][ <details JSON>]`, `exception`, `view_error`, `process_exit <근거>: <message>`), 사람에게 가는 toast(재시작 멈춤, kind 위반)
  - 내놓는 것: 없음. ticket, coding agent, examples 줄과 App Engineer 지침 다시 쓰기는 `ae-builds`의 몫이라 건드리지 않는다.

## 할 일

줄 번호는 지금 main의 것이다. 글은 영어로 쓰고, 고친 문단은 지금처럼 80자 안팎에서 줄을 바꾼다. 아래에 없는 줄(ticket, coding agent, examples, release)은 건드리지 않는다.

1. App Engineer 지침(`packages/core/agent-roles/roles/app-engineer/prompt.md`)
   - 3-7: "keep the app's problems under control"을 "find out what is wrong when the app misbehaves"로 바꾼다.
   - 11-18("When you start work" 문단): reaction 목록을 "an activation failed" 하나로 줄인다. 그 뒤에 한 문장을 더한다: "lophn does not open a session when the app keeps crashing or documents break a domain's kinds; the person sees a notice and may ask you." annotation, coding agent 문장과 "Read the call or reaction first ..."는 그대로다.
   - 33-35: "keeps being used and a problem is opened"를 "keeps being used, and `kind.check` shows why"로 바꾼다.
   - 46-50: 여는 말 "(a violation arrives and a session opens), read the state with `kind.check` and the problems with `problem.list` (give it the `domain`)"을 "(the person tells you, or `kind.check` shows violations), read the state with `kind.check`"로 바꾼다. 뒤 문장(무엇을 고칠지 정하고 이유를 말한다, 사람의 문서를 고치지 않는다)은 그대로다.
   - 113: 근거 예 "(a problem, an annotation, a file path)"를 "(an annotation, a file path)"로 바꾼다(ticket 근거의 problem 갈래는 `pr-problem-refs`가 지웠다). 115-119의 실패 분기와 `reportProblem` 줄(A15)은 그대로 둔다.
   - 141-142: problem `rewind_unproven` 줄이다(이 task 범위). "A problem `rewind_unproven` means ... make a ticket with such examples for it." 문장을 지운다. 그 problem을 올리는 길은 `pr-test-runner-reports`가 지웠다. 앞 문장("these examples are the only real proof.")은 examples 줄이라 둔다.
   - 172-174: "read the open problems (`problem.list`) and tickets (`ticket.list`) of the app"을 "read the open tickets (`ticket.list`) of the app"으로 바꾼다.
   - 175-180: problem을 읽고 닫는 bullet을 진단 bullet로 바꾼다. activation 실패 문장은 남긴다. 예:
     "When the person asks you to look at the app, or it seems to misbehave, read what happened before you decide: its state with `app.status`, its log with `app.logs` (narrow it with `invocation`, `since` and `until`) and its tool calls with `app.invocations` (for example `status: "failed"`). A failure branch the app reports with `reportProblem` is a line `error <name>: <message>`, with its details as JSON at the end; an uncaught exception is `exception <name>: <message>` followed by its source frames; an error on the app's screen is a `view_error` line; and an app process that ended abnormally is `process_exit <reason>: <message>` (`crash_loop` means lophn stopped restarting it). Say what you read and what you infer, then make a ticket that fixes the cause. When an activation fails, read the evidence and make a ticket that fixes the cause."
   - 193-206: 공개 tool bullet(193-196)에서 "A release that changes or removes a public tool another domain uses is reported to its users;"를 지우고, 막힌 release에서 할 일을 reaction 없이 그 bullet에 접는다. 예: "A release that removes a public tool another domain uses is blocked and is not activated. To remove such a tool, tell the owner of each domain that uses it with `call` and no reply expected (the Project Manager of its project or the App Engineer of its app), then ask the person; otherwise make a ticket that brings the tool back." `PublicToolsChanged` bullet 둘(197-206)을 지운다.
   - 207-211(package에서 난 "problem"), 220, 227의 "problem"은 일반 영어(버그)라 그대로 둔다.
2. Project Manager 지침(`packages/core/agent-roles/roles/project-manager/prompt.md`)
   - 13-18: reaction 줄을 지운다. 예: "You work when the person asks and when another agent calls you (lophn, an Operator). A note the person left on an artifact of the project (an annotation) also reaches you when no session wrote there last. lophn does not open a session when documents break a domain's kinds; the person sees a notice and may ask you. Read the call first and then the evidence it points to."
   - 37-38: "used and a problem is opened"를 "used, and `kind.check` shows why"로 바꾼다.
   - 55-57: 여는 말을 App Engineer 46-50과 같게 바꾼다("(the person tells you, or `kind.check` shows violations), read the state with `kind.check`"). 57-60의 뒤 문장은 그대로다.
   - 69: "(a ticket, a blueprint, a release, a problem of an app, a package, a bug found by an Operator)"에서 "a problem of an app, "를 지운다.
   - 77-80: `PublicToolsChanged` bullet을 지운다.
   - 99-100: "no tickets, blueprint, release, coding agent hand-over or app problems"를 "no tickets, blueprint, release or coding agent hand-over"로 바꾼다.
3. lophn 지침(`packages/core/agent-roles/roles/lophn/prompt.md`) 47-50(AGENT-ROLE L7): problem tool 대신 앱 상태와 log를 읽게 바꾼다. 예:
   "When the person asks whether their apps are healthy, read each app with `app.get` and `app.status`, recent errors in its log with `app.logs`, failed tool calls with `app.invocations` (`status: "failed"`), and tickets with `ticket.list`. Separate what you confirmed from what you infer, and say "not confirmed" for numbers you did not read."
   56줄의 "interpret why a problem happened"는 일반 영어이고 원인 해석을 App Engineer에게 두는 뜻이라 그대로 둔다.
4. `packages/core/agent-roles/roles/prompts.ts` 44: "- <lophn-reaction> is a fact lophn detected, such as a problem opening."의 예를 "such as a release that failed to activate."로 바꾼다. tag 줄 자체와 35줄 주석(여덟 tag)은 그대로다.
5. lophn guide(`packages/core/agent-roles/roles/lophn/guides/`)
   - `features-and-screens.md` 27-29: "App detail shows the current release, access (grants), connections, problems and what changed."에서 "problems"를 뺀다(Issues 탭은 `pr-issues-ui-screen`이 지웠다).
   - `domains.md` 11-14: "The program checks it and opens a problem when a document breaks it."를 "The program checks it and shows you a toast when documents newly break it."로 바꾼다.
   - `questions-and-decisions.md` 38-39: "resolving a problem, "을 지운다. 21-24의 "a reaction that opens a session"은 activation 실패 reaction이 남아 그대로 둔다.
   - `roles-and-grants.md` 51-53: "When a public tool an agent uses changes, the Project Manager or App Engineer of its place can tell it."를 지운다. 뒤 문장("A release that removes ... is blocked.")은 둔다.
6. 내장 skill(`packages/core/agent-roles/skills/kinds-yaml/SKILL.md`) 41-43: "that keeps being used and a problem is opened."를 "that keeps being used."로 바꾼다. 9줄의 "a problem in the schema"는 일반 영어라 둔다.

## 정한 것

- App Engineer와 PM의 "When you start work"에 재시작 멈춤과 kind 위반은 session을 열지 않고 사람에게 알림이 간다는 문장을 둔다. 이유: 그 길로 오던 일이 이제 사람의 말로 온다는 것을 agent가 알아야 같은 일을 기다리지 않는다.
- 공개 tool이 막힌 release에서 할 일은 reaction 없이 App Engineer 지침에 남긴다. 이유: 막기는 `ae-builds`까지 그대로라, 지우면 막힌 release를 다룰 지침이 없다.
- "problem"이 일반 영어(버그, 원인)로 쓰인 줄은 그대로 둔다. 이유: problem 모델을 가리키지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음.
- 남지 않음: `grep -rn -E "problem\.(list|get|body|set_state)|PublicToolsChanged|rewind_unproven|a problem is opened|opens a problem|open problems|resolving a problem|problems under control|problem of an app|app problems|problem opened|When the reaction is|a public tool changed|domains changed|is reported to its|connections, problems|can tell it" packages/core/agent-roles --include=*.md`가 0줄이고, `grep -n "problem opening" packages/core/agent-roles/roles/prompts.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 없으면 "없음"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
