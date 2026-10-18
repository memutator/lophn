# fb-sdk-me

app test의 의존 확인이 앱이 낸 package(`@me/*`)의 설치 경로를 읽지 못해, `@me/*`를 import한 앱을 "선언하지 않은 의존"으로 떨어뜨린다. 경로를 맞게 읽게 고친다.

- 단위: fb-sdk-me (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/problems/tests/app-test/generate.ts`
  - `packages/core/problems/tests/app-test/generate_test.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/coding-agent.md`의 "앱이 낸 package를 import한 앱은 app test에서 \"선언하지 않은 의존\"으로 떨어진다"
  - 설치 경로: `packages/core/apps/packages/install.ts`의 `packageInstallPath`(`@me`는 `sdk/@me/<part>/<version>`, 내장은 `sdk/<part>/<version>`)
  - architecture: `project-docs/architecture/coding-agent.md`("release 확정", app test)
- 계약:
  - 쓰는 것: `generateAppTestChecks(input: AppTestInput)`, `AppTestInput`의 `dependencies`, `imports`
  - 내놓는 것: 바뀌는 계약 없음

## 할 일

1. `generate.ts`의 `SDK_COPY`를 `/^\.\/sdk\/(?:@me\/)?([^/]+)\/([^/]+)\//`로 바꾼다. 이름 비교(`item.name.split("/").pop() === copy[1]`)는 그대로 맞는다.
2. `generate_test.ts`를 만든다. `generateAppTestChecks`에 아래 셋을 넣고 의존 확인 결과를 본다(결과가 담기는 칸은 `checkDependencies`가 만드는 값을 따라간다).
   - `@me/date-range@1.0.0`을 선언하고 `"@me/date-range": "./sdk/@me/date-range/1.0.0/mod.ts"`를 import한다 → 선언하지 않은 의존이 없다.
   - 내장 SDK(`./sdk/<part>/<version>/...`)를 선언하고 import한다 → 지금처럼 통과한다.
   - `@me/other`를 선언하지 않고 import한다 → 선언하지 않은 의존으로 걸린다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "앱이 낸 `@me` package를 선언하고 import한 앱의 의존 확인이 통과하고, 선언하지 않은 `@me` import는 여전히 걸린다." 이것이 틀리면 package를 다시 쓰는 앱이 켜지지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 정한 것: 없으면 "없음"
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음"
