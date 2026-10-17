# role-ports

`lophn-agent/register.ts`가 다른 module의 표를 SQL로 직접 읽고 `projects/contexts`를 import하는 것을, 그 module들이 내놓는 읽기 함수와 `core/main`의 조립 file이 꽂는 port로 바꾼다. 같은 조립 file이 role 명령(`ROLE_COMMANDS`)도 role 층에서 꽂는다. 이 뒤 `tools/check-deps.ts`의 `lophn-agent>projects` 예외를 지운다.

- 단위: role-ports (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/register.ts`
  - `packages/core/lophn-agent/commands/{registry.ts,reads.ts,mod.ts,role-prompts.ts}`
  - `packages/core/lophn-agent/agents/ports.ts`
  - `packages/core/agent-roles/commands.ts`
  - `packages/core/projects/lookups.ts`
  - `packages/core/apps/lookups.ts`
  - `packages/core/main/daemon/assembly.ts`
  - `packages/core/main/daemon/wiring/{lophn-agent-team.ts,lophn-agent-registration.ts}`
  - `tools/check-deps.ts`
  - 추가 소유(lead가 더함, 8번 범위만): `packages/core/lophn-agent/agents/{caller.ts,caller_test.ts,commands.ts,reads.ts}`, `packages/core/lophn-agent/tools/domain/{operator-place.ts,operator-place_test.ts}`, `packages/core/agent-roles/tools/operator.ts`의 import 줄
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`("규칙과 그 이유"의 예외 둘, "import를 지우려고 다른 module의 표를 SQL로 직접 읽게 바꾸지 않는다")
  - roadmap: `project-docs/products/roadmap/harness-domain-split.md`("층 규칙의 예외와 숨은 의존", "단계" 5번, 정할 것 6), `project-docs/issues/mistakes.md`의 숨은 SQL 의존
  - 코드: `packages/core/storage/ledger/{reader-worker.ts,writer-assembly.ts,team-module.ts}`(팀 등록 file을 Worker가 어떻게 싣는가)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent`, `agent-roles`
- 계약:
  - 쓰는 것: `lophn-agent/agents/ports.ts`의 `AgentLookups`(이미 port 모양이다), `projects/contexts/mod.ts`의 `contextStatusOf`, `agent-roles/`.
  - 내놓는 것:
    - `packages/core/projects/lookups.ts`: `projectExists(sql, id)`, `projectIds(sql)`, `contextProjectOf(sql, id)`, `activeContextIds(sql, project)`. `packages/core/apps/lookups.ts`: `appExists(sql, id)`, `appIds(sql)`. 표를 가진 module이 자기 표 읽기를 낸다. `sql`은 `Pick<Tx["sql"], "get" | "all">`.
    - `lophn-agent/register.ts`: 다른 module의 표를 읽지 않고 `projects`·`apps`·`agent-roles`를 import하지 않는다. `createLedgerRegistration`, `createReaderRegistration`, `lophnAgentDefinitions`는 `{ lookups, roleCommands }`를 인자로 받는 factory가 된다.
    - `packages/core/main/daemon/wiring/lophn-agent-team.ts`: 팀 등록 file. `AgentLookups`를 `projects/lookups.ts`·`apps/lookups.ts`·`contextStatusOf`로 만들고 `roleCommands`를 `agent-roles/commands.ts`에서 가져와 `register.ts`의 factory에 꽂아 `createLedgerRegistration`, `createReaderRegistration`, `lophnAgentDefinitions`를 내보낸다. `main/daemon/assembly.ts`의 `TEAMS`가 `lophn-agent/register.ts` 대신 이 file을 가리킨다.
    - `agent-roles/commands.ts`: `ROLE_COMMANDS`(옛 `commands/registry.ts`의 표)와 `NEW_APP_PROMPT`·`REPAIR_APP_PROMPT`·`CHECK_CONTRACTS_PROMPT`(옛 `commands/role-prompts.ts`).
    - `commands/registry.ts`의 `buildRegistry({ role, roleCommands, skills })`, `commands/reads.ts`의 `createCommandReads({ skills, roleCommands })`.

## 확인한 것

- reader Worker는 팀 등록 file을 URL로 import해 `createReaderRegistration()`을 인자 없이 부른다(`storage/ledger/reader-worker.ts:27`). writer는 `team.createLedgerRegistration({} as never)`와 `team.lophnAgentDefinitions`를 쓴다(`writer-assembly.ts:166-187`). 그래서 `register.ts`가 module 최상위 const(`agentDeps`, `commandReads`, `skillsReads`, …)를 직접 만들고 다른 module을 import해야 했다. port를 꽂을 자리는 Worker가 싣는 팀 file이고, 그 자리는 `core/main`(조립)이어야 domain·role 층을 둘 다 import할 수 있다. 이미 `main/daemon/wiring/lophn-agent-registration.ts`가 같은 꼴의 팀 file이다(`createCoreRegistration`).
- 따라서 `register.ts` 최상위 const를 factory 안으로 옮기는 것이 이 task의 큰 일이다. 새 팀 file을 reader Worker가 싣는 경로(`TEAMS`에서 module URL이 나오는 곳)에 맞게 `assembly.ts`에 걸어야 한다. 모르면 `grep -rn "TEAMS" packages/core --include=*.ts`로 찾는다.

## 할 일

근거: README `role-ports` 단위, roadmap "단계" 5번.

1. 시작 전에 snapshot을 뜬다: `packages/core/lophn-agent/register.ts`가 등록하는 command 이름, read 이름(route name)의 정렬 목록을 core를 띄우지 않고 `createLedgerRegistration()`·`createReaderRegistration()`에서 뽑아 JSON으로 저장한다(`packages/core/.tmp-probe/`, 끝낼 때 지운다). 끝에 같아야 한다.
2. `projects/lookups.ts`, `apps/lookups.ts`를 만든다. SQL 본문은 `register.ts`의 `placeExists`, `agentLookups`에서 그대로 옮긴다(표를 가진 module로 가는 것이다).
3. `register.ts`를 고친다. `placeExists`, `agentLookups`, `import { contextStatusOf }`를 지우고, 이것들을 쓰는 최상위 const(`agentDeps`, `agentCommands`, `agentReads`, `skillsReads`, `projectExtensionDeps`, `commandReads` 등)를 `{ lookups, roleCommands }`를 받는 factory 안으로 옮긴다. `operatorDirectory(sql)`도 `lookups`를 받게 한다(`main/daemon/wiring/lophn-agent-registration.ts`가 부른다). `AgentLookups`에 모자라는 칸이 있으면 `agents/ports.ts`에 더한다.
4. `main/daemon/wiring/lophn-agent-team.ts`를 만들고 `assembly.ts`의 `TEAMS`가 그것을 가리키게 한다. `lophn-agent-registration.ts`가 부르던 `operatorDirectory`도 `lookups`를 넘긴다.
5. role 명령: `commands/role-prompts.ts`와 `registry.ts`의 `ROLE_COMMANDS`, `promptCommand`를 `agent-roles/commands.ts`로 옮긴다. `buildRegistry`는 `roleCommands`를 인자로 받는다. protocol의 `ROLE_COMMAND_NAMES`와 같아야 한다는 주석 조건은 그대로다.
6. `tools/check-deps.ts`에서 `CORE_LAYER_EXCEPTIONS`의 `"lophn-agent>projects"`와 그 주석 줄을 지운다(집합이 비면 비운 채로 둔다. 규칙 정리는 `layer-checks`).
8. (lead가 더함) Operator의 role→place 규칙 `operatorPlaceAllowed`(`lophn-agent/tools/domain/operator-place.ts`)를 role 층으로 옮긴다. `role-layer-tools`가 옮기려 했으나 harness의 `agents/caller.ts:6`(`agentCallerRule`)과 `agents/commands.ts`·`agents/reads.ts`가 써서 못 옮겼다. `agents/ports.ts`의 `AgentDeps`에 그 규칙을 받는 칸 하나(`operatorPlaceAllowed`나 `agentCallerRule`, 가장 단순한 쪽)를 더하고 `caller.ts`·`commands.ts`·`reads.ts`가 그것을 쓰게 한다. `register.ts`의 factory가 받아 넘기고, 팀 file(`main/daemon/wiring/lophn-agent-team.ts`)이 role 층에서 꽂는다. 그 뒤 `operator-place.ts`와 `_test.ts`를 `tools/move-files.ts`로 `packages/core/agent-roles/tools/`로 옮긴다. `caller_test.ts`는 규칙을 인자로 넘기게 고친다. 남지 않음: `grep -rn "operator-place" packages/core/lophn-agent --include=*.ts`가 0줄이다.
7. 같은 종류의 숨은 SQL이 `lophn-agent/instructions/files.ts`(110, 225줄: `apps.source_path`, `projects` 존재)와 `lophn-agent/models/{commands.ts,reads.ts}`(`projects` 존재)에 있다. 이 task의 방법(lookups를 port로 받기)으로 풀 수 있으면 같이 푼다. 그 file들은 소유가 아니므로 바꾸면 "넘길 줄"에 file:line을 적는다. 못 풀면 고치지 말고 "알려진 미완 동작"에 적는다.

## 끝남

- `deno task check`가 통과한다. core가 뜬다(`lead/boot.sh`가 본다. worker는 AGENTS.md가 정한 `.dev-data/`의 `LOPHN_HOME`으로 한 번 띄운다).
- 동작 비교: 1번의 command·read 이름 목록 전후가 같다. 명령 목록 read(`commandsList`)가 role마다 전과 같은 항목을 낸다. 이를 보는 기존 test가 있으면 통과한다(`commands/`·`register` 관련).
- 위험 test: 없음 (옮기기와 port로 바꾸기뿐이다)
- 남지 않음:
  - `grep -nE "from \"\.\./(projects|apps|problems)/|select .* from (projects|apps|contexts)" packages/core/lophn-agent/register.ts`가 0줄이다.
  - `grep -n "lophn-agent>projects" tools/check-deps.ts`가 0줄이다.
  - `grep -rn "agent-roles" packages/core/lophn-agent --include=*.ts`가 0줄이다.
  - `packages/core/lophn-agent/commands/role-prompts.ts`가 없다.
  - `packages/core/.tmp-probe/`가 없다.

## 지켜야 할 것(계획 README)

- 동작을 바꾸지 않는다. agent가 보는 tool 목록과 입력이 role마다 나누기 전과 같아야 한다(`tools/registry_test.ts`가 role별 목록을 본다).
- tool 정의 file은 agent runtime child에서 실린다. domain의 store나 DB 코드를 import하지 않는다(`layers.md` "실행 때 import가 뜻하는 것").
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 (`assembly.ts`는 이 task가 고친다. 다른 계획이 같은 file을 고쳤으면 lead가 rebase에서 합친다)
- 안 쓰게 된 export: 없음
- 정한 것: lookups 함수의 이름과 자리, 팀 file을 Worker가 싣는 경로
- 넘길 줄: 7번에서 소유 밖을 고친 곳
- 계약 바꾸기 요청: 없음이 기본
- **무겁게 짠 것**: 없음이 기본. 있으면 `무엇 / 왜 / 줄인다면 / 어디`
- **알려진 미완 동작**: 7번에서 못 푼 숨은 SQL. 못 끊어서 `check-deps.ts` 예외를 남겼다면 그 이유
