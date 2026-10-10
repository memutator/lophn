---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---

# lead handoff (2026-10-10 plan 359/359 완료 기준)

다음 orchestrator(lead)가 이 팀을 이어 받을 때 알아야 하는 것. 무엇을 만들지는 `docs/plan/`이 정하고,
여기는 운영 방법·현재 상태·함정만 적는다. 숫자와 PR 목록은 작성 시각 기준이니 시작할 때
`node docs/tmp/plan-count.js now`와 `gh pr list`로 다시 본다.

## 0. 멈춘 이유와 다시 시작할 때

- 2026-10-08 ~22:06 Claude Code 세션이 rate limit으로 종료됐다. 그 뒤 Devin CLI가 lead를 이어 받아
  batch 25·26을 merge하고 멈춘 WIP를 전부 commit·push로 보존했다.
- 2026-10-09 ~00:05 subagent 주간 사용량 한도가 끝나 이어가기 worker(T41·T27)가 중단됐다.
- 2026-10-09 17:30 박스 lead가 로컬 grok 세션으로 넘겼다. 사람이 배치를 다시 허용했고("plan 확인하고
  sub agent 병렬 배치해서 plan 완성까지"), 그 세션이 #480~#524를 개별 merge하고 worker를 계속
  채웠다.
- 2026-10-10 ~13:22 grok lead 세션이 rate limit으로 정지됐다. 사람의 마지막 지시: "추가 sub agent
  배치하지 말고 모두 완료되면 handoff 갱신까지만." 이 문서가 그 갱신이다. 지금 돌고 있는
  worker·검사·background job은 없다(PR watch script `~/.grok/long-running-background-tasks/
  lophn_pr_watch.sh`도 죽어 있다). `.dev-data/merge-queue.txt`는 비어 있다.
- 2026-10-10 ~14:2x Devin lead가 죽은 grok worker의 worktree 4개를 이어가는 devin subagent 4개를
  띄웠다. 하나(t21-format)는 끝까지 가서 **PR #525**를 열었고, 나머지 셋은 devin free-model rate
  limit(~14:25 UTC 05:25 reset)으로 중간에 죽었다. 셋의 작업은 전부 WIP commit·push로 보존했다
  (§6 dirty 표). 이어갈 때는 WIP commit 위에서 같은 worktree·branch를 쓴다.
- 2026-10-10 Claude Code lead(Opus 5.5)가 이어 받아 grok·devin worker가 하던 일만 마무리했다
  (사람 지시: worker는 일반 작업 `sonnet-high`, 좁은 task는 haiku). #525 리뷰·merge, 이어가기 worker
  셋(t25-s4 → #527, t24-s4 → #528, t27-terms4 → #526), #489 e2e 재실행(1 passed, 3 steps) 뒤
  main(#521)과의 `apps/core/apps-control.ts` 충돌을 worker가 merge로 풀고 다시 통과 → merge.
  **멈춘 이유: 맡은 목록을 다 끝냈다.** 새 slice·task·eval은 배치하지 않았다. 지금 열린 PR·돌고
  있는 worker·background job 없음.
- merge 권한: 사람이 다시 "merge의 모든 권한을 위임한다"고 했고, classifier가 [Self-Approval]·
  [Merge Without Review]로 merge-nocheck를 거절해 사람이 `.claude/settings.local.json`에 allow
  rule `Bash(bash .dev-data/lead-tools/merge-nocheck.sh *)`를 넣었다. lead가 settings를 직접
  고치는 것은 [Self-Modification]으로 막힌다 — 사람에게 부탁한다.
- 같은 날 사람이 "이후 plan 완성까지 계속 진행"을 지시해 배치를 다시 열었다(slot 제한 없음, worker는
  일반 `sonnet-high`, 좁고 명확한 일은 haiku). 그 뒤 사람이 **"plan 빨리 닫기"를 결정**했다(#573, 남은
  slice E2E 7개 블록의 "정한 것(사람, 2026-10-10 — plan 빨리 닫기)" 줄): flow 주요 단계 통과면 완료,
  다른 갈래·환경 의존(실제 root 설치, OS keychain, node-pty)·followup 결함 ignore 단계는 넘김. app-broken
  6~9단계도 사람 결정으로 제외. **2026-10-10 저녁 359/359 완료**(main `86c4736`). 열린 PR은 이 handoff
  PR(#529)뿐. 돌고 있는 worker·검사 없음.
- 넘긴 것은 전부 `.dev-data/followups.md` 76~100과 아래 §7에 있다. 다음 일은 plan이 아니라 followup
  (제품 결함·미구현)과 실사용 피드백이다.
- 다시 시작하면 §6을 본다. 사람이 배치를 다시 허용하기 전에는 worker를 띄우지 않는다.

## 1. 사람이 정한 운영 규칙

- 사람에게는 한국어로 답한다. 개발 용어는 영어 그대로 쓴다(AGENTS.md). 번역어(잎, 장부, 시험 등)를 만들지
  않는다. plan 줄에 worker가 "시험:"이라고 쓰면 "테스트:"로 고친다.
- lead는 직접 기능을 만들지 않는다. worker를 띄우고, PR을 리뷰하고, merge한다. **merge 권한은 전부
  위임돼 있다(2026-10-08 재확인)**. merge 검사에서 걸린 작은 것(쓰지 않는 import, test 기대값, fmt)
  은 lead가 PR branch에 직접 고쳐 넣어도 된다.
  - 단, lead 자신의 PR은 permission classifier가 [Self-Approval]로 `gh pr merge`를 거절한다.
    우회하지 말고 사람에게 merge를 요청한다(#457은 사람이 merge했다).
- **merge는 deno test 없이 한다**(2026-10-09 사람 지시 "deno test 일단 생략하고 합쳐"). PR마다
  `.dev-data/lead-tools/merge-nocheck.sh`를 순차로 돌린다(§4). batch.sh·integrate.sh·queue는 쓰지
  않는다. bundle deno test를 돌렸다고 말하지 않는다 — 정적 검사와 worker가 자기 `_test.ts`만
  돌린 결과가 전부다. merge-nocheck를 병렬로 돌리면 main checkout의 `git pull`이 race한다.
- 한도가 있을 때는 놀고 있는 worker가 없게 한다. merge·worker 종료마다 빈 slot을 겹치지 않는
  다음 slice로 바로 채운다(2026-10-09 사람 지시 "왜 다음 작업하는 sub agent는 비워두냐고").
  **상태 줄만 겹치는 것은 keepboth로 합치면 되니 slice를 막지 않는다. 코드 파일 겹침만 진짜
  block이다.**
- **구현에 집중**(2026-10-06). 리뷰에서 돌려보내는 기준은 보안 경계(범위 밖 노출, 권한 우회), 저장 안 된
  blob의 가짜 hash, 테스트 실패, task 완료 기준 미달뿐이다. 나머지는 이어보냄을 받아들인다.
- **test 생략**(2026-10-07, 기계 메모리 고갈 뒤). worker는 `worker-common.md`의 "test 생략"을 따른다:
  자기가 쓰거나 고친 `_test.ts`만 파일 단위로, `memwait.sh`로. npm check·e2e·Electron은 task가 요구할
  때만 `heavy.sh`로. 넓은 회귀는 lead가 맡는다.
- full `deno task check`는 아무도 돌리지 않는다. 넓은 검사가 필요하면 lead가 `light-check.sh`로
  한다(10-09 지시로 merge 조건은 아니다).
- 진행도는 `.dev-data/progress-log.md`(git 무시)에 `docs/tmp/progress-snap.sh`로 남긴다. 사람에게
  진행도를 말할 때는 이 log와 `plan-count.js "<시각>"`로 git 이력에서 계산한다. 어림으로 말했다가
  사람에게 지적받은 적이 있다.
- plan 파일 끝에 새 Q 항목을 더하지 않는다. 결정은 그 task 블록 안 줄로 적는다.

## 2. worker 배정 (사람 지시, 2026-10-09 갱신)

| 일 | subagent_type | 비고 |
|---|---|---|
| **전부** | general worker (lead model 상속, `subagent_type`·`model` 생략) | 10-09 사람 지시. `fast-worker` 금지. 10-08의 `glm-flash-max` 지시는 Claude harness 얘기라 grok 세션에는 general-purpose로 적용됐다 |

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
- `git worktree add -b`는 upstream을 origin/main으로 단다. 만들 때마다 `git branch --unset-upstream`
  한다(치는 fatal "no upstream" 메시지가 성공 신호다). push는 `git -C <wt> push -u origin HEAD`.
- flow 하나가 worker 하나의 slice다. PR을 먼저 열고 그 단계만 push하게 지시한다. 이미 돈 단계의 test
  본문은 고치지 않는다고 명시한다.
- 끝난 worker가 "background work still running"으로 다시 깨어나 같은 보고를 되풀이하면 TaskStop으로
  멈춘다(한도만 쓴다).
- 선행 풀기(사람 결정): shell#T53, problems#T22, coding-agent#T45는 contract와 fake로 먼저 만들었고,
  선행(problems#T20·T21)이 merge되면 실제로 잇는 작은 PR을 따로 낸다. 그 PR이 들어가야 상태를 완료로
  바꾼다.
- 미룸(사람 결정): platform#T49(macOS·Windows), coding-agent#T48(오프라인 MCP),
  lophn-agent#T54·T55·T56(실제 model eval과 eval 환경 구축 전부. 다시 넣으라는 말이 없으면 eval 관련
  코드·fixture·`deno task eval`을 만들지 않는다). plan-count와 ready.js가 빼고 센다. 미룸 표시는
  #457 merge로 main의 plan 파일에도 있다.

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
| `merge-nocheck.sh` | **현재 merge 경로**(10-09 지시). `bash merge-nocheck.sh PR worktree-dir "review 문구"`. origin/main을 PR worktree에 합치고(plan만 충돌이면 `docs/tmp/keepboth.py`로 양쪽 남김, 코드 충돌은 exit 3 중단), shell deno.lock을 되돌리고, push, mergeable 대기, review 코멘트, `gh pr merge --squash --match-head-commit`, remote branch·worktree 정리, `git pull --ff-only`까지 한다. exit 5는 push 단계 — 조용히 재시도하면 된다. 병렬 금지, 순차만. MERGE_COMMIT_PRS는 세팅하지 않는다 |
| `.dev-data/merge-queue.txt` | 승인된 PR 대기열. 한 줄에 `pr\|worktree 이름\|review 문구`. merge-nocheck 시대에는 쓰지 않는다(비어 있음) |
| `integrate.sh` | `.claude/worktrees/merge-batch`(branch `lead/merge-batch`)에 origin/main 위로 대기열 PR branch를 차례로 합친다. `SKIP="436 445"`로 뺄 PR. plan 파일 충돌은 양쪽을 남기고, 코드 충돌은 그 PR을 건너뛰고 알린다. 먼저 `git reset --hard origin/main` 하고 돌린다. merge-batch worktree는 stale하니 main처럼 쓰지 않고 push도 하지 않는다 |
| `light-check.sh` (docs/tmp) | fmt·lint·deps·contract coverage·deno check·docs check, 바뀐 폴더 test, core tripwire, shell npm check. `LIGHT_TEST_TIMEOUT`(기본 900초)를 받는다 |
| `heavy.sh <cmd>` | 동시 2개 flock, MemAvailable 8GB 대기, `systemd-run --user --scope` 8G 상한으로 돌린다. light-check는 `heavy.sh env -u LOPHN_HOME LIGHT_TEST_TIMEOUT=2400 docs/tmp/light-check.sh > .dev-data/logs/check-batchN.log`로 background |
| `memwait.sh <cmd>` | 6GB 대기, 4G 상한. 파일 하나짜리 test용 |
| `rerun-failed.sh <log>` | log의 `=> ./x_test.ts` 실패 파일만 merge-batch에서 하나씩 다시 돌린다 |
| `batch.sh` | `LIST="438 440" MERGE_COMMIT_PRS="438 440" bash batch.sh`. PR마다 `merge-nocheck.sh`를 부르고 merge된 줄을 대기열에서 지운다. 10-09 지시로 지금은 쓰지 않는다 |
| `ready.js` | 선행이 모두 완료인 미완 task 목록(미룸 빼고, 선행 풀기 반영) |
| `next-spawns.md` | spawn·batch·merge 시간순 운영 기록 |
| `plan-count.js "<시각>"\|now`, `progress-snap.sh` (docs/tmp) | 진행도 |

### batch merge 규칙 (사람 승인 2026-10-07 — 10-09 "deno test 생략" 지시로 보류, 다시 batch를 쓰면 적용)

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
- `gh pr diff`는 path 인자가 없다. `gh pr diff N > /tmp/prN.diff`로 저장해 본다.
- base branch가 지워진 closed PR은 reopen이 안 된다(#493). 새 branch로 다시 연다(#496).
- Electron e2e의 첫 실패가 esbuild missing이나 ENOENT면 제품 결함이 아니라 환경이다: `npm --prefix
  apps/shell/main ci`가 electron install script를 건너뛰어 `node_modules/electron/dist/electron`이
  없는 것. `node apps/shell/main/node_modules/electron/install.js`로 받고 다시 돌린다.
- `deno check`는 빠르다. 오래 걸리는 것은 apps/core `deno test`다(127개 파일이 startCore, 부하에서
  25초 per-test timeout에 무더기로 죽는 알려진 flaky). 둘을 헷갈려 보고하지 않는다.

## 6. 현재 상태 (2026-10-10 plan 완료)

- **완료 359/359**(`plan-count.js now`). 분모는 미룸 5개(coding-agent#T48, lophn-agent#T54·T55·T56,
  platform#T49)를 뺀 값. main `86c4736`. 열린 PR #529(이 문서, 사람 merge 필요).
- 이번 세션 merge(10-10, 모두 merge-nocheck squash, bundle deno test 안 돌림): #489 #525~#580 (번호가
  빈 것은 없음 — #529만 열림). 완료로 바뀐 task: problems#T23(#541)·T25(#542)·T24(#565),
  coding-agent#T36(#553)·T41(#578), platform#T54(#574), documents#T21(#577)·T27(#575),
  lophn-agent#T41(#579), apps#T27(#580).
- 이번 세션이 고친 큰 제품 결함: ports.wait 질문 대기(#535, followup 49·55), release.prepare 확정기
  (#560, §7-69), 외부 MCP 연결·IPv6·HTTP 인증(#557·#564·#568), 지침 파일 model 입력(#559, run 기준
  permit), 답 결과 링크(#555), skill 발견(#556·#570), 앱 context tool·view_session(#547·#550),
  question 선택지 app_registration·setting_change·document_move(#569·#571), 확인 창 결과 opener 통보
  (#563), shell event 재연결(#572), 오프라인 고정 판 직접 추출·검색 지연 해소(#552), settings 진단 탭
  연결(#545), Q9 refresh probe run 허용(#554, 사람 결정).
- merge 권한: 사람이 `.claude/settings.local.json`에 `Bash(bash .dev-data/lead-tools/merge-nocheck.sh *)`,
  `gh pr ready` allow rule을 넣었다. lead가 settings를 직접 고치는 것은 [Self-Modification]으로 막힌다.
- worker 평가 기록: `.dev-data/worker-eval.tsv`(+ `worker-eval-summary.py`). sonnet-high는 반려
  거의 없음, haiku는 빠르고 싸지만 단독 완결률이 낮다 — 좁은 조사·재실행·문서 정리에 맞다.
- 운영 함정(이번에 겪음): (1) keepboth merge가 plan 상태 줄을 둘로 갈라 첫 줄만 세는 plan-count를
  어긋나게 한다(#564에서 합침) — 상태 줄 충돌은 손으로 하나로. (2) 끝난 worker의 Electron·core 잔여
  process가 heavy.sh lock을 쥐어 다른 e2e가 2시간 대기 — `fuser .dev-data/heavy.*.lock`으로 보고
  worktree가 사라진 쪽의 정확한 pid만 죽인다. (3) apps/core를 고친 worker가 core tripwire를 안 돌려
  main이 깨졌다(#556 → #570) — worker 공통 규칙에 tripwire 필수 추가. (4) worker가 보고 뒤
  background 작업을 쥐고 반복해서 깨어나면 TaskStop.

## 7. 알려진 남은 구멍

이어보낸 것 전체는 `.dev-data/followups.md`(git 무시)에 있다. 1~55는 그 파일, 56~73은 2026-10-09 박스
기록, 74~75는 10-09~10 grok 세션, 76~78은 10-10 Claude Code 마무리 기록이다.

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
- 73: (해소) edit-document 8 overlay dialog를 시험이 못 찾은 것은 제품이 아니라 시험 구동 — `flow.shell.connect`의
  overlay CDP session을 매번 닫아 캐시 연결을 다시 못 읽었다. 제품 경로(tab-strip `[data-close]` →
  `editor.files.leave` → overlay dialog)는 그대로고, #491이 그 갈래를 덮었다.
- 74: shell renderer의 사람 통로 allowlist가 `worker:documents/prepare`를 거절한다(`forbidden`,
  `apps/shell/main/desktop/core/allowlist_test.ts`의 shell/editor#R7이 고정 — 준비 worker는 renderer에
  열지 않는다). `window.lophnEditor.create`도 format을 생략해 첫 판이 implicit로 저장된다. 그래서 지정
  format 검사 error 갈래(R4·R6)의 explicit 판을 사람 경로로 만들 수 없어 first-project format e2e가
  막혀 있다. worktree `documents-t21-format`에 `versions/work.ts`의 생략 저장 explicit 거절과
  `observation.ts` warning 유지 변경이 있다. 통로를 열지는 shell concern.
- 76: #528 사람 token(`apps/core/parent.ts`의 `targets: {}`)이 problems/tests `GetVerification`을
  forbidden으로 받는다(`packages/problems/tests/reads.ts` `sameApp`/`verificationScope`, `model.ts`
  `canReadVerification`/`scopeCovers`가 app target을 요구). Versions 탭의 Version test 결과가 늘
  "Can't read the result right now"다(통과로 보이지는 않음). 읽기 권한 설계(보안 경계)라 고치지
  않았다. verify-app-repair 4의 그 단언은 ignore. 실제 결과는 Issues 탭 `recorded`로 보인다.
- 77: #528 `packages/problems/grouping/reads.ts`·`tests/problem-tests.ts`가 `releases`·`events`를
  SQL로 직접 읽는다(고친 release 활성 여부·bundle). concern 경계상 contract 읽기로 옮길 것.
- 78: #527 app-broken 4 e2e가 사람 token으로 `problems/list-verifications`를 부르다 forbidden이라
  그 블록을 뺐다(scoped credential 전용 읽기). 76과 같은 축.
- 75: update-lophn 2단계(#510) 이어보냄 둘: (a) 어떤 process 종료든 clean stop으로 본다. (b) 정지 뒤
  writeInstall이 실패하면 process는 죽었는데 화면은 아무 변화가 없다고 말한다.
- 76~100 (10-10 Claude Code 세션): `.dev-data/followups.md`에 원문. 요약 —
  76·78 사람 token이 GetVerification·list-verifications forbidden(Versions test 결과 못 읽음),
  77 problems·apps/core가 다른 concern 표를 SQL로 직접 읽음, **79 [사람: followup으로 두고 패스]**
  agent runtime·revert worker가 앱 socket 64자리 전부 권한(5.1.1보다 넓음, slot 배정이 supervisor
  메모리 순서) — `agent-runtime-child_test` run-loop#R8이 main에서 실패 중, 80 headless 두 번째 창
  close가 shell 종료, 81 응답만 잃은 보고 문구, 82 unhandled rejection 원래 메시지 유실, 83·99 grant
  재시작 뒤 열린 앱 view conflict·읽기 not available, 84 DoctorSource 미조립(Q16·T48 선행),
  85 settings 복구 안내 자리·사라진 문서 탭 자리표시, 86 SDK install machine 없음·packages.usage stub,
  87 release 확정기 메모리 기억, 88 instruction read run 공용 자격·projectOf null, 89 automation 간격
  flake, 90 secret 단계(keychain), 91 visual 저장 표시 재시작 뒤 사라짐, 93 죽은 core 재기동 감독 없음,
  94 contexts 화면 revert 진입 없음, 95 화면 있는 앱 app test pass 불가(test mode feedback·화면 검사
  host 없음 → new-app 확정·preview·적용 미검증), 96 파일에서 빼기 결정 창(shell), 97 files/status가
  삭제·이동 뒤 tracked·lophn 공간 끊김 알림 없음, 98 handoff로 받은 App Engineer run이 model 호출 없이
  configuration_unavailable, 100 app.annotate 판정 deny·복원 패널 view 열기 실패.
- 아직 열린 큰 것: 33(coding agent hook 대상 사람 확인), 35·36(repair diff·이미지 redaction), 42(agent
  임시 글 streaming 통로 없음), 43(ReproductionScenario builder 없음), 44(launcher가 core 준비 뒤에도
  "getting ready"에 멈춤), 45(문제 알리기 dialog 시작 전 실패·재전송), 47~50(#448).
