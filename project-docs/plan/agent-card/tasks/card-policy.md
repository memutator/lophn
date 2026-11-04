# card-policy

A2A의 시야: call을 보낼 수 있는 place 쌍을 place 정책으로 정하고, agent 쌍은 예외로 덧쓴다. 다른 place에서 불려 home에 열린 session은 폴더를 읽지 않는다. 명함은 지금 place에서 부를 수 있는지를 보인다.

- 단위: card (wave 4)
- 선행: card-show.
- 소유(이 task만 고친다):
  - 새 `packages/protocol/lophn-agent/call-policy.ts`, `packages/core/config/setting-declarations.ts`
  - `packages/core/router/{router,ports}.ts`(+test)
  - `packages/core/agent-places/place/place-folders.ts`(+test), `packages/core/lophn-agent/session/**`(session이 열린 까닭을 남기는 곳만)
  - `packages/core/lophn-agent/agents/**`(명함의 `callable`)
  - `packages/shell/renderer/desktop/settings/**`(정책 목록 한 절), `packages/design/i18n/catalog/**`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`, `place-session.md`(home 읽기 범위)
  - 제품 결정: 계획 README 정한 것 6~8, roadmap 단계 9
- 계약:
  - 쓰는 것: `card-read`의 명함, `card-check`의 Router 검사 자리
  - 내놓는 것: 설정 `call_policy {places: [{from, to, allow}], agents: [{from, to, allow}]}`, 판정 함수 `mayCall(fromSession, toAgent, toPlace)`

## 할 일

1. 기본 표(정한 것 6)는 program에 있다. 설정 `call_policy`의 `places`는 place 쌍을 덧쓰고(예: project A → project B 허용), `agents`는 agent 쌍을 덧쓴다. 판정 순서: agent 예외 → place 덧쓰기 → 기본 표.
2. Router `route()`에서 보낸 이가 agent session인 call을 `mayCall`로 본다. 거절은 `forbidden`이고 tx가 되돌아간다. 사람이 보낸 call과 workflow step은 보지 않는다.
3. home 좁히기(정한 것 7): 다른 place의 session이 부른 call로 home에 열린 session은 file 읽기 범위에 project 폴더가 없다. 그 session이 열린 까닭(부른 place)을 session에 남기고 `placeScope`가 그것을 본다.
4. 명함에 `callable`(지금 부르는 session의 place에서 부를 수 있나).
5. 설정 화면: 정책 목록(place 쌍, agent 쌍)과 더하기·지우기.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "project A의 agent가 project B로 보내는 call은 기본으로 `forbidden`이고 call 행도 session도 남지 않으며, agent 예외가 허용하면 간다"
  - "project A가 부른 home session은 project B 폴더를 읽지 못한다"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
