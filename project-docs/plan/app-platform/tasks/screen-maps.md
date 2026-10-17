# screen-maps

화면 build가 화면마다 source map을 따로 봉인하고, problems가 stack이 가리킨 화면 bundle에 맞는 map을 읽어 앱 source 위치로 푼다. 지금은 화면이 둘 이상이면 합친 `app.js.map`에 `mappings`가 없어 늘 bundle 위치로만 남는다.

- 단위: screen-maps (wave 1)
- 선행: release-files. `flow.ts`·`seal.ts`·`read.ts`를 같이 고칠 수 있어 순서를 둔다. release-files가 이 file들을 건드리지 않는다고 lead가 확인하면 없음으로 바꿔도 된다.
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/ui-build/build.ts`
  - `packages/core/apps/releases/prepare/flow.ts`
  - `packages/core/apps/releases/bundle/seal.ts`
  - `packages/core/apps/releases/bundle/read.ts`
  - `packages/core/apps/releases/mod.ts`
  - `packages/core/problems/snapshots/work.ts`
  - `packages/core/problems/snapshots/source-map.ts`
  - `packages/core/problems/snapshots/work_test.ts`
- 겹침(같은 계획 다른 단위): `sdk-install`·`release-files`가 `apps/releases/{prepare,bundle}`를 고친다. 이 task가 거기서 고치는 곳은 `flow.ts`의 source map 다루는 줄(아래 할 일 2)과 file 수를 세는 `+ 2`, `seal.ts`의 `sourceMap` 입력과 `SOURCE_MAP_COPY_NAME`, `read.ts`의 `GENERATED_FILES` 한 줄, `mod.ts`의 export 한 줄뿐이다. 나머지는 건드리지 않는다. `vendor.ts`, `lock.ts`, `apps/packages/`는 소유하지 않는다. 다른 계획(`agent-place`, `agent-io`)의 자리는 건드리지 않는다.
- 읽을 것:
  - 이슈: `project-docs/issues/platform.md`의 "화면이 둘 이상인 앱의 합친 `app.js.map`에 `mappings`가 없다"
  - architecture: `project-docs/architecture/annotation.md`("source 위치는 잇지 않는다" 절. `app.js.map`을 problems만 읽는다)
  - 계획 `project-docs/plan/app-platform/README.md`의 "정한 것" 3
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `apps`·`problems`와 자식, `project-docs/module-catalog.yaml`
- 계약:
  - 쓰는 것: bundle 안 화면 파일 이름 `screens/<key>/main.js`(`prepare/from-source.ts`가 만든다. 이 task는 고치지 않는다). esbuild external source map.
  - 내놓는 것: bundle 사본에 화면마다 `screens/<key>/main.js.map`(= `<화면 JS path>.map`)이 들어간다. `app.js.map`은 사라진다. `buildScreens` 결과는 `{ files }`뿐이고 `files`에 화면 JS와 그 map이 같이 있다(`sourceMap` 칸을 지운다). 쓰는 곳은 `prepare/flow.ts` 하나다.

## 할 일

1. `ui-build/build.ts`: `buildScreens`가 화면마다 esbuild가 만든 map을 `<screen.path>.map`으로 `files`에 더한다. 지금의 `sources` 정규화(`source.endsWith(screen.path) ? screen.path : source`)와 `sourcesContent` 완전성 검사(길이 같고 null 없음, 아니면 `build_failed`)는 map마다 한다. 합치는 `merged`, `maps.length === 1` 분기, `UiBuildOutput.sourceMap`과 `SourceMap.mappings`의 optional을 지운다. 근거: 이슈 추천 첫째, README 정한 것 3.
2. `prepare/flow.ts`: `built.value.sourceMap`을 쓰는 곳을 지운다. (a) `files.some(... sourceMap.path)` 뒤 `files.push(sourceMap)` 블록, (b) `sealBundle`의 `sourceMap:` 인자. 화면 map은 `built.value.files`로 이미 `files`에 들어 있어 manifest와 byte 합과 봉인이 그대로 지난다. file 수를 미리 세는 `input.screens.length + ... + 2`는 지금 `app.js.map` 한 개를 센 것이다. 화면 map이 화면 수만큼이므로 화면 수 한 번을 더 세게 고치고 `+ 2`에서 map 몫을 뺀다. 위의 "화면·blueprint·source map이 더해지기 전" 주석도 맞춘다.
3. `bundle/seal.ts`: `sealBundle`의 `sourceMap?` 입력과 그 `push`, `SOURCE_MAP_COPY_NAME` 상수를 지운다(flow가 더는 안 넘기므로 죽은 코드). `bundle/read.ts`의 `GENERATED_FILES`에서 `SOURCE_MAP_COPY_NAME`을 빼고 import도 지운다(`screens/`가 이미 `GENERATED_FOLDERS`에 있어 화면 map은 source diff에서 제외된다). `releases/mod.ts`의 `SOURCE_MAP_COPY_NAME` export를 지운다.
4. `problems/snapshots/source-map.ts`: `readSourceMap(copyRoot)`가 고정 `app.js.map` 대신 화면 key를 받아 `screens/<key>/main.js.map`을 `readIfInside`로 읽게 한다. key는 `^[a-z0-9][a-z0-9-]*$`만 받는다(`apps/releases/ui-build/app-build.ts`의 `SCREEN_KEY`와 같은 규칙. problems는 apps를 import하지 않으니 규칙만 반복한다). 상수 `SOURCE_MAP_COPY`를 지운다.
5. `problems/snapshots/work.ts`의 `resolveStackFrames`: 지금은 stack의 첫 `at` 줄만 보고 합친 map 하나를 읽는다. 이렇게 바꾼다.
   - `stackSites(stack)`에서 file(URL이든 path든)이 `/screens/<key>/main.js`로 끝나는 첫 site를 찾는다. 있으면 그 key의 map을 읽어 그 site의 줄·열로 지금과 같은 규칙(같은 줄에서 대상 열 이하 가장 큰 표지, stack 열 1-based·map 열 0-based, `relativeToFolder`로 준비 폴더 안 path만)으로 푼다.
   - 이 화면 map 시도를 `framesInsideBundle`보다 먼저 한다. 지금은 stack file이 bundle 사본 안이면 `framesInsideBundle`이 먼저 돌아 화면 JS의 생성 위치(`screens/<key>/main.js:1:2345`)를 그대로 frame으로 돌려주므로 map까지 오지 않는다. 화면 site가 없거나 map을 읽거나 푸는 데 실패하면 지금처럼 `framesInsideBundle`로 간다.
   - "위치 원문을 모르는 stack"(`positional === null`)에서 map 전체를 푸는 가지는 지운다. 화면 key를 알 수 없으면 어느 map인지 정할 수 없다.
   - map 크기 판정은 mappings 문자열 하나에만 한다(`walkAllMappings`가 이미 `LIMITS.stack_bytes`로 건다). 지금 map file 전체 byte에 거는 `stack_bytes` 검사는 `sourcesContent`를 세어 늘 넘으므로 지운다. `stack_bytes` 값은 바꾸지 않는다.
   근거: 이슈 "고치려면" 첫째, `project-docs/architecture/annotation.md`.
6. 위험 test 하나를 `problems/snapshots/work_test.ts`에 쓴다(아래 "끝남"). esbuild를 띄우지 않는다. map은 손으로 만든 최소 JSON(`version: 3`, `sources`, `sourcesContent`, `mappings`)을 임시 폴더의 bundle 사본(`apps/<app id>/bundles/<64 hex>/manifest.json` + 화면 map 둘)에 쓴다. blob prepare는 가짜 구현을 넘긴다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "화면이 둘인 앱에서 stack이 가리킨 화면의 map으로 그 화면의 source 위치가 풀리고 다른 화면 source로 풀리지 않는다". 같은 test에서 stack file이 bundle 사본 안 `screens/<key>/main.js`인 경우(위 `framesInsideBundle`이 먼저 가로채던 경우)로 만든다. 이 test는 `build.ts`를 거치지 않는다. `buildScreens`는 esbuild 자식 process를 띄우므로 새 test를 만들지 않는다.
- 남지 않음:
  - `grep -rn "app\.js\.map\|SOURCE_MAP_COPY" packages tools`가 0줄이다(코드 주석 포함).
  - `grep -rn "sourceMap" packages/core/apps packages/core/problems --include=*.ts`에 `buildScreens` 결과의 `sourceMap`이나 `sealBundle`의 `sourceMap`이 없다.
- 새 E2E·subprocess·서버 test는 쓰지 않는다. core를 띄워 손으로 확인하는 일도 하지 않는다. 확인은 unit test와 `deno task check`까지다.

## 지켜야 할 것(계획 README에서 그대로)

- module은 `core/main`을 import하지 않는다. 바닥은 위층을 import하지 않는다. domain끼리는 problems → apps만. (problems가 apps를 import하지 않고 규칙만 반복하는 것이 지금 방식이다. 이 task는 import를 새로 더하지 않는다.)
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다. (`app.js.map`을 옛 이름으로 읽는 길을 두지 않는다.)
- 설치 사본은 읽기 전용이고 release bundle에 굳힌 사본과 섞지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 예상
- 안 쓰게 된 export: `SOURCE_MAP_COPY_NAME`(이 task가 지운다)
- 정한 것: 위 할 일 5의 세 가지(map 시도를 `framesInsideBundle` 앞에 둠, 위치 모르는 stack 가지 삭제, map file 전체 byte 검사 삭제)
- 넘길 줄: release-files·sdk-install 범위의 file에서 고친 줄
- 계약 바꾸기 요청: 없음 예상
- **무겁게 짠 것**: 없으면 "없음"
- **알려진 미완 동작**: mappings 문자열 한도(`stack_bytes`, 16 KiB)가 minify한 큰 화면에는 작을 수 있다. 이 한도를 넘으면 화면 map이 있어도 bundle 위치로만 남는다. 한도를 바꾸는 일은 이 task 범위 밖이다. 이 task는 안다고만 적는다.

## (lead가 더함)

- release-files가 merge되었다. `bundle/seal.ts`에 `links.ts`의 연결 만들기가 들어갔으니 그 줄은 건드리지 않는다. 같은 file 끝에 코드 없이 남은 고아 주석("사본이 정말 0444·0555인지 재귀로 본다.")이 있으면 지운다.
