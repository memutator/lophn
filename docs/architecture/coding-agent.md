---
type: architecture
concerns: [coding-agent]
---
# coding-agent

## 1. 맡는 것과 맡지 않는 것

Claude Code, Codex, OpenCode, Hermes, pi, Gemini CLI, OpenClaw의 자기 터미널 세션과 사람 [Start]로 project 터미널 탭에 연 TUI에 MCP(stdio), CLI, skill을 제공한다. 제품 harness catalog·native 감지·선택 target 설치 receipt, credential 자동 발급·keychain 보관·회수, session 시작·derived 관측, 공통 안내와 summary·repair context, MCP ticket claim·완료 보고·machine check를 맡는다. connection과 ticket의 domain module은 core에 있지만, 큰 응답 조립과 검사는 core 밖이다.

- 시작 동작은 ticket·harness·방식 하나다. 지금은 사람이 자기 터미널에서 직접 시작하거나 [Start]로 project 터미널 탭의 TUI를 첫 prompt와 함께 연다. 클릭이 exact 시작 허락이며 ticket 생성·문제 발생·hook 조회는 착수 지시가 아니다. headless·자동 시작·preset 사전 허락·coordinator·coding loop는 이번 범위에 없다.
- 모든 coding 작업은 직접 요청·피드백도 lophn·App Engineer가 ticket으로 정리한 뒤 MCP claim→작업→보고한다. 근거 부족은 다음 결정으로 연결하고 ticket 없는 code 작업 fallback을 제공하지 않는다.
- source 편집은 외부 coding agent의 파일 도구가 한다. connection은 source lock도, 외부 프로세스 종료 권한도 아니다.
- 문서 version, format, blueprint, release, preview, 실제 Verification, problem 닫힘은 각각 소유 concern의 contract를 쓴다. 통로가 같은 사실의 별도 상태를 만들지 않는다.
- MCP·CLI·worker는 ledger와 앱 DB를 직접 열지 않는다. 어떤 coding agent 통로도 approval 결정·grant 변경·secret 값·운영 backup·원본 임의 파일 접근·machine test result 작성을 제공하지 않는다.
- 사람 전용 CLI command도 별도 user token 파일을 읽지 않는다. 되돌릴 수 없거나 심각한 사람 결정(연결 회수, secret 값 등록·삭제, 운영 앱 시작·중지, release activation, 문제 닫힘·무시, 테스트로 확인할 수 없는 수리의 "내가 확인함")만 **confirmation window** contract로 shell main에 넘기며 user credential은 main에만 남는다. 창을 열 수 없는 환경은 사람이 열 결정 링크와 대기 사실을 반환한다. ticket 생성·취소, [Start], harness 연결 생성·설치는 묻지 않는다.

## 2. 프로세스

### 2.1 수명과 통신

MCP·CLI·coding-agent worker에 shell/terminal의 PTY 실행 경계를 연결한다. installer·doctor·hook은 CLI mode이며 catalog·관측·receipt 관리도 core writer 밖이다. coding loop는 외부 harness가 소유한다.

| 프로세스 | 누가 시작하나 | 하는 일 | 종료·감독 |
|---|---|---|---|
| MCP `lophn-mcp` | 자기 터미널 또는 [Start] TUI의 제품 MCP client; session 소유 여부는 adapter별 관측 | JSON-RPC framing, tool discovery, 입력 검증, 공통 client 호출, MCP 결과 표현 | stdin EOF·세션 종료에 종료; 다시 시작은 제품이 결정. core는 띄우지 않음; OpenClaw session stdio 미확인은 unknown |
| CLI `lophn` | 사람 또는 coding agent의 shell command | argv·JSON 입력, 같은 공통 client, 사람이 읽는 출력·JSON, 설치·doctor·hook | 호출 한 번 뒤 종료. daemon start는 platform의 시작 통로에 요청하며 CLI가 writer가 되지 않음 |
| coding-agent worker | core의 프로세스 감독 | summary·repair context 조립, redaction·budget, ticket 조건 비교·test 요청, event 따라잡기 | core가 시작·감독·재시작. core 연결 상실 시 작업 중단; 새 credential로 reported 재조회 |
| 외부 harness TUI | 사람이 [Start]를 누른 exact plan을 shell main이 검증하고 shell/terminal PTY로 시작 | 제품 TUI·첫 prompt 수신·MCP 사용; native hook/plugin/extension의 검증 evidence만 관측 | 외부 harness가 coding loop 소유; 재시작·resume 자동 실행 없음, process 소유/종료는 shell/terminal contract |

core에는 `coding-agent/connection/commands`, `coding-agent/tickets/commands`, 각 read module만 둔다. claim 만료 60초 타이머는 core의 감독 timer가 만료 후보 read 뒤 `ticket.expire_claim`을 제출한다. timer 자체가 표를 쓰지 않는다. connection 회수 transaction은 새 인증을 즉시 막으며 claim 정리는 이후 command로 가능하다. 재시작 때도 먼저 만료 후보를 정리한다.

```text
사람 → 자기 터미널 / [Start] → shell main → project 터미널 PTY → coding agent TUI
         ├ MCP client ─ stdin/stdout ─ lophn-mcp ─┐
         ├ shell command ─ lophn CLI ────────────┼─ loopback HTTP JSON ─ core
         └ skill·AGENTS.md (로컬 파일)            │                    ├ 인증·read
                                                 │                    ├ command → ledger
                                                 │                    └ 요청 전달·감독
                                                 │                          │
                                                 │                   coding-agent worker
                                                 │                   ├ summary·repair 조립
                                                 │                   └ ticket check
                                                 │                          │
                                                 │                 read·blob·event·command
                                                 └ 앱 통로 (direct) → 앱/preview 프로세스
사람 전용 심각한 결정 → confirmation window → shell main → 사람 credential의 contract 호출
worker → test 실행·release 준비·format 실행 → 각 소유 프로세스 (결과만 core command)
```

core 주소는 `--daemon-url`, `LOPHN_DAEMON_URL`, 현재 daemon 연결 정보, 설치 설정, `http://127.0.0.1:7431` 순서다. 주소는 명시 loopback만 받는다. 주소가 바뀌어도 token을 재발급하지 않는다. actor는 인증 contract가 정한다. label은 `--label`, 제품 환경의 label, MCP `clientInfo.name` 순서의 표시 값일 뿐이다. 대상 앱은 `--app`, `LOPHN_APP`, 현재 작업 위치의 blueprint 순서로 찾고 실제 connection scope와 다시 비교한다.

모든 core RPC는 `POST /v1/<resource>/<method>`다. 공통 HTTP envelope·Authorization·Host/Origin·오류는 **인증**, **read**, **command** contract를 따른다. worker event는 **event 구독**의 WebSocket `/v1/events/subscribe`, 빠진 구간은 `/v1/events/list`로 따라잡는다. 앱 command 실행은 core RPC로 proxy하지 않고 **앱 통로**로 직접 간다.

### 2.2 실제 권한과 시작

설치 adapter가 절대 Deno executable, 분리 argv, 설치 resource·캐시 경로를 만든다. MCP 실행 argv의 기본 모양은 다음이다. 각 `<…>`는 설치 때 해석한 절대 경로·loopback endpoint이며 shell 문자열로 합치지 않는다.

```text
deno run --cached-only --no-prompt --config <resources>/deno.json
  --allow-read=<resources>,<cache>,<daemon-discovery-files>,<submission-root>
  --allow-env=LOPHN_HOME,LOPHN_CONNECTION,LOPHN_DAEMON_URL,LOPHN_APP,LOPHN_MCP_TOOLSETS,LOPHN_AGENT_LABEL,DENO_DIR
  --allow-net=<core-loopback-host:port>,<allowed-app-loopback-host:ports>
  <resources>/apps/mcp/main.ts
  --connection <cac-id> --toolsets core,app --cwd <submission-root>
```

- OS keychain 접근은 Deno의 광범위 run/FFI가 아니라 platform/identity의 helper `lophn-credential`(고정 권한 compile binary, 설치 묶음의 고정 절대 경로)이다. helper는 keychain을 직접 열지 않고 core의 소유자 전용 socket에 요청을 건네며 keychain 읽기는 core가 `secret-tool`로 한다(→ platform 3.1). MCP·CLI에는 `--allow-run=<helper 절대 경로>`만 준다. 통로는 stdin의 `CredentialDeliveryRequest`(connection·process generation·loader identity·purpose `mcp_cli_loader`)와 stdout의 token이고 timeout은 5초다. 잠김·Secret Service 없음·timeout·누락은 이유가 다른 unavailable이다(contracts/coding-agent `connection-auth`). MCP·CLI에 keychain 전체 조회·user token·임의 secret 권한을 주지 않는다. 같은 OS 사용자의 다른 프로세스가 helper를 부를 수 있는 한계는 platform/security#R2 범위 밖으로 받아들인다.
- MCP에는 `-A`, 무제한 read/write/env/run, helper 밖의 `--allow-run`, 앱 direct socket의 정확한 경로 밖의 `--allow-write`, `--allow-ffi`를 주지 않는다. 앱 direct socket에 연결하려면 Deno가 그 경로의 `--allow-net=unix:<경로>`·`--allow-read`·`--allow-write`를 함께 요구한다(Deno 2.9.7 실측). 그래서 MCP argv에는 앱 socket 자리 64개(`$XDG_RUNTIME_DIR/lophn/a0..a63.sock`, 이름 규칙은 contracts/apps `socket-slots`)의 정확한 경로만 net·read·write로 들어가고 폴더·와일드카드·다른 쓰기는 없다(open-issues coding-agent/mcp-server#Q9). format·빌드·테스트·source 배포는 담당 프로세스에 요청한다. loopback net permission은 listen과 connect를 구별하지 못하므로 MCP 코드는 listener를 만들지 않는다.
- Deno 파일 권한만으로 submission root 안의 symlink·금지 영역까지 안전하다고 보지 않는다. 명시 제출 파일과 연결 source는 realpath로 재검사한다. 운영 data·backup·추적 원본·다른 앱 source로 이어지는 경로는 거절한다. 원본 자료는 고정 Version 참조로 읽는다.
- 연결 source가 없는 문서 작업은 사람이 선택한 제출 workspace만 read allowlist에 넣는다. agent가 이미 가진 bytes를 제출할 수도 있다. core에는 클라이언트 파일 경로를 보내 서버가 읽게 하지 않는다.
- 일반 CLI도 같은 제한이다(open-issues coding-agent/mcp-server#Q9). 설치·감지·`daemon`·`sdk add --apply`가 요구하는 write·run은 정확한 경로·파일로만 연다: 쓰기는 `<H>/integrations`(receipt·journal·감지 결과)와 instance lock 파일(`<H>/run/instance.lock`), 실행은 helper·설치 Deno·`lophn-desktop` 세 파일, 읽기는 PATH의 절대 폴더와 감지가 보는 home 기준 bin 폴더(`DETECTION_FALLBACK_DIRS`), 환경은 `PATH`·`XDG_RUNTIME_DIR`·`TMPDIR`·`CODEX_HOME`·`XDG_CONFIG_HOME`·`HERMES_HOME`을 더한다. 명령 시점에야 알 수 있는 경로는 launcher가 같은 argv를 읽는 권한 계획 process(`apps/cli/launch.ts`)로 계산해 그 실행의 argv에만 더한다: `harness plan|install|update|remove`·`connection install`은 입력의 exact target 하나가 쓰는 설정 파일(`selectedWriteFiles`: 제품 설정 파일 하나와 앱 범위의 관리 구간 지침 파일, 각 파일의 `.lophn-tmp` temp 이름 포함)을, `sdk add --apply`는 core가 알려 준 앱 source의 `deno.json`·`deno.lock` 두 파일을 읽기·쓰기로 연다. 계산하지 못하면 아무것도 더하지 않고(그 command는 권한 오류가 `unavailable`이다) 폴더 단위·home 단위 grant와 `-A`·일반 `--allow-write`·`--allow-run`은 없다. 설정 파일은 같은 폴더의 정해진 temp 이름에 쓰고 rename한다(폴더 권한 없이). 폴더가 아직 없으면 만들지 못해 설치가 실패로 남고(제품을 한 번 실행해 폴더가 생긴 뒤 설치한다), 폴더를 볼 수 없어 symlink 검사는 설정 파일 자체의 symlink만 거절한다(쓰기 범위가 그 정확한 파일과 temp 이름으로 끝난다). MCP에는 이 통로가 없다. 제품 version·auth probe(`harness refresh`)의 실행 파일은 위 실행 권한에 없어 probe는 실행되지 않고 unknown으로 남는다. 기존 code를 고치는 permission은 없다.
- `sdk add --apply`의 source 쓰기·`deno.lock` 재생성(설치 Deno 하나의 run)은 MCP에 없고 MCP는 apply를 거절한다. 권한이 없으면 성공으로 꾸미지 않고 unavailable이다. doctor의 MCP probe는 절대 Deno executable 하나의 run permission만 추가한다.
- worker는 설치 코드 read, core loopback net, 전달받은 작업 credential만 가진다. source 디렉터리·ledger·앱 DB·keychain read/write·임의 run permission은 없다. 요청자의 connection을 인증 contract로 검증한 좁은 조회 context를 사용하며 machine credential로 범위 밖 근거를 대신 읽지 않는다. 테스트 credential은 test runner에만 있다.
- 패키지 설치는 코드·설정·Deno cache를 함께 설치한다. MCP 시작에 download·npx·원격 import를 넣지 않는다. 별도 외부 제품 adapter가 필요하면 제품의 사람이 승인한 설치 절차로 미리 설치하고 exact version을 고정한다.

### 2.3 connection credential 자동 발급·전달

1. 사람은 연결할 harness·profile·user/app 설치 target·label·all 또는 app 하나의 scope를 선택한다. 그 선택이 허락이며 confirmation window는 열지 않는다. token 생성·복사·붙여 넣기는 없다.
2. 인증의 trusted 경계가 core 밖에서 token을 자동 발급하고 OS keychain에 connection principal의 항목으로 보호 보관을 준비한다. 잠김·누락은 unavailable이고 평문 파일 fallback은 없다.
3. core command는 준비된 검증 hash와 정확한 사람 결정만 받아 connection·hash·event를 한 transaction에 기록한다. 원문 token은 command 입력·결과·API·event·stdout에 없다. commit 실패의 준비 keychain 항목은 사용 불가·정리한다.
4. 생성 성공 뒤 installer가 선택 target의 MCP·skill을 설치한다. 설정·wrapper에는 `--connection <cac-id>` 또는 `LOPHN_CONNECTION` 참조만 쓴다. MCP server·CLI 시작 때 `lophn-credential` helper가 keychain에서 꺼내 그 프로세스에만 전달하며 일곱 제품 config의 `env`에도 token은 없다.
5. lophn이 [Start]로 여는 TUI 프로세스에는 `LOPHN_CONNECTION=<cac-id>` 참조만 가고 token은 가지 않는다. 그 아래에서 harness가 띄운 lophn MCP·CLI가 4의 helper로 같은 connection credential을 받는다. TUI 전용 보호 전달은 없다. first prompt·argv·일반 env·PTY·log·model 문맥에 token 원문을 넣지 않는다.
6. 보관 준비 실패는 무생성이다. connection 생성 뒤 설치 실패는 connection 성공·component별 partial 실패로 분리하고 재발급하지 않는다. 설치 제거는 revoke가 아니며 scope 변경·분실은 사람이 기존 connection 회수 뒤 새 연결을 선택한다.

인증 실패에 user credential fallback·자동 재발급은 없다. 회수 직후 살아 있는 MCP와 direct-call 앱 credential의 새 요청도 거절된다. keychain 항목·설치 파일 삭제는 회수를 대신하지 않는다. harness/profile/session은 credential entity 필드가 아니다.

## 3. 저장

기본 home은 `~/.lophn`이며 설치·OS별 위치는 **인증**·platform의 설치 contract를 따른다. 아래 경로는 개발 통로가 운영 data를 읽을 수 있다는 뜻이 아니다.

| 자료 | 위치·소유 module | 쓰는 주체·규칙 |
|---|---|---|
| `coding_agent_connections` | `~/.lophn/lophn.db`; core `coding-agent/connection` | connection command만. label·scope·principal·token hash·회수·revision. 원문 token은 없음 |
| `tickets`, `ticket_references`, `ticket_adoption_questions`, `ticket_conditions`, `ticket_problems`, `ticket_open_repair_problems` | 같은 ledger; core `coding-agent/tickets` | 생성·취소·check command. 문제 독점 예약은 생성 transaction의 unique 제약; 종료 시 현재 예약만 제거 |
| `ticket_claims`, `ticket_completions`, `ticket_check_results` | 같은 ledger; core `coding-agent/tickets` | 현재 claim, 보고별 completion, 조건별 최신 check. 과거 completion·event 보존 |
| 완료 summary | **blob** contract의 `~/.lophn/blobs/sha256/…` | 변경·수행/미실행 확인·한계의 UTF-8 bytes를 redaction 후 준비. ledger에는 hash·영구 참조 |
| command 결과·event·worker cursor | platform ledger 표 | **command**, **event 구독**으로만. coding-agent 전용 작업 queue 없음 |
| HarnessDefinition catalog | 서명된 제품 배포 resource | catalog/adapter revision·검증 version·감지/설치/실행 계약; host absolute path·secret 없음 |
| 감지·설치/loading·session 관측 | derived memory/disposable local cache | environment/profile/catalog/generation별; stale/unknown 유지. 새 ledger 표 없음 |
| LocalIntegrationReceipt·recovery journal | `~/.lophn/integrations/` private local metadata | installer만. exact target·owned path/key/marker·last-written hash, component별 commit·복구; 운영 ledger 아님 |
| default/enabled/profile 선택 | platform/settings | 사용자 선택과 native local path 분리; 감지가 저장 선택을 덮지 않음 |
| token 원문 | OS keychain의 인증 경계 | 자동 발급·`lophn-credential` helper로 MCP·CLI에만 전달. backup·git·release·config 제외. coding-agent module은 token 파일·keychain secret 표를 만들지 않음 |
| 배포 skill·템플릿 | `<resources>/skills/<name>/SKILL.md`, `<resources>/templates/app/`; 서명된 설치 manifest | version·content hash 고정. 같은 version 내용 변경은 배포 테스트 실패 |
| 설치 사본 | 사람이 선택한 제품 skill root·제품 설정 | installer만. 동명 사람 파일은 충돌, 조용한 교체 금지 |
| 앱 공통 안내 | `<source>/AGENTS.md` | `<!-- begin lophn-managed -->`와 `<!-- end lophn-managed -->` 사이 하나만 갱신 |
| wrapper·local MCP·hook | `<source>/bin/lophn`, 제품 local 설정·skill 사본 | connection ID만. gitignore의 관리 구간에 local 파일을 안내; release bundle 제외 |
| session summary·repair context·추가 페이지·doctor 결과 | worker/CLI 메모리와 요청 응답 | derived, ID·ledger 표·blob 정본 없음. 다음 요청에서 다시 조립 |

이 concern은 derived SQLite·앱 DB를 두지 않는다. Report·Snapshot·Release·Version·Verification·고친 기록은 소유 concern 정본을 읽는 참조이지 여기에 복제한 기록이 아니다.

## 4. concern 배치표

| concern | 프로세스 | 모듈 | 저장 | 주로 쓰는 contract |
|---|---|---|---|---|
| coding-agent/connection | core, trusted 인증 경계, MCP/CLI loader | `connection/commands`, `connection/read`, `connection/credential` | `coding_agent_connections`, OS keychain | 인증, command, read, confirmation window |
| coding-agent/harnesses | CLI installer/doctor, core 밖 local adapter | `harnesses/catalog`, `detection`, `integration`, `receipts`, `adapters` | 배포 catalog·derived 관측·local receipt/journal | settings, 인증 참조, 파일 hash-CAS |
| coding-agent/sessions | shell main, terminal PTY, 관측 adapter | `sessions/plan`, `launch`, `observe` | launch plan·derived 관측, 새 ledger 없음 | shell/terminal, 인증, read, ticket 현재 claim |
| coding-agent/mcp-server | MCP | `mcp/stdio`, `mcp/server`, `mcp/tools`, `client` | 없음 | coding agent 통로, read, command, 앱 통로 |
| coding-agent/cli | CLI | `cli/parser`, `cli/commands`, `cli/output`, `client` | 설치 사본 외 없음 | coding agent 통로, confirmation window |
| coding-agent/guides | CLI installer/hook, worker | `guides/install`, `guides/managed-files`, `guides/summary`, `adapters` | 설치 skill·템플릿·AGENTS.md; summary는 없음 | read, 인증, release 준비·적용 |
| coding-agent/repair-context | worker | `repair-context/assemble`, `select`, `budget`, `cursor` | 없음 | read, blob, redaction, outline·search 읽기 |
| coding-agent/tickets | core, worker | `tickets/commands`, `read`, `checker` | ticket 표 9개 | command, read, event 구독, test 실행, release 준비·적용 |

leaf concern 8개 모두 배치했다. 내부 경로는 `packages/coding-agent/…`로 두며 옛 `v2`, 작업 번호, `coding-agent-interface` 패키지를 새 정본 이름으로 남기지 않는다.

## 5. 내놓는 contract

### 5.1 coding agent 통로의 공통 계약

**입력.** connection 선택, 등록된 tool/op 또는 CLI command, 대상 ID·고정 version 주소, 구조화 인자. 쓰기는 소유 command가 요구하는 `base_revision`·idempotency key를 전달한다. ticket 후속 쓰기는 `ticket`과 `claim_seq`도 필수다. 요청 본문에 actor를 받지 않는다. 한 작업은 공통 client의 등록된 동작 하나로만 라우팅하며 임의 core API 이름을 실행하는 passthrough는 없다.

**출력.** `{summary, data, next}`와 실패 시 안전한 `{code, message, details}`다. 정확한 core 성공·오류 envelope는 platform contract를 따르고 adapter는 다음 정보를 잃지 않는다.

- `summary`는 짧은 한 줄, `data`는 고정 주소·대상·관측 기준·현재 상태·검사 근거·누락·cursor, `next`는 실행 가능한 상세 read나 결정 위치다.
- 접수, 실제 시작, 실제 테스트 통과, release 준비, approval 대기, activation, ticket 확인됨, problem 닫힘은 별개 필드·참조다. 승인 대기는 요청 실패가 아니다.
- MCP는 `structuredContent`와 의미가 같은 JSON text content를 함께 반환한다. 본문을 summary에 중복하지 않는다. 이미지는 지원 client에서 별도 image content로만 제공한다.
- CLI `--json`은 stdout에 JSON 하나와 마지막 newline만 쓴다. stderr는 redaction된 진단만. 사람 출력도 같은 data를 표·본문·다음 command로 표현하며 없는 테스트를 성공으로 표시하지 않는다.
- CLI exit는 성공 접수·정상 read·approval 대기 `0`, 입력 `2`, 인증/범위 `3`, 실제 작업 실패·실제 test fail `4`, 전송 실패 `5`, 쓰기 응답 유실로 효과 확인 불가 `6`, 내부 실패 `1`이다. 테스트가 접수만 된 경우 `0`이어도 통과가 아니다. hook mode의 예외는 아래에 있다.

**범위 검사.** 아래 tool 표의 범위 표기는 `S`=현재 connection scope의 모든 대상과 하위 read, `A`=그 scope 안 app 및 연결 source의 realpath, `G`=공통 설치 format·SDK·템플릿, `ALL`=전체 connection에서만 등록이다. 목록·검색은 scope를 먼저 적용한 뒤 count·limit·cursor를 낸다. app scope에서 context·project를 읽을 수 없으면 제목·존재·개수를 대신 주지 않는다. ticket 근거는 권한을 확대하지 않으며 허용되지 않은 근거는 `현재 연결로 읽을 수 없음`만 준다.

**오류.** 모든 행은 `invalid_input`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `unavailable`, `internal`과 소유 contract의 세부 오류를 전달한다. 틀린 op·폐지 이름·필수 값·범위·cursor는 실행 전 거절한다. conflict 응답은 읽을 수 있는 현재 상태와 재조회만 포함한다. 전송 중 쓰기 결과를 모르면 별도 `effect_unknown` 진단과 원래 idempotency key·대상 조회를 반환하고 성공이나 domain 실패로 추측하지 않는다.

MCP protocol 오류는 JSON parse `-32700`, request 모양 `-32600`, 없는 method `-32601`, 없는 tool·MCP params `-32602`다. 알려진 tool의 실행·scope·입력 실패와 효과 불명은 JSON-RPC 응답 안 `isError: true`다. tool 숨기기만으로 권한을 막지 않으며 API에서도 같은 허용 목록을 검사한다.

**보장.** MCP·CLI는 같은 operation registry·validator·credential loader·client를 사용한다. 양쪽에 제공하는 같은 credential·입력·CAS·key의 domain 결과와 거절이 같다. 작업 claim은 MCP에만 두며 CLI claim은 MCP 연결·지정 ticket 안내만 반환한다. 읽기는 writer queue를 거치지 않는다. 반환 전에 scope·redaction을 적용한다. 앱 read는 direct call이며 invocation 기록 때문에 응답을 기다리지 않는다.

**보장하지 않는 것.** skill loading·준수, 외부 OS 파일 접근·git 편집·프로세스 종료, source 편집의 동시성 통제, 완료 주장의 진실, 응답 유실을 실패로 판정, 자동 새 실행, preview로 운영 정상·problem 닫힘 증명은 보장하지 않는다.

### 5.2 MCP 전체 목록

`core`가 기본이고 `app`은 `--toolsets core,app` 또는 `LOPHN_MCP_TOOLSETS=core,app`에서만 켠다. `ops`, `catalog`, `all` 별칭은 거절한다. 아래 고정 adapter tool은 15개이며 app toolset에는 5.2 뒤의 blueprint 유래 read tool도 포함한다. `op`를 표시하지 않은 tool은 단일 동작이다. 행의 op 목록이 고정 adapter의 완전한 허용 목록이며, 목록 밖 op는 없다. `?`는 선택 입력이다.

| tool / toolset | op와 입력 | data 출력 | 범위·추가 검증 |
|---|---|---|---|
| `lophn_session` / core | `summary` / app?, cursor? | scope, observed_seq/at, 문제·ticket 요약, 자기 claim·기한, reported 남은 조건, next_cursor, claim_rule | S; 조회만, 본문·log 없음 |
| `lophn_index` / core | `root`, `place`, `context`, `document`, `section`, `search`, `status` / place?, context?, address?, query?, depth?, cursor? | 목차·keyword 결과·고정 version·derived 반영 지연·이어 읽기 | S; context는 실제 관점, 소속 아님. 깊이·cursor는 outline contract |
| `lophn_project` / core | `list`, `show`, `current` / project? | 이름·제목·목적·프로젝트 문서 수·읽을 자료 참조; current는 가장 깊은 등록 폴더의 project 참조 하나, 불일치는 빈 목록과 등록 안내 | S; 절대 경로·폴더·tracking 규칙 없음. cwd는 입력이 아니라 연결 credential의 고정 근거 |
| `lophn_document` / core | `list`, `history`, `diff` / place? 또는 unplaced?, state?, limit?, cursor?, address?, from?, to?, section? | 목록·남은 허용 수·cursor; 고정 판 이력·줄 diff·누락 | S; list 1~500. diff 두 고정 판 필수, 의미 rename 추정 없음 |
| `lophn_read` / core | address, version?, section?, start?, length?, cursor? | 정확한 고정 판의 부분 본문·다음 범위·새 판 존재·부재/추출 실패 | S; cursor의 고정 version을 새 최신 판으로 바꾸지 않음 |
| `lophn_save` / core | paths(제출 root 기준 상대 경로, 첫 경로 primary), place?, slug?, title?, format?, series?, key?, base_revision?, idempotency_key | document·version·고정 주소·unchanged·format 경고·derived 지연 | S; local bytes 제출만. series면 key 필수. 명시 format 부적합은 무저장 |
| `lophn_format` / core | `list`, `show`, `validate` / media_type?, format?, paths? | 선언·작성 안내·bytes 검사 diagnostics(severity·위치) | G; validate는 format 실행 요청, agent 검사 주장 입력 없음 |
| `lophn_series` / core | `list`, `show`, `next` / place?, series?, key? | 규칙·정렬 인스턴스·다음 key/title 제안 또는 제안 불가 이유 | S; 계산만, 문서·series 생성 없음 |
| `lophn_context` / core | `list`, `show`, `items`, `glossary`, `of`, `propose` / context?, address?, perspective?, depth?, change?, reason?, idempotency_key? | 관점 항목·용어·문서 참조 context; propose는 고정 변경안 문서 주소·담당 agent 안내 | S; definition 직접 변경·직접 Question 생성 없음; 폴더/untracked 항목 제안 거절 |
| `lophn_question` / core | `list`, `show` / question?, app?, state?, cursor? | 범위 안 질문의 이유·option·고정 action·상태 | S; answer op 없음, 채택은 grant가 아님 |
| `lophn_approval` / core | `list`, `show` / approval?, app?, state?, cursor? | exact 대상·입력·영향·기한·대기/적용 상태·결정 위치 | S; allow/reject/consume op 없음 |
| `lophn_app` / app | `list`, `show`, `register`, `source`, `validate`, `test`, `preview_start`, `preview_stop`, `release_prepare`, `status`, `blueprint`, `invocations`, `logs`, `sync_tools`, `command`, `invocation` / app?, source?, name?, title?, purpose?, planning_version?, template_version?, bundle_hash?, timeout_ms?, problems?, ticket?, claim_seq?, command?, input?, environment?, invocation?, preview?, kind?, target?, test_hash?, check_index?, check_hash?, completion_seq?, before?, after?, basis_seq?, reports?, automation?, limit?, lines?, cursor?, base_revision?, idempotency_key? | 앱·source·검사 diagnostics·Verification/진행·preview 참조·prepared release·approval·현재 상태·invocation·log·배포별 변경 결과 | register ALL, 나머지 A. app test 기본 300,000ms를 runner에 명시. invocation 최대20, log 한 번에 1~200줄. release_prepare는 현재 ticket claim과 같은 hash 통과 근거 |
| `lophn_sdk` / app | `catalog`, `show`, `add` / query?, package?, version?, app?, apply? | catalog 이름·최신판·종류·설명, API/type/permission/peer/예제, exact import 안내·변경/무변경/충돌 | G; apply만 A. range version·미설치 version·조용한 upgrade 거절 |
| `lophn_problem` / app | `list`, `show`, `snapshot`, `fix_records`, `summary`, `bundle`, `more`, `record_fix`, `test` / app?, problem?, ticket?, claim_seq?, state?, handler?, kind?, source_ref?, cursor?, before_release?, after_release?, summary_version?, verification?, test_hash?, target?, basis_seq?, reports?, base_revision?, idempotency_key? | 문제·snapshot·고친 기록·bounded 수리 자료·추가 근거; record_fix 접수 event; 실제 테스트 접수/결과 | S/A. coding 쓰기는 현재 ticket/claim 필수; 과거 ticket 없는 기록은 조회만. more는 정본 참조만. claim·별도 repair 단계·닫힘·test result 입력 없음 |
| `lophn_ticket` / app | `list`, `show`, `checks`, `claim`, `renew`, `release`, `report` / app?, state?, limit?, cursor?, ticket?, claim_seq?, completion?, base_revision?, idempotency_key? | 목록·불변 본문·조건·현재 claim/작업 가능 여부·조건별 근거; claim connection/seq/기한; 보고 접수·남은 조건 | S/A; list1~20. 후속 쓰기는 유효 claim·이번 seq 검사. create/cancel/check 판정/start/resume/permission 응답 op 없음 |

위 표의 `?`는 여러 op를 합친 입력 목록에서의 선택 표시다. coding 작업의 source 구현·변경, `release_prepare`, `record_fix`에는 현재 `ticket`·`claim_seq`가 필수이며 조회·ticket 준비 전 근거 조사에만 생략할 수 있다. 문서 저장·설치 관측이 ticket claim을 만들거나 code 작업을 대신 허락하지 않는다.

고정 runtime adapter는 `lophn_app`의 조회와 동작 `command`, `invocation`으로 제공한다. `command` 입력은 app·command·JSON input·`environment: preview|live`·양의 timeout_ms?이며 기본 preview다. coding credential은 선언된 `effect=read`이며 `confirm=false`인 command만 호출한다. `invocation`은 app·invocation ID·같은 environment를 받아 실제 결과·효과 불명을 읽는다. CLI의 사람용 write/external·automation은 아래 사람 통로로만 제공한다. 이 두 op도 `lophn_app` schema의 완전한 op 목록에 포함한다.

app toolset에는 현재 scope 안 앱 blueprint의 read·비confirm command마다 직접 호출 tool을 추가한다(→ coding-agent/mcp-server#R34,R35). 이름은 `lophn_app_<app ID sha256 앞 12자>_<command 이름 sha256 앞 16자>`(39자)로 결정적으로 생성하고(Gemini CLI가 `mcp_lophn_`을 붙여 63자 안에 든다) 원 command 이름·설명·input schema를 그대로 쓴다. 같은 이름이 다른 command와 충돌하면 조용히 덮지 않고 discovery 실패를 반환한다. command input과 겹치지 않는 바깥 객체에 `input`, `environment`, `timeout_ms`를 두고 같은 앱 통로 client로 호출한다. registry는 app·release·blueprint 기준을 결합하며 호출 때 현재 credential·scope·release를 다시 검사한다. 판이 달라지면 옛 정의로 호출하지 않고 `conflict`와 목록 재조회를 반환한다. release·connection 변경은 `notifications/tools/list_changed`로 재발견을 안내하며 앱별 MCP 설정·별도 앱 MCP 프로세스는 만들지 않는다.

secret 사용은 호출자 종류가 아니라 현재 앱 grant와 network host를 따르며 값은 **앱 통로**의 전송 경계가 붙인다. 외부 조회만 하는 command는 read, 조회해 앱에 저장하면 write, 앱 밖 상태를 바꾸면 external이다. 사람용 automation 수동 호출도 external·confirm 선언/실행 금지를 우회하지 않는다(→ apps/blueprint, apps/permissions, apps/automations).

`readOnlyHint`는 session/index/project/document/read/series/question/approval 및 blueprint 유래 read tool에만 붙인다. validate 실행을 가진 format, propose를 가진 context, 나머지 혼합 tool에는 붙이지 않는다. discovery schema의 minified UTF-8 JSON과 배포에서 고정한 tokenizer로 고정 15개 및 현재 동적 목록의 token 수를 각각 재측정하고 결과를 배포 테스트에 둔다. 2,000 token은 목표이며 옛 측정값을 새 보장으로 재사용하지 않는다.

### 5.3 이 concern의 core RPC 목록

외부 통로가 호출하는 이 concern 소유 RPC만 적는다. 다른 concern의 경로·entity를 이 파일에서 재정의하지 않는다. 아래 쓰기는 **command**, 조회는 **read** envelope를 사용한다.

| RPC (모두 POST) | 입력 → 출력 | 권한·CAS·오류 |
|---|---|---|
| `/v1/coding_agent_connections/list`, `/show` | filter/cursor 또는 connection → 원문·hash 없는 connection | 인증 scope; 다른 연결 token 없음 |
| `/v1/coding_agent_connections/create` | id,label,scope,인증 경계의 준비된 token 검증 hash,key → connection; 원문 없음; 확인 창 없음 | user만; ID 미존재·app 존재·사람이 고른 입력 일치·보호 보관 준비; invalid_input/forbidden/conflict |
| `/v1/coding_agent_connections/connect` (memory) | label,scope → connection 참조만; token·hash 없음; 확인 창 없음; ledger envelope 없음 | user만(shell main이 사람 credential로 부름). core의 인증 경계가 token을 자동 발급·keychain 보관한 뒤 같은 사람 credential로 `create`를 제출한다; 보관 준비 실패는 무생성(unavailable); coding agent·app는 호출 불가 |
| `/v1/coding_agent_connections/revoke` | connection,base_revision,confirmation window 근거,key → revoked connection | user만; active·revision·exact 확인; not_found/forbidden/conflict |
| `/v1/coding_agent_sessions/summary` | app?,cursor? → CodingAgentSessionSummary | coding connection scope; worker 조립. 인증 실패를 빈 결과로 바꾸지 않음 |
| `/v1/repair_context/summary`, `/bundle` | problem 또는 repair ticket → 요약 또는 RepairContext | 현재 connection의 모든 참조 검사; 둘 다 상태 무변경 |
| `/v1/repair_context/more` | problem,kind,source,cursor? → evidence page·next_cursor | 고정 조건 cursor, scope·redaction·kind budget. 틀린 cursor invalid_input |
| `/v1/tickets/list`, `/show`, `/checks` | app/state/limit/cursor 또는 ticket → 요약·전체 ticket·check | scope; list 최대20, 본문 없음; show는 모든 고정 근거·조건 |
| `/v1/tickets/create` | Ticket 불변 필드,readiness,needs,key → open ticket | user·lophn·담당 App Engineer만. 생성 시 문제 독점 unique·판/채택 답·조건; invalid_input/forbidden/not_found/conflict |
| `/v1/tickets/make_ready` | ticket,base_revision,근거·채택 답·조건,key → ready ticket | lophn·담당 App Engineer만. needs_confirmation에서만; 근거·채택 답·조건을 한 번만 채움. invalid_input/forbidden/not_found/conflict |
| `/v1/tickets/claim` | ticket,base_revision,key → claimed ticket·connection·claim_seq·expires_at | coding_agent; open/check_failed·active connection·scope·revision |
| `/v1/tickets/renew_claim`, `/release_claim` | ticket,claim_seq,base_revision,key → 현재 claim 또는 open | 현재 coding_agent만; seq·connection·기한. unauthorized/forbidden/conflict |
| `/v1/tickets/upload_summary` (upload) | `x-lophn-input` {blob_hash, bytes ≤256KiB}, body summary bytes → ticket_summary 준비 참조 | coding_agent; purpose·상한은 ticket 등록값 고정, 주체는 요청 credential, 바이트는 해석 없이 blob 준비로 흘린다. 이어지는 report_completion이 같은 transaction에서 영구 참조를 등록한다. invalid_input/unauthorized/unavailable |
| `/v1/tickets/report_completion` | ticket,claim_seq,base_revision,completion,key → reported ticket·completion_seq | 유효 claim·같은 app/ticket/claim release·모든 참조 검사. invalid_input/unauthorized/forbidden/not_found/conflict |
| `/v1/tickets/expire_claim` | ticket,claim_seq,key → open 또는 충돌 | 배정 machine만; 만료/회수와 현재 seq 재검사 |
| `/v1/tickets/record_checks` | ticket,completion_seq,base_revision,checks,대상 revision,key → reported/confirmed/check_failed | checker machine만; 최신 보고·현재 대상·Verification hash 재검사. invalid_input/forbidden/conflict |
| `/v1/tickets/cancel` | ticket,reason,base_revision,key → cancelled | user 또는 허용 revert machine만; 종료 전·1~200자 사유; invalid_input/forbidden/conflict |

connection event는 `CodingAgentConnectionCreated`, `CodingAgentConnectionRevoked`다. ticket event는 `TicketCreated`, `TicketMadeReady`, `TicketClaimed`, `TicketClaimRenewed`, `TicketClaimReleased`, `TicketCompletionReported`, `TicketChecksRecorded`, `TicketConfirmed`, `TicketCheckFailed`, `TicketCancelled`다. payload와 상태 전이는 `coding-agent/connection`, `coding-agent/tickets` domain model을 그대로 따른다. 통로 별칭 event·외부 세션 heartbeat event는 없다.

### 5.4 CLI 전체 command와 출력

`lophn <group> <command>`가 정본 이름이다. 아래 command 외 별칭은 없다. 모든 command는 `--json`·`--help`를 지원한다. 공통 선택은 `--connection`, `--daemon-url`, `--app`; 쓰기는 `--base-revision`, `--idempotency-key`, ticket 후속은 `--claim-seq`다. JSON input은 `--input '<json>'` 또는 `--input-file <path>` 하나만 받고 상대 경로는 현재 작업 위치 기준이다. 파일 여러 개는 save의 위치 인자이며 첫 파일이 primary다.

| command 전체 목록 | 주요 입력 | 출력 data·권한 |
|---|---|---|
| `help [group [command]]`, `version` | command? | 목적·인자·JSON 예·read/write·사람 전용·confirmation 필요·다음 조회; 설치 version |
| `doctor` | `--target`, app?, connection? | daemon·인증·설정과 네 loading 단계별 success/failure/unknown·이유·다음 확인 |
| `daemon start|stop|status|logs` | logs cursor/lines? | 접수와 실제 상태·안전 log 구별. start/stop 사람 전용; coding credential에서는 거절 |
| `connection list|show|create|revoke` | show/revoke ID, create label·scope, revoke revision | 원문 없는 연결. create는 사람 선택만, revoke만 confirmation window. 둘 다 사람 전용 |
| `mcp config` | `--target`, `--scope user|app`, connection, toolsets? | 절대 executable·argv·안전 env의 제품별 조각만. 설정 파일 무변경 |
| `connection install` | 선택 harness/profile·scope·connection·app? | 기존 connection의 선택 target 재설치; 사람 전용·동일 receipt 계약. 자동 재발급 없음 |
| `harness list|detect|refresh|inspect|plan|install|update|remove` | exact native target/profile·user/app scope·components·plan·operation key | catalog·최초 감지·명시 재감지·resource별 diff/outcome·receipt·네 loading 관측. 관리 쓰기 사람 전용; 전체 자동 설치 없음 |
| `skills list|install` | install `--target`, profile?, `--scope`, names? | 이름·설명·version/hash, 파일별 변경/무변경/충돌. 동명 비관리 skill 교체 없음 |
| `session summary` | app?, cursor?, `--hook`? | lophn_session 결과. hook mode는 아래 별도 상한 |
| `session plan` | `plan_input`(ticket·revision·connection·harness·profile·project·folder_ref·cwd·method·shell main이 다시 읽은 `facts`·human_start_handle·operation_id) | method가 `terminal_tui`면 LaunchPlan, `own_terminal`이면 안내. process를 열지 않는다. core를 읽지 않고 저장한 감지와 지금 본 실행 파일을 쓴다. 사람 전용 |
| `session observe` | `--hook <harness>`, stdin의 hook·plugin·extension payload(JSON 하나 또는 NDJSON) | 제품별 normalizer가 정규화한 HarnessSessionObservation NDJSON을 환경 `LOPHN_TERMINAL_OBSERVE` socket에만 쓴다. 환경이 없으면 stdin도 읽지 않고 아무것도 보내지 않는다. core·credential을 부르지 않고 stdout은 비며 exit는 0이다. 사람 전용 아님(TUI 아래 hook이 부른다) |
| `index root|place|context|document|section|status`, `search <query>` | 대상·depth·cursor·place? | lophn_index 결과; saved view 전용 command 없음 |
| `read <address>` | version/section/start/length/cursor? | lophn_read 결과·정확한 판·이어 읽기 |
| `document list|history|diff`, `save <files...>` | 목록 place/unplaced/state/limit; 비교 from/to; 저장 metadata | lophn_document/save 결과·주소·검사 경고·unchanged |
| `format list|show|validate` | media-type/format/files | lophn_format 결과 |
| `project list|show|current` | ID/cwd | 읽기는 lophn_project. 등록·보관·연결은 화면 |
| `context list|show|items|glossary|of|propose` | context/address/perspective/depth; propose change/reason | 읽기·제안은 lophn_context. 생성·항목 추가는 화면 |
| `series list|show|next` | place/series/key | 읽기는 lophn_series. series 생성은 화면 |
| `question list|show|open`, `approval list|show|open` | ID/filter/cursor | 조회 또는 exact 결정 화면·대기 링크. open이 답·허락을 뜻하지 않음 |
| `app list|show|path|register|source|validate|test|preview start|preview stop|release prepare|status|blueprint|invocations|logs|sync-tools` | 대응 MCP 입력; path는 app, preview stop은 preview 참조 | lophn_app 결과. register 전체 연결만. test 기본300초; sync-tools 파일별 결과 |
| `sdk catalog|show|add` | query/package/exact version, `--apply`? | lophn_sdk 결과; 기본 import 안내, 명시 source 반영만 |
| `app command`, `app invocation`, `app automation run` | app·command·input·environment; invocation ID; automation 이름 | 실제 결과·invocation·approval 대기. coding은 read만, automation 수행·운영 write/external은 사람 요청만 |
| `app start|stop|release activate` | app, exact release/대상 입력 | 사람 보호 결정 대기와 실제 상태. coding credential은 거절 |
| `problem list|show|snapshot|fix-records|summary|bundle|more|record-fix|test` | 대응 MCP 입력; more kind/source-ref/cursor | lophn_problem 결과; image 미지원은 허용 첨부 열기 참조·종류·크기 |
| `problem attachment open` | problem·snapshot·첨부 참조 | 허용된 첨부의 로컬 열기. 운영 경로 대신 안전한 참조; scope·redaction 검사 |
| `problem report|request-repair|confirm|dismiss` | report app/한 줄 증상, request problem(ticket 준비), confirm 근거, dismiss 사유/false-alarm? | feedback 접수·담당 agent의 ticket 준비/지정 ticket 지시·결정 화면. 사람 전용; 요청은 자동 agent 시작 아님 |
| `ticket list|show|checks|claim|renew|release|report|create|cancel` | 대응 MCP 입력; report JSON; create 불변 필드; cancel 사유 | lophn_ticket 결과. create/cancel은 사람 통로이고 확인 창 없음, claim은 MCP 안내만, check 판정 command 없음 |

`app test`는 app test·test command·reproduction test 요청을 구별하는 `--kind`와 그 소유 contract 입력을 받는다. 일반 shell stdout를 test result로 제출하는 옵션은 없다. `ticket report`는 release·summary 문서/bytes·outputs·문제별 fix event·Verification 참조를 받되 완료 seq를 입력받지 않는다. `document history`는 from/to와 선택 section의 고정 이력이며 diff의 rename 추정은 없다.

사람 전용 CLI는 `--yes`, TTY yes, approve/reject 별칭을 만들지 않는다. 사람 credential이 없는 headless에서는 이미 도는 core의 상태를 coding credential으로 허용 범위만 읽을 수 있고, 심각한 사람 결정만 confirmation window 시작/결정 안내로 남는다. secret·project·context·series의 사람 관리는 CLI에 없고 화면에서 한다. headless daemon 시작은 platform의 로컬 설치·시작 contract를 쓰며 coding token으로 요청할 수 없다.

### 5.5 일곱 제품 설치 adapter와 안내

HarnessDefinition의 adapter manifest는 검증한 제품 version·설정 schema·effective profile의 user/app 위치·loading probe·detection/version/auth·hook·TUI 첫 prompt와 session evidence 계약을 고정한다. domain 정본은 → coding-agent/harnesses, coding-agent/sessions다. 설치 당시 capability가 맞지 않으면 자동 설정 대신 조각과 다음 수동 확인을 제공한다. 기존 server·env·permission·trust·hook·동명 skill을 덮어쓰지 않는다. 아래는 각 제품의 통로를 만드는 모양이다.

| 제품 | MCP 설치 연결 | skill root (user / app) | 앱 공통 안내·주의 |
|---|---|---|---|
| Claude Code | 사람 user 등록 또는 app `.mcp.json`의 `mcpServers.lophn`: command·args·env | `~/.claude/skills` / `.claude/skills` | `CLAUDE.md` 관리 구간의 `@AGENTS.md`; 기존 import·permission 보존. `.claude/settings.local.json`의 lophn SessionStart 항목만 설치 |
| Codex | 사람이 Codex를 고르면 effective `CODEX_HOME`(기본 `~/.codex`)/`config.toml`의 `[mcp_servers.lophn]`: command·args·env를 receipt와 함께 설치 | `~/.agents/skills` / `.agents/skills` | `AGENTS.md`; 더 가까운 `AGENTS.override.md`·안내 검사. 앱별 TOML/MCP 파일은 만들지 않음. 사람이 고친 hash는 충돌 |
| OpenCode | `~/.config/opencode/opencode.json` 또는 app `opencode.json`: `mcp.lophn`의 type=local·command 배열·environment | `~/.config/opencode/skills` / `.opencode/skills` | `AGENTS.md`; 기존 rules·다른 config 우선순위 유지 |
| Hermes | `$HERMES_HOME/config.yaml`(기본 `~/.hermes/config.yaml`)의 `mcp_servers.lophn`: command·args·env·cwd | `$HERMES_HOME/skills` / `.hermes/skills` | `AGENTS.md`; project skill trust는 사람이 `hermes skills trust`로 결정. 프로필 home과 실제 workspace 확인 |
| pi | `~/.pi/agent/mcp.json`(user)과 trusted `<cwd>/.pi/mcp.json`(app)의 `mcpServers.lophn` stdio command·args·env·cwd | `~/.pi/agent/skills` / `.pi/skills` | `AGENTS.md`; 더 가까운 `AGENTS.override.md` 검사. MCP script/proxy가 필수인 형태는 사용하지 않음. 깨진 `mcp.json`은 파일 전체 건너뜀이므로 무변경 |
| Gemini CLI | `~/.gemini/settings.json` 또는 `.gemini/settings.json`의 `mcpServers.lophn`: command·args·env | `~/.gemini/skills` / `.gemini/skills` | context.fileName의 기존 목록을 보존하고 `AGENTS.md` 참조 추가. trust=true 자동 설정·skill consent 생략 없음 |
| OpenClaw | 사람의 config `mcp.servers.lophn` stdio command·args·cwd 조각; 지원 version의 MCP client 검사 | `~/.openclaw/skills` / 사람이 선택한 agent workspace의 `skills` | workspace `AGENTS.md`는 앱 root와 다를 수 있음. 앱 정본을 명시 읽게 안내하며 workspace를 바꾸거나 규칙 복제하지 않음. 세션 소유 stdio 미확인은 unknown·CLI fallback |

OpenClaw gateway·제품의 shared MCP 수명은 lophn이 세션별 프로세스를 보장했다는 뜻이 아니다. 세션별 MCP를 확인하지 못하는 경우에도 같은 connection의 CLI·skill 연결을 별도로 검사한다. 지원하지 않는 adapter를 성공으로 출력하지 않는다. 공식 설정 모양 확인 자료는 OpenCode의 MCP/skills, Gemini CLI의 MCP/skills, Hermes의 MCP/skills, OpenClaw의 MCP/skills 및 pi MCP adapter다(아래 참고).

설치 알고리즘은 다음이다.

1. 선택 제품·native environment/profile·effective config roots·user/app scope·connection·app realpath·catalog/adapter revision으로 exact target plan을 만들고 서명된 manifest의 version/hash·skill frontmatter·본문 500줄 미만·한 단계 참조를 검사한다. 문자 상한은 Unicode code point, 줄은 CRLF를 LF로 정규화한 logical line 기준이다.
2. skill root 바로 아래 `<name>/SKILL.md`와 직접 참조 파일을 함께 복사한다. 이름·설명만 시작 discovery에 보이고 본문은 필요한 skill을 읽을 때만 들어간다. 동명 사람 skill은 conflict다. lophn 관리 사본도 receipt의 last-written hash와 다르면 사용자 변경으로 보존한다. receipt 없는 동명 사본은 소유한다고 추정하지 않는다.
3. 새 템플릿은 처음부터 AGENTS.md 관리 marker 쌍을 갖는다. 갱신은 정확한 쌍 하나의 내부만 교체한다. marker 없음·중복·불완전은 무변경·사람 복구 안내다. 앞뒤 bytes는 그대로 둔다.
4. MCP 설정은 해당 lophn key만 merge하고 CLI wrapper는 절대 설치 client와 connection ID·app 기본값만 넣는다. 사람이 Codex를 고르면 사용자 config의 lophn 항목만 receipt와 함께 쓴다. 앱 TOML은 만들지 않는다. ignore와 제품 얇은 안내도 관리 부분만 바꾼다. broken JSON/TOML/YAML은 무변경이다.
5. receipt의 owned resource/fragment digest와 현재 digest 일치, 계획에서 읽은 전체 파일 hash와 교체 직전 hash 일치를 모두 검사한다. 불일치·외부 symlink·동명 비관리 resource는 conflict다. 같은 디렉터리 temp/fsync/rename으로 파일별 교체하고 committed resource의 receipt를 갱신한다. 제거도 같은 ownership+hash 조건에서 owned fragment/file만 지우며 user 영역은 남긴다. changed/unchanged/skipped/conflict/failed·receipt outcome을 resource별로 반환하고 multi-file 원자성을 주장하지 않는다. receipt 저장 실패는 partial+recovery journal이며 재검사 전 추가 갱신·제거를 막는다.
6. MCP initialize·tool discovery·skill name/description discovery·app guide loading을 각각 success/failure/unknown으로 기록한다. 파일 존재만으로 loading 성공이라고 하지 않는다. override·동명 skill·더 가까운 안내·별도 workspace·trust 거절의 다음 확인을 준다.

배포 네 skill은 `lophn-navigate`, `lophn-save`, `lophn-build-app`, `lophn-repair`다. 앱 템플릿은 **release 준비·적용**과 **test 실행** 관문을 안내하고 code·SDK layout은 apps 소유다. 공통 안내에는 고정 설계 주소, SDK 재사용, blueprint 먼저 수정, machine 생성 테스트 수정 금지, 문제 code·reportProblem·예외·피드백 연결 보존, 실제 테스트·preview·결과 반환, 사람 지시 claim, 금지 작업만 둔다. 변하는 ticket·repair bundle·token은 없다. 안내·skill·wrapper·hook·제품 local MCP 설정은 운영 release에서 제외한다.

Claude Code hook은 `session summary --hook --app <app>`을 사용한다. 시작·재개·초기화에 warning 이상 coding_agent 대상 open/fixing 문제를 최대3개, 열린/check_failed ticket의 요약·나머지 수·상세 읽기·마지막 착수 금지 문장을 합쳐 **10줄·1,200 code point 이하**로 만든다. info·사람 처리 문제는 제외한다. 전체 timeout5초, core 대기3초이며 장애·빈 결과는 stdout 빈 값·exit0으로 끝낸다. 이는 일반 summary의 실패 표시와 다르고 hook이 세션 시작을 막지 않기 위한 예외다. doctor·명시 summary에는 실패 이유를 표시한다. 나머지 여섯 제품은 같은 summary를 명시 조회한다. 상태 수집 hook/plugin/extension은 summary와 별도 목적·receipt·version 검증이다. Claude settings, Codex effective CODEX_HOME hooks, Gemini settings, Hermes YAML/plugin, OpenCode XDG plugin, pi extension을 서로 다른 target으로 두고 미검증 status adapter/OpenClaw는 unknown이다. hook 설치로 trust·permission 응답 권한을 열지 않는다.

### 5.6 repair context 조립·budget·cursor

`repair-context/assemble`은 coding-agent worker에서 요청마다 현재 read·고정 blob을 모은다. `observed_at`, 읽은 대상별 `basis` revision, 증상 당시 시각·발생 release·source commit 기준을 함께 낸다. ticket은 연결된 문제를 각각 구별하며 ticket 준비 전 조사는 problem 하나·ticket=null이다. 이 조회로 code 작업을 시작하지 않는다. 완성 묶음은 저장하지 않는다.

절 순서는 domain model의 15종 그대로다. `target_symptom → human_text → inspect → acceptance_checks → preserve → failure_basis → representative_occurrences → preceding_changes → logs → past_repairs → related_problems → attachments → reproduction → more → return_method`다. 내용도 누락 사실도 없는 절만 뺀다. raw 사람 말·앱 문자열·log는 명시 data fence 안에 두며 가설·해석과 분리한다.

| 부분 | 적용 상한 (줄·문자·개수 제한은 모두 적용) |
|---|---|
| 머리·증상 | 머리6줄; 증상 문제당1줄·전체2줄 |
| 사람 말·볼 곳 | 사람 말5줄·문제당300자; inspect10줄·5근거 |
| acceptance·preserve | 각각8줄·200자 요약; 전체 조건·제약 참조 필수 |
| 실패·대표 발생 | 실패 invocation15줄; 첫·마지막·차이가 큰 발생 최대3개·전체30줄·각400자 |
| 직전 변화·log·지난 고친 기록 | 변화12개·14줄·각100자; 기본 log45줄; 최신 고친 기록5개·10줄 |
| 관련 문제·첨부 | 관계별5줄·전체10문제; 첨부40줄·image metadata20개; command 결과 각3행 |
| 재현·추가 읽기·반환 | 재현6줄·500자; more5줄・근거 목록은 추가 페이지; return4줄 |
| summary | 문제당2줄·전체10줄·1,200자 |
| 전체 텍스트 | ticket 모든 문제 합산24,576 UTF-8 bytes·300줄; 누락·잘림·이어 읽기 포함 |

대표 발생은 Report 접수 seq의 첫·마지막을 중복 없이 고른 뒤, 고정 근거의 `(release, 실패 command, evidence 종류 집합, 보존된 stack source 위치)` fingerprint에서 앞의 대표와 항목 불일치 수가 가장 큰 후보를 고른다. 동률은 낮은 Report seq다. 현재 source를 읽어 fingerprint를 보충하지 않는다. 직전 변화는 첫 발생7일 전부터 observed_at까지의 허용된 release·문서 변경 참조를 첫 발생과 시각 거리, event seq 순서로 최대12개 고른다. 원인이라고 확정하지 않는다.

budget은 **scope 검사 → 정본 read → redaction → 절별 제한 → 최종 렌더·계수 → 전체 축소 → 최종 redaction 안전 확인** 순서다. redaction 실패면 원문을 빼고 이유·실제 추가 조회를 남긴다. `TextEncoder`로 UTF-8 bytes를 세고 newline으로 logical lines를 센다. 긴 한 줄도 bytes 제한을 받는다. 초과면 log → 대표 excerpt → 첨부 metadata 순서로 줄인다. 그래도 넘으면 상태·필수 근거 ID·실제 more를 남기고 나머지는 페이지 참조로 바꾼다. Unicode code point 중간·JSON 구조 중간을 자르지 않는다. 텍스트와 구조화 sections는 같은 제한된 내용이며 원문을 JSON에 별도로 숨겨 넣지 않는다.

source diff는 첫 발생 전 고정 release와 현재 고정 release의 변경 통계·관련 source 차이를 **release 준비·적용**의 허용 보존 참조로 읽는다. 보존 근거가 없으면 없는 이유만 내고 현재 source 파일을 당시 근거로 보충하지 않는다.

추가 페이지는 `log`200줄, `occurrences`20개, `source_diff`300줄, `screen`24,576bytes와 공통24,576bytes·300줄 제한을 함께 받는다. image는 redaction 뒤 하나2,097,152bytes, 기본 bundle에 binary/base64를 넣지 않는다. 큰 image는 크기·미제공 이유만, 자동 원문 fallback은 없다. CLI/텍스트-only MCP는 scope 검사한 첨부 열기 참조·종류·크기로 잇는다.

cursor는 worker가 만든 opaque base64url payload에 서버 MAC을 붙인다. 내용은 connection principal·app/problem·kind·고정 Report/Snapshot/Release/Version 참조·filter·next offset이다. 이는 token이 아닌 이어 읽기 비교값이고 scope를 대체하지 않는다. 매 페이지마다 connection 회수·scope를 다시 검사한다. 다른 대상·kind·filter에 재사용하거나 변조하면 invalid_input이다. 고정 대상이 없어졌거나 읽을 수 없으면 이유를 반환하고 최신 대상으로 몰래 이어 읽지 않는다. worker 재시작으로 cursor를 검증할 수 없으면 첫 페이지 재조회 안내를 반환한다.

## 6. 쓰는 contract

| contract · 소유 | 쓰는 곳 |
|---|---|
| 인증·command·read · platform | connection actor/scope·매 요청 회수 검사, 자기 domain module의 짧은 쓰기, scope로 거른 읽기 |
| event 구독 · platform | worker cursor 따라잡기, 완료 보고·Verification·problem·release 변경에 ticket 조건 재비교 |
| blob · platform | 제출 bytes·완료 summary 준비, 허용 정본 근거 read; hash 단독 접근 금지 |
| redaction · platform | summary·bundle·페이지·이미지·JSON·진단 반환 전 |
| approval · platform | 대기·exact 대상·결정 위치 읽기만. coding 통로가 결정·소비하지 않음 |
| format 실행·outline·search 읽기 · documents | bytes 검사, 고정 판의 목차→section→본문, 이력·diff·지연 |
| 앱 통로 · apps | preview 및 허용 read direct call, 같은 environment invocation 조회 |
| release 준비·적용 · apps | 연결 source의 고정 bundle·같은 hash app test·ticket/claim 출처·activation 대기. 실제 적용은 apps |
| test 실행 · problems | 실제 app/reproduction/test command 요청·Verification read. checker도 결과를 직접 쓰지 않음 |
| confirmation window · shell | 연결 회수·secret 값 등록·삭제·운영 앱 시작·중지·release activation·문제 닫힘·무시·"내가 확인함"의 exact 입력 전달·링크·대기 |

템플릿의 예외·feedback 연결은 **문제 보고**, **앱 화면 틀**을 쓰는 앱 code다. MCP가 앱 actor인 척 보고하지 않는다. context 제안은 고정 변경안 문서로 남긴 뒤 담당 agent가 **agent run**과 질문 소유 규칙으로 사람에게 연결한다.

## 7. 흐름

### 7.1 harness 감지·연결·설치

```text
[최초 native lookup / 사람 Refresh] PATH·bounded fallback 읽기 → environment/profile별 HarnessDetection
 → [사람] harness·profile·설치 범위·connection scope 선택
 → [사람 선택] exact connection 범위 (확인 창 없음)
 → [인증 trusted 경계] token 자동 발급·OS keychain 보관 준비 (core 밖)
 → [core] connection.create(hash만) → connection+hash+event
 → [인증 경계] commit 확인; 실패 준비는 사용 불가·정리
 → [installer] catalog revision·target·receipt·hash 검사 → 파일별 commit·receipt
 → [doctor] component 상태와 네 loading stage 별도 관측
```

재감지는 사람이 요청할 때만 한다. PATH·profile·catalog 변경은 cache를 stale로 만들되 자동 탐색·설치·시작하지 않는다. 감지는 credential을 만들지 않는다. 사람이 Codex를 고르면 사용자 config의 lophn MCP 항목만 receipt와 함께 설치하고 앱 TOML은 만들지 않으며 사람이 고친 hash는 충돌이다. keychain 보관 실패는 무생성, 설치 부분 실패는 발급 성공과 별도로 표시한다. unknown auth/loading을 성공이나 부재로 바꾸지 않는다.

### 7.1.1 지정 ticket의 사람 시작

```text
[사람] ticket·harness·방식 선택
 ├ 자기 터미널: 사람이 직접 제품 TUI를 열고 지정 ticket 지시
 └ [Start]: exact one-use start handle → shell main 검증
     → 현재 ticket revision/claim 없음·connection scope·executable/profile·project 폴더 재검사
     → 인증 경계가 connection credential 보호 전달
     → shell/terminal의 project PTY 탭에 catalog argv로 TUI spawn
     → first prompt 1회 전달 (지정 ticket read → MCP claim → 작업 → 보고)
 → [제품 MCP client] lophn-mcp 시작 → keychain loader → initialize/tools list
 → [coding agent] ticket show → MCP ticket.claim (실제 claim 경쟁/CAS)
 → [상태 adapter] native ID·상태 evidence → derived session 관측
```

[Start]가 시작 허락이며 별도 시작 confirmation window는 없다. 연결 생성·scope 확대·harness 자체 trust·release activation의 허락을 대신하지 않는다. 등록 project와 연결 source가 없거나 여러 폴더 선택이 미정이면 다음 연결/선택 안내로 끝난다. 실행 전에 다른 harness로 fallback하거나 재감지하지 않는다. status `starting/ready/working/waiting_input/ended/unknown`은 claim·보고·실제 테스트와 별개다. session ID가 없으면 null이며 탭/connection/ses ID로 채우지 않는다. 자기 터미널 session은 확인된 MCP binding/evidence만 연결하고 lophn process 소유로 표시하지 않는다.

readiness·first prompt 전달이 불명이면 unknown이며 자동 입력 재전송·새 process 시작이 없다. lophn 재시작 뒤 terminal 복원은 새 TUI 실행이 아니며 evidence 재연결 전 unknown이다. 나중 headless·자동 시작·coordinator는 현재 method·MCP op·ledger에 열지 않는다.

### 7.2 문서 저장

```text
[coding agent] format 안내·허용 place·현재 version 읽기 → 제출 파일 작성
 → [MCP/CLI] 명시 파일 realpath·입력 검사, 파일마다 /v1/documents/upload로 bytes 제출 → 준비 참조
 → [documents 담당 프로세스] format 실행·blob 준비 (무거운 일)
 → [core documents module] 문서 command(CAS·key·scope) → version+event
 → [MCP/CLI] 고정 주소·unchanged/경고·아직 남은 derived 반영 반환
```

원본 파일을 core가 읽거나 coding agent가 tracking 규칙을 바꾸지 않는다. index 완료는 저장 접수와 별개다.

### 7.3 지정 ticket claim과 제작·release 준비

```text
[사람 화면] 직접 요청·피드백·열린 문제의 수리 요청 또는 새 구현 요청
 → [shell/lophn/App Engineer] 기존 고정 자료에서 ticket 입력 준비; 미정 재현·채택은 생성하지 않고 다음 행동 안내
 → [core tickets module] 같은 ticket.create 검사 → open (외부 세션 자동 시작 없음)
 → [사람] 자기 터미널에 특정 ticket 지시 또는 [Start] 첫 prompt
 → [MCP/CLI] ticket show·고정 채택 판·acceptance check 읽기
 → [MCP → core tickets module] ticket.claim command(base_revision,key)
 → [MCP/CLI] connection·claim_seq·60분 기한 반환
 → [coding agent] SDK 읽기 → blueprint·source 구현
 → [apps 준비 담당] 연결 source 고정 bundle
 → [test runner] 같은 hash app test → 결과 command → Verification (ticket test_command 검사는 완료 보고 뒤)
 → [apps preview] fixture preview (direct)
 → [MCP/CLI] 현재 ticket/claim 재조회; 필요하면 명시 renew command
 → [apps release 준비·적용] ticket+claim_seq+고정 hash+실제 통과 참조 요청
 → [core apps module] 현재 claim 검사 후 release 준비 command·출처 저장
 → [MCP/CLI] prepared release·Verification·다음 조회 반환 (activation은 사람이 한 번 누름)
```

읽기·테스트·preview·release 준비는 claim을 연장하지 않는다. source 변경이면 이전 hash의 app test를 재사용하지 않는다. 준비는 activation이 아니며 activation 결정은 사람에게 남는다.

### 7.4 ticket 수리와 ticket 준비 전 조사 자료 읽기

```text
[MCP/CLI] repair ticket 또는 준비 전 problem의 bundle 조회 요청
 → [core read/인증] 현재 연결·허용 대상 판정 → [worker] 정본별 basis 수집
 → [worker] 발생 release·snapshot·실패 invocation·지난 고친 기록·고정 test 조립
 → [worker] scope/redaction·대표 선정·절별/전체 budget·more 생성
 → [MCP/CLI] bounded 자료 반환 → 필요한 종류만 more 요청 (command 없음)
 → [coding agent] 원래 증상 test·유지 제약 보존하며 source 수정
 → [test runner/apps] 같은 hash app test·fixture preview·release 준비
 → [test runner] 실제 준비된 before/after release·고정 reproduction test로 같은 증상 검사
 → [core problems module] 고친 기록 command·release·Verification 연결
```

code 작업 전에는 7.3의 실제 ticket·MCP claim이 필수다. 준비 전 조회는 ticket=null이며 문서·근거 조사만 가능하고 담당 agent의 ticket 준비로 이어진다. ticket 없는 고친 기록은 과거 근거 조회만 유지한다. 당시 source 근거가 없으면 현재 파일로 과거 줄 번호를 꾸미지 않는다.

### 7.5 완료 보고와 machine check

```text
[MCP/CLI] 현재 claim 재조회 → summary·산출물·fix event·Verification 참조 준비
 → [core tickets module] ticket.report_completion command
     (현재 claim·release ticket_source 검사 → claim 끝내기+reported+event)
 → [worker] TicketCompletionReported 또는 reported 재조회
 → [worker] 조건별 actual Verification·release active·problem 닫힘/고친 release·human_confirmation 비교
     필요한 실제 test 실행은 runner에 요청; test_command에는 이번 completion_seq·조건 번호·고정 조건 hash를 전달
     human_confirmation의 pass는 "내가 확인함"이며 Verification이 아님
     미실행/승인 대기는 inconclusive
 → [core tickets module] ticket.record_checks command
     (completion_seq·ticket revision·읽은 대상 revision·hash CAS)
 → 전부 pass: confirmed / 실제 fail: check_failed / 나머지: reported
 → [MCP/CLI] ticket checks 읽기 → 완료 주장·보고 접수·남은 조건을 따로 반환
```

각 test 조건의 Verification은 같은 app·보고 release bundle hash뿐 아니라 `test_command`의 TicketTestLink(ticket·조건 번호·고정 조건 hash·completion_seq), reproduction의 problem·고정 test hash·after release까지 소유 **test 실행** contract로 확인한다. 보고 전 임의 command 성공이나 다른 조건의 같은 bundle 테스트를 재사용하지 않는다.

사람 화면은 → coding-agent/tickets#R27, shell/wording의 영어 화면 말로 여섯 상태를 표현한다. 제목·원래 요청/문제·현재 결과·다음 행동만 기본으로 보이며 상세 조건·보고·로그는 펼쳐 읽는다. claim과 검사 진행을 위한 별도 UI 상태를 ledger에 만들지 않는다.

worker는 `VerificationRecorded`, `ProblemClosed`, `ProblemReopened`, `ReleaseActivated`, `ReleaseSuperseded` event에서 해당 reported ticket만 다시 비교한다. model 호출은 없다. 오래된 보고의 결과는 새 completion을 덮지 않는다. problem 닫힘은 먼저 **problems/closing**이 판정하며 ticket 확인됨으로 거꾸로 닫지 않는다.

### 7.6 회수·만료·취소

```text
[사람 confirmation window] 연결 회수
[사람] ticket 취소 (확인 창 없음, 1~200자 사유)
 → [core] revoke/cancel command → 즉시 새 credential/옛 claim 쓰기 거절
 → [core 감독 timer] 60초마다·재시작 때 만료/회수 후보 read
 → [core tickets module] ticket.expire_claim command(현재 seq 비교)
 → ticket open, 과거 completion·release·문서·Verification 보존
 → [외부 세션 MCP/CLI] 후속 요청 unauthorized/conflict → 현재 ticket 재조회
```

회수된 연결로 재조회도 허용하지 않는다. 살아 있는 외부 세션에 강제 종료가 전달됐다고 표시하지 않고 사람의 새 connection 안내만 준다. 같은 connection이 재claim해도 옛 claim_seq 요청은 conflict다.

## 8. 실패와 재시작

| 실패 | 처리·복구 |
|---|---|
| MCP/CLI 종료·stdin EOF | 권위 있는 작업 상태 없음. 제품이 다시 연 통로에서 같은 connection·ticket·claim·release를 읽음. 종료만으로 반납·외부 세션 사망을 기록하지 않음 |
| 쓰기 응답 유실 | 원래 key·내용으로 command 결과 조회/재요청 또는 현재 대상 read. 새 key로 준비·보고·외부 효과를 자동 반복하지 않음. effect_unknown·exit6/isError |
| core 재시작 | OS keychain의 active connection credential 그대로 사용. 실행 credential은 인증 contract에 따라 새로 받음. token 자동 재발급 없음. core 만료 정리, worker reported 누락 check 복구 |
| worker 종료 | core 감독이 재시작. derived bundle은 다시 조립; 접수 완료 report는 ledger에 남음. event cursor+reported read로 따라잡고 최신 completion CAS. cursor 불가면 첫 페이지 재조회 |
| 만료·회수·취소·동일 connection 재claim | 모든 후속 쓰기 transaction에서 현재 seq·기한 재검사. timer 정리 지연은 허용 근거 아님. 이전 산출물 보존, 자동 renew 없음 |
| test/format/release 준비 프로세스 중단 | 소유 contract의 실제 결과·미실행·unavailable 전달. shell excerpt·preview 성공으로 Verification pass를 만들지 않음 |
| redaction·근거 수집 실패 | 해당 절/첨부의 missing/redacted/forbidden/truncated와 이유. 실패를 없는 문제·빈 성공·0건으로 감추지 않음 |
| 설치 부분 실패·동시 편집·깨진 설정 | component별 commit/무변경/충돌·사람 파일 보존. receipt/journal과 현재 hash 재검사, receipt 실패는 partial+recovery. 전체 성공 추측 금지·네 loading 단계 별도 관측 |
| PATH/version/auth probe 실패·빈 결과 | absent·error·timeout·unknown 구별; 마지막 관측과 시각 유지. 자동 refresh/install/launch 없음 |
| [Start] executable·scope·ticket revision 변경 | spawn 전 conflict/unavailable; 새 connection·다른 harness·임의 cwd 자동 대체 없음 |
| TUI readiness timeout·prompt 전달 불명·실행 경계 종료 | session unknown/launch_failed와 다음 터미널 확인 안내; prompt 자동 재전송·process 자동 재시작 없음. 실제 exit evidence만 ended |
| session hook 수집 끊김·lophn 재시작 | stale/unknown, native ID 미획득은 null. 재관측만 허용하며 claim은 별도 정본 조회·기존 만료 정책 |
| keychain 잠김·누락 | credential 사용 unavailable, OS 다음 행동 안내. token 파일·user fallback·자동 재발급 없음 |
| token 유출 의심·분실 | 사람 회수 후 새 connection; keychain 항목 삭제·label 변경만으로 해결이라고 하지 않음. 진단은 connection ID만 |

테스트는 사람 [Start] exact 허락·project PTY·prompt 1회·재시작 unknown·session/claim 분리, bounded native 감지·명시 refresh·profile cache 분리, receipt/hash update/remove·partial recovery·keychain 잠김, MCP/CLI 공통 동작 parity(실제 claim은 MCP만), app scope의 제목·건수·첨부 누출, 회수 후 살아 있는 MCP/direct-call 거절, claim 기한 경계·재claim 옛 seq, 보고/검사 CAS, Unicode budget·cursor 변조, managed marker 오류·동시 편집·원자적 교체, 일곱 제품의 기존 설정 보존·네 loading 단계·오프라인 MCP 시작을 포함한다.

## 9. 이전과 달라진 것

- 이전: CLI가 user token을 읽거나 환경 제품 이름으로 actor를 정했다. / 지금: coding-agent connection ID의 OS keychain의 같은 credential을 MCP·CLI가 시작 때 받으며 사람 credential은 shell main에만 둔다. / 이유: 통로 변경·label·작업 위치로 권한을 얻지 못하게 한다.
- 이전: 인증 실패에 user token으로 coding token을 자동 재발급했다. / 지금: 회수·분실은 사람이 회수 후 새 connection을 만든다. / 이유: 회수 결정을 되살리지 않는다.
- 이전: MCP의 broad read/write/run과 daemon command 안 source 순회·테스트가 섞였다. / 지금: narrow adapter, core 밖 담당 프로세스, 결과만 command다. / 이유: A1·A2와 source/data 경계를 지킨다.
- 이전: 직전 사본은 다섯 tool 묶음만 적어 format·series·질문·runtime·출력 동작을 구현자가 다시 추측했다. / 지금: 고정 15개 tool의 전체 op·blueprint 유래 read tool·CLI 전체 command·자기 RPC·검사·오류·출력을 명시한다. / 이유: 현재 requirements의 capability를 빠뜨리지 않고 공통 registry로 두 통로를 맞춘다.
- 이전: 문제 직접 claim·24시간 claim·읽기 갱신·repair attempt/workflow·host 작업 journal·receipt가 있었다. / 지금: ticket claim60분·명시 갱신, 고친 기록·Verification·invocation을 사용한다. / 이유: 불필요한 작업 상태·ledger·권한 단계를 없앤다. 새 LocalIntegrationReceipt는 외부 config ownership의 local metadata이지 작업 receipt 부활이 아니다.
- 이전: 수리 자료가 현재·당시 근거와 여러 크기 체계를 섞었다. / 지금: 요청 시 worker 조립·고정 basis·15절·24KiB/300줄·실제 cursor로 통일한다. / 이유: 적은 token으로 근거 전체에 닿고 없는 증거를 숨기지 않는다.
- 이전: skill 덮어쓰기·제품별 본문 복제·앱 설정 자동 trust를 할 여지가 있었다. / 지금: hash/CAS·managed 구간·AGENTS.md 정본·네 단계 loading 검사. 사람이 Codex를 고르면 사용자 config에 receipt와 함께 설치하고 앱 TOML은 만들지 않는다. OpenClaw는 명시 읽기다. / 이유: 고른 harness에는 설치하고 사람 안내·설정·workspace는 보존한다.
- 이전: 모든 시작 조회 실패를 같은 방식으로 처리했다. / 지금: 일반 summary는 실패를 표시하고 Claude Code hook만 명시 상한·timeout·빈 출력/exit0 예외다. / 이유: 근거 부재와 장애를 구분하면서 외부 세션 시작을 막지 않는다.

참고한 제품 설정 자료: [OpenCode MCP](https://opencode.ai/docs/mcp-servers/), [OpenCode skills](https://opencode.ai/docs/skills/), [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/), [Gemini CLI skills](https://geminicli.com/docs/cli/skills/), [Hermes MCP](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/), [Hermes skills](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/), [OpenClaw MCP](https://docs.openclaw.ai/tools/mcp), [OpenClaw skills](https://docs.openclaw.ai/tools/skills). pi의 위치는 조사 revision(8369268)의 소스(`mcp-servers.ts` `validateMcpServerConfig`, `extensions/mcp/config.ts` `loadMcpConfig`)로 확인했고 옛 pi MCP adapter 참고는 쓰지 않는다.
