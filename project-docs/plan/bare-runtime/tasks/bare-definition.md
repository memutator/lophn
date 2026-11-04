# bare-definition

정의에 `runtime`, `description`, `tools` 칸을 더하고 file, resolve, CLI, 편집기가 그것을 읽고 쓴다. model에 보내는 것은 아직 바꾸지 않는다.

- 단위: bare (wave 1)
- 선행: 없음. remove-domain `rd-layers`와 content-block `cb-core`가 land한 뒤 연다(README "열 때").
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{agent-values,agent-definitions}.ts`
  - `packages/core/lophn-agent/agents/{definition-file,commands,resolve,layers,reads}.ts`(+test)
  - `packages/cli/commands/agent.ts`(+test)
  - `packages/shell/renderer/workspace/agents/**`, `packages/design/i18n/catalog/agents.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`
  - 제품 결정: 계획 README 정한 것 1, 7, 8. `project-docs/products/AGENT.md` P2~P4
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `runtime?: "lophn" | "bare"`(없으면 lophn), `description?: string`(한 줄, 빈 글·줄바꿈 거절, 길이 상한), `tools?: string[]`(bare일 때만), `ResolvedAgent.runtime`·`ResolvedAgent.picks`, `AgentRow.description`

## 할 일

1. schema: `agent-values.ts`의 칸 목록(l.119-142)과 `agent-definitions.ts`. strict schema다. `runtime: lophn`인데 `tools`가 있으면 `invalid_input`.
2. file: serializer `orderedFrontmatter`(`definition-file.ts` l.213-241)는 whitelist라 칸을 더하지 않으면 저장 때 조용히 사라진다. 세 칸을 더한다. `runtime`이 없으면 쓰지 않는다.
3. 잠금: 내장 lophn agent는 `runtime: bare`를 거절한다(`checkDefinition`이 지금 name·profile만 잠근다). 새 칸은 agent도 고칠 수 있다(`commands.ts`의 사람만 목록에 넣지 않는다).
4. resolve: `ResolvedAgent`가 `runtime`과 고른 것을 갖는다. bare는 `skills: []`. `resolve_test.ts` l.19(옛 P4 "tool 목록은 바뀌지 않는다")는 고쳐 쓰거나 지운다.
5. CLI: `agent create/update` flag는 schema에서 나오므로 따라온다. 도움말만 본다.
6. 편집기: `definition-form.tsx` `FIELD_OF`에 runtime 선택, description 입력, bare일 때 tool 고르기(그 place 종류 목록, 할당한 앱 command, MCP에서), bare면 skill·`skills_off` 칸을 숨긴다. fake data에 bare agent 하나.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "`runtime`, `description`, `tools`가 serialize → parse 뒤에 남는다"(`definition-file_test.ts`를 넓힌다)
  - "내장 lophn agent file의 `runtime: bare`는 거절된다"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
