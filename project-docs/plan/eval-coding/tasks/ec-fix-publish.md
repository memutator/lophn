# ec-fix-publish

`package.publish`가 늘 "the app source has no commit"으로 떨어지는 bug를 고친다. agent tool이 agent runtime child 안에서 `git`을 띄우는데 그 process에는 git을 띄울 권한이 없다. HEAD를 core의 route가 읽게 옮긴다.

- 단위: ec-fix-publish (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/apps/package-routes.ts`(`packagePublishInputSchema`의 `commit` 칸과 그 주석만)
  - `packages/core/apps/packages/publish.ts`
  - `packages/core/apps/agent-tools/package.ts`(`headOf`, `package.publish` tool)
- 읽을 것:
  - 이슈: `project-docs/issues/coding-agent.md`의 절 "`package.publish`가 늘 ... 떨어진다"(지금, 영향, 고치려면). 이슈는 lead가 닫는다
  - `packages/core/lophn-agent/tools/runtime-permissions.ts`(agent runtime의 `allow_run`이 MCP server와 `/bin/sh`뿐인 이유)
  - `packages/core/apps/releases/prepare/git-extract.ts`(`GitRunner`, `gitCommandRunner`, `extractCommit`)
  - `packages/core/main/daemon/wiring/apps.ts`의 `publishPackage({...})` 조립(바꿀 필요가 없으면 두지 않는다)
- 계약:
  - 쓰는 것: memory route `packagePublish`, `GitRunner`.
  - 내놓는 것: `packagePublishInputSchema`에서 `commit`이 빠진다. route는 앱 source(`sourceRootOf(app)`)의 HEAD를 core process에서 읽어 그 commit을 낸다. 쓰는 쪽은 `packages/core/apps/agent-tools/package.ts` 하나다(`grep -rn "packagePublish" packages tests`로 확인). eval의 `tests/eval/restore/package.ts`는 tool을 `commit` 없이 부르므로 바뀌지 않는다.

## 할 일

1. `packages/protocol/apps/package-routes.ts`: `packagePublishInputSchema`에서 `commit` 칸을 지운다. `path` 칸 주석 "commit 안의 package 폴더."는 "앱 source HEAD commit 안의 package 폴더."로 고친다.
2. `packages/core/apps/packages/publish.ts`: `sourceRootOf` 다음에 `deps.git ?? gitCommandRunner()`로 `git -C <source> rev-parse HEAD`를 부른다. 40자 hex가 아니면(commit이 없는 저장소) `invalid_input`, git이 실패하면 `unavailable`이다. 그 commit을 `extractCommit`에 넘긴다. 낸 결과의 commit이 output이나 등록 입력에 이미 실리면 그대로 둔다.
3. `packages/core/apps/agent-tools/package.ts`: `headOf`와 `Deno.Command` 호출을 지운다. tool 입력의 `.omit({...})`에서 `commit: true`를 뺀다(schema에 칸이 없다). handler는 `appGet`으로 source 폴더가 없는 앱만 걸러 `invalid`로 답하고, 그 밖은 `packagePublish`를 부른다. `appGet`이 더는 필요 없으면 `routes`에서도 뺀다. tool 설명의 "The code is the HEAD commit of the app source, so commit the folder first."는 그대로 맞다.
4. 지운 이름(`headOf`, "the app source has no commit")을 `grep -rn`해 주석과 오류 글에 남은 것을 고친다.

## 끝남

- `deno task check:full`이 통과한다. core가 두 번 뜬다.
- 확인(commit하지 않는 probe, `.dev-data/ec-fix-publish/`): fake provider로 앱 하나를 켜고(`tests/support/app/activate.ts`의 길) App Engineer의 `package_publish` tool 호출로 `@me/<이름>` 1.0.0이 `packages/versions`에 나온다. 진짜 provider는 부르지 않는다.
- 위험 test: 없음.
- 남지 않음: `grep -rn "headOf\|has no commit" packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것
- 안 쓰게 된 export
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
