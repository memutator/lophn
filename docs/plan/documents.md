---
type: plan
concerns: [documents]
---
# documents 구현 계획

최상위 concern `documents`의 leaf 9개(projects, file-tracking, versions, formats, outline-and-search, series, addressing, contexts, terms)와 `fixtures/projects/`를 만든다. 문서 편집 화면·목록 화면은 shell 팀이 만들고, 이 팀은 core 쪽 command·read 모듈, documents worker 프로세스, 그리고 그 contract의 구현을 맡는다.

정본: [intent](../intent/documents.md), requirements `docs/requirements/documents/`, domain model `docs/domain-model/documents/`, [architecture](../architecture/documents.md), 지나는 flow.

## 모든 작업에 공통

- 코드 자리는 `packages/documents/<leaf>/`이고 모양은 [architecture.md](../dev/architecture.md)를 따른다(`mod.ts`, `model.ts`, `commands.ts`, `reads.ts`, `work.ts`, `adapters/`, 옆에 `*_test.ts`). 같은 최상위의 다른 leaf는 그 leaf의 `mod.ts`로만 부른다. 다른 최상위는 `packages/contracts/<그 최상위>/`로만 부른다.
- 프로세스 배치(architecture/documents 2장): core 안에서는 command·read 모듈만 돈다. documents worker(coordinator 1)와 준비 worker 2 slot, 호출마다 뜨는 format runner(최대 2)는 `apps/worker/`의 kind로 조립한다. 무거운 일(scan, hash, blob 준비, 추출, diff, 검색)은 core에서 하지 않는다.
- ledger 표 DDL은 그 leaf 코드에 두고 platform의 migration 등록 contract로 올린다. derived store(`~/.lophn/derived/documents.sqlite`) 표는 outline-and-search의 adapter가 소유하고 coordinator만 쓴다.
- 테스트 이름은 요구 번호로 시작한다: `Deno.test("documents/versions#R3: 같은 내용과 format 계약의 저장은 기존 판을 돌려준다", ...)`. 시각·id·무작위 값은 `packages/base`의 interface로 주입한다. 파일 시나리오는 `fixtures/projects/`를 임시 폴더에 복사해 쓴다.
- 통합 테스트는 core를 임시 폴더의 파일 SQLite(WAL)와 임시 data root로 띄우고 API(`POST /v1/<resource>/<method>`)로 부른다. documents worker가 필요한 테스트는 실제 coordinator·준비 worker 프로세스를 띄운다. public route가 없고 core harness가 아직 없는 T5는 leaf의 test-only `node:sqlite` fixture에 contract Sql을 주입한다.
- core 등록은 `apps/core/documents.ts`, worker kind 조립은 `apps/worker/documents/`만 고친다. registry는 platform이 만든다(lead 결정 Q1).

## slice: skeleton

### T1 예시 project 폴더 fixture

- 상태: 완료 (#4)
- 등급: 좁은
- concern: documents/projects, documents/file-tracking, documents/formats, documents/series
- 요구: 없음 (아래 작업 테스트의 재료: projects#R3–R5, file-tracking#R3, R4, R11, formats#R2, R10–R16, series#R5, R8, outline-and-search#R11)
- 자리: fixtures/projects/
- 쓰는 contract: 없음
- 내놓는 contract: 없음 (fixture 폴더와 시나리오 helper)
- slice: skeleton
- 선행: 없음
- 완료:
  - `fixtures/projects/notes-basic/`: 하위 폴더 2단 이상, Markdown 문서들(ATX 1~6단, setext, YAML front matter, fenced code 안 heading 모양, HTML pre, `{#custom-id}`, 같은 제목 중복, 기호만 있는 제목, level 건너뛰기, 단일 h1·여러 h1, 서문, 한글 제목, BOM·CRLF·분해형 한글), `.gitignore`와 그에 걸리는 파일, `**/*.md` 밖 파일
  - `fixtures/projects/multi-folder/`: 두 root에 같은 상대 경로 파일, 중첩 폴더
  - `fixtures/projects/mixed-formats/`: HTML(script·style·template·nav·textarea·hidden·aria-hidden·section id·title fallback), XHTML, plain text, PDF, PNG, 알 수 없는 data
  - `fixtures/projects/weekly-report/`: series용 문서(P001, 0.2·0.9·0.10, 0.2.1, 자유 이름 key)
  - `fixtures/projects/korean-search/`: 긴 한국어 단어, 2글자 단어가 든 본문
  - `fixtures/projects/scenarios.ts`: fixture를 임시 폴더로 복사하고 바깥 변화를 만드는 helper(바깥에서 고치기, 지우고 같은 경로에 다시 만들기, 이름 바꾸기, root 밖 symlink, `.git` 폴더, lophn data 폴더, 권한 제거, 같은 size·mtime 수정). `.git`처럼 저장소에 넣을 수 없는 것은 helper가 만든다
  - `deno task check` 통과, fixture 목록과 쓰임을 `fixtures/projects/README.md`에 한 줄씩

## slice: documents

### T2 documents worker 프로세스 뼈대

- 상태: 완료 (#128) — 준비 worker의 실제 scan·hash·diff와 결과 command 제출은 T11 몫이다
- 등급: 기본
- concern: documents/file-tracking
- 요구: documents/file-tracking#R5
- 자리: packages/documents/file-tracking/ (작업 배분 scheduler, adapters/ipc의 요청 배분), apps/worker/documents/ (coordinator·준비 worker kind 조립)
- 쓰는 contract: platform 신뢰 child 감독(감독 pipe, ready, machine credential 전달), platform blob 준비 pipe, contracts#T6의 신뢰 child pipe framing(작업 요청·응답·byte chunk frame; documents 안에 따로 codec을 만들지 않는다)
- 내놓는 contract: 없음 (core↔coordinator↔준비 worker 내부 IPC)
- slice: documents
- 선행: platform#T7(신뢰 child 감독), platform#T8(worker entry와 kind 목록), platform#T9(core entry와 registry), contracts#T6(감독 pipe), contracts#T15
- 완료:
  - coordinator 1개가 준비 worker 2 slot을 띄우고 crash 시 그 slot을 새 프로세스로 채운다. 한 slot은 사람이 기다리는 요청을 먼저 받고, 기다리는 요청이 없으면 두 slot 모두 background
  - contracts#T6 framing 위에 `request_id, operation, input_ref, basis` 요청과 제한된 chunk를 싣는다. IPC 종료는 진행 요청의 `unavailable`이지 성공이 아니다. stderr에 본문·token을 쓰지 않는다
  - root별 iterator와 후보 큐, round-robin으로 최대 128 directory entry씩 배분, 결과 command 제출 동시 2개
  - core 비동기 dispatch: core는 IPC 결과를 기다리는 동안 command queue·JS 실행 흐름을 잡지 않는다
  - 권한: coordinator는 `--allow-net`·`--allow-env`·`--allow-ffi` 없이 `--no-prompt`. 준비 worker는 root·working copy·staging의 read와 필요한 write만
  - `packages/documents/file-tracking/scheduler_test.ts`에 file-tracking#R5: 큰 root scan 중 작은 root의 변경이 처리되고, 동시 준비가 2를 넘지 않고, 예산 초과는 unverified로 남는다
  - IPC 끊김·worker crash 테스트

### T3 document format 추출 규칙

- 상태: 완료 (#74)
- 등급: 기본
- concern: documents/formats
- 요구: documents/formats#R1, R2, R3, R9, R10, R11, R12, R13, R14, R15, R16, R17
- 자리: packages/documents/formats/ (`modules/document/`, `modules/pdf/`, `modules/image/`, `modules/data/`의 선언·validate·extract, model.ts의 출력 값)
- 쓰는 contract: contracts/documents의 FormatDeclaration, FormatDiagnostic, SectionExtractionResult, ExtractedSection
- 내놓는 contract: 없음 (T4가 묶어 실행한다)
- slice: documents
- 선행: T1, contracts#T17
- 완료:
  - module 코드는 Deno·Web 전역 없이 JSON·문자열·배열 계산만 쓴다(QuickJS guest에서 돈다). sha256도 module 안의 순수 구현
  - 내장 선언 4개: document(text/markdown, text/x-markdown, text/html, application/xhtml+xml, text/plain), pdf, image(image/*), data(나머지). MIME·구조·metadata 요구·template·guide·examples·vocabulary
  - 추출용 텍스트: UTF-8 decode → BOM 제거 → LF → NFC. 원문 바이트는 그대로
  - Markdown ATX·setext, front matter·fenced code·HTML pre 제외, 트리·범위, 유일한 h1은 title, `_preamble`, `{#id}` 우선 key, 자동 slug(`A & B`→`a--b`), 빈 slug는 `section`, 같은 부모 중복은 `-2`·`-3`, 명시 anchor 중복은 구조 error, 조상 slug를 `/`로 이은 key
  - HTML·XHTML 원본 h1~h6, 제외 구역, heading id 우선, 감싸는 section id는 첫 heading에만, title fallback. 스크립트·동적 DOM 실행 없음
  - plain text는 heading을 만들지 않는다. pdf·image·data extract는 `unsupported`
  - 출력: title, key, parent, position, level, anchor, own_ranges, subtree_range, characters, heading을 뺀 own range 본문 hash(body_hash), 대표 텍스트와 text_hash
  - `modules/document/*_test.ts`에 각 요구 번호 테스트(T1 fixture와 inline 입력). 같은 입력을 두 번 돌려 같은 출력

### T4 format runner 격리와 module 묶음

- 등급: 최상위
- concern: documents/formats
- 요구: documents/formats#R8, R18, R19, R20
- 자리: packages/documents/formats/ (adapters/quickjs-host, work.ts의 runner client·fixture 관문·출력 검사, module 묶음과 module_hash, reads.ts), apps/worker/documents/ (format-runner kind)
- 쓰는 contract: platform blob(정확한 module 묶음을 purpose `format_module`로 보존), platform read·인증
- 내놓는 contract: format 실행(`/v1/formats/list`, `/get`, `/validate`, `/extract`), SDK format Package가 다시 내보낼 내장 선언과 module_hash(질문 Q10)
- slice: documents
- 선행: T2, T3, contracts#T11, contracts#T17
- 완료:
  - runner는 호출마다 새 프로세스·새 QuickJS WASM context. guest에 `Date`·시간 API·`Math.random`·crypto 난수·`eval`·`Function`·동적 import·host object·WASM·FFI를 설치하지 않는다. 요청의 정확한 묶음 안 module만 로드
  - 초기 조절값: guest memory 64 MiB, 호출 5초(interrupt handler + coordinator deadline kill), 입력 16 MiB, 출력 8 MiB, runner heap 제한, 동시 2개. crash·한도 초과는 그 호출의 `unavailable`
  - module_hash는 묶음 코드·의존·추출 규칙·guest 실행 규약을 덮는다. 묶음은 재현 가능하게 만들고 check가 source와 묶음의 일치를 확인한다
  - 사용 가능 전에 입력·기대 출력 fixture 전부와 우회(파일·network·시간·난수·동적 코드) 테스트 통과. host가 출력 크기·key 유일·범위·부모 존재·비순환을 다시 검사
  - 옛 Version이 가리키는 module은 hash로만 찾고 이름으로 최신 module을 찾지 않는다. 누락·실행 실패·미지원을 구별하고 대체 추출을 하지 않는다
  - `/v1/formats/list`, `/get`(선언·template·guide·예시·vocabulary), `/validate`(파일·줄·열 위치, Version 없음), `/extract`
  - `runner_test.ts`에 formats#R18: 금지 접근마다 실패, 무한 loop kill, 대형 출력 거절, 반복 결과 같음. formats#R19: fixture 하나 실패나 순환 부모 출력 module은 쓰이지 않음. formats#R20: module 누락·runner 실패의 이유 구별. formats#R8: 검사만으로 판 수가 늘지 않음(API 통합 테스트)
- 상태: 완료 (#174)

### T5 address 문법과 이름 예약

- 상태: 완료 (#53)
- 등급: 기본
- concern: documents/addressing
- 요구: documents/addressing#R1, R2, R10
- 자리: packages/documents/addressing/ (model.ts의 Slug·PlaceRef·Address·DocumentRef 문법, 이름 제안·검사, commands.ts가 쓰는 `place_names`·`document_names` 예약 helper와 DDL)
- 쓰는 contract: platform command(Tx), platform migration 등록
- 내놓는 contract: 자리 이름 예약 port(apps/registration이 app 생성·이름 변경 transaction에서 부른다), Address parse/format(contracts/documents에 두면 shell·MCP·CLI가 같은 문법을 쓴다)
- slice: documents
- 선행: contracts#T14, platform#T1(ledger와 schema step), platform#T2(command 처리)
- 완료:
  - `<place>/<doc>#<section>@<version>`: version은 0으로 시작하지 않는 양의 10진수, section은 percent encoding, context는 place가 아님
  - project·app slug는 하나의 이름 공간, 문서 이름은 자리 안에서 유일, 현재·옛 예약 이름은 다른 대상에 재사용 불가(예약 행은 지우거나 target을 바꾸지 않음)
  - 이름 검사: `_`로 시작, address 구분자, 공백, 제어 문자 거절, 최대 길이(질문 Q5). 제목에서 영문 이름 제안, 첫 파일 이름을 재료로 씀, 한글 제목은 그대로 둠
  - `model_test.ts`에 addressing#R1, R10, `commands_test.ts`에 addressing#R2(project 이름을 app이, 옛 문서 이름을 다른 문서가 쓰면 conflict, 보관 뒤에도 예약 유지)
- 구현 메모: public contract의 Slug·PlaceRef·Address·DocumentRef schema와 parse/format을 소비·re-export한다. `addressingSchemaSteps`는 예약 표·index와 UPDATE/DELETE/중복 INSERT 거절 trigger를 제공한다(INSERT OR REPLACE도 target을 바꾸지 못함). 같은 target의 재예약은 helper의 no-op이며 최초 reserved_seq를 유지한다.
- 구현 경계: `createPlaceNameReservation(tx: Pick<Tx, "sql">)`와 `createDocumentNameReservation(tx: Pick<Tx, "sql">)`는 caller가 넘긴 현재 guarded Tx.sql에만 묶인다. 별도 connection·BEGIN/COMMIT·owner 표가 없다. SQL 실패는 platform 경계까지 throw를 전달한다. core entry·actual tx.port factory 조립은 T5가 구현하지 않는다(Q7).
- 통합 확인 후속: T5 완료 증거는 contract 소비·순수 이름 제안·WAL 예약 persistence와 주입한 guarded Tx의 rollback/lifetime까지다. 실제 writer Worker·current credential·core tx.port 조립은 아직 미검증이다. platform의 public `apps/core/testing/ledger.ts` harness가 main에 들어오면 T5 정정 또는 T7의 작은 통합 테스트로 owner 변경과 예약의 같은 rollback·seal 뒤 retained port 차단·다음 Tx fresh binding을 확인한다.

### T6 Document·Version ledger

- 상태: 완료 (#164)
- 등급: 기본
- concern: documents/versions
- 요구: documents/versions#R1, R2, R3, R4, R5, R6, R7, R8, R9, R11, R12
- 자리: packages/documents/versions/
- 쓰는 contract: platform command·read·인증(actor는 credential, run, 종료 run 거절)·blob(blob_refs 등록, 원문 read), addressing 예약 helper(T5)
- 내놓는 contract: `document.save`(준비 결과를 받는 command), `document.update`, `document.archive`, `document.unarchive`; read `/v1/documents/list`, `/get`, `/history`, `/file`; event `DocumentCreated`, `DocumentSaved`, `DocumentUpdated`, `DocumentArchived`, `DocumentUnarchived`
- slice: documents
- 선행: T5, contracts#T15, platform#T3(read), platform#T5(identity), platform#T14(blob 참조·읽기)
- 완료:
  - `documents`·`versions` 표와 DDL. 판 번호는 문서마다 1부터 연속. 여러 파일 판(대표 파일 하나 + 첨부)의 정규화 ContentFile 목록 blob과 `files_hash`·`content_hash`(codepoint 순 고정 필드 JSON의 SHA-256)
  - 첫 저장은 Document와 Version을 한 transaction에 만들고 `DocumentCreated`와 `DocumentSaved`(previous_version null)를 낸다. 새 판은 `DocumentSaved`
  - 최신 content_hash와 FormatRef(name, module_hash, explicit)가 같으면 기존 판과 `unchanged`, event 없음
  - base_version CAS, 신뢰한 preparation_ref만 받고 core에서 파일을 다시 읽거나 hash하지 않음. 저장 주체는 인증된 자격, 주장한 이름·작업 디렉터리로 source를 만들지 않음
  - 확정 판의 원문·형식·주체·시각·출처는 바꾸는 경로가 없다. 영구 삭제 route가 없다
  - `/v1/documents/list`(place, active·archived, 개수 조건, 최신 판 주체·시각·format), `/get`, `/history`(판마다 주체·시각·run), `/file`(고정 판의 ContentFile 상대 경로 → 저장 바이트와 MIME Content-Type)
  - `model_test.ts`, `commands_test.ts`, `reads_test.ts`에 각 요구 번호 테스트, API 통합 테스트(HTML·PDF·이미지 원문 바이트와 Content-Type 대조)

### T7 Project ledger

- 상태: 완료 (#79)
- 등급: 기본
- concern: documents/projects
- 요구: documents/projects#R1, R2, R3, R7, R8, R9, R10, R11
- 자리: packages/documents/projects/
- 쓰는 contract: platform command·read·인증, addressing 예약 helper(T5)
- 내놓는 contract: `project.create`, `project.update`(이름·제목·목적), `project.archive`, `project.unarchive`; read `/v1/projects/list`, `/get`, `/resolve`; 활성 tracking root 목록 read(platform 감독이 documents worker 권한을 만들 때 씀); event `ProjectCreated`, `ProjectUpdated`, `ProjectArchived`, `ProjectUnarchived`
- slice: documents
- 선행: T5, contracts#T14, platform#T3, platform#T5
- 완료:
  - `projects`·`project_folders`·`project_tracking_patterns` 표. 등록·변경은 user만(agent·app·coding agent는 forbidden). 폴더 0개·여러 개 허용, 기본 project 자동 생성 없음
  - create는 tracking.enabled=false만 받는다. 기본 제안 값(`**/*.md`, .gitignore 적용)은 read가 돌려준다
  - 켜진 tracking root 겹침(같은 실제 폴더, 조상·자손) 검사를 순수 함수로 두고 unarchive에서 쓴다(set_tracking은 T10)
  - 사람 read: 이름·목적·폴더 설명·문서 수·패턴·.gitignore 적용. agent read: 등록 목록·연결 project·읽을 자료 참조, 실제 경로·파일 목록 없음
  - resolve: 가장 깊은 등록 root(꺼진 중첩 root 포함), 내용 유사도로 재연결하지 않음. coding agent가 cwd로 resolve하면 project 참조만 돌려주고 경로·원본 연결은 만들지 않음
  - 이름 변경은 같은 transaction에서 place 예약, 보관은 문서·판을 지우거나 일괄 보관하지 않음
  - `commands_test.ts`, `reads_test.ts`, `model_test.ts`에 각 요구 번호 테스트, API 통합 테스트
- 착수 경계: Q12(contracts Q24, #72)가 들어왔고 `project.resolve_cwd`·`project.tracking_roots`·사람 read의 `initial_tracking_proposal`·list/resolve conflict·고정 version ref를 public harness(platform#T59) 통합 테스트로 소비한다. cwd 근거는 `ctx.conditions.cwd`다(Q14, #77). 근거가 없으면 fail-closed이고 caller path fallback은 없다. Q13의 owner target 검사는 해소(#82, #91)되어 command는 tx.port(TargetAuthorization), read와 event 반응은 snapshot.port(TargetAuthorization)로 domain target을 판정한다.

### T8 저장 준비 경로

- 등급: 기본
- concern: documents/versions, documents/formats, documents/file-tracking
- 요구: documents/formats#R4, R5, R7
- 자리: packages/documents/versions/ (work.ts의 준비 조립, `/v1/documents/prepare`·`/save` route), packages/documents/file-tracking/ (준비 worker의 파일 목록 검사, 같은 stream의 hash와 blob 준비, canonical ContentFile 목록), packages/documents/formats/ (validate 호출)
- 쓰는 contract: platform 인증·read·command·blob 준비 pipe, format 실행(T4)
- 내놓는 contract: 파일 준비 결과(`/v1/documents/prepare`, `/v1/documents/save`; PreparedVersion, SaveResult). `document.save`는 등록 command라 다른 owner가 platform#T18로 같은 Tx에서 부른다(lophn-agent의 tool 결과 확정; 질문 Q7)
- slice: documents
- 선행: T2, T4, T6, platform#T11(scope 재검사), platform#T13(blob 준비와 설치)
- 완료:
  - 호출자 자격(user, coding_agent, agent, app)으로 doc·base_version 또는 신규 doc·metadata, 파일 목록·대표 파일·내용 참조, FormatRef, idempotency key를 받는다. app·release·run·actor는 인증 근거로 확인하고 본문 주장으로 받지 않는다
  - 준비 worker가 안전한 상대 경로·유일 경로·대표 파일 하나·바이트 수를 검사하고 같은 stream을 hash와 blob 준비로 보낸다. canonical 목록, format validate 뒤 `preparation_ref`를 원래 요청·기준·blob에 묶는다
  - 명시 format의 error는 `invalid_input`으로 거절(사전 validate와 같은 오류), warning은 결과에 남김. 미지정 새 문서는 MIME 기본 format, 구조 error는 warning, 위험 경로·접근 실패·runner 실패는 낮추지 않음
  - 기존 문서는 base_version의 정확한 FormatRef. 최신 판이 바뀌면 conflict 뒤 재준비. 사람의 명시 format 변경만 새 판의 계약을 바꿈
  - 같은 idempotency key의 재전달은 같은 신규 doc ID
  - `work_test.ts`·API 통합 테스트에 formats#R4, R5, R7
- 상태: 완료 (#200) — 이어보냄: apps/core의 `documents/prepare` worker 조립(core workers map)과 준비 worker의 실제 같은 stream hash·blob 준비 → documents#T11

### T9 address 해석과 문서 이동·이름 변경

- 등급: 기본
- concern: documents/addressing
- 요구: documents/addressing#R1, R3, R6, R7, R8, R9
- 자리: packages/documents/addressing/ (reads.ts `/v1/documents/resolve`, commands.ts `document.move`·`document.rename`)
- 쓰는 contract: platform command·read·인증, contracts#T20의 App 등록 read(App 존재·status; apps 쪽 구현 전에는 test double), versions(T6) mod
- 내놓는 contract: `document.move`, `document.rename`(사람 경로. question option action 경로는 T30), read `/v1/documents/resolve`; event `DocumentMoved`, `DocumentRenamed`
- slice: documents
- 선행: T6, T7, contracts#T20
- 완료:
  - 해석: place 예약 → place ID, `(place ID, 이름)` 예약 → doc, version 지정이면 그 판·없으면 해석 시점 최신 판. 옛 project 이름·옛 문서 이름·옛 자리도 같은 대상의 현재 참조를 함께 돌려준다
  - 자리 없는 문서는 제목으로 찾고 ID로 읽는다. 기본 자리에 자동으로 넣지 않는다
  - 보관·자리 없음이 된 대상도 예약을 지우지 않고 보관 상태·ID 읽기를 안내한다
  - move·rename은 user만(고정 option action을 적용하는 machine 경로는 T30). 낡은 기준은 conflict, 자리 없는 문서를 임의 자리에 자동 배치하지 않음. 옛 예약을 남기고 새 예약을 같은 transaction에 더함
  - 자리 변경은 FileSource·디스크 파일·tracking 규칙을 바꾸지 않는다
  - 옛 address도 현재 scope로 검사하고 안내로 권한을 넓히지 않는다
  - `reads_test.ts`, `commands_test.ts`에 각 요구 번호 테스트(이름·자리를 여러 번 바꾼 뒤 처음 address로 지정 판에 닿기)
- 상태: 완료 (#176)

### T10 tracking 규칙과 미리보기

- 등급: 기본
- concern: documents/projects
- 요구: documents/projects#R3, R4, R5, R6, R7
- 자리: packages/documents/projects/ (model.ts 규칙 판정, work.ts 미리보기 scan, commands.ts `project.set_tracking`과 `project.update`의 folders 변경), packages/documents/file-tracking/ (scan iterator 재사용)
- 쓰는 contract: platform command·read·인증, documents worker(T2)
- 내놓는 contract: `/v1/projects/preview_tracking`(TrackingPreview, page), `project.set_tracking`; event `ProjectTrackingChanged`
- slice: documents
- 선행: T1, T2, T7
- 완료:
  - 각 root 기준 `/` 상대 경로에 include·exclude glob을 순서대로, 마지막 일치, 미일치 제외. picomatch와 ignore(중첩 `.gitignore` 포함), OS locale 무관
  - `.git` 내부·lophn data 폴더·root 밖 symlink는 include로도 추적 불가(순회와 최종 열린 파일 둘 다)
  - 미리보기는 포함·제외 파일과 이유를 root와 묶어 page로 돌려주고, 적용은 미리 본 folders·tracking·base_revision과 같아야 한다(다르면 conflict). 디스크에 새로 생긴 파일은 적용한 규칙으로 판정
  - set_tracking에서 활성 켜진 root 겹침 conflict
  - `model_test.ts`에 projects#R4, R5, `work_test.ts`·`commands_test.ts`에 projects#R3, R6, R7, API 통합 테스트
- 상태: 완료 (#187) — 규칙 판정(picomatch·ignore, `.git`·lophn data·root 밖 symlink 차단), scan port 위의 미리보기 판정·page 조립, `project.set_tracking`·folders 변경의 미리보기 일치·겹침 conflict·`ProjectTrackingChanged`, harness 통합 테스트는 #90에, documents worker(T2)의 scan port와 `/v1/projects/preview_tracking` route 연결과 그 API 통합 테스트는 #187에 합쳤다.

### T11 파일 관측에서 Version까지

- 상태: 완료 (#254, #266, #271, #275, #284, #295) — 한 것(#254): documents worker를 제품 core가 hello(machine credential·api_port)와 함께 띄움, core→coordinator 요청 통로(FileStatus 조회), 파일 관측 제출 조립(`observation.ts`), 준비 route의 기준 판 읽기, outline·읽기·search·view open·export worker route를 reader Worker의 snapshot으로 서빙, 활성 tracking root 변화에서 `connectDocumentsRelaunch`. 한 것(#266): 관측 loop 시작(Q15: core가 snapshot에서 읽은 tracking 규칙·경로→문서 연결을 `documents.observation_basis` 요청으로 coordinator에 보내고 바뀐 것만 다시 보냄), 파일 관측의 첫 저장이 문서를 그 파일에 연결(`document.save`), 준비 route의 format 검사(core가 원문 blob을 읽어 pipe의 byte frame으로 보내고 coordinator가 format runner로 검사), machine 준비 참조 principal 정정(`machine:documents`, 전엔 document.save가 forbidden), 실제 core와 documents worker로 파일 편집이 새 Version이 되는 통합 시험. 한 것(#271, Q16): PreparedVersion에 `files`(ContentFile과 파일별 준비 참조 또는 이미 등록된 blob의 참조)를 더하고 `document.save`가 같은 tx에서 `version_files` 행과 경로별 원문 blob 참조(`document_version.file`)를 등록(같은 내용의 재저장은 새 참조 없음), 관측 제출이 파일별 준비 참조를 save 요청에 묶고(같은 바이트의 살아 있는 준비 참조 재사용은 core relay가 한다, coding-agent Q24) 관측 worker는 같은 바이트의 동시 준비를 한 번만 함, A→B→A·같은 내용의 두 파일·core 재시작 뒤 되돌림이 저장되고 원문이 읽히는 시험, 만기된 준비 참조는 prune 전이라도 다시 등록, 실제 core와 documents worker로 준비 참조 수명(10분)·정지 회수를 넘긴 뒤에도 원문이 읽히는 시험, export 출력이 versionSchema의 source 필드를 빠뜨려 실제 export가 500이던 것을 고침. 한 것(#284): `GET /v1/documents/file`(고정 판의 경로별 원문 bytes)을 제품 core가 서빙한다. reader Worker가 `storedFile`로 `document.file` 권한과 판의 경로별 `version_files` 행을 판정하고(범위 밖·없는 판·없는 경로는 같은 not_found), core가 그 blob hash·바이트 수대로 I/O worker의 blob.read를 창(256 KiB) 단위로 읽어 크기·sha256이 행과 같을 때만 원문 bytes로 답한다. blob이 없거나 어긋나면 unavailable이고 일부 bytes로 꾸미지 않는다. 한 응답은 8 MiB까지였고(file route payload가 core 안에서 한 파일을 모았다), Content-Type은 route 등록값으로 고정이었다 → 후속 #289(platform 소유 변경): 응답이 창 단위 stream이 되어(소비자가 당길 때만 읽음, 끝에서 크기·sha256이 어긋나면 응답을 끊음, 첫 창은 응답 전에 읽어 blob 부재·한 창짜리 불일치는 헤더 전에 unavailable) 상한이 문서 upload 상한(256 MiB)이 되고 Content-Type은 판의 ContentFile.media_type이다. 후속(큰 텍스트 저장 수정): #289의 "알려진 한계"는 한도가 아니라 버그였다. 원인은 format 검사가 대표 파일 바이트를 guest 입력 JSON 숫자 배열로 넘겨 한 바이트가 3~4자·guest 값 하나가 되는 것이다. guest memory(64 MiB)는 대표 파일 약 1.6 MiB에서 `out of memory`로 끝나고(1.5 MiB는 통과하되 약 3.9초로 호출 5초에 근접), 이 실패가 coordinator 응답에서 `unavailable`로만 보여 어느 한도인지 드러나지 않았다(core→coordinator byte channel, blob 준비 중계, 읽기 stream은 32 MiB까지 문제없음). 그래서 "입력 16 MiB"는 guest 입력 JSON 문자열 상한일 뿐 파일 크기 상한이 아니었고, file-tracking의 `VALIDATE_INPUT_MAX_BYTES`(16 MiB, 바이트)는 실제로 끝나는 크기와 맞지 않았다. 한도를 올리지 않고 사실에 맞췄다: (1) 검사가 guest에 넘기는 바이트는 **바이트를 읽는 format(document)의 대표 파일**뿐이다. 첨부와 pdf·image·data(파일 모양만 보는 검사)는 바이트를 보내지 않고 크기·blob hash만 넘기므로 한도에 들지 않는다. (2) 그 대표 파일의 한도는 contracts의 `FORMAT_CHECK_CONTENT_MAX_BYTES` = 1 MiB(대표 파일 1 MiB 검사 약 2.5초·guest memory 64 MiB 안에서 실제로 끝나는 크기. 한도 정확히까지는 시험이 실제 검사를 돌린다)이고 `VALIDATE_INPUT_MAX_BYTES`는 이를 가리킨다. (3) 한도를 넘으면 검사를 하지 못한다: 사전 검사와 저장 준비가 같은 결과(`check_skipped` 진단, 파일·크기·한도 포함)를 낸다. 명시 format은 error라 저장이 `invalid_input`(사전 검사에서 한도가 보인다), 미지정 새 문서는 warning이라 원문 그대로 저장된다(formats#R4, R5). 통과로 꾸미지도 `unavailable`로 숨기지도 않는다. (4) 파일 크기의 상한은 upload 상한 256 MiB(`DOCUMENT_UPLOAD_MAX_BYTES`) 하나이고 읽기 stream도 같은 값이다. 상한을 넘는 Content-Length는 본문을 읽기 전에 `body exceeds the 268435456 byte limit`인 `invalid_input`이다(platform dispatch 문구만 한도를 싣게 고침). worker route의 오류 문장은 platform/api#R4가 호출자에게 주지 않으므로(코드별 고정 문장) 저장의 `invalid_input` 문장에는 한도가 실리지 않는다: 한도는 `/v1/formats/validate` 진단과 위 platform 문구로 닿는다. `apps/core/documents-large-text_test.ts`가 실제 core·documents worker·I/O worker로 2 MiB·32 MiB 텍스트를 upload 경로와 관측 경로로 저장해 원문 그대로 읽고, 한도 정확히·1 바이트 넘음·명시 format 거절·큰 이미지·큰 첨부·upload 상한을 본다. 이 한도(1 MiB)는 guest의 UTF-8 해석·정규화가 QuickJS에서 약 2.5초/MiB라 생긴 값이다. 한도를 올리려면 guest module(module_hash가 바뀐다)을 줄여야 하며 이 PR 범위 밖이다(Q29). `documents/outline-and-search`의 section 추출(T21)은 같은 guest 실행을 쓰므로 같은 한도를 받게 된다(조립은 T21 몫이다): 한도를 넘는 판은 추출을 하지 못하고 원문 파일 참조(fallback)만 내야 하며 저장·읽기는 영향이 없다. 이 저장소에 "15 MB 추출 fallback"이라는 값은 없다. 이어보냄: 준비 worker spawn·batch protocol과 `/v1/projects/preview_tracking` 서빙 → T12, coordinator의 derived store 열기·search consumer·section 추출 조립 → T21, redactor의 알려진 secret registry 전달(secret store의 제품 core 조립과 reader pool의 값 등록·회수 통로, Q17) → platform#T19(조립 끝: 후속 #289, 제품 redactor가 알려진 값도 지운다)
- 등급: 최상위
- concern: documents/file-tracking, documents/versions
- 요구: documents/file-tracking#R3, R4, R6, R7, R8, R9, R10, R18, documents/versions#R13
- 자리: packages/documents/file-tracking/ (work.ts의 watch·scan·안정 읽기·후보 합치기·관측 제출, model.ts의 FileObservationBasis·FileStatus 계산, `/v1/files/status`), packages/documents/versions/ (`document.save`의 관측 CAS와 원본 연결 문서 규칙)
- 쓰는 contract: platform 인증(machine credential)·command·read·event 구독(규칙·source 변경)·blob 준비 pipe, 저장 준비 경로(T8)
- 내놓는 contract: `/v1/files/status`(FileStatus)
- slice: documents
- 선행: T8, T10, platform#T4(event 구독)
- T20에서 넘어온 것: `/v1/documents/export` worker route 서빙과 제품 redactor 조립(exportDocument는 redactor를 deps로 받는다, #239)
- T2에서 넘어온 것: 준비 worker의 실제 scan·hash·diff와 그 결과 command 제출, `/v1/projects/preview_tracking` route 연결(T10 진행 줄)
- T8에서 넘어온 것: `/v1/documents/prepare` worker route를 apps/core에 조립(startApiServer workers map), 준비 worker가 T8 조립(createPrepareAssembly)에 실제 같은 stream hash·blob 준비 port를 준다(#200은 fake port로만 검증)
- T13에서 넘어온 것: documents coordinator가 derived 검색 store를 열고 `/v1/search/{query,status}` worker route를 제품 core에서 서빙한다(#215는 test seam으로만 연결, 제품은 503)
- 완료:
  - root별 `Deno.watchFs(recursive)` 신호는 힌트. 시작·절전 복귀·watch 넘침·단절·규칙·폴더 변경·보관 해제에 전체 대조, 평소 60초마다 root scan(진행 중이면 합침), root당 후보 10,000개 초과면 `rescan_required` 하나
  - canonical 경로별 후보 합치기, 750ms 조용하면 관측, 안정 읽기 최대 3회. 열기 전·후 실제 경로·file identity·size·mtime 비교, 같은 stream에서 hash와 blob. 안정 확인 실패는 unverified로 두고 다음 파일로
  - 삭제 후 재생성·이름 변경을 단순 수정으로 숨기지 않고, 내용이 같다고 source를 자동 재연결하지 않는다. size·mtime가 같아도 주기 대조에서 hash를 영원히 건너뛰지 않는다
  - 제출은 FileObservationBasis(project, project_revision, path, document_revision, file_source, active, original_hash, observed_at)와 함께 machine `document.save`. 규칙·source·최신 판·보관·root 제거가 바뀌었으면 conflict 뒤 재관측
  - `documents.source_path` 하나가 경로↔문서 대응이고 목록·scan·편집이 같은 read를 쓴다. 원본 연결 문서의 직접 내용 저장은 conflict, 파일 삭제·tracking 해제로 연결이 자동으로 사라지지 않음
  - FileStatus: 추적 안 함, 추적 중인 판, version 대기, format 검사 실패, 원본 없음, 미확인 + 관측 시각·비교 판. 꺼진 동안 여러 번 고친 파일은 현재 내용만 준비
  - launch spec(활성 root 목록으로 만든 allow-read·allow-write)은 `apps/core/documents.ts`가 선언한다. root 추가·해제로 spec이 바뀌면 platform#T7이 documents worker만 정상 정지 뒤 새 권한으로 다시 띄우고, coordinator는 시작 때 전체 root를 재scan
  - `work_test.ts`(T1 시나리오: 꺼진 동안 고침, watch 넘침, 지우고 재생성, 이름 변경, 읽는 중 교체, 같은 size·mtime 수정, 규칙 변경·source 재연결·보관·권한 상실을 준비와 확정 사이에 끼움)와 `model_test.ts`에 각 요구 번호 테스트. 파일 3,000개 변경 중 다른 root의 작은 저장과 고정 판 read가 응답하는 통합 테스트
  - 관측 근거(Q15): core가 reader snapshot에서 활성·tracking 켠 project의 root·규칙과 `documents.source_path` 연결(문서 ID·판·최신 판·원본 hash·보관 상태)을 읽어(`apps/core/documents-basis.ts`, 연결은 경로 순서 page로, 같은 snapshot 기준) 감독 pipe 요청으로 보낸다. 제어 frame 상한(256 KiB) 안의 조각이고 마지막 조각에서 한꺼번에 반영된다. 바뀐 것만 다시 보내고, 보내기가 실패하거나 coordinator가 다시 뜨면 전체를 다시 보낸다. coordinator는 root별 관측 loop를 근거에 맞춘다(새 root 시작, 사라진 root 정지, 규칙·project 판·보관 해제가 바뀐 root만 다시 대조). 멈춘 loop는 watcher를 닫는다
  - event 구독(Q17): root 집합과 관측 근거는 주기로 읽지 않는다. core 안 구독자 `machine:documents-feed`(token 없는 ledger credential 기록)가 events/list를 지나 documents event(`ProjectCreated·Updated·TrackingChanged·Archived·Unarchived`, `DocumentCreated·Saved·SourceChanged·Archived·Unarchived·Restored`)를 받으면 100ms 모아 `project.tracking_roots`·관측 근거를 같은 snapshot read로 다시 맞춘다(`apps/core/documents-feed.ts`). 구독이 (다시) 열릴 때도 맞춘다. 확인 도중에 온 신호는 끝난 뒤 한 번 더 확인하고, 읽기·재시작·보내기가 실패할 때만 대기 뒤 다시 시도한다. `events-registration_test.ts`(실제 core: 사람이 Project event를 본다, agent·app·다른 machine·feed principal을 흉내 낸 자격은 범위 밖 event를 없는 event와 같은 답으로 받는다, core 안 구독자가 ProjectTrackingChanged를 받는다), `internal-subscription_test.ts`, `documents-roots_test.ts`(실제 core: set_tracking event가 worker를 새 권한으로 다시 띄운다), `documents-basis_test.ts`
  - 파일 관측의 첫 저장은 문서를 그 파일에 연결하고(DocumentCreated의 file_source) 같은 경로에 이미 연결된 문서가 있으면 conflict다. 연결된 파일은 그 문서의 최신 판에 이어 제출하고, 최신 판의 원본 hash와 같은 내용이면 준비·저장 요청을 보내지 않는다. 보관된 문서에는 새 판을 확정하지 않는다. conflict면 새 근거가 온 뒤 한 번 더 제출한다
  - format 검사: core가 I/O worker의 원문 blob을 창(256 KiB) 단위로 읽어 coordinator pipe의 byte chunk frame으로 보내고(한 번에 하나, 바이트를 읽는 format의 대표 파일만, 1 MiB 상한 — 넘으면 검사 생략 진단) 같은 channel을 가리키는 요청을 보낸다. coordinator가 권한 없는 format runner로 검사한다(spec에 deno 실행 파일 하나의 allow_run). 통로가 끊기거나 runner가 실패하면 통과로 꾸미지 않고 unavailable이다
  - `documents/file`(#284): `documents-observation_test.ts`와 `documents-file_test.ts`(실제 core·documents worker·I/O worker: 관측한 판의 파일이 원문 bytes 그대로 읽힌다, 옛 판은 자기 판의 bytes, 코딩 agent 저장으로 만든 여러 파일 판이 경로마다 정확한 bytes, 범위 밖 자격·없는 판·없는 경로가 같은 not_found, 사라진 blob은 unavailable)에 `documents/versions#R5·R8` 테스트
  - `documents-observation_test.ts`(실제 core·documents worker·임시 폴더: 처음 관측→첫 판, 편집→같은 문서의 다음 판, 새 파일→다른 문서, 규칙 밖 파일 무시, FileStatus tracked, 재시작해도 같은 내용은 새 판 없음, 꺼진 동안 고침→새 판)와 `documents-basis_test.ts`, `documents-validate_test.ts`, `basis_test.ts`·`observers_test.ts`·`validation_test.ts`·`observation_test.ts`·`requests_test.ts`, `versions/commands_test.ts`에 각 요구 번호 테스트

### T12 사람 파일 쓰기와 working copy

- 상태: 완료 (#293, #298) — 한 것(#293): 파일 쓰기·이름 변경·삭제 알고리즘(직렬화, 시작·교체 직전 base_hash·identity 재검사, 같은 폴더 임시 파일 exclusive-create·sync, atomic replace, 새 파일 no-replace 설치, 원자 교체 불가면 실패)과 실제 프로세스를 SIGKILL하는 시험, `files.{list,read,status,watch,write,rename,delete}`와 `file.record_result`(event 하나, `(request_key, operation)` 중복 방지)를 제품 core에서 서빙, working copy(`~/.lophn/documents/working-copies/<doc>/content`·`meta.json`)와 요청자 자격의 판 확정(`version_request`), `files.delete`의 confirmation 소비를 core에 연결, T11에서 넘어온 준비 worker spawn(coordinator가 platform 감독을 slot마다 하나씩 써서 띄움, Q21)·batch의 준비 worker 요청·응답(`documents.hash_batch`)·`/v1/projects/preview_tracking` 서빙(요청 폴더만 읽는 준비 worker 하나, Q22). 한 것(후속 #298): (1) tracking을 끈 project 폴더도 쓴다 — core가 자기 snapshot에서 읽은 활성 project의 모든 등록 폴더(`folders`)를 관측 근거(Q15)와 같은 core→coordinator envelope로 보내고(새 machine read 없음), coordinator의 파일 목표 풀이와 준비 worker의 권한 집합이 이것을 쓴다. 관측 root(tracking을 켠 폴더)와 따로라 관측 loop는 그대로 관측 root만 본다(Q25, Q28). (2) 파일 읽기가 헤더(hash·크기·identity)와 창(256 KiB) 단위 byte frame으로 나뉘어 `files.read`를 platform의 stream 응답(#289)으로 서빙한다: 512 KiB 한도와 JSON frame 한도가 없고 문서 upload 상한(256 MiB)까지 읽으며, 창마다 준비 worker가 파일 identity를 다시 보고 core가 sha256을 이어 계산해 끝에서 헤더와 다르면 응답을 끊는다(Q25). (3) `content`가 `existing` 원본 참조인 쓰기(옛 판 복원)를 받는다: 저장과 같은 규칙(그 판의 `version_files` 행 + `document.file` 접근)을 core가 요청 자격으로 확인하고, 위조·접근 밖·없는 참조는 같은 `invalid_input`이며, 확인된 blob 바이트를 쓰기에 복사한다. (4) FileOperationResult에 `latest_version`을 더해 `version_result: conflict`일 때 그 문서의 지금 최신 판을 채운다(contracts, Q26). 남은 것: (5) 편집 표시(`files.watch`가 켜는 메모리 값)는 requirements가 지금 요구하지 않아 두지 않았다(소비자가 생기면 별도). (6) 후보 배분(`addCandidate`→준비 worker `hash_batch`)의 결과 제출은 연결하지 않았다 — 이어보냄: 준비 worker가 읽은 바이트를 blob으로 준비하는 길(준비 worker 바이트 전달)과 production 관측의 준비 worker 이전 → T21(Q23). 관측 loop는 coordinator 안에 그대로 둔다.
- 등급: 기본
- concern: documents/file-tracking, documents/formats
- 요구: documents/file-tracking#R1, R2, R11, R12, R15, R16, R17, documents/formats#R6
- 자리: packages/documents/file-tracking/ (files.ts·file-ops.ts 파일 쓰기 알고리즘과 port, adapters/file-ops.ts OS 호출, reads.ts `files.list`·working copy 근거, commands.ts `file.record_result`, working-copy.ts·prepared-files.ts working copy 저장 `~/.lophn/documents/working-copies/<doc>/`), apps/worker/documents/ (pool.ts 준비 worker pool, files*.ts coordinator 처리, file-requests.ts 준비 worker 쪽, batch.ts 후보 배분 요청·응답), apps/core/documents-files.ts (`files.*`·`preview_tracking` worker route 서빙)
- 쓰는 contract: platform 인증(user만, machine credential)·command, route kind=file, shell confirmation window(files.delete 근거), 저장 준비 경로(T8), 파일 관측(T11)
- 내놓는 contract: 파일 쓰기(`/v1/files/list`, `/read`, `/status`, `/watch`, `/write`, `/rename`, `/delete`, `/record_result`; FileTarget, FileWriteRequest, FileOperationResult); event `FileWritten`, `FileRenamed`, `FileDeleted`
- slice: documents
- 선행: T8, T11, platform#T12(file·worker 전달 route), platform#T56(confirmation handle), contracts#T13(confirmation window), contracts#T16
- T11에서 넘어온 것: 준비 worker spawn과 batch의 준비 worker 요청·응답 protocol(지금 coordinator의 `spawnPreparation`은 연결되지 않아 batch 제출은 unavailable이고 파일 관측은 coordinator 안의 관측 loop가 직접 한다), `/v1/projects/preview_tracking` worker route 서빙(core route 등록, coordinator 요청, 준비 worker의 실제 scan; 준비 worker는 slot마다 kind를 따로 두거나 platform 감독을 coordinator에서 쓰는 방식을 정해야 하고 kill adapter의 run 권한이 더 필요하다). 사람 파일 쓰기가 준비 worker의 첫 소비자다 — 해소(#293): 준비 worker는 coordinator가 띄우고(Q21), 폴더 미리보기는 요청 폴더만 읽는 준비 worker 하나가 맡는다(Q22).
- 완료:
  - user만 원본 파일 통로를 쓴다. agent·coding agent·app·MCP·CLI 자격은 forbidden
  - 같은 canonical 목표의 작업 직렬화, 시작에 base_hash 대조, 같은 디렉터리 임시 파일 exclusive-create·stream·sync, 교체 직전 경계·file identity·hash 재검사, atomic replace, 새 파일은 no-replace 설치, 가능한 OS에서 부모 디렉터리 sync. 원자 교체 불가면 실패(truncate·복사 덮어쓰기 없음)
  - 충돌은 `conflict`(HTTP 409), 권한·read-only·용량·quota·원자 교체 불가는 `unavailable`(HTTP 503). log·감사 payload에는 경로·hash·OS 오류만
  - FileOperationResult는 파일 결과·기록 결과·version_result(not_requested, preparing, validation_failed, conflict, confirmed)를 따로. 성공한 파일 작업마다 `file.record_result`로 event 하나, `(request_key, operation)` 중복 방지. 응답 유실에 자동 재쓰기 없음
  - 자동 저장은 파일 쓰기만, 명시 저장·편집 종료가 version 준비 경계. 지정 format 검사 실패는 파일을 되돌리지 않는다
  - 원본 없는 문서는 선택 판으로 만든 working copy를 편집하고, 새 최신 판과 충돌하면 working copy를 남긴 채 새 기준을 돌려준다. 자동 project·문서 생성 없음, 앱 source 자동 추적 없음
  - files.delete는 등록 때 confirmation handle 필요를 선언하고, core의 handle registry가 worker로 넘기기 전에 handle을 대상(canonical 경로, base_hash, delete)과 함께 메모리에서 원자적으로 검증·소비한다(platform#T56). 넘긴 뒤 conflict여도 handle은 소비된 채 사람이 다시 확인한다. ledger 접수 command는 두지 않는다. ApprovalRequest는 쓰지 않는다
  - `files_test.ts`(교체 직전·직후 종료, no-replace 경쟁, 외부 수정 409, 권한·용량 503, 본문 없는 log), `commands_test.ts`, `working-copy_test.ts`에 각 요구 번호 테스트, API 통합 테스트

### T13 derived store와 검색

- 상태: 완료 (#188, #215) — 이어보냄: 제품 core에서 `/v1/search/{query,status}` worker route를 documents coordinator가 서빙(지금은 503) → documents#T11. 요약·주제 검색과 match_source는 #230에 합쳤다
- 등급: 기본
- concern: documents/outline-and-search
- 요구: documents/outline-and-search#R10, R11, R12, R13, R14, R16, R17, R18
- 자리: packages/documents/outline-and-search/ (adapters/ derived SQLite 9개 표, work.ts search consumer·재생성, reads.ts `/v1/search/query`·`/status`)
- 쓰는 contract: platform event 구독·read(seq S의 일관된 snapshot, scope 후보 필터)·redaction·blob read, format 실행(T4)
- 내놓는 contract: outline·search 읽기 중 `/v1/search/query`, `/v1/search/status`(SearchResult, IndexCoverage), derived 삭제 뒤 재생성(platform#T42 restore가 씀)
- slice: documents
- 선행: T4, T6, contracts#T18, platform#T3, platform#T4, platform#T15(redaction 규칙 엔진)
- documents#T24에서 넘어온 것: 이전 판을 현재 format module로 다시 추출해 module이 달라 `watch_unverified`로 남은 section 비교(`format module changed`)를 풀 수 있게 하는 derived 재추출(Q33). 지금은 module이 다른 두 판의 section 비교를 미확인으로 두고 있다
- 완료:
  - `derived_versions`, `derived_sections`, `derived_texts`, `search_documents`, `search_rows`, `search_fts`(FTS5 `tokenize='trigram'`), `summary_cache`, `derived_cursors`, `watch_unverified`. coordinator가 유일한 writer, 별도 read 연결
  - consumer 결과·FTS 교체·cursor는 한 derived transaction. 실패 판은 이유를 남기고 cursor가 진행돼도 omissions를 돌려준다. 재생성·재파생은 ledger에 아무것도 쓰지 않는다
  - 3 codepoint 미만 질의는 허용 후보 행의 escaped LIKE. 최신 반영 판의 section 제목·본문과 가용 요약·주제 텍스트, 요약 일치는 입력 판·stale를 따로
  - 검색 결과: 고정 판 참조·section·범위·제목·snippet·score. 검색 판과 최신 판이 다르면 둘 다. 빈 결과도 lagging·rebuilding·omissions와 함께
  - 보관 문서·보관 자리는 현재 ledger 상태로 기본 결과에서 뺀다(낡은 index 행이 있어도). 해제 뒤 비동기 반영
  - 같은 대상의 재파생·목록 무효화는 500ms 합침, move는 출발·도착 자리와 관련 Context 갱신, 대상 불명 event는 전체 무효화
  - 요약 없으면 원문 서문 200 codepoint 발췌(요약과 구분). 요약을 만들려고 model·agent run을 시작하지 않음
  - 삭제·손상 시 한 read transaction에서 현재 자료와 as_of_seq=S를 함께 받아(platform#T3) `documents.rebuild.sqlite`를 만들고 S 다음부터 구독으로 따라잡은 뒤 교체, 그동안 `rebuilding=true`. derived가 기록한 `ledger_id`가 `/v1/platform/status`와 다르면(복원 뒤) derived를 버리고 재생성
  - 권한 밖 ID는 후보 단계에서 빼고 count·rank·page도 허용 집합에서. agent 출력은 redaction
  - `work_test.ts`, `reads_test.ts`에 각 요구 번호 테스트(T1 korean-search로 2글자·3글자 한글, index 삭제 후 재생성, 실패 주입 시 빈 결과와 실제 빈 결과 구별)
  - 이어받음: documents#T13의 요약·주제 검색과 match_source. `/v1/search/query`·`/status` handler는 이 작업이 쓴다. apps/core 조립·HTTP 통합은 별도 작업으로 남는다

### T14 outline과 단계적 읽기

- 상태: 완료 (#230) — 이어보냄: root outline의 context 자리 묶음 → documents#T23, `/v1/outline/{root,place,document}`와 `/v1/documents/read` route와 실제 인증 연결을 제품 core에 붙이는 것 → documents#T11
- 등급: 기본
- concern: documents/outline-and-search, documents/addressing
- 요구: documents/outline-and-search#R1, R2, R3, R5, R6, R7, R8, R9, R15, R22, R26, documents/addressing#R4, R5
- 자리: packages/documents/outline-and-search/ (model.ts 예산·estimated token·cursor, reads.ts `/v1/outline/root`·`/place`·`/document`·`/v1/documents/read`, coordinator의 page basis), packages/documents/addressing/ (section 해석)
- 쓰는 contract: platform read·인증·redaction·blob read, format 실행(T4), derived store(T13)
- 내놓는 contract: outline·search 읽기 중 `/v1/outline/root`, `/v1/outline/place`, `/v1/outline/document`, `/v1/documents/read`(OutlinePage, ReadResult, Section, LineRange)
- slice: documents
- 선행: T9, T13
- 완료:
  - root(활동 순, 이 slice에서는 project·app 자리와 자리 없는 문서 묶음; context 부분은 T23) → place(갱신 순, 제목·format·선택 판·갱신 시각·발췌·section 수, 본문 없음, agent에게 경로·디스크 상태 없음) → document outline(section별 시작·끝·body_hash·문자 수·estimated token·부모·자식 수) → section·줄 범위 본문
  - 기본 예산: root 1,500, place 3,000, document outline 2,000·depth 2 estimated token, 본문 12,000 codepoint. estimated token은 codepoint 수/3 올림. 초과 시 complete=false·cursor·숨긴 자식 수
  - 본문 cursor는 ver·module_hash·section·include_children·줄 위치·줄 안 codepoint 위치. 긴 한 줄도 겹침·누락 없이 이어 읽음. outline 뒤 새 판이 저장돼도 같은 cursor는 처음 판, latest_version은 따로
  - 목록 cursor는 basis_seq·query_hash·sort·scope_basis·선택 판 목록에 묶는다. 다른 조건·판의 cursor는 `invalid_input`, basis 만료·worker 재시작은 `conflict`. page마다 scope 재검사
  - cache가 없으면 선택 판만 직접 추출하고 scan·index 따라잡기를 기다리지 않는다
  - 성공 추출의 key 없음은 `missing`, 미지원은 `unsupported`, 미완료·실패는 `unverified`. 추정 section을 돌려주지 않는다
  - section 해석: 전체 경로 우선, 유일한 마지막 이름 허용, 중복이면 `invalid_input`(모호함). 선택 판의 같은 key만, 최신 판에서 사라지면 소실 표시, 유사 section redirect 없음. code block·table 주소 없음
  - `model_test.ts`, `reads_test.ts`에 각 요구 번호 테스트(12,000자 초과 본문·한 줄짜리 긴 본문 이어 읽기, scan·index 큐 지연 중 선택 판 읽기 우선 응답)

### T15 saved view

- 상태: 완료 (#242)
- 등급: 기본
- concern: documents/outline-and-search
- 요구: documents/outline-and-search#R23, R24, R25
- 자리: packages/documents/outline-and-search/ (commands.ts `view.save`·`view.update`·`view.delete`, reads.ts `/v1/views/list`·`/get`·`/open`)
- 쓰는 contract: platform command·read·인증, 검색(T13), place 목록(T14)
- 내놓는 contract: `view.save`, `view.update`, `view.delete`; read `/v1/views/list`, `/get`, `/open`; event `SavedViewCreated`, `SavedViewUpdated`, `SavedViewDeleted`
- slice: documents
- 선행: T13, T14, contracts#T19
- 완료:
  - `saved_views` 표, 저장·변경·삭제는 user만, revision은 마지막 변경 event seq
  - 조건: text, place, Context 포함 여부, format, document_status(active·archived·all, 기본 active), 갱신 기간. 정렬: updated_desc, updated_asc, title_asc, address_asc. 정의하지 않은 조건(series 멤버, tag, 앱 DB, 문서 관계)은 `invalid_input`
  - open은 매번 현재 허용 문서로 다시 만들고 Document·Context item을 만들지 않는다. text 조건이면 IndexCoverage를 붙인다. 상대 기간은 open 시각에 고정하고 cursor에 유지
  - cache는 정규화 조건·정렬·대상 고정 판 목록·현재 scope가 같을 때만. glossary 없음. 삭제된 view cursor는 conflict
  - `commands_test.ts`, `reads_test.ts`에 각 요구 번호 테스트

### T16 이력·diff·restore

- 상태: 완료 (#304) — 한 것: 공용 section-comparison(`model.ts` `compareSections`·`compareSectionKey`·`sectionHistory`, T24가 같은 함수를 쓴다), `/v1/documents/section_history`·`/diff`를 reader Worker가 ledger snapshot과 derived store로 서빙(`history-reads.ts`, bounded Myers `diff.ts`), `document.restore` command와 core 등록(`DocumentSaved`+`DocumentRestored`, 최신과 같으면 unchanged, 원본 연결 문서는 파일 쓰기 뒤 관측 근거로만), 실제 core·documents worker·I/O worker 통합 시험. 차이(질문 Q30): diff 계산이 준비 worker가 아니라 reader Worker에서 돌고(core 요청 thread 밖), 본문은 derived_texts만 쓴다(추출이 없거나 unverified·unsupported·failed인 판은 누락). 후속(선택): 준비 worker로 diff 이전, 파생 text가 없는 판의 원문 blob 직접 diff.
- 등급: 기본
- concern: documents/outline-and-search, documents/versions
- 요구: documents/versions#R10, documents/outline-and-search#R19, R20, R21
- 자리: packages/documents/outline-and-search/ (model.ts 공용 section-comparison, reads.ts `/v1/documents/section_history`·`/diff`, work.ts 준비 worker의 bounded Myers diff), packages/documents/versions/ (`/v1/documents/restore`, `document.restore`)
- 쓰는 contract: platform command·read·인증·blob read, 저장 준비 경로(T8), 사람 파일 쓰기(T12)
- 내놓는 contract: `/v1/documents/section_history`, `/v1/documents/diff`, `/v1/documents/restore`, `document.restore`; event `DocumentRestored`
- slice: documents
- 선행: T12, T14
- 완료:
  - section 이력: 고정 판 사이 같은 key로 변경 없음·본문 수정·추가·소실. 이름 변경은 소실+추가, 유사도 대응 없음. 중간 판부터 잘라도 직전 판과 비교, 소실 행은 살아 있는 행 뒤
  - diff: 두 고정 판의 전체 또는 선택 section 줄 단위, 한도를 넘으면 변경 블록 단위로 이어 읽기, blob 복원 불가 구간은 누락. 계산은 준비 worker
  - restore: 선택 판의 바이트와 정확한 FormatRef를 준비하고 최신 base_version·base_revision CAS. 최신과 같으면 새 판 없음. 원본 연결 문서는 사람 파일 쓰기(T12) 뒤 관측 근거로만 확정
  - section-comparison은 T24 watch가 같은 함수를 쓴다(module 묶음의 body_hash 규약)
  - `model_test.ts`(공용 section-comparison), `diff_test.ts`(bounded Myers), `history_test.ts`(이력·diff handler), `versions/restore_test.ts`(restore command), `apps/core/documents-history_test.ts`(실제 core·documents worker·I/O worker)에 각 요구 번호 테스트

### T17 Series ledger

- 상태: 완료 (#219) — 첫 Document 저장과 첫 가입의 한 transaction 처리는 T18이 이어받아 끝냈다(#241)
- 등급: 기본
- concern: documents/series, documents/versions
- 요구: documents/series#R1, R2, R3, R5, R7, R8, R10, R11, R13, R14, documents/versions#R15
- 자리: packages/documents/series/ (model.ts 정렬·다음 규칙 순수 계산, commands.ts)
- 쓰는 contract: platform command·read·인증·blob(draft), versions(T6)·저장 준비 경로(T8)·addressing(T9)
- 내놓는 contract: `series.create`, `series.update`, `series.set_draft`, `series.clear_draft`, `series.add_instance`, `series.update_instance`, `series.remove_instance`, `series.archive`, `series.unarchive`; event `SeriesCreated` 등 9개
- slice: documents
- 선행: T8, T9, contracts#T19
- 완료:
  - `series`·`series_instances`·`series_keys` 표. create·update·add_instance·update_instance는 user와 허용 coding_agent·app, 나머지 가족 변경은 user, lophn agent는 mutation 없음
  - key는 비어 있지 않고 가족 안에서 유일, 멤버를 빼도 예약 유지, 문서 address 이름과 별개. 같은 자리·같은 format만 멤버, 멤버 수정은 같은 doc의 새 판
  - 첫 Document 저장과 첫 가입을 같이 요청하면 한 ledger transaction에서 두 검사와 일치 draft 비우기
  - 정렬: format 선언 order_value 또는 key 자연 순(숫자 성분은 수로, 0.9 다음 0.10, 동점·해석 불가는 locale 무관 codepoint 순과 Document ID)
  - NextRule 등록 검사: 정수 ±step, major·minor·patch, 1~4자리 0 채움. 5자리 채움·해석 불가 규칙은 등록 거절. P001→P002, 0.2→0.3, 0.2→1.0, 0.2.1→0.2.2
  - draft 하나(key·예정 doc·template 값), 확정 멤버 아님, 첫 판 전에는 Document·Context 대상 아님
  - 보관·해제는 멤버 문서와 독립, 영구 삭제 route 없음, 읽기는 event를 만들지 않음
  - `model_test.ts`, `commands_test.ts`에 각 요구 번호 테스트

### T18 Series 읽기와 다음 이름

- 상태: 완료 (#241) — 읽기, 그리고 T17에서 넘어온 `document.save`의 같은 tx series 가입(`series/join.ts`, core 등록이 versions에 주입)
- 등급: 기본
- concern: documents/series
- 요구: documents/series#R4, R6, R9, R12
- 자리: packages/documents/series/ (reads.ts `/v1/series/list`·`/get`·`/next`, work.ts 준비 worker의 series-next), packages/documents/outline-and-search/ (`/v1/outline/series`)
- 쓰는 contract: platform read·인증, documents worker(T2)
- 내놓는 contract: `/v1/series/list`, `/v1/series/get`, `/v1/series/next`(NextSuggestion), `/v1/outline/series`
- slice: documents
- 선행: T14, T17
- T17에서 넘어온 것: 첫 Document 저장과 첫 series 가입을 한 ledger transaction에서 처리(두 검사와 일치 draft 비우기, versions save 경로가 series 가입을 부르는 seam, #219). 일치 기준은 활성 가족 draft의 예정 문서. 첫 저장만 가입하고 검사 거절은 저장 전체 거절, 범위 밖 가족·lophn agent는 없는 가족과 같게 가입 없이 저장. `series/join_test.ts`에 시험
- 완료:
  - 자리별 가족 목록(규칙, 멤버 수), 상세와 가족 목차는 같은 기준·순서의 key·제목·고정 최신 판·보관 상태. page는 T14 cursor 방식
  - next: key 자연 순의 마지막 확정 멤버(보관 멤버 포함, draft 제외)와 규칙으로 계산, from·taken·document_name·series_revision 반환, 아무것도 예약·저장하지 않음. 빈 가족·해석 불가·안전 정수 overflow는 빈 제안
  - ID 또는 자리+이름으로 조회, 가족은 address·version이 없음
  - lophn agent 자격은 list·get·next만, 허용 coding_agent·app은 T17 mutation도
  - `reads_test.ts`에 각 요구 번호 테스트(제안을 두 번 읽어도 문서·event 수 같음)

### T19 문서를 파일로 두기와 빼기

- 등급: 기본
- concern: documents/projects, documents/file-tracking, documents/versions
- 요구: documents/projects#R12, documents/file-tracking#R13, R14, documents/versions#R13
- 자리: packages/documents/file-tracking/ (work.ts 두기·빼기 순서), packages/documents/versions/ (`document.set_source`), packages/documents/projects/ (파일 하나의 정확한 include 추가)
- 쓰는 contract: platform command·인증, shell confirmation window(파일 삭제 근거), 사람 파일 쓰기(T12), address 이동(T9), tracking(T10)
- 내놓는 contract: `document.set_source`, 두기·빼기 요청(`files.write`의 선택 `place`, `files.delete`의 선택 `unlink`와 결과의 `placement`·`unlinking`); event `DocumentSourceChanged`
- slice: documents
- 선행: T9, T10, T12, platform#T56
- 상태: 완료 (#315) — 두기·빼기는 `files.write`의 `place`와 `files.delete`의 `unlink`로 core가 서빙한다(Q34)
- 완료:
  - 두기: tracking이 켜진 project만(꺼졌으면 conflict). 최신 고정 판 바이트를 no-replace로 쓰고, 패턴 밖이면 그 파일 하나의 include를 `project.set_tracking`으로, `document.move`, `document.set_source`를 각각 현재 CAS로 확정. 파일 성공 뒤 연결 확정 실패는 파일을 남기고 따로 표시
  - 빼기: 디스크 hash가 최신 판 원문과 같을 때만 파일 삭제, 다르면 conflict로 파일을 남김
  - set_source·해제는 user만, 자동으로 연결이 사라지지 않음
  - `work_test.ts`, `commands_test.ts`에 각 요구 번호 테스트(확인과 생성 사이에 대상 파일을 만들어 덮지 않음)

### T20 문서 export

- 등급: 기본
- concern: documents/versions
- 요구: documents/versions#R16
- 자리: packages/documents/versions/ (reads.ts `/v1/documents/export`, work.ts 묶기)
- 쓰는 contract: platform read·인증·redaction·blob read
- 내놓는 contract: read `/v1/documents/export`
- slice: documents
- 선행: T9, T14, platform#T16(redaction 안전 필드)
- 상태: 완료 (#239) — 이어보냄: `/v1/documents/export` route 서빙(workerRoutes·workers map)과 제품 redactor 조립 → T11. redaction 실패는 지금 export 전체를 `unavailable`로 거절한다(계약 출력에 빠진 범위 필드가 없어 부분 표시를 못 한다, 온전한 export로 꾸미지 않음은 지킴)
- 완료:
  - 사람이 고른 project·app 자리의 문서와 고정 판을 Markdown·JSON으로, 원래 바이트와 판 참조를 함께. HTML·PDF처럼 Markdown으로 못 바꾸는 원문은 원래 MIME과 바이트. derived index는 넣지 않음
  - 외부 출력은 redaction, redaction 실패 구간은 빠진 범위와 이유로 표시하고 온전한 export로 꾸미지 않음
  - `reads_test.ts`에 versions#R16 테스트

### T21 documents slice flow E2E

- 상태: 진행 (#297, #407, #410, #479, #491, #497, #502, #506, #508, #513, #518, #520, #525) — 한 것: platform#T42가 남긴 복원 연결(`documents.search_ledger`·ledger 문)과 shell#T17이 찾은 두 결함(Q31), T11·T25에서 넘어온 실제 조립 셋(coordinator의 derived store·search consumer와 core의 event 공급·원문 blob 전달·section 추출, route 앞단의 용어 출현 확인, 원문 읽기는 #284가 붙인 `documents/file`), 그리고 그 위에서 돈 flow E2E 다섯 파일(`e2e/flows/{find-documents,first-project,write-series,organize-documents,restore-document}_test.ts`)과 `project-workspace_test.ts`의 문서 단계(project-workspace 2·edit-document 1·2·3·4·5·6·7·8, 실제 headless shell·core·documents worker·format runner, 화면 selector와 core 읽기로 확인). #491은 edit-document 8만: 닫기 guard overlay dialog. #479가 dialog를 못 본 것은 테스트가 `flow.shell.connect`의 overlay CDP session을 매번 닫아 캐시된 연결로 다시 읽지 못한 것이고, 제품 경로(tab-strip `[data-close]` → `editor.files.leave` → overlay dialog)는 그대로다. #497은 이 slice의 restore-document 파일 없음 갈래다. #502는 restore-document 1의 agent가 쓴 판의 run 근거다(이력은 그 판에 저장된 run만 보인다). #506은 restore-document 1의 옛 이름·자리 참조다(옛 address로 열면 같은 문서의 지정 판과 이력을 읽는다). #508은 restore-document 6의 검색 반영 대기만이다(기준이 맞아 새 고정 판이 생긴 뒤 파일 저장·판 확정·검색 반영을 각각 확인하고, 검색 반영 대기를 restore 실패나 완료한 반영으로 바꾸지 않는다). #513은 restore-document의 보관·추적 중단 갈래다(문서나 프로젝트를 보관했거나 추적을 중단해도 옛 판은 읽히고, 낡은 추적 범위로 원본 연결 문서의 새 판을 확정하지 않는다). #518은 restore-document의 판 확정 실패 갈래다(원본 바이트는 저장됐지만 판 확정이 실패하면 document 화면에서 실제 끝난 저장과 실패한 뒤 단계를 구별하고, 이미 성공한 파일 저장을 취소했다고 말하지 않는다). #520은 restore-document의 연결 끊김 갈래다(연결이 끊겨 결과를 확인하지 못하면 document 화면에서 연결 끊김과 확인된 저장 상태를 구별한다. 확인하지 못한 판 확정을 성공으로 채우지 않는다). #525는 first-project 5의 format 검사 갈래다(documents/formats#R4·R5·R6): format을 생략한 후속 저장도 그 판의 explicit를 따르고(explicit 판 위 생략 저장의 구조 error는 `invalid_input` 거절, implicit 판 위에서는 warning), 저장 warning은 결과와 파일 상태 details에 남고 같은 내용의 재대조가 지우지 않는다. 미지정 새 문서의 구조 실패는 원문 보존·warning 상태·section 추출 실패(unverified + failure_reason) 구별을 실제 e2e로 돌았다. 지정 format 거절의 e2e 단계는 사람 통로가 `worker:documents/prepare`를 거절해(shell/editor#R7, editor create도 format을 받지 않음) 지정 format 판을 사람 길로 만들 수 없어 `ignore`로 꺼 두었다(followup 74). 남은 것(아래 "이어보냄", 해당 화면의 owner task는 모두 완료라 넘길 곳이 없다): 검색 반영 대기 표시(6)를 뺀 이어보냄
- 등급: 기본
- concern: documents
- 요구: 없음 (flow 시나리오: first-project, project-workspace, edit-document, find-documents, organize-documents, restore-document, write-series)
- 자리: e2e/flows/<flow>_test.ts
- 쓰는 contract: shell 화면, fake provider 없음(model 없는 갈래만)
- 내놓는 contract: 없음
- slice: documents
- 선행: T11–T20, contracts#T10(E2E harness), shell#T9, T13–T20, T22, T23(첫 창, layout, project-workspace, launcher 등록·미리보기, document 편집기·저장·이력, documents 화면, projects 화면, 파일 지우기 확인)
- T11에서 넘어온 것: coordinator의 derived store 열기와 search consumer 조립(event 공급, 원문 blob 읽기, format runner의 section 추출)이 돼야 `/v1/outline/*`·`/v1/search/*`가 unavailable 대신 데이터를 돌려준다. 원문 blob 보존(Q16)은 풀렸다. T13에서 넘어온 것의 나머지. `GET /v1/documents/file`의 제품 core 서빙은 T11(#284)에서 붙었다. 문서 편집기·restore 흐름의 원문 읽기는 그 route로 돈다(한 응답은 stream이고 상한은 upload 상한 256 MiB).
- T12에서 넘어온 것: 준비 worker의 바이트 전달(읽은 파일 바이트를 blob으로 core에 준비하는 길)과 그 위에서 production 관측의 읽기를 준비 worker로 옮기고 후보 배분(`addCandidate`→`hash_batch`)의 결과를 제출하는 연결(질문 Q23). 파일 창 읽기(`documents.read_window`)가 준비 worker→coordinator byte frame 길(pool의 `replyBytes`)을 이미 놓았다. 이 길에 coordinator의 blob 준비(`childBlobPort`)를 이어 붙이면 된다. 그 전까지 관측은 coordinator의 loop다
- T25에서 넘어온 것: `/v1/terms/propose`·`/v1/terms/update`(근거 변경)의 route 앞단 확인. coordinator의 derived store로 고정 판의 section·줄 범위를 읽어 `checkTermOccurrence`(`packages/documents/terms/occurrence.ts`, `createDerivedEvidenceSource`)를 command 앞에서 돌리고 거절하면 command를 부르지 않는다(질문 Q8). coordinator의 derived store를 여는 일이 #266에서 T21로 넘어왔다. 이 앞단이 서기 전까지 core는 고정 판의 존재·문서 짝·범위만 확인한다
- 한 것:
  - search consumer 조립: coordinator가 derived store를 열고(`apps/worker/documents/search.ts`, 이미 만든 파일을 다시 열면 schema step을 건너뛴다) core가 보낸 event와 저장 판 원문으로 section을 추출해 결과·FTS·cursor를 한 derived transaction에 쓴다(`outline-and-search/consumer.ts`, 이미 지난 seq는 건너뛰고 cursor는 뒤로 가지 않는다). core는 feed 자격(`machine:documents-feed`)으로 coordinator의 cursor부터 event를 읽어 consumer가 쓰는 event(저장·복원·보관·해제·이동·이름·제목)만 순서대로 보낸다(`apps/core/documents-search.ts`). 저장 판은 ledger 판 행의 파일 목록대로 I/O worker의 원문 blob을 byte chunk frame으로 먼저 보내고(검사와 같은 pipe·channel 번호를 나눠 쓰는 `Streamer`로 직렬화) 요청이 그 channel을 가리킨다. 추출은 권한 없는 format runner가 하고, 끝나지 않으면 두 번 다시 받고 세 번째에 그 판을 `failed`로 남겨 cursor를 진행한다(뒤의 문서를 막지 않는다). 원문을 읽어 보내지 못하는 판(사라진 blob)도 세 번 뒤 `unverified`로 남긴다. 추출도 format 검사(#295)와 같은 입력 규칙을 따른다: 바이트를 읽는 format의 대표 파일 하나만 guest에 넘기고, 그 파일이 `FORMAT_CHECK_CONTENT_MAX_BYTES`(1 MiB)를 넘으면 runner를 부르지 않고 한도를 밝힌 이유(`derived_versions.unverified_reason`, 새 schema step)로 `unverified`를 남긴다. 그 이유는 검색 누락 목록과 section 읽기의 `failure_reason`에 나온다. 구독이 끊긴 동안의 변화는 늘 cursor부터 읽어 따라잡는다. 대상 불명 event는 전체 무효화라 consumer가 이해하는 event만 보낸다. 이동·이름·제목 event는 feed에만 연다(사람 공개는 owner가 정하지 않음). 이 이동·이름·제목 event도 관측 근거를 다시 맞추는 신호다(문서 revision이 바뀌면 근거의 `document_revision`이 낡아 파일 관측의 저장이 conflict였다, E2E가 찾아 고침).
  - T25에서 넘어온 route 앞단: `term.propose`와 근거를 바꾸는 `term.update`는 core의 writer 앞에서(`apps/core/documents-term-check.ts`) reader Worker의 내부 read가 요청 자격이 읽을 수 있는 고정 판의 section·줄 범위를 derived store로 읽어 `checkTermOccurrence`를 돌리고, 거절하면 command를 부르지 않는다. 권한 밖·없는 판·없는 section은 같은 거절이다(존재를 새지 않는다). derived가 없으면 unavailable이다.
  - 이 조립이 드러낸 leaf 결함 셋을 같은 PR에서 고쳤다. (1) 검색이 문서의 첫 section 행만 비교하고 결과 줄 범위가 section 본문 기준 줄이었다(여러 section 문서의 뒤 section을 못 찾고 `ranges`가 문서 줄이 아니었다) → 문서의 모든 section 행을 비교하고 줄 범위를 문서 줄로 바꾼다. (2) 목차의 `hidden_children_count`가 숨은 자손 전체라 `children_count`를 넘어 계약 출력이 거절됐다(깊은 문서의 `outline.document`가 internal) → 숨은 직접 자식 수로 바로잡았다. (3) 보관한 문서의 `outline.document`·`documents.read`가 not_found였다(versions#R11·outline-and-search#R17 위반) → 보관 문서도 확정한 판은 읽는다.
  - 기존 시험 두 개(`apps/core/terms_test.ts`, `apps/core/context-tools-e2e_test.ts`)는 가짜 hash의 판에 근거를 달아 후보를 제안했다. 출현 확인이 서면서 실제 문서를 저장해 그 section 본문에서 이름을 확인하도록 고쳤다(context-tools는 시험이 따로 쓰던 derived 쓰기 연결을 없앴다: coordinator가 유일한 writer다).
  - E2E 조립: `e2e/flow-support.ts`(headless shell·core 띄우기, renderer DOM 입력·클릭·실제 마우스 입력, shell preload의 core 통로로 사람 command, 프로젝트 등록·추적, 색인 대기)와 `e2e/run.ts`가 shell을 기본으로 `LOPHN_SHELL_HEADLESS=1`로 띄운다(사람이 화면에서 보려면 `LOPHN_SHELL_HEADLESS=0`).
  - find-documents 1·2·3·4·7과 다른 갈래(빈 검색, 보관, section 미지원, 지연·누락). 5~6(agent·coding agent 읽기)은 agent slice E2E(lead 결정 Q4)
  - first-project 3·5·6·7·8과 다른 갈래(등록만으로는 추적하지 않음, 겹침 거절, 미지원 형식, 추적을 꺼도 판 읽기)
  - write-series 1·4·6·7과 다른 갈래(해석할 수 없는 규칙, 이미 쓴 key, 제안은 문서를 만들지 않음)
  - organize-documents 4·5와 사람 직접 이동 갈래(이름 충돌·옛 예약 이름, 옛 참조 안내, 원본 파일은 그대로). 2~3(lophn 역할 추천·question)은 agent slice E2E(lead 결정 Q4)
  - 시험: `outline-and-search/consumer_test.ts`, `apps/worker/documents/search_test.ts`, `apps/core/documents-derived_test.ts`(실제 core·documents worker: 저장→검색·목차·읽기, 고친 판, 보관, core 재시작), `terms_test.ts`의 출현 확인 거절, `reads_test.ts`의 위 결함 셋. `deno task e2e`에서 위 flow가 통과한다.
- 이어보냄(이 PR이 하지 않은 것):
  - first-project 1·2·4는 `e2e/flows/first-project_test.ts`의 `flow first-project: 1·2·4`가 실제 화면으로 돈다: launcher 빈 카드 자리의 등록 dialog(이름·목적·폴더, headless OS 폴더 선택기는 `LOPHN_SHELL_PICK_FOLDER`가 고른 폴더를 돌려준다) → 그 프로젝트 작업대의 추적 꺼짐 안내 → 추적 dialog의 기본 규칙(Markdown, .gitignore)과 포함·제외 미리보기 → 그만두면 켜지 않고 켜면 미리본 범위만 문서가 된다. 다른 시험의 준비는 여전히 같은 사람 command를 core 통로로 낸다. 접근 상실·format 검사 실패 갈래 → 이 PR이 보지 않았다(후속)
  - project-workspace 2(문서 읽기·고치기)·edit-document 1·2·3·4·5·6·7과 충돌·저장 실패 갈래는 `e2e/flows/project-workspace_test.ts`의 `flow project-workspace 2`가 돈다(shell#T17 #376이 project 작업대 core source와 저장 흐름을 붙였다). 이 시험이 찾은 것: 쓸 수 없던 폴더가 풀린 뒤 "다시 시도"를 누르면 글은 파일에 쓰이지만 편집기가 곧 충돌로 바뀌던 것은 자동 다시 시도와 겹친 쓰기 때문이었고 #410이 고쳤다(시험은 충돌 없이 저장으로 끝난다). 아직 없는 것: edit-document 8(탭·창 닫기 guard는 shell overlay dialog라 flow 시험이 DOM으로 구동하지 않았다), project-workspace 3~9(terminal·app-panel·배치 복원은 documents 밖)
  - restore-document 1·2·3·4·6과 비교만 하고 닫기·이미 같은 내용·옛 판이 이후 이력과 함께 남음은 `e2e/flows/restore-document_test.ts`가 돈다(정보 패널 이력 → 비교 화면 → restore 확인 → 원본 파일 쓰기와 그 관측 판). 5의 충돌은 #410이 restore가 비교 때 본 최신 판과 그 판 원문의 파일 hash를 기준으로 삼게 하면서 닫혔다: 관측이 판으로 만든 바깥 변경도 쓰기 전 충돌이고, 관측 전 바깥 변경은 main 단위 시험(`apps/shell/main/editor/restore_test.ts`)이 결정적으로 보며 flow 시험은 확인 직전 바깥 변경으로 어느 쪽이든 쓰지 않고 그 내용이 자기 판으로 남는 것을 본다. 아직 없는 것: agent가 쓴 판의 run 근거(1)·옛 이름·자리 참조(1), 원본 파일이 없거나 접근할 수 없을 때(다른 갈래), 검색 반영 대기 표시(6)
  - organize-documents 1·6·7은 `e2e/flows/organize-documents_test.ts`의 `flow organize-documents: 1·6·7`이 실제 projects 화면으로 돈다: 프로젝트 제목 저장 → 문서 이름 변경(같은 문서·같은 고정 판·원본 파일 그대로) → 고른 문서의 판을 Markdown으로 export해 포함 문서·원래 파일과 고르지 않은 문서를 구별. 문서를 파일로 두기와 빼기 화면(shell#T20·documents#T19)과 JSON export·redaction 실패 갈래는 이 시험이 보지 않았다(후속). write-series 2·3·5의 "내용을 쓰고 저장"(편집기 저장·series draft) → shell#T17. series 등록 화면의 자리 선택지는 화면이 처음 한 번 읽는다(새로 등록한 프로젝트는 창을 다시 읽어야 보인다, shell 쪽 갱신은 shell#T19 후속)
  - derived의 `ledger_id` 불일치(복원 뒤)는 붙었다: core가 search consumer 통로의 `documents.search_ledger`로 지금 ledger의 식별을 알리고 coordinator의 문(`apps/worker/documents/ledger-gate.ts`)이 `reconcileLedgerBasis`로 store를 맞춘 뒤에야 cursor·apply·advance에 답한다(platform#T42, `apps/core/restore-derived_test.ts`). 삭제 뒤 재생성(`documents.rebuild.sqlite`) 흐름과 요약·주제 검색 cache를 채우는 일은 이 조립에 없다
  - shell#T17이 실제 headless 제품 실행에서 찾은 둘을 풀었다. (1) worker `documents/read`가 unavailable이던 것은 제품 core에 derived store가 없어서였다(reader의 `derivedRead`가 "derived store가 아직 없다"를 unavailable로 답한다, 빈 본문으로 꾸미지 않는다). coordinator가 store를 열고 search consumer가 채우면서 해소됐고, 추적·upload한 문서 모두 `apps/core/documents-observation_test.ts`·`documents-derived_test.ts`에서 본문(추출 전에는 `section_status: unverified`와 원문 file 참조)을 읽는다. 시작 직후에도 store는 이미 있다(core 기동이 coordinator 뒤에 선다). (2) 파일 추적이 만든 문서의 자리가 null이라 project 작업대 목록·palette에 보이지 않던 것은 Q31로 정했다.

## slice: context

### T22 Context ledger

- 상태: 완료 (#190)
- 등급: 기본
- concern: documents/contexts
- 요구: documents/contexts#R1, R2, R3, R5, R6, R7, R8, R15
- 자리: packages/documents/contexts/
- 쓰는 contract: platform command·read·인증(Context Engineer agent 자격), contracts#T33의 apps blueprint read((app, command)의 존재와 effect=read), contracts#T28의 revert 근거, versions(T6)
- 내놓는 contract: `context.create`, `context.update`, `context.set_item`, `context.remove_item`, `context.archive`, `context.unarchive`; read `/v1/contexts/list`, `/get`, `/related`; event `ContextCreated`, `ContextUpdated`, `ContextItemSet`, `ContextItemRemoved`, `ContextArchived`, `ContextUnarchived`
- slice: context
- 선행: T9, contracts#T21, contracts#T28, contracts#T33
- 완료:
  - `contexts`·`context_items` 표, target_key canonical encoding(문서 전체 null section, section, app 가지 구분)
  - item 대상은 저장 판이 있는 문서·그 section·앱 read command만. 미추적 파일·project 폴더·write·external command는 `invalid_input`
  - 관점 기준·참고·watch와 이유, 같은 문서를 여러 context·같은 context에서 전체와 section을 별개로
  - user와 허용 CE agent의 개별 동작, coding agent의 직접 변경은 forbidden(제안은 question 쪽), 종료 run 거절, base_revision CAS
  - 제거·보관은 문서·앱·용어를 바꾸지 않음. 보관 중 watch 멈춤(T24가 확인)
  - related: 문서가 직접 든 context, project 문서가 직접 든 context를 item에서 계산. 별도 project-context 연결 없음
  - Context는 Operator 담당 범위를 만들지 않는다(preset이 여러 context를 고름)
  - apps 쪽 구현 전에는 contract를 흉내 내는 test double로 app item을 검사한다
  - CE agent run의 context 변경을 lophn-agent revert가 보상하는 경로: 이후 revision이 그대로일 때만, 아니면 conflict
  - lophn-agent#T42에서 고침: `context.set_item`·`remove_item`이 revision을 옮기지 않던 것(요구는 마지막 항목 변경 seq)과 run revert가 부르는 `CONTEXT_DISPATCHABLE_COMMANDS`(lophn-agent Q47)
  - `commands_test.ts`, `reads_test.ts`에 각 요구 번호 테스트

### T23 context outline

- 상태: 완료 (#258) — 이어보냄: 앱 read command 항목의 읽기 가능 여부에 blueprint command 존재 확인 연결(지금은 앱이 활성인지만 본다, apps blueprint read가 들어온 뒤), `/v1/outline/context`의 glossary·candidates → documents#T25(이어받아 채움)
- 등급: 기본
- concern: documents/outline-and-search, documents/contexts
- 요구: documents/outline-and-search#R2, R4, documents/contexts#R4
- 자리: packages/documents/outline-and-search/ (`/v1/outline/context`, root의 context 부분), packages/documents/contexts/ (reads)
- 쓰는 contract: platform read·인증·redaction
- 내놓는 contract: `/v1/outline/context`
- slice: context
- 선행: T14, T22
- 완료:
  - root에 context 목적·기준 항목 수·참조 앱 수·활동, 문제·질문·approval 대기는 소유 concern read를 가리키는 참조만
  - context outline: 목적, 기준→참고→watch 순서의 item, 선택 이유, 선택 고정 판, 읽기 가능 여부, 빈 관점 구별. 예산 3,000과 cursor
  - item은 최신 판을 따라 읽되 읽은 결과·전달 근거는 그때 고른 고정 판, 항목별 옛 판 고정 옵션 없음
  - `reads_test.ts`에 각 요구 번호 테스트

### T24 context watch

- 상태: 완료 (#318) — 한 것: `context.record_watch_change`·`context_watch_changes`, 구성 재생(`pendingWatches`), coordinator watch consumer와 core driver, `watch_unverified` 재확인(질문 Q33). 남은 것: 모듈이 달라 미확인인 비교를 재추출로 푸는 길은 T13으로 넘겼다(Q33). flow build-context의 notification 단계 통합 테스트는 T27
- 등급: 기본
- concern: documents/contexts
- 요구: documents/contexts#R9, R10, R11, R12, R13
- 자리: packages/documents/contexts/ (work.ts watch consumer, commands.ts `context.record_watch_change`), packages/documents/outline-and-search/ (derived `watch` cursor·`watch_unverified`를 mod로 노출)
- 쓰는 contract: platform event 구독·read(source_seq까지 event 재생)·command·machine credential, section-comparison(T16)
- 내놓는 contract: `context.record_watch_change`(machine); event `ContextWatchedItemChanged`(platform notifications가 구독)
- slice: context
- 선행: T16, T22, platform#T4
- 완료:
  - 자기 derived cursor로 `DocumentSaved`를 받아 source_seq 당시 구성을 재생하고 전후 고정 판 비교: 문서 전체는 content_hash, section은 같은 key body_hash·추가·소실. format만 바뀐 저장은 내용 변화가 아님
  - 추출 미완료·실패·비교 의미가 불명한 module 변경은 `watch_unverified`에 남기고 나중에 재추출
  - confirmed만 command로 제출, `(context, target_key, after_version)` 중복 방지, 구성 변경·보관 뒤의 낡은 결과는 거절, command 수락 뒤에 cursor 진행
  - section key 소실은 item을 그대로 두고 소실·미확인을 구별, 유사 section으로 바꾸지 않음
  - 앱 read command item의 watch는 호출·변화 기록을 만들지 않음. 변화 event로 agent run을 시작하지 않음
  - `work_test.ts`, `commands_test.ts`에 각 요구 번호 테스트(비교 중 관점 변경·보관, 같은 결과 재전달, extractor 실패)
  - 이어받음: platform#T53의 record_watch_change 발생 작업. `context.record_watch_change`가 `ContextWatchedItemChanged`를 내는 것은 이 작업의 자리다. flow build-context의 notification 단계 통합 테스트는 platform#T53에 남는다

### T25 Term

- 상태: 완료 (#269) — 한 것: `terms`·`term_evidence` 표, 다섯 command와 `/v1/terms/list`·`/get`, `/v1/outline/context`의 glossary·candidates(T23에서 이어받음), `term.define`의 compare(새 등록은 base_revision 없음, 질문 Q19), 출현 확인 함수(`checkTermOccurrence`). 이어보냄: route 앞단의 출현 확인 연결(coordinator derived store가 필요하다) → documents#T21(T21에서 붙음, #297)
- 등급: 기본
- concern: documents/terms
- 요구: documents/terms#R1, R2, R3, R4, R5, R6
- 자리: packages/documents/terms/ (commands.ts, reads.ts glossary)
- 쓰는 contract: platform command·read·인증(CE agent 자격, platform#T24의 QuestionActionEvidence로 machine이 actor=user 적용), contracts#T28의 revert 근거, outline 읽기(T14)
- 내놓는 contract: `term.propose`, `term.define`, `term.update`, `term.archive`, `term.unarchive`; read `/v1/terms/list`, `/get`, `/v1/outline/context`의 glossary; event `TermProposed`, `TermDefined`, `TermUpdated`, `TermArchived`, `TermUnarchived`
- slice: context
- 선행: T22, T23, platform#T24
- 완료:
  - `terms`·`term_evidence` 표. 후보는 실제 본문의 고정 판과 section 또는 줄 범위 근거가 있어야 한다. route가 command 전에 고정 판 범위를 읽어 출현을 확인하고(질문 Q8), 근거 없는 agent 후보는 거절
  - 정의 확정·수정은 user 또는 고정 option(context·이름·뜻)을 적용하는 machine(actor=user)만. CE agent는 후보 이름·근거만, definition 입력은 forbidden
  - context마다 따로, 같은 이름 자동 통합·번역·상속·대응 없음. 이름 비교는 정확한 문자열
  - glossary는 정의와 후보를 나누고 정의 첫 page 30개와 cursor
  - 보관은 정의·근거를 지우지 않고 정의를 후보로 돌리는 경로가 없다
  - CE agent run의 후보 변경만 revert로 보상(이후 revision이 그대로일 때), 사람 정의는 revert 대상이 아님
  - 앱 read command를 item으로 가진 context의 사람 정의를 앱 설명 읽기 근거로 제공, blueprint로 복사하지 않음
  - lophn-agent#T42에서 더함: run revert가 후보 보상으로 부르는 `TERM_DISPATCHABLE_COMMANDS`(update·archive·unarchive, 정의 확정은 아님)
  - `commands_test.ts`, `reads_test.ts`에 각 요구 번호 테스트(정의 35개를 30개·5개로)

### T26 context export

- 상태: 완료 (#278) — 이어보냄: context export의 Markdown 표현(JSON 결과를 사람이 저장할 때 shell이 Markdown으로 그린다, Q20) → shell#T36
- 등급: 기본
- concern: documents/contexts
- 요구: documents/contexts#R14
- 자리: packages/documents/contexts/ (reads.ts `/v1/contexts/export`)
- 쓰는 contract: platform read·인증·redaction
- 내놓는 contract: read `/v1/contexts/export`
- slice: context
- 선행: T20, T25
- 완료:
  - 목적, 관점별 직접 item, 선택 이유, 읽은 고정 판 참조, glossary. 하위 context·관계 지도·권한 밖 본문 없음. T20과 같은 Markdown·JSON 규칙
  - `reads_test.ts`에 contexts#R14 테스트

### T27 context slice flow E2E
<<<<<<< HEAD
- 상태: 진행 (#486, #493, #498, #507, #511, #516, #526, #531, #535, #558) — 한 것: build-context 1(contexts 화면에서 목적을 말하고 Context Engineer 대화로 의도·경계를 정해 context에 남긴다. 도크를 닫아도 context와 문서 화면이 남고 문서 판은 그대로다), build-context 2(목차·검색에서 이번 목적의 고정 문서 section과 본문 범위만 읽고, blueprint 읽기 command의 이름·설명·입력·효과를 조회한다. 앱 command는 실행하지 않고 사람에게는 검색이 보이지 않는다), build-context 3(conversation에서 책임 근거는 기준, 배경 자료는 참고, 변화만 따라갈 자료는 watch로 제안한다. 사람은 지금 필요한 항목과 읽을 수 있는지를 먼저 확인하고, 선택 이유·읽은 고정 근거·부족한 자료는 필요할 때 살핀다. 근거와 추정을 섞지 않는다. 이 branch (#493)), build-context 4(conversation에서 기존 요청과 자료만으로 정할 수 없는 경계만 묻는다. 사람은 목적과 범위를 정하고, Context Engineer는 허용된 context 구성 변경과 설계 보고를 남긴다. 자유 답은 정확한 변경으로 쓰지 않는다. 이 slice (#498)), build-context 5의 agent 입력·권한 검사(항목마다 현재 agent 자격으로 허용 범위를 다시 읽는다. 초기 입력은 관점별 목차·주소이고 본문은 요청한 section만이다. context 이름이나 연결된 자료로 읽기·앱 command 범위를 넓히지 않는다. 이 slice (#507)), 실제 headless shell·core·documents worker로 build-context 5(사람 구성의 화면·고정 section 읽기)·6·7, section 소실·항목 제거·보관과 define-terms 1·3·6(사람 직접 정의), 미루기·직접 정의 CAS 충돌·같은 이름 다른 context·보관, define-terms 2(Context Engineer가 context 목차에서 필요한 section 본문만 읽고, 서로 다른 문서 3개 이상에 그대로 있는 미등록 말만 후보로 남긴다. 근거는 고정 판의 section·줄 범위 최대 5개이고 뜻은 정하지 않는다. 2개 문서·근거 없는 말은 후보가 아니며 이 단계는 사람 화면에 보이지 않는다. 이 slice (#511)), define-terms 3(contexts 화면에서 이미 정한 뜻과 아직 정하지 않은 후보를 구별해서 본다. conversation에서 결정을 필요로 하는 말의 근거와 미정 선택, 추천 이유를 확인하고, 자신이 쓸 이름·뜻을 명시적으로 답하거나 미룬다. 선택만 하거나 일반 메시지로 긍정한 것은 정의 확정이 아니다. 이 slice (#516)), define-terms 4(고정한 context·이름·뜻 term.define 선택지를 확인 창 없이 사람의 결정으로 접수하고 자유 답은 정의로 쓰지 않는다. 접수된 결정의 machine 적용은 followups 49·55 결함으로 볼 수 없어 e2e에서 ignore step으로 표시했다. 이 slice (#526)), define-terms 5(사람이 정한 뜻은 결정 주체·이전 뜻·이후 뜻의 변경 기록으로 남고 고치면 먼저 기록을 두고 새 기록만 더해진다. 이후 agent가 읽는 목록에서 사람 정의와 미정 후보가 갈라져 있다. term event는 공개 정책이 없어 events read에 안 보여 ledger 행을 읽기 전용으로 읽었고, 4의 machine 적용은 볼 수 없어 같은 term.define을 사람 직접 정의로 불렀다. 이 slice (#531)). build-context 8(끝난 Context Engineer 일의 revert. reverts/preview가 복원 가능(context 보관·보고 문서 보관)과 유지(대화 메시지 감사 사실)를 나누고, 확인 창에서 닫기는 결정이 아니며 결정하면 새 변경으로만 복원된다. 원자료·질문·run은 그대로고 model은 다시 불리지 않으며 contexts 화면에서 Focus가 보관됨으로 남는다. contexts 화면에는 revert 진입이 없고 roles 검토 단추도 Context Engineer 답이 결과 링크를 달지 않아 서지 않아, 같은 owner_decision 요청을 shell 다리로 직접 냈다. 이 slice (#558)). 남은 것: 담당 없음·목적 미정·미확인·범위 밖·revert 충돌·단절; define-terms 4의 적용 확인은 followups 49·55를 #535가 고쳐 ignore를 풀고 통과(define-terms 3은 질문을 기다리는 run에 맞춰 고침), 그 결정의 run·question 출처가 변경 기록에 남는지, agent 근거 부족·반영 지연·question 전제 변경·단절. 제품 runtime child 기동(T26·platform#T24 완료), term.define option adapter(T29 완료), contexts revert 진입(shell#T36 완료)은 contexts 화면에 없어 8단계에서 shell 다리 요청으로 대신했고 완료 task에는 새 넘어온 것 줄을 넣지 않았다. 앱 계약 tool은 lophn-agent#T44에 넘겼다.
- 등급: 기본
- concern: documents
- 요구: 없음 (flow 시나리오: build-context, define-terms)
- 자리: e2e/flows/<flow>_test.ts
- 쓰는 contract: shell 화면, contracts#T10 E2E harness와 fake provider
- 내놓는 contract: 없음
- slice: context
- 선행: T22–T26, contracts#T10, shell#T36(contexts 화면), shell#T27(대화 도크), shell#T28(질문 칸), shell#T29(revert 확인), lophn-agent#T42(context·term tool과 revert 연결), lophn-agent#T43(Context Engineer 역할), lophn-agent#T29(question option 적용), lophn-agent#T34(revert)
- platform#T53에서 넘어온 것: flow build-context의 notification 단계(context watch 변화 알림) 통합 테스트(#195)
- 완료:
  - context slice는 agent slice 뒤라 model 단계까지 돈다(lead 결정 Q4). Context Engineer는 fake provider script로 움직인다
  - build-context 1~8과 다른 갈래(담당 없음, 목적 미정, section 소실·미확인, 범위 밖 자료, 보관·제거, revert 충돌, 연결 끊김)
  - define-terms 1~6과 다른 갈래(근거 부족, 반영 지연, 미루기, 전제 변경, 같은 이름 다른 context, 연결 끊김)
  - `deno task e2e`에서 위 시나리오가 통과

## slice: agent

### T28 지침 파일

- 등급: 기본
- concern: documents/file-tracking, documents/versions
- 요구: documents/file-tracking#R19, R20, documents/versions#R19, R20
- 자리: packages/documents/file-tracking/ (FileTarget·FileObservationBasis의 instruction_file 가지, 등록 파일 관측), packages/documents/versions/ (instruction_file source·VersionSource, 지침 문서 write 보호)
- 쓰는 contract: contracts#T27의 InstructionLocation·InstructionAttachment 값(T15·T16의 instruction_file 참조를 이 type으로 좁힘), `/v1/presets/instruction-attachments` read, Tx 안의 지침 첨부 판정 port(tx.port, 요청함), platform 인증·command. LOPHN.md 자리 규칙(전역·project·app)은 documents가 instruction_file source로 스스로 판정
- 내놓는 contract: 파일 쓰기와 저장 준비 contract의 instruction_file 가지, 지침 대상(등록 locator 또는 preset 첨부)의 현재 확정 판 read와 지침 문서 여부 표시(lophn-agent/instructions#R3, R6이 씀)
- slice: agent
- 선행: T12, T19, contracts#T27(지침 값·첨부 read·첨부 판정 port; lophn-agent 구현 T18은 이 작업 뒤)
- 상태: 완료 (#346)
- 완료:
  - 전역 `<data root>/LOPHN.md`와 활성 project 첫 폴더의 `LOPHN.md`만 exact 등록으로 관측한다. 등록은 documents가 data root와 project 목록에서 스스로 정하고(`file-tracking/instruction.ts`) core reader가 기존 관측 근거(`instructions`)에 실어 coordinator에 보낸다. 폴더 재귀·부모 순회·cwd 추측이 없고 tracking을 끈 project도 관측한다. 일반 root 관측은 등록된 지침 파일을 건너뛰어 project 문서로 만들지 않는다
  - FileObservationBasis·VersionSource·FileSource의 instruction_file 가지로 판을 만든다. 파일은 소유자(data root와 같음)·symlink 아님(상위 폴더 포함 canonical)·일반 파일·열기 전후 identity·UTF-8·hash를 검사하고, 걸리면 판 없이 상태(unverified·validation_failed)만 남긴다. 파일이 없으면 첫 저장 전에는 문서도 판도 없고(source_missing은 연결 문서가 있을 때만) 아무것도 만들지 않는다. 문서는 place·name null이고 Project·system place를 만들지 않는다
  - 사람의 지침 파일 쓰기는 `files.write`의 instruction_file 목표다. exact 등록 경로·대상·층과 맞는 목표만 풀고(아니면 같은 invalid_input) 최초 생성은 미존재 CAS, 저장은 base_hash CAS, 쓴 뒤 그 파일을 바로 다시 관측해 새 판을 만든다. agent·coding agent·app는 route가 user 전용이라 못 쓴다
  - agent·coding_agent·app의 document.save(첫 저장 포함)·update(제목)는 instruction_file에 연결된 문서이거나 현재 preset 판의 지침 첨부가 가리키는 문서에 forbidden이다. instruction_file 원본을 달고 문서를 만드는 것도 forbidden이다. Operator 출력으로 지정돼 있어도 풀리지 않는다. 판정 port가 없거나 실패하면 거절한다. document.move·document.set_source는 이미 user 전용이다
  - `InstructionAttachments` port를 apps/core/lophn-agent.ts가 등록한다(preset 현재 판의 지침 첨부, 같은 근원을 `/v1/presets/instruction-attachments` read가 쓴다)
  - `*_test.ts`에 각 요구 번호 테스트(versions/instruction-file_test.ts, file-tracking/instruction_test.ts, apps/worker/documents/instruction_test.ts, apps/core/documents-instruction_test.ts·documents-instruction-files_test.ts 실제 core)
- 정한 것:
  - instruction_target은 `global` 또는 `project:<prj>`다. 등록 판은 전역 `1`, project는 그 project의 revision이다. project 층 파일은 project의 첫 등록 폴더 바로 아래 LOPHN.md다
  - 전역 파일의 쓰기는 data root 전체 쓰기를 주지 않으려고 임시 파일을 `documents/staging`에 두고 대상 파일 하나에만 쓰기 권한을 준다(같은 파일 시스템 안의 교체만 한다)
  - 외부 편집은 watch 없이 시작·60초 주기·사람이 쓴 직후에 그 파일 하나를 다시 읽어 관측한다. 읽기(소유자·symlink·일반 파일·안정 읽기)는 등록 폴더를 읽을 권한이 있는 준비 worker가 하고(`documents.read_instruction`, 한 frame 256 KiB를 넘는 파일은 미확인) coordinator는 hash·바이트만 받는다. 그래서 project를 만들어도 worker를 다시 띄우지 않는다
  - 전역 지침의 첫 쓰기는 연결된 문서가 아직 없어 `file.record_result` event의 subject를 정할 수 없고 기록은 unverified로 남는다(파일 결과·판은 정상). 파일 결과에 문서 참조를 싣는 계약은 따로 바꾼다
  - OperatorOutput port는 T32가 쓴다(지침 여부 판정에는 쓰지 않는다)
  - `/v1/presets/instruction-attachments` read의 쿼리가 없는 열(presets.definition)을 읽던 것을 preset_revisions.definition으로 고쳤다(lophn-agent#T7의 숨은 오류)
- T28에서 넘어온 것:
  - app 층 `<앱 자리>/LOPHN.md`는 앱 자리의 파일 경로를 documents가 알 수 없어 등록 목록에 들어오지 않는다 (apps/registration이 앱 자리 경로를 내놓는 작업 뒤 `instructionRegistrations`에 더한다)

### T29 설치 안내 읽기

- 상태: 완료 (#270) — 제품 안내 묶음의 실제 설치 폴더 조립은 platform#T48 몫이다(Q18)
- 등급: 기본
- concern: documents/versions
- 요구: documents/versions#R17, R18
- 자리: packages/documents/versions/ (설치 manifest reader: lophn_version·title·content_hash), packages/documents/outline-and-search/ (`/v1/guides/list`·`/get`·`/outline`·`/read`를 기존 outline·section 읽기 코드로)
- 쓰는 contract: 설치 폴더의 `guides/`(자리는 platform/install-and-update, 묶기는 platform#T48), contracts#T18의 BundledGuide, platform read·인증
- 내놓는 contract: `/v1/guides/list`, `/v1/guides/get`, `/v1/guides/outline`, `/v1/guides/read`(BundledGuide)
- slice: agent
- 선행: T14, contracts#T18
- 완료:
  - offline으로 목록·목차·절·본문, 설치 판·내용 hash 표시. 사용자 Document·place·tracking을 자동으로 만들지 않음
  - 직접 편집·이동·보관 불가. 사람이 고치려면 일반 문서 복사본으로 저장(documents.save), update가 복사본을 덮지 않음
  - 안내 글은 lophn-agent 팀이 쓴다(lead 결정 Q6). 여기서는 테스트용 안내 fixture 묶음, `*_test.ts`에 각 요구 번호 테스트

### T30 agent 출력 저장 범위, question option 적용, revert 경로

- 상태: 완료 (#313)
- 등급: 기본
- concern: documents/versions, documents/addressing
- 요구: documents/versions#R14, documents/addressing#R9
- 자리: packages/documents/versions/, packages/documents/addressing/
- 쓰는 contract: contracts#T28의 question option·revert 근거, platform#T18(다른 owner가 같은 Tx로 document.save·document.move를 부름), platform#T24(agent credential, QuestionActionEvidence)
- 내놓는 contract: question option action이 부르는 `document.move`·`document.rename`의 machine(actor=user) 경로, revert가 쓰는 `document.archive`·`document.restore`(machine, 결정 근거)
- slice: agent
- 선행: T8, T9, T16, platform#T18, platform#T24, contracts#T28 (lophn-agent#T29 option 적용과 lophn-agent#T34 revert가 이 작업을 부른다)
- 완료:
  - 기획·설계 결과는 agent 자격의 저장 범위 안에서 고정 문서 판으로 남고 SaveResult의 고정 참조로 다시 연다. 원본 연결·보관·지침 문서는 agent 출력 불가. Operator 범위는 T32
  - 문서 이동·이름 변경 option: 대상·place·이름·base_revision이 고정된 option을 사람이 고른 근거로만 machine이 actor=user로 한 번 적용. 자유 답·추천·침묵·낡은 기준은 적용하지 않음
  - revert: run 이후 판·revision이 그대로일 때만 보상, 생성 문서는 보관, 원본 연결 문서의 디스크 revert는 포함하지 않음. 이후 변경은 conflict
  - `*_test.ts`에 versions#R14(agent 출력), addressing#R9(option 적용) 테스트와 revert 경로 테스트

## slice: apps

### T31 앱 자리와 앱 출력

- 상태: 완료 (#330) — 이어보냄: broker 서버의 `DocumentsSave` 조립(app credential client·출력 bytes 근원·선언 읽기)과 cap-save의 출력 bytes 전달 방식 → apps#T19(질문 Q35)
- 등급: 기본
- concern: documents/addressing, documents/versions, documents/series
- 요구: documents/versions#R14, documents/addressing#R2, documents/series#R1
- 자리: packages/documents/addressing/ (place kind app 해석, 자리 이름 예약 port 구현을 apps/registration에 주입), packages/documents/versions/ (app 자격 저장 범위), packages/documents/outline-and-search/ (앱 자리 목록은 apps/blueprint의 읽을 구조를 가리킴)
- 쓰는 contract: apps registration read(App 존재·status·slug), apps blueprint read(선언 출력 문서 이름)
- 내놓는 contract: 자리 이름 예약 port의 구현(T5에서 모양을 냄)
- slice: apps
- 선행: T9, T17, contracts#T20, contracts#T33, apps#T1(app 생성의 이름 예약), apps#T13(앱 broker), apps#T14(cap-save)
- apps#T13에서 넘어온 것: broker의 `DocumentsSave` port(`packages/apps/permissions/broker/documents.ts`)를 실제 앱 자격 저장에 잇는 어댑터. broker는 선언 key·grant를 확인하고 늘 자식의 앱 자리와 같은 idempotency key로 부른다
- 완료:
  - 앱은 자기 앱 자리의 선언된 출력 이름(blueprint documents[].key)만 저장. save는 (앱 자리, key)로 대상을 찾아 첫 저장이면 만들고 그 뒤에는 같은 Document의 새 판(base_version CAS), VersionSource kind=app{app, release}. 앱 결과는 고정 판으로 다시 연다
  - project 이름을 앱이 쓰면 conflict(같은 transaction 예약), 앱 이름 변경 뒤 옛 address 안내
  - 허용된 앱의 series 등록·멤버 저장
  - `*_test.ts`에 각 요구 번호 테스트, apps 팀 registration 테스트와 함께 이름 공간 통합 테스트
  - 구현 메모: 앱 credential의 scope target에는 place가 없어(발급은 app·release·process·mode만 고정) 앱 자리 경계는 documents가 요청 자격의 app id로 직접 판정한다. `addressing/app-place.ts`의 `actingApp`·`isAppPlace`, `versions/authorization.ts`의 `authorizeDocument`(앱 자격은 다른 place·자리 없음의 기존 문서를 not_found, 새 문서는 forbidden), `versions/app-output.ts`의 `appOutputRejected`(새 출력은 자기 앱 place·문서 이름 필수, `appRegistrationLookup`으로 앱이 있고 active일 때만, 다른 place의 기존 문서는 없는 문서와 같은 답)·`releaseClaimed`(판 출처 release는 자격이 고정한 release), `series/commands.ts`·`series/join.ts`(앱은 자기 앱 place의 가족만 등록·변경·가입). place 이름 예약 port의 주입은 apps#T1이 `apps/core/apps.ts`에 이미 해 두었다
  - 어댑터: `packages/apps/permissions/adapters/documents-save.ts`의 `createAppDocumentsSave`. broker `DocumentsSave`를 그 자식의 app credential로 `documents/list`(앱 place에서 출력 이름으로 찾기) → `documents/upload`(bytes를 core blob 준비로, hash·크기는 core가 실제 bytes와 맞춤) → `document.prepare`(새 문서면 선언 이름·format·앱 place·이름, source app{app, release}) → `document.save`(기준 판 CAS, 준비 참조·재전송 key 묶음)로 잇는다. hash는 꾸미지 않는다. 새 문서 id는 (앱, 출력 key, 재전송 key)에서 정해 응답을 잃은 첫 저장의 재전송이 같은 문서를 가리키고, 기준 없이 다른 key로 이미 있는 문서에 쓰면 conflict다. `apps/core/app-output_test.ts`가 실제 core·documents worker·I/O worker로 판 쌓기·재전송·낡은 기준 conflict·unchanged·다른 앱 문서 거절·보관된 앱·project 이름 충돌·문서 이름 변경 뒤 옛 address·앱 series 범위를 본다
  - 같이 고친 것: `documentUpload.actors`에 `app`을 더했다(contracts 변경). 앱이 자기 출력의 준비 참조를 자기 credential로 받아야 `document.save`(principal 일치)가 등록한다. `addressing/reads.ts`의 현재 place 이름이 `reserved_seq`를 text로 정렬해 seq 9 다음 10에서 옛 이름이 현재로 안내되던 것을 숫자 순서로 고쳤다(앱 이름 변경 뒤 옛 address 안내에 닿는다)
  - 범위 밖으로 둔 것: `자리:`의 outline-and-search "앱 자리 목록은 apps/blueprint의 읽을 구조를 가리킴"은 완료 줄에 없고 root outline이 이미 active 앱을 나열한다. 앱 이름(slug) 변경 command는 apps에 아직 없어 앱 이름 변경 뒤 옛 address 안내는 place 예약 두 개를 둔 reads 시험(addressing#R6)과 문서 이름 변경의 core 통합 시험으로 보았다

## slice: operator

### T32 Operator 출력 범위

- 상태: 완료 (#444) — 구현은 packages/documents/versions/operator-output.ts. 역할이 ledger의 현재 자격(`scope.agent`)에 실리지 않아 contracts의 `OperatorOutputLookup`에 `isOperator(assignment)`를 additive로 더하고 core(apps/core/lophn-agent.ts)에 `OperatorOutput` port 구현을 등록했다. 시험은 operator_output_test.ts(단위)와 apps/core/documents-operator-output_test.ts(실제 core)
- 등급: 기본
- concern: documents/versions
- 요구: documents/versions#R14
- 자리: packages/documents/versions/
- 쓰는 contract: contracts#T27의 `/v1/assignments/outputs`와 Tx 안의 Operator 출력 판정 port(tx.port, 요청함), platform 인증
- 내놓는 contract: 없음 (document.save가 판정 port를 부른다)
- slice: operator
- 선행: T30, contracts#T27, lophn-agent#T52(ApplyOperatorAssignment와 outputs)
- 완료:
  - Operator 자격의 저장은 assignment의 기존 출력 Document에 새 판만. 새 Document·자리·format 변경·series 다음 문서 생성은 forbidden, 최신 판의 format 계약을 따른다
  - 반복 판단 결과는 고정 판으로 남고 다음 회차가 같은 Document의 새 판이 된다
  - `*_test.ts`에 versions#R14(Operator 출력) 테스트

## 다른 팀에 기대는 것

| 팀 | 무엇 | 작업 id | 쓰는 작업 |
|---|---|---|---|
| contracts | contracts/documents(공통 값·Address·project·자리 이름 port, document·version·준비 결과, 파일 쓰기, format, outline·read·search·guide, series·view, context·term), 등록 interface(`tx.port`, `tx.call`)와 pipe framing, event, blob, redaction, confirmation window, App read, E2E harness, assignment, question·revert 근거, apps blueprint | T6, T7, T10, T11, T12, T13, T14–T19, T20, T21, T27, T28, T33 | 전부 |
| platform | ledger·schema step, command, read, event 구독, identity, 신뢰 child 감독, core entry, scope 재검사, file route, blob 준비·참조·읽기, redaction, 다른 owner command를 같은 Tx로 부르기, QuestionActionEvidence | T1–T5, T7, T9, T11–T16, T18, T24 | T2–T31 |
| shell | 화면(launcher 등록, project-workspace, document 편집기·이력·diff, documents 화면, projects 화면, contexts·conversation 화면) | 미정 | T21, T27 |
| apps | app 생성에서 자리 이름 예약 port 호출, broker와 cap-save | T1, T13, T14 | T31 |
| lophn-agent | context·term tool과 revert 연결, Context Engineer 역할, question option 적용, revert, Operator 출력 판정 | T29, T34, T42, T43, T52 | T27, T32 |

documents가 다른 팀 작업의 선행이 되는 곳: apps#T1 ← T5, apps#T29(format SDK Package) ← T3·T4, platform#T17(notification 반응) ← T24, platform#T42(restore 뒤 derived) ← T13, problems#T19 ← T6·T14, lophn-agent의 읽기·저장 tool ← T4·T6·T8·T9·T13·T14·T16·T22·T23·T25·T28·T30.

## 요구 덮기

| concern | 요구 수 | 덮은 수 | 작업 |
|---|---|---|---|
| documents/projects | 12 | 12 | T7, T10, T19 |
| documents/file-tracking | 20 | 20 | T2, T11, T12, T19, T28 |
| documents/versions | 20 | 20 | T6, T11, T16, T17, T19, T20, T28, T29, T30, T31, T32 |
| documents/formats | 20 | 20 | T3, T4, T8, T12 |
| documents/outline-and-search | 26 | 26 | T13, T14, T15, T16, T23 |
| documents/series | 14 | 14 | T17, T18, T31 |
| documents/addressing | 10 | 10 | T5, T9, T14, T30, T31 |
| documents/contexts | 15 | 15 | T22, T23, T24, T26 |
| documents/terms | 6 | 6 | T25 |
| 합계 | 143 | 143 | |

## 질문

lead가 2026-10-04에 모두 정했다.

- **Q1 공유 entry 파일.** 정함: platform이 registry를 만들고 documents는 `apps/core/documents.ts`와 `apps/worker/documents/`만 고친다(code-map에 반영됨).
- **Q2 의존성.** 정함: picomatch, ignore, QuickJS WASM sync 빌드, parse5를 승인했다(stack.md에 반영됨). Markdown heading scanner, guest 안의 sha256, bounded Myers diff는 직접 쓴다.
- **Q3 E2E 자리와 소유.** 정함: `e2e/flows/<flow>_test.ts`, documents·context slice E2E는 documents 팀(plan README "E2E" 표).
- **Q4 model이 끼는 flow 단계.** 정함: documents slice는 사람 갈래만 돌고 organize-documents 2~3·find-documents 5~6은 agent slice E2E(lophn-agent 팀)에서 돈다. context slice는 agent 뒤라 build-context·define-terms를 model 단계까지 documents 팀이 돈다(T27).
- **Q5 이름 최대 길이.** 처음엔 문서 이름 100 codepoint·place slug 64 codepoint로 정했으나 contracts#T14에서 lead가 둘 다 63으로 바꿨다. T5는 main public contract의 `SLUG_MAX_LENGTH=63`을 그대로 소비한다. place·document가 같은 Slug를 쓰므로 별도 최대 길이나 schema를 만들지 않는다. 자동 제안은 소문자 ASCII·숫자·하이픈이며 코드와 테스트가 정본이다.
- **Q6 설치 안내 글과 자리.** 정함: 글은 lophn-agent 팀, 설치 묶음의 `guides/` 자리는 platform/install-and-update. documents는 reader와 읽기 경로만(T29).
- **Q7 다른 최상위와 한 Tx로 묶기.** 정함: 소유 팀의 동기 Tx 경로를 쓴다. 자리 이름 예약은 `tx.port`(contracts#T14·T6), lophn-agent의 문서 저장·question option 적용은 다른 owner의 등록 command를 같은 Tx로 부르는 `tx.call`(contracts#T6, platform#T18), Operator 출력 판정은 contracts#T27의 판정을 document.save가 부른다(T32).
  - T5 경계: current guarded Tx.sql을 받는 factory를 내놓는다. 현재 platform의 static ports map은 per-command factory injection과 같지 않으며 이 runtime 조립 보정은 platform이 맡는다. raw DB나 이전 Tx를 붙잡은 static port로 우회하지 않는다. lead 결정: port·harness를 T5 병합 선행으로 추가하지 않고 factory·예약 규칙을 먼저 합친다. 실제 writer Worker·current credential·core tx.port 통합은 public harness의 main 병합 뒤 T5 정정 또는 T7 통합 테스트로 확인한다.
- **Q8 derived가 필요한 검사.** 정함: route handler가 command 전에 coordinator로 고정 판을 읽어 확인하고 command는 고정 판 존재와 참조만 CAS한다.
- **Q9 첫 저장의 event.** 정함: 첫 저장은 DocumentCreated와 DocumentSaved(previous_version null)를 함께 낸다.
- **Q10 SDK format Package.** 정함: `@lophn/format-document` 하나(이름·MIME·template·guide·FormatRef, 검사 코드 없음). 코드는 apps#T29, 내용은 T3·T4의 선언에서 만든다.
- **Q11 T5 이름 제안의 작은 동작.** 추천·적용: 제목에서 ASCII 재료가 나오면 먼저 쓰고, 없으면 첫 파일의 basename에서 마지막 확장자를 뺀 재료를 쓴다. 그마저 없으면 `document`, 숫자로 시작하면 `document-` prefix를 쓴다. non-ASCII를 transliteration하지 않으며 title은 그대로 둔다. 63에서 자른 뒤 끝 하이픈을 뺀다. 이유: IO·locale·무작위 없이 항상 schema-valid 제안을 주고 사람이 최종 이름을 고를 수 있게 한다. 중복 이름 suffix 탐색·예약은 순수 제안에 넣지 않는다.
- **Q12 T7 public Project read seam.** 해소(#72). `project.resolve_cwd`는 input `{}`와 host 고정 cwd로 project ID와 read common만 돌려주고 근거가 없으면 fail-closed다. `project.tracking_roots`는 machine 전용 활성·enabled root다. `initial_tracking_proposal`은 저장된 tracking과 별도 output이고 list·resolve cursor drift는 conflict다. Project read 자료 참조는 고정 version이다.
- **Q13 T7 owner target 검사 주입.** 해소(#82, #91). owner는 Tx·ReadSnapshot의 TargetAuthorization port로 domain target을 판정하고, port 부재·Promise·잘못된 반환은 fail-closed다.
- **Q14 T7 authenticated cwd 근거.** 해소(#77).
- **Q15 T11 coordinator가 machine으로 읽을 tracking 규칙·문서 연결(lead 결정).** machine ceiling은 command만 허용하는 것이 의도이므로 machine read를 새로 열지 않는다. core가 소유자로 snapshot에서 tracking 규칙(patterns·use_gitignore)과 경로→문서 연결(document ID·revision·최신 판)을 읽어, 이미 있는 core→coordinator 요청 envelope로 coordinator에 관측 근거 재료를 넘긴다. 규칙이나 연결이 바뀌면 같은 통로로 다시 보낸다. contract의 HTTP route·credential 정책은 바꾸지 않는다.
- **Q16 T11 save가 판의 경로별 원문을 남기지 않는다.** 정함(lead, 추천안 채택): PreparedVersion에 `files`(ContentFile과 파일별 준비 참조)를 더하고 save가 같은 tx에서 `version_files` 행과 `document_version.file` blob 참조(owner_key `<version>/<path>`)를 등록한다(#271). `files` 항목은 새 바이트면 준비 참조(`preparation_ref`), 이미 등록된 blob(옛 판으로 되돌림·같은 바이트)이면 그 참조(`existing`)로, 준비 단계가 입력의 content로 정한다. `existing`은 판 파일 참조(`document_version/file`)여야 하고 그 판의 문서를 이 자격이 `document.file`로 읽을 수 있어야 하며, 없는 참조와 권한 밖은 같은 `forbidden`이다. 같은 바이트의 준비 참조는 principal·purpose·hash마다 하나(10분)라 A→B→A·같은 내용의 다른 파일은 준비 참조를 다시 써야 한다: core relay가 살아 있는 참조를 돌려주고(coding-agent Q24), 관측 worker는 동시 같은 바이트 준비를 한 번만 한다. 만기된 참조는 prune 전이라도 다시 등록할 수 있다. 아래는 정하기 전의 문제와 추천이다. `document.save`의 입력 PreparedVersion에는 파일 목록이 없어(파일별 준비 참조·ContentFile) 판의 `version_files` 행과 경로별 원문 blob 참조(`versionFileField`)를 만들지 못한다. `mintVersion`의 files는 `{hash, size_bytes}`이고 원문 blob(`document_file` 준비)은 등록되지 않아 준비 참조 수명(10분)이 지나면 사라진다. 그래서 관측한 판은 Version과 파일 목록 blob은 있지만 `document.file`·export·extraction이 읽을 원문 바이트가 없다(T8 완료 줄이 "경로별 원문 blob은 준비 worker가 확정하며 등록한다"고 적었으나 구현되지 않았다). 추천: PreparedVersion에 `files`(ContentFile와 파일별 준비 참조) 필드를 더하고 save가 같은 Tx에서 `version_files` 행과 `document_version.file` blob 참조를 등록한다(contracts 변경이라 lead 결정 뒤 contracts·T6·T8가 같이). 지금은 진행하지 않았다.
- **Q17 T11 core 안에서 쓰는 event 구독·알려진 secret registry의 조립.** (정함 #275 — event 구독, secret registry는 남음) (1) 해소: 제품 reader 등록이 팀 event 정의와 공개 정책을 싣지 않던 것을 platform이 고쳤다. 팀 module이 `createEventRegistration()`(events·visibility)을 내고, reader Worker가 `createReaderRegistration` 또는 `createEventRegistration`을 낸 모든 팀 module에서 모아 한 registry로 `events/list`에 싣는다(`collectEventRegistrations`, 같은 type의 서로 다른 정의·정책은 기동 거절, 정책이 없으면 숨김). 손으로 쓴 목록이 아니라 routes·settings가 모이는 것처럼 core가 받은 팀 module 목록에서 모은다(settings.ts는 정적 import 목록이라 그대로 두었다). 지금 정책을 낸 팀은 documents(Project 4종, 사람 전용 기존 정책)와 problems(VerificationRecorded)뿐이고 apps·lophn-agent·coding-agent·shell·platform은 정책이 없어 그 event는 계속 숨김이다. 사람 token의 operation에는 정책이 있는 event 이름이 들어가 owner 정책이 사람에게 보일 수 있다(`eventOperations`). (2) core 안 구독자: core가 직접 돌리는 machine principal(`machine:documents-feed`, token 없음, ledger credential 기록)이 바깥 구독자와 같은 session(`createEventSession`, 함수 sink)으로 `events/list`를 지나 dispatcher에 올라 event를 받는다(`apps/core/internal-subscription.ts`, at-least-once, session이 닫히면 backoff 뒤 다시 열고 열 때마다 resync). 공개 범위는 owner(documents)의 `documents-events.ts`가 정한다: `ProjectCreated·Updated·TrackingChanged·Archived·Unarchived`와 `DocumentCreated·Saved·SourceChanged·Archived·Unarchived·Restored`가 feed에 열리고, Project 4종은 나머지 자격에 기존 사람 전용 정책을 그대로 따르며 나머지 documents event(`ProjectTrackingChanged` 포함)와 문서 event는 feed가 아니면 닫혀 있다. 사람·agent·app credential은 이 principal(actor machine, credential_ref 일치)이 될 수 없다. 1초·2초 주기 읽기를 이 구독으로 바꿨다(`documents-feed.ts`: event나 (재)구독이 깨우면 root 집합과 관측 근거를 같은 snapshot read로 다시 맞춘다. 실패할 때만 대기 뒤 다시 시도). (3) 해소 #289(platform#T19 후속): core가 secret store를 열어 값을 읽고 reader pool의 등록·회수 통로로 reader Worker의 보호 메모리 registry를 채워 documents redactor가 알려진 값도 지운다(값을 못 읽는 동안은 fail-closed). 아래는 해소 전의 문제다: secret store가 제품 core에 조립되지 않아 core 보호 메모리에 채워진 registry가 없고 reader pool은 요청 밖의 값 전달 통로가 없다. 추천: secret registry 전달은 platform이 reader pool의 값 등록·회수 통로와 함께 정한다. 그 전까지 documents redactor는 pattern 검출만 한다. WebSocket 구독의 dispatcher 등록과 SubjectScopeGate는 platform #277이 고쳤다.
- **Q18 T29 설치 안내 manifest 모양과 설치 root(추천으로 진행).** platform#T48(설치 묶음)이 아직 `guides/`를 만들지 않아 documents가 reader 쪽 모양을 정했다: `<설치 root>/guides/manifest.json`은 `{lophn_version, guides: BundledGuide[]}`(lophn-agent#T30이 내놓는 BundledGuide 배열 그대로, 모든 안내의 lophn_version이 최상위와 같다)이고 파일은 `guides/` 기준 상대 경로, content_hash는 대표 파일 raw bytes sha256이다(lophn-agent Q27). 설치 root는 reader Worker가 env `LOPHN_INSTALL_ROOT`(없으면 `/opt/lophn`)에서 읽는다. platform#T48이 다른 모양·자리를 정하면 `apps/core/documents-reader.ts`의 `guidesRoot`와 `packages/documents/versions/guides.ts`만 맞춘다. 제품 안내가 없으면 `/v1/guides/*`는 빈 목록이 아니라 unavailable이다.
- **Q19 T25 `term.define`의 compare가 새 등록에도 `base_revision`을 요구한다.** 정함(lead): contract를 고친다. `termDefine.compare`의 `base_revision`은 선택이다. 이미 있는 용어를 정의할 때는 handler가 필수로 요구하고(없으면 `invalid_input`), 새 ID 등록에는 비교할 revision이 없으므로 보내면 `invalid_input`이다. 이유: 없는 revision을 꾸며 보내게 하지 않는다.
- **Q20 (정함, lead: 추천대로) T26 context export에 Markdown·JSON 선택이 없다(추천으로 진행).** `contexts/export` contract(`contextExport`)는 입력이 `{context}`뿐이고 출력이 JSON 구조(context·items·glossary)로 고정이라 T20의 `format: markdown|json` 규칙을 그대로 따를 자리가 없다. 구현은 contract 출력(JSON)만 낸다: 목적·관점별 직접 항목·선택 이유·읽은 고정 판(문서 항목의 최신 판)·section 상태·활성 정의 glossary, 권한 밖 문서·앱 항목은 항목과 context 안 모두에서 빠지고, 외부 출력 redaction은 title·purpose·reason·용어 이름·정의에 적용하며 하나라도 실패하면 export 전체가 `unavailable`이다. Markdown 렌더링이 필요하면 contract(contracts#T21)에 `format` 입력과 본문 출력을 더해야 한다. 추천: 지금은 JSON만 두고, shell이 Markdown으로 보여 주는 것은 화면 쪽에서 JSON을 렌더링한다. 같이 정한 것: 판이 없는 문서 항목은 고정할 판이 없어 싣지 않고, 보관 문서는 최신 판을 그대로 고정 참조로 싣는다. section 상태는 derived store가 아직 없으면 `unverified`다.
- **Q21 T12 준비 worker는 어디서 띄우나(정함: architecture/documents 2.1을 따른다).** coordinator가 띄우고 감독한다. core의 platform 감독은 kind마다 child 하나라 slot 둘을 선언하지 못하고, 준비 worker의 읽기·쓰기 권한이 coordinator가 아는 현재 등록 root로 정해져서다. coordinator는 platform `createSupervisor`를 slot마다 하나씩 쓴다(ready 기한·3회 재기동·process group 종료 확인이 platform 규칙 그대로). 그래서 coordinator spec의 `allow_run`에 `/usr/bin/kill`(감독의 group 종료 adapter), `allow_env`에 `NODE_V8_COVERAGE`(감독이 child를 띄울 때 deno가 읽는 이름)가 더해졌고 core의 `documents/preparation` spec은 없앴다(spec은 `apps/worker/documents/launch.ts`). worker는 첫 요청에서 띄우고 한 번 뜬 뒤 상주한다(core 기동 시간·메모리). 등록 root 근거가 달라지면 다음 요청이 새 권한으로 다시 띄운다. 프로세스가 죽으면 진행 중 요청은 결과 불명(unavailable)이고 자동으로 다시 쓰지 않는다. (#293)
- **Q22 T12 폴더 미리보기는 상시 slot이 못 읽는 폴더를 읽는다(정함: 추천 채택).** `/v1/projects/preview_tracking`은 아직 등록하지 않은 폴더를 scan해야 해서 현재 root만 읽는 상시 slot의 권한 밖이다. 요청의 폴더만 `--allow-read`로 가진 준비 worker를 요청마다 하나 띄워 한 번 쓰고 끝낸다(route는 user만, 폴더는 사람이 고른 것). (#293)
- **Q23 T12 관측 loop는 coordinator 안에 둔다(추천으로 진행).** T11이 넘긴 batch의 준비 worker 요청·응답은 만들었다(`documents.hash_batch`: 후보 순서대로 hash·크기 또는 unverified 이유, 본문 없음, 실제 준비 worker 시험). 그러나 production 관측은 그대로 coordinator의 loop이고 후보 배분의 결과 제출은 연결하지 않았다. 관측 제출은 읽은 바이트를 같은 stream의 blob으로 core에 준비해야 하는데 준비 worker는 core 감독 pipe가 아니라 coordinator의 자식이라 blob 준비 통로가 없다. 읽기를 준비 worker로 옮기려면 바이트를 coordinator로 되돌리거나 준비 worker에 blob 준비 통로를 주는 설계가 먼저 필요하다. 사람 파일 쓰기가 준비 worker의 첫 소비자이고, 쓴 파일은 관측 loop가 새 판 하나로 기록한다(중복 없음, 시험).  설계 필요(후속 #298이 T21로 이어보냄): (a) 준비 worker가 읽은 바이트를 coordinator로 보내는 byte frame 길은 파일 창 읽기에서 생겼다(pool `replyBytes`, 준비 worker의 응답 전 byte frame) — 단 창 하나(256 KiB)짜리 요청·응답이고 stream은 아니다. (b) coordinator가 그 바이트를 core의 blob으로 준비하는 길(`session.prepareBlob`의 stream 입력, credit 기반)은 이미 있다. 이 둘을 이어 한 파일을 준비 worker가 stream으로 읽어 hash하며 coordinator를 거쳐 blob으로 준비하는 단일 요청과, 그 결과(blob 참조·hash)를 관측 제출(`createObservationSubmit`)에 넘기는 연결이 설계 대상이다. 절반만 만들지 않았고 production 관측은 coordinator loop 그대로다. (#293)
- **Q24 T12 working copy의 판 확정은 core가 요청자 자격으로 한다(정함: 추천 채택).** `files.write`의 `version_request`는 사본 쓰기가 성공한 뒤 core가 요청 credential로 `document.prepare`·`document.save`(`base_version` CAS)를 따로 시도하고 결과를 `version_result`로 낸다(`confirmed`·`validation_failed`·`conflict`, 일시 실패는 `preparing`). coordinator의 machine credential로 저장하면 판의 작성 주체가 machine이 되어 "원래 actor를 machine 준비 자격으로 바꾸지 않는다"를 어긴다. project 파일의 `version_request`는 관측 loop가 같은 판을 만들므로 `preparing`이고 판 수는 관측 경계(안정된 변경)에 따라 정해진다. 판 확정이 어떤 결과여도 이미 성공한 파일 쓰기를 되돌리지 않는다(formats#R6). (#293)
- **Q25 T12가 남긴 한계 둘(해소: 후속 #298).** (1) 쓰기는 coordinator·준비 worker가 권한을 가진 root, 곧 tracking을 켠 활성 폴더에만 됐다. 이제 core가 snapshot에서 읽은 활성 project의 모든 등록 폴더(`folders`)를 관측 근거와 같은 envelope로 coordinator에 보내고, coordinator는 이것으로 파일 목표를 풀고 준비 worker의 권한 집합(read·write)을 만든다(집합이 달라지면 다음 요청이 준비 worker를 새 권한으로 다시 띄운다). coordinator 프로세스 자체의 권한(`workerSpecs`)은 그대로 tracking root라 폴더만 바뀌어도 coordinator를 다시 띄우지 않는다(project 등록 직후의 미리보기 같은 요청이 재시작에 끊기지 않는다). 대신 coordinator가 읽지 못하는 폴더의 동시 작업 key는 symlink를 풀지 않은 경로다(준비 worker가 매번 root 안의 일반 파일인지 다시 보고 base_hash·identity 대조와 원자 교체는 그대로다). (2) 읽기는 512 KiB가 한계였다. 이제 헤더와 창 단위 byte frame이다(Q25의 해소 본문은 T12 상태 줄). 처음 추천은 coordinator→core byte frame 응답이었고, core가 창 하나씩 요청하고 응답 전에 channel로 byte frame을 받는 방식으로 했다(core 메모리는 열린 창 하나). (#293)
- **Q26 T12 `version_result: conflict`가 새 기준을 돌려주지 못한다(해소: 후속 #298, contracts 변경 승인).** FileOperationResult에 선택 field `latest_version`(그 문서의 지금 최신 판 id)을 더했다. `version_result`가 `conflict`일 때만 올 수 있고(스키마가 검사), core가 판 확정이 conflict로 끝난 뒤 그 문서의 최신 판을 읽어 채운다. 읽지 못하면 싣지 않고 충돌은 그대로다. 사본 파일과 `files.status`의 `version_pending`·`compared_version`은 그대로 남는다. (#293)
- **Q27 T12가 platform 쪽에서 고친 것 셋(platform이 확인해 달라).** (1) `files.delete`의 route confirmation은 core에 연결돼 있지 않아 항상 503이었다. core가 writer Worker의 registry에 `consume`(예약과 소비를 그 thread에서 한 번에) 메시지를 보내는 다리를 `startApiServer({confirmation})`에 넣었고 `consumeRouteConfirmation`이 비동기 다리(`RouteConfirmation.useOnce`)도 받게 했다(기존 동기 `ConfirmationBridge`는 그대로). (2) platform이 소비할 때 결정 이름으로 route 이름(`files.delete`)을 썼는데 점이 있어 발급할 수 없는 이름이다(`decisionNameSchema`). core가 `routeDecision` 표로 `FILE_DELETE_DECISION`(`delete_file`)으로 바꿔 소비한다. route 정의가 결정 이름을 싣게 contracts를 고치면 이 표를 없앤다. (3) coordinator는 worker_request를 답을 기다리지 않고 처리한다(오래 걸리는 파일 쓰기·`files.watch`가 뒤따르는 요청과 byte frame을 막지 않게). (#293)
- **Q28 T12 관측하지 않는 폴더의 `version_request`(추천으로 진행).** tracking을 끈 project의 폴더는 쓸 수 있지만 관측 loop가 보지 않아 project 파일의 판을 만들지 않는다. 그 폴더에 `version_request`를 붙인 쓰기는 기다릴 판이 없으므로 `preparing`이 아니라 `not_requested`로 답한다(파일 쓰기·기록은 그대로). 관측하는 폴더는 지금처럼 `preparing`이다(관측 loop가 같은 판을 만든다, Q24). 쓰기 폴더(`folders`)와 관측 root(`roots`)를 coordinator가 따로 쥐어서 가릴 수 있다. (후속 #298)
- **Q29 큰 텍스트 문서의 구조 검사는 대표 파일 1 MiB까지만 한다(추천으로 진행).** 문서 크기의 domain 제한은 없고(upload 상한 256 MiB 하나), 검사 한도는 guest 실행(memory 64 MiB·호출 5초)이 실제로 끝나는 크기라 1 MiB다. 넘는 문서는 미지정 새 문서면 `check_skipped` warning으로 저장되고 명시 format이면 `invalid_input`이다. 추천: 이 정책을 유지하고, 더 큰 문서의 구조 검사가 필요하면 guest module을 줄이는 별도 작업으로 한도를 올린다(module_hash가 바뀌므로 fixture와 옛 판 module 보존을 함께 본다). 사람이 정할 것: 1 MiB 넘는 문서의 구조 검사를 포기해도 되는지.
- **Q30 T16 diff·이력은 reader Worker가 derived store만으로 계산한다(추천으로 진행).** (1) architecture 5.4는 줄 diff를 준비 worker에서 한다고 썼지만, section 이력·outline·search가 이미 reader Worker(core 안의 별도 thread, 요청 credential의 snapshot과 derived read 연결)에서 도므로 같은 자리에 두었다. 계산은 core 요청 thread 밖이고 Myers는 편집 거리 1,024와 탐색 20,000,000 단계에서 멈춘다(넘으면 줄 수준 일치를 못 찾은 구간 전체를 삭제+추가 한 block으로 두며, 적용하면 같은 결과인 올바른 diff이고 최소가 아닐 뿐이다). 응답은 한 번에 12,000 codepoint·1,000줄까지 변경 block 경계에서 끊어 cursor로 잇고(block 하나가 예산을 넘으면 줄 단위), 예산보다 긴 한 줄은 싣지 않고 그 줄만 누락으로 밝힌다. 준비 worker로 옮기는 일은 documents worker에서 reader Worker가 파생 text를 직접 읽는 길을 대체해야 하므로 필요해지면 별도 작업이다. (2) 본문은 derived_texts(정규화한 대표 텍스트)를 쓴다: 줄 번호가 section의 own_ranges와 같은 좌표다. 추출이 없거나 unverified·unsupported·failed인 판(검사 한도 1 MiB를 넘은 판 포함)은 section도 본문도 추정하지 않고 판마다 이유와 함께 누락이다. 원문 blob을 직접 읽어 diff하는 길은 두지 않았다(대표 텍스트가 정규화를 거쳐 줄 좌표가 달라진다). (3) 이력·diff는 보관 문서의 고정 판도 읽는다(versions#R11). 권한 밖과 없는 문서·다른 문서의 판은 같은 not_found다. section_history의 소실 행 순서(R20)는 두 판의 모든 key를 비교하는 공용 `compareSections`가 살아 있는 행 뒤에 소실 행을 모아 정하고(T24 watch가 같은 함수를 쓴다), 한 key의 이력은 판마다 한 행이다. module이 다른 두 판은 body_hash 규약이 달라 비교하지 않고 누락으로 밝힌다. (4) `document.restore`: 준비 결과의 content_hash·files_hash·파일 목록·FormatRef가 선택한 판과 정확히 같을 때만 새 판을 만들고(아니면 invalid_input), 파일은 그 판의 원문 blob 참조(`existing`)다. 최신과 내용·형식이 같으면 unchanged, 보관 문서·낡은 base_version·base_revision은 conflict, 권한 밖은 없는 문서와 같은 not_found다. 원본 연결 문서는 선택 판의 바이트를 사람이 파일에 쓴 뒤(T12) 그 파일의 관측 근거(같은 연결의 source·file_basis, 관측 original_hash가 선택 판의 대표 파일)로만 확정하고 근거 없는 직접 restore는 conflict다. 제목 보상 값은 machine(revert)만 보낼 수 있다. 새 판의 event는 `DocumentSaved`와 `DocumentRestored`이고 결과의 event_seq는 마지막 event다. (5) restore 준비: 모든 파일이 같은 판의 원문 blob 참조(`existing`)이고 그 판의 files_hash·정확한 FormatRef와 같으면, 검사 한도(1 MiB) 초과로 검사를 하지 못한 `check_skipped`는 명시 format이어도 error가 아니라 warning이다(이미 그 FormatRef로 받아들인 내용이다). 새 바이트의 명시 format 저장은 #295 그대로 invalid_input이고, 다른 검사 error가 함께 있거나 참조·hash·FormatRef가 하나라도 다르면 받아 주지 않는다. 고친 것: versions 시험 fixture(`versions/testing/mod.ts`)의 id가 base36이라 판이 많으면 ULID에 없는 글자가 나와 id가 깨졌다(Crockford base32로 고침).
- **Q31 파일 관측이 만든 문서의 자리는 관측 save가 정한다(추천으로 진행, shell#T17이 찾음).** 파일 추적이 만든 문서는 `place: null, name: null`로 저장돼 프로젝트 작업대 목록·palette(자리로 거르는 `documents/list`·`outline/place`)에 한 번도 나오지 않았다. 자리를 누가 정하는지 requirements가 말하지 않았다(addressing#R3은 "임의 기본 자리에 자동으로 넣지 않는다", "원본 연결의 자리는 명시 저장·이동 규칙"). 정함: 프로젝트 폴더의 파일을 관측해 만든 새 문서는 그 폴더를 가진 프로젝트가 자리고, `document.save`의 첫 저장이 같은 transaction에서 정한다(`packages/documents/versions/commands.ts`의 `observedPlacement`). 자리는 사람이 등록한 폴더에서 왔으므로 임의 기본 자리가 아니다(R3의 금지는 파일이 없는 저장 upload·agent에 남는다). 이름은 제목(관측 때는 파일 이름의 stem)에서 `suggestName`으로 만들고 같은 자리에서 이미 쓰이거나 예약된 이름이면 `-2`, `-3`을 붙인다(addressing#R2: 이름은 같은 자리에서 유일하고 옛 예약은 다른 대상이 쓸 수 없다). 이름 충돌 때문에 관측 save가 막히는 일이 없게 core가 같은 tx에서 정한다(worker가 이름을 정하면 동시 관측이 충돌한다). 호출자가 자리나 이름을 정해 보낸 저장, 지침 파일(`instruction_file`) 문서, 이름을 정하지 못한 경우는 그대로(자리 없음)다. `DocumentCreated` event가 자리와 이름을 담고 이름 예약도 같은 tx에 선다. 이미 자리 없이 만들어진 문서는 바꾸지 않는다(사람이 옮긴다). 자리를 옮기는 일이 원본 연결·경로·추적을 바꾸지 않는 것(addressing#R8)은 그대로다. 시험: `versions/commands_test.ts`, `apps/core/documents-observation_test.ts`(실제 core·worker: 자리·이름·예약·`documents/list`·본문 읽기), flow E2E 네 파일이 사람 command로 문서를 프로젝트에 옮기던 단계를 자리 확인으로 바꿨다. 추천: 이 정함을 requirements(addressing#R3 확인)에도 적었다.
- **Q33 context watch의 제출 근거와 다시 확인(추천으로 진행, documents#T24).** requirements가 정하지 않은 모양을 이렇게 정했다. (1) `context.record_watch_change`의 `base_revision`과 입력의 `context_revision`은 같은 값(core가 읽은 지금 구성의 revision)이어야 하고, 이 revision 비교와 별도로 command가 ledger events에서 구성을 재생해 "저장(source_seq) 당시 watch였고 그 뒤 그 항목의 관점·대상 변경과 보관 상태 변경이 없는" 항목만 받는다(제목·목적 변경은 항목을 건드리지 않아 받는다). 저장 뒤에 추가했거나 제거 뒤 다시 추가한 항목, 보관했다 푼 context는 낡은 결과다. (2) 원래 저장 event(`DocumentSaved`)의 전후 판과 입력이 다르면 invalid_input이다. 변화 기록(`context_watch_changes`)이 이미 있으면 그 뒤 구성이 바뀌어도 같은 결과를 돌려주고 event는 더하지 않는다. (3) 재생 입력은 core의 ledger snapshot read(`document.watch_input`)가 같은 순수 함수(`pendingWatches`)로 가려 coordinator에 보내고, coordinator는 derived의 section으로 비교한 뒤 machine credential로 제출한다. 제출이 수락된 뒤에만 `watch` cursor를 진행하고, 구성 변경과 계속 부딪치면(5번) 미확인으로 남겨 뒤를 막지 않는다. (4) 추출이 아직 없거나 실패한 판, module이 달라 비교 규약을 모르는 판은 `watch_unverified`에 이유와 함께 남는다. 추출이 끝나면(search consumer가 한 번 따라잡은 뒤) 같은 저장 event를 다시 보내 확인하고, 이유가 바뀌지 않은 실패·module 변경은 다시 보내지 않는다. 같은 module로 이전 판을 다시 추출해 비교하는 길은 이 작업이 만들지 않았다(남은 것). (5) 읽을 때 NUL이 잘리는 SQLite 특성 때문에 `watch_unverified`는 target_key와 별도로 `document`·`section` 열을 읽는다. (6) 문서 복원(`DocumentRestored`)도 새 최신 판을 만들므로 저장과 같은 경로로 전후 판을 비교하고 같은 중복키(`after_version`)를 쓴다. requirements 수준의 읽기는 "watch 항목이 바뀌었는가"이고 event 이름은 기준이 아니다(lead 결정). (7) module이 달라 미확인인 비교를 이전 판 재추출로 푸는 일은 T13(derived 재추출)로 넘겼다.
- **Q32 T30 agent 출력 범위와 revert 보상의 documents 쪽 규칙(추천으로 진행).** (1) agent 자격의 `document.save`·`document.update`는 file·app source를 주장하면 forbidden이고, 원본 연결 문서(지침 파일 FileSource 포함)와 보관 문서에는 새 판도 제목 변경도 forbidden이다(범위 밖 대상의 답은 platform 판정 그대로). 등록 locator나 preset 첨부로만 알 수 있는 지침 문서의 분류 검사는 T28이다. (2) revert의 machine `document.archive`는 모든 판을 agent가 남긴 원본 연결 없는 문서만 보관한다(첫 판이 agent가 아니거나 원본 연결이면 forbidden, 이후 다른 주체의 판이 있으면 conflict). 도메인 모델의 "결정 근거"는 입력 field로 두지 않았다(contract에 field가 없다): revert 쪽 사람 결정은 `FinishRevert`/`RevertRun`이 확인하고 documents는 저장된 사실(판의 `saved_by`)과 CAS로만 보상 대상을 좁힌다. machine `document.restore`는 기존 `base_version`·`base_revision` CAS와 원본 연결 근거 규칙을 그대로 쓴다. (3) `document.move`·`document.rename`은 contract 그대로 user만 받고 dispatchable이다. option action 적용은 platform이 `QuestionActionEvidence`를 검증해 같은 transaction의 user 자격으로 dispatch하므로 documents에 machine 전용 handler를 따로 두지 않았다. (4) 해소(lophn-agent#T34, #329): `DOCUMENT_DISPATCHABLE_COMMANDS`에 `document.archive`·`document.restore`를 더했다.
- **Q34 T19 두기·빼기의 순서와 연결 규칙(추천으로 진행, lead가 route 안의 의도로 정함).** (1) 순서 코드는 `file-tracking/placement.ts`(`placeDocumentFile`, `removeDocumentFile`)다. work.ts는 이미 관측 work라 따로 두었다. 파일 쪽(`PlacementFiles`)과 ledger 읽기·command(`PlacementLedger`, `PlacementCommands`)는 port이고, core 조립은 `apps/core/documents-placement.ts`와 `documents-files.ts`다. (2) 새 route 없이 `files.write`의 선택 `place: { document, version }`(새 project 파일, base_hash null, content는 그 판 유일한 파일의 `existing` 원본 참조)와 `files.delete`의 선택 `unlink: { document }`로 부른다. 결과 FileOperationResult에 선택 필드 `placement`(source, tracking, move)·`unlinking`(source, move)가 단계별 결과를 싣는다. 확인 handle 묶음(request_key, target, base_hash)은 그대로다. core는 쓰기·삭제를 기존 coordinator 경로로 하고 연결 단계는 요청 credential의 `runtime.writer.command`로 직접 부른다. 사람 자격에 `document.set_source`·`document.move`·`project.set_tracking` 범위가 없으면 그 단계가 forbidden으로 실패하고 파일은 남는다. 새 내부 read `document.file_placement`(문서·프로젝트·최신 판 파일·연결된 경로·쓸 이름을 문서 접근으로 판정)를 reader Worker에 더했다. (3) 순서는 원본 연결, 추적 규칙, 자리다(처음 정한 규칙, 연결, 자리 순서를 바꿨다). 원본 연결을 먼저 걸면 패턴 밖 경로는 연결된 뒤에야 관측되고, 패턴 안 경로는 아래 (4)로 막는다. 규칙 변경의 폴더 미리보기는 파일을 쓰기 전에 해 두고(그 프로젝트 revision이 그대로면 그 미리보기를 적용, 바뀌었으면 다시 본다): 연결 확정 직후의 미리보기는 coordinator와 겹쳐 간헐적으로 60초 제한까지 끝나지 않았다. (4) 경로 예약: core가 쓰기 전부터 원본 연결이 확정될 때까지(성공·실패 모두 놓는다) 그 경로를 메모리에 잡고, 그 사이 같은 경로를 가리키는 파일 관측의 `document.save`는 writer 앞단(`withPlacementReservation`)에서 conflict다. 관측 loop는 그 후보를 다시 관측하고 그때는 문서가 이미 연결돼 있어 새 문서를 만들지 않는다. 두기 자신의 command는 이 앞단을 거치지 않는다. (5) 두기는 쓰기 전에 읽기만으로 거절할 것(꺼진 tracking, 이미 연결된 문서, 이미 있는 파일, 다른 문서가 쓰는 경로, 범위 밖 경로, 판이 낡음, 참조 위조)을 모두 거른다. 첨부가 있는 판은 첨부를 잃으므로 `invalid_input`이다. 이미 자리가 있는 문서는 move를 건너뛴다. 패턴 밖 경로의 include는 정확히 그 파일 하나이고 `!`로 시작하는 이름은 만들 수 없어 conflict다. `.gitignore`가 가리는 파일은 core가 디스크를 읽지 않아 쓰기 전에 거르지 못하고(`PlacementLedger.gitignore`는 선택), 쓴 뒤 상태에서 추적되지 않음으로 보인다: 이어보냄(coordinator에 .gitignore 사슬 읽기를 더하면 된다). 앞 단계가 실패하면 뒤 단계는 시도하지 않고 파일은 남는다. (6) 빼기는 사람이 확인한 디스크 hash(`base_hash`)가 최신 판 원문과 같고 디스크도 같을 때만 지운다(아니면 409로 파일·연결·자리를 그대로 둔다). 대상 파일이 문서의 원본 연결과 다르면 invalid_input이다. 파일이 이미 없으면 지울 것 없이 연결 해제로 가고 결과 outcome은 `unverified`, 기록·event는 없다. 순서는 삭제, `set_source(null)`, `move(null)`이고 각각 그 순간의 revision이다. (7) `document.set_source`는 `project_file`만 걸고 푼다: 지침 파일 연결은 지침 대상이 정하므로 `invalid_input`, 등록 폴더 밖·`.git` 안·없는 또는 보관된 프로젝트는 같은 `invalid_input`, 보관 문서에 거는 것은 `conflict`(푸는 것은 가능), 다른 문서가 쓰는 경로는 `conflict`다. (8) addressing의 `changePlace`가 `place: null`로 옮기는 move에서 옛 이름을 그대로 가져가 항상 `invalid_input`이던 것을 고쳤다(자리 없음으로 되돌리는 길이 막혀 있었다). T9·T30 시험은 이 경로를 보지 않았다.
- **Q35 앱 출력의 bytes는 어디서 오는가(추천으로 진행, documents#T31).** broker 요청(`/_lophn/broker/documents/save`)과 cap-save에는 본문이 없다: 선언 key·기대 version·재전송 key뿐이라 `DocumentsSave` port가 받는 값만으로는 문서에 넣을 bytes가 없다. hash를 꾸미지 않고 core의 blob 준비를 지나야 하므로 어댑터는 `AppOutputSource` port(`files({app, release, key}) → {path, media_type, bytes, blob_hash, primary, open()}[]`)로 bytes를 받고, 근원 구현은 apps#T19(supervisor 조립)로 넘겼다. 추천: 앱이 저장 전에 자기 `data/files/` 영역의 `outputs/<key>/`에 출력 파일을 쓰고 cap-save는 그 사실을 바꾸지 않는다(문서 하나는 파일 하나 이상, 대표 파일은 `primary`로 정한다). supervisor가 realpath로 앱 data 안임을 검사해 읽는 근원을 구현한다. 대안은 cap-save·broker 계약에 파일 목록을 싣는 것인데 큰 bytes가 broker JSON을 지나므로 추천하지 않는다. 같은 맥락으로 `AppOutputDeclarations`(blueprint documents[]의 name·format·document)도 supervisor가 apps blueprint read로 낸다. documents 쪽은 `documentUpload`에 `app` actor를 더했고(contracts 변경, #330) 앱 자격의 prepare·save·list·upload는 이 PR의 통합 시험이 실제 core로 확인했다.
