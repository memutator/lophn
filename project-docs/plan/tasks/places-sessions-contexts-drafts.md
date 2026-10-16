# places-sessions-contexts-drafts

context 판을 초안 폴더에서 짠다. 새 판의 초안 폴더를 열고(내용은 Project Manager가 file tool로 쓴다), 그 폴더를 격리 test로 돌리고, 제출한다. 옛 JSON 인자 통째 저장(`bundle.save_draft`)은 없앤다. outline kind를 "파일 하나의 목차 전체가 개체 하나"로 바꾸고, pdf·docs 같은 저장 목차를 만들고 고치고 지우는 route를 core에 짓는다.

- 단위: places-sessions (wave 3)
- 선행: places-sessions-contexts-authority (같은 `api/commands-bundle.ts`와 `ledger/deps.ts`를 먼저 권한 모양으로 바꾼다)
- 소유(이 task만 고친다):
  - `packages/core/projects/contexts/api/{commands-bundle,reads-bundle,reads-preview,commands,reads}.ts` (초안, test, 제출, 목차 route)
  - `packages/core/projects/contexts/preview/`
  - `packages/core/projects/contexts/check/` (초안 폴더 test 입구)
  - `packages/core/projects/contexts/extract/{outline,outline-documents,document,types}.ts`, `validate/{sources,fields-from}.ts`
  - `packages/core/projects/contexts/folders.ts` (새로)
  - `packages/core/projects/contexts/outlines.ts` (새로)
  - `packages/core/projects/contexts/ledger/{content-blobs,rows}.ts` (목차 저장 표)
- 읽을 것:
  - spec: S4 4장 `context.draft`·`context.test`·`context.submit`·`outline.*`·6장 context 글·11장 14·15 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - 요구: req-0004·0012(목차)·0021·0023·0024(초안이 있는 동안 적용된 판을 쓴다), req-1484·1485(md 목차 규칙), req-1525 — `/home/pyosechang/projects/lophn/project-docs/requirements/core-contexts.yaml`, `core-lophn-agent.yaml`
  - inventory: `I2.8#2`, `I2.10#19`, `I2.10#20`, `I2.10#21`, `I3.10#3`
  - 지금 코드: `contexts/api/commands-bundle.ts`(331줄), `contexts/check/runner.ts`, `contexts/preview/`, `contexts/extract/outline.ts`
- 계약:
  - 쓰는 것: `protocol/projects/context-drafts.ts`(`bundleOpenDraftRoute`, `bundleTestDraftRoute`, `CONTEXT_DRAFT_ROUTES`), `context-outlines.ts`(`outlineGet`, `outlineSet`, `outlineDelete`, `contextOutlineSchema`), `context-contract.ts`의 `bundleContentSchema`와 목차 새 상수, `parseMarkdownOutline`(`outline-markdown.ts`), `core/projects/ports.ts`(`ContextFolders`, `ContextAuthority`)
  - 내놓는 것: `createContextFolders(dataRoot)`(`ContextFolders` 구현), `contexts/mod.ts`의 초안·목차 command와 read. agent-tools가 tool(`context.draft`·`context.test`·`context.submit`·`outline.*`)에서 부른다.

## 모양

### 초안 폴더 (`I2.10#19`, `I3.10#3`)

- 위치: lophn data root 아래 `projects/<project>/contexts/<context>/drafts/<bundle>/`. `ContextFolders.draftFolder(project, context, bundle)`가 돌려주는 경로이다. 폴더는 판이 제출되거나 버려질 때까지만 있다.
- 폴더 모양은 문서에 없다. 추천: 폴더 안에 `bundle.json` 하나. 내용은 `BundleContent`(`schema`, `contract`, `searches`, `saved_views`, `examples`) 그대로이다. 새 판을 열면 적용된 판이 있으면 그 내용을, 없으면 `{schema:1, contract:{…빈 골격}}`을 써 둔다(context-update와 context-init이 그 위에서 일한다). Project Manager의 file tool 범위에 그 project context의 초안·목차 폴더가 더해진다는 것(S4 4장)은 agent-tools(agent runtime의 Deno 권한)가 맡는다. 이 선택을 보고 "정한 것"에 적는다.
- `bundle.open_draft`(`bundleOpenDraftRoute`) command: 새 context이면 첫 판과 함께 context를 만들고(`context.create` 규칙을 따른다), 이미 열린 초안이 있으면 그 폴더를 돌려준다. 보관한 context는 `conflict`. 초안이 있는 동안에도 적용된 판을 쓴다(req-0024). 옛 `bundle.save_draft`는 쓰지 않는다. `bundleSaveDraft` command와 `draft_content` blob 저장(`ledger/content-blobs.ts`의 초안 내용 blob)을 걷어낸다.
- `bundle.test_draft`(`bundleTestDraftRoute`) read: 폴더의 `bundle.json`을 읽어 `bundleContentSchema`로 검사하고 격리 test(`check/runner.ts`, `preview/`)를 돌려 `CheckReport`를 돌려준다. 읽기라 command나 event를 만들지 않는다. 검사 중인 판은 폴더의 내용 hash로 정해진다.
- `bundle.submit` command: 폴더의 내용을 읽어 판 내용으로 확정하고 옛 검사(`check/`)를 시작한다. 통과하면 자동 적용된다(옛 `bundle.finish_check`·`bundle.rollback`은 그대로). 제출하면 폴더를 지운다. 버리면(`bundle.discard_draft`) 폴더를 지운다.
- 초안 폴더에 `bundle.json` 말고 다른 file이 있어도 무시한다.

### 판 되돌리기 (`I2.10#21`)

- 사람이 판을 되돌리는 command(`bundle.rollback`)는 남는다(req-0022). Project Manager tool에는 없다. 건드리지 않는다. 확인만 한다.

### outline kind (`I2.8#2`)

- `extract/outline.ts`가 heading마다 `EntityAnchor`를 만들던 것을 파일 하나의 목차 전체를 개체 하나로 바꾼다. 제목마다 개체를 만드는 일은 section kind 몫이다. `min_level`·`max_level`은 개체 수를 정하지 않고 목차 tree의 깊이 제한이 된다. `extract/outline-documents.ts`와 `validate/sources.ts`, `validate/fields-from.ts`(`from: outline`의 `max_level` field)를 맞춘다.
- md 파일은 program이 `parseMarkdownOutline`으로 파싱하고, pdf·docs처럼 program이 결정적으로 만들 수 없는 형식은 저장된 목차를 쓴다(아래). `format`은 `OUTLINE_FORMATS`에 새 형식이 늘어난 새 상수를 따른다.
- `extract/document.ts`, `types.ts`: 두 번째 md 목차 parser(`formats/modules/document/markdown.ts`)가 아니라 `parseMarkdownOutline` 하나를 쓴다(level, title, subtree_range만 쓴다).

### 저장된 목차 (`outlines.ts`)

- `outline.set`/`outline.delete`/`outline.get` command·read의 core 쪽이다(tool은 agent-tools 몫). 목차는 lophn data의 그 context 아래(`ContextFolders.outlineFolder(project, context)`)에 둔다. 표 또는 파일 어느 쪽이든 좋다. 추천: context 폴더 아래 `outlines/<파일 경로 hash>.json` 한 파일씩(`contextOutlineSchema`). 읽기는 모든 role. 쓰기는 Project Manager만(`ContextAuthority.canWrite`). 원본 파일이 바뀌어도 program은 낡음을 감지하지 않는다(PRODUCT.md 3장, AGENT-ROLE C5). 다시 만드는 계기는 사람의 요청이다.

## 할 일

1. `folders.ts`: `createContextFolders(dataRoot)`.
2. `bundle.open_draft`/`bundle.test_draft`/`bundle.submit`/`bundle.discard_draft`를 위 모양으로. `contexts/api/commands.ts`, `reads.ts`에 등록한다.
3. outline kind를 고치고 `outlines.ts`를 짓는다.
4. 옛 `save_draft`와 초안 JSON blob 경로를 지운다.
5. test: `drafts_test.ts` 한 파일, 임시 폴더로 표를 돈다. subprocess와 Worker를 띄우지 않는다.
   - "폴더의 bundle.json이 BundleContent 검사를 통과하지 못하면 test는 실패 보고를 주고 판이 만들어지지 않는다"
   - "초안이 열려 있는 동안에도 적용된 판이 쓰이고, 제출하거나 버리면 폴더가 사라진다"

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "잘못된 bundle.json은 판이 되지 못한다", "초안이 있는 동안에도 적용된 판을 쓰고 제출·버림 뒤 폴더가 사라진다"
- 남지 않음: `grep -rn "save_draft\|bundleSaveDraft\|draftContentSchema" packages/core/projects/contexts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/projects/mod.ts`의 `CONTEXT_DRAFT_ROUTES`·`CONTEXT_OUTLINE_ROUTES` 등록(lead), `contexts/register.ts` 호출은 places-sessions-contexts-authority가 고친 모양을 따른다. `wiring/projects.ts`에서 `createContextFolders(dataRoot)`를 `ContextFolders`로 끼운다
- 안 쓰게 된 export: `bundleSaveDraftRoute`, `draftContentSchema`, `contextDraftRoute`(읽기 route `context.draft`: 이름이 새 tool과 겹쳐 지금 쓰는 곳을 센 뒤 보고), 두 번째 md 목차 parser
- 정한 것: 초안 폴더의 위치와 `bundle.json` 한 file, 저장 목차 파일 위치
- 계약 바꾸기 요청(wave 3): `ContextFolders`에 모자란 것

- (lead가 더함, agent-tools-context가 넘긴 것. 추가 소유, lead 승인: `protocol/projects/context-drafts.ts`의 draft 읽기 출력, `core/lophn-agent/run-loop/place-data.ts`의 PM `PlaceScope` 줄) PM이 초안 폴더에 file tool로 쓰려면 그 폴더가 `PlaceScope.write`에 들어야 한다. `context.draft` 읽기의 `draft`에 `folder`를 싣고(가장 작은 계약 고침), turn 준비가 PM의 열린 초안 폴더들을 읽어 `PlaceScope`의 read·write에 더한다. 지금 PM의 `file.write`는 초안 폴더에서 forbidden이다. `context.draft` tool 출력은 `{context, draft, folder}`다.
