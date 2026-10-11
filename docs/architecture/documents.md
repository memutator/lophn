---
type: architecture
concerns: [documents]
---
# documents

## 1. 맡는 것과 맡지 않는 것

사람이 쓰는 글의 고정 Version을 준비하고, 필요한 부분을 적은 양으로 찾고 읽게 한다. Project·Document·Version·Series·Context·Term의 ledger command·read 모듈은 이 concern의 코드이며 core 안에 배치한다. 원문 읽기·hash·format 검사·section 추출·diff·키워드 검색·context 색인과 check는 core 밖에서 한다. 파일 바이트 저장, 파일 작업 기록, Version 확정, context index 반영은 네 개의 별도 완료다.

- 자동 추적은 사람이 켠 Project 폴더에만 적용한다. 앱 source, 기본 notes Project, `_inbox`·`_system` 같은 place를 자동으로 만들지 않는다.
- 사람의 shell만 현재 원본 파일 통로를 쓴다. agent·coding agent·앱은 허용된 고정 Version을 읽고 원본 연결 없는 문서 내용을 저장한다. coding agent가 자기 외부 편집기로 파일을 고치는 것은 이 통로 밖의 일이다.
- format은 결정적인 검사·추출 코드다. 문서 자체의 background 동작·HTML 스크립트 run을 제공하지 않는다. lophn 배포 안내는 설치 묶음의 `guides/`에 고정 manifest(version·title·content hash)와 읽기 전용 문서로 두고 coordinator가 기존 outline·section 읽기 코드로 제공한다(manifest는 `guides/manifest.json`의 `{lophn_version, guides: BundledGuide[]}`이고 안내 파일 경로는 `guides/` 기준 상대 경로다. 안내마다 content_hash는 대표 파일 raw bytes의 sha256이고 매 요청 실제 bytes와 대조한다); 사용자 Document·system place·tracking을 자동 생성하지 않으며 복사본만 일반 문서 저장 contract로 남긴다.
- Context는 한 Project의 파일 위에 선 결정적 계약(type·kind·field·relation·check·public)과 선언 검색의 묶음이다. Project 하나에 여럿이 있고 자료의 소유자가 아니다. 계약과 그 판(Bundle)은 lophn ledger(+blob)가 갖고 Project 폴더에는 아무것도 쓰지 않는다(documents/contexts#Q11). index는 계약이 가리키는 현재 Project 파일을 훑어 만든 derived store이며 문서 Version이나 tracking에 기대지 않는다(documents/contexts#Q14).
- ledger writer, transport, credential·scope·secret·redaction·blob GC·backup은 platform이 소유한다. 이 파일은 그 contract를 사용한다.
- 편집 화면·충돌 화면·confirmation window는 shell, model 요약 생성과 prompt 조립은 lophn-agent, 앱 command·DB·source는 apps 및 coding-agent가 맡는다. 문서 worker는 앱 DB를 읽거나 앱 read command를 호출하지 않는다. Context의 app-data kind는 core가 꽂는 port로만 앱 read command를 읽는다(5.6).
- 계약 위반은 `ContextViolationsRecorded`로 기록하고, 수가 늘었을 때의 notification은 platform의 notification contract가 만든다. 문서 변화·index 완료·위반으로 agent run을 시작하지 않는다. 위반을 Context Engineer에게 넘기는 것은 사람이 누르는 일이고 그 대화와 prompt 조립은 lophn-agent가 맡는다.

## 2. 프로세스

### 2.1 구성과 수명

문서 영역의 상시 프로세스는 coordinator 하나와 준비 worker 두 개다. core가 coordinator를 띄우고 종료·crash를 감독한다. coordinator가 정확한 실행 파일(Deno와 `apps/worker/documents/preparation-entry.ts`)로 준비 worker 두 slot을 띄우고 작업별 format runner를 시작한다. 준비 worker는 core가 아니라 coordinator가 띄운다: core의 platform 감독은 kind마다 child 하나라 slot 둘을 선언할 수 없고, 준비 worker의 읽기·쓰기 권한이 coordinator가 아는 현재 등록 루트로 정해지기 때문이다. coordinator는 platform의 `createSupervisor`를 slot마다 하나씩 쓴다(ready 기한, 3회 재기동과 backoff, process group 종료 확인이 platform 규칙 그대로다). 준비 worker가 죽으면 감독이 그 slot을 새 프로세스로 채우고 진행 중이던 요청은 결과 불명(unavailable)이며 자동으로 다시 보내지 않는다. worker는 첫 요청에서 띄운다(core 기동 시간·메모리를 아끼려는 구현 선택이고, 한 번 뜬 뒤에는 상주한다). 등록 루트 근거가 바뀌면 다음 요청이 worker를 새 권한으로 다시 띄우고, 루트 추가·해제로 core가 coordinator를 교체하면 pool도 함께 새로 만들어진다. coordinator의 `--allow-run`은 Deno 하나와 감독이 process group 종료를 확인하는 `/usr/bin/kill`이고, `--allow-env`에는 감독이 child를 띄울 때 읽는 이름 `NODE_V8_COVERAGE`가 더해진다. 폴더 미리보기(`/v1/projects/preview_tracking`)는 아직 등록하지 않은 폴더를 읽어야 해서 상시 slot의 권한 밖이다. 그 요청의 폴더만 `--allow-read`로 가진 준비 worker 하나를 요청마다 띄워 한 번 쓰고 끝낸다. format runner는 호출마다 시작하고 한 결과를 낸 뒤 종료한다. format 동시 run은 최대 두 개다. context 일(index·check)은 coordinator가 아니라 별도 kind의 context worker가 한다(2.4). 문서 Version·tracking과 생애가 달라, 그쪽을 정리해도 context에 영향이 없게 하려는 것이다. core·shell은 다른 concern의 프로세스이며 문서 프로세스 수에 포함하지 않는다.

```text
shell main / agent runtime / MCP·CLI / 앱
   │ platform API (원래 credential, 작은 JSON + 내용 참조)
   ▼
core
   ├ documents/* command·read 모듈 ── 유일한 writer ── ~/.lophn/lophn.db
   ├ platform read·인증·blob·event 구독 contract
   ├ context reader ── 선언 검색 = 순수 함수 ── derived/contexts.sqlite (read 연결)
   ├ 비동기 dispatch ── stdio framed IPC ── context worker (1)
   │                                         └ context.index (stat scan + extract) · context.check (임시 snapshot) · context.preview (draft 추출 보기)
   └ 비동기 dispatch ── stdio framed IPC ── documents coordinator (1)
                                           ├ Deno.watchFs / scan cursor / 폴더별 공정 큐
                                           ├ framed IPC ── 준비 worker (2)
                                           │                  └ scan·stream hash·파일 교체·diff·키워드 검색
                                           └ framed IPC ── format runner (호출마다, 최대 2)
                                                             └ QuickJS WASM 새 guest context
원본 Project 파일 / doc별 working copy       blob contract       derived/contexts.sqlite (context worker가 유일한 writer)
```

coordinator는 API 서버를 따로 열지 않는다. HTTP 요청의 작은 입력은 core가 비동기 IPC로 넘긴다. 결과를 기다리는 동안 core command queue나 JS 실행 흐름을 점유하지 않는다. stdio는 `request_id, operation, input_ref, basis`의 길이 prefix frame과 제한된 chunk frame을 쓴다. stderr는 diagnostics용이며 본문·token은 출력하지 않는다. IPC 종료는 진행 요청의 결과 불명 또는 이용 불가이지 성공이 아니다.

worker가 쓰는 platform contract 호출은 coordinator가 중계한다. 원래 요청의 actor·run·scope와 대상·내용 참조를 인증된 요청 근거에 결합하여 전달한다. 자동 file 관측과 `file.record_result`에만 좁은 machine credential을 쓴다(context worker의 `bundle.finish_check`·`context.record_violations`도 같다. 2.4). format guest에는 credential·확인 handle·원본 절대 경로를 전달하지 않는다. worker가 직접 `lophn.db`를 열지 않는다.

### 2.2 실제 권한

- coordinator의 Deno 권한은 등록한 활성 루트와 `~/.lophn/documents/`의 필요한 `--allow-read`, 작업 staging의 `--allow-write`, 고정 worker·runner 실행 파일의 `--allow-run`만 준다. `--allow-net`, `--allow-env`, `--allow-ffi`는 주지 않고 `--no-prompt`로 시작한다. core 통신은 상속한 stdio다. 루트 추가·해제 때 core가 새 권한 목록으로 문서 프로세스를 교체하고 재scan한다.
- 준비 worker에는 현재 루트·working copy·staging의 `--allow-read`와 파일 작업에 필요한 경로(등록 루트, `documents/working-copies`, `documents/staging`)의 `--allow-write`만 준다. spec은 coordinator가 관측 근거의 등록 루트로 만든다(`apps/worker/documents/launch.ts`). network·env·subprocess·FFI 권한은 없다. 이 프로세스는 신뢰한 플랫폼 코드만 실행하며 사람이 선택한 목표인지 요청마다 별도로 검사한다. Deno 경로 권한은 사용자 자격 검사의 대체가 아니다.
- format runner는 Deno 기반 고정 host 실행 파일과 내장 QuickJS WASM을 묶어 배포한다. 호출 입력과 module 바이트를 IPC로 받으므로 파일·network·env·subprocess·FFI 권한을 전부 주지 않는다. guest module을 Deno에 직접 import하거나 Deno Worker 전역에서 실행하지 않는다.
- QuickJS guest에는 JSON·문자열·배열·순수 계산만 제공한다. `Date`, 시간 API, `Math.random`, crypto 난수, `eval`, `Function`, 동적 import, host object·WASM·FFI 접근을 설치하지 않는다. 정적 module loader는 요청의 정확한 묶음 안 module만 로드한다. guest에는 바이트 입력을 복사해 주고 출력 JSON만 받는다. Deno의 시간·난수를 지우는 것만으로 격리가 됐다고 하지 않는다.
- host가 QuickJS memory limit와 interrupt handler를 설정하고, coordinator는 별도 deadline에서 runner를 강제 종료한다. 초기 구현값은 guest memory 64 MiB, 호출 5초, 입력 16 MiB, 출력 8 MiB다. runner 프로세스의 최대 heap도 제한하며 crash·한도 초과는 그 호출의 `unavailable`이다. 이 값은 구현 조절값이지 문서 원문 전체 크기의 domain 제한이 아니다(파일 크기의 상한은 upload 상한 256 MiB 하나다). 입력 16 MiB는 guest가 받는 입력 JSON 문자열의 상한이다: 파일 바이트는 JSON 숫자 배열로 들어가 한 바이트가 3~4자라서 guest memory 안에서 실제로 끝나는 대표 파일은 1 MiB까지이고, host는 이를 검사 한도(`FORMAT_CHECK_CONTENT_MAX_BYTES`)로 따로 지킨다. 검사는 바이트를 읽는 format(document)의 대표 파일 바이트만 guest에 넘기고 첨부와 파일 모양만 보는 format(pdf·image·data)은 바이트를 넘기지 않는다. 검사에 필요한 입력이 한도를 넘으면 미지원처럼 꾸미지 않고 검사를 하지 못했다는 진단(한도 포함)을 낸다: 명시 format은 error라 저장이 invalid_input이고 미지정 새 문서는 warning이라 원문은 그대로 저장된다.
- 내장 format만 시작한다. 사용 가능해지기 전에 고정 fixture 전부와 파일·network·시간·난수·동적 코드 우회 테스트를 통과해야 한다. module hash에는 코드·의존·추출 규칙·guest 실행 규약을 포함한다. 규약 변경을 같은 module hash 아래 덮어쓰지 않는다.

### 2.3 watch·scan·작업 배분

coordinator가 등록 루트별 `Deno.watchFs(root, {recursive: true})`를 연다. OS의 rename/remove/create 신호는 힌트로 보존하고 canonical 경로별 후보를 합친다. 이름 변경은 옛 경로 부재와 새 경로 존재를 따로 관측한다. 삭제 후 재생성을 단순 수정으로 합치지 않으며 내용이 같다고 source를 자동 재연결하지 않는다.

각 루트에 iterator와 후보 큐를 두고 round-robin으로 최대 128개 directory entry씩 준비 worker에 넘긴다. `.git`·lophn 데이터·루트 밖 symlink는 순회와 최종 열린 파일 검사에서 모두 제외한다. include/exclude는 `/` 상대 경로에 순서대로 적용해 마지막 일치를 쓰고 미일치는 제외한다. glob은 정확한 dependency로 고정한 picomatch, `.gitignore`는 ignore 라이브러리를 쓰며 루트 아래 중첩 `.gitignore`도 상대 경로대로 적용한다. OS locale로 glob 결과를 바꾸지 않는다.

시작, 절전 복귀, watch 넘침·단절, Project 규칙·폴더 변경, 보관 해제에는 전체 루트 대조를 예약한다. 평상시에는 60초마다 각 루트의 다음 scan을 예약하되 이전 scan이 끝나지 않았으면 하나로 합친다. size·mtime는 우선순위 힌트일 뿐 주기 대조에서 hash를 영원히 생략하지 않는다. 후보가 루트당 10,000개를 넘으면 개별 후보 대신 `rescan_required` 한 값을 남긴다. 큐·scan 위치·편집 표시·FileStatus는 worker 메모리이며 ledger queue를 만들지 않는다.

한 경로에는 준비·제출 하나만 진행한다. 진행 중 신호는 다음 관측 표시로 남긴다. 외부 변화는 750ms 동안 새 신호가 없을 때 관측하고, 안정 읽기는 최대 3회 재시도한다. 열기 전·후의 실제 경로·file identity·size·mtime를 비교하고 같은 읽기 stream을 hash와 blob staging으로 보낸다. 안정성을 확인하지 못하면 `unverified`로 두고 다른 파일을 진행한다. 관측하지 못한 중간 편집까지 보존한다고 하지 않는다.

준비 worker 두 slot 중 한 slot은 사람이 요청한 파일 읽기·저장, 선택 판 읽기·diff를 먼저 받고 다른 slot은 background scan을 진행한다. 사람이 기다리지 않으면 두 slot 모두 background에 사용한다. 요청마다 바이트·시간 예산을 두고 chunk 사이 양보한다. 신뢰한 worker code라도 큰 순회·hash·diff를 coordinator의 실행 흐름에 동기식으로 올리지 않는다. 결과 command 제출은 동시에 두 개까지만 진행하고 platform command의 접수 제한에 맞춰 늦춘다.

### 2.4 context worker

context worker는 `apps/worker`의 kind `documents/contexts` 하나다. core가 platform의 `createSupervisor`로 띄우고 감독한다(kind마다 child 하나, ready 기한·재기동·process group 종료 확인은 platform 규칙 그대로). 첫 요청에서 띄우고 상주한다. 죽으면 진행 중이던 요청은 결과 불명(`unavailable`)이며 자동으로 다시 보내지 않는다. worker 본문은 얇은 entry(`apps/worker/documents/contexts.ts`)이고 일은 `packages/documents/contexts`의 `work.ts`가 순수 부분(`extract`·`checks`·`search`·`check`)을 불러 한다. 파일을 읽고 sqlite에 쓰는 IO만 worker 쪽 adapters다.

| job | 입력 | 하는 일 | 내는 것 |
|---|---|---|---|
| `context.index` | context, 적용 Bundle의 contract(core가 blob을 읽어 IPC 요청에 싣는다), Project 루트 | 계약이 가리키는 경로만 stat(size·mtime)으로 훑어 바뀌었거나 새로 생긴 파일만 다시 extract하고, 사라진 파일의 개체를 지운 뒤 derived store를 한 transaction으로 갱신한다. 이어 `checks`로 위반 집합을 다시 계산한다 | scan 결과(훑은 수·바뀐 수·실패·omissions)와 위반 요약. 위반 수가 ledger의 마지막 기록(`recorded_count`, core가 요청에 싣는다)과 다르면 `context.record_violations`를 제출 |
| `context.check` | context, 후보 Bundle(contract·선언 검색·예시), 그 context의 saved view 전부 | 계약이 가리키는 파일을 임시 snapshot 폴더로 복사해 고정하고 그 snapshot에 대해서만 `check` runner를 돌린 뒤 snapshot을 지운다 | 결정적 report(`bundle_hash, snapshot_hash`, 통과/실패와 이유, 위반 수). core에 `bundle.finish_check`를 제출 |
| `context.preview` | context, draft Bundle의 content(core가 draft blob을 읽어 IPC 요청에 싣는다), Project 루트, 다른 context의 public type(`context.check`와 같은 환경) | 계약이 가리키는 파일을 `context.check`와 같은 임시 snapshot으로 복사해 고정하고 그 snapshot에 대해 `check` runner의 모양·의미·추출·예·saved view 단계를 돌린다. index와 ledger는 쓰지 않고 판을 적용하지도 않으며 사람이 저장한 saved view는 부르지 않는다. 파일 수·바이트·시간은 `context.check`와 같은 예산이고 넘으면 부분 결과 없이 실패한다 | type별 개체 수(계약의 type 순서), 위반 전부(canonical 순서, 문구 없음), 판 단계 finding. 제출하는 command가 없다. 결과를 core의 `context.preview` 읽기가 문구를 붙이고 page(30개)로 잘라 돌려준다 |

- 권한: 등록 루트의 `--allow-read`, `~/.lophn/derived/contexts.sqlite`(와 WAL)와 `~/.lophn/documents/staging/context-check/`의 `--allow-write`만 준다. network·env·subprocess·FFI는 없고 `--no-prompt`로 시작한다. 루트 추가·해제 때 core가 새 권한으로 worker를 교체한다. 신뢰한 플랫폼 코드만 실행하며 사용자 script는 실행하지 않는다(선언형 query뿐, documents/contexts#Q10).
- 경로 안전: 계약의 경로는 Project 루트 기준 `/` 상대 경로나 glob이다. 순회와 최종 열린 파일 검사에서 `.git`·lophn 데이터·루트 밖 symlink를 제외한다. 루트 밖을 가리키는 경로는 읽지 않고 계약 오류로 보고한다.
- 직렬화: 한 context에는 job이 하나씩만 돈다. 같은 context의 같은 job 요청은 하나로 합쳐 같은 결과를 돌려준다. `context.preview`는 draft content hash까지 같은 요청만 합친다.
- 예산: 파일 수·바이트·시간 예산을 둔다(구현 조절값). 넘으면 거기서 멈추고 `omissions`를 결과에 싣는다. 일부만 훑고 전체를 훑은 것처럼 꾸미지 않는다. 예외로 `context.preview`는 `omissions` 자리가 없는 읽기이므로 넘으면 `unavailable`이다(개체 수를 일부만 센 채 돌려주지 않는다).
- 결과 제출: core와 같은 framed IPC를 쓰고 `bundle.finish_check`·`context.record_violations`는 좁은 machine credential로 제출한다. 원래 요청의 context·bundle 근거를 결합하며 command가 현재 적용 판과 맞는지 다시 검사한다. worker가 직접 `lophn.db`를 열지 않는다.
- app-data: worker는 앱 read command를 부르지 않는다. `context.check`와 `context.preview`는 app-data kind의 모양(계약 안의 command 이름·결과 field)만 검사하고 앱 데이터는 읽지 않는다.

## 3. 저장

### 3.1 정본과 파일 위치

| 위치 | 내용 | owner·쓰기 규칙 |
|---|---|---|
| `~/.lophn/lophn.db` | 아래 documents ledger 표, 공통 events·command 결과 | core의 해당 documents 모듈만 도메인 표를 변경; 실제 writer는 platform command 하나 |
| 사람이 고른 Project 루트 | 현재 원본 파일 | 사람 파일 통로 또는 외부 편집기; ledger와 별도 생애 |
| `~/.lophn/documents/working-copies/<doc>/` | 대표 파일·첨부, 미확정 편집, 연 판·module 근거의 작은 작업 metadata | 원본 없는 문서의 사람 편집; 자동 tracking·derived GC 대상 아님 |
| `~/.lophn/documents/staging/` | 준비 stream·업로드·format 입력의 임시 파일, `context-check/<check>/`의 check snapshot(check가 끝나면 지운다) | 준비 worker; 미완료 staging은 재시작 때 정리, 확정 blob은 직접 삭제하지 않음 |
| platform blob store | 원문 파일, 정규화 ContentFile 목록, 큰 diagnostics, 정확한 format 묶음, Series draft 입력, Context Bundle(계약·선언 검색·예시)과 check report | blob contract로 내구 설치·참조 등록; 문서 worker가 내부 경로를 직접 읽거나 쓰지 않음 |
| `~/.lophn/derived/contexts.sqlite` | context index: 훑은 파일 stat·개체·관계·위반 집합 | context worker가 유일한 writer, core는 별도 read 연결; 삭제·재생성 가능 |
| OS keychain·앱 DB | 이 concern의 데이터 없음 | secret은 받지 않으며 앱 DB를 검색용으로 복사하지 않음 |

working copy는 선택한 Version의 원문 바이트로 처음 만들고 그 이후 편집을 보존한다. 자동으로 최신 판을 다시 덮어쓰지 않는다. 새로운 최신 판과의 충돌이면 working copy를 남긴 채 새 기준을 사람에게 보여 준다. Project 원본의 경로·현재 연결 문서 대응은 `documents.source_path` 하나가 기준이며 file 목록·scan·편집이 같은 read를 사용한다.

| core 모듈 | ledger 표 |
|---|---|
| `documents/projects` | `projects`, `project_folders`, `project_tracking_patterns` |
| `documents/versions` | `documents`, `versions` |
| `documents/addressing` | `place_names`, `document_names` |
| `documents/series` | `series`, `series_instances`, `series_keys` |
| `documents/contexts` | `contexts`, `context_bundles`, `context_checks`, `saved_views` |
| `documents/terms` | `terms` |

`files.*`는 ledger transaction이 아니다. `file.record_result`가 공통 `events`에 `FileWritten`, `FileRenamed`, `FileDeleted`를 남기고 공통 command 결과로 중복을 막는다. 별도 파일 상태·관측 후보·PreparedVersion 표는 없다. Context의 개체·관계·위반 목록은 ledger 표가 아니라 derived다. ledger에는 Bundle 판, check 결과, saved view, 용어, 위반 수의 마지막 기록(`contexts.violation_count`, `violations_hash`)만 남는다. format 선언 역시 ledger entity가 아니며 Version이 참조하는 정확한 묶음은 blob 참조로 보존한다.

ContentFile은 상대 경로의 Unicode codepoint 순으로 정렬하고 `path, blob_hash, bytes, media_type, primary` 고정 필드 순서의 JSON 배열을 UTF-8로 encode한다. 공백·추가 필드 없이 같은 canonical encoder를 준비와 검증에 쓴다. `files_hash`는 이 목록 blob, `content_hash`는 같은 정규화 목록 바이트의 SHA-256이다. 원본 파일의 `original_hash`는 실제 원문 stream hash이며 목록 hash와 다르다. 원문을 LF·NFC 텍스트로 바꿔 blob에 저장하지 않는다.

### 3.2 context index (derived)

목차는 저장하지 않는다. 문서 안의 목차(제목 tree)는 쓸 때마다 결정적 outline parser가 그때 파싱하며 derived 표가 없다(5.4, documents/outline-and-search#Q9). 키워드 검색도 색인 없이 검색할 때 파일을 훑는다. derived로 남는 것은 context index 하나이고 정본이 아니다. 정본은 Project 파일(자료)과 ledger의 Bundle(계약)이다.

`derived/contexts.sqlite`는 context worker만 쓰고 core의 context reader는 별도 read 연결로 읽는다.

| 표 | 내용 |
|---|---|
| `index_state` | context별 적용 `bundle_hash`·마지막 scan 시각·결과(`complete \| partial \| failed`)·omissions |
| `index_files` | `(context, path)`별 size·mtime·extract에 쓴 `bundle_hash`·extract 상태(`ok \| failed`와 안전한 이유) |
| `index_entities` | `(context, ord)`별 type·key(id)·path·section key(있으면)·field 값(canonical JSON)·관계 간선 `links`(JSON)·source kind. `ord`는 추출이 낸 순서다 |
| `index_violations` | `(context, ord)`별 kind·rule·type·path·section·대상. 위반 집합이고 `ord`는 canonical 순서다 |

한 scan의 결과는 한 SQLite transaction에 쓴다. 같은 파일 내용과 같은 Bundle은 같은 행을 낳고 순서는 canonical이다. SQLite FTS5를 쓰지 않는다. 선언 검색은 index 행을 읽어 순수 함수로 평가하고, 표의 SQL index는 `(context, type, id)`와 `(context, path)` 같은 조회 열에만 둔다. `index_entities`의 기본키가 `(context, type, id)`가 아니라 `(context, ord)`인 것은 같은 type에 같은 key의 개체가 둘일 수 있어서다(unique 규칙이 그것을 위반으로 센다). 관계 간선은 별도 표 없이 개체 행의 `links`에 두므로 `index_relations` 표는 없다. 해석하지 못한 참조는 위반(`broken_link`, `relation_target_exists`)으로 센다. app-data kind의 개체는 index에 저장하지 않는다(검색할 때 port로 읽는다, 5.6).

**따라잡기.** tracking도 event 구독도 없다. 검색·context 열기·Overview 개수를 읽기 전에 reader가 `context.index`를 요청해 계약 경로를 싸게 다시 훑는다. `(path, size, mtime)`이 `index_files`와 같은 파일은 건너뛴다. 같은 context에 이미 도는 scan이 있으면 그 결과를 기다리고, 직전 scan이 끝난 지 2초 안이면 새로 요청하지 않는다. 기한 2초 안에 끝나지 않으면 있던 index로 답하고 결과에 `indexed_at`과 `stale: true`를 싣는다(초기 구현값. 파일 수에 맞춰 조절한다). 적용 Bundle이 바뀌면 다음 scan은 모든 파일을 다시 extract한다. 같은 size·mtime으로 내용만 바뀐 편집은 다음 변경 때까지 index에 안 보일 수 있다. stat만 쓰는 선택의 대가이고 hash 비교로 막지 않는다(documents/contexts#Q14). 사람이 열지 않아도 위반을 알리려고 context worker가 활성 context의 계약 경로가 든 폴더만 `Deno.watchFs`로 본다. 신호는 "그 context를 다시 훑으라"는 힌트로만 쓰고(500ms 동안 합침), 변화 비교·기록·event·화면 상태는 만들지 않는다. 신호를 놓쳐도 다음 검색·열기의 훑기가 따라잡는다. 계약이 바뀌거나 context가 보관되면 감시 폴더를 다시 정한다(documents/contexts#R23, 7.7).

**index를 읽는 읽기.** `context.entity`와 `context.series_next`는 `context.search`와 같이 core의 context reader가 `derived/contexts.sqlite`를 별도 read 연결로 읽고, 읽기 전에 위 따라잡기를 한다. `context.entity`는 `index_entities`에서 `(context, type, key)` 행을 `(context, type, id)` 조회 index로 찾고 그 행의 `links`로 관계 대상 행을 찾는다. `context.series_next`는 같은 type의 `index_entities` 경로 목록만 `series-next` 순수 함수에 넘기고 project 폴더를 따로 훑지 않는다. 둘 다 worker job을 더하지 않고 index를 갱신하지 못했으면 빈 결과로 꾸미지 않고 `unavailable`이다(다른 context 읽기와 같다). `context.preview`만 파일을 읽으므로 worker job이다(2.4).

**삭제·손상.** index 파일을 지워도 Bundle·saved view·용어·위반 수의 마지막 기록은 그대로다. 다음 요청이 전체를 다시 훑어 채우고, 기한 안에 첫 scan이 끝나지 않으면 빈 결과를 성공으로 꾸미지 않고 `unavailable`을 돌려준다. 사라진 파일의 개체는 다음 scan에서 지운다. 파일을 읽는 사이 identity·size·mtime이 바뀌면 그 파일은 이번 scan에서 `failed`로 두고 다음 scan에서 다시 읽는다.

목록은 ledger read로 고정한 작은 metadata와 index 개수를 조립하며 본문을 같이 싣지 않는다. API의 판·주체·format·hash·관측 정보는 내부 contract다. 사람 화면의 기본 노출은 documents/file-tracking#R9,R15·documents/versions#R9·documents/outline-and-search#R2~R4,R14와 shell/wording을 따른다. 지금 필요한 결과·다음 행동만 표시하고 기록·판 비교·처리 상세는 펼쳐 본다. 안쪽 개념 라벨을 그대로 노출하지 않으며 고정 화면 문구는 en message key로 전달한다. 관련 목록의 무효화·메모리 cache 재파생은 500ms 동안 합친다. 이동은 출발·도착 place를 둘 다 갱신하고 대상 불명 event는 전체 목록 cache를 무효화한다. cache를 채우려고 model call이나 agent run을 예약하지 않는다.

선언 검색의 pagination은 keyset cursor다. cursor는 `bundle_hash, query_hash, 마지막 정렬 값, entity id`를 묶는다. 다른 질의·입력의 cursor는 `invalid_input`, 그 사이 적용 Bundle이 바뀌었으면 `conflict`다. page 사이에 index가 바뀌어도 정렬 순서에서 cursor 뒤부터 다시 계산하므로 같은 개체를 두 번 주지 않지만, 그 사이 생기거나 사라진 개체가 보일지는 보장하지 않는다. 본문 cursor는 `ver, module_hash, section, include_children, 줄 위치, 줄 안 codepoint 위치`를 함께 가진다. 긴 한 줄도 12,000 codepoint씩 나누며 이어 읽기에서 겹침·누락이 없다. 다른 판·조건·범위의 cursor는 `invalid_input`, worker 재시작·안정 기준 유지 불가는 `conflict`다. 매 페이지 현재 scope를 다시 검사한다.

## 4. concern 배치표

| concern | 프로세스 | 모듈 | 저장 | 주로 쓰는 contract |
|---|---|---|---|---|
| documents/projects | core + coordinator·준비 worker | `documents/projects`, `tracking-rules`, `scan` | projects·folders·patterns, 메모리 scan | command·read·event 구독, 파일 준비 결과 |
| documents/file-tracking | coordinator·준비 worker + core 결과 handler | `documents/observation`, `files`, `preparation` | 원본·working copy·staging; 공통 events | 파일 쓰기·파일 준비 결과, 인증·blob·command |
| documents/versions | core + 준비 worker | `documents/versions`, `preparation` | documents·versions·원문/목록 blob | 파일 준비 결과, command·read·blob |
| documents/formats | format runner + coordinator host | `documents/formats`, `format-runner` | 정확한 module blob·fixture | format 실행·blob |
| documents/outline-and-search | core read + 준비 worker | `documents/outline-and-search`(`outline`, `keyword-search`, `read`, `diff`); outline parser는 `packages/contracts/documents/` | 없음(목차·색인 저장 없음) | outline·search 읽기, read·blob·redaction |
| documents/series | core read·command + 준비 worker | `documents/series`, `series-order`, `series-next` | series·instances·keys·draft blob | outline·search 읽기, read·command·format 실행 |
| documents/addressing | core + coordinator section lookup | `documents/addressing` | place_names·document_names | read·command, outline·search 읽기 |
| documents/contexts | core(command·read·선언 검색 실행) + context worker | `documents/contexts`(`extract`, `checks`, `search`, `check`) | contexts·context_bundles·context_checks·saved_views; Bundle·report blob; derived/contexts.sqlite | read·command·blob·notification, app-data port |
| documents/terms | core | `documents/terms` | terms | command·read |

leaf concern은 9개이며 빠진 leaf는 없다. `documents/contracts`는 위 네 소유 contract의 schema·결과 검사를 모으고 테스트는 각 모듈 옆에 둔다. 다른 concern의 표를 직접 조회하는 repository를 worker에 넣지 않는다.

## 5. 내놓는 contract

모든 RPC는 `POST /v1/<resource>/<method>`다. 공통 envelope·HTTP error mapping·인증·큰 내용 전송은 platform의 API·인증·blob contract를 따른다. 다음 표는 documents가 소유하는 실제 경로와 동작이다. 큰 바이트는 blob contract의 준비 참조로 받은 뒤 worker에서 stream으로 읽고, JSON에 본문 전체를 중복 싣지 않는다. 파일 쓰기는 JSON RPC를 받더라도 ledger command queue로 보내지 않는다.

### 5.1 파일 준비 결과

| 경로 | 동작 |
|---|---|
| `/v1/documents/upload` | `upload` kind. coding agent·사람·앱(자기 출력, 자기 app credential)이 제출한 파일 하나의 바이트(body)를 입력의 hash·크기와 맞춰 blob 준비 중계로 보내 요청 credential 주체의 준비 참조를 돌려준다; 이어지는 `/v1/documents/prepare`의 파일 입력이 된다 |
| `/v1/documents/prepare` | 저장 입력·기준을 blob과 FormatValidationResult로 준비; 아직 Version 없음 |
| `/v1/documents/save` | 동일 준비 경로 뒤 `document.save`; PreparedVersion만 받은 내부 제출도 이 handler가 검증 |
| `/v1/documents/restore` | 선택 고정 판을 준비하고 `document.restore`; 원본 연결이면 사람 파일 쓰기·관측 근거 필수 |
| `/v1/projects/preview_tracking` | 정확한 폴더·규칙·base_revision의 TrackingPreview; page 단위 반환 |

**입력.** 원래 credential, 기존 `doc`·`base_version` 또는 신규 예정 `doc`·metadata, 파일 목록·대표 파일·내용 참조, FormatRef와 idempotency key를 받는다. 파일 관측은 `project, project_revision, path, document_revision, file_source, active, original_hash, observed_at`의 FileObservationBasis도 필수다. 신규 path의 연결 문서 미존재를 비교한다. app·release·run·actor는 인증된 근거로 확인하며 본문 주장으로 받지 않는다.

**처리.** 준비 worker는 안전한 상대 경로·유일 경로·대표 파일 하나·바이트 수를 검사하고 같은 stream을 hash와 blob staging에 넣는다. 내구 blob 완료, canonical 목록, 정확한 format 검사를 끝낸 후 `files_hash, file_count, primary_path, content_hash, files(ContentFile과 파일별 preparation_ref), format, validation, preparation_ref`를 낸다. `document.save`는 `files`로 같은 tx에서 `version_files` 행과 경로별 원문 blob 참조(`document_version.file`, owner_key `<version>/<path>`)를 목록 blob 참조 옆에 등록한다. 등록하지 않으면 준비 참조 수명(10분)이 지나 원문이 사라진다. 같은 내용의 재저장은 새 판도 새 참조도 만들지 않는다. 같은 바이트의 준비 참조는 principal·purpose·hash마다 하나(10분)라, core blob relay가 살아 있는 준비(원문·목록 blob)를 돌려주고(coding-agent Q24) 관측 worker는 같은 바이트의 동시 준비를 한 번만 보낸다. `preparation_ref`는 신뢰한 worker의 결과와 원래 요청·기준·blob을 묶은 작은 참조다. core는 이 참조와 작은 CAS만 검사하고 큰 목록을 다시 읽거나 hash하지 않는다.

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

**출력.** FileOperationResult는 `written | renamed | deleted | unverified`, 전후 경로·hash, 작업 뒤 관측 시각/hash·`changed_again`, `recorded | unverified`, 그리고 `not_requested | preparing | validation_failed | conflict | confirmed`의 version_result를 따로 반환한다. 후속 결과는 같은 request_key로 연결하되 worker 재시작 뒤 조회 가능성을 보장하지 않는다. 파일 성공 응답을 먼저 줄 수 있다. file 결과의 event actor는 machine이며 원래 user 요청 근거를 유지한다.

**오류.** base_hash 불일치·새 목표 존재는 `conflict`·HTTP 409, 디스크 권한·read-only·용량·quota·안전한 원자 교체 불가는 `unavailable`·HTTP 503이다. 잘못된 목표는 `invalid_input`, user가 아닌 요청은 `forbidden`이다. 경로·hash·안전한 OS 오류만 log·감사 payload에 넣고 편집 본문은 넣지 않는다.

**보장.** 시작과 교체 직전에 hash를 비교하고 확인된 충돌에는 쓰지 않는다. 성공한 각 작업을 `file.record_result`로 보고하여 `FileWritten`, `FileRenamed`, `FileDeleted`를 남긴다. 같은 편집 세션의 두 작업도 두 결과다. 자동 저장은 파일 쓰기만이고 명시 저장·편집 종료가 version 준비 경계다.

**구현 모양.** core는 user 자격과 원문 출처 — 준비 참조(요청 주체가 upload로 만든 `document_file` blob) 또는 옛 판 파일의 원본 참조(`existing`, 저장과 같은 규칙으로 그 판의 `version_files` 행과 `document.file` 접근을 확인하고 위조·접근 밖은 없는 것과 같은 `invalid_input`) — 를 확인하고 원문을 I/O worker에서 읽어 byte chunk frame으로 coordinator에 보낸 뒤 같은 channel을 가리키는 요청을 보낸다. coordinator는 FileTarget을 등록 폴더(관측 근거의 folders — 활성 project의 모든 등록 폴더로 tracking을 껐어도 포함하고 관측 root와 따로다, 범위 밖·모르는 project는 없는 것과 같은 `invalid_input`) 또는 working copy 폴더로 풀고, 같은 canonical 목표의 요청을 줄 세워 준비 worker의 human slot에 맡기며, 성공한 작업을 machine credential의 `file.record_result`로 기록한다(idempotency key는 `(request_key, operation)`에서 만든다). 읽기는 한 JSON frame에 싣지 않는다: core가 헤더(hash·크기·파일 identity)를 받고 창(256 KiB)을 하나씩 요청하면 준비 worker가 identity를 다시 확인하고 응답 전에 byte chunk frame으로 보내며, core는 소비자가 당길 때만 다음 창을 요청해 sha256을 이어 계산하고 끝에서 헤더와 다르면 응답을 끊는다(상한은 문서 upload 상한). `files.watch`는 마지막 관측이 바뀌거나 기한(10초)이 지나면 답한다. 이름 변경은 새 이름을 hard link로 no-replace 설치한 뒤 옛 이름을 지운다(중간에 끊기면 두 이름이 같은 파일을 가리킬 뿐 내용을 잃지 않는다). 쓰기 중 임시 파일은 같은 폴더의 `.lophn-write-*.tmp`이고 tracking은 이 이름을 관측하지 않는다.

**working copy.** `~/.lophn/documents/working-copies/<doc>/`에 대표 파일 `content`와 작은 metadata `meta.json`(연 판, 대표 파일 경로·MIME, 마지막 확정 내용 hash)을 둔다. 첫 쓰기에서 폴더와 metadata를 만들고 core가 ledger에서 읽은 근거(원본 연결 없는 활성 문서, 연 판의 대표 파일)로만 만든다. `version_request`가 있으면 core가 사본 쓰기 성공 뒤 **요청한 사람의 자격으로** `document.prepare`·`document.save`를 따로 시도하고(`base_version` CAS) 결과를 `version_result`(`confirmed | validation_failed | conflict | preparing`)로 낸다. 새 최신 판과 충돌해도 사본은 남는다. project 파일의 `version_request`는 관측 loop가 쓴 파일을 판 하나로 기록하므로 `preparing`이고, tracking을 끈 폴더는 관측하지 않아 `not_requested`다. 판 확정이 `conflict`이면 결과의 `latest_version`이 그 문서의 지금 최신 판이다.

**보장하지 않는 것.** 외부 편집기와 공동 잠금, 마지막 비교와 교체 사이 외부 쓰기 차단, 파일·ledger 단일 transaction은 없다. 교체 뒤 재관측으로 다시 바뀜을 표시한다. 응답 유실·결과 불명에 자동 재쓰기하지 않는다. 이미 성공한 파일 바이트를 format 실패 때문에 이전 내용으로 바꾸지 않는다.

문서를 파일로 두기와 빼기는 같은 route 안의 선택 의도다(새 route는 없다). `files.write`의 `place: { document, version }`은 새 project 파일(base_hash null)에 그 문서 최신 판의 유일한 파일(content의 `existing` 원본 참조)을 쓰고, `files.delete`의 `unlink: { document }`는 확인 handle이 묶는 대상(request_key, target, base_hash)을 그대로 두고 지운 뒤 연결을 푼다. core가 쓰기·삭제는 coordinator 경로로 하고, 연결 확정은 요청한 사람의 자격으로 command를 직접 부른다. 두기: tracking이 꺼진 Project는 허용하지 않고, 패턴 밖 경로의 규칙 변경 미리보기는 파일을 쓰기 전에 하며, 쓰기 전부터 원본 연결이 확정될 때까지 core가 그 경로를 메모리에 잡는다(그 사이 같은 경로의 파일 관측 첫 저장은 conflict). 파일을 no-replace로 쓴 뒤 `document.set_source`, 패턴 밖이면 그 파일 하나의 include를 `project.set_tracking`으로, 자리 없는 문서면 `document.move`를 각각 그 순간의 현재 CAS로 확정한다. 원본 연결이 추적 규칙보다 앞서므로 패턴 밖 파일은 연결된 뒤에야 관측된다. 앞 단계가 실패하면 뒤 단계는 시도하지 않고 파일은 남기며, 단계별 결과는 FileOperationResult의 `placement`(source, tracking, move)에 따로 싣는다. 빼기: 사람이 확인한 디스크 hash가 최신 Version의 원문과 같고 디스크도 같은 경우에만 삭제하고(다르면 conflict로 파일과 연결을 그대로 둔다), 이어서 `document.set_source(null)`, `document.move(null)`을 각각 확정해 `unlinking`에 싣는다. 파일이 이미 없으면 지울 것 없이 연결 해제로 간다(outcome은 unverified, 기록·event 없음). place 이동만으로 파일을 이동하거나 source를 바꾸지 않는다.

### 5.3 format 실행

| 경로 | 동작 |
|---|---|
| `/v1/formats/list`, `/v1/formats/get` | 내장 declaration, MIME·구조·metadata 요구·template·guide·examples·vocabulary |
| `/v1/formats/validate` | 고정 module의 validate; 저장이나 변경 event 없음 |
| `/v1/formats/extract` | 신뢰한 문서 처리의 고정 module extract; 저장하지 않는 결과, Version 없음 |

**입력.** 정확한 module_hash, validate/extract operation, 실제 파일 목록·대표 바이트와 input_hash, 명시 여부를 받는다. 기존 Version은 이름으로 최신 module을 찾지 않는다. 내장 document는 `text/markdown`, `text/x-markdown`, `text/html`, `application/xhtml+xml`, `text/plain`; pdf는 `application/pdf`, image는 `image/*`, data는 나머지 원문을 받는다. plain text는 heading을 만들지 않고 텍스트 읽기·검색만 한다. pdf·image·data는 첫 구현에서 section 추출이 `unsupported`다.

**출력.** validate는 input_hash·module_hash·passed/failed·error/warning diagnostics와 파일·줄·열 위치를 반환한다. extract는 `ready | unsupported | unverified | failed`, 대표 텍스트·title·section key·parent·position·level·anchor·own_ranges·subtree_range·characters·body_hash를 반환한다. host는 출력 크기·key 유일성·범위·부모 존재·비순환을 다시 검사한다. ready의 빈 sections와 unsupported를 구별한다.

document module 자체가 UTF-8 decode → BOM 제거 → LF → NFC를 적용하고 Markdown ATX·setext, YAML front matter·fenced code·HTML pre 제외, HTML 원본 h1~h6와 hidden 구역 제외를 구현한다. 유일한 h1은 title로 빼고 서문은 `_preamble`이다. 명시 anchor 우선·자동 slug·같은 부모 suffix·전체 경로 key·heading 제외 본문 hash 규약을 이 묶음 한 곳에 둔다. 문서 읽기·diff가 같은 규약을 중복 구현하지 않는다. 같은 heading 규약은 목차를 그때 파싱하는 outline parser(5.4)도 따르며, 두 구현은 같은 fixture를 함께 통과해야 한다. 초기 document body_hash는 own_ranges의 heading 제외 본문을 LF로 연결하여 hash한다. 자식 변화는 자식 section 또는 문서 전체 watch로 읽는다.

**오류.** 잘못된 입력·지정 format 구조 error는 `invalid_input`, 정확한 module 누락·runner 종료·한도 초과·출력 계약 위반은 `unavailable`과 안전한 이유다. 추출 실패는 원문 읽기를 막지 않고 `unverified` section 상태와 원문 참조를 제공한다.

**보장.** 2.2의 새 guest·권한 없음·fixture·출력 검사를 통과한 같은 module·바이트는 같은 정규화 결과다. module은 Version·Series draft 참조가 남는 동안 blob contract로 보존한다.

**보장하지 않는 것.** 내용의 진실성·같은 key의 영구적 의미·HTML 동적 DOM 구조·미지원 format의 가짜 section·누락 module의 새 module 대체는 보장하지 않는다.

### 5.4 outline·search 읽기

| 경로 | 입력 → 출력 |
|---|---|
| `/v1/outline/root` | 예산·cursor → Project·App 목적/건수·자리 없는 문서 묶음 |
| `/v1/outline/place` | PlaceRef·예산·cursor → 작은 문서 목록·고정 선택 판·format·발췌 |
| `/v1/outline/document` | ID/Address·ver·depth·예산 → 고정 ver의 section 통계·범위·body_hash·트리. 원문을 읽어 outline parser가 그때 파싱하며 저장하지 않는다 |
| `/v1/outline/series` | ser 또는 place/name·cursor → series.get과 같은 기준·순서의 멤버 목록 |
| `/v1/documents/read` | 고정 참조·section·include_children·줄 범위·cursor → ReadResult |
| `/v1/documents/file` | 고정 ver·ContentFile 상대 경로 → 허용된 blob 읽기 참조·저장 MIME·바이트 수 |
| `/v1/documents/history`, `/v1/documents/section_history` | doc·from/to·key → 고정 판 목록·같은 key 변화 |
| `/v1/guides/list`, `/v1/guides/get`, `/v1/guides/outline`, `/v1/guides/read` | 설치 manifest의 lophn_version·content_hash 고정 참조·section/범위/cursor → BundledGuide 목록·같은 설치 안내 판의 목차·본문; offline·읽기 전용 |
| `/v1/documents/diff` | 두 고정 ver·section? → core 밖에서 계산한 줄 단위 diff·누락 |
| `/v1/search/query` | 문자열·project·cursor → Project의 md 파일을 그때 훑은 path·줄 범위·snippet·omissions |
| `/v1/contexts/search` | context·검색 이름·inputs·cursor·page_size → 선언 검색 결과(행의 개체 ref·cell·path 링크)·total·bundle_hash·complete |
| `/v1/series/list`, `/v1/series/get`, `/v1/series/next` | place 또는 ser → 가족 구성·멤버·NextSuggestion |

**읽기 처리.** 최신은 먼저 platform read로 선택해 고정 ver로 바꾼다. outline의 그 ver를 section·본문 cursor까지 유지하고 latest_version은 따로 표시한다. 목차는 저장도 cache도 없다. 준비 worker가 그 판의 원문 blob을 읽어 outline parser로 그때 파싱하고, 전체 scan을 기다리지 않는다. 같은 입력은 같은 tree이고 section key·범위·body_hash 규약은 parser 한 곳이다. 성공 파싱에 key가 없으면 `missing`, 미지원은 `unsupported`, 실패는 `unverified`다. 원문 파일은 blob contract로 저장한 MIME·바이트를 읽으며 agent 출력은 redaction을 우회하지 않는다.

**outline parser.** `packages/contracts/documents/outline-markdown.ts`의 순수 함수 `parseOutline(mediaType, text)`다. UTF-8 decode → BOM 제거 → LF → NFC 뒤 ATX·setext heading을 읽고 YAML front matter·fenced code를 제외하며, 유일한 h1은 title로 빼고 서문은 `_preamble`로 둔다. 명시 anchor 우선·자동 slug·같은 부모 suffix·전체 경로 key·heading 제외 본문 hash는 5.3의 document module과 같은 규약이다. 지금은 `text/markdown`·`text/x-markdown`만 해석하고 다른 형식은 `unsupported`를 돌려준다(형식마다 parser를 붙일 자리만 열어 둔다). 의존성·시각·무작위·IO가 없어 shell editor(Outline)와 `documents/contexts`(`outline`·`section` kind), 준비 worker가 같은 코드를 부른다. 각 heading의 줄 범위를 함께 돌려주므로 section 본문 field도 이 결과로 자른다.

root 예산 1,500, place 3,000, document outline 2,000 estimated token·depth 2, 본문 12,000 Unicode codepoint를 초기 기본으로 쓴다. 추정 token은 codepoint 수/3의 올림이며 실제 model token이 아니다. 초과 시 complete=false·cursor·숨긴 자식 수를 반환한다. 목록에는 본문·agent용 절대 경로·현재 파일 상태를 넣지 않는다. 사람의 Project 폴더 행에서는 files 통로로 파일 트리를 열고 그 파일을 문서 목록에 중복 나열하지 않는다.

**키워드 검색.** 색인이 없다. `search.query`는 Project의 md 파일을 검색할 때 그때 훑는다(documents/outline-and-search#Q9). 준비 worker의 human slot이 등록 루트를 걸으며 `.gitignore`·숨은 폴더·lophn 데이터·루트 밖 symlink를 제외하고, 형식 범위는 outline과 같다(md). 각 파일을 stream으로 읽어 NFC로 정규화한 뒤 locale과 무관하게 대소문자를 구분하지 않는 부분 문자열로 비교하고 path·줄 범위·snippet을 돌려준다. 정렬은 일치 수 내림차순, 같으면 path의 Unicode codepoint 순이다. 파일 수·바이트·시간 예산을 넘으면 거기서 멈추고 `omissions`(훑지 못한 이유)와 cursor를 돌려준다. 보관 Project와 권한 밖 Project는 후보 단계에서 제외한다. 모든 길이의 질의가 같은 규칙이다. embedding·model 검색은 없다.

**선언 검색.** `contexts.search`는 적용 Bundle의 선언 검색 하나를 inputs와 함께 실행한다. 실행기는 `packages/documents/contexts/search`의 순수 함수(index 개체·관계 + 선언 + inputs → 결과)이고 core의 context reader가 부른다. worker·IPC·network를 거치지 않는다. 순서: (1) 권한과 context 상태 확인(보관·권한 밖은 `not_found`/`forbidden`), (2) 적용 Bundle 선택, (3) inputs를 선언의 inputs 형식으로 검사(어긋나면 `invalid_input`), (4) index 신선도 확보(3.2), (5) derived read 연결에서 그 context의 개체·관계를 읽어 순수 함수 실행, (6) 결과에 `bundle_hash`, `indexed_at`, `stale`, `omissions`를 싣는다. 선언형 query(from·where·관계 따라가기·sort·group)만 있고 사용자 script는 없다(documents/contexts#Q10). 같은 index·Bundle·inputs는 같은 결과와 순서다(동점은 entity id). 순수 함수가 core의 실행 흐름을 막지 않도록 index 개체 수와 결과 page에 상한을 두고(구현 조절값), 상한을 넘는 index는 `omissions`로 드러낸다. 결과의 도메인 개체는 path(와 section key)를 담아 shell이 Project 문서 탭으로 연다. 다른 context의 개체를 선언이 가리키려면 그 context가 public으로 내놓은 type·field만 쓴다. 이는 계약 검증이 판 check에서 이미 막았으므로 실행기는 다시 넓히지 않는다.

root는 활동 순, place는 갱신 순으로 시작하고 seq·ID로 동점을 결정한다. 기본 목록·검색은 현재 ledger에서 보관 문서·보관 자리를 제거한다. 고정 판 직접 읽기는 유지한다. 권한 밖 ID는 후보 단계에서 제거한다. 제목·snippet·본문뿐 아니라 count·rank·pagination도 허용 집합에서만 계산한다. cache의 scope를 현재 허락처럼 쓰지 않는다. Context inclusion·옛 Address·blob hash만으로 범위를 넓히지 않는다. redaction 뒤에도 고정 판·원래 범위·redacted를 유지하며 안전한 출력이 불명이면 본문을 뺀다.

**saved view.** saved view는 선언 검색 호출(검색 id와 고정 inputs)에 이름을 붙인 ledger 사실이며 context에 속한다(`saved_views`). 저장·변경·삭제는 `view.save`, `view.update`, `view.delete`다. 열 때마다 선언 검색을 다시 실행하고 결과를 저장하지 않는다. 사람이 검색 결과에서 저장하거나 Context Engineer가 미리 두며(저장·변경은 user와 Context Engineer, 삭제는 user), 삭제는 행만 지우고 그 before 값은 event에 남는다. 일반 조건(제목·본문·format·기간·보관 상태)으로 만드는 saved view는 없다. 그런 조건은 키워드 검색으로 그때그때 한다. 계약이 바뀌어 검색 id나 inputs 형식이 깨지면 그 saved view가 걸리도록, check는 후보 Bundle에 대해 모든 saved view의 검색 id·inputs를 검사한다(실패하면 적용이 막힌다).

**series 다음 계산.** `series.next`는 core read 모듈에서 scope·같은 snapshot의 가족 revision·멤버·예약 key·draft를 읽는다. 많은 멤버의 자연 정렬과 NextRule 계산은 준비 worker의 순수 `series-next`에 맡겨 write queue 밖에서 끝낸다. 화면과 MCP·CLI는 이 답을 쓰고 계산을 재구현하지 않는다. 표시 정렬·descending과 무관하게 key 자연 순의 마지막 확정 멤버(보관 멤버 포함)를 기준으로 한다. draft는 마지막 멤버가 아니다. 빈 가족·해석 불가 날짜 key·안전 정수 overflow는 빈 제안이다. 정수 ±step, major/minor/patch, 1~4자리 zero padding만 계산하며 from·taken·document_name·series_revision을 반환한다. 조회는 key·doc·파일을 예약하지 않고 가입 때 다시 CAS한다.

**이력·diff.** 같은 module의 key·body_hash 비교는 순수 `section-comparison`에 둔다. 의미 rename·유사도 chain은 없다. 잘린 시작 판은 직전 판도 읽고 소실 행은 살아 있는 행 뒤에 둔다. 줄 diff는 준비 worker에서 bounded Myers 방식으로 계산하고, 계산 한도를 넘으면 변경 블록 단위로 나누어 이어 읽게 한다. blob 복원 불가는 누락으로 표시하고 빈 본문으로 성공을 꾸미지 않는다.

**오류.** 조건·cursor·다른 ver의 범위는 `invalid_input`, 허용 대상 없음은 `not_found`, cursor가 가리키던 Bundle이 바뀐 것과 안정 기준 유지 불가는 `conflict`, blob·module 접근 실패·worker 적체는 `unavailable`이다. 자격 오류는 인증 contract를 따른다.

**보장.** 단계적 읽기의 고정 판·범위 유지, 매 page의 scope 검사, 실패·미지원·지연 표시, index 삭제·재생성의 정본 불변을 보장한다.

**보장하지 않는 것.** 키워드 검색이 예산 안에서 모든 파일을 훑었다는 것(`omissions` 제외), 같은 size·mtime으로 바뀐 파일의 즉시 반영, 여러 문서의 공동 commit 시점, section 의미 대응, 선언 검색 두 page 사이에 같은 index가 유지되는 것을 보장하지 않는다.

### 5.5 도메인 command·read 경로

다음 이름을 platform command·read handler에 등록한다. domain model의 입력·CAS·actor·event를 그대로 쓰며 긴 준비를 이 handler 안에 넣지 않는다. 표의 모든 경로는 POST다. `create`는 ID 미존재, `update`·구성 변경·보관은 base_revision, 새 Version은 base_version을 비교한다. 이름·key 예약은 같은 transaction에서 검사한다. 공통 오류는 5.1~5.4와 platform error mapping을 따른다.

| resource와 method 경로 | 등록 이름 |
|---|---|
| `/v1/projects/create`, `/update`, `/set_tracking`, `/archive`, `/unarchive` | `project.create`, `project.update`, `project.set_tracking`, `project.archive`, `project.unarchive` |
| `/v1/projects/list`, `/get`, `/resolve`, `/resolve_cwd`, `/tracking_roots` | 저장 문서 중심 Project read; 사람만 폴더 경로·tracking 값 포함; resolve는 꺼진 중첩 폴더도 가장 깊은 등록 루트로 해석; resolve_cwd는 coding agent의 고정 cwd로 project ID만; tracking_roots는 machine의 활성·켠 root |
| `/v1/documents/update`, `/set_source`, `/archive`, `/unarchive`, `/move`, `/rename` | `document.update`, `document.set_source`, `document.archive`, `document.unarchive`, `document.move`, `document.rename` |
| `/v1/documents/list`, `/get`, `/resolve`, `/export` | 현재 metadata·고정 판·Address 예약 해석·사람의 Markdown/JSON 및 원문 export |
| `/v1/contexts/create`, `/archive`, `/unarchive` | `context.create`(user와 Context Engineer), `context.archive`, `context.unarchive`(user); context는 Project 하나에 속하고 Project마다 여럿이다 |
| `/v1/contexts/save_draft`, `/discard_draft`, `/submit_bundle` | `bundle.save_draft`(Context Engineer가 초안을 새로 쓰거나 덮어쓴다; 내용은 blob), `bundle.discard_draft`(user와 Context Engineer), `bundle.submit`(Context Engineer; 초안을 번호 있는 판으로 올리고 check를 시작) |
| `/v1/contexts/record_check`, `/record_violations` | `bundle.finish_check`(check report 기록, 통과하면 같은 transaction에서 자동 적용), `context.record_violations`(위반 수의 마지막 기록); 둘 다 `CONTEXT_WORKER_OPERATIONS`만 가진 좁은 machine 내부 제출 |
| `/v1/contexts/rollback` | `bundle.rollback`(이전 판을 다시 적용; user) |
| `/v1/contexts/save_view`, `/update_view`, `/delete_view` | `view.save`, `view.update`, `view.delete`(user) |
| `/v1/contexts/hand_off_violations` | `context.hand_off_violations`(위반 하나 또는 전부를 Context Engineer Run으로 넘김; user) |
| `/v1/contexts/list`, `/get`, `/overview`, `/contract`, `/draft`, `/search`, `/input_options`, `/violations`, `/bundles`, `/saved_views`, `/entity`, `/series_next`, `/containing` | 목록(적용·진행 중인 판 포함)·한 context와 적용 판 요약·type별 개체 수·적용 판의 계약·만드는 중인 판의 진행·선언 검색 실행(5.4)·검색 입력 후보·위반 목록과 근거·판 이력과 check 보고·saved view 목록(깨진 것 표시)·개체 하나의 field와 관계 대상·series type의 다음 이름·Project 파일 경로가 속한 context 역조회(문서 Info›Contexts); user와 Context Engineer가 읽는다 |
| `/v1/terms/set`, `/remove` | `glossary.set`(용어 + 뜻; 새 항목은 id·context, 기존 항목은 entry; user와 Context Engineer), `glossary.remove` |
| `/v1/terms/list` | `glossary.list`(context별 용어집 전부, 용어 순) |
| `/v1/series/create`, `/update`, `/set_draft`, `/clear_draft`, `/add_instance`, `/update_instance`, `/remove_instance`, `/archive`, `/unarchive` | 대응 `series.*`; create·update·add_instance·update_instance는 user와 허용 coding_agent·app, 나머지 가족 변경은 user, lophn agent 가족 mutation 없음 |

표의 `/update` 같은 짧은 표기는 그 행의 resource를 반복한 전체 경로다. project.create는 tracking.enabled=false만 허용하며, project.update로 folders를 바꾸는 경우도 project.set_tracking과 같은 미리보기의 정확한 folders·tracking·base_revision을 검사한다. Document 최초 save와 Series 첫 가입을 같이 요청하면 두 모듈의 검사를 같은 ledger transaction에 적용하고 일치 draft를 비운다. Series 구성·draft는 source 파일이나 Version 없는 Document가 아니다. 기존 멤버 수정은 같은 doc의 새 ver이며 멤버 추가가 아니다. Operator의 기존 출력 doc 범위를 Series 도입으로 넓히지 않는다.

Bundle은 context마다 순번을 가진 판이고 상태와 전이는 domain model(documents/contexts)이 정한다. `bundle.submit`은 `base_bundle`을 CAS로 비교해 후보를 기록하고, 그 뒤 core가 `context.check` job을 보낸다. `bundle.finish_check`는 report의 `bundle_hash`가 후보와 같고 그 context의 적용 판이 제출 때의 `base_bundle`과 같을 때만 받는다. 통과면 같은 transaction에서 그 판을 적용 판으로 올리고 이전 판을 남긴다. 사람 승인 단계는 없다(읽기만 하는 계약이라 바깥 효과가 없다). 실패는 이유를 남기고 적용을 막는다. 사람이 문서를 계약 밖으로 고친 것은 report의 위반 수로 셀 뿐 적용을 막지 않는다. Context Engineer가 계약을 망가뜨린 것(계약 검증·예시·saved view 실패)과 구별하는 것이 check의 일이다. `bundle.rollback`은 이미 check를 통과한 이전 판을 다시 적용하며 다시 check하지 않는다.

문서 영역의 실제 event 이름은 다음과 같다. 목록 read·추출·index 재생성·series.next에는 변경 event가 없다.

- Project: `ProjectCreated`, `ProjectUpdated`, `ProjectTrackingChanged`, `ProjectArchived`, `ProjectUnarchived`.
- Document: `DocumentCreated`, `DocumentSaved`, `DocumentUpdated`, `DocumentSourceChanged`, `DocumentArchived`, `DocumentUnarchived`, `DocumentRestored`, `DocumentMoved`, `DocumentRenamed`.
- 파일: `FileWritten`, `FileRenamed`, `FileDeleted`.
- Context: `ContextCreated`, `ContextArchived`, `ContextUnarchived`, `ContextBundleDraftSaved`, `ContextBundleDraftDiscarded`, `ContextBundleSubmitted`, `ContextBundleCheckFailed`, `ContextBundleApplied`, `ContextBundleRolledBack`, `ContextViolationsRecorded`, `ContextViolationsHandedOff`, `SavedViewCreated`, `SavedViewUpdated`, `SavedViewDeleted`(이름과 payload는 domain model documents/contexts).
- Glossary: `GlossaryEntrySet`, `GlossaryEntryRemoved`.
- Series: `SeriesCreated`, `SeriesUpdated`, `SeriesDraftSet`, `SeriesDraftCleared`, `SeriesInstanceAdded`, `SeriesInstanceUpdated`, `SeriesInstanceRemoved`, `SeriesArchived`, `SeriesUnarchived`.

### 5.6 app-data port

Context의 app-data kind는 앱의 read command 자체다. 문서 쪽 코드는 앱을 import하지 않는다. `packages/documents/contexts`는 port 하나(`AppDataReader`: 앱·command·inputs → 결과 행)만 정의하고, core 조립(`apps/core/documents.ts`)이 `packages/contracts/apps`의 read command contract로 adapter를 꽂는다. adapter는 검색을 부른 주체의 자격으로 호출하므로 앱 허락·역할·assignment 범위가 그대로 적용되고, context에 넣었다고 부를 수 있게 되지 않는다. 결과는 index에 저장하지 않고 호출한 그 검색에서만 쓴다. 첫 구현은 port와 fake adapter까지이고 실제 앱 read command 연결은 마지막에 붙인다(documents/contexts#Q16). 호출 실패·권한 없음은 그 개체 type의 결과를 `unavailable`로 표시하고 파일 기반 개체의 결과는 그대로 둔다.

## 6. 쓰는 contract

| 소유 | contract | 쓰는 곳 |
|---|---|---|
| platform | 인증 | 원래 actor·현재 scope·machine 작업 범위 확인; 준비 결과를 원래 요청에 결합 |
| platform | read | 규칙·source·Version·Context·Bundle·Term·Series·saved view, 현재 후보 scope |
| platform | command | 준비 Version 확정, 파일 결과 기록, Context Bundle 제출·check 결과 접수·자동 적용·위반 수 기록·중복 방지; 짧은 CAS transaction |
| platform | event 구독 | 규칙·source 갱신; 마지막 처리 위치에서 재연결 |
| platform | notification | `ContextViolationsRecorded`에서 위반 수가 늘었을 때 알림으로 바꾼다(platform이 소유한 trigger). documents는 event만 낸다 |
| platform | blob | 원문·목록·diagnostics·draft·정확한 module의 내구 설치·참조 등록·허용 읽기 |
| platform | redaction | agent·model·외부 export로 나가는 제목·snippet·본문; 원문을 변경하지 않음 |
| platform | approval | 정확한 위험 파일 작업의 승인 근거; worker가 자유 문장을 허락으로 해석하지 않음 |
| shell | confirmation window | 사람의 삭제·정리 결정 근거와 정확한 목표 확인 |
| apps | read command | Context app-data kind는 core가 꽂은 port로 앱 read command contract를 호출 |

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

Series draft가 있어도 첫 판 전에는 Document read 대상이 아니다. 같은 내용·정확한 계약은 unchanged이고 기존 멤버 내용 수정으로 가족 수가 늘지 않는다. 응답을 잃으면 같은 key·신규 doc ID로 결과를 재조회하거나 재전달한다.

### 7.4 context index 따라잡기

```text
reader(검색·context 열기·Overview): ensure_fresh(context)
 → core: 적용 Bundle의 contract를 blob에서 읽어 context.index 요청
 → context worker: 계약 경로 stat → size·mtime이 같으면 건너뜀 → 바뀐 파일만 extract
 → derived transaction: index_files·entities·relations 교체 + index_state
 → checks 실행 → index_violations 교체
 → reader: 순수 함수로 검색하거나 Overview 개수를 조립
 → 응답: indexed_at·stale·omissions

index 삭제/손상
 → 다음 ensure_fresh가 index_state 없음으로 전체 scan
```

파일 하나의 extract 실패가 scan을 멈추지 않는다. 그 파일만 `failed`로 남기고 결과에 omissions를 싣는다. 기한 안에 scan이 끝나지 않으면 reader는 있던 index로 답하며 `stale: true`를 표시한다. 선택 판 직접 읽기와 키워드 검색은 index를 기다리지 않는다.

### 7.5 outline → section → 본문과 키워드 검색

```text
호출자: outline.root → place 선택
 → core read + coordinator: 작은 목록에서 고정 ver 선택
 → 호출자: outline.document(ver, depth=2)
 → coordinator → 준비 worker: 원문 blob을 outline parser로 그때 파싱 → key·범위·크기
 → 호출자: documents.read(ver, key, include_children, range)
 → 준비 worker: 현재 scope 재검사·redaction → 본문 조각 + 같은 ver cursor

호출자: search.query(문자열, project)
 → 준비 worker(human slot): 등록 루트의 md 파일을 stream으로 훑기(예산)
 → path·줄 범위·snippet + omissions
```

outline 후 새 판이 생겨도 기존 cursor는 처음 ver를 읽고 latest_version은 따로 준다. 키워드 검색은 호출 시점의 파일을 읽으며 결과를 어디에도 저장하지 않는다. basis를 유지하지 못하는 이어 보기는 conflict로 재조회를 요구한다.

### 7.6 Context 판 제출 → check → 자동 적용

```text
Context Engineer(agent) 또는 user: contract·선언 검색·예시 초안을 blob으로 준비
 → core command: bundle.submit(base_bundle CAS) → ContextBundleSubmitted
 → core dispatch: context worker에 context.check (후보 Bundle + 그 context의 saved view 전부)
 → context worker: 계약이 가리키는 파일을 임시 snapshot으로 복사
     · 계약 검증(kind·field·relation·public 규칙, 경로가 루트 안)
     · extract → checks (위반은 셈만 한다)
     · 선언 검색의 예시 실행, 기대와 다르면 실패
     · saved view의 검색 id·inputs 검사
     · 시간·크기 예산
 → snapshot 삭제 → report(bundle_hash, snapshot_hash, 결과)
 → core command: bundle.finish_check — 후보와 base_bundle CAS
     통과 → 같은 transaction에서 적용(이전 판 보존) → ContextBundleApplied
     실패 → ContextBundleCheckFailed, 적용 없음
 → 다음 context.index는 새 bundle_hash로 모든 파일을 다시 extract

되돌리기
 → user: bundle.rollback(이전 판) → ContextBundleRolledBack
```

고치는 동안 Operator는 지금 적용된 판을 계속 쓴다. snapshot은 check가 도는 동안만 쓰는 임시 폴더이며 문서 Version이나 ledger 사실이 아니다. 같은 후보를 같은 파일 상태로 check하면 report가 같다(hash 결정적).

### 7.7 계약 위반 감지 → 알림 → Context Engineer

```text
context.index(검색·열기 전, 적용 직후 첫 scan, 계약 경로 파일 변경 신호): checks → index_violations
 → 직전 기록(contexts.violation_count·violations_hash)과 비교
 → 달라졌으면(늘거나 줄면) context worker가 context.record_violations(context, bundle_hash, count, violations_hash, 새 위반 key 일부)
 → core command: 현재 적용 bundle_hash·직전 기록 CAS → ContextViolationsRecorded
 → platform notification contract: 알림(누르면 그 context의 Violations)
 → 사람: Send to Context Engineer — lophn-agent가 contexts.violations read의 근거(어느 파일이 어느 규칙을 어겼는지)를 붙여 대화를 만든다
```

같으면 제출하지 않는다. 줄어든 경우도 마지막 기록을 맞추려고 제출하지만 notification은 늘었을 때만 만든다(documents/contexts domain model). idempotency key는 `(context, bundle_hash, violations_hash)`라 응답을 잃은 재제출이 event를 두 번 만들지 않는다. 위반으로 agent run을 시작하지 않는다.


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
| context.index 중 worker 종료 | 직전 index 유지(한 scan은 한 transaction) | 같은 context의 다음 요청이 다시 훑음; 진행 중 요청은 `unavailable`이고 자동 재전송 없음 |
| context.check 중 종료·snapshot 복사 실패 | 후보 Bundle은 submitted로 남음 | 결과 불명을 통과로 꾸미지 않음; 임시 snapshot은 시작 때 정리; 후보를 다시 check에 보냄 |
| bundle.finish_check 응답 유실 | 적용됐을 수 있음 | 같은 `(bundle, report_hash)`로 재제출; command 결과로 중복 방지 |
| check 통과 뒤 적용 전에 다른 판이 먼저 적용됨 | `base_bundle`이 달라짐 | `conflict`; 후보는 적용하지 않고 새 기준에서 다시 제출 |
| context.record_violations 응답 유실 | event가 있을 수 있음 | 같은 `(context, bundle_hash, violations_hash)`로 재제출; event 중복 없음; notification은 소유 contract가 복구 |
| 계약 경로가 루트 밖·symlink 탈출 | 읽지 않음 | 그 경로 제외; check에서는 계약 오류로 실패, 운영 중 index에서는 `failed` |
| 파일이 scan 중 바뀌거나 사라짐 | 읽기 전후 identity·size·mtime이 다름 | 그 파일을 이번 scan에서 `failed`로 두고 다음 scan에서 다시 읽음 |
| app-data port 호출 실패 | index와 무관 | 그 type의 결과만 `unavailable`; 파일 기반 결과는 그대로
| context index 파일 삭제·손상 | 정본·Bundle·saved view·용어·위반 수 기록 유지 | 3.2의 전체 재scan; 기한 안에 끝나지 않으면 `unavailable`(빈 결과로 꾸미지 않음); 선택 판 직접 read와 키워드 검색은 허용 |
| core 단절 | 새 인증·command 적용 불가 | 새 사람 파일 변경을 시작하지 않음; 이미 시작한 작업은 실제 결과 또는 unverified 반환; 재연결 후 자격·규칙·source를 읽고 재관측 |
| cursor 기준 소실·권한 변화 | 이전 cursor를 안정하게 유지할 수 없음 | conflict로 재조회; 권한 밖 제목·count를 반환하지 않음 |

core 시작·기존 앱 direct call은 문서 전수 scan·context 첫 scan 완료를 기다리지 않는다. 프로세스 재시작 때 working copy는 보존한다. `FileStatus`는 마지막 관측 기준일 뿐 현재 디스크의 영구 상태가 아니다. 준비·watch·파일 감사 결과가 불명인 경우를 성공·0·부재로 채우지 않는다.

테스트는 파일 3,000개 변경 중 다른 루트의 작은 저장·고정 판 read·core command를 호출하고, 읽는 중 atomic 교체·동일 size/mtime 수정·규칙 변경·source 재연결·보관·credential 회수를 섞는다. rename·delete 재생성, no-replace 경쟁, sync/교체 직전과 직후 종료, working copy 충돌, format 금지 접근·무한 loop·대형 출력, 키워드 검색의 한글·예산 초과, context index 삭제·같은 stat 재scan·check 중 파일 변경·`record_check`/`record_violations` 중복 재전달을 검증한다. 같은 fixture Project(`packages/documents/contexts/testdata/`)에서 extract → checks → search의 정답이 byte 단위로 같아야 하고, outline parser와 5.3의 document module은 같은 heading fixture를 함께 통과해야 한다. outline을 연 뒤 새 판을 저장해도 같은 cursor로 옛 판 전체가 겹침 없이 읽혀야 한다.

## 9. 이전과 달라진 것

- 이전: 파일 순회·hash·추출이 daemon의 실행 흐름과 저장 transaction 안에서 돌았다 / 지금: coordinator와 준비 worker 두 개, 호출별 format guest에서 끝내고 작은 준비 결과만 core에 낸다 / 이유: writer 하나를 유지하면서 무관한 읽기·command를 막지 않는다.
- 이전: 목차·section·본문을 derived에 색인하고 FTS5 검색과 재생성 queue를 뒀다 / 지금: 목차는 저장하지 않고 쓸 때 결정적 parser로 파싱하며 키워드 검색은 그때 파일을 훑는다 / 이유: 색인을 최신으로 둘 계기(version·tracking)가 없고 지우고 다시 만들 자료를 줄인다.
- 이전: format을 직접 import하고 Deno 권한 차단만으로 결정성을 주장했다 / 지금: 권한 없는 runner와 QuickJS WASM 새 guest에서 시간·난수·동적 실행을 제거하고 fixture·출력 검사한다 / 이유: OS 권한 차단과 순수 계산의 결정성은 다른 경계다.
- 이전: Context가 문서 항목의 평평한 목록이고 watch·perspective로 변화를 비교해 알렸다 / 지금: Context는 Project 파일 위의 결정적 계약과 선언 검색이며 위반 수가 늘 때만 알린다 / 이유: 사람이 문서를 계약 밖으로 고친 것은 program이 결정적으로 감지하고, 자료가 바뀐 것 자체는 알리거나 결정받지 않는다.
- 이전: 조회 전에 index flush를 기다리고 offset만 cursor에 넣었다 / 지금: 선택 ver를 직접 파싱하고 선언 검색은 keyset cursor에 Bundle·질의를 묶는다 / 이유: 전체 갱신을 기다리지 않으며 다른 판·질의의 cursor를 섞지 않는다.
- 이전: Home·기본 notes·수신 place를 만들고 origin 대응을 여러 곳에서 읽었다 / 지금: Project·App 또는 place 없음, doc별 working copy, documents.source_path 한 기준이다 / 이유: 자료의 자리와 디스크 경계를 분리한다.
- 이전: series 초안을 첫 Version 없는 문서로 저장하고 다음 이름을 화면·daemon에서 나누어 계산했다 / 지금: draft는 Series의 값이고 다음 계산은 read→준비 worker의 공용 순수 계산이다 / 이유: 미확정 작성 값과 독립 문서 가족을 구별하며 같은 기준의 제안을 돌려준다.
- 이전: saved view가 일반 조건(제목·본문·기간)을 저장했다 / 지금: saved view는 context의 선언 검색 호출을 저장한 것이고 계약 판 check에 걸린다 / 이유: 계약이 바뀌어 깨지는 view를 적용 전에 잡고, 일반 조건은 키워드 검색으로 그때그때 한다.
- 이전: 계약이 없었고 Context 항목은 사람이 고른 문서 목록이었다 / 지금: 계약·선언 검색을 판으로 묶어 격리 check를 거치고 통과하면 사람 승인 없이 자동 적용하며 이전 판으로 되돌린다 / 이유: 읽기만 하는 계약이라 바깥 효과가 없고, check가 Context Engineer의 실수와 사람의 문서 수정을 구별한다.
- 이전: v2에서 앱별 host journal·lease·실행 허가 단계·토큰 여러 종을 늘렸다 / 지금: ledger 하나·core writer 하나·재scan 가능한 메모리 후보와 derived cursor만 쓴다 / 이유: 문서 준비 비용을 격리하는 데 분산 ledger 장치가 필요하지 않다.

## Instructions 파일의 명시 등록

[Instructions]는 → lophn-agent/instructions의 exact 전역/project/app 파일 또는 사람이 연결한 지침 Document를 editor로 연다. global ~/.lophn/LOPHN.md는 data-root 재귀 tracking을 열지 않는 단일 파일 예외이고 Project/system place를 자동 생성하지 않는다. documents/file-tracking의 instruction_file target·관측 basis가 registration revision·source·hash·base_version을 비교해 documents/versions의 instruction_file source 판을 확정한다. 파일 부재는 첫 저장 전 지침 없음이고 agent가 빈 파일을 만들지 않는다. 사람 쓰기 결과와 version 확정은 기존처럼 별도다.

지침 대상 분류는 exact 등록/preset 첨부 참조로 확인한다. agent·coding agent·app의 문서 write/source 이동·출력 지정 우회는 거절하며 question으로 제안만 한다. 외부 사람 편집은 안정 관측으로 새 판을 만들고 복원은 새 Version이다. call마다 지침 최신 확정 판을 resolve하는 것은 agent runtime이며 파일·version 정본을 prompt snapshot 원본으로 복제하지 않는다. → documents/file-tracking#R19,R20, documents/versions#R19,R20, shell/editor#R17
