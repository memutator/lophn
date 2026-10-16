# remove-app-extras-tools

lophn-agent의 tool 쪽에서 없어지는 것을 지운다: `document.*` tool 열 개와 그 보조 operation(`SaveToolDocument`, `document.prepare`, `document.save`), `format.*` tool, `series.next_name`, 앱 화면 context·주석 tool(`app.screen_context`, `app.annotate`). 시각 블록의 앱 카드가 화면 context 읽기 결과를 쓰던 부분도 걷는다. 문서가 디스크 파일이 되고(S4 9장) 앱 화면 메모·상태가 없어져서 대체 없이 없어진다. file·shell·web tool은 wave 3 agent-tools가 새로 짓는다.

- 단위: remove-app-extras (wave 1)
- 선행: core-wiring
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/tools/series-next-tool.ts`
  - `packages/core/lophn-agent/tools/tool-documents.ts`
  - `packages/protocol/lophn-agent/tool-documents.ts`
  - `packages/core/lophn-agent/tools/visuals/`
- 추가 소유(lead 승인, 2026-10-16. 소유와 같이 고친다. 지운 것을 가리키는 줄만 고친다. core·shell 조립이 wiring file로 쪼개졌으면 그 줄이 옮겨 간 wiring file이 대신한다. "등록 file(lead)"도 지운 것을 가리키는 줄만 뺀다.):
  - 지울 file: `packages/core/lophn-agent/tools/bundles/document.ts`, `bundles/format.ts`, `bundles/app-context.ts`, `packages/core/lophn-agent/tool-judgment/app-context-judgment.ts`
  - 고칠 file(agent-tools·approvals 몫): `packages/core/lophn-agent/tools/{registry.ts, mod.ts, context-search-tools.ts, app-toolkit.ts, app-tools.ts}`, `tools/bundles/handlers.ts`, `packages/core/lophn-agent/tool-judgment/{mod.ts, builtin-binding.ts}`, `packages/core/lophn-agent/register.ts`(`TOOL_DOCUMENT_ROUTES`)
  - 등록 file(lead): `packages/protocol/lophn-agent/{mod.ts, registry.ts}`의 `tool-documents` export와 `TOOL_DOCUMENT_ROUTES`, 조립의 `toolDocumentWorkers`(core-wiring이 쪼갠 뒤라면 `packages/core/main/daemon/wiring/` 아래 lophn-agent file)
- 읽을 것:
  - spec: S4 3장·4장·9장 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - 삭제 목록: `/home/pyosechang/projects/lophn/project-docs/tmp/notes/removed.md` 1장("앱 화면 메모", "문서의 판"), 2장("앱 화면 상태")
  - 결정: `/home/pyosechang/projects/lophn/project-docs/tmp/inventory/00-decisions.md` #110(앱 카드만 남긴다)
  - inventory: `I1.4#6`, `I2.4#40`, `I1.5#12`(tool 쪽 file만), `I6#26`(lead 몫 줄을 이 task가 한다) — `../assignment.md`에서 이 task가 맡은 줄. 표는 `/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md` 1.4, 1.5, 2.4장
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`, `code-map.md`
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 없음(지우기만 한다). 뒤 task(`remove-app-extras-apps`, `remove-documents-move`, `remove-documents-core`)가 `tool-documents.ts`·`app-context.ts`가 쓰던 module을 지울 수 있게 된다

## 할 일

1. `document.*` tool을 지운다. (I1.4#6)
   - `tools/bundles/document.ts`(`document.list`·`outline`·`search`·`read_version`·`read_section`·`read_range`·`history`·`diff`·`create`·`save_version`), `tools/bundles/format.ts`(`format.*`), `tools/tool-documents.ts`, `protocol/lophn-agent/tool-documents.ts`, `tools/series-next-tool.ts`(`series.next_name`)
   - `tools/registry.ts`: `DOCUMENT_TOOLS`·`FORMAT_TOOLS`·`SERIES_NEXT_TOOLS` 등록, `TOOL_BUNDLES`의 `format` 항목과 document 묶음, `SUPPORTING_OPERATIONS`의 `SaveToolDocument`. `LinkProblemInterpretation`은 problems 몫이니 남긴다.
   - `tools/mod.ts`의 해당 export, `tools/bundles/handlers.ts`의 `createDocumentToolHandlers`·`createFormatToolHandlers`, `tools/context-search-tools.ts`의 `createSeriesNextToolHandlers`, `lophn-agent/register.ts`의 `TOOL_DOCUMENT_ROUTES`.
   - `tool-judgment/builtin-binding.ts`의 `document.create`·`document.save_version` 항목.
   - 안내 읽기 tool(`bundles/guide.ts`)은 건드리지 않는다. `guide.outline` 정리는 `remove-documents-protocol`이 한다.
2. 앱 화면 context·주석 tool을 지운다. (I1.5#12의 tool 쪽)
   - `tools/bundles/app-context.ts`(`app.screen_context`, `app.annotate`), `tool-judgment/app-context-judgment.ts`와 `tool-judgment/mod.ts`의 export, `tools/mod.ts`의 export, `tools/app-toolkit.ts`의 화면 context 분기(`defineContext`, `contextBinding`, `contextHandlers`), `tools/app-tools.ts`의 `agent_context` 쓰임(blueprint 칸 자체는 계약 단위가 지운다).
   - 사람이 다는 annotation(S9)은 반대 방향이라 다른 단위가 새로 짓는다. 건드리지 않는다.
3. 시각 블록의 앱 카드를 화면 context 없이 그린다. (I2.4#40, I6#26)
   - `tools/visuals/work.ts`의 245·287줄 근처(`app.screen_context` read 결과를 쓰던 부분)를 걷고 앱 카드가 화면 context 없이 만들어지게 한다. 앱 카드 블록은 남는다(결정 #110).
   - 표·차트·도표 블록, `visual.prepare_document`, 시각 블록 출처 `document`는 건드리지 않는다. 그 줄은 agent-tools 몫이다.
4. 문자열로만 남은 tool 이름을 grep으로 찾는다(check가 못 잡는다): `document.`, `format.`, `series.next_name`, `app.screen_context`, `app.annotate`를 `packages/core/lophn-agent`, `packages/protocol/lophn-agent`, role 지침 문자열에서 찾는다. 아래 파일은 지우지 말고 보고한다: `roles/*`의 주석·지침 글, `prompt-assembly/*`(agent-definition 몫).
5. `deno task check`를 돈다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(지우기만 한다)
- 남지 않음: `grep -rn "createDocumentToolHandlers\|createFormatToolHandlers\|DOCUMENT_TOOLS\|FORMAT_TOOLS\|SERIES_NEXT_TOOL\|SaveToolDocument\|TOOL_DOCUMENT_ROUTES\|toolDocumentWorkers\|appScreenContextSchema\|app-context-judgment" packages tools`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/lophn-agent/{mod.ts, registry.ts}`와 조립에서 뺀 항목
- 안 쓰게 된 export: `protocol/apps/agent-context.ts`의 `appScreenContextSchema`(remove-app-extras-apps가 지운다), `tools/bundles/visual.ts`의 `document.create`를 말하는 설명 글과 `verifySources`의 `document` 출처(agent-tools), `session/rewind/record.ts`의 `document.create` 주석, `prompt-assembly/turn-context.ts`의 `document_editor`(agent-definition)
- 정한 것: 시각 블록의 표·차트·도표를 지우지 않은 것. 그 줄은 agent-tools와 화면 단위(screens-project)에 배정돼 있고 renderer가 같이 쓰기 때문이다. README 2.2의 "visuals(앱 카드 외)"는 wave 3에서 지운다
- 계약 바꾸기 요청: 없음
