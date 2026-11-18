---
name: orchestrate
description: lead(주 session)가 일을 worker에게 맡겨 돌릴 때 쓴다. 먼저 일의 모양(직접, 한 줄, 병렬 계획)을 고르고, 병렬 계획이면 계획 하나(project-docs/plan/<계획>/)를 worker 여럿에게 나눠 돌린다. task 고르기, worktree 만들기, worker 띄우기, 보고 받기, review, merge, status 갱신, issue 기록까지.
---

# 오케스트레이션

## 먼저: 어떤 길인가

worker 여럿을 계획 폴더와 brief로 돌리는 것은 병렬일 때만 값을 한다. 시작하기 전에 고른다(기준은 `planner-persona` skill의 "어떻게 할지 고르기"와 같다).

- **직접.** 작은 일(task 한둘, 한 session)은 lead가 자기 worktree에서 직접 구현한다. 계획 폴더와 brief를 쓰지 않는다.
- **한 줄.** 일이 서로 기대거나 같은 file을 고치거나 앞에서 읽은 것을 뒤가 그대로 써야 하면 계획 폴더를 열지 않는다. branch 하나(lead의 worktree)에서 lead가 직접 하거나 worker 하나가 한다. 다음 일은 새 worker를 띄우지 않고 같은 worker에게 SendMessage로 잇는다(context가 이어진다). 새 worker로 바꾸는 때는 그 worker의 context가 너무 커졌을 때뿐이고, 그때는 앞에서 정한 것과 바뀐 file을 prompt에 적어 넘긴다.
- **병렬 계획.** 범위가 path로 깨끗이 나뉘고, task가 서로 기대지 않고(맞물리는 약속은 먼저 고정했고), worker가 brief만 보고 끝낼 수 있을 때다. 이 문서의 나머지(계획 폴더, brief, wave, `launch.sh`·`merge.sh`·`land.sh`)는 이 길의 것이다.

어느 길이든 구현과 나란히 띄울 것이 있다: 구현한 worker가 아닌 worker의 review, 실제 앱에서 돌려 보는 확인, 코드 조사, spike. 이 일들은 context가 이어지면 안 되거나 이어질 필요가 없어서 따로 띄운다. worker가 앱을 띄워 보지 못한 변경은 merge 전에 이 확인을 거친다.

직접과 한 줄에서도 지키는 것: main checkout에서 일하지 않는다(자기 worktree와 branch), worker prompt에 넣을 것(아래 "worker 띄우기"의 목록), 보고를 diff와 대조하기, main에는 `main-merge.sh`로 올리기, 이슈와 change-log.

## 병렬 계획

lead는 task를 골라 worker에게 맡기고, 결과를 review해 그 계획의 branch에 합치고, wave마다 main에 올린다. 병렬 계획에서 lead는 기능 코드를 직접 짜지 않는다. 직접 고치는 것은 셋뿐이다: 공용 등록 file, 고정된 계약을 바꾸는 작은 commit, merge 충돌 가운데 등록 file 충돌.

계획 하나가 `project-docs/plan/<계획>/` 폴더 하나다(꼴은 `project-docs/plan/README.md`). task brief 꼴은 [brief-template.md](brief-template.md)다. 도구는 `project-docs/plan/tools/`(`status.py`, `lead/*`)이고 모두 첫 인자로 계획 이름을 받는다.

**lead는 main checkout에서 일하지 않는다.** 계획마다 branch `plan/<계획>`과 그 worktree(`.claude/worktrees/plan-<계획>`)가 lead의 자리다. `lead/lead.sh <계획>`이 만들고 경로를 찍는다. lead의 모든 명령(status, launch, prompt, merge, 이슈와 status commit)은 그 경로에서 돌린다(Bash 호출마다 `cd <그 경로> && ...`). task branch는 plan branch에서 갈라지고 merge.sh는 plan branch로 합친다. main에는 `lead/land.sh <계획>`이 올린다. 기본은 계획 끝에 한 번이다(아래 "merge"). 그래서 계획 둘이 같이 돌아도 main checkout과 서로의 작업 트리를 건드리지 않는다. `status.md`와 brief는 lead worktree의 것이 바른 것이다. `status.py ready`는 다른 계획의 lead worktree에서 running task를 읽어 소유가 겹치는 task를 거른다.

## 병렬 규칙

1. 계약(protocol, port, shell IPC, preload, design 공용 부품)은 고정한 뒤 lead만 고친다. worker는 바꿀 것을 보고에 요청으로 적고, lead가 작은 commit으로 고쳐 영향받는 `running` worker에게 SendMessage로 알린다.
2. 단위마다 소유 path만 고친다. 남의 file은 import만 한다. 남이 쓰는 export는 더하기만 하고, 안 쓰게 된 것은 보고하면 lead가 합친 뒤 지운다.
3. 공용 등록 file은 lead가 합친다: `package.json`(workspaces), `packages/protocol/**/mod.ts`의 목록, core 조립 목록(`packages/core/main/daemon/wiring/`), gallery `tools/wireframes/pages/index.ts`. worker는 "등록할 것"을 보고에 적는다.
4. 옛것과 새것이 잠시 같이 있어도 된다. 호환 장치(옛 이름 읽기, 옛 경로)는 만들지 않는다. 여러 영역이 쓰던 옛 계약은 마지막 cleanup이 지운다.
5. main과 plan branch는 늘 빠른 check가 통과한다. main에는 land.sh(rebase, full check, e2e, core 기동, 판 정하기)를 거친 것만 올라간다.
6. wave는 앞 wave가 모두 merged일 때 연다. 동시에 도는 worker 수는 정하지 않는다. `status.py ready`가 낸 task는 다 띄워도 된다(core type check 하나가 약 2.6GB다. 기계가 버거우면 lead가 줄인다). full check는 동시에 2개까지다.
7. 영역을 통째로 소유하는 cleanup 같은 task도 영역별 worktree로 나눠 병렬로 돌릴 수 있다. 충돌은 `mod.ts`, registry, i18n catalog(`packages/design/i18n/catalog/`)에 몰리니 catalog는 한 worker에게만 맡긴다.

## 시작 전

1. `lead/lead.sh <계획>`으로 lead worktree를 열고 거기로 간다. 그 worktree에 commit 안 된 변경이 없고 `npm run check`가 통과한다. 계획 폴더가 아직 main에 없으면(main에서 계획을 쓰지 않았으면) lead worktree에 쓰고 commit한다.
2. `git config user.email`이 맞다(없으면 worker가 commit마다 author를 제각각 넣는다).
3. `<계획>/tasks/*.md`를 썼으면 `python3 -I project-docs/plan/tools/status.py <계획> build`로 `<계획>/status.md`를 만든다.

## 한 바퀴

띄울 task가 있는 동안 되풀이한다.

### 1. 고르기

`python3 -I project-docs/plan/tools/status.py <계획> ready`가 띄울 수 있는 task를 낸다(앞 wave 모두 merged, 선행 merged, 이 계획과 다른 계획의 running과 소유 안 겹침). 여럿이면 wave가 낮은 것, 뒤에 기다리는 task가 많은 것, `status.md` 위쪽 순이다. 겹치지 않게 N개를 한 번에 고르려면 `python3 -I project-docs/plan/tools/lead/pick.py <계획> N`.

### 2. worktree

`project-docs/plan/tools/lead/launch.sh <계획> <id>...`가 main checkout의 `.claude/worktrees/<id>`와 branch `<단위>/<id>`(plan branch에서 갈라짐)를 만들고, `tools/worktree-prep.ts`가 그 worktree에서 `npm ci`를 돌려 자기 `node_modules`를 만들고 Electron binary를 받고, status를 `running`으로 한다. worktree마다 한 번이라 느리다(Electron과 node-pty를 새로 받는다).

### 3. worker 띄우기

Agent tool로 띄운다: `subagent_type: sonnet-high`, `run_in_background: true`, prompt는 `python3 -I project-docs/plan/tools/lead/prompt.py <계획> <id> <branch> "<알아 둘 것>"`의 출력 그대로.
- model은 `sonnet-high`다. `mimo-v2.6-flash`는 쓰지 않는다. worker는 자기 sub agent를 띄우지 않는다.
- 폴링하지 않는다. 끝나면 알림이 온다. 그 사이 띄울 수 있는 task를 더 띄운다.
- worker와의 대화(prompt, SendMessage)는 영어로만 한다(AGENTS.md). `prompt.py`도 영어로 찍는다. 사람에게 하는 보고는 한국어다.

worker에게 꼭 넣을 것(`prompt.py`에 들어 있다. 고치면 이 목록도 고친다):
- 작업 위치(worktree 절대 경로)와 "그 밖의 file은 고치지 않는다".
- 먼저 읽을 것: worktree의 AGENTS.md, brief의 절대 경로, brief의 "읽을 것".
- 소유 path만 고친다. 계약은 고치지 않고 요청을 보고에 적는다. project-docs는 고치지 않는다. 예외는 자기 task가 더하거나 지운 입구·test file의 `project-docs/flows/` 줄이다("project-docs를 고치지 않는다"만 보고 worker가 flows 줄을 빠뜨린 일이 있다).
- 다른 task나 module이 가진 type을 자기 쪽에 따로 선언하지 않는다. 같은 wave에서 한 file에 만나는 두 task가 병렬로 돌 때 뒤 task가 앞 task의 type 사본을 두면 어긋남이 merge에서야 드러났다.
- 실제 relay에 붙지 않는다: 개발 root에서 `remote.enabled`를 켜기 전에 `remote.relay`를 비운다(기본값이 실제 relay다. worker가 개발 root의 remote를 켠 일이 있다. 이슈 `dev-root-remote-uses-real-relay`).
- import를 끊으려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `check-deps` 예외로 둔다.
- 지우거나 옮기거나 값을 바꾼 이름·숫자는 grep해 주석과 오류 메시지에 남은 것도 고친다. route를 지우거나 이름을 바꾸면 method를 문자열로도 grep한다(화면이 resource·method 문자열로 불러 type check가 못 본다. 안 쓰는 export 정리가 화면 셋이 부르던 route를 지운 일이 있다). protocol 입력·출력의 칸 이름을 바꾸면 `<칸>:`과 `.<칸>`도 문자열로 grep한다(command envelope의 `input`과 `link.read`·`call` 응답은 type이 없다. 칸 이름 바꾸기가 `release.record` 입력과 shell의 `apps/tools` 읽기를 놓친 일이 있다). 규칙을 모을 때 이미 있는 표를 쓰고 사본을 만들지 않는다(옛 이름이 남은 주석을 lead가 따로 고친 일이 네 번, 모으는 task가 role 표 사본을 또 만든 일이 있다).
- test는 위험한 것만(`write-test`). E2E, 브라우저, 스크린샷, subprocess·서버 test는 새로 만들지 않는다(계획이 brief로 정한 `tests/e2e`의 flow만 예외).
- worker의 Bash 호출은 매번 cwd와 변수가 처음으로 돌아간다. 명령마다 `cd <worktree>; ...`로 시작한다(안 그러면 main checkout에서 돈다).
- core 확인: `cd <worktree>; project-docs/plan/tools/lead/boot.sh`만 쓴다. 새 data root로 core를 두 번 띄우고 각자 timeout으로 끝나 `boot N exit 0`을 찍는다. 손으로 띄우는 한 줄(`tail -f /dev/null | ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron … & wait`)은 `wait`에서 멈춘 일이 있다. **ps·fuser·ss로 찾지 않는다**(`ps --ppid … -C tail`이 OR로 걸려 남의 process를 끈 일이 있다). pkill·killall 금지. 실제 `~/.lophn`은 절대 건드리지 않는다. lead와 worker의 shell은 설치본 터미널에서 `LOPHN_HOME=~/.lophn`을 물려받는다. `boot.sh` 밖에서 Electron·core·CLI를 띄우는 명령은 늘 `LOPHN_HOME`을 `.dev-data/<id>/` 아래로 정한다(data root를 잃은 개발 앱이 그 env로 사람의 root에 간 일이 있다. 이슈 `worker-env-points-at-real-root`). data root는 0700이어야 기동한다.
- 임시 file(move-files mapping, probe 출력)은 worktree 안 `.dev-data/<id>/`에 둔다. session scratchpad는 같이 도는 worker끼리 공유되어 mapping이 덮인 일이 있다.
- 명령이 auto mode classifier에 막히면 다른 명령으로 우회하지 않고 보고한다. lead도 worker가 거절당한 명령을 대신 돌리지 않고 사람에게 묻는다(사용자 앱 방어를 지우는 변경의 check:full·commit이 막힌 일이 있다).
- `npm run check:full`을 돌린다. 끝까지 돌지 않은 check는 통과도 환경 문제도 아니라 멈춘 단계와 함께 "끝나지 않았다"고 보고한다(wireframes smoke는 끝나지 않는 page 이름을 찍는다). 통과하면 branch에 commit한다(영어 명령형 한 줄과 본문. 요구 ID와 작업 번호 없음). push, merge, rebase, 다른 branch는 하지 않는다.
- `node_modules`는 worktree마다 `npm ci`로 생기는 것이라 commit하지 않는다. 고친 file을 path로 add하고 `git diff --cached --stat`을 본다.
- 막히면 추측으로 넘어가지 말고 할 수 있는 데까지 하고 보고한다. 맡은 일을 "시간이 부족했다"며 남기지 않는다.
- 보고는 brief의 "보고" 꼴로 쓰고, "무겁게 짠 것"과 "알려진 미완 동작" 칸을 빼지 않는다.

### 4. 받기

1. 보고를 읽고 diff와 대조한다. 보고만 믿지 않는다.
2. **무겁게 짠 것**(가장 단순한 구현보다 무겁게 짠 곳)은 `project-docs/issues/<id>.yaml`에 `kind: defect` 이슈로, **알려진 미완 동작**은 `kind: bug` 이슈로 올린다. 단 `issue` skill의 "올릴지"를 먼저 거친다. 그 task 안에서 고칠 만큼 작으면 같은 worker에게 SendMessage로 고쳐 보내게 하고, "확인 못 함"은 lead가 merge 전에 확인한다. 손해가 구체적이지 않은 무게와 사실을 적은 것은 올리지 않는다.
3. worker가 크게 잘못한 것(review에서 되돌린 것, 사람이 찾은 것)은 `mistake` 이슈로 만든다. 원인과 막을 check나 문장을 적는다.
4. review(아래)를 한다. 통과하면 merge한다.
5. 안 되면 셋 중 하나다: 같은 worker에게 SendMessage로 고칠 것을 보낸다 / brief를 고쳐 다시 띄운다 / `blocked`로 두고 이유를 적는다. 두 번 실패한 task는 brief를 쪼갠다.

### 5. review

| 볼 것 | 어떻게 |
|---|---|
| node_modules를 commit하지 않았다 | `git diff --stat plan/<계획>...<branch> \| grep node_modules`가 0줄. 있으면 merge하지 않는다. gitignore한 폴더라 diff에 나오면 잘못 add한 것이다 |
| 소유 밖 file을 안 고쳤다 | `git diff --name-only plan/<계획>...<branch>`를 brief의 소유와 댄다. 예외: 지운 것을 가리키던 등록 줄만 뺀 것, i18n catalog에 key를 더한 것 |
| check가 통과한다 | worktree에서 `npm run check:full`. 빠른 check는 바뀐 package만 본다 |
| 위험 test | brief의 "위험 test"가 이름으로 있고 통과한다 |
| 계획의 목표와 본보기 | diff가 README와 같은지만 보지 않는다. 계획의 목표 문장(사람의 말)과 계획이 따른다고 한 본보기에 비춰 만든 모양이 맞는지 본다. 본보기와 다른 장치를 만들었으면 README의 정한 것에 그 차이가 적혀 있어야 한다(이슈 `plan-reference-shape-unchecked-in-review`) |
| 기존 계약을 좁히지 않았다 | 입력 검사나 자격을 바꾼 route를 `grep -rn "<route>" tests/e2e tests/support`로 찾는다. brief 밖에서 좁힌 것(앱 id를 누가 정하나)이 check:full을 지나 e2e에서 깨진 일이 있다 |
| 할 일을 다 했다 | brief의 "할 일"과 "남지 않음" grep을 하나씩 댄다. `TODO`·`FIXME` grep |
| core가 뜬다 | check는 통과해도 reader 등록 중복처럼 기동 때만 드러나는 오류가 있다. `lead/boot.sh`(merge.sh가 돌린다) |
| 화면 | `npm run wireframes`가 되고 gallery page가 옮긴 component를 쓴다 |
| 새 앱 view 자리(tray, sidebar, float, card 같은 `EmbeddedView`가 서는 곳) | gallery는 main의 열기 검사(`checkOpen`)를 건너뛰므로 screenshot만으로 통과시키지 않는다. 진짜 Electron 앱에서 그 자리를 한 번 열어 앱 화면이 뜨는 것까지 본다(headless + `--remote-debugging-port` + CDP로 열고 screenshot). worker가 "진짜 Electron에서 안 돌림"이라고 보고했으면 lead가 이 확인을 한다 |
| 보고의 등록할 것 | lead가 고칠 목록에 옮긴다 |

### 6. merge

`project-docs/plan/tools/lead/merge.sh <계획> <id>`(`fix/<id>` branch는 `merge-fix.sh <계획> <id>`). 하는 일: node_modules 검사 → plan branch 위로 rebase → worktree `check:full` → plan branch로 ff-merge → plan branch `check:full` → core 두 번 기동(`boot.sh`) → renderer build → worktree·branch 정리 → status merged. 멈추면 `STOP: ...`을 찍는다.
- `STOP: rebase conflict`: worktree에서 충돌을 풀고 `GIT_EDITOR=true git rebase --continue` 뒤 다시 돌린다. 대개 등록 file이나 i18n catalog다. catalog 충돌은 두 쪽 key를 다 남긴다. flows yaml 충돌을 두 쪽을 다 남겨 풀면 한 flow 안에 key가 겹치거나 지운 `ignore` 줄이 되살아난다. 풀고 바로 `node tools/flows.ts check`를 돈다. 그 밖 file이 충돌하면 소유가 잘못 나뉜 것이다. task를 돌려보내고 소유를 고친다.
- merge.sh는 task마다 같은 commit에 `check:full`을 두 번 돈다(worktree, plan branch). 끝난 task가 여럿이면 차례로 rebase·ff한 뒤 묶음에 `check:full`과 기동을 한 번 도는 길도 있다(multi-machine lead가 쓴 저장소 밖 script reports/multi-machine/lead/merge-batch.sh. 사람이 2026-11-17 그 방식을 받았다). 묶음이 실패하면 어느 task인지 다시 가린다.
- merge 바로 뒤에 보고의 "등록할 것"을 고치고 check가 통과하면 commit한다. `merge.sh`가 바꾼 `status.md`는 commit하지 않으니 lead가 같이 commit한다.
- land는 계획 끝에 한 번이 기본이다. land 하나에 `check:full`, e2e 전체, core 기동으로 수십 분이 들고 그동안 다음 wave를 띄우지 못한다(workspace-layers는 wave마다 land해 계획 대부분이 land 대기였다). 중간 land는 다음 가운데 하나일 때만 하고, 그 wave를 README에 적는다.
  - 사람의 data root 모양을 바꾸는 migration이 든 wave(그 wave 전부가 함께 올라야 root가 깨지지 않는다)
  - main에서 같은 file을 고치는 다른 계획이나 session이 있을 때
  - plan branch가 오래 열려 rebase가 커질 때
- land를 미루면 e2e 실패가 늦게 드러난다. 그래서 protocol 이름, id 꼴, 문자열 값을 바꾸는 task의 brief "남지 않음" grep은 `tests/`까지 본다(e2e의 옛 기대값을 brief grep이 `packages tools`만 봐서 놓쳤다).
- land하기 전에 이 계획이 `packages/`를 바꿨으면 `project-docs/products/change-log/<x.y>/<id>.yaml` 항목을 쓴다. `version`은 lead worktree의 `package.json` 판으로 쓴다(`package.json`은 고치지 않는다. PATCH는 land.sh가 올리고 이 항목의 판과 폴더를 맞춘다). `modules`는 계획 전체 diff에서 동작·계약이 바뀐 module-catalog path, `context-review`로 걸려 봤지만 고칠 것이 없던 registry ID는 `checked`, 결정은 `decisions`의 `by: person | agent`, 설치한 앱에서 사람이 해야 하거나 확인할 것이 있으면 `checklist`(해야 할 것은 `해야: `로 시작). 판은 새 항목을 더한 land에서만 오르니, 중간 land에는 항목을 넣지 않고 마지막 land에 넣는다. 고친 이슈는 `status: fixed`로 닫는다. 규칙은 `products/change-log/README.md`다.
- land할 때는 status와 이슈를 commit한 뒤 `project-docs/plan/tools/lead/land.sh <계획>`으로 main에 올린다. 두 단계다. 무거운 단계(lock `.git/lophn-land.lock`으로 하나씩): lead worktree를 main 위로 rebase → `package-lock.json`이 바뀌었으면 `npm ci` → `check:full` → (`tests/e2e`에 test가 있으면) `npm run e2e:deps`, `npm run e2e` → core 두 번 기동. 다른 land가 돌면 "다른 land가 끝나기를 기다린다"를 찍고 기다린다. 쓰는 단계(main lock `.git/lophn-main.lock`, 짧다): 지금 main 위로 rebase → 무거운 단계 동안 main이 움직였으면 `npm ci`(필요할 때)와 `npm run check`만 다시 본다(e2e와 기동은 다시 돌지 않는다. 합친 상태의 e2e는 다음 land의 무거운 단계가 본다) → 판을 정해 "Release <판>" commit → main fast-forward. main lock을 쥔 동안 main에 쓰는 것이 없어 재시도 loop가 없다. `STOP: main ff failed`면 main checkout에 그 commit들과 겹치는 고친 file이 있는 것이다. main을 건드린 쪽(사람이나 다른 session)에게 알린다.
- 계획이 끝나면 계획 폴더를 지운 commit까지 land하고 lead worktree와 plan branch를 지운다(`git worktree remove`, `git branch -d plan/<계획>`).
- push는 사람 확인 뒤에만 한다.

## 상태 기록

`python3 -I project-docs/plan/tools/status.py <계획> set <id> <todo|running|review|merged|blocked> [branch] [commit] [기록]`. 막히면 `<계획> set <id> blocked "" "" "<이유>"`.

## 계약 바꾸기 요청

1. worker는 계약을 안 고치고 보고에 요청을 적는다.
2. lead가 받을지 정한다. 기준은 `project-docs/architecture/`와 PRODUCT.md다.
3. 받으면 plan branch에 작은 commit으로 계약을 고치고, 그 계약을 쓰는 `running` worker에게 SendMessage로 알린다.
4. 문서와 다르게 가야 하거나 제품 동작이 바뀌면 사람에게 묻는다.

## 막힘과 겪은 함정

- 문서에 답이 없으면 추천안으로 진행하고 기록해 둔다. 사람에게 올리는 것은 제품 동작, 비용, 되돌리기 비싼 것뿐이다.
- 권한 분류기가 `git push`, `git rebase`, merge script를 막을 수 있다. 우회하지 말고 무엇을 왜 하려는지 사람에게 말한다.
- 같은 file을 두 task가 원하면 한쪽에 소유를 주고 다른 쪽은 선행을 걸어 뒤로 미룬다.
- worktree 안 `.dev-data`에는 쓰기 금지 file(core가 깐 읽기 전용 sdk 사본)이 남는다. `merge.sh`, `boot.sh`, `npm run dev:mock`은 지우기 전에 `chmod -R u+w`를 한다. 손으로 `git worktree remove`나 `rm`을 할 때 실패하면 `chmod -R u+w <worktree>/.dev-data` 뒤 다시 지운다.
- `npm run dev`는 `LOPHN_HOME`을 무시하고 저장소(worktree) 안 `.dev-data`를 쓴다.
- check:full이 못 보는 것: renderer build(`node packages/shell/renderer/build.ts`). 이것으로 main이 깨진 채 지나간 일이 있다.
- 오래된 worktree에서 `npm ci`를 돌리기 전에 그 `node_modules`가 다른 checkout의 것을 가리키는 link가 아닌지 본다(`ls -ld node_modules`). link면 `npm ci`가 가리키는 쪽을 비운다. main checkout의 `node_modules`가 하루 동안 비어 있던 일이 있다. link면 지우고 `npm ci`한다.
- 계획 폴더 없이 돌릴 때(직접, 한 줄)도 모양은 같다: branch 하나에 합치고 main에는 사람이 확인한 뒤 올린다. 첫 worker를 main으로 바로 올렸다가 사람이 바로잡은 일이 있다.
- wave마다 task가 하나씩인 계획을 계획 폴더와 brief로 돌린 일이 여러 번 있다. worker가 매번 처음부터 코드를 읽고, task마다 worktree와 merge 비용이 든다. 그런 일은 "한 줄"이다.
- Agent tool의 `isolation: worktree`는 plan branch에서 갈라지지 않는다(main 쪽 옛 commit에서 시작한 일이 있다). launch.sh가 만든 worktree를 쓰고, 그렇게 못 했으면 worker가 먼저 `git reset --hard <합칠 branch>`를 하게 한다.
- worker가 자주 한 실수(보고를 diff와 대조하는 이유):
  - template literal로 만드는 message key(`` `common.label.tab-${dot}` ``)를 "쓰는 곳 없음"으로 보고 지웠다.
  - 설계와 안 맞는 test를 지우면서 그 test가 지키던 권한 경계 검사까지 없앴다.
  - 맡은 worktree가 아닌 곳에 commit했다.
  - 맡은 항목 일부를 "시간이 부족했다"며 남겼다. 다시 맡기면 끝냈다.
- land.sh가 plan branch를 main 위로 다시 쓰면, 그 전에 갈라진 task branch의 merge-base가 옛 wave commit 앞으로 간다. 그대로 rebase하면 옛 commit까지 다시 올리다 충돌한다(여섯 번). launch.sh가 갈라진 점을 branch config(`lophnBase`)에 적고 merge.sh가 `rebase --onto`로 그 뒤만 옮긴다. 이 장치 전에 띄운 task는 merge 전에 task worktree에서 `git rebase --onto plan/<계획> <launch 때 plan HEAD> <task branch>`를 한다.
- schema 칸 이름을 바꾼 task 뒤에 type 오류가 나면 먼저 칸 이름(`run` → `turn` 같은 것)이 어긋난 곳을 의심한다.
- merge가 도는 동안 plan branch에 commit하지 않는다. merge.sh가 rebase한 뒤 ff하려다 `STOP: ff failed`로 멈춘다. status·이슈 commit은 merge 사이에 한다.
- main에 쓰는 길은 land.sh(계획)와 `main-merge.sh <branch>`(그 밖의 session)와, main checkout에서 main lock을 잡은 직접 commit(`flock "$(git rev-parse --git-common-dir)/lophn-main.lock" git commit ...`)뿐이다. land의 무거운 단계 동안 다른 session이 main에 올려도 land는 쓰는 단계에서 한 번 rebase하고 빠른 check만 더 본다.
- land 뒤에 다음 merge를 이어 붙일 때는 `land.sh && merge.sh …`처럼 land의 종료 코드를 본다. agent-card에서 land가 e2e로 실패했는데 명령이 그 실패를 보지 않아 다음 task merge가 먼저 돌았고, 그 뒤 land를 모두 다시 돌렸다.
- land.sh가 rebase 충돌로 멈추면 lead worktree에서 풀고 `git add`, `git rebase --continue` 뒤 land.sh를 다시 돈다. `package.json`의 판 줄만 부딪히면 도구가 main의 판으로 맞춰 스스로 푼다(branch가 판을 고치지 않는 것이 원칙이다). 항목은 file이 따로라 서로 부딪히지 않는다. plan branch를 손으로 `git rebase main`하는 명령은 분류기가 막았다(worker branch가 그 위에 있을 때). land.sh 길로 한다.
- lead가 쓸 문서(이슈 닫기, change-log 항목, architecture)가 main에서 다른 계획이 고친 file과 겹치면, main에서 갈라진 branch에서 쓰고 land의 rebase가 끝난 뒤 lead worktree에 cherry-pick한다. 옛 base에서 쓰면 rebase 충돌이 문서마다 난다.
- 두 계획의 마무리 문서 commit(architecture, catalog, change-log)을 병렬로 쓰면 같은 architecture file에서 부딪힌다(multi-machine). 하나씩 쓰거나 둘째를 첫째의 branch 위에서 쓴다.
- wiring에 memory handler만 붙이고 팀 registration의 `memoryRoutes`에 route를 빼면 요청이 늘 `not_found`인데 check와 기동은 통과했다(여섯 route가 그랬다). 지금은 core 기동이 둘을 대조해 멈춘다.
- turn 경로(model resolver 같은 runtime 쪽 코드)가 machine 자격으로 새 read를 부르면 `packages/core/lophn-agent/run-loop/runtime-access.ts`의 `RUNTIME_MACHINE_ROUTES`에 그 route를 더한다. 빠지면 unit(가짜 machine)과 core 기동은 통과하고, e2e에서 모든 turn이 시작하자마자 `configuration_unavailable`로 끝났다.
- land와 merge를 background로 돌릴 때 출력은 `| tail`로 받지 말고 file로 받는다. land.sh는 단계마다 시각과 단계 이름 한 줄(`lock을 잡았다`, `check:full`, `e2e`, `core 두 번 기동`, `main fast-forward`)을 바로 찍고, 단계의 출력은 실패할 때만 찍는다. "다른 land가 끝나기를 기다린다" 뒤에 `lock을 잡았다`가 없으면 아직 기다리는 중이다. e2e가 도는 동안의 진행은 그 test의 data root(`/tmp/lophn-e2e-*`)에 새 file이 쓰이는지로 본다(e2e가 멈춘 것을 40분 동안 몰랐다).
- 다른 계획의 land가 e2e를 돌리는 동안 같이 e2e를 돌리면 앱 crash-loop 단계(그때 `reaction_test`, 지금 `app-restart_test`)가 멈춘 일이 한 번 있다(혼자 돌리면 통과, 원인은 확인 전). 그래서 land.sh가 lock으로 하나씩 돈다. 손으로 `pgrep -f 'land.sh …'`로 기다리지 않는다. 그 pattern이 기다리는 shell 자신의 command line에 있어 영영 끝나지 않았다.
- e2e가 한 test에서 끝없이 기다리면 먼저 그 run의 turn이 모두 실패하는지 본다(그 run data root의 `lophn.db` `turns.outcome_reason`). 모든 turn이 `configuration_unavailable`이던 bug가 40분 멈춘 land로 보였다.
- fix task가 merge되면, 같은 길을 쓰는 running worker에게 그 사실을 바로 알리고 commit이 있으면 lead가 그 branch를 rebase한다. worker는 rebase할 수 없어서 옛 base에서 이미 고친 bug를 다시 쫓는다(앱 E2E worker 셋이 한 시간 가까이 그랬다).
- 실제 앱 확인 worker에게 "내장 provider를 가짜 key로 이어 본다"고 시키면 core가 연결 뒤 그 provider의 실제 model 목록 주소를 읽는다(core-setup). provider 연결 확인은 custom provider를 fake model server 주소로 잇는 것만 시키고, 내장 정의의 연결과 로그인 완료는 사람에게 부탁한다.
- 같은 기계에서 E2E가 "부하 때문" flake로 보이면 먼저 사용자 단위로 공유하는 자원(`XDG_RUNTIME_DIR` 아래 socket, `/tmp`의 고정 이름)을 의심한다. 앱 start flake 둘이 core끼리 같은 socket 경로를 쓴 제품 bug였다.
- worker가 test에 기다림이나 우회를 넣어 통과시켰으면(보고의 "무겁게 짠 것") 제품 bug를 가린 것인지 본다. 가렸으면 그 test를 land 전에 fix task로 되돌린다.
- 권한 분류기는 session마다 그 session에 사람이 직접 한 말만 본다. planner가 전한 사람의 허락("진짜 provider 맘껏 써")은 lead session에서 통하지 않아, `LOPHN_LAND_SKIP_E2E=1 land.sh`("CI Bypass")와 진짜 model을 부르는 명령("Real-World Transactions")이 막혔다. 계획에 이런 일이 있으면 사람이 자리를 비우기 전에 lead session에 직접 말하게 한다. 다른 session에 대신 돌려 달라고 하지 않는다.
- planner나 lead가 main에서 문서를 바로 고쳐도 `npm run check:full`을 돈다. `npm run check`가 못 보는 문서 fmt로 main이 깨진 일이 있다.
- 이슈와 문서의 path는 저장소 root부터 쓴다. package 안에서 줄인 path는 docs check가 "없는 path"로 막는다.
- 층 하나를 지우는 cleanup의 끝남 grep은 이름(type, route, 표)만 잡는다. 그 층만 쓰던 화면 칸은 이름이 달라 남는다(remove-role 뒤 session popover의 "Waiting for a coding agent" 칸과 `queuedCoding` prop이 넘기는 곳 없이 남았다). 지운 층의 화면 문구 key로 한 번 더 grep하고, 그 key를 쓰는 component의 prop을 넘기는 곳이 있는지 본다.
- harness가 lead session을 다시 띄운 뒤에도 같은 session의 옛 process가 lead로 돌고 있을 수 있다(같은 `--resume` id의 process가 둘, 둘 다 merge하고 같은 worktree에 worker를 다시 맡겼다). worker를 이어 맡기기 전에 같은 session의 다른 process가 있는지 보기만 하고, 어느 쪽을 남길지는 사람이 고르게 한다.
- worker가 `check:full`이 "끝나지 않았다"고 보고하면 환경 문제로 단정하지 않는다. 멈춘 wireframes smoke는 끝나지 않는 page였다(목록을 event마다 새로 만들어 Inbox가 구독을 계속 새로 걸었고, 같은 code가 실제 창에서도 돈다). smoke가 이제 그 page 이름을 찍는다. 전체 check가 끝나지 않은 branch는 merge하지 않는다.
- worker가 gallery server를 띄우는 명령을 auto mode classifier에 자주 거절당해 화면을 "보지 못했다"고 보고한다. 화면 task를 merge하기 전에 lead가 보고에 적힌 page를 직접 찍는다(build, 문서의 명령으로 serve, headless Chrome screenshot).
- 한 wave에서 소유 file이 겹치지 않는 task들은 서로의 file에 "넘길 줄"을 남긴다(한 wave 뒤 19줄). 계획의 마지막 task에 그 영역 전체의 소유를 주고 두 단계로 돌린다: 먼저 넘겨받은 줄(lead가 화면을 본다), 그다음 자기 정리.
- 같은 SDK package의 판을 올리는 계획 둘이 동시에 돌면 같은 번호를 고른다. 나중에 land하는 계획이 그 판을 만든 commit의 rebase 멈춤에서 번호를 다시 매기고(새 메모 file은 다음 번호, `Previous:`는 먼저 land한 계획의 것, pin, lock), 최종 번호를 change-log 항목에 쓴다.
- 다른 protocol 영역에 기대는 route file은 의존이 가리키는 쪽에 있어야 한다(`protocol/folder`의 carry 계약이 `protocol/remote`를 import하는데 `protocol/remote`의 기기 route 목록이 그 계약을 import해야 했다. `check-deps`는 lead가 route를 등록할 때에야 순환을 막았다). 계약 file을 만드는 task는 import 방향을 먼저 본다.
- `git add <path들>`에 이미 지워져 stage된 path가 하나 있으면 add 전체가 중단되고, 이어지는 `git commit`은 그 전에 stage된 것만 commit한다. 폴더를 지우는 commit 뒤에는 `git status`를 본다.
- 개발 core 둘을 짝지우고 headless Electron 창으로 실제 앱을 확인하는 일은 싸다(worker 15분쯤): `LOPHN_SHELL_HEADLESS=1`과 `--headless`, `--remote-debugging-port`, core는 `env -i`와 `.dev-data/` 아래 각자의 `LOPHN_HOME`, 짝짓기는 roster route, screenshot은 CDP. 창이 보이는 것을 바꾸는 계획은 land 전에 한 번 한다. test와 gallery가 못 본 결함 둘을 찾았다.
- 권한 경계를 바꾸는 계획은 독립 review를 일곱 번 받았고(계약, 허락, 받는 쪽, 보내는 쪽, event, 앞선 나르기 계획의 둘) 매번 test와 check가 통과한 must-fix를 찾았다(다른 컴퓨터로 갈 앱 call이 이 컴퓨터의 앱을 돌렸고, 사람만 쓰는 칸을 agent가 썼고, 아무도 읽지 않는 hop flag가 있었고, 도착 순서에 기대는 허락이 있었다). 이 방식을 유지한다: reviewer는 코드를 쓰지 않은 쪽이고, 공격 입력을 만들고 규칙마다 mutation으로 test가 깨지는지 본다. reviewer의 "다음 task가 구현할 규칙"을 다음 task brief에 보낸다.
- 한 계획의 task는 같은 reviewer에게 맡기고(계약을 기억한다), task의 고침 라운드와 계획의 마무리 기록은 그 task를 지은 worker에게 맡긴다.
- 한 wave의 task들이 같이 merge되어야 하면(받는 쪽이 보내는 쪽만 보내는 것을 요구한다) brief에 적고 연달아 merge한다. 하나만 merge하면 기존 컴퓨터 사이 traffic이 끊긴다는 것을 reviewer가 잡았다.
- 이런 계획은 wave마다 개발 core 둘을 짝지워 실제 앱을 확인하고, 올림도 같이 본다: 이전 release의 code로 main checkout에서 data root를 만든 뒤 계획의 code로 기동한다(허락 옮기기와 빠진 "Update needed" 표시를 찾았다).
- schema step은 그 표가 속한 wiring과 상관없이 마지막 wiring의 `schemaStepsAfterTeams`와 lock file 끝에 task가 merge된 순서로 둔다(worker가 step을 그 표의 옛 step 옆에 둔 일이 있다).

## 사람에게 알리는 때

wave 하나가 끝났을 때(무엇이 merge됐는지, push할지), 계약을 고정했을 때, `blocked`를 lead가 못 풀 때, 문서와 다르게 가야 할 때, 그리고 `project-docs/issues/`에 이슈가 쌓였을 때.
