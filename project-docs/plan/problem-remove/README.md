# problem-remove: problem 모델과 reaction을 지우고 앱 log를 primitive로 둔다

- **목표:**
  - lophn이 앱의 "problem"을 모르게 한다. problem 상태 machine, 보고 길(collector worker, snapshot, 보고 표, 묶음), 사람 feedback, 저장하는 kind 위반을 지운다.
  - 앱 log를 primitive로 둔다. 앱마다 file로 남기고, 잡히지 않은 예외의 stack을 원래 source 줄로 풀어 쓴다.
  - program이 agent를 부르는 reaction 여섯 가운데 다섯을 지운다.
  - App Engineer가 앱 log, invocation, 앱 상태를 직접 읽게 한다.
- **재료:**
  - roadmap `project-docs/products/roadmap/problem-ticket.md`("모양", "지우는 것", "정한 것", 단계 1 `problem-remove`)
  - roadmap `project-docs/products/roadmap/agent-definition.md`(단계의 `problem-remove` 몫), `project-docs/products/roadmap/approval.md`("reaction")
  - architecture: `event.md`, `kinds.md`, `app-call.md`, `annotation.md`, `activation.md`, `coding-agent.md`, `agent-definition.md`, `layers.md`, `testing.md`
  - `project-docs/boundary-catalog.yaml`의 `problems`, `project-docs/module-catalog.yaml`
- **범위 밖** (다른 계획):
  - ticket, claim, examples gate, test runner, rewind 증명, release와 activation의 계기, preview를 App Engineer에게 열기, 공개 tool 막기 → `ae-builds`
  - approval의 나머지 → `approval-simplify`
  - Reactor 자체 → `reactor-remove`
  - guide를 skill로, command 인자 → `agent-definition`
  - coding agent 연결의 크기(보류, `problem-ticket.md` "정할 것" 1)
  - eval과 e2e test(사람, 아래 "정한 것")
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `pr-`로 시작한다. 할 일의 근거는 이 README의 "정한 것"과 roadmap이다.
- **시작 조건:** main `e192a9d8c` 이후. `approval-simplify`, `headless-run`, `schedule-job`, `workflow`는 brief만 써 둔 것이고, 이 계획 뒤에 차례로 연다.

## 정한 것

### 사람 (2026-10-20~21)

- problem과 ticket 모델은 너무 빡빡하다. 계약, 모양, 로직, tool을 최대한 덜어내고 agent의 책임을 높인다. lophn은 primitive만 두고, 관측, 진단, trace, doctor는 agent가 짓는다(`problem-ticket.md`).
- 앱 problem이 생기면 App Engineer를 자동으로 여는 흐름을 지운다.
- eval과 e2e test는 이 개편 동안 고치지 않는다. 다 바뀐 뒤 e2e를 고치고 eval을 돌린다.

### agent

- **`tests/e2e`와 `tests/eval`을 `deno task check`에서 뺀다. 이 계획의 첫 task다.**
  - 근거: 사람이 eval과 e2e를 이 개편 동안 고치지 않기로 했다. 그런데 `deno task check:full`(land가 돈다)은 `tests/` 전체를 type check하고 `tests/eval`의 test를 돈다. 빼지 않으면 지운 계약을 그 file들이 가리켜 land가 막힌다.
  - 뺄 범위는 type check와 test discovery 둘 다다. `tests/support` 가운데 e2e와 eval만 쓰는 것도 뺀다. package test가 쓰는 `tests/support`는 남기고, 깨지면 최소로 고친다.
  - 되돌리는 것은 e2e를 고치는 뒤의 계획이 한다. `tools/check.ts`에 그 이유를 주석 한 줄로 남긴다.
- **reaction 다섯을 지운다: `ProblemOpened`, `ProblemReopened`, `AppRestartHalted`, `KindViolationFound`, `PublicToolsChanged`.**
  - `ReleaseActivationFailed`는 `ae-builds`까지 남긴다. activation이 아직 `TicketVerified`로 돌고, 실패를 App Engineer가 받을 다른 길이 없다.
  - reaction 설정(`reactions.*`)과 그 화면은 남는 하나 때문에 `ae-builds`까지 둔다. 목록에서 다섯만 뺀다.
  - `AppRestartHalted`와 `KindViolationFound`는 toast만 쓰므로 남지 않는 event로 옮긴다(`architecture/event.md`: domain event는 "그 뒤에 꼭 움직여야 하는 일"에만). `PublicToolsChanged`는 받는 곳이 없어지므로 내지 않는다. 막기 자체는 `ae-builds`가 알림으로 바꿀 때까지 그대로다.
- **SDK `reportProblem`은 남기고, 앱 log에 error 한 줄(이름, 내용)을 쓰는 함수로 바꾼다.**
  - 근거: 앱과 test 재료가 이미 부른다. 이름 붙은 오류는 log에서도 쓸모 있는 신호다. 보고 길(collector, 보고 표, 묶음)만 지운다.
  - 지침 A15("보고할 실패 분기에 `reportProblem`을 둔다")는 그대로 맞는 말이 된다.
- **잡히지 않은 예외와 화면 오류는 log 줄이 된다.** 예외 stack은 봉인된 bundle의 source map으로 원래 source 줄로 풀어 쓴다. 지금 `packages/core/problems/snapshots/`의 source map 풀이를 log 쪽으로 옮긴다. redaction은 지금 log buffer처럼 줄마다 한다.
- **앱 log를 앱마다 file로 남긴다.** file 하나는 8 MiB까지이고, 넘으면 앞 file 하나로 돌린다(앱마다 합쳐 16 MiB). invocation 표시(`[inv=...]`)와 redaction은 지금 log buffer와 같다. 읽기는 file에서 하고, invocation, 시각, 줄 수로 거른다.
- **사람의 feedback(앱 화면 "User report")을 지운다.** 근거: annotation이 같은 일을 한다(사람이 앱 화면에서 App Engineer에게 알린다).
- **`rewind_unproven`을 problem으로 올리는 길을 지운다.** 근거: problem 보고 길이 없어진다. rewind 증명 자체는 `ae-builds`가 지운다. 그 사이 증명 결과는 test 기록에만 남는다.
- **저장하는 kind 위반(`domain_problems`, `problem.sync_domain`)을 지운다.** `kind.check`는 그대로다. toast는 kinds dispatcher가 메모리에서 앞 결과와 비교해 새 위반이 있을 때 남지 않는 event로 낸다.
- **problem tool, CLI 명령, coding agent skill을 지운다.**
  - 모든 role의 `problem.list`, `problem.get`, `problem.body`와 App Engineer의 `problem.set_state`
  - CLI `problem list|show|more|occurrence|body|diff`와 그것만 쓰는 source diff
  - coding agent skill `lophn-repair`. App Engineer는 고치는 ticket에도 `lophn-build-app`을 쓴다.
- **App Engineer에게 앱 log, invocation, 앱 상태 읽기 tool을 연다.** 근거: problem을 지우면 진단할 곳이 이것뿐이다. coding agent CLI가 쓰는 core route를 그대로 쓴다.
  - preview는 `ae-builds`로 옮긴다. 진단에는 읽기 셋이면 되고, preview는 App Engineer가 직접 짓고 확인할 때 필요하다(roadmap에서 옮김).
- **lophn의 "앱이 잘 도나"(AGENT-ROLE L7)는 앱 상태와 log를 읽는다.** lophn에게도 읽기 tool을 준다.
- **지침에서 problem과 reaction 줄을 지운다.** App Engineer, PM, lophn 지침의 problem, `problem.*`, kind 위반 reaction, `PublicToolsChanged` reaction 줄과 guide 속 같은 줄이다. `PRODUCT_INSTRUCTIONS`의 `<lophn-reaction>`은 `ReleaseActivationFailed` 때문에 남긴다.
- **앱 상세의 issues 화면을 지운다.** 사람에게는 toast가 남는다. 화면을 지우는 것은 `ui-design` skill로 wireframe부터 고친다.
- **죽은 problem 계약과 쓰는 곳 없는 blob 종류 셋을 지운다.**
  - 죽은 계약: `packages/protocol/problems/`의 `problems.ts`, `closing.ts`, `problem-reads.ts`, `problem-detail.ts`, `reports.ts` 일부
  - blob 종류: `snapshot_attachment`, `trace_body`, `operational_log`
- **옛 표, event, route는 migration 없이 지운다.** 개발 data는 지우고 새로 만든다(AGENTS.md "호환성").

### 뼈대 검토에서 정한 것 (agent, 2026-10-21)

- **console 출력을 invocation 표시로 감싸지 않는다.**
  - SDK가 쓰는 줄(`reportProblem`, 잡히지 않은 예외)에만 invocation을 싣는다. 그 밖의 stdout과 stderr 줄은 invocation이 null이고, 시각으로 찾는다.
  - 근거: 지금 `[inv=...]`를 쓰는 코드가 없다. log buffer가 읽기만 한다. 덜어내는 쪽이다.
- **`reportProblem(name, message?, details?)`이고 돌려주는 것이 없다.** 줄은 `error <name>`, message가 있으면 `: <message>`, details가 있으면 그 뒤에 한 칸 띄고 JSON이다. redaction은 writer가 한다. 근거: 지금 앱과 재료는 `reportProblem(name, message, {...})` 셋으로 부른다. 이 모양이면 부르는 곳이 하나도 깨지지 않는다(살 단계에서 고침).
- **비정상 종료 줄은 `process_exit <근거>: <message>`다.** 근거는 `unexpected_exit`, `v8_oom`, `start_failed`, `ready_timeout`, `crash_loop` 가운데 하나다.
- **예외의 frame 줄은 예외 줄 바로 뒤에 같은 invocation으로 이어 쓴다.** 시각(`at`)이 같다는 보장은 두지 않는다. writer의 `append`에 시각 칸을 더하지 않는 쪽이 단순하다.
- **log 쓰기는 supervisor의 launch spec에서 `<data root>/apps`에 쓰기를 열어야 돈다.** `pr-log-writer`가 `packages/core/apps/control.ts`의 `appSupervisorSpec`을 고친다. 앱 process의 권한은 그대로라 앱은 log file에 닿지 않는다.
- **supervisor의 log redaction에 앱에 건넨 secret 값도 넣는다.** log가 이제 disk에 남으므로, 바깥 응답에 되돌아온 secret이 file에 남지 않게 한다(`pr-log-writer`).
- **앱 process가 비정상으로 끝나면 log에 한 줄 쓴다.** exit code, 시작 실패, crash loop가 대상이다. 근거: 지금 crash 관측이 problem으로 보내던 사실을 한 줄로 남긴다.
- **preview와 test mode의 오류는 이번에 log에 쓰지 않는다.** `ae-builds`가 preview를 App Engineer에게 열 때 같이 본다.
- **켠 뒤 첫 kind 검사는 toast를 띄우지 않는다.** 앞 결과가 메모리에 없어 모든 위반이 새것으로 보이기 때문이다.
- **problem을 가리키던 곳은 같이 지운다.** test runner가 test child의 보고를 core로 넘기던 길, call refs와 ticket 근거의 `problem` 종류다. `problems` 표가 없어지면 읽을 곳이 없다.

## 순서

- wave와 선행은 tasks의 brief가 정한다. 첫 task는 check에서 e2e와 eval을 빼는 것이다.
- 계약을 먼저 고정할 것: 앱 log file과 그 읽기 route의 모양, App Engineer와 lophn의 새 읽기 tool 이름.

## 사람이 정할 것

- 없음.

## lead가 할 일

- merge할 때마다 바뀐 곳의 test를 돌린다. e2e와 eval은 돌리지 않는다(사람).
- land는 `LOPHN_LAND_SKIP_E2E=1 land.sh problem-remove`다. e2e는 이 개편 동안 고치지 않는다(사람).
  - 권한 분류기는 lead session에서 사람이 직접 한 말만 본다. 사람이 lead session에 "e2e를 건너뛰고 land해도 된다"고 직접 말해야 한다(orchestrate skill). planner가 전한 말로는 통하지 않는다.
- 첫 task(`pr-check-exclude`)가 land되기 전의 task는 merge하지 않는다.
- 이 계획은 끝까지 다 merge한 뒤 한 번에 land한다. wave별로 land하면 main이 어중간한 상태로 남는다.
  - wave 2만 land하면 kind 위반 toast가 `pr-kinds-toast`(wave 3) 전까지 뜨지 않는다.
  - wave 4와 5 사이에는 화면 오류가 core에 닿을 길이 없다.
  - 지침은 wave 5(`pr-role-prompts`) 전까지 더는 오지 않는 reaction을 말한다.
- wording catalog는 여러 task가 고친다. rebase 때 두 쪽 key를 다 남긴다.
- `pr-check-exclude`를 land할 때 `project-docs/architecture/testing.md`(층)와 `.claude/skills/write-test/SKILL.md`(check 파이프라인)에 "개편 동안 `tests/e2e`, `tests/eval`과 그것만 쓰는 `tests/support`를 check에서 뺐다" 한 줄을 더한다. e2e를 되살리는 계획이 그 줄을 지운다.
- 다 끝나면
  - 이슈: `issues/activation.md`의 unproven 알림 이슈는 `rewind_unproven` problem이 없어져 닫는다. 그 밖에 problem을 가리키는 이슈를 `issue` skill로 본다.
  - 문서
    - `architecture/event.md`, `kinds.md`, `app-call.md`(log), `annotation.md`, `activation.md`(`rewind_unproven`), `coding-agent.md`(CLI), `agent-definition.md`(tool), `layers.md`
    - `project-docs/products/AGENT-ROLE.md`: A2, A15, A16, L7, E1, E2, E5, E7, 5절 그림의 program 줄
    - `project-docs/boundary-catalog.yaml`(`problems`), `project-docs/module-catalog.yaml`, `project-docs/PRODUCT.md` 6절의 "problem"
    - roadmap `problem-ticket.md`에서 land된 것을 지우고, `approval.md`의 reaction 줄
  - changelog 열린 판 `0.6.0`에 항목을 덧붙이고, 계획 폴더를 지운다.
- 사람에게 묻는 것: push. 그 밖은 planner에게 묻는다.
