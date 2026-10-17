# question-path

`tools/questions/`의 쓰이지 않는 ledger 질문 길(질문 표, 질문 command·read, 선택지 고정 action, 보호 설정, 자유 답 검사, 글 blob 준비)과 그 protocol, 그 길에만 붙은 ledger 쪽 장치를 지운다. `ask` tool과 그 기다림(`tools/questions/wait.ts`)은 남긴다.

- 단위: question-path (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/config/settings.ts`
  - `packages/core/lophn-agent/tools/questions/{commands,erase,group,model,option-actions,protected-settings,reads,reads_test,schema,screen,text-blobs,text-prepare,text-read}.ts`(전부 지운다)
  - `packages/core/lophn-agent/tools/questions/mod.ts`(`createQuestionWaits` export 한 줄만 남긴다)
  - `packages/protocol/lophn-agent/{questions,question-submission,question-text,decision-values}.ts`(전부 지운다)
  - `packages/core/lophn-agent/register.ts`(질문 등록과 주석만. 겹침 참고)
  - `packages/core/lophn-agent/run-loop/runtime-access.ts`(질문 import·route·`OPTION_ACTION_OPERATIONS`만. 겹침 참고)
  - `packages/core/main/daemon/wiring/lophn-agent.ts`(`withQuestionText` 감쌈만)
  - `tools/check-deps.ts`(`HARNESS_LEFTOVERS`의 `option-actions.ts` 줄과 `LEAVING_FILES`의 `question-submission.ts` 줄만)
  - `packages/core/storage/ledger/tx.ts`(`callChosenOption`과 `chosenTx`)
  - `packages/core/storage/ledger/schema.ts`(`question-evidence` step)
  - `packages/protocol/server/question-option.ts`(지운다)
  - `packages/protocol/server/registration.ts`(`Tx.callChosenOption` 멤버와 그 주석)
  - `packages/protocol/server/mod.ts`(`question-option.ts` export 줄)
- 읽을 것:
  - 이슈: `project-docs/issues/code-health.md`의 "`tools/questions/`의 ledger 질문 길이 쓰이지 않는다"(정한 것: 지운다, 선택지에 동작을 묶는 기능은 살리지 않는다)
  - 계획: `project-docs/plan/agent-place/README.md`(정한 것 4, 지켜야 할 것)
  - architecture: `project-docs/architecture/layers.md`(harness가 domain을 import하지 않는다. 고치는 것은 lead다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`, `project-docs/module-catalog.yaml`의 `lophn-agent`(`tools/questions/`는 이 module 안 폴더라 catalog 줄은 없다)
- 계약:
  - 쓰는 것: `packages/protocol/lophn-agent/ask-tool.ts`(`AskInput`, `AskAnswer`, `AskResult`, `askWait`, `ASK_ROUTES`)는 바꾸지 않는다. `wait.ts`가 쓰는 `Id<"qgr">`와 bus event `QuestionAsked`·`QuestionResolved`(`protocol/events/agent.ts`)도 그대로다.
  - 내놓는 것: 없음(지우기). 지운 route 이름 `CreateQuestionGroup`, `AnswerQuestionGroup`, `AnswerQuestionAction`, `DeferQuestionGroup`, `CancelQuestionGroup`, `ExpireQuestionGroup`, `ApplyQuestionOption`, `ReadQuestionGroup`, `ListQuestionGroups`, `ReadQuestionText`와 event `QuestionCreated`·`QuestionAnswered`·`QuestionExpired`·`QuestionCancelled`는 더 이상 없다.

## 지켜야 할 것(README에서 그대로)

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. 필요한 값은 composition root(`core/main`)가 넘긴다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다(이 task는 옮기지 않고 지우기만 한다).
- schema가 바뀐다(질문 표 둘과 `question_evidence` 표가 사라진다). 호환 장치(migration, 옛 이름 읽기)를 만들지 않는다. **개발 data(`.dev-data/`)는 지우고 새로 만든다.** 사람의 `~/.lophn`은 건드리지 않는다.
- 새 E2E, subprocess, 서버 test를 쓰지 않는다.

## 남길 것과 이유

- `tools/questions/wait.ts`: `ask` tool이 기다리는 메모리 기다림. `createQuestionWaits`가 `main/daemon/wiring/approvals.ts`에서 쓰인다. `ask-tool.ts`와 bus만 import하므로 지우는 file에 기대지 않는다(확인함).
- `tools/questions/mod.ts`: 한 줄(`export { createQuestionWaits } from "./wait.ts";`)로 줄여 남긴다. `approvals.ts`의 import 경로를 안 바꾸려는 것이다.
- `tools/bundles/ask.ts`, `packages/protocol/lophn-agent/ask-tool.ts`, `run-loop/runtime-access.ts`의 `askWait`(`HUMAN_WAIT_ROUTES`)와 `tools/ports.ts`의 `QuestionWait`, `run-loop/core-ports.ts`의 `questions.ask`, `main/agent-runtime/product-driver.ts`의 `questions.ask`: 전부 `ask` 길이다. 건드리지 않는다.
- `main/daemon/wiring/approvals.ts`: 고치지 않는다(`mod.ts`가 남아서 import가 그대로 풀린다).
- `packages/protocol/base/ids.ts`의 `qgr`, `qst`: `qgr`는 `wait.ts`와 `ask-tool.ts`가 쓴다. `qst`는 `protocol/config/settings.ts`(`ApplySettings.evidence`)와 `protocol/lophn-agent/messages.ts`(link `kind: "question"`)가 쓰므로 지우지 않는다.
- `packages/protocol/lophn-agent/` 네 file 가운데 남길 것은 없다. `ask-tool.ts`는 `questions.ts`·`question-submission.ts`·`question-text.ts`·`decision-values.ts` 어느 것도 import하지 않는다(확인함). `protocol/approvals/approvals.ts`(`approvalActionSchema`)는 다른 곳이 쓰므로 남긴다.
- `ApplySettings`(`protocol/config/settings.ts`, `SETTINGS_ROUTES`): 이 task가 지우지 않는다("정한 것" 참고). 쓰던 곳은 `option-actions.ts`뿐이라 handler도 호출자도 남지 않는다.
- `packages/core/lophn-agent/session/message-body.ts`의 `prepareBytes`·`rejected`와 `packages/base/redaction`: 다른 곳도 쓰므로 그대로 둔다.

## 정한 것

- 할 일 7(ledger 쪽 장치)은 이슈 "고치려면"에 없던 범위다. `Tx.callChosenOption`, `questionOption` port, `question_evidence` 표는 제공하는 곳이 이미 없고 질문 길이 지워지면 부르는 곳도 없어, 같은 schema 변경에서 같이 지운다(개발 data를 한 번만 지우려고). 이 범위가 부담이면 lead가 할 일 7과 소유 마지막 다섯 줄을 빼고 별도 task로 둘 수 있다.
- `ApplySettings` route는 지우지 않는다. handler가 어디에도 없고 `option-actions.ts`만 부르던 route지만 `protocol/config`는 이 계획의 범위가 아니다. 보고의 "안 쓰게 된 export"에 적어 lead가 이슈로 올린다.

## 할 일

1. `tools/questions/`의 13개 file을 지운다(소유 줄의 목록). 근거: 이슈 "고치려면"과 부르는 곳이 없다는 확인. `reads_test.ts`는 지우는 read만 본다. `mod.ts`는 `createQuestionWaits` 한 줄만 남긴다.
2. `packages/protocol/lophn-agent/`의 `questions.ts`, `question-submission.ts`, `question-text.ts`, `decision-values.ts`를 지운다. 근거: 이슈 "고치려면"의 "`ask`가 안 쓰는 것". 쓰는 곳은 `tools/questions/`뿐이다.
   - barrel을 같은 변경에서 맞춘다(protocol을 바꾸면 쓰는 쪽을 같이 고친다): `protocol/lophn-agent/mod.ts`에서 위 네 file의 `export *` 줄 넷, `protocol/lophn-agent/registry.ts`에서 `./questions.ts` import와 `...QUESTION_COMMANDS.filter(...)` 줄. 이 둘은 소유가 아니다. 지우는 줄만 최소로 고치고 보고의 "등록할 것"과 "넘길 줄"에 적는다.
3. `packages/core/lophn-agent/register.ts`에서 `./tools/questions/mod.ts` import 전부(`createQuestionCommands`, `createQuestionReads`, `deleteSessionQuestions`, `questionBodyFields`, `questionSchemaSteps`, `questionTextRead`), `questionCommands`·`questionReads` 선언, `deleteSessionRecords`의 `deleteSessionQuestions` 단계, `lophnAgentDefinitions`의 `...questionSchemaSteps`, `questionCommands.*` 여섯 줄, `questionReads.*`(`lophnAgentDefinitions.reads`와 `createReaderRegistration`의 두 곳), `...questionBodyFields`, `apiReads`의 `questionTextRead(...)`를 지운다. 질문을 말하는 주석(질문 묶음 설명, `CreateQuestionGroup` 예시, `ReadQuestionText도...`, `deleteSessionRecords`의 "질문 묶음")도 사실에 맞게 고치거나 지운다. 근거: 이슈 "고치려면".
4. `packages/core/lophn-agent/run-loop/runtime-access.ts`에서 `OPTION_ACTION_OPERATIONS` import와 `RUNTIME_MACHINE_OPERATIONS`의 그 spread, `RUNTIME_MACHINE_ROUTES`와 import의 `questionRead`, `questionText`, `cancelQuestionGroup`, `applyQuestionOption`을 지운다. `askWait`/`HUMAN_WAIT_ROUTES`는 남긴다. machine credential이 가진 operation이 줄어드는 쪽이다(권한 확대 없음). 근거: 이슈 "영향"(agent credential에 남은 `applyQuestionOption`).
5. `packages/core/main/daemon/wiring/lophn-agent.ts`에서 `text-prepare.ts` import와 `withQuestionText(inner, createQuestionTextPreparer(...))` 감쌈을 지워 `writer: (inner) => withAppEngineer(inner, ...)`로 한다. 파일 맨 위 주석과 "질문 글(...)도 message body와 같은 길로..." 주석도 맞게 고친다. `ctx.bodyPrepare`는 다른 wiring이 쓰므로 `context.ts`는 건드리지 않는다.
6. `tools/check-deps.ts`에서 `HARNESS_LEFTOVERS`의 `tools/questions/option-actions.ts` 줄과 `LEAVING_FILES`의 `protocol/lophn-agent/question-submission.ts` 줄을 지운다. 근거: 이슈 "고치려면". 다른 줄은 건드리지 않는다(`LEAVING_FILES`에는 `protocol/server/registration.ts`가 남는다).
7. 이 길에만 붙은 ledger 쪽 장치를 같이 지운다. 근거: 이 길이 지워지면 provider가 없는 port다. 이미 지금도 `questionOption` port를 제공하는 곳이 없어 `callChosenOption`은 늘 forbidden이다.
   - `packages/protocol/server/question-option.ts`를 지우고 `protocol/server/mod.ts`의 export 줄을 뺀다.
   - `packages/protocol/server/registration.ts`의 `Tx.callChosenOption` 멤버와 그것을 설명하는 주석, `CommandDefinition.dispatchable` 주석의 "question option 적용" 구절을 맞게 고친다.
   - `packages/core/storage/ledger/tx.ts`의 `callChosenOption` 구현, `chosenTx`, `CHOSEN_FORBIDDEN`, `questionOption`·`ChosenOptionCall` import와 그 뒤 안 쓰게 된 import·helper를 지운다. `tx`의 다른 멤버(`call` 등)는 그대로다.
   - `packages/core/storage/ledger/schema.ts`의 `question-evidence` step을 지우고 맨 위 주석("question_evidence 표는 쓰는 곳이 남아 있어 아직 둔다")을 맞게 고친다.
7-1. `packages/protocol/config/settings.ts`의 `applySettings`와 `SETTINGS_ROUTES`를 지우고 `packages/protocol/registry.ts`의 `...SETTINGS_ROUTES` 줄과 import를 지운다. core에 handler가 없고 부르던 곳은 `option-actions.ts`뿐이었다(planner 확인). 같은 file의 다른 export를 쓰는 곳이 있으면 그것은 남긴다. `qst` id가 `ApplySettings.evidence` 말고 쓰이는 곳(`messages.ts`의 link)은 남긴다.
8. 남은 import와 type 오류를 `deno task check`로 잡는다. 지운 뒤 깨질 곳(`grep`으로 확인한 전부)은 이것이다.
   - `packages/core/lophn-agent/register.ts`(할 일 3)
   - `packages/core/lophn-agent/run-loop/runtime-access.ts`(할 일 4)
   - `packages/core/main/daemon/wiring/lophn-agent.ts`(할 일 5)
   - `packages/protocol/lophn-agent/mod.ts`, `packages/protocol/lophn-agent/registry.ts`(할 일 2)
   - `packages/core/storage/ledger/tx.ts`, `packages/protocol/server/mod.ts`(할 일 7)
   - 그 밖의 소비자는 없다. 지우는 이름의 소비자를 `packages`와 `tools` 전체에서 찾아 확인했다(`packages/shell/main/dist/desktop.cjs`는 `.gitignore`의 build 산물이다). `packages/shell/renderer/conversation/agent-tab-source.ts`의 `QuestionOption`은 별개의 지역 `interface`다. renderer·wireframes의 question 화면은 `ask` 길(`QuestionAsked`·`AskInput`)이다.
9. `project-docs/`(architecture, catalog, issue, changelog)는 고치지 않는다. 이 계획의 lead가 마지막에 한꺼번에 고친다(README "lead가 할 일").

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 새 규칙이 없고 지우기만 하며, 지우는 `reads_test.ts`("다른 session의 agent는 질문 묶음을 읽지 못한다")가 지키던 read가 함께 없어진다. 남는 `ask` 길(`wait.ts`)은 session과 tool call로 key를 잡아 다른 session의 질문을 읽지 못한다. machine credential의 operation은 줄 뿐이다. 새 E2E·subprocess·서버 test는 쓰지 않는다.
- 남지 않음: `grep -rnE "CreateQuestionGroup|AnswerQuestionGroup|AnswerQuestionAction|ApplyQuestionOption|applyQuestionOption|ReadQuestionGroup|ReadQuestionText|question_groups|question_evidence|callChosenOption|questionOption|OPTION_ACTION_OPERATIONS|protectedSetting|screenAnswerText|createQuestionCommands|createQuestionReads|deleteSessionQuestions|questionSchemaSteps|questionBodyFields|questionTextRead|withQuestionText|createQuestionTextPreparer|QUESTION_COMMANDS|QUESTION_BLOB_OWNER_KIND|QUESTION_TEXT_PURPOSE" packages tools --include=*.ts --include=*.tsx`가 0줄이다(`packages/shell/main/dist`, `node_modules` 제외).
- `ls packages/core/lophn-agent/tools/questions`가 `mod.ts`와 `wait.ts`만 보인다.
- `ask` 길이 그대로다: `ask-tool.ts`, `tools/bundles/ask.ts`, `wait.ts`, `approvals.ts`는 diff에 없다(`git diff --stat`으로 확인).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 이 task가 최소로 고친 `protocol/lophn-agent/mod.ts`(export 줄 넷)와 `registry.ts`(`QUESTION_COMMANDS` 줄)는 소유가 아니다. 합칠 때 lead가 다시 확인한다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): `applySettings`·`SETTINGS_ROUTES`(`protocol/config/settings.ts`, 호출자와 handler가 없다), `ids.ts`의 `qst`는 아직 쓰인다.
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 가장 단순한 구현보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없음. 선택지에 동작을 묶는 기능은 살리지 않는 것이 정한 것이다.
