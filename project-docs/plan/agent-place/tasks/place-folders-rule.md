# place-folders-rule

place 폴더 목록을 만드는 규칙(role과 place에서 file tool이 읽고 쓰는 폴더)을 `agent-roles`의 순수 함수 하나로 모으고, turn scope를 만드는 `place-data.ts`가 그것을 쓰게 한다. 같은 규칙이 Deno 권한 합(`runtimeFolders`)도 낸다. 다른 쪽(rewind, runtime 권한)은 `place-folders-wiring`이 이 규칙으로 옮긴다.

- 단위: place-folders (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/place/place-folders.ts` (새 file)
  - `packages/core/agent-roles/place/place-folders_test.ts` (새 file)
  - `packages/core/agent-roles/place/place-data.ts`
  - `packages/core/agent-roles/place/place-data_test.ts` (지운다. `appSourceScope` test가 place-folders_test로 간다)
- 읽을 것:
  - architecture: `project-docs/architecture/place-session.md`(마지막 "지키는 것" 항목: file tool의 범위는 place가 정한다)
  - 이슈: `project-docs/issues/place-session.md`의 "PM이 초안 폴더를 연 같은 turn에 쓰면 forbidden이다"(고치려면 B), "agent runtime process의 Deno 권한에 place 폴더가 없다"(폴더 목록 만드는 곳이 둘)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
  - 지금 코드: `place-data.ts`의 `readPlaceData`(scope를 채우는 곳, project 분기의 `openDraftFolders`, `appSourceScope`, lophn 분기의 `scope.read.push`), `main/daemon/rewind-glue.ts`의 `placeFoldersOf`(이 규칙과 어긋나 있는 사본. 고치는 것은 `place-folders-wiring`)
- 계약:
  - 쓰는 것: `protocol/lophn-agent`의 `Role`. harness와 domain은 import하지 않는다(순수 함수, 값만 받는다).
  - 내놓는 것(`place-folders-wiring`이 기대는 모양. 이름과 칸을 바꾸지 않는다):
    - `placeScope(facts): { read: string[]; write: string[] }`
      - `facts = { role: Role; place: { kind: "project" | "app"; id: string } | null; projectFolders: readonly string[]; draftFolders: readonly string[]; appSource: string | null; allProjectFolders: readonly string[] }`
      - `projectFolders`는 place가 project일 때 그 project의 등록 폴더(position 순), `draftFolders`는 그 project의 열린 초안 폴더, `appSource`는 place가 app일 때 앱 source 폴더(없으면 null), `allProjectFolders`는 active project 전체 폴더(lophn만 쓴다).
    - `runtimeFolders({ dataRoot: string; draftRoot: string; projectFolders: readonly string[]; appSources: readonly string[] }): { read: string[]; write: string[] }`
      - agent runtime child의 Deno 권한용 합이다. `projectFolders`는 active project 전체 폴더, `appSources`는 active 앱의 source 폴더(null은 뺀 것). 결과의 read·write는 둘 다 (project 폴더 + 앱 source)이고, write에 `draftRoot`를 더한다(초안 폴더는 turn 중에 열려 목록이 정해지지 않는다). 중복은 뺀다. `placeScope`를 다시 불러 합을 내고, 규칙을 따로 복사하지 않는다. `dataRoot`는 read에 이미 허락돼 있으니 결과에 넣지 않는다(쓰지 않으면 인자에서 뺀다).

## 지켜야 할 것

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. 필요한 값은 composition root(`core/main`)가 넘긴다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

## 정한 것

- 규칙은 값만 받는 동기 함수다. 값을 읽는 길은 둘이다(place-data는 `CoreCall`의 async 읽기, rewind·runtime은 core의 SQL 읽기). 읽는 길을 하나로 합치지 않는다: 하나가 agent runtime process 안이고 하나가 core라 prompt 재료를 읽는 길과 같을 수 없다. 합치는 것은 "어떤 role이 어떤 폴더를 읽고 쓰는가"의 규칙이다.
- 규칙은 지금 `place-data.ts`의 동작과 같다. 바꾸지 않는다: lophn은 `allProjectFolders`를 읽기만; Project Manager는 `projectFolders`와 `draftFolders`를 읽고 쓰기; project place의 다른 role(Operator)은 `projectFolders`를 읽고 쓰기(초안 폴더는 없다); App Engineer는 `appSource`를 읽고 쓰기; 앱 place의 Operator는 `appSource`를 읽기만; `appSource`가 null이면 빈 목록. 그 밖의 조합은 빈 목록.
- 이유: `rewind-glue.ts`의 `placeFoldersOf`가 따로 만들어 초안 폴더와 project Operator가 빠져 어긋났다. 규칙이 한 곳이면 `place-folders-wiring`에서 그쪽도 같은 규칙을 쓴다(`place-session.md` 이슈 추천 B).

## 할 일

1. `place-folders.ts`에 위 두 함수와 type을 만든다. 근거: 이슈 "PM이 초안 폴더를…" 고치려면 B, architecture place-session "file tool의 범위는 place가 정한다".
2. `place-data.ts`의 `readPlaceData`가 scope를 `placeScope`로 채우게 고친다. 읽는 값만 모은다: project place면 `projectApi.get`의 폴더, PM이면 `openDraftFolders`(그대로 둔다), 앱 place면 `appGet`의 `source_path`, lophn이면 목록의 폴더. `appSourceScope`와 그 export를 지운다(쓰는 곳은 이 file뿐이다. grep으로 확인).
3. `place-data_test.ts`를 지우고 `place-folders_test.ts`에 위험 test를 쓴다(아래).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "`placeScope`는 role별로 file tool이 닿는 폴더와 쓸 수 있는 폴더를 표 그대로 낸다(앱 place의 Operator는 쓰기 없음, PM만 초안 폴더, lophn은 읽기만)" 하나와 "`runtimeFolders`는 모든 project 폴더와 앱 source를 read·write에 한 번씩 담고 write에 `draftRoot`를 더한다" 하나. 둘 다 `Deno.test` 표 하나씩. 권한 경계(Deno 권한과 file tool scope)가 새지 않는 것을 지키는 test다. 그 밖에 test를 더하지 않는다.
- 남지 않음: `grep -rn "appSourceScope" packages tools`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`agent-roles`에 barrel이 있으면 알려 준다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
