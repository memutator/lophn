---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---

# lead handoff (2026-10-09 18:15 기준)

다음 orchestrator(lead)가 이 팀을 이어 받을 때 알아야 하는 것. 무엇을 만들지는 `docs/plan/`이 정하고,
여기는 운영 방법·현재 상태·함정만 적는다. 숫자와 PR 목록은 작성 시각 기준이니 시작할 때
`node docs/tmp/plan-count.js now`와 `gh pr list`로 다시 본다.

## 0. 멈춘 이유와 다시 시작할 때

- 2026-10-08 ~22:06 Claude Code 세션이 rate limit으로 종료됐다. 그 뒤 Devin CLI가 lead를 이어 받아
  batch 25·26을 merge하고 멈춘 WIP를 전부 commit·push로 보존했다.
- 2026-10-09 ~00:05 subagent 주간 사용량 한도가 끝나 이어가기 worker(T41·T27)가 중단됐다. 지금 돌고
  있는 worker·검사·cron은 없다.
- 2026-10-09 17:30 박스 lead가 로컬로 넘겼다. 사람 지시: "추가 배치는 하지 말고 지금 작업을 다 merge하고 알려줘."
  로컬 lead가 열린 부분 PR 6개를 merge했다(§6). 새 worker는 띄우지 않는다.
- 다시 시작하면 §6을 본다. 사람이 배치를 다시 허용하기 전에는 ready task를 시작하지 않는다.

## 1. 사람이 정한 운영 규칙

- 사람에게는 한국어로 답한다. 개발 용어는 영어 그대로 쓴다(AGENTS.md). 번역어(잎, 장부, 시험 등)를 만들지
  않는다. plan 줄에 worker가 "시험:"이라고 쓰면 "테스트:"로 고친다.
- lead는 직접 기능을 만들지 않는다. worker를 띄우고, PR을 리뷰하고, merge한다. **merge 권한은 전부
  위임돼 있다(2026-10-08 재확인)**. merge 검사에서 걸린 작은 것(쓰지 않는 import, test 기대값, fmt)
  은 lead가 PR branch에 직접 고쳐 넣어도 된다.
  - 단, lead 자신의 PR(#457 이 handoff)은 permission classifier가 [Self-Approval]로 `gh pr merge`를
    거절한다. 우회하지 말고 사람에게 merge를 요청한다.
- 한도가 있을 때는 놀고 있는 worker가 없게 한다. PR 하나를 처리할 때마다 시작할 수 있는 task를 다시
  계산해 바로 띄운다(`docs/tmp/lead-tools/ready.js`).
- **구현에 집중**(2026-10-06). 리뷰에서 돌려보내는 기준은 보안 경계(범위 밖 노출, 권한 우회), 저장 안 된
  blob의 가짜 hash, 테스트 실패, task 완료 기준 미달뿐이다. 나머지는 이어보냄을 받아들인다.
- **test 생략**(2026-10-07, 기계 메모리 고갈 뒤). worker는 `worker-common.md`의 "test 생략"을 따른다:
  자기가 쓰거나 고친 `_test.ts`만 파일 단위로, `memwait.sh`로. npm check·e2e·Electron은 task가 요구할
  때만 `heavy.sh`로. 넓은 회귀는 lead의 batch 검사가 한 번 맡는다.
- full `deno task check`는 아무도 돌리지 않는다. lead는 batch마다 `light-check.sh`만 돈다.
- 진행도는 `.dev-data/progress-log.md`(git 무시)에 `docs/tmp/progress-snap.sh`로 남긴다. 사람에게
  진행도를 말할 때는 이 log와 `plan-count.js "<시각>"`로 git 이력에서 계산한다. 어림으로 말했다가
  사람에게 지적받은 적이 있다.
- plan 파일 끝에 새 Q 항목을 더하지 않는다. 결정은 그 task 블록 안 줄로 적는다.

## 2. worker 배정 (사람 지시, 2026-10-08)

| 일 | subagent_type | 비고 |
|---|---|---|
| **전부** | `glm-flash-max` | 10-08 사람 지시로 sonnet-high 기본 폐기. glm만 쓴다 |

- 동시 worker는 6개까지.
- 지시문은 좁고 명시적으로 쓴다(파일 자리·완료 기준·돌릴 test 파일·금지 사항). 큰 파일은 부분 읽기,
  test 출력은 줄이라고 적는다(context 한도 대책).
- worker 프롬프트 첫 줄은 항상 "Don't use the Agent tool or spawn subagents. Do the work yourself in
  your own worktree." 그리고 `AGENTS.md` → `docs/tmp/worker-common.md` → `docs/dev/team-brief.md` →
  자기 task 블록 순서로 읽게 한다.
- permission classifier가 `&&`로 이은 git 명령을 거절한다. 프롬프트에 "one plain command per shell
  call"을 넣는다.
- **glm worker는 큰 task 끝에서 보고 없이 context 한도로 멈추는 일이 반복됐다**(10-08 하루에
  T53·T20·T34·T41·T58·T27 여섯 번). 멈추면 worktree의 commit·미commit을 보고 lead가 WIP
  commit·push한 뒤, 조사 결과와 남은 일을 넘겨 **같은 worktree/branch에서 이어가는 worker**를
  띄운다(이어가기 worker는 자기 worktree가 아니라 그 자리에서 일했다).
- **E2E·큰 task는 "PR을 먼저 열고 산출물마다 push"로 지시한다.** E2E flow 하나가 glm에게 ~30분이라
  14개를 한 번에 맡기면 context 한도를 두 번 넘는다(T41). apps#T27은 8 flow를 한 번에 맡겨 1316
  tool·82분에 산출물 0으로 끝났다 → "flow 하나(use-app-command)로 PR을 먼저"라는 지시로 좁혔다.
- 바뀐 것이 없는 worktree는 agent가 끝나면 지워진다. 같은 worker를 다시 부를 때 worktree가 없으면
  새 worker를 띄운다.
- 끝난 worker가 "background work still running"으로 다시 깨어나 같은 보고를 되풀이하면 TaskStop으로
  멈춘다(한도만 쓴다).
- 선행 풀기(사람 결정): shell#T53, problems#T22, coding-agent#T45는 contract와 fake로 먼저 만들었고,
  선행(problems#T20·T21)이 merge되면 실제로 잇는 작은 PR을 따로 낸다. 그 PR이 들어가야 상태를 완료로
  바꾼다.
- 미룸(사람 결정): platform#T49(macOS·Windows), coding-agent#T48(오프라인 MCP),
  lophn-agent#T54·T55·T56(실제 model eval과 eval 환경 구축 전부. 다시 넣으라는 말이 없으면 eval 관련
  코드·fixture·`deno task eval`을 만들지 않는다). plan-count와 ready.js가 빼고 센다. **미룸 표시는
  아직 #457에만 있다 — main의 plan 파일에는 없음.**

## 3. 반드시 지키는 안전 규칙

- 실제 사람 데이터 root(`~/.lophn`, `~/.config/lophn`)와 harness home(`~/.claude`, `~/.codex`,
  `~/.gemini` 등)을 열거나 쓰지 않는다. core·shell·worker는 항상 `LOPHN_HOME=$(mktemp -d)`.
  hook·skill 설치 test는 temp HOME과 temp harness 폴더만.
- 실제 OS keychain·secret-tool, 전역 단축키, autostart, OS notification을 건드리지 않는다. 사람의
  app-control autostart와 다른 project(att)도 건드리지 않는다.
- Electron은 headless만. 직접 띄운 정확한 pid만 죽인다.
- legacy repo는 읽기만. `docs/intent/`는 사람만 고친다.
- `git stash` 금지. main에 force push·이력 재작성 금지. `lead/merge-batch`는 lead 전용이라
  `reset --hard origin/main` 해도 된다.
- 테스트는 실제 model provider(tools/fake-provider)나 실제 coding agent 제품을 부르지 않는다.
  저장하지 않은 blob의 가짜 hash 금지. redaction은 core known-values 통로로.
- worker가 거절당한 명령을 lead가 대신 돌리지 않는다(permission laundering).

## 4. 도구

lead가 쓰는 사본은 `.dev-data/lead-tools/`(git 무시, 이 기계에 남는다)에 있다. 잃으면
`docs/tmp/lead-tools/`의 사본을 그리로 복사한다(경로가 그 자리로 박혀 있다).

| 파일 | 쓰임 |
|---|---|
| `.dev-data/merge-queue.txt` | 승인된 PR 대기열. 한 줄에 `pr\|worktree 이름\|review 문구` |
| `integrate.sh` | `.claude/worktrees/merge-batch`(branch `lead/merge-batch`)에 origin/main 위로 대기열 PR branch를 차례로 합친다. `SKIP="436 445"`로 뺄 PR. plan 파일 충돌은 양쪽을 남기고, 코드 충돌은 그 PR을 건너뛰고 알린다. 먼저 `git reset --hard origin/main` 하고 돌린다 |
| `light-check.sh` (docs/tmp) | fmt·lint·deps·contract coverage·deno check·docs check, 바뀐 폴더 test, core tripwire, shell npm check. `LIGHT_TEST_TIMEOUT`(기본 900초)를 받는다 |
| `heavy.sh <cmd>` | 동시 2개 flock, MemAvailable 8GB 대기, `systemd-run --user --scope` 8G 상한으로 돌린다. light-check는 `heavy.sh env -u LOPHN_HOME LIGHT_TEST_TIMEOUT=2400 docs/tmp/light-check.sh > .dev-data/logs/check-batchN.log`로 background |
| `memwait.sh <cmd>` | 6GB 대기, 4G 상한. 파일 하나짜리 test용 |
| `rerun-failed.sh <log>` | log의 `=> ./x_test.ts` 실패 파일만 merge-batch에서 하나씩 다시 돌린다 |
| `batch.sh` | `LIST="438 440" MERGE_COMMIT_PRS="438 440" bash batch.sh`. PR마다 `merge-nocheck.sh`(main 합치기, plan 충돌 양쪽 남김, deno.lock 되돌림, push, mergeable 대기, review 코멘트, `gh pr merge --match-head-commit`, branch·worktree 정리)를 부르고 merge된 줄을 대기열에서 지운다 |
| `ready.js` | 선행이 모두 완료인 미완 task 목록(미룸 빼고, 선행 풀기 반영) |
| `next-spawns.md` | spawn·batch·merge 시간순 운영 기록 |
| `plan-count.js "<시각>"\|now`, `progress-snap.sh` (docs/tmp) | 진행도 |

### batch merge 규칙 (사람 승인 2026-10-07)

- 대기열을 크게 묶어 한 번에 검사한다. 검사가 도는 동안 들어온 PR은 다음 batch로.
- 실패하면 전체를 다시 돌리지 않는다. `rerun-failed.sh`로 실패한 파일만 따로 돌려, 통과하면 부하
  탓으로 보고 merge한다.
- 따로 돌려도 실패하거나 정적 검사·shell check가 실패하면 실제 결함이다. 원인 PR만 빼거나 고치고
  나머지는 merge한다.
- 다른 PR이 위에 쌓인 PR은 merge commit으로(`MERGE_COMMIT_PRS`). 쌓인 순서대로 merge한다.
- test가 timeout(rc 124)으로 끊기면 log에 `=>` 줄이 없다. 끊긴 자리 뒤의 test 파일을 따로 모아 다시
  돌린다(같은 PR의 앞부분은 이미 통과).

## 5. 함정 (실제로 겪은 것)

- **log 끝 줄만 보면 놓친다.** `deno lint ... | tail -1`이 "Checked 1 file"만 보여 쓰지 않는 import를
  놓친 적이 있다. `grep -E "^error|Found|실패"`로 본다.
- **core 재시작 test가 줄줄이 "credential 기록이 이미 있고 권한이 다르다"로 실패하면** 새 고정 machine
  credential이 `apps/core/credentials.ts`의 `FIXED_CREDENTIALS`에 없는 것이다(#436).
- **core tripwire**(`packages/platform/responsiveness/core_imports_test.ts`): core module graph에
  동기 file API·압축·외부 fetch가 들어오면 실패한다. #436의 `apps/core/app-revert.ts`가 앱 runtime
  client(unix socket fetch)를 core 안에서 직접 쓴 것이 걸려, 앱 revert command 호출을 감독
  worker(`apps/worker/apps/revert.ts`)로 옮겨 풀었다.
- **shell tsc는 `packages/contracts`를 따라가면 깨진다.** coding 관련 shell 코드는 deno가 검사하는
  자리(`apps/shell/terminal-host` 등)에 둔다(#438).
- 새 route·event·bundle을 더한 PR이 그 목록을 고정한 contract test(`registry_test`, `reverts_test`,
  `document_tools_test`)나 port 모양을 쓰는 다른 test fixture를 안 고치는 일이 잦다. 같은 PR에 고쳐
  넣는다.
- 부하 flaky: core를 띄우는 test가 25초 timeout으로 무더기 실패. 따로 돌리면 통과한다.
- GitHub GraphQL 502, mergeable UNKNOWN은 잠시 뒤 다시. merge-nocheck가 기다린다. `gh pr edit`는
  projectCards deprecation으로 실패할 수 있다 → `gh api -X PATCH repos/memutator/lophn/pulls/<n>`.
- worker의 shell npm check는 `apps/shell/main/desktop/core/deno.lock`을 바꿔 둔다. merge 전에
  되돌린다(merge-nocheck가 한다). `apps/shell/node_modules` symlink가 없으면 ipc의 zod import가
  node test에서 깨진다(merge-batch에는 있다).
- worker가 시작 전 멈추거나 중간에 죽어도 worktree에 찌꺼기(probe 디렉터리 등)를 남긴다. WIP commit
  전에 untracked 목록을 본다.

## 6. 현재 상태 (2026-10-09 18:15)

- 완료 346/362(95%). 인수 시각(17:30)은 345/362, 그 전 lead 인수 때 341/362. 이번 merge로 완료가 늘어난
  task는 shell#T53뿐이다. 나머지 다섯 PR은 상태 줄이 진행이다.
- main `ae07c7b`. 열린 PR은 #457(이 handoff)뿐. merge-queue는 비어 있다.
- 사람 지시(17:30): 추가 배치 금지. 새 worker를 띄우지 않는다. lophn-agent#T54·T55·T56 실제 model eval은
  사람이 미룸 — 시작 금지.
- #457은 docs만. lead self-merge는 거절되므로 사람이 merge한다.

### batch 27 (끝남)

통합 branch에서 light-check(fmt·lint·deps·coverage·deno check·docs·바뀐 폴더 deno test·shell npm check)를
통과시킨 뒤 squash merge했다. `e2e/flow-support.ts`는 #473의 `osNotifyFails`, #479의 `pickFolder`,
#478의 `env`를 같이 두었고, `organize-documents_test.ts`는 #466의 2·3과 #479의 1·6·7을 같이 두었다.

| PR | task | merge | 상태 줄에 남은 것 |
|---|---|---|---|
| #473 | platform#T54 | `14cbe8e` | 진행. backup-and-restore 통과. 남은 flow: catch-up-notifications(전달 상태가 `failed`가 아니라 `unconfirmed`), work-offline, update-lophn, install-lophn |
| #474 | apps#T27 | `7ae8666` | 진행. restore-app-release 통과. new-app은 `e2e/flows/flow-new-app_test.ts`까지 썼으나 통과 미확인. 남은 flow: new-app의 app test·preview·적용, change-app, run-app-automation, manage-app-permissions, use-app-command, connect-apps, ask-app-hint |
| #479 | documents#T21 | `7200475` | 진행. first-project 1·2·4, organize-documents 1·6·7 통과. edit-document 8은 overlay dialog를 못 찾아 시험을 뺐다. restore-document 1의 agent run 근거·옛 이름·파일 없음 갈래는 미착수 |
| #466 | lophn-agent#T41 | `72e74f6` | 진행. 끝낸 flow: connect-provider, manage-provider-accounts, steer-agent-work, answer-question(답 확정 제외), resume-agent-session, review-agent-work, ask-lophn-help(1~4·미루기), add-agent-extension 2~4, view-agent-visuals(앱 카드 제외). `ignore`인 미검증: organize-documents 2~3, find-documents 5~6, project-workspace 8, add-agent-extension 1 폴더 등록. 제품 결함으로 막힌 시험도 `ignore` |
| #478 | coding-agent#T41 | `737d047` | 진행. connect-coding-agent, manage-tickets, start-coding-agent 통과. 남은 것: new-app, fake harness TUI, 일곱 adapter fixture. keychain 성공 갈래와 manage-coding-access는 통로가 없어 범위 밖 |
| #477 | shell#T53 | `ae07c7b` | 완료. Issues 결정을 ApplyProblemDecision과 확인 창에 잇는다. `basis.versionKnown`은 `issueViewOf`의 last_release가 아니라 apps/get 활성 release로 덮어쓴다. text가 null인 문제는 unavailable |

lead가 PR branch에 고친 것(lint·fmt·이름): #466 쓰지 않는 import·`SECRET_INTENT`, #474 `new-app_test.ts`가
`new-` 접두라 `flow-new-app_test.ts`로 변경하고 쓰지 않는 `post` 삭제, #478 쓰지 않는 `dump`, #477
`problem-decision_test.ts` fmt.

이번 E2E가 같이 고친 제품 결함 5건은 위 PR에 들어갔다: backup 목록 read, restore cancel 뒤 plan 잔존,
restore 뒤 reconnect, versions 탭 시작 확인 refresh, app decision `compare`.

### 검사에서 본 것

- 저장소 `deno fmt`은 통과했는데 shell npm check의 `deno fmt`은 `apps/shell/main` 기준으로 한 파일을
  더 감싼다. shell 파일을 건드리면 그 fmt로 본다.
- `docs/tmp/light-check.sh`의 deno test 한계는 900초로 박혀 있고 `LIGHT_TEST_TIMEOUT`을 무시한다.
  이번 통합 시험은 그 값을 읽는 로컬 수정으로 2400초에 돌렸다(commit하지 않음). apps/core가 들어오면
  900초를 넘길 수 있다.
- 알려진 환경 실패·flaky는 §7의 60·61·65·70. 이번 로컬 light-check의 deno test와 shell check는 통과했다.

### READY (2026-10-09 18:15 `ready.js`, 미배정)

사람이 배치를 막았다. 시작하지 않는다.

- 진행 PR이 merge된 뒤에도 남은 flow가 있어 READY: platform#T54, apps#T27, documents#T21, documents#T27,
  lophn-agent#T41, coding-agent#T36, coding-agent#T41, problems#T23(#447, shell#T53 merge 뒤에도 남은
  갈래가 상태 줄에 있다).
- 상태 줄이 없는 READY: coding-agent#T46, problems#T26.
- problems#T24·T25는 #477 merge만으로 열리지 않았다. `ready.js`에 없다.

### 다음에 할 일

1. 사람이 #457을 merge한다.
2. 사람이 배치를 다시 허용하기 전에는 worker를 띄우지 않는다. 허용되면 `ready.js`와 각 상태 줄의 남은
   flow부터 하고, 아래 제품 결함(§7의 68·69·64·67·71)이 E2E를 막고 있다.

## 7. 알려진 남은 구멍

이어보낸 것 전체는 `.dev-data/followups.md`(git 무시)에 있다. 1~55는 그 파일, 56~73은 2026-10-09 박스
기록이다.

- 52: #453 test-runner kind가 RequestTest 실행과 problems.work 반응기를 같은 child에서 돈다. 실제 가동 확인.
- 53: `apps/worker/apps/revert.ts`가 사람 Bearer token을 감독 channel로 받아 `apps/connect`를 부른다.
- 54: #470 `LinkProblemInterpretation`은 agent actor만 받는데 revert는 user/machine 자격이다.
- 55: #469 product core test가 verification·release 행을 SQLite에 직접 seed한다. 49가 T41 E2E에서 재현됨
  (`ports.wait`가 question 갈래를 부르지 않아 질문을 만든 run이 끝나고 `questions/answer`가 거절된다).
- 56: #472 e2e가 가짜로 깨뜨린 앱을 쓴다.
- 57: 같은 앱의 다른 탭이 process를 공유한다는 단언이 없다.
- 58: #471 `closure.confirmation`은 `ApplyProblemDecision@<basis_seq>` 참조이고, handle `target_ref`는 choice 값이다.
- 59: 세션 없는 run이 `model_calls` CHECK에 거절된다. harness/usage migration이 필요하다.
- 60·61: 환경 실패. 박스에서 `problems-app-test-fixtures`·`problems-reproduction-fixtures`·`problems-test-run`
  ("프로세스 메모리 경계를 강제할 수 없다")와 `terminal/coding/coding-start_test.ts` R4·R12. 번호와 항목의
  짝은 박스 원문. 로컬에서는 통과할 수 있다.
- 62: `ProblemWordingPort`가 `apps.ts` reader에만 등록된다. 배정 필요.
- 63: roles review 근거가 `model_name`을 읽지만 저장 값은 `name`이라 모델 이름이 빠진다.
- 64: 저장한 지침이 model call에 안 실린다(`product-driver.ts`의 instruction-files stub). edit-instructions 4단계가 막힌다.
- 65·70: flaky(단독 통과). `builtin-write-flow_test.ts`의 tickets#R3, `desktop/core/byte-routes_test.ts`.
  번호 짝은 박스 원문. shell/main test는 `--config=desktop/core/deno.json`이 필요하다.
- 66: settings가 core 준비 전 [Connect]를 거절한다.
- 67: 설정 변경 질문의 선택지에 변경이 실리지 않는다(`draftSubmission`이 runtime에 없다).
- 68: 제품 runtime이 외부 MCP에 닿지 못한다. `agent-runtime.ts` `specFor`가 `mcpServers`를 넘기지 않고, HTTP는
  `fetch`와 `--allow-net`이 없다. approve-action과 add-agent-extension 5단계가 막힌다.
- 69: `release.prepare` finalizer가 없다. `prepare_bundle` → app test 통과 → `release.prepare`를 잇는 core
  호출자가 없어 new-app이 실제 core로 끝까지 못 돈다.
- 71: 등록한 skill 폴더를 제품이 검사하지 않는다(`discoverSkills` 제품 경로 없음).
- 72: answer 메시지가 run이 저장한 문서를 결과 링크로 싣지 않는다. review-agent-work의 결과 링크 단언은 결함 수정 뒤 다시 확인.
- 73: edit-document 8 overlay dialog를 시험이 못 찾았다. 시험 구동인지 제품인지는 아직 모른다.
- 아직 열린 큰 것: 33(coding agent hook 대상 사람 확인), 35·36(repair diff·이미지 redaction), 42(agent
  임시 글 streaming 통로 없음), 43(ReproductionScenario builder 없음), 44(launcher가 core 준비 뒤에도
  "getting ready"에 멈춤), 45(문제 알리기 dialog 시작 전 실패·재전송), 47~50(#448).
