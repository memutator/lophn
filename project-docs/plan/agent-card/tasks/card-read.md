# card-read

정의에 `modality` 칸을 더하고, program이 agent의 명함을 계산하고, agent와 사람이 `lophn agent card <name>`으로 읽는다.

- 단위: card (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{agent-values,agent-definitions}.ts`
  - `packages/core/lophn-agent/agents/**`
  - `packages/core/main/daemon/wiring/lophn-agent-team.ts`, `packages/core/apps/lookups.ts`
  - `packages/cli/commands/agent.ts`(+test)
  - `packages/core/agent-places/tool-lists.ts`(+test)
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`
  - 제품 결정: 계획 README 정한 것 1~5
- 계약:
  - 쓰는 것: `ResolvedAgent`, `AgentRow.description`, `lookups.shared(apps)`, `apps/usage/users.ts` `agentAssignment`
  - 내놓는 것: `modality?: {input?: ("text"|"image"|"file")[], output?: (...)[]}`, 명함 type `AgentCard {name, description, runtime, modality, replies, diff: {plus, minus}, notes}`, 동기 조회 `cardOf(name)`, 답 방식 계산 `repliesOf(agent)`

## 할 일

1. schema: `agent-values.ts`에 `modality`. serializer `definition-file.ts` `orderedFrontmatter`(~l.220)는 whitelist라 같이 더한다. 옛 file은 그대로 읽힌다.
2. 차이: place = null로 계산한다(정한 것 2). 할당한 앱의 public command는 deny를 뺀 것이다. 동기 조회 `sharedCommands(apps, deny)`를 `lophn-agent-team.ts`에서 `shared`처럼 잇는다(`agents/reads.ts` `rowOf`가 skill·MCP 수를 이미 센다).
3. 답 방식: `repliesOf`(정한 것 4). model이 이미지를 못 받으면(`models/resolve.ts` `input_media`) `notes`에 적는다.
4. 명령 `agent.card`(CLI `lophn agent card <name>`, `lophn` tool로도). 모든 place 종류의 명령 목록(`core/agent-places/tool-lists.ts`)에 읽기 명령으로 연다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "`modality`가 serialize → parse 뒤에 남고 칸 없는 옛 정의도 읽힌다"(`definition-file_test.ts`를 넓힌다)
  - "명함의 차이에 비공개 command와 deny로 뺀 command가 없다"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
