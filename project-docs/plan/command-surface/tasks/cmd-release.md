# cmd-release

배포 tool 일곱을 명령으로 옮긴다: `release.list`, `release.get`, `release.prepare`, `release.activate`, `preview.start`, `preview.call`, `preview.stop`.

- 단위: cli (wave 2)
- 선행: app-layers. 새 선언과 호출 대상 모양을 쓴다.
- 소유(이 task만 고친다):
  - `packages/core/apps/agent-tools/{release.ts,preview.ts}`
  - `packages/cli/commands/{release.ts,release_test.ts,preview.ts,preview_test.ts}`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`의 "정한 것" 2~9
  - 본보기: `packages/cli/commands/`의 job 명령과 그 등록
  - architecture: `project-docs/architecture/activation.md`(`release.activate`는 `waiting_consent`를 돌려주고 막히지 않는다)
- 계약:
  - 쓰는 것: cs-foundation의 명령 모양, app-layers의 호출 대상(operation, command) 모양

## 할 일

1. 일곱 tool을 명령으로 옮기고 agent-tools 쪽 정의를 지운다. place 종류는 지금 place 목록 그대로다.
2. `preview.start`의 기다리기(500 ms마다 60초까지)는 명령 context의 clock과 abort signal로 한다.
3. `preview.call`은 app-layers가 정한 대로 자기 앱 preview의 operation과 command를 부른다. 입력에서 대상을 고르는 꼴은 app-layers의 실제 이름을 따른다.
4. 명령 help는 영어이고, 다른 tool 이름은 명령 꼴로 쓴다.

## 끝남

- `npm run check:full`이 통과하고 `boot.sh`가 두 번 `exit 0`이다.
- 위험 test: 없음(route와 판정은 그대로다)
- 남지 않음: 옮긴 tool 이름이 `packages/core/apps/agent-tools/`에 정의로 남지 않는다.

## 보고

- 바꾼 file, 통과한 check
- 등록할 것: 명령 등록 목록, `TOOL_ORDER`·place 목록에서 뺄 이름, `packages/core/apps/agent-tools/mod.ts`에서 뺄 것
- 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

## lead가 더함 (cs-foundation merge 뒤)

- 명령 모양: `packages/cli/commands/types.ts`의 `defineCommand({...})`. 칸은 `name`(점 이름), `summary`, `description`, `input`(zod strict object), `positional`(칸 이름), `effect`, `routes: [{name}]`, `places`(`PlaceKind[]`, 빈 목록이면 binary만, 전부면 `PLACE_KINDS`), `run(input, ctx)`. 명령 file은 `JOB_COMMANDS` 같은 배열을 export한다. 본보기는 `packages/cli/commands/job.ts`다.
- `ctx`: `core.read(route, input)`, `core.command(route, input, {key, compare?})`(key는 `lophn` tool에서 tool call id, binary에서 `--idempotency-key`나 무작위), `place`(binary는 undefined, home은 null), `clock`, `signal`. 결과는 `{summary, content, arrayKeys?, text?, failed?, note?}`(`CommandResult`).
- 함정: 내장 tool을 명령으로 옮기면 같은 변경에서 옛 tool 정의와 `packages/core/agent-places/tool-lists.ts`의 그 이름을 지운다. wire 이름이 겹치면 `buildWireTable`이 실패해 그 session의 모든 tool이 "not available"이 된다(`packages/core/main/agent-tools_test.ts`가 잡는다).
- 추가 소유(등록 줄만): `packages/cli/commands/mod.ts`에 이 task의 명령 배열 한 줄, `packages/core/agent-places/tool-lists.ts`에서 옮긴 tool 이름 지우기, `packages/core/main/agent-tools.ts`에서 옮긴 bundle 지우기. 다른 task도 같은 줄을 고치므로 merge 충돌은 lead가 푼다.
