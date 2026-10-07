---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---

# lead handoff (2026-10-07 20:00 기준)

다음 orchestrator(lead)가 이 팀을 이어 받을 때 알아야 하는 것. 무엇을 만들지는 `docs/plan/`이 정하고,
여기는 운영 방법·현재 상태·함정만 적는다. 숫자와 PR 목록은 작성 시각 기준이니 시작할 때
`node docs/tmp/plan-count.js now`와 `gh pr list`로 다시 본다.

## 0. 멈춘 이유와 다시 시작할 때

- 2026-10-07 19:1x 사람 지시: "주간 한도 임박 이유로 추가적인 Task 진행은 하지 않는다". 새 worker를 띄우지 않았고, 막 띄운 worker 둘(lophn-agent#T47, coding-agent#T35)은 멈춰 WIP를 push했다. 이미 돌던 worker는 끝까지 받아 PR로 남겼고, lead는 승인된 PR의 merge만 마무리했다.
- 지금 돌고 있는 worker·검사·cron은 없다.
- 사람이 다시 시작하라고 하기 전에는 새 task를 띄우지 않는다. 시작하면 6절 "다음에 할 일" 순서로 간다.

## 1. 사람이 정한 운영 규칙

- 사람에게는 한국어로 답한다. 개발 용어는 영어 그대로 쓴다(AGENTS.md). 번역어(잎, 장부, 시험 등)를 만들지 않는다. plan 줄에 worker가 "시험:"이라고 쓰면 "테스트:"로 고친다.
- lead는 직접 기능을 만들지 않는다. worker를 띄우고, PR을 리뷰하고, merge한다. merge 권한은 lead에게 위임돼 있다. merge 검사에서 걸린 작은 것(쓰지 않는 import, test 기대값, fixture 한 줄)은 lead가 PR branch에 직접 고쳐 넣어도 된다.
- 한도가 있을 때는 놀고 있는 worker가 없게 한다. PR 하나를 처리할 때마다 시작할 수 있는 task를 다시 계산해 바로 띄운다(`docs/tmp/lead-tools/ready.js`).
- **구현에 집중**(2026-10-06). 리뷰에서 돌려보내는 기준은 보안 경계(범위 밖 노출, 권한 우회), 저장 안 된 blob의 가짜 hash, 테스트 실패, task 완료 기준 미달뿐이다. 나머지는 이어보냄을 받아들인다.
- **test 생략**(2026-10-07, 기계 메모리 고갈 뒤). worker는 `worker-common.md`의 "test 생략"을 따른다: 자기가 쓰거나 고친 `_test.ts`만 파일 단위로, `memwait.sh`로. npm check·e2e·Electron은 task가 요구할 때만 `heavy.sh`로. 넓은 회귀는 lead의 batch 검사가 한 번 맡는다.
- full `deno task check`는 아무도 돌리지 않는다. lead는 batch마다 `light-check.sh`만 돈다.
- 진행도는 `.dev-data/progress-log.md`(git 무시)에 `docs/tmp/progress-snap.sh`로 남긴다. 사람에게 진행도를 말할 때는 이 log와 `plan-count.js "<시각>"`로 git 이력에서 계산한다. 어림으로 말했다가 사람에게 지적받은 적이 있다.
- plan 파일 끝에 새 Q 항목을 더하지 않는다. 결정은 그 task 블록 안 줄로 적는다.

## 2. worker 배정 (사람 지시, 2026-10-07)

| 일 | subagent_type | 비고 |
|---|---|---|
| 기본(대부분의 task, 제품 연결·화면 포함) | `sonnet-high` | glm보다 완료 기준을 지키고 제품에 실제로 잇는다 |
| 범위가 좁고 할 일이 분명한 task(한 module·한 test 파일, 제품 연결 없음)만 | `glm-flash-max` | 오래 돌다 멈추는 일이 잦았다. 3시간 가까이 돈 glm worker 셋을 사람 지시로 멈추고 sonnet-high로 넘긴 적이 있다(handoff는 `.dev-data/handoffs/`) |

- 동시 worker는 6개까지.
- worker 프롬프트 첫 줄은 항상 "Don't use the Agent tool or spawn subagents. Do the work yourself in your own worktree." 그리고 `AGENTS.md` → `docs/tmp/worker-common.md` → `docs/dev/team-brief.md` → 자기 task 블록 순서로 읽게 한다.
- permission classifier가 `&&`로 이은 git 명령을 거절한다. 프롬프트에 "one plain command per shell call"을 넣는다.
- 바뀐 것이 없는 worktree는 agent가 끝나면 지워진다. 같은 worker를 다시 부를 때 worktree가 없으면 새 worker를 띄운다.
- 끝난 worker가 "background work still running"으로 다시 깨어나 같은 보고를 되풀이하면 TaskStop으로 멈춘다(한도만 쓴다).
- 선행 풀기(사람 결정): shell#T53, problems#T22, coding-agent#T45는 contract와 fake로 먼저 만들었고, 선행(problems#T20·T21)이 merge되면 실제로 잇는 작은 PR을 따로 낸다. 그 PR이 들어가야 상태를 완료로 바꾼다.
- 미룸(사람 결정): platform#T49(macOS·Windows), coding-agent#T48(오프라인 MCP), lophn-agent#T54·T55·T56(실제 model eval과 eval 환경 구축 전부. 다시 넣으라는 말이 없으면 eval 관련 코드·fixture·`deno task eval`을 만들지 않는다). plan-count와 ready.js가 빼고 센다.

## 3. 반드시 지키는 안전 규칙

- 실제 사람 데이터 root(`~/.lophn`, `~/.config/lophn`)와 harness home(`~/.claude`, `~/.codex`, `~/.gemini` 등)을 열거나 쓰지 않는다. core·shell·worker는 항상 `LOPHN_HOME=$(mktemp -d)`. hook·skill 설치 test는 temp HOME과 temp harness 폴더만.
- 실제 OS keychain·secret-tool, 전역 단축키, autostart, OS notification을 건드리지 않는다. 사람의 app-control autostart와 다른 project(att)도 건드리지 않는다.
- Electron은 headless만. 직접 띄운 정확한 pid만 죽인다.
- legacy repo는 읽기만. `docs/intent/`는 사람만 고친다.
- `git stash` 금지. main에 force push·이력 재작성 금지. `lead/merge-batch`는 lead 전용이라 `reset --hard origin/main` 해도 된다.
- 테스트는 실제 model provider(tools/fake-provider)나 실제 coding agent 제품을 부르지 않는다. 저장하지 않은 blob의 가짜 hash 금지. redaction은 core known-values 통로로.
- worker가 거절당한 명령을 lead가 대신 돌리지 않는다(permission laundering).

## 4. 도구

lead가 쓰는 사본은 `.dev-data/lead-tools/`(git 무시, 이 기계에 남는다)에 있다. 잃으면 `docs/tmp/lead-tools/`의 사본을 그리로 복사한다(경로가 그 자리로 박혀 있다).

| 파일 | 쓰임 |
|---|---|
| `.dev-data/merge-queue.txt` | 승인된 PR 대기열. 한 줄에 `pr|worktree 이름|review 문구` |
| `integrate.sh` | `.claude/worktrees/merge-batch`(branch `lead/merge-batch`)에 origin/main 위로 대기열 PR branch를 차례로 합친다. `SKIP="436 445"`로 뺄 PR. plan 파일 충돌은 양쪽을 남기고, 코드 충돌은 그 PR을 건너뛰고 알린다. 먼저 `git reset --hard origin/main` 하고 돌린다 |
| `light-check.sh` (docs/tmp) | fmt·lint·deps·contract coverage·deno check·docs check, 바뀐 폴더 test, core tripwire, shell npm check. `LIGHT_TEST_TIMEOUT`(기본 900초)를 받는다 |
| `heavy.sh <cmd>` | 동시 2개 flock, MemAvailable 8GB 대기, `systemd-run --user --scope` 8G 상한으로 돌린다. light-check는 `heavy.sh env -u LOPHN_HOME LIGHT_TEST_TIMEOUT=2400 docs/tmp/light-check.sh > .dev-data/logs/check-batchN.log`로 background |
| `memwait.sh <cmd>` | 6GB 대기, 4G 상한. 파일 하나짜리 test용 |
| `rerun-failed.sh <log>` | log의 `=> ./x_test.ts` 실패 파일만 merge-batch에서 하나씩 다시 돌린다 |
| `batch.sh` | `LIST="438 440" MERGE_COMMIT_PRS="438 440" bash batch.sh`. PR마다 `merge-nocheck.sh`(main 합치기, plan 충돌 양쪽 남김, deno.lock 되돌림, push, mergeable 대기, review 코멘트, `gh pr merge --match-head-commit`, branch·worktree 정리)를 부르고 merge된 줄을 대기열에서 지운다 |
| `ready.js` | 선행이 모두 완료인 미완 task 목록(미룸 빼고, 선행 풀기 반영) |
| `plan-count.js "<시각>"\|now`, `progress-snap.sh` (docs/tmp) | 진행도 |

### batch merge 규칙 (사람 승인 2026-10-07)

- 대기열을 크게 묶어 한 번에 검사한다. 검사가 도는 동안 들어온 PR은 다음 batch로.
- 실패하면 전체를 다시 돌리지 않는다. `rerun-failed.sh`로 실패한 파일만 따로 돌려, 통과하면 부하 탓으로 보고 merge한다.
- 따로 돌려도 실패하거나 정적 검사·shell check가 실패하면 실제 결함이다. 원인 PR만 빼거나 고치고 나머지는 merge한다.
- 다른 PR이 위에 쌓인 PR은 merge commit으로(`MERGE_COMMIT_PRS`). 쌓인 순서대로 merge한다.
- test가 timeout(rc 124)으로 끊기면 log에 `=>` 줄이 없다. 끊긴 자리 뒤의 test 파일을 따로 모아 다시 돌린다(같은 PR의 앞부분은 이미 통과).

## 5. 함정 (실제로 겪은 것)

- **log 끝 줄만 보면 놓친다.** `deno lint ... | tail -1`이 "Checked 1 file"만 보여 쓰지 않는 import 두 개를 놓쳐 batch를 한 번 더 돌렸다. `grep -E "^error|Found"`로 본다.
- **core 재시작 test가 줄줄이 "credential 기록이 이미 있고 권한이 다르다"로 실패하면** 새 고정 machine credential이 `apps/core/credentials.ts`의 `FIXED_CREDENTIALS`에 없는 것이다(#436).
- **core tripwire**(`packages/platform/responsiveness/core_imports_test.ts`): core module graph에 동기 file API·압축·외부 fetch가 들어오면 실패한다. test child 진입 module을 core가 import하는 `mod.ts`에서 re-export한 경우(#442·#446), core 안에서 앱 runtime client를 직접 쓴 경우(#436)가 있었다.
- **shell tsc는 `packages/contracts`를 따라가면 깨진다.** coding 관련 shell 코드는 deno가 검사하는 자리(`apps/shell/terminal-host` 등)에 둔다(#438).
- 새 route·event·bundle을 더한 PR이 그 목록을 고정한 contract test(`registry_test`, `reverts_test`, `document_tools_test`)나 port 모양을 쓰는 다른 test fixture를 안 고치는 일이 잦다. 같은 PR에 고쳐 넣는다.
- 부하 flaky: core를 띄우는 test가 25초 timeout으로 무더기 실패. 따로 돌리면 통과한다.
- GitHub GraphQL 502, mergeable UNKNOWN은 잠시 뒤 다시. merge-nocheck가 기다린다.
- worker의 shell npm check는 `apps/shell/main/desktop/core/deno.lock`을 바꿔 둔다. merge 전에 되돌린다(merge-nocheck가 한다). `apps/shell/node_modules` symlink가 없으면 ipc의 zod import가 node test에서 깨진다(merge-batch에는 있다).

## 6. 현재 상태 (2026-10-07 20:00)

- 완료 324/359(90%, 미룸 5개 제외). 오늘 기록: 18:20 316 → 19:45 324. eval 세 task를 미룬 뒤 전체가 362에서 359로 줄었다.
- 돌고 있는 worker·검사·cron 없음. `lead/merge-batch`는 지난 batch 그대로라 다음 batch 전에 reset한다.

### 열린 PR

| PR | task | 상태와 남은 일 |
|---|---|---|
| #436 | lophn-agent#T48 앱 revert | 리뷰 통과했으나 merge 검사에서 뺐다. lead가 고정 credential·test 기대값은 고쳐 push했다(`748138c3`). **남은 결함:** `apps/core/app-revert.ts`가 core 안에서 앱 runtime client(unix socket fetch)를 써 core tripwire에 걸린다. 앱 revert command 호출을 다른 앱 호출처럼 worker·invocation 경로로 옮겨야 한다(followup 51) |
| #445 | shell#T30 roles 화면 | 리뷰 통과. main과 `apps/core/core.ts`(+ plan 두 파일) 충돌. #455가 이미 #445를 합치며 같은 충돌을 풀었으니 참고 |
| #453 | problems#T19 work reaction·해석 연결 | **리뷰 안 함.** core.ts·tickets.ts·credentials.ts·writer-assembly.ts까지 고쳤다. worker 보고: 실제 core checker가 repair ticket의 problem target `revision`을 "open"으로 보내 `record_checks`가 거절한다(coding-agent#T45로 넘김). 제품 core에 `PROBLEM_STATUSES_PORT`가 없어 repair ticket 생성이 test 밖에서 막힌다 |
| #454 | coding-agent#T33 배포 skill | **리뷰 안 함.** skill 네 개, manifest, `skills install` 권한 planner(skill 폴더 단위 read·write) |
| #455 | shell#T54 Operator 화면 | **리뷰 안 함.** #445를 포함한다(#445 다음). 상태를 완료로 달았지만 실제 core에서 승인된 붙이기가 적용되지 않는다: `ApplyOperatorAssignment`가 machine 전용이라 user apply가 forbidden, `decision_seq` 자리표시 "1", `approval.submit_assignment` 입력 모양 불일치(lophn-agent#T53로 넘김). 완료로 둘지 리뷰에서 정한다 |
| #456 | followup 40 RequestTest 제품 실행 경로 | **리뷰 안 함.** #442·#446은 main에 들어갔다. #446과 같은 core graph 고침을 다른 방식(`child-types.ts`)으로 해 main과 충돌할 것이다. main(#446, `failure-path.ts`) 쪽을 따른다. core에서 coding agent reproduction claim을 검사한다. reproduction 실행은 `RequestTest`에 ReproductionScenario가 없어 `preparation_failed`로 끝나고(가짜 없음), agent가 고정 test hash를 얻을 통로가 없다(coding-agent 결정 필요) |

### 멈춘 WIP (PR 없음, branch push됨)

- lophn-agent#T47: branch `worktree-agent-a87eea81af0e4153f`(`8863afa9`). app-context judgment와 test 일부. 멈출 때 하던 일: "app_panel kind와 executeTool 인자 순서 test 고치기".
- coding-agent#T35: branch `worktree-agent-a02c45df5defe12c1`(`b7b9d321`). core summary handler·CLI·MCP를 고치던 중. 멈출 때 하던 일: "selectedWriteFiles 주석, dispatch의 hookArgv·version 연결".
- 이어갈 때는 sonnet-high에게 branch에서 시작하라고 하고 `git log origin/main..`과 task 블록을 대조하게 한다.

### 남은 task (2026-10-07 20:00, 미완 35)

- 진행(선행 풀기·연결 PR·남은 단계는 각 상태 줄): coding-agent#T36·T45, problems#T22·T23, shell#T53, documents#T21·T27
- PR 있음: lophn-agent#T48(#436), shell#T30(#445), problems#T19(#453), coding-agent#T33(#454), shell#T54(#455)
- WIP: lophn-agent#T47, coding-agent#T35
- 아직 시작 안 함: apps#T27, coding-agent#T34·T41·T46·T47, lophn-agent#T16·T38·T40·T41·T50·T53·T57, platform#T54, problems#T20·T21·T24·T25·T26, shell#T48·T58·T59
- 핵심 경로: problems#T19(#453) → T20 → T21이 들어가야 선행 풀기 세 task의 연결 PR과 problems E2E(T24·T25)가 열린다. lophn-agent#T53(Operator)은 #455의 넘어온 것을 받는다.

### 다음에 할 일 (다시 시작할 때 순서)

1. `gh pr list`, `node docs/tmp/plan-count.js now`로 숫자 확인.
2. #453 → #454 → #456 리뷰(완료 기준·요구 대조). #445 충돌 정리 뒤 #455 리뷰. 통과한 것을 대기열에 넣고 한 batch로.
3. #436은 앱 호출 경로를 고칠 sonnet-high worker에게(followup 51).
4. WIP 둘(lophn-agent#T47, coding-agent#T35) 이어서 끝내기.
5. ready.js로 빈 자리를 채운다. problems#T20은 #453 merge 뒤.

## 7. 알려진 남은 구멍

이어보낸 것 전체는 `.dev-data/followups.md`(git 무시, 번호 1~51)에 있다. 아직 열린 큰 것:

- 33: coding agent status hook·plugin 대상이 실제 제품에서 맞는지 사람 확인 필요.
- 35·36: repair context의 source diff 전체, 이미지 첨부 redaction.
- 42: agent 대화 임시 글 streaming 통로(core→main→renderer)가 없다.
- 43: 문제의 원래 Report에서 ReproductionScenario를 만드는 builder가 없다(#456의 reproduction 실행이 여기에 걸림).
- 47~50(#448에서): `document.create`가 없는 project 자리에도 성공, 정기 run의 `question.submit` 거절, 끝난 run의 질문, 불확실한 내장 write 결과 조회 미연결.
- 51: #436 core 안 앱 fetch.
