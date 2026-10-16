# remove-documents-protocol

protocol의 문서 옛 약속(주소·판·문서 route·format·series·outline·history·upload)을 지우고, 그것을 import하던 곳(coding agent CLI·MCP, project 읽기, 작은 protocol file)에서 문서 쪽을 걷는다. core와 renderer의 구현은 앞 task들이 지웠으므로 이 task가 마지막이다.

- 단위: remove-documents (wave 1)
- 선행: remove-documents-core, remove-documents-sdk, remove-documents-ui, remove-app-extras-tools
- 소유(이 task만 고친다):
  - `packages/protocol/projects/address.ts`
  - `packages/protocol/projects/document-events.ts`
  - `packages/protocol/projects/document-files.ts`
  - `packages/protocol/projects/documents.ts`
  - `packages/protocol/projects/format-bounds.ts`
  - `packages/protocol/projects/format-extraction.ts`
  - `packages/protocol/projects/formats.ts`
  - `packages/protocol/projects/guides.ts`
  - `packages/protocol/projects/history.ts`
  - `packages/protocol/projects/outline-entries.ts`
  - `packages/protocol/projects/outline.ts`
  - `packages/protocol/projects/sections.ts`
  - `packages/protocol/projects/series-values.ts`
  - `packages/protocol/projects/series.ts`
  - `packages/protocol/projects/uploads.ts`
  - `packages/protocol/projects/versions.ts`
- 추가 소유(lead 승인, 2026-10-16. 소유와 같이 고친다. 지운 것을 가리키는 줄만 고친다. core·shell 조립이 wiring file로 쪼개졌으면 그 줄이 옮겨 간 wiring file이 대신한다. "등록 file(lead)"도 지운 것을 가리키는 줄만 뺀다.):
  - protocol/projects(contract-calls-places 몫): 지울 file `read.ts`, `read-values.ts`, `search.ts`. 고칠 file `places.ts`, `projects.ts`, `file-values.ts`, `files.ts`
  - protocol/coding-agent(contract-coding 몫): `cli-core.ts`, `mcp-core.ts`, `ticket-values.ts`
  - coding agent(coding-agent 몫): `packages/coding-agent/cli/commands/{document,format,save,series,index}.ts`, `cli/dispatch.ts`, `cli/help.ts`, `cli/registry.ts`, `connection/{document-save,save-result,submission,upload-bytes,mod}.ts`, `mcp-server/tools/{document,format,save,series,project,index}.ts`, `mcp-server/registry.ts`
  - lophn-agent(agent-tools·agent-definition·approvals 몫): `packages/core/lophn-agent/tools/bundles/{guide,problem-interpretation,question-actions}.ts`, `tools/questions/option-actions.ts`, `tool-judgment/work.ts`, `roles/lophn/{place-recommendation,plan,work}.ts`
  - registry(places-sessions 몫): `packages/core/projects/registry/{authorization,cursor,reads}.ts`
  - 등록 file(lead): `packages/protocol/projects/mod.ts`의 export와 `ROUTES`·`EVENTS` 목록, `packages/protocol/registry.ts`
- 읽을 것:
  - spec: S4 9장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`, S6 10장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/coding-agent.md`
  - 삭제 목록: `/home/pyosechang/projects/lophn/project-docs/tmp/notes/removed.md` 1장
  - inventory: `I1.1#8`(`Document*`·`Series*` event 정의만), `I2.6#25`(지우는 file에 든 `coding_agent` actor 몫만), `I2.10#14`(protocol 안내 schema를 줄이는 부분만) — `../assignment.md`에서 이 task가 맡은 줄
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `code-map.md`
- 계약:
  - 쓰는 것: 없음. 단 `protocol/projects/openable-format.ts`(`remove-documents-move`가 만든 새 file)는 지우지 않는다
  - 내놓는 것: 안내 schema만 남은 `protocol/projects/guides.ts`: `GuideReference`·`guideReferenceSchema`, `BundledGuide`·`bundledGuideSchema`, `ContentFile`·`contentFileSchema`·`contentFilesOutputSchema`(`ContentFile`은 안내 file 하나의 모양이다). 안내 route(`guide.list/get/outline/read`)는 없다. `PlaceRef`·`placeRefSchema`·`placeRefOutputSchema`는 `places.ts`에 있다

## 할 일

1. 소유 file을 지운다. 단 `guides.ts`는 위 "내놓는 것"만 남기고 줄인다. (I1.1#8, I2.10#14)
   - `outline-markdown-sha256.ts`는 지우지 않는다. 남는 `outline-markdown.ts`(contexts가 쓰는 md 목차 parser)가 동기 sha256을 쓴다.
   - `PlaceRef`(`placeRefSchema`, `placeRefOutputSchema`)는 `address.ts`에 있지만 문서 개념이 아니다. `places.ts`로 옮겨 `roles/lophn`, 질문 옵션, CLI가 계속 쓴다.
   - `places.ts`의 `PlaceNameReservation`·`placeNameReservation`·`placeNameSchema`는 지운다(이름 예약은 앞 task가 걷었다).
2. 추가 소유가 승인됐으면 쓰던 곳을 고친다.
   - `read.ts`, `read-values.ts`, `search.ts`는 문서 읽기·옛 `search.query` route라 지운다. 새 키워드 검색 route는 contract-calls-places가 새 file로 만든다.
   - `projects.ts`: `agentProjectSchema`·`userProjectSchema`의 `documents`(`fixedDocumentRefOutputSchema`)와 `document_count`를 지운다. 지운 type을 쓰는 칸이 문서 id·주소·판을 가리키면 칸째 지운다. `registry/{authorization,cursor,reads}.ts`의 `DocumentRef` 쪽도 같이 걷는다.
   - `file-values.ts`: `documentFileInputSchema`(document-files.ts), `instructionTargetSchema`·`saveResultSchema`(versions.ts)를 쓰던 곳을 줄인다. `files.*` route 모양 자체는 contract-calls-places와 places-sessions가 새로 정하니 이 task가 더 바꾸지 않는다.
   - `protocol/coding-agent/{cli-core,mcp-core,ticket-values}.ts`: 문서·format·series·outline·history route를 쓰던 항목을 지운다. `ticket-values.ts`의 `addressSchema` 쓰임도 걷는다.
   - coding agent: CLI `document`·`format`·`save`·`series`·`index`(outline) 명령과 MCP 도구 `document`·`format`·`save`·`series`·`project`(outlineRoot), 그것들이 쓰던 connection 도우미(`document-save`, `save-result`, `upload-bytes`, `submission`의 `DocumentFileInput`)를 지운다. 명령 목록(`cli/registry.ts`, `cli/help.ts`)에서도 뺀다. MCP 쪽은 wave 3 coding-agent가 통째로 지우니 이 명령·도구만 걷는다.
   - lophn-agent: `bundles/guide.ts`의 `guide.outline` 도구와 `guideList`·`guideRead` route 호출을 걷는다(안내 읽기는 agent-tools가 새로 짓는다). `question-actions.ts`·`problem-interpretation.ts`·`tool-judgment/work.ts`의 `documentGet`, `option-actions.ts`의 `documentMove`·`documentRename` 분기는 문서 개념이 사라져 분기째 지운다. `roles/lophn/work.ts`는 `BundledGuide`·`ContentFile`을 `guides.ts`에서 가져오게 둔다.
   - `I2.6#25`: 지운 file에 든 `coding_agent` actor 항목은 file과 함께 사라진다. approvals·questions·sessions·grants·blob upload 등 남은 file의 `coding_agent` 정리는 contract-coding 몫이니 건드리지 않는다.
3. `protocol/projects/mod.ts`에서 지운 file의 export와 `DOCUMENT_ROUTES`·`FORMAT_ROUTES`·`OUTLINE_ROUTES`·`READ_ROUTES`·`HISTORY_ROUTES`·`SEARCH_ROUTES`·`GUIDE_ROUTES`·`SERIES_*`·`UPLOAD_ROUTES`·`DOCUMENT_EVENTS`·`DOCUMENT_READ_ROUTES`를 뺀다. `protocol/registry.ts`가 이 목록을 모으면 같이 고친다(등록 file이니 지운 항목만 빼고 보고한다).
4. 문자열로만 남은 route 이름을 grep으로 찾는다: `"document.`, `"format.`, `"series.`, `"outline.`, `"search.`, `"guide.`, `/v1/documents`. 명령 도움말(`cli/help.ts`)과 도구 설명 문자열은 check가 못 잡는다.
5. `deno task check`를 돈다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지우기만 한다)
- 남지 않음: `grep -rn "protocol/projects/\(address\|documents\|document-events\|document-files\|formats\|versions\|series\|uploads\|history\|outline\|sections\)\b" packages tools`가 0줄이다. `grep -rn "documentList\|documentSave\|documentPrepare\|documentUpload\|seriesGet\|formatValidate\|outlineRoot" packages`도 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/projects/mod.ts`·`protocol/registry.ts`에서 뺀 목록, `protocol/projects/openable-format.ts` export가 남아 있는지
- 안 쓰게 된 export: `protocol/base/ids.ts`의 `Document`·`Version`·`Series` id 종류와 `protocol/projects/values.ts`의 문서 key schema(`documentIdSchema`, `sectionKeySchema`, `versionIdSchema` 등)가 남았으면 이름을 적는다(cleanup이 지운다)
- 정한 것: `outline-markdown-sha256.ts`를 지우지 않은 것, `guides.ts`에 남긴 것, `projects`의 `documents`·`document_count`를 지운 것
- 걱정: contract-calls-places가 `places.ts`·`projects.ts`·`file-values.ts`를 같은 때에 고치면 충돌한다. 이 task가 먼저 merge되는 순서를 권한다
- 계약 바꾸기 요청: 없음
