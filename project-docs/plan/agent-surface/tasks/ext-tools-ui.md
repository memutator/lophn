# ext-tools-ui

harness agent가 extension tool을 `lophn` 명령으로 부르게 하고, 편집기에 extension 할당 칸을, 명함 `diff.plus`에 extension tool을 더한다. test extension fixture로 호출 길 하나를 확인한다.

- 단위: ext (wave 4)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/cli/commands/ext.ts`(새 file)
  - `packages/coding-agent/skills/lophn-agent.ts`
  - `packages/core/lophn-agent/agents/{card,reads}.ts`, `packages/core/lophn-agent/workspaces/model.ts`(card lookups 타입)
  - `packages/shell/renderer/workspace/agents/editor/{definition-form,tool-picks}.tsx`
  - `packages/shell/renderer/workspace/agents/agent-card.tsx`
  - `packages/design/i18n/catalog/agents.ts`
  - `tools/wireframes/pages/screens/agent-settings.tsx`
  - `tests/support/extensions/echo-tool/`(새 폴더), `packages/shell/main/extensions/extension-tools_test.ts`(새 file)
- 읽을 것:
  - `project-docs/plan/agent-surface/README.md`, `project-docs/products/roadmap/tool-extension.md`(단계 2, 정한 것 3·8)
  - architecture: `project-docs/architecture/{extension,agent-definition,coding-agent}.md`(coding-agent는 "harness agent" 절)
  - ext-tools가 낸 것: `packages/protocol/lophn-agent/extension-tools.ts`(`extension_tools/call`, `catalog`), 정의 칸 `extensions`, model 이름 `ext__<id>__<tool>`
  - 명령: `packages/cli/commands/{agent,session,types}.ts`, `packages/cli/main.ts`(입력 JSON은 `--input`, `--json`은 출력 flag)
  - 명함: `packages/core/lophn-agent/agents/card.ts`(`diff.plus`), `reads.ts`(`context.lookups`), `packages/core/lophn-agent/register.ts`(lookups 조립. 등록 file이라 고칠 줄은 보고한다)
  - 편집기: `definition-form.tsx`(`FIELD_OF`, `FieldName`, mcp 절), `tool-picks.tsx`(bare picks), 본보기 wireframe `tools/wireframes/pages/screens/agent-settings.tsx`
  - registry test 꼴: `packages/shell/main/extensions/registry_test.ts`(roots·load 주입)
- 계약:
  - 쓰는 것: `extension_tools/call`, `extension_tools/catalog`(user), 정의 칸 `extensions`.
  - 내놓는 것: 명령 `lophn ext call <name> --input '<json>'` → tool 결과의 content block(글은 그대로, 이미지는 file로 쓰지 않고 `[image]` 줄). `<name>`은 model 이름 `ext__<id>__<tool>`이다.

## 할 일

1. **harness CLI.** `packages/cli/commands/ext.ts`에 `ext.call`(`positional: ["name"]`, `input`, `effect: "external"`, `routes: [extension_tools/call]`, `workspaces: WORKSPACE_KINDS`). route가 Gate를 판정하므로 harness agent도 lophn runtime과 같은 자격·판정이다. 이 명령은 lophn runtime agent의 `lophn` tool help에도 보인다. 숨기는 장치는 만들지 않는다(이미 진짜 tool이 있어 help만 하나 더 보인다). 새 명령 첫 단어 `ext`와 같은 slug의 앱이 있을 때 어느 쪽이 이기는지 확인해 보고한다.
2. **skill.** `lophn-agent.ts`에 "extension tool을 부르는 법" 절을 짧게 더한다(`lophn ext call`, 할당한 것만, 이름 꼴). harness agent용 skill이라 `sdk-note`는 해당하지 않는다.
3. **명함.** lophn runtime의 `diff.plus`에 할당한 extension의 tool을 `ext: <extension id>` 줄로 더한다(MCP의 `mcp: <server>`와 같은 꼴). card context lookups에 catalog를 더한다. bare는 picks가 이미 보인다.
4. **편집기.** 먼저 wireframe `agent-settings.tsx`의 정의 편집 page에 "Shell extensions" 절(설치되고 켜진 extension 목록, 줄마다 이름·설명·tool 수와 할당 check)을 그리고, 그 코드를 `definition-form.tsx`로 옮긴다. 저장은 정의 쓰기(`agentChange`, 사람 자격)로 `extensions`를 바꾼다. 할당 저장(`assignment.set`)은 고치지 않는다. 문구는 `agents.ts` catalog에 둔다. core의 skill·MCP "Extensions"와 헷갈리지 않게 "Shell extensions"라고 쓴다. bare면 `tool-picks.tsx`가 할당한 extension의 tool을 picks 후보로 보인다.
5. **fixture.** `tests/support/extensions/echo-tool/`에 `manifest.json`(tool `echo` 하나)과 entry를 둔다. 제품 roots(`bundled/`, 설치 root)에 넣지 않고, `packages/core/config/shell-settings.ts`에 켜기 설정을 더하지 않는다(test가 roots와 설정을 주입한다). `extension-tools_test.ts` 하나가 fixture를 registry로 load해 catalog에 `ext__echo-tool__echo`가 보이고 `callTool`이 handler의 content를 돌려주는지 본다.

## 끝남

- `npm run check`가 통과한다. renderer build가 된다. `npm run wireframes`가 되고 gallery의 agent 설정 page가 새 절을 그린다.
- 위험 test: 위 fixture test 하나. 화면 test는 붙이지 않는다.
- 남지 않음: `TODO`·`FIXME`를 남기지 않는다.

## 보고

brief-template의 보고 꼴. 등록할 것(`packages/cli/commands/mod.ts`, `packages/core/lophn-agent/register.ts`의 lookups 줄, gallery `tools/wireframes/pages/index.ts`)을 적는다. 진짜 Electron에서 편집기를 열어 보지 않았으면 그렇게 적는다.
