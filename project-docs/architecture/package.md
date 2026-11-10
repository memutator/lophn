# package

앱이 쓰는 package는 둘이다. lophn이 싣는 내장 SDK(`@lophn/<part>`)와, 앱 workspace의 agent가 앱 code 일부를 내놓은 사용자 package(`@me/<part>`)다. 둘 다 정확한 판 하나로 고정하고, 읽기 전용 설치 사본을 앱 폴더로 복사해 npm `file:` 의존으로 건다. release는 그 사본을 봉인하므로, 새 판이 나와도 이미 켠 release는 옛 판으로 돈다.

## 문제

- 앱 code는 agent가 쓴다. 앱이 의존하는 SDK와 다른 앱의 code가 앱이 모르는 사이에 바뀌면, 이미 켠 release가 깨지고 사람은 이유를 모른다. 판이 한번 정해지면 byte까지 바뀌지 않아야 한다.
- 한 앱이 만든 code를 다른 앱이 가져다 쓰려면 이름, 판, 안내, 필요한 권한이 한 곳에 공개돼 있어야 한다. 없으면 앱마다 같은 code를 복사해 고치고, 한쪽의 수정이 다른 쪽에 닿지 않는다.
- 공개한 판의 byte가 한 군데(디스크 사본)에만 있으면 그것을 잃는 순간 그 판을 고정한 앱을 다시 지을 수 없다. 이것은 사용자 data다.
- npm은 registry 이름으로 풀려 하고, Node는 `node_modules` 안의 `.ts`를 돌리지 않는다. 앱 source 안에서 npm이 SDK를 찾게 하는 길이 따로 필요하다.
- 소비 앱이 package가 필요로 하는 권한을 선언하지 않고 release를 내면 실행 중에야 거절로 드러난다.

## 목표와 비목표

- 목표: 판이 불변이다. 앱이 고정한 판은 release에 봉인되어 새 판이 나와도 그대로 돈다. 공개 판의 byte는 잃지 않는다. 필요한 권한은 release를 내는 때 드러난다.
- 목표: 앱 agent가 사람 승인 없이 자기 앱 code의 일부를 낼 수 있고, 다른 앱이 정확한 판으로 가져다 쓴다.
- 비목표: 범위(`^`, `~`), prerelease, registry. 판은 정확한 `x.y.z`만 받는다. 얻는 것이 없는 것을 ledger와 protocol에 넓히지 않는다.
- 비목표: 낸 판의 수정과 삭제. 틀리면 새 판을 낸다.
- 비목표: 내장 SDK를 catalog에 등록하는 것. 개발 중 같은 이름·판의 byte가 바뀌어도 기동이 막히지 않게 하려는 것이다.
- 비목표: `@me`가 기대는 다른 `@me`의 권한을 따라가는 것(열린 것).

## 모델

```
  내장 SDK 원본, design(ui·i18n)                 앱 source의 package 폴더 (HEAD commit)
        │ core build마다                                │ package.publish
        ▼                                                ▼
  <data>/sdk/<part>/<ver>/                  <data>/sdk/@me/<part>/<ver>/   ← 설치 사본 (파일 0444, 폴더 0555)
                                                  ▲ core 기동 때 ledger의 bundle blob에서 되살림
        │ 앱 폴더로 복사 (앱 scaffold, release 준비, agent shell의 npm install 앞)
        ▼
  <app>/.lophn/sdk/...  (gitignore)  ── npm install ──▶ node_modules가 사본을 가리킴
        │ release 준비
        ▼
  release bundle 안 .lophn/sdk/... + node_modules  ← 봉인
```

- **이름.** `@lophn/<part>`, `@me/<part>`. `part`는 `^[a-z0-9]+(?:-[a-z0-9]+)*$`다. 같은 part가 두 scope에 있어도 설치 위치가 다르다(`sdk/<part>`, `sdk/@me/<part>`).
- **판.** 정확한 `x.y.z`. 판 목록은 숫자 순서다(`0.10.0`이 `0.9.0` 뒤).
- **설치 사본.** package 한 판의 자기 완결 byte를 data root의 `sdk` 아래에 푼 읽기 전용 폴더다. 사본끼리의 의존은 두 설치 위치 사이의 `file:` 상대 경로로 바뀌어 있다. 정확한 npm 의존은 판 그대로 둔다. 내장 SDK가 repo 밖의 source(protocol 검증기 같은)를 가져오는 자리는 사본 안 `vendor/`에 함께 담아 사본만으로 읽히게 한다. 원본 file은 고치지 않고, 바꾼 byte가 사본의 hash가 된다.
- **앱 사본.** 앱이 `package.json`의 `file:.lophn/sdk/[@me/]<part>/<ver>`로 건 판의 설치 사본을 앱 폴더 `.lophn/sdk` 아래에 실제 file로 복사한 것이다. 사본 사이의 의존도 따라가며 복사한다. 설치되지 않은 판이면 `not_found`이고, 이유에 설치된 판 목록과 "앱의 의존을 설치된 판으로 올리라"는 안내가 실린다.
- **bundle blob.** `@me` 한 판의 설치 사본 byte(파일 경로·길이·byte를 이은 하나의 byte열)다. 그 sha256이 `bundle_hash`다.

## 정본

- `@lophn`: 설치 사본이 정본이다. catalog에 없다. `packages.builtin`이 디스크에서 설치된 가장 높은 판과 안내를 읽는다. 안내는 SDK의 안내 file이 있으면 그것이고, `@lophn/ui`처럼 없으면 분류별 export 색인과 예산 안의 props 정의를 읽을 때 사본의 source에서 뽑아 만든다.
- `@me`: ledger catalog(`packages`, `package_versions`)가 정본이다. 판 행은 trigger가 고치기와 지우기를 막고 package 행도 지울 수 없다. bundle byte와 안내는 blob field `package_version/bundle`·`package_version/guide`(둘 다 permanent)로 보존하고, 설치 사본은 그 파생이다. `package_version/guide`는 일반 읽기를 열고(공개 catalog 자료), `package_version/bundle`은 사본을 되살리는 core만 읽는다.
- catalog 값: package는 `id`, `name`, 한 줄 `description`, `owner_app`(없을 수 있다)이고, 판은 `version`, `bundle_hash`, `guide_hash`, `permissions`다.

## 규칙

- 앱은 같은 판을 `package.json`(`file:.lophn/sdk/[@me/]<part>/<ver>`)과 앱 선언의 `sdk_dependencies` 두 곳에 적는다. release 준비가 둘을 대조해 다르면 `invalid_input`이다.
- 그 밖의 npm 의존은 정확한 판만 받는다. 범위, 원격 주소(`npm:`·URL), 앱 폴더 밖 경로, 설치 사본 꼴이 아닌 `file:` 값은 release 준비가 거절한다.
- `@me` 이름은 전역이다. 처음 publish한 앱이 `owner_app`이고 그 앱만 새 판을 낸다(다른 앱은 `forbidden`). 앱을 지워도 package와 판은 남고 `owner_app`은 비워진다(null). `owner_app`이 없는 package는 다음에 publish한 앱이 주인이 된다.
- 같은 name·version을 같은 bundle hash, guide hash, permissions로 다시 내면 재시도로 받는다. 이때 새 판 행도 event도 없고 빠진 blob 참조만 붙는다. 하나라도 다르면 `conflict`이고 공개 판은 바뀌지 않는다. 이미 낸 판의 description은 바뀌지 않는다. 새 판을 낼 때 그 판의 description이 package의 description이 된다.
- 판 등록(`package.register_version`)은 machine 자격만 부른다. 사람도 agent도 직접 부르지 않고 publish가 부른다. 등록은 판 행, blob 참조 둘, `PackageVersionRegistered` event를 같은 tx에 넣는다. blob의 hash·목적이 입력과 다르거나 그 호출자가 준비한 blob이 아니면 `invalid_input`이다.
- 설치 사본은 같은 byte면 그대로 두고 다르면 지우고 다시 쓴다. 사본은 읽기 전용이라 덮어쓰지 않는다.

## publish (`package.publish`)

그 앱 workspace의 agent session만 부른다(route actor는 agent이고 credential의 앱 조건이 그 앱과 같아야 한다. 아니면 `forbidden`). 사람 승인은 없다. 이름은 `@me/...`여야 한다. core가 순서를 정한다.

1. 앱의 source 폴더에서 HEAD commit을 읽는다. agent runtime child는 git을 띄울 수 없어 core가 읽는다. source 연결이 없으면 `invalid_input`, HEAD를 못 읽으면 `unavailable`이다. commit tree만 읽고, 저장소 전체가 clean이어야 한다(tracked 변경이나 untracked가 하나라도 있으면 거절). symlink, 폴더 밖 경로, git metadata는 거절한다.
2. 입력 `path` 아래 file을 뽑는다. 비어 있으면 `invalid_input`이다. 그 폴더의 `package.json`이 있어야 하고 `name`·`version`이 입력과 같아야 한다. `@lophn`·`@me` 의존은 정확한 판이어야 하고 설치 사본 사이의 `file:` 상대 경로로 다시 쓴다.
3. 폴더 `@lophn/cap-*` 의존이 요구하는 permission을 입력 `permissions`가 덮어야 한다. `permissions`는 선언 permission 여섯 이름(`fs.read`, `fs.write`, `net.fetch`, `net.listen`, `secret.use`, `notify.send`)만 받는다.
4. 안내는 세 절(`# Purpose`, `# API`, `# Examples`)을 core가 정해진 모양으로 이은 byte다. 각 절은 앞뒤 공백만 다듬고 나머지는 손대지 않는다. 이 byte와 bundle byte의 sha256을 만들고 blob으로 준비한다. 안내의 구조나 정확성은 검사하지 않는다.
5. machine route `package.register_version`이 같은 tx에서 판을 넣고 blob 참조 둘을 건다.
6. 설치 사본을 쓴다. 쓰기가 실패하면 `unavailable`로 답하지만 판은 이미 등록돼 남는다. 다음 기동이나 같은 내용의 재시도가 사본을 채운다.

앱 agent가 따르는 절차는 내장 skill `publish-package`다.

## 읽기

- `packages.builtin`(user·agent): 설치된 `@lophn` 사본의 목록과 안내. 설치되지 않은 이름은 `not_found`, 사본을 못 읽으면 `unavailable`이다.
- `packages.list`·`packages.versions`·`packages.usage`: catalog 목록(`@me`를 `@lophn`보다 먼저), 한 package의 주인 앱과 판들, 한 판을 켜진 release로 고정한 앱(`used_by`). usage는 지금 켜진 release만 센다. 지난 release와 archived 앱은 그 판으로 더 돌지 않아, 세면 고칠 곳을 잘못 짚는다. 등록 안 된 package는 `not_found`다.
- `packages.guide_body`: 정확한 판의 안내 blob 구간. 그 field 하나만 열린다.
- CLI `package.read`는 이를 합쳐 안내를 한 창(24 KiB)씩 준다. 결과 JSON 전체(다른 칸 포함)가 한 창 안에 들도록 자르고, 남았으면 `guide_truncated`와 `guide_next_offset_bytes`로 이어 읽게 한다. 사용처 목록이 창을 다 차지하면 그 목록을 비워 안내 자리를 내고, 그래도 안내 한 글자도 못 넣으면 잘라 숨기지 않고 `unavailable`이다. 안내 본문 자체의 예산은 20 KiB다. 색인과 예산 안의 props가 한 번에 오고, 넘는 부분은 앱 폴더의 사본에서 읽는다.

## 설치와 복구

- core build(runtime 뒤, API 앞)가 내장 SDK 원본 중 판이 있는 폴더 전부와 design의 지원 소스(`@lophn/ui`, `@lophn/i18n`)를 설치 사본으로 푼다. 하나라도 실패하면 build가 멈추고 core는 뜨지 않는다. 옛 SDK 사본은 따로 싣지 않는다.
- core 기동(API가 열린 뒤, blob을 읽으려면 I/O worker가 떠 있어야 해서)은 catalog의 `@me` 판마다 설치 사본과 bundle blob을 맞춘다. 사본이 없거나 다르면 bundle blob에서 다시 쓴다. catalog를 읽지 못하면 `internal`로 기동이 멈춘다.
- bundle blob이 없는 옛 판(blob 등록 전에 낸 판)은 설치 사본의 `package.json`에서 `file:` 재작성을 되돌려 bundle byte를 다시 만들고, sha256이 `bundle_hash`와 같을 때만 그 byte로 blob을 만들어 `package.register_version` 재시도로 참조를 붙인다. `owner_app`이 없는 판은 주인을 바꾸게 되므로 붙이지 않는다. blob 참조가 붙어야 하고 SQL만으로 안 되므로 schema step이 아니라 기동 단계에서 멱등으로 돈다.
- 되살리지 못한 판은 log `me_copy_skipped`로 남기고 core는 계속 뜬다. 그 판을 고정한 앱의 사본 복사만 `not_found`로 실패한다.
- 앱 사본 복사는 앱 scaffold, release 준비의 staging, agent shell의 `npm`(`install`·`ci`·`add`·`update` 앞)에서 일어난다. 복사에 실패해도 shell의 npm은 그대로 돌아 풀리지 않는 SDK 의존이 npm 오류로 보이고, release 준비는 `sdk_not_installed`로 실패한다. release 준비의 npm은 install script를 돌리지 않는다. bundle에는 설치된 file만 필요하고 registry의 임의 code를 사람 기계에서 돌릴 이유가 없다.

## permission

core는 SDK code를 import하지 않으므로 capability package가 요구하는 permission을 같은 값으로 따로 가진다. 요구는 `@lophn/cap-fs`(`fs.read` 또는 `fs.write`), `cap-net`(`net.fetch`), `cap-notify`(`notify.send`), `cap-secret`(`secret.use`와 `net.fetch` 둘 다)다. release 준비는 선언한 `@lophn/cap-*`의 요구와, 선언이 고정한 `@me` 판마다 catalog에 적힌 `permissions`를 모두 선언의 `permissions`에서 찾는다. 없으면 `invalid_input`이고 어느 package가 무슨 permission을 요구하는지 싣는다. catalog에 없는 `@me` 판은 `invalid_input`이다. 검사도 import도 grant를 주지 않는다.

publish는 같은 규칙을 폴더 `@lophn/cap-*` 의존에 적용해 낸 `permissions`가 그 요구를 덮게 한다. 그래서 소비 앱이 `@me` 판 하나의 permission만 선언하면 그 안의 cap 요구도 빠지지 않는다. `@me`가 다른 `@me`에 기대는 경우는 따라가지 않는다(열린 것).

실행 때 막는 것은 broker다(`app-call.md`). 다만 net·secret·notify·앱 호출만 broker route가 있고, cap-fs는 broker route가 없어 선언된 `fs.*`를 실행 때 판정하지 않는다.

## 판 올리기

- 내장 SDK의 판을 올리면 `migrate-sdk` 메모를 쓴다(`sdk-note` skill). `app.sdk_status`가 앱의 켜진 release가 봉인한 `@lophn` 판을 설치된 판, 지원 하한(`lophn.supported_from`)과 견줘 단계(`required`: 하한보다 옛 판, `available`: 하한 위지만 지금 판보다 옛 판, `current`)와 읽을 메모 file 이름을 낸다. `@me`는 보지 않는다.
- `@me` 판은 메모가 없다. 낸 앱이 그 판을 쓰는 앱(`packages.usage`, `package.read`의 `used_by`)의 lophn에게 `call send`로 알리고, 소비 앱이 두 곳의 pin을 같이 올린다.

## 경계와 계약

- boundary: `package-registry`(판 목록, 읽기 전용 설치 사본, 사용자 package 받기), `user-package`, `sdk`, 공개 계약 `package-spi`(package 한 판의 계약), `sdk-api`.
- route: `package.register_version`(machine), `package.publish`(agent, 오류 `forbidden`·`invalid_input`·`conflict`·`unavailable`), `packages.builtin`, `packages.list`, `packages.versions`, `packages.guide_body`, `packages.usage`, `app.sdk_status`.
- event: `PackageVersionRegistered`(name, version, permissions, bundle_hash, guide_hash).
- 저장: ledger 표 `packages`, `package_versions`. blob field `package_version/bundle`, `package_version/guide`(owner key는 `<name>@<version>`). 설치 사본 `<data>/sdk/<part>/<ver>/`, `<data>/sdk/@me/<part>/<ver>/`. 앱 폴더의 `.lophn/sdk/...`.
- log: `me_copy_skipped`.
- 앱 agent의 지침: 내장 skill `publish-package`(내기와 쓰기 절차, 실패별 대처). app prompt는 package로 옮기거나 남의 package를 쓸 때 이 skill을 읽게 하고, home prompt는 home의 lophn이 package로 빼기로 정하면 code가 있는 앱의 lophn에게 넘기게 한다(`products/AGENT.md` L11).

## 지키는 것

1. 공개한 `@me` 판의 name·version·bundle byte·guide는 바뀌지 않고 지워지지 않는다. trigger가 막고, 같은 판을 다른 hash나 permissions로 다시 내면 `conflict`다.
2. 공개 `@me` 판의 bundle byte는 ledger blob(permanent)에 있다. 설치 사본을 잃어도 core 기동이 blob에서 되살린다.
3. 설치 사본은 파일 0444, 폴더 0555이고 같은 name·version이라도 byte가 다르면 새로 쓴다. 앱은 사본을 고치지 않고 복사해서 쓴다.
4. 이미 켠 release는 봉인된 판으로 돈다. 설치된 판이 올라가도 그 release의 판은 바뀌지 않는다.
5. 앱의 두 pin(`package.json`, `sdk_dependencies`)은 같은 정확한 판이다. 다르면 release 준비가 거절한다.
6. `@me` package의 새 판은 `owner_app`만 낸다. publish는 그 앱 workspace의 agent session만 부르고 사람 승인 없이 끝난다.
7. publish는 clean한 commit tree만 읽는다. dirty tree, untracked file, symlink, 밖을 가리키는 경로, git metadata는 거절한다.
8. package가 요구하는 permission(`@lophn/cap-*`의 요구, `@me` 판이 적은 `permissions`)을 선언하지 않은 소비 앱은 release를 내지 못한다.
9. `package.register_version`은 machine 자격만 부른다.
10. 판 하나를 못 되살려도 core는 뜬다(경고 `me_copy_skipped`). 내장 SDK 사본을 하나라도 못 풀면 core는 뜨지 않는다.
11. 판은 정확한 `x.y.z`만이다. prerelease와 범위는 어느 층에서도 받지 않는다.

## 결정

- 내장 SDK는 catalog에 등록하지 않고 설치 사본이 정본이다. 이유: 같은 name·version의 byte가 개발 중 바뀌면 등록이 `conflict`라 기동이 막힌다. (agent)
- SDK 사본은 앱 폴더 안 `.lophn/sdk`에 실제 file로 두고 npm `file:` 의존으로 건다. 이유: Node는 `node_modules` 안의 `.ts`를 돌리지 않고, SDK의 npm 의존은 사본의 실제 경로에서 앱 `node_modules`로 올라가 풀려야 한다. 링크로 걸면 그 길이 막힌다. (agent)
- release 준비의 npm은 install script를 돌리지 않는다. 이유: bundle에는 설치된 file만 필요하다. (agent)
- 내장 SDK의 props는 생성 file이 아니라 `packages.builtin`이 읽을 때 설치 사본의 source에서 뽑는다. 버린 안: design에 안내 file을 생성해 두기. 생성물과 그 check가 하나 더 는다. (agent)
- 안내 본문 예산은 tool 결과 한 창보다 작은 20 KiB다. 이유: 색인과 예산 안의 props가 `package.read` 한 번에 오고, 넘는 부분은 앱 폴더의 사본에서 읽게 한다. (agent)
- 옛 SDK 사본은 data root에 따로 싣지 않는다. 지원 하한 아래 앱은 처음 다시 release할 때 옮긴다. (agent)
- `package.publish`의 HEAD는 core가 읽고 agent runtime에 git 실행 권한을 주지 않는다. 이유: agent runtime child는 git을 띄울 수 없어 늘 "commit이 없다"고 답해 어떤 앱도 package를 내지 못했다. (사람)
- package 주인은 domain이 아니라 앱이다(`owner_app`). (agent)
- 앱을 지우면 그 앱이 주인인 package의 `owner_app`을 비운다. 이유: 지운 앱 id는 다시 쓰이지 않아 주인을 남기면 누구도 새 판을 내지 못하고, 원본 source도 앱 폴더와 함께 지워져 고칠 길이 없었다. 판은 정확한 `x.y.z`로 고정되고 낸 판은 바뀌지 않으므로 새 주인이 낸 판이 쓰는 앱에 몰래 들어가지 않는다. 이 규칙 전에 지운 앱이 주인으로 남은 package는 ledger step이 같은 상태로 옮긴다. (사람이 추천을 받음, 2026-11-10)
- 공개 판의 byte는 ledger blob이 지키고 설치 사본은 그 파생이다. 이유: 설치 사본을 잃으면 공개 판을 되살릴 길이 없었고 이것은 사용자 data다. 버린 안: "같은 내용으로 다시 publish"로 복구(앱 HEAD가 바뀌면 hash가 달라 불가). (사람이 추천을 받음, 2026-11-08)
- `@me` permission은 publish와 release 준비에서 강제한다. 이유: 권한 누락이 실행 중 broker 거절로만 드러났다. 버린 안: 칸 지우기(schema step이 들어 일이 비슷한데 얻는 것이 없다), 정보로 두기. (사람이 추천을 받음, 2026-11-08)
- description은 최신 판을 따른다. 버린 안: 다르면 `conflict`(설명 하나로 publish가 막힌다). (사람이 추천을 받음, 2026-11-08)
- prerelease는 받지 않는다. 이유: ledger를 넓히는 대신 protocol을 좁혔다. 판 schema는 `1.0.0-beta`를 받는데 ledger CHECK가 막아 내부 오류가 났었다. (agent)
- bundle blob 이전에 낸 판의 옮기기는 schema step이 아니라 기동 단계에서 멱등으로 돈다. 이유: blob 참조는 SQL만으로 못 붙는다. (agent)

## 열린 것

- `@me` package가 다른 `@me`에 기대면 그 권한을 따라가지 않는다. `@me/a`가 `net.fetch`를 적은 `@me/b`에 기대면서 자기 `permissions`에서 빼고 낼 수 있고, `@me/a`만 쓰는 소비 앱은 release가 뜨고 실행 중 broker에서 거절된다. 추천은 publish 때 `@me` 의존의 정확한 판의 `permissions`도 입력이 덮는지 한 단계만 보는 것이다(이슈 `me-dependency-permission-not-followed`).
- 기동 옮기기가 옛 `@me` 판에 bundle blob을 못 붙일 수 있다. 사본의 `package.json`이 원래 JSON 2칸 들여쓰기가 아니면 hash가 `bundle_hash`와 달라 붙이지 못하고 기동마다 `me_copy_skipped`만 남는다. 그런 판은 설치 사본이 유일한 byte다(이슈 `old-me-version-blob-not-reattached`).
- cap-fs는 실행 때 broker가 막지 않는다. "실행 때 막는 것은 broker"와 cap-fs의 동작이 어긋나 정본을 정해야 한다. `app-call.md`는 cap-fs가 OS가 허락하는 파일을 어디든 읽고 쓴다고 적는다.
- `@me` 판의 안내는 형식(세 절이 비지 않음)만 검사한다. 안내가 맞는지는 낸 agent의 몫이다.
