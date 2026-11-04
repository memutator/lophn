# bare-skills

bare agent가 skill도 더할 수 있다. bare는 다 덜어진 상태에서 사람이 tool, lophn 명령, 앱 command, MCP, skill을 더한다.

- 단위: card (wave 5)
- 선행: card-policy.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{agent-values,agent-definitions}.ts`
  - `packages/core/lophn-agent/agents/**`, `packages/core/lophn-agent/extensions/{skills,skill-folders,registry}.ts`(+test)
  - `packages/core/lophn-agent/run-loop/prepare.ts`, `packages/core/lophn-agent/prompt-assembly/skill-list.ts`
  - `packages/shell/renderer/workspace/agents/**`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-definition.md`(bare, skill 층)
  - 제품 결정: 계획 README 정한 것 9
- 계약:
  - 쓰는 것: bare의 `tools`, `ResolvedAgent.picks`
  - 내놓는 것: 정의 칸 `skills?: string[]`(bare일 때만)

## 할 일

1. 정의 칸 `skills`(bare만, lophn에서 쓰면 `invalid_input`). serializer whitelist에 더한다.
2. resolve: bare의 skill은 고른 이름만(층을 거쳐 찾은 것 중에서). 지금 `skills: []`를 바꾼다.
3. prompt: bare에 고른 skill이 있으면 skill 목록을 그것만으로 싣는다.
4. 명함 차이에 bare의 고른 skill이 보인다. 편집기에 bare skill 고르기.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "`skills`가 serialize → parse 뒤에 남는다"(`definition-file_test.ts`를 넓힌다)
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
