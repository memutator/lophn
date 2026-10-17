# place-folders-wiring

core 쪽 두 곳이 `place-folders-rule`의 규칙을 쓰게 한다. (1) rewind의 쓰기 폴더(`placeFoldersOf`)가 초안 폴더와 project Operator를 포함하게, (2) agent runtime child의 Deno 권한 `placeFolders`가 열린 project·앱 source 폴더의 합으로 채워지고 목록이 바뀌면 child를 다시 띄우게.

- 단위: place-folders (wave 1)
- 선행: place-folders-rule. 이 task가 `placeScope`와 `runtimeFolders`를 import한다.
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/place-folders-glue.ts` (새 file)
  - `packages/core/main/daemon/rewind-glue.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-session.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`
  - `packages/core/lophn-agent/run-loop/runtime.ts`
  - `packages/core/projects/lookups.ts`
  - `packages/core/apps/lookups.ts`
  - `packages/core/projects/contexts/folders.ts`
  - `packages/core/projects/contexts/mod.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/place-session.md`("file tool의 범위는 place가 정한다", lophn의 쓰기 직전 파일 내용은 core가 허용 폴더 안에서 읽는다)
  - 이슈: `project-docs/issues/place-session.md`의 두 절(초안 폴더 같은 turn 중 rewind 쪽 문단, Deno 권한 절 전부)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `run-loop`, `agent-sessions`, `agent-roles`
  - 지금 코드: `rewind-glue.ts`의 `placeFoldersOf`(SQL로 따로 만든다), `lophn-agent-session.ts` 140행 근처 `foldersOf: (session) => ... placeFoldersOf`, `run-loop/runtime.ts`의 `specFor`(`placeFolders: { read: [], write: [] }`)·`readMcp`·`readSkillRoots`·polling `setInterval`과 `same`, `lophn-agent-runtime.ts`의 `startAgentRuntimeChild({... readMcpServers, readSkillRoots })`, `projects/contexts/folders.ts`의 `createContextFolders`(`<data root>/projects/<project>/contexts/<context>/drafts/<bundle>`), `tools/runtime-permissions.ts`의 `agentRuntimePermissions`(이미 `placeFolders.read`·`write`를 `allow_read`·`allow_write`에 얹는다. 고치지 않는다)
- 계약:
  - 쓰는 것: `agent-roles/place/place-folders.ts`의 `placeScope(facts)`와 `runtimeFolders({ dataRoot, draftRoot, projectFolders, appSources })`(모양은 `place-folders-rule.md`의 계약)
  - 내놓는 것: `main/daemon/place-folders-glue.ts`의 `placeFoldersOf(lookup, dataRoot, session): string[]`(그 session의 쓰기 폴더. `write-routes.ts`의 `foldersOf`가 쓴다)와 `runtimeFoldersOf(lookup, dataRoot): { read: string[]; write: string[] }`(Deno 권한용)

## 지켜야 할 것

- harness(`packages/core/lophn-agent`)는 `agent-roles`와 domain을 import하지 않는다. 필요한 값은 composition root(`core/main`)가 넘긴다.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

## 정한 것

- 초안 폴더는 `<data root>/projects/` 아래 고정 위치이고 turn 중에 열리므로, Deno 쓰기 허락에 목록 대신 그 상위 `projectsRoot(dataRoot)`를 고정으로 더한다(`runtimeFolders`의 `draftRoot`). 폴더 목록 변화로 child를 다시 띄우면 도는 turn이 죽는데 초안은 turn 중에 열린다. 읽기는 data root 전체가 이미 열려 있다. 더 좁히려면 열린 초안 폴더마다 허락을 얹고 초안이 바뀔 때 다시 띄우면 되지만 PM의 같은 turn 쓰기가 막힌다. 이 선택이 틀렸으면 보고의 "정한 것"에서 사람이 고른다.
- `<data root>/projects/<id>/extensions.json`(project MCP 정의)도 이 상위 아래에 있어 Deno 쓰기 권한으로는 닿는다. file tool의 scope(`resolveInPlace`)가 PM·Operator에게는 그 파일을 열어 주지 않아 막는다. 여기서 더 막지 않는다.
- Deno 권한은 열린(active) project 폴더와 active 앱 source 폴더 전체의 합이다(README 정한 것 2). session마다의 범위는 file tool scope가 지킨다. 새 project·앱이 등록되면 다음 점검(1초 polling)에서 child를 다시 띄운다.
- 다시 띄우는 길은 hosts·MCP·skill 폴더가 바뀔 때와 같다(`runtime.ts`의 polling `setInterval` 안, `deps.io.updateSpec`). 새 길을 만들지 않는다.
- `projectsRoot(dataRoot)`는 `projects/contexts/folders.ts`가 갖는다(`contextFolder`가 이미 쓰는 `${dataRoot}/projects`를 함수 하나로 뺀다). agent-roles는 domain을 import하지 못하므로 조립이 이 값을 `draftRoot`로 넘긴다.
- SQL은 `projects/lookups.ts`·`apps/lookups.ts`에 함수로 더하고(`select ... from project_folders`, `contexts`와 `context_bundles` where `status = 'draft'`, `apps.source_path`) `place-folders-glue.ts`가 쓴다. 표는 그 module이 갖는다(`lookups.ts` 머리 주석). 지금 `rewind-glue.ts`의 직접 SQL은 이로써 없어진다.
- rewind 기록은 write 폴더만 본다(`foldersOf`가 쓰기 폴더). 그래서 `placeFoldersOf`는 `placeScope(...).write`를 돌려준다.
- sessions 표의 `role`은 문자열이다. `ROLES`(`protocol/lophn-agent/mod.ts`)에 없는 값이면 빈 목록이다.

## 할 일

1. `projects/contexts/folders.ts`에 `projectsRoot(dataRoot)`를 빼고 `contexts/mod.ts`에서 export한다. 근거: 위 정한 것(draftRoot).
2. `projects/lookups.ts`에 더한다(이름은 worker가 정한다): project의 등록 폴더 경로(position 순), active project 전체 폴더 경로, project의 draft 판 `{ context, bundle }` 목록. `apps/lookups.ts`에 더한다: 앱 하나의 `source_path`(null 가능), active 앱 전체 `source_path`(null 뺀 것). 근거: 이슈 "고치려면 … 열린 project·앱 source 폴더 목록".
3. `main/daemon/place-folders-glue.ts`(새 file)를 만든다. `placeFoldersOf(lookup, dataRoot, session)`: sessions에서 role·place를 읽고(`select role, place_kind, place_id from sessions where id = ?`, 지금 `rewind-glue.ts`와 같은 질의) 2의 lookups로 facts를 모아 `placeScope(...).write`를 돌려준다. 초안 폴더 경로는 `createContextFolders(dataRoot).draftFolder(project, context, bundle)`로 만든다. `runtimeFoldersOf(lookup, dataRoot)`: active project·앱 전체를 읽어 `runtimeFolders({ ..., draftRoot: projectsRoot(dataRoot) })`를 돌려준다. 근거: 이슈 "PM이 초안 폴더를…" 고치려면 B, "Deno 권한…" 고치려면.
4. `rewind-glue.ts`에서 `placeFoldersOf`를 지우고(`appWritesOf`는 둔다) 주석을 맞춘다. `lophn-agent-session.ts`의 `foldersOf`가 `place-folders-glue.ts`의 `placeFoldersOf`를 `ctx.root.path`와 함께 부르게 고친다.
5. `run-loop/runtime.ts`: `AgentRuntimeDeps`에 `readPlaceFolders?(): Promise<Result<{ read: readonly string[]; write: readonly string[] }>>`를 더한다(`readMcpServers?`와 같은 모양. 없으면 빈 목록). `specFor`가 `placeFolders` 인자를 받아 `agentRuntimeLaunchSpec`에 넘기고(지금 `{ read: [], write: [] }`를 지운다), 시작 때 한 번 읽고, polling에서 읽어 `same(read)`·`same(write)`가 모두 같지 않으면 `updateSpec`으로 다시 띄운다. 읽지 못한 목록은 바꾸지 않은 것으로 본다(`readMcp`와 같다). harness는 `agent-roles`를 import하지 않는다. 목록은 인자로 받는다.
6. `lophn-agent-runtime.ts`의 `startAgentRuntimeChild({...})`에 `readPlaceFolders: () => ledgerSnapshot(ctx.ledgerPath, (lookup) => runtimeFoldersOf(lookup, ctx.root.path))`를 꽂는다(`ledgerSnapshot`은 `lophn-agent/session/rewind/files.ts`에서 온다. `lophn-agent-session.ts`가 import하는 것과 같다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 규칙은 `place-folders-rule`의 test가 본다. Deno 권한과 runtime 재기동은 process를 건너는 확인이라 이 계획이 하지 않는다(README 정한 것 3). 이 task에서 새 test를 쓰지 않는다.
- 남지 않음: `grep -rn "placeFolders: { read: \[\], write: \[\] }" packages/core/lophn-agent/run-loop`와 `grep -n "placeFoldersOf" packages/core/main/daemon/rewind-glue.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(core 조립 목록에 새로 꽂을 것이 없다. `place-folders-glue.ts`는 import로 쓴다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: folder 목록이 바뀌어 child를 다시 띄울 때 돌던 turn은 hosts·MCP가 바뀔 때처럼 끊긴다(초안 폴더는 고정 상위로 열어 이 경우가 아니다). 이 동작이 그대로면 그렇게 적는다.
