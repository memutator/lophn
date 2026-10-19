# af-prompt-list

project의 PM과 project place의 Operator의 prompt(place 정보)에 artifact 목록을 싣는다: artifacts 폴더의 절대 path와, `artifacts/*/index.html`로 찾은 artifact마다 이름·제목·설명. program이 결정적으로 만든다.

- 단위: artifact-scope (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/agent-roles/place/artifact-list.ts`
  - `packages/core/agent-roles/place/artifact-list_test.ts`
  - `packages/core/agent-roles/place/place-info.ts`
  - `packages/core/agent-roles/place/place-info_test.ts`
  - `packages/core/agent-roles/place/place-data.ts`
  - `packages/core/main/agent-runtime/product-driver.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`(core 안 의존 방향). place 정보를 turn을 시작할 때 읽는 곳은 `packages/core/lophn-agent/run-loop/prepare.ts:465`(`deps.placeData`)
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "3. 대화와 prompt"(prompt: 그 project agent의 prompt에 artifact 목록(name, 제목, 설명)을 싣는다. program이 결정적으로 만든다), "1. artifact model"의 제목과 설명
  - 본보기: `place-info.ts:156`(`placeInfo`, 순서가 정해진 섹션), `place-info_test.ts`, `place-data.ts:122`(`readPlaceData`), `place-info.ts:33`(`PlaceData`), `place-data.ts:387`(`placeData`), wave 1이 낸 `PlaceFiles`(`place-data.ts`), `core/main/agent-runtime/product-driver.ts:150`
  - 계약: `packages/protocol/projects/artifact.ts`(`parseArtifactMeta`, `ARTIFACT_ENTRY`, `artifactNameSchema`), `PlaceFacts.artifactsFolder`·`PlaceFiles`(af-file-scope)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`
- 계약:
  - 쓰는 것: 위 계약 항목
  - 내놓는 것: `PlaceFiles`에 `listArtifacts(folder: string): Promise<readonly { name: string; title: string; description: string }[]>`를 더한다. `PlaceData.artifacts: { folder: string; items: readonly ArtifactEntry[] } | null`(PM과 project place의 Operator만 값이 있다).

## 할 일

1. `artifact-list.ts`: file system을 인자로 받는 `listArtifactEntries(folder, fs)`. 바로 아래 폴더마다 `lstat`로 symlink는 건너뛰고, 이름이 slug이고 `index.html`이 일반 file인 것만 센다. 앞 64 KiB를 읽어 `parseArtifactMeta(text, name)`. 이름 순. 폴더가 없으면 빈 목록.
   - shell main의 목록(`packages/shell/main/artifact/list.ts`)과 같은 규칙이지만 core는 shell을 import하지 못한다. 규칙의 사본이므로 "관례 자리 `artifacts/*/index.html`"이라는 한 줄을 주석에 둔다.
2. `place-data.ts`: `PlaceFiles.listArtifacts`를 쓴다. `artifactsFolder`가 정해진 project place의 PM·Operator에 한해 `PlaceData.artifacts = { folder, items }`를 채운다(읽기 실패는 빈 목록).
3. `place-info.ts`: `placeInfo`에 `Artifacts` 섹션을 더한다(agent 목록과 context 사이). 첫 줄에 폴더 path(`Folder: <절대 path>` — 아직 artifact가 없어도 agent가 어디에 쓸지 안다), 이어서 `- <name>: <title> — <description>`(description이 비면 뺀다)과 입구 path(`artifacts/<name>/index.html`)를 줄 하나에. 이름 순. 예산(`CONTEXT_TEXT_BUDGET`)은 context 글에만 걸린다. artifact가 많으면 앞 50개만 싣고 "N more"로 줄인다(prompt 안의 글이라 상한이 필요하다). 그 밖의 role에는 섹션이 없다.
4. `product-driver.ts`: wave 1의 `files`에 `listArtifacts`를 더한다(`listArtifactEntries(folder, Deno fs)`).
5. `place-info_test.ts`(있는 test)에 PM의 artifact 섹션 한 건만 더한다. 그 밖의 test는 위험 test 기준으로 두지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. prompt 글의 모양은 test하지 않는다. 제목·설명은 AI가 쓴 HTML에서 오지만 `parseArtifactMeta`가 길이를 자르고 공백으로 줄여 한 줄로 만들므로 다른 목록(context 이름·purpose)과 같은 수준이다.
- 남지 않음: 새 섹션이라 옛 이름이 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 50개 상한, 섹션 자리와 줄 모양
- 넘길 줄: `place-info.ts`·`place-data.ts`는 domain-kinds(kind 글), domain-place(앱 place, 지도)도 건드린다. 섹션 하나를 더하는 곳이라 rebase 때 두 쪽을 다 남긴다.
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 목록은 turn을 시작할 때 읽으므로 그 turn 중에 생긴 artifact는 다음 turn의 prompt부터 실린다
