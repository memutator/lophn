# place-operator-app-read

앱 place의 Operator가 앱 source 폴더를 file tool로 읽을 수 있게 한다. 쓰기는 주지 않는다.

- 단위: place (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/run-loop/place-data.ts`
  - `packages/core/lophn-agent/run-loop/place-data_test.ts`
- 읽을 것:
  - issues: `project-docs/issues/place-session.md`의 "앱 place의 Operator는 file 범위가 없다". 정한 것은 "앱 Operator에게 앱 source 폴더 읽기를 준다. 쓰기는 주지 않는다."다.
  - architecture: `project-docs/architecture/place-session.md`의 file tool 범위 줄. lead가 고친다.
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`
  - 코드: `packages/core/lophn-agent/tools/file/scope.ts`(`resolveInPlace`가 `scope.read`/`scope.write`로 판정한다), `packages/core/lophn-agent/run-loop/prepare.ts`(`readPlaceData` 결과를 `ToolContext.scope`에 채운다)
- 계약:
  - 쓰는 것: `ToolContext.scope`(`PlaceScope`: `read`, `write` 폴더 목록). 모양을 바꾸지 않는다.
  - 내놓는 것: 없음. `readPlaceData`의 반환 모양은 그대로다.
- 정한 것:
  - `rewind-glue.ts`의 `placeFoldersOf`(`packages/core/main/daemon/rewind-glue.ts`)는 고치지 않는다. 이 함수는 "쓰기 폴더"(rewind가 pre-image를 남길 폴더)를 만들고, 앱 Operator는 쓰기가 없으므로 `[]`가 맞다.
  - runtime process 권한(`tools/runtime-permissions.ts`)도 고치지 않는다. place 폴더 권한은 role과 상관없는 목록이고, 지금 `run-loop/runtime.ts`가 `placeFolders: { read: [], write: [] }`로 띄운다. 이 값이 모든 role에 비어 있는 것이 의도인지는 worker가 `agent-runtime`의 file I/O 경로를 한 번 보고, role과 상관없는 일이면 고치지 말고 보고의 "알려진 미완 동작"에 적는다.
  - 이 task의 test는 `readPlaceData`에 가짜 `CoreCall`을 넘겨 scope만 본다. 권한 경계(쓰기를 열지 않음)라 `write-test` 기준에 든다. 앱 record와 `callSendable` 응답이 route의 output schema를 통과하는 가장 작은 모양을 만든다. 준비가 무거우면 scope 규칙을 `place-data.ts` 안의 작은 순수 함수로 빼서 그것을 test해도 된다.

## 할 일

1. `packages/core/lophn-agent/run-loop/place-data.ts`의 app place 분기(`else if (place?.kind === "app")`)를 고친다. `source !== null`이면 `role === "app_engineer" || role === "operator"`가 `scope.read.push(source)`, `role === "app_engineer"`만 `scope.write.push(source)`를 한다. 그 밖의 줄(`release`를 App Engineer만 읽는 것 등)은 그대로다.
2. 같은 file의 머리 주석("... App Engineer는 앱 source 폴더를 읽고 쓴다")에 앱 place의 Operator가 앱 source 폴더를 읽기만 한다는 말을 더한다.
3. `packages/core/lophn-agent/run-loop/place-data_test.ts`를 만든다. test는 하나다: "앱 place의 Operator는 앱 source 폴더를 읽기만 하고 쓰지 못한다". 같은 준비(앱 place, `source_path`가 있는 앱)로 role을 표로 돈다: `operator`는 `read=[source]`, `write=[]`이고 `app_engineer`는 `read=[source]`, `write=[source]`이다. subprocess·Worker는 쓰지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "앱 place의 Operator는 앱 source 폴더를 읽기만 하고 쓰지 못한다." (`place-data_test.ts`)
- 남지 않음: `grep -n 'role === "app_engineer"' packages/core/lophn-agent/run-loop/place-data.ts`의 `scope.read`·`scope.write` 줄이 위 규칙대로이고, `placeFoldersOf`는 바뀌지 않았다(`git diff --stat`에 `rewind-glue.ts`가 없다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 위 "정한 것"에서 더 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 확인한 runtime process의 place 폴더 권한 결과를 적는다. 없으면 "없음". (참고: project place의 Operator는 `place-data.ts`에서 쓰기 scope도 받는데 `placeFoldersOf`는 Project Manager만 폴더를 주므로 project Operator의 쓰기는 rewind에 기록되지 않는다. 이 task 밖이고 `issues/place-session.md`의 "PM이 초안 폴더를 연 같은 turn에 쓰면 forbidden이다"의 B안이 다룬다.)
