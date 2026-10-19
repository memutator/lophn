# af-artifact-values

artifact의 공통 값과 순수 함수를 protocol에 둔다. shell main(artifact 목록), core(prompt의 artifact 목록), renderer(대화 글의 artifact link)가 같은 규칙을 쓰도록 한 file에 모은다.

- 단위: artifact-protocol (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/projects/artifact.ts`
- 읽을 것:
  - 제품 결정: `project-docs/products/roadmap/artifact.md`의 "무엇을 만드나" 1(artifact model)과 3(대화와 prompt), "정한 것 (agent)"의 "제목과 설명은 HTML에서 읽는다"
  - 본보기: `packages/protocol/projects/outline-markdown.ts`(의존 없는 순수 함수를 protocol에 두고 renderer `packages/shell/renderer/editor/model.ts:2`가 import한다), `packages/protocol/projects/values.ts:7`(`slugSchema`)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/protocol`(notes: 의존 없는 순수 함수를 shell과 core가 같이 써야 할 때만 예외)
- 계약:
  - 쓰는 것: `slugSchema`(`packages/protocol/projects/values.ts`)
  - 내놓는 것(다른 task가 import한다)
    - `ARTIFACTS_FOLDER = "artifacts"`, `ARTIFACT_ENTRY = "index.html"`, `ARTIFACT_DATA_FOLDER = "data"`, `ARTIFACT_ENTRIES_FILE = "_entries.json"`
    - `artifactNameSchema = slugSchema`(artifact 이름은 폴더 이름이고 slug다)
    - `type ArtifactMeta = { title: string; description: string }`
    - `parseArtifactMeta(html: string, fallbackTitle: string): ArtifactMeta`
    - `type ArtifactMention = { start: number; end: number; name: string }`
    - `artifactMentions(text: string, names: readonly string[]): ArtifactMention[]`

## 할 일

1. 새 file `packages/protocol/projects/artifact.ts`에 위 상수와 `artifactNameSchema`를 둔다. 값의 이유는 주석 한 줄(왜)만 쓴다.
2. `parseArtifactMeta`: `<title>`과 `<meta name="description" content="…">`를 정규식으로 읽는다.
   - meta는 속성 순서(`name` 먼저, `content` 먼저)와 따옴표(`"`, `'`)가 달라도 읽는다. `name`은 대소문자를 가리지 않는다.
   - `&amp; &lt; &gt; &quot; &#39;`만 푼다. 공백 연속은 한 칸으로 줄이고 앞뒤를 자른다.
   - title은 120자, description은 300자까지 자른다(prompt에 싣는 글이라 상한이 필요하다). `<title>`이 없거나 비면 `fallbackTitle`, description이 없으면 빈 글이다.
   - 호출하는 쪽이 HTML 앞 64 KiB만 넘긴다는 전제다. 이 함수는 file을 읽지 않는다.
3. `artifactMentions`: 대화 글에서 이 project의 artifact를 가리키는 path 조각의 위치를 낸다.
   - 한 조각은 공백·따옴표·backtick·괄호가 아닌 문자의 연속이고, 그 안에 `artifacts/<name>`이 path 마디 경계(조각 시작 또는 `/` 바로 뒤)에서 나오며 `<name>`이 `names`에 있어야 한다. `<name>` 뒤는 조각 끝이거나 `/`여야 한다(`artifacts/spending-old`가 `spending`으로 읽히면 안 된다).
   - 조각 끝의 `. , ; : ! ?`는 뺀다. `start`/`end`는 뺀 뒤의 조각 전체(절대 path면 `/…/artifacts/<name>/index.html` 전부)다.
   - 같은 글에서 겹치는 조각은 없다. 순서는 `start` 오름차순이다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 이름 규칙은 이미 있는 `slugSchema`가 지키고, 나머지는 문구 처리라 AGENTS.md "속도"의 test 대상이 아니다.
- 남지 않음: 새 file이라 옛 이름이 없다. 같은 상수를 다른 package가 따로 정의해 둔 곳이 없다(`grep -rn '"artifacts"' packages --include=*.ts`).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `packages/protocol/projects/mod.ts`에 `export * from "./artifact.ts";`(lead)
- 안 쓰게 된 export: 없음
- 정한 것: title/description 상한(120/300자), `<name>` 경계 규칙
- 넘길 줄: 없음
- 계약 바꾸기 요청: 없음
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
