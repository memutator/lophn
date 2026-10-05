---
type: architecture
concerns: [documents]
---
# documents

## 1. 맡는 것과 맡지 않는 것

사람이 쓰는 글의 고정 Version을 준비하고, 필요한 부분을 적은 양으로 찾고 읽게 한다. Project·Document·Version·Series·Context·Term과 saved view의 ledger command·read 모듈은 이 concern의 코드이며 core 안에 배치한다. 원문 읽기·hash·format 검사·section 추출·diff·검색은 core 밖에서 한다. 파일 바이트 저장, 파일 작업 기록, Version 확정, 검색 반영은 네 개의 별도 완료다.

- 자동 추적은 사람이 켠 Project 폴더에만 적용한다. 앱 source, 기본 notes Project, `_inbox`·`_system` 같은 place를 자동으로 만들지 않는다.
- 사람의 shell만 현재 원본 파일 통로를 쓴다. agent·coding agent·앱은 허용된 고정 Version을 읽고 원본 연결 없는 문서 내용을 저장한다. coding agent가 자기 외부 편집기로 파일을 고치는 것은 이 통로 밖의 일이다.
- format은 결정적인 검사·추출 코드다. 문서 자체의 background 동작·HTML 스크립트 run을 제공하지 않는다. lophn 배포 안내는 설치 묶음의 `guides/`에 고정 manifest(version·title·content hash)와 읽기 전용 문서로 두고 coordinator가 기존 outline·section 읽기 코드로 제공한다; 사용자 Document·system place·tracking을 자동 생성하지 않으며 복사본만 일반 문서 저장 contract로 남긴다.
- Context는 자료의 소유자가 아니라 기준 / 참고 / watch의 관점이다. section은 같은 key만 이어지고 유사한 제목·본문으로 대상을 바꾸지 않는다.
- ledger writer, transport, credential·scope·secret·redaction·blob GC·backup은 platform이 소유한다. 이 파일은 그 contract를 사용한다.
- 편집 화면·충돌 화면·confirmation window는 shell, model 요약 생성과 prompt 조립은 lophn-agent, 앱 command·DB·source는 apps 및 coding-agent가 맡는다. 문서 worker는 앱 DB를 읽거나 앱 read command를 대신 호출하지 않는다.
- `ContextWatchedItemChanged`만 내고 notification은 platform의 notification contract가 만든다. 문서 변화·index 완료·watch 변화로 agent run을 시작하지 않는다.

## 2. 프로세스

### 2.1 구성과 수명

문서 영역의 상시 프로세스는 coordinator 하나와 준비 worker 두 개다. core가 coordinator를 띄우고 종료·crash를 감독한다. coordinator가 정확한 실행 파일로 준비 worker 두 개를 띄우고 작업별 format runner를 시작한다. 준비 worker가 죽으면 그 slot을 새 프로세스로 채운다. format runner는 호출마다 시작하고 한 결과를 낸 뒤 종료한다. format 동시 run은 최대 두 개다. core·shell은 다른 concern의 프로세스이며 문서 프로세스 수에 포함하지 않는다.

```text
shell main / agent runtime / MCP·CLI / 앱
   │ platform API (원래 credential, 작은 JSON + 내용 참조)
   ▼
core
   ├ documents/* command·read 모듈 ── 유일한 writer ── ~/.lophn/lophn.db
   ├ platform read·인증·blob·event 구독 contract
   └ 비동기 dispatch ── stdio framed IPC ── documents coordinator (1)
                                           ├ Deno.watchFs / scan cursor / 폴더별 공정 큐
                                           ├ derived writer·read / search·watch consumer
                                           ├ framed IPC ── 준비 worker (2)
                                           │                  └ scan·stream hash·파일 교체·diff
                                           └ framed IPC ── format runner (호출마다, 최대 2)
                                                             └ QuickJS WASM 새 guest context
원본 Project 파일 / doc별 working copy       blob contract       derived/documents.sqlite
```

coordinator는 API 서버를 따로 열지 않는다. HTTP 요청의 작은 입력은 core가 비동기 IPC로 넘긴다. 결과를 기다리는 동안 core command queue나 JS 실행 흐름을 점유하지 않는다. stdio는 `request_id, operation, input_ref, basis`의 길이 prefix frame과 제한된 chunk frame을 쓴다. stderr는 diagnostics용이며 본문·token은 출력하지 않는다. IPC 종료는 진행 요청의 결과 불명 또는 이용 불가이지 성공이 아니다.

worker가 쓰는 platform contract 호출은 coordinator가 중계한다. 원래 요청의 actor·run·scope와 대상·내용 참조를 인증된 요청 근거에 결합하여 전달한다. 자동 file 관측과 `file.record_result`, `context.record_watch_change`에만 좁은 machine credential을 쓴다. format guest에는 credential·확인 handle·원본 절대 경로를 전달하지 않는다. worker가 직접 `lophn.db`를 열지 않는다.

### 2.2 실제 권한

- coordinator의 Deno 권한은 등록한 활성 루트와 `~/.lophn/documents/`, `~/.lophn/derived/`의 필요한 `--allow-read`, derived 및 작업 staging의 `--allow-write`, 고정 worker·runner 실행 파일의 `--allow-run`만 준다. `--allow-net`, `--allow-env`, `--allow-ffi`는 주지 않고 `--no-prompt`로 시작한다. core 통신은 상속한 stdio다. 루트 추가·해제 때 core가 새 권한 목록으로 문서 프로세스를 교체하고 재scan한다.
- 준비 worker에는 현재 루트·working copy·staging의 `--allow-read`와 파일 작업에 필요한 경로의 `--allow-write`만 준다. network·env·subprocess·FFI 권한은 없다. 이 프로세스는 신뢰한 플랫폼 코드만 실행하며 사람이 선택한 목표인지 요청마다 별도로 검사한다. Deno 경로 권한은 사용자 자격 검사의 대체가 아니다.
- format runner는 Deno 기반 고정 host 실행 파일과 내장 QuickJS WASM을 묶어 배포한다. 호출 입력과 module 바이트를 IPC로 받으므로 파일·network·env·subprocess·FFI 권한을 전부 주지 않는다. guest module을 Deno에 직접 import하거나 Deno Worker 전역에서 실행하지 않는다.
- QuickJS guest에는 JSON·문자열·배열·순수 계산만 제공한다. `Date`, 시간 API, `Math.random`, crypto 난수, `eval`, `Function`, 동적 import, host object·WASM·FFI 접근을 설치하지 않는다. 정적 module loader는 요청의 정확한 묶음 안 module만 로드한다. guest에는 바이트 입력을 복사해 주고 출력 JSON만 받는다. Deno의 시간·난수를 지우는 것만으로 격리가 됐다고 하지 않는다.
- host가 QuickJS memory limit와 interrupt handler를 설정하고, coordinator는 별도 deadline에서 runner를 강제 종료한다. 초기 구현값은 guest memory 64 MiB, 호출 5초, 입력 16 MiB, 출력 8 MiB다. runner 프로세스의 최대 heap도 제한하며 crash·한도 초과는 그 호출의 `unavailable`이다. 이 값은 구현 조절값이지 문서 원문 전체 크기의 domain 제한이 아니다. 검사에 필요한 입력이 한도를 넘으면 미지원처럼 꾸미지 않는다.
- 내장 format만 시작한다. 사용 가능해지기 전에 고정 fixture 전부와 파일·network·시간·난수·동적 코드 우회 테스트를 통과해야 한다. module hash에는 코드·의존·추출 규칙·guest 실행 규약을 포함한다. 규약 변경을 같은 module hash 아래 덮어쓰지 않는다.

### 2.3 watch·scan·작업 배분

coordinator가 등록 루트별 `Deno.watchFs(root, {recursive: true})`를 연다. OS의 rename/remove/create 신호는 힌트로 보존하고 canonical 경로별 후보를 합친다. 이름 변경은 옛 경로 부재와 새 경로 존재를 따로 관측한다. 삭제 후 재생성을 단순 수정으로 합치지 않으며 내용이 같다고 source를 자동 재연결하지 않는다.

각 루트에 iterator와 후보 큐를 두고 round-robin으로 최대 128개 directory entry씩 준비 worker에 넘긴다. `.git`·lophn 데이터·루트 밖 symlink는 순회와 최종 열린 파일 검사에서 모두 제외한다. include/exclude는 `/` 상대 경로에 순서대로 적용해 마지막 일치를 쓰고 미일치는 제외한다. glob은 정확한 dependency로 고정한 picomatch, `.gitignore`는 ignore 라이브러리를 쓰며 루트 아래 중첩 `.gitignore`도 상대 경로대로 적용한다. OS locale로 glob 결과를 바꾸지 않는다.

시작, 절전 복귀, watch 넘침·단절, Project 규칙·폴더 변경, 보관 해제에는 전체 루트 대조를 예약한다. 평상시에는 60초마다 각 루트의 다음 scan을 예약하되 이전 scan이 끝나지 않았으면 하나로 합친다. size·mtime는 우선순위 힌트일 뿐 주기 대조에서 hash를 영원히 생략하지 않는다. 후보가 루트당 10,000개를 넘으면 개별 후보 대신 `rescan_required` 한 값을 남긴다. 큐·scan 위치·편집 표시·FileStatus는 worker 메모리이며 ledger queue를 만들지 않는다.

한 경로에는 준비·제출 하나만 진행한다. 진행 중 신호는 다음 관측 표시로 남긴다. 외부 변화는 750ms 동안 새 신호가 없을 때 관측하고, 안정 읽기는 최대 3회 재시도한다. 열기 전·후의 실제 경로·file identity·size·mtime를 비교하고 같은 읽기 stream을 hash와 blob staging으로 보낸다. 안정성을 확인하지 못하면 `unverified`로 두고 다른 파일을 진행한다. 관측하지 못한 중간 편집까지 보존한다고 하지 않는다.

준비 worker 두 slot 중 한 slot은 사람이 요청한 파일 읽기·저장, 선택 판 읽기·diff를 먼저 받고 다른 slot은 background scan·index를 진행한다. 사람이 기다리지 않으면 두 slot 모두 background에 사용한다. 요청마다 바이트·시간 예산을 두고 chunk 사이 양보한다. 신뢰한 worker code라도 큰 순회·hash·diff를 coordinator의 실행 흐름에 동기식으로 올리지 않는다. 결과 command 제출은 동시에 두 개까지만 진행하고 platform command의 접수 제한에 맞춰 늦춘다.

## 3. 저장

### 3.1 정본과 파일 위치

| 위치 | 내용 | owner·쓰기 규칙 |
|---|---|---|
| `~/.lophn/lophn.db` | 아래 documents ledger 표, 공통 events·command 결과 | core의 해당 documents 모듈만 도메인 표를 변경; 실제 writer는 platform command 하나 |
| 사람이 고른 Project 루트 | 현재 원본 파일 | 사람 파일 통로 또는 외부 편집기; ledger와 별도 생애 |
| `~/.lophn/documents/working-copies/<doc>/` | 대표 파일·첨부, 미확정 편집, 연 판·module 근거의 작은 작업 metadata | 원본 없는 문서의 사람 편집; 자동 tracking·derived GC 대상 아님 |
| `~/.lophn/documents/staging/` | 준비 stream·업로드·format 입력의 임시 파일 | 준비 worker; 미완료 staging은 재시작 때 정리, 확정 blob은 직접 삭제하지 않음 |
| platform blob store | 원문 파일, 정규화 ContentFile 목록, 큰 diagnostics, 정확한 format 묶음, Series draft 입력 | blob contract로 내구 설치·참조 등록; 문서 worker가 내부 경로를 직접 읽거나 쓰지 않음 |
| `~/.lophn/derived/documents.sqlite` | outline·section·text·FTS5·summary·search/watch cursor·실패 | coordinator의 유일한 derived writer, 별도 read 연결; 삭제·재생성 가능 |
| `~/.lophn/derived/documents.rebuild.sqlite` | 재생성 중 완성본 후보 | 완성·따라잡기 뒤 읽기 연결을 닫고 교체; 정본 아님 |
| OS keychain·앱 DB | 이 concern의 데이터 없음 | secret은 받지 않으며 앱 DB를 검색용으로 복사하지 않음 |

working copy는 선택한 Version의 원문 바이트로 처음 만들고 그 이후 편집을 보존한다. 자동으로 최신 판을 다시 덮어쓰지 않는다. 새로운 최신 판과의 충돌이면 working copy를 남긴 채 새 기준을 사람에게 보여 준다. Project 원본의 경로·현재 연결 문서 대응은 `documents.source_path` 하나가 기준이며 file 목록·scan·편집이 같은 read를 사용한다.

| core 모듈 | ledger 표 |
|---|---|
| `documents/projects` | `projects`, `project_folders`, `project_tracking_patterns` |
| `documents/versions` | `documents`, `versions` |
| `documents/addressing` | `place_names`, `document_names` |
| `documents/series` | `series`, `series_instances`, `series_keys` |
| `documents/contexts` | `contexts`, `context_items`, `context_watch_changes` |
| `documents/terms` | `terms`, `term_evidence` |
| `documents/outline-and-search` | `saved_views` |

`files.*`는 ledger transaction이 아니다. `file.record_result`가 공통 `events`에 `FileWritten`, `FileRenamed`, `FileDeleted`를 남기고 공통 command 결과로 중복을 막는다. 별도 파일 상태·관측 후보·PreparedVersion 표는 없다. format 선언 역시 ledger entity가 아니며 Version이 참조하는 정확한 묶음은 blob 참조로 보존한다.

ContentFile은 상대 경로의 Unicode codepoint 순으로 정렬하고 `path, blob_hash, bytes, media_type, primary` 고정 필드 순서의 JSON 배열을 UTF-8로 encode한다. 공백·추가 필드 없이 같은 canonical encoder를 준비와 검증에 쓴다. `files_hash`는 이 목록 blob, `content_hash`는 같은 정규화 목록 바이트의 SHA-256이다. 원본 파일의 `original_hash`는 실제 원문 stream hash이며 목록 hash와 다르다. 원문을 LF·NFC 텍스트로 바꿔 blob에 저장하지 않는다.

### 3.2 derived store

| 표 | 내용·갱신 단위 |
|---|---|
| `derived_versions` | 고정 ver·content_hash·module_hash·추출 상태·실패 이유 |
| `derived_sections` | `(version, key)`별 트리·own_ranges·subtree_range·body_hash·길이·자식 수 |
| `derived_texts` | 정규화 대표 텍스트·text_hash·UTF-8 line offset; 원문 대신 derived 안에 둠 |
| `search_documents` | 문서별 마지막 반영 ver 하나, 현재 목록 metadata·상태·saved_seq |
| `search_rows` | 해당 반영 ver의 section 제목·자체 본문·범위; section 없는 텍스트는 null key 한 행 |
| `search_fts` | external content `search_rows`, `title, body`, FTS5 `tokenize='trigram'` |
| `summary_cache` | 입력 ver·section·input_hash가 있는 가용 요약; 없으면 원문 서문 200 codepoint 발췌 |
| `derived_cursors` | `search`, `watch` 각각의 processed_seq·rebuilding·rebuild_basis_seq |
| `watch_unverified` | context·target·전후 ver·source_seq·context_revision·미확인 이유 |

한 event의 해당 consumer 결과와 cursor는 한 derived SQLite transaction에 쓴다. search 행 교체와 FTS delete/insert도 같은 transaction이다. cursor는 필터로 생략한 event까지 읽어 지나간 위치를 사용하며 seq를 연속 정수로 가정하지 않는다. search 실패를 기록하고 cursor를 진행할 수 있지만 `omissions`를 반드시 반환한다. watch의 confirmed command가 수락되기 전에는 해당 event를 처리 완료로 표시하지 않는다.

목록은 ledger read로 고정한 작은 metadata와 derived 통계를 조립하며 본문을 같이 싣지 않는다. API의 판·주체·format·hash·관측·index 정보는 내부 contract다. 사람 화면의 기본 노출은 documents/file-tracking#R9,R15·documents/versions#R9·documents/outline-and-search#R2~R4,R14와 shell/wording을 따른다. 지금 필요한 결과·다음 행동만 표시하고 기록·판 비교·처리 상세는 펼쳐 본다; 안쪽 개념 라벨을 그대로 노출하지 않으며 고정 화면 문구는 en message key로 전달한다. 관련 목록의 무효화·메모리 cache 재파생은 500ms 동안 합친다. 이동은 출발·도착 place와 관련 Context 둘 다 갱신하고 대상 불명 event는 전체 목록 cache를 무효화한다. 요약의 입력 판이 선택 판과 다르면 `stale`이다. cache를 채우려고 model call이나 agent run을 예약하지 않는다.

pagination은 coordinator 메모리의 제한된 page basis에 `basis_seq, query_hash, sort, scope_basis, 선택 ver 목록`을 묶는다. opaque cursor는 그 basis와 다음 위치를 가리킨다. 본문 cursor는 `ver, module_hash, section, include_children, 줄 위치, 줄 안 codepoint 위치`를 함께 가진다. 긴 한 줄도 12,000 codepoint씩 나누며 이어 읽기에서 겹침·누락이 없다. 다른 판·조건·범위의 cursor는 `invalid_input`, basis 만료·worker 재시작·안정 기준 유지 불가는 `conflict`다. 매 페이지 현재 scope를 다시 검사한다.

derived DB 삭제·손상 시 ledger 기준 seq S의 일관된 read snapshot으로 rebuild 파일을 만든다. S의 문서·최신 판·구성과 정확한 module을 추출한 뒤 S 다음 event를 따라잡는다. snapshot이 만료되면 새 기준으로 다시 시작한다. 살아 있는 기존 파일이 있으면 그것을 계속 읽고 `rebuilding=true`를 표시한다. 없으면 원문·선택 판 직접 추출은 제공하고 search에는 미반영을 표시한다. 완성 파일 교체는 writer와 read 연결·WAL을 안전하게 닫은 뒤 한다. derived 삭제로 Document·Version·saved view·Series·확정 watch event는 변하지 않는다. summary cache 삭제 뒤 같은 model 요약이 재현된다고 약속하지 않는다.

watch rebuild는 search와 별개다. 확인된 변화는 ledger의 `context_watch_changes` 중복 근거를 유지하고, 필요한 `DocumentSaved` 구간을 다시 읽어 미확인 비교를 복구한다. Context 구성은 event의 작은 before·after 또는 blob 참조를 source_seq까지 재생해 얻는다. 지금 새로 추가된 항목을 과거 watch 대상으로 삼지 않는다.

## 4. concern 배치표

| concern | 프로세스 | 모듈 | 저장 | 주로 쓰는 contract |
|---|---|---|---|---|
| documents/projects | core + coordinator·준비 worker | `documents/projects`, `tracking-rules`, `scan` | projects·folders·patterns, 메모리 scan | command·read·event 구독, 파일 준비 결과 |
| documents/file-tracking | coordinator·준비 worker + core 결과 handler | `documents/observation`, `files`, `preparation` | 원본·working copy·staging; 공통 events | 파일 쓰기·파일 준비 결과, 인증·blob·command |
| documents/versions | core + 준비 worker | `documents/versions`, `preparation` | documents·versions·원문/목록 blob | 파일 준비 결과, command·read·blob |
| documents/formats | format runner + coordinator host | `documents/formats`, `format-runner` | 정확한 module blob·fixture | format 실행·blob |
| documents/outline-and-search | coordinator·준비 worker + core view handler | `documents/outline-and-search`, `derived`, `read`, `views`, `diff` | documents.sqlite 9개 표, saved_views | outline·search 읽기, read·event 구독·redaction |
| documents/series | core read·command + 준비 worker | `documents/series`, `series-order`, `series-next` | series·instances·keys·draft blob | outline·search 읽기, read·command·format 실행 |
| documents/addressing | core + coordinator section lookup | `documents/addressing` | place_names·document_names | read·command, outline·search 읽기 |
| documents/contexts | core + coordinator·준비 worker | `documents/contexts`, `watch`, `section-comparison` | contexts·items·watch_changes; derived watch cursor·미확인 | outline·search 읽기, read·event 구독·command |
| documents/terms | core + coordinator glossary read | `documents/terms`, `glossary` | terms·term_evidence | command·read, outline·search 읽기 |

leaf concern은 9개이며 빠진 leaf는 없다. `documents/contracts`는 위 네 소유 contract의 schema·결과 검사를 모으고 테스트는 각 모듈 옆에 둔다. 다른 concern의 표를 직접 조회하는 repository를 worker에 넣지 않는다.

## 5. 내놓는 contract

모든 RPC는 `POST /v1/<resource>/<method>`다. 공통 envelope·HTTP error mapping·인증·큰 내용 전송은 platform의 API·인증·blob contract를 따른다. 다음 표는 documents가 소유하는 실제 경로와 동작이다. 큰 바이트는 blob contract의 준비 참조로 받은 뒤 worker에서 stream으로 읽고, JSON에 본문 전체를 중복 싣지 않는다. 파일 쓰기는 JSON RPC를 받더라도 ledger command queue로 보내지 않는다.

### 5.1 파일 준비 결과

| 경로 | 동작 |
|---|---|
| `/v1/documents/prepare` | 저장 입력·기준을 blob과 FormatValidationResult로 준비; 아직 Version 없음 |
| `/v1/documents/save` | 동일 준비 경로 뒤 `document.save`; PreparedVersion만 받은 내부 제출도 이 handler가 검증 |
| `/v1/documents/restore` | 선택 고정 판을 준비하고 `document.restore`; 원본 연결이면 사람 파일 쓰기·관측 근거 필수 |
| `/v1/projects/preview_tracking` | 정확한 폴더·규칙·base_revision의 TrackingPreview; page 단위 반환 |

**입력.** 원래 credential, 기존 `doc`·`base_version` 또는 신규 예정 `doc`·metadata, 파일 목록·대표 파일·내용 참조, FormatRef와 idempotency key를 받는다. 파일 관측은 `project, project_revision, path, document_revision, file_source, active, original_hash, observed_at`의 FileObservationBasis도 필수다. 신규 path의 연결 문서 미존재를 비교한다. app·release·run·actor는 인증된 근거로 확인하며 본문 주장으로 받지 않는다.

**처리.** 준비 worker는 안전한 상대 경로·유일 경로·대표 파일 하나·바이트 수를 검사하고 같은 stream을 hash와 blob staging에 넣는다. 내구 blob 완료, canonical 목록, 정확한 format 검사를 끝낸 후 `files_hash, file_count, primary_path, content_hash, format, validation, preparation_ref`를 낸다. `preparation_ref`는 신뢰한 worker의 결과와 원래 요청·기준·blob을 묶은 작은 참조다. core는 이 참조와 작은 CAS만 검사하고 큰 목록을 다시 읽거나 hash하지 않는다.

기존 문서의 FormatRef는 base_version의 정확한 계약이다. 최신 판이 달라지면 거절하고 다시 준비한다. 허용된 사람의 명시 format 변경만 새 판의 계약을 바꾼다. Operator는 기존 assignment 출력 Document에 새 Version만 쓰며 새 Document·place·format을 만들지 않는다. 원본 연결 문서는 관측 아닌 직접 저장에 `conflict`를 반환한다. 명시 restore는 선택 판의 바이트와 정확한 FormatRef를 준비하며 최신 base_version·base_revision은 그대로 CAS한다; 원본 연결이면 사람 파일 쓰기 뒤 그 바이트의 관측 근거로만 확정한다.

**출력.** prepare는 PreparedVersion, save는 `saved | unchanged`, doc·ver·고정 reference·event_seq·warnings의 SaveResult다. 최신 content_hash와 FormatRef의 name·module_hash·explicit가 전부 같으면 기존 판을 반환하고 변경 event는 없다. 첫 저장은 Document와 Version을 같은 transaction에 만든다. 새 판은 `DocumentSaved`, 첫 문서는 `DocumentCreated`, restore는 `DocumentRestored`를 함께 낸다.

**오류.** `invalid_input`은 위험 경로·잘못된 목록·지정 format error, `conflict`는 base_version·규칙·연결·revision·보관 상태 변경, `unauthorized | forbidden`은 자격·run·출력 범위 위반, `unavailable`은 안정 읽기·blob 내구 저장·필수 format 실행 실패다. 미지정 새 문서의 구조 error만 warning으로 낮추고 원문을 보존한다. 접근·안전·module run 실패는 warning으로 낮추지 않는다.

**보장.** hash한 원문과 blob 바이트가 같다. 기준이 달라지면 늦은 결과가 덮지 않는다. 동일 재전달은 같은 key·신규 doc ID를 사용한다. 원래 actor를 machine 준비 자격으로 바꾸지 않는다.

**보장하지 않는 것.** 준비 바이트가 제출 시점의 최신 디스크라는 것, 모든 중간 편집 복원, 파일·ledger 원자성, outline·검색 완료는 보장하지 않는다.

### 5.2 파일 쓰기

| 경로 | 실제 동작 |
|---|---|
| `/v1/files/list`, `/v1/files/read`, `/v1/files/status` | 사람의 허용 FileTarget 목록·현재 바이트/base_hash·관측 FileStatus |
| `/v1/files/watch` | shell 편집 연결의 현재 변화 상태; 원본 접근은 user만 |
| `/v1/files/write` | `files.write`; FileWriteRequest의 stream을 수정 전 hash 비교 후 교체 |
| `/v1/files/rename` | `files.rename`; base_hash·기존 경로·새 목표 미존재 검사 |
| `/v1/files/delete` | `files.delete`; base_hash와 필요한 confirmation 근거 검사 |
| `/v1/files/record_result` | 내부 machine의 `file.record_result`; 원래 user 요청에 결합한 성공 결과만 기록 |

**입력.** 인증된 user·`request_key`, project_file 또는 working_copy의 FileTarget, 기존이면 base_hash·신규면 null, 새 바이트의 준비 참조, version을 원하면 base_version·format 등 준비 입력을 받는다. 임의 경로·일반 파일 아닌 대상·루트 밖 symlink·원본 연결 문서에 잘못 지정한 working copy는 거절한다.

**쓰기 알고리즘.** 같은 canonical 목표의 lophn 내부 작업을 직렬화한다. 시작에 실제 파일 hash와 base_hash를 대조하고, 같은 디렉터리에 임시 파일을 exclusive-create하여 stream을 쓴다. 파일을 sync한 뒤 교체 직전에 경계·file identity·hash를 재검사한다. 기존 파일은 같은 파일 시스템의 atomic rename/replace를 쓰고 새 파일은 임시 파일의 hard link 등 no-replace 설치를 사용한다. no-replace 또는 원자 교체를 지원하지 않는 파일 시스템에서는 실패시키고 truncation·복사 덮어쓰기로 대체하지 않는다. 가능한 OS에서는 부모 디렉터리도 sync한다. rename은 새 목표 no-replace, delete는 목표를 다시 확인한 뒤 수행한다.

**출력.** FileOperationResult는 `written | renamed | deleted | unverified`, 전후 경로·hash, 작업 뒤 관측 시각/hash·`changed_again`, `recorded | unverified`, 그리고 `not_requested | preparing | validation_failed | conflict | confirmed`의 version_result를 따로 반환한다. 후속 결과는 같은 request_key로 연결하되 worker 재시작 뒤 조회 가능성을 보장하지 않는다. 파일 성공 응답을 먼저 줄 수 있고 검색 반영은 IndexCoverage로 따로 조회한다. file 결과의 event actor는 machine이며 원래 user 요청 근거를 유지한다.

**오류.** base_hash 불일치·새 목표 존재는 `conflict`·HTTP 409, 디스크 권한·read-only·용량·quota·안전한 원자 교체 불가는 `unavailable`·HTTP 503이다. 잘못된 목표는 `invalid_input`, user가 아닌 요청은 `forbidden`이다. 경로·hash·안전한 OS 오류만 log·감사 payload에 넣고 편집 본문은 넣지 않는다.

**보장.** 시작과 교체 직전에 hash를 비교하고 확인된 충돌에는 쓰지 않는다. 성공한 각 작업을 `file.record_result`로 보고하여 `FileWritten`, `FileRenamed`, `FileDeleted`를 남긴다. 같은 편집 세션의 두 작업도 두 결과다. 자동 저장은 파일 쓰기만이고 명시 저장·편집 종료가 version 준비 경계다.

**보장하지 않는 것.** 외부 편집기와 공동 잠금, 마지막 비교와 교체 사이 외부 쓰기 차단, 파일·ledger 단일 transaction은 없다. 교체 뒤 재관측으로 다시 바뀜을 표시한다. 응답 유실·결과 불명에 자동 재쓰기하지 않는다. 이미 성공한 파일 바이트를 format 실패 때문에 이전 내용으로 바꾸지 않는다.

새 파일로 문서를 두기는 최신 고정 판의 바이트를 no-replace로 쓴 뒤 `project.set_tracking`의 정확한 include, `document.move`, `document.set_source`를 각각 현재 CAS로 확정한다. tracking이 꺼진 Project는 허용하지 않는다. 파일 성공 뒤 연결 확정 실패는 파일을 남기고 별도로 표시한다. 자리 없음으로 돌아가며 파일을 지우는 요청은 디스크 hash가 최신 Version의 원문과 같은 경우에만 삭제한다. place 이동만으로 파일을 이동하거나 source를 바꾸지 않는다.

### 5.3 format 실행

| 경로 | 동작 |
|---|---|
| `/v1/formats/list`, `/v1/formats/get` | 내장 declaration, MIME·구조·metadata 요구·template·guide·examples·vocabulary |
| `/v1/formats/validate` | 고정 module의 validate; 저장이나 변경 event 없음 |
| `/v1/formats/extract` | 신뢰한 문서 처리의 고정 module extract; derived 결과, Version 없음 |

**입력.** 정확한 module_hash, validate/extract operation, 실제 파일 목록·대표 바이트와 input_hash, 명시 여부를 받는다. 기존 Version은 이름으로 최신 module을 찾지 않는다. 내장 document는 `text/markdown`, `text/x-markdown`, `text/html`, `application/xhtml+xml`, `text/plain`; pdf는 `application/pdf`, image는 `image/*`, data는 나머지 원문을 받는다. plain text는 heading을 만들지 않고 텍스트 읽기·검색만 한다. pdf·image·data는 첫 구현에서 section 추출이 `unsupported`다.

**출력.** validate는 input_hash·module_hash·passed/failed·error/warning diagnostics와 파일·줄·열 위치를 반환한다. extract는 `ready | unsupported | unverified | failed`, 대표 텍스트·title·section key·parent·position·level·anchor·own_ranges·subtree_range·characters·body_hash를 반환한다. host는 출력 크기·key 유일성·범위·부모 존재·비순환을 다시 검사한다. ready의 빈 sections와 unsupported를 구별한다.

document module 자체가 UTF-8 decode → BOM 제거 → LF → NFC를 적용하고 Markdown ATX·setext, YAML front matter·fenced code·HTML pre 제외, HTML 원본 h1~h6와 hidden 구역 제외를 구현한다. 유일한 h1은 title로 빼고 서문은 `_preamble`이다. 명시 anchor 우선·자동 slug·같은 부모 suffix·전체 경로 key·heading 제외 본문 hash 규약을 이 묶음 한 곳에 둔다. 문서 읽기·watch·diff가 같은 규약을 중복 구현하지 않는다. 초기 document body_hash는 own_ranges의 heading 제외 본문을 LF로 연결하여 hash한다. 자식 변화는 자식 section 또는 문서 전체 watch로 읽는다.

**오류.** 잘못된 입력·지정 format 구조 error는 `invalid_input`, 정확한 module 누락·runner 종료·한도 초과·출력 계약 위반은 `unavailable`과 안전한 이유다. 추출 실패는 원문 읽기를 막지 않고 `unverified` section 상태와 원문 참조를 제공한다.

**보장.** 2.2의 새 guest·권한 없음·fixture·출력 검사를 통과한 같은 module·바이트는 같은 정규화 결과다. module은 Version·Series draft 참조가 남는 동안 blob contract로 보존한다.

**보장하지 않는 것.** 내용의 진실성·같은 key의 영구적 의미·HTML 동적 DOM 구조·미지원 format의 가짜 section·누락 module의 새 module 대체는 보장하지 않는다.

### 5.4 outline·search 읽기

| 경로 | 입력 → 출력 |
|---|---|
| `/v1/outline/root` | 예산·cursor → Project·App·Context 목적/건수·자리 없는 문서 묶음 |
| `/v1/outline/place` | PlaceRef·예산·cursor → 작은 문서 목록·고정 선택 판·format·발췌/요약 |
| `/v1/outline/context` | ctx·예산·cursor → 기준/참고/watch·이유·고정 선택 판·읽기 상태·glossary |
| `/v1/outline/document` | ID/Address·ver·depth·예산 → 고정 ver의 section 통계·범위·body_hash·트리 |
| `/v1/outline/series` | ser 또는 place/name·cursor → series.get과 같은 기준·순서의 멤버 목록 |
| `/v1/documents/read` | 고정 참조·section·include_children·줄 범위·cursor → ReadResult |
| `/v1/documents/file` | 고정 ver·ContentFile 상대 경로 → 허용된 blob 읽기 참조·저장 MIME·바이트 수 |
| `/v1/documents/history`, `/v1/documents/section_history` | doc·from/to·key → 고정 판 목록·같은 key 변화 |
| `/v1/guides/list`, `/v1/guides/get`, `/v1/guides/outline`, `/v1/guides/read` | 설치 manifest의 lophn_version·content_hash 고정 참조·section/범위/cursor → BundledGuide 목록·같은 설치 안내 판의 목차·본문; offline·읽기 전용 |
| `/v1/documents/diff` | 두 고정 ver·section? → core 밖에서 계산한 줄 단위 diff·누락 |
| `/v1/search/query` | 문자열·place/context/format 조건·cursor → 고정 판·section/범위·snippet·score·IndexCoverage |
| `/v1/search/status` | 허용된 대상 → 반영 ver·최신 ver·lagging·rebuilding·omissions |
| `/v1/views/list`, `/v1/views/get` | 현재 범위·viw → 저장한 조건·정렬·revision |
| `/v1/views/open` | viw·예산·cursor → 매번 조건을 다시 적용한 작은 문서 목록; glossary 없음 |
| `/v1/series/list`, `/v1/series/get`, `/v1/series/next` | place 또는 ser → 가족 구성·멤버·NextSuggestion |

**읽기 처리.** 최신은 먼저 platform read로 선택해 고정 ver로 바꾼다. outline의 그 ver를 section·본문 cursor까지 유지하고 latest_version은 따로 표시한다. cache가 없으면 준비 worker·format runner가 그 판만 직접 추출하며 전체 scan·index 따라잡기를 기다리지 않는다. 성공 추출에 key가 없으면 `missing`, 미지원은 `unsupported`, 미완료·실패는 `unverified`다. 원문 파일은 blob contract로 저장한 MIME·바이트를 읽으며 agent 출력은 redaction을 우회하지 않는다.

root 예산 1,500, place·context 3,000, document outline 2,000 estimated token·depth 2, 본문 12,000 Unicode codepoint를 초기 기본으로 쓴다. 추정 token은 codepoint 수/3의 올림이며 실제 model token이 아니다. 초과 시 complete=false·cursor·숨긴 자식 수를 반환한다. glossary 정의는 첫 page 30개이고 후보와 분리한다. 목록에는 본문·agent용 절대 경로·현재 파일 상태를 넣지 않는다. 사람의 Project 폴더 행에서는 files 통로로 파일 트리를 열고 그 파일을 문서 목록에 중복 나열하지 않는다.

검색 worker는 parameterized FTS5 trigram 질의를 수행한다. 3 codepoint 미만 질의는 허용 후보의 `search_rows.title/body`에 escaped SQL LIKE를 쓰고 원본 폴더 scan으로 대체하지 않는다. 최신 반영 판의 section 제목·자체 본문과 가용 요약·주제 텍스트를 검색한다. 원문은 search_fts, 가용 요약·주제 cache는 동일한 trigram/짧은 LIKE 규약으로 현재 허용 대상에 한해 비교하여 결과를 합친다. cache 일치 결과는 실제 입력 판·section·input_hash·stale를 별도로 반환하고 해당 입력 판의 outline·원문으로 이어지며, 요약의 위치를 원문 일치 줄처럼 꾸미지 않는다. 요약이 없는 문서에서 이를 채우려고 model을 호출하지 않는다. rank는 유한한 keyword 점수이며 검색 판·최신 판이 다르면 둘 다 준다. embedding·model 검색은 없다.

root는 활동 순, place·context는 갱신 순으로 시작하고 seq·ID로 동점을 결정한다. Context는 basis·reference·watch와 빈 관점을 API에서 구별한다. 기본 목록·검색은 현재 ledger에서 보관 문서·보관 자리를 제거하며 낡은 index 행이 남아도 이를 반환하지 않는다. 보관 해제의 검색 반영은 비동기이고 고정 판 직접 읽기는 유지한다. 권한 밖 ID는 후보 단계에서 제거한다. 제목·snippet·본문뿐 아니라 count·rank·pagination도 허용 집합에서만 계산한다. cache의 scope를 현재 허락처럼 쓰지 않는다. Context inclusion·옛 Address·blob hash만으로 범위를 넓히지 않는다. redaction 뒤에도 고정 판·원래 범위·redacted를 유지하며 안전한 출력이 불명이면 본문을 뺀다.

**saved view.** 조건은 core의 `saved_views`에 보존한다. 저장·변경·삭제는 각각 `view.save`, `view.update`, `view.delete`이며 아래 mutation 표를 쓴다. revision은 마지막 변경 event seq다. 삭제는 조건 행만 제거하며 문서·판·Context는 그대로 남고 삭제 event의 before 값은 보존한다. 삭제된 view cursor는 conflict다. open은 현재 허용 문서에 place·제목·text·format·Context 포함·`document_status`(active/archived/all, 기본 active)·갱신 기간 조건을 적용한다. 요구에 없는 Series 멤버·tag·앱 DB·문서 관계 조건은 거절한다. 결과는 별도 Document·Context item을 만들지 않는다. 정렬은 updated_desc/updated_asc/title_asc/address_asc이며 updated는 Version의 event seq·ID tie-breaker를 사용한다. cache는 정규화 조건·정렬·대상 고정 ver 목록·현재 scope가 모두 같을 때만 메모리에서 재사용한다. text 조건이면 IndexCoverage를 그대로 붙여 누락을 숨기지 않는다. 상대 갱신 기간은 open의 시각에 고정하고 같은 cursor에 유지한다.

**series 다음 계산.** `series.next`는 core read 모듈에서 scope·같은 snapshot의 가족 revision·멤버·예약 key·draft를 읽는다. 많은 멤버의 자연 정렬과 NextRule 계산은 준비 worker의 순수 `series-next`에 맡겨 write queue 밖에서 끝낸다. 화면과 MCP·CLI는 이 답을 쓰고 계산을 재구현하지 않는다. 표시 정렬·descending과 무관하게 key 자연 순의 마지막 확정 멤버(보관 멤버 포함)를 기준으로 한다. draft는 마지막 멤버가 아니다. 빈 가족·해석 불가 날짜 key·안전 정수 overflow는 빈 제안이다. 정수 ±step, major/minor/patch, 1~4자리 zero padding만 계산하며 from·taken·document_name·series_revision을 반환한다. 조회는 key·doc·파일을 예약하지 않고 가입 때 다시 CAS한다.

**이력·diff.** 같은 module의 key·body_hash 비교를 watch와 공용 순수 `section-comparison`에 둔다. 의미 rename·유사도 chain은 없다. 잘린 시작 판은 직전 판도 읽고 소실 행은 살아 있는 행 뒤에 둔다. 줄 diff는 준비 worker에서 bounded Myers 방식으로 계산하고, 계산 한도를 넘으면 변경 블록 단위로 나누어 이어 읽게 한다. blob 복원 불가는 누락으로 표시하고 빈 본문으로 성공을 꾸미지 않는다.

**오류.** 조건·cursor·다른 ver의 범위는 `invalid_input`, 허용 대상 없음은 `not_found`, basis 유지 불가는 `conflict`, blob·module 접근 실패·worker 적체는 `unavailable`이다. 자격 오류는 인증 contract를 따른다.

**보장.** 단계적 읽기의 고정 판·범위 유지, 매 page의 scope 검사, 실패·미지원·지연 표시, derived 재생성의 정본 불변을 보장한다.

**보장하지 않는 것.** 저장 직후 검색 완료, index cursor가 최신이면 모든 문서 검색 가능, 여러 문서의 공동 commit 시점, section 의미 대응, 조건 open의 결과가 영구히 같은 것을 보장하지 않는다.

### 5.5 도메인 command·read 경로

다음 이름을 platform command·read handler에 등록한다. domain model의 입력·CAS·actor·event를 그대로 쓰며 긴 준비를 이 handler 안에 넣지 않는다. 표의 모든 경로는 POST다. `create`는 ID 미존재, `update`·구성 변경·보관은 base_revision, 새 Version은 base_version을 비교한다. 이름·key 예약은 같은 transaction에서 검사한다. 공통 오류는 5.1~5.4와 platform error mapping을 따른다.

| resource와 method 경로 | 등록 이름 |
|---|---|
| `/v1/projects/create`, `/update`, `/set_tracking`, `/archive`, `/unarchive` | `project.create`, `project.update`, `project.set_tracking`, `project.archive`, `project.unarchive` |
| `/v1/projects/list`, `/get`, `/resolve`, `/resolve_cwd`, `/tracking_roots` | 저장 문서 중심 Project read; 사람만 폴더 경로·tracking 값 포함; resolve는 꺼진 중첩 폴더도 가장 깊은 등록 루트로 해석; resolve_cwd는 coding agent의 고정 cwd로 project ID만; tracking_roots는 machine의 활성·켠 root |
| `/v1/documents/update`, `/set_source`, `/archive`, `/unarchive`, `/move`, `/rename` | `document.update`, `document.set_source`, `document.archive`, `document.unarchive`, `document.move`, `document.rename` |
| `/v1/documents/list`, `/get`, `/resolve`, `/export` | 현재 metadata·고정 판·Address 예약 해석·사람의 Markdown/JSON 및 원문 export |
| `/v1/contexts/create`, `/update`, `/set_item`, `/remove_item`, `/archive`, `/unarchive`, `/record_watch_change` | 대응 `context.*` 이름; 마지막은 좁은 machine 내부 제출 |
| `/v1/contexts/list`, `/get`, `/related`, `/export` | 현재 구성·직접 item 역조회·사람의 목적/항목/고정 참조/glossary export |
| `/v1/terms/propose`, `/define`, `/update`, `/archive`, `/unarchive` | 대응 `term.*` 이름; 정의는 사람 또는 검증된 option action만 |
| `/v1/terms/list`, `/get` | 정의·후보 분리·고정 출현 근거 read |
| `/v1/series/create`, `/update`, `/set_draft`, `/clear_draft`, `/add_instance`, `/update_instance`, `/remove_instance`, `/archive`, `/unarchive` | 대응 `series.*`; create·update·add_instance·update_instance는 user와 허용 coding_agent·app, 나머지 가족 변경은 user, lophn agent 가족 mutation 없음 |
| `/v1/views/save`, `/update`, `/delete` | `view.save`, `view.update`, `view.delete`; 저장·변경·삭제 모두 user만 |

표의 `/update` 같은 짧은 표기는 그 행의 resource를 반복한 전체 경로다. project.create는 tracking.enabled=false만 허용하며, project.update로 folders를 바꾸는 경우도 project.set_tracking과 같은 미리보기의 정확한 folders·tracking·base_revision을 검사한다. Document 최초 save와 Series 첫 가입을 같이 요청하면 두 모듈의 검사를 같은 ledger transaction에 적용하고 일치 draft를 비운다. Series 구성·draft는 source 파일이나 Version 없는 Document가 아니다. 기존 멤버 수정은 같은 doc의 새 ver이며 멤버 추가가 아니다. Operator의 기존 출력 doc 범위를 Series 도입으로 넓히지 않는다.

문서 영역의 실제 event 이름은 다음과 같다. 목록 read·추출·index 재생성·series.next에는 변경 event가 없다.

- Project: `ProjectCreated`, `ProjectUpdated`, `ProjectTrackingChanged`, `ProjectArchived`, `ProjectUnarchived`.
- Document: `DocumentCreated`, `DocumentSaved`, `DocumentUpdated`, `DocumentSourceChanged`, `DocumentArchived`, `DocumentUnarchived`, `DocumentRestored`, `DocumentMoved`, `DocumentRenamed`.
- 파일: `FileWritten`, `FileRenamed`, `FileDeleted`.
- Context: `ContextCreated`, `ContextUpdated`, `ContextItemSet`, `ContextItemRemoved`, `ContextArchived`, `ContextUnarchived`, `ContextWatchedItemChanged`.
- Term: `TermProposed`, `TermDefined`, `TermUpdated`, `TermArchived`, `TermUnarchived`.
- Series: `SeriesCreated`, `SeriesUpdated`, `SeriesDraftSet`, `SeriesDraftCleared`, `SeriesInstanceAdded`, `SeriesInstanceUpdated`, `SeriesInstanceRemoved`, `SeriesArchived`, `SeriesUnarchived`.
- Saved view: `SavedViewCreated`, `SavedViewUpdated`, `SavedViewDeleted`.

## 6. 쓰는 contract

| 소유 | contract | 쓰는 곳 |
|---|---|---|
| platform | 인증 | 원래 actor·현재 scope·machine 작업 범위 확인; 준비 결과를 원래 요청에 결합 |
| platform | read | 규칙·source·Version·Context·Term·Series·view, 현재 후보 scope, seq S의 일관된 재생성 기준 |
| platform | command | 준비 Version 확정, 파일 결과 기록, watch 결과 접수·중복 방지; 짧은 CAS transaction |
| platform | event 구독 | 규칙·source 갱신, search/watch 따라잡기; 마지막 derived cursor에서 재연결 |
| platform | blob | 원문·목록·diagnostics·draft·정확한 module의 내구 설치·참조 등록·허용 읽기 |
| platform | redaction | agent·model·외부 export로 나가는 제목·snippet·본문; 원문을 변경하지 않음 |
| platform | approval | 정확한 위험 파일 작업의 승인 근거; worker가 자유 문장을 허락으로 해석하지 않음 |
| shell | confirmation window | 사람의 삭제·정리 결정 근거와 정확한 목표 확인 |
| apps | 앱 통로 | Context app_command 항목은 읽을 참조만 반환; 호출자는 이 통로로 호출 |

상대 contract의 transport·token 형식·표·프로세스 내부를 재정의하지 않는다. 앱 출력·coding connection·assignment/run scope는 각 소유 concern의 정책을 최종 command가 확인한다. worker는 다른 모듈 표를 직접 열지 않는다.

## 7. 흐름

### 7.1 Project 규칙 적용 → 파일 관측 → Version

```text
shell: OS 폴더 선택·규칙 입력
 → core read: 현재 Project revision
 → coordinator/준비 worker: tracking preview를 작은 page로 scan
 → shell: 같은 folders·tracking·base_revision으로 적용
 → core command: project.set_tracking → ProjectTrackingChanged
 → coordinator: watch 설치 + 공정 루트 scan
 → 준비 worker: 실제 경계·안정 읽기 → 같은 stream hash/blob
 → format runner: 정확한 module validate
 → coordinator: PreparedVersion + FileObservationBasis 제출
 → core command: document.save(CAS·scope) → DocumentCreated/DocumentSaved
 → search/watch consumer: 각각 비동기 반영
```

coordinator는 machine으로 tracking 규칙과 경로→문서 연결을 읽지 않는다. core가 소유자로 snapshot에서 읽어(활성 root·규칙, `documents.source_path` 연결과 최신 판) 감독 pipe의 요청(`documents.observation_basis`)으로 넘기고, 규칙이나 연결이 바뀌면 바뀐 것만 같은 통로로 다시 보낸다(제어 frame 상한 안의 조각, 마지막 조각에서 한꺼번에 반영). 준비 route의 format 검사는 core가 I/O worker의 원문 blob을 창 단위로 읽어 같은 pipe의 byte chunk frame으로 coordinator에 보내고, coordinator가 format runner로 검사한다.

규칙·source·보관·최신 판이 준비 중 바뀌면 command가 거절하고 새 기준으로 관측한다. 삭제·이동·권한 상실은 source_missing/unverified이며 연결과 옛 Version을 삭제하지 않는다. 꺼진 동안의 여러 중간 편집 대신 현재 확인한 바이트만 준비한다.

### 7.2 사람 편집 → 원자 교체 → 별도 완료

```text
shell main(user): files.read → 실제 base_hash·관측 시각
 → shell editor: 편집; 자동 저장은 files.write만 요청
 → core dispatch: user·허용 FileTarget 확인, writer queue 밖 IPC
 → 준비 worker: 시작 hash 비교 → 같은 디렉터리 임시 stream·sync
 → 준비 worker: 직전 경계/hash 비교 → atomic replace/no-replace → 재관측
 → coordinator: FileOperationResult(파일 결과)
 → core command: file.record_result → FileWritten(기록 결과)
 → shell 명시 저장/편집 종료: version 준비 요청
 → 준비 worker/format runner: 현재 파일 또는 working copy 준비
 → core command: document.save(Version 결과)
 → coordinator search: IndexCoverage(검색 결과)
```

working copy도 파일 hash와 base_version을 따로 검사한다. 외부 쓰기는 409, 디스크 실패는 503이다. 파일 교체 뒤 검사 실패는 파일 성공 + validation_failed이며 이전 바이트로 복구하지 않는다. shell 연결이 끊기면 메모리 편집 표시를 해제하고 원본을 다시 관측한다.

### 7.3 agent·앱 내용 저장과 Series 가입

```text
호출자(자기 credential): doc/base_version 또는 신규 doc + 내용 blob 참조
 → core/인증·read: 현재 저장 scope·source 없음·FormatRef 확인
 → coordinator/준비 worker: 파일 목록 검사·stream blob·canonical hash
 → format runner: validate; 지정 error면 준비 실패
 → coordinator: 원래 actor·run·app/release에 묶인 준비 참조
 → core command: document.save + 선택한 series.add_instance 검사
 → 같은 transaction: 첫 Document·Version·멤버·key 예약·draft 비움 + event
 → 호출자: 고정 SaveResult; search 반영은 뒤따름
```

Series draft가 있어도 첫 판 전에는 Document read·Context target가 아니다. 같은 내용·정확한 계약은 unchanged이고 기존 멤버 내용 수정으로 가족 수가 늘지 않는다. 응답을 잃으면 같은 key·신규 doc ID로 결과를 재조회하거나 재전달한다.

### 7.4 derived 따라잡기와 재생성

```text
coordinator search: derived_cursors.search부터 event 구독
 → 준비 worker/format runner: DocumentSaved의 정확한 ver만 추출
 → coordinator derived transaction: ver·section·text·FTS 교체 + cursor
 → 목록 변경 event: 500ms 무효화 합침; move의 양쪽 place·Context 갱신
 → 요청 응답: indexed_version·latest_version·lagging·omissions

삭제/손상
 → core read: seq S의 일관된 snapshot
 → coordinator: documents.rebuild.sqlite에 S의 자료 재생성
 → event 구독: S 다음을 따라잡기
 → coordinator: 완성 파일 교체·새 read 연결; rebuilding 해제
```

실패 판 하나 때문에 정상 판의 처리를 멈추지 않는다. 실패 이유를 derived에 남기고 cursor가 진행돼도 omissions를 반환한다. 재생성 중 선택 고정 판 read는 직접 추출로 우선 처리한다. watch는 자체 cursor·중복키로 별도 따라잡는다.

### 7.5 outline → section → 본문과 saved view

```text
호출자: outline.root → place 또는 Context 선택
 → core read + coordinator: 작은 목록에서 고정 ver 선택
 → 호출자: outline.document(ver, depth=2)
 → coordinator: cache 또는 해당 ver 직접 추출 → key·범위·크기
 → 호출자: documents.read(ver, key, include_children, range)
 → coordinator: 현재 scope 재검사·redaction → 본문 조각 + 같은 ver cursor

shell(user): views.save(조건·정렬) → core command → SavedViewCreated
 → 호출자: views.open(viw)
 → core read: 현재 view·revision·허용 후보
 → coordinator: 현재 조건 평가·검색 coverage·정렬·고정 판 목록
 → 동일 조건/판 목록 cache 또는 새 작은 목록; glossary 없음
 → 호출자: 선택 판 outline·section read
```

outline 후 새 판이 생겨도 기존 cursor는 처음 ver를 읽고 latest_version은 따로 준다. view를 다시 열면 현재 조건·현재 허용 문서로 목록을 다시 만들며 view 자체나 Context item에 목록을 저장하지 않는다. basis를 유지하지 못하는 이어 보기는 conflict로 재조회를 요구한다.

### 7.6 Context watch 변화 확인

```text
coordinator watch: 자체 cursor에서 DocumentSaved(source_seq) 수신
 → core read + event replay: source_seq 당시 Context 구성 근거와 현재 revision
 → 준비 worker/format runner: before/after 고정 판·같은 key의 비교
 → 전체 문서: content_hash; section: 공용 section-comparison body_hash·존재 여부
 → unverified: watch_unverified + watch cursor를 derived에 저장, 나중에 재추출
 → unchanged: event 없이 cursor 진행
 → confirmed: coordinator가 context.record_watch_change 제출
 → core command: 당시 근거·현재 active/revision/target/watch·중복키 검사
 → ContextWatchedItemChanged → platform notification contract
 → coordinator: command 수락 뒤 derived watch cursor 진행
```

확인 결과는 content_changed/section_added/section_missing만 event가 된다. module 변경의 비교 규약이 불명·추출 실패면 소실로 단정하지 않는다. 늦은 before→after 비교는 그 고정 판의 사실이지 현재 최신 판의 주장으로 바꾸지 않는다. 구성 변경·보관이면 예전 결과를 버리고 현재 추가한 항목에 과거 변화를 적용하지 않는다. 앱 read item의 watch는 자동 호출·변화 event를 만들지 않는다.

## 8. 실패와 재시작

| 실패·불명 시점 | 남은 사실 | 처리 |
|---|---|---|
| coordinator·준비 worker가 scan/hash 중 종료 | 기존 ledger 판·원문 blob 유지 | core가 프로세스 재시작; 활성 루트 재scan; 메모리 후보 유실을 이력 복원으로 꾸미지 않음 |
| watch 넘침·절전·루트 이동·permission 상실 | watch만으로 현재 내용 확정 불가 | 루트 재대조; 원본 없음과 unverified 구별; 경계 이탈·보관의 낡은 준비 결과 거절 |
| 파일이 계속 변함 | 안정된 새 바이트를 확인하지 못함 | 제한 재시도 뒤 FileStatus unverified·시각·비교 ver를 표시하고 다른 파일 진행 |
| blob 준비 뒤 command 전 종료 | 참조 없는 준비 blob 가능 | 새 기준으로 재준비; blob GC contract에 맡기고 확정 blob을 직접 삭제하지 않음 |
| document.save 응답 유실 | commit됐을 수 있음 | 같은 idempotency key·준비 ID로 결과 확인·재전달; 최신 판을 임의 변경하지 않음 |
| atomic replace 뒤 IPC·기록 응답 유실 | 파일은 바뀌었을 수 있음 | outcome/recording unverified; 자동 재쓰기 금지; 현재 hash 재관측. 관측만으로 유실된 FileWritten을 만들어 내지 않음 |
| file.record_result 실패, worker는 살아 있음 | 확인한 파일 성공 결과가 메모리에 있음 | 같은 request_key로 결과 보고만 재전달; 새 파일 작업 금지·파일 성공과 기록 실패 분리 |
| 디스크·quota·원자 교체 불가 | 새 바이트 성공을 확인하지 못함 | 503 unavailable; 임시 파일 정리; 비원자 fallback 없음 |
| format 지정 검사 실패 | 실제 디스크 저장은 유지 | diagnostics·파일/줄/열·Version 미확정 표시; 사람 수정 또는 명시 format 변경 뒤 재준비 |
| format runner hang·OOM·계약 위반 | 판별 구조를 확인하지 못함 | 해당 runner만 kill; 실패/미확인·원문 읽기 제공; 정확한 module로 재시도 |
| 정확한 module·blob 누락 | ledger 고정 참조 유지 | unavailable 이유와 가능한 원문 참조; 같은 hash 복구만 허용, 새 module 대체 없음 |
| derived transaction 전 종료 | cursor도 결과도 미확정 | 같은 event 재처리; 고정 ver/key로 교체, FTS 중복 없음 |
| watch command commit 뒤 cursor 전 종료 | 변화 event가 있을 수 있음 | `(context, target, after_ver)`로 재제출; event 중복 없음; notification은 소유 contract가 복구 |
| derived 파일 삭제·손상 | 정본·saved view·가족·확정 변화 유지 | 3.2의 새 파일 재생성, rebuilding/omissions 표시; 선택 판 직접 read 허용 |
| core 단절 | 새 인증·command 적용 불가 | 새 사람 파일 변경을 시작하지 않음; 이미 시작한 작업은 실제 결과 또는 unverified 반환; 재연결 후 자격·규칙·source를 읽고 재관측 |
| page basis 소실·권한 변화 | 이전 cursor를 안정하게 유지할 수 없음 | conflict로 재조회; 권한 밖 제목·count를 반환하지 않음 |

core 시작·기존 앱 direct call은 문서 전수 scan·index rebuild 완료를 기다리지 않는다. 프로세스 재시작 때 working copy는 보존한다. `FileStatus`는 마지막 관측 기준일 뿐 현재 디스크의 영구 상태가 아니다. 준비·watch·파일 감사 결과가 불명인 경우를 성공·0·부재로 채우지 않는다.

테스트는 파일 3,000개 변경 중 다른 루트의 작은 저장·고정 판 read·core command를 호출하고, 읽는 중 atomic 교체·동일 size/mtime 수정·규칙 변경·source 재연결·보관·credential 회수를 섞는다. rename·delete 재생성, no-replace 경쟁, sync/교체 직전과 직후 종료, working copy 충돌, format 금지 접근·무한 loop·대형 출력, FTS2글자/3글자 한글, index 삭제·snapshot 만료·watch 중복 재전달을 검증한다. outline을 연 뒤 새 판을 저장해도 같은 cursor로 옛 판 전체가 겹침 없이 읽혀야 한다.

## 9. 이전과 달라진 것

- 이전: 파일 순회·hash·추출이 daemon의 실행 흐름과 저장 transaction 안에서 돌았다 / 지금: coordinator와 준비 worker 두 개, 호출별 format guest에서 끝내고 작은 준비 결과만 core에 낸다 / 이유: writer 하나를 유지하면서 무관한 읽기·command를 막지 않는다.
- 이전: outline·FTS·index 문서를 ledger 안에 저장하고 index 재생성마다 Version·event를 만들었다 / 지금: 문서별 불변 Version은 ledger, outline·section·FTS·cursor는 documents.sqlite의 derived다 / 이유: 지우고 다시 만드는 자료가 정본 이력을 부풀리지 않는다.
- 이전: format을 직접 import하고 Deno 권한 차단만으로 결정성을 주장했다 / 지금: 권한 없는 runner와 QuickJS WASM 새 guest에서 시간·난수·동적 실행을 제거하고 fixture·출력 검사한다 / 이유: OS 권한 차단과 순수 계산의 결정성은 다른 경계다.
- 이전: section 유사도·rename chain·판단 큐로 watch 항목을 자동 이동했다 / 지금: 같은 key만 비교하고 소실·미확인을 구별하며 item을 그대로 둔다 / 이유: machine이 판단 근거의 의미를 바꾸지 않는다.
- 이전: 조회 전에 index flush를 기다리고 offset만 cursor에 넣었다 / 지금: 선택 ver를 직접 추출하고 조건·scope·판·basis를 cursor에 결합한다 / 이유: 전체 갱신을 기다리지 않으며 새 판과 옛 판을 섞지 않는다.
- 이전: Home·기본 notes·수신 place를 만들고 origin 대응을 여러 곳에서 읽었다 / 지금: Project·App 또는 place 없음, doc별 working copy, documents.source_path 한 기준이다 / 이유: 자료의 자리와 디스크 경계를 분리한다.
- 이전: series 초안을 첫 Version 없는 문서로 저장하고 다음 이름을 화면·daemon에서 나누어 계산했다 / 지금: draft는 Series의 값이고 다음 계산은 read→준비 worker의 공용 순수 계산이다 / 이유: 미확정 작성 값과 독립 문서 가족을 구별하며 같은 기준의 제안을 돌려준다.
- 이전: saved view 목록이나 index 사본을 정본처럼 보존했다 / 지금: 조건은 saved_views의 ledger 사실이고 open의 목록만 derived cache다 / 이유: 사람의 조건은 잃지 않고 현재 허용 자료를 매번 다시 고른다.
- 이전: v2에서 앱별 host journal·lease·실행 허가 단계·토큰 여러 종을 늘렸다 / 지금: ledger 하나·core writer 하나·재scan 가능한 메모리 후보와 derived cursor만 쓴다 / 이유: 문서 준비 비용을 격리하는 데 분산 ledger 장치가 필요하지 않다.

## Instructions 파일의 명시 등록

[Instructions]는 → lophn-agent/instructions의 exact 전역/project/app 파일 또는 사람이 연결한 지침 Document를 editor로 연다. global ~/.lophn/LOPHN.md는 data-root 재귀 tracking을 열지 않는 단일 파일 예외이고 Project/system place를 자동 생성하지 않는다. documents/file-tracking의 instruction_file target·관측 basis가 registration revision·source·hash·base_version을 비교해 documents/versions의 instruction_file source 판을 확정한다. 파일 부재는 첫 저장 전 지침 없음이고 agent가 빈 파일을 만들지 않는다. 사람 쓰기 결과와 version 확정은 기존처럼 별도다.

지침 대상 분류는 exact 등록/preset 첨부 참조로 확인한다. agent·coding agent·app의 문서 write/source 이동·출력 지정 우회는 거절하며 question으로 제안만 한다. 외부 사람 편집은 안정 관측으로 새 판을 만들고 복원은 새 Version이다. call마다 지침 최신 확정 판을 resolve하는 것은 agent runtime이며 파일·version 정본을 prompt snapshot 원본으로 복제하지 않는다. → documents/file-tracking#R19,R20, documents/versions#R19,R20, shell/editor#R17
