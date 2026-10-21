# wf-decl-reader

role 층에 workflow 선언 reader를 만든다: 모든 active domain의 `workflows/*.md`를 읽어 꼴을 검사하고, 참가자를 agent로 풀고, 이 agent가 참가자인 workflow를 가려낸다. 그 reader를 `ToolContext.workflows`에 꽂고, 선언과 오류를 돌려주는 읽기 tool `workflow.list`를 더한다.

- 단위: decl (wave 2)
- 선행: wf-contract-shapes
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/workflows/{read.ts,files.ts}` (새 file)
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `packages/core/domains/agent-tools.ts`
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/lophn-agent/run-loop/runtime-access.ts`
- 읽을 것:
  - 계획: `project-docs/plan/workflow/README.md`의 "정한 것"(참가자는 그릇을 건넌다, 틀린 선언은 그 file만 뺀다)과 "뼈대 검토에서 정한 것"(모든 active domain을 읽는다, 열쇠는 `<domain>/<이름>`, 풀리지 않는 참가자는 file 전체를 뺀다, 한 agent가 참가자 둘이면 오류)
  - architecture: `project-docs/architecture/agent-call.md`("받는 쪽의 앱과 project는 정확히 맞아야 풀린다"), `project-docs/architecture/domain.md`("읽기는 그릇 안이다", "`DOMAIN.md`·`kinds.yaml`·`skills/`는 그 그릇의 PM이나 App Engineer만 쓴다"), `project-docs/architecture/agent-definition.md`("role의 tool 목록은 코드가 고정한다", "agent credential의 operation 상한은 route 이름이다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `domains`, `run-loop`, `agent-tool-spi`; `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`, `packages/core/domains`, `packages/core/main`
  - import 규칙: `tools/check-deps.ts`(`core-layer`, `tool-file`: `packages/core/domains/agent-tools.ts`는 base, protocol, 같은 폴더, `lophn-agent/tools/spi.ts`만 import한다)
  - 본보기(코드): Router의 이름 풀기 `packages/core/agent-roles/place/session-directory.ts`(`resolveNamed`)와 그 lookup `packages/core/main/daemon/wiring/lophn-agent-registration.ts`(`projectByName`은 id나 이름, `appByName`은 id·slug·이름), frontmatter 읽기 `packages/core/lophn-agent/agents/definition-file.ts`(`@std/yaml`의 `parse`, `schema: "core"`), machine 자격 읽기 `packages/core/main/agent-runtime/product-driver.ts`(`callerDomains`, `turnSkillReader`), 읽기 tool `packages/core/domains/agent-tools.ts`(`domain.list`), `packages/core/lophn-agent/tools/bundles/skill.ts`(`routes: []`로 port를 읽는 tool)
- 계약:
  - 쓰는 것:
    - `packages/protocol/lophn-agent/workflow-file.ts`의 schema, `WorkflowDeclaration`, `WorkflowError`, `WorkflowListing`, `WorkflowMembership`, `WorkflowRead`, `checkWorkflowStructure`, `workflowKey`
    - `domainWorkflowsFolder`(`packages/protocol/domains/paths.ts`)
    - `WorkflowReader`(`packages/core/lophn-agent/tools/ports.ts`), `ToolPorts`의 `workflows`(`packages/core/lophn-agent/run-loop/prepare.ts`)
    - machine 자격 읽기 `domainList`, `projectApi.list`, `appList`, `agentDefinitionList`. `domainList`는 이미 `RUNTIME_MACHINE_ROUTES`에 있고 나머지 셋은 이 task가 더한다. `projectApi.list`의 `machine` actor는 `wf-contract-shapes`가 연다.
  - 내놓는 것:
    - `WorkflowFiles = { list(domain: string): Promise<Result<readonly { file: string; text: string }[]>> }` — `<data>/domains/<dom>/workflows/` 바로 아래 `*.md`를 이름순으로 준다. 폴더가 없으면 빈 목록이다. `files.ts`에 fs 구현 `productWorkflowFiles(root)`.
    - `readWorkflows(input: { core: CoreCall; self: AgentRef; place: Place | null; files: WorkflowFiles }): Promise<Result<WorkflowRead>>` — `core`는 runtime의 machine 자격이다. 모든 active domain의 폴더를 읽는다. `listing`은 `place` 그릇의 domain 것(null이면 전부), `memberships`는 `self`가 참가자로 풀리는 선언이다. 참가자 풀기는 Router와 같은 정확한 이름 맞춤이다.
    - product-driver의 `toolPorts`가 `workflows: { read: () => readWorkflows(...) }`를 꽂는다(machine 자격, `session.agent`, `session.place`).
    - tool `workflow.list`(`DOMAIN_AGENT_TOOLS`): 입력 `{}`, 결과 `WorkflowListing`. 모든 role의 읽기 tool 목록과 `TOOL_ORDER`에 든다.

## 할 일

1. `packages/core/agent-roles/workflows/files.ts`(새 file)
   - `WorkflowFiles` type(계약 모양)을 둔다. `file`은 file 이름(`eval.md`)이다.
   - `productWorkflowFiles(root: string): WorkflowFiles` — `domainWorkflowsFolder(root, domain)`을 `Deno.readDir`로 읽어, 이름이 `.md`로 끝나는 보통 file(`isFile`. symlink와 폴더는 뺀다)만 `Deno.readTextFile`로 읽고 이름순으로 낸다. 폴더가 없으면(`Deno.errors.NotFound`) `ok([])`, 그 밖의 오류는 `unavailable`이다.
2. `packages/core/agent-roles/workflows/read.ts`(새 file). import는 base, protocol, `@std/yaml`, `../../lophn-agent/run-loop/core-call.ts`(`CoreCall`, `readOf`)만 쓴다(`core-layer`: agent-roles는 feature module을 import하지 않는다).
   1. machine 자격으로 네 목록을 읽는다. 하나라도 실패하면 그 오류를 돌려준다. 목록은 `limit: 1000` 한 번으로 읽고 `next_cursor`가 null이 아니면 `unavailable`("too many …")이다.
      - `domainList({ status: "active", limit })`
      - `projectApi.list({ status: "active", limit })`, `appList({ status: "active", limit })`
      - `agentDefinitionList({})`(machine은 place 없이 전부 받는다)
   2. domain을 이름순으로 돌며 `files.list(domain.id)`를 부른다. 실패하면 `{ domain: <이름>, file: "workflows/", reason: "the workflows folder cannot be read" }` 오류 하나를 두고 다음 domain으로 간다.
   3. file마다 아래를 차례로 하고, 처음 걸린 곳의 이유로 `WorkflowError`(`file: "workflows/<file 이름>"`)를 두고 그 file을 뺀다. reason은 영어 한 줄이다.
      - 이름: `.md`를 뺀 이름이 `workflowNameSchema`에 맞지 않으면 `the file name is not a slug`.
      - 크기: 글의 UTF-8 bytes가 `INSTRUCTION_FILE_MAX_BYTES`(`packages/protocol/lophn-agent/models.ts`, 32 KiB)를 넘으면 `the file is larger than 32 KiB`(`wf-contract-shapes`의 "선언 file").
      - frontmatter 가르기: 첫 줄이 `---`이고 그 뒤 첫 `---` 줄까지가 frontmatter다(`\r`은 떼고 본다). 없으면 `no frontmatter`, 닫히지 않으면 `the frontmatter is not closed`. `parse(text, { schema: "core" })`가 던지거나 map이 아니면 `the frontmatter is not valid YAML`.
      - schema: `workflowFrontmatterSchema.safeParse`가 실패하면 issue를 `<path>: <message>`로 `; `로 이어 한 줄로 낸다.
      - 구조: `checkWorkflowStructure`의 이유를 `; `로 잇는다.
      - 참가자 풀기(아래 4). 못 풀면 `participant <p>: <이유>`.
      - 같은 agent: 두 참가자가 같은 agent로 풀리면 `participants <a> and <b> are the same agent`.
      - 통과하면 `WorkflowDeclaration`(`key: workflowKey(domain.name, name)`, `contacts`는 없으면 `{}`, `body`는 frontmatter 뒤 글의 앞 빈 줄과 뒤 공백을 뺀 것)을 만든다.
   4. 참가자 풀기. Router(`resolveNamed`, `projectByName`, `appByName`)와 같은 정확한 맞춤이다. place가 없으면 그 domain의 owner가 그릇이다.
      - `lophn` → `{ role: "lophn" }`.
      - `project_manager` → place가 `{project: x}`면 `id === x || name === x`인 active project, 없으면 owner가 project여야 한다(app이면 `a Project Manager needs a project`). 못 찾으면 `project <x> not found`. AgentRef `{ role: "project_manager", project: id }`.
      - `app_engineer` → place가 `{app: x}`면 `id`, `slug`, `name` 가운데 하나가 x인 active 앱, 없으면 owner가 app이어야 한다(project면 `an App Engineer needs an app`). AgentRef `{ role: "app_engineer", app: id }`.
      - `operator` → 그릇을 위처럼 정하고, `agentDefinitionList`의 행 가운데 `kind === "operator"`이고 `name`이 같고 `place`가 그 그릇인 것이 하나여야 한다. 0이면 `operator <name> not found in <project|app> <이름>`, 둘 이상이면 `the operator name <name> is ambiguous`.
      - address(`NamedAgent`)는 늘 그릇을 적는다. 객체는 이 key 순서로 만든다(prompt의 JSON bytes가 같게): lophn `{ role }`, PM `{ role, place: { project: <project name> } }`, App Engineer `{ role, place: { app: <app slug> } }`, Operator `{ role, place, name }`(place 안은 project name이나 app slug).
      - 같은 agent인지는 `agentIdentityOf`(`packages/protocol/lophn-agent/places.ts`)의 `role`, `column`, `value`가 모두 같은지로 본다.
   5. 결과를 만든다.
      - `listing.workflows`는 `key`순, `listing.errors`는 domain 이름과 file 순이다. `place`가 있으면 owner가 그 place인 domain 것만 싣는다. `place`가 null(lophn)이면 전부다.
      - `memberships`: 모든 선언에서 `self`와 같은 agent로 풀린 참가자가 있으면 하나씩 만든다. `key`순. `participant`는 그 참가자 이름, `entry`는 `entry === participant`, `participants`는 선언 순서로 `{ name, address, you }`, `contacts`는 그 참가자의 연락처를 선언 순서로 `{ ...contact, address: <to의 address> }`, `body`는 선언의 body다.
   6. 이 file에는 role 이름 문자열을 써도 된다(role 층이다).
3. `packages/core/lophn-agent/run-loop/runtime-access.ts`: `RUNTIME_MACHINE_ROUTES`의 `domainList` 근처에 `appList`, `agentDefinitionList`, `projectApi.list`를 더하고, 왜 machine으로 읽는지 한 줄 주석을 단다(다른 그릇의 workflow 선언과 참가자를 풀어야 하고 agent 자격은 자기 그릇만 본다). `appList`는 이미 `appGet`을 가져오는 `../../../protocol/apps/mod.ts`, `projectApi`는 `../../../protocol/projects/mod.ts`, `agentDefinitionList`는 이미 가져오는 `../../../protocol/lophn-agent/mod.ts`에서 import한다. 이 file은 `check-deps`의 `HARNESS_LEFTOVERS`에 있어 feature protocol import가 된다.
4. `packages/core/main/agent-runtime/product-driver.ts`
   - `placeFiles()` 안의 data root 계산(`LOPHN_HOME`이 절대 path일 때만)을 `dataRoot(): string | null`로 꺼내 `placeFiles()`가 쓴다.
   - `workflowsOf(machine: CoreCall, self: AgentRef, place: Place | null): Promise<Result<WorkflowRead>>`를 둔다: root가 null이면 `unavailable`, 아니면 `readWorkflows({ core: machine, self, place, files: productWorkflowFiles(root) })`. `wf-prompt-section`이 같은 함수를 `placeFiles`에서 쓴다.
   - `toolPorts`에 `workflows: { read: () => workflowsOf(calls.machine, session.agent, session.place) }`를 더한다.
5. `packages/core/domains/agent-tools.ts`: `DOMAIN_AGENT_TOOLS`에 `workflow.list`를 더한다.
   - `input: z.strictObject({})`, `routes: []`(reader가 machine 자격으로 읽어 agent 자격의 상한에 더할 route가 없다), `effect: "read"`.
   - description(영어 한 줄): `List the workflow declarations (workflows/<name>.md) of the domains of the project or app you work in (all domains if you have no place), and why any file was left out.`
   - handler: `ctx.workflows.read()`가 실패하면 그대로 돌려주고, 성공하면 `fitted(\`${n} workflows, ${m} left out\`, listing, ["workflows", "errors"])`.
   - import는 `zod`, base, protocol, `../lophn-agent/tools/spi.ts`만이다(`tool-file`).
6. `packages/core/agent-roles/tool-lists.ts`: `READ_TOOLS`의 `domain.get` 뒤와 `TOOL_ORDER`의 `domain.create` 뒤에 `"workflow.list"`를 넣는다.
7. 끝내기 전에 `deno test --no-check packages/core/main/agent-tools_test.ts packages/core/agent-roles tests/eval/versions/versions_test.ts`를 돌린다(목록의 이름마다 정의가 있는지. eval의 test "role이 받는 agent tool은 모두 TOOL_FILES의 source file에 정의돼 있다"는 `TOOL_ORDER`의 이름을 `tests/eval/versions/files.ts`의 `TOOL_FILES`에서 찾는다. `workflow.list`는 그 목록에 있는 `packages/core/domains/agent-tools.ts`에 두므로 `tests/`를 고치지 않는다).

정한 것:
- reader는 runtime의 machine 자격으로 읽는다(이유: agent 자격은 `agentConditions`가 자기 그릇에 묶어 `domainList`, `projectApi.list`, `appList`가 다른 그릇을 거르고, `agentDefinitionList`는 place 없이 부르면 `forbidden`이다. 그러면 다른 그릇의 선언도, 다른 그릇의 참가자도 못 본다). model에 가는 것은 걸러서 준다: prompt 절은 자기 membership만, `workflow.list`는 자기 그릇의 선언과 오류만이다. skill 읽기(`turnSkillReader`)가 이미 machine 자격으로 읽는 본보기다.
- 보관된 project·앱·domain은 풀지 않는다. 보관된 그릇의 참가자는 "not found"로 그 file이 빠진다(이유: 보관된 그릇은 일하지 않고, active 목록만 읽으면 된다).
- 목록은 `limit: 1000` 한 번으로 읽는다(paging helper를 또 만들지 않는다). 넘으면 `unavailable`이다.
- App Engineer의 address는 앱 `slug`, PM의 address는 project `name`이다(Router가 둘 다 정확히 맞춘다. slug는 겹치지 않는다).

## 끝남

- `deno task check`가 통과한다.
- machine route와 project 목록 actor가 바뀌었으므로 `project-docs/plan/tools/lead/boot.sh`로 core가 두 번 뜬다(`boot N exit 0`).
- 위험 test: 없음. 참가자가 아닌 agent에게 연락처가 가지 않는 것은 `wf-prompt-section`의 위험 test가 이 `readWorkflows`를 그대로 써서 본다.
- 남지 않음: 없음(바꾸는 이름이 없다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`workflow.list`는 `DOMAIN_AGENT_TOOLS`에 들어 `main/agent-tools.ts`가 이미 모은다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
