# screens-app-space-detail

앱 공간의 운영 패널(앱 상세) 탭 넷(Version, Access, Activity, Issues)을 wireframe 코드 `app-space/`에서 renderer `app-frame/app-detail/`로 옮긴다. activation 진행·이전 release로 돌아가기, 바깥 자원 거두기, 호출 기록과 rewind panel, 문제 상태 단추를 새로 얹고 Connections 탭과 옛 결정 흐름을 지운다. renderer와 fake source까지 이 task의 일이고, gallery 연결은 다음 task(`screens-app-space-frame`)가 한다.

- 단위: screens-app-space (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/app-frame/app-detail/`
  - `packages/design/wording/catalog/app-space.ts` (wording-split이 만든 file. 다음 task `screens-app-space-frame`도 같은 file을 고친다. 이 task가 먼저다. 소유 바꾸기 요청: `ownership.md`의 screens-app-space에 더한다)
  - `packages/design/wording/catalog/app-space.placeholders.ts` (`generate.ts`가 만드는 생성물)
- 읽을 것:
  - spec: S5 5장(invocation 기록), 7장(rewind), 11장 1·2·3 — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/app-call.md`
  - spec: S7 6장(묻는 조건), 7장(순서), 8장(이전 release로 돌아가기) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/activation.md`
  - spec: S2 4장(앱 grant: 보고 거두는 화면은 앱 상세) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - inventory: `U1.4#2`, `U1.4#3`, `U1.4#6`, `U1.4#7`, `U1.4#8`, `U1.4#9`, `U1.4#10`, `U1.4#11`, `U1.4#12`, `U2.4#1`, `U2.4#2`, `U2.4#3`, `U2.4#4`, `U2.4#5`, `U2.4#6`, `U2.4#7`, `U2.4#8`, `U2.4#9`, `U3.4#2`, `U3.4#3`, `U3.4#4`, `U3.4#6`, `U3.4#7`, `U3.4#8`, `U3.4#9`
  - 결정: `../README.md` 3장 #18·#23·#57 (이름: `command` → app-api, `run` → turn)
  - 본보기(화면):
    - `tools/wireframes/frames/compositions/app-space/version-tab.tsx` → `app-detail/versions/versions-tab.tsx`
    - `tools/wireframes/frames/compositions/app-space/access-tab.tsx` → `app-detail/access/access-tab.tsx`
    - `tools/wireframes/frames/compositions/app-space/activity-tab.tsx` → `app-detail/activity/activity-tab.tsx`
    - `tools/wireframes/frames/compositions/app-space/rewind-panel.tsx` → 새 `app-detail/activity/rewind-panel.tsx`
    - `tools/wireframes/frames/compositions/app-space/issues-tab.tsx` → `app-detail/issues/issues-tab.tsx`
    - `tools/wireframes/frames/compositions/app-space/parts.tsx` (`Pill`, `EffectPill`, `Section`, `Facts`, `Note`, `Mono`) → 새 `app-detail/parts.tsx`
    - `tools/wireframes/frames/compositions/app-space/data.ts` (가짜 data: release, 바깥 자원, 호출 기록, 문제)
    - `tools/wireframes/frames/compositions/app-space/app-space.module.css`
- 계약:
  - 쓰는 것:
    - `protocol/apps`의 invocation 기록(호출자 종류, project, 효과, 결과 모름), changeset·rewind 요청·계획·결과 type. contract-app-calls(wave 2)가 둔 이름을 쓴다. 모양은 S5 5·7장.
    - `protocol/apps`의 activation 상태와 선언 비교(늘어난 선언, migration 손실 단계). contract-releases-problems가 둔 이름을 쓴다. 모양은 S7 6·8장.
    - `protocol/problems`의 문제 상태(열림, 해결됨, 무시)와 재발. contract-releases-problems.
    - `protocol/approvals`의 앱 grant 읽기. contract-approvals.
  - 내놓는 것 (`app-space.tsx`와 dev-mock이 쓴다. 이름 유지):
    - `AppDetail`(`app-detail.tsx`), `IssuesTab`(`issues/issues-tab.tsx`), 타입 `AppDetailSource`·`IssuesSource`.
    - fake: `fakeDetail`(`testdata/fake-source.ts`), `fakeIssues`(`issues/testdata/fake-source.ts`). 위치와 이름을 옮기지 않는다.
    - `AppDetail`의 props가 줄어도 `app-space.tsx`(screens-app-space-frame 소유)가 넘기는 `preview`·`onPreview`·`tasks` 같은 prop은 type에서 지우지 말고 보고의 "남긴 prop"에 적는다. frame task가 지운다.

## 할 일

1. **탭을 넷으로 줄인다** — `app-detail.tsx`. 탭은 Version, Access, Activity, Issues다(`U2.4#1`). Connections 탭은 Access에 합친다(둘 다 같은 앱 grant다). wave 1이 지웠을 Automations, Data, Tasks의 흔적(탭, import, `decision-end.ts`가 가리키던 것)이 남았으면 지운다. `connections/` 폴더는 이 task가 지운다(`U1.4#3`: 앱 쌍 허락·회수 흐름과 4초 poll `POLL_MS`).
2. **source를 새 모델로 고친다** — `source.ts`, `model.ts`.
   - 지운다: `VersionRow.ticket`·`tests`, `TaskChecks`·`taskChecks`·`taskChecksText`(`U1.4#6`), `AppDecision` 전체와 `decide`·`onUnconfirmed`(확인 창 통로. screens-data가 확인 창을 지운다), `turnOffAutomation`, `exportApp`(`U1.4#8`), automation 관련(`BlueprintAutomation`, `AutomationsView`, `automations`), `Comparison`의 automation 칸, `use_version`·`connect_apps` 계열.
   - 더한다: Version — activation 상태(적용 중 단계, 적용됨, 적용 실패와 이유)와 이전 release 목록(각 data schema)과 `rollback(release)`. Access — 바깥 자원(network host, secret 이름, 파일)과 다른 앱 app-api 줄, `revoke(grant)`와 거두기 상태(요청 접수, 정리 완료). Activity — 호출 기록 줄(호출자: 사람 화면, agent session, 다른 앱, 앱 시작 / project / 효과 read·write·external / 되돌림됨 / 결과 모름 / 대기 write), project 거르기, 한 호출 세부, rewind 계획·시작·진행·결과. 모양은 wireframe `data.ts`의 `Invocation`·`Resource`·`Release`를 source type으로 옮긴다.
   - `core-source.ts`: wave 2 계약(`protocol/apps`, `protocol/problems`)에 route가 정의된 새 method는 그 route를 부른다(core의 handler가 아직 없어도 된다. 붙이는 것은 통합 단계다). 계약에 route가 없는 method만 `{ ok: false, code: "unavailable" }`로 답한다. 새 route를 만들지 않는다. 이미 route가 있는 읽기(versions, blueprint, access, runtime)는 그대로 부른다.
3. **Version 탭** — `versions/versions-tab.tsx`(526줄)를 wireframe `version-tab.tsx`대로 다시 짠다. (`U2.4#5`, `U2.4#6`, `U3.4#6`, `U3.4#7`, `U1.4#7`)
   - 지운다: [Use this version] 단추와 `choose`·`canUse`·`requested`, "결정을 기다리는 중", Task 확인 줄(`fact-task`), 준비됨 Version 카드. 사람은 release를 고르지 않는다.
   - 보인다: 지금 release 카드(상태 Applied, 적용 시각, commit, data schema). 적용 중이면 "Being applied" 카드: 단계 목록(새 호출 멈춤, 도는 호출 기다림, 이전 process 종료 확인, migration, 새 release 시작 확인)과 "이전 release가 계속 응답한다". 적용 실패면 이유와 이전 release가 남아 있다는 말과 App Engineer가 이어받는다는 말(`U3.4#7`, S7 7장).
   - "What changes, rA to rB": 늘어난 선언(network host, 다른 앱 쓰기)과 손실 단계(지우는 표나 칸)만 보인다. 대기 목록 카드의 비교(screens-data)와 같은 모양이다. screens-data의 비교 component가 main에 있으면 import해서 쓰고, 없으면 `versions/changes.tsx`로 만든다(정한 것에 적는다).
   - "Earlier releases": 이전 release마다 [Go back to rN]. 지금 data schema와 같은 것만 켜지고, 다르면 꺼진 채 이유("Data schema vX differs from the current vY"), 적용 중에도 꺼진다. 돌아간 뒤 "Only the app code changed. The database stays as it is."를 그 탭 위쪽 toast로 알린다(`U3.4#6`, S7 8장). toast는 ui-chrome(wave 2)의 design `Toast`를 쓴다.
   - preview 시작·중지 진입점은 wireframe에 없다. `VersionsTab`이 쓰던 `startPreview`·`stopPreview`는 이 탭이 쓰지 않게 되면 source에서 지운다. 다른 곳에서 쓰면 지우지 않고 보고에 적는다.
4. **Access 탭** — `access/access-tab.tsx`(306줄)를 wireframe `access-tab.tsx`대로 바꾼다. (`U2.4#2`, `U1.4#3`)
   - "Access is set when a release is applied. It can only be taken back here, not added." 안내, "Outside resources"(종류 pill, 이름, 자세한 글, [Revoke])와 "Other apps"(다른 앱 app-api).
   - [Revoke]는 확인 창 없이 바로 요청을 접수한다. 줄 아래에 두 단계를 나눠 보인다: "Revoke requested. New calls are blocked."(즉시), "Waiting for the previous process to stop, then the app restarts without it." → 끝나면 "Previous process stopped…"와 Revoked 표시(S2 4장, `terminationPending`).
   - 이 상태는 읽기 갱신이 필요하다. `use-read.ts`의 `pollMs`를 거두기 정리 중일 때만 준다. 이벤트 구독으로 바꾸는 것은 screens-data의 hook이 들어온 뒤의 일이다. `useRead`의 export 이름과 `ReadHandle` 모양을 유지한다.
5. **Activity 탭과 rewind panel** — `activity/activity-tab.tsx`(153줄)를 wireframe `activity-tab.tsx`대로 바꾸고 `activity/rewind-panel.tsx`를 새로 만든다. (`U2.4#3`, `U1.4#2`, `U3.4#2`, `U3.4#3`, `U3.4#4`)
   - 호출 줄: 시각, 호출자(사람 화면 / agent session — 눌러서 그 session을 연다 / 다른 앱 / 앱 시작), project, 효과 pill, 결과, "되돌림됨" 표시. 기다리는 write는 "대기"로 보인다. `whoText`의 `by-automation`·`by-applying`과 `direct/agent/app/automation` 호출자 구분을 새 호출자 종류로 바꾼다(`U1.4#2`).
   - project로 거르는 select와 줄을 펼친 세부(부른 session·turn·tool call, 입력 지문, 결과 요약, 되돌림 기록) — `U3.4#4`, S5 5장.
   - 지금 release의 live write·external·앱 시작 줄에 [Rewind] 시작 단추를 둔다(S5 7장).
   - rewind panel은 확인 창이 아니다. Activity 탭 안에서 같은 탭 본문을 갈아 끼운다(`stage`: `confirm` → `running` → `done` | `conflict`). 확인 단계: 고른 호출부터 최신까지 함께 되돌아갈 줄(시각, 효과, 부른 쪽, 결과 "Will be undone / Won't be undone(external) / Can't be undone(결과 모름 write)")과 개수 요약, "그 앱을 쓴 모두의 변경이 함께 사라진다. 다시 되돌릴 수 없다" 안내. 사람이 [Rewind <앱 이름>]을 눌러야 시작한다. 진행 단계: 새 호출 멈춤, 도는 호출 기다림(어느 호출인지), 한 번에 되돌림. 충돌이면 통째로 취소됐다는 이유. 성공이면 목록을 다시 읽는다(`U3.4#3`, S5 7장·11장 2).
   - 상태가 바뀌는 `running` 동안 `useRead`의 `pollMs`를 쓴다(4번과 같다).
6. **Issues 탭** — `issues/issues-tab.tsx`(481줄), `issues/model.ts`, `issues/source.ts`, `issues/core-read.ts`, `issues/core-source.ts`를 wireframe `issues-tab.tsx`대로 바꾼다. (`U2.4#7`, `U2.4#8`, `U2.4#9`, `U3.4#8`, `U3.4#9`, `U1.4#9`, `U1.4#10`, `U1.4#11`)
   - 상태는 열림·해결됨·무시 셋이고 색은 그에 맞춘다(`statusText`·`statusTone`). 목록은 상태와 기간으로 거르고, 한 줄은 영향 한 문장과 상태다.
   - 상세: 접수 수, 처음·마지막 시각, 발생 목록(시각, release, 앱 오류 / 제보), 근거(원래 source 위치의 stack, log, release와 commit, 제보 글). 재발한 문제는 "해결됨이던 것이 다시 열림"을 이전 해결 시각과 다시 난 release와 함께 나눠 보인다(`U3.4#8`).
   - [Resolved]·[Ignored] 두 단추는 확인 없이 바로 상태를 바꾼다(`U3.4#9`).
   - 지운다: 네 줄 구별(고쳤다는 주장, 실제 테스트, 내가 확인함, 미확인) `IssueTestState`·`testTone`, repair ticket·claim 줄, `fixing` 상태, 닫힘 근거 네 종류, fixed·not_fixed·not_visible 단추와 한 줄 이유 입력(`choose`, `dismissing`, `note`, `choiceOptions`, `decide`), [I tried it again](`tried`, `report-again.ts`, `reportAgain`, `withReportAgain`을 쓰던 `app-space.tsx` 호출은 frame task가 지운다).
   - `windowIssueDecision`(결정 창을 여는 통로, `issues/core-source.ts`)은 지운다. `desktop/entry.tsx`가 import하므로 보고의 "안 쓰게 된 export"에 적는다.
7. **fake source** — `testdata/fake-source.ts`(`fakeDetail`)와 `issues/testdata/fake-source.ts`(`fakeIssues`)를 새 source 모양으로 고치고 wireframe `data.ts`의 Orders 앱 data(release r6·r7, 바깥 자원, 호출 기록, 문제)로 채운다. 적용 중·적용 실패·거두기 정리 중·rewind 각 단계는 fake에 설정 인자로 고를 수 있게 한다(예: `fakeDetail({ activation: "applying" })`). `fakeTasks`는 wave 1이 지웠다. 남았으면 지운다.
8. **wording** — 박아 둔 영어 글을 `catalog/app-space.ts`의 `app-detail.*` key로 만든다(`U2.4#4`, `U1.4#12`). 호출 문구(`did-action`, `by-*`, `mode-*`)와 결정 종류 안내를 새 호출자 종류로 바꾸고 confirm·automation 언급은 쓰지 않는다. 안 쓰게 된 옛 key는 지우지 않는다(4단계 cleanup). 만든 뒤 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 `catalog/app-space.placeholders.ts`를 다시 만든다.
9. **CSS** — `app-detail.module.css`에 wireframe `app-space.module.css`의 해당 규칙(카드, 단계 목록, 줄, 행 오른쪽 끝 단추)을 옮긴다. 탭 안 알림은 색 띠가 아니라 toast(6.1).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 (화면 task. 되돌림 계산과 grant 거두기는 B5·B2 몫이다)
- 남지 않음:
  - `grep -rn "automation\|exportApp\|TaskChecks\|IssueTestState\|reportAgain\|use_version\|connect_apps" packages/shell/renderer/app-frame/app-detail`이 0줄이다.
  - `app-detail/connections/`, `app-detail/data/`, `app-detail/automations/`, `app-detail/tasks/`가 없다.
- (화면) gallery 연결은 `screens-app-space-frame`이 한다. 이 task는 `deno task check`까지다.

## 보고

- 바꾼 file
- 등록할 것: 영역 `app-space`의 새 key와 지운 key. `desktop/dev-mock/app-space.ts`가 부르는 `fakeDetail`·`fakeIssues`의 인자 모양과 `mockTasks` 삭제(screens-workspace-space가 한다), `desktop/entry.tsx`의 `coreAppDetailSource`·`coreIssuesSource`·`windowIssueDecision` import 변화
- 안 쓰게 된 export: `windowIssueDecision`, `withReportAgain`, `AppDecision` 등 (남이 쓰던 것은 지우지 않았다)
- 남긴 prop: `AppDetailProps`의 `preview`·`onPreview`·`tasks`·`initialTab`("tasks")
- 정한 것: source method 이름, 선언 비교 component를 import했는지 새로 만들었는지, preview 진입점 처리, 4·5번의 `pollMs` 사용 범위
- 계약 바꾸기 요청(wave 3): 없음 | 있으면 적는다
