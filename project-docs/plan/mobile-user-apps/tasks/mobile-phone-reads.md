# mobile-phone-reads

폰이 받을 화면 목록을 한 번에 내는 read `apps/phone_screens`의 handler를 짓는다. 켜진(active) release를 가진 앱마다 `phone` 화면과 그 release의 manifest(`phone.json`)를 bundle 사본에서 읽어 싣고, 앱 process가 지금 도는지 같이 낸다. 폰은 이 목록으로 앱 목록을 그리고 manifest로 화면을 받을지 정한다(bytes는 기존 `apps/screen_file`).

- 단위: phone-screen (wave 4)
- 선행: mobile-phone-contract, mobile-build-phone
- 소유(이 task만 고친다):
  - `packages/core/apps/phone/screens.ts`(새 file)
  - `packages/core/apps/phone/screens_test.ts`(새 file)
- 공유 줄 허락(한 줄씩만 더하고 보고의 "넘길 줄"에 적는다):
  - `packages/core/apps/register.ts`(`apiReads`에 `unattachedRead(appPhoneScreens)` 한 줄, `unattachedRead`의 type 목록에 이름)
  - `packages/core/main/daemon/wiring/apps.ts`(`reads(reads)`에 handler를 붙이는 한 줄. 본보기 `reads.set("apps/skills", appSkillsRead(...))`)
  - `packages/core/apps/routes.ts`(handler 함수를 `appSkillsRead` 옆에 두는 쪽이 낫다면 그만큼만. 아니면 위 소유 file 안에 둔다)
  - `packages/protocol/apps/registry.ts`(`mobile-phone-contract`가 route를 목록에 올리지 못했다면 한 줄)
- 읽을 것:
  - 본보기: `packages/core/apps/routes.ts`의 `appSkillsRead`(활성 release 선언 + bundle 사본의 파일을 읽는 main thread read), `packages/core/apps/screens/skills.ts`(`BundleLocator`로 bundle 사본의 파일을 안전하게 읽는 `realPath` 가드), `packages/core/apps/screens/serve.ts`(`serveFileUnder`), `core/apps/runtime/reads.ts`(앱 process가 도는지의 관측)
  - 계약: `packages/protocol/apps/phone.ts`의 `appPhoneScreens`와 `packages/protocol/apps/phone-screen.ts`의 `phoneManifestSchema`(`mobile-phone-contract`), 배치 `screens/<key>/phone.json`(`mobile-build-phone`)
  - architecture: `project-docs/architecture/app-call.md`(보관한 앱은 agent에게 없는 앱이고 사람(user)은 본다. 이 read의 actor는 user뿐이다)
- 계약:
  - 쓰는 것: `appPhoneScreens`(입력 `{}`, 출력 `{screens: [{app, app_name, icon, screen, label, params?, release, bundle_hash, manifest, running}]}`)
  - 내놓는 것: 그 handler와 등록. 폰 gate(`mobile-remote-gate`)가 이 route를 폰 allowlist에 올린다

## 할 일

1. `screens.ts`에 handler를 짓는다: `loadApps(sql, "active")`로 보관하지 않은 앱을 돌고, 앱마다 활성 선언(`loadActiveDeclaration`)의 화면 가운데 `places`가 `["phone"]`인 것을 고른다. 각 화면의 `bundle_hash`는 release 기록에서, `manifest`는 bundle 사본의 `screens/<key>/phone.json`을 `skills.ts`와 같은 가드(bundle 폴더 밖이나 symlink는 없는 file)로 읽어 `phoneManifestSchema`로 검사한다. manifest가 없거나 틀린 화면은 목록에서 뺀다(그 release는 준비 단계의 검사가 통과시킨 것이라 정상 앱에서는 없다. 빼는 이유를 주석 한 줄로 남긴다). `icon`은 `apps/icon`이 쓰는 선언의 icon 값 그대로(`readAppIcon`의 선언 쪽. 사람이 올린 icon은 폰이 `apps/icon`으로 따로 읽는다)다. `running`은 그 앱의 지금 live process가 ready이고 그 release인지의 관측이다.
2. 등록: `register.ts`에 `unattachedRead`로 올리고(handler 없음이면 `unavailable`) `wiring/apps.ts`가 handler로 덮는다. `as_of_seq`·`next_cursor`(null)는 `appSkills`가 아니라 `withReadCommon`을 쓰는 읽기의 방식을 따른다.
3. test(아래 위험 test 하나)와 정상 경로 한 개를 쓴다. 앱·release·bundle은 fake `BundleLocator`와 메모리 sql로 만든다.
4. flows catalog: 새 route의 입구와 outcome, 새 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다(core가 이 route를 등록하고 뜬다).
- 위험 test: "`apps/phone_screens`는 보관한 앱, 켜진 release가 없는 앱, `phone` 화면이 없는 앱, manifest가 bundle 폴더 밖(`..`, 밖을 가리키는 symlink)에서 읽히는 화면을 싣지 않는다"
- 남지 않음: 없음(더하기뿐).
- `project-docs/flows/`가 check를 통과한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 출력 예 하나(앱 둘, 하나는 running false), 등록할 것·넘길 줄.
