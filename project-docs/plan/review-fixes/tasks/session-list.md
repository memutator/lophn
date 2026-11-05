# session-list

session 목록 읽기의 N+1(session마다 turn 전부 읽기)을 없애고, 전역 gate를 주입으로 바꾸고, 모든 session 변화에 모든 tab이 다시 읽는 것을 줄인다.

- 단위: sessions (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/agent-sessions.ts` (`workspaceSessionList` 출력에 칸 하나 더하기만)
  - `packages/core/lophn-agent/session/reads.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-sessions.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-env.ts`
  - `packages/shell/renderer/conversation/agent-tab-data.ts`
  - `packages/shell/renderer/shell/use-left-sidebar.ts`
  - `packages/shell/renderer/app-frame/app-runs.ts`
  - 추가 소유: `workspaceSessionList` 출력 칸이 늘어 깨지는 fake/mock source(`agent-tab-fake-source.ts`, `desktop/dev-mock/`)의 그 줄만
- 읽을 것:
  - `agent-tab-core-source-sessions.ts` 186-237행(`lastActiveOf`가 session마다 `turnList`를 페이지 끝까지 읽음)
  - `agent-tab-core-source-env.ts` 59·80행(core마다 동시 4개 gate, module-level WeakMap, `PAGE_LIMIT=50`에서 말없이 멈춤)
  - `agent-tab-data.ts` 72-76행(어느 session이든 시작·끝나면 모든 agent tab이 목록을 다시 읽음)
  - `use-left-sidebar.ts` 84-96행, `app-frame/app-runs.ts` 57행
  - `packages/core/lophn-agent/run-loop/reads.ts`(turn 읽기)
- 계약:
  - 쓰는 것: `workspaceSessionList`, `turnList`, `sessionSnapshotsList`
  - 내놓는 것: `workspaceSessionList` 출력 session마다 `last_active_at: string | null`(마지막 turn이 끝난, 없으면 시작한 시각. turn이 없으면 null)

## 할 일

1. core의 `workspaceSessionList` handler가 session마다 `last_active_at`을 낸다. 한 번의 질의로 구한다. 다른 module의 표를 SQL로 직접 읽지 않는다: run-loop의 read port나 lophn-agent 안에서 이미 turn을 읽는 길을 쓴다. schema 변경(새 칸, 새 step)이 필요해 보이면 하지 말고 멈춰서 보고한다.
2. renderer `readSessions`가 `last_active_at`을 쓰고 `lastActiveOf`, `createActiveTimes`, session별 `turnList` 읽기를 지운다.
3. 동시 요청 gate를 module-level WeakMap에서 `Env`에 주입하는 값으로 바꾼다(AGENTS.md: 전역 mutable 상태 없음). 페이지가 `PAGE_LIMIT`에서 말없이 멈추는 곳이 목록을 잘라 먹으면 끝까지 읽거나 잘렸음을 오류로 낸다.
4. `agent-tab-data.ts`의 목록 다시 읽기를 그 tab의 agent·workspace session이 바뀔 때만 하게 좁힌다. `use-left-sidebar.ts`, `app-runs.ts`의 같은 꼴 읽기도 좁히거나 1의 칸을 쓴다.
5. `turnList`를 문자열로도 grep해 남은 session별 scan이 없게 한다.

## 끝남

- `npm run check:full`이 통과한다(lead가 준 Windows 기준선 실패는 빼고).
- `node packages/shell/renderer/build.ts`가 된다.
- 위험 test: 없음(성능·화면). core handler에 기존 test가 있으면 칸을 맞춘다.
- 남지 않음: `grep -rn "lastActiveOf\|createActiveTimes" packages`가 0줄.
- `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.

## 보고

brief-template의 보고 꼴.
