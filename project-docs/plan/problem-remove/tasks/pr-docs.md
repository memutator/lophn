# pr-docs

계획이 바꾼 동작에 맞춰 architecture 문서, AGENT-ROLE, catalog, PRODUCT 6절을 고친다. 코드는 고치지 않는다. lead가 맡긴다(README "lead가 할 일"의 "다 끝나면" 문서 줄). roadmap, 이슈, changelog, 계획 폴더는 lead가 한다.

- 단위: docs (wave 6)
- 선행: pr-cleanup. 코드가 모두 merge된 뒤 그 코드를 보고 쓴다.
- 소유(이 task만 고친다):
  - `project-docs/architecture/event.md`
  - `project-docs/architecture/kinds.md`
  - `project-docs/architecture/app-call.md`
  - `project-docs/architecture/annotation.md`
  - `project-docs/architecture/activation.md`
  - `project-docs/architecture/coding-agent.md`
  - `project-docs/architecture/agent-definition.md`
  - `project-docs/architecture/agent-call.md`
  - `project-docs/architecture/place-session.md`
  - `project-docs/architecture/layers.md`
  - `project-docs/architecture/domain.md`
  - `project-docs/architecture/approval.md`
  - `project-docs/architecture/ui-kit.md`
  - `project-docs/architecture/testing.md`
  - `project-docs/products/AGENT-ROLE.md`
  - `project-docs/PRODUCT.md`
  - `project-docs/boundary-catalog.yaml`
  - `project-docs/module-catalog.yaml`
  - `project-docs/context-component-registry.yaml`
- 읽을 것:
  - 계획: `project-docs/plan/problem-remove/README.md` 전체("정한 것", "뼈대 검토에서 정한 것", "lead가 할 일"의 "다 끝나면")와 `project-docs/plan/problem-remove/tasks/*.md`(task마다 무엇을 지우고 더했나)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`("모양", "지우는 것", 단계 1). 범위 밖(ticket, claim, examples, test runner, rewind 증명, preview, 공개 tool 막기, Reactor)은 다른 계획이 한다. 문서에서 그것을 지우지 않는다.
  - AGENTS.md "말"(영어 단어나 굳은 음차를 쓰고 번역어를 만들지 않는다)과 "문서" 표(architecture는 여러 module에 걸친 흐름, 불변 조건, 이유)
  - 코드(지금 동작의 근거. 문서는 코드에 맞춘다)
    - 앱 log: `packages/protocol/apps/app-log.ts`(머리 주석의 file 모양과 줄 꼴), `packages/protocol/apps/app-storage.ts`(`appLogFile`), `packages/core/apps/runtime/observations/log-file.ts`, `packages/core/apps/runtime/observations/stack-frames.ts`, `packages/core/apps/runtime/observations/crash.ts`(`crashLogText`), `packages/core/apps/permissions/broker/problems.ts`(`createExceptionLogService`), `packages/core/apps/runtime/view-errors.ts`, `packages/core/apps/runtime/reads.ts`(file 읽기 덮기), `packages/core/main/app-supervisor/assembly.ts`(`logFileOf`, 알려진 secret registry), `packages/core/apps/control.ts`(`appSupervisorSpec`의 `allow_write`), `packages/sdk/cap-problem/report-port.ts`(`reportProblem`)
    - reaction과 event: `packages/protocol/approvals/grants.ts`(`REACTION_EVENT_TYPES`), `packages/protocol/events/domain.ts`, `packages/protocol/events/transient.ts`(`AppRestartHalted`, `KindViolationFound`), `packages/core/events/reactor/session-opening.ts`, `packages/core/apps/runtime/commands.ts`(`APP_RESTART_HALTED_TOPIC`), `packages/core/projects/kinds/host/dispatcher.ts`
    - tool: `packages/core/agent-roles/tool-lists.ts`, `packages/core/apps/agent-tools/runtime.ts`
    - 남은 problems module: `packages/core/problems/`(test runner만)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음

## 할 일

근거는 README "정한 것"과 merge된 코드다. 문서와 코드가 다르면 코드가 맞다. 코드를 고치지 않는다.

1. 지운 것을 가리키는 줄을 찾는다: `grep -rnE "problem|Problem|reaction|collector|snapshot|feedback|User report|Report a problem|Issues|lophn-repair|source diff|log buffer|rewind_unproven|PublicToolsChanged|AppRestartHalted|KindViolationFound|domain_problems|reportProblem" <소유 file>`. 줄마다 지금 코드에 맞춰 고치거나 지운다.
   - 남는 것은 그대로 둔다: `ReleaseActivationFailed` reaction과 reaction 설정(`reactions.release_activation_failed`), `<lophn-reaction>`, Reactor, test runner(`packages/core/problems/tests`)와 rewind 증명, ticket, examples, 공개 tool 막기, SDK 이름 `@lophn/cap-problem`과 broker 경로 `/_lophn/broker/problems/observe-exception`, 일반 영어의 "problem"(버그, 원인).
   - 옛 동작을 "예전에는"으로 길게 적지 않는다. 지금 동작과 이유만 쓴다. 왜 problem 모델을 지웠는지는 "왜 이 모양인가"에 한두 줄이면 된다(`project-docs/products/roadmap/problem-ticket.md` "왜").
2. `app-call.md`에 앱 log를 쓴다(흐름과 지키는 것). 근거는 README "앱 log를 앱마다 file로 남긴다", "잡히지 않은 예외와 화면 오류는 log 줄이 된다", "뼈대 검토에서 정한 것".
   - 자리와 돌리기: `<data root>/apps/<app>/logs/app.log`와 `app.log.1`, file 하나 8 MiB, 앱마다 16 MiB. JSON Lines, 줄마다 `{ at, invocation, text }`. 쓰는 쪽은 app supervisor 하나다. supervisor의 Deno 쓰기 권한이 `<data root>/apps`를 연다. 앱 process는 data root를 fs grant로 열지 못해 log에 닿지 않는다.
   - 줄의 출처 다섯과 꼴: 앱 stdout·stderr(머리 `[inv=<id>] `는 떼어 `invocation`에), SDK `reportProblem`(`error <name>[: <message>][ <details JSON>]`), 잡히지 않은 예외(`exception <name>: <message>`와 봉인된 bundle의 source map으로 푼 frame 줄), 화면 오류(`view_error <observation> <name>: <message>`, shell main → core `app.log_view_error` → supervisor), 비정상 종료(`process_exit <근거>: <message>`). preview와 test 자식의 출력과 오류는 쓰지 않는다.
   - redaction: 줄마다 redaction한 뒤 300자로 자른다(이 순서). supervisor는 credential pattern과 core에서 받아 앱에 건넨 secret 값(`apps.secret_value`)을 지운다. core는 읽을 때 알려진 secret 값으로 한 번 더 지우고, 안전화를 못 끝내면 읽기 전체가 `unavailable`이다.
   - 읽기: `app.logs`(`apps/logs`)가 두 file을 바로 읽고 invocation, `since`(포함), `until`(제외), `limit`으로 거른다. supervisor가 없어도 읽힌다. actor는 user, coding_agent, agent, app이다. lophn과 App Engineer는 tool `app.logs`로, coding agent는 CLI `app logs`로 같은 route를 부른다.
   - 지금 "지키는 것"의 바깥 길 줄(secret 값이 앱의 log에 없다)이 새 동작과 맞는지 본다.
3. `event.md`: domain event 목록에서 지운 다섯을 빼고, `AppRestartHalted`와 `KindViolationFound`가 남지 않는 event라는 것과 누가 내는지(crash loop 기록 commit 뒤 apps wiring, kinds dispatcher)를 적는다. reaction은 `ReleaseActivationFailed` 하나다. program은 앱 오류를 보고 agent를 부르지 않는다(README 사람 결정).
4. `kinds.md`: lead가 위반 줄을 이미 고쳤다. 남은 reaction·problem 줄만 본다.
5. `agent-definition.md`, `agent-call.md`, `place-session.md`: problem tool(`problem.list`, `problem.get`, `problem.body`, `problem.set_state`)이 없고, lophn과 App Engineer 목록에 `app.status`, `app.logs`, `app.invocations`가 있다. call refs와 ticket 근거에 problem 갈래가 없다. reaction 목록은 하나다.
6. `coding-agent.md`: CLI `problem list|show|more|occurrence|body|diff`, source diff(`coding.source_diff`), skill `lophn-repair`가 없다. 배포 skill은 `lophn-build-app` 하나이고 고치는 ticket에도 쓴다. 증상의 근거는 `app status`, `app logs`, `app invocations`로 읽는다.
7. `activation.md`: `rewind_unproven` problem이 없다. 증명 못 한 write tool은 app test pass 이유 한 줄에만 남는다.
8. `annotation.md`: 사람의 feedback(앱 화면 "User report", [Report a problem])이 없고 annotation이 그 일을 한다. "화면마다의 source map은 앱 오류 stack 풀이에 남는다"가 지금 자리(`packages/core/apps/runtime/observations/stack-frames.ts`)와 맞는지 본다.
9. `layers.md`: `packages/core/problems`는 test runner만 남는다. stack frame 풀이는 apps 쪽에 있다. 지운 module과 방향 줄을 고친다.
10. `domain.md`, `approval.md`, `ui-kit.md`, `testing.md`: `PublicToolsChanged`와 지운 reaction 넷의 줄, cap-problem 사본 설명(보고 queue가 없다), app test가 problem을 보고하던 줄을 고친다. 공개 tool 막기는 남는다. `testing.md`의 "개편 동안 ... check에서 뺐다" 줄은 그대로 둔다.
11. `project-docs/products/AGENT-ROLE.md`: A2, A15, A16, L7, E1, E2, E5, E7과 5절 그림의 program 줄. A15(실패 분기에 `reportProblem`)는 "앱 log에 error 한 줄"로 맞는 말이 된다. A16(고친 release 전에 닫지 못한다)은 problem과 함께 없어진다. L7은 앱 상태와 log를 읽는다. 5절 그림에서 program이 agent를 부르는 줄은 activation 실패 하나만 남긴다. 지침(`packages/core/agent-roles/roles/*/prompt.md`, 이미 고쳤다)과 어긋나지 않게 한다.
12. `project-docs/PRODUCT.md` 6절의 MVP 목록에서 "problem"을 지금에 맞춘다("ticket"은 남는다).
13. catalog
    - `project-docs/boundary-catalog.yaml`: `problems` boundary를 test runner 계약만 남은 것으로 고친다. 앱 log 계약(`packages/protocol/apps/app-log.ts`)이 `app-runtime` 등 맞는 boundary에 들게 한다.
    - `project-docs/module-catalog.yaml`: `packages/core/problems` 설명과 boundary를 고친다. 지운 폴더를 가리키는 줄을 지운다.
    - `project-docs/context-component-registry.yaml`: 지운 것을 가리키는 줄을 고친다.
14. 확인: `deno run --allow-read tools/check-docs.ts`와 `deno task check:full`(modules 단계가 catalog와 폴더를 대조한다).

## 끝남

- `deno task check:full`이 통과한다.
- 위험 test: 없음. 문서다.
- 남지 않음: 할 일 1의 grep에 남은 줄이 모두 "남는 것"(할 일 1)이다. 남긴 줄을 보고에 file:줄로 적는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음이면 "없음"
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 소유 밖 문서(skill, roadmap, 이슈)에 남은 옛 이름을 file:줄로. 고치지 않는다
- 계약 바꾸기 요청: 없음이면 "없음"
- **무겁게 짠 것**: 없음이면 "없음"
- **알려진 미완 동작**: 코드와 문서가 어긋나는데 코드가 틀려 보이는 곳. 없음이면 "없음"
