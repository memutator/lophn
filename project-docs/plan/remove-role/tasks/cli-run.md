# cli-run

`lophn run`이 agent 이름과 place(`--project`, `--app`)를 받아 `AgentAddress`로 run을 시작하게 한다. `pm:`, `ae:`, `operator:` 꼴과 `NamedAgent` JSON을 지운다.

- 단위: cli (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/coding-agent/cli/commands/run.ts`
  - `packages/coding-agent/cli/{help,parser,main_test}.ts`
  - `packages/protocol/coding-agent/cli-commands.ts`
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `packages/coding-agent/cli/main.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/run.md`의 "지키는 것"(시작: 이름이 안 풀린 첫 시도는 session도 run도 남기지 않는다)과 "CLI와 자격"(명령, 종료 코드, 자격). 이 문서의 `--agent` 꼴 줄은 lead가 이 task를 합칠 때 고친다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `coding-agent-cli-interface`, `runs`. `project-docs/module-catalog.yaml`의 `packages/coding-agent`
  - 제품 결정: `project-docs/plan/remove-role/README.md` "주소와 넘기기"의 "CLI `lophn run`은 agent 이름과 place(`--project`, `--app`)를 받는다. `pm:`, `ae:`, `operator:`는 지운다", "call의 `to`는 ... `agent`는 이름이고, place가 없으면 home이다"
  - 계약 모양: `project-docs/plan/remove-role/tasks/contract-agent.md`의 `AgentAddress`·`placeNameSchema`·`LOPHN_AGENT_NAME`, `project-docs/plan/remove-role/tasks/runs-core.md`의 `StartRun`·run 기록 `target` 꼴과 "CLI `run`은 이 task 동안 옛 `--agent` 글을 `AgentAddress`로 옮겨 넘긴다"
  - 코드:
    - `packages/coding-agent/cli/commands/run.ts`: `runAgent`, `start`, 그리고 `runs-core`가 남긴 옛 글 옮김(`pm:`·`ae:`·`operator:` → `AgentAddress`)
    - `packages/coding-agent/cli/parser.ts`: `VALUE_FLAGS`, `FLAG_KEYS`, `ParsedArgs`
    - `packages/coding-agent/cli/main.ts`(읽기만, 소유 밖): 줄 226-238이 flag 값을 command 입력 칸으로 하나씩 옮기고 `--step`이 위치 인자 `<step>`을 덮지 못하게 막는다
    - `packages/coding-agent/cli/help.ts`: 도움말은 command 입력 schema에서 만든다(`fieldsOf`, `userInputLines`)
    - `packages/protocol/coding-agent/cli-commands.ts`의 `user("agent run", …)`
    - `packages/protocol/runs/runs.ts`의 `runStart`(runs-core가 바꾼 뒤의 꼴)
    - `packages/coding-agent/cli/main_test.ts`의 `runRecord`
- 계약:
  - 쓰는 것: `runs-core`가 바꾼 `StartRun`(`agent?: AgentAddress`)과 run 기록 꼴. `contract-agent`의 `AgentAddress`.
  - 내놓는 것: `lophn run`의 agent 칸은 agent 이름(없으면 lophn), place는 `--project <이름|id>`·`--app <이름|id>` 가운데 하나(없으면 home)다(README "CLI `lophn run`은 agent 이름과 place를 받는다").

## 할 일

`run` 명령의 agent·place 입력과 도움말을 새 꼴로 바꾸고 `runs-core`가 남긴 옛 글 옮김을 지운다. 명령 이름은 지금 그대로 `lophn agent run <prompt>`다(README의 "`lophn run`"은 이 명령을 말한다).

1. `packages/protocol/coding-agent/cli-commands.ts`의 `agent run` 입력 schema(근거: README "CLI `lophn run`", `coding-agent-cli-interface`):
   - `agent`: `z.string().min(1).optional()`, 설명 "agent 이름 (없으면 lophn)". 옛 꼴 목록 글(`lophn | pm:<project> | ae:<app> | operator:… | NamedAgent JSON`)을 지운다.
   - `project`: `z.string().min(1).optional()`, 설명 "place가 될 project의 이름이나 id. --app과 같이 쓰지 않는다".
   - `app`: `z.string().min(1).optional()`, 설명 "place가 될 앱의 이름이나 id. --project와 같이 쓰지 않는다".
   - `session`, `schema`, `async`, `input`은 그대로다. 도움말은 이 schema에서 나오므로 `--project <project>`, `--app <app>` 줄이 저절로 생긴다.
2. `packages/coding-agent/cli/parser.ts`: `--project`, `--app`을 값 flag로 더한다(`VALUE_FLAGS`, `FLAG_KEYS`, `ParsedArgs`의 `project`·`app`, 처음 값 `undefined`). 머리 주석의 flag 설명이 있으면 맞춘다.
3. `packages/coding-agent/cli/main.ts`: 이 file은 지금 소유에 없다(뼈대 문제로 보고했다). 이 brief의 소유 줄에 `packages/coding-agent/cli/main.ts`가 없으면 1, 2, 4, 5를 끝내고 이 단계는 하지 말고 보고의 "알려진 미완 동작"에 "flag 둘이 command 입력에 닿지 않는다"로 적는다. 소유에 있으면 두 가지를 더한다.
   - `parsed.project`, `parsed.app`을 `candidate.project`, `candidate.app`으로 옮긴다(`parsed.agent` 줄 옆).
   - `tool call <app> <tool>`은 위치 인자 `app`을 받는다. `--app`이 그것을 덮지 못하게 `--step`과 같은 모양으로 막는다: `slots.includes("app")`인데 `--app`이 있으면 `invalid_input` "<app> 위치 인자와 --app을 같이 쓰지 않는다".
4. `packages/coding-agent/cli/commands/run.ts`(근거: `run.md` "지키는 것", contract-agent의 `AgentAddress`):
   - 지운다: `AGENT_FORMS`, `resolveAgent`, `runs-core`가 남긴 옛 글 옮김, `NamedAgent` import, `start`의 후보 두 개 재시도(`inputs[1]`). `--project`·`--app`이 place 종류를 말하므로 이름을 두 번 풀 일이 없다. `start`는 입력 하나를 받는다.
   - `runAgent`:
     - `--session`이 `--agent`·`--project`·`--app` 가운데 하나와 같이 오면 `invalid_input` "--session은 --agent·--project·--app과 같이 쓰지 않는다". 지금 `--agent`와 `--session` 검사 자리에서 한다.
     - `--project`와 `--app`이 같이 오면 `invalid_input` "--project와 --app은 같이 쓰지 않는다".
     - `--session`이 없으면 `agent: AgentAddress` = `{ agent: input.agent ?? LOPHN_AGENT_NAME }`에 `--project`면 `place: { project }`, `--app`이면 `place: { app }`를 더한다. place가 없으면 home이다(README).
     - `runStart` 입력은 지금의 `base`(`kind: "agent"`, `prompt`, 있으면 `input`·`session`·`schema`)에 `--session`이 없을 때만 `agent`를 더한 것이다. `runs-core`가 정한 `StartRun` 꼴(`agent`와 `session` 가운데 정확히 하나) 그대로다.
   - 머리 주석(`lophn agent run`, …)은 그대로 두되 role 말이 있으면 지운다.
5. `packages/coding-agent/cli/main_test.ts`: `runRecord`의 `target`을 runs-core가 정한 기록 꼴 `{ agent: { agent: "lophn", place: null } }`로 바꾼다. 다른 행은 건드리지 않는다.
6. `packages/coding-agent/cli/help.ts`: 1의 schema만으로 도움말이 맞으면 고치지 않는다. role 말이나 옛 `--agent` 꼴이 남았으면 지운다.

## 정한 것

- `--session`은 `--agent`·`--project`·`--app` 셋 모두와 같이 쓰지 않는다. 이유: 이어 쓰는 session의 agent와 place는 열 때 정해져 바뀌지 않는다(README "session의 정체는 (agent id, place)다"). 같이 받으면 어느 쪽이 맞는지 CLI가 정할 수 없다.
- `--project`·`--app` 값은 이름이나 id를 그대로 넘기고 CLI에서 풀지 않는다. 이유: `placeNameSchema`가 이름이나 id를 받고 core의 `resolveAddress`가 푼다. CLI가 따로 풀면 규칙의 사본이 생긴다.
- 위험 test를 더하지 않는다. 이유: CLI 입력 모양은 AGENTS.md "속도"의 위험 목록(데이터 잃기, 권한·secret 경계, 두 번 고친 bug)에 들지 않는다. user token이 출력에 남지 않는 `main_test.ts`의 행이 그대로 경계를 본다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음. `packages/coding-agent/cli/main_test.ts`의 "user token으로 부른 run show는 token을 출력에 남기지 않는다" 네 행이 그대로 통과한다.
- 손 확인: `node packages/coding-agent/cli/main.ts agent run --help`가 `--agent`, `--project`, `--app`, `--session` 줄을 내고 `pm:`·`ae:`·`operator:` 글이 없다.
- 남지 않음:
  - `grep -rn 'pm:\|ae:<\|operator\|Operator\|NamedAgent\|project_manager\|app_engineer\|resolveAgent\|AGENT_FORMS' packages/coding-agent/cli packages/protocol/coding-agent/cli-commands.ts`가 0줄이다.
  - `grep -rn 'role' packages/coding-agent/cli packages/protocol/coding-agent/cli-commands.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
