# agent-definition-instructions

지침 층을 전역, project(`LOPHN.md`), agent 셋으로 줄이고, 지침을 model call 직전마다가 아니라 turn 시작에 한 번 읽게 바꾼다. `app` 층은 없앤다. lophn은 project 지침을 prompt에 넣지 않고 `instructions.read` route로만 읽는다.

- 단위: agent-definition (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/instructions/` 전체 (`files.ts`, `model.ts`, `preview.ts`, `read.ts`, `work.ts`, `mod.ts`)
- 읽을 것:
  - spec: S4 5장(층과 순서, 바뀔 때), 11장 11 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S8 9장 5(앱 place의 project 지침) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - inventory: `I2.4#25`, `I2.4#26`(읽는 쪽), `I2.4#27`, `I3.4#20`(route 쪽. tool은 agent-tools-work)
  - 결정: `../README.md` 3장 #5(agent runtime은 core 호출로 받는다)
- 계약:
  - 쓰는 것: `protocol/lophn-agent/instructions.ts`의 `instructionsGet`, `PROMPT_INSTRUCTION_LAYERS`, `PROJECT_INSTRUCTION_FILE`(contract-agent-tools-config), role과 place 값(contract-calls-places), 앱 source가 속한 등록 project를 찾는 읽기(`core/projects/ports.ts`, contract-calls-places)
  - 내놓는 것: `readTurnInstructions(deps, session)`(turn 시작에 부르는 함수. 층별 본문과 hash를 돌려준다), `instructionsGet`의 core handler 함수

## 할 일

1. 층 정리 (`I2.4#25`): `InstructionLayerKind`를 `global`, `project`, `agent`로 줄인다. `app` 층(`<data root>/apps/<앱>/LOPHN.md`)과 `readLayer`의 `app` 분기를 지운다. 쓰는 곳이 `files.ts`, `read.ts`, `model.ts` 밖(run-loop, session 등)에 남아 있으면 지우지 못한 이름을 보고에 적는다.
2. place에서 project 찾기: 앱 place의 agent는 앱 source 폴더가 등록 project 안에 있으면 그 project의 `LOPHN.md`를, 없으면 project 지침 없이 돈다 (S8 9장 5). project place의 agent는 그 project의 `LOPHN.md`다. `instructionPlace`의 "session place를 따른다"를 이 규칙으로 바꾼다.
3. lophn (`I2.4#27`): lophn은 place가 없으므로 `readTurnInstructions`가 project 층을 비워 돌려준다. lophn이 다른 project의 `LOPHN.md`를 읽는 길은 `instructionsGet`에 `project`를 주는 것뿐이다.
4. turn 시작에 읽기 (`I2.4#26`): `readTurnInstructions(deps, session)`이 층 순서(`PROMPT_INSTRUCTION_LAYERS`)대로 읽어 `{ layer, text, hash, status }` 목록을 돌려준다. 도는 turn은 이 결과를 끝까지 쓴다. 매 model call 직전에 다시 읽는 `work.ts`의 `resolveInstructions` 호출 경로는 새 입구가 생기면 쓰는 곳이 없어지므로, 옛 함수는 `prompt-assembly`의 옛 `assemblePrompt`가 쓰는 동안 남기고 보고에 적는다. 한 층이라도 읽기 실패(파일은 있는데 못 읽음)나 상한(`INSTRUCTION_FILE_MAX_BYTES` 32 KiB) 초과면 turn을 시작하지 않고 이유를 돌려준다 (사람이 쓴 지침을 조용히 빼지 않는다). 파일이 없는 것은 부재로 정상이다.
5. route handler (`I3.4#20`): `instructionsGet`의 handler. `layer`가 `global`이면 전역 파일, `project`이면 `project` 칸이 있을 때만 그 project의 `LOPHN.md`(없으면 session의 place가 가리키는 project), `agent`이면 그 session의 agent 정의 본문이다. `project` 칸은 요청한 session의 role이 lophn일 때만 받고, 다른 role이 session의 place 밖 project를 주면 `forbidden`이다. 본문은 base64로 주고 상한은 contract대로다. 로컬 경로를 어느 칸에도 싣지 않는다.
6. `read.ts`: `instructionFilesOverCore`가 `instructionsGet`을 session으로 부르게 바꾼다 (run 대신 session). 옛 `ReadInstructionFile`을 부르는 코드는 새 입구로 옮기고, 옛 route handler는 register.ts(agent-definition-register)가 내릴 때까지 남긴다.
7. `preview.ts`(전역 앞부분 미리보기)는 그대로 둔다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "lophn이 아닌 role은 자기 place 밖 project의 LOPHN.md를 읽지 못한다" — `instructions/read_test.ts`가 role과 요청한 project의 조합을 표로 돌려 허용과 `forbidden`을 본다. 임시 폴더에 project 폴더 둘과 `LOPHN.md`를 만든다.
- 남지 않음: `grep -rn "layer: \"app\"\|'app'" packages/core/lophn-agent/instructions`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `instructionsGet` handler를 core에 등록하는 줄은 agent-definition-register가 한다
- 안 쓰게 된 export: 옛 `resolveInstructions`·`ReadInstructionFile` handler·`INSTRUCTION_LAYERS` 사용처
- 정한 것: 읽기 실패를 turn 시작 거절로 다루는 것, 층 결과 모양
- 계약 바꾸기 요청: 앱 source가 속한 등록 project를 찾는 읽기가 contract에 없으면 그 이름
