# mobile-local-prepare

release 준비에 폰 backend를 건다: 선언의 `runs_on`에 `phone`이 있으면 준비가 `mobile-local-build`의 build와 load 검사, 폰 schema 검사, SDK 하한을 돌리고 `phone/backend.js`·`backend.json`을 bundle에 담는다. 어기면 준비가 agent가 읽고 고칠 수 있는 영어 한 줄로 실패한다. 폰이 받을 길도 연다: `apps/phone_screens`의 항목에 `runs_on`과 `backend`(manifest)를 더하고, 폰이 backend와 migration file을 받는 file route `apps/phone_file`을 짓는다.

- 단위: phone-backend (wave 5)
- 선행: mobile-local-decl, mobile-local-build. **중간 land 뒤**(단계 6 `mobile-build-phone`이 고친 `prepare/{from-source,flow}.ts`와 `ui-build/`, `mobile-phone-reads`의 `core/apps/phone/screens.ts`가 main에 있어야 한다)
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/prepare/{from-source,flow,checks,from-source_test,flow_test,checks_test}.ts`
  - `packages/core/apps/releases/ui-build/staging-guard.ts`
  - `packages/core/apps/releases/phone-backend`(단계 6의 `staging-guard.ts`를 쓰게 하는 만큼)
  - `packages/protocol/apps/phone.ts`
  - `packages/core/apps/phone/{screens,screens_test}.ts`
  - `packages/core/apps/phone/{files,files_test}.ts`(새 file)
  - `tests/support/app/local`(선언에 `runs_on`을 더하는 만큼)
- 공유 줄 허락(한 줄씩, 보고의 "넘길 줄"에): `packages/protocol/apps/registry.ts`(`apps/phone_file`), `packages/core/apps/register.ts`(handler 등록), `packages/core/main/daemon/wiring/apps.ts`(handler를 붙이는 줄)
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-survey.md` 2(d)(release 검사), 4의 "Phone package"·"`apps/phone_screens` entries"·"New file route"
  - build와 검사: `packages/core/apps/releases/phone-backend/`와 `mobile-local-build`의 보고(부를 함수, child 진입, 걸린 시간), `packages/protocol/apps/phone-backend.ts`(manifest), `packages/protocol/apps/activation/phone-schema.ts`
  - 단계 6의 준비: `prepare/from-source.ts`(`runChild`, `eval-declaration`, `app-build`, 폰 화면 갈래와 `npm prune --omit=dev`), `prepare/flow.ts`, `prepare/checks.ts`(`checkMigration`의 scratch DB), `ui-build/staging-guard.ts`, 제한 `packages/protocol/apps/releases.ts`(준비 시간과 bundle 상한)
  - 단계 6의 폰 읽기: `packages/protocol/apps/phone.ts`(`appPhoneScreens`), `packages/core/apps/phone/screens.ts`(활성 release의 선언과 bundle 사본에서 manifest를 읽는 길, `BundleLocator`의 realpath 가드), file route 본보기 `packages/protocol/apps/calls/screen.ts`와 그 handler
  - 선언: `packages/protocol/apps/declaration/types.ts`의 `runs_on`과 `sdk_dependencies`(`mobile-local-decl`)
- 계약:
  - 쓰는 것: 위 build·검사 함수와 manifest schema, 선언의 `runs_on`
  - 내놓는 것:
    - 준비 실패 이유(stage `build` 또는 `migration`): build·load 검사의 문장 그대로, 폰 schema 문장(`phoneSchemaProblems`), SDK 하한 "an app that runs on the phone needs @lophn/cap-store 2.0.0 and @lophn/cap-tool 2.2.0 or later"
    - `apps/phone_screens` 항목에 `runs_on: ("computer" | "phone")[]`(선언에 없으면 `["computer"]`), `backend: PhoneBackendManifest | null`(`phone`이 없으면 null)
    - `apps/phone_file`(`defineFile`, resource `apps`, method `phone_file`, actors `["user"]`): 입력 `{app, release, path}`. path는 그 release의 `backend.json`이 적은 것(`phone/backend.js`, `phone/backend.json`, `migrations/<from>-<to>.sql`)만. release가 그 앱의 활성 release가 아니거나 path가 목록 밖이면 `not_found`. 오류 `invalid_input`, `not_found`, `unavailable`

## 할 일

1. 준비(`from-source.ts`, `flow.ts`): 선언(이미 eval한 JSON)의 `runs_on`에 `phone`이 있으면 app build 뒤, `npm prune` 앞에(build가 staging의 SDK 사본을 읽는다) `phone-backend/main.ts` child를 돌린다. 결과 file을 bundle의 `phone/`에 담고 file 수·byte 상한 계산이 센다. child가 실패하면 준비가 그 문장으로 실패한다. 준비 시간 상한 안에 드는지 fixture로 재서 보고한다.
2. 검사(`checks.ts`): `runs_on`에 `phone`이 있으면 `checkMigration`이 target까지 올린 scratch DB(빈 DB에서 올린 것)에서 `phoneSchemaProblems`를 부른다. SDK 하한은 선언의 `sdk_dependencies`로 본다.
3. import guard: `phone-backend/`의 작은 guard를 단계 6의 `ui-build/staging-guard.ts` 하나로 합친다.
4. `apps/phone_screens`(`phone.ts`, `core/apps/phone/screens.ts`): 두 칸을 더한다. manifest는 bundle 사본의 `phone/backend.json`을 schema로 읽는다(읽지 못하면 그 앱 항목을 싣지 않고 log 한 줄).
5. `apps/phone_file`(`phone.ts`, `core/apps/phone/files.ts`): bundle 사본에서 그 file을 realpath 가드로 읽어 준다(`screens.ts`의 길). 등록 줄 셋.
6. fixture `tests/support/app/local`의 선언에 `runs_on: ["computer", "phone"]`과 폰 화면 하나를 더하고(`tests/support/app/phone`의 kit stand-in을 쓴다), 준비 test로 정상 경로 하나와 아래 위험 test.

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- 위험 test:
  - "`runs_on`에 `phone`이 있는 앱은 `node:` import, 선언과 다른 handler, 정수 PK·AUTOINCREMENT·trigger, SDK 하한 아래 가운데 하나만 있어도 준비가 실패하고, `phone`이 없는 앱의 준비는 그대로다"
  - "`apps/phone_file`은 그 release의 `backend.json`이 적은 file만 주고, 목록 밖 path(`..`, 다른 화면 file, `node_modules`)와 활성이 아닌 release는 `not_found`다"
- 남지 않음: `grep -rn "staging-only" packages/core/apps/releases`가 `ui-build/staging-guard.ts` 한 곳이다.
- flows catalog: 이 task가 더하는 route, 준비 실패 갈래, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: fixture의 준비 결과(file 목록과 크기, 걸린 시간), 실패 문장 예 넷, `apps/phone_screens`와 `apps/phone_file`의 최종 모양.
