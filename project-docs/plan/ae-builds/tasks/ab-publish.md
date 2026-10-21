# ab-publish

`package.publish`가 통과한 app test를 요구하지 않게 하고, ticket protocol에서 빌려 쓰던 source 경로 schema를 apps protocol로 옮긴다. test runner와 ticket을 지우기 전에 package 쪽을 떼는 일이다.

정한 것: `package.publish` 입력의 `tests`를 지운다. 이유: README가 test runner를 지운다. verification id를 만드는 곳이 없어지고, 앱 test는 App Engineer가 앱 source에서 shell로 돌린다(roadmap "정한 것(사람)" 2026-10-21). README "뼈대 검토에서 정한 것"의 "지우기가 끌고 오는 것도 지운다"가 같은 말이다.

- 단위: publish (wave 1)
- 선행: ab-source. 같은 wave에서 `packages/core/main/daemon/wiring/apps.ts`를 고친다.
- 소유(이 task만 고친다):
  - `packages/protocol/apps/package-routes.ts`
  - `packages/core/apps/packages/publish.ts`
  - `packages/core/apps/agent-tools/package.ts`
  - `packages/core/main/daemon/wiring/apps.ts`(`publishPackage`의 `verification`과 그 import만)
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "뼈대 검토에서 정한 것"("지우기가 끌고 오는 것도 지운다: `package.publish`의 `tests`")
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "정한 것(사람)" 2026-10-21 "lophn program이 test runner를 알고 돌리는 것도 지운다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `package-registry`, `agent-tool-spi`; `project-docs/module-catalog.yaml`의 `packages/core/apps`, `packages/protocol`
  - 코드(줄은 main `dd956b49f`. `wiring/apps.ts`는 ab-source merge 뒤라 줄이 밀린다. 이름으로 찾는다)
    - `packages/protocol/apps/package-routes.ts`의 `packagePublishInputSchema`(67-90. `tests`는 87줄), `packagePublish`(92-100). `idSchema` import(13)는 `packageRegisterVersionInputSchema`의 `owner_app`(38)도 쓴다.
    - `packages/protocol/coding-agent/ticket/values.ts`의 `sourceRelativePathSchema`(13-21). 쓰는 곳은 이 file 안(94, 120)과 `agent-tools/package.ts` 둘이다. ticket 쪽 정의는 ab-ticket-delete가 지운다.
    - `packages/core/apps/packages/publish.ts`의 머리 주석(1-2), `AppTestVerificationLookup` import(10), `PublishDeps.verification`(34), test 확인 고리(66-76)
    - `packages/core/apps/agent-tools/package.ts`의 import(25), `package.publish` tool(170-197. 입력은 route schema에서 `key`와 `path`를 빼고 `path`를 `sourceRelativePathSchema`로 바꾼 것, 설명 178)
    - `packages/core/main/daemon/wiring/apps.ts`의 problems import(81-84. `findAppTestVerification`, `findPassedAppTest`), `publishPackage({...})`의 `verification:` 줄(371). `findPassedAppTest`는 activation deps(168)가 아직 쓴다(ab-release-prepare가 지운다).
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: `packagePublish` 입력에 `tests`가 없다. `publishPackage` deps에 `verification`이 없다. `package.publish` tool 설명에 test가 없다. `sourceRelativePathSchema`는 `packages/protocol/apps/package-routes.ts`에서 온다. ticket protocol의 같은 이름은 ab-ticket-delete가 지운다. `findAppTestVerification`(test runner 쪽)은 wiring이 더 import하지 않는다(test runner 안 `request-ports.ts`가 아직 쓰니 지우지 않는다).

## 할 일

근거: README "뼈대 검토에서 정한 것", roadmap "정한 것(사람)" 2026-10-21.

1. `package-routes.ts`
   - `packagePublishInputSchema`에서 `tests`(87)를 지운다.
   - `sourceRelativePathSchema`를 `ticket/values.ts` 13-21과 같은 정의로 옮겨 export한다. 위 주석("앱 source 안 상대 위치. 절대 경로·루트 밖 `..`·빈 조각은 거절한다")도 가져온다. `packages/protocol/apps/mod.ts`가 `export *`로 내보낸다. 최상위 `packages/protocol/mod.ts`는 namespace로 내보내서 ticket 쪽 같은 이름과 부딪히지 않는다.
2. `publish.ts`
   - 66-76의 test 확인 고리, `PublishDeps.verification`(34), `AppTestVerificationLookup` import(10)를 지운다.
   - 머리 주석 2줄의 "통과한 test가 있어야 하고"를 지운다. 자격 검사(agent이고 `conditions.app`이 그 앱, 57-62)는 그대로다.
3. `agent-tools/package.ts`
   - `sourceRelativePathSchema` import를 `../../../protocol/apps/package-routes.ts`로 옮긴다(25줄을 24줄 import에 합친다). tool file은 base, protocol, 같은 폴더, spi만 import한다(`tools/check-deps.ts`의 tool-file 규칙).
   - 설명(178)에서 "and tests (ids of passed app tests of this app)"를 지운다. 예: "Publish a folder of an app's code as a user package (@me/...). Give the version, a one line description, the guide (purpose, api, examples) and the permissions it needs. The code is the HEAD commit of the app source, so commit the folder first."
   - 입력 모양은 지금처럼 route schema에서 `key`와 `path`를 빼고 `path: sourceRelativePathSchema`를 더한 것이다. `tests`는 route schema에서 빠지므로 저절로 없다.
4. `wiring/apps.ts`
   - `publishPackage({...})`의 `verification: (id) => findAppTestVerification(link.sql, id),` 줄을 지운다.
   - problems import에서 `findAppTestVerification`만 뺀다. `findPassedAppTest`는 남긴다.
5. 위험 test: 없음. 요구 하나를 지울 뿐이고 publish의 자격 검사와 설치 사본 규칙은 그대로다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음
  - `git grep -n "verification\|AppTestVerification\|tests" -- packages/core/apps/packages/publish.ts`가 0줄이다.
  - `git grep -n "coding-agent/ticket" -- packages/core/apps/agent-tools/package.ts`가 0줄이다.
  - `git grep -n "findAppTestVerification" -- packages/core/main`이 0줄이다.
  - `git grep -n "tests:" -- packages/protocol/apps/package-routes.ts`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음(`packages/protocol/apps/mod.ts`는 `export *`다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): `packages/protocol/problems/app-test-lookup.ts`의 `AppTestVerificationLookup`을 apps 쪽이 더 쓰지 않는다(test runner가 쓰니 남긴다. ab-runner-delete가 지운다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳. e2e·eval(`tests/e2e`, `tests/eval`)이 `tests`를 보내면 고치지 않는다(사람)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 예: tool 입력은 `path: "."`를 받지만 route의 `relativePathSchema`(`packages/protocol/projects/values.ts` 28-36)가 `.`을 거절한다. 지금도 같다.
