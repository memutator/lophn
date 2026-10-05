---
type: architecture
concerns: [platform]
---
# platform

## 1. 맡는 것과 맡지 않는 것

platform은 core 안의 API·command·read·event 배포·프로세스 감독과 공통 blob·인증·secret·redaction·approval·notification을 구현한다. 설정, 플랫폼 진단, 설치, backup, ledger migration도 맡는다. 플랫폼 사실은 `lophn.db` 하나가 원본이며 core의 ledger 실행기 하나만 쓴다.

다른 concern의 command는 그 concern 모듈을 core에 등록하여 실행한다. platform은 공통 transaction과 입구 검사를 제공할 뿐 그 entity의 상태 전이나 SQL을 다른 모듈에 복제하지 않는다. 앱 DB·release 적용·direct call은 apps, 원본 파일·format·search는 documents, 보고·snapshot·test 판정은 problems, model 호출·agent loop는 lophn-agent, MCP·CLI는 coding-agent, 사람 결정 UI는 shell 소유다.

보호하는 범위는 한 사람·한 머신의 사용자 소유 앱에서 생기는 버그·유출·권한 우회·로컬 웹 공격이다. 같은 OS 계정 장악, 관리자·kernel·runtime 취약점, 제3자 악성 앱과 악성 외부 coding agent의 OS 작업을 막는다고 보장하지 않는다. 문서·SDK·앱·외부 skill·log는 신뢰하지 않는다. 자료 문자열을 사람 결정·권한·실제 test result로 승격시키지 않는다.

## 2. 프로세스

### 2.1 실행 배치

```text
Electron main (shell) ── 상속된 비공개 pipe ── core (Deno, 데이터 root당 하나)
  │ user token은 main 메모리만                  │
  │ HTTP POST / WebSocket (Bearer)              ├ API event loop: 제한·인증·routing·감독
  └───────────────────────────────────────────→├ command 입장 → ledger writer Worker ×1
                                              │                   └ SQLite write 연결 ×1
MCP / CLI ─────── HTTP POST / WebSocket ───────→├ read 입장 → reader Worker ×2
                                              │                └ read-only 연결 각 1개
                                              └ event 배포: reader로 seq 따라잡기
                                                │ 상속 pipe: 시작·ready·정지·종료 관측
          ┌──────────────────┬──────────────────┼─────────────────┬─────────────────┐
          ▼                  ▼                  ▼                 ▼                 ▼
 platform I/O worker     문서 worker        test runner       agent runtime      앱 supervisor
 blob·backup·redaction   (documents)         (problems)        (lophn-agent)       (apps)
 keychain·진단           │ format child      │ test child       │ model 호출        └ 앱별 child
          │              └ derived           └ 격리 DB           └ tool 호출            └ 앱 DB
          └ 결과·준비 참조·관측은 HTTP command로만 core에 제출

shell main / MCP / CLI / agent runtime ── 앱 통로 ──→ 앱 프로세스 (core를 경유하지 않음)
```

core가 상시 감독하는 신뢰 child는 platform I/O worker, 문서 worker, agent runtime, 앱 supervisor, 그리고 kind 정책이 상시인 worker다. problems의 report collector와 test runner control은 상시 worker다. 실제 test를 실행하는 test child만 요청마다 bounded하게 띄운다. test runner처럼 요청 시 정책인 다른 kind도 배정 작업이 있을 때만 bounded하게 띄운다. Electron main이 core를 띄우고 지켜본다. core는 이 신뢰 child를 지켜보며 앱 child·format child·test child의 세부 감독은 해당 소유자에게 맡긴다. 창 닫기는 플랫폼 종료가 아니다. Electron main의 명시적 종료가 core 종료를 시작한다.

### 2.2 core의 내부 모듈과 스레드

코드 자리는 code-map을 따른다. command·read·event는 `packages/platform/ledger/`, 신뢰 child 감독은 `packages/platform/responsiveness/`에 둔다. 그 밖의 platform 모듈은 `packages/platform/` 아래 `api`, `identity`, `blob-store`, `secrets`, `redaction`, `approvals`, `notifications`, `settings`, `diagnostics`, `backup-and-migration`, `install-and-update`다. 다른 최상위의 ledger 모듈은 `packages/<concern>/ledger/`에 두고 registry가 command/read/event schema를 가져온다. 코드 경로에 작업 번호나 시기를 넣지 않는다.

- **API event loop.** Deno HTTP 서버가 `127.0.0.1`과 `::1`에만 bind한다. 기본 port는 7431이다. SQL·hash·파일 순회·압축·keychain 호출·앱 import를 여기서 하지 않는다. body를 유한하게 읽고 등록된 schema로 검증한 뒤 작은 메시지를 Worker에 보낸다.
- **writer Worker 하나.** Deno Worker 안의 내장 `node:sqlite`(SQLite 3.53, FTS5) 연결 하나가 유일한 정상 writer다. `journal_mode=WAL`의 실제 반환을 확인하고 `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`을 설정한다. command handler는 동기 함수이며 `Tx`만 받는다. `await`, 파일·socket·process handle, 중첩 transaction, 자체 commit을 허용하지 않는다.
- **reader Worker 두 개.** 각자 `readOnly:true` 연결과 `PRAGMA query_only=ON`을 사용한다. 응답 하나를 짧은 read transaction으로 만들고 그 snapshot에서 scope·관계·개수·`as_of_seq`를 함께 얻는다. SQLite 연결 객체를 스레드 사이에 공유하지 않는다. writer queue와 reader queue는 다르다.
- **event 배포.** commit 메시지는 새 head를 확인하라는 힌트다. 배포기는 reader에서 커밋된 event를 읽는다. commit listener 안에서 notification·index·앱 실행을 하지 않는다. 깨우는 메시지를 잃어도 seq 조회로 따라잡는다.
- **notification 반응 처리기.** core의 독립 비동기 루프가 `notifications` cursor부터 배치를 읽어 전용 machine command를 낸다. 본문 조립·OS 표시·model 호출은 하지 않는다.
- **감독.** 비동기 spawn·종료 통지와 작은 제어 메시지를 처리한다. 시작 확인을 기다리는 동안 API loop나 ledger transaction을 붙잡지 않는다. 로그 파일 쓰기도 platform I/O worker에 보낸다.

SQL import는 ledger/read 실행기에만 허용한다. core 모듈의 동기 파일 API·압축·외부 fetch·앱/format/model 구현 import는 정적 검사로 금지한다. worker가 없을 때 같은 코어 실행 흐름에서 대신 처리하는 fallback은 없다.

### 2.3 입장·실행 한도

다음은 첫 구현의 고정 안전 기본값이며 일반 설정으로 격리나 한도를 해제하지 않는다.

| 경계 | 기본값 | 초과 처리 |
|---|---|---|
| RPC JSON | 256KiB, 깊이 16, 전체 object/array 항목 4,096개 | `invalid_input`; 큰 내용은 prepared blob |
| 작은 command | 변경 행 최대 1,000개, CAS 대상 최대 256개 | parsed compare의 leaf 256개 초과는 handler 전 거절; `Tx`의 `sql`·`emit`·`advanceSubscriberCursor` 실제 변경 행(`total_changes` 차이) 누적 1,000개 초과나 `get`·`all`의 변경은 전체 rollback; 부분 적용하지 않음 |
| command 입장 | 전체 256개, principal당 64개, 그중 제어용 16개 예약, 실행 시작 대기 5초 | `unavailable`; queue 입장은 durable 접수 아님 |
| read | 실행 2개, 대기 64개, principal당 대기 8개, 최대 500행·1MiB 응답 | 페이지 또는 명시적 한도 오류 |
| HTTP | header 8KiB, 동시 요청 128개·principal당 16개, body 수신 5초 | 한도 오류; chunked도 누적 bytes로 검사 |
| event | 연결 32개·principal당 4개, batch 256개·256KiB, 연결 buffer 1MiB | 느린 구독 연결 종료; event 건너뛰기 금지 |
| 신뢰 child | ready 10초, 정상 정지 5초, 실패 재기동 1·2·4초 후 최대 3회 | 해당 구성 요소만 사용 불가; 무한 재시작 금지 |
| platform I/O | 무거운 작업 동시 2개, 대기 32개, principal당 4개 | `unavailable`; 작업 사이 round-robin |
| 안전 log | info, 파일당 10MiB ×5(오래된 파일부터 정리), crash 관측 30일, 메모리 대기 1MiB | 진단만 누락 이유/계수 표시; API 대기 금지 |

queue는 principal별 FIFO·principal 사이 round-robin이며 등록된 회수·정지 제어만 예약 영역에 들어간다. caller의 priority 주장은 받지 않는다. 실행 중 transaction은 priority로 끊지 않는다. read query는 등록된 indexed query와 행 한도로 제한하고, 실행이 2초를 넘는 reader는 새 입장을 닫아 unhealthy로 표시한다. native SQL을 JS 타이머로 강제 취소했다고 주장하지 않는다. writer 스레드 실패는 core 저장 실패로 다루고 임의 두 번째 writer를 만들지 않는다.

응답 목표는 platform/responsiveness#R6~R10을 그대로 검증한다. 4 logical CPU·16GiB RAM·로컬 SSD, warm-up 30초 뒤 5분·각 1,000개 이상 요청으로 작은 read p95 200ms/p99 500ms, 작은 command·64KiB 문서 저장 p95 500ms/p99 1,000ms, 제어 접수 p95 200ms/p99 500ms, shell 첫 반응 p95 100ms/p99 250ms를 잰다. 100,000파일·10GiB scan, 1GiB 압축, 60초 model/test, 정체 앱, 동시 관리 요청 10개를 각각 및 함께 건다. 오류·timeout은 성공 분포로 세지 않고 queue 대기와 실행 시간을 따로 기록한다.

### 2.4 시작 통로와 프로세스 권한

신뢰 child는 설치 묶음의 고정 진입점을 설치된 Deno로 `run --cached-only --frozen --no-prompt` 실행한다. shell 문자열을 실행하지 않는다. 필요한 경로만 `--allow-read=<...>`, `--allow-write=<...>`, 필요한 loopback/외부 host만 `--allow-net=<...>`으로 열고 argv에는 credential을 넣지 않는다. 일반 `--allow-all`·`--allow-ffi`·전체 환경 접근은 없다. core의 `--allow-run`은 설치된 Deno binary와 플랫폼 OS adapter 진입점만, child의 subprocess 권한은 해당 소유 concern의 고정 child launcher만이다.

core 자신(부모)의 실행 permission에는 두 개의 정확한 이름을 추가로 연다. 둘 다 Deno 2.9.7을 실측해 확인했다. ① `--allow-run=/usr/bin/kill` — 신뢰 child를 Linux `setsid` session leader로 띄운 뒤(`node:child_process.spawn`의 `detached:true`가 pid=pgid=session을 만든다) 그 process group을 끝낼 유일한 통로다. `Deno.kill(-pid, ...)`은 scoped `--allow-run`으로는 `NotCapable`이고 unscoped `--allow-run`을 요구해 위 좁힌 권한과 부딪히므로 쓰지 않는다. 대신 이 고정 OS adapter 진입점을 `argv`만(`-9 -- -<pid>` 같은 음수 group pid), `shell:false`, `env:{}`로 부른다. core는 첫 child를 띄우기 전에 자기 실제 pid(`Deno.pid`)에 신호 0을 보내 이 adapter를 확인하고, 없거나 `NotCapable`이면 어떤 child도 띄우지 않는다(별도 존재 확인용 `--allow-read`는 열지 않는다). group 종료는 leader exit만으로 성공이 아니다. leader가 스스로 끝나든 stop 기한 뒤 강제로 끝내든 같은 경계를 지난다: group에 SIGKILL, leader exit 확인, 신호 0이 "No such process"를 돌려줄 때까지의 group 소멸 확인. 각 단계는 실제 경과 시간으로 bounded하고, 어느 단계든 실패하거나 확인할 수 없으면 그 kind는 unavailable이며 옛 handle을 쥔 채 새 child를 띄우지 않는다. leader 하나만 죽이는 대체 경로는 없다. ② `--allow-env=NODE_V8_COVERAGE` — Deno의 `node:child_process` 호환 코드가 child env를 명시해도 내부에서 그 이름 하나를 무조건 읽어(`copyProcessEnvToEnv`) 권한이 없으면 spawn 자체가 `NotCapable`로 막힌다. 같은 코드는 부모에 그 값이 있으면 child env에 복사하므로, supervisor는 그 이름을 값 없는 key로 두어 복사를 막는다. child env는 kind launch spec의 좁힌 화이트리스트 그대로다. 이 실측은 T7 범위이고 macOS·Windows adapter는 범위 밖이다(아래 fail-closed).

| 신뢰 프로세스 | 플랫폼이 열어 주는 범위 | 플랫폼이 열지 않는 것 |
|---|---|---|
| core | 설치 코드 읽기, ledger·WAL·run 제어 자료, loopback listener, 고정 child spawn | 원본 root·앱 DB·keychain·외부 네트워크 |
| platform I/O worker | blob·backup·진단·run 임시 자료, 검증용 ledger read-only, OS keychain adapter | ledger 쓰기·임의 앱 코드·임의 외부 요청 |
| 문서 worker | 배정된 root·blob 준비 통로·자기 derived store | ledger 파일 직접 쓰기·앱 DB·credential을 format child에 전달 |
| test runner | 고정 test bundle·격리 작업 폴더·좁은 결과 command | 운영 DB·실제 secret·credential을 test child에 전달 |
| agent runtime | 설치 runtime 코드·허용 provider 경계·scope 있는 contract | 임의 shell·파일·코드 실행·credential을 model/외부 MCP에 전달 |
| 앱 supervisor | 설치 runtime·앱 실행 자료와 고정 child spawn | ledger 쓰기·machine 자격을 앱 사용자 코드에 전달 |

감독 pipe는 부모가 만든 child의 stdin(부모→자식)과 stdout(자식→부모)이다. 둘 다 길이 prefix binary frame(JSON 제어 frame과 byte chunk frame)만 싣고, Electron main↔core도 같은 frame을 쓴다. child가 임의 loopback 주소나 PID만으로 감독을 주장할 수 없다. 최초 메시지는 core epoch·불투명 process identity·배정 task·scope 상한이다. credential은 그 연결로 한 번 전달하고 argv에는 넣지 않는다. ready는 실제 준비가 끝난 child만 보내며 작업 성공과 다르다. child 결과는 배정된 command로 제출한다. stdout은 감독 frame 전용이고 그 밖의 출력은 stderr로 보낸다. stderr는 제어 통로나 성공 근거가 아니며 원시 출력 자동 보관도 하지 않는다. frame이 아닌 stdout 바이트는 protocol 위반으로 그 child를 멈춘다.

부모 pipe EOF는 즉시 새 작업·credential 사용을 막고 child 종료를 시작한다. child helper는 handler가 끝나기를 기다리지 않고 stdin을 계속 읽어 EOF·stop·protocol 위반을 바로 보며, 미리 읽어 둔 frame은 수와 byte 합의 상한을 넘으면 protocol 실패로 끝낸다. 이때 내리는 것은 session의 사용 허가이고, handler가 이미 복사한 credential 값을 지우지는 못한다. core 연결 상실 때 앱 supervisor는 앱 child까지 종료한다. Linux는 실제 child handle과 process group(위 OS adapter)으로 부모 사망과 자식 잔존을 실측 확인했다. macOS는 같은 설계(session leader + 고정 kill adapter)를 따르되 그 OS adapter 실측은 아직 없고, Windows는 Job Object가 그 자리를 맡되 역시 실측이 없다. 실측이 없는 조합은 실행 불가로 처리하고 "된다"고 주장하지 않는다. 종료 확인이 없는 옛 실행과 겹쳐 새 작업을 띄우지 않는다. PID 파일만 보고 같은 PID의 다른 프로세스를 죽이지 않는다.

앱 sandbox·화면 Electron 설정·test/format 코드의 세부 권한은 소유 contract를 따른다. OS sandbox를 끈 Ubuntu 개발 테스트는 배포 격리 통과가 아니다. 각 OS에서 강제할 수 없는 조합은 실행 불가로 처리한다.

## 3. 저장

### 3.1 설치 폴더와 data root

Linux 설치 묶음은 `/opt/lophn/` 아래 `deno`, `platform/`(source·lock·vendor), `desktop/`, `skills/`, `sdk/`를 둔다. `/usr/bin/lophn-desktop`, `/usr/bin/lophn`, `/usr/bin/lophn-mcp`는 이 묶음의 launcher다. .deb는 Chromium sandbox 파일을 root 소유·4755로 설치하고 실제 OS sandbox 활성화를 검사한다. AppImage는 sandbox가 확인된 환경에서만 대안이다. macOS는 `Lophn.app/Contents/Resources/`, Windows는 설치한 `Lophn/resources/` 아래 같은 runtime 묶음을 둔다. 서명·공증·OS별 build 검증 없이 배포 완료라고 표시하지 않는다.

data root `H`는 Linux/macOS의 `~/.lophn`, Windows의 `%USERPROFILE%\.lophn`이다. `LOPHN_HOME`은 시작 전에 root를 선택할 뿐 일반 설정 override가 아니다. root는 소유자와 symlink를 확인한 하나의 정규 경로로 고정한다. 설치 파일을 update해도 H를 초기화하지 않는다. Linux Deno cache는 `~/.cache/lophn/deno`; macOS는 `~/Library/Caches/lophn/deno`, Windows는 `%LOCALAPPDATA%\lophn\deno`이며 삭제해도 고정 의존성으로 재생성할 수 있다.

```text
H/
  lophn.db                         ledger (+ SQLite WAL·SHM)
  blobs/sha256/<2자>/<62자>         불변 blob, POSIX 0400
  blobs/tmp/                       아직 완성되지 않은 streaming 파일
  derived/                         소유 concern별 derived DB·출처·cursor
  apps/<app ID>/                   apps 소유 실행 자료·DB·backup
  sdk/                             apps/sdk 소유 고정 설치 자료
  LOPHN.md                        사람이 쓰는 전역 지침; exact 파일만 version 연결
  run/                             instance lock·인증 없는 위치 metadata·임시 제어 자료
  logs/                            안전 운영 log·crash 관측
  backups/<UTC stamp>/             manifest.json·ledger.db·blobs/...
  backups/migrations/s<N>-<stamp>/  migration 전 schema N의 검증 복구본
  settings/                        명시 import/export용 TOML, 원본 아님
```

Linux H·관리 앱 폴더·run은 0700이며 더 넓으면 정상 기동을 거절한다. coding connection token 원문은 OS keychain에만 있고 설정·wrapper·파일에는 connection 참조만 둔다. 다른 OS는 동등한 소유자 전용 ACL을 검증한다. user·assignment·app·worker token 파일은 만들지 않는다. OS keychain 원값은 이 tree 밖에 있다. 외부 project 원본과 앱 source는 각 소유 concern이 등록한 위치에 남긴다.

### 3.2 ledger 표 소유권

| 모듈 | 소유 표 | 쓰는 경로 |
|---|---|---|
| `platform/ledger` | `events`, `command_results`, `subscriber_cursors` | transaction 기반 코드; command handler의 emit·결과·반응 cursor |
| `platform/blob-store` | `blob_refs` | 소유 record 변경과 같은 transaction의 공통 참조 등록 |
| `platform/secrets` | `secrets` | `SetSecret`, `RemoveSecret`; 원값 아닌 sealed_ref·revision |
| `platform/settings` | `setting_choices`, `setting_revisions`, `settings_state` | `ApplySettings`, `ReloadSettings` |
| `platform/backup-and-migration` | `schema_migrations` | 정상 writer가 닫힌 유지보수 ledger 실행기 |
| `platform/approvals` | `approval_requests`, `approval_uses` | request command와 소유 동작의 공통 한 번 사용 함수 |
| `platform/notifications` | `notifications` | 전용 subscriber 생성·사람 읽음 command |

identity·redaction·security·diagnostics에는 별도 ledger 표가 없다. coding agent의 token hash·회수 상태는 coding-agent/connection의 표에, provider 참조는 lophn-agent/harness/provider에, 외부 MCP 인증 참조·판은 lophn-agent/extensions의 소유 기록에 둔다. 다른 concern의 표는 해당 모듈만 쓰고 platform은 `Tx`로 조합할 뿐 직접 고치지 않는다. event·command 결과·설정 이력·migration 이력의 UPDATE/DELETE 금지를 SQLite 보호로 강제한다. 일반 `audit=false` 우회는 없고 event 없는 기반 쓰기는 domain model의 네 예외로 한정한다.

### 3.3 ledger 밖 자료

blob은 정확한 저장 바이트의 sha256이며 redaction한 복사본의 hash와 원본 hash를 섞지 않는다. 사람이 소유한 문서 원본 보존은 documents/versions 소유다. derived 결과는 고정 source version·seq 구간·method 판·`indexed_through_seq`와 함께 해당 derived DB의 같은 transaction에 쓰고, 완성본 교체 전 일부 결과를 최신 전체로 표시하지 않는다.

OS adapter는 macOS Keychain, Windows Credential Manager, Linux Secret Service를 사용한다. 값은 보호 입력·허용된 플랫폼 소비 경계 메모리와 keychain에만 있고 ledger·blob·설정·backup·환경 변수에 없다. 잠김·불가이면 필요한 기능만 `unavailable`이며 파일 볼트나 환경 변수 fallback은 없다. JavaScript/OS 메모리의 완전한 지움은 보장하지 않는다.

## 4. concern 배치표

| concern | 프로세스 | 모듈 | 저장 | 주로 쓰는 contract |
|---|---|---|---|---|
| platform/ledger | core writer·read Worker | ledger·commands·reads | ledger 공통 3표 | command, read, event 구독 |
| platform/api | core API loop | api·route registry | 메모리·derived WS 재생 위치 | command, read, event 구독, 인증 |
| platform/blob-store | platform I/O worker·core | blob-store | blob 파일·blob_refs·GC 관측 파일 | blob, command, 인증 |
| platform/identity | core·신뢰 시작 경계 | identity | 메모리 credential; 영구 connection hash는 소유 concern | 인증, read, command |
| platform/secrets | platform I/O worker·소비 경계·core | secrets·OS adapter | keychain·앱 secrets; provider·외부 MCP 참조는 소유 concern | secret, 앱 grant 검사, redaction |
| platform/redaction | platform I/O worker·각 플랫폼 경계 | redaction | 규칙 묶음·안전 결과, 원값 목록은 보호 메모리 | redaction, blob, 인증 |
| platform/responsiveness | core·각 신뢰 worker | admission·worker scheduler·measurement | 메모리 한도·안전 측정 결과 | command, read, 앱 통로 |
| platform/security | 모든 신뢰 입구 | policy·boundary checks | 설치 정책; 별도 보안 DB 없음 | 인증, approval, secret, redaction |
| platform/backup-and-migration | core ledger 실행기·platform I/O worker | backup-and-migration | schema_migrations·backup manifest·복구본 | read, blob, command |
| platform/settings | core·platform I/O worker | settings·registry | 설정 3표·교환 TOML | command, read, redaction |
| platform/diagnostics | core·platform I/O worker | diagnostics | 제한 log·crash 관측 | read, 인증, redaction |
| platform/approvals | core·shell main | approvals | approval_requests·approval_uses | approval, confirmation window, command |
| platform/notifications | core subscriber·shell main | notifications | notifications·공통 cursor | notification, event 구독, redaction |
| platform/install-and-update | Electron main·core 시작 코드·OS installer | install-and-update | 설치 묶음·H·cache·instance lock | 인증, read, backup·migration 절차 |

### 4.1 사람이 보는 경계

platform read는 정확한 fact·참조·판·상태를 유지하지만 shell은 지금 판단할 결과·영향·다음 행동만 기본으로 보여 준다. ledger·seq·invocation·내부 credential·기술 key는 기본 화면의 말이 아니며 필요한 안전 상세에서만 펼친다. en·message key·formatting은 shell/wording, 모양은 shell/design-system, 정적 화면은 screens, 사용 순서는 flows가 소유한다. 플랫폼 오류·상태·설정 설명을 화면마다 다른 업무 규칙으로 해석하지 않는다. → shell#I8, shell#I9, platform/settings#R30, platform/approvals#R17

SettingDefinition registry는 이름·한 줄 설명·현재값/기본값의 뜻·영향 기능·위험·되돌림·적용 시점의 message key와 schema를 함께 등록하고 설명 없는 항목은 거절한다. shell과 lophn 역할은 같은 registry의 현재값과 설명을 읽는다. lophn 제안은 questions의 고정 option action → QuestionActionEvidence 검사 → 기존 ApplySettings로만 적용하며 임의 대화 동의를 변경으로 승격하지 않는다. → platform/settings#R27, platform/settings#R28, platform/settings#R29

confirmation window는 요청 창 위의 child modal BrowserWindow다. 앱 view를 숨기거나 교체하지 않고 parent의 입력만 막으며 main이 고정 정본을 읽고 일회 handle을 쓴다. 상세를 접어도 사람이 동작·대상·이유·외부 전송·보존 데이터·되돌릴 수 없는 영향을 놓치지 않는다. menu·popover·palette·dialog·tooltip과 경계 drag는 앱 view 위 shell overlay view의 몫이며 platform이 별도 view 제어 contract를 만들지 않는다. → shell/confirmation-window, shell/app-frame

notification 자동 표시는 현재 focus·문서·앱을 바꾸지 않는다. OS 표시도 opt-in 최소 정보이며 사람이 대상 열기를 명시적으로 고른 때만 이동한다. 모든 근거는 다시 읽을 수 있지만 화면 전체에 기술 기록을 연속 노출하지 않는다. → platform/notifications#R9, platform/notifications#R11, platform/notifications#R12, shell/desktop

## 5. 내놓는 contract

### 5.1 HTTP transport와 등록 경로

RPC는 **POST `/v1/<resource>/<method>`**, 정확히 세 구간이다. major는 현재 1만 제공한다. 대소문자·누락·추가 구간·미등록 resource/method·옛 별칭은 추정하지 않는다. route registry는 `resource/method → kind(command/read/file), schema, handler, actor 상한, 한도`를 정적 등록한다. transport는 domain 검증을 재구현하지 않는다.

command body는 `{input,idempotency_key,compare,run?,prepared:[],confirmation?}`이며 command 이름은 경로의 등록값에서 정한다. 내부 전달 시 domain model의 `CommandEnvelope.command`를 채운다. 본문 actor·SQL·함수 이름·임의 파일 경로는 받지 않는다. read body는 등록된 인자 객체다. JSON 요청은 `Content-Type: application/json`; 성공은 결과 객체를 그대로 HTTP 200으로 반환하며 `{data:...}` 같은 추가 포장을 하지 않는다. 문서 원본 파일 read만 해당 소유 경로에서 바이트·Content-Type을 반환한다. 일반 blob read는 JSON 결과다.

실패는 `{error:{code,message,details?}}`이며 `invalid_input/unauthorized/forbidden/not_found/conflict/unavailable/internal` 순서로 HTTP `400/401/403/404/409/503/500`이다. handler의 소유 오류는 등록된 공통 분류에 대응한다. 원문 입력·stack·token·범위 밖 존재를 반환하지 않는다. 앱 caller에는 안전한 종류와 설명만 제공한다. 잘못된 transport도 이 분류를 쓰며 HTTP redirect나 자동 major 변환을 하지 않는다.

| kind | 실제 경로 | 등록된 동작 / 출력 |
|---|---|---|
| read | `/v1/platform/status` | 준비·schema·data root·구성 요소 현재 관측 |
| read | `/v1/platform/health` | `HealthObservation[]`, 관측 시각 |
| read | `/v1/identity/current` | 자기 actor·현재 scope·조건; 원값 없음 |
| read | `/v1/commands/result` | 자기 principal·key의 확정 결과 또는 안전한 부재 |
| read | `/v1/events/list` | `after_seq` 이후 허용 event batch |
| command | `/v1/events/advance-cursor` | `AdvanceSubscriberCursor`; 반응 완료 위치 |
| read | `/v1/blobs/read` | 허용 owner·고정 판·field·offset·length → BlobReadResult + base64 안전 bytes |
| read | `/v1/secrets/list` | 허용 이름·설정 여부만; sealed_ref 없음 |
| command | `/v1/secrets/set` | `SetSecret`; 보호 준비 참조만 |
| command | `/v1/secrets/remove` | `RemoveSecret`; 참조 제거 확정 |
| read | `/v1/secrets/cleanup` | 안전 `SecretCleanupResult`; 삭제·종료 완료 분리 |
| read | `/v1/approvals/get`, `/v1/approvals/list` | 허용 request·안전 미리보기·결정·사용 receipt |
| command | `/v1/approvals/create` | `create_approval_request` |
| command | `/v1/approvals/grant` | `grant_approval_request`; confirmation 필수 |
| command | `/v1/approvals/reject` | `reject_approval_request`; confirmation 필수 |
| command | `/v1/approvals/expire` | `expire_approval_request`; 전용 machine |
| command | `/v1/approvals/cancel` | `cancel_approval_request` |
| command | `/v1/approvals/apply` | `apply_approved_action`; 등록된 소유 command로 dispatch |
| read | `/v1/notifications/get`, `/v1/notifications/list` | source 사실·읽음·대상 열기 경로 |
| command | `/v1/notifications/create` | `create_notification`; 전용 machine만 |
| command | `/v1/notifications/read` | `mark_notification_read` |
| read | `/v1/settings/definitions`, `/v1/settings/get`, `/v1/settings/history` | 사람이 읽는 이름·설명·영향·위험·되돌림·적용 시점을 포함한 등록 항목·EffectiveSetting·판 이력; 화면과 lophn 역할이 같은 registry를 읽고 변경은 questions의 고정 option action으로 기존 ApplySettings에 전달 |
| command | `/v1/settings/apply`, `/v1/settings/reload` | `ApplySettings`, `ReloadSettings`; 검증 준비 참조 |
| read | `/v1/diagnostics/list`, `/v1/diagnostics/check` | 안전 진단·doctor 현재 관측; 무거운 검사는 worker |
| read | `/v1/backups/list`, `/v1/backups/get` | worker가 확인한 manifest·완료/검사 상태 |
| memory | `/v1/workspace/publish` | shell main(user)의 창 상태 등록; 요약 2KiB·탭 page 20개 |
| memory | `/v1/workspace/bind` | session → 창 결합; user만 |
| memory | `/v1/workspace/unpublish` | 창 상태 제거; user만 |
| memory | `/v1/workspace/read` | 결합 session의 현재 보기; agent만; 반환 전 redaction |

위 목록은 platform 소유 경로의 전부다. 다른 최상위의 실제 command/read/file 경로는 그 소유 architecture의 contract 목록으로 registry에 등록하며 여기서 이름을 새로 정하지 않는다. 앱 화면·command·업무 DB를 이 HTTP API로 프록시하지 않는다. 동일 major에서 선택 필드 추가만 허용하고 필수 입력·기존 의미·오류 분류·event 의미 변경은 새 major다.

`memory` route(command/read처럼 경로를 갖지만 ledger queue·reader와 event를 쓰지 않는다)는 API loop 안의 작은 handler로 바로 돌며 인증·body 한도·schema 검사는 다른 route와 같다. 현재 보기 relay(`/v1/workspace/*`, contracts/shell/workspace.ts)가 이 kind다. relay 값은 core 메모리에만 있고 ledger·blob·log에 가지 않는다. main 연결이 끊기거나 core epoch가 바뀌면 그 main의 relay 값은 모두 `disconnected`이며 결합 없는 주기 run은 `unavailable`이다. 옛 값을 `current`로 주지 않는다(prompt-assemble#R28). shell renderer는 이 경로를 shell allowlist로 부르지 않고 main이 직접 보낸다.

blob prepare, 큰 redaction, TOML parse/import/export, backup 생성·restore·GC, secret 보호 입력·export/import는 신뢰 프로세스의 **검증된 pipe 작업 호출**이다. 일반 HTTP JSON에 raw stream·secret 원값·임의 파일 경로를 받는 범용 업로드 route를 두지 않는다. 소유 concern이 등록한 `upload` kind route만 바이트 body를 받는다: 입력은 `x-lophn-input` header(base64url JSON), body는 `application/octet-stream`이며 route가 상한(`max_bytes`)과 purpose를 고정하고, core는 바이트를 해석·hash·보관 없이 등록된 handler로 흘려 보낸다(문서 파일 제출 `/v1/documents/upload`가 blob 준비 중계로 보낸다). 준비 주체는 요청 credential이다. 이 작업은 ledger command가 아니며 job entity·업무 queue를 새로 만들지 않는다. 실패 시 worker의 관측 결과만 반환하고 domain 확정이 필요한 단계는 아래 command로 따로 제출한다.

### 5.2 command

**입력:** 등록 command와 schema 통과 input, 최초 시도 전에 고정한 idempotency key, 모든 관련 판·hash·seq CAS, 필요하면 자격과 연결된 run·신뢰 준비 참조·confirmation. key는 UTF-8 1~128 bytes다. 입력 정규화는 RFC 8785 JSON canonicalization을 사용하고 seq는 십진 문자열, blob 참조는 정확한 저장 hash다. 작은 정규화 metadata의 sha256가 fingerprint다. token·전송 시도 ID·일회 handle 원문은 포함하지 않고 사람 결정의 대상·내용·선택은 포함한다.

**실행 순서:** 입장 → writer의 `BEGIN IMMEDIATE` → 현재 자격 검사 → `(principal,key)` 원래 결과 확인 → 동일 fingerprint이면 재전달 → 새 요청이면 scope·run·CAS·준비·사람 결정 확인 → event seq 배정·소유 변경·blob refs·반응 cursor·결과 저장 → commit → 성공·event wake-up. 다른 fingerprint는 `conflict`다. 재전달은 현재 자격을 검사하지만 이미 소비한 handle이나 달라진 CAS로 새 변경을 시도하지 않는다.

**출력:** 소유 command의 결과 객체와 `first_seq`, `last_seq`, `replayed`; 변화 없으면 seq는 null이다. 외부 작업의 receipt는 접수 사실이며 외부 성공이 아니다. 원래 결과와 현재 상태를 섞지 않는다.

**오류:** 공통 7종. queue 초과·유지보수·disk/lock/commit 실패는 `unavailable`, CAS·같은 key의 다른 요청은 `conflict`. 확정 결과가 없는 요청의 재조회는 미실행 증거가 아니다.

**보장:** domain 변경·event·command 결과와 필요한 approval 사용·blob 참조·반응 cursor는 한 transaction이다. FK·unique·불변 보호를 검사한다. 실패는 전체 rollback이다. 모든 domain 변경에는 event가 있고 확정 결과/event는 기간으로 삭제하지 않는다. 현재 자격 검사는 queue 대기 뒤 다시 한다.

**보장하지 않는 것:** 외부 효과 exactly-once, 파일·앱 DB·keychain과 SQLite의 공동 원자성, 도착 순서와 commit 순서의 일치, caller 연결 종료에 따른 실행 취소. 응답이 없으면 같은 key로 결과를 확인한다.

### 5.3 read

**입력:** credential, 등록 read 인자·허용 대상/고정 판·페이지 한도. **출력:** 허용 자료·`as_of_seq`·고정 판·다음 cursor·잘림/생략 범위. **오류:** 공통 7종; 앱 범위 자격의 다른 앱 대상은 실제 없는 대상과 같은 `not_found`, 유효 자격의 일반 금지 동작은 `forbidden`이다.

**보장:** writer queue 밖 snapshot에서 제목·주소·존재·목차·summary·개수·관계·근거를 scope로 먼저 제한한다. 범위를 제한한 자료만으로 summary를 만들 수 없으면 전체 제외한다. blob 다운로드·redaction·외부 작업을 기다리며 SQLite snapshot을 유지하지 않는다. 작은 참조 목록을 고정하여 transaction을 닫고 worker가 처리한 뒤 반환 직전에 현재 자격을 다시 검사한다. 긴 blob 조각도 각각 재검사한다. 후행 조회 기록을 기다리지 않는다.

**보장하지 않는 것:** 여러 HTTP 요청을 합친 snapshot, 디스크 원본의 현재 상태, 저장 즉시 index 최신성. derived 결과는 자기 반영 위치와 source 판을 별도로 반환한다.

### 5.4 event 구독

WebSocket handshake는 **GET `/v1/events/subscribe`**, `Authorization: Bearer ...`, 선택 subprotocol은 `lophn.events.1`뿐이다. token을 URL·cookie·subprotocol에 넣지 않는다. shell renderer가 직접 연결하지 않고 main·MCP·CLI·신뢰 runtime의 header 지원 클라이언트가 연결한다. handshake의 Host·Origin·Bearer·scope 검사를 HTTP와 동일하게 한다.

첫 frame과 반환은 다음과 같다. 모든 seq는 십진 문자열이다.

```json
{"type":"subscribe","from_seq":"101","types":["NotificationCreated"],"subjects":[],"subscriber":"shell-display","limit":256}
{"type":"events","events":[],"scanned_through_seq":"140","head_seq":"140"}
{"type":"ack","subscriber":"shell-display","through_seq":"140"}
```

- `from_seq`는 **포함**이다. 처음부터는 `"0"`, 처리 위치 P 이후부터는 `(BigInt(P)+1n).toString()`을 보낸다. 번호의 연속성을 가정하지 않는다. HTTP `/v1/events/list`는 `{after_seq,types?,subjects?,limit?}`이며 `seq > after_seq`다. 따라서 두 transport의 재생 뜻은 같은 위치 다음부터로 맞출 수 있다.
- `types`는 등록 event 이름만, `subjects`는 현재 scope 안 필터만 받는다. 비어 있으면 제한하지 않는다. 필터로 숨긴 event도 `scanned_through_seq`에 포함하고 empty batch도 진행 위치를 반환한다. `head_seq`는 그 읽기 snapshot의 끝이다.
- `subscriber`는 선택이다. 이름 있는 표시 구독의 ack는 그 credential principal·이름에 묶인 derived 전송 위치다. 자기 연결에서 읽어 지난 위치 이하·감소하지 않는 값만 받는다. `H/derived/api-subscriptions/`에 저장하며 재연결 시 명시 from이 없으면 저장 위치 다음부터 시작한다. 전달만으로 올리지 않고 다른 자격의 ack는 거절한다.
- 이 ack는 `subscriber_cursors.processed_through_seq`와 **다르다**. ledger 반응 처리기는 소유 domain command와 cursor를 같이 commit한다. 반응 없는 구간만 `AdvanceSubscriberCursor`다. idempotency 기준은 `(subscriber,cause_seq,reaction)`이며 그 주체의 등록 subscriber만 갱신한다. derived 처리기는 결과·cursor를 자기 DB에 같이 쓴다.
- 전달은 seq 오름차순·at-least-once다. 소비자는 seq로 중복 제거한다. 느린 연결은 안전한 `unavailable` frame을 가능하면 보낸 뒤 1013으로 닫는다. 회수/종료 자격은 1008로 닫고 이후 전달하지 않는다. client는 마지막 확정 처리 위치로 재연결한다.

platform 소유 event 이름은 `SecretSet`, `SecretRemoved`, `SettingsChanged`, `SettingsReloaded`, `ApprovalRequestCreated`, `ApprovalRequestGranted`, `ApprovalRequestRejected`, `ApprovalRequestExpired`, `ApprovalRequestCancelled`, `NotificationCreated`, `NotificationRead`다. ledger 기반 자체 event는 없다. 다른 event 이름과 payload는 해당 소유 registry를 따른다. 출력 envelope는 `seq,type,subject,actor,run,payload,at`이며 큰 내용은 안전 blob 참조다.

**오류:** 공통 오류·미등록 필터·후퇴/미관측 ack는 안전하게 거절한다. **보장:** 커밋 event만 전달하며 구독 정체가 command를 막지 않는다. **보장하지 않는 것:** exactly-once 전달, event 도착에 따른 새 agent run, ack에 따른 업무 처리 완료, 외부 효과와 cursor의 공동 원자성.

### 5.5 blob

**입력:** 신뢰 pipe의 `blob.prepare`는 principal·등록 purpose·bytes stream·예상 hash 선택값을 받는다. `blob.read`는 hash 단독이 아니라 허용 owner·고정 판·field에서 해석한 참조·바이트 구간을 받는다. 최대 준비 blob은 1GiB, 스트림 chunk는 1MiB, JSON read의 실제 구간은 최대 256KiB, 준비 참조는 10분 수명이다. 소유 concern은 더 낮은 한도를 등록할 수 있다.

**출력:** 준비는 `PreparedBlob(preparation,principal,purpose,hash,size_bytes)`다. `/v1/blobs/read`의 읽기는 BlobReadResult와 base64 bytes다. core↔I/O worker의 `blob.read`는 그 바이트를 JSON control frame에 담지 않는다. 256KiB 읽기 창의 base64가 control frame 한도(256KiB)를 넘기기 때문이다. worker는 요청이 준 channel의 byte chunk frame으로 바이트를 돌려주고 JSON에는 hash·크기·channel만 남긴다. **오류:** 예상 hash/크기/구간 오류는 `invalid_input`, disk·sync·참조 blob 부재/손상은 `unavailable`, 소유 범위 위반은 안전한 공통 거절이다.

**보장:** I/O worker가 같은 바이트를 streaming hash하면서 같은 파일 시스템 임시에 쓰고 sync·0400·원자적 설치·지원 OS directory sync를 마친 뒤 반환한다. 같은 hash는 덮어쓰지 않고 기존 완성 파일을 검증하여 재사용한다. core는 준비 주체·purpose·수명·worker 완료 참조만 확인하며 파일을 다시 hash하지 않는다. 모든 영구 참조는 소유 변경 transaction에 `blob_refs`로 등록한다. hash 공유가 scope를 합치지 않는다. 출력용 원문은 redaction 전 일반 tmp/blob에 저장하지 않는다.

**GC:** 기동/매일 필요 여부만 worker가 관측한다. 실제 GC는 새 준비·command 차단, 진행 준비 종료/중단, writer 정지 뒤 고정 모든 blob_refs와 대조한다. 미참조 확인 시각은 worker 관리 파일에 안전하게 남기고 그 뒤 7일 지나야 삭제한다. archive·옛 판·감사 참조는 남긴다. 재시작 tmp는 살아 있는 작업이 아님을 확인한 뒤 정리한다. backup 도중 GC·내용 삭제는 불가다.

**보존:** model 호출 본문·snapshot 첨부·trace 본문·운영 log 같은 큰 자료의 blob은 종류별 용량 상한을 넘으면 오래된 것부터 정리하고 남은 참조는 내용 부재로 표시한다. 변경 기록·결정·확정 결과의 blob과 그 참조는 기간이나 용량으로 삭제하지 않는다. → platform/blob-store#R13

**보장하지 않는 것:** blob 설치와 ledger commit 원자성, 나이만으로 참조 blob 삭제, 한 참조 차단이 모든 사본·backup의 물리 삭제라는 주장. disk 부족은 신규 준비·변경을 제한하지 기존 참조 blob을 지워 성공을 만들지 않는다.

### 5.6 인증

**입력:** Bearer 또는 검증된 내부 pipe, 등록 동작·대상·현재 실행 조건. **출력:** 클라이언트가 만들 수 없는 AuthenticatedContext의 principal·actor·scope·conditions. **오류:** 없는/위조/회수/종료 token은 401, 유효 자격의 금지 동작은 403, 앱 scope 밖 대상은 부재와 같은 404, 안전한 발급 경계 불가는 503이다.

불투명 token은 `crypto.getRandomValues`의 32 bytes를 base64url로 만든다. sha256 digest를 32-byte constant-time 비교로 검증한다. digest 자체를 Bearer로 받지 않는다. 영구 connection digest는 해당 소유 module에서 읽고 현재 회수 상태를 확인한다. 실행 digest·조건은 core epoch의 메모리 registry다.

| actor | 발급·보관 | 현재 상한과 종료 |
|---|---|---|
| `user` | Electron main이 core를 시작한 상속 pipe에 core가 한 번 발급; main 메모리 | 사람용 동작: 발급 시점의 조립된 route·command 표에서 user actor를 허용하는 operation 전부(machine·app·worker 전용 제외); 클릭 증거는 별도. main 연결 종료·core 재시작 시 폐기 |
| `coding_agent:<cac>` | confirmation window의 connection 결정 뒤 발급; git 밖 connection 저장소에 한 번 안전 전달 | 전체/앱 하나의 협업 scope ∩ 현재 connection 상태; 회수되면 새 사용 즉시 차단 |
| `agent:<asg>` | 유효 assignment·run 시작에서 신뢰 agent runtime에 발급 | 시작 역할·tool·scope ∩ 현재 제한; run 종료·멈춤·감독 상실 시 종료 |
| `app:<app>` | core가 supervisor의 신뢰 앱 runtime 경계에 고정 app·release·process·mode로 발급 | 자기 선언 보고·산출물; 사용자 코드에는 token 없음; 종료·판 교체·회수 시 폐기 |
| `machine` | 신뢰 worker에 task·대상·결과 command를 고정하여 발급 | 자기 배정 작업만; 실제 test runner만 test 결과 제출; 작업/프로세스 종료 시 폐기 |

이것은 다섯 actor의 하나의 credential 형식이다. 앱 연결·confirmation handle·준비 참조를 추가 token 종류나 actor로 만들지 않는다. 사람 harness 연결 선택 뒤 인증 경계가 coding agent token을 자동 발급·OS keychain 보관 준비하고 소유 command에 digest만 제출한다. commit 확인 뒤 adapter가 값 없는 준비 결과만 보여 준다. 원문 재조회·원문을 command_results에 저장하는 재전달은 없다. 저장 준비나 commit 실패의 token은 사용할 수 없고 정리 대상이다.

검사 순서는 **Host → Origin → Bearer → 현재 동작 자격**이다. 실제 port P의 allowlist는 `127.0.0.1:P`, `localhost:P`, `[::1]:P`다. 임의 proxy header는 무시하고 Origin header가 있으면 값에 관계없이 403이다. CORS·cookie·브라우저 예외는 없다. 인증/route 한도를 정한 뒤 body를 읽고 Content-Length를 사전 검사하며 길이가 없거나 속인 stream도 누적 상한을 넘기기 전에 중단한다. health·준비 상태·WS도 예외가 없다.

**보장:** 쓰기는 transaction에서, 읽기는 snapshot에서 현재 자격·scope를 재검사한다. 회수·assignment 멈춤·app grant 회수·감독 상실은 모든 새 read/write/blob/구독/direct 연결에서 즉시 제한한다. direct 연결의 강제는 앱 통로 소유 코드가 한다. source 주소·slug·blob hash·handoff가 권한을 늘리지 않는다.

사람 클릭이 필요한 command의 confirmation handle은 main↔core 비공개 연결에서만 발급한다. 메모리 값이며 core epoch·main 연결·window·정확한 대상·내용 기준·허용 결정·120초 기한에 묶는다. 창 닫기·main/core 재시작은 무효다. writer transaction 안에서 현재 상태와 함께 검증·소비하며 ledger commit 실패면 같은 살아 있는 handle의 예약을 풀되 종료/만료 handle을 되살리지 않는다. commit 뒤 응답 유실의 동일 key는 저장 결과를 먼저 반환한다. handle 원문은 ledger·fingerprint·event·log에 없다.

QuestionActionEvidence는 lophn-agent/questions 소유 정본에서 실제 사람이 고른 option·고정 action을 확인한 뒤 machine의 정확히 같은 되돌릴 수 있는 안쪽 동작을 한 번 적용하는 경우에만 actor=user로 기록한다. 일반 machine의 actor 주장이나 자유 답 해석은 거절한다.

**보장하지 않는 것:** token 소지가 실제 클릭, 회수가 이미 전달한 자료를 잊게 함, lophn scope가 외부 coding agent OS 접근을 제한함.

### 5.7 secret

**입력:** `secret.prepare`는 전용 보호 입력의 값·용도·owner를 검증된 pipe로 받는다. `SetSecret`은 그 SecretPreparation과 이전 참조/revision CAS만 받는다. `secret.send`는 신뢰 소비 경계에서 현재 SecretUse·고정 destination·동작·안전 body를 받는다. 일반 secret 값 read는 없다.

**출력:** 설정은 안전 이름·설정 여부·판, 사용은 소비 경계 안의 전송 결과, 정리는 `reference_blocked/os_deleted/processes_ended`를 각각 실제 관측으로 반환한다. **오류:** 자격·용도 위반, CAS 충돌, keychain 잠김/누락/안전 경계 불가는 공통 오류이며 값·length·공개 hash·OS 내부 경로를 넣지 않는다.

**보장:** keychain OS 준비는 core 밖에서 먼저 끝낸다. CAS를 통과한 `SetSecret`만 참조를 바꾸고 실패하면 이전 참조를 유지한다. 교체/제거 commit은 이후 사용부터 막는다. I/O worker는 keychain의 불투명 항목 중 ledger가 현재 참조하는 것과 준비 중인 것을 구별하여 고아·이전 값을 정리한다. 값 삭제·그 값을 쓴 프로세스 종료가 실제 확인되기 전에는 정리 완료라고 표시하지 않는다.

앱 secret 전송은 apps 소유의 실제 전송 경계가 앱·고정 release·선언 이름∩유효 grant·허락된 목적지를 확인한다. 호출마다 사람 approval을 요구하지 않는다. 플랫폼 adapter가 keychain에서 값을 꺼내 현재 허용 destination의 인증 header에 **전송 직전** 붙인다. 앱 사용자 코드는 secret 이름만 지정하고 header 원값을 받지 않는다. command를 부른 쪽(사람 화면·agent·automation·다른 앱)으로 secret 사용을 막지 않는다. provider 인증도 model 호출의 신뢰 adapter 안에서 현재 provider 참조/revision을 검사하여 HTTPS 전송 직전에만 붙인다. model loop·tool 인자·기록 body에는 값이 없다. redirect는 자동 인증 전달하지 않고 매 목적지를 다시 검사한다.

#### 내부 contract: secret 전송 부착·갱신 결과 저장

`secret 전송 부착`은 secret contract 안의 비공개 소비 호출이며 새 공개 API나 token 종류가 아니다. 부르는 쪽은 agent runtime의 **신뢰 provider adapter·외부 MCP transport**, 앱 supervisor의 **신뢰 전송부**다. 각 adapter는 agent/app credential을 빌리지 않고 자기 process·task로 좁힌 machine credential을 사용한다. agent의 loop·tool·앱 사용자 코드에는 이 연결이나 값 반환 기능을 열지 않는다.

- **통로·입력:** core와 해당 신뢰 adapter의 비공개 연결로 secret 참조·revision, 목적지(host 또는 고정 MCP 서버 연결), 용도를 보낸다. core는 machine scope·process 생존·현재 참조와 그 목적지/용도의 허용 근거를 검증한다. 앱 사용은 현재 grant까지 필요하다.
- **실행·출력:** core는 작은 허용 결과만 조정하고 keychain OS 호출을 직접 기다리지 않는다. platform I/O의 보호 adapter가 값을 꺼내 승인된 소비 adapter의 전송 callback 메모리에만 전달한다. 이 내부 callback의 출력은 **값**이지만 agent·앱 코드의 일반 결과 객체로 반환하지 않는다. callback은 인증 부착/전송 뒤 원값 참조를 버리며 기록은 안전 참조·용도·결과만 남긴다. 실제 bytes를 모델/tool/오류/log에 남기지 않는다.
- **오류·보장:** scope/용도/목적지 거절은 `forbidden`, 현재 참조/revision 변경은 `conflict`, keychain/보호 callback 불가는 `unavailable`이다. redirect마다 다시 검사하고 다른 host에 인증을 자동 전달하지 않는다. 비공개 연결 상실·회수 뒤 새 부착은 불가다. 보호 전송 코드만 값을 받는 성질과 core 밖 OS 작업을 함께 지킨다.
- **보장하지 않는 것:** JS/OS 메모리 완전 삭제, 이미 전송한 효과 회수, 자식 stdio MCP 서버의 OS 권한 제한. stdio 서버 argv·환경에 값 주입은 하지 않는다. 외부 MCP가 인증 원값을 요구하는 경우 신뢰 HTTP transport의 허용된 인증 경계가 아닌 일반 tool/stdio 자료 경로로 넘기지 않는다.

짝인 `갱신 결과 저장`은 같은 비공개 연결의 신뢰 provider adapter 또는 외부 MCP transport만 호출한다. 입력은 고정 credential 소유 key·목적지·용도·기존 보호 참조/revision과 갱신된 값이며 값은 보호 callback 메모리에만 둔다. core가 해당 scope·소유·현재 CAS를 확인한 뒤 I/O 보호 adapter가 새 값을 keychain에 먼저 준비한다. **값을 제외한** SecretPreparation과 기존 CAS를 credential 소유 concern의 command에 제출하여 참조·판·event를 확정한다. 출력은 안전 새 참조·판/설정 여부다. 준비/commit/CAS 실패는 이전 참조를 유지하고 고아를 정리한다. provider 로그인·갱신 정책과 외부 MCP 연결 상태의 정의는 해당 소유 concern의 contract를 따른다.

알려진 값은 보호 redaction 메모리에 전체 등록하고 잠금·재시작 후 사용 전에 재등록한다. 긴 값부터 정확 일치 검사하며 짧은 값·개수로 제외하지 않는다. 보호 원값 목록을 agent·앱·test 코드에 전달하지 않는다. 소비 프로세스의 보호 adapter가 접근한 값은 일반 runtime 루프에 반환하지 않는다.

머신 이전용 `secret.export/import`는 사람의 보호 입력·명시 선택에 한정한 별도 pipe 작업이다. format 1의 고정 metadata와 선택 항목을 Argon2id(64MiB, 3회, parallelism 1, 무작위 salt 16 bytes)로 얻은 키와 AES-256-GCM(무작위 nonce 12 bytes)으로 인증 암호화한다. metadata도 인증하고 수정·잘못된 암호는 전체 거절한다. native 보호 adapter가 메모리 안에서만 암호화/복호화하여 새 keychain에 준비한 뒤 참조 CAS를 제출한다. 평문 중간 파일·일반 backup·agent/API 원값은 없다. import 실패는 기존 참조를 바꾸지 않는다.

**보장하지 않는 것:** OS/JS 메모리 완전 삭제, 로컬 참조 제거로 외부 provider 키 폐기, 이미 보낸 효과 취소. keychain 불가 환경은 secret 기능만 unavailable이며 평문/암호 파일 볼트 fallback이 없다.

### 5.8 redaction

**입력:** `redaction.check`의 RedactionInput(source,media_type,audience,safe_fields,private_fields), 현재 scope, 제한된 원문 메모리. **출력:** RedactionResult(rule_revision,status,content,redacted_items,omissions). **오류:** 한도·미지원·불확실·검사 실패는 안전 Omission과 `invalid_input/unavailable`; 원문을 통과시키지 않는다.

| 경계 | 수행 위치와 순서 |
|---|---|
| 세션 입력·질문 답 | 저장/모델 전송 전에 신뢰 플랫폼 경계 검사; secret 발견이면 전체 제출 차단·보호 입력 안내만 |
| report·snapshot·invocation·log·첨부 | SDK 선언 안전 필드 선택 → 플랫폼 수집 재검사 → 안전 blob/log 준비 → core에 작은 참조 |
| 문서·search·repair context·handoff·tool 결과 | 현재 scope 먼저 → 필요한 자료만 → 현재 규칙 redaction → caller |
| model input | agent runtime의 플랫폼 경계에서 scope·data 출처 → redaction → 실제 전송과 동일 bytes 기록; 인증 header 제외 |
| model output·산출물·trace | 저장·tool 사용·화면 표시 각각 전에 재검사; 내부 추론·재생 서명은 수집 제외 |
| notification·복사·export·tooltip | source 사실에서 안전 제목/대상만 만들고 현재 규칙 검사; 원문 보기 없음 |

고정한 gitleaks credential prefix·PEM 규칙 묶음의 content hash를 입력/출력이 함께 사용한다. 새 규칙은 fixture 검증 뒤 묶음 전체를 교체한다. OpenAI·Anthropic·GitHub·AWS·Slack key, JWT·PEM 공통 fixture를 포함하되 이것이 provider 지원 목록은 아니다. Authorization/Cookie·URL 인증·JSON secret/token/password/credential 값은 중첩 구조에서 제거한다. 모든 secret 대체는 길이·종류와 무관한 `*` 하나다.

텍스트/JSON 검사 단위 1MiB·깊이 16·4,096 항목, 처리 5초를 기본으로 한다. 큰 문서/stream은 worker가 조각 사이 알려진 값의 최장 길이에 따른 보류 구간을 유지하여 검사된 prefix만 내보낸다. 보류가 한도를 넘거나 안전을 확인 못하면 그 범위 전체를 제외한다. 이미지의 자동 OCR 완전 탐지는 보장하지 않는다. 사람이 고른 feedback screenshot은 redaction 대상이 아니다(D32).

표본은 명시 원값 경로만 secret 처리 후 최대 64자·전체 2KiB, ID형 문자열은 그 표본 안 가명으로 처리한다. 전체/중간 wildcard 원값 선언은 거절한다. 화면 문자열 80자 초과는 안전 shape로 줄이며 private 필드는 길이와 무관하게 제외한다. 짧은 이메일도 예외가 아니다. shape의 type·길이와 가명 비교 범위도 공개 정책으로 검사한다.

**보장:** 저장 redaction을 통과한 과거 blob도 반환/모델 전송 때 현재 규칙으로 다시 검사한다. 원본·event·고정 blob을 새 규칙 때문에 몰래 바꾸지 않는다. 실패 원문은 일반 tmp/log/blob에 먼저 저장하지 않고 제외 범위·이유만 남긴다. redaction은 agent나 설정으로 끌 수 없다. 이미 일어난 효과는 기록 redaction 실패로 재실행하지 않는다.

**보장하지 않는 것:** 임의 인코딩·암호화·이미지·분할된 미지 password와 모든 개인정보의 자동 탐지. 수집 최소화·안전 필드 선언이 정규식보다 먼저다.

### 5.9 approval

**입력:** domain model의 고정 requester·run·reason_blob·effect·action·기한과 작은 준비 참조. action은 정확한 concern·등록 command·caller·고정 ID targets·정규 input·comparison을 묶는다. `input_hash/binding_hash`는 5.2의 정규화를 사용한다. secret 원값은 없다. 수리라면 보존 데이터·실제 검증 기준을 설명에 포함한다.

**출력:** ApprovalRequest와 결정 event, 적용에서는 소유 receipt에 연결된 ApprovalUse. 미리보기는 redaction 복사본이며 정확 입력 지문을 그 미리보기 hash로 대신하지 않는다. **오류:** 설명 공백/schema 오류, 현재 권한 위반, 대상 부재, 내용·CAS·상태·기한·사용 충돌은 공통 오류다.

**보장:** `create/grant/reject/expire/cancel/apply` 경로는 5.1의 정확한 domain command만 호출한다. grant/reject는 confirmation window handle 없이는 user token으로도 불가다. pending에서 한 번 종료하며 설명·동작·기한·종료 결정은 바꾸지 않는다. 기본 기한은 없음이고 지정 기한 도달부터 결정과 사용을 거절한다. granted 기록은 뒤 기한 경과 때문에 expired로 바꾸지 않는다.

`apply_approved_action`은 고정 소유 command에 dispatch하며 **현재 권한·원래 run·대상·CAS·정확 action → approval_uses INSERT(approval PK) → 소유 접수/변경·event·상호 FK → command 결과**를 한 transaction에 확정한다. approval만 먼저 소비하는 공개 command는 없다. ledger 밖 작업은 receipt와 사용을 먼저 같이 commit한 뒤 소유 worker가 수행한다. confirm 앱 호출도 이 원칙의 apps/invocations 소유 접수 예외다. 사용 후 실패/unknown은 새 호출 허락이 아니며 같은 key는 같은 receipt다.

거절은 이유 없이 가능하며 이유가 있으면 redaction 후 해당 역할에 전달한다. 거절·만료·취소는 그 호출 미실행이며 tool 반복 실패가 아니다. 같은 run 및 같은 사람 요청의 handoff 계보에서 거절된 같은 동작·대상·입력은 설명만 바꿔 다시 묻지 않는다. 계보 판정은 소유 contract를 사용한다. 새 사람 요청은 별개다.

**보장하지 않는 것:** 허락 저장이 적용 성공, 지속 범위 확대, 침묵·창 닫기·notification·일반 긍정·질문 답·CLI TTY가 approval이라는 해석. 실제 결과는 action.concern 소유다.

### 5.10 notification

**입력:** 전용 `notifications` machine subscriber의 source_seq·진행 위치 또는 user의 명시 notification ID 읽음. **출력:** source_seq 하나당 Notification 하나, source 사실에 근거한 안전 제목·원래 시각·대상·변화·사람 행동·결과 열기 또는 없는 이유. **오류:** 계기 표 밖 source·잘못된 cursor·금지 주체·부재는 공통 오류다.

| source event | 생성 조건 |
|---|---|
| `ProblemOpened`, `ProblemReopened`, `ProblemClosed` | 운영 보고의 문제만 |
| `ApprovalRequestCreated`, `QuestionCreated` | 항상 |
| `TicketConfirmed`, `TicketCheckFailed` | 항상 |
| `AssignmentPaused` | actor=machine, 반복 실패 또는 대상 보관 |
| `ContextWatchedItemChanged` | machine이 watch 변화·section 소실을 확정 |
| `ReleaseActivationFailed` | 항상 |

`create_notification`은 실제 source·조건을 transaction에서 재검사하여 notification·`NotificationCreated`·cursor를 함께 commit한다. `source_seq UNIQUE`와 `(notifications,source_seq,create)`로 중복을 막는다. 계기 없는 구간은 cursor만 전진한다. `mark_notification_read`는 최초 read_at·`NotificationRead`를 한 번 남기고 반복은 unchanged다. 본문·Message·업무 상태·OS 배달 상태를 복제하지 않는다.

**보장:** 표 밖 report/ticket 전이/handoff/RunFinished/문서 저장/앱 임의 발송은 생성하지 않는다. 창/OS 표시 실패로 ledger 사실을 버리지 않는다. OS 표시 기본값은 꺼짐이며 사람이 켜면 같은 notification의 최소 제목·대상 열기만 shell에 전달한다. 실패는 다음 조회에서 안전 이유로 보이며 별도 retry 업무 표를 만들지 않는다. notification 생성·전달·읽음은 새 agent run이나 닫힌 세션 재개를 만들지 않는다.

**보장하지 않는 것:** OS 배달 성공, 클릭/읽음이 승인·답·닫힘·ticket 확인, 현재 대상 상태가 당시 사실과 같음. 서로 다른 source를 미읽음 종류가 같다는 이유로 덮어쓰지 않는다.

## 6. 쓰는 contract

| 소유 contract | platform에서 쓰는 곳 |
|---|---|
| documents의 파일 준비 결과 | 준비 주체·고정 참조·CAS를 해당 소유 command에 제출 |
| documents의 format 실행 | 문서 worker에 준비를 맡기며 core에서 실행 코드를 import하지 않음 |
| apps의 앱 통로 | 현재 자격/회수 정보 제공; 일반 앱 호출은 직접 통로 유지 |
| apps의 invocation 전달 | 신뢰 실행 출처와 결과를 소유 command로 확정 |
| apps의 release 준비·적용 | 접수/결과 조정; 실제 준비·DB 변경·시작 확인은 supervisor |
| problems의 문제 보고·test 실행 | 안전 준비와 실제 runner의 결과만 소유 command에 반영 |
| lophn-agent의 agent run | 시작·대기·복구 조정; notification으로 새 run을 만들지 않음 |
| lophn-agent의 model 호출 | secret 소비 경계·redaction 공통 규칙만 제공; 실제 provider 호출은 runtime |
| shell의 confirmation window | 비공개 main 연결에서 handle 발급·검증·소비; UI는 shell |

## 7. 흐름

### 7.1 준비 결과를 확정하고 응답 유실 뒤 다시 읽는다

```text
[문서 worker] 관측·hash·format·blob 준비, 이전 판/CAS 고정
 → [worker] 동일 준비 참조·key의 소유 command를 HTTP POST
 → [core API] 제한·인증 → writer queue
 → [writer] 현재 자격 → 결과 조회 → CAS → 소유 변경·event·blob_refs·결과 commit
 → [API] 성공 반환   → [event 배포] seq batch   → [문서 worker] derived 후속 반영
응답 유실 → [worker] 같은 key/입력 재전달 → [writer] 원래 결과, replayed=true
```

파일 저장·version 확정·index 반영은 서로 다른 완료다. 준비 성공은 domain 확정이 아니며 CAS 충돌은 원본 자동 덮어쓰기가 아니다.

### 7.2 읽기와 notification 반응

```text
[shell main] read POST → [reader Worker] scope·자료·as_of_seq snapshot → 응답
[core notifications] cursor P → [reader] P 뒤 source event batch
 → 계기 있음: create_notification command
 → [writer] source 재검사·notification·event·cursor commit
 → [shell main WS] NotificationCreated → [shell] 같은 notification 표시
 → [사람] 명시 읽음 → [main] mark_notification_read command → [writer] read_at commit
```

표시용 WS ack는 반응 cursor가 아니다. OS 표시 실패여도 notification은 남고 읽음/클릭은 다른 결정을 만들지 않는다.

### 7.3 approval 뒤 ledger 밖 작업

```text
[요청 runtime] 고정 action·효과·안전 설명 준비 → create_approval_request command
 → [writer] request·ApprovalRequestCreated commit
 → [shell main] 정본 read → confirmation window, 비공개 handle(120초)
 → [사람] 명시 선택 → [main] grant/reject command
 → [writer] handle·현재 내용·기한 검증/소비, 결정 commit
허락 → [소유 runtime] apply_approved_action command(원래 caller 유지)
 → [writer] 현재 scope·CAS·원래 일·정확 action, 사용 + 소유 receipt commit
 → [소유 worker] receipt 확인 뒤 실제 일 → 결과 command → [writer] 소유 결과 commit
```

거절·만료·취소는 실제 일을 시작하지 않는다. confirm 앱 호출은 user 결정과 실제 caller(user·agent·다른 앱)를 구별하고 agent ask와 confirm이 겹치면 같은 정확한 approval을 한 번만 소비한다. actual call은 receipt 뒤에도 원래 호출자→앱 direct다. 응답 유실·결과 unknown에 같은 허락으로 새 receipt를 만들지 않는다.

### 7.4 secret 교체와 전송

```text
[사람] 보호 입력 → [main/보호 adapter] 값은 전용 pipe
 → [platform I/O] keychain 준비·known-secret 등록 → SecretPreparation
 → [main] SetSecret command(이전 참조/revision)
 → [writer] CAS·참조·SecretSet commit
 → [I/O/앱 supervisor] 이전 참조 차단·OS 정리·사용 프로세스 종료 각각 관측
사용 → [신뢰 소비 adapter] 현재 참조/판·용도·목적지·앱의 현재 grant 검사(호출마다 secret approval 없음)
 → [keychain 경계] 값 조회 → 실제 허용 전송 직전 인증 첨부
 → [redaction 경계] 결과 안전화 → caller/기록; 원값 반환 없음
```

CAS 실패는 이전 참조를 유지한다. keychain 잠김은 로컬 문서/secret 없는 앱까지 막지 않는다. 이미 보낸 요청은 로컬 삭제로 취소되지 않는다.

### 7.5 online backup과 명시 restore

```text
[core] 하루 한 번 backup 작업 배정, GC/삭제 차단
 → [platform I/O] SQLite online backup으로 고정 S snapshot
 → snapshot blob_refs 전부 복사·실제 hash·SQLite integrity 검사
 → manifest complete=true 원자적 설치 → 최근 완료 7개 보존
[사람] 검증 backup 선택·잃을 S 뒤 기록 확인 → [main] 보호 결정
 → [core] 입장/준비 차단·짧은 command 종료·worker/앱/agent 정지·writer 닫기
 → [I/O] 현재 자료 별도 보존 → 검증본 staging → 교체
 → [core] 새 epoch·자격 재검증·derived/전송 cursor 초기화 → 정상 시작 순서
```

manifest format 1은 `schema_version,through_seq,created_at,ledger_hash,blobs,settings,integrity,complete`를 포함한다. 상대 경로는 `ledger.db`, `blobs/sha256/<2>/<62>`로 고정하고 제외 범위 안내를 함께 둔다. ledger 선택 설정은 snapshot에 들어간다. 앱 DB·외부 원본/source·keychain·token은 자동 포함하지 않는다. 실패/미완성 묶음 때문에 마지막 완료 7개를 지우지 않는다.

### 7.6 기동·migration·복구

```text
[Electron main] OS single-instance 시작 → core 고정 진입점·상속 pipe
 → [core 시작] H 소유/권한·OS instance lock → 설정 parse/검증 준비
 → [ledger 실행기] SQLite recovery·integrity·schema 이력/hash 검사
 → 미적용 migration 있음: 정상 입장 차단·worker 정지·정상 writer 닫기
    → [I/O] schema N·시각 포함 복구본, integrity 통과
    → [ledger 실행기] 단계별 BEGIN IMMEDIATE: 변환 + version/hash/시각 이력 commit
    → FK·unique·불변 보호 확인
 → [core] 중단 대상 식별·cursor 복원·실행 credential 폐기
 → [API] 인증된 정상 read/command 시작
 → [감독] 필요한 worker·허용 앱 감독 시작
 → [소유 worker] 실제 미완료 관측, base_seq·unknown 이유 포함 복구 command
 → [agent runtime] 소유 규칙에 맞는 주기 접수
```

SQLite/schema 점검 뒤 정상 read는 전체 scan·index·큰 blob hash를 기다리지 않는다. 중단 작업 점검은 먼저 대상과 유효성/사용 불가를 식별하며 외부 관측 전체가 끝나야 모든 읽기를 열어 주는 전역 barrier를 만들지 않는다. 잘못된 agent 설정만 있으면 agent 시작을 막고 설정 수정·문서 읽기·무관한 앱은 연다.

## 8. 실패와 재시작

| 끊긴 곳/실패 | 처리·복구와 완료 의미 |
|---|---|
| queue 입장 후 실행 전 | durable 접수 아님. 대기 기한 초과는 미시작 unavailable; 같은 key 재전달 가능 |
| transaction 도중 | SQLite rollback/commit 결과로 확인. 성공을 log/메모리/JSONL로 대신하지 않음 |
| commit 뒤 응답 전 | 현재 자격 확인 뒤 같은 key의 저장 결과를 반환; 새 event/효과 접수 없음 |
| blob 설치 후 참조 commit 전 | 미참조 고아; 준비 재검증 또는 정지 GC, 즉시 참조 손상으로 오인하지 않음 |
| 참조된 blob 부재/손상 | unavailable·저장소 손상; 빈 내용·성공으로 채우지 않음 |
| worker crash | 그 기능만 unavailable; 제한 재기동. process 재기동은 task 재실행 아님 |
| writer Worker crash/불명확 commit | 새 쓰기 입장 닫고 core 재시작 경로. SQLite와 command_results 확인 전 두 번째 writer 금지 |
| 외부 receipt 뒤 결과 없음 | 소유 concern이 실제 관측해 confirmed/not_started/unknown 제출; 응답 부재로 미실행 추정·자동 반복 금지 |
| main/core crash | 이전 메모리 token·handle 폐기. 부모 pipe 상실 child 정지; 새 epoch로 신뢰 시작 |
| 승인 결정 commit 뒤 main crash | 저장된 request/command 결과부터 조회; 미사용 handle은 복구하지 않음 |
| grant/secret 회수 뒤 process 종료 불가 | 새 사용 차단, 실제 종료 미확인 표시; 회수 요청을 완료로 부풀리지 않음 |
| keychain 준비 뒤 CAS/commit 실패 | 이전 참조 유지; 새 준비 값 고아 정리. 삭제/종료 관측은 별도로 표시 |
| redaction 실패·불확실·timeout | 원문 저장/표시/전송/반환 중단, Omission만. 실제 효과를 다시 실행하지 않음 |
| 느린 구독·wake-up 유실 | 연결 종료 또는 reader head 재확인; 마지막 확정 처리 위치 이후 재생 |
| derived 쓰기 도중 crash | 결과/cursor 로컬 transaction 기준 재처리; ledger 원본은 그대로 |
| disk 부족·5초 lock 초과 | 새 준비/쓰기 unavailable; 가능한 기존 read 유지, 참조 blob 임의 삭제 금지 |
| 미지원 schema·다른 migration hash·손상 | 정상 서비스 차단, 원본 보존. 자동 초기화/downgrade/backup 덮어복원 금지 |
| migration 중 실패 | 해당 단계 전체 rollback·이전 완료 판 유지; 정상 서비스 열지 않음. 다음 기동은 실패 단계부터 |
| backup/restore 중 중단 | complete 아닌 묶음은 restore 불가; 현재 원본 보존본과 staging 검사 뒤 명시 복구 |

정상 종료는 새 command·prepare 입장 닫기 → 입장한 짧은 command 확정 또는 실패 → child 정상 정지(5초 뒤 필요하면 실제 handle 강제 종료) → 종료 관측 → read/writer 연결 닫기 → instance lock 해제 순서다. 종료 도중 결과 미확인은 unknown으로 남기며 외부 효과를 없었다고 표시하지 않는다.

migration은 앞으로만 간다. 이전 설치로 돌아갈 때는 사람이 호환되는 검증 backup을 restore해야 한다. migration 전 복구본은 성공 직후 삭제하지 않고 사람이 범위와 복원 가능성을 확인한 명시 삭제만 허용한다. 삭제는 SQLite page·WAL·OS backup의 물리 흔적 제거를 보장하지 않는다. 수동 lophn update는 정상 정지 후 OS 설치 묶음만 교체하고 필요한 변환은 이 절차를 따른다. 자동 다운로드/설치/무단 재시작과 headless 별도 설치는 첫 판에 없다.

일반 settings는 `builtin < common`만 병합하고 Preset 구성은 별도 고정 판으로 저장한다. TOML 1.0 format 1의 명시 import/export는 worker에서 parse·redaction·전체 영향 검증한 뒤 `ApplySettings`에 제출한다. 객체는 항목별, scalar/array는 높은 층 전체 교체다. nullable 값과 선택 삭제는 구별하며 정확한 교환 표현은 → redesign/propagate#Q1에서 확정한다. reload 실패는 마지막 유효 판 전체를 유지한다. 일반 설정에 secret·환경 치환·include·command·원격 URL·assignment override·안전 해제는 없다. 적용값은 메모리이며 명시 선택만 ledger 원본이다. Preset model/prompt/tool과 run 한도 변경은 다음 run, 지침·작업 자리 snapshot과 현재 안전 제한은 다음 호출부터 적용한다. 변하지 않은 연결을 reload 때문에 재기동하지 않는다.

diagnostics는 안전 구성 요소·시각·분류·위치·redaction 설명만 비동기로 기록한다. core·SDK·desktop 내부 실패는 `lophn_internal`이며 앱 문제로 돌리지 않는다. 인증 실패 폭주는 제한 log만 남기고 ledger event를 만들지 않는다. doctor는 SDK 같은 version의 hash 차이·credential 권한·grant 위험·log 미가공 key 패턴을 worker에서 검사하고 원문 없이 실제 관측을 반환한다. raw stdout/stderr·HTTP dump·crash memory·내부 추론은 자동 수집하지 않는다.

## 9. 이전과 달라진 것

- **이전:** SQLite 동기 호출·큰 hash·format/file 처리가 같은 daemon 흐름에 섞였다. **지금:** writer/read는 내부 Worker, 큰 I/O는 별도 프로세스다. **이유:** queue만 나누어도 인증·read event loop가 멈추는 문제를 없앤다.
- **이전:** SQLite `NORMAL`, 작은 blob의 command 안 `putSync` 경로가 있었다. **지금:** WAL 실제 확인·FULL·외래 키·5초 잠금 상한과 command 밖 blob 준비만 허용한다. **이유:** 확정 내구성과 짧은 transaction을 일치시킨다.
- **이전:** 앱 조회/실행을 daemon이 중계하고 v2에서 앱별 host journal·lease·실행 허가·여러 token을 추가했다. **지금:** ledger/writer 하나, 앱 direct call, confirm의 단일 접수·approval 사용만 선행한다. **이유:** 원본과 감독을 분산하지 않고 무관한 응답을 분리한다.
- **이전:** user token 파일·harness 이름 actor·WS token subprotocol을 사용했다. **지금:** user는 main 메모리, connection ID/assignment/app/task 자격, WS Authorization header다. **이유:** 실제 주체와 최소 token 전송·즉시 회수 경계를 지킨다.
- **이전:** CLI TTY나 user 자격을 사람 결정으로 볼 수 있었다. **지금:** confirmation window와 비공개 120초 일회 handle만 사람 결정 근거다. **이유:** 자격 소지와 정확한 클릭을 분리한다.
- **이전:** 앱이 secret 값을 읽고 암호화 파일 볼트·safeStorage master key를 사용했다. **지금:** keychain 원값·참조 CAS·전송 직전 플랫폼 첨부이며 보호 export만 별도다. **이유:** 원값을 agent·앱 코드·backup에 퍼뜨리지 않는다.
- **이전:** index가 ledger에 섞이고 backup은 DB 중심이었다. **지금:** derived는 재생성 파일, backup은 snapshot S의 모든 참조 blob까지 검증한다. **이유:** 빠른 복사본을 원본과 분리하고 실제 복원 가능성을 보장한다.
- **이전:** notification을 폭넓은 협업 전이나 앱 임의 발송으로 만들 여지가 있었다. **지금:** 계기 표·source_seq unique·전용 subscriber만 생성한다. **이유:** 표시가 업무 결정·새 agent 작업이 되지 않는다.

## Preset 설정과 coding loader 경계

일반 설정 원본은 builtin/common 선택이며 Preset 계정·model·prompt·자료·MCP·skill·지침 연결의 원본은 → lophn-agent/presets의 고정 판이다. 공통 judgment/organizing 값은 생성 후보만 제공한다. coding enabled·nullable 기본 harness·profile 선택은 → coding-agent/harnesses로 검증하고 machine-local executable·effective roots·receipt·관측은 TOML export와 분리한다.

connection 생성은 보호 화면의 exact scope 결정 → 신뢰 인증 경계의 token/keychain 준비 → connection 검증 hash commit → trusted loader 사용 순서다. commit 전·실패 token은 무효이며 고아 값을 정리한다. OS keychain 누락·잠김은 unavailable; 평문 token 파일·일반 env fallback은 없다. loader는 current connection·scope·catalog adapter·실제 child generation을 확인하고 process-local 보호 통로로 MCP/CLI 인증 adapter에만 전달한다. TUI [Start]는 기존 connection 사용 허락이며 credential 발급·scope 확대 허락을 대신하지 않는다. revoke는 keychain 삭제 완료와 별도로 모든 새 요청에서 즉시 적용한다. → platform/identity#R5,R15, platform/secrets#R12
