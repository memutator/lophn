# acp-chat-screen

lophn 채팅 화면이 ACP snapshot과 갱신만 읽고 그린다. renderer의 해석 code를 지운다.

- 단위: acp (wave 3)
- 선행: acp-core.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation/**`
  - `packages/shell/renderer/desktop/connection/events/**`
- 읽을 것:
  - architecture: `project-docs/architecture/acp.md`, `agent-chat.md`
  - 제품 결정: 계획 README 정한 것 2~4
- 계약:
  - 쓰는 것: `AcpSnapshot`, `AcpUpdated`, `reduceAcp`
  - 내놓는 것: 없음

## 할 일

1. `AgentTabSource`를 ACP source로: snapshot을 읽고 갱신을 `reduceAcp`로 접는다. `agent-tab-data.ts`의 `foldEvent`, `foldDelta`, `readThread`의 항목 만들기, 이름으로 tool을 가르고 JSON을 parse하는 code, 시각 merge를 지운다.
2. tool 묶어 보이기 같은 모양 일은 renderer에 남는다.
3. fake source(`agent-tab-fake-source.ts`)를 ACP 상태와 갱신을 내는 꼴로 다시 쓴다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "같은 기록에서 갱신을 접은 상태와 snapshot이 같다"(TurnEnded 뒤 줄이 튀던 bug)
- 남지 않음: `grep -rn "foldEvent\|readThread" packages/shell/renderer`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.
