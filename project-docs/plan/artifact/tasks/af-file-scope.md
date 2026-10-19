# af-file-scope

project의 PM과 project place의 Operator가 lophn data의 `<data>/projects/<prj>/artifacts/` 폴더를 file tool로 읽고 쓰게 한다(`file.write`·`file.edit`, rewind 기록 포함). 규칙은 `placeScope` 하나이고, turn의 file 범위·rewind 쓰기 폴더·Deno 권한이 모두 이것으로 나온다.

- 단위: artifact-scope (wave 1)
- 선행: af-artifact-values. 이 task는 `ARTIFACTS_FOLDER` 상수를 import한다.
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/place/place-folders.ts`
  - `packages/core/agent-roles/place/place-folders_test.ts`
  - `packages/core/agent-roles/place/data-folder.ts`
  - `packages/core/agent-roles/place/data-folder_test.ts`
  - `packages/core/agent-roles/place/place-data.ts`
  - `packages/core/main/daemon/place-folders-glue.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/place-session.md`("지키는 것"의 file tool 범위, `placeScope` 하나로 turn 범위·rewind·runtime 권한을 만든다는 항목)
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "1. artifact model"의 수명 표(쓰는 쪽), `project-docs/plan/artifact/README.md`의 "정한 것"(file 범위)
  - 본보기: `place-folders.ts:19`(`placeScope`)·`:46`(`runtimeFolders`), `place-data.ts:122`(`readPlaceData`)·`:363`(`placeScope` 호출), `place-folders-glue.ts:24`(`placeFoldersOf`), `core/lophn-agent/tools/file/scope.ts`(`resolveInPlace`: 허용 폴더의 realpath가 없으면 그 폴더는 건너뛴다), `core/lophn-agent/session/rewind/write-routes.ts:49`(`openRoot`가 realpath를 비교한다), `core/lophn-agent/tools/runtime-permissions.ts:49`(`allow_read`는 data root 전체, `allow_write`는 `placeFolders.write`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
- 계약:
  - 쓰는 것: `ARTIFACTS_FOLDER`(`packages/protocol/projects/artifact.ts`)
  - 내놓는 것
    - `data-folder.ts`: `artifactsFolder(root: string, project: string): string` = `<root>/projects/<project>/artifacts`
    - `PlaceFacts.artifactsFolder: string | null`(place가 project일 때 그 project의 artifacts 폴더, 아니면 null)
    - `place-data.ts`: `type PlaceFiles = { artifactsFolder(project: string): string | null; ensureDir(path: string): Promise<void> }`, `placeData(call, agent, files: PlaceFiles)`. wave 2 `af-prompt-list`가 이 type에 목록 읽기를 더한다.

## 할 일

1. `data-folder.ts`에 `artifactsFolder`를 더한다(`placeDataFolder`로 project 폴더를 만들고 `ARTIFACTS_FOLDER`를 붙인다). `data-folder_test.ts`에 한 줄.
2. `place-folders.ts`
   - `PlaceFacts`에 `artifactsFolder`를 더한다.
   - `placeScope`: project place의 `project_manager`는 `[...projectFolders, artifactsFolder, ...draftFolders]`, `operator`는 `[...projectFolders, artifactsFolder]`를 read·write 모두 가진다. `artifactsFolder`가 null이면 더하지 않는다. 순서가 중요하다: 상대 path의 기준은 읽기 목록의 첫 폴더(`scope.ts`)라서 사람의 project 폴더가 앞에 남아야 한다.
   - lophn, app_engineer, 앱 place의 operator에는 더하지 않는다.
   - `runtimeFolders`는 이미 `<data>/projects` 전체를 쓰기 폴더(`draftRoot`)로 열기 때문에 artifacts 폴더가 그 안에 든다. 고치지 말고 그 이유를 한 줄 주석으로 남긴다.
3. `place-data.ts`
   - `placeData`가 세 번째 인자 `files: PlaceFiles`를 받아 `readPlaceData`로 넘긴다.
   - project place이고 role이 project_manager 또는 operator이면 `folder = files.artifactsFolder(place.id)`. null이 아니면 `await files.ensureDir(folder)`(첫 쓰기 전에 폴더가 있어야 한다. `resolveInPlace`는 없는 허용 폴더를 건너뛰어 첫 artifact를 쓰지 못한다. 실패는 삼키고 폴더가 없으면 범위에서 빠진 채 간다)를 하고 `placeScope`의 facts에 넣는다.
4. `place-folders-glue.ts`의 `placeFoldersOf`가 facts에 `artifactsFolder: place?.kind === "project" ? artifactsFolder(dataRoot, id) : null`을 넣는다(rewind의 쓰기 폴더, `openRoot`가 realpath로 비교하므로 폴더가 있어야 한다). 폴더를 만들지는 않는다.
5. `main/agent-runtime/product-driver.ts`: `placeData`를 그대로 넘기던 곳(150줄 근처)을 `(call, agent) => placeData(call, agent, files)`로 바꾼다. `files`는 `LOPHN_HOME`(절대 path일 때만)으로 `artifactsFolder`를 내고 `ensureDir`는 `Deno.mkdir(path, { recursive: true })`다. 다른 file system 호출을 이 file에 더하지 않는다.
6. `place-folders_test.ts`의 표에 행을 더한다(아래 위험 test).

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`place-folders_test.ts`의 표에 행으로): "PM과 project place의 Operator만 artifacts 폴더를 읽고 쓰고, lophn(읽기 포함)·App Engineer·앱 place의 Operator는 그 폴더가 read·write 어디에도 없으며, project 폴더가 artifacts 폴더보다 앞에 남는다".
- 남지 않음: `grep -rn "placeData(" packages --include=*.ts`에서 인자 둘짜리 호출이 없다(test 포함).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: artifacts 폴더의 목록 안 자리, 폴더를 만드는 곳(runtime의 `ensureDir`)
- 넘길 줄: `place-folders.ts`·`place-data.ts`는 domain-kinds(kind 글), domain-place(앱 place, skill 자리)도 건드린다. `PlaceFacts`에 칸을 더하는 한 곳이라 rebase 때 두 쪽을 다 남긴다.
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: runtime child의 Deno 권한은 확인만 했다(`<data>/projects` 전체가 이미 쓰기 허용). 실제 turn에서 `file.write`로 첫 artifact가 써지는지는 wave 2 뒤 lead가 `deno task dev`로 본다.

## lead가 더함

- **runtime 쓰기 목록에 artifacts 폴더를 따로 더한다.** 위 할 일 2의 "`runtimeFolders`는 고치지 말고 주석" 대신 이것을 한다. 같이 도는 `domain-kinds`의 `dk-prompt-place`가 `draftRoot`(`<data>/projects` 전체 쓰기)를 지우므로 그 넓은 권한에 기대지 않는다.
  - `runtimeFolders`의 입력에 `artifactFolders: readonly string[]`를 더해 write와 read에 넣는다. `draftRoot` 줄은 그대로 둔다(나중에 land하는 쪽이 합친다).
  - `place-folders-glue.ts`의 `runtimeFoldersOf`가 `projectIds(sql)`(`packages/core/projects/lookups.ts`)의 project마다 `artifactsFolder(dataRoot, id)`를 넘긴다.
  - `place-folders_test.ts`의 `runtimeFolders` test(있으면)에 artifacts 폴더가 write에 드는 것을 한 줄 더한다.
