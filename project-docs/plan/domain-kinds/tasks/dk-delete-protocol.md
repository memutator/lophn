# dk-delete-protocol

protocol에서 context를 마지막으로 지운다: context 계약·API·초안·worker 계약 file 다섯, 그 route 등록, id 접두 여섯, 옛 event `ContextViolationFound`와 그 reaction grant 칸, 쓰이지 않는 project record의 `tracking`. 다른 task가 쓰는 곳을 모두 끊은 뒤에 도는 마지막 task다.

- 단위: cleanup (wave 3)
- 선행: dk-delete-core, dk-delete-context-tools, dk-shell-workspace, dk-chips-reactions, dk-delete-eval, dk-operator-contexts, dk-delete-wording
- 소유(이 task만 고친다):
  - `packages/protocol/projects/context-api-content.ts`
  - `packages/protocol/projects/context-api.ts`
  - `packages/protocol/projects/context-contract.ts`
  - `packages/protocol/projects/context-drafts.ts`
  - `packages/protocol/projects/context-work.ts`
  - `packages/protocol/projects/read-values.ts`
  - `packages/protocol/projects/projects.ts`
  - `packages/protocol/projects/mod.ts`
  - `packages/protocol/base/ids.ts`
  - `packages/protocol/events/domain.ts`
  - `packages/protocol/approvals/grants.ts`
  - `packages/core/events/reactor/session-opening.ts`
  - `packages/core/approvals/approvals_test.ts`
  - `packages/core/approvals/gate/gate_test.ts`
- 읽을 것:
  - plan: `project-docs/plan/domain-kinds/README.md`("정한 것", "호환성 장치를 두지 않는다"), roadmap `project-docs/products/roadmap/domain.md`의 "정한 것 (agent, 초안)"("쓰이지 않는 `tracking`(project record)과 `app_reads`를 같이 지운다". `app_reads`는 `dk-operator-contexts`가 지웠다)
  - architecture: `project-docs/architecture/event.md`(domain event 목록, 새 일을 여는 event 다섯이 `REACTION_EVENT_TYPES`와 같아야 한다는 type 대조 `_newWorkMatchesReactions`)
  - 지금 코드(고칠 곳):
    - `packages/protocol/projects/mod.ts`: `export *` 줄(`context-contract`, `context-api`, `context-work`, `context-drafts`, `read-values`)과 `ROUTES`의 `...CONTEXT_API_ROUTES`, `...CONTEXT_DRAFT_ROUTES`, 그 import. `kinds-*` export와 `...KIND_ROUTES`, `PROJECT_API_ROUTES`, `projectResolveCwd`, `PROJECT_SEARCH_ROUTES`는 남긴다.
    - `packages/protocol/base/ids.ts`: `ID_PREFIXES`의 `ctx`, `cbn`, `chk`, `trm`, `ser`, `viw`. 지우기 전에 `rg -n 'idSchema\("(ctx|cbn|chk|trm|ser|viw)"\)|"(ctx|cbn|chk|trm|ser|viw)_|Id<"(ctx|cbn|chk|trm|ser|viw)">' packages tests tools`가 이 task 소유 밖에서 0줄인지 본다. `doc`·`ver`는 지우지 않는다(`problems`의 interpretation link가 `ver`를 쓴다).
    - `packages/protocol/events/domain.ts`: `contextViolationFound` 정의(≈:49), `DOMAIN_EVENTS`·`domainEventSchema`·`DOMAIN_EVENT_KINDS`의 줄. `packages/protocol/approvals/grants.ts`: `REACTION_EVENT_TYPES`와 `reactionGrantSchema`의 `ContextViolationFound`. `packages/core/events/reactor/session-opening.ts`: `callOf`의 `case "ContextViolationFound"`와 `registerNewWorkHandlers`의 `reactor.on("ContextViolationFound", …)`. 두 core test: reaction grant fixture의 `ContextViolationFound: "open"` 줄.
    - `packages/protocol/projects/projects.ts`: `tracking`(`trackingGlobSchema`·`patternFields`·`trackingPatternOutputSchema`·`trackingFields`·`trackingRuleSetOutputSchema`, `projectSchema.tracking`, `userProjectSchema.initial_tracking_proposal`). 쓰는 곳이 `protocol/projects/project-routes.ts`의 `projectReadSchema` 하나뿐이고 core는 이 칸을 읽지도 쓰지도 않는다(`rg -n "tracking" packages --glob '*.ts' --glob '!packages/design/**'`). `userProjectSchema`가 `projectSchema`와 같아지면 합치고 `projectReadSchema`의 union을 필요한 만큼만 둔다.
  - 주의: 그 밖의 `context` 말(`opening_context`, 모델 `context` 한도, `contextBridge`)은 다른 개념이다. 건드리지 않는다.
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기)

## 할 일

1. 시작 전 확인: `rg -n "protocol/projects/context-|projects/read-values|ContextViolationFound|contextViolationFound|CONTEXT_API_ROUTES|CONTEXT_DRAFT_ROUTES" packages tests tools --glob '!tests/eval/runs/**'`에서 이 task 소유 밖의 쓰는 곳이 남아 있으면 지우지 말고 보고한다(앞선 task가 못 끊은 것).
2. 위 file 일곱을 지우고(`context-*.ts` 다섯과 `read-values.ts`는 통째로) 나머지는 해당 줄만 고친다. `idSchema("ctx")` 같은 호출이 소유 밖에 남아 있으면 그 접두는 지우지 말고 보고한다.
3. `deno task check`로 type 오류를 따라간다. 새 route 등록(`...KIND_ROUTES`, `PROJECT_PROBLEM_ROUTES`)이 살아 있는지 core 기동으로 본다.

## 정한 것

- reaction grant의 옛 칸이 사라지므로 저장된 개발 설정의 `reactions.context_violation_found`는 무시되는 낡은 key가 된다. migration을 만들지 않는다(AGENTS.md "호환성").
- 새 event `KindViolationFound`와 옛 event의 순서 의존은 없다(`dk-event`가 새것을 먼저 더했다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지운 기능의 줄과 test 한 줄).
- 남지 않음: `rg -n "ContextViolationFound|contextViolationFound|context-contract|context-api|context-drafts|context-work|CONTEXT_API_ROUTES|CONTEXT_DRAFT_ROUTES|BundleContent|contextCreateRoute|bundleSubmitRoute" packages tests tools --glob '!tests/eval/runs/**'`가 0줄이다. `rg -n 'idSchema\("(ctx|cbn|chk|trm|ser|viw)"\)' packages tests tools`가 0줄이다. `rg -n -w "tracking" packages/protocol packages/core`가 0줄이다.
- core 기동: `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 찍고, renderer build(`deno run -A packages/shell/renderer/build.ts`)가 된다.
- 마지막으로 계획 전체의 남은 흔적을 본다: `rg -n -i "contexts?\b" packages tools tests --glob '!tests/eval/runs/**' --glob '!tests/eval/scorecards/**' --glob '!tests/eval/registry/**' --glob '!**/node_modules/**' --glob '!**/dist/**'`의 결과를 모아 무관한 것(모델 context 한도, `contextBridge`, `createContext`, `SetupContext` 등)을 뺀 나머지를 보고에 적는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음(지우는 task다)
- 정한 것
- 넘길 줄: 소유 밖에 남은 흔적(있으면 위치)
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
