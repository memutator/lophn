# agent-definition-prompt

prompt 조립을 S4 6장 순서로 바꾼다: 층 순서, tool 목록 블록, skill 목록, place 정보(role별 표, 부를 수 있는 agent 목록), context 글, 바뀜 notice. 순수 함수로 짓는다. IO는 호출하는 쪽(router의 run-loop)이 하고 이 task는 값을 받아 글을 만든다.

- 단위: agent-definition (wave 3)
- 선행: agent-definition-input-tags (`noticeInput`, `attachedInput`을 import한다)
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/prompt-assembly/` 전체 (`input-tags.ts`와 그 test는 agent-definition-input-tags 것이니 고치지 않는다)
- 읽을 것:
  - spec: S4 5·6장(층과 순서, 바뀔 때, 입력 꼴, compact, place 정보, context 글, 넣지 않는 것) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - 조사: `/home/pyosechang/projects/lophn/project-docs/tmp/claude-code-prompt-assembly copy.md`
  - inventory: `I1.4#16`, `I2.4#24`, `I2.4#26`(notice와 compact 쪽. 지침을 turn 시작에 읽는 쪽은 agent-definition-instructions), `I2.4#30`, `I3.4#10`, `I3.4#23`, `I3.4#24`, `I3.4#30`
  - 같이 읽는 줄(다른 단위 몫): `I2.4#9`(skill 목록 위치. 줄은 router 몫이지만 목록 글은 이 task가 만든다), `I2.4#13`(tool 목록을 session 시작에 고정하는 일은 router), `I2.4#31`(compact 실행은 places-sessions의 `session/compactor`), `I1.9#7`(이 task는 `prompt-assembly/turn-context.ts`만 지운다. shell 쪽과 `run-loop/turn.ts`의 `gatherView`는 각 단위 몫)
  - 결정: `../README.md` 3장 #41
- 계약:
  - 쓰는 것: `protocol/lophn-agent/context-text.ts`(`contextTextSchema`, `CONTEXT_TEXT_LEVELS`, `CONTEXT_TEXT_TAG`), `protocol/lophn-agent/input-tags.ts`의 `NOTICE_KINDS`(contract-agent-tools-catalog), `toWireToolName`, role 값(contract-calls-places)
  - 내놓는 것: 아래 함수. router의 run-loop와 agent-tools-context(`buildContextText`)가 쓴다.

## 할 일

남이 쓰는 export는 지우지 않고 새 함수를 옆에 더한다. 지우지 못한 옛 이름은 보고의 "안 쓰게 된 export"에 적는다. 먼저 `grep -rn "prompt-assembly" packages/core --include=*.ts`로 밖에서 쓰는 이름을 센다(run-loop, session, providers adapter가 쓴다).

1. 층 순서 (`I2.4#24`): 새 입구 `assembleTurnPrompt(input, deps)`를 둔다. 순서는 자주 안 바뀌는 것이 앞이다.
   1. built-in role 지침과 고정 규칙 (고정 본문. 입력은 role 지침 글 하나다)
   2. tools: 공통, role별, grant tool. 목록은 session을 시작할 때 고정한다. deferred tool은 이름만 둔다. model에 보내는 이름은 `toWireToolName`을 거친다.
   3. 지침 층: 전역, project(`LOPHN.md`), agent를 이어 붙인다. lophn은 `LOPHN.md`가 없다. 지침은 `input.instructions`로 받는다. 이 함수는 file을 읽지 않는다 (agent-definition-instructions가 turn 시작에 읽는다).
   4. skill 목록: 이름과 설명만. 꺼진 skill은 뺀다.
   5. place 정보 (아래)
   6. 대화: 입력, 답, tool 결과. 바뀜 notice는 끝에 덧붙인다.
   cache 경계는 1~5 사이에 둔다. `PromptLayerKind`, `SystemLayerKind`, `systemBlocks`를 새 순서에 맞게 더하고, 옛 `assemblePrompt`와 `InstructionDeps`를 쓰는 곳은 그대로 둔다.
2. place 정보 (`I3.4#24`, `I3.4#30`): `placeInfo(role, data, budget)` 순수 함수. `data`는 호출하는 쪽이 core 읽기로 모은 값이다 (project, 앱, context, agent 목록).
   - 모두: 자기 role과 이름. grant 안의 다른 agent마다 role, 이름, place, 한 줄 설명 (call의 `to`를 짐작 없이 쓰게). place에 놓인 role이면 project일 때 이름, 목적, 폴더와 폴더 설명, 지정한 하위 폴더와 그 설명, 앱일 때 앱 이름, 목적, source 폴더.
   - Operator: 붙은 context마다 context 글. grant 안의 앱마다 이름과 목적. 같은 project의 context만 넣는다.
   - App Engineer: 자기 앱의 이름, 목적, source 폴더, blueprint 파일 경로, 활성 release와 그 app-api 이름 목록.
   - lophn: project 목록, 앱 목록, context 목록(이름과 한 줄, 예산 안). project 지침은 넣지 않는다.
   - Project Manager: 자기 project의 context마다 context 글 (예산을 넘으면 이름과 한 줄).
   - 열린 session 목록과 앱 화면의 상태는 넣지 않는다.
3. context 글 (`I2.4#30`): `buildContextText(read)`가 `contextTextSchema` 값을 만들고(적용된 판에서 결정적으로. 계약 원문은 넣지 않는다), `renderContextText(text, level)`이 `<lophn-context name version>` 글로 쓴다 (S4 6장의 예시 꼴). 같은 판이면 같은 글이다. 예산은 `budget`으로 받는다(session을 시작할 때 고정). 넘으면 `names`(이름과 한 줄), 그래도 넘으면 `count`(개수와 list tool 안내만). 다른 context의 type은 `context/Type`으로만 쓴다. project 정보가 place 정보의 project 줄과 같으면 한 번만 둔다. 옛 `context-overview.ts`, `material.ts`의 context 자료(overview와 용어집을 예산이 넘으면 줄이던 것)를 이것으로 대신한다.
4. 바뀜 notice (`I2.4#26`, `I3.4#10`, `I3.4#23`): `SeenBasis` 값(지침 층별 hash, tool 이름 목록 hash, context 목록과 판 번호와 용어집 hash, 부를 수 있는 agent 목록 hash)과 `diffBasis(seen, now)` 순수 함수를 둔다. turn이 시작할 때 지난 turn이 본 판과 비교해 바뀐 것마다 `noticeInput`으로 notice를 만든다.
   - 지침이 바뀌었으면 "지침이 바뀌었다"와 바뀐 층의 새 전문을 붙인다 (`instructions_changed`).
   - tool 목록이 바뀌었으면 `tools[]`는 그대로 두고 무엇이 더해지고 빠졌는지만 쓴다 (`tools_changed`). program이 쓴 문장만 쓴다. 앱이 쓴 글은 넣지 않는다.
   - context 목록이 바뀌면 더해지고 빠진 것을, 새 판이 적용되거나 용어집이 바뀌면 그 context 글의 새 전문을 붙인다 (`contexts_changed`).
   - 부를 수 있는 agent 목록이 바뀌면 `agents_changed`.
   - compact할 때는 notice 대신 최신 값으로 1~5를 다시 만든다: `assembleTurnPrompt`가 `SeenBasis` 없이 불리면 notice가 없다.
   `SeenBasis`를 session 기록에 쓰는 일은 router와 places-sessions 몫이다. 보고에 필요한 저장 칸을 적는다.
5. skill 목록 글 (`I2.4#9`의 글): `skillListText(skills)`가 이름과 설명을 쓴다. 꺼진 skill은 뺀다. skill 본문은 `skill.read`로 읽으므로 싣지 않는다.
6. 지움: `compaction.ts`의 계산 함수(`compactionNeeded`, `precheckCompaction`, `compactionTarget`, `mergeStepInputCap`, `recentHistoryBudget`, `splitChunks`, `historyCut`, `checkCompletion`, `shrinkResultText`)는 쓰는 곳이 없으므로 지운다 (`I1.4#16`). 요약 request에 필요한 `summaryOutputCap`은 남긴다. `turn-context.ts`, `TurnContextBasis`, `withTurnContext`를 지운다. `run-loop`나 `ContextBasis.turn_context`가 아직 쓰면 지우지 않고 보고한다.
7. `model.ts`의 `HistoryPart`에 tool 결과 안의 이미지를 담는 part(`media_type`, `data_base64`)를 더한다. 남이 쓰는 type이라 더하기만 한다. agent-tools-file의 `image.read` 결과 `{ image: { media_type, data_base64 } }`를 provider 쪽(agent-definition-models)이 image block으로 바꾸려면 필요하다.
8. `mod.ts`에 새 함수를 올린다 (agent-definition-input-tags가 한 줄 더한 파일을 이어서 쓴다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - "context 글이 같은 판에서 같다" — `context-text_test.ts`가 같은 판을 두 번 만들어 글이 바이트까지 같고, 입력 배열 순서를 섞어도 같은 것을 본다.
  - "읽을 자격 없는 context는 prompt에 없다" — `place-info_test.ts`가 Operator에게 다른 project의 context와 붙지 않은 context를 주어 place 정보에 나오지 않는 것을 본다.
- 남지 않음: `grep -rn "compactionNeeded\|precheckCompaction\|historyCut\|splitChunks" packages`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 없음
- 안 쓰게 된 export: 옛 `assemblePrompt`, `PromptDeps`(`InstructionDeps`), `PromptLayerKind`의 옛 값, `turn-context.ts`에서 남긴 것, `wireData`를 쓰는 `material.ts`·`summary.ts` 조각
- 정한 것: 예산 단위(글자 수. 값은 인자), `SeenBasis`의 칸, notice 본문 문구, place 정보 블록 제목
- 계약 바꾸기 요청: `data`를 채울 core 읽기(project·앱·context·agent 목록)가 contract에 없으면 그 이름. `SeenBasis` 저장 칸
