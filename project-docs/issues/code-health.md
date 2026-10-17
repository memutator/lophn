# code-health

여러 module에 걸친 코드 건강 이슈다(죽은 이름, 긴 파일, test 준비 코드). 짝이 되는 architecture 문서는 없다.

## `apps/calls/calls_test.ts`의 동시성 test가 병렬 check 부하에서 가끔 깨진다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금: "write는 앱마다 한 번에 하나씩 돌고 read는 동시에 돈다"가 `deno task check:full`(`--parallel`)에서 한 번 실패했다. 같은 file만 돌리면 다섯 번 모두 통과했고, 같은 branch에서 check:full을 다시 돌리면 통과했다. 이 test file을 건드리지 않은 다른 변경의 check에서도 여러 번 같은 실패가 났다. 모두 다른 check:full이 같이 돌 때였다. test의 `until(done)`은 `setTimeout(0)`을 1000번 돌고 조건이 안 되어도 조용히 끝나며, 그다음 `assertEquals(t.sent.length, 4)`가 깨진다. 기다림이 시간이 아니라 tick 수라 부하가 크면 조건보다 먼저 끝날 수 있다.

영향: lead의 merge·land가 코드와 상관없이 멈춘다(계획 둘이 full check를 같이 돌릴 때 늘어난다). 사람이 원인을 찾느라 시간을 쓴다.

고치려면: `until`이 조건이 안 되면 실패를 던지게 하고 기다림을 시간 상한(예: 2초)으로 바꾼다(작음). 추천: 이 안.

## `tools/questions/`의 ledger 질문 길이 쓰이지 않는다

```yaml
kind: defect
modules: [packages/core/lophn-agent, packages/protocol, tools]
```

지금: `ask` tool은 `ctx.questions.ask` → memory route `askWait` → `main/daemon/wiring/approvals.ts`의 `createQuestionWaits`(`tools/questions/wait.ts`)로 main thread 메모리에서 기다린다. `ask` 입력(`protocol/lophn-agent/ask-tool.ts`)의 선택지는 `label`·`description`뿐이다. 그 옆의 ledger 질문 길은 `register.ts`가 handler, read, 표(`question_groups`·`questions` schema step), session 삭제 정리(`deleteSessionQuestions`)를 등록하지만 route(`CreateQuestionGroup`, `AnswerQuestionGroup`, `AnswerQuestionAction`, `ApplyQuestionOption`, `ReadQuestionGroup` 등)를 부르는 곳이 packages 어디에도 없다. 선택지 고정 action(`option-actions.ts`), 선택지로 못 바꾸는 설정(`protected-settings.ts`), 자유 답 secret 검사(`screen.ts`), 질문 글 blob(`text-*.ts`)이 모두 이 길에만 붙어 있다. `ask`가 옛 `question.submit`을 대신하면서 tool binding만 지워지고 남았다. `tools/questions/`에서 `ask.ts`(bundle)·`wait.ts`를 뺀 약 2,268줄이다.

영향: 죽은 길이 harness 안의 domain 섞임으로 보인다. `option-actions.ts`가 `protocol/apps`의 `appCreate`를 import해 `HARNESS_LEFTOVERS`에 올라 있고, 표 둘의 schema step과 route가 agent credential(`run-loop/runtime-access.ts`의 `applyQuestionOption`)과 protocol registry에 남아 읽는 사람이 쓰이는 길로 오해한다.

고치려면: `tools/questions/`에서 `wait.ts`와 그것이 쓰는 것만 남기고 지운다. `register.ts`의 등록(질문 commands·reads·`questionTextRead`·`questionBodyFields`·`questionSchemaSteps`·`deleteSessionQuestions`), protocol의 `questions.ts`·`question-submission.ts`·`question-text.ts` 중 `ask`가 안 쓰는 것, `runtime-access.ts`의 `applyQuestionOption`, `tools/check-deps.ts`의 `HARNESS_LEFTOVERS` 한 줄을 같이 지운다. schema가 바뀌므로 개발 data는 지우고 새로 만든다(중간, 기계적).

정한 것: 지운다(사람). 선택지에 동작을 묶는 기능은 살리지 않는다. 필요해지면 그때의 `ask` 모양에 맞춰 새로 짠다.
