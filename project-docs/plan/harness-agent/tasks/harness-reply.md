# harness-reply

harness가 자기 shell에서 `lophn call reply|send`로 답하고 다른 agent를 부른다. workflow가 harness 참가자를 넘긴다.

- 단위: harness (wave 3)
- 선행: harness-headless.
- 소유(이 task만 고친다):
  - `packages/core/agent-places/credentials.ts`, 새 turn 자격 발급 file(`packages/core/main/daemon/wiring/` 안)
  - `packages/cli/connection/**`(env 자격 읽기), `packages/cli/commands/call.ts`
  - `packages/shell/main/harness/**`(env 넣기)
  - `packages/core/workflows/**`(harness 참가자, `not_handed`)
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`, `approval.md`, `workflow.md`
  - roadmap: `project-docs/products/roadmap/workflow.md` 남은 일 1
  - 제품 결정: 계획 README 정한 것 6
- 계약:
  - 쓰는 것: `harness-core`의 host route
  - 내놓는 것: env 이름 하나(예: `LOPHN_AGENT_CREDENTIAL`)

## 할 일

1. turn을 시작할 때 그 session·turn에만 쓰이고 turn 끝에 만료되는 agent 자격을 만들어 host가 harness env에 넣는다. 범위는 그 place 종류의 credential 상한(`placeOperations`) 안이다.
2. CLI가 env 자격을 읽어 `call.reply`, `call.send` 등을 그 agent로 부른다. user token으로는 지금처럼 `forbidden`.
3. workflow: `harness` 참가자를 넘긴다(`not_handed` 이유를 지운다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "turn 자격은 그 session의 입력에만 답하고 turn 끝 뒤에는 거절된다"
  - "user token으로 `call.reply`는 여전히 `forbidden`이다"
- 남지 않음: `grep -rn "not_handed" packages/core/workflows`에 harness 이유가 없다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
