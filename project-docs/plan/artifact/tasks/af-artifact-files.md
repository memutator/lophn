# af-artifact-files

artifact를 디스크에서 찾고 읽고 지켜보는 순수 로직을 shell main에 둔다: 열 대상(artifact 또는 사람의 `.html`)을 root와 입구 file로 풀기, project의 artifact 목록 만들기, 폴더 변경 지켜보기. file 시스템과 timer는 인자로 받는다. view는 이 task에 없다.

- 단위: artifact-files (wave 1)
- 선행: af-artifact-values. 이 task는 그 file의 `parseArtifactMeta`와 상수를 import한다.
- 소유(이 task만 고친다):
  - `packages/shell/main/artifact/source.ts`
  - `packages/shell/main/artifact/source_test.ts`
  - `packages/shell/main/artifact/list.ts`
  - `packages/shell/main/artifact/watch.ts`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "1. artifact model"(자리, 제목과 설명, 찾기)과 "2. artifact 탭"의 "여는 길"·"다시 load"
  - `project-docs/products/roadmap/domain.md`의 "view와 artifact"(찾는 법: `artifacts/*/index.html`)
  - 본보기: `packages/shell/main/browser/bookmarks.ts`(file 시스템·시각을 인자로 받는 모양), `packages/shell/main/browser/bookmarks_test.ts`(node:test + 임시 폴더)
  - 계약: `packages/protocol/projects/artifact.ts`(af-artifact-values가 낸다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`
- 계약:
  - 쓰는 것: `parseArtifactMeta`, `ARTIFACTS_FOLDER`, `ARTIFACT_ENTRY`, `artifactNameSchema`(`packages/protocol/projects/artifact.ts`)
  - 내놓는 것(wave 2 `af-artifact-view`가 import한다)
    - `source.ts`: `resolveSource(dataRoot: string, source: ArtifactSource, fs): Promise<Result>` — `ArtifactSource`는 `{ kind: "artifact"; project: string; name: string } | { kind: "file"; project: string; path: string }`. 성공은 `{ root: string; entry: string; file: string; name: string | null }`(`root`는 realpath, `entry`는 root 안 상대 path, `file`은 입구 file의 절대 path). 실패 code는 `invalid_input` | `not_found`.
    - `list.ts`: `listArtifacts(dataRoot: string, project: string, fs): Promise<ArtifactListItem[]>` — `{ name, title, description, modified }`(`modified`는 입구 file mtime의 ISO 문자열), 이름 순.
    - `watch.ts`: `watchFolder(input: { dir: string; recursive: boolean; debounceMs: number }, deps: { watch; timer }, onChange: () => void): { stop(): void }`

## 할 일

1. `source.ts`
   - artifact 대상: 폴더는 `<dataRoot>/projects/<project>/artifacts/<name>`. `name`이 `artifactNameSchema`가 아니면 `invalid_input`. 폴더의 realpath가 `<dataRoot>/projects/<project>/artifacts`의 realpath 안이 아니면(폴더가 symlink로 다른 곳을 가리킴) `not_found`. 입구 `index.html`이 일반 file이 아니면 `not_found`(폴더가 없을 때와 같은 답이다. renderer가 placeholder를 그린다).
   - file 대상: `path`는 절대 path이고 확장자가 `.html` 또는 `.htm`, realpath가 일반 file이어야 한다. root는 그 file이 든 폴더의 realpath, entry는 file 이름, `name`은 null이다.
   - project 폴더 안인지는 보지 않는다(renderer가 사람의 폴더 어느 곳이든 연다. 사람의 앱을 공격자로 보지 않는다).
2. `list.ts`: `<dataRoot>/projects/<project>/artifacts/` 바로 아래 항목마다 `lstat`로 symlink는 건너뛰고, 폴더 이름이 slug이고 `index.html`이 일반 file(`lstat`)인 것만 센다. 입구 file 앞 64 KiB를 읽어 `parseArtifactMeta(text, name)`. 폴더가 없으면 빈 목록이다.
3. `watch.ts`: 주어진 `watch`(`fs.watch` 모양)로 폴더를 지켜보고, 이벤트가 오면 `timer`로 `debounceMs` 동안 모아 `onChange`를 한 번 부른다. 폴더가 사라지거나 watch 오류가 나도 던지지 않는다(조용히 멈춘다). `stop()`은 watch와 timer를 거둔다.
   - artifact는 `recursive: true`(작은 자기 폴더), 사람의 `.html`은 `recursive: false`(사람의 폴더가 클 수 있다. 하위 폴더의 asset이 바뀌어도 다시 load하지 않는다)로 쓰는 것이 호출하는 쪽의 몫이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`source_test.ts`, node:test, 임시 폴더): "artifact 이름이 slug가 아니거나 artifact 폴더가 artifacts 폴더 밖을 가리키는 symlink이면 거절하고, `.html`이 아니거나 일반 file이 아닌 대상은 file 대상으로 열리지 않는다". 목록·watch는 test하지 않는다.
- 남지 않음: 새 file이라 옛 이름이 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: file 대상의 root(그 file이 든 폴더), debounce 기본 값을 호출하는 쪽에 맡긴 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
