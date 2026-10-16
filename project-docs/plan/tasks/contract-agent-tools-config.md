# contract-agent-tools-config

agent 정의의 설정 쪽 계약을 고정한다: 지침 층, skill 층과 내장 skill 선언, MCP 서버 층, model 기본값 하나. 옛 모양은 지우지 않고 새것을 옆에 더한다.

- 단위: contract-agent-tools (wave 2)
- 선행: 없음. `AgentRole` 같은 role 값은 쓰지 않고 문자열 literal로 둔다.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/instructions.ts`
  - `packages/protocol/lophn-agent/skill-settings.ts`
  - `packages/protocol/lophn-agent/mcp-settings.ts`
  - `packages/protocol/lophn-agent/models.ts`
  - `packages/shell/ipc/instructions.ts`
  - 같은 단위의 소유라도 고치지 않는 것: `model-calls.ts`, `model-call-values.ts`, `model-picker.ts`, `option-axes.ts`, `provider-inputs.ts`, `provider-values.ts`, `providers.ts`, `resolved-model.ts`, `traces.ts`. S4가 provider 연결, model 호출 기록, 선택기, trace의 모양을 바꾸라고 하지 않았다. `ProviderRegistered` 같은 event 정의와 `ExportAgentTrace`는 쓰는 쪽(agent-definition-models)이 그만 쓴 뒤 cleanup이 지운다.
- 읽을 것:
  - spec: S4 2·5·7·9·11장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - inventory: `I1.1#7`(질문·provider·model·MCP 설정의 event. `reverts`, `assignments`, `agents` 쪽 event는 contract-calls-places 몫이다), `I3.4#26`, `I2.4#36`(model slot의 protocol 쪽), `I2.11#2`(설정 선언 모양. 아래 6번)
  - 결정: `../README.md` 3장 #117·118(설정 파일), #41
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md` "package 사이 약속"
- 계약:
  - 쓰는 것: `protocol/base`의 `defineRead`, `defineCommand`, `idSchema`. 설정 선언의 새 모양은 contract-platform이 `protocol/config`에 둔다.
  - 내놓는 것: 아래 "모양"의 이름. wave 3의 agent-definition-instructions, agent-definition-extensions, agent-definition-models와 screens-agents가 기댄다.

## 모양

### instructions.ts

지침은 3층이 이어 붙는다: 전역, project(`LOPHN.md`), agent. built-in role 지침은 prompt의 고정 본문이라 층이 아니다. `app` 층은 없다(S4 5장).

```ts
export const PROJECT_INSTRUCTION_FILE = "LOPHN.md";
export const PROMPT_INSTRUCTION_LAYERS = ["global", "project", "agent"] as const; // 이어 붙이는 순서
export const instructionsGetInputSchema; // { session, layer, project? }
export const instructionsGet;            // defineRead, resource "instructions", method "get", name "GetInstructions", actors ["machine"]
```

- `layer`는 `PROMPT_INSTRUCTION_LAYERS`. `project`는 lophn이 `instructions.read`로 다른 project의 `LOPHN.md`를 읽을 때만 준다. 없으면 session의 place가 가리키는 project다.
- 출력은 옛 `ReadInstructionFile`과 같다: `{ file: { size_bytes, content_base64 } | null }`. 상한도 같다(`INSTRUCTION_READ_MAX_BASE64`).
- 옛 `instructionRead`(입력이 `run`), `INSTRUCTION_LAYERS`, `INSTRUCTION_READ_LAYERS`는 지우지 않는다. `instructionPreview`(전역 앞부분)는 그대로 쓴다.
- `INSTRUCTION_ROUTES`에 `instructionsGet`을 더한다.

### skill-settings.ts

skill의 층은 전역, project이고 끄기는 전역, project, agent 세 층에서 한다. 같은 이름은 마지막 층이 덮는다. 내장 skill은 lophn이 가진다(S4 2장).

```ts
export const SKILL_SOURCES = ["builtin", "global", "project"] as const;
export const BUILTIN_SKILLS = [
  { name: "context-init", role: "project_manager", can_disable: false, description: "..." },
  { name: "context-update", role: "project_manager", can_disable: false, description: "..." },
] as const; // 내장 skill 선언. description은 skill 목록에 들어가는 영어 한 줄
export const skillEntrySchema; // { name, description, source, enabled, can_disable }
export const skillsReadInputSchema; // { project? }
export const skillsRead;  // defineRead, resource "skills", method "read", name "ReadSkills", actors ["user", "machine"]
```

- `description`: `context-init`은 목적을 정하고 첫 판의 계약과 검색 script를 짜 test를 거쳐 내는 일, `context-update`는 적용된 판에서 새 판을 짜 test를 거쳐 내는 일이다(`I3.4#28`).
- `skillsRead`는 agent 설정 화면용이다(`I3.4#26`). 출력은 `{ skills: skillEntrySchema[], skills_off: string[] }`. `project`를 주면 전역과 내장에 그 project 층을 더한다. 같은 이름은 마지막 층이 덮고, 가려진 쪽은 목록에 두지 않는다. 그래서 `shadowed`는 없다.
- 끈 skill도 목록에 남고 `enabled`만 false다. `can_disable`이 false인 내장 skill은 끌 수 없다.
- 옛 `skillShadowSchema`, `skillSummarySchema`, `SKILL_SOURCE_KINDS`, `globalSkillsRead`는 지우지 않는다.

### mcp-settings.ts

MCP 서버의 층은 전역, project, agent다. 앱 place의 MCP 층은 없다. 같은 이름은 마지막 층이 덮고 이름이 다르면 모두 쓴다. tool의 효과는 `readOnlyHint`가 참이면 read, 아니면 external이라(S2 3장) 서버 설정에 tool 분류를 두지 않는다.

```ts
export const mcpServerSchema; // mcpServerConfigSchema에서 `revision`과 `classifications`를 뺀 것. 나머지 칸(name, enabled, call_timeout_ms, transport, stdio/http)은 같다
export const projectExtensionSettingsRead;   // resource "project-extension-settings", method "read", name "ReadProjectExtensionSettings", input { project }, actors ["user", "machine"]
export const projectExtensionSettingsChange; // method "change", name "ChangeProjectExtensionSettings", input { project, mcp_servers: mcpServerSchema[] }, compare { hash }
```

- 읽기 출력은 `{ project, mcp_servers, hash }`다. skill은 `skillsRead`가 맡아 여기 싣지 않는다.
- agent 층 서버는 agent 정의 안에 둔다(contract-calls-places의 agent 정의 입력). 이 task는 `mcpServerSchema`만 내놓고 그쪽이 가져다 쓴다.
- 옛 `ReadPlaceExtensionSettings`, `ChangePlaceExtensionSettings`, `PlaceExtensionSettingsChanged`, `mcpServerConfigSchema`는 지우지 않는다. MCP OAuth 시작·완료 route(`BeginMcpAuth` 등)의 입력이 쓰는 `place` 칸은 이 task에서 건드리지 않는다.
- `EXTENSION_ROUTES`에 새 route 둘을 더한다.

### models.ts

model은 전역 기본 하나와 agent 설정에서 고른다. role별 기본과 "Model for summaries" 칸은 없다(S4 2장, `I1.4#17`).

```ts
export const modelDefaultSchema = modelChoiceSchema.nullable(); // 처음은 null
export const modelDefaultRead;   // resource "model-default", method "read", name "ReadModelDefault", output { default }
export const modelDefaultChange; // method "change", name "ChangeModelDefault", input { default }
```

- `MODEL_ROUTES`에 둘을 더한다.
- 옛 `MODEL_DEFAULT_SLOTS`, `modelDefaultsSchema`, `ChangeModelDefaults`, `ReadModelDefaults`, `ModelDefaultsChanged`는 지우지 않는다. 즐겨찾기(`ModelFavorites*`)와 catalog 읽기·갱신은 그대로 둔다.
- 바뀐 것을 화면에 알리는 길은 contract-events가 정한다(`SettingsChanged`). 새 event를 만들지 않는다.

### shell/ipc/instructions.ts

- `instructionsPlaceSchema`와 `InstructionsPlace`의 `app` 층을 지운다. 쓰는 곳이 남아 있으면(`grep -rn '"app"' packages/shell` 가운데 지침 열기) 지우지 않고 보고에 적는다.

## 할 일

1. 위 다섯 file에 새 이름을 더한다. 옛 이름은 지우지 않는다. 이름이 겹쳐 `protocol/lophn-agent/mod.ts`의 `export *`가 깨지면 새 이름을 바꾼다.
2. `defineSetting` 선언 셋(`skillFoldersSetting`, `skillsOffSetting`, `mcpServersSetting`, `I2.11#2`)은 contract-platform이 `protocol/config`에 둔 새 설정 선언 모양이 main에 있을 때만 그 모양으로 옮긴다. key는 요소 이름 아래로 한다(`agents.…`). 없으면 손대지 않고 보고에 적는다.
3. 새 route를 `protocol/lophn-agent/registry.ts`의 `ROUTES`에 올릴 목록으로 보고에 적는다(lead가 등록한다).
4. (lead가 맞추며 더함) provider와 MCP 등록 입력의 `credential`은 `{ secret: <name> }`이다. 값은 contract-shell의 보호 입력 창과 `secrets/put`으로만 들어온다(contract-platform).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(schema와 상수뿐이다).
- 남지 않음: 지우는 일이 없다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/lophn-agent/registry.ts`의 `ROUTES`에 `instructionsGet`, `skillsRead`, `projectExtensionSettingsRead`, `projectExtensionSettingsChange`, `modelDefaultRead`, `modelDefaultChange`
- 안 쓰게 된 export: `instructionRead`·`INSTRUCTION_LAYERS`·`INSTRUCTION_READ_LAYERS`, `skillShadowSchema`·`skillSummarySchema`·`SKILL_SOURCE_KINDS`·`globalSkillsRead`, `ReadPlaceExtensionSettings`·`ChangePlaceExtensionSettings`·`PlaceExtensionSettingsChanged`·`mcpServerConfigSchema`, `MODEL_DEFAULT_SLOTS`·`modelDefaultsSchema`·`ChangeModelDefaults`·`ReadModelDefaults`·`ModelDefaultsChanged`, `Provider*` event 셋, `ExportAgentTrace`
- 정한 것: skill과 MCP의 새 route 이름, `mcpServerSchema`에서 `classifications`를 빼는 것, 내장 skill description 영어 문구, `SKILL_SOURCES` 셋
- 계약 바꾸기 요청: 없음(wave 2)
