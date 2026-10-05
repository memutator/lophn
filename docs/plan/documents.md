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

- 상태: 진행 (#PR_NUMBER) — 한 것: documents worker를 제품 core가 hello(machine credential·api_port)와 함께 띄움(`apps/worker/documents/entry.ts`, launch spec 경로 수정), core→coordinator 요청 통로(FileStatus 조회), 파일 관측 제출 조립(`observation.ts`: 자식 session의 blob 준비(#248) → `document.prepare` → machine `document.save`, 상태 기록), 준비 route의 기준 판 읽기, outline·읽기·search·view open·export worker route를 reader Worker의 snapshot으로 서빙(제품 redactor), 활성 tracking root 변화에서 `connectDocumentsRelaunch`. 남은 것: (1) 관측 loop 시작: coordinator가 machine으로 읽을 tracking 규칙·문서 연결 read가 없어 `readObservationSource`가 err다(Q15, contract). 연결되면 fs port(watch·scan·read)와 제출은 이미 `runCoordinator`에 붙어 있다. (2) 준비 worker spawn과 batch의 준비 worker 요청·응답 protocol(platform#T7 supervisor, 지금 batch는 준비 결과를 받지 않는다). (3) 준비 route의 format 검사: 원문 바이트를 coordinator의 format runner에 보내는 길. (4) `/v1/projects/preview_tracking` 서빙(준비 worker scan 필요, T2에서 넘어온 것). (5) coordinator의 derived store 열기와 search consumer 조립(T13에서 넘어온 것; 파일이 없으면 서빙은 unavailable). (6) ProjectTrackingChanged event 구독(events/list 공개 정책에 등록되기 전이라 root 읽기 주기 확인으로 대신함). (7) redactor의 알려진 secret registry(reader Worker에 없어 pattern 검출만)
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

### T12 사람 파일 쓰기와 working copy

- 등급: 기본
- concern: documents/file-tracking, documents/formats
- 요구: documents/file-tracking#R1, R2, R11, R12, R15, R16, R17, documents/formats#R6
- 자리: packages/documents/file-tracking/ (work.ts 파일 쓰기 알고리즘, `files.*` route, commands.ts `file.record_result`, adapters/ working copy 저장 `~/.lophn/documents/working-copies/<doc>/`)
- 쓰는 contract: platform 인증(user만, machine credential)·command, route kind=file, shell confirmation window(files.delete 근거), 저장 준비 경로(T8), 파일 관측(T11)
- 내놓는 contract: 파일 쓰기(`/v1/files/list`, `/read`, `/status`, `/watch`, `/write`, `/rename`, `/delete`, `/record_result`; FileTarget, FileWriteRequest, FileOperationResult); event `FileWritten`, `FileRenamed`, `FileDeleted`
- slice: documents
- 선행: T8, T11, platform#T12(file·worker 전달 route), platform#T56(confirmation handle), contracts#T13(confirmation window), contracts#T16
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
  - `model_test.ts`, `reads_test.ts`, `versions/commands_test.ts`에 각 요구 번호 테스트

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
- 내놓는 contract: `document.set_source`, 두기·빼기 요청(파일 쓰기 contract 안의 동작); event `DocumentSourceChanged`
- slice: documents
- 선행: T9, T10, T12, platform#T56
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

- 등급: 기본
- concern: documents
- 요구: 없음 (flow 시나리오: first-project, project-workspace, edit-document, find-documents, organize-documents, restore-document, write-series)
- 자리: e2e/flows/<flow>_test.ts
- 쓰는 contract: shell 화면, fake provider 없음(model 없는 갈래만)
- 내놓는 contract: 없음
- slice: documents
- 선행: T11–T20, contracts#T10(E2E harness), shell#T9, T13–T20, T22, T23(첫 창, layout, project-workspace, launcher 등록·미리보기, document 편집기·저장·이력, documents 화면, projects 화면, 파일 지우기 확인)
- 완료:
  - first-project 1~8과 다른 갈래(겹침 거절, 접근 상실, format 검사 실패, 미지원 형식)
  - project-workspace의 문서 단계(1, 2, 7과 저장 실패 갈래). 터미널·앱 패널 단계는 shell·apps slice
  - edit-document 1~8과 다른 갈래(바깥 수정 충돌, 503, 검사 실패)
  - find-documents 1~4, 7과 사람 갈래. 5~6(agent·coding agent 읽기)은 agent slice E2E(lead 결정 Q4)
  - organize-documents 1, 4~7과 사람 직접 이동 갈래. 2~3(lophn 역할 추천·question)은 agent slice E2E(lead 결정 Q4)
  - restore-document 1~6과 다른 갈래, write-series 1~7과 다른 갈래
  - `deno task e2e`에서 위 시나리오가 통과

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
  - `commands_test.ts`, `reads_test.ts`에 각 요구 번호 테스트

### T23 context outline

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
  - `commands_test.ts`, `reads_test.ts`에 각 요구 번호 테스트(정의 35개를 30개·5개로)

### T26 context export

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
- 완료:
  - 전역 `~/.lophn/LOPHN.md`·project·app LOPHN.md·preset 첨부 지침은 exact 등록 파일만 관측(data root 재귀 tracking·부모 순회·cwd 추측 없음), owner·실제 열린 파일·symlink·UTF-8·hash 검사
  - 최초 생성은 미존재 CAS, 저장·복원은 base_hash와 base_version CAS 뒤 재관측으로 새 판. 파일이 없으면 첫 저장 전에는 version 없음, agent가 빈 파일을 만들지 않음
  - 지침 문서는 agent·coding agent·app의 create·save·제목·move·source 변경이 forbidden(다른 출력으로 지정해도). agent는 question 제안만
  - 전역 지침은 place·name null의 instruction_file source, Project·system place 자동 생성 없음. LOPHN.md와 AGENTS.md 구별
  - `*_test.ts`에 각 요구 번호 테스트

### T29 설치 안내 읽기

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

- 등급: 기본
- concern: documents/addressing, documents/versions, documents/series
- 요구: documents/versions#R14, documents/addressing#R2, documents/series#R1
- 자리: packages/documents/addressing/ (place kind app 해석, 자리 이름 예약 port 구현을 apps/registration에 주입), packages/documents/versions/ (app 자격 저장 범위), packages/documents/outline-and-search/ (앱 자리 목록은 apps/blueprint의 읽을 구조를 가리킴)
- 쓰는 contract: apps registration read(App 존재·status·slug), apps blueprint read(선언 출력 문서 이름)
- 내놓는 contract: 자리 이름 예약 port의 구현(T5에서 모양을 냄)
- slice: apps
- 선행: T9, T17, contracts#T20, contracts#T33, apps#T1(app 생성의 이름 예약), apps#T13(앱 broker), apps#T14(cap-save)
- 완료:
  - 앱은 자기 앱 자리의 선언된 출력 이름(blueprint documents[].key)만 저장. save는 (앱 자리, key)로 대상을 찾아 첫 저장이면 만들고 그 뒤에는 같은 Document의 새 판(base_version CAS), VersionSource kind=app{app, release}. 앱 결과는 고정 판으로 다시 연다
  - project 이름을 앱이 쓰면 conflict(같은 transaction 예약), 앱 이름 변경 뒤 옛 address 안내
  - 허용된 앱의 series 등록·멤버 저장
  - `*_test.ts`에 각 요구 번호 테스트, apps 팀 registration 테스트와 함께 이름 공간 통합 테스트

## slice: operator

### T32 Operator 출력 범위

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
- **Q15 T11 coordinator가 machine으로 읽을 tracking 규칙·문서 연결.** 미정. 지금 machine이 읽는 `project.tracking_roots`는 root 경로와 project revision뿐이라 tracking 규칙(patterns·use_gitignore)과, 경로에 연결된 문서의 ID·revision·최신 판(관측 근거 FileObservationBasis의 재료)을 알 수 없다. machine ceiling은 command kind 정책만 허용하므로 read를 더 얹을 수도 없다. 추천: `project.tracking_roots` 출력에 규칙을 더하고, 경로→문서 연결을 machine이 읽는 route를 contracts에 추가한다(contracts·platform 변경이라 lead가 정한다).
