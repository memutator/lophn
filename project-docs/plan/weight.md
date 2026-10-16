# 무겁게 짠 것

worker가 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳이다. lead가 worker 보고의 "무겁게 짠 것"에서 덧붙인다. 대부분 요구가 시킨 것이라 merge를 막지 않았다.

사람이 보고 줄일지 정한다. 줄이기로 하면 diet task로 옮기고 항목을 지운다. 남기기로 하면 이유를 그 자리 주석으로 옮기고 항목을 지운다.

항목 꼴: `## <task id> (<commit>)` 아래에 무엇을 넣었나 / 왜 넣었나(worker 말) / 줄인다면 / 어디.

## releases-problems-activation (`4200c006`)

- **앱별 activation 대기열(메모리)과 30초 재시도.** `ApprovalDecided`·`TicketVerified` 뒤 줄에 세우고 차례가 오면 시작한다. 차례가 왔을 때 비교를 다시 보고, 허락한 비교와 달라졌으면 다시 묻는다.
  - 이유: 같은 앱에 activation이 겹치지 않게 하고, 허락과 실제 시작 사이의 변경을 잡는다.
  - 줄인다면: 앱마다 한 번에 하나만 받고 나머지는 `conflict`로 거절한다. 재시도는 없앤다.
  - `core/apps/releases/activation/{queue,handler,orchestrator}.ts`
- **끊긴 시도 이어받기.** 차례가 온 release가 `activating`이면 새로 시작하지 않고 `recoverActivation`으로 잇는다. 실패 code는 `start_failed`.
  - 줄인다면: 기동 때 `activating`은 모두 실패로 닫고 복구본으로 되돌린다.
  - `activation/recovery.ts`
- **실패 순서.** 복원을 확인한 뒤 먼저 기록하고 그다음 이전 release를 시작한다(크래시 뒤 복구본으로 두 번 덮지 않게).
- **migration 단계마다 새 표의 PRIMARY KEY 검사**, `-- loss:` 줄 파싱(`lossOfStepSql`).
- **복구본 보존**: `permanent` + `eraseBlobRefs`, data worker는 앱 폴더에 최근 하나만 둔다.
- `complete`가 같은 tx에서 `syncAppGrants(..., "granted")`, `discardBackups`, revision `max(head seq, 현재+1)`.

## router-calls (`67cdf598`)

- **commit 뒤 할 일(after-commit) 길.** writer Worker의 tx가 할 일을 모아 `CommandSuccess.after_commit`에 싣고 main이 입력함·Bus에 적용한다. 되돌린 tx나 재전달이면 버린다.
  - 이유: 입력함·Bus가 main thread에 있고 command는 Worker에서 돈다(lead 결정).
  - 대안이 마땅치 않다. 남기는 쪽 추천.
  - `storage/ledger/after-commit.ts`, `writer-worker.ts`, `run-loop/work.ts`의 `createInboxApplier`
- **본문과 고정 문구를 writer 앞 처리기에서 blob으로 미리 준비.** call 본문(redaction 포함), 실패 문구, 취소 알림, `receiver_ended` 문구.
  - 이유: 받는 session 기록의 본문이 blob이어야 하고 tx 안에서 blob을 못 만든다.
  - 줄인다면: 고정 문구는 blob 대신 짧은 inline 글로 기록한다(계약 변경 필요).
  - `main/daemon/wiring/router.ts`
- **켤 때 `RecoverCalls`**: `accepted`이고 아직 안 가져간 call을 `lophn_restarted`로 닫고 보낸 session에 알린다.
- **배달 실패를 보낸 쪽 종류별로 다르게 돌려준다**(사람은 오류 code, program·coding agent는 `call: null` 결과, agent는 `kind: reply` + 고정 영어 문구).
  - 줄인다면: 모두 오류 code 하나로.
- Router·command·read를 요청마다 만들고, Worker가 `router-registration.ts`를 import할 때 `RouterEnvironment`를 전역에 놓는다.

## coding-agent-tickets (`f7de4c64`)

- **ticket 표 6개**(`tickets`, claims, `ticket_completions`, `ticket_check_results`, `ticket_verdicts` 등). 보고마다 check 결과 한 줄, 확인 결과 한 줄(불변).
  - 줄인다면: 완료 보고와 결과를 한 표의 열로 합친다.
- **ticket마다 revision**(1부터, 바뀔 때마다 증가), claim_seq, completion_seq.
- `ticket.cancel`이 transport의 active·waiting call을 찾아 멈춘다.
- check는 test를 다시 돌리지 않고 기록된 Verification만 읽는다(이건 가벼운 쪽으로 간 결정).

## coding-agent-cli (`3cc8abe3`)

- **`harness install`·`refresh`의 Deno 권한을 입력 경로 하나로 좁힌다.** launcher가 같은 argv를 launch-entry에 주고, 절대 경로이고 `..`·쉼표·개행이 없을 때만 `--allow-read/write`를 더한다. `refresh`는 감지한 실행 파일에만 `--allow-run`.
  - 이유: coding agent가 부르는 CLI라 권한 경계.
  - 경계라 남기는 쪽 추천. 다만 install engine이 아직 없어 지금은 `unavailable`이다.
- **텍스트 출력의 data fence**: 공백 없는 짧은 token이 아닌 문자열은 모두 fence 안에 둔다.
- `mutates` 칸을 명령 이름 마지막 단어(`READ_WORDS`)로 가른다.

## approvals-tool-judgment (`42bdf70f`)

- 허락 뒤 `resolve`를 한 번 더 불러 intent를 다시 만들고 `consumeTurnAllow`에 넘긴다(허락과 실행 사이 변경을 잡는다). spec 요구.

## screens-app-space-frame (`8c5d5790`)

- **project 고르기 scrim**: view를 project 없이 먼저 열고, state의 `project`가 null이면 scrim을 얹고 `useViewCover`로 native view를 숨긴다.
- **native view 위 toast 두 길**: `overlay`가 있으면 overlay `notification` 표면, 없으면 DOM `Toast`.
  - 줄인다면: overlay 하나로.
- 터미널 요청은 `request.coding.app === app`일 때만 pane에서 받는다.

## screens-conversation-view (`be54a797`)

- 보낸 말을 `accepted`(접수됨)로 남겼다가 확정 메시지가 오면 지운다(`DraftStore`).
- panel 층(rewind·권한·recap)을 `layer` state 하나로.
- 새 session 입력 메모리 key `new:role:name:place`.

## screens-workspace-screens (`ccb2cb38`)

- **project 등록 slug 재시도**: 화면은 이름만 받고 core-source가 slug를 만들어 `conflict`면 `-2`…`-5`로 다섯 번까지 다시 보낸다.
  - 줄인다면: `project.create`의 `name`을 core가 정하게 한다(계약 변경, worker 요청).

## screens-contexts-overview (`75393aa4`)

- fake source가 보관·rollback을 메모리에서 실제로 돌린다(gallery용).

## test 준비 코드

- test 수는 적다(task당 1~4개). 다만 준비 코드가 길다: `apps/calls/calls_test.ts` 344줄(test 3개), `approvals/approvals_test.ts` 336줄, `apps/rewind/rewind_test.ts` 279줄, `approvals/gate/gate_test.ts` 250줄.
  - 줄인다면: 공용 ledger fixture 하나로 모은다(cleanup 때).

## 확인 비용

- 화면 task 셋이 http server + headless chrome으로 gallery 스크린샷을 찍었다. 이후 지시문에서 뺐다.

## agent-definition-prompt (`8d99ad5c`)

- **`SeenBasis`와 turn 사이 diff notice.** 지침 층별 hash, tool 이름 목록, context `{name, version, glossary hash}`, agent 목록을 turn마다 남기고, 바뀌면 Added/Removed notice와 새 전문을 붙인다.
  - 이유: spec이 "바뀐 것만 알린다"를 요구한다. 이름을 목록으로 둔 것은 더해지고 빠진 것을 쓰기 위해서다.
  - 줄인다면: 바뀌면 place 블록 전체를 다시 싣고 diff는 없앤다.
  - `prompt-assembly/{basis,turn-prompt}.ts`
- **context 글 예산을 세 단계로 줄인다**(full → names → count, lophn은 names부터).
  - 줄인다면: 예산을 넘으면 이름만.
- cache marker를 role·instructions·place 셋에 단다.

## places-sessions-contexts-authority (`48e20be9`)

- **위반 키 집합 비교용 새 표 `context_violation_keys`**(context마다 JSON 한 행). 이전에 없던 키 `[kind, rule, path, section]`가 생길 때만 `ContextViolationFound`를 낸다.
  - 이유: 같은 위반으로 PM을 반복해서 깨우지 않는다(spec).
  - 줄인다면: 위반 수가 늘 때만 event를 낸다(새 표 없이 `violation_mark` 열 하나).
  - `core/projects/contexts/ledger/rows-violations.ts`, `api/commands-violations.ts`

## agent-tools-file (`37adb7c8`)

- **file tool 상한이 많다**: read 300줄·24 KiB·10 MiB, pdf 20쪽·쪽당 6000자, 이미지 5 MiB, glob 200개, grep 100줄·줄당 300자. 각각 이어 읽기 안내 문구가 있다.
  - 이유: model 문맥을 지킨다. spec이 상한을 요구한다.
  - 줄인다면: 바이트 상한 하나와 안내 문구 하나로.
- 경로 판정이 symlink·끊어진 symlink·새 파일의 상위 realpath까지 본다. 권한 경계라 남기는 쪽 추천.

## agent-definition-agents (`f49718b5`)

- Operator 정의 파일을 place 폴더를 훑어 찾는다(`findOperator`, ref에 place가 없어서).
  - 줄인다면: ref에 place를 싣는다(계약 변경).

## agent-definition-models (`93a37352`)

- 즐겨찾기 compare 기준용 표 `model_favorites_seq(one, seq)` 한 줄. event 대신이다.

## agent-tools-shell-web (`99df84b1`)

- shell을 새 process group(`setsid`)으로 띄워 시간 초과 때 group째 죽인다. 상한 120/600초, stream마다 1 MiB.
  - 줄인다면: 출력 상한을 더 낮춘다(1 MiB 둘이면 model에 2 MiB까지 간다).
- `web.fetch` redirect를 hop마다 대상 검사하며 직접 따라간다(최대 5번). 금지 대역 표가 길다. 권한 경계라 남기는 쪽 추천.

## agent-definition-extensions (`4da65e2d`)

- MCP tool 이름이 wire 규칙에 안 맞거나 64자를 넘으면 hash 8자를 붙여 줄인다.
- 끌 수 없는 내장 skill과 같은 이름의 사람 skill은 `skipped`에 이유와 함께 남긴다.

## annotation-core (`d506d353`)

- **command 넷(`AnnotationPersist/Discard/AddRefs/Sweep`)과 ref 표, 24시간 sweep, 1시간 유예.** memory route라 ledger를 못 써서 사람 자격으로 command를 다시 낸다.
  - 줄인다면: annotation을 메시지 본문에만 남기고 별도 표·sweep을 없앤다(ticket 근거가 annotation을 직접 가리키지 않게).
- source map으로 bundle 위치를 source 위치로 푼다.

## coding-agent-harness (`38a4f62b`)

- **설치 hash 기록(`.lophn/installed.json`)과 "사람이 고쳤으면 안 덮기".** skill은 파일마다, hook JSON은 lophn 항목만 접은 hash.
  - 이유: 사람이 고친 설정을 지키는 것은 데이터 보호 쪽이다. 남기는 쪽 추천.
- harness 7종(claude, codex, gemini, pi, opencode, hermes, openclaw)의 감지·설치 표.
  - 줄인다면: MVP는 claude 하나만.

## coding-agent-session (`e5c029ad`)

- **메모리 대신 ledger 표 셋(`coding_sessions`, `coding_lines`, `coding_inputs`)과 machine command `ApplyCodingSignal`.** writer·reader Worker가 같이 보고 tx와 같이 되돌아가야 해서다. 켤 때 비운다.
  - 줄인다면: coding session을 main thread 한 곳에만 두고 core 읽기는 그쪽에 묻는다(Worker 경계를 넘는 port가 필요).
- 앱마다 coding session 하나와 call 줄, 실패 이유 여섯 가지.

## events-reactor (`438d8734`)

- Reactor의 backoff(1~30초)와 5초 poll 안전망, handler 이름 중복 검사. spec의 "두 번 반응하지 않는다"를 위한 것이라 남기는 쪽 추천.

## coding-agent-settings (`c8129c42`)

- harness 감지 결과를 shell main 메모리에 쥐고, 실패한 결과는 쥐지 않아 다음 읽기가 다시 감지한다. 가벼운 쪽이다.

## places-sessions-contexts-drafts (`12027baf`)

- **초안을 ledger가 아니라 data root 아래 폴더(`drafts/<bundle>/bundle.json`)에 두고, 제출 때 검사해 판으로 확정.** PM이 file tool로 직접 고치게 하려는 것이라 가벼운 쪽이다.
- **저장 목차(`outlines/<sha256(path)>.json`, revision으로 낙관적 잠금)와 outline kind.** md 아닌 문서의 목차를 사람이 적는 길이다. 아직 worker에 닿지 않아 쓰이지 않는다.
  - 줄인다면: 저장 목차 전체를 빼고 md 목차만.
- `bundle.test_draft`가 worker가 있으면 overlay로 검사를 끝까지 돌리고, 없으면 `running`을 낸다.

## places-sessions-rewind (`367d98e3`)

- **pre-image를 core가 읽어 두는 memory route 둘(`StageRewindFile`, `RecordRewindWrite`)과 root별 기록, 같은 상대 경로가 두 root에 있으면 `chain_broken`.** 파일 되돌리기의 정확성(데이터 보호)이라 남기는 쪽 추천.
- **앱 rewind 요청(`rewind_apps` 표, background, accepted/applied/rejected).** 지금은 wiring이 없어 늘 rejected.
  - 줄인다면: MVP는 앱 rewind를 빼고 파일·대화만 되돌린다(`apps` 입력과 표를 지움).
- 숨김 구간을 `reverts.result_seq`(session 마지막 메시지 순번)로 잡는 규칙.

## fix-runtime-gate (`18cc5fd3`)

- Gate 물음과 ask 기다림을 core main thread 메모리 route 둘로(runtime은 긴 호출 한 번). 꺼졌다 켜지면 사라진다. 가벼운 쪽이다.

## releases-problems-bundle (`293e0d88`)

- **npm·jsr 의존을 준비 때 vendor로 받아 bundle에 통째로 담기(`vendor/`, `node_modules/` symlink 풀기, 예약 path 거절).** 앱이 network 없이 뜨게 하려는 것이다. bundle 크기가 커진다.
  - 줄인다면: MVP는 npm·jsr 의존을 막고 sdk·@me만 허용.
- activation 요청 읽기(`approval-reads.ts`)를 approval 표를 직접 읽는 임시 구현으로 두었다.

## releases-problems-template (`0abc69e6`)

- **jsx-runtime을 가로채는 esbuild plugin이 SDK component마다 `new Error().stack`으로 위치를 읽어 `data-lophn-at`을 싣는다.** annotation이 화면 요소를 source 위치로 잇는 길이다. 개발·release build 둘 다에 들어간다(fix-app-build). 렌더마다 stack을 만드는 비용이 있다.
  - 줄인다면: annotation은 화면 위치(selector)만 남기고 source 위치 잇기를 뺀다.

## 문서 정리 때 찾은 것

- **ledger `domainOnly` 옵션.** 목록 밖 type의 emit을 거절하는 방어 장치인데 wiring 어디서도 켜지 않는다. 주석은 켜진 것처럼 쓴다.
  - 줄인다면: 지운다. 남기면 daemon wiring에서 켜고 주석을 맞춘다.
  - `core/storage/ledger/tx.ts`
- **`wrapUntrusted` 둘.** `prompt-assembly/input-tags.ts`와 `run-loop/untrusted.ts`에 같은 것이 있다. web tool은 앞의 것을 쓴다.
  - `core/lophn-agent/`
- **App Engineer active context 읽기.** `agents/layers.ts`가 읽지만 `visibleContexts`가 App Engineer에 아무것도 보여 주지 않아 쓰이지 않는다.
- **deferred tool.** assemble과 `tool.search`가 지원하지만 `run-loop/prepare.ts`가 어떤 tool에도 켜지 않는다.
- **core module 규칙과 어긋난 import.** 다른 module의 `mod.ts`가 아닌 파일 import 59건(`apps`, `projects`, `problems`, `lophn-agent`에는 `mod.ts`가 없다), domain module끼리 18건(problems→apps 12), 바닥→domain 1건(`storage/blobs/child-prepare.ts`→`problems/register.ts`), module→`core/main` 8건. check가 없어 쌓였다.
- **400줄 넘는 파일 86개** (가장 긴 것 1274줄).
- **`protocol/apps/direct-socket.ts`의 흔적.** core를 지나지 않던 앱 직통 통로는 지웠는데, supervisor 제어 경로 상수를 re-export하는 파일이 남아 `protocol/apps/mod.ts`가 내보낸다.
  - 줄인다면: 쓰는 곳을 supervision protocol로 바로 잇고 지운다.
