# bu-preview-screen

preview 탭의 앱 화면이 빈다. core의 `/apps/screen_file`이 preview 대상(`{mode: "preview", app, process_nonce}`)을 늘 `not_found`로 답하기 때문이다(`packages/core/apps/routes.ts`의 `bundleLocatorOf`: `if (target.mode !== "live") return missing();`). 지금 돌고 있는 그 preview의 봉인된 bundle에서 화면 file을 내주게 고친다.

- 단위: bu-preview (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/routes.ts`(`bundleLocatorOf`와 그 주석)
  - `packages/core/apps/preview/{service,model}.ts`
  - `packages/core/main/daemon/wiring/apps.ts`(locator에 preview 조회를 넘기는 곳만)
  - 위 file 옆의 `*_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`(preview mode), `project-docs/architecture/workspace-layout.md` "agent가 연 탭"(preview 탭)
  - 본보기: `packages/core/apps/preview/service.ts`(`live` map: 앱마다 `{nonce, declared, bundle_hash}`), `packages/core/apps/releases/bundle/seal.ts`의 `bundleCopyPath`, `packages/core/apps/releases/activation/desired.ts`의 `createCopyPreviewBundles`(preview bundle이 어디에 열리는지), `packages/shell/main/app-frame/app-protocol.ts`(shell이 screen file을 어떤 target으로 묻는지)
  - 재현: lead의 확인 script `/home/pyosechang/projects/lophn/.claude/worktrees/plan-browser-use/.dev-data/verify/preview-screen-file.ts`(읽기만. 실행하려면 그 worktree에서 `timeout 900 node tools/electron-node.ts .dev-data/verify/preview-screen-file.ts`. 고친 core로 돌리려면 이 script를 네 worktree의 `.dev-data/bu-preview-screen/`로 복사해 고쳐 돌린다)
- 계약:
  - 쓰는 것: `/apps/screen_file`의 target 꼴(그대로), `BundleLocator.dir(target)`(그대로)
  - 내놓는 것: 없음

## 할 일

1. `BundleLocator.dir`이 preview 대상이면 그 앱에 지금 살아 있는 preview의 nonce가 `target.process_nonce`와 같을 때만 그 preview의 bundle 사본 폴더를 돌려준다. nonce가 다르거나(멈춘·바뀐 preview) 없으면 `not_found`다. preview service의 `live` map을 동기로 읽는 조회 하나를 service에 더하고 wiring이 locator에 넘긴다. 사본 자리는 preview가 연 bundle의 자리를 그대로 쓴다(새 사본을 만들지 않는다).
2. live 대상의 동작은 바꾸지 않는다.
3. 주석 "preview 대상의 사본 자리는 이 동기 조회로는 알 수 없어"를 고친다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "preview 대상의 screen file은 그 앱의 지금 preview nonce일 때만 나오고, 멈춘 preview의 옛 nonce와 다른 앱의 nonce는 `not_found`다"(locator test. 가짜 service)
- 남지 않음: `grep -rn "preview 대상의 사본 자리는" packages`가 0줄.
- 재현 script를 고친 core로 돌려 preview target의 `index.html`·`main.js`가 200인 것을 보고에 붙인다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
