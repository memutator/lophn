# inventory 배정

inventory의 모든 줄을 단위에 배정한 표다. 줄 번호는 `I<절>#<순번>`(implementation-inventory)과 `U<절>#<순번>`(ui-inventory)이다. 순번은 그 절의 표에서 몇 번째 줄인지다.

- 처음 배정은 script가 했다. 줄에 적힌 코드 path를 `ownership.md`에 대 보고, path가 없으면 영역의 기본 단위로 보냈다.
- task brief는 자기 단위의 줄을 번호로 모두 인용한다. 다른 단위 몫이라고 보면 brief의 "넘길 줄"에 적고, 오케스트레이터가 옮긴다.
- "같이 닿음"은 그 줄의 path가 다른 단위의 소유에도 걸친다는 뜻이다. 두 단위의 brief가 서로 선행이나 넘길 일을 적는다.
- implementation-inventory 4장(UI)과 5장(만들지 않는 것), ui-inventory 4장(만들지 않는 UI)은 배정하지 않는다. 순서 제약(implementation-inventory 6장, ui-inventory 5장)은 lead가 DAG에 반영한다.

배정한 줄: 857개, 배정 못 한 줄: 0개.

## lead — 48줄

- `I6#1` `DocumentsChannel`(`core/projects/file-tracking/coordinator/serving.ts`)을 공용 위치로 옮기고 `Documents` 이름을 뗀다 (순서 제약)
- `I6#2` `createProductRedactor`(`outline-and-search/redactor.ts`)를 `packages/base/redaction/`으로 옮긴다 (순서 제약)
- `I6#3` MCP의 op→route 표(`cli/commands/app.ts`의 `APP_OP_ROUTES`, `problem.ts`의 `MCP_PROBLEM_ROUTES`)와 `mcp-decisions.ts`의 `decisionLink`를 CLI 쪽으로 옮긴다 (순서 제약)
- `I6#4` `events` 표를 상태 근거로 읽는 약 42개 파일을 각 concern의 표 읽기로 옮긴다 (순서 제약)
- `I6#5` internal subscription을 쓰던 구독자 여섯(`assignments/reactions.ts`, `tickets/checker/connection.ts`, `problems/grouping/connection.ts`, `problems/closing/connection.ts`, `file-tracking/coordinator/feed.ts`, `notifications/loop.ts`)의 대체 (순서 제약)
- `I6#6` renderer가 쓸 event client와 Gateway(조건 구독, snapshot) (순서 제약)
- `I6#7` notifications 모듈과 OS notification 삭제 (순서 제약)
- `I6#8` 시도 id를 새로 만든다 (순서 제약)
- `I6#9` shell main `refreshAppViews`의 대체 신호 (순서 제약)
- `I6#10` 대화 기록을 session 기록에 쓰는 길 (순서 제약)
- `I6#11` Reactor와 `ApprovalDecided` handler(02), `TicketVerified` activation handler(07) (순서 제약)
- `I6#12` `ticket.verify`와 `TicketVerified` 기록(06) (순서 제약)
- `I6#13` `problems.work`·`problems.closing` 반응기 삭제 (순서 제약)
- `I6#14` Router(`agent_calls`)와 `AcceptRun` 새 입구(03) (순서 제약)
- `I6#15` `core/apps/tickets/ports.ts`가 `tools/handoff`에서 import하는 `adoptionOf` 의존을 끊는다 (순서 제약)
- `I6#16` agent grant와 reaction grant(02) (순서 제약)
- `I6#17` file·shell·web tool, `file.*` 대신할 `outline.get`·`pdf.read`·`image.read`(04) (순서 제약)
- `I6#18` agent runtime child의 Deno 권한 결정(file·shell·web을 child가 하는지 core가 하는지) (순서 제약)
- `I6#19` 새 ask tool과 `QuestionAsked`·`QuestionResolved`, 새 대기 목록 (순서 제약)
- `I6#20` 새 대기 목록(02)과 event client·store 층(01) (순서 제약)
- `I6#21` secret 보호 입력(`kinds/secret-input`)을 창 없이 분리하고, `confirmation: "required"`를 쓰는 12개 route의 확인 handle을 정리한다 (순서 제약)
- `I6#22` 새 core 호출 경로 서비스(05) (순서 제약)
- `I6#23` 앱 화면 byte(`/screens`)를 내주는 길을 정한다 (순서 제약)
- `I6#24` 앱 rewind(changeset 뒤집기, rewind 실행)와 session rewind의 앱 선택 (순서 제약)
- `I6#25` blueprint 칸(`confirm`, `revert`, `automatic_tasks`, `documents`, `agent_context`, `problem_codes`) 삭제는 소비자와 같이 한다 (순서 제약)
- `I6#26` agent-context 삭제와 함께 `tools/visuals/work.ts`(245·287줄)의 `app.screen_context` 사용 정리 (순서 제약)
- `I6#27` problem code 선언 체계 삭제는 보고의 `code`, SDK `cap-problem`, 앱 broker의 선언 guard, template의 failure path test와 같이 한다 (순서 제약)
- `I6#28` `formats/model.ts`의 `formatForMediaType`(123~140행)을 열기 가능한 형식 판별로 옮긴다 (순서 제약)
- `I6#29` `registry/rules.ts`의 `.gitignore` 일치(`gitignoreExcludes`, `ignore` 의존)를 새 키워드 검색으로 옮긴다 (순서 제약)
- `I6#30` `core/projects/versions/guides.ts`(설치 manifest reader)를 다른 곳으로 옮긴다 (순서 제약)
- `I6#31` `core/apps/tickets/summary-upload.ts`, `core/problems/repairs/fix-summary-upload.ts`가 `file-tracking/routes/upload.ts`에서 가져오는 `exactBytes`를 정리한다 (순서 제약)
- `I6#32` `redactScreen`을 쓰는 notifications와 problems snapshots의 화면 증거를 먼저 지운다 (순서 제약)
- `I6#33` blob GC의 `backup.pending` 연결(`core/storage/blobs/gc.ts`의 `backupPendingFolders`, `worker/maintenance.ts`)을 같이 걷는다 (순서 제약)
- `I6#34` `ledger-id.ts`를 쓰는 곳(`core/events/subscription-store.ts` 등)을 확인한다 (순서 제약)
- `I6#35` assignment를 가리키는 약 70개 파일을 role과 place(Operator는 자기 ID)로 옮긴다 (순서 제약)
- `I6#36` context 쓰기 자격 검사(`isContextEngineer`가 assignments 표를 읽음)를 Project Manager 판정으로 바꾼다 (순서 제약)
- `I6#37` 설정 항목 선언 모델(타입과 기본값만)을 먼저 짠다 (순서 제약)
- `I6#38` 개발 data를 지우고 새로 만든다 (순서 제약)
- `I6#39` coding agent adapter가 `packages/coding-agent/`에 있어 core가 부를 수 없다는 문제(변환 표와 launch 계획의 순수 값을 protocol로 옮기거나 code-map을 고침)를 푼다 (순서 제약)
- `U5#1` event client, store 층, 반응 층, 새 대기 목록 (순서 제약)
- `U5#2` renderer event client와 Gateway (순서 제약)
- `U5#3` 새 질문 tool과 `QuestionAsked`·`QuestionResolved`, 새 대기 목록 (순서 제약)
- `U5#4` secret 보호 입력을 창 틀에서 떼고, `confirmation: "required"`를 쓰는 route 12개의 확인 handle을 정리 (순서 제약)
- `U5#5` 앱 rewind panel과 session rewind의 앱 고르기 (순서 제약)
- `U5#6` shell main `refreshAppViews`를 대신할 신호(남지 않는 event로 앱 view에 알림, #17) (순서 제약)
- `U5#7` 앱 화면 byte(`/screens`)를 내주는 새 길(refactor session) (순서 제약)
- `U5#8` blueprint `confirm` 칸 삭제 (순서 제약)
- `U5#9` 지침 진입을 일반 문서 탭으로 바꾼다 (순서 제약)

## check (wave 0) — 0줄


## core-wiring (wave 0) — 5줄

- `I1.2#4` 기한과 만료: `expires_at`, `expired` 상태, 만료 command, 만료 sweep read, 60초 timer, 전용 machine principal (같이 닿음: approvals, contract-approvals)
- `I1.10#11` machine 자격 `machine:documents*` 기록
- `I2.2#7` approval 모듈 등록 (같이 닿음: approvals)
- `I2.10#15` core.ts 조립 (같이 닿음: places-sessions)
- `I3.6#5` 끝 표의 나머지

## wording-split (wave 0) — 5줄

- `I1.12#2` SDK UI의 `DocumentAddress`(문서 주소 표시와 복사)
- `I2.6#38` 맡은 영역의 wording과 설정 말
- `U1.1#6` 확인 창 wording
- `U1.1#8` 쓰는 곳 없는 wording key
- `U3.2#6` call 문구

## remove-documents (wave 1) — 41줄

- `I1.1#4` core 안 구독자용 internal subscription(machine principal, WebSocket 대신 함수 sink) (같이 닿음: coding-agent, events, places-sessions, releases-problems, remove-platform)
- `I1.1#8` 지운 개념과 상태 일생 event: Document*, Series*, Snapshot*, Version*, FileWritten 등 (같이 닿음: coding-agent, contract-releases-problems, releases-problems)
- `I1.3#12` handoff 근거로 App Engineer가 앱 밖 문서를 읽는 예외 (같이 닿음: contract-events, events)
- `I1.5#13` 문서 저장(cap-save) (같이 닿음: app-calls, approvals, contract-app-calls, contract-approvals, releases-problems)
- `I1.5#14` format module
- `I1.5#19` 앱 등록의 기획 문서 판 참조와 이름 예약 (같이 닿음: app-calls, contract-app-calls, contract-calls-places, places-sessions)
- `I1.7#20` 사용자 package의 `kind`(component/capability/domain/format)와 kind 불변 규칙 (같이 닿음: contract-releases-problems, releases-problems)
- `I1.9#5` 문서 판 되살리기, series 새 멤버 첫 판 만들기, 파일로 두기(place)의 main 통로 (같이 닿음: contract-shell, remove-platform)
- `I1.10#1` 문서 주소 체계 통째로
- `I1.10#2` 문서 판(version)과 판 주소 (같이 닿음: places-sessions)
- `I1.10#3` file-tracking 통째로 (같이 닿음: agent-definition, contract-platform, places-sessions, platform, releases-problems)
- `I1.10#4` format module과 section 추출 (같이 닿음: places-sessions)
- `I1.10#5` 목차 색인과 FTS 검색 색인
- `I1.10#6` series registry (같이 닿음: places-sessions)
- `I1.10#7` 문서 export
- `I1.10#8` 사람이 올리는 문서 upload (같이 닿음: coding-agent, core-wiring, releases-problems)
- `I1.10#10` Documents event 구독자와 feed (같이 닿음: core-wiring, events)
- `I1.10#13` 문서 쪽 blob 목적 (같이 닿음: coding-agent, platform)
- `I1.11#12` redaction의 화면 상태 문자열 규칙과 표본 규칙 (같이 닿음: remove-platform)
- `I2.6#25` coding agent actor의 route 목록 (같이 닿음: contract-agent-tools, contract-approvals, contract-events, contract-platform, platform)
- `I2.8#10` API 경로의 major (같이 닿음: app-calls, coding-agent, events)
- `I2.10#8` 사람 파일 통로 `files.*` (같이 닿음: contract-calls-places)
- `I2.10#9` 지침 파일(LOPHN.md) 편집 길 (같이 닿음: screens-project)
- `I2.10#10` 폴더 밖 경로·symlink 거절
- `I2.10#11` 열기 가능한 형식
- `I2.10#13` redactor 위치 (같이 닿음: agent-tools, approvals, core-wiring, remove-app-extras, router)
- `I2.10#14` 설치 안내(guide) 읽기 (같이 닿음: agent-definition, agent-tools)
- `I2.11#9` 알려진 secret 값 등록(redaction 입력) (같이 닿음: events, platform)
- `I2.11#10` redaction 실패 때 원문 차단 (같이 닿음: agent-tools, events, releases-problems)
- `I2.11#11` redaction의 남는 규칙 (같이 닿음: platform)
- `I2.11#21` blob 소유 종류 등록 (같이 닿음: platform, releases-problems, router)
- `I3.10#1` project 키워드 검색 (같이 닿음: contract-calls-places)
- `U1.3#4` 버전 비교 화면
- `U1.3#5` 판 복원(옛 판으로 되돌리기)
- `U1.3#6` 정보 패널의 버전 탭 (같이 닿음: screens-project)
- `U1.3#8` 편집기의 형식 문제 표시(problems gutter, 문제 목록)
- `U1.3#9` 문서 링크 `[[` 선택기 (같이 닿음: screens-project)
- `U1.3#10` file-tracking 안내 카드와 [Turn on tracking] (같이 닿음: screens-workspace)
- `U1.5#1` Documents 화면(틀, reader, 검색 panel) (같이 닿음: screens-workspace)
- `U1.5#2` series 화면과 registry 화면 (같이 닿음: screens-project)
- `U1.5#3` 문서 정리(organize)와 export

## remove-platform (wave 1) — 16줄

- `I1.1#9` 앱·release·ticket·context의 상태 event (같이 닿음: app-calls, coding-agent, contract-app-calls, contract-calls-places, contract-coding, contract-platform, contract-releases-problems, events, platform, releases-problems)
- `I1.1#10` 옛 notification 모듈 전부: 계기 표, 엔진, 루프, 표, `NotificationCreated/Read`, Ask 값 (같이 닿음: core-wiring)
- `I1.6#8` coding token의 keychain 보관·전달 (같이 닿음: contract-coding, contract-platform, core-wiring, events, platform)
- `I1.9#6` OS notification 표시(NotificationCreated 기반) (같이 닿음: platform)
- `I1.9#8` update 적용 통로 (같이 닿음: platform)
- `I1.11#1` ledger 자동 backup과 restore 전체(하루 주기 tick, manifest, 보존 개수, 목록·조회 read, 복원 계획, 확인된 복원, 정지 뒤 복원 process, core 재시작 loop) (같이 닿음: contract-platform, core-wiring, platform, releases-problems)
- `I1.11#2` shell main의 restore 통로 (같이 닿음: platform)
- `I1.11#3` secret 머신 이전 export·import(암호 파일) (같이 닿음: contract-platform, platform, releases-problems)
- `I1.11#13` 설치·update 안내 계산(update package metadata, sandbox 파일 검사, lock 비교) (같이 닿음: core-wiring, platform)
- `I2.7#12` 실패 단계 (같이 닿음: contract-releases-problems, releases-problems)
- `I2.11#3` 설정 조회 응답 (같이 닿음: contract-platform, platform, router, screens-project)
- `U1.1#1` notification chip(창 오른쪽 아래의 읽지 않은 notification 목록) (같이 닿음: screens-workspace)
- `U1.1#2` notification Ask toast(`AskAgentToast`), `NoticeAsk`, `AskView`·`AskRequest` (같이 닿음: screens-project)
- `U1.1#3` Things to confirm 화면 전체(inbox, 지난 결정 목록, 기간 filter, notification 기록, 질문 묶음 카드)
- `U1.5#6` Settings Backup 탭(복원 계획과 목록, secret export·import 창) (같이 닿음: remove-documents)
- `U2.5#5` 설정을 따로 읽는 화면 (같이 닿음: screens-project)

## remove-app-extras (wave 1) — 11줄

- `I1.4#6` `document.*` tool 열 개(list, outline, search, read_version, read_section, read_range, history, diff, create, save_version)와 보조 operation `SaveToolDocument`·`document.prepare`·`document.save` (같이 닿음: agent-tools)
- `I1.5#8` SDK `withRevert`와 revert 결과 (같이 닿음: contract-app-calls)
- `I1.5#11` 앱 automation 전부 (같이 닿음: contract-app-calls, contract-approvals)
- `I1.5#12` agent-context(화면 상태, 화면 메모) (같이 닿음: agent-tools, app-calls, contract-app-calls, releases-problems)
- `I1.7#6` 앱 data export 전부 (같이 닿음: contract-app-calls, core-wiring, platform, releases-problems)
- `I1.7#7` problem code 선언 체계 전부 (같이 닿음: contract-releases-problems, releases-problems)
- `I2.4#40` 시각 블록 app 카드가 화면 context read 결과를 쓰는 부분
- `I2.5#12` SDK app-api 등록과 dispatch (같이 닿음: app-calls)
- `I2.5#13` SDK의 다른 앱 호출
- `I2.12#2` 시각 블록 출처 `document`(문서 id, 판 id, section)를 새 문서 모델에 맞추기 (같이 닿음: agent-tools, screens-project)
- `U1.4#1` Automations 탭

## contract-events (wave 2) — 3줄

- `I3.1#2` agent event 정의와 envelope
- `U2.1#2` event를 renderer로 넘기는 길 (같이 닿음: contract-shell, screens-data)
- `U2.6#2` 시작 실패 화면

## contract-approvals (wave 2) — 7줄

- `I1.2#11` approval 생명주기 domain event 다섯: `ApprovalRequestCreated`·`Granted`·`Rejected`·`Expired`·`Cancelled` (같이 닿음: approvals, contract-events)
- `I1.3#3` 고정 방향 표 `HANDOFF_DIRECTIONS`, `handoffAllowed`
- `I2.2#2` `protocol/approvals` 계약
- `I2.2#4` 허락·거절 command → 사람 자격의 결정 command
- `I2.2#8` `grants` 표와 `Grant` 계약 (같이 닿음: approvals)
- `I2.2#13` grant 표시 자료
- `I3.2#2` intent 봉투

## contract-calls-places (wave 2) — 16줄

- `I1.3#6` handoff 내용 blob 한 벌: blob field 등록, 준비기, run 읽기 종류 `handoff_content` (같이 닿음: core-wiring)
- `I1.3#7` run 출처 `handoff` 가지와 그 열·제약·index
- `I1.8#1` 파일 관측 route와 결과 기록, file event 3종
- `I1.10#15` `project.set_tracking` 앞 단계에 묶인 "folders 바꾸기는 tracking preview 필요" 규칙
- `I1.10#17` 위반 넘김 command와 Run 만들기 (같이 닿음: places-sessions)
- `I2.3#1` run 접수 입구 `AcceptRun` (같이 닿음: events, router)
- `I2.3#3` `mode: correction` → steer, `mode: request` → 기본
- `I2.4#1` role 값과 이름: `context_engineer` → Project Manager (같이 닿음: agent-definition, app-calls, approvals, contract-agent-tools, contract-approvals, core-wiring, places-sessions, remove-platform)
- `I2.4#21` context 쓰기 tool (같이 닿음: agent-tools)
- `I2.4#38` agent 이름·built-in 이름 충돌 검사
- `I2.8#1` md 목차 parser (같이 닿음: places-sessions)
- `I2.8#5` session role과 place 규칙 (같이 닿음: places-sessions)
- `I2.10#22` 위반 알림 event (같이 닿음: places-sessions, remove-documents, remove-platform)
- `I2.10#23` 용어집
- `I2.10#26` 사람 쪽 command 행위자
- `I3.3#12` 받는 session 기록의 봉투 칸

## contract-agent-tools (wave 2) — 4줄

- `I1.1#7` 질문·되돌리기·assignment·provider·model·agent 정의의 ledger event
- `I1.4#12` 옛 질문 묶음 모델: 질문 묶음, 근거(문서 판 참조), adoption, 고정 action 선택지, 추천, 확인 handle, 기한, Skip (같이 닿음: agent-tools, contract-approvals)
- `I2.4#34` command 종류와 도는 turn 중 동작
- `I3.4#26` agent 설정 화면용 skill 목록 읽기(project 층, 내장, 끌 수 있는지)

## contract-app-calls (wave 2) — 13줄

- `I1.5#2` 앱이 다른 앱을 부르는 직접 통로 (같이 닿음: approvals)
- `I1.5#16` invocation의 `approval` 칸, `accepted` 상태, `approval` unique index
- `I1.5#17` 호출자 종류 `automation`, `system`의 직접 호출
- `I1.5#20` blueprint `problem_codes`
- `I1.5#21` 앱 process의 `request_key` 재조회·cancel·status (직접 client용)
- `I2.5#1` invocation 표와 protocol 모양
- `I2.5#5` invocation 읽기
- `I2.5#8` 앱 process의 socket 서버
- `I2.5#9` 앱 시작 입력과 ready
- `I2.5#16` SDK blueprint 작성 도우미
- `I2.5#17` blueprint 검사 (같이 닿음: app-calls)
- `I2.5#20` 호출 루프 거절
- `I2.12#3` 앱 view 열기 입력에 project 더하기 (같이 닿음: app-calls, contract-shell, screens-app-space)

## contract-releases-problems (wave 2) — 2줄

- `I1.7#13` 문제와 repair ticket을 잇는 `problems.work` 반응기와 `fixing` 상태 (같이 닿음: coding-agent, releases-problems)
- `I2.9#6` 제보 화면의 첨부 (같이 닿음: releases-problems, screens-app-space)

## contract-coding (wave 2) — 9줄

- `I1.6#2` MCP 쪽 protocol 정의 5개
- `I1.6#19` 제품 안내 skill 둘
- `I2.6#1` CLI의 `ticket claim`
- `I2.6#2` CLI 인증
- `I2.6#5` CLI `sdk`
- `I2.6#6` CLI `problem`
- `I2.6#12` 맡기기 계획 `launchPlanOf`
- `I2.6#36` release bundle에서 빼는 경로
- `I3.1#9` 새 domain event `CodingSessionEndedUnreported`

## contract-platform (wave 2) — 0줄


## contract-shell (wave 2) — 3줄

- `I1.6#25` 사람이 보는 ticket 링크 intent (같이 닿음: platform)
- `I1.9#2` 확인 창 IPC와 preload (같이 닿음: contract-approvals)
- `U3.5#3` 폴더를 찾을 수 없음

## ui-chrome (wave 2) — 15줄

- `I3.12#1` SDK component가 그린 요소에 component 이름을 싣기
- `I3.12#3` annotation 값의 모양(메모, 고른 요소 또는 영역의 screenshot, component 이름, source 파일과 줄, 앱 release, 화면 위치)
- `U6.1#2` 탭 본문의 내용은 최대 폭을 둔 기둥을 가로 가운데에 놓는다
- `U6.1#3` 고른 탭과 탭 본문은 배경이 같아 하나로 보인다. 본문 안에 배경색이 다른 넓은 영역을 두지 않는다. image, pdf, terminal의 바탕도 같다
- `U6.1#4` 탭 안 알림은 그 탭의 위쪽 toast로 띄운다. 색 다른 띠나 상자는 쓰지 않는다
- `U6.1#5` design `Toast`는 행동 단추를 오른쪽 끝에 둔다(지금은 왼쪽). gallery에는 worker들이 따로 만든 look-alike가 넷 있다. 하나로 합친다
- `U6.1#6` 글을 넣는 칸(input, textarea, select)은 focus 때 바깥 outline을 띄우지 않고 칸 테두리 색만 `--color-focus`로 바뀐다
- `U6.1#7` harness(Claude Code, Codex, Gemini CLI, OpenCode, pi, Hermes, OpenClaw)와 provider 이름 옆에 vendor 아이콘을 붙인다. 아이콘 출처는 `@lobehub/icons-static-svg`(MIT)다
- `U6.1#8` 파일과 폴더에는 종류 아이콘을 붙인다. 출처는 `@iconify-json/catppuccin`(MIT)이다. 색은 light에서 Latte, dark에서 Macchiato다
- `U6.1#9` menu 항목에는 아이콘을 붙인다
- `U6.2#1` 창 위쪽 바는 36px다(지금 48px). 창 단추는 46px이고, 닫기 단추는 올리면 빨간 바탕(#c42b1c)에 흰 아이콘이다
- `U6.2#2` 위쪽 바 오른쪽 묶음은 창 단추 바로 옆에 붙는다. 명령 palette 단추는 돋보기 대신 ⌘ 아이콘이다
- `U6.2#3` sidebar 머리는 위쪽 바와 높이가 같고 경계선이 한 줄로 이어진다. 경계선은 겹치지 않는다
- `U6.3#2` 모양은 아이콘과 이름, 고른 탭 아래 3px 밑줄, 상자 없음이다. 탭 이름 오른쪽의 종류 글자(Document editor, Agent 등)는 없다
- `U6.3#3` 파일 탭 아이콘은 파일 종류 아이콘, agent 탭 아이콘은 그 agent의 profile 아이콘, coding 터미널 탭 아이콘은 harness vendor 아이콘이다

## events (wave 3) — 25줄

- `I1.1#1` 화면·외부가 ledger를 읽는 길 `events/list` read와 그 schema(`eventsList`, `after_seq`, `types`, `subjects`, 배치 한도) (같이 닿음: contract-events)
- `I1.1#2` event 공개 정책(visibility) 장치 전부 (같이 닿음: agent-definition, app-calls, coding-agent, contract-events, core-wiring, places-sessions, releases-problems)
- `I1.1#3` 이름 있는 구독의 ack 저장(named subscriber, ack frame, `derived/api-subscriptions`) (같이 닿음: contract-events, core-wiring)
- `I1.1#5` 사람 token 자격으로 events 재생(from_seq 포함, catch-up replay)
- `I1.1#11` 노출용 `events.run` 칸과 run 색인 (같이 닿음: contract-events)
- `I1.2#2` `approval_uses` 표와 `Tx.useApproval`·`usableApproval`·`recordedUse` (같이 닿음: coding-agent, contract-events)
- `I1.6#7` 사람이 만드는 연결(connection) 모델 (같이 닿음: contract-coding)
- `I1.11#7` question 근거로 하는 machine apply(agent 제안을 사람이 고르면 설정 적용) (같이 닿음: agent-tools, contract-platform, platform)
- `I2.1#1` ledger `events` 표 역할
- `I2.1#3` `blob_refs.registered_seq`와 `notifications.source_seq`의 `references events (seq)`
- `I2.1#4` 반응 cursor와 반응 idempotency (같이 닿음: contract-events)
- `I2.1#5` WebSocket 구독 frame과 route (같이 닿음: contract-events)
- `I2.1#14` commit 뒤 Bus 배포 (같이 닿음: core-wiring)
- `I2.1#17` notification 계기 trigger 목록과 겹친 domain event 정의 위치
- `I2.1#18` Gateway가 받는 principal
- `I2.6#23` 기본 실행 옵션 setting (같이 닿음: contract-coding)
- `I2.6#24` coding token의 인증
- `I2.11#14` schema step 목록 (같이 닿음: core-wiring)
- `I2.11#15` core API의 요구에서 빠진 방어(코드를 둘지는 선택) (같이 닿음: platform)
- `I3.1#1` Bus
- `I3.1#5` Gateway
- `I3.1#6` Reactor
- `I3.1#7` 새 일 handler(다섯 event 공통)
- `I3.1#10` 시작 때 정리
- `I3.6#3` coding token 발급·회수

## approvals (wave 3) — 48줄

- `I1.2#1` 범용 적용 엔진: `apply_approved_action` command와 "concern + command + 대상 + 입력" action을 소유 command로 dispatch해 한 tx에서 사용 기록까지 확정하는 길 (같이 닿음: contract-approvals, core-wiring, router)
- `I1.2#3` approval 설명 글 전부: 이유·변경·외부 영향·되돌림·보존·검증 blob, 준비(redaction) 증거, 글 읽기 (같이 닿음: contract-approvals)
- `I1.2#5` 사람·요청자가 하는 취소
- `I1.2#6` 거절 억제(같은 계보에서 거절한 같은 요청 재요청 금지) (같이 닿음: agent-definition)
- `I1.2#7` confirm 전용 request 규칙
- `I1.2#8` session 허락 근거를 approval 행과 ledger event로 계산하는 방식
- `I1.2#9` session 삭제 때 approval request를 지우는 길 (같이 닿음: agent-definition)
- `I1.2#10` 재시작 점검의 approval 관측 (같이 닿음: platform)
- `I1.2#12` 판정표 `judge()`: allow·ask·deny와 이유 코드 열여섯, 되돌릴 수 있는 쓰기는 사람 요청 계보에서만 allow, assignment·run·origin·listed·roleAllows 사실
- `I1.2#13` 내장 쓰기 tool의 소유 계약 연결(ask를 만드는 쪽)
- `I1.2#14` grant kind `agent.commands`(앱이 agent 사용을 허락하는 command 목록) (같이 닿음: agent-tools, app-calls, contract-approvals)
- `I1.2#15` grant마다 approval 하나를 요구하는 생성 길(`grant.create`의 `checkApproval`)
- `I1.7#3` activation 중 grant 변경 거절 (같이 닿음: app-calls)
- `I1.7#8` 앱 broker의 "선언한 code만 보고" guard (같이 닿음: app-calls, releases-problems)
- `I1.10#12` agent tool 판정에서 "Operator의 쓰기 대상 문서가 담당 place에 있는지" 확인
- `I2.1#10` `ApprovalRequestGranted/Rejected/Expired/Cancelled` → `ApprovalDecided` (같이 닿음: contract-approvals)
- `I2.2#1` `approval_requests` 표
- `I2.2#3` request 생성 command (같이 닿음: contract-approvals)
- `I2.2#5` cancel command
- `I2.2#6` approval read
- `I2.2#9` 앱 grant 생성 command
- `I2.2#10` 앱 grant 거두기
- `I2.2#11` 실행 범위 계산
- `I2.2#12` 요구 해석
- `I2.2#14` Deno 실행 flag
- `I2.2#15` 앱 process가 쓰는 바깥 자원 broker(`net.fetch`, `secret.use`, 보고)
- `I2.2#16` Gate 호출자: tool 실행 앞단 (같이 닿음: contract-agent-tools)
- `I2.2#20` 실행 직전 재검사
- `I2.2#22` 허락 접수와 적용 성공을 구별해 알림
- `I2.5#15` SDK secret client (같이 닿음: app-calls, contract-app-calls)
- `I2.7#6` `declarationsOfBlueprint` (같이 닿음: releases-problems)
- `I2.7#11` 성공 단계에 얹을 일 (같이 닿음: app-calls, releases-problems)
- `I2.7#21` 앱 process의 쓰기 범위
- `I3.2#1` Gate 함수
- `I3.2#3` 효과별 기본값
- `I3.2#4` agent grant
- `I3.2#5` reaction grant
- `I3.2#6` 앱 grant 비교와 생성 (같이 닿음: app-calls)
- `I3.2#7` Reactor handler: `ApprovalDecided`
- `I3.2#8` `ApprovalRequested` 남지 않는 event
- `I3.2#9` turn 안 request 보관과 event
- `I3.2#10` turn 안 request의 결정 command
- `I3.2#11` session 허락 메모리
- `I3.2#12` "항상"의 효과
- `I3.2#13` 설정 고치기 판정
- `I3.2#14` 카드 내용 만들기
- `I3.2#15` 보류 request 대기 읽기
- `I3.2#16` Gate 호출 지점 연결

## router (wave 3) — 38줄

- `I1.1#6` ledger에 쓰는 agent 일생 event 정의와 emit (같이 닿음: contract-calls-places)
- `I1.3#1` handoff tool 폴더 전체: `SubmitHandoff` command 래퍼, 읽기 둘, 내용 blob 준비
- `I1.3#4` 칸 넷 내용 `handoffContentSchema`(무엇, 왜, 제외, 기대 결과)
- `I1.3#8` "사람 요청에서 이어진 run만 보낼 수 있다"는 검사
- `I1.3#9` session 없는 run과 assignment 단위 줄
- `I1.3#10` agent tool `handoff.submit`, `handoff.read_status`, `handoff.read_result`
- `I1.3#11` tool `run.read_result`
- `I2.1#16` waiting-and-recovery의 "복구" 반쪽 (같이 닿음: contract-calls-places)
- `I2.2#19` run이 request를 기다리는 길(approval 쪽)
- `I2.3#2` 사람 메시지 접수
- `I2.3#4` steer 본문 감싸기
- `I2.3#5` 입력 본문 만드는 곳
- `I2.3#6` 사람의 단추 한 번으로 새 session 열기
- `I2.3#7` 줄 서기와 선택
- `I2.3#8` App Engineer 시작 조건
- `I2.3#9` 받는 run의 place
- `I2.4#9` skill 목록을 prompt에 넣는 위치와 포장
- `I2.4#13` tool 목록을 고정하는 때
- `I2.4#23` tool 결과 포장
- `I2.4#35` 사람에게 묻는 질문의 상태 (같이 닿음: contract-calls-places)
- `I2.8#6` agent 식별(assignment ID → role과 place) (같이 닿음: contract-events)
- `I2.11#5` 필수 선택이 비었을 때 (같이 닿음: platform)
- `I3.1#3` lophn agent run-loop이 agent event를 Bus에 내기
- `I3.3#1` Router
- `I3.3#2` `agent_calls` 표와 schema step
- `I3.3#3` 상태 전이
- `I3.3#4` 실패 이유
- `I3.3#5` dedup
- `I3.3#7` reply tool
- `I3.3#8` cancel tool
- `I3.3#9` 사람이 취소하는 command
- `I3.3#10` session 목록 tool
- `I3.3#11` call 상태·내용 읽기 route
- `I3.3#13` lophn session 입력함
- `I3.3#14` 열린 session, 없으면 새 session
- `I3.3#16` code-map 갱신
- `I3.3#17` annotation 입력을 App Engineer session의 사람 메시지로 받기
- `I3.4#29` 사람이 붙인 것의 입력 꼴

## agent-tools (wave 3) — 35줄

- `I1.4#1` `FORBIDDEN_TOOL_NAMES`(shell, file.read, file.write, http.request, web.*, browser, code.run, subagent, coding_agent.start)와 `listTools`의 금지 이름 skip, "내장 tool은 문서·앱·context와 agent 일만 다룬다" 주석
- `I1.4#2` `TOOL_BUNDLES`(preset이 이름으로 고르던 묶음)와 묶음 이름 상수
- `I1.4#7` `problem.set_interpretation`과 문제 해석 연결
- `I1.4#8` 증거 읽기 `snapshot.read`, `verification.read`, `repair.read`
- `I1.4#9` `ticket.make_ready`와 준비 상태 모델(`needs`, `adoption_questions` 입력, `missingForReady`, `TICKET_EXTRA_NEEDS_MAX`)
- `I1.4#10` 선언 검색 tool을 context마다 동적으로 만드는 길(`ctx_<ULID>_<slug>_<hash8>`)과 개체 읽기 `context.read_entity`
- `I1.4#11` `context.containing`(문서 경로를 Source가 덮는 context 찾기) (같이 닿음: contract-calls-places)
- `I1.4#13` `question.submit`, `question.read_decision`, `approval.read_decision` tool
- `I1.5#10` agent tool의 revert·confirm 분기
- `I1.10#18` context 만들기·보관·되살리기 command를 agent tool에서
- `I1.12#1` `visual.prepare_document` tool(시각 블록을 html 문서 본문으로 준비)
- `I2.1#13` command 층의 event 쓰기
- `I2.2#17` 앱 app-api tool의 판정 연결 (같이 닿음: contract-calls-places)
- `I2.2#23` role별 노출 효과 표 `APP_COMMAND_EXPOSURE`와 `ToolDefinition`의 효과 칸 (같이 닿음: agent-definition)
- `I2.4#8` `skill.read`와 `skill.read_supplemental`
- `I2.4#12` 앱 app-api tool 이름과 정의
- `I2.4#14` 읽기 tool과 쓰기 tool의 role 배정
- `I2.4#15` ticket tool
- `I2.4#16` 문제 tool
- `I2.4#17` 앱 tool
- `I2.4#18` package tool
- `I2.4#19` release tool
- `I2.4#20` context 읽기 tool
- `I2.4#22` 안내 tool
- `I2.5#19` agent의 app-api tool 실행 (같이 닿음: app-calls)
- `I2.11#19` 감독: child의 core 자격 노출 방지 (같이 닿음: app-calls, platform)
- `I3.3#6` call tool
- `I3.4#1` `file.read`
- `I3.4#3` place 경로 검사(범위 계산)
- `I3.4#5` `pdf.read`, `image.read`
- `I3.4#8` 사람에게 묻는 tool(ask)과 `QuestionAsked`/`QuestionResolved` 흐름
- `I3.4#19` `context.search`(검색 하나 부르기)
- `I3.4#31` Operator 만들기와 고치기 tool
- `I3.8#8` file tool 쓰기 직전 pre-image 기록 배선
- `I3.10#2` pdf·docs 목차 저장과 `outline.get/set/delete` (같이 닿음: contract-calls-places, places-sessions)

## agent-definition (wave 3) — 60줄

- `I1.3#2` handoff protocol route 셋(`SubmitHandoff`, `ReadHandoffStatus`, `ReadHandoffResult`)과 registry 등록 (같이 닿음: contract-calls-places)
- `I1.4#3` 역할 상한 이름 표 `ROLE_CAPS`와 `RoleCap`, `COMMON_READ_TOOLS`, `ASK_TOOLS`, `CONTEXT_ENGINEER_ONLY_TOOLS`, `CONTEXT_LOOKUP_ONLY_TOOLS`, `roleCapsOf`, `ResolveEnvironment.role_caps`
- `I1.4#4` 사람이 role의 tool 목록을 넓히거나 좁히는 길: agent 정의 `permissions` 칸, project 설정 `permissions`, Workspace 기본 권한, resolve의 `role_caps ∩ 층별 permissions`, `permissionIssues`와 `over_cap` issue, 저장 검사 `capIssues`, `agentToolNameSchema`, `agentPermissionsSchema` (같이 닿음: contract-calls-places)
- `I1.4#5` `roles/{lophn,app-engineer,operator}/tool-selection.ts`(`lophnTools`, `lophnOffers`, `appEngineerTools`, `operatorTools` 등)
- `I1.4#14` lophn 질문·설정 제안 helper: `setting-proposal.ts`, `question-submission.ts`, `place-recommendation.ts`
- `I1.4#15` role 안의 흐름 검사·초안 함수 (lophn plan·app-plan·ops-report, App Engineer design·interview·interpretation·ticket·scope, operator result, context-engineer report)
- `I1.4#16` 자동 compaction 계산 함수: `compactionNeeded`, `precheckCompaction`, `compactionTarget`, `mergeStepInputCap`, `recentHistoryBudget`, `splitChunks`, `historyCut`, `checkCompletion`, `shrinkResultText`
- `I1.4#17` "Model for summaries" 칸(`summaries` slot) (같이 닿음: contract-agent-tools)
- `I1.4#18` 같은 이름 skill 둘이 보일 때 고르게 하는 길(`choose_skill`, `skill_origin`, `COMMAND_SKILL_ORIGINS`) (같이 닿음: contract-agent-tools)
- `I1.4#19` skill 이름이 겹칠 때 먼저 발견한 것을 남기고 진 것을 알리는 `shadowing`·`SkillShadow` (같이 닿음: contract-agent-tools)
- `I1.8#2` agent trace export (같이 닿음: contract-agent-tools)
- `I2.1#15` 트레이스 읽기·내보내기(observability) (같이 닿음: contract-agent-tools)
- `I2.2#18` 외부 MCP tool 판정 (같이 닿음: contract-calls-places)
- `I2.4#3` lophn은 place 없이 하나 (같이 닿음: contract-calls-places)
- `I2.4#4` 설정 층 (같이 닿음: contract-calls-places)
- `I2.4#5` resolved agent의 `tools`: 상한 ∩ 층 → role 고정 목록 + agent grant 안의 tool (같이 닿음: contract-calls-places)
- `I2.4#6` skill 끄기: 층마다 끄고 이름 단위로 덮는다 (같이 닿음: contract-agent-tools)
- `I2.4#7` skill 출처 (같이 닿음: contract-agent-tools)
- `I2.4#10` MCP server 층 (같이 닿음: contract-agent-tools)
- `I2.4#11` 외부 MCP tool 이름
- `I2.4#24` prompt 층 구성과 cache 경계
- `I2.4#25` 지침 층 (같이 닿음: app-calls, contract-agent-tools)
- `I2.4#26` 지침을 읽는 때와 막는 규칙
- `I2.4#27` lophn의 project 지침
- `I2.4#28` built-in role 지침 4개
- `I2.4#29` 제품 공통 지시
- `I2.4#30` context 자료 → place 정보
- `I2.4#32` 전역 built-in 명령 (같이 닿음: contract-agent-tools, screens-conversation)
- `I2.4#33` role 명령
- `I2.4#36` role별 기본 model slot (같이 닿음: contract-agent-tools)
- `I2.4#37` agent 설정 파일의 `contexts`(Operator가 붙은 context)와 앱 Operator의 file 범위 (같이 닿음: contract-calls-places)
- `I2.4#39` agent runtime child의 Deno 권한
- `I2.11#2` 설정 항목을 선언하는 곳 열세 개 (같이 닿음: contract-agent-tools, contract-coding, platform, releases-problems)
- `I3.4#2` `file.write`, `file.edit`
- `I3.4#4` `glob`, `grep`
- `I3.4#6` `shell`
- `I3.4#7` `web.search`, `web.fetch`
- `I3.4#9` `tool` 찾기(deferred tool 정의 불러오기)와 deferred 규칙
- `I3.4#10` tool 바뀜 알림
- `I3.4#11` app-api tool 이름 역조회 표와 "없는 tool" 오류
- `I3.4#12` project 범위 app-api의 project 칸
- `I3.4#13` `ticket.update`, `ticket.verify`, `ticket.cancel`
- `I3.4#14` `problem.set_state`
- `I3.4#15` `app.create`, `app.link_source`
- `I3.4#16` `blueprint.check`
- `I3.4#17` `package.publish`
- `I3.4#18` `release.get`
- `I3.4#20` `instructions.read`
- `I3.4#21` 입력 tag 만들기
- `I3.4#22` `<lophn-untrusted>` 포장
- `I3.4#23` 지침·tool·place 정보 바뀜 notice
- `I3.4#24` place 정보 builder
- `I3.4#25` 내장 skill 정의와 "끌 수 있는지" flag
- `I3.4#28` Project Manager 내장 skill 둘
- `I3.4#30` place 정보의 부를 수 있는 agent 목록
- `I3.8#1` project 등록 때 Project Manager 생성 (같이 닿음: places-sessions)
- `I3.8#2` 앱 등록 때 App Engineer 생성 (같이 닿음: app-calls)
- `I3.8#3` lophn 한 개 보장 (같이 닿음: core-wiring)
- `I3.8#4` agent 더하기·지우기 규칙
- `I3.11#1` secret 파일 저장소 (같이 닿음: core-wiring, events, platform, screens-data)

## places-sessions (wave 3) — 35줄

- `I1.8#3` session 되살리기(archive 풀기) (같이 닿음: contract-calls-places)
- `I1.8#4` session 닫기 command와 closed 상태
- `I1.8#5` assignment 상태 machine과 반응 (같이 닿음: contract-calls-places, core-wiring)
- `I1.10#9` 문서 쓰기·읽기 contract 전부
- `I1.10#14` project의 tracking 규칙 (같이 닿음: contract-calls-places)
- `I2.2#21` 세션 rewind가 대기 request를 취소하는 길
- `I2.4#2` Project Manager는 project마다 하나, project 등록 때 생김, 자기 project의 context만 (같이 닿음: contract-calls-places)
- `I2.4#31` compact
- `I2.8#2` context의 outline kind (같이 닿음: contract-calls-places)
- `I2.8#3` archive한 session
- `I2.8#4` session 지움
- `I2.8#7` fork
- `I2.8#8` session rewind 계획에 앱 선택을 잇기 (같이 닿음: contract-calls-places)
- `I2.8#9` session rewind가 되돌리는 파일의 범위
- `I2.8#12` 대화 기록 저장 위치(message, tool call, model call, compact 경계)
- `I2.10#1` project 등록 입력 (같이 닿음: contract-calls-places)
- `I2.10#2` project 읽기 모양 (같이 닿음: contract-calls-places)
- `I2.10#3` 폴더를 찾을 수 없을 때의 상태
- `I2.10#4` 폴더 겹침 규칙
- `I2.10#5` project archive 효과
- `I2.10#6` `name`(slug) 칸
- `I2.10#7` `project.resolve_cwd` (같이 닿음: coding-agent, contract-calls-places)
- `I2.10#19` 초안 판의 저장 방식 (같이 닿음: contract-calls-places)
- `I2.10#20` 판 test
- `I2.10#21` 판 적용 뒤 되돌리기
- `I2.10#24` saved view의 출처 값
- `I2.10#25` context 보관
- `I2.10#27` context 파일 읽기의 경로 규칙
- `I3.1#4` session snapshot
- `I3.8#5` role과 place 짝 검사
- `I3.8#6` session archive·지움의 영향 묶음
- `I3.8#7` archive한 session은 입력을 받지 않는다
- `I3.8#9` rewind 화면이 쓸 앱별 write 목록 소비
- `I3.10#3` 초안 폴더 열기와 `context.draft`·`context.test` tool
- `I3.10#4` 폴더가 없어진 project 폴더 다시 잇기

## app-calls (wave 3) — 47줄

- `I1.2#16` confirm command의 app-frame 흐름(proof 받기, `ConfirmGate`)
- `I1.5#1` 앱 쌍 연결 준비, origin 서명, path 장부 (같이 닿음: approvals)
- `I1.5#3` 서명 AppConnection 발급과 검증 (같이 닿음: contract-app-calls)
- `I1.5#4` view가 닫힐 때 연결 비우기 (같이 닿음: contract-app-calls, platform, screens-app-space)
- `I1.5#5` Deno runtime client(직접 호출 client) (같이 닿음: agent-tools)
- `I1.5#6` confirm 경로 전부 (같이 닿음: approvals, contract-app-calls)
- `I1.5#7` revert 전부(core worker) (같이 닿음: contract-calls-places, core-wiring, events, places-sessions, releases-problems)
- `I1.5#9` blueprint `revert` 칸, `confirm` 칸 (같이 닿음: contract-app-calls)
- `I1.5#15` 후행 전달 목록과 후행 사실 (같이 닿음: contract-app-calls)
- `I1.5#18` 앱 process Deno 허락에 다른 앱 socket을 더하는 일
- `I1.6#26` 앱 호출 경로의 coding_agent operation 상한
- `I2.5#2` invocation schema trigger
- `I2.5#3` invocation 기록 주체
- `I2.5#4` 기록 규칙 `recordingMode`
- `I2.5#6` core 재시작 점검
- `I2.5#7` 앱 process의 호출 처리
- `I2.5#10` broker 서비스 묶음 (같이 닿음: contract-app-calls)
- `I2.5#11` apps 제어 조립 (같이 닿음: contract-app-calls)
- `I2.5#14` SDK DB 연결
- `I2.5#18` app-api 이름(command에서 app-api로)
- `I2.5#21` preview 호출
- `I2.5#22` 앱 등록 actor
- `I2.5#27` 앱 화면(사람)의 호출 (같이 닿음: contract-app-calls)
- `I2.5#28` shell main의 view 연결 (같이 닿음: screens-app-space)
- `I2.7#9` activation 순서: 접수 닫기와 비우기 (같이 닿음: releases-problems)
- `I2.7#20` app test가 "network 없이 test DB로" 도는지 (같이 닿음: releases-problems)
- `I2.9#7` test 이름과 주석의 옛 요구·작업 번호
- `I2.12#1` `useCommand`·`CommandSpec`·guide·예제·시험에서 사람 확인(`confirm`) 개념 빼기
- `I3.1#8` 새 domain event `AppRestartHalted` (같이 닿음: contract-app-calls)
- `I3.5#1` core 호출 경로 서비스
- `I3.5#2` 부른 쪽 확인 세 길
- `I3.5#3` project 정하기
- `I3.5#4` 호출 루프와 깊이 거절
- `I3.5#5` 앱마다 write queue
- `I3.5#6` core에서 앱 process로 가는 호출 op
- `I3.5#7` SDK session과 changeset 반환
- `I3.5#8` changeset 보관과 삭제
- `I3.5#9` changeset 뒤집기
- `I3.5#10` rewind 목록 계산
- `I3.5#11` rewind 실행
- `I3.5#12` drain 공용 부품
- `I3.5#13` 앱 process에서 뒤집은 changeset 적용
- `I3.5#14` rewind 기록
- `I3.5#15` session·turn별 write 목록 read
- `I3.5#16` SDK project 읽기
- `I3.5#17` handler가 받는 project
- `U2.4#15` SDK `CommandButton`의 확인 표시

## coding-agent (wave 3) — 69줄

- `I1.3#5` 문서 판 고정 근거 `HandoffReference`(document, version, section, question)와 검사 `checkReferences`, `adoptionOf` (같이 닿음: contract-calls-places)
- `I1.6#1` MCP server 전부
- `I1.6#3` `--toolsets`와 `LOPHN_MCP_TOOLSETS`, MCP tool 출력 꼴 (같이 닿음: contract-coding)
- `I1.6#4` MCP 설정 출력
- `I1.6#5` MCP 연결 관측
- `I1.6#6` 안내 파일 배포와 관리 구간
- `I1.6#9` 사람이 직접 시작하는 길
- `I1.6#10` terminal host의 관측 socket (같이 닿음: contract-coding)
- `I1.6#11` TUI 아래 MCP·CLI process 관측과 core 등록
- `I1.6#12` 사람 전용 안내 command (같이 닿음: contract-coding)
- `I1.6#13` 금지 작업 목록
- `I1.6#14` CLI의 앱 밖 명령(문서·project·series·format) (같이 닿음: contract-coding)
- `I1.6#15` 앱 직접 통로
- `I1.6#16` 사람이 하는 harness 관리 command
- `I1.6#17` 기본 harness 제안
- `I1.6#18` 환경·profile 분리
- `I1.6#20` ticket 준비 상태와 채택 질문 (같이 닿음: contract-coding)
- `I1.6#21` 종류별 필수 조건 강제
- `I1.6#22` ticket 화면 읽기와 [Start] 다음 행동 (같이 닿음: contract-coding)
- `I1.6#23` ticket 자동 확인 판정
- `I1.6#24` 사람의 revert로 ticket 취소하는 machine 경로
- `I2.1#8` `TicketConfirmed` → `TicketVerified`, `TicketCheckFailed`는 event에서 뺀다 (같이 닿음: contract-coding)
- `I2.1#9` `TicketClaimReleased(reason=expired)` → `TicketClaimExpired` (같이 닿음: contract-coding, core-wiring)
- `I2.1#12` `ReleaseActivationFailed`, `TicketCompletionReported` (같이 닿음: app-calls, contract-coding, contract-releases-problems, releases-problems)
- `I2.6#4` CLI `app` 명령 표
- `I2.6#9` 읽기·변경 command 이름
- `I2.6#10` 배포 skill 본문
- `I2.6#11` 첫 prompt
- `I2.6#13` cwd를 등록 project 폴더로 요구하는 검사
- `I2.6#14` Hermes·OpenClaw 첫 prompt 전달
- `I2.6#15` 첫 prompt를 PTY에 넣는 방식 (같이 닿음: contract-coding)
- `I2.6#16` hook 신호 번역
- `I2.6#17` 제품마다 turn 끝 신호
- `I2.6#18` catalog의 hook 위치
- `I2.6#19` catalog의 형태
- `I2.6#20` version·로그인 확인
- `I2.6#21` harness 설치 engine
- `I2.6#22` 설정 파일 adapter
- `I2.6#26` ticket 생성 입력 (같이 닿음: contract-coding)
- `I2.6#27` acceptance check 종류
- `I2.6#28` 완료 보고 때의 검사
- `I2.6#29` ticket 불변 규칙
- `I2.6#30` claim의 주인 (같이 닿음: contract-coding)
- `I2.6#31` claim 조건
- `I2.6#32` ticket 취소
- `I2.6#33` ticket 읽기 (같이 닿음: contract-coding)
- `I2.6#34` 문제의 수리 ticket 사실 (같이 닿음: contract-releases-problems)
- `I2.6#35` 수리 ticket 문제 예약
- `I2.7#33` `app-test` 안의 problem 쪽 fixture·예시 (같이 닿음: contract-app-calls, releases-problems)
- `I3.3#15` call을 닫는 Reactor handler 셋
- `I3.6#1` harness transport(맡기기 쪽)
- `I3.6#2` 앱마다 queue
- `I3.6#4` session 끝 정리
- `I3.6#6` hook 설치
- `I3.6#7` CLI hook 명령
- `I3.6#8` hook 수신 route와 event 변환
- `I3.6#9` 외부 session ID 연결
- `I3.6#10` App Engineer 메시지를 PTY에 넣기
- `I3.6#11` coding agent의 메시지 command
- `I3.6#12` source diff 읽기
- `I3.6#13` 실행 옵션의 전달
- `I3.6#14` turn 끝 신호 유무 표시
- `I3.6#15` 터미널 탭 열기(core가 시킴)
- `I3.6#17` 기동 때 coding session 복구 (같이 닿음: core-wiring)
- `I3.6#18` `ticket.update` command (같이 닿음: contract-coding)
- `I3.6#19` `ticket.verify` command
- `I3.6#20` 글 조건
- `I3.6#21` annotation을 ticket 근거에 붙이고 CLI로 읽기 (같이 닿음: contract-coding)
- `U2.6#3` 터미널 탭이 coding TUI를 보이는 모양 (같이 닿음: contract-coding, screens-project)

## releases-problems (wave 3) — 76줄

- `I1.7#1` activation 시작을 approval에 묶는 검사 (같이 닿음: contract-releases-problems)
- `I1.7#2` 시작·확정 때 비교 기준을 다시 확인하는 CAS (같이 닿음: contract-releases-problems)
- `I1.7#4` `ReleaseComparison`에서 지울 칸: `added/removed/changed_automations`, `added_problem_code_warnings`, 변경 종류 `confirm`·`revert`, `review_required`("호환 주장 안 함"의 반대 장치), `description_only_commands` (같이 닿음: contract-releases-problems)
- `I1.7#5` 준비 도중 원본 변경 감시
- `I1.7#9` 증거 snapshot의 화면 증거(화면 이름·화면 상태·screenshot)와 snapshot의 "값 또는 이유 하나" 짝 체계 (같이 닿음: contract-releases-problems)
- `I1.7#10` 닫기 규칙과 닫힘 근거 넷(verified, user_confirmed, recovered, dismissed), 자동 닫는 반응기 `problems.closing` (같이 닿음: contract-releases-problems)
- `I1.7#11` 고친 기록(fix record) (같이 닿음: contract-releases-problems)
- `I1.7#12` 수리 자료 묶음 조립기와 시작 summary 조립 (같이 닿음: contract-coding)
- `I1.7#14` 문제의 해석 연결(문서 version·절) (같이 닿음: contract-releases-problems)
- `I1.7#15` reproduction test 장치 전부 (같이 닿음: contract-releases-problems)
- `I1.7#16` 필수 검사 중 problem·보고 계열 9개: `declarations`, `failure_path_coverage`, `code_usage_static`, `code_usage_dynamic`, `sdk_receipt`, `process_exception`, `redaction`, `permission_denial`, `view_exception`, `feedback`(실패 경로 `failure_path:<code>`까지)
- `I1.7#17` 필수 검사 중 계약 계열 6개: `read_contract`, `automation_scope`, `secret_grant`, `adapter_isolation`, `revert_conflict`, `revert_duplicate`
- `I1.7#18` 화면 검사 host(앱 화면을 offscreen으로 띄워 관측) (같이 닿음: screens-app-space)
- `I1.7#19` 보고 접수의 세부 장치(선택): collector 대기 상한(`collector_pending_*`, `collector_concurrent_assembly`, `automatic_body_bytes`), 발생 재전송 replay 표(`OccurrenceReplays`), 접수 전 redaction 거치기, 본문 읽기 route (같이 닿음: contract-releases-problems)
- `I1.7#21` 개인 package 등록 거절
- `I2.1#2` `events` 표를 상태로 읽는 곳을 domain 표 읽기로 (같이 닿음: agent-definition, agent-tools, app-calls, approvals, coding-agent, events, places-sessions, platform, remove-platform, router)
- `I2.1#11` `ProblemOpened`/`ProblemReopened`의 emit 조건과 payload (같이 닿음: contract-releases-problems)
- `I2.1#19` internal subscription 쓰던 구독자 여섯의 대체
- `I2.5#23` app test의 되돌림 검사
- `I2.5#24` app test의 read 검사
- `I2.5#25` app 호출 이름이 박힌 release 준비 흐름
- `I2.5#26` app 템플릿과 안내 (같이 닿음: coding-agent)
- `I2.6#7` CLI 출력의 data fence
- `I2.6#8` `repairContextMore` (같이 닿음: contract-coding)
- `I2.6#37` 새 앱 source 준비
- `I2.7#1` activation 시작 command (같이 닿음: contract-releases-problems)
- `I2.7#2` 시도의 이름(`started_seq`) (같이 닿음: contract-releases-problems)
- `I2.7#3` activation이 겹칠 때
- `I2.7#4` 묻는 조건의 판정
- `I2.7#5` 비교 결과의 모양 (같이 닿음: contract-releases-problems)
- `I2.7#7` `DataChange`에 손실 선언 (같이 닿음: contract-releases-problems)
- `I2.7#8` 이전 release로 돌아가기
- `I2.7#10` 복구본(backup) 수명
- `I2.7#13` migration 출발점 확인
- `I2.7#14` release 준비의 ticket 출처 (같이 닿음: contract-releases-problems)
- `I2.7#15` `TicketVerified`로 release를 찾는 조회
- `I2.7#16` bundle의 의존 처리(npm·jsr)
- `I2.7#17` 의존 선언과 manifest 대조 (같이 닿음: contract-releases-problems)
- `I2.7#18` 필수 검사 정의의 남는 넷
- `I2.7#19` test 종류와 side (같이 닿음: contract-releases-problems)
- `I2.7#22` problem 상태 모델 (같이 닿음: contract-releases-problems)
- `I2.7#23` 문제 묶는 key (같이 닿음: contract-releases-problems)
- `I2.7#24` 보고의 `code` (같이 닿음: contract-app-calls, contract-releases-problems)
- `I2.7#25` 발생 근거(snapshot) (같이 닿음: contract-releases-problems)
- `I2.7#26` 처리되지 않은 오류 수집 (같이 닿음: contract-releases-problems)
- `I2.7#27` 재발해서 다시 여는 조건
- `I2.7#28` 문제 목록 조회 (같이 닿음: contract-releases-problems)
- `I2.7#29` 문제 상세 (같이 닿음: contract-releases-problems)
- `I2.7#30` 문제 상태 바꾸기 (같이 닿음: contract-releases-problems)
- `I2.7#31` 제보 (같이 닿음: contract-releases-problems)
- `I2.7#32` `Verification`·테스트 기록 읽기 (같이 닿음: contract-releases-problems)
- `I2.7#34` package 등록 command (같이 닿음: contract-releases-problems)
- `I2.7#35` package 목록과 읽기
- `I2.7#36` 설치된 사본 읽기 전용
- `I2.7#37` package update가 기존 앱 의존을 바꾸지 않는다
- `I2.7#38` problems의 설정 항목 `detailCollectionSetting`(진단 상세 수집)
- `I2.8#11` blob-store 용량 범주 (같이 닿음: contract-platform, platform)
- `I2.10#12` `DocumentsChannel` 재배치 (같이 닿음: app-calls, core-wiring, platform, remove-documents)
- `I2.11#17` 진단: lophn 내부 오류 분류 (같이 닿음: platform)
- `I2.11#22` blob 정지 유지보수 (같이 닿음: core-wiring, platform)
- `I3.7#1` activation handler
- `I3.7#2` 앱마다 activation 줄
- `I3.7#3` 복구본 지우기 (같이 닿음: platform)
- `I3.7#4` 손실 단계 선언 읽기와 판정
- `I3.7#5` 묻는 경우의 activation 보류 request 만들기
- `I3.7#6` 이전 release로 돌아가기 command
- `I3.7#7` `problem.set_state` 쪽 command
- `I3.7#8` 해결됨·무시의 상태 전이 기록
- `I3.7#9` 문제 조회의 기간 인자 (같이 닿음: contract-releases-problems)
- `I3.7#10` 사용자 package 내기 흐름
- `I3.7#11` npm·jsr 의존을 bundle에 담기
- `I3.7#12` 사용자 package 의존을 bundle에 담기
- `I3.7#13` 필수 검사 `의존`
- `I3.7#14` activation 실패 payload에 실패 근거 읽기
- `I3.7#15` 문제 상세에 source commit
- `I3.12#2` 그린 요소의 앱 source 위치(파일과 줄) 얻는 길

## platform (wave 3) — 30줄

- `I1.3#13` handoff 자료 봉투 `handoffEnvelope`
- `I1.9#3` 질문 묶음을 확인 창 없이 접수하는 길(`windowless-confirmation`) (같이 닿음: contract-approvals, screens-data)
- `I1.9#4` 문서 판 비교·tracking 미리보기·설치 안내 worker route
- `I1.9#9` 단일 instance와 second-instance argv 처리
- `I1.11#4` settings TOML 가져오기·내보내기 (같이 닿음: contract-platform, releases-problems)
- `I1.11#5` 설정 변경 기록(immutable revision 이력) (같이 닿음: contract-platform)
- `I1.11#6` 설정 충돌 검사(편집 시작 revision 비교) (같이 닿음: contract-platform, screens-workspace)
- `I1.11#8` secret 삭제 완료 표시(`secrets.cleanup` read, `reference_blocked`·`os_deleted`·`processes_ended`) (같이 닿음: contract-platform)
- `I1.11#9` OS keychain 저장소와 그 부속 (같이 닿음: core-wiring, releases-problems)
- `I1.11#10` 보안 상태 점검(doctor): sdk hash, credential 권한, 넓은 grant, file+network grant, 오래 안 쓴 grant, 가리지 않은 key 패턴 (같이 닿음: contract-platform, core-wiring)
- `I1.11#11` 보안 사건 구분(`SECURITY_DIAGNOSTIC_KINDS`, `classifySecurity`) (같이 닿음: events)
- `I2.1#6` shell main의 event 구독 (같이 닿음: contract-events, contract-shell)
- `I2.1#7` 앱 frame 새로고침 신호 `refreshAppViews`
- `I2.6#3` CLI 권한 계획과 launcher
- `I2.9#5` window 열기 intent (같이 닿음: contract-shell, screens-workspace)
- `I2.11#1` 설정 항목 선언 모양 (같이 닿음: agent-definition, contract-platform, events, releases-problems)
- `I2.11#4` 층 처리
- `I2.11#6` secret 쓰기와 지우기의 원자성 (같이 닿음: contract-platform, screens-data)
- `I2.11#7` secret 조회 (같이 닿음: contract-platform)
- `I2.11#8` secret 전송 부착의 값 읽기 (같이 닿음: approvals)
- `I2.11#12` 복구본 규칙 (같이 닿음: core-wiring)
- `I2.11#13` 시작 실패 분류 (같이 닿음: contract-events, core-wiring)
- `I2.11#16` 진단: 상태 점검 (같이 닿음: core-wiring)
- `I2.11#18` 진단: log와 crash 기록
- `I2.11#20` 감독: child 하나가 core를 막지 않음
- `I2.11#23` schema step 적용 중 쓰기 정지 (같이 닿음: core-wiring)
- `I3.11#2` 설정 파일 저장소와 선언 registry (같이 닿음: core-wiring)
- `I3.11#3` 설정 파일의 형식과 위치, 읽는 쪽에 알리는 방법
- `I3.11#4` 설정 화면이 쓰는 항목 이름과 설명
- `I3.11#5` 진단 목록과 상태 read를 제품에 등록 (같이 닿음: core-wiring)

## annotation (wave 3) — 0줄


## screens-data (wave 3) — 16줄

- `I1.9#1` 확인 창(별도 modal)의 main 쪽 전체: coordinator, handle 발급, canonical 비교, 확인 binding, decide·submit·check, 창 열기 (같이 닿음: contract-approvals)
- `I2.9#4` secret 보호 입력
- `U1.1#4` 질문·approval·notification을 3초마다 훑는 polling
- `U1.1#5` 확인 창 renderer 전체
- `U2.1#4` overlay의 `notification` 표면 (같이 닿음: contract-shell, screens-project)
- `U2.1#5` secret 보호 입력
- `U2.1#7` Workspace로 들어가는 단추 이름
- `U2.2#11` session rewind 화면 (같이 닿음: screens-conversation)
- `U3.1#1` event client
- `U3.1#2` store 층
- `U3.1#3` UI용 hook
- `U3.1#4` 반응 층
- `U3.1#5` 대기 목록 panel
- `U3.1#6` 보류 request 카드
- `U3.1#7` turn 안 request 카드의 내용
- `U3.1#8` 거절 이유 입력

## screens-conversation (wave 3) — 37줄

- `U1.1#7` 옛 dock, Roles, provider 계정의 흔적
- `U1.2#1` 질문 카드의 기한 표시, 추천 칸, Details, 고정 action 적용 상태(applying, applied, apply_failed), Skip
- `U1.2#3` 시각 블록의 [Save as document], 저장 진행 표시(`SaveState`), 저장된 문서 링크 (같이 닿음: screens-project)
- `U1.2#4` `/` 메뉴의 "같은 이름 skill 고르기"와 출처 라벨
- `U1.2#5` session 목록의 Restore(되살리기)
- `U2.1#1` 화면이 core를 읽는 방식 (같이 닿음: screens-project)
- `U2.2#1` approval 카드
- `U2.2#2` approval 카드의 결정 상태
- `U2.2#3` 질문 카드
- `U2.2#4` 보내기 방식
- `U2.2#5` composer의 보내기 선택
- `U2.2#6` 내 말 옆 "Change" 표시
- `U2.2#7` rewind 안내 문구
- `U2.2#8` 대화 줄의 보낸 쪽 구별
- `U2.2#9` `/` 메뉴
- `U2.2#10` 입력칸 아래 권한 요약
- `U2.2#12` session 목록의 archive와 지움
- `U2.2#13` closed session 표시
- `U2.2#14` fork
- `U2.2#15` 대화의 문서 결과 링크 (같이 닿음: screens-project, screens-workspace)
- `U2.2#17` role 이름이 나오는 대화 쪽
- `U3.2#1` 받은 메시지의 보낸 쪽 chip
- `U3.2#2` chip을 누르면 여는 panel
- `U3.2#3` 보낸 session의 call 블록
- `U3.2#4` 답과 실패 메시지 이어 붙이기
- `U3.2#5` call 취소 단추
- `U3.2#7` `/recap`
- `U3.2#8` session 허락 보기
- `U3.2#9` archive된 session 읽기 전용
- `U3.2#10` session rewind의 앱 고르기
- `U3.2#11` 위반 chip과 기다리는 coding 맡기기 표시
- `U6.5#1` composer에 보내기 방식 menu는 없다. 일하는 중 보낸 메시지는 composer 위 Next turn 줄에 쌓이고, 줄의 [Send now]가 steer다(req-1509)
- `U6.5#2` 질문 카드는 한 번에 질문 하나를 보이고 ‹ 1 of N ›로 넘긴다
- `U6.5#3` agent header 위에 여백을 둔다
- `U6.5#4` `/` 명령 창은 아이콘, 이름, 설명이 한 줄인 얇은 행이고 묶음은 선으로 나눈다
- `U6.5#5` model picker에는 안내 문구가 없다. 고른 model의 variant만 보인다. model을 바꾸면 새 model의 기본 variant로 조용히 맞춘다. provider 요청 오류는 대화 안 메시지와 [Retry]로 보인다
- `U6.5#6` 대기 목록: pill은 위쪽 바 안에 있다. 항목 세부는 기본으로 접는다(제목, 한 줄 설명, 단추만). 단추는 오른쪽 끝이다

## screens-project (wave 3) — 54줄

- `I1.9#7` 현재 보기(열린 탭, 선택한 문서 절·줄, 앱 view 참조)를 core로 relay하는 길 (같이 닿음: agent-definition, app-calls, contract-shell, platform)
- `I1.10#16` version 준비와 형식 검사
- `I2.9#1` 앱 공간의 agent 부르기 통로 이름
- `I2.9#2` layout 저장의 info 탭
- `I2.9#3` 문서 탭 kind의 대상
- `I2.10#16` 편집기 파일 adapter (같이 닿음: contract-agent-tools, contract-shell)
- `I2.10#17` 창 닫기 guard
- `I2.10#18` 두 번째 md 목차 parser 통합 (같이 닿음: contract-calls-places, platform)
- `I3.6#16` session과 터미널 탭의 대응 (같이 닿음: coding-agent)
- `U1.2#2` 표·차트·도표 시각 블록
- `U1.3#7` 문서 머리 메타 줄의 판 번호
- `U1.3#12` Search 하위 탭과 Search 탭의 [Ask …]
- `U1.3#16` 화면을 둔 채 다시 읽는 `stamp` 장치
- `U1.3#17` 위반 목록의 "… is on it" 표시
- `U2.1#3` 대기 개수 pill (같이 닿음: screens-app-space)
- `U2.2#16` composer의 context chip
- `U2.2#18` 시각 블록의 앱 카드
- `U2.3#1` 계약 위반 toast
- `U2.3#4` 접힌 sidebar rail
- `U2.3#5` sidebar의 문서 목록
- `U2.3#6` 문서 탭이 여는 대상과 탭 key
- `U2.3#7` 문서 읽기
- `U2.3#8` Outline 목록
- `U2.3#9` 읽기 위치 기억의 section key
- `U2.3#10` 문서 탭이 다루는 확장자
- `U2.3#11` 저장 흐름과 저장 상태
- `U2.3#12` 충돌과 밖에서 바뀐 파일
- `U2.3#13` 정보 패널 위치
- `U2.3#14` 정보 패널 Info 탭
- `U2.3#15` 문서 탭의 판 hint와 pending
- `U2.3#16` 지침 [Instructions] 진입 (같이 닿음: screens-workspace)
- `U2.3#20` 위반 목록의 [Send to …]와 [Send all …]
- `U2.3#28` 정의 저장 안내 문구
- `U2.3#29` profile 이미지
- `U2.3#31` 코드 이름 `workspace/`와 Lophn Workspace (같이 닿음: screens-workspace)
- `U2.4#11` project 안에서 앱 열기(앱 패널 탭) (같이 닿음: contract-app-calls, screens-app-space)
- `U3.1#9` toast 문구와 "눌러서 agent 부르기" (같이 닿음: wording-split)
- `U3.3#4` 확장자별 viewer 고르기
- `U3.3#5` text 파일 편집기
- `U3.3#6` 이미지·pdf viewer (같이 닿음: contract-shell)
- `U3.3#7` project 밖 파일 열기
- `U3.3#8` project 키워드 검색
- `U3.3#9` 줄 번호로 문서 열기
- `U3.3#10` sidebar의 saved view 목록
- `U3.6#1` lophn이 여는 터미널 탭
- `U6.1#1` 토글과 행동 단추는 줄 오른쪽 끝의 고정 열에 둔다. 이름 길이와 상관없이 같은 위치다. form의 Save·Cancel, 카드의 Open·Archive, toast 단추도 오른쪽 끝이다
- `U6.3#1` 탭 줄은 component 하나(`TabStrip`)다. project 창과 앱 공간 pane 머리가 같이 쓴다
- `U6.4#2` Explorer: 루트는 한 줄 머리(`▾ PHRONER`)이고, menu로 연결 폴더와 하위 폴더(req-1524)를 골라 바꾼다. tree에 파일 종류 아이콘을 붙인다
- `U6.4#4` Agent: agent마다 열린 session을 들여 써 보이고, 맨 아래에 Recent session 몇 개를 둔다
- `U6.4#5` 새 탭(+) menu 항목과 하위 menu에 아이콘을 붙인다
- `U6.4#6` 문서 탭: 파일 지우기 확인은 화면 가운데 modal이다. 편집 중에는 focus 테두리가 없다. 정보 panel은 위 border가 있는 overlay다. view bar는 경로 없이 한 줄이다. 밖에서 바뀜과 충돌은 탭 위쪽 toast다
- `U6.7#2` Settings 항목은 sidebar의 Settings 아래에 아이콘과 묶음으로 들어간다. 묶음은 General(General, Appearance), Agents(Providers, Agents, Tools and skills, Coding agents), System(Reactions, Diagnostics)이다. 고른 줄은 둥근 배경이고, Settings 안에 둘째 목차 열은 없다
- `U6.7#3` Appearance: Theme(Light, Dark, System이 기본), Text size, Reading width, Density
- `U6.7#4` Projects: 목록의 마지막 카드 아래에 동그란 + 단추로 등록한다. 등록 폴더 아래에 하위 폴더가 중첩으로 보인다(req-1524). Folders 머리 아래에 여백을 둔다

## screens-contexts (wave 3) — 13줄

- `U1.3#11` Context 탭 머리의 [Ask Context Engineer]와 [History]
- `U1.3#13` Contexts 탭의 [New context]와 안내 글
- `U1.3#14` [New context] 뒤 agent 탭 열기, draft 탭, 만드는 중(drafting) 표시
- `U1.3#15` context 목록 30초 polling(context watch)
- `U1.3#18` 문구: tracking, 판·비교·복원·저장 주체·diff, context의 agent 부르기와 new context
- `U2.3#17` Context 탭 읽기 시점
- `U2.3#18` context 목록의 공급원
- `U2.3#19` Contexts 탭 카드
- `U2.3#21` Search 탭이 context에 묶임
- `U3.3#11` Context 탭의 판 목록과 되돌리기
- `U6.4#1` sidebar 맨 위에 밑줄 글자 탭 Explorer / Context / Agent를 둔다. 한 번에 하나만 보인다
- `U6.4#3` Context: contexts 목록과 saved views
- `U6.4#7` 용어집: 머리 줄(Glossary, 용어 수, 오른쪽 끝 [Add term])을 둔다. 더하기와 고치기는 그 줄에서 바로 한다(Enter·✓ 저장, Esc·× 취소). Edit과 Delete는 hover 때 보이고, 지우기 확인은 modal이다

## screens-agents (wave 3) — 16줄

- `I3.4#27` 각 agent 정의의 profile 이미지 읽기·올리기 연결
- `U1.3#1` agent editor의 "Built-in instructions (read only)"
- `U1.3#2` agent editor와 Agents 탭의 Permissions 칸
- `U1.3#3` 새 탭(`+`) 메뉴의 Agents 항목 (같이 닿음: screens-project)
- `U1.5#10` Settings › Agents의 "Model for summaries"
- `U2.3#3` sidebar의 Agents 묶음
- `U2.3#23` Agents 탭의 lophn 카드 (같이 닿음: screens-project)
- `U2.3#24` agent editor의 지침 블록 (같이 닿음: screens-project)
- `U2.3#25` Skills 칸(agent editor, Agents 탭, Settings 전역) (같이 닿음: screens-project)
- `U2.3#26` agent editor의 MCP 칸 (같이 닿음: screens-project)
- `U2.3#27` Models 줄(Agents 탭 "Models for this project"의 role별 줄)
- `U2.3#30` Operator 만들기와 목록
- `U2.5#6` Settings › Agents의 Default models
- `U3.3#1` agent grant 할당 화면
- `U3.3#2` 내장 skill 표시
- `U3.3#3` agent 층 MCP server 붙이기

## screens-app-space (wave 3) — 36줄

- `I3.9#1` 앱 화면 annotate mode의 main 쪽
- `U1.4#2` Activity 탭의 automation·activation 호출자 문구
- `U1.4#3` Connections 탭의 앱 쌍 허락·회수 흐름과 4초 poll
- `U1.4#6` Version 탭의 Task 확인 줄(`fact-task`)과 version ↔ ticket 읽기
- `U1.4#7` 준비됨·실패 Version의 [Use this version]과 "결정을 기다리는 중"
- `U1.4#8` Data 탭 전체(Export 단추와 준비·실패 문구 포함)
- `U1.4#9` Issues 탭의 네 줄 구별(고쳤다는 주장, 실제 테스트, 내가 확인함, 미확인), repair ticket·claim 줄, `fixing` 상태, 닫힘 근거 4종
- `U1.4#10` Issues 탭의 fixed, not_fixed, not_visible 단추와 한 줄 이유 입력
- `U1.4#11` [I tried it again] 단추
- `U1.4#12` release 쪽 문구
- `U2.3#2` role 이름 Context Engineer (같이 닿음: wording-split)
- `U2.4#1` 앱 운영 패널의 탭
- `U2.4#2` Access 탭(앱 grant)
- `U2.4#3` Activity 탭 행
- `U2.4#4` 앱 상세 wording
- `U2.4#5` Version 탭의 Version 카드
- `U2.4#6` Version 탭의 "what changes"
- `U2.4#7` Issues 탭 상태 이름과 색
- `U2.4#8` Issues 탭 상세
- `U2.4#9` Issues 목록
- `U2.4#10` 제보 dialog (같이 닿음: contract-releases-problems, contract-shell, screens-data)
- `U2.4#12` 앱 place에서 앱 열기(앱 공간)
- `U2.4#13` 앱 화면 안 문서 보기 slot (같이 닿음: contract-app-calls)
- `U2.4#14` title bar의 agent select
- `U3.4#1` annotate mode
- `U3.4#2` 앱 rewind 확인 panel
- `U3.4#3` rewind 진행과 결과
- `U3.4#4` invocation 세부
- `U3.4#5` 앱 place에서 project 고르기
- `U3.4#6` 이전 release로 돌아가기 단추
- `U3.4#7` activation 진행과 실패
- `U3.4#8` 문제의 재발 표시
- `U3.4#9` 문제의 해결됨·무시 단추
- `U6.6#1` 앱 화면은 위쪽 바 아래 전체를 쓴다. 탭 줄이 없다
- `U6.6#2` agent와 앱 상세는 앱 화면 옆 pane이다. coding 터미널은 그 pane 머리의 탭으로 바꿔 본다
- `U6.6#3` 위쪽 바 오른쪽은 아이콘 단추만 둔다. 순서는 [Annotate, Report(깃발)] | [Agent ▾, 앱 상세] | ⌘이고, 켜진 것은 눌린 모양이다

## screens-workspace (wave 3) — 24줄

- `I3.9#2` annotation 보내기
- `U1.4#4` Tasks 탭 전부([Start] 화면, 새 Task, ticket 취소, 복사할 요청 문장, TUI 상태) (같이 닿음: contract-coding)
- `U1.4#5` coding 연결의 회수·취소·생성 링크 화면
- `U1.5#4` Settings의 notifications panel
- `U1.5#5` Settings Update 탭
- `U1.5#7` Settings 진단 탭의 보안 점검(넓은 grant, 가리지 않은 key)
- `U1.5#8` 설정 상세의 효력 시점 줄
- `U1.5#9` 확장 설정 편집의 revision 비교
- `U1.5#11` 문구: Workspace Documents와 series
- `U1.5#12` 문구: 문서 정리, export, place 단계
- `U2.1#6` route 모양
- `U2.3#22` 팔레트의 문서 묶음
- `U2.5#1` Workspace의 화면 구성
- `U2.5#2` Projects 화면
- `U2.5#3` Apps 화면
- `U2.5#4` Settings General 탭
- `U2.5#7` Settings coding agent panel
- `U2.5#8` Settings coding의 IPC와 source (같이 닿음: contract-coding, contract-shell)
- `U2.5#9` coding 문구
- `U2.5#10` Settings 진단 panel
- `U2.6#1` 런처 project 카드와 등록 dialog
- `U3.5#1` Settings의 reaction grant
- `U3.5#2` 필수 설정이 비었을 때의 안내
- `U6.7#1` sidebar 줄(Projects, Apps, Settings와 하위 항목)은 40px 높이로 넉넉하게 둔다

## cleanup (wave 4) — 0줄


