# card-check

Router가 agent가 보낸 call을 받는 agent의 modality와 답 방식으로 검사해, 받지 못하면 `invalid_input`으로 거절한다.

- 단위: card (wave 2)
- 선행: card-read.
- 소유(이 task만 고친다):
  - `packages/core/router/{router,ports}.ts`, `packages/core/router/router_test.ts`
  - `packages/core/lophn-agent/places/directory.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`
  - 제품 결정: 계획 README 정한 것 3, 4
- 계약:
  - 쓰는 것: `card-read`의 `modality`, `repliesOf`
  - 내놓는 것: `SessionDirectory.accepts(agent)`(`router/ports.ts`)

## 할 일

1. `router.ts` `route()`의 `resolve()` 뒤, `deliver` 앞(~l.244)에서 보낸 이가 agent인 call만 검사한다. block 대응: `image` → `image`, `resource_link`·`resource` → `file`, `text` → `text`. 답 방식은 `repliesOf`.
2. 거절은 `invalid_input`이고 받는 agent와 빠진 modality·답 방식을 글에 적는다. tx가 되돌아가 call 행도 새 session도 남지 않는다.
3. `SessionDirectory.accepts`를 `places/directory.ts`에서 `AgentDirectory`로 잇는다(동기). test의 fake directory도 맞춘다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "거절된 call은 call 행도 새 session도 남기지 않는다"(`router_test.ts`)
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
