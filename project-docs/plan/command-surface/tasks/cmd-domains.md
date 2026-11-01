# cmd-domains

domain·kind·설정·agent 정의 tool 일곱을 명령으로 옮긴다: `domain.read`, `domain.create`, `kind.list`, `kind.check`, `settings.get`, `agent.create`, `agent.update`.

- 단위: cli (wave 1)
- 선행: cs-foundation. 명령 표와 `lophn` tool이 있어야 한다.
- 소유(이 task만 고친다):
  - `packages/core/domains/**`
  - `packages/core/agent-places/tools/{kind.ts,kind_test.ts,agent.ts,agent_test.ts,settings.ts}`
  - `packages/core/projects/kinds/**`
  - `packages/cli/commands/{domain.ts,domain_test.ts,kind.ts,kind_test.ts,settings.ts,agent.ts,agent_test.ts}`
- 읽을 것:
  - roadmap: `project-docs/products/roadmap/command-surface.md`의 "정한 것" 2~9
  - architecture: `project-docs/architecture/domain.md`, `project-docs/architecture/kinds.md`, `project-docs/architecture/agent-definition.md`(`agent.create`·`agent.update`는 할당을 주지 못한다)
  - 본보기: `packages/cli/commands/`의 job 명령과 그 등록
- 계약:
  - 쓰는 것: cs-foundation의 명령 모양

## 할 일

1. 일곱 tool을 명령으로 옮기고 agent-places·domains 쪽 정의를 지운다. place 종류는 지금 place 목록 그대로다.
2. 부른 쪽에 따라 하던 판단을 core route로 옮긴다. 같은 명령을 binary가 user token으로도 부르기 때문이다.
   - `kind.list`·`kind.check`가 domain이 `ctx.domains` 안인지 보고, 하나뿐이면 생략하게 하는 것: route가 agent credential의 맡은 domain(`packages/core/main/daemon/agent-domains.ts`의 셈)으로 본다. 사람은 domain을 꼭 준다.
   - `domain.create`가 `ownerOf(ctx)`로 place에서 owner를 정하는 것: route가 agent credential의 조건(`conditions.app`·`conditions.project`)으로 정한다. 사람은 owner를 준다.
3. 명령 help는 영어다.

## 끝남

- `npm run check:full`이 통과하고 `boot.sh`가 두 번 `exit 0`이다.
- 위험 test: "agent가 맡지 않은 domain으로 `kind list`를 부르면 core route가 거절한다"(지금 `kind_test.ts`가 보는 것을 route 쪽으로 옮긴다)
- 위험 test: "agent가 `domain create`로 자기 place 그릇 밖에 domain을 만들지 못한다"
- 남지 않음: 옮긴 tool의 정의가 `packages/core/agent-places/tools/`와 `packages/core/domains/agent-tools.ts`에 남지 않는다.

## 보고

- 바꾼 file, 통과한 check
- 등록할 것: 명령 등록 목록, `TOOL_ORDER`·place 목록에서 뺄 이름, `packages/core/agent-places/tools/mod.ts`·`packages/core/main/agent-tools.ts`에서 뺄 것
- 안 쓰게 된 export, 정한 것, 넘길 줄, 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"

## lead가 더함 (cs-foundation merge 뒤)

- 명령 모양: `packages/cli/commands/types.ts`의 `defineCommand({...})`. 칸은 `name`(점 이름), `summary`, `description`, `input`(zod strict object), `positional`(칸 이름), `effect`, `routes: [{name}]`, `places`(`PlaceKind[]`, 빈 목록이면 binary만, 전부면 `PLACE_KINDS`), `run(input, ctx)`. 명령 file은 `JOB_COMMANDS` 같은 배열을 export한다. 본보기는 `packages/cli/commands/job.ts`다.
- `ctx`: `core.read(route, input)`, `core.command(route, input, {key, compare?})`(key는 `lophn` tool에서 tool call id, binary에서 `--idempotency-key`나 무작위), `place`(binary는 undefined, home은 null), `clock`, `signal`. 결과는 `{summary, content, arrayKeys?, text?, failed?, note?}`(`CommandResult`).
- 함정: 내장 tool을 명령으로 옮기면 같은 변경에서 옛 tool 정의와 `packages/core/agent-places/tool-lists.ts`의 그 이름을 지운다. wire 이름이 겹치면 `buildWireTable`이 실패해 그 session의 모든 tool이 "not available"이 된다(`packages/core/main/agent-tools_test.ts`가 잡는다).
- 추가 소유(등록 줄만): `packages/cli/commands/mod.ts`에 이 task의 명령 배열 한 줄, `packages/core/agent-places/tool-lists.ts`에서 옮긴 tool 이름 지우기, `packages/core/main/agent-tools.ts`에서 옮긴 bundle 지우기. 다른 task도 같은 줄을 고치므로 merge 충돌은 lead가 푼다.
