# dead-contexts

pdf·docs 문서의 저장 목차(`outline.get`·`set`·`delete` route, 폴더 port, agent tool)와 md 아닌 목차를 읽는 길(`storedOutline`)을 통째로 지운다. md 목차(outline source)만 남긴다.

- 단위: dead (wave 2)
- 선행: dead-agent. 둘 다 `packages/protocol/lophn-agent/tool-catalog.ts`를 고친다. dead-agent가 `tool.search` 줄을 먼저 지운다.
- 소유(이 task만 고친다):
  - `packages/protocol/projects/context-outlines.ts`, `packages/protocol/projects/context-contract.ts`, `packages/protocol/projects/mod.ts`
  - `packages/protocol/lophn-agent/tool-catalog.ts`
  - `packages/core/projects/contexts/outlines.ts`, `packages/core/projects/contexts/mod.ts`, `packages/core/projects/contexts/folders.ts`, `packages/core/projects/contexts/register.ts`
  - `packages/core/projects/contexts/ledger/deps.ts`, `packages/core/projects/ports.ts`
  - `packages/core/projects/contexts/extract/outline.ts`, `packages/core/projects/contexts/extract/types.ts`, `packages/core/projects/contexts/extract/run.ts`
  - `packages/core/lophn-agent/tools/builtin.ts`, `packages/core/lophn-agent/tools/bundles/outline.ts`
  - `packages/core/lophn-agent/roles/project-manager/prompt.md`, `packages/core/lophn-agent/roles/lophn/guides/roles-and-grants.md`
- 읽을 것:
  - issues: `project-docs/issues/contexts.md`의 "저장 목차와 outline kind가 쓰이지 않는다"(정한 것: 지운다). md 아닌 문서를 context로 쓰는 일은 "md가 아닌 문서는 context로 쓸 수 없다" 이슈로 남아 있고, 필요해지면 계약부터 다시 설계한다. 이 task는 저장 목차를 되살릴 여지를 남기지 않는다.
  - architecture: contexts를 다루는 문서가 없다. 코드가 기준이다.
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/projects`, `packages/protocol`, `packages/core/lophn-agent`
- 계약:
  - 쓰는 것: `packages/protocol/projects/context-contract.ts`의 `outlineSourceSchema`(md 목차 source).
  - 바꾸는 것: 계약을 지운다. route `outline.get`·`outline.set`·`outline.delete`(`context-outlines.ts` 전부), `CONTEXT_OUTLINE_SOURCE_FORMATS`, builtin tool 이름 `outline.get`·`outline.set`·`outline.delete`와 그 입력 schema(`outlineEntry` 포함), port 칸 `ContextFolders.outlineFolder`. 쓰는 쪽은 모두 이 task의 소유에 넣었다.
  - 안 바꾸는 것: contract의 `kind: "outline"` source와 그 `format: "markdown"` 칸. (정한 것 참고)
- 정한 것: 이슈 제목의 "outline kind"는 stored 목차를 읽는 `kind: "outline"` 분기(md 아닌 format)를 말한다. md 목차를 읽는 outline source 자체는 "md 목차만 둔다"는 이슈 본문대로 남긴다. `outlineSourceSchema.format`은 값이 `"markdown"` 하나만 남지만, 지우면 계약을 쓰는 곳과 bundle fixture가 모두 바뀌므로 이번엔 칸을 두고 `extract/outline.ts`에서만 분기를 없앤다. 칸 자체를 지울지는 별도 이슈다(worker는 건드리지 않는다).

## 할 일

### 1. 계약(protocol) 지우기

1. `packages/protocol/projects/context-outlines.ts`를 지운다. `packages/protocol/projects/mod.ts`에서 `export * from "./context-outlines.ts"`, `CONTEXT_OUTLINE_ROUTES` import, `...CONTEXT_OUTLINE_ROUTES` 줄을 뺀다(지운 것을 가리키던 등록 줄만 뺀다).
2. `packages/protocol/projects/context-contract.ts`: `CONTEXT_OUTLINE_SOURCE_FORMATS`와 그 주석("md가 아닌 파일의 목차는 core가 저장해 둔다.")을 지운다. `OUTLINE_FORMATS`와 `outlineSourceSchema`는 그대로다.
3. `packages/protocol/lophn-agent/tool-catalog.ts`: `READ_TOOLS`의 `"outline.get"`, `ROLE_WRITE_TOOLS.project_manager`의 `"outline.set"`·`"outline.delete"`, `TOOL_INPUTS`의 `"outline.get"`·`"outline.set"`(주석 포함)·`"outline.delete"` 칸, 쓰는 곳이 없어진 `outlineEntry` 상수를 지운다.

### 2. core projects 지우기

4. `packages/core/projects/contexts/outlines.ts`를 지운다. `contexts/mod.ts`의 `contextOutlineCommands, contextOutlineReads` export 줄을 뺀다.
5. `contexts/register.ts`: `contextOutlineCommands`·`contextOutlineReads` import와 `commands`·`reads` 목록의 두 spread, 가짜 deps(`UNATTACHED`)의 `folders.outlineFolder()` 칸을 지운다.
6. `contexts/folders.ts`: `outlineFolder`와 파일 머리 주석의 `outlines/<파일 경로 hash>.json` 줄, "저장 목차" 말을 지운다(초안 폴더만 남는다). `packages/core/projects/ports.ts`: `ContextFolders.outlineFolder`와 주석의 "목차"를 지운다. `contexts/ledger/deps.ts`: `folders.outlineFolder`와 `foldersAt` 위 주석의 "저장 목차 폴더"를 지운다.
7. `contexts/extract/types.ts`: `StoredOutlines` type, `KindContext.storedOutline` 칸을 지운다. `OutlineEntry` 주석("pdf·docs는 저장된 목차에서 온다")을 md만으로 고친다.
8. `contexts/extract/run.ts`: `extractAll`의 네 번째 인자 `storedOutline`, `StoredOutlines` import, `KindContext`에 `storedOutline`을 넣는 줄을 지운다. 호출처(`contexts/check/runner.ts`, `contexts/index/scan.ts`)는 이미 인자를 넘기지 않으므로 고치지 않는다.
9. `contexts/extract/outline.ts`: `outlineKind`에서 `format` 분기와 `context.storedOutline` 호출을 지워 md 목차(`readDocument(path).headings`)만 남긴다. 파일 머리 주석에서 "pdf·docs처럼 ... 저장된 목차를 쓴다"를 뺀다. `OutlineEntry | null` 타입 선언은 단순하게 줄인다.

### 3. agent tool·문구 지우기

10. `packages/core/lophn-agent/tools/bundles/outline.ts`를 지운다. `tools/builtin.ts`에서 `OUTLINE_TOOLS` import와 spread를 뺀다(조립 목록의 지운 것을 가리키던 줄만 뺀다).
11. `roles/project-manager/prompt.md`: "For pdf and docs files, you alone make, change and delete their outline, with `outline.get`, ..." 항목(두 줄)을 지운다. `roles/lophn/guides/roles-and-grants.md`: "It also makes outlines for pdf and docs files." 문장을 지운다(앞뒤 문장이 이어지게 다듬는다). `context-init/SKILL.md`의 "an outline" 말은 md 목차 source를 가리키므로 건드리지 않는다(소유 밖).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 지우는 일이다. md 목차는 `protocol/projects/outline-markdown_test.ts`가 이미 본다.
- 남지 않음:
  - `grep -rnE "outlineGet|outlineSet|outlineDelete|contextOutlineSchema|ContextOutline\b|CONTEXT_OUTLINE|outlineFolder|storedOutline|StoredOutlines|OUTLINE_TOOLS|contextOutline(Reads|Commands)|outline\.(get|set|delete)" packages tools --include=*.ts --include=*.tsx --include=*.md --exclude-dir=node_modules --exclude-dir=dist`가 0줄이다.
  - `ls packages/core/projects/contexts/outlines.ts packages/protocol/projects/context-outlines.ts packages/core/lophn-agent/tools/bundles/outline.ts`가 모두 없다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(지우기만이다)
- 안 쓰게 된 export: `tools/domain/result.ts`의 `notFound`·`invalid`, `tools/context/visible.ts`의 `checkVisible`, `ledger/app-bound.ts`의 `authorizeRead`·`denyCommand` 등 이 task로 쓰는 곳이 없어진 것이 있으면 적는다. 남이 쓰던 것은 지우지 않는다.
- 정한 것: 위 "정한 것"에서 더 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: `outlineSourceSchema.format` 칸을 지우자는 제안이 있으면 여기에 적는다(고치지 않는다).
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
