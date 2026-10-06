---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---

# worker 공통 (lead가 준다)
- 저장소 /home/pyosechang/projects/lophn. 먼저 docs/dev/team-brief.md(worker 지침)를 읽고 그대로 따른다.
- 모든 명령과 파일 경로는 lead가 준 worktree 절대 경로다(`git -C <worktree>`, `cd <worktree> && ...`). main checkout은 고치지 않는다.
- 사람·문서에 쓰는 말은 한국어, 개발자 용어는 영어 그대로(AGENTS.md).
- full `deno task check`는 돌리지 않는다. lead가 병합 직전에 최신 main을 합쳐 한 번 돌린다. worker는 PR 전에 바꾼 자리의 targeted `deno test`, `deno check <바꾼 파일·디렉터리>`, `deno fmt --check <바꾼 파일>`, `deno lint <바꾼 파일>`, docs를 고쳤으면 `node tools/check-docs.ts`만 돌린다. shell(apps/shell/main)을 고쳤으면 `npm --prefix apps/shell/main run check`도 돌린다. PR 전에 `deno run --allow-read tools/check-deps.ts`는 꼭 돌린다(다른 최상위·leaf 경계 직접 import 금지). 범위 밖 대상은 없는 것과 똑같이 답한다(forbidden으로 존재를 새지 않는다).
- 병합하지 않는다. PR을 열고 lead에게 보고한다: PR 번호, head sha, 바꾼 자리, check 결과, 테스트가 가리키는 요구, 남은 것.
- 다른 concern이 막으면 그 내용을 보고에 적는다.
- 계획 상태 줄의 PR 번호는 실제 번호여야 한다. 먼저 push하고 PR을 연 뒤, 받은 번호로 `- 상태: 완료 (#<번호>)`를 달아 같은 PR에 push한다. 번호를 추측하지 않는다.
- 절대 금지: 실제 사람 데이터 root(~/.lophn, ~/.config/lophn)를 열거나 쓰지 않는다. core·shell·worker를 띄울 때는 항상 LOPHN_HOME(또는 --home)을 temp dir나 worktree 안 .dev-data로 준다. 이 규칙을 어기면 사람의 이전 lophn 데이터가 망가질 수 있다.
- 테스트 fixture(node:sqlite·temp dir 쓰는 것)는 그 leaf의 `testing/mod.ts`에 두고 mod.ts에서 export하지 않는다. 다른 leaf의 fixture는 `<leaf>/testing/mod.ts`로 import한다(docs/dev/code-map.md). PR 전에 `packages/platform/responsiveness/core_imports_test.ts`도 돌린다.

## 구현에 집중 (사람 지시, 2026-10-06)

- 목표는 완료 기준을 채우는 구현이다. 일어나지 않은 문제나 미래 유지보수 비용을 위한 일반화·방어 코드·추가 리팩터링을 하지 않는다.
- 테스트는 완료 기준이 요구하는 것과 바꾼 동작을 확인하는 것만 쓴다. 같은 테스트를 부하 상태로 반복 돌리지 않는다. 넓은 회귀는 lead의 병합 검사가 맡는다.
- 바꾼 자리의 targeted test를 한 번 통과시키면 PR을 연다. 한 번 실패 뒤 다시 돌려 통과한 timing 실패는 보고에 한 줄만 적고 넘어간다.
- 자기 task 범위 밖의 일은 고치지 않고 받는 task에 `- <task>에서 넘어온 것:` 한 줄로 넘긴다. 단, 보안 경계(범위 밖 노출, 권한 우회)와 저장 안 된 blob의 가짜 hash는 고친다.
- plan 파일 끝에 새 Q 항목을 더하지 않는다(PR끼리 번호가 부딪힌다). 정한 것은 자기 task 블록의 상태 줄이나 완료 아래 한 줄로 적는다.
- contract 변경이 필요하면 멈추지 말고 additive하게 고쳐 PR에 넣고 보고에 적는다.

## Electron은 headless로만 (사람 지시)

- Electron 창을 사람 화면에 띄우지 않는다. 사람이 이 장치를 쓰고 있다.
- 이 장치에는 xvfb가 없고, Electron v44의 `--ozone-platform=headless`는 segfault한다. 쓰지 않는다.
- 확인된 방법: `BrowserWindow({ show: false, webPreferences: { offscreen: true } })`로 만들고, `webContents.on("paint", (_e, _dirty, image) => …image.toPNG())`로 screenshot을 뜬다. offscreen에서는 `capturePage()`가 UnknownVizError로 실패한다.
- shell 전체를 띄워 볼 때는 `LOPHN_SHELL_HEADLESS=1`이 main에 들어오면 그것을 쓴다(창 숨김·offscreen·`LOPHN_SHELL_SHOT_DIR`로 screenshot). 들어오기 전에는 위 방식의 작은 probe로만 확인한다.
- 띄운 Electron은 끝나면 반드시 자기가 띄운 정확한 pid만 멈추고, 남겨 두지 않는다. `--remote-debugging-port`로 오래 띄워 두지 않는다.

## git stash 금지

- git stash 목록은 모든 worktree와 worker가 함께 쓴다. `git stash`, `git stash pop`, `git stash apply`를 쓰지 않는다. 다른 worker의 작업을 집어 올 수 있다(실제로 일어났다).
- 작업을 잠시 치워야 하면 자기 branch에 WIP commit을 만들고 나중에 고친다. 기준선 확인은 `git worktree add <scratch 경로> origin/main`으로 따로 연다.
- 자기 PR에는 자기 작업 자리의 파일만 넣는다. 맡지 않은 concern의 파일이 diff에 보이면 PR 전에 빼고 보고한다.
