# 계획: 새 data root에서 앱을 만들어 release까지 가게 하고, 앱 호출·로그·check의 구멍을 막기

상태: 열었음. brief는 `tasks/`, 상태는 `status.md`(`python3 -I project-docs/plan/tools/status.py app-platform build`). lead는 `project-docs/plan/tools/lead/lead.sh app-platform`이 여는 worktree(branch `plan/app-platform`)에서 돌린다.

## 이 계획

- 목표: 새 data root에서 template으로 만든 앱이 release 준비를 지나게 하고(sdk 설치 사본, template, file 수), 화면 둘 이상인 앱의 오류 위치를 풀고, 앱 호출의 control frame 초과를 막고, crash를 log에 남기고, activation이 approvals 안을 건너 읽지 않게 하고, check를 막는 flaky test와 문서 속 없는 path를 잡는다.
- 재료:
  - `project-docs/issues/platform.md`의 sdk 설치 사본, template file 수, `app.js.map`, crash log 절
  - `project-docs/issues/app-call.md` 두 절
  - `project-docs/issues/activation.md`의 `approval-reads.ts` 절(정한 것 있음)
  - `project-docs/issues/code-health.md`의 `calls_test` flaky 절
  - `project-docs/issues/mistakes.md`의 "새로 쓴 문서와 주석이 지운 파일을 가리킴"(registry check 포함)
  - `project-docs/architecture/activation.md`, `project-docs/architecture/app-call.md`, boundary-catalog의 `apps`와 자식, `approvals`, `problems`
- 범위 밖: write app-api rewind 검사(`activation.md`에서 막히는 앱이 나올 때까지 두기로 정함), Reactor backoff 점검, agent 쪽(계획 `agent-place`, `agent-io`), 새 E2E·subprocess test.
- 단위(brief가 확정한다):
  - `sdk-install`: core 기동 때 `packages/sdk/*`와 지원 소스(`packages/design`, wording)를 `packageInstallPath` 자리에 읽기 전용으로 풀고 앱 template을 `templates/app/`에 둔다. 지워진 `apps/packages/install.ts` 함수를 git 기록에서 되살려 기동 조립에 잇는다. `packages/sdk/blueprint`·`cap-store`의 `../../protocol/…` 상대 import가 사본에서 풀리게 한다. 판은 각 `deno.json`의 `version`(`packages/design/deno.json`에 없으면 더한다).
  - `release-files`: `releases/bundle/vendor.ts`의 `collect`가 symlink를 따라 복사하지 않고 `.deno/` 안 실제 폴더만 담으며, bundle을 푸는 쪽이 `node_modules/<이름>` 연결을 다시 만든다.
  - `screen-maps`: 화면별 source map을 따로 봉인하고 `problems/snapshots/work.ts`가 stack의 화면 bundle에 맞는 map을 읽는다.
  - `call-frames`: `RESULT_MAX_BYTES`를 control frame 한도 아래로 낮추고, rewind apply 본문을 bytes frame stream으로 보낸다.
  - `crash-log`: `installCrashHandler`를 daemon 기동 앞, 앱 supervisor, 앱 process, shell main entry에 건다.
  - `approval-reads`: approvals가 `request(id)`·`pending()` 읽기를 공개 API로 내고 wiring이 끼운다. `main/daemon/wiring/approval-reads.ts`를 지운다.
  - `test-wait`: `apps/calls/calls_test.ts`의 `until`이 조건이 안 되면 실패를 던지고 기다림을 시간 상한(2초)으로.
  - `doc-paths`: `AGENTS.md`, `.claude/skills/`, `project-docs/`(change-log, `issues/archived`, `plan/`, `products/roadmap/` 제외)의 md·yaml에서 backtick 안 저장소 path가 있는지, `context-component-registry.yaml`의 `path`·`change_reasons.boundaries`·`roles`가 있는지 보는 check. `tools/check.ts`에 단계로 올리고, 지금 걸리는 문장을 고친다.
- 순서(초안): wave 1 모두. 같은 file(core 기동 조립 등)이 나오면 선행으로 묶는다.
- 사람이 정할 것: 없다.

## 정한 것

1. **sdk 설치는 이슈의 추천(지워진 install 함수를 되살려 기동에 잇기)으로 한다.** release bundle에 굳힌 사본의 격리를 지킨다.
2. **file 수는 상한을 올리지 않고 중복 복사를 없앤다.** 크기도 반으로 준다.
3. **source map은 화면별로 둔다**(이슈 추천 첫째). 읽는 쪽이 sections를 풀 필요가 없다.
4. **rewind apply는 bytes frame stream으로 보낸다.** write 하나씩 나누면 중간 실패 때 일부만 되돌린 상태가 된다.
5. **crash handler는 이슈의 "필요해질 때"를 지금 한다.** 사람이 원인을 모르는 기동 실패가 실제로 있고 곳마다 작다.
6. **문서 path check를 만든다.** 같은 mistake가 여러 번 났다(planner-persona "같은 실수가 두 번이면 check로 막는다").
7. **새 subprocess·서버 test를 만들지 않는다.** 확인은 unit test로 한다. process를 건너는 확인은 이 계획이 하지 않는다(E2E는 testing 계획 몫).

## 지켜야 할 것(worker brief에 그대로 넣는다)

- module은 `core/main`을 import하지 않는다. 바닥은 위층을 import하지 않는다. domain끼리는 problems → apps만.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 설치 사본은 읽기 전용이고 release bundle에 굳힌 사본과 섞지 않는다.

## 돌리기 전에

- 계획 `agent-place`, `agent-io`와 같이 돈다. 이 계획이 갖는 곳: `packages/core/apps`(단 `apps/agent-tools/`는 고치지 않는다), `packages/core/problems/snapshots`, `packages/core/approvals`, `packages/core/diagnostics`, `main/daemon/{main,core}.ts`와 `wiring/{apps,approval-reads}.ts`, `main/app-supervisor/`, `packages/sdk`, `packages/design/deno.json`, `shell/main`의 entry(crash handler만), `tools/check.ts`와 새 check file. 다른 두 계획은 이 file들을 소유하지 않는다.
- 다른 session이 test·E2E roadmap을 쓰고 있다. 그쪽이 계획을 열면 `tools/check.ts`, `tools/dev.ts`, `tools/fake-provider`를 고칠 수 있다. `doc-paths`는 `tools/check.ts`에 한 단계만 더한다.

## lead가 할 일

- merge 때마다 관련 이슈 절을 `issue` skill대로 닫는다.
- 모두 merged면 `architecture/activation.md`, `architecture/app-call.md`, boundary-catalog·module-catalog, `context-component-registry.yaml`(새 check 조각)을 고치고, changelog 열린 판에 항목을 덧붙이고, 이 폴더를 지운 commit까지 land한다.
