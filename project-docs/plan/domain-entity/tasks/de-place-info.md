# de-place-info

prompt의 place 정보와 file tool이 닿는 폴더를 새 모양으로 만든다. place는 project 또는 app이고, 그 그릇의 domain마다 kind 글·artifact 목록·폴더가 붙는다. App Engineer는 앱 source와 앱의 domain 폴더, PM은 project 폴더들과 project의 domain 폴더, Operator는 그릇 폴더와 고른 domain의 `artifacts/`만 연다(`DOMAIN.md`·`kinds.yaml`·`skills/`는 그 그릇의 PM이나 App Engineer만 쓴다). lophn의 지도는 project 단위에서 domain 단위가 된다. file 범위는 prompt의 place 정보, rewind의 쓰기 폴더, agent runtime child의 Deno 권한 셋이 같은 규칙(`placeScope`)에서 나온다.

- 단위: roles (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/place/{artifact-list,data-folder,data-folder_test,place-data,place-folders,place-folders_test,place-info,place-info_test}.ts`
  - `packages/core/main/daemon/place-folders-glue.ts`
  - `packages/core/main/daemon/place-folders-glue_test.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/place-session.md`("file tool의 범위는 place가 정한다"), `project-docs/architecture/agent-definition.md`("place 정보에는 잘 안 바뀌는 목록만", "lophn의 place 정보에는 … 지도가 실린다", "kind 글은 program이 …"), `project-docs/architecture/kinds.md`, `project-docs/architecture/artifact.md`("쓰는 것은 …", "artifacts 폴더는 turn을 시작할 때 runtime이 만든다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `project-docs/module-catalog.yaml`의 `packages/core/agent-roles`
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > Operator 좁히기, PM·App Engineer prompt, kind 파일, artifact", `project-docs/products/roadmap/domain.md`의 "role과 place", "domain이 가진 것"
  - 본보기(코드): `packages/core/agent-roles/place/{place-data,place-info,place-folders}.ts` 전체와 그 test, `packages/core/main/daemon/place-folders-glue.ts`, `packages/core/main/agent-runtime/product-driver.ts`의 `placeFiles()`(110~145째 줄), 앱 place가 있던 옛 모양 `git show a66724c30^:packages/core/agent-roles/place/place-folders.ts`
- 계약:
  - 쓰는 것: `ResolvedAgent.domains`(구체 id 목록. `de-agents-domains`), `kindText`의 새 모양 `buildKindText({domains})`·`renderKindText`(`de-turn-domains`), `kindGet`의 `{domain}` 입력(`de-kinds-domain`), `appUsage`의 `{app, tool, domain, source}`(`de-public-tools`), `domainList`·`domainGet`, `domainFolder`·`domainKindsFile`·`domainDocFile`·`domainSkillsFolder`·`domainArtifactsFolder`(`packages/protocol/domains/paths.ts`), `appAppApi`·`appAppApiIndex`의 tool `domain`
  - 내놓는 것
    - file 범위 `placeScope(facts)`(순수): lophn은 등록된 모든 project 폴더 읽기만. **PM**은 자기 project 폴더들과 그 project의 모든 domain 폴더(`domainFolder`: `kinds.yaml`·`DOMAIN.md`·`skills/`·`artifacts/`)를 읽고 쓴다. **App Engineer**는 자기 앱의 source 폴더와 그 앱의 모든 domain 폴더를 읽고 쓴다. **Operator**는 project place면 project 폴더들을 읽고 쓰고, 앱 place면 앱 source만 읽고, 어느 쪽이든 고른 domain(`ResolvedAgent.domains`)의 `artifacts/`(폴더)만 읽고 쓴다(`DOMAIN.md`·`kinds.yaml`·`skills/`는 열지 않는다. 고른 domain의 `DOMAIN.md`와 kind 글은 prompt에 실린다. 바꿀 일은 그 그릇의 PM이나 App Engineer에게 call한다. 예전 Operator가 context 계약을 바꾸지 않고 PM에게 call한 것(AGENT-ROLE O6)과 같은 자리다). PM은 앱 source를 열지 못하고 App Engineer는 project 폴더를 열지 못하며, 둘 다 다른 그릇의 domain 폴더를 열지 못한다. 앱·project의 data·release 사본(`<data>/apps/<app>/{data,bundles,staging,preview}`)과 agent 정의 폴더(`agents/`)·`extensions.json`은 어느 role도 열지 않는다. `base`(상대 경로 기준)는 project place면 첫 폴더(없으면 project의 data 폴더), 앱 place면 앱 source다.
    - `runtimeFolders(input)`: 열린 project 폴더, 열린 앱 source, 모든 domain 폴더의 합(읽기·쓰기)이다.
    - place 정보: `# Your place` 아래 (project) `Place: project <name>. …`와 폴더들 또는 (앱) `Place: app <name>. …`와 source·blueprint·active release의 tool 이름들, `Domains` 절(domain마다 `<name> — <title>: <purpose>`와 그 domain의 폴더 경로), kind 글(domain별 `Domain <name>` 덩이, 예산 안에서 full → names → count), `Artifacts`(domain별 폴더와 목록, 전체 50개까지). lophn은 `Projects`·`Apps` 목록과 domain 지도(`Domains` 절: domain마다 owner, 목적, 공개 tool(키, effect, 설명), 그 tool을 쓰는 다른 domain. package는 주인 앱 줄에)를 싣는다. 부를 수 있는 agent 줄에 App Engineer(`app <name>`)가 돌아온다.

## 할 일

1. `data-folder.ts`: `placeDataFolder(root, place)`는 project면 `<data>/projects/<prj>`, 앱이면 `<data>/apps/<app>`(`de-place-restore`가 되살렸다)이다. project의 `artifactsFolder(root, project)`는 지운다(자리는 domain으로 갔다). `projectIdOfFolder`는 앱 id 짝(`appIdOfFolder`)을 더한다. 이 file의 test를 맞춘다.
2. `place-folders.ts`: 위 계약의 `placeScope`·`runtimeFolders`로 쓴다. `PlaceFacts`는 `place: {kind, id} | null`, `projectFolders`, `appSource`, `domains: readonly {id, folder, artifactsFolder}[]`(그 agent가 맡은 domain만. PM·App Engineer는 그릇 전부), `dataFolder`, `allProjectFolders`다. `kindsFile`·`skillsFolder` 칸은 없어진다. 범위는 폴더 단위다(PM·App Engineer는 domain 폴더, Operator는 `artifacts/`). file 하나만 여는 항목이 더 쓰이지 않으면 지운다. `place-folders_test.ts`를 새 규칙으로 쓴다(아래 위험 test).
3. `place-data.ts`: 한 turn의 재료를 agent 자격 core 읽기로 모은다. project place면 `projectApi.get`, 앱 place면 `appGet`과(active release가 있으면) `appAppApi`의 tool 이름. 그릇의 domain 목록은 `domainList({owner})`, 이 agent의 domain은 `agent.domains`(`ResolvedAgent`)이고 kind 글은 그 domain마다 `kindGet({domain})`로 읽어 `buildKindText({domains})`로 만든다(읽지 못한 domain은 빼고 turn은 계속한다). 폴더는 `files.domainFolder(domain)`로 구하고 turn 시작에 `ensureDir`(domain 폴더와 `skills/`, `artifacts/`)한다(만들지 못한 폴더는 범위에서 빠진다). artifact 목록은 domain마다 읽는다. `ROLE_LINE`에 App Engineer를 되살린다("Looks after the app's tools, tickets, releases and its domains."). `PlaceFiles`를 `{domainFolder(domain), dataFolder(place), ensureDir, listArtifacts}`로 바꾼다. lophn의 지도: `appAppApiIndex`로 앱 tool(+`domain`), `appUsage`로 사용 관계, `packagesList`·`packagesUsage`로 package를 읽어 domain마다 덩이를 만든다(package 주인은 앱이다(`owner_app`, `de-app-domains`). package는 domain 덩이 대신 주인 앱의 `Apps` 줄에 싣는다. 읽기 오류는 그 덩이만 비운다).
4. `place-info.ts`: `PlaceData`를 위 계약에 맞게 바꾼다(`MapProject` → `MapDomain {name, owner, purpose, tools, usedBy}`(package는 앱 줄에), `kinds`의 domain별 덩이, `artifacts`의 domain별 목록, 앱 place의 `app`·`release`, `ROLE_LABEL.app_engineer`). 예산 규칙: 글자 수 상수(`KIND_TEXT_BUDGET`)는 kind 글과 domain 지도에 각각 걸고, 넘으면 이름과 한 줄로 줄인다. `Domains` 절의 `<name> — <title>: <purpose>` 줄은 줄이지 않는다. 같은 재료가 같은 bytes가 되게 domain 이름순으로 정렬한다. `place-info_test.ts`를 맞춘다.
5. 조립: `place-folders-glue.ts`는 sessions 표에서 role·place를 읽고 `domainsOfOwner`(`packages/core/domains/lookups.ts`)로 그릇의 domain을 구해 `placeScope`를 부른다(Operator가 고른 domain은 정의 file에 있어 sessions 표만으로는 모른다. 그래서 rewind의 쓰기 폴더는 Operator에게도 그 그릇의 domain 폴더 전부로 넉넉히 잡고, 실제 쓰기는 file tool이 `placeScope`로 좁힌다). `runtimeFoldersOf`는 모든 project 폴더와 앱 source와 `activeDomainIds`의 domain 폴더를 합친다. `kindsFilePath`·`PROJECT_LAYER.skillsFolder`·`artifactsFolder`·`appOfProject`는 더 쓰지 않는다. `wiring/lophn-agent-runtime.ts`와 `product-driver.ts`의 `placeFiles()`도 같은 규칙(domain 폴더)을 쓴다. `deno.json` 권한이 아니라 child에 넘기는 폴더 목록만 바뀐다.
6. 시험을 새 규칙으로 고친다: `place-folders_test.ts`, `place-info_test.ts`, `data-folder_test.ts`, `place-folders-glue_test.ts`.

## 정한 것

- Operator는 `DOMAIN.md`를 쓰지 않는다(README "planner가 고친 것"). 앱 place의 Operator는 앱 source가 읽기 전용이어도 고른 domain의 `artifacts/`는 쓴다.
- domain 폴더는 PM·App Engineer에게 통째로 열린다(`kinds.yaml`, `DOMAIN.md`, `skills/`, `artifacts/`뿐인 폴더라 file 항목으로 좁히지 않는다). 지난 모양처럼 kinds 파일만 file 항목으로 여는 일은 없다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test:
  - "PM의 범위에는 앱 source가 없고 App Engineer의 범위에는 project 폴더가 없다. 둘 다 다른 그릇의 domain 폴더, 앱 data·release 사본, agent 정의 폴더를 열지 못한다" — `packages/core/agent-roles/place/place-folders_test.ts`
  - "domain A만 고른 Operator의 범위에는 A의 `artifacts/`만 있다. B의 폴더, A의 `DOMAIN.md`·`kinds.yaml`·`skills/`는 없다" — 같은 file
  - "domain A만 고른 Operator의 place 정보에는 A의 kind 글과 artifact만 실리고 B의 것은 없다. PM의 place 정보에는 그릇의 domain 전부가 실린다" — `packages/core/agent-roles/place/place-info_test.ts`(또는 `place-data` 단위 test)
  - "lophn의 지도에는 공개 tool만 실리고 비공개 tool은 없다" — 같은 file
- 남지 않음: `grep -rn "kindsFilePath\|skillsFolder\|artifactsFolder(\|appOfProject" packages/core/agent-roles packages/core/main`이 0줄이다(정의 파일 `protocol/projects/kinds-file.ts`와 `ProjectLayer.skillsFolder` 정의는 cleanup이 지운다). `grep -rn "projects/" packages/core/agent-roles/place/data-folder.ts`는 project의 data 폴더 줄만 남는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: `kindsFilePath`, `ProjectLayer.skillsFolder`, `artifactsFolder`
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
