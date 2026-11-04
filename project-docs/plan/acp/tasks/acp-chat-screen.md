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

## lead가 더함 (acp-core 보고에서)

- 추가 소유: `packages/shell/renderer/desktop/dev-mock/agent.ts`(fake source를 ACP 꼴로 바꾼 데 맞추는 데까지).
- `AcpUpdated`는 subject가 null이라 Bus의 session 조건에 걸리지 않는다. `types: ["AcpUpdated"]`로 구독하고 payload의 `session`으로 고른다. snapshot보다 앞선 갱신을 snapshot 위에 다시 접지 않는 일(읽기 시작 표시)은 읽는 쪽 몫이다(`acp.md`).
- `acpUpdatesOf`는 `packages/protocol/events/acp-project.ts`로 옮겨졌다. 화면은 쓰지 않는다(core가 부른다). 화면은 `reduceAcp`만 쓴다.
- 도는 중에는 snapshot과 접은 상태가 조금 다를 수 있다(기다리는 동안 `turn.elapsed`, tool `duration_ms`). 끝난 상태는 같아야 한다. 화면에서 보이는 차이가 있으면 보고한다.
- renderer에 남은 옛 사본(`live-text.ts`의 `foldDelta`, `turnEndTimes`, `agent-tab-data.ts`의 `blocksText(body)` 길)도 지운다.
- 옛 길이 쓰던 core read·snapshot 칸(`session-snapshots`의 `writing`·`steering`·`elapsed`, thread 읽기에 쓰던 route) 가운데 화면이 더 안 쓰는 것은 지우지 말고 "안 쓰게 된 export"에 적는다. lead가 정리한다.
