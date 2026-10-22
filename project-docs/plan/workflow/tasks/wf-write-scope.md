# wf-write-scope

project의 `workflows/` 폴더를 그 project의 Project Manager만 file tool로 쓰게 한다. `placeScope`, runtime child의 Deno 권한, rewind 쓰기 폴더를 같이 고친다.

- 단위: roles (wave 2)
- 선행: wf-contract
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/place/place-folders.ts`
  - `packages/core/agent-roles/place/place-folders_test.ts`
  - `packages/core/agent-roles/place/place-data.ts`
  - `packages/core/agent-roles/place/place-info.ts`
  - `packages/core/agent-roles/place/place-info_test.ts`
  - `packages/core/main/daemon/place-folders-glue.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`(`placeFiles()`에 한 줄. `PlaceFiles` 구현이 여기뿐이다)
- 읽을 것:
  - architecture: `project-docs/architecture/place-session.md`(`placeScope`와 `runtimeFolders`의 관계: 폴더 종류를 더하면 두 곳을 같이 고친다), `project-docs/architecture/domain.md`(rewind의 쓰기 폴더, `placeScope`), `project-docs/architecture/artifact.md`("쓰는 것은 그 domain을 맡은 agent뿐이다"), `project-docs/architecture/agent-definition.md`(place 층, 정의 자리)
  - 제품 결정: `project-docs/products/roadmap/workflow.md`의 "정의: 선언, `workflow.md`, artifact"(만들고 고치는 것은 그 project의 PM), "지금 코드"의 file 쓰기 범위
  - 본보기 코드: `packages/core/agent-roles/place/place-folders.ts`의 `placeScope`(role마다 폴더 규칙 하나, 모두 이것을 쓴다), `place-data.ts`의 domain 폴더 `ensureDir`(없는 허용 폴더는 file scope가 건너뛴다), `packages/core/main/daemon/place-folders-glue.ts`의 `placeFoldersOf`·`runtimeFoldersOf`, `packages/core/main/agent-runtime/product-driver.ts`의 `placeFiles()`(`PlaceFiles` port 구현), `packages/core/lophn-agent/tools/file/write.ts`(`resolveInPlace(ctx.scope, path, "write")`가 쓰기 판정)
- 계약:
  - 쓰는 것: `wf-contract`의 `workflowsFolder(dataRoot, project)`(`packages/protocol/workflows/paths.ts`)
  - 내놓는 것:
    - `PlaceFacts`에 `workflowsFolder: string | null`. project place의 Project Manager에게만 값이 있고 `placeScope`가 그 폴더를 read와 write 둘 다에 더한다. Operator, App Engineer, lophn, 앱 place의 PM에는 열리지 않는다. `base`(상대 path 기준)는 그대로다.
    - `runtimeFolders`의 입력에 `workflowFolders: readonly string[]`(열린 project마다 `workflowsFolder`). child의 Deno 권한은 PM이 쓸 수 있는 모든 폴더를 합쳐 열어야 한다. 누가 쓰는지는 file tool의 scope(`placeScope`)가 가른다.
    - `placeFoldersOf`(rewind의 쓰기 폴더)는 `placeScope(...).write`를 그대로 쓰므로 PM의 workflows 폴더가 자동으로 rewind 대상이 된다. glue가 `workflowsFolder`를 facts에 채운다.
    - `place-data.ts`: PM의 project place에서 turn을 시작할 때 그 폴더를 `ensureDir`한다(file tool은 없는 허용 폴더를 건너뛴다).
    - `place-info.ts`: PM의 place 정보(prompt)에 `Workflows folder: <절대 path>` 한 줄을 싣는다. PM이 `guide-workflows`대로 쓸 때 절대 path를 쓰게 하려는 것이다(artifact의 `Folder:` 줄과 같은 이유). 다른 role의 prompt는 바뀌지 않는다.

## 할 일

1. **규칙.** `packages/core/agent-roles/place/place-folders.ts`.
   - `PlaceFacts`에 `workflowsFolder: string | null`을 더한다(주석: place가 project일 때 그 project의 `workflows/` 절대 경로).
   - `placeScope`의 PM 분기(`role === "project_manager" && place.kind === "project"`)에서만 `facts.workflowsFolder`가 null이 아니면 `read`와 `write` 둘 다의 끝에 더한다. `own`·`domainFolders` 뒤라서 `base`(첫 폴더)는 그대로다. 다른 분기(App Engineer, Operator, lophn, 앱 place의 PM)는 값이 facts에 있어도 쓰지 않는다. 근거: 규칙이 이 한 곳에만 있어야 sandbox 경계가 하나다. 폴더를 facts에 채우는 쪽(glue, place-data)은 role을 가리지 않아도 된다.
   - `runtimeFolders`의 입력에 `workflowFolders: readonly string[]`를 더해 `folders` 합집합에 넣는다(read와 write 둘 다). 근거: child 하나가 모든 role의 turn을 돌려서 Deno 권한은 합이어야 하고, 누가 쓰는지는 file tool의 scope가 가른다(`runtimeFolders` 위 주석과 같은 이유).
2. **facts 채우기.**
   - `packages/core/main/daemon/place-folders-glue.ts`: `placeFoldersOf`가 `workflowsFolder: place?.kind === "project" ? workflowsFolder(dataRoot, place.id) : null`을 facts에 채운다(`packages/protocol/workflows/paths.ts`의 `workflowsFolder`, `wf-contract`가 만든다). 이것으로 rewind의 쓰기 폴더(`placeScope(...).write`)가 PM의 workflows 폴더를 자동으로 포함한다. `runtimeFoldersOf`는 active project마다 `workflowsFolder(dataRoot, id)`를 `workflowFolders`로 넘긴다(`projects/lookups.ts`의 `projectIds`와 `projectStatusOf`로 active만 거른다. 이미 `activeProjectFolderPaths`를 쓰는 file이라 같은 lookups를 import한다).
   - `packages/core/agent-roles/place/place-data.ts`: `PlaceFiles`에 `workflowsFolder(project: string): string | null`을 더한다(`domainFolder`와 같은 꼴. data root를 모르면 null). `readPlaceData`가 `placeScope`에 넘기는 facts에 `workflowsFolder`를 채운다(`place?.kind === "project"`일 때). PM(`role === "project_manager"`)이 project place에서 turn을 시작할 때만 그 폴더를 `files.ensureDir`로 만든다. 만들지 못하면(throw) 도메인 폴더처럼 범위에서 빼고 turn은 계속한다: 없는 허용 폴더는 file scope가 건너뛰어 첫 쓰기가 실패하기 때문에 PM turn 시작 때 만들어 둔다. 다른 role의 turn은 폴더를 만들지 않는다.
   - `packages/core/main/agent-runtime/product-driver.ts`: `placeFiles()`에 한 줄 `workflowsFolder: (project) => root === null ? null : workflowsFolder(root, project)`를 더한다(import 포함). `PlaceFiles`를 구현하는 곳이 여기뿐이고, 안 더하면 type check가 실패한다.
3. **prompt 한 줄.** `packages/core/agent-roles/place/place-info.ts`: `PlaceData`에 `workflowsFolder: string | null`을 더하고, `placeLines`의 project 분기에서 값이 있으면 `  Workflows folder: <path>` 한 줄을 더한다(`Folders:` 줄 뒤). `place-data.ts`가 PM의 project place일 때만 값을 채운다(`ensureDir`이 된 경우). 다른 role의 `PlaceData`는 null이라 prompt가 바뀌지 않는다. 이 줄은 `wf-role-text`의 `guide-workflows`가 가리키는 줄이다. 줄 이름 `Workflows folder:`를 바꾸지 않는다.
4. **test.**
   - `place-folders_test.ts`의 위험 test(아래 "끝남")를 기존 PM·App Engineer test와 Operator test에 같은 꼴로 더한다. `base`에 `workflowsFolder: "/data/projects/prj_a/workflows"`를 넣어 모든 case가 값이 있는 facts로 돌게 하고, PM의 기대값에만 그 폴더가 들어 있으며 나머지(App Engineer, 서로의 place의 PM·App Engineer, Operator 둘, lophn)는 그대로임을 본다. `runtimeFolders` case에 `workflowFolders`를 더한다.
   - `place-info_test.ts`에는 test 하나를 더한다: project place의 PM에는 `Workflows folder:` 줄과 `scope.write`의 그 폴더가 있고 같은 place의 Operator에는 둘 다 없다. fixture는 기존 `fakeCall`로 `/projects/get`, `/calls/sendable`, `/domains/list`를 채우고 `files`에 `workflowsFolder`를 더한다. `ensureDir` 호출 횟수는 세지 않는다. 기존 case의 `files` 객체와 `PlaceFacts`·`PlaceData` 리터럴에 새 칸만 맞춘다.

## 정한 것

- **판정 위치는 `placeScope` 하나다.** facts는 role과 상관없이 project place면 채우고, PM 분기만 쓴다. `lophn`은 `workflows/`를 file tool로 읽지도 못한다(`workflow.list`·`workflow.get` tool로 본다).
- **범위는 file tool(`file.read/glob/grep/write/edit`)과 rewind 기준이다.** `shell.run`이 이 범위에 묶이지 않는 것은 기존 한계 그대로다(shell 규칙은 `architecture/approval.md`의 몫). 이 task가 새로 만들지 않는다.
- **`workflow.md`·artifact를 쓰는 곳도 이 폴더 하나다.** `workflows/<name>/artifacts/…`가 같은 폴더 안이라 별도 규칙이 없다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "project의 `workflows/`는 그 project의 PM만 쓴다. Operator와 App Engineer와 lophn의 scope에는 없다". `place-folders_test.ts`의 기존 PM·App Engineer test에 같은 꼴로 더한다.
- 남지 않음: 없음(옛 이름을 지우는 task가 아니다). `PlaceFacts`·`PlaceData`·`PlaceFiles` 리터럴 누락은 type check가 잡는다.

## 보고

- 바꾼 file, 통과한 check.
- 등록할 것: 없음.
- 안 쓰게 된 export: 없음.
- 정한 것: 위 "정한 것" 밖에 worker가 정한 것.
- 넘길 줄: 없음.
- 계약 바꾸기 요청: 있으면 적는다. `workflowsFolder`의 경로 모양이나 `PlaceFiles` 방식을 바꿔야 했다면 이유.
- cache: PM의 place 정보(system의 4번 cache 경계)에 한 줄이 늘어 PM session의 cache가 한 번 깨진다고 적는다.
- **무겁게 짠 것**, **알려진 미완 동작**: 없으면 "없음". (`shell.run`이 범위에 안 묶이는 기존 한계는 여기 다시 적지 않는다.)
