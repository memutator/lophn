# package

앱이 쓰는 package는 둘이다. lophn이 싣는 내장 SDK(`@lophn/<part>`)와, 앱 workspace의 agent가 앱 code 일부를 내놓은 사용자 package(`@me/<part>`)다. 둘 다 정확한 판 하나로 고정하고, 읽기 전용 설치 사본을 앱 폴더로 복사해 npm `file:` 의존으로 건다. release는 그 사본을 봉인하므로, 새 판이 나와도 이미 켠 release는 옛 판으로 돈다.

## 층

```
  packages/sdk/*, packages/design(ui·i18n)       앱 source의 package 폴더 (HEAD commit)
        │ installSdkCopies (core build마다)              │ package.publish
        ▼                                                 ▼
  <data>/sdk/<part>/<ver>/                  <data>/sdk/@me/<part>/<ver>/   ← 설치 사본 (0444/0555)
                                                  ▲ 기동 때 bundle blob에서 되살림
        │ syncAppSdk (scaffold, release prepare)
        ▼
  <app>/.lophn/sdk/...  (gitignore)  ── npm install ──▶ node_modules가 사본을 가리킴
        │ release prepare
        ▼
  release bundle 안 .lophn/sdk/... + node_modules  ← 봉인
```

## 정본

- `@lophn`: 설치 사본이 정본이다. catalog에 없다. 같은 name·version의 byte가 개발 중 바뀌어도 ledger 충돌이 없게 하려는 것이다. `packages.builtin`이 디스크에서 설치된 가장 높은 판과 guide를 읽는다.
- `@me`: ledger catalog(`packages`, `package_versions`)가 정본이다. 판 행은 trigger가 고치기·지우기를 막는다. bundle byte와 guide는 blob field `package_version/bundle`·`package_version/guide`(둘 다 permanent)로 보존하고, 설치 사본은 그 파생이다. core 기동(`sdkInstallWiring.start`)이 catalog의 판마다 사본이 없거나 다르면 bundle blob에서 다시 쓴다.

## 규칙

- 이름은 `@lophn/<part>`·`@me/<part>`, `part`는 `^[a-z0-9]+(?:-[a-z0-9]+)*$`. 판은 정확한 `x.y.z`이고 prerelease·범위는 없다. 판 목록은 숫자 순서다(`compareVersions`).
- 앱은 같은 판을 `package.json`(`file:.lophn/sdk/[@me/]<part>/<ver>`)과 `lophn.ts`의 `sdk_dependencies` 두 곳에 적는다. release prepare가 둘을 대조한다. 그 밖의 npm 의존은 정확한 판만 받는다.
- `@me` 이름은 전역이다. 처음 publish한 앱이 `owner_app`이고 그 앱만 새 판을 낸다. 앱을 지워도 package는 남는다.
- 같은 name·version을 같은 bundle·guide hash·permissions로 다시 내면 재시도로 받고(빠진 blob 참조만 붙인다), 하나라도 다르면 `conflict`다. description은 새 판을 낼 때 그 판의 값으로 바뀐다.

## publish (`package.publish`)

그 앱 workspace의 agent session만 부른다(route `actors: ["agent"]` + credential의 `conditions.app`). 사람 승인은 없다. core가 순서를 정한다(`packages/core/apps/packages/publish.ts`).

1. 앱의 source 폴더에서 `git rev-parse HEAD`. commit tree만 읽고, 저장소 전체가 clean이어야 한다(tracked 변경·untracked가 하나라도 있으면 거절). symlink는 거절.
2. `path/` 아래 file을 뽑는다. `package.json`의 `name`·`version`이 입력과 같아야 한다. `@lophn`·`@me` 의존은 설치 사본 사이의 `file:` 상대 경로로 다시 쓴다.
3. 폴더의 `@lophn/cap-*` 의존이 요구하는 permission(`SDK_REQUIRED_PERMISSIONS`)을 입력 `permissions`가 덮어야 한다.
4. bundle byte와 guide(`# Purpose`/`# API`/`# Examples`)의 sha256을 만들고 blob을 준비한다.
5. machine route `package.register_version`이 같은 tx에서 판을 넣고 두 blob 참조를 건다.
6. 설치 사본을 쓴다. 실패해도 판은 남고, 다음 기동이나 같은 내용의 재시도가 사본을 채운다.

앱 agent가 따르는 절차는 내장 skill `publish-package`다.

## permission

core는 SDK code를 import하지 않으므로 capability package의 요구를 `packages/core/apps/releases/sdk-permissions.ts`에 옮겨 적는다. release prepare는 그 요구와, 선언이 고정한 `@me` 판마다 catalog의 `permissions`를 모두 선언의 `permissions`에서 찾는다. 없으면 `invalid_input`이다. `@me`가 다른 `@me`에 기대는 경우는 따라가지 않는다(`project-docs/issues/app-call.md`). 실행 때 막는 것은 broker다(`app-call.md`).

## 판 올리기

- 내장 SDK의 판을 올리면 `migrate-sdk` 메모를 쓴다(`sdk-note` skill). `app.sdk_status`가 앱의 켜진 release가 봉인한 판을 설치된 판·`supported_from`과 견줘 `required`/`available`/`current`를 낸다.
- `@me` 판은 메모가 없다. 낸 앱이 그 판을 쓰는 앱(`packages.usage`, `package.read`의 `used_by`)의 lophn에게 `call send`로 알리고, 소비 앱이 두 곳의 pin을 같이 올린다.
