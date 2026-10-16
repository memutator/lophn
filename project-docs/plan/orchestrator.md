# 오케스트레이터 절차

오케스트레이터는 lead session이다. task를 골라 worker에게 맡기고, 결과를 review해 main에 합친다. 이 문서를 위에서부터 그대로 따라 돌린다.

## 1. 역할

- **하는 일**
  - task 고르기, worktree 만들기, worker 띄우기
  - review, merge, 등록 file 고치기, `status.md` 고치기
  - 사람에게 묻기
- **하지 않는 일:** 기능 코드를 직접 짜지 않는다. 직접 고치는 것은 셋뿐이다.
  - lead 소유 file(`ownership.md`의 lead)
  - 고정된 계약을 바꾸는 작은 commit(7장)
  - merge 충돌 가운데 등록 file 충돌
- **worker:** model은 `sonnet-high`다. `mimo-v2.6-flash`는 쓰지 않는다. worker는 자기 sub agent를 띄우지 않는다.

## 2. 재료

| file | 쓰임 |
|---|---|
| `status.md` | task마다 wave, 선행, 상태, branch, commit. 오케스트레이터만 고친다 |
| `tasks/<id>.md` | worker에게 넘기는 brief(꼴은 `tasks/README.md`) |
| `ownership.md` | 단위마다 고칠 수 있는 path |
| `assignment.md` | inventory 줄을 어느 단위가 맡는지 |
| `README.md` | 계획 개요, 계약 결정(3장), 사람이 정할 것 |
| `../dev/` | 코드, test, workflow 규칙 |
| `tools/` | 이 절차가 부르는 script(`owned.py`, `status.py`, `coverage.py`) |

project-docs는 git에 있다(README 4.1의 10번, 2026-10-16). worktree에도 사본이 생기지만 `status.md`·brief의 "(lead가 더함)"·docs-review는 main checkout의 것이 바른 것이다. worker에게는 언제나 절대 경로 `/home/pyosechang/projects/lophn/project-docs/...`를 주고, worker는 project-docs를 고치지 않는다. lead가 고친 project-docs는 merge 사이에 lead commit으로 남긴다.

## 3. 시작 전 (한 번)

1. main에 commit 안 된 변경이 없고 `deno task check`가 통과한다.
2. 옛 worktree와 branch 정리가 끝났다. `git worktree list`에는 main checkout만 있다.
   - 정리 명령은 권한 분류기가 막아서 사람이 `!`로 돌린다(`README.md` 5장).
   - 지우기 전 백업은 `.git/lophn-cleanup-2026-10-16/`에 있다.
3. `python3 -I project-docs/plan/tools/coverage.py`가 통과한다. inventory 줄이 모두 어느 brief에 들어 있고, 같은 wave에서 소유가 겹치는 task가 없다는 뜻이다.
4. `status.md`의 모든 task가 `todo`다.
5. `README.md` 4.1의 "사람이 정할 것"에 답이 있거나, 기본값으로 간다고 사람이 말했다.

## 3.1 wave 사이에 lead가 할 일

| 때 | 할 일 |
|---|---|
| wave 1 전 | wave 1 brief의 "추가 소유"를 승인한다(brief 줄과 `ownership.md` wave 1 머리). 끝남(2026-10-16) |
| wave 3 전 | wave 3 brief(screens-*)의 "추가 소유"를 보고, 띄우기 전에 승인하거나 고친다. 끝남(2026-10-16) |
| wave 2 전 | `packages/protocol/base/ids.ts`에 접두사 `agt`, `trn`, `cal`, `act`, `rwd`, `ann`, `anb`를 더한다. 끝남(2026-10-16) |
| wave 2 전 | `packages/protocol/base/actor.ts`가 `coding_agent:ses_…` principal을 받게 한다. 끝남(2026-10-16) |
| wave 2 전 | `packages/design/deno.json`에 `@iconify-json/catppuccin` import를 더하고 lock을 고친다(ui-chrome-components 전). 끝남(2026-10-16) |
| wave 3 전 | 계약 고정 commit(8장). 끝남(2026-10-16) |
| wave 3 전 | `packages/core/main/daemon/wiring/context.ts`에 `settings`, `settingDeclarations`, `secretStore`, `secretAttach`, `componentChecks` 칸을 더한다. 끝남(2026-10-16) |
| wave 3 전 | `../dev/code-map.md`에 Router 줄을 적는다. Router는 domain module을 import하지 않고 port만 알며, wiring이 구현을 끼운다. 끝남(2026-10-16) |
| merge마다 | 보고의 "등록할 것"을 고친다(6장). 의존성 정리, gallery `pages.ts`, shell main 조립의 `confirmation` → `secret-input`, `protocol/*/registry.ts`의 route, `ALL_EVENTS` 교체가 여기에 든다 |

## 4. 한 바퀴

빈 slot이 있는 동안 아래를 되풀이한다. 동시에 도는 worker는 최대 8개다. core type check 하나가 약 2.6GB이기 때문이다(RAM 29GB).

### 4.1 고르기

`python3 -I project-docs/plan/tools/status.py ready`가 지금 띄울 수 있는 task를 낸다.
- 선행이 모두 `merged`인 task다.
- 지금 `running`인 task와 소유 path가 겹치지 않는 task다.
- 앞 wave의 task가 모두 `merged`인 task다. wave는 차례로 연다.

여럿이면 아래 순서로 고른다.
1. wave가 낮은 것
2. 뒤에 기다리는 task가 많은 것(script가 수를 적는다)
3. `status.md`에서 위에 있는 것

wave 3은 계약 고정 commit(8장)이 main에 들어간 뒤에만 연다.

### 4.2 worktree

```sh
cd /home/pyosechang/projects/lophn
git worktree add .claude/worktrees/<id> -b <단위>/<id> main
deno run -A tools/worktree-prep.ts .claude/worktrees/<id>
```

- `tools/worktree-prep.ts`는 check task가 만든다. 그 전(wave 0)에는 이렇게 잇는다:
  `ln -s /home/pyosechang/projects/lophn/packages/shell/main/node_modules .claude/worktrees/<id>/packages/shell/main/node_modules`
- 새 worktree에 `npm ci`를 돌리지 않는다. Electron과 node-pty를 다시 받고 빌드해야 해서 느리다.

### 4.3 worker 띄우기

Agent tool로 띄운다. 값은 셋이다.
- `subagent_type: sonnet-high`
- `run_in_background: true`
- prompt: 아래 template에 값을 넣어 그대로 보낸다.

```text
lophn task `<id>`를 해 줘.

- 작업 위치: /home/pyosechang/projects/lophn/.claude/worktrees/<id> (branch <단위>/<id>). 이 worktree 밖의 file은 고치지 않는다.
- 먼저 읽을 것:
  1. 작업 위치의 AGENTS.md
  2. /home/pyosechang/projects/lophn/project-docs/plan/tasks/<id>.md (이 task의 brief)
  3. brief의 "읽을 것"
- 고칠 수 있는 것은 brief의 "소유" path뿐이다. 다른 path가 필요하면 고치지 말고 보고한다.
- 계약(protocol, port, shell IPC, preload)은 wave 2 task만 고친다. wave 3 task는 계약 바꾸기 요청을 보고에 적는다.
- 끝나면 `deno task check`를 돌리고, 통과하면 이 branch에 commit한다. 메시지는 영어 명령형 한 줄과 본문이다. 요구 ID와 작업 번호는 넣지 않는다.
- push, merge, rebase, 다른 branch 건드리기는 하지 않는다.
- 막히면 추측으로 넘어가지 말고, 할 수 있는 데까지 하고 보고한다.
- 보고는 brief의 "보고" 꼴로 짧게 쓴다.
- `packages/shell/main/node_modules`(worktree-prep의 symlink)는 commit하지 않는다. 고친 file을 path로 add하고, commit 전에 `git diff --cached --stat`을 본다.
```

### 4.4 기다리기

- worker가 끝나면 알림이 온다. 그 사이 다른 slot을 채운다. polling하지 않는다.
- 띄우자마자 `python3 -I project-docs/plan/tools/status.py set <id> running <단위>/<id>`로 적는다.

### 4.5 받기

1. 보고를 읽는다.
2. 5장 review를 한다.
3. 통과하면 6장 merge를 한다.
4. 안 되면 아래 셋 가운데 하나로 처리하고 `status.md`에 적는다.
   - 같은 worker에게 SendMessage로 고칠 것을 보낸다.
   - brief를 고쳐 다시 띄운다.
   - `blocked`로 두고 이유를 적는다.

## 5. review

| 볼 것 | 어떻게 |
|---|---|
| core가 뜬다 | merge 뒤 main에서 짧은 data root로 core를 15초 띄워 exit 0을 본다. check는 통과해도 reader 등록 중복처럼 기동 때만 드러나는 오류가 있다(2026-10-16 places-sessions-session) |
| node_modules를 commit하지 않았다 | `git diff --stat main...<branch> | grep node_modules`가 0줄이다. 있으면 merge하지 않는다. ff-merge가 main checkout의 진짜 `node_modules`를 덮어 지운다(2026-10-16에 한 번 일어났다) |
| 소유 밖 file을 고치지 않았다 | `python3 -I project-docs/plan/tools/owned.py <id>`가 소유 밖 file을 0개 낸다 |
| check가 통과한다 | worktree에서 `deno task check:full`을 돈다(빠른 check는 바뀐 package만 보고, merge 뒤 main을 깨지 않으려면 full이 필요하다) |
| 위험 test가 있다 | brief의 "위험 test"가 test 이름으로 있고 통과한다 |
| 할 일을 다 했다 | brief의 "할 일"과 "남지 않음" grep을 하나씩 대 본다 |
| 옛 이름과 죽은 코드가 없다 | brief의 grep, 그리고 `TODO`·`FIXME` grep |
| 화면은 gallery에서 그려진다 | `deno task wireframes`가 되고, 그 page가 옮긴 component를 쓴다 |
| 보고의 등록할 것 | 6장에서 lead가 고칠 목록에 옮긴다 |

`owned.py`가 소유 밖으로 내도 받아들이는 경우가 넷 있다.
- wave 1 덜어내기 task가 brief의 "추가 소유"(지운 것을 쓰던 곳)를 고친 것
- 등록 file(`mod.ts`, `registry.ts`, 조립 목록)에서 지운 것을 가리키는 줄만 뺀 것
- wording catalog에 key를 더한 것. `owned.py`가 이미 허락한다.
- `ownership.md`의 "순서로 나눠 쓰는 file"을 선행 순서대로 고친 것. `owned.py`가 이미 허락한다.

## 6. merge

```sh
cd /home/pyosechang/projects/lophn
git -C .claude/worktrees/<id> rebase main
deno task check            # worktree 안에서
git merge --ff-only <단위>/<id>
deno task check            # main에서
git worktree remove .claude/worktrees/<id> && git branch -d <단위>/<id>
```

- rebase에서 충돌이 나면 대개 등록 file이나 wording catalog다. lead가 푼다.
  - catalog 충돌은 두 쪽 key를 다 남기고, `generate.ts`를 그 영역으로 다시 돌린다.
- 다른 file이 충돌하면 소유가 잘못 나뉜 것이다. 그 task를 worker에게 돌려보내고 `ownership.md`를 고친다.
- 보고의 "등록할 것"은 merge 바로 뒤에 lead가 고친다. 목록은 이렇다.
  - `protocol/*/mod.ts` 목록
  - core 조립 목록
  - wording 생성
  - gallery `pages.ts`
  - `deno.json`
- 등록을 고친 뒤 check가 통과하면 commit한다.
- `python3 -I project-docs/plan/tools/status.py set <id> merged <branch> <commit>`로 `status.md`를 고친다. 띄울 때는 `set <id> running <branch>`, 막히면 `set <id> blocked "" "" "<이유>"`다.
- push는 하지 않는다. wave가 끝날 때 사람에게 묻는다.

## 7. 계약 바꾸기 요청 (wave 3)

1. worker는 계약을 고치지 않고 보고에 요청을 적는다.
2. 오케스트레이터가 요청을 받아들일지 정한다. 기준은 spec과 `README.md` 3장의 결정이다.
3. 받아들이면 lead가 main에 작은 commit으로 계약을 고친다.
4. 그 계약을 쓰는 `running` task에게 SendMessage로 알린다.
5. `status.md`의 기록 칸에 적는다.
6. spec과 다르게 가야 하면 `../tmp/docs-review.md`에 적는다. 제품 동작이 바뀌면 사람에게 묻는다.

## 8. gate

### 계약 고정 (wave 2 끝)

wave 2 task가 모두 merge되면 lead가 계약을 한꺼번에 읽는다. 아래가 맞으면 계약 고정 commit을 만든다.
- 이름이 `README.md` 3장의 결정과 맞는다(turn, steer, app-api, `project_manager`, tool 이름 철자).
- 같은 뜻에 다른 이름이 없다.
- spec 장마다 그 모양이 계약에 있다.
- `deno task check`가 통과한다.
- `README.md` 4.2의 "계약 고정 때 볼 것"을 하나씩 확인한다.

commit 메시지는 `Freeze the contracts for the rebuild`다. 이 commit이 main에 들어간 뒤 `python3 -I project-docs/plan/tools/status.py freeze <commit>`으로 적어야 wave 3이 열린다.

### 통합 (wave 3 끝)

`README.md` 2.7의 spec별 확인 흐름을 돌린다.
1. `deno task dev`로 띄워 흐름을 손으로 돈다.
2. 화면은 `LOPHN_SHELL_HEADLESS=1`과 `LOPHN_SHELL_SHOT_DIR`로 찍는다.
3. 흐름이 깨지면 그 단위에 고침 task를 새로 만든다.
4. 다 되면 cleanup task를 혼자 띄운다.

## 9. 막힘

- **worker가 중간에 멈추거나 실패했다:** 같은 brief로 다시 띄운다. 두 번 실패하면 brief를 쪼갠다.
- **문서에 답이 없다:** 추천안으로 진행하고 `../tmp/docs-review.md`에 적는다. 사람에게 올리는 것은 셋뿐이다.
  - 제품 동작
  - 비용
  - 되돌리기 비싼 것
- **권한 분류기가 막았다:** 우회하지 않는다. 사람에게 무엇을 왜 하려 했는지 말하고 정하게 한다.
- **같은 file을 두 task가 원한다:** `ownership.md`를 고쳐 한쪽에 주고, 다른 쪽은 선행을 걸어 뒤로 미룬다.

## 10. 사람에게 알리는 때

- wave 하나가 끝났을 때. 무엇이 merge됐는지와 push할지 묻는다.
- 계약 고정 commit을 만들었을 때.
- `blocked` task가 생겼고 오케스트레이터가 풀 수 없을 때.
- spec과 다르게 가야 할 때.
