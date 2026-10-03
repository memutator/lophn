---
type: research
concerns: [lophn-agent/visuals]
---
# 대화 안의 시각 블록

## 질문

표·차트·도표를 선언형 데이터로 받나, 아니면 markdown·HTML·코드로 받아 그리나. 크기 상한을 넘기면 자르나 거절하나.
model이 보낸 HTML·script·URL을 어디서 막고, 깨지거나 다 못 그린 블록을 어떻게 보여 주나.
stream 도중 미완성 블록과, 그림 자체를 파일로 남기는 기능이 있나.

## 프로젝트별

### OpenClaw (37efa0b4a644)

시각 출력이 두 갈래다. 둘 다 대화 메시지가 아니라 세션 dashboard의 widget이다.

**HTML widget.** `src/canvas/widget-tool.ts`의 `show_widget` tool이 model에게 HTML을 직접 받는다. `kind` 기본값은 `"html"`(`:347`)이고, 설명문이 "Send markup directly in widget_code. Scripts, stylesheets, and fonts may load from CDN"이라고 script·외부 자원을 허용한다(`:329`). 상한은 HTML **10 MiB**(`WIDGET_HTML_MAX_UTF8_BYTES`, `packages/gateway-protocol/src/schema/canvas.ts:6`), 등록된 다른 kind는 **262,144자**(`REGISTERED_WIDGET_CODE_MAX_CHARS:45`), scope당 widget **32개**(`WIDGET_MAX_PER_SCOPE:46`). 넘으면 `WidgetHtmlInputError`로 거절하고 자르지 않는다(`assertWidgetHtmlSize:355`). inline script는 저장 전에 `findWidgetScriptSyntaxError`(`widget-script-syntax.ts:118`)로 문법 검사해 오류의 script 번호·줄·칸을 돌려주고 다시 부르게 한다(`widget-tool.ts:363`). 실행을 막는 게 아니라 문법만 본다 [확인].

**sandbox.** `buildBoardWidgetContentSecurityPolicy`(`src/gateway/board-sandbox.ts:33`)가 `default-src 'none'`, `object-src 'none'`, `frame-src 'none'`, `form-action 'none'`, `webrtc 'block'`에 `sandbox allow-scripts`를 준다. script는 `'unsafe-inline'` + CDN allowlist라 **script 실행을 허용**한다. `connect-src`만 grant된 origin으로 제한되고, inline widget은 fetch가 없다(설명문: "Inline widgets cannot fetch APIs", `widget-tool.ts:329`). iframe은 `wrap.ts:74`에서 부모와 origin을 끊는다 [확인].

**선언형 report.** `src/boards/board-report.ts`의 `BoardReport`가 데이터만 받는다. `reportSchema`(`:23`)는 `z.strictObject` + discriminated union으로 `text / metrics / table / chart / links` 블록만 받고, 안내 문구가 "No HTML, scripts, styles, network reads, or executable actions"다(`BOARD_REPORT_GUIDANCE:5`). 상한은 JSON **8 KiB**(`BOARD_WIDGET_PROPS_MAX_BYTES`, `board-layout.ts:17`), 블록 **24개**, metrics·열 **8개**, 행·chart point **40개**, link **20개**. chart는 `bar | line`만, 값은 number. link는 `http(s)` URL만(`z.url({ protocol: /^https?$/ })`, `:54`). 초과는 `BoardValidationError`로 전체 거절이고 자르지 않는다(`parseBoardReport:73`) [확인]. 출처·관측 시각 필드는 없다. 값이 어디서 왔는지 적는 자리가 없다 [확인].

**저장.** pin하면 세션 dashboard에 widget으로 남는다(`pin=true`, `widget-tool.ts:380`). 실행 코드 없는 정적 HTML로 내보내거나 이미지로 남기는 기능은 canvas 코드에서 찾지 못했다 [미확인].

**stream.** tool 인자로 한 번에 받으므로 미완성 블록 처리가 없다. 문법 오류는 완성된 입력 기준이다 [확인].

### Codex (3a69ec3ef8fb)

대화 본문은 markdown이고, 시각은 mermaid fence 하나다. `codex-rs/tui/src/markdown_render/mermaid.rs`가 닫힌 fence만 그린다. `has_closing_fence`(`:19`)가 여는 fence 길이 이상의 닫는 표시가 content 밖에 있어야 true를 반환하므로, stream 중 아직 안 닫힌 fence는 그림이 아니다(`:4` 주석: "Callers only render completed fences") [확인].

**상한.** `codex-rs/mermaid/src/lib.rs`가 `MAX_SOURCE` **16 KiB**(`:20`), `MAX_NODES` **16**(`:21`), `MAX_EDGES` **24**(`:22`), `MAX_LABEL` **40**(`:23`), `MAX_CELLS` **65536**(`:24`)을 둔다. 넘으면 `RenderError::Limit`(`lib.rs:64`)이고, 렌더러는 원본 code block을 유지한 채 이유 한 줄을 앞에 붙인다(`mermaid.rs:43`: "exceeds the terminal renderer's size limits"). 지원 밖 문법(`Unsupported`)과 터미널 폭 초과(`TooWide`)도 같은 방식이다. 그림을 자르거나 일부를 성공으로 보여 주지 않는다 [확인].

**안전.** "diagrams never emit terminal control sequences"(`mermaid.rs:4`). 입력이 mermaid 텍스트라 HTML·script·URL이 들어올 자리가 없다. 좌표·SVG를 받지 않고 렌더러가 배치한다 [확인].

**출처·저장.** 출처 표기 없음. 결과는 터미널 텍스트라 파일로 남기는 기능이 없다. 원본 fence는 transcript가 그대로 가진다(`mermaid.rs:3` "Source remains owned by the transcript") [확인].

### Pi (83692682f095)

Codex와 같이 markdown mermaid fence를 터미널 문자 그림으로 바꾼다. `packages/coding-agent/src/modes/interactive/components/mermaid.ts`의 `createMermaidMarkdownTransformer`(`:60`)가 `grok-mermaid`의 `render`로 `MermaidArt`를 만들고, 폭이 `context.availableWidth`를 넘으면 원본 fence를 그대로 둔다(`:76`) [확인].

**상한.** 폭 비교 외의 숫자 상한은 이 파일에 없다. `grok-mermaid` 패키지 소스는 이 저장소에 없어 node·edge 상한은 확인하지 못했다 [미확인].

**실패 표시.** `art.warnings`가 있으면 원본 fence 아래에 `Mermaid diagram not rendered: <첫 경고> (+N more)`를 붙인다(`:77`). 그림을 부분으로 보여 주지 않는다 [확인].

**stream.** 설정 `markdown.mermaid`는 `"off" | "final" | "streaming"`, 기본은 **streaming**이다(`settings-manager.ts:87,1512`). streaming이 아니면 stream 중에는 transformer가 markdown을 그대로 반환해(`mermaid.ts:63`) 미완성 fence를 그리지 않는다. streaming 모드에서는 stream 중에도 그린다. 경고 표시는 stream 중이 아닐 때만 붙인다(`:77`) [확인].

**안전·출처·저장.** 입력이 mermaid 텍스트라 script·URL 자리가 없다. 출처 표기 없음. 파일 저장 없음 [확인].

### Gemini CLI (fb972b2f87fe)

차트·도표 렌더러는 없고, markdown table만 따로 그린다. `packages/cli/src/ui/utils/MarkdownDisplay.tsx:68`이 `|`로 시작하는 줄과 separator 줄을 모아 `TableRenderer`(`TableRenderer.tsx`, 333줄)로 넘긴다. 행·열 상한은 `TableRenderer.tsx`에서 찾지 못했다. 초과를 거절하지 않고 있는 그대로 그린다 [확인, 상한은 미확인].

**안전.** markdown 렌더링이라 model이 HTML·script를 보낼 통로가 이 표 경로에는 없다. 다만 별도 상한 검사가 없어 큰 표의 제한은 터미널 높이에 맡겨진다 [확인].

**출처·저장·stream.** 출처 표기 없음. 표만 파일로 남기는 기능 없음. stream 처리도 이 표 경로에는 없다 [확인].

## 비교

| 항목 | lophn (요구) | OpenClaw report | OpenClaw HTML widget | Codex mermaid | Pi mermaid | Gemini CLI table |
|---|---|---|---|---|---|---|
| 형식 | 선언형 명세만 (R1) | 선언형 JSON (zod strict) | HTML·script 직접 수신 | mermaid 텍스트 | mermaid 텍스트 | markdown 표 |
| 종류 | 표, bar/line/scatter, node·edge 도표, 앱 카드 (R1) | text, metrics, table, bar/line chart, links | HTML 자유 | mermaid 도표만 | mermaid 도표만 | markdown 표만 |
| 블록 수 | 메시지당 8 (R3) | report당 24 | scope당 widget 32 | fence당 1 | fence당 1 | 제한 없음 |
| 크기 | 합계 256 KiB, 표 1000행·20열, 차트 8 series·1000점, 도표 100 node·200 edge (R3) | 8 KiB, 열 8, 행 40, point 40 | HTML 10 MiB | source 16 KiB, node 16, edge 24, label 40자 | 폭 초과만 확인 | 없음 |
| 초과 처리 | 자르지 않고 전체 거절 (R3) | 전체 거절 | 전체 거절 | 원본 유지 + 이유 | 원본 유지 | 그대로 그림 |
| 출처·설명 | 제목·설명·출처 필수, 근거 없는 값은 명시 (R2) | 없음 | title만 (host metadata) | 없음 | 없음 | 없음 |
| script·URL | 거절 (R1) | schema가 거부 (link는 http(s)만) | script 허용, CSP로 origin만 제한 | 입력 자리가 없음 | 입력 자리가 없음 | 입력 자리가 없음 |
| sandbox | 실행 자체가 없음 | 실행 필드 없음 | iframe + CSP, script는 허용 | 터미널 문자, control sequence 없음 | 터미널 문자 | markdown |
| 깨진 명세 | 메시지 본문·설명·참조 보존, 이용 불가 표시 (R5) | 입력 단계에서 거절 | 문법 오류 줄·칸 반환 후 재시도 | 원본 fence + 이유 한 줄 | 원본 fence + 경고 | 없음 |
| 파일로 남기기 | 실행 코드 없는 HTML 문서 (R6) | 없음 (dashboard pin) | 없음 | 없음 (원본은 transcript) | 없음 | 없음 |
| stream 미완성 | 확정 전 조각은 저장 안 함 | 해당 없음 (tool 인자) | 해당 없음 | 닫힌 fence만 그림 | 기본 streaming (모드로 끔) | 없음 |
| 검증 | 엄격 schema, unknown field 거절 | `z.strictObject` | script 문법 검사만 | 파서 오류 = 미지원 | 경고 수집 | separator 줄 확인만 |

## lophn에 가져올 것과 버릴 것

**[R1] 선언형만.** 비교 대상 중 선언형으로 받고 script를 구조적으로 거부하는 것은 OpenClaw `BoardReport` 하나다. 나머지는 markdown 텍스트(Codex, Pi, Gemini)거나 HTML을 그대로 실행한다(OpenClaw widget). 가져올 것: `strictObject` + discriminated union으로 종류를 고정하고 unknown field를 거절하는 방식, link·script·style 자리를 schema에서 없애는 것. 버릴 것: `show_widget`의 HTML 입력과 CDN script 허용. lophn은 앱 카드가 live 앱 화면 참조라 widget HTML과 다르게 가야 한다.

**[R3] 상한과 거절.** 초과를 잘라 일부만 보여 주지 않는 점은 OpenClaw(거절)와 Codex·Pi(원본 유지 + 이유)가 같다. Gemini table은 상한이 없어 반대 사례다. 가져올 것: 거절 메시지에 어느 상한을 넘었는지 넣는 것(OpenClaw script 오류가 줄·칸을 돌려주듯). 버릴 것: Codex처럼 렌더 시점에 조용히 원본으로 되돌리는 것. lophn은 저장 전에 거절해야 하므로(R3 "더 작은 블록을 요청") 화면에 도착한 블록은 항상 유효해야 한다. 숫자 자체는 OpenClaw report(8 KiB, 행 40)가 lophn(256 KiB, 행 1000)보다 훨씬 작다. 터미널 폭 제약이 없는 화면이라 더 큰 값이 가능하지만, 1000행 표가 한 메시지에 8개면 화면이 감당하는지는 구현 때 확인이 필요하다. open-issues 후보 아님 — 요구가 이미 숫자를 정했다.

**[R2] 출처.** 어느 프로젝트도 값의 출처를 블록에 붙이지 않는다. Codex가 "원본 fence는 transcript 것"이라고 소유만 구분할 뿐 데이터가 어디 문서·어느 command에서 왔는지는 없다. 출처 표기는 lophn이 새로 만드는 자리고, 비교에서 가져올 선례가 없다. 빈 데이터와 결측을 0으로 바꾸지 않는 요구는 이 네 곳 모두 명시하지 않는다. chart 결측을 null로 두는 테스트가 따로 필요하다.

**[R5] 깨진 블록.** Codex·Pi는 렌더 실패 뒤에도 원본 텍스트를 남긴다. 이게 "실패해도 본문이 남는다"는 요구와 같다. 다만 둘은 원본이 곧 그림의 입력이라 분리가 없다. lophn은 렌더가 SDK 몫이라 렌더 실패와 참조 소멸(앱 archive, release 변경)을 나눠야 하고, 이 구분은 어느 프로젝트에도 없다. 가져올 것: 실패 이유를 본문과 분리해 한 줄로 보이는 것. 버릴 것: 최신 것으로 대체. 대체 금지는 비교 대상에 대응 기능 자체가 없다.

**[R6, R7] 문서로 남기기.** 실행 코드 없는 정적 HTML로 내보내는 곳은 없다. OpenClaw pin은 live dashboard라 문서가 아니다. 이 기능은 선례 없이 새로 만든다. 정적 HTML을 만들 때 Codex의 "control sequence를 절대 내지 않는다"는 원칙을 가져온다: 명세는 escaped JSON으로만 넣고 script·iframe·외부 URL을 만들지 않는다(domain model이 이미 그렇게 정함).

**[R7] stream.** Pi의 기본값 streaming은 lophn과 반대다. lophn은 확정 전 조각을 저장하지 않으므로(observability R11) 시각 블록도 닫히기 전에는 그리지 않는 Codex 방식이 맞다. 가져올 것: 닫힘 확인 전엔 원문 그대로 두고 확정 뒤에만 그리는 것. 버릴 것: Pi의 streaming 모드.

## 구현 메모

**입력 검증 순서.** 순서가 바뀌면 거절 이유가 달라진다.

1. JSON parse. 실패하면 `invalid_input`, 아무것도 저장하지 않는다.
2. 최상위가 배열이고 길이가 1..8인지. 9개면 전체 거절.
3. 블록마다 `schema_version`, `kind`, `key` 중복, unknown field.
4. kind별 payload: 표 열 1..20·행 0..1000·행의 키가 선언 열뿐, 차트 series 1..8·point 합 1..1000·x type과 point 짝, 도표 node 1..100·edge 1..200·양끝이 있는 node.
5. canonical JSON UTF-8 byte 합이 262144 이하인지. 이 검사는 마지막에 한다. 앞 단계에서 자른 값으로 크기를 재면 안 된다.
6. 하나라도 실패하면 메시지 전체를 거절하고 통과한 블록도 저장하지 않는다(R3 부분 저장 금지).

**거절 메시지.** 어느 블록 `key`의 어느 상한을 넘었는지 한 줄로 돌려 더 작은 블록을 다시 받게 한다. 받은 원문의 일부를 오류 메시지에 넣지 않는다(OpenClaw는 script 오류에 해당 줄을 넣는데, 여기엔 본문이 클 수 있어 뺀다).

**결측.** 차트 point의 null은 결측이다. 0으로 바꾸거나 점을 빼지 않는다. line은 입력 순서대로 잇되 null 점에서 선을 끊을지 이을지는 SDK 몫이고, 데이터는 그대로 둔다.

**깨진 참조 표시.** 앱 카드는 `release`가 현재와 다르면 `contract_changed`, 앱·화면이 없으면 `unavailable`. 둘 다 원래 `app`·`release`·`view` 참조와 설명 텍스트를 남기고 다른 앱이나 최신 release로 바꾸지 않는다. 렌더 중 예외가 나도 메시지 본문은 그대로 두고 그 블록만 이용 불가로 표시한다.

**stream.** 블록은 메시지가 확정된 뒤에만 그린다. stream 중 도착한 부분 JSON은 화면에 올리지 않고, 확정 실패면 블록 없이 텍스트만 남는다.

**문서 저장.** `visual.prepare_document` 결과는 `text/html` blob 하나다. 내용은 제목·설명·출처, 명세의 escaped JSON, SDK가 만든 정적 그림·표다. script·iframe·외부 자원·앱 token을 넣지 않는다. 앱 카드는 snapshot을 얻으면 그것만, 못 얻으면 `unavailable`과 참조만. 준비 성공을 문서 저장 성공으로 세지 않는다(저장은 `document.create/save_version` 한 번).

**테스트 경계.**

- 블록 8개 수용, 9개 전체 거절. 표 1000행 수용, 1001행 거절. 차트 point 합 1000 수용, 1001 거절. 도표 edge 200 수용, 201 거절 (R3).
- unknown field, `kind` 오타, 차트 `type: "pie"`, 도표 edge가 없는 node를 가리키면 거절 (R1).
- payload에 `<script>`, `javascript:` URL, 임의 http URL이 있으면 거절. 앱 카드 `input`에 URL이 있어도 거절 (R1).
- 행 안 숫자가 아닌 값, 무한대·NaN 거절. null은 수용하고 화면에서 0으로 보이지 않는지 (R2).
- 출처 없는 블록은 저장되되 설명에 근거 없음이 보이는지. 빈 행 배열은 빈 표로 보이는지 (R2).
- 참조한 release를 archive한 뒤 메시지가 `unavailable`로 보이고 본문·설명·원래 참조가 남는지. 최신 release로 바뀌어 보이지 않는지 (R5).
- 렌더러가 예외를 던져도 같은 메시지의 다른 블록과 텍스트가 남는지 (R5).
- stream 중 절반만 도착한 JSON이 화면에 안 나오고, 확정 뒤에만 나타나는지.
- 문서로 남긴 HTML에 script·iframe·외부 요청이 없는지, 세션을 닫아도 문서가 열리는지, snapshot을 못 얻은 카드가 이용 불가로 남는지 (R6, R7).
