# sync-read

read route가 무엇에 기대는지 선언하게 하고, 화면이 쓰는 공통 읽기 `useCoreRead`를 만든다.

- 단위: sync (wave 2)
- 선행: sync-core.
- 소유(이 task만 고친다):
  - `packages/protocol/base/route.ts`
  - `packages/protocol/**`의 read route 정의 file(`defineRead`와 읽기만 하는 `defineMemory`)
  - `packages/shell/renderer/desktop/connection/events/{client,store,hooks}.ts*`
  - `packages/shell/renderer/desktop/connection/`에 새 file(공통 읽기)
  - `tools/`의 check에 새 단계 하나
- 읽을 것:
  - 계획 README "정한 것"
  - roadmap: `project-docs/products/roadmap/screen-sync.md`의 "지금 코드 › 읽는 쪽"
  - architecture: `project-docs/architecture/event.md` 지키는 것 19~23
- 계약:
  - 쓰는 것: `sync-core`의 `ChangeName`, `StateChanged`
  - 내놓는 것: route 정의의 `reads`, `useCoreRead(route, input)`가 돌려주는 `{loaded, reload}`(지금 `app-frame/app-detail/use-read.ts`의 `useRead`와 같은 모양)

## 할 일

1. `route.ts`: read 정의와 memory 정의에 선택 칸 `reads`(이름이거나 `{name, id(input)}`).
2. 화면이 부르는 read route에 `reads`를 적는다. 기능마다의 `core-source.ts`(약 20개)가 부르는 route가 대상이다.
3. `useCoreRead`: 구독하고, `ready`를 받은 뒤 읽고, 그 route의 `reads`와 맞는 `StateChanged`나 `ready`가 오면 다시 읽는다. 읽는 중에 온 것은 읽기가 끝난 뒤 한 번만 다시 읽는다. 끊기면 옛 값을 stale로 표시한 채 둔다. `events/store.ts`의 `syncOnReady`와 `events/client.ts` 위에 짓는다.
4. Electron 전역(`globalThis.lophnCore` 등)을 이 file에서 직접 쓰지 않는다. `CoreSource`만 받는다.
5. check 한 단계: read route의 `reads`에 있는 이름을 `changes`로 내는 route가 하나도 없으면 실패한다.
6. 화면은 옮기지 않는다(다음 wave).

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음
- `tools/wireframes`의 fake source로 `useCoreRead`가 돈다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. `reads`를 적지 못한 read route와 이유를 "정한 것"에 적는다.
