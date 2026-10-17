# release-files

release bundle에 npm package가 두 번 들어가 file 수가 상한(10,000)에 걸리는 것을 없앤다. `releases/bundle/vendor.ts`의 `collect`가 symlink를 따라 복사하지 않고 실제 폴더(`node_modules/.deno/` 안)만 담고, symlink는 목록으로 bundle에 같이 굳힌다. bundle을 사본으로 푸는 `sealBundle`이 그 목록으로 `node_modules/<이름>` 연결을 다시 만든다. 상한은 올리지 않는다.

- 단위: release-files (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/bundle/vendor.ts`
  - `packages/core/apps/releases/bundle/links.ts`
  - `packages/core/apps/releases/bundle/seal.ts`
  - `packages/core/apps/releases/bundle/vendor_test.ts`
- 읽을 것:
  - 이슈: `project-docs/issues/platform.md`의 "template 앱의 release 준비가 file 수 상한(10,000)에 걸린다"(닫는 일은 lead가 한다)
  - architecture: `project-docs/architecture/ui-kit.md`("앱 UI가 build되는 길" 4: release 준비가 설치 사본을 bundle에 굳히고 실행 중인 앱은 그 bundle의 사본만 본다). `project-docs/architecture/activation.md`는 사본이 읽기 전용으로 봉인된다는 배경이다.
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`(`apps` 아래), `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 코드: `releases/prepare/from-source.ts`의 `fetchExternal`(받은 `.lophn/deps/{vendor,node_modules}`를 `readVendorFiles`로 읽는다), `releases/prepare/flow.ts`(`vendorCopies`가 `files`에 섞여 manifest·`sealBundle`로 간다), `releases/prepare/limits.ts`(`RELEASE_FILE_MAX_COUNT` 비교), `releases/bundle/runtime-entry.ts`(`lophn.json`의 `vendor: true, nodeModulesDir: "manual"`: 운영 process는 사본 안 `node_modules/`를 그대로 읽는다)
  - test 기준: `.claude/skills/write-test/SKILL.md`
- 계약:
  - 쓰는 것: `readVendorFiles(root)`의 반환 모양 `Result<{path, bytes}[]>`은 그대로다(부르는 곳 `from-source.ts`를 고치지 않는다). `sealBundle`의 입력(`bundleFiles` 등)도 그대로다.
  - 내놓는 것: 바뀐 `bundleFiles` 규약 하나. bundle 안 `node_modules/.lophn-links.json`(아래 "정한 것"). 다른 task가 기대는 것은 없다.

## 지켜야 할 것(계획 README 그대로)

- module은 `core/main`을 import하지 않는다. 바닥은 위층을 import하지 않는다. domain끼리는 problems → apps만.
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 설치 사본은 읽기 전용이고 release bundle에 굳힌 사본과 섞지 않는다.

이 task에서: 여기서 만지는 것은 release bundle에 굳는 쪽(`apps/<app>/bundles/<hash>/`)뿐이다. `<dataRoot>/sdk/`의 설치 사본(`sdk-install` 단위가 까는 것)은 읽지도 쓰지도 않는다. bundle 사본은 지금처럼 file 0444·폴더 0555로 봉인한다. `RELEASE_FILE_MAX_COUNT`는 바꾸지 않는다. protocol(`packages/protocol/apps/releases.ts`)을 바꾸지 않는다.

## 겹침

- 같은 계획의 `screen-maps`가 `releases/bundle/seal.ts`(`sourceMap` 입력)와 `prepare/flow.ts`를 고친다. `screen-maps` brief가 이 task를 선행으로 둔다. 이 task는 `seal.ts`에서 연결을 만드는 호출 몇 줄만 더하고 `flow.ts`는 고치지 않는다.
- `main/daemon/{main,core}.ts`, `wiring/*.ts`는 만지지 않는다.

## 현재 모양(코드로 확인)

- `fetchExternal`이 임시 폴더에서 `deno cache`(`nodeModulesDir: "auto"`)를 돌리면 `node_modules/<이름>`은 `node_modules/.deno/<이름>@<판>/node_modules/<이름>`을 가리키는 symlink이고, `.deno/<이름>@<판>/node_modules/` 안에도 그 package의 의존을 가리키는 symlink가 있다. `readVendorFiles` → `collect`는 `Deno.stat`(symlink를 따라간다)을 써서 가리키는 폴더를 symlink 자리에서 한 번 더 복사한다. 그래서 `lucide-react@1.51.0`(4306 file)이 두 번 담긴다.
- 담긴 file은 `flow.ts`의 `vendorCopies`로 들어가 `files`에서 manifest(path·hash)가 되고, `sealBundle`이 정규 file로만 사본에 쓴다. 사본을 만드는 곳은 `sealBundle` 하나(`flow.ts`의 호출)다. 읽는 쪽(`readBundleCopy` 등)은 사본을 읽기만 한다.

## 정한 것

- **symlink는 목록 file 하나로 bundle에 굳힌다**: `node_modules/.lophn-links.json`, 내용은 `[{"path": "node_modules/react", "target": ".deno/react@19.3.0/node_modules/react"}, …]`(`path`순 정렬, `target`은 `Deno.readLink`가 준 상대 값 그대로, JSON 한 줄이 아니라 `JSON.stringify(list)` 하나). 이유: bundle은 정규 file(path+bytes)만 담고 manifest·hash가 그 byte를 덮는다. 목록 file을 한 번 더 담으면 연결의 모양도 bundle hash에 들어가 같은 입력이 같은 hash가 된다. manifest schema(protocol)를 바꾸지 않는다. 푸는 쪽이 사본에서 `.deno/` 구조를 추측해 연결을 다시 만들지 않아도 된다(peer 의존 symlink는 구조로 추측할 수 없다). 이름과 모양은 worker가 더 단순하게 바꿔도 되지만 `vendor.ts`가 쓰고 `seal.ts`가 읽는 한 쌍이고 보고에 적는다.
- 연결 목록은 `node_modules/` 아래 모든 symlink에 적용한다(`node_modules/<이름>`, `node_modules/@scope/<이름>`, `.deno/…/node_modules/<의존>` 모두). `vendor/`(jsr) 아래에도 symlink가 있으면 같은 처리를 한다.
- `.lophn-links.json`의 상수 이름·parse·검증은 새 `bundle/links.ts` 한 곳에 둔다(`vendor.ts`가 만들고 `seal.ts`가 읽는다). 이유: 두 file이 같은 모양을 각자 적지 않게 하고 `seal.ts` 변경을 호출 두세 줄로 줄인다(계획 `screen-maps`가 `seal.ts`의 source map 봉인을 고칠 수 있다. "겹침" 참고).

## 할 일

1. `bundle/links.ts`를 새로 만든다. 근거: 위 "정한 것".
   - `LINKS_PATH = "node_modules/.lophn-links.json"`, `type VendorLink = {path, target}`, `encodeLinks(links): Uint8Array`, `decodeLinks(bytes): Result<VendorLink[]>`.
   - `decodeLinks`는 아래를 거절한다(`invalid_input`): 목록이 아님, `path`가 `node_modules/`나 `vendor/` 아래가 아님, `path`나 `target`에 `..`로 사본 밖으로 나가는 구간이 있음(`path`의 상위 폴더에서 `target`을 풀어 결과가 사본 root 밖), 절대 경로, `\` 등. 근거: 내려받은 npm package가 만든 연결이 폴더 밖을 가리켜 앱 process의 읽기 허락(사본 root)을 우회하는 것을 막는다(AGENTS.md "인터넷에서 온 것"). 상한 검사 등 일반화는 두지 않는다.
2. `bundle/vendor.ts`의 `collect`를 고친다. 근거: 이슈 "고치려면" 추천, 계획 README "정한 것" 2.
   - `entry.isSymlink`이면 `Deno.readLink`로 target을 읽어 `links`에 `{path: <bundle 안 경로>, target}`을 더하고 따라가지 않는다. 디렉터리와 정규 file은 `readDir`가 준 `entry.isDirectory`·`entry.isFile`로 가른다(`Deno.stat`을 쓰지 않는다. `stat`이 symlink를 따라가던 것이 원인이다). `.deno/` 폴더는 건너뛰지 않고 그대로 들어간다(실제 폴더가 거기에 한 벌 있다). `SKIP`은 그대로 둔다.
   - `MAX_DEPTH`와 `depth` 인자는 symlink를 따라가지 않으면 고리가 없으므로 지운다(죽은 코드).
   - `readVendorFiles`는 마지막에 `links`가 있으면 `LINKS_PATH` file(`encodeLinks`)을 한 개 더해 반환한다. 반환 type·정렬은 그대로.
   - 파일 머리 주석("node_modules의 symlink는 가리키는 폴더를 그 자리에 복사해서 푼다")을 새 동작("symlink는 복사하지 않고 목록으로 남긴다")으로 고친다.
3. `bundle/seal.ts`의 `sealBundle`을 고친다. 근거: 이슈 "bundle을 푸는 쪽이 `node_modules/<이름>` 연결을 다시 만든다", 사본을 만드는 곳이 여기 하나다.
   - `bundleFiles`에 `LINKS_PATH`가 있으면 `decodeLinks`로 읽고(오류면 `invalid_input`으로 봉인을 거절), 다른 file을 모두 쓴 뒤 각 연결을 `Deno.symlink(target, "<copyPath>/<path>")`로 만든다. `.lophn-links.json` 자체도 다른 file처럼 사본에 쓴다(manifest에 들어 있으므로 사본에 없으면 hash 확인이 어긋난다).
   - 연결의 부모 폴더가 아직 없으면 `mkdir -p`하고 `directories`에 넣어 마지막에 0555로 좁힌다. 연결을 다 만든 뒤에 폴더를 좁힌다(0555 폴더에는 만들 수 없다). `chmod`는 symlink를 따라가므로 연결을 `files` 목록에 넣지 않는다(정규 file만 0444).
   - 같은 path가 정규 file로도 있으면 연결을 만들지 않고 `invalid_input`이다(`written`의 `seen` 규칙과 같은 취급).
   - 바뀌는 줄은 호출 몇 줄이어야 한다. 새 로직은 `links.ts`에 둔다.
4. 위험 test를 `bundle/vendor_test.ts`에 쓴다(아래 "끝남"). 근거: `write-test` "사용자 data를 잃거나 망가뜨리는 규칙", "폴더 밖 쓰기". 임시 폴더에 가짜 `node_modules`를 직접 만들어 `readVendorFiles` → `sealBundle`을 돌린다. `deno cache`·network·subprocess를 쓰지 않는다.
5. 옛 모양 사본: 이미 봉인된 옛 bundle 사본(중복 복사본)을 읽는 길이나 변환은 만들지 않는다(AGENTS.md "호환성"). 개발 data는 지우고 새로 만든다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`vendor_test.ts`, 둘):
  - "bundle에 같은 file이 두 번 들어가지 않는다": 임시 폴더에 `node_modules/.deno/a@1.0.0/node_modules/a/index.js`, 거기를 가리키는 symlink `node_modules/a`와 `node_modules/@s/b`(→ `.deno/b@2.0.0/node_modules/b`), `.deno/a@1.0.0/node_modules/b`(→ `../../b@2.0.0/node_modules/b`, peer 연결)를 만들어 `readVendorFiles`가 `index.js` 류를 한 번씩만 담고 `node_modules/a/…`·`node_modules/@s/b/…` 경로의 중복 byte가 없는 것을 본다. 이어서 그 file 목록으로 `sealBundle`한 사본에서 `node_modules/a/index.js`를 연결을 거쳐 읽을 수 있고, 연결이 아닌 모든 file이 0444, 폴더가 0555인 것을 본다.
  - "폴더 밖을 가리키는 연결은 사본에 만들어지지 않는다": `target`이 `../../../outside`(사본 밖)인 `.lophn-links.json`을 `bundleFiles`에 넣으면 `sealBundle`이 `err`을 돌려주고 사본 밖에 아무것도 만들어지지 않는다.
- 남지 않음:
  - `grep -n "Deno.stat\|MAX_DEPTH" packages/core/apps/releases/bundle/vendor.ts` 0줄(root 폴더가 있는지 보는 `Deno.stat`이 필요하면 `readVendorFiles`의 그 한 곳만 남기고 `collect` 안에는 없다).
  - `grep -rn "RELEASE_FILE_MAX_COUNT" packages/protocol` 값이 `10_000` 그대로다.
- 새 E2E·subprocess·서버 test를 쓰지 않는다. template 앱의 release 준비를 core를 띄워 손으로 확인하는 일은 이 계획이 하지 않는다. 확인은 위 test와 `deno task check`까지다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 목록 file의 이름·모양을 바꿨다면 그 내용
- 넘길 줄: `flow.ts`·`from-source.ts`를 건드려야 했다면 그 줄(소유가 아니다. 최소로만)
- 계약 바꾸기 요청: manifest·`RELEASE_FILE_MAX_COUNT`·`relativePathSchema`(protocol) 변경이 필요해 보이면 고치지 말고 여기 적는다
- **무겁게 짠 것**
- **알려진 미완 동작**: 실제 `deno cache`가 만든 `node_modules`로 file 수가 상한 아래인지는 이 task의 test가 보지 않는다(가짜 구조로 중복이 없는 것만 본다). 실제 template 앱의 release 준비 확인은 이 계획 밖이다.
