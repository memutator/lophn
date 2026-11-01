# cmd-workflows

workflow tool 다섯(`workflow.list`, `workflow.get`, `workflow.report`, `workflow.edit`, `workflow.check`)을 명령으로 옮기고, binary에만 있던 `workflow start|report|stop|show`와 한 벌로 합친다.

- 단위: cli (wave 1)
- 선행: cs-foundation. 명령 표와 `lophn` tool이 있어야 한다.
- 소유(이 task만 고친다):
  - `packages/core/workflows/**`
  - `packages/cli/commands/{workflow.ts,workflow_test.ts}`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`의 "정한 것" 2~9
  - architecture: `project-docs/architecture/workflow.md`("agent tool과 CLI")
  - 본보기: `packages/cli/commands/`의 job 명령과 그 등록
- 계약:
  - 쓰는 것: cs-foundation의 명령 모양

## 할 일

1. 한 가지 일에 명령 하나다. `workflow.report` tool과 binary `workflow report`는 같은 `workflowReport` route를 부르는 한 명령이 되고, 부른 쪽(agent session 또는 사람)은 core가 credential로 안다. `workflow.get`과 `workflow show`도 같다. 지금 binary 명령만 있던 `start`, `stop`은 place 종류를 지금처럼 비운다(binary만). 사람만 하는 일이 아니면 lophn agent에게 열지는 이 task가 정하고 근거를 적는다.
2. agent-tools 쪽 정의를 지운다. place 종류는 지금 place 목록 그대로다.
3. 명령 help는 영어다.

## 끝남

- `npm run check:full`이 통과하고 `boot.sh`가 두 번 `exit 0`이다.
- 위험 test: 없음(route와 판정은 그대로다)
- 남지 않음: `packages/core/workflows/agent-tools.ts`가 없다. 같은 route를 부르는 명령이 둘 남지 않는다.

## 보고

- 바꾼 file, 통과한 check
- 등록할 것: 명령 등록 목록, `TOOL_ORDER`·place 목록에서 뺄 이름, `packages/core/main/agent-tools.ts`에서 뺄 bundle
- 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

## lead가 더함 (cs-foundation merge 뒤)

- 명령 모양: `packages/cli/commands/types.ts`의 `defineCommand({...})`. 칸은 `name`(점 이름), `summary`, `description`, `input`(zod strict object), `positional`(칸 이름), `effect`, `routes: [{name}]`, `places`(`PlaceKind[]`, 빈 목록이면 binary만, 전부면 `PLACE_KINDS`), `run(input, ctx)`. 명령 file은 `JOB_COMMANDS` 같은 배열을 export한다. 본보기는 `packages/cli/commands/job.ts`다.
- `ctx`: `core.read(route, input)`, `core.command(route, input, {key, compare?})`(key는 `lophn` tool에서 tool call id, binary에서 `--idempotency-key`나 무작위), `place`(binary는 undefined, home은 null), `clock`, `signal`. 결과는 `{summary, content, arrayKeys?, text?, failed?, note?}`(`CommandResult`).
- 함정: 내장 tool을 명령으로 옮기면 같은 변경에서 옛 tool 정의와 `packages/core/agent-places/tool-lists.ts`의 그 이름을 지운다. wire 이름이 겹치면 `buildWireTable`이 실패해 그 session의 모든 tool이 "not available"이 된다(`packages/core/main/agent-tools_test.ts`가 잡는다).
- 추가 소유(등록 줄만): `packages/cli/commands/mod.ts`에 이 task의 명령 배열 한 줄, `packages/core/agent-places/tool-lists.ts`에서 옮긴 tool 이름 지우기, `packages/core/main/agent-tools.ts`에서 옮긴 bundle 지우기. 다른 task도 같은 줄을 고치므로 merge 충돌은 lead가 푼다.
