---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---

# lead handoff (2026-10-09 00:15 기준)

다음 orchestrator(lead)가 이 팀을 이어 받을 때 알아야 하는 것. 무엇을 만들지는 `docs/plan/`이 정하고,
여기는 운영 방법·현재 상태·함정만 적는다. 숫자와 PR 목록은 작성 시각 기준이니 시작할 때
`node docs/tmp/plan-count.js now`와 `gh pr list`로 다시 본다.

## 0. 멈춘 이유와 다시 시작할 때

- 2026-10-08 ~22:06 Claude Code 세션이 rate limit으로 종료됐다. 그 뒤 Devin CLI가 lead를 이어 받아
  batch 25·26을 merge하고 멈춘 WIP를 전부 commit·push로 보존했다.
- 2026-10-09 ~00:05 subagent 주간 사용량 한도가 끝나 이어가기 worker(T41·T27)가 중단됐다. 지금 돌고
  있는 worker·검사·cron은 없다.
- 다시 시작하면 §6 "다음에 할 일" 순서로 간다. WIP는 전부 push돼 있으니 worktree가 지워져도
  branch에서 복구된다(아래 "남은 WIP" 표).

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

## 6. 현재 상태 (2026-10-09 00:15)

- 완료 341/362(94%). Devin CLI 구간 merge 6개: #464(T53)·#465(T34)·#467(T58)·#468(T57)·#469(T20)·
  #470(T50). 그 전 12개(#436·#445·#453–#456·#458–#463)는 아래 이력대로.
- merge-queue 비어 있음. `lead/merge-batch` local은 `f1012d99`(batch 26 통합본, push 안 함).

### 열린 PR

| PR | task | 상태와 남은 일 |
|---|---|---|
| #457 | 이 handoff (+eval 미룸) | docs만. 사람 merge 필요(lead self-merge 거절됨) |
| #466 | lophn-agent#T41 agent flow E2E | **부분 PR**(진행 표시). 완료 flow 4/14: connect-provider·manage-provider-accounts·steer-agent-work·answer-question. head `c79ae09e`에 미검증 WIP `resume-agent-session_test.ts`(602줄) 포함 — 다음 worker가 통과 확인부터 |

### batch 25·26 (끝남)

- batch 25: #464의 lint·fmt 3파일을 lead가 고쳐 push → 통과 → #464 `fe70b28`·#465 `abfd9f0` merge.
- batch 26: #467·#468·#469·#470 통합 `48eb9ddc` → light-check 실패 → `rerun-failed.sh`로 재현 확인
  (context-revert·document-tools·revert·wording check 단독 실패). 원인 둘을 lead가 PR branch에 고쳐
  push: #467 `fcc5293f`(`isosOf` unused, settings.backup heading 3개 마침표), #470 `78187bb6`
  (`AGENT_OPERATIONS`의 `document.get` 중복 — `LinkProblemInterpretation` 보조 operation으로 이미
  들어와 `acceptTestCredential`의 duplicate operation에 걸렸다). 재통합 `f1012d99` → 통과 → 4개
  merge(`8f3718c`·`4411d6a`·`fe60307`·`26e5786`).

### 남은 WIP (전부 push됨 — worktree가 지워져도 branch에서 복구)

| task | branch | head | 상태 |
|---|---|---|---|
| lophn-agent#T41 | `lophn-agent/t41-agent-flow-e2e` (PR #466) | `c79ae09e` | flow 4개 완료 + resume-agent-session 미검증 WIP. 남은 ~9: review-agent-work, approve-action(앱 confirm 제외), ask-lophn-help, edit-instructions, add-agent-extension, view-agent-visuals(앱 카드 제외), organize-documents 2~3단계, find-documents 5~6단계, project-workspace 8단계. 질문 답 확정 경로는 제품 결함(followups 49)으로 이어보냄 |
| apps#T27 | `apps-slice-flow-e2e` (PR 없음) | `8668e77b` | WIP commit: `e2e/flows/probe-restore_test.ts`·`restore-app-release_test.ts` + `app-decisions.ts`의 `compare:{}` 수정(envelope schema가 요구 — 실제 제품 결함일 수 있음, 다음 worker가 확인). plan은 8개 flow 필요: new-app·change-app·restore-app-release·run-app-automation·manage-app-permissions·use-app-command·connect-apps·ask-app-hint |

### 남은 task (미완 ~21, 미룸 5 빼고)

- PR 있음: lophn-agent#T41(#466 부분), apps#T27(branch만)
- **핵심 경로 다음 단계**: problems#T20이 merge됐으므로 problems#T21이 READY. T21 merge 뒤
  coding-agent#T45·problems#T22·shell#T53의 "실제 data에 잇는 연결 PR"과 problems E2E T24·T25·T26이
  열린다(ready.js 확인).
- 진행(남은 단계는 상태 줄 참고): coding-agent#T36·T45, documents#T21·T27, problems#T22·T23(#447),
  shell#T53
- 미착수: coding-agent#T41·T46·T47, platform#T54, problems#T24·T25·T26, shell#T48

### 다음에 할 일 (다시 시작할 때 순서)

1. `gh pr list`, `node docs/tmp/plan-count.js now`, `node .dev-data/lead-tools/ready.js`로 숫자 확인.
2. T41 worker: `resume-agent-session_test.ts` 통과 확인 → 나머지 flow 하나씩 commit·push(#466 계속).
3. T27 worker: `8668e77b`의 app-decisions compare 수정이 제품 결함인지 확인부터 → flow 하나씩 PR.
   좁은 지시(한 번에 flow 하나)를 지킨다 — glm은 8개를 한 context에서 못 끝낸다.
4. problems#T21 worker — 핵심 경로.
5. `ready.js`로 빈 slot 채운다(6개까지). worker는 glm-flash-max만.

## 7. 알려진 남은 구멍

이어보낸 것 전체는 `.dev-data/followups.md`(git 무시, 번호 1~53)에 있다. 이번 구간에 닫힌 것·새 것:

- 닫힘: 40(RequestTest 제품 실행 경로 → #456), 51(#436 core 안 앱 fetch → 감독 worker `apps/revert`로
  옮겨 merge).
- 새 것 52: #453의 test-runner kind가 RequestTest 실행(stdout JSON)과 problems.work 반응기(감독 pipe
  envelope)를 같은 child에서 돌린다. 경합은 없어 보이나 실제 가동으로 확인(problems#T22 wiring 때).
- 새 것 53: `apps/worker/apps/revert.ts`가 사람 Bearer token을 감독 channel로 받아 `apps/connect`를
  부른다 — worker 전용 machine 자격으로 바꾸고 token 전달을 없애는 편이 낫다. worker kind 자체
  `_test.ts`도 없다(lophn-agent 후속).
- 새 것 54: #470의 `LinkProblemInterpretation`은 agent actor만 받는데 그 revert는 user/machine 자격으로
  부른다 → 제품 경로에서 revert가 forbidden이 될 수 있다. 결정 필요: actor 인가를 넓히거나 revert를
  assignment 범위 agent 자격으로 부르게 한다. (lophn-agent#T50 이어보냄)
- 새 것 55: #469(problems#T20)의 product core test가 verification·release 행을 SQLite에 직접 seed한다
  (실제 lifecycle 아님). review에서 test fixture 한정으로 받았으나 실제 경로로 만드는 followup.
- 확인됨: followups 49(끝난 run의 질문에 답할 수 없음)를 T41 E2E가 실제로 재현했다 — `ports.wait`가
  `{tool_call, approval}`만 받아 `WaitRun`의 question 갈래를 아무도 부르지 않아 질문을 만든 run이
  곧바로 끝나고 `questions/answer`가 "the run is finished"로 거절된다. answer-question의 답 확정
  경로는 이 결함으로 검증 불가였다.
- 아직 열린 큰 것: 33(coding agent hook 대상 사람 확인), 35·36(repair diff·이미지 redaction), 42(agent
  임시 글 streaming 통로 없음), 43(ReproductionScenario builder 없음 — reproduction 실행이 걸림),
  44(launcher가 core 준비 뒤에도 "getting ready"에 멈춤 — lophnCore.subscribe 재생 없음), 45(문제
  알리기 dialog 시작 전 실패·재전송 규칙), 47~50(#448: document.create 자리 검증, 정기 run
  question.submit, 끝난 run 질문, Toolkit.lookups 미연결).
