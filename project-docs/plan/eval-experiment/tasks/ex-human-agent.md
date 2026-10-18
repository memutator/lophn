# ex-human-agent

사람 역할의 답을 runner가 `.env` key로 Anthropic API를 부르는 길에서, eval을 돌리는 agent가 질문마다 새 subagent로 답하는 길로 바꾼다. trial이 도는 동안 App Engineer의 `ask` 질문은 "답 대기" entry file이 된다(질문, 선택지, 시나리오의 요구 카드, 이 trial에서 앞서 한 답). 돌리는 agent가 `deno task eval:answer <run>`으로 대기 목록을 보고 답을 적으면, trial을 쥐고 있는 runner가 제품 `askAnswer` route로 넣는다. 허락(approval)은 지금처럼 program 규칙이다. 옛 호출 길(`human/answer.ts`의 fetch)은 지운다. 호환 장치는 두지 않는다.

- 단위: ex-human-agent (wave 2)
- 선행: ex-spec, ex-judge-agent
- 소유(이 task만 고친다):
  - `tests/eval/human/**`
  - `tests/eval/runner/trial.ts`의 한 곳(`createHumanRole({...})` 호출과 그 import)만. ex-judge-agent가 같은 파일의 judge 블록을 먼저 고치므로 그 merge 뒤에 시작한다(같은 wave 안에서 순서만 둔다). 이 줄 없이는 `fetch`·`apiKey`를 없앤 `HumanDeps`와 맞지 않아 type check가 깨진다. runner 나머지는 ex-cli의 몫이다.
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/eval.md`의 "요구 카드"(사람 역할), "역할과 흐름", "진짜로 도는 것"(허락 규칙)
  - 계획: `project-docs/plan/eval-experiment/README.md`("정한 것"의 "채점과 사람 역할은 eval을 돌리는 agent가 맡는다")
  - 같은 계획: `ex-judge-agent.md`(같은 file 프로토콜. 이름과 규칙을 맞춘다. `PendingJudge`, `judgeKey`, stdin JSON으로 기록, 덮기 규칙)
  - 지금 코드(main에 있다): `tests/eval/human/{answer,role,definition,approve,mod}.ts`, `human.json`, `prompt.md`, `human_test.ts`, `tests/eval/types.ts`(`HumanSpec`, `HumanRecord`, `HumanSummary`, `ApproveRule`), `tests/eval/runner/trial.ts`의 `createHumanRole` 호출, `tests/eval/runner/idle.ts`(`act` hook, 질문이 있는 동안 poll마다 `tick`을 부르고 답이 없으면 조용함이 아니다), `tests/eval/runner/steps.ts`(coding 시나리오 trial 상한 90분)
  - 제품 route: `packages/protocol/lophn-agent/ask-tool.ts`(`askRead`, `askAnswer`, `AskQuestion`, `AskAnswer`: `askAnswer`는 `question`이 글자 그대로 같은 답만 받는다), `packages/protocol/events/mod.ts`(`sessionSnapshotsList`의 `questions`)
- 계약:
  - 쓰는 것:
    - `tests/eval/types.ts`: `HumanSpec`, `HumanRecord`, `HumanSummary`. **아래 "types.ts 변경"이 ex-spec으로 먼저 들어가 있어야 한다.** 없으면 고치지 말고 멈추고 보고한다.
    - `packages/protocol/lophn-agent/ask-tool.ts`의 `askAnswer`, `askRead`(이미 role.ts가 쓴다).
  - 내놓는 것(ex-cli, ex-skills가 기댄다), `tests/eval/human/mod.ts`:
    - `type HumanDefinition = { n: number; prompt: string }`, `loadHumanDefinition()`, `HUMAN_FILES`.
    - `createHumanRole(deps: HumanDeps): HumanRole`. `HumanDeps = { port: HumanPort; clock: Clock; spec: HumanSpec; evalDir: string; run: string; trial: number; log: (line: string) => void; definition?: HumanDefinition }`(`fetch`, `apiKey`는 없다). `HumanRole = { tick(): Promise<{ acted: number }>; record(): HumanRecord; waiting(): string[] }`. `waiting()`은 답을 기다리는 질문 key 목록이다.
    - `type PendingQuestion = { key: string; run: string; trial: number; session: string; tool_call: string; asked_at: string; card: string; earlier: EarlierAnswer[]; questions: AskQuestion[] }`, `type EarlierAnswer = { question: string; answer: string[] }`, `type GivenAnswer = { model: string; answered_at: string; selected: string[][] }`.
    - `questionKey(trial: number, toolCall: string): string`: `` `t${trial}-${toolCall}` ``.
    - `writeQuestion(evalDir, entry: PendingQuestion): Promise<void>`(`<evalDir>/<run>/questions/<key>.json`, 이미 있으면 던진다), `readQuestions(evalDir, run): Promise<{ question: PendingQuestion; answered: boolean }[]>`(폴더가 없으면 `[]`), `writeGivenAnswer(evalDir, run, key, given): Promise<void>`(`<key>.answer.json`, 이미 있으면 던진다), `readGivenAnswer(evalDir, run, key): Promise<GivenAnswer | null>`.
    - `buildAnswers(questions: AskQuestion[], selected: (string[] | undefined)[]): AskAnswer[]`: 옛 `answerQuestions` 안의 `build`를 뺀 것이다(순서대로 질문마다 하나, `question`은 입력 질문에서 복사, 빈 값은 `ANSWER_DEFAULT`, 단일 선택은 첫 값 하나만). `ANSWER_DEFAULT = "추천대로 해 줘"`는 그대로다.
    - `renderForAgent(def: HumanDefinition, q: PendingQuestion): string`: subagent에게 그대로 줄 글 전문.
  - `tests/eval/human/main.ts`: `deno task eval:answer`의 입구(할 일 5). lead가 `deno.json`에 task를 올린다.

### types.ts 변경(ex-spec이 한다. 이 task는 고치지 않는다)

```ts
// HumanRecord에서 뺀다
model: string;   // 질문마다 다른 subagent가 답한다. 답마다 적는다
// HumanRecord.answers[]에 더한다
model: string | null; // 답한 model. 돌리는 agent가 적는다
```

`definition`(`human@<n>`)은 그대로다. `cost_usd`(`answers[]`, `HumanRecord`, `HumanSummary`)는 항상 0으로 두고 남긴다. 이유와 정리는 `ex-judge-agent.md`와 같다(ex-cli가 지운다). `HumanSummary.fallback`은 `error`가 있는 답의 수로 그대로 센다(이제 `askAnswer` 오류만 해당한다).

## 할 일

근거: README "정한 것"의 사람 역할 항목, roadmap "요구 카드".

1. `definition.ts`, `human.json`, `prompt.md`.
   - `HumanDefinition = { n; prompt }`. `human.json`은 `{ "n": 2 }`만 둔다(model, max_tokens, 단가는 지운다). `HUMAN_FILES`는 그대로.
   - `prompt.md`(영어)를 subagent용으로 다시 쓴다. 지금 글의 역할 설명(요구 카드로 사람처럼 답한다, 카드가 답하는 질문은 맞는 선택지의 `label`을 글자 그대로, 카드가 답하지 않으면 정확히 `추천대로 해 줘`, 카드 밖 요구를 만들지 않는다, 앞서 한 답과 모순하지 않는다, 되묻거나 설명하지 않는다, 단일 선택은 하나만)를 유지하고 두 군데를 바꾼다: ① tool 호출 문장을 "마지막 메시지에 JSON 하나만 쓴다. 질문마다 선택한 값(선택지 `label` 또는 짧은 글)의 배열 하나를 담은 배열: `[[\"Month\"], [\"Export\", \"Share\"]]`. 다른 글, code fence 금지"로. ② 입력은 메시지 안의 `<requirement_card>`, `<earlier_answers>`, `<questions>`뿐이라고 쓴다(옛 글은 카드가 system이었다). 파일을 열거나 명령을 돌리지 않는다.
2. `answer.ts`를 `answers.ts`로 바꿔 쓴다(fetch 길을 지운다). 남는 것: `ANSWER_DEFAULT`, `EarlierAnswer`, `buildAnswers`, 글 만들기 `earlierText(earlier)`·`questionsText(questions)`(옛 파일의 같은 이름 함수. 모양을 바꾸지 않는다). `answerQuestions`, `HumanFetch`, Messages API 요청 조립, 응답 해석, 비용 계산은 모두 지운다.
3. `pending.ts`: 위 계약의 file 입출력 함수. 폴더는 `<evalDir>/<run>/questions/`, 파일은 `<key>.json`(질문)과 `<key>.answer.json`(답). `JSON.stringify(v, null, 2) + "\n"`.
4. `role.ts`: `createHumanRole`을 file 프로토콜로 바꾼다. 허락 부분(`chooseTurn`, `choosePending`, 결정 기록)은 한 줄도 바꾸지 않는다.
   - 질문 처리(tick마다, `sessionSnapshotsList`의 `questions` 각각): key = `questionKey(deps.trial, q.tool_call)`. 이미 보낸 key면 건너뛴다.
     1. 질문 entry를 아직 안 썼으면 `askRead`로 읽어 `writeQuestion`(`card: spec.card`, `earlier`는 이 trial에서 앞서 보낸 답의 복사본)하고 `log("답 대기 <run> <key>")`. `askRead`가 닫힌 오류(`not_found`, `conflict`)면 보낸 것으로 친다(지금과 같다).
     2. `readGivenAnswer`가 있으면 `buildAnswers(questions, given.selected)`로 `AskAnswer[]`를 만들어 `askAnswer`로 보낸다. 성공하면 `record.answers`에 `{ at, session, tool_call, questions, answers, error: null, cost_usd: 0, model: given.model }`를 더하고 `earlier`에 쌓고 보낸 것으로 친다(`acted++`).
     3. 보내기가 닫힌 오류면 보낸 것으로 치고 오류를 기록한다. 닫히지 않은 오류면 `error`와 함께 기록하고, 같은 답으로 매 tick 되풀이하지 않게 그 답 file을 지워 agent가 다시 답할 수 있게 한다(`log("답 거절 <run> <key>: <오류>")`).
     4. 답이 없으면 아무것도 하지 않는다(`waiting()`에 든다). 대기가 있는 동안 60초마다 한 번 `log("답 대기 n개: <run> <key들>")`를 낸다(돌리는 agent가 놓치지 않게).
   - 이유: `ask`는 turn이 답을 기다리는 tool이라 답이 없으면 trial이 시간 상한까지 멈춘다. 그래서 대기를 눈에 띄게 찍는다. 대기 중에는 `waitUntilIdle`이 조용함으로 치지 않는다(idle.ts의 `act` 규칙).
   - `record()`: `model`을 빼고 `definition`만 `human@<n>`으로 둔다.
5. `show.ts`·`main.ts`(`deno task eval:answer`).
   - `renderForAgent`: `def.prompt`, 빈 줄, `<requirement_card>\n${card}\n</requirement_card>`, `<earlier_answers>\n${earlierText(earlier)}\n</earlier_answers>`, `<questions>\n${questionsText(questions)}\n</questions>`. 이 밖의 정보(시나리오 이름, session, 앱, ticket, 진행 상황)를 넣지 않는다.
   - 명령 셋. `<evalDir>`은 `.dev-data/eval`(repo root에서 구한다).
     ```
     deno task eval:answer <run>                          # 답 대기 목록: key, 질문 첫 줄
     deno task eval:answer <run> show <key>               # subagent에게 줄 전문(stdout)
     deno task eval:answer <run> set <key> --model <name> # stdin의 JSON string[][]를 기록
     ```
     `set`: 질문 entry가 없으면 1. 답 file이 이미 있으면 거절(1, "이미 답함. runner가 넣기 전이거나 넣는 중이다"). stdin이 JSON 배열의 배열(`string[][]`)이 아니거나 질문 수와 길이가 다르면 2와 이유(몇 개가 필요한지). 아니면 `writeGivenAnswer`하고 `<key>: 기록`을 찍는다. 값이 비어 있는 질문은 `buildAnswers`가 `추천대로 해 줘`로 채운다. 이 단계에서 선택지 이름을 검사하지 않는다(카드가 답하는 짧은 글도 허용하고, 질문 글 일치는 `buildAnswers`가 보장한다).
     종료 코드: 0 정상(대기 목록이 비어도 0), 1 없는 run·key·덮기 거절, 2 인자 오류.
   - 제품의 `askAnswer` route는 trial의 core를 쥔 runner process가 부른다. 이 CLI는 core에 닿지 않는다(trial마다 core의 주소와 token이 process 안에만 있다). 이유: token을 file에 쓰지 않으려는 것이고, 검사(질문 글 일치, 선택 수)가 `buildAnswers` 한 곳에 남는다.
6. `answer.ts`와 `human_test.ts`의 옛 부분을 지운다. 이 파일이 있던 곳을 부르는 곳은 `human/mod.ts`와 `human/role.ts`뿐이다.
7. runner 이음 줄(`tests/eval/runner/trial.ts`): `createHumanRole({ port: core, fetch: ..., apiKey: deps.key, clock, spec })`에서 `fetch`와 `apiKey`를 뺀다. 대신 `evalDir: deps.evalDir, run: deps.runId, trial: index, log: deps.log`를 준다. 그 밖(spend guard의 `humanSpend`, `humanSummary`)은 건드리지 않는다.

## 정한 것

- **답은 file로 받아 runner가 넣는다.** 사람이 원한 길은 `eval:answer`가 `askAnswer`를 부르는 것인데, trial의 core는 runner process가 쥐고 있어 다른 process의 CLI가 닿으려면 core 주소와 token을 file에 써야 한다. 그러지 않고 같은 검사와 같은 route 호출을 runner 안에 둔다. 결과(제품 `askAnswer`로 답이 들어가는 것)는 같다. 이 결정이 틀렸다면 알려 달라.
- **subagent의 답은 선택한 값의 배열이고, 질문 글은 program이 복사한다.** 옛 길과 같은 이유다: `askAnswer`가 `question`이 글자 그대로 같은 것만 받는다.
- **모델의 오류로 default를 채우는 길이 없어졌다.** 답을 못 받으면 trial은 기다린다(README의 "잃는 것"). 시간 상한(coding 시나리오 90분)이 그 끝이다.
- **`earlier`는 질문 entry를 쓸 때의 값이다.** 같은 시각에 다른 session의 질문이 둘 대기하면 서로의 답을 보지 못한다. 그 trial에서 질문은 보통 한 session(App Engineer)에서 차례로 온다.
- **허락은 건드리지 않는다.** `chooseTurn`, `choosePending`과 결정 기록이 그대로다(roadmap: 허락은 program 규칙).

## 끝남

- `deno task check`가 통과한다. `tests/eval`의 `*_test.ts`는 check에서 돈다. test는 순수하다(임시 폴더 file 읽기·쓰기와 가짜 `tryCall`만, core·subprocess·network 없음).
- 위험 test(옛 `human_test.ts`를 고쳐 둘):
  - 허락 test(`human role decides only by the scenario rule and once per request`)는 `fetch`·`apiKey` 인자만 빼고 그대로 둔다. 규칙 밖 허락이 grant를 만드는 경계다.
  - "질문은 대기 entry가 되고(카드, 앞서 한 답 포함), 답 file이 오면 모든 질문에 순서대로 `question` 글자 그대로의 답이 `askAnswer`로 가며(빈 값은 default, 단일 선택은 하나), 답이 없는 동안은 아무것도 보내지 않고, 보내기가 거절되면 답 file을 지워 다시 답할 수 있다." (가짜 `tryCall`, 임시 폴더. 옛 test의 `answerQuestions` 표 자리에 `buildAnswers` 표를 둔다.)
- 새 subprocess·서버·진짜 provider 호출 test는 없다.
- 남지 않음: `grep -rn "api.anthropic.com\|HumanFetch\|answerQuestions" tests/eval`이 0줄이다. `grep -rn "price_usd_per_mtok\|max_tokens" tests/eval/human`이 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `deno.json`의 `"eval:answer": "deno run --allow-all tests/eval/human/main.ts"`(`--env-file` 없음)
- 안 쓰게 된 export: `answerQuestions`, `HumanFetch`, `HumanDeps`의 `fetch`·`apiKey`, `HumanDefinition`의 `model`·`max_tokens`·`price_usd_per_mtok`
- 정한 것: 위 "정한 것" 밖에서 worker가 정한 것
- 넘길 줄: `tests/eval/runner/trial.ts`의 `createHumanRole` 호출(소유가 ex-cli라 최소로만 고쳤다). 같은 파일의 judge 블록은 ex-judge-agent가 고친다. 겹치지 않았는지 확인한다.
- 계약 바꾸기 요청: `types.ts` 변경이 위와 다르게 필요하면 적는다.
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 진짜 trial에서 대기 → 답 → 제품 `askAnswer` 경로를 돌려 보지 않았다(core가 필요하다. lead가 첫 coding 시나리오에서 본다). 질문이 있는 판단 case(L1 등)에는 `human`이 없어 이 길을 타지 않는다.
