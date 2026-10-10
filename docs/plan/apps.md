---
type: plan
concerns: [apps]
---

# apps 구현 계획

apps 최상위의 12개 leaf concern(registration, blueprint, releases, runtime,
agent-context, connections, permissions, automations, invocations, data,
preview, sdk)을 구현하는 작업이다. 코드 자리는 [code-map](../dev/code-map.md)의
apps 줄, 실행 entry `apps/app-supervisor/`와 `apps/worker/`의 release·data kind,
공개 SDK `packages/sdk/`의 blueprint·cap-_·format-_, 그리고 `fixtures/apps/`다.
`packages/sdk/ui-*`와 `@lophn/tokens`는 shell 팀이 만든다.

## 공통으로 정한 것

- **core 조립.** platform#T9의 registry에 apps는 `apps/core/apps.ts` 한 파일로만
  등록한다(command·read·event·schema step·dispatchable command·port·worker kind
  launch spec). worker kind 코드는 `apps/worker/apps/`에만 둔다(lead 결정).
- **앱 안에서 도는 코드.** `packages/apps/runtime/entrypoint/`,
  `packages/apps/invocations/context.ts`, `packages/apps/automations/clock.ts`,
  `packages/apps/agent-context/redaction.ts`,
  `packages/apps/connections/client.ts`는 release bundle에 "플랫폼 진입 파일"로
  들어가 manifest hash로 고정된다. 그래서 의존성이 없어야 한다(Zod, npm 금지).
  core·supervisor는 앱 코드를 import하지 않는다.
- **SDK.** `packages/sdk/*`는 앱 bundle에 그대로 들어가므로 SDK끼리만 peer로
  의존하고, Zod를 끌어오는 `packages/contracts` 파일은 import하지 않는다. 예외는
  blueprint 정본 검증기 하나다. contracts 팀 제안대로 import 없는 순수 TS
  검증기를 `packages/contracts/apps/blueprint.ts`에 두고 @lophn/blueprint가 다시
  내보내 정본을 하나로 둔다(apps/blueprint#R16, 질문 Q2).
- **테스트 이름**은 요구 번호로 시작한다: `Deno.test("apps/runtime#R19: ...")`.
  시각·id·무작위·단조 tick은 `packages/base`의 Clock·IdSource로 주입한다.
- **E2E.** apps slice의 flow 8개는 T27이 돌린다. 앞 slice flow 중 앱
  단계(project-workspace의 app-panel, build-context의 blueprint 조회,
  approve-action의 confirm·grant, view-agent-visuals의 app-card)도 T27이 함께
  돌린다(Q4).
- **시작 시점.** 선행이 모두 main에 합쳐진 작업은 slice와 상관없이 시작한다(Q9).
- **다른 팀 작업 id.** 아래 `선행:`에서 아직 id를 받지 못한 것은
  `<팀>(<contract 또는 기능>)`으로 적었다. id를 받는 대로 채운다.

## slice: documents

### T1 앱 등록, source 연결, 보관

- 상태: 완료 (#143)
- 등급: 기본
- concern: apps/registration
- 요구: apps/registration#R1–R10
- 자리: packages/apps/registration/ (model.ts, commands.ts, reads.ts,
  adapters/source-path.ts, mod.ts), apps/core/apps.ts
- 쓰는 contract: platform command·read·인증(actor·scope: user, 전체 scope coding
  connection, 앱 scope connection), documents/addressing의 place_names 예약 Tx
  함수, lophn-agent/questions option action으로 적용될 owner command
  등록(platform approvals)
- 내놓는 contract:
  `/v1/apps/{create,connect_source,archive,unarchive,list,get}`, event
  AppCreated·AppSourceConnected·AppArchived·AppUnarchived (contracts#T20)
- slice: documents
- 선행: contracts#T20, contracts#T14, platform#T9, documents#T5
- 완료:
  - `registration_test.ts`: 화면 없는 앱·화면 있는 앱 등록과 문서 등록 구별(R1),
    source·release·기획 판 없는 등록과 기획 판 있는 등록 조회(R2), 전체 scope
    coding connection은 등록되고 앱 scope connection·lophn agent 직접 요청은
    forbidden(R3), 관리 저장소 밖 git 폴더의 실제 경로 연결(R4), source 재연결
    전후 active_release·bundle 참조 불변(R5), 기존 비소유 폴더와 같은 slug에서
    그 폴더 불변·이름 공간 conflict(R6), slug에서 이름 추천과 입력 이름
    보존(R7), archive가 run_enabled=false를 함께 저장하고 unarchive가 false
    유지(R8), archive 뒤 release 이력·앱 place 조회(R9), project 없이 등록한
    앱의 독립 place 조회(R10)
  - CAS·idempotency 거절 테스트(같은 key 재전송, 낡은 seq)
  - flow organize-documents의 앱 보관 단계 E2E(documents slice의 E2E에 넣는다)

## slice: apps

### T2 blueprint 정규 schema와 @lophn/blueprint

- 상태: 완료 (#66)
- 등급: 기본
- concern: apps/blueprint, apps/sdk
- 요구: apps/blueprint#R1, R4, R5, R6, R7, R10, R11, R15, R16, R18, R19, R20,
  R21, R22, apps/sdk#R5
- 자리: packages/sdk/blueprint/ (define.ts, mod.ts, *_test.ts),
  packages/apps/blueprint/ (mod.ts). 정본 검증기
  `packages/contracts/apps/blueprint.ts`는 contracts#T33이 쓴다
- 쓰는 contract: contracts#T33의 import 없는 blueprint 검증기(type, normalize,
  validate, InputSchema 검사, default 적용, 정규 input hash)
- 내놓는 contract: @lophn/blueprint 1.0.0의 공개 API(defineBlueprint,
  defineAgentContext, validateBlueprint, validateInput, canonicalInputHash).
  contracts#T33의 정본 검증기를 다시 내보낸다(Q2)
- slice: apps
- 선행: contracts#T33
- 완료:
  - `validate_test.ts`: 화면 없는 앱의 빈 화면 목록 허용, 누락·중복·모르는 선언
    거절(R1), effect 하나와 독립 confirm(R4), external·write·read 정의
    예시(Google Calendar 조회=read, 동기화=write, 일정 만들기=external)(R5),
    secret을 쓰는 read·write의 confirm=false 허용(R6), JSON Schema 부분집합의
    타입·enum·default·길이·수 범위 검사와 default 채움(R10),
    $ref·oneOf·format·모르는 keyword 거절(R11), screen·command key와 label
    분리(R15), 같은 corpus에서 작성형과 검증기 판정이 같고 network·model 없이
    돈다(R16), 순서만 다른 작성형의 같은 정규 JSON과 옛 context 필드 거절(R18),
    sizes 비어 있음·중복 거절(R19), command description·input description이 비면
    거절하고 blueprint만으로 tool 목록(목적·필수 입력·effect·confirm)을 만들 수
    있다(R20), revert 지원 선언 누락·read/external의 supported=true·되돌림
    command 없음 거절(R21), app_connections·agent_context의 잘못된
    대상·command·주석 자리 거절과 옛 context 형식 구별(R22)
  - `canonical-json_test.ts`: 생략한 default와 명시한 default가 같은 input
    hash(R7)
  - `reexport_test.ts`: @lophn/blueprint가 contracts의 검증기를 그대로 다시
    내보내고(사본 없음), 템플릿 작성형과 직접 쓴 같은 선언이 같은 판정을
    낸다(apps/sdk#R5). SDK 설치 byte에 zod가 없다
  - 요구별 판정 테스트는 이 작업이 apps 요구 번호로 쓰고 contracts#T33의
    검증기를 부른다. 검증기가 요구와 다르면 contracts 팀에 고칠 것을 요청한다
  - automation 선언 검사(interval_ms ≥ 60000, on_start, command
    존재·confirm=false, 고정 입력 schema 통과)는 여기서 선언 형태만, 실행 정책은
    T20

### T3 permission scope와 Deno flag 계산

- 상태: 완료 (#73)
- 등급: 기본
- concern: apps/permissions, apps/blueprint
- 요구: apps/permissions#R5, R6, R7, R8, R9, R10, R11, R12, R18, R19, R25,
  apps/blueprint#R9
- 자리: packages/apps/permissions/ (model.ts, flags.ts, protected-paths.ts,
  adapters/realpath.ts, mod.ts)
- 쓰는 contract: platform 데이터 root·보호 경로 목록(platform/security),
  contracts#T33의 PermissionScope
- 내놓는 contract: 없음(apps 안쪽 모듈. T4·T8·T13이 쓴다)
- slice: apps
- 선행: apps#T2, contracts#T33
- 완료:
  - `model_test.ts`: fs.write가 fs.read를 포함하지 않고 문자열 prefix만 같은
    폴더 거절(R5), `~`·상대 경로·symlink를 실제 절대 경로로 풀고 폴더 밖 symlink
    경고(R6), home 전체·~~/.ssh·~~/.aws·~/.gnupg·keychain·데이터 root·다른 앱
    DB·source를 감싸는 부모 경로 거절(R7), wildcard host·port 0·전체 port
    거절(R8), net.listen은 localhost·127.0.0.1·::1의 정확한 port만, 0.0.0.0
    거절(R9), localhost·127.0.0.1·::1을 합치지 않음(R10), 정렬과 중복 거절(R12)
  - `flags_test.ts`: 생성한 deno 인자에
    --allow-all·-A·--allow-run·--allow-ffi·--allow-sys·--allow-env·--prompt가
    없고 --no-prompt·--no-remote·--no-npm·--cached-only·--no-config가 있음(R18,
    R19), 플랫폼 실제 port와 설정 port가 net 범위에 들어가지 않고 방향을 강제할
    수 없는 net.listen 요청은 거절(R11), migration용 flag는 bundle 읽기와 자기
    DB 작업 영역만(R18), effect 선언과 무관하게 같은 앱의 flag가
    같다(apps/blueprint#R9)
  - Deno 한계 문구(VM·container 아님, 허락 경로 안 secret, 실행 중 symlink 교체,
    CPU·RSS·disk 미제한)를 grant 표시 자료의 message key로 내놓는다(R25)

### T4 grant command와 read

- 상태: 완료 (#303) — 이어보냄: 현재 선언 port(`currentDeclarations`)의 실제
  구현과 activation event 발생 → apps#T18·T19, platform#T47의 doctor 관측 교체 →
  platform#T48
- 등급: 기본
- concern: apps/permissions
- 요구: apps/permissions#R1, R2, R3, R24, R26, R27, apps/automations#R13
- 자리: packages/apps/permissions/ (commands.ts, reads.ts), apps/core/apps.ts
- 쓰는 contract: platform command·read·approval(정확한 app·kind·scope에 묶인
  approval 한 번 사용, `/v1/approvals/apply` owner command 등록)
- 내놓는 contract: `/v1/grants/{create,revoke,list}`, event
  GrantCreated·GrantRevoked (contracts#T37). grants.list는 confirmation window의
  grant 표시 자료다(요구·reason·정규 scope·조합 경고·Deno 한계 문구 key)
- slice: apps
- 선행: apps#T1, apps#T3, contracts#T37, platform#T23
- platform#T47에서 넘어온 것: doctor 보안 진단이 지금 읽는 관측 파일 대신 grant
  위험 read와 SDK hash(T5 contract)를 읽게 교체(#180)
- shell#T43에서 넘어온 것: app-detail Automations [Turn off]는 `automation.run`
  grant를 확인 창 없이 `grant.revoke`로 거두는데 지금 호출할 수 없다. (1)
  `grant.revoke`가 contract에서 `confirmation: "required"`라 확인 handle 없는
  호출은 invalid_input이다. automation.run만 확인 없이 받는 경로가 필요하다.
  (2) `grants.list`가 비교 기준 `grants_seq`(앱의 마지막 Grant 사건 seq)를 내지
  않아 shell이 `compare`를 채울 수 없다(additive 출력 field). 둘이 서기 전에는
  shell의 `turnOffAutomation`이 unavailable을 답하고 화면은 "아직 켜져 있다"만
  보인다
  - 처리됨 (#404): `grants.list`가 `grants_seq`를 내고 사람 전용 `grant.revoke_automation`(확인 창 없음, 그 앱·grant·key의 `automation.run`만, CAS)이 끈다
- 완료:
  - `commands_test.ts`: 선언만 있는 접근은 실행 범위가 0이고 같은 범위의
    approval 적용 뒤만 grant가 생긴다(R1), 실행 범위 = 현재 release 요구 ∩
    active grant로 옛 grant·grant 밖 선언 모두 제외(R2), 같은 host·port의 후속
    release는 grant 재사용·새 host·port는 미포함(R3), fs.read와 net.fetch 동시
    요구에 조합 경고가 표시 자료에 붙고 자동 부여 없음(R24), app.call grant의
    방향 있는 (caller,target,commands) 기록과 B→A·A→C 미포함(R26),
    agent.commands grant가 기본 닫힘이고 화면 열기·app.call·coding connection과
    별개(R27)
  - 앱에 activation이 진행 중이면 grant.create·revoke가
    conflict(apps/releases#R13의 grant 쪽 거절)
  - revoke는 "종료 확인 근거"가 있어야 revoked로 확정한다(종료 확인 자체는 T13)
  - Grant kind `automation.run`(scope
    `{automation, command, input_hash, when}`): 현재 blueprint의 external
    automation 선언과 정확히 같을 때만 grant.create, 끄기는 사람의
    grant.revoke이고 프로세스 재시작 없이 다음 회차부터
    막힌다(apps/automations#R13, Q1). apps/permissions domain model의 kind
    목록을 같은 PR에서 고친다

### T5 SDK catalog과 설치

- 상태: 완료 (#170)
- 등급: 기본
- concern: apps/sdk
- 요구: apps/sdk#R2, R3, R4, R6, R8, R9, R11, R12, R13
- 자리: packages/apps/sdk/ (model.ts, commands.ts, reads.ts, install.ts,
  resolve.ts, mod.ts), packages/sdk/*/guide.md(패키지마다 안내),
  apps/core/apps.ts
- 쓰는 contract: platform command·read·blob(blob.prepare)
- 내놓는 contract: `/v1/packages/{register_version,list,versions,guide,usage}`,
  event PackageVersionRegistered (contracts#T37). `lophn-sdk:<name>@<version>`
  import map 해석 함수(T6이 쓴다)
- slice: apps
- 선행: apps#T2, contracts#T37, platform#T13, platform#T14
- coding-agent#T36에서 넘어온 것: `sdk show`의 안내 원문(API·type·permission·peer·예제) read. `packages.guide`는 `guide_hash`만 돌려주고 `blob.read`는 owner가 blob field를 등록해야 읽힌다(`owner_kind`·`owner_key`·`field`). guide blob field 등록(coding credential·agent·app가 읽는 `general_read`)과 owner 키를 정하면 coding-agent의 `sdk show`가 `body`를 채운다(connection/sdk-ops.ts의 `body: null`).
- 완료:
  - `install_test.ts`: 설치가 packages/sdk/*를 패키지마다 자기 완결 byte로 묶고
    hash·guide hash를 blob에 넣은 뒤 register_version을 machine으로 부른다. 설치
    사본은 파일 0444·디렉터리 0555(R9), 설치가 확인한 내용만 목록에 나타나고
    외부 패키지는 등록할 수 없다(R13), 다시 설치(update)는 새 version만 더하고
    기존 version byte·guide를 덮지 않는다(R8, R11)
  - `catalog_test.ts`: 한 Package에 한
    kind(component·capability·domain·format)(R2), 목록에서 이름·한 줄
    목적·정확한 version·공개 API·permission·peer·예제를 읽는다(R3), 설치 대상
    목록이 R4의 이름을 1.0.0으로 담고 cap-read-model·cap-notify는 없다(R4;
    ui-*·tokens는 shell, cap-problem은 problems#T5가 만든 byte를 등록하므로 이름
    전부가 실제로 설치되는지는 T27에서 확인), @me 이름이 있으면 먼저 정렬하고
    개인 등록 요청은 forbidden(R6), guide가 patch·minor·major를 구별하고
    permission 증가를 major로 표시(R12)
  - usage read가 release의 고정 sdk_dependencies로 사용처를 찾는다(R6)

### T6 release bundle 준비 (release worker)

- 등급: 기본
- concern: apps/releases, apps/blueprint, apps/sdk, apps/permissions
- 요구: apps/releases#R1, R2, R3, R4, R19, apps/blueprint#R17, apps/sdk#R7, R10,
  R34
- 상태: 완료 (#182) — contracts#T36이 내놓기로 한 bundle 사본 경로 함수가
  contracts에 없다. 이 PR에서는 leaf(`packages/apps/releases/bundle/seal.ts`)가
  계산하고, contracts 후속이 남았다. release worker는 blob pipe를 열지 않고,
  준비 흐름의 `prepareBlob`은 supervisor가 주입한다.
- 자리: packages/apps/releases/prepare/ (git-extract.ts, limits.ts,
  source-watch.ts), packages/apps/releases/bundle/ (manifest.ts, seal.ts,
  import-map.ts), packages/apps/releases/ui-build/,
  packages/apps/blueprint/extract.ts, apps/worker/apps/release.ts
- 쓰는 contract: platform blob(blob.prepare, 신뢰 pipe), documents format
  실행(`/v1/formats/validate·get`, module_hash),
  problems/problem-codes(필수·예약 code 검사), coding-agent의 bundle 제외 목록
  상수(안내·wrapper·제품 local 설정·skill 사본, coding-agent/guides#R19), T5의
  import map 해석
- 내놓는 contract: release worker job(supervisor ↔ worker stdio JSON, apps
  안쪽), 읽기 전용 bundle 사본 위치 규칙
  `apps/<app ID>/bundles/<bundle hash>/`와 그 안의 정규 `blueprint.json`·source
  map 자리(problems test runner·collector가 씀, contracts#T36에 경로 함수)
- slice: apps
- 선행: apps#T2, apps#T5, contracts#T36, contracts#T50, platform#T12,
  platform#T13, documents#T4, problems#T1
- 완료:
  - `git-extract_test.ts`: 지정 commit의 tree object만 읽고 working tree
    변경·uncommitted 파일·symlink 자체·.git·개발 credential·agent
    설정(coding-agent 제외 목록: AGENTS.md·CLAUDE.md의 관리 구간 파일, bin/lophn
    wrapper, .mcp.json, .claude/settings.local.json, skill 사본)이 bundle에
    없다. source 밖 경로·commit에 없는 변경은 거절(R2)
  - `limits_test.ts`: source 64MiB·bundle 256MiB·10000파일·300000ms 각각을
    넘기는 입력, 준비 중 취소, worker 종료에서 bundle이 확정되지 않고 실패
    이유가 남는다(R19). 준비 중 source 변경이면 source_changed로 취소(R3)
  - `bundle_test.ts`: bundle 사본 root에 정규 `blueprint.json`이 있고 manifest가
    가리킨다, 같은 commit·SDK에서 같은 bundle hash, source와 설치 SDK 최신판을
    바꿔도 기존 bundle byte·선언 불변(R1), manifest의 entrypoint·파일
    hash·sdk_dependencies, lophn-sdk import map을 bundle 안 상대 경로로 바꾸고
    ^·~·latest 거절(apps/sdk#R7), remote·npm·jsr import 거절(apps/sdk#R34)
  - `ui-build_test.ts`: 고정 UI 의존으로 화면 build와 external source map이
    bundle에 들어가고, 운영 시작에는 build·다운로드가 없다(R4, apps/sdk#R10)
  - `extract_test.ts`: TypeScript blueprint 추출은 권한 없는 Deno 자식에서 10초
    제한, 파일·network 접근과 무한 반복이 거절되거나 10초 안에
    끝난다(apps/blueprint#R17)

### T7 앱 진입점, direct 통로, @lophn/cap-schedule

- 등급: 기본
- concern: apps/runtime, apps/invocations, apps/blueprint, apps/sdk
- 요구: apps/runtime#R3, R5, R8, R10, R11, R12, R22, R31, apps/blueprint#R8,
  R12, apps/invocations#R4, R14, apps/sdk#R27, R28
- 자리: packages/apps/runtime/entrypoint/ (main.ts, startup.ts,
  direct-server.ts, control.ts, screens.ts, verify.ts),
  packages/apps/invocations/context.ts, packages/sdk/cap-schedule/ (handlers.ts,
  context.ts, trace.ts, results.ts, mod.ts)
- 쓰는 contract: contracts#T34(앱 통로 wire, 초기 JSON, AppConnection 검증,
  createAppChannelClient), problems의 앱 SDK 보고와 exception observer(앱 code
  load 전에 설치)
- 내놓는 contract: direct socket `GET /screens/<screen>/<path>`,
  `POST /_lophn/commands/{invoke,cancel}`, `GET /_lophn/commands/status`,
  `POST /_lophn/control/{probe,open,close,shutdown}`의 앱 쪽 구현. mode
  live·preview·test(test는 problems runner가 띄움)
- slice: apps
- 선행: apps#T2, contracts#T34, platform#T5, problems#T5
- 완료:
  - `direct-server_test.ts`: 위조 서명·옛 nonce·다른
    release·bundle·mode·만료·범위 밖 screen·command를 각각 거절(R11), 틀린
    입력은 handler 전 invalid_input이고 default를 채운 정규 입력으로 handler를
    부른다(apps/blueprint#R7 재사용), body의 actor·effect·caller 주장 무시(R9),
    화면 요청은 선언 size와 view_session에 묶이고 같은 프로세스의 두
    view_session이 분리된다(R31), lophn.invalid 외 host 거절(R8)
  - `ready_test.ts`: 시작은 ready=false·accepting=false, 실제 등록 handler
    목록이 blueprint와 다르면 ReadyAttestation이 실패한다(apps/blueprint#R8),
    준비 모드에서 write·external command와 clock이 닫혀 있다(R3), activation
    commit 전 control/open 거절
  - `entrypoint_test.ts`: 앱 code load 전에 exception observer를 설치하고,
    처리되지 않은 exception·rejection은 보고 시도 뒤 stderr에 원래 실패를 남기고
    exit 1, 보고 통로가 끊겨도 같다(R22)
  - `invoke_test.ts`: 쓰기 응답 전에 연결을 끊어도 handler가 다시 불리지
    않는다(R12), command 경계 하나에 invocation 하나이고 내부 helper 10개는 따로
    기록되지 않는다(apps/invocations#R4), 입력 본문 1MiB 상한을 넘으면
    invalid_input과 blob·version 참조 안내(apps/blueprint#R12), ledger 쪽 없이도
    응답한다(R10)
  - `cap-schedule/context_test.ts`(Deno 2.9): await·timer·SQLite·fetch 뒤
    app·release·mode·invocation 문맥 유지, 모르는 invocation ID를 만들지
    않음(apps/sdk#R27), trace 이름 64자 허용·65자 거절과 inv ID와
    구별(apps/sdk#R28)
  - `cap-schedule/results_test.ts`: read 결과가 정상 0행과 미수집·부분
    범위·신선도 부족을 구별하고, 조건·정렬·데이터 기준이 바뀐 이어 읽기 cursor를
    거절(apps/invocations#R14)
  - socket은 사용자 전용 Unix socket HTTP/1.1이고 화면 socket 위치는 앱 view에
    노출되지 않는다(R5, 통합은 T10)
- 상태: 완료 (#114)

### T8 supervisor 프로세스 수명

- 상태: 완료 (#118)
- 등급: 최상위
- concern: apps/runtime
- 요구: apps/runtime#R1, R2, R4, R6, R7, R16, R17, R18, R19, R20, R21, R23, R24
- 자리: packages/apps/runtime/supervisor/ (supervisor.ts, restart-policy.ts,
  control-link.ts), packages/apps/runtime/processes/ (spawn.ts, socket-dir.ts,
  identity.ts, terminate.ts), packages/apps/runtime/core-link.ts(core 쪽),
  apps/app-supervisor/main.ts
- 쓰는 contract: platform 신뢰 child 감독 pipe(child stdin·stdout 위 길이 prefix
  frame, codec contracts#T6, stdout은 frame 전용·그 밖 출력은 stderr, machine
  credential 1회 전달, EOF면 앱 child까지 종료; platform#T7), event 구독(WS, seq
  cursor), read(apps·releases·grants 현재 상태), 앱마다 app:<app> 자격
  발급(platform#T31)
- 내놓는 contract: core ↔ supervisor 제어 protocol(apps 안쪽),
  `/v1/apps/{record_started,record_stopped,record_unavailable}`를 machine으로
  부름(contracts#T20)
- slice: apps
- 선행: apps#T3, apps#T7, contracts#T20, platform#T4, platform#T7
- 완료:
  - architecture/apps.md 2.1의 "전용 pipe의 JSON line"을 platform pipe(길이
    prefix frame)로 같은 PR에서 고친다
  - `spawn_test.ts`: clearEnv와 HOME·DENO_DIR·XDG_CACHE_HOME·PATH만 전달,
    parent의 API token이 자식 환경에 없음, LOPHN_DENO 또는 Deno.execPath()
    사용(R24), 초기 JSON은 stdin 한 줄이고 argv·환경에 token·secret 없음(R7),
    --cached-only·--no-remote로 원격 import한 앱은 시작 실패(R23)
  - `socket-dir_test.ts`: XDG_RUNTIME_DIR이 없으면 사용자별 0700 임시 디렉터리,
    경로 104byte 미만 검사, 긴 slug에도 시작(slug를 경로에 넣지 않음)(R6)
  - `supervisor_test.ts`: 재시작과 activation이 겹쳐도 같은 DB writer가 둘
    생기지 않고, 이전 자식 종료 확인 전 다음 자식을 띄우지 않는다(R1), 30초 안에
    hash·handler·schema·probe를 확인하지 못하면 시작 실패와 이유(R2), 앱 import
    오류가 core·supervisor를 끝내지 않고 앱에 플랫폼 DB·credential 파일 접근이
    없다(R4), 사람이 멈춘 앱은 재기동·backoff 경과에도 시작하지 않음(R16), core
    제어 EOF면 새 호출·clock을 닫고 자식 종료, PID 재사용을 생존 근거로 쓰지
    않음(R17), daemon 종료·재시작·release 교체의 자식 정지를 미리 의도된 종료로
    분류(동시 SIGINT에서 crash로 세지 않음)(R18), 예상 밖 종료는 1·2·4초부터
    최대 300초 backoff, 600초 안에 5회 넘으면 자동 재시작 중지와 이유,
    run_enabled 불변(R19), idle만으로 종료하지 않음(R20), 한 앱을 무응답으로
    만들어도 다른 앱 direct 호출과 core 읽기가 응답(R21)

### T9 실행 상태, 멈춤, 관측

- 상태: 완료 (#251)
- 등급: 기본
- concern: apps/runtime, apps/registration
- 요구: apps/runtime#R13, R14, R15, R25, R26, R27, R28, R29,
  apps/registration#R8
- 자리: packages/apps/runtime/ (model.ts RuntimeState, commands.ts, reads.ts),
  packages/apps/runtime/observations/ (log-buffer.ts, stream-decoder.ts,
  memory.ts, crash.ts), apps/core/apps.ts
- 쓰는 contract: platform command·read·redaction, problems 문제
  보고(`/v1/problems/observe-exception`)
- 내놓는 contract: `/v1/apps/{enable_execution,disable_execution,runtime,logs}`,
  event
  AppExecutionEnabled·AppExecutionDisabled·AppStarted·AppStopped·AppUnavailable
  (contracts#T20). apps.logs {app, invocation?, limit≤200, max_bytes?} → {lines,
  collected_at, truncated, state}
- slice: apps
- 선행: apps#T8, contracts#T20, contracts#T6, problems#T3
- 완료:
  - `model_test.ts`: release 없음=preparing, 사람이 멈춤=stopped,
    응답함=running, 허용됐지만 응답 없음=unavailable 네 상황과
    termination_pending, 상세 이유는 reason에만(R13), 과거 event만으로
    running이라 하지 않음
  - `stop_test.ts`: 멈춤은 새 command·clock부터 닫고 진행 호출 종료 요청 뒤 10초
    유예와 강제 종료, OS 종료 확인 전에는 termination_pending(R15), archive도
    같은 순서로 닫히고 unarchive 뒤에도 멈춤 유지(apps/registration#R8)
  - `log-buffer_test.ts`: invocation당 200줄·최근 500 invocation·미연결 500줄·한
    줄 300자, redaction 뒤 secret 없음, 줄바꿈 없는 stdout의 byte 상한, 버린
    줄은 supervisor pipe 진단(log 줄 손실, contracts#T6)으로 남김(R26), 추가
    조회 최대 200줄과 실패 직후 flush 대기 20ms 이하(R27)
  - `memory_test.ts`: Linux VmRSS 60초 표본, 다른 OS는 측정하지 않은 값을 0으로
    채우지 않음, heap 설정을 RSS 제한이라 하지 않음(R25), 한도의 85% 초과가 10분
    지속될 때만 관측, 표본 누락은 지속을 끊음, 한도 없음·미측정이면 주장하지
    않음(R29)
  - `crash_test.ts`: ready timeout·crash loop·V8 OOM·예상 밖 종료를 다른 근거로
    problems에 보내고 의도된 정지는 보내지 않음(R28), runtime read가 실행 상태와
    열린 problem을 별개로 두고 없는 지표를 만들지 않음(R14)

### T10 apps.connect와 runtime client

- 상태: 완료 (#312)
- 등급: 기본
- concern: apps/runtime, apps/permissions
- 요구: apps/runtime#R9, R32, apps/permissions#R28
- 자리: packages/apps/runtime/connect.ts(core 안 제어 어댑터, AppConnection
  서명),
  packages/apps/runtime/supervisor-link.ts·control-protocol.ts(core↔supervisor
  제어 질의), packages/apps/runtime/client/ (Deno client),
  packages/apps/runtime/supervisor/control-link.ts(platform pipe로 고침),
  apps/app-supervisor/assembly.ts·main.ts(조립),
  apps/core/apps-control.ts·apps.ts(core 조립)
- 쓰는 contract: platform 인증(AuthenticatedContext의
  actor·scope·credential_ref·기한, core epoch; platform#T5), 소유 회수
  event(GrantRevoked, assignment 멈춤, coding-agent의
  CodingAgentConnectionRevoked, run 종료), lophn-agent의
  AgentAppScope(contracts#T26, agent credential의 conditions), contracts#T34
- 내놓는 contract: `POST /v1/apps/connect`, AppConnection, Deno runtime
  client(agent runtime·MCP·CLI가 씀). shell main의 Node client는 shell 팀이 같은
  wire로 만든다
- slice: apps
- 선행: apps#T4, apps#T7, apps#T8, contracts#T34, contracts#T26, platform#T5,
  coding-agent#T9
- 완료:
  - `connect_test.ts`: 제어 경로는 플랫폼 인증 연결만 받고 임의 caller의 control
    요청과 화면 본문의 다른 앱 주장은 거절(R9), live connection에 release
    필수·release 없는 preview는 bundle_hash로 결속, endpoint·nonce를 ledger에
    쓰지 않음, 화면 connection은 screen·size 교집합(blueprint sizes)만. 실제
    core와 실제 앱 자식이 Ed25519 서명을 매 요청 검증한다
  - `agent-connect_test.ts`: 열린 앱이라도 agent.commands grant가 없으면 거절,
    grant 뒤에도 AgentAppScope 밖 command는 connection에 들어가지 않음,
    lophn·App Engineer·Operator에게 각자 허용 command만(R32,
    apps/permissions#R28)
  - `client_test.ts`: Unix socket HTTP로 invoke·status·cancel, request_key
    재사용으로 같은 결과 조회, 전송 단절은 결과 모름으로 돌려주고 자동 재호출
    없음
  - `runtime-source_test.ts`: 실제 core가 platform 감독 pipe로 실제 supervisor를
    띄우고 supervisor가 실제 앱 자식을 띄워 probe·open·record_started,
    apps.runtime·apps.logs의 실제 source(현재 관측·log 줄 redaction·종료 중
    terminating), 사람의 멈춤, core 종료 때 앱 종료, 회수된 credential의
    connection이 새 nonce 재시작으로 닫힘
  - `apps/app-supervisor/assembly_test.ts`: 조립한 supervisor가 실제 앱 자식에
    probe·open·정지·crash 근거 보고(그 자식의 app credential)·RSS 표본·log 진단
    frame·core 끊김 종료를 한다
  - apps#T9에서 넘어온 것: core의 `apps.runtime`·`apps.logs`는 supervisor
    메모리를 platform 감독 pipe의 `worker_request`(`apps.observe`·`apps.logs`)로
    조회해 reader가 판정한 결과에 현재 관측·log를 덮어 준다.
    apps/app-supervisor/main.ts는 stdout·stderr `attach`와 `log-redact`,
    memory·crash observer, `requestStop`의 close·shutdown, `terminating`
    reason의 RuntimeObservation 변환을 조립한다
  - problems#T17에서 넘어온 것: collector(machine) credential이
    `/v1/settings/get`과, scope가 operation `app.logs`와 대상 앱을 함께 이름
    지은 `/v1/apps/logs`에 닿는다. 앱을 이름 짓지 않은 machine 자격과 다른 앱은
    없는 앱과 같은 응답이다(`runtime-source_test.ts`가 실제 core에서 collector가
    log를 읽는 것을 본다, Q22)
  - core 서명 key는 `createCoreSigner()` 하나다: AppConnection·confirm proof를
    같은 key로 서명하고 앱 시작 입력과 감독 hello의 `verify_key`도 그
    key다(`connect_test.ts`가 같은 core의 AppConnection과 proof가 같은 공개
    key로 검증되는 것을 본다). 앱 entrypoint는 `control/shutdown`을 받으면 진행
    호출이 끝나는 대로 스스로 끝나고(`entrypoint/shutdown_test.ts`) 유예가
    지나면 supervisor가 강제 종료한다
  - 별도 platform 회수 event는 없다. 소유 event를 구독하는 대신 발급한
    connection의 credential 상태와 agent.commands grant를 1초마다 다시 읽어,
    닫히거나 줄어든 것의 프로세스를 정지 확인 뒤 새 nonce로 다시 띄운다(Q5, Q23)
  - apps#T9에서 넘어온 것: core의 `apps.runtime`·`apps.logs`는 지금 관측·log
    source 없이 등록돼(없음·none을 명시) 있으니, supervisor
    메모리(관측·`LogBuffer.collect`·memory·crash)를 core가 조회하는 제어
    메시지와 source 연결, apps/app-supervisor/main.ts의 조립(stdout·stderr
    `attach`와 `log-redact`, memory observer와 crash observer 시작,
    `requestStop`으로 direct 제어의 close·shutdown 호출, 관측의 `terminating`
    reason을 RuntimeObservation으로 변환)
  - problems#T17에서 넘어온 것: problems collector가 `/v1/apps/logs`를
    credential의 앱·invocation으로
    부르고(`packages/problems/snapshots/adapters/core-logs.ts`)
    `/v1/settings/get`으로 진단 상세 수집 설정을 읽는다. 위 source 연결이 끝나면
    collector credential이 두 route에 닿는지(authorizeApp의 collector 접근,
    scope operation `app.logs`·`GetSettings`)를 확인하고, 접근이 없으면 로그는
    `unavailable` 이유로 남는다
  - 별도 platform 회수 event는 없다. 소유 event(GrantRevoked, assignment 멈춤,
    CodingAgentConnectionRevoked, run 종료)와 core epoch 변화를 받으면 그
    credential_ref로 발급한 connection을 쓰는 통로를 닫는다(Q5)
  - apps#T12에서 넘어온 것: core 서명 key는 `packages/apps/runtime/signing.ts`의
    `createCoreSigner()`가 core 시작마다 Ed25519 key 쌍을 만든다(`verifyKey`는
    앱 시작 입력의 `verify_key`, `signConnection`·`signConfirmProof`가 서명).
    connect.ts는 이 signer를 core 안에서 하나 쥐고 AppConnection을
    `signConnection`으로 서명하며, 앱 시작 때 `verifyKey`를 넣는다. 앱
    entrypoint는 이미 이 key로 AppConnection과 confirm proof 서명을
    검증한다(`runtime/signing_test.ts`)

### T11 invocation 기록 command와 read

- 상태: 완료 (#161)
- 등급: 기본
- concern: apps/invocations, apps/releases
- 요구: apps/invocations#R3, R6, R9, R10, R13, R15, R16, R17, apps/releases#R17
- 자리: packages/apps/invocations/ (model.ts, commands.ts, reads.ts, mod.ts),
  apps/core/apps.ts
- 쓰는 contract: platform command·read·redaction·blob(detail_hash), platform
  공통 idempotency
- 내놓는 contract:
  `/v1/invocations/{record_started,record_finished,record_denied,list,get}`,
  event InvocationStarted·InvocationFinished·InvocationDenied (contracts#T35).
  accept_confirm은 T12
- slice: apps
- 선행: apps#T1, contracts#T35, platform#T2
- 완료:
  - `model_test.ts`: 상태 전이(없음·accepted→running→succeeded/failed/unknown,
    denied), terminal 뒤 늦은 start가 running으로 되돌리지 않음, 같은 사실
    재전송은 같은 결과·다른 종료 사실은 conflict(R6), accepted만 있으면
    started_at 없음(R9), 알려진 ID만 unknown으로 확정·모르는 호출은 만들지
    않음(R10)
  - `reads_test.ts`: release 교체 뒤에도 당시
    release·operation·trigger·mode·actor·caller가 그대로(R3), command를 지운 새
    release 뒤에도 당시 blueprint로 설명(apps/releases#R17), A→B와 agent→B의
    caller(app·release·parent / run·tool_call) 구별과 부모 없으면 없음(R16),
    confirm에서 actor·caller는 요청자이고 approval은 별도 참조(R17), succeeded는
    handler 반환일 뿐 업무 정확성 필드를 두지 않음(R13), summary 16KiB·redaction
    뒤 secret 없음(R15)

### T12 invocation 후행 전달과 confirm 실행

- 상태: 완료 (#311) — 이어보냄: broker 서버의 `/invocations/submit` 연결 → T13,
  signer 쥐기·AppConnection 서명 → T10, A→B confirm proof 전달 → T15, automation
  trigger → T20, agent 요청자 E2E → T27
- 등급: 기본
- concern: apps/invocations
- 요구: apps/invocations#R1, R2, R5, R7, R8, R11, R12, R18, R19
- 자리: packages/apps/invocations/delivery/ (queue.ts, backoff.ts),
  packages/apps/invocations/confirm.ts(accept_confirm command),
  packages/apps/runtime/entrypoint/confirm-marker.ts,
  packages/apps/permissions/broker/invocations.ts
- 쓰는 contract: platform approval(정확한 approval 확인과 approval_uses INSERT
  Tx 함수, platform#T32), supervisor pipe의 diagnostic 메시지(종류 "apps 전달
  손실", platform#T8; 분류는 platform#T38), platform
  인증(credential_ref·기한·core epoch, platform#T31)
- 내놓는 contract: `/v1/invocations/accept_confirm`, event InvocationAccepted,
  ConfirmExecutionProof (contracts#T34, T35)
- slice: apps
- 선행: apps#T7, apps#T8, apps#T11, contracts#T35, contracts#T6, platform#T8,
  platform#T32
- 완료:
  - `delivery_test.ts`: ledger 저장을 지연시켜도 일반 호출 응답이 먼저 오고
    기록은 뒤에 반영(R1), 기록 대상: confirm·write·external·automation
    read·실패/거절 read·start·data_change, 성공 일반 read 100회는 기록 100개를
    만들지 않음(R2), 업무 성공 뒤 전달을 끊어도 응답은 성공이고 기록 메시지만
    재전송·한도 초과는 손실 진단(R5), 전체 4096 메시지 또는 8MiB, unavailable만
    1·2·4초부터 최대 30초 backoff, unauthorized·conflict·invalid_input은 반복 안
    함(R19), A→B·agent→B 일반 read도 같은 규칙(R18)
  - `confirm_test.ts`: approval 사용과 accepted가 한 transaction이고 저장 실패면
    handler가 불리지 않음, 같은 접수 재전송은 기존 접수(R7), 같은 proof를 동시에
    보내도 handler 1회, 옛 프로세스 proof·입력·release·command가 다른 proof
    거절(R8), marker 4096개가 차면 기존 marker를 버리지 않고 새 접수 거절(R19)
  - `effects_test.ts`: 로컬 저장 뒤 외부 전송 실패를 저장 완료와 전송 실패로
    따로 남기고 취소 요청 접수를 효과 취소로 표시하지 않음(R11), 결과 모름·기록
    누락으로 업무를 다시 부르지 않음(R12)
  - 이어받음: platform#T43의 invocation 복구 command. 재시작 점검이 미완료
    invocation을 실제 관측으로 확정하는 연결은 이 작업이 낸다. 기록 자체는
    apps#T11이 끝났고, 미완료 전달을 재시작 때 이어 받는 쪽은 이 작업이다
  - 구현 자리: `invocations/confirm.ts`(accept_confirm, platform#T32의 시험 전용
    stand-in은 지웠다), `invocations/delivery/{queue,backoff}.ts`,
    `invocations/recording.ts`(기록 대상 규칙·사실 모양),
    `invocations/restart.ts`(재시작 점검 관측, `apps/core/core.ts`가 owner로
    건다), `runtime/entrypoint/{confirm-marker,stages}.ts`,
    `permissions/broker/invocations.ts`(broker submit),
    `apps/app-supervisor/delivery.ts`(core sender·손실 진단 frame·조립)

### T13 broker의 permission 강제

- 상태: 완료 (#316) — 이어보냄: supervisor 조립(자식마다 broker
  socket·`createBrokerHub`·`serveBroker`,
  `BrokerAccess`·`SecretDelivery`·`ProblemsReport`·`GrantRevoker`·`AppProcesses`
  어댑터) → T19, `DocumentsSave` 어댑터 → documents#T31. broker의
  `/ready`·`/control/watch`·`/automations/*`·`/apps/connect` 경로는 각 담당
  작업(T7·T10·T15·T20)이 `BrokerServices`에 더한다
- 등급: 기본
- concern: apps/permissions, apps/blueprint
- 요구: apps/permissions#R4, R13, R14, R15, R16, R17, R20, R21, R22, R23, R29,
  apps/blueprint#R13
- 자리: packages/apps/permissions/broker/ (server.ts, net-fetch.ts, secrets.ts,
  documents.ts, problems.ts, apply-grant.ts), apps/core/apps.ts
- 쓰는 contract: platform secret 전송 부착·redaction, documents
  저장(`/v1/documents/save`, 앱 자리·documents[].key로 찾고 첫 저장이면 만듦,
  documents#T8·T31), problems 문제 보고(`/v1/problems/report`), platform
  인증(app:<app> 자격)
- 내놓는 contract: broker
  `/_lophn/broker/{net/fetch,secrets/use,documents/save,problems/report}`(apps
  안쪽, SDK가 씀)
- slice: apps
- 선행: apps#T4, apps#T8, platform#T15, platform#T20, platform#T31,
  documents#T8, problems#T3
- 완료:
  - `fs-boundary_test.ts`: 운영 앱이 자기 data는 읽고 쓰고 source·다른 앱
    DB·log·credential 접근은 거절(R4)
  - `documents_test.ts`: 미선언 문서·grant 밖 문서 저장 거절(R13), 같은 선언
    key로 두 번 저장하면 broker가 같은 (앱 자리, key)·같은 재전송 key로 보내고
    다른 앱 place 참조는 거절(apps/blueprint#R13). documents#T31(apps slice, 이
    작업 뒤)이 들어오기 전에는 documents 저장 contract fake로 보고, 같은
    Document에 version이 쌓이는 실제 확인은 T27이 한다
  - `secrets_test.ts`: grant가 있는 앱의 command를 사람
    화면·agent·automation·다른 앱이 불러도 secret이 붙고 회수하면 다음 사용부터
    거절(R14), 앱 코드·준비 모드·preview·argv·환경·invocation·event·blob에 원값
    없음(R15), redaction 등록 실패와 다른 host redirect에서 전달 멈춤(R16), 값
    교체·삭제 뒤 사용 앱을 종료 확인과 새 nonce로 재시작(R17)
  - `apply-grant_test.ts`: grant 변경은 새 호출 차단 → 기존 자식 종료 확인 → 새
    범위 재시작, 종료 확인 전 새 자식 없음(R20), 종료 확인을 막으면 회수 진행
    중·확인 뒤에만 revoked(R21), 전송 뒤 회수해도 그 전송은 완료 사실로
    남음(R22), app.call·agent.commands 회수도 관련 연결 차단과 종료 확인 뒤
    적용·옛 connection 거절(R29)
  - 진단·수리 runner가 다른 앱·플랫폼 파일을 요청하면 거절(R23)
  - apps#T12에서 넘어온 것: `apps/app-supervisor/delivery.ts`의
    `createSupervisorDelivery`가 만든
    `delivery.broker.submit(child, body)`(`permissions/broker/invocations.ts`)를
    broker 서버가 `/_lophn/broker/invocations/submit`에 올린다. 자식
    credential에서 `BrokerChild{app, release, mode, processNonce}`를 정해 넘기고
    응답은 `{accepted: true}` 또는 오류 envelope다. 지금
    apps/app-supervisor/main.ts는 `delivery`를 만들어 자식 종료
    hook(`childExited`)만 연결하고 broker 서버는 없다

### T14 cap-fs, cap-net, cap-store, cap-save, cap-secret

- 상태: 완료 (#320) — 이어보냄: 앱 프로세스 entrypoint의 host port 설치와 실제
  자식에서의 broker 시험, release 준비의 선언 permission 검사(R22) → T19, DB
  파일 이름 `app.sqlite` 합의 → T18
- 등급: 기본
- concern: apps/sdk
- 요구: apps/sdk#R22, R23, R24, R25, R26, R30, R31, R32
- 자리: packages/sdk/cap-fs/, packages/sdk/cap-net/, packages/sdk/cap-store/,
  packages/sdk/cap-save/, packages/sdk/cap-secret/
- 쓰는 contract: T13 broker 서비스, T7 cap-schedule의 host 문맥
- 내놓는 contract: 각 @lophn/cap-* 1.0.0 공개 API
- slice: apps
- 선행: apps#T7, apps#T13, problems#T5
- 완료:
  - capability import가 grant를 주지 않고 요구 permission이 빠진 앱 선언은
    검사에서 거절(R22), 거절 오류에 필요한 permission 이름과 scope(R23)
  - cap-fs read·write·watch, cap-net timeout·retry fetch(재시도는 read에만
    기본), cap-store 자기 SQLite와 migration 도우미(R24), loopback 듣기 안내는
    Deno.serve이고 별도 패키지 없음(R25)
  - @lophn/cap-problem에 추가 permission 없이 선언 code 보고·해소 주장·변경
    메모가 있고 닫기 API가 없다(R26). cap-problem 코드는 problems#T5가 쓰고(Q3)
    이 작업은 공개 API 검사만 한다
  - cap-save는 선언 key·기대 version·재전송 key를 받고 같은 요청 재전송이
    version 하나(R30), cap-secret은 grant 범위 사용 client와 preview 대역만 있고
    원값 읽기·CRUD 없음(R31), 공개 API에 core DB·credential·grant 발급·problem
    닫기 통로 없음(R32)
  - 구현 자리: 각 package는 자기 완결(상대 import와 `node:` 뿐)이다.
    `packages/sdk/cap-fs/`(Deno flag 직접 사용, 거절을 permission 이름과 경로로
    번역), `cap-net/fetch.ts`, `cap-secret/secret.ts`, `cap-save/save.ts`,
    `cap-store/store.ts`, 각 package의
    `declaration.ts`(`checkDeclaration`·`REQUIRED_PERMISSIONS`)와 `guide.md`.
    실제 broker와 이어 보는 시험은 `packages/sdk/capabilities_test.ts`(실제
    `createBrokerEndpoint`를 unix socket으로 듣고 local fake server만 씀)
  - host port: cap-net·cap-secret·cap-save·cap-store는
    `Symbol.for("lophn.cap-host")` 전역 port로만 앱 프로세스 host에
    닿는다(cap-schedule의 `SCHEDULE_PORT`와 같은 방식). 모양은
    `{mode, dataPath, post(path, body, {signal?}) → {status, body}, call() → {command, inputHash, release, invocation} | null}`이다.
    `post`는 host가 process_nonce·mode·broker credential을 붙여 broker socket에
    POST한다(앱 코드와 SDK는 credential을 보지 못한다). 이 port를 설치하는 쪽은
    아래 T19로 넘겼다

### T15 앱 쌍 연결

- 상태: 완료 (#324) — 이어보냄: 준비·confirm 서비스의 core
  조립(approval·blueprint 어댑터 포함)·supervisor broker 서비스·target direct
  socket의 Deno 허락 → T19, A→B E2E → T27
- 등급: 기본
- concern: apps/connections, apps/runtime, apps/sdk
- 요구: apps/connections#R1–R7, apps/runtime#R30, apps/sdk#R40
- 자리: packages/apps/connections/ (resolve.ts, origin.ts, client.ts, mod.ts),
  packages/apps/permissions/broker/apps-connect.ts,
  packages/sdk/cap-schedule/connect.ts(connectAppCommands)
- 쓰는 contract: T4 grant, T10 connect, contracts#T34(AppCallOrigin)
- 내놓는 contract: broker `/_lophn/broker/apps/connect`(apps 안쪽),
  connectAppCommands(@lophn/cap-schedule)
- slice: apps
- 선행: apps#T4, apps#T10, apps#T12, apps#T13, contracts#T34
- apps#T21에서 넘어온 것: preview 자식의 `/apps/connect` 서비스 자리에는 `packages/apps/preview`의 `createPreviewAppsService()` 대역(가짜 connection 없이 대상이 있든 없든 같은 forbidden, 시도만 메모리에 기록)을 올린다. live가 아닌 mode의 자식은 이 서비스로 다른 앱의 실제 connection을 받지 못한다
- 완료:
  - `resolve_test.ts`: A→B 두 command 허락이면 그 둘만, B→A·A→C 거절(R1), 호출
    범위 = source 선언 ∩ active app.call grant ∩ target 현재 command, 새
    command는 옛 grant로 안 됨(R2)
  - `pair_test.ts`: 같은 handler·입력 검사·effect, secret grant가 있는 target의
    confirm=false는 추가 approval 없이, confirm=true만 approval(R3), ledger 지연
    중에도 A→B 응답(R4, apps/runtime#R30), 위조 caller·미허락 command·옛
    프로세스 연결 거절(apps/runtime#R30), A의 당시 release와 부모 inv 전달·부모
    없으면 없음, B→C는 B 자신의 선언·grant 없이는 거절(R5), B가 응답 중 종료돼도
    A의 다른 화면과 C 호출이 동작하고 B 쓰기를 반복하지 않음(R6), A→B→A와 아홉
    번째 앱 거절·독립 A→B와 B→A는 가능(R7)
  - SDK client가 실제 app·release·부모 inv 문맥을 전달하고 import만으로 연결
    허락이 생기지 않음(apps/sdk#R40)
  - apps#T12에서 넘어온 것: A→B confirm=true 호출은 approval 적용 뒤
    `invocation.accept_confirm`의 proof를 `CoreSigner.signConfirmProof`로 서명해
    호출자에게 주고, 호출자가 같은 입력과 함께 B의 direct 호출에 붙인다. 앱
    entrypoint가 서명·nonce·release·command·input_hash·caller·기한을
    검증한다(`invocations/confirm_test.ts`)
  - 구현 자리: `connections/resolve.ts`(순수 범위 계산,
    effectiveScope.app_calls와 같음을 시험), `connections/origin.ts`(`PathBook`:
    발급 origin과 start 사실로 path·알려진 부모를 이음, `observeStarts`가 broker
    invocations 서비스를 감싼다),
    `connections/prepare.ts`(`inspectPair`·`createPairPreparer`: source 현재
    프로세스·선언·grant, target 현재 프로세스를 읽어 AppConnection을 서명,
    `close(app)`가 `ConnectionGate`),
    `connections/confirm.ts`(`createConfirmProofIssuer`: 적용된 접수의 proof를
    `CoreSigner.signConfirmProof`로 서명),
    `connections/confirm-request.ts`(`createPairConfirmer`: approval 요청·poll),
    `connections/client.ts`(앱 프로세스 쪽 `PairPort`·`unixPairDirect`, Zod
    없음), `permissions/broker/apps-connect.ts`(`/_lophn/broker/apps/connect`),
    `packages/sdk/cap-schedule/connect.ts`(`connectAppCommands`),
    `runtime/entrypoint/startup.ts`가 `PairPort`를 설치하고 `broker-client.ts`에
    `appsConnect`가 있다. `connections/mod.ts`는 Zod 없는 통로·순수 범위만 내고
    core 쪽(prepare·confirm·origin)은 `invocations/commands.ts`처럼 core 조립이
    직접 부른다
  - 시험: `resolve_test.ts`(R1, R2),
    `pair_test.ts`·`path_test.ts`·`confirm_test.ts`(실제 broker endpoint·실제
    core 서명·실제 앱 자식·실제 core approval),
    `permissions/broker/apps-connect_test.ts`, `connections/client_test.ts`,
    `permissions/broker/apps-confirm_test.ts`,
    `runtime/entrypoint/pair-port_test.ts`,
    `sdk/cap-schedule/connect_test.ts`·`connect_pair_test.ts`(R40)
  - confirm 경로(R3): broker
    `/_lophn/broker/apps/confirm/{request,poll}`(`permissions/broker/apps-confirm.ts`,
    contracts `brokerAppsConfirm*`). 호출한 앱 자식이 (대상
    앱·command·입력·연결의 대상 release·nonce)로 approval을 요청하면 서비스가
    대상의 고정 blueprint로 입력 지문을 계산해(요청에 지문을 싣지 않는다. 앱
    쪽은 대상 schema를 몰라 지문을 만들 수 없다) 호출한 앱 요청자의 approval을
    만들고, poll(최대 5초 기다림)이 허락을 보면 `apply_approved_action`을 적용한
    뒤 접수된 proof를 서명해 준다. 그래서 approval은 한 번만 쓰인다. SDK
    `call`은 대상 앱이 `confirm_required`로 거절하면(또는 `confirm: true`면
    처음부터) 이 흐름으로 가서 같은 입력·같은 request_key로 proof를 붙여 다시
    보낸다(`connections/confirm-request.ts`, `sdk/cap-schedule/connect.ts`)
  - 호출 출처(Q28): `brokerAppsConnectInput.incoming`(받은 연결의 부른
    앱·release·부모)을 서비스가 발급한 origin과 맞춰 path를 서비스 값으로
    잇는다. runtime이 handler 문맥(`InvocationContext.caller`)에 싣고 SDK가
    보낸다. 모르는 출처는 invalid_input
  - 이어보냄 아래 T19: 준비 서비스를 core에 조립하고 supervisor broker에 올리기,
    앱 프로세스의 target direct socket Deno 허락

### T16 화면 context와 agent 주석

- 상태: 완료 (#326) — 이어보냄: view 폐기·교체를 runtime에 보내는 쪽(shell →
  core 중계 → `control/view-closed`) → shell#T39, revert 조립(`{result,revert}`)
  → apps#T23, 탭 닫은 뒤 거절의 E2E → apps#T27
- 등급: 기본
- concern: apps/agent-context, apps/sdk
- 요구: apps/agent-context#R1–R6, apps/sdk#R39
- 자리: packages/apps/agent-context/ (schema.ts, redaction.ts, mod.ts),
  packages/sdk/cap-schedule/screen-context.ts(registerScreenContext,
  registerAnnotationTarget)
- 쓰는 contract: contracts#T33(ScreenContextReadInput, AppScreenContext,
  AnnotationWriteInput), platform redaction(model 전달 경계에서 다시 적용은
  lophn-agent 쪽)
- 내놓는 contract: SDK 등록 API. read·write는 앱의 일반 command라 새 경로 없음
- slice: apps
- 선행: apps#T2, apps#T7, apps#T10, contracts#T33
- 완료:
  - 선언된 화면만 context·주석을 제공하고 미선언 화면·자리는 invalid_input(R1),
    같은 앱 두 view_session에서 다른 상태와 revision, 닫힌 view는 unavailable·옛
    상태를 최신으로 내보내지 않음(R2), 요약은 redaction 뒤 UTF-8 2048byte
    이하이고 상세는 detail=true 조회에서만(R3), sensitive_paths는
    요약·상세·오류에서 제거되고 안전성 미확인은 생략 사실만(R4), 주석 쓰기는
    선언 자리와 expected_revision CAS, revision 변경은 conflict·닫힌 view는
    unavailable(R5), agent.commands grant를 거두면 조회·되쓰기 거절(R6, T10
    통합)
  - 템플릿 예제에서 코드 입력과 지난 attempt 공유·민감 칸 제외·옛 revision 주석
    거절(apps/sdk#R39)

### T17 data worker: backup, migration, restore

- 등급: 기본
- concern: apps/data
- 상태: 완료 (#192) — 이어보냄: activation 순서(종료 확인 → backup 확정 →
  migration → 복원)와 보호 backup의 blob field 등록 확정 → apps#T18
- 요구: apps/data#R1, R2, R3, R5, R6, R7, R8, R10, R14
- 자리: packages/apps/data/worker/ (schema.ts, backup.ts, migrate.ts,
  restore.ts, integrity.ts), packages/apps/data/commands.ts,
  apps/worker/apps/data.ts
- 쓰는 contract: platform blob(보호 backup 설치, blob field 등록 때 일반 읽기
  불가로 적는다; platform#T13·T14), T3 migration용 flag
- 내놓는 contract:
  `/v1/releases/{record_backup,record_data_change,record_data_restore}`, event
  ReleaseBackupRecorded·ReleaseDataChanged·ReleaseDataRestored, data worker
  job(stdin JSON → DataResult; problems test runner도 씀) (contracts#T36)
- slice: apps
- 선행: apps#T3, apps#T6, contracts#T36, platform#T13, platform#T14
- 완료:
  - 앱마다 DB 파일 하나이고 core·supervisor는 열지 않으며 종료 확인 뒤 단독 data
    worker만 연다(R1), ORM 없는 앱도 같은 규칙을 통과하고 업무 저장과 ledger를
    함께 rollback했다고 하지 않음(R2), DB 미사용 앱 schema 0 허용·실제 schema와
    마지막 migration 결과 확인(R3)
  - WAL에 새 항목이 있는 DB를 SQLite backup API로 backup·복구하면 항목이 남고
    본체 파일 복사는 유효 backup이 아님(R5), 단계마다 데이터 변경과 schema
    갱신이 한 transaction이고 중간 실패에 함께 rollback(R6), 0→3의 두 번째 단계
    실패면 0의 데이터·schema로 복원(R7), 공개한 migration script를 바꾼 release
    준비 거절(R8), migration 6회 뒤 최근 5개 유지·진행 중 복원 참조는 보호(R10),
    schema 통과를 업무 정확성으로 표시하지 않음(R14)
  - migration 자식에 network·secret·외부 fs·subprocess 권한이 없다(T3 flag
    재사용)

### T18 activation

- 상태: 완료 (#381, 조립 #386) — 이어보냄: 템플릿 앱의 실제 기동 entry·problems 보고 → apps#T27
- 후속 (#449): 운영 앱 runtime entry
- 등급: 최상위
- concern: apps/releases, apps/data
- 요구: apps/releases#R8, R12, R13, R14, R15, R16, apps/data#R4, R9, R11, R12
- 자리: packages/apps/releases/activation/ (orchestrator.ts, steps.ts,
  recovery.ts), packages/apps/releases/commands.ts(start_activation,
  complete_activation, fail_activation), apps/core/apps.ts
- 쓰는 contract: platform approval(정확한 대상 release approval,
  `/v1/approvals/apply` owner command), notification(ReleaseActivationFailed),
  event 구독
- 내놓는 contract:
  `/v1/releases/{start_activation,complete_activation,fail_activation}`, event
  ReleaseActivationStarted·ReleaseActivated·ReleaseSuperseded·ReleaseActivationFailed
  (contracts#T36)
- slice: apps
- 선행: apps#T4, apps#T8, apps#T9, apps#T17, apps#T19, platform#T23, platform#T33
- apps#T21에서 넘어온 것: 실제 `PreviewBundles`(`packages/apps/preview/service.ts`의 port)를 `core.ts`의 `appPreviews.bundles`로 낸다. 봉인 bundle 사본(`bundleCopyPath`)의 manifest·blueprint에서 entry·import map·`appFlags(…, data=preview 영역)`·command key·선언 화면·data schema를 만들고 `fixture(hash)`는 manifest 파일 중 그 hash의 byte를 돌려준다. 운영 DesiredApp 조립과 같은 함수를 쓴다. 없으면 `/v1/previews/start`는 unavailable이다
- 선행: apps#T4, apps#T8, apps#T9, apps#T17, apps#T19, platform#T23,
  platform#T33
- 완료:
  - `activation_test.ts`: coding agent가 준비한 release도 approval 없이는
    activating이 되지 않고 재시도에는 새 결정(R8), approval 뒤 grant·active
    release를 바꾸면 낡은 activation 거절(R12), activation 둘·grant 변경 동시
    요청에서 하나만 진행, 이전 자식 종료 뒤 새 자식(R13),
    handler·hash·schema·probe 불일치면 active 불변·성공 commit 뒤에만 통로 open,
    같은 transaction에 이름·설명 갱신과 첫 성공의 run_enabled=true(R14), 다른
    schema의 옛 release는 바로 activation 안 됨·같은 schema rollback은 새
    activation(R16)
  - `recovery_test.ts`: 종료 확인·backup 확정을 각각 지연시키면 migration도 새
    업무도 시작하지 않음(apps/data#R4), migration·새 준비 실패면 새 자식 종료 →
    backup restore → 무결성·schema 확인 → record_data_restore → fail_activation
    → 이전 release 재준비, 복원 실패·미확인은 unavailable과 문제
    보고(apps/data#R11, apps/releases#R15), 성공 commit 뒤 만든 업무 데이터는 옛
    backup으로 자동 덮지 않음(apps/data#R12), migration 이력에서 출발·도착
    schema·설명·손실 가능성·backup·결과·시각을 찾음(apps/data#R9)
  - 각 단계에서 child·core·supervisor를 끊는 테스트와 complete_activation 응답
    유실 테스트(architecture/apps.md 8장)
  - apps#T14에서 넘어온 것: 앱 DB 파일 이름은
    `<data_path>/app.sqlite`다(cap-store의 `DEFAULT_DATABASE_FILE`). data
    worker의 `databasePath`·`backupPath` 기준을 이 파일로 맞춘다. cap-store의
    migration 도우미는 data worker와 같은 `lophn_data_schema` 표와 `sha256:`
    script_hash 규칙을 쓰고 live 앱에서는 schema 변경을 거절하므로, 운영의
    schema 변경은 activation의 data worker만 한다
  - 이어받음: apps#T17의 activation 순서(종료 확인 → backup 확정 → migration →
    복원) 조립. 보호 backup의 blob field 등록(general_read 없음)은 record_backup
    hash로 이 작업이 확정한다. T17은 backup 파일을 앱 데이터 영역에 남긴다
  - 이어받음: platform#T33의 fail_activation 발생 작업. `fail_activation`이
    `ReleaseActivationFailed`를 내는 것은 이 작업의 자리다
  - 이어받음: platform#T43의 release activation 복구 command. 재시작 점검이
    미완료 activation을 실제 관측으로 확정하는 연결은 이 작업이 낸다
  - 이어받음: apps#T4의 activation 진행 판정 상대. grant.create·revoke는
    ReleaseActivationStarted와 그 seq를 started_seq로 가리키는
    ReleaseActivated·ReleaseActivationFailed event로 "activation 진행 중"을
    본다(`permissions/store.ts`). start_activation은 `expected_grants_seq`에
    apps/permissions의 grant 집합 seq(앱의 마지막 GrantCreated·GrantRevoked
    event seq, 없으면 0)를 쓰고, 시작 event의 시도 식별은 그 event의 seq다
  - 이어받음: apps#T10의 supervisor 상태 알림. 활성 release와 실행 허용이
    정해지면 `core.reconcileApp(desired)`(apps/core/apps-control.ts)로
    release·bundle hash·등록 command·선언 화면·flag(`appFlags`의 결과; socket은
    supervisor가 시작마다 더한다)·entry·import map·data 경로를 supervisor에
    알리고, 사람의 멈춤·archive·grant 변화도 같은 호출로 알린다. core는
    마지막으로 알린 상태를 기억해 supervisor가 다시 뜨면 같은 상태로 맞춘다.
    후보 release의 activation 준비(commit 전 open 금지)는 지금 `DesiredApp`에
    없다: 후보는 probe까지만 하고 commit 뒤에 open하는 조립이 이 작업 몫이다.
    지금 supervisor는 probe가 통과하면 바로 open한다
  - apps#T19에서 넘어온 것: (1) 봉인 bundle 사본 모양. release 준비가 앱 source·build한 `screens/`·정규
    `blueprint.json`·`manifest.json` 말고 `import-map.json`(앱 deno.json의 import map을 잠근 것: SDK는
    `./sdk/<이름>/<version>/<경로>`, npm·jsr는 정확한 pin)과 설치 SDK 사본(`sdk/<이름>/<version>/...`,
    지원 소스 design·wording 포함)과 앱의 `deno.lock`을 담는다. 운영 DesiredApp의 `importMap`은 사본의
    `import-map.json`이고 상대 경로는 그 파일 위치(사본 root) 기준이다. 앱 자식의 읽기 허락은 사본 root를
    덮어야 한다(`appFlags`의 bundle). (2) `PreviewBundles`(`appPreviews.bundles`)도 같은 사본 모양에서
    entry·import map을 만든다. (3) release.prepare를 부르는 쪽이 없다: 준비(`prepare_bundle`)가 끝나고
    같은 bundle hash의 app test가 pass이면 machine이 사본의 `blueprint.json`·`manifest.json`·data schema와
    data_changes(`migrations/`의 단계 파일)·tests·ticket_source로 `release.prepare`를 부르는 자리는
    apps#T27이 정한다(아래 T27)

### T19 release 준비 확정, 비교, blueprint read

- 상태: 완료 (#377) — 이어보냄: 봉인 사본 모양·PreviewBundles → apps#T18, release.prepare 호출자·secret 전송 부착·GrantApplier 조립 → apps#T27
- 등급: 기본
- concern: apps/releases, apps/blueprint
- 요구: apps/releases#R5, R6, R7, R9, R10, R11, R18, apps/blueprint#R2, R3
- 자리: packages/apps/releases/ (commands.ts prepare, reads.ts list·get·compare,
  compare.ts, preparation.ts(supervisor 쪽 요청 진행)),
  packages/apps/blueprint/reads.ts(apps.blueprint), apps/core/apps.ts
- 쓰는 contract: problems test 실행(Verification read:
  bundle_hash·kind=app_test·pass), coding-agent의
  `checkTicketClaim({ticket, claim_seq, connection, now})` read(같은 core
  transaction 안에서 요청 때와 확정 때), platform command·read
- 내놓는 contract:
  `/v1/releases/{prepare_bundle,preparation,cancel_preparation,prepare,list,get,compare}`,
  `/v1/apps/blueprint`, event ReleasePrepared (contracts#T36, T20)
- slice: apps
- 선행: apps#T6, apps#T8, contracts#T36, contracts#T41, problems#T9, problems#T10, problems#T11, coding-agent#T19
- apps#T14에서 넘어온 것: (1) 앱 프로세스 entrypoint가 cap-net·cap-secret·cap-save·cap-store의 host port(`globalThis[Symbol.for("lophn.cap-host")]`, 모양은 T14 완료 줄)를 시작 입력으로 설치한다. `post`는 `createBrokerClient`와 같게 `process_nonce`·`mode`를 본문에 붙이고 broker socket에 credential로 POST하며, `call()`은 invoke 중인 command의 `command`·`inputHash`(검증·default 적용한 실제 입력의 hash)·`release`·`invocation`을 `AsyncLocalStorage` 문맥으로 낸다(`runtime/entrypoint/invoke.ts`가 `port.run`을 부르는 자리). `dataPath`는 시작 입력의 `data_path`다. 지금 entrypoint는 이 port를 설치하지 않아 실제 자식에서 cap-net 등은 `unavailable`이다. 위 supervisor 조립(자식마다 broker socket)이 서면 실제 자식에서 cap-net·cap-secret·cap-save가 broker를 지나는 것을 시험한다. (2) release 준비(`prepare`)는 blueprint의 `sdk_dependencies`가 cap-fs·cap-net·cap-save·cap-secret일 때 `permissions`에 요구 permission이 없으면 거절한다(apps/sdk#R22). 표는 각 package의 `REQUIRED_PERMISSIONS`(cap-fs는 fs.read 또는 fs.write, cap-net은 net.fetch, cap-save는 document.save, cap-secret은 secret.use와 net.fetch)이고 core는 SDK 코드를 import하지 않으므로 같은 표를 `packages/apps/blueprint`에 옮겨 쓴다. SDK의 `checkDeclaration`과 같은 결과여야 한다
- coding-agent#T21에서 넘어온 것: swap blueprint into APP_OP_ROUTES. `apps.blueprint` read route가 contract 표에 생기면 `packages/coding-agent/connection/app-ops.ts`의 `APP_OP_ROUTES.blueprint`(지금 appRuntime 입력 자리)를 그 route로 바꾸고 `blueprint` op 실행(지금 `unavailable`)을 그 read로 잇는다
- coding-agent#T23에서 넘어온 것: `/v1/apps/blueprint` read가 앱 하나의 active release 고정 blueprint에서 `{release, blueprint_hash, commands[{key,label,description,effect,confirm,input}]}`를 낸다(coding_agent actor도 받고, 범위 밖·없는 앱·active release 없음은 같은 not_found). coding-agent의 `AppBlueprintSource`(`mcp-server/tools/app-commands.ts`)가 이 모양으로 읽는다. 지금 main에는 route가 없어 blueprint 유래 앱 tool이 `apps/mcp/main.ts`의 `appBlueprint` 옵션이 비어 나오지 않는다
- apps#T13에서 넘어온 것: `apps/app-supervisor/main.ts`에서 운영 자식마다 broker socket을 열고(`createBrokerHub`·`serveBroker`, `permissions/broker/`) 서비스 어댑터를 조립한다. `BrokerAccess`는 이 작업의 blueprint read(현재 release 선언 ∩ active grant, 요청마다 다시 읽음), `SecretDelivery`·`RedactionGate`는 core secret store의 전송 부착(contracts#T23), `ProblemsReport`는 problems collector, `GrantRevoker`·`AppProcesses`는 core 제어 메시지. `DocumentsSave`는 documents#T31이 낸다. 지금은 시험 fake(`permissions/testing/broker.ts`)만 있어 broker가 아무 데서도 돌지 않는다
- apps#T15에서 넘어온 것: (1) core에서 `createPairPreparer({clock, signer, process, facts})`(`connections/prepare.ts`)를 만든다. `signer`는 T10의 같은 `createCoreSigner()` 하나, `process`는 `supervisor-link`의 `ProcessSource`, `facts`는 T10의 `ConnectFacts`에 `declarations(app)`(현재 release 선언 `{release, app_connections}`, 위 `currentDeclarations`)를 더한 것이다. (2) supervisor의 자식 broker 서비스에 `apps: createAppsConnectService({preparer})`를 달되 supervisor는 core의 preparer를 부르는 `AppPairPreparer` 어댑터(감독 pipe `worker_request`)를 쓴다. `invocations`는 `observeStarts(createInvocationBroker(...), preparer.paths)`로 감싸 start 사실이 path 장부에 알려지게 하고(`childExited`가 장부를 비운다), `ConnectionGate.close`는 `preparer.close`다. (3) 앱 자식의 Deno 허락에 app.call target의 direct socket(`unix:<고정 자리 socket>`과 읽기·쓰기)을 `effectiveScope.app_calls`의 대상마다 더한다. 지금 `appFlags`는 자기 두 socket만 열어 실제 자식의 `unixPairDirect`는 NotCapable이다. (3-1) confirm: core에서 `createPairConfirmer({process, facts, signer, paths: preparer.paths, ids, targets, approvals, accepted})`(`connections/confirm-request.ts`)를 만들고 supervisor 자식 broker에 `appsConfirm: createAppsConfirmService({confirmer})`를 단다. 어댑터는 이 작업(T19)이 만든다: `ConfirmTargets`(대상 release의 고정 blueprint로 `canonicalInputHash`와 confirm=true 확인, 아니면 invalid_input), `ConfirmApprovals`(요청자 `app:<호출 앱>`의 `confirmAction`으로 approval 생성·상태 읽기·machine의 `apply_approved_action`), `ConfirmAcceptances`(core에 저장된 접수 사실(`invocations`의 approval과 `InvocationAccepted` event 시각)에서 proof payload를 다시 만든다. `invocation.accept_confirm`은 dispatch 전용이라 직접 HTTP 재전송은 거절되고(platform Q32, #328), 접수가 없으면 `not_found`다). 시험 어댑터는 `connections/confirm_test.ts`에 있고 같은 방식으로 읽는다. (4) 앱 프로세스 entrypoint는 `startRuntime`이 `PairPort`(`Symbol.for("lophn.cap-apps")`)를 이미 설치한다. 위 cap-host port를 설치할 때 broker `post`를 공유하도록 합치려면 `connections/client.ts`의 `createPairPort`를 `CAP_HOST.post`로 바꾸면 된다
- apps#T21에서 넘어온 것: (1) 실제 `PreviewReleases`(release→bundle hash, 없는 release·다른 앱의 release는 undefined)를 `appPreviews.releases`로 낸다. (2) supervisor 조립이 자식마다 broker socket을 열 때 preview 자식에는 `createPreviewBrokerServices({scope: previewScopeOf(blueprint), invocations, problems})`(`packages/apps/preview`)를 `BrokerServices`로 쓰고 launcher의 `attachBroker`가 그 자리다. invocation·problems 서비스는 운영과 같은 구현이고 mode와 release(null이면 기록 없음)로 구별된다
- shell#T43에서 넘어온 것: `apps.blueprint`는 active release의 blueprint만 읽는다(입력이 `{app}`뿐). app-detail의 준비만 된 Version preview는 그 Version이 여는 화면 key를 읽을 길이 없어 지금 쓰는 Version의 full 화면 key로 연다. `{app, release}`로 그 Version의 화면 선언을 읽는 additive 입력이 필요하다. 그 전에 새 Version이 첫 화면 key를 바꾸면 preview가 열리지 않는다
  - 처리됨 (#404): `apps.blueprint`가 `{app, release}`를 받는다(다른 앱의 release는 없는 것과 같다)
- apps#T20에서 넘어온 것: 같은 supervisor 조립에서 (1) `createAutomationPermits()`(`automations/permits.ts`) 인스턴스를 supervisor에 하나 쥐고(앱마다가 아니라 전체 동시 4개 한도) 자식마다 `createAutomationBroker({access, permits})`(`permissions/broker/automations.ts`)를 `BrokerServices.automations`에 넣는다. (2) `BrokerAccess.current`의 `AccessState`에 `automations`(현재 release 선언의 `AutomationDeclarationFact` 목록)를 채운다. 이 작업의 `currentDeclarations` port가 낸다. (3) 자식 종료를 확인하면 `permits.childExited(processNonce)`를 `InvocationBroker.childExited`와 같은 자리에서 부른다. (4) `apps.automations` read가 선언을 알려면 이 작업의 `currentDeclarations`를 `apps/core/apps.ts` `createReaderRegistration`의 `ports` map에 같은 key로 등록해야 한다(지금은 등록이 없어 core에서 빈 목록이다). 등록한 뒤 `automations/core_http_test.ts`에 선언·승인·관측 흐름(permissions/testing의 `set_declarations` 등)을 더한다
- 선행: apps#T6, apps#T8, contracts#T36, contracts#T41, problems#T9,
  problems#T10, problems#T11, coding-agent#T19
- apps#T14에서 넘어온 것: (1) 앱 프로세스 entrypoint가
  cap-net·cap-secret·cap-save·cap-store의 host
  port(`globalThis[Symbol.for("lophn.cap-host")]`, 모양은 T14 완료 줄)를 시작
  입력으로 설치한다. `post`는 `createBrokerClient`와 같게
  `process_nonce`·`mode`를 본문에 붙이고 broker socket에 credential로 POST하며,
  `call()`은 invoke 중인 command의 `command`·`inputHash`(검증·default 적용한
  실제 입력의 hash)·`release`·`invocation`을 `AsyncLocalStorage` 문맥으로
  낸다(`runtime/entrypoint/invoke.ts`가 `port.run`을 부르는 자리). `dataPath`는
  시작 입력의 `data_path`다. 지금 entrypoint는 이 port를 설치하지 않아 실제
  자식에서 cap-net 등은 `unavailable`이다. 위 supervisor 조립(자식마다 broker
  socket)이 서면 실제 자식에서 cap-net·cap-secret·cap-save가 broker를 지나는
  것을 시험한다. (2) release 준비(`prepare`)는 blueprint의 `sdk_dependencies`가
  cap-fs·cap-net·cap-save·cap-secret일 때 `permissions`에 요구 permission이
  없으면 거절한다(apps/sdk#R22). 표는 각 package의
  `REQUIRED_PERMISSIONS`(cap-fs는 fs.read 또는 fs.write, cap-net은 net.fetch,
  cap-save는 document.save, cap-secret은 secret.use와 net.fetch)이고 core는 SDK
  코드를 import하지 않으므로 같은 표를 `packages/apps/blueprint`에 옮겨 쓴다.
  SDK의 `checkDeclaration`과 같은 결과여야 한다
- coding-agent#T21에서 넘어온 것: swap blueprint into APP_OP_ROUTES.
  `apps.blueprint` read route가 contract 표에 생기면
  `packages/coding-agent/connection/app-ops.ts`의 `APP_OP_ROUTES.blueprint`(지금
  appRuntime 입력 자리)를 그 route로 바꾸고 `blueprint` op 실행(지금
  `unavailable`)을 그 read로 잇는다
- coding-agent#T23에서 넘어온 것: `/v1/apps/blueprint` read가 앱 하나의 active
  release 고정 blueprint에서
  `{release, blueprint_hash, commands[{key,label,description,effect,confirm,input}]}`를
  낸다(coding_agent actor도 받고, 범위 밖·없는 앱·active release 없음은 같은
  not_found). coding-agent의
  `AppBlueprintSource`(`mcp-server/tools/app-commands.ts`)가 이 모양으로 읽는다.
  지금 main에는 route가 없어 blueprint 유래 앱 tool이 `apps/mcp/main.ts`의
  `appBlueprint` 옵션이 비어 나오지 않는다
- apps#T13에서 넘어온 것: `apps/app-supervisor/main.ts`에서 운영 자식마다 broker
  socket을 열고(`createBrokerHub`·`serveBroker`, `permissions/broker/`) 서비스
  어댑터를 조립한다. `BrokerAccess`는 이 작업의 blueprint read(현재 release 선언
  ∩ active grant, 요청마다 다시 읽음), `SecretDelivery`·`RedactionGate`는 core
  secret store의 전송 부착(contracts#T23), `ProblemsReport`는 problems
  collector, `GrantRevoker`·`AppProcesses`는 core 제어 메시지. `DocumentsSave`는
  documents#T31이 낸다. 지금은 시험 fake(`permissions/testing/broker.ts`)만 있어
  broker가 아무 데서도 돌지 않는다
- apps#T15에서 넘어온 것: (1) core에서
  `createPairPreparer({clock, signer, process, facts})`(`connections/prepare.ts`)를
  만든다. `signer`는 T10의 같은 `createCoreSigner()` 하나, `process`는
  `supervisor-link`의 `ProcessSource`, `facts`는 T10의 `ConnectFacts`에
  `declarations(app)`(현재 release 선언 `{release, app_connections}`, 위
  `currentDeclarations`)를 더한 것이다. (2) supervisor의 자식 broker 서비스에
  `apps: createAppsConnectService({preparer})`를 달되 supervisor는 core의
  preparer를 부르는 `AppPairPreparer` 어댑터(감독 pipe `worker_request`)를 쓴다.
  `invocations`는 `observeStarts(createInvocationBroker(...), preparer.paths)`로
  감싸 start 사실이 path 장부에 알려지게 하고(`childExited`가 장부를 비운다),
  `ConnectionGate.close`는 `preparer.close`다. (3) 앱 자식의 Deno 허락에
  app.call target의 direct socket(`unix:<고정 자리 socket>`과 읽기·쓰기)을
  `effectiveScope.app_calls`의 대상마다 더한다. 지금 `appFlags`는 자기 두
  socket만 열어 실제 자식의 `unixPairDirect`는 NotCapable이다. (3-1) confirm:
  core에서
  `createPairConfirmer({process, facts, signer, paths: preparer.paths, ids, targets, approvals, accepted})`(`connections/confirm-request.ts`)를
  만들고 supervisor 자식 broker에
  `appsConfirm: createAppsConfirmService({confirmer})`를 단다. 어댑터는 이
  작업(T19)이 만든다: `ConfirmTargets`(대상 release의 고정 blueprint로
  `canonicalInputHash`와 confirm=true 확인, 아니면 invalid_input),
  `ConfirmApprovals`(요청자 `app:<호출 앱>`의 `confirmAction`으로 approval
  생성·상태 읽기·machine의 `apply_approved_action`), `ConfirmAcceptances`(core에
  저장된 접수 사실(`invocations`의 approval과 `InvocationAccepted` event
  시각)에서 proof payload를 다시 만든다. `invocation.accept_confirm`은 dispatch
  전용이라 직접 HTTP 재전송은 거절되고(platform Q32, #328), 접수가 없으면
  `not_found`다). 시험 어댑터는 `connections/confirm_test.ts`에 있고 같은
  방식으로 읽는다. (4) 앱 프로세스 entrypoint는 `startRuntime`이
  `PairPort`(`Symbol.for("lophn.cap-apps")`)를 이미 설치한다. 위 cap-host port를
  설치할 때 broker `post`를 공유하도록 합치려면 `connections/client.ts`의
  `createPairPort`를 `CAP_HOST.post`로 바꾸면 된다
- apps#T20에서 넘어온 것: 같은 supervisor 조립에서 (1)
  `createAutomationPermits()`(`automations/permits.ts`) 인스턴스를 supervisor에
  하나 쥐고(앱마다가 아니라 전체 동시 4개 한도) 자식마다
  `createAutomationBroker({access, permits})`(`permissions/broker/automations.ts`)를
  `BrokerServices.automations`에 넣는다. (2) `BrokerAccess.current`의
  `AccessState`에 `automations`(현재 release 선언의 `AutomationDeclarationFact`
  목록)를 채운다. 이 작업의 `currentDeclarations` port가 낸다. (3) 자식 종료를
  확인하면 `permits.childExited(processNonce)`를
  `InvocationBroker.childExited`와 같은 자리에서 부른다. (4) `apps.automations`
  read가 선언을 알려면 이 작업의 `currentDeclarations`를 `apps/core/apps.ts`
  `createReaderRegistration`의 `ports` map에 같은 key로 등록해야 한다(지금은
  등록이 없어 core에서 빈 목록이다). 등록한 뒤 `automations/core_http_test.ts`에
  선언·승인·관측 흐름(permissions/testing의 `set_declarations` 등)을 더한다
- apps#T22에서 넘어온 것: (1) release 준비가 bundle에 설치
  사본(`sdk/<name>/<version>/`, 지원 소스 `@lophn/design`·`@lophn/wording`
  포함)의 byte를 담고 앱 deno.json의 import map을 bundle 안 상대 경로로 잠가야
  한다. 지금 `prepareRelease`는 앱 source·build 화면·blueprint만 담고 SDK byte는
  담지 않는다. 앱 import map은 `@lophn/<name>` 같은 bare 이름이 키, 값이
  `lophn-sdk:<name>@<version>/<경로>`이거나 정확한 `npm:`·`jsr:`
  pin이다(`buildImportMap`이 같은 모양을 만든다). 앱의 deno.lock은 bundle에
  들어간다. (2) 앱 진입점 `boot()`가 reportProblem transport로 broker
  `/_lophn/broker/problems/report`에 POST하고 응답 본문을
  `{ok, value: ReportAcceptance}` 또는 오류로 읽는다. T13의 `ProblemsReport`
  어댑터를 supervisor에 조립할 때 같은 모양으로 응답해야 한다. (3) 화면
  build(`scripts/build-ui.ts`, esbuild)를 준비 단계가 직접 돌려
  `screens`·`assets`를 만든다. 지금 입력은 이미 build된 JS와 자원이다
- documents#T31에서 넘어온 것: `DocumentsSave` 실제 어댑터(`packages/apps/permissions/adapters/documents-save.ts`의 `createAppDocumentsSave`)는 documents#T31이 끝냈다(실제 core로 시험). supervisor 조립(위 apps#T13 줄)이 그 deps 셋을 채운다. (1) `client(child)`: 그 자식의 app credential(`app_credential_request`로 받은 token, 앱 코드는 못 봄)로 core API를 부르는 client. `createRpcClient`(contracts/platform)와 upload route(`x-lophn-input` base64url JSON header, body 바이트 stream)를 쓰며 구조는 `command`·`read`·`upload` 셋이다. (2) `output`(`AppOutputSource`): 앱이 선언한 key의 출력 bytes 근원. broker 요청에는 본문이 없으므로 근원을 정해야 한다(documents plan Q35 추천: 앱이 자기 `data/files/outputs/<key>/`에 쓰고 supervisor가 realpath로 앱 data 안임을 검사해 읽는다, hash·크기는 읽어서 재고 core가 실제 bytes와 맞춘다). cap-save의 안내(`guide.md`)에 그 규칙을 적어야 앱이 쓸 수 있다. (3) `declarations`(`AppOutputDeclarations`): 현재 release의 blueprint documents[] name·format·document. 이 작업의 blueprint read에서 낸다
- 완료:
  - `prepare_test.ts`: release 없이 bundle을 테스트한 뒤 같은 hash의 pass만
    준비되고 한 byte 바꾼 bundle·자가 제출 결과는 거절(R5),
    누락·만료·반납·connection 회수·claim 변경은 요청 때와 확정 때 모두 거절,
    출처는 claim 해제 뒤에도 그대로(R6), 새 claim 없는 준비 거절·옛 ticket 없는
    release는 null 출처 그대로 읽고 선택 가능(R7), 열린 problem의 code
    삭제·완화는 경고로만(R18)
  - `compare_test.ts`: 새 필수 입력·external 효과·permission 추가·파괴
    migration이 각각 비교에 보임(R9), schema가 같아도 효과가 바뀌면 호환이라
    하지 않고 설명만 바뀐 경우를 구별(R10), 데이터 계약 변경은 apps/data 근거,
    새 접근 요청은 grant 근거로 따로(R11)
  - `blueprint-read_test.ts`: 설명·구조 검증·실제 test 통과를 다른 필드로 내고
    설명만 있는 앱에 test 성공 표시가 없음(apps/blueprint#R3), 화면·command
    설명에서 결과·시작 위치·선택·예시·정보 종류·보존·제약·automation 끄는 법
    필드가 있는지 검사(빈 값 거절, apps/blueprint#R2)
  - prepare_bundle 진행은 core command queue 밖 supervisor 메모리이고 메모리
    유실이면 unknown
  - 이어받음: apps#T4의 현재 선언 port. `permissions/declarations.ts`의
    `currentDeclarations`(`get(sql, app)`: 현재 release의 release
    id·permissions·app_connections·command key·automations(key, command,
    external, input_hash, when))를 releases 조립이 같은 key로 등록한다. tx
    port는 `apps/core/apps.ts`의 ports에, grants.list의 표시 자료는 같은 파일의
    `createReaderRegistration` ports map에 고정 값으로 등록한다. 등록 전에는
    app.call·agent.commands·automation.run의 grant.create가 `unavailable`이고
    grants.list의 display는 null이다
  - 구현 자리: ledger 쪽 `releases/{commands,reads,compare,store,facts,schema}.ts`(`release.prepare`·
    `release.prepare_bundle`의 요청 때 검사·`releases.list·get·compare`), `blueprint/reads.ts`
    (`apps.blueprint`), 준비 진행 `releases/preparation.ts`(supervisor 메모리, 모르면 `unknown`)와 실제 일
    `releases/prepare/from-source.ts`(commit 추출 → 설치 SDK 사본·잠근 `import-map.json` → blueprint 평가 →
    화면 build → 봉인; `bundle/lock.ts`; 앱 source는 신뢰하지 않아 앱의 build script를 실행하지 않고 신뢰된
    `ui-build/{app-build,eval-blueprint,binaries}.ts`가 권한을 좁혀 한다, apps/releases#R3), supervisor 쪽 `apps/app-supervisor/{release-runner,assembly,broker,
    access,pairs,preview-broker}.ts`와 자식 `apps/worker/apps/release-job.ts`, core 쪽 `apps/core/{apps,
    apps-control,apps-confirm}.ts`. 준비 접수·진행·취소는 command route지만 진행이 메모리라
    `withReleasePreparation`이 writer 앞에서 supervisor로 넘긴다(접수만 먼저 ledger transaction에서 앱 범위·
    source 연결·ticket claim을 확인한다). 시험: `releases/{prepare,compare,preparation,core_http}_test.ts`,
    `releases/prepare/from-source_test.ts`, `blueprint/blueprint-read_test.ts`,
    `app-supervisor/{preparation,release-runner,assembly}_test.ts`, `apps/core/release-preparation_test.ts`
  - 정함(추천으로 진행): 준비 접수 요청 때 ticket claim 확인은 `release.prepare_bundle`의 ledger 검사로,
    범위 밖·없는 앱·source 없는 앱은 같은 `forbidden`(진행 조회는 같은 `not_found`)이다. release 자식의 쓰기는
    그 앱의 폴더(`apps/<app>/`)에만 하고 build 자식은 staging 안 `TMPDIR`만 쓴다
  - 이어보냄: 위 apps#T18 두 줄(사본 모양·PreviewBundles), apps#T27 세 줄(release.prepare 호출자, secret 전송
    부착, GrantApplier 조립)

### T20 automation

- 상태: 완료 (#321) — 이어보냄: supervisor 조립(permits 하나·자식마다
  automations broker 서비스·`AccessState.automations`·자식 종료 때
  `permits.childExited`)과 `apps.automations` reader의 `currentDeclarations`
  port 등록 → T19, automation 켜기·끄기 화면 → shell#T43, 실제 supervisor·앱
  자식 automation 회차 E2E → T27
- 등급: 기본
- concern: apps/automations, apps/blueprint
- 요구: apps/automations#R1–R13, apps/blueprint#R14
- 자리: packages/apps/automations/ (clock.ts, permits.ts, reads.ts, mod.ts),
  packages/apps/permissions/broker/automations.ts(try_acquire, release),
  packages/apps/runtime/entrypoint/(automation.ts 조립, invoke.ts의 호출 경로,
  broker-client.ts, control.ts), apps/core/apps.ts,
  apps/core/apps-control.ts(관측 덮기)
- 쓰는 contract: T12 후행 기록, T4의 `automation.run` grant(external automation
  켜기 승인, Q1), packages/base의 Clock(단조 tick)
- 내놓는 contract: `/v1/apps/automations`(선언·현재 실행 가능 여부·승인
  상태·실제 관측), broker
  `/_lophn/broker/automations/{try_acquire,release}`(apps 안쪽)
- slice: apps
- 선행: apps#T4, apps#T7, apps#T8, apps#T12, contracts#T34
- apps#T21에서 넘어온 것: automation clock은 `mode !== "live"`인 프로세스(preview·test)에서 시작하지 않는다(apps/preview#R6). `packages/apps/preview/real_test.ts`의 "시작 계기가 있는 automation도 preview에서는 스스로 돌지 않는다" 시험이 이를 지킨다(clock이 없어 지금은 돌지 않음만 본다)
- 완료:
  - `clock_test.ts`(가짜 tick·타이머): on_start 한 번과 60000ms 간격만,
    59999ms·cron·파일·event 계기 거절(R2), 1초 검사·started_tick 배수·벽시계
    변경 무관·재시작은 새 기준(R3), 통로 닫힘·schema 불일치면 handler 없이
    이유를 남김(R4), 진행 중이면 다음 회차 skip(R5), 절전 1시간 뒤 지난 60회와
    보충 1회 모두 없음(R7), 실패 직후 retry 0(R8), timeout 10분이면 취소 요청과
    timeout 사실, 결과 모름은 성공·미실행으로 쓰지 않음(R9)
  - `permits_test.ts`: 독립 automation 5개가 동시에 도래하면 4개만 시작하고
    대기열 없음, permit은 실제 handler 종료·자식 종료 확인 때만 반환(R6)
  - `reads_test.ts`: 선언만·앱 꺼짐·archive·준비 전·권한 없음·관측 있음을 서로
    다른 사실로 구별하고(입력 source는 blueprint에 개념이 없어 고정 입력만, Q30)
    읽기 command의 automation 호출도 관측으로 센다(R10), 직접 호출(수동
    확인)·다른 release·preview·다른 앱 호출은 관측이 아니다(R12), 현재 관측이
    열려 있으면 runnable이고 닫혀 있으면 그 이유가 승인 부족보다 먼저 보이며
    관측 질의 실패면 reader 값을 그대로 둔다
  - `runtime/entrypoint/automation_test.ts`(앱 쪽 조립): 같은 입력의 직접 호출과
    automation이 같은 handler를 같은 정규 입력으로 부르고 미선언 command·잘못된
    입력·confirm=true 거절(R1, apps/blueprint#R14), start·finish·deny 사실의
    trigger·caller가 automation key·actor machine, 통로 닫힘·preview 대상에서
    handler 없음(R4), timeout 결과 모름·점유 유지(R9), 기록 전달 실패와 재시작이
    업무를 다시 돌리지 않음(R11), 수동 확인은 직접 호출·preview 연결 거절(R12),
    승인 거절(403) 회차에 handler·invocation 없음(R13)
  - `core_http_test.ts`: 실제 core의 reader 등록·메인 덮기를 지나
    `/v1/apps/automations`가 닿고 선언을 모르면 빈 목록, 범위 밖 앱은 없는 앱과
    같은 응답
  - apps/automations domain model(`docs/domain-model/apps/automations.md`)에
    켜기 승인 = `automation.run` grant와 시작하지 못한 회차의 사실 구분을 같은
    PR에서 적었다
  - `permissions/broker/automations_test.ts`(external 승인·한도·mode·경로):
    external automation은 켜는 승인 전에는 돌지 않고 승인 뒤 같은
    command·입력·주기로 추가 확인 없이 돈다, 입력·command·주기를 바꾸거나 끈 뒤
    다시 켜면 새 승인, confirm=true 연결 거절, grant가 있는 secret을 쓰는
    command는 실행(R13)
  - apps#T12에서 넘어온 것: automation 호출의 invocation trigger는
    `{kind: "automation", key}`이고 읽기도 항상
    남긴다(`invocations/recording.ts`의 `recordingMode`가 trigger
    `automation`이면 `always`). 지금 앱 entrypoint는 직접 호출 연결만 알아
    trigger를 `direct`로 남기므로, automation 연결의 caller·trigger를
    `start`·`deny` 사실에 실어야 한다 — 완료: `runtime/entrypoint/invoke.ts`의
    `launch`가 호출 방식(trigger·actor)과 caller를 받아 `start`·`finish`·`deny`
    사실에 싣는다. automation 회차는 trigger·caller가
    `{kind: "automation", key}`, actor가
    machine이다(`launchAutomation`·`denyAutomation`·`timeoutAutomation`)

### T21 preview와 test mode 대역

- 상태: 완료 (#327) — 이어보냄: 실제 `PreviewBundles` → apps#T18, `PreviewReleases`·preview 자식의 broker 서비스 조립 → apps#T19, 앱 쌍 연결 대역 자리 → apps#T15, automation clock의 mode 검사 → apps#T20, 대역 확인 표시 → shell#T37·T45(Q33). release null 허용(Q32)은 이 PR이 contracts까지 고쳤다
- 등급: 기본
- concern: apps/preview
- 요구: apps/preview#R1–R10
- 자리: packages/apps/preview/ (launcher.ts, adapters/secret.ts,
  adapters/external.ts, adapters/documents.ts, adapters/apps.ts, mod.ts),
  apps/core/apps.ts
- 쓰는 contract: T8 supervisor, T10 connect(mode=preview), problems 문제
  보고(preview는 개발 진단, problem=null), problems test 실행(bundle 대상
  Verification)
- 내놓는 contract: `/v1/previews/{start,get,stop}`, PreviewInput
  (contracts#T37). 대역 adapter는 problems test runner의 mode=test에도 쓴다
- slice: apps
- 선행: apps#T6, apps#T8, apps#T10, apps#T13, contracts#T37
- 완료:
  - release 없는 bundle도 preview로 열리고 active release·운영 통로 불변(R1), fixture에서 만든 disposable DB·파일에만 쓰고 운영 DB·backup을 복사하지 않음, 종료 뒤 폐기(R2), preview 종료 뒤 호출은 unavailable이고 운영 앱이 불리지 않음(R3), secret·외부 쓰기·문서 저장·다른 앱 조회·loopback 듣기는 대역만(R4), confirm command의 실제 handler와 approval 소비 없음·대역 성공을 실행 성공이라 하지 않음(R5), clock이 꺼져 있고 수동 호출만(R6), 운영과 preview의 view_session 분리와 응답·invocation·보고의 mode 구별(R7), preview 보고가 운영 problem을 열거나 닫지 않음(R8), release 없는 preview에는 가짜 release·invocation이 없음(R9), preview 성공이 grant·activation·run_enabled·운영 데이터를 바꾸지 않음(R10)
  - 시험(요구 번호로 시작): `launcher_test.ts`(R1·R2·R3·R4·R7·R9 fake 자식), `service_test.ts`(R1·R2·R3·R7·R9·R10 service·영역), `adapters_test.ts`(R4·R8·R9 broker 대역), `real_test.ts`(실제 앱 자식 프로세스: R1·R2·R3·R4·R5·R6·R7·R9·R10), `apps/core/previews_test.ts`(실제 core·supervisor·앱 자식으로 R1·R2·R3·R7·R10), `apps/core/previews-sdk_test.ts`(R4: apps leaf는 packages/sdk를 import하지 못하므로 앱 쪽 cap-save·cap-secret 대역과 broker 쪽 대역이 같은 요청 순서에서 같은 결과를 내는지 본다)
  - 이어받음: 준비된 bundle을 preview 시작 입력으로 여는 실제 `PreviewBundles`(봉인 bundle 사본의 entry·import map·`appFlags(…, data=disposable 영역)`·command·화면·data schema, fixture는 manifest 파일 중 hash가 맞는 byte)는 운영 앱의 DesiredApp 조립과 같은 일이라 apps#T18이 같은 조립으로 낸다(`core.ts`의 `appPreviews.bundles`, 시험은 fixture bundle로 끼운다). release→bundle 대응 `PreviewReleases`는 releases 읽기를 가진 apps#T19가 낸다(`appPreviews.releases`). 둘이 없으면 `/v1/previews/start`는 unavailable이고 get·stop은 그대로 된다
  - 이어받음: preview 자식의 broker 서비스는 T19의 supervisor 조립이 자식마다 broker socket을 열 때 `createPreviewBrokerServices({scope: previewScopeOf(blueprint), invocations, problems})`(preview/adapters)를 `BrokerServices`로 쓰고, 앱 쌍 연결 서비스 자리(T15)에는 그 묶음의 `apps` 대역을 올린다. launcher의 `attachBroker`가 그 자리다. 지금 broker가 어디서도 돌지 않으므로 preview 자식의 broker 호출은 닿을 곳이 없다(앱 쪽 SDK는 live가 아닌 mode에서 대역을 쓴다)
  - 이어받음: preview에서 automation clock이 켜지지 않는 것(R6)은 T20의 clock이 `mode !== "live"`에서 시작하지 않도록 만들 때 `real_test.ts`의 R6 시험(시작 계기가 있는 blueprint가 preview에서 스스로 돌지 않음)이 지킨다. clock이 아직 없어 지금 시험은 "돌지 않음"만 본다
  - 해결(contracts, Q32): release 없는 preview를 위해 `contracts/apps/direct-socket.ts`의 `controlOpenInputSchema.release`와 `contracts/platform/supervision.ts`의 `app_credential_request.release`가 null을 받게 이 PR에서 고쳤다(계약 시험·`platform/identity` 발급 시험 포함, null이면 credential의 조건·대상에 release 키를 두지 않고, registry는 live가 아니고 bundle hash가 있을 때만 release 없는 app 자격을 받는다). preview 자식의 broker credential은 supervisor가 만든 일회용 값으로 둔다(core 발급 app credential을 쓰면 같은 앱 운영 자식의 credential이 끝난다)
  - 이어받음(shell): confirm command를 preview에서 부르면 앱이 forbidden(`confirm commands are not run in preview`)으로 답한다. preview partition·view_session 분리와 `mode` 구별 표시(R7)는 shell#T37, preview를 사람에게 "대역 확인"으로 보이는 표시는 shell#T45가 맡는다
  - release 없는 bundle도 preview로 열리고 active release·운영 통로 불변(R1),
    fixture에서 만든 disposable DB·파일에만 쓰고 운영 DB·backup을 복사하지 않음,
    종료 뒤 폐기(R2), preview 종료 뒤 호출은 unavailable이고 운영 앱이 불리지
    않음(R3), secret·외부 쓰기·문서 저장·다른 앱 조회·loopback 듣기는
    대역만(R4), confirm command의 실제 handler와 approval 소비 없음·대역 성공을
    실행 성공이라 하지 않음(R5), clock이 꺼져 있고 수동 호출만(R6), 운영과
    preview의 view_session 분리와 응답·invocation·보고의 mode 구별(R7), preview
    보고가 운영 problem을 열거나 닫지 않음(R8), release 없는 preview에는 가짜
    release·invocation이 없음(R9), preview 성공이
    grant·activation·run_enabled·운영 데이터를 바꾸지 않음(R10)

### T22 앱 템플릿

- 상태: 완료 (#355) — 이어보냄: SDK byte·잠긴 import map의 bundle 담기와
  reportProblem broker 응답·화면 build 직접 실행 → T19, 템플릿 관리 구간 본문 →
  coding-agent#T34, `sdk add`의 import map 갱신 → coding-agent#T22
- 등급: 기본
- concern: apps/sdk
- 요구: apps/sdk#R1, R29, R33, R35, R36, R41
- 자리: packages/apps/sdk/template/ (app/ 템플릿 원본, resolve.ts),
  packages/apps/sdk/install.ts(템플릿 hash 고정 설치)
- 쓰는 contract: shell의 @lophn/ui-state
  AppErrorBoundary·@lophn/ui-layout·shell/wording catalog 검사 도구, problems의
  @lophn/cap-problem과 exception observer(problems#T5), coding-agent/guides의
  안내 파일 자리(templates/app/AGENTS.md·CLAUDE.md·.gitignore의 관리 구간은
  coding-agent#T34가 채운다)
- 내놓는 contract: `templates/app/` 설치 템플릿(coding agent가 씀)
- slice: apps
- 선행: apps#T5, apps#T7, apps#T14, problems#T5, shell#T6, shell#T40
- 완료:
  - 템플릿으로 만든 앱에 진입 코드·blueprint·정확한 import map과 lock·DB 쓸 때만
    migration·생성 blueprint test·fixture·React 화면·coding agent 안내가 있고
    문제 보고·예외 수집·root AppErrorBoundary가 기본 연결(R33, R29)
  - 템플릿 앱이 en만으로 돌고 고정 문구 직접 삽입·빠진 en key·placeholder
    불일치가 build/test에서 실패, catalog 문구를 바꿔도 command·screen key
    불변(R41)
  - LOPHN_APP_TEMPLATE → 설치 templates/app → 내장 검증 템플릿 순서와 hash
    확인(R35)
  - 템플릿 업무 프로세스는 Deno, 화면은 React, lophn 화면과 같은 설치 Package를
    쓴다(R1), guide에 재사용 기준(실제 사용처 2개 이상, 앱 DB 구조·앱 전용
    prop은 앱에 남김)(R36)
  - 템플릿 앱이 T6 bundle 준비와 problems app test를 통과한다
- shell#T37에서 넘어온 것: 앱 entrypoint(`packages/apps/runtime/entrypoint/main.ts`의 `startRuntime`)가 `screenBytes`를 넘기지 않아 실제 앱 프로세스의 `GET /screens/<screen>/<path>`가 모두 404다. 템플릿 앱의 build된 화면 자원을 bundle에서 내주게 잇는다. shell main은 view를 `lophn-app://<app label>/<screen key>/index.html`로 열어 `/screens/<screen key>/index.html`을 그 screen의 진입으로 부르고, 자원은 같은 screen 아래 상대 경로로 부른다(다른 screen 경로는 shell이 막는다). content type은 text/html·text/css·text/javascript·application/json·wasm·이미지·글꼴만 받는다(`apps/shell/main/app-frame/app-protocol.ts`)
- shell#T41에서 넘어온 것: @lophn/ui-reading은 `@lophn/design/reading`도, @lophn/ui-action은 `@lophn/blueprint`(type만)도 import한다. 템플릿 화면 build의 import map·설치 묶음이 ui-reading·ui-filter·ui-stat·ui-action과 함께 이것을 풀어야 한다. 템플릿의 명령 버튼은 `CommandButton`에 blueprint command 선언을 그대로 주면 confirm 표시와 `lophnApp.call` 호출이 따라온다
- shell#T44에서 넘어온 것: 세션 앱 카드의 입력(AppCardReference `input`)을 앱의 card 화면에 넘길 통로가 없다. shell renderer registry(`workspace/visuals/registry.ts`)는 그 값을 그대로 들고 있고 card view는 screen·size·view_session만으로 열린다. AppScreenRequest(contracts)에 카드 입력을 더하고 SDK가 card 화면에서 읽게 하면, shell은 view 열기 IPC의 `card`에 입력을 실어 main이 화면 요청에 붙인다
- shell#T40에서 넘어온 것: @lophn/ui-control·ui-overlay·ui-layout·ui-state(ui-table·ui-chart도)는 `@lophn/design`·`@lophn/design/components`·`@lophn/wording`을 import한다. 설치(`install.ts`)는 packages/sdk/<name>만 묶으므로 템플릿 화면 build의 import map·설치 묶음이 이 셋을 함께 풀어야 한다. root 오류 경계는 `@lophn/ui-state`의 `AppErrorBoundary`로 화면 root를 감싸기만 하면 앱 preload가 `lophn:render-error`를 받아 넘긴다(따로 잇는 통로 없음)
- shell#T37에서 넘어온 것: 앱
  entrypoint(`packages/apps/runtime/entrypoint/main.ts`의 `startRuntime`)가
  `screenBytes`를 넘기지 않아 실제 앱 프로세스의
  `GET /screens/<screen>/<path>`가 모두 404다. 템플릿 앱의 build된 화면 자원을
  bundle에서 내주게 잇는다. shell main은 view를
  `lophn-app://<app label>/<screen key>/index.html`로 열어
  `/screens/<screen key>/index.html`을 그 screen의 진입으로 부르고, 자원은 같은
  screen 아래 상대 경로로 부른다(다른 screen 경로는 shell이 막는다). content
  type은 text/html·text/css·text/javascript·application/json·wasm·이미지·글꼴만
  받는다(`apps/shell/main/app-frame/app-protocol.ts`)
- shell#T40에서 넘어온 것:
  @lophn/ui-control·ui-overlay·ui-layout·ui-state(ui-table·ui-chart도)는
  `@lophn/design`·`@lophn/design/components`·`@lophn/wording`을 import한다.
  설치(`install.ts`)는 packages/sdk/<name>만 묶으므로 템플릿 화면 build의 import
  map·설치 묶음이 이 셋을 함께 풀어야 한다. root 오류 경계는 `@lophn/ui-state`의
  `AppErrorBoundary`로 화면 root를 감싸기만 하면 앱 preload가
  `lophn:render-error`를 받아 넘긴다(따로 잇는 통로 없음)
- 정한 것:
  - 템플릿 원본은 `packages/apps/sdk/template/app/`이고 파일 이름 끝의 `.tmpl`을
    설치와 앱 만들기가 뗀다(저장소 fmt·lint·check·test가 템플릿 소스를 앱으로
    읽지 않게). 고정 hash는 접미를 뗀 묶음의 sha256이고(`template/pin.ts`의
    `TEMPLATE_HASH`) 템플릿을 바꾸면 `template_test`가 새 값을 알려 준다. 선택
    순서는 override(hash는 사람의 선택이라 묻지 않고, 템플릿 모양이 아니면 다른
    후보로 넘어가지 않고 실패) → 설치 `templates/app`(고정 hash와 byte가 같을
    때만. 다르면 이유를 `skipped`에 남기고 다음) → 내장(고정 hash와 다르면
    실패)이다. 설치는 hash가 맞을 때만 하고 사본은 파일 0444·디렉터리
    0555다(`installTemplate`)
  - 설치 사본은 앱 bundle 안에서 저장소 없이 읽히므로 자기 완결이어야 한다.
    `@lophn/blueprint`(contracts/apps의 의존성 없는 blueprint 정본)와
    `@lophn/cap-problem`(contracts/problems/sdk-report와 그 type이 쓰는 base
    오류 type)은 사본 안 `vendor/`로 함께 담고 specifier를 사본 안 상대 경로로
    바꾼다(`vendor.ts`. 원본은 고치지 않고 바꾼 byte가 사본 hash다). 공용 UI
    Package가 import하는 `@lophn/design`·`@lophn/wording`은 catalog Package가
    아니라 지원 소스로 같은 `sdk/<name>/1.0.0/` 자리에 읽기 전용으로
    풀고(`installSupportPackage`, register_version 없음) 시험·다른 Package를
    뺀다. 설치와 bundle seal 모두 깊은 파일의 중간 폴더까지 0555로 좁힌다(전에는
    파일 바로 위 폴더만 좁혀 중간 폴더에 쓸 수 있었다. 같은 결함이라 `seal.ts`도
    고쳤고 `verifyInstallPermissions`는 폴더 끝까지 본다)
  - 정확한 import map은 `buildImportMap`이 만든다. 앱이 고르는
    Package(`TEMPLATE_ROOTS`)에서 시작해 사본의 공개 export에서 상대 import를
    따라 닿는 소스만 읽고, `@lophn/*`와 npm import를 끝까지 따라
    `lophn-sdk:<name>@<version>/<경로>`와 정확한 `npm:`·`jsr:` pin만 담는다.
    사본 밖으로 나가거나 없는 파일을 가리키는 상대 import, 정확한 pin이 없는
    bare import, 같은 이름의 다른 pin은 map을 만들지 않고 실패한다. 템플릿
    deno.json은 이 결과(와 `@lophn/app`·시험 도구 pin)와 같고 시험이 본다.
    `@lophn/design`·`@lophn/wording`도 blueprint `sdk_dependencies`에 정확한
    pin으로 들어간다. 이 장치의 개발용 map(`.lophn/import-map.json`, ignore)은
    `lophn-sdk:` 값을 설치 사본 file URL로 바꾼 것(`devImportMap`)이고 앱의
    `deno task test·check·wording`이 `--import-map`으로 쓴다. lock은 템플릿의
    deno.lock이고 시험이 `--frozen-lockfile --cached-only`로 돈다.
    shell#T40·T41이 넘긴
    `@lophn/design`·`/components`·`/reading`·`@lophn/wording`과 type만 쓰는
    `@lophn/blueprint`는 packages/sdk에 소스가 있는 모든 R4 Package를 설치해
    같은 map이 푸는지 보는 시험이 덮고, 새 Package가 들어오면 그 시험이 함께
    덮는다
  - 앱 화면 문구: 앱은 자기 en catalog(`src/wording/en.ts`, key 첫 구간은 screen
    key 또는 common)와 생성한 `placeholders.ts`를 가진다. `@lophn/wording`에
    `createTranslator`(앱 catalog용 `t`, key 없음·placeholder 불일치는 compile
    error), `./generate` export(`render`), 검사 도구에 `screens` 선택과
    `placeholder-mismatch` 규칙(`t("key", {…})`의 값 이름이 문장의 placeholder와
    다름)을 additive하게 더했다. blueprint의 사람 문구(이름·설명·label)는
    catalog에서 가져오고 command·screen key는 문구와 별개의
    식별자다(`makeBlueprint(catalog)`)
  - 문제 보고: SDK `reportProblem`이 진입점이 설치한 reporter를 부르는
    port(`installProblemReporter`, 설치하지 않은 곳은 실패 값)를
    `@lophn/cap-problem`에 더했다. 진입점 `main()`이 observer module의
    `createProblemReporter`로 broker `problems/report` transport reporter를
    설치하고(`problemTransport`, 없는 대역은 건너뜀) invocation 문맥은 schedule
    port의 실제 문맥만 붙인다. 앱 command는 선언한 code literal로
    `reportProblem("…")`을 부른다. 처리되지 않은 예외 수집과 root
    `AppErrorBoundary`는 템플릿이 따로 잇지 않는다
  - 화면 자원: build 결과(`index.html`·`main.js`·`main.css`·글꼴)는 bundle의
    `screens/<screen key>/`에 있고 진입점이 `bundleScreenFiles(bundle 사본)`로
    내준다(shell#T37, content type은 shell이 받는 목록). release 준비는 JS 말고
    build가 만든 자원을 `PrepareReleaseInput.assets`로 받아 bundle에 담고,
    `FIXED_UI_DEPENDENCIES`에 `@lophn/design`·`@lophn/wording`을 더했다. 화면
    build는 앱의 `deno task build`(`scripts/build-ui.ts`, esbuild)다
  - 시험의 보증 범위: 만든 앱의 test(blueprint·업무·실패 경로·문구)와 type 검사,
    화면 build, `prepareRelease` bundle, 진입점의 화면 읽기, problems
    `generateAppTestChecks`의 runner
    검사(declarations·fixed_sdk·failure_path_coverage)와 source의 code 사용
    scan을 `apps/core/app-template_test.ts`가 한 흐름으로 본다. AppDriver로 도는
    harness 검사(probe·process_exception 등)는 problems#T12가 AppDriver를 낸
    뒤의 일이다
- apps#T22 → apps#T19로 넘김: 같은 절의 apps#T19 "apps#T22에서 넘어온 것" 참고

### T23 fixture: 할 일 앱

- 상태: 완료 (#389) — 이어보냄: 화면의 view_session 통로·템플릿 화면의 응답 모양 → T27
- 등급: frontend
- concern: apps/blueprint, apps/data, apps/agent-context, apps/connections,
  apps/permissions
- 요구: apps/blueprint#R2, R19, R21, apps/data#R3, R6, apps/agent-context#R1,
  R4, R5, apps/connections#R1, apps/permissions#R5
- 자리: fixtures/apps/todo/
- 쓰는 contract: @lophn/blueprint, cap-schedule, cap-store, cap-fs, cap-save,
  ui-*(shell)
- 내놓는 contract: 없음(E2E·problems tests가 쓰는 fixture)
- slice: apps
- 선행: apps#T22, apps#T15, apps#T16, shell#T34, shell#T40, shell#T41
- 완료:
  - 화면 full·panel, command: list_todos(read), add_todo·complete_todo(write,
    revert 지원), revert_todo, export_markdown·import_markdown(fs.read·fs.write
    grant, problems/tests#R18의 "파일 편집·변환"), add_to_calendar(캘린더 앱
    app.call)
  - DB schema 0→1→2 migration 두 release(change-app·restore-app-release
    시나리오용), 변경 → 되돌림 → 같은 상태 테스트
  - agent_context: 지금 고치는 할 일의 요약과 민감 칸(private_note), 힌트
    annotation target
  - 템플릿에서 시작해 T6·problems app test를 통과
  - apps#T22에서 넘어온 것: fixture는 `scaffoldApp`(`packages/apps/sdk`)과
    `packages/apps/sdk/testing/mod.ts`의 `installedHome`·`scaffoldInto`로
    템플릿에서 시작하고, `apps/core/app-template_test.ts`가 그 앱을
    test·build·T6 준비·problems 검사로 돌리는 틀이다. 템플릿 앱의 DB는 cap-store
    기본 `app.sqlite`, command handler는 `src/commands.ts`, 문구는
    `src/wording/en.ts`다
  - apps#T16에서 넘어온 것: 닫힌 view는 runtime이 막는다(`control/view-closed`,
    앱이 per-view 상태를 버릴 필요 없음). fixture의 `read`는 모르는 session에
    `undefined`를 돌려주기만 한다. 쓰기 handler가 되돌림 근거(`receipt`)를
    가지면 `{result, revert:{invocation, receipt, expected_revision}}` 조립이
    필요하다. 주석 쓰기 결과는 지금 `{revision, result}`이고 revert 조립은 앱
    command 공통이라 첫 사용처인 이 fixture에서 SDK에 더하고 lophn-agent#T48이
    읽는다

### T24 fixture: 캘린더 앱

- 상태: 완료 (#387) — 이어보냄: add_event의 되돌림 근거 조립 → T23, AppShell nav 없는 전체 폭 → shell#T40
- 등급: frontend
- concern: apps/blueprint, apps/automations, apps/permissions, apps/connections
- 요구: apps/blueprint#R5, R6, R20, apps/automations#R13, apps/permissions#R8,
  R14, apps/connections#R3
- 자리: fixtures/apps/calendar/, fixtures/apps/calendar/fake-external/(테스트용
  외부 캘린더 HTTP server)
- 쓰는 contract: @lophn/blueprint, cap-schedule, cap-store, cap-net, cap-secret,
  ui-*(shell)
- 내놓는 contract: 없음
- slice: apps
- 선행: apps#T22, apps#T14, apps#T20, shell#T40, shell#T41
- 완료:
  - command: list_events(read), add_event(write, revert 지원),
    sync_events(외부에서 가져와 저장, write), create_external_event(external,
    confirm=false), delete_all_events(write, confirm=true)
  - secret.use(외부 캘린더 token)·net.fetch(fake 외부 host·port) 선언,
    automation: on_start sync·interval sync(60000ms)·external 동기화(켜는 승인
    필요)
  - 다른 앱(할 일)과 agent가 쓰는 command, problems/tests#R18의 "외부 연동 효과"
  - 정한 것: 앱 원본은 `fixtures/apps/calendar/`에 `.tmpl` 접미로 두고(`fake-external/`만 일반 `.ts`), 시험(`apps/core/app-calendar-fixture_test.ts`)이 `readTemplateDirectory(stripSuffix)`로 temp 폴더에 풀어 commit한 뒤 T6 `prepareFromSource`로 준비한다. 앱 test가 network 권한이 없어 앱 안 tests는 fake의 메모리 `fetch`를 net 대역에 잇고, 실제 HTTP는 `serveFakeExternal`(선언한 127.0.0.1:38917)과 broker `net/fetch` 서비스 시험이 쓴다. net 요청에는 body가 없어 `create_external_event`는 query로 보낸다. 되돌림 command는 `revert_event`다. 만들기 요청의 5xx·전송 단절은 효과 모름(`CommandRejection`이 아닌 오류), 가져오기 실패와 4xx는 효과 없는 거절이다
  - T23으로 넘김: `add_event`는 결과로 일정(`id` 포함)만 돌려주고 `revert_event {id}`를 선언한다. `{result, revert:{invocation, receipt, expected_revision}}` 조립 helper를 SDK에 더하면(T23) 이 앱도 같은 helper로 바꾼다. T23이 `app.call`로 부를 command는 `add_event {title, starts_at(ISO 8601)}`다

### T25 fixture: rate limit 대시보드 앱

- 상태: 완료 (#398) — 남은 것: ui-filter 날짜 범위 popover의 카드 폭 잘림(shell), import map의 `@types` 지시문 따라가기(apps/sdk)
- 등급: frontend
- concern: apps/blueprint, apps/runtime, apps/invocations
- 요구: apps/blueprint#R19, apps/runtime#R31, apps/invocations#R14
- 자리: fixtures/apps/rate-limit-dashboard/
- 쓰는 contract: @lophn/blueprint, cap-schedule, cap-store, cap-fs,
  ui-chart·ui-stat·ui-filter·ui-state·ui-layout(shell)
- 내놓는 contract: 없음
- slice: apps
- 선행: apps#T22, shell#T34, shell#T40, shell#T41
- 완료:
  - 화면 full·panel·card(panel 320px·card 240px에서 가로 scroll 없음), 같은 앱의
    panel 두 개와 card 하나가 프로세스 하나
  - 집계 기간·시간대가 있는 read command, 미수집·부분 범위·신선도 부족을 정상
    0행과 구별(problems/tests#R18의 "집계 기간·시간대")
  - 정한 것: 앱 원본은 `fixtures/apps/rate-limit-dashboard/`에 `.tmpl` 접미로 두고 시험(`apps/core/app-rate-limit-dashboard-fixture_test.ts`)이 `readTemplateDirectory(stripSuffix)`로 풀어 T6 `prepareFromSource`로 준비한다. 수집은 외부 service가 아니라 fs.read 선언 폴더의 JSON 파일(`collect_usage {file}`, 원천 구간 `from`·`to`와 표본)이라 fake 서버가 없다. 읽기는 `usage_report {from, to, timezone, providers?, order?, limit?, continuation?}`이고 결과는 `{rows, coverage, freshness, continuation, period, collected_through, providers}`다(`coverage`는 구간 수집 합집합이 기간을 덮는 정도로 `complete`·`partial`·`uncollected`, `freshness`는 수집이 기간 끝 또는 지금보다 1시간 넘게 뒤처지면 `stale`, 수집이 없으면 `unknown`). 이어 읽기는 처음 조건(기간·시간대·provider)·정렬·데이터 기준(수집 id)이 바뀌면 `conflict`다. 되돌림이 필요한 write가 없어 `withRevert`는 쓰지 않는다. 화면 폭 검사는 실제 Electron을 화면 없이(show:false·offscreen) 띄워 잰다(Electron이 없는 곳은 건너뜀)
  - 남은 것(shell, ui-filter): `DateRangeFilter` popover가 카드 240px에서 오른쪽(직접 기간의 To·Apply)이 잘린다. 정한 기간 선택은 남지만 직접 기간은 못 쓴다
  - 남은 것(apps/sdk 준비): `buildImportMap`이 `// @ts-types="@types/d3-scale"` 지시문의 `@types/*`를 따라가지 못해 ui-chart를 쓰는 앱은 deno.json에 `@types/d3-scale`·`@types/d3-shape`를 손으로 더해야 type 검사가 선다

### T26 fixture: 일부러 깨지는 앱

- 상태: 완료 (#425)
- 등급: 기본
- concern: apps/runtime, apps/data
- 요구: apps/runtime#R2, R19, R22, R28, apps/data#R7, R11
- 자리: fixtures/apps/broken/
- 쓰는 contract: @lophn/blueprint, cap-schedule, cap-problem
- 내놓는 contract: 없음(problems slice의
  report-app-problem·app-broken·verify-app-repair가 쓴다)
- slice: apps
- 선행: apps#T22, problems#T5, shell#T40
- 완료:
  - runtime 쪽 깨짐(환경 값 없이 fixture 설정으로 고른다): 시작 crash, ready
    timeout, handler 불일치, V8 OOM, 반복 종료, migration 두 번째 단계 실패,
    틀린 집계를 정상 응답
  - problems 팀 시나리오 10종(problems#T12가 검증한다):
    1. 선언 code 2개(fixer coding_agent 하나, fixer user 하나). code마다 실제
       command에 fixture 실패를 주입하는 실패 경로 test 1개 이상
    2. command handler 안의 처리되지 않은 TypeError(앱 source frame 2~3개
       깊이)와, 같은 함수에서 줄·message만 다른 변형(같은 지문)
    3. 처리되지 않은 Promise rejection(process)
    4. view의 root render 오류(TSX, source map 포함), event handler error,
       view의 unhandledrejection. 깨진 view에서도 [문제 알리기]가 동작(버튼과
       보고 자리는 fixture가 심고, 누르는 것은 shell E2E 몫이다)
    5. 미선언 code를 reportProblem에 넘기는 command(_invalid_report)
    6. 앱 frame 없는 exception(의존 package 안에서 throw)
    7. 짧은 시간에 보고 25개를 내는 command(앱당 60초 20개 한도)
    8. 30줄 넘게 log를 남긴 뒤 실패하는 command, 응답 뒤 비동기로 실패하는
       command
    9. reproduction용 판 5개: A 깨짐, B 고침, C 약화(보고 경로 삭제 또는 기대
       낮춤), D 여전히 깨짐, E 다른 실패. 같은 고정 reproduction test를
       A→B/C/D/E에 적용할 수 있다
    10. 빈 DB에서는 되고 이전 판 schema에서는 실패하는 migration 판
  - 판마다 source commit이 따로 있어 T6 bundle 준비와 release 준비로
    이어진다(verify-app-repair에 쓴다)

### T27 apps slice flow E2E

- 상태: 진행 (#474, #489, #546, #547, #548) — 완료: restore-app-release. new-app은 등록·source 연결·bundle
  준비까지 e2e/flows/flow-new-app_test.ts를 썼으나 통과는 아직 확인하지 못했다(실행 대기열).
  새 결함: release.prepare를 부르는 finalizer가 제품 코드에 없어 new-app의 app test 통과
  이후(preview·적용·activation)는 돌 수 없다. #489 use-app-command: confirm 허락은 실행되고 거절은 다시 묻지 않는다. list의 성공한 일반 읽기는 invocation을 남기지 않는다(apps/invocations#R2, R18). 남은 것: new-app의 app test·preview·적용,
  change-app, run-app-automation, manage-app-permissions(#548: fs 접근 허락·거절·창 닫기·회수와
  새 nonce 재시작까지 돈다. 남은 것은 secret 단계 2·3·6(OS keychain 없음, SecretDelivery 미부착), command 허락 4,
  보호 범위·조합 경고 갈래), connect-apps,
  ask-app-hint. #546 ask-app-hint 1단계: 앱 패널 탭의 turn context(e2e/flows/ask-app-hint_test.ts).
  #547 ask-app-hint 2단계: `app.screen_context`·`app.annotate`를 `apps/agent-runtime/app-toolkit.ts`
  (`defineContext`·`contextBinding`·`contextHandlers`)와 `prepare.ts`의 tool 목록·binding·handler에 이었고,
  desktop renderer 진입의 `appViews.screens`(`coreAppScreens`)를 이어 앱 패널 열기 단추가 선다. 2단계(선언된
  read·주석 command만 tool)와 열기 단추 step이 e2e로 돈다. 3단계 이후(현재 화면 조회·redaction·주석 쓰기·revision
  충돌·탭을 닫은 뒤)는 제품 결함 하나가 막는다: agent·앱 화면 둘 다 자기 view_session을 알 길이 없다(turn context
  탭 줄에 없고 화면 page URL에 query가 없다). 잇는 길은 `ViewTab`(app_panel)에 view_session을 더하는 contract
  모양 변경이 필요해 lead 결정을 기다린다
- 등급: 기본
- concern: apps
- 요구: flow new-app(fixture 경로), change-app, restore-app-release,
  run-app-automation, manage-app-permissions, use-app-command, connect-apps,
  ask-app-hint가 가리키는 apps 요구
- 자리: E2E 자리(skeleton이 정한 곳)의 apps flow 시나리오, fixtures/apps/
- 쓰는 contract: shell E2E 도구(Playwright Electron), tools/fake-provider, 각
  팀의 apps slice 작업
- 내놓는 contract: 없음
- slice: apps
- 선행: apps#T1–T26, apps#T29, problems#T9–T11, documents#T31, shell#T37–T45,
  shell#T47, lophn-agent#T44(앱 command 자동 tool·앱 판정·SDK 안내 tool),
  lophn-agent#T47(lophn의 앱 일: 화면 context·힌트·앱 카드), lophn-agent#T48(앱
  revert), coding-agent#T18, coding-agent#T19, coding-agent#T20,
  coding-agent#T21
- lophn-agent#T44에서 넘어온 것: agent가 confirm=true 앱 command를 부르는 흐름의 마지막 구간. 판정은 approval 하나(동작이 `invocation.accept_confirm`, 접수 입력에 인증된 run·ToolCall caller와 live process nonce)를 만들고 사람이 허락한 뒤 진입까지 닫혔다. 허락된 approval을 `apply_approved_action`으로 접수하고 core가 서명한 proof를 agent caller에게 주는 길은 없다(proof 서명은 앱 쌍 `createPairConfirmer`에만 있다). 지금 handler는 proof 없이 direct call을 보내 앱이 거절하므로 사람 허락 없이 실행되는 일은 없지만 confirm command는 agent에서 끝까지 돌지 못한다. agent caller용 proof 발급 길과 handler의 proof 첨부를 닫고 flow use-app-command의 agent 단계로 확인한다.
- problems#T23에서 넘어온 것: report-app-problem flow는 운영 앱 자식의 실제 기동 entry(위 apps#T18 이어보냄)가 없어서, 준비한 fixture bundle에 실제 runtime entrypoint의 `main()`을 부르는 진입 파일(`entry.ts`)과 `@lophn/base` import map을 더해 다시 봉인한 bundle을 ledger에 심어 돌렸다(`withRuntimeEntry`). 그 우회는 지웠다. release 준비가 `lophn-entry.ts`를 만들어 manifest의 entrypoint로 삼는다(apps#T18 후속)
- 완료:
  - 위 8개 flow가 E2E로 돈다. new-app은 실제 coding agent 대신
    coding-agent#T20의 fake coding agent가 ticket을 claim하고, fixture 앱을
    템플릿 source로 등록 → bundle 준비 → app test → release 준비 → preview →
    activation까지 돈다. 기획·설계·App Engineer 단계는 coding-agent slice E2E가
    돈다. 실제 coding_agent credential(keychain·loader)은
    platform#T34(coding-agent slice)라, apps slice에서는 platform#T9의
    `apps/core/testing/` harness로 coding_agent credential을 만든다
  - 앞 slice flow의 앱 단계(project-workspace의 app-panel, build-context의 앱
    blueprint 조회, approve-action의 confirm·grant, view-agent-visuals의
    app-card)를 함께 돌린다(Q4)
  - 각 flow의 다른 갈래 중 앱 고장·연결 끊김·거절·사람이 그만둠을 하나 이상씩
    넣는다
  - 설치된 SDK catalog에 apps/sdk#R4의 이름 전부(@lophn/blueprint, tokens, ui-*
    10개, cap-* 7개, format-document)가 1.0.0으로 있다
  - coding-agent#T25에서 넘어온 것: new-app·change-app flow의 coding agent 자리는 `tools/fake-coding-agent`(`startFakeCodingAgent`)다. 지금 e2e/flows에 두 flow가 없어 쓰는 곳이 아직 없다. step에 `report`(release·summary·outputs·fix_records·verifications)가 있고 summary는 `lophn_ticket`이 upload_summary로 올린다. 결과의 `report_state`·`completion_seq`·`check_state`를 완료 주장·접수·확인으로 따로 읽는다. change-app도 같은 도구를 쓴다(위 완료 줄은 new-app만 적었다)
  - apps#T16에서 넘어온 것: ask-app-hint flow에서 탭을 닫은 뒤 agent의 context
    조회·주석 쓰기가 `unavailable`이고 옛 상태를 최신으로 내보내지 않는다(실제
    앱 view와 T23 fixture)
  - apps#T23에서 넘어온 것: (1) fixture의 `edit_todo`가 화면이 고치는 할 일을
    view_session과 함께 알리는데 화면은 자기 view_session을 지금 알 길이 없다
    (앱 화면 URL에 query가 안 간다). fixture 화면은 `?view_session=`을 읽고
    없으면 알리지 않는다. ask-app-hint E2E는 shell이 앱 화면에 view_session을
    주는 통로(shell#T39)를 정한 뒤 돈다. (2) 화면이 `lophnApp.call`로 받는 값은
    앱 응답 전체 `{result:{result,revert?},invocation?,mode}`다. fixture 화면은
    안쪽 result를 읽고, 템플릿 화면의 `result.rows`는 이 모양과 맞지 않으니
    템플릿(apps#T22)을 고칠 때 함께 본다
  - apps#T12에서 넘어온 것: agent 요청자의 confirm은 agent 요청 → 허락 →
    `apply_approved_action` → proof 서명(`CoreSigner.signConfirmProof`) → direct
    호출로 이어 E2E로 본다. agent의 asg id는 접수 입력 caller(run·tool_call)가
    아니라 approval requester에 있고 Invocation actor가
    된다(`invocations/confirm.ts`, 단위 시험은 `callerMatchesRequester`)
  - apps#T15에서 넘어온 것: connect-apps flow는 실제 core·supervisor·앱 자식
    둘로 A→B(허락 범위·거절·끊김·path·읽기만 거친 재귀 거절)를 E2E로 돈다. A→B
    confirm=true는 호출한 앱의 SDK `call`이 broker `apps/confirm/request`로
    approval을 요청 → confirmation window에서 사람이 결정 → poll이 적용·proof
    서명 → direct 호출로 이어진다(서비스 시험은 `connections/confirm_test.ts`).
    거절·만료·결정 지연(`confirmTimeoutMs`)도 한 갈래씩 본다
  - apps#T19에서 넘어온 것: (1) release.prepare를 부르는 쪽: new-app flow가 prepare_bundle 완료 → app
    test pass → release.prepare까지 가려면 supervisor(또는 core)가 같은 bundle hash의 통과한 app test를
    확인한 뒤 machine 자격으로 `release.prepare`를 불러야 한다. 입력은 봉인 사본의 `blueprint.json`·
    `manifest.json`, `migrations/` 단계 파일에서 낸 data_schema·data_changes, tests, prepare_bundle의
    ticket_source다. 지금 core에는 `prepare_bundle` 요청의 ticket_source를 기억하는 곳도(supervisor 진행은
    메모리) 부르는 쪽도 없다. (2) supervisor의 `SecretDelivery`·`RedactionGate`(broker secrets/use)는 platform
    secret 전송 부착(`secret.send` worker op)에 닿지 않아 허락된 요청이 unavailable로 닫힌다. 값은 keychain과
    전송 callback 메모리에만 있다. (3) `GrantApplier`(`permissions/broker/apply-grant.ts`)의 supervisor 쪽
    `AppProcesses`(stop·start)와 core `GrantRevoker` 조립: grant 확정·회수가 broker 연결을 막고 자식 종료를 확인한
    뒤 새 범위로 재시작하는 흐름(manage-app-permissions flow)
  - apps#T18에서 넘어온 것: (1) activation 실행은 core(`apps/core/apps-activation.ts`)가 `runActivation`·`recoverActivation`을 돌리고 단계는 supervisor op(`apps.activation_pause`·`prepare`·`open`·`resume`, `apps.data_job`)와 core 내부 machine command로 간다. 앱 자식의 실제 기동 entry는 아직 시험 자식(`runtime/testing/app-child.ts`)뿐이다: 템플릿 앱의 `main.ts`는 runtime entrypoint(`entrypoint/main.ts`)가 `@lophn/app`으로 불러 오는 모듈이고 사본의 import map·진입 파일이 그 entrypoint를 띄우도록 준비(release 준비)가 만들지 않는다. 실제 템플릿 앱이 운영 자식으로 뜨는 흐름(entry·`@lophn/base` 해석·read 허락)은 T27 new-app flow가 닫는다. (2) problems 보고: activation의 복원 실패·종료 미확인은 `app.record_unavailable`로 이유를 runtime 상태에 남기지만 problems의 보고(report)로는 가지 않는다(플랫폼이 낸 보고를 받는 경로가 없다). (3) grant 변경(create·revoke)이 새 flag로 자식을 다시 띄우는 흐름은 위 apps#T19의 (3)이다. 운영 DesiredApp은 App 행·active release·grant가 바뀌면 다시 알리지만 supervisor는 같은 release·bundle이면 기존 자식을 그대로 둔다.

### T29 @lophn/format-document

- 등급: 좁은
- concern: apps/sdk
- 요구: apps/sdk#R2, R4
- 자리: packages/sdk/format-document/
- 쓰는 contract: documents format 선언(내장 document format의 이름·MIME
  목록·template·guide·FormatRef의 정확한 module_hash, documents#T3·T4)
- 내놓는 contract: @lophn/format-document 1.0.0
- slice: apps
- 선행: apps#T5, documents#T3, documents#T4
- 완료:
  - Package는 kind=format 하나만 담고 catalog에 1.0.0으로 등록된다(R2, R4)
  - 이름·MIME 목록·template·guide·FormatRef만 담고 검사 코드는 넣지 않는다.
    검사는 격리된 `/v1/formats/validate`만 한다
  - FormatRef의 module_hash가 documents#T4의 `/v1/formats/get` 결과와 같다는
    테스트
  - pdf·image·data는 원문 format이라 Package를 만들지 않는다(documents 팀 추천,
    그 팀 질문 Q10에 올라가 있다)
- 상태: 완료 (#184)

### T30 앱 등록의 question option action 경로

- 등급: 좁은
- concern: apps/registration
- 요구: apps/registration#R3
- 자리: packages/apps/registration/ (commands.ts), packages/contracts/apps/ (contracts 변경은 contracts 팀 작업으로 먼저), apps/core/apps.ts
- 쓰는 contract: lophn-agent/questions의 option action(OPTION_ACTION_OWNERS, 값 type은 contracts/lophn-agent)
- 내놓는 contract: `app.create`의 미리 배정한 app ID 입력과 option 적용 경로(contracts 변경 필요)
- slice: apps
- 상태: 완료 (#374)
- 선행: apps#T1, lophn-agent#T29, platform#T58
- lophn-agent#T29에서 넘어온 것: option action의 생성 대상은 미리 배정한 ID여야 하는데 `app.create`는 ID를 만들어 돌려주고 dispatchable이 아니며 user·coding_agent만 받는다. lophn 제안의 새 앱 등록 선택지(questions#R13)는 이 경로가 있어야 열린다. 열면 `packages/lophn-agent/questions/option-actions.ts`의 `OPTION_ACTION_OWNERS`에 한 줄을 더하고 core 조립이 같은 handler를 묶는다.
- 완료:
  - 사람이 고른 질문 선택지로만 machine이 앱을 한 번 등록한다. 자유 답·낡은 기준은 등록하지 않고 같은 선택지의 두 번째는 conflict다
  - `registration_test.ts`에 위 요구 테스트

## slice: operations

### T28 앱 export

- 등급: 기본
- concern: apps/data
- 요구: apps/data#R13
- 자리: packages/apps/data/worker/export.ts, packages/apps/data/reads.ts,
  apps/core/apps.ts
- 쓰는 contract: platform blob(export 묶음), platform file route(사람이 고른
  자리에 파일로 받기, platform#T12)
- 내놓는 contract: `/v1/apps/export`(준비 중·완성·실패 구별) (contracts#T20)
- slice: operations
- 선행: apps#T17, apps#T19, platform#T12, platform#T13
- shell#T43에서 넘어온 것: core에 `worker:apps/export`가 서면 app-detail Data 탭에 [Export]를 붙인다. 지금은 route가 core에 없어 탭이 "아직 내보낼 수 없다"만 보인다. shell main의 renderer allowlist(`main/desktop/core/allowlist.ts`의 `READING_WORKER_ROUTES`)에 이 worker route를 더하는 일도 그때 한다
- 상태: 완료 (#424)
- 완료:
  - export 안에 고정 blueprint·release 이력·각 불변 bundle·정확한 SDK byte·WAL
    확정 내용을 포함한 무결성 확인 DB 사본이 있고 secret 원값·credential이
    없으며 앱 외부 자료 포함 여부가 명시된다(R13)
  - flow backup-and-restore의 앱 export 단계 E2E(operations slice)

## 다른 팀과 주고받는 것

| 팀           | apps가 받는 것                                                                                                                                                                                                                                                                                               | apps가 주는 것                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| contracts    | contracts#T20(앱 등록·실행, documents slice), T33(blueprint·scope·agent-context 값, 정본 검증기), T34(앱 통로), T35(invocation 전달), T36(release·data worker job), T37(grant·package·preview), T14(이름 예약 port), T41(ticket claim port), T26(AgentAppScope), T32(test 실행·problem code), T39(문제 보고) | C-apps-1–7 목록과 모양                                                                                                                                                                      |
| platform     | core 조립, 신뢰 child 띄우기, command·read·event·blob·인증·approval·secret·redaction·notification·diagnostics                                                                                                                                                                                                | approval apply owner command(grant.create·revoke, release.start_activation, app.create, automation 켜기), invocation 전달                                                                   |
| documents    | place_names 예약 Tx 함수, 앱 문서 저장(place=app, name=key), format 실행, format Package 이름                                                                                                                                                                                                                | AppCreated, 앱 place                                                                                                                                                                        |
| problems     | 문제 보고, test 실행과 Verification read, problem code 검사, @lophn/cap-problem과 exception observer                                                                                                                                                                                                         | bundle 사본(T6), apps.logs(T9), invocations.get(T11), data worker job(T17), apps.blueprint·releases read(T19), ReleaseActivated(T18), test mode 진입점과 대역(T7, T21), fixture 앱(T23–T26) |
| shell        | ui-*·tokens(shell#T34 agent slice, T40·T41 apps slice), wording 검사 도구(shell#T6), app-frame Node client(T37), 앱 preload(T38), app-detail(T43), 패널 탭·앱 카드(T44), confirmation window 앱 결정 4종(T45)                                                                                                | 앱 통로(T7, T10), 결정 표시 read(T4, T19, T20), 적용 command(T4, T12, T18)                                                                                                                  |
| lophn-agent  | AgentAppScope(agent credential conditions), app tool 생성                                                                                                                                                                                                                                                    | apps read(T1, T9, T11, T19), connect(T10), agent-context SDK(T16), accept_confirm(T12), revert 계약(T2, T7)                                                                                 |
| coding-agent | ticket claim 검사 Tx 함수, MCP op 대응                                                                                                                                                                                                                                                                       | 앱 RPC(T1, T5, T9, T11, T19, T21), 템플릿(T22)                                                                                                                                              |

## 요구 덮기

| concern            | 요구 수 | 덮은 수 | 작업                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps/registration  | 10      | 10      | T1(R1–R10), T9(R8)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| apps/blueprint     | 22      | 22      | T2(R1, R4–R7, R10, R11, R15, R16, R18–R22), T3(R9), T6(R17), T7(R8, R12), T13(R13), T19(R2, R3), T20(R14)                                                                                                                                                                                                                                                                                                                             |
| apps/releases      | 19      | 19      | T6(R1–R4, R19), T11(R17), T18(R8, R12–R16), T19(R5–R7, R9–R11, R18)                                                                                                                                                                                                                                                                                                                                                                   |
| apps/runtime       | 32      | 32      | T7(R3, R5, R8, R10–R12, R22, R31), T8(R1, R2, R4, R6, R7, R16–R21, R23, R24), T9(R13–R15, R25–R29), T10(R9, R32), T15(R30)                                                                                                                                                                                                                                                                                                            |
| apps/permissions   | 29      | 29      | T3(R5–R12, R18, R19, R25), T4(R1–R3, R24, R26, R27), T10(R28), T13(R4, R13–R17, R20–R23, R29)                                                                                                                                                                                                                                                                                                                                         |
| apps/connections   | 7       | 7       | T15(R1–R7)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| apps/agent-context | 6       | 6       | T16(R1–R6)                                                                                                                                                                                                                                                                                                                                                                                                                            |
| apps/automations   | 13      | 13      | T20(R1–R13), T4(R13의 켜기 grant)                                                                                                                                                                                                                                                                                                                                                                                                     |
| apps/invocations   | 19      | 19      | T7(R4, R14), T11(R3, R6, R9, R10, R13, R15–R17), T12(R1, R2, R5, R7, R8, R11, R12, R18, R19)                                                                                                                                                                                                                                                                                                                                          |
| apps/data          | 14      | 14      | T17(R1–R3, R5–R8, R10, R14), T18(R4, R9, R11, R12), T28(R13)                                                                                                                                                                                                                                                                                                                                                                          |
| apps/preview       | 10      | 10      | T21(R1–R10)                                                                                                                                                                                                                                                                                                                                                                                                                           |
| apps/sdk           | 41      | 41      | apps 작업 31개: T2(R5), T5(R2–R4, R6, R8, R9, R11–R13), T6(R7, R10, R34), T7(R27, R28), T14(R22–R26, R30–R32), T15(R40), T16(R39), T22(R1, R29, R33, R35, R36, R41). shell 작업 10개: shell#T34(R16 ui-table, R17, R20, R38), shell#T40(R14, R15, R18 ui-state, R21, R37), shell#T41(R16 ui-reading, R18 filter·stat, R19). R4의 tokens·ui-* 부분은 shell#T34·T40·T41, R29 component와 R41 공용 UI 부분은 shell#T40·T41이 함께 덮는다 |
| 합계               | 222     | 222     |                                                                                                                                                                                                                                                                                                                                                                                                                                       |

작업 수는 29개다. slice별로 documents 1(T1), apps 27(T2–T27, T29), operations
1(T28)이다.

## 질문

모두 정했다(lead 답, 2026-10-04). 기록으로 남긴다.

- **Q1 external automation 켜기 승인의 저장 자리.** 정했다: Grant kind
  `automation.run`(scope `{automation, command, input_hash, when}`)을 더한다.
  켜기는 approval로 grant.create, 끄기는 grant.revoke다. 앱 clock은 회차마다
  broker try_acquire에서 active grant를 확인하므로 프로세스를 재시작하지 않는다.
  external이 아닌 automation은 앱 실행 허용을 따른다.
  apps/permissions·apps/automations domain model은 T4·T20 PR에서 고치고,
  contracts#T37에 kind를 더한다.
- **Q2 blueprint schema의 정본 자리.** 정했다: import 없는 순수 TS 검증기 하나를
  packages/contracts/apps/blueprint.ts에 두고 @lophn/blueprint가 다시 내보낸다.
  앱이 import하는 검증기는 의존성 없는 순수 TS로 둔다는 예외가
  docs/dev/stack.md에 들어간다.
- **Q3 @lophn/cap-problem 코드 자리.** 정했다: problems#T5가
  packages/sdk/cap-problem/에 쓴다. apps는 catalog 등록(T5)·진입점 연결(T7)·공개
  API 검사(T14)를 맡는다.
- **Q4 앞 slice flow의 앱 단계.** 정했다: organize-documents의 앱 보관 단계는
  T1(documents slice)에서 돈다. 나머지 앱 단계(project-workspace, build-context,
  approve-action, view-agent-visuals)는 T27에서 돈다.
- **Q5 AppConnection 서명·기한·회수.** 정했다(platform Q15): 앱 direct 연결과
  confirm proof는 apps가 서명하는 진술이다. platform은 credential_ref·기한·core
  epoch만 준다. 서명은 core 안 apps 제어 어댑터가 core 시작마다 만드는 Ed25519
  key로 하고, 공개 key는 앱 초기 JSON에 넣는다. AppConnection 기한은 원래
  credential 이하·최대 10분, proof는 120초다. 회수는 소유 event와 core epoch로
  판단해 관련 통로를 닫고 새 nonce로 재시작한다.
- **Q6 format SDK Package.** 정했다(documents Q10): @lophn/format-document
  하나다(T29).
- **Q7 test mode 진입점.** 정했다: problems test runner는 같은 진입점과 같은 두
  socket HTTP protocol을 쓰고, runner가 broker와 caller 역할을 한다.
  domain-model/apps/runtime의 mode에 test를 더한다. 시작
  입력·AppConnection·broker child의 mode는 `live`·`preview`·`test`이고,
  `POST /v1/apps/connect`와 RuntimeObservation·화면 틀은 live·preview만 받는다.
- **Q8 core 조립 자리.** 정했다: apps는 `apps/core/apps.ts`와
  `apps/worker/apps/`만 고친다.
- **Q9 apps slice 시작 시점.** 정했다: 선행이 모두 main에 합쳐진 작업은 slice와
  상관없이 시작한다(docs/dev/team-brief.md).
- **Q10 apps slice에서의 ticket claim.** 정했다: coding-agent#T18·T19·T20과
  contracts#T41이 apps slice에 있다. T19와 T27이 그것을 쓴다.
- **Q11 ui-chart 지원 종류.** lophn-agent/visuals#R1(산점 차트, node·edge
  도표)과 apps/sdk#R17(산점도는 첫 판 밖)이 부딪쳤다. shell·lophn-agent 팀과
  맞춰 apps/sdk#R17과 domain-model/apps/sdk의 SharedVisualInput에 산점 차트와
  node·edge 도표를 더했다(누적 면만 첫 판 밖). 구현은 shell#T34다.

- **Q12 폴더 direct grant를 broker로 옮길지.** T3는 하위 포함 폴더의 직접
  grant를 허용하고, grant 때 폴더 밖을 가리키는 lexical link만
  `--deny-read`/`--deny-write`로 넣는다. 다른 프로세스가 grant 계산 뒤 link를
  심는 것은 `permissions.limit.symlink-changes`로 공개한다. broker cap-fs(T13)가
  생기면 폴더 direct grant를 broker로 옮길지 정한다. 추천안: 옮긴다. broker가
  실제 경로를 매번 확인하면 그 TOCTOU 한계가 사라진다. 결정은 T13에서 한다.

- **Q13 grants.list의 표시 자료 field(해결, T4).** contracts#T37의 `grants.list`
  출력은 `Grant[]`와 read 공통 field뿐이라 요구·reason·조합 경고·Deno 한계 문구
  key를 실을 자리가 없다. 정했다(lead): additive 표시 field를 더한다.
  grants.list 출력에 `display`(요구별
  `kind·scope·reason·granted·warnings·outside_links`, `combination_warnings`,
  `limit_keys`)를 더했고 `permissions/display.ts`의 `buildGrantDisplay`가
  채운다. 앱을 지정하고 현재 release 선언을 알 때만 있고 그 밖에는 null이다.
  read는 파일 I/O를 하지 않아 `outside_links`는 빈 목록이며 폴더 밖 link 검사는
  부여 준비(T3 `resolveRequirement`)가 한다.
- **Q14 점이 든 route 이름과 approval·confirmation(해결, T4·platform#T32).**
  apps route 이름은 `grant.create`처럼 점으로 나뉘는데 `approvals`의
  action.command 정규식과 confirmation handle의 decision 이름 정규식이 점을
  거절해 apply·확인 창이 apps command를 쓸 수 없었다. approval의 command
  정규식은 platform#T32(#300)가 같은 문법으로 풀었고, T4는 confirmation handle의
  decision 이름 정규식(`confirmation-handle.ts`)에 점으로 나뉜 마디를 허용하고
  테스트를 더했다.
- **Q15 현재 release 선언 port(이어보냄, T4).** grant.create의
  app.call·agent.commands·automation.run 선언 비교는 `currentDeclarations`
  port(`permissions/declarations.ts`)로 현재 선언을 읽는다. `get(sql, app)`이라
  tx port와 reader port가 같은 구현을 쓴다. 구현은 releases(T18·T19)가 같은
  key로 등록한다(T18·T19에 이어받음으로 적었다). 등록이 없는 core에서는 이 세
  kind의 grant.create가 `unavailable`이다(선언을 모른 채 만들지 않는다). 시험은
  `permissions/testing/mod.ts`의 시험 team이 같은 port·activation event를 낸다.
  activation 진행 판정은 ReleaseActivationStarted와 그 seq를 started_seq로
  가리키는 Activated·Failed event로 하므로 release 표 없이 동작한다.
- **Q16 doctor 관측 교체(이어보냄 platform#T48, T4).** platform#T47이 넘긴
  "doctor 보안 진단을 관측 파일 대신 grant 위험 read와 SDK hash로 교체"는 하지
  않았다. grant 위험 read의 contract가 없고, `last_used_at`의 근거(broker가
  실제로 쓴 시각, check/platform#Q21)가 T13 전이라 없으며, doctor를 core에
  연결하는 일은 platform#T48이다. 추천안: T13이 grant 사용 시각을 남긴 뒤
  contracts에 grant 위험 read(`app·kind·file·network·broad·last_used_at`)를
  더하고 doctor worker를 그 read로 바꾼다.

- **Q17 confirm proof의 서명 검증(해결, T12).** `invocation.accept_confirm`은
  접수와 proof payload를 낸다(`CONFIRM_PROOF_LIFETIME_MS` 120초, 같은 접수의
  재전송은 접수 시각 기준이라 수명이 늘지 않는다). direct 호출의 `proof`가 서명
  없는 payload라 연결을 가진 호출자가 proof를 지어낼 수 있었다. lead가 contract
  변경을 승인해 `contracts/apps/direct-socket.ts`의 `proof`를
  `signedConfirmProofInputSchema`(`{payload, signature}`)로 바꿨다. core는
  시작마다 만든 Ed25519 key(`runtime/signing.ts`의 `createCoreSigner`)로 proof를
  서명하고, 앱 entrypoint의 `verifyProof`가 서명을 가장 먼저 확인한 뒤
  nonce·release·command·input_hash·caller·기한(120초)을 비교한다. 위조·다른
  key·바뀐 payload는 401, 다른 입력에 옮긴 proof는 409, 만료는
  401이다(`confirm_test.ts`가 실제 core와 실제 direct socket으로 본다).
- **Q18 거절 행(해결, T12).** domain-model의 전이표는
  `없음 / accepted → denied`인데 T11 구현은 absent를 conflict로 막아 접수 없이
  거절된 알려진 호출(선언된 command를 인증된 연결로 불렀다가 handler 전에
  거절)을 남길 길이 없었다(apps/invocations#R2는 거절된 읽기를 남기라 한다).
  `record_denied`가 absent에서 거절 행(`denied`, started_at·approval·입력 지문
  없음)을 만들게 고치고 T11의 absent 시험(`model_test.ts`, `reads_test.ts`)을
  같은 PR에서 바꿨다. `record_finished`가 absent를 거절하는 것(모르는 호출을
  만들지 않음, R10)은 그대로다.
- **Q19 접수된 confirm의 start(해결, T12).** `record_started`가 accepted 행에는
  started_at 불일치로 conflict였고 running으로 옮기지 못했다. 접수가 고정한
  대상·주체·호출자가 같으면 관측한 시작 시각으로 같은 행을 running으로
  옮긴다(접수 시각으로 채우지 않는다, R9).
- **Q20 재시작 뒤 접수·실행 중 행의 확정(해결, T12).** 새 route를 더하지 않고
  기존 machine command `invocation.record_finished`(status `unknown`)를 쓴다.
  core 기동이 `machine:invocation-recovery`(token 없는 내부 자격,
  `FIXED_CREDENTIALS`에 더함)로 `invocations.list`의 accepted·running 행을 읽어
  같은 key(`interrupted:<inv>`)로 확정하고, 요약에 `reason: core_restarted`와
  재시작 점검 관측의 근거(`observeInvocations`와 같은 `interruptedEvidence`)를
  남긴다. 접수만 있던 행은 started_at 없이, 실행 중이던 행은 있던 started_at
  그대로 unknown이다. 이전 core의 앱 프로세스는 이미 없고 새 프로세스는 새
  nonce라 옛 접수·시작은 이어지지 않는다. 시험은
  `invocations/restart_test.ts`(같은 홈으로 재시작을 두 번)다.
- **Q21 AppConnectOutput에 서명이 없다(정함, T10).** contracts#T34의
  `appConnectOutputSchema`는 `{endpoint, connection}`뿐이라 앱 direct 요청의
  Authorization(`{payload, signature}`)에 필요한 서명을 실을 자리가 없었다.
  lead가 승인해 `appConnectOutputSchema`에 `signature`(raw 64byte Ed25519의
  base64url)를 더했고 `createAppChannelClient.connect`와 Deno client가 그대로
  읽는다.
- **Q22 apps.logs의 machine 접근(정함, T10).** problems report collector는
  machine actor인데 `apps.logs`의 actor 목록에 machine이 없었다. lead가 좁게
  승인했다: `apps.logs`의 actor에 machine을 더하고, read handler가 machine은
  credential scope의 대상 app이 요청한 app과 같고 operation `app.logs`가 scope에
  있을 때만 열어 준다(그 밖은 없는 앱과 같은 응답). registry 상한에 machine의
  `app.logs`를 더했다.
- **Q23 회수 통로를 event 대신 credential 상태로(해결, T10).** Q5의 소유
  event(GrantRevoked, assignment 멈춤, CodingAgentConnectionRevoked, run 종료)를
  core 안 구독으로 받으려면 각 owner가 apps 구독자에게 event 공개 정책을 내야
  한다. 그런데 run 종료·assignment 멈춤·connection 회수는 모두 platform
  registry의 credential 종료(`endBy`·`revoke`)로 끝나고, GrantRevoked는 grants를
  다시 읽으면 보인다. 그래서 connector가 발급한 connection의 credential_ref를
  `revalidate`하고 agent connection의 command가 아직 active agent.commands grant
  안인지 grants를 다시 읽는다(기본 1초). 닫힌 것은 그 프로세스의 정지 확인 뒤 새
  nonce 재시작이다. 사람 화면 connection도 같은 규칙이라 사람 credential이
  닫히면 앱이 한 번 다시 뜬다. 비용: agent run이 끝날 때마다 그 run이 최근 10분
  안에 연결한 앱이 정지 유예(Q25; 진행 호출이 없으면 바로 끝난다)를 거쳐 다시
  뜬다. 정했다: 유지한다(Q5의 "run 종료로 통로를 닫는다"를 그대로 지킨다). 다만
  run 종료마다 앱을 다시 띄우는 비용이 크면 앱 entrypoint에 특정
  credential_ref의 connection만 거절하는 제어 경로(`control/revoke`,
  contracts#T34 후속)를 두어 재시작 없이 닫는 쪽이 낫다. owner event 구독으로
  바꾸면 지연이 줄지만 owner마다 공개 정책이 필요하다.
- **Q24 platform 조립 파일의 추가(T10).**
  `apps/core/core.ts`·`registration.ts`·`credentials.ts`·`test-credentials.ts`·`testing/core.ts`에
  apps 조립이 들어갔다: team 등록의 `memoryRoutes`(handler는 core 조립이
  붙인다), registry 상한에 apps operation 정책(`appsOperationPolicies`),
  `appSupervisor` 기동 옵션(제품 main만 true)과 `core.reconcileApp`, platform
  status의 `apps` 구성 요소, `machine:apps-control`의 고정 credential 등록, 시험
  credential의 `revalidate`와 기한. 추천안: platform 팀이 위 조립을 review해
  자기 파일의 모양으로 정리한다.
- **Q25 앱 entrypoint의 shutdown 종료(정함, T10).** `control/shutdown`이 새
  호출·clock만 닫고 프로세스를 끝내지 않아 멈춤·release 교체·회수 재시작이 항상
  10초 유예를 기다렸다. lead가 승인해 entrypoint가 shutdown을 받으면 새 호출을
  닫은 채 진행 호출이 끝나는 대로(유예 `grace_ms` 안에서) `Deno.exit(0)`한다.
  유예가 지나도 끝나지 않으면 supervisor의 강제 종료가 이어진다(R15). Q23의
  재시작 비용은 이로써 받아들일 수 있다.
- **Q26 T3·T8·T9 조립의 실제 동작 오류(해결, T10).** 실제 프로세스로 처음 이어
  보며 고쳤다. (1) `appFlags`가 socket 듣기·연결에 필요한
  `--allow-net=unix:<경로>`와 가상 host `lophn.invalid` 허락을 만들지 않아 앱이
  시작하지 못했다(Deno 2.9.7은 읽기·쓰기 허락만으로는 unix listen이
  NotCapable이다). (2) `--deny-net`의 `::1:<port>`는 Deno가 빈 host로 읽어
  프로세스가 시작하지 않는다. `[::1]:<port>`로 고쳤다. (3) supervisor가 자식에게
  자신의 machine credential을 넘기고 있었다. 자식마다 `app_credential_request`로
  core가 발급한 app credential을 쓴다. (4) supervisor main이 platform
  hello·ready·worker_request가 아닌 자체 hello를 기다려 감독 pipe가 ready에 닿지
  못했고, record 호출에 `compare`가 없어 400이었으며, 응답 모양(`output` 감쌈)을
  잘못 읽어 `record_stopped`가 남지 않았다. (5) 같은 앱의 두 socket 경로를 허락
  목록에 넣을 방법이 없어(Deno net 허락은 정확한 경로만) socket을 고정 자리
  64개로 바꿨다(architecture 2.2). (6) `apps/permissions/commands_test.ts`가
  #305 이후 approval 설명 글의 I/O worker 없이 14개 모두 실패해 `io: true`로
  고쳤다.
- **Q27 cap-fs는 Deno flag를 그대로 쓴다(정함, T14).** Q12의 "폴더 direct
  grant를 broker로 옮길지"는 옮기지 않는다. architecture 2.3이
  `fs.read`·`fs.write`를 대응 Deno flag로 강제한다고 정했고, T13의 broker
  서비스에도 파일 통로가 없다. cap-fs는 얇은 client라 Deno의 `NotCapable`을
  `forbidden`(permission `fs.read`·`fs.write`와 정확한 경로)으로 번역할 뿐이다.
  실제 자식의 flag로 허락 안·밖을 가르는 시험이 `cap-fs/fs_test.ts`다. Q12의
  TOCTOU 한계(`permissions.limit.symlink-changes`)는 그대로 공개한다.
- **Q28 앱 쌍 path와 부모 invocation(해결, T15).** `brokerAppsConnectInput`에는
  path를 실을 수 없었다. lead가 승인해 선택 field `incoming`(받은 연결의 부른
  앱·release·부모)을 더했다. 서비스는 자기가 발급한 origin 중 이 자식 프로세스가
  받은 것과 맞춰 path를 서비스 값으로 잇고(자식이 주장하는 path는 없다, 모르는
  출처는 invalid_input), 읽기만 거친 A→B→A도 준비 때 거절한다. `incoming`이
  없으면 broker가 본 start 사실로, 그것도 없으면 부모 없음·새 path다(기존 동작).
  한계: 자식이 `incoming`을 아예 보내지 않으면(SDK를 쓰지 않는 코드) 독립 호출로
  본다. SDK·entrypoint는 항상 싣는다.
- **Q29 `invocation.accept_confirm`을 apply 밖에서 부를 수 있다(발견, T15).**
  사람이 허락(grant)한 approval이 있으면 machine credential이
  `invocations/accept_confirm`을 직접 부르는 것만으로 접수와 proof가 나오고
  `approval_uses`는 남지 않으며(이후 `approvals/apply`는 conflict), 그
  approval이 한 번만 쓰인다는 보장이 깨진다(`connections/confirm_test.ts`가 먼저
  적용 여부를 확인하는 `ConfirmAcceptances.find`로 우회). 이 command는
  `dispatchable`로 apply 안에서만 불려야 한다. 추천안: platform ledger가
  dispatchable command의 직접 route 호출을 거절한다(apps/invocations 쪽
  handler는 apply가 준 문맥에서만 접수한다). lead가 별도 platform 수정(dispatch
  전용 command의 직접 호출 거절)으로 배정했다.
- **Q30 automation의 설계 선택(정함, T20).**
- **Q31 화면 context의 거절 코드와 host port(정함, T16).** (1) handler 예외는 모두 원문 없는 500이라 `invalid_input`·`conflict`·`unavailable`을 호출자에게 구별해 줄 길이 없었다. handler가 효과 전의 거절을 `CommandRejection`(심볼 `lophn.command-rejection`, 코드 4개)으로 던지면 entrypoint(`invoke.ts`)가 그 코드와 안내 문장으로 답하고 invocation 요약에 `error=<코드>`만 남기며 write도 `effects: unconfirmed`로 적지 않는다(효과 없음이 알려진 거절). 같은 접수의 재전송도 같은 거절이다. 다른 예외는 그대로 500이다. (2) 선언·민감 path·열린 view는 앱 코드가 넘기지 않고 runtime이 `startRuntime`에서 설치하는 host port(`lophn.screen-context`)가 release에 고정된 blueprint와 `state.views`에서 준다. 제거·요약 규칙(`agent-context/redaction.ts`)은 bundle의 플랫폼 진입 파일이라 앱이 바꾸지 못하고 host가 없으면 원문을 내보내지 않고 거절한다. SDK는 packages/apps를 import하지 않으므로 같은 symbol·모양을 맞춘다. (3) `sensitive_paths`는 AppScreenContext 값을 가리킨다(`/data/private_note`, `/summary`). 요약이나 남은 data에 제거한 문자열이 그대로 있으면(4자 이상) 그 자료를 보내지 않고 생략 사실만 남긴다. domain-model/apps/agent-context·sdk를 같은 PR에서 고쳤다. (4) 닫힌 view: runtime이 `closedViews`와 `control/view-closed`(contracts `controlViewClosedInputSchema`, machine 연결 전용)로 view session을 버려 앱 협조 없이 조회·주석이 unavailable이고 닫힌 session은 화면 요청으로 되살아나지 않는다(상한 1024). 보내는 쪽은 shell#T39에 넘겼다. (5) 시험 fixture: `startFixtureApp`·`world.start`가 다른 앱 자식 entry(`child`·`fixture`)를 받는다. (1) 입력 source: blueprint의 automation은 고정 입력뿐이라 R10의 "입력 source 없음" 사실은 따로 없다. 필요해지면 reason code를 더한다. (2) 놓친 회차의 판정: 도래한 배수가 검사 시각보다 `LATE_TOLERANCE_MS`(2000ms, 1초 검사 두 번) 넘게 지났으면 놓친 회차로 건너뛰고 다음 미래 배수부터 이어 간다(절전 복귀와 timer 지연을 한 규칙으로 본다). (3) on_start는 접수 결과와 상관없이 업무 통로가 열릴 때 한 번만 시도한다. permit 거절·한도 초과로 건너뛰어도 승인이 나중에 와도 그 프로세스에서는 다시 시도하지 않는다(재시작이 새 시작). (4) 시작하지 못한 이유(통로 닫힘·schema 불일치·진행 중·한도·승인 없음·놓침)는 invocation이 아니라 clock 메모리의 reason이고 `apps.automations`의 reason으로 보인다. 선언을 어긴 회차(confirm=true, 고정 입력 불일치)만 `deny` 사실로 남는다. (5) broker `try_acquire`는 승인 없음을 `forbidden`(필요한 `automation.run` scope를 details로), 한도·점유를 `permit:false`로 구별한다. contracts#T34의 출력 모양은 바꾸지 않았다.
- **Q30 automation의 설계 선택(정함, T20).** (1) 입력 source: blueprint의 automation은 고정 입력뿐이라 R10의 "입력 source 없음" 사실은 따로 없다. 필요해지면 reason code를 더한다. (2) 놓친 회차의 판정: 도래한 배수가 검사 시각보다 `LATE_TOLERANCE_MS`(2000ms, 1초 검사 두 번) 넘게 지났으면 놓친 회차로 건너뛰고 다음 미래 배수부터 이어 간다(절전 복귀와 timer 지연을 한 규칙으로 본다). (3) on_start는 접수 결과와 상관없이 업무 통로가 열릴 때 한 번만 시도한다. permit 거절·한도 초과로 건너뛰어도 승인이 나중에 와도 그 프로세스에서는 다시 시도하지 않는다(재시작이 새 시작). (4) 시작하지 못한 이유(통로 닫힘·schema 불일치·진행 중·한도·승인 없음·놓침)는 invocation이 아니라 clock 메모리의 reason이고 `apps.automations`의 reason으로 보인다. 선언을 어긴 회차(confirm=true, 고정 입력 불일치)만 `deny` 사실로 남는다. (5) broker `try_acquire`는 승인 없음을 `forbidden`(필요한 `automation.run` scope를 details로), 한도·점유를 `permit:false`로 구별한다. contracts#T34의 출력 모양은 바꾸지 않았다.
- **Q31 preview 시작 입력의 fixture(정함, T21).** `PreviewInput.fixture_hash`는 bundle manifest의 파일 중 그 hash의 byte다(domain-model apps/sdk의 files에 fixture가 있다). core가 byte를 확인해 새 preview 영역의 `app.sqlite`로 놓고(없으면 영역은 비어 있다) 운영 DB·backup·files는 어떤 경로로도 복사하지 않는다. bundle에 없는 hash는 invalid_input이다. 추천안으로 진행했다. fixture를 다른 형식(SQL 시드 등)으로 쓰려면 requirements를 정한 뒤 `PreviewBundle.fixture`만 바꾼다.
- **Q32 release 없는 preview의 통로(해결, T21).** `control/open`의 `release`와 `app_credential_request.release`가 null을 받지 못해 준비 전 bundle의 preview가 가짜 release 없이 열릴 길이 없었다. lead가 승인해 이 PR에서 두 schema를 nullable로 고쳤다(live 자식은 null이면 release 불일치로 거절, 발급기는 null이면 조건·대상에 release를 넣지 않고 registry는 live가 아니고 bundle hash가 있는 app 자격만 release 없이 받는다). preview 자식은 core가 발급한 app credential 없이 supervisor가 만든 일회용 broker 자격을 쓴다(core 발급 경로는 같은 앱 운영 자식의 credential을 끝낸다). preview 자식의 problems 보고 자격은 problems 팀이 정한다.
- **Q33 preview의 confirm command(정함, T21).** preview 자식은 confirm=true command를 proof가 있어도 실행하지 않고 forbidden으로 답한다(verify 단계, handler 전). 대역 확인을 사람에게 어떻게 보일지는 shell이 정한다(shell#T45).
- **Q31 화면 context의 거절 코드와 host port(정함, T16).** (1) handler 예외는
  모두 원문 없는 500이라 `invalid_input`·`conflict`·`unavailable`을 호출자에게
  구별해 줄 길이 없었다. handler가 효과 전의 거절을 `CommandRejection`(심볼
  `lophn.command-rejection`, 코드 4개)으로 던지면 entrypoint(`invoke.ts`)가 그
  코드와 안내 문장으로 답하고 invocation 요약에 `error=<코드>`만 남기며 write도
  `effects: unconfirmed`로 적지 않는다(효과 없음이 알려진 거절). 같은 접수의
  재전송도 같은 거절이다. 다른 예외는 그대로 500이다. (2) 선언·민감 path·열린
  view는 앱 코드가 넘기지 않고 runtime이 `startRuntime`에서 설치하는 host
  port(`lophn.screen-context`)가 release에 고정된 blueprint와 `state.views`에서
  준다. 제거·요약 규칙(`agent-context/redaction.ts`)은 bundle의 플랫폼 진입
  파일이라 앱이 바꾸지 못하고 host가 없으면 원문을 내보내지 않고 거절한다. SDK는
  packages/apps를 import하지 않으므로 같은 symbol·모양을 맞춘다. (3)
  `sensitive_paths`는 AppScreenContext 값을 가리킨다(`/data/private_note`,
  `/summary`). 요약이나 남은 data에 제거한 문자열이 그대로 있으면(4자 이상) 그
  자료를 보내지 않고 생략 사실만 남긴다. domain-model/apps/agent-context·sdk를
  같은 PR에서 고쳤다. (4) 닫힌 view: runtime이 `closedViews`와
  `control/view-closed`(contracts `controlViewClosedInputSchema`, machine 연결
  전용)로 view session을 버려 앱 협조 없이 조회·주석이 unavailable이고 닫힌
  session은 화면 요청으로 되살아나지 않는다(상한 1024). 보내는 쪽은 shell#T39에
  넘겼다. (5) 시험 fixture: `startFixtureApp`·`world.start`가 다른 앱 자식
  entry(`child`·`fixture`)를 받는다. (1) 입력 source: blueprint의 automation은
  고정 입력뿐이라 R10의 "입력 source 없음" 사실은 따로 없다. 필요해지면 reason
  code를 더한다. (2) 놓친 회차의 판정: 도래한 배수가 검사 시각보다
  `LATE_TOLERANCE_MS`(2000ms, 1초 검사 두 번) 넘게 지났으면 놓친 회차로 건너뛰고
  다음 미래 배수부터 이어 간다(절전 복귀와 timer 지연을 한 규칙으로 본다). (3)
  on_start는 접수 결과와 상관없이 업무 통로가 열릴 때 한 번만 시도한다. permit
  거절·한도 초과로 건너뛰어도 승인이 나중에 와도 그 프로세스에서는 다시 시도하지
  않는다(재시작이 새 시작). (4) 시작하지 못한 이유(통로 닫힘·schema 불일치·진행
  중·한도·승인 없음·놓침)는 invocation이 아니라 clock 메모리의 reason이고
  `apps.automations`의 reason으로 보인다. 선언을 어긴 회차(confirm=true, 고정
  입력 불일치)만 `deny` 사실로 남는다. (5) broker `try_acquire`는 승인 없음을
  `forbidden`(필요한 `automation.run` scope를 details로), 한도·점유를
  `permit:false`로 구별한다. contracts#T34의 출력 모양은 바꾸지 않았다.
