# agent-definition-extensions

skill과 MCP를 새 층 규칙으로 바꾸고 내장 skill 둘(`context-init`, `context-update`)을 짓는다. skill 층은 내장, 전역, project이고 끄기는 전역, project, agent 세 층에서 한다. MCP 서버 층은 전역, project, agent이고 앱 place 층은 없다. 외부 MCP tool 이름은 `mcp__<server>__<tool>`, 효과는 `readOnlyHint`로 정한다.

- 단위: agent-definition (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/extensions/` 전체 (`skills.ts`, `skills-sync.ts`, `skill-folders.ts`, `skill-read.ts`, `global-skills.ts`, `registry.ts`, `place-settings.ts`, `place-servers.ts`, `place-store.ts`, `mcp-*.ts`, `secret-refs.ts`, `mod.ts`, `adapters/`)
  - `packages/core/lophn-agent/extensions/builtin-skills/` (새 폴더: 내장 skill 자산. 저장소 루트 `assets/skills`는 쓰지 않는다)
- 읽을 것:
  - spec: S4 2장(skills, MCP, 층), 3장(skill 읽기, grant 안의 tool), 4장 "app-api tool"(이름 규칙), 11장 8·12·15 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S2 3·4·5장(외부 MCP tool의 효과와 Gate) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - 제품: Project Manager의 책임 C1~C8 — `/home/pyosechang/projects/lophn/project-docs/products/AGENT-ROLE.md`
  - 조사: `/home/pyosechang/projects/lophn/project-docs/tmp/research/mcp-result-trust.md`
  - inventory: `I1.4#19`, `I2.2#18`, `I2.4#6`, `I2.4#7`, `I2.4#10`, `I2.4#11`, `I3.4#25`, `I3.4#28`, `I3.4#26`(`ReadSkills` handler 쪽. 계약은 contract-agent-tools-config)
  - 결정: `../README.md` 3장 #41
- 계약:
  - 쓰는 것: `BUILTIN_SKILLS`, `skillsRead`, `mcpServerSchema`, `projectExtensionSettingsRead/Change`(contract-agent-tools-config), `MCP_TOOL_PREFIX`, `TOOL_NAME_MAX`(contract-agent-tools-catalog), `ToolDefinition`·`SkillReader`(agent-tools-registry가 `tools/`에 두는 type. 구조가 맞으면 import 없이 맞춘다)
  - 내놓는 것: `BUNDLED_SKILLS_ROOT`(`extensions/builtin-skills`), `discoverSkills`의 새 입력·결과, `createSkillSnapshot(...)`와 그것이 돌려주는 `SkillReader`, MCP tool 정의 빌더, `ReadSkills`·`ReadProjectExtensionSettings`·`ChangeProjectExtensionSettings`의 core handler

## 할 일

먼저 `grep -rn "lophn-agent/extensions\|extensions/mod.ts" packages/core --include=*.ts`로 밖에서 쓰는 이름을 센다(run-loop, agents, register.ts, `main/agent-runtime`이 쓴다). 쓰는 곳이 남은 이름은 지우지 않고 보고한다.

1. skill 층과 출처 (`I2.4#7`): 발견 출처를 `place / registered / personal / bundled`에서 내장, 전역(등록 폴더 + 개인 보관소), project 셋으로 바꾼다. project 층은 project place의 skill 폴더이고 앱 place의 skill 폴더는 두지 않는다. 같은 이름은 마지막 층이 덮는다(project > 전역 > 내장). `productSkillStores`의 `place`·`apps` 경로, `shadowing`·`SkillShadow`(먼저 발견한 것을 남기고 진 것을 알리던 것, `I1.4#19`)를 지운다. 형식이 틀려 제외한 꾸러미(skipped)와 이유는 남긴다.
2. 내장 skill (`I3.4#25`, `I3.4#28`):
   - `extensions/builtin-skills/context-init/SKILL.md`, `extensions/builtin-skills/context-update/SKILL.md`를 쓴다. 둘 다 Project Manager만 갖는다. 영어로, 기존 skill 꾸러미 형식(frontmatter `name`, `description`)을 따른다. `context-init`은 목적을 정하고 첫 판의 계약과 검색 script를 짜 `context.test`를 거쳐 `context.submit`으로 내는 흐름, `context-update`는 적용된 판(`context.get`)에서 새 판을 짜 test를 거쳐 내는 흐름이다. 초안 폴더 구조와 계약 file 모양은 `protocol/projects/context-contract.ts`(contract-calls-places)와 places-sessions의 contexts 구현을 읽고 맞춘다. 정해지지 않은 모양은 지어내지 않고 tool 호출 순서로만 쓰고 보고한다.
   - `BUNDLED_SKILLS_ROOT`가 이 폴더를 가리키게 하고 `mod.ts`로 내보낸다. `register.ts`가 같은 값으로 읽기 허락을 건다(agent-definition-register).
   - 내장 skill은 `BUILTIN_SKILLS`의 `can_disable`을 따른다. `can_disable`이 false면 어느 층에서 꺼도 켜져 있고, 같은 이름의 사람 skill이 있어도 내장이 남는다(사람 skill은 skipped에 이유와 함께 둔다). `can_disable`이 true인 내장 skill은 끌 수 있고, 끄면 같은 이름의 사람 skill이 대신한다.
3. skill 끄기 (`I2.4#6`): 끄기 층이 셋이다. 전역 `skills_off` 설정, project 층(project 설정 파일에 끈 이름 목록을 둔다. 지금은 둘 곳이 없다), agent 정의의 `skills_off`. 끈 skill은 이름 단위로 덮인다. 지금 발견되지 않는 끈 이름도 기록에서 지우지 않는다. 효과는 목록(prompt의 skill 목록)에서 빠지고 `skill.read`가 막는 것이다.
4. `skill-read.ts`와 `SkillReader`: `createSkillSnapshot(deps, session)`이 turn 시작에 skill 목록과 읽기 가능한 본문 판을 고정하고 `read(session, name, path?)`를 가진 `SkillReader`를 돌려준다. 도는 turn은 시작할 때 읽은 판을 쓴다. 지금의 `pinned_hash` 비교와 `changed` 실패는 지운다. 꺼진 skill은 막는다. `skill.read_supplemental`은 없다(딸린 파일은 `path`). 전역 skill은 lophn data에 있어 file tool이 닿지 않는다. 이 reader만 읽는다.
5. `ReadSkills` handler: `skillsRead` 입력(`project?`)으로 내장 + 전역 + (project) 층을 합친 목록과 `skills_off`를 돌려준다(`I3.4#26`). 끈 skill도 목록에 남고 `enabled`만 false다. 기존 `global-skills.ts`의 읽기를 이것으로 대신한다.
6. MCP 층 (`I2.4#10`): 서버 층은 전역(설정), project, agent 정의다. 같은 이름은 마지막 층이 덮고 다르면 모두 쓴다. "전역 서버와 이름이 겹치는 project 서버는 등록 거절" 규칙을 지운다. 앱 place 층(`place-settings.ts`, `place-servers.ts`, `place-store.ts`의 앱 쪽)을 지우고 project 층 handler(`ReadProjectExtensionSettings`, `ChangeProjectExtensionSettings`, `mcpServerSchema`)로 바꾼다. `classifications`(tool별 효과·`reversible`·`schema_hash` 분류)와 `revision`을 지운다. 옛 `ReadPlaceExtensionSettings`·`ChangePlaceExtensionSettings` handler는 register.ts가 내릴 때까지 남긴다.
7. MCP tool 이름과 효과 (`I2.4#11`, `I2.2#18`): `ext_<server16>_<tool>`(`EXTERNAL_TOOL_PREFIX`)를 `mcp__<server>__<tool>`로 바꾼다. 64자(`TOOL_NAME_MAX`)를 넘으면 결정적인 hash를 붙인다. 이름을 parse하지 않고 정의 목록의 표로 거꾸로 찾는다. 효과는 tool의 `readOnlyHint`가 참이면 `read`, 아니면 `external`이다. `safe_tools` 목록으로 묻지 않던 모양을 지운다. 묻는지는 agent grant가 정하고 Gate는 `executeTool`이 한다(agent-tools-registry). 결과는 감싸지 않는다 (S4 6장). `mcp-toolkit.ts`·`mcp-tools.ts`가 `ToolDefinition`(origin `external`)을 만들게 한다.
8. OAuth 흐름(`mcp-oauth*.ts`, `mcp-auth*.ts`)과 secret 참조(`secret-refs.ts`, `mcp-token-ref.ts`)는 입력의 `place` 칸이 project 하나로 좁아지는 것 말고는 바꾸지 않는다.

- (lead가 더함, screens-agents-editor의 계약 바꾸기 요청, lead 승인) project 층 skill 켬·끔과 전역 MCP server를 project 층에서 켬·끄는 route가 없다(`setSkill`이 `unavailable`, `setMcp`는 project 자기 server만 바꾼다). S4 2장대로 project 층 설정에 싣고(계약 file 추가 소유) `workspace/agents/core-source.ts`의 `setSkill`·`setMcp` 줄도 맞춘다(추가 소유). 외부 MCP server의 tool 목록 읽기가 없어 Grants의 "Tools from MCP servers"가 빈다. 연결된 server의 tool 이름을 읽는 read가 있으면 더한다.

- (lead가 더함, screens-workspace-settings가 넘긴 것) Settings의 skill·MCP 쓰기(`settings/extension-settings.ts`의 `applySetting`)가 아직 옛 `settings/get`·`apply` route를 쓴다. platform-config가 옛 handler를 걷으면 막히니 새 route로 바꾼다(추가 소유: 그 file).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "끌 수 없는 내장 skill은 어느 층에서 꺼도, 같은 이름의 사람 skill이 있어도 그대로 남는다" — `skills_test.ts`가 층과 `can_disable`의 조합을 표로 돌려 최종 목록과 `skill.read` 허용을 본다. 임시 폴더를 쓰고 사람의 data root를 쓰지 않는다.
- 남지 않음: `grep -rn "EXTERNAL_TOOL_PREFIX\|SkillShadow\|safe_tools\|classifications" packages/core/lophn-agent/extensions`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: 세 handler(`ReadSkills`, `ReadProjectExtensionSettings`, `ChangeProjectExtensionSettings`)를 register.ts에 거는 일은 agent-definition-register가 한다
- 안 쓰게 된 export: 1번에서 밖의 사용처 때문에 남긴 이름, 옛 place extension handler
- 정한 것: 끌 수 없는 내장 skill이 같은 이름의 사람 skill보다 앞서는 것, project 층 끄기 목록의 저장 위치, 내장 skill의 draft 폴더 설명 수준
- 계약 바꾸기 요청: contexts의 초안 폴더 구조가 contract에 없으면 그 이름

- (lead가 더함, agent-definition-agents가 넘긴 것) `safe_tools`가 `extensions/mcp-tools.ts`, `mcp-toolkit.ts`에 남았고 `run-loop/prepare.ts`는 `selection({safe_tools: []})`로 맞춰 두었다. 걷는다. agent 정의의 `mcp_servers`는 저장만 되고 연결은 이 task 몫이다.
