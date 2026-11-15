# mobile-build-phone

release 준비가 앱의 폰 화면(`src/screens/<key>/phone.tsx`)을 두 가지로 만든다: 폰 runtime이 돌릴 작은 plain JS bundle(`phone.js`와 manifest `phone.json`)과, desktop preview가 react-native-web으로 그릴 web 진입(`index.html`, `preview.js`). 둘 다 신뢰된 core 쪽 build가 하고 앱의 build script는 돌리지 않는다. 폰 화면이 선언과 어긋나면 준비가 실패한다. 이 task는 어려운 쪽(설치 비용과 신뢰 경계를 지키며 두 번 build하는 길)이라 opus high로 돌린다.

- 단위: phone-screen (wave 3)
- 선행: mobile-phone-contract, mobile-place-decl
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/ui-build`(`app-build.ts`와 새 하위 폴더 `phone/`(진입 생성, esbuild plugin, web 대체 module), 그 test)
  - `packages/core/apps/releases/prepare/from-source.ts`
  - `packages/core/apps/releases/prepare/flow.ts`
  - `packages/core/apps/releases/prepare/source-checks.ts`
  - `packages/core/apps/releases/prepare/from-source_test.ts`
  - `packages/core/apps/releases/prepare/flow_test.ts`
  - `packages/core/apps/releases/bundle/modules.ts`(아래 설치 비용의 결과가 요구할 때만)
  - `tests/support/app/phone`(새 폴더: test가 쓰는 작은 앱 fixture와 kit·hook의 최소 stand-in. 진짜 kit은 아직 SDK part가 아니다)
- 공유 줄 허락(한 줄씩만 더하고 보고의 "넘길 줄"에 적는다): root `package.json`(core의 build가 쓰는 새 의존을 lead가 정확한 판으로 등록한다. 이 task는 보고에 이름과 판만 적고 root `package.json`·`package-lock.json`은 고치지 않는다)
- 읽을 것:
  - 판정과 실험 code: `/home/pyosechang/projects/lophn/reports/mobile-program/app-screens-spike.md`의 "5. Bundle format", "6. Desktop preview (react-native-web)", "Recommended architecture" 3·7. 실험 code(읽기만): `/home/pyosechang/projects/lophn-worktrees/spike-app-screens/mobile/guest/{esb.sh,web-entry.tsx,stubs/}`
  - 지금 build: `packages/core/apps/releases/ui-build/{app-build.ts,build.ts}`(진입 `src/screens/<key>/main.tsx`, 둘째 pass가 `main.js`마다 source map을 만든다), `prepare/from-source.ts`(`npm install|ci --ignore-scripts` 뒤 `eval-declaration`, `app-build`, `readBuiltScreens`: `main.js`는 화면이고 나머지는 assets이다), `prepare/flow.ts`(`buildScreens`는 화면이 0개면 `fixed_dependency_missing`으로 실패한다. 폰 화면만 가진 앱이 이 길에서 죽지 않게 한다), `releases/bundle/modules.ts`(`node_modules`를 통째로 bundle에 담는다), 제한 `protocol/apps/releases.ts:17-20`(source 64 MiB, bundle 256 MiB, 준비 300 s), npm 단계 상한 120 s
  - 계약: `packages/protocol/apps/phone-screen.ts`(`mobile-phone-contract`: `PHONE_HOST_MODULES`, `phoneManifestSchema`, `PHONE_BASE_FORMAT`, 전역 이름). 이 계획 `README.md`의 "정한 것"(spike 판정)
  - SDK part가 앱에 깔리는 길: `packages/core/apps/packages/{install.ts,vendor.ts,sdk-sync.ts}`, 앱 template `packages/core/apps/packages/template/app/`(기본 template은 폰 의존이 없다. 바꾸지 않는다)
  - architecture: `project-docs/architecture/ui-kit.md`("앱 화면 build"), `app-call.md`
- 계약:
  - 쓰는 것: `phone-screen.ts`의 상수와 `phoneManifestSchema`. 폰 화면의 선언은 `places: ["phone"]`(`@lophn/declaration` 4.6.0), `path`는 `/screens/<key>/index.html`(생성된 preview 진입)
  - 내놓는 것: 아래 source 규약과 bundle 배치. `mobile-phone-reads`(manifest 읽기), `mobile-preview-phone`(preview 진입), `mobile-phone-guest`와 `mobile-phone-apps`(`phone.js`)가 이 배치에 기댄다

### source 규약과 bundle 배치

- 폰 화면 하나는 `src/screens/<key>/phone.tsx`이고 default export가 React component다. 그 dir에는 `main.tsx`가 없다(있으면 준비가 실패한다: 한 key에 두 program을 두지 않는다). 선언의 화면 `places`가 `["phone"]`이면 그 key의 dir에 `phone.tsx`가 있어야 하고, `phone.tsx`가 있는 dir은 선언에 `phone` 화면으로 있어야 한다(둘 다 어긋나면 준비 실패, 이유는 agent가 읽고 고칠 수 있는 영어 한 줄).
- bundle의 `screens/<key>/`에 낸다: `phone.js`(폰이 돌린다), `phone.js.map`, `phone.json`(manifest), `index.html`과 `preview.js`(+`preview.js.map`, 필요하면 css)(desktop preview). 이 파일들은 `readBuiltScreens` 기준 assets다(`main.js`가 없다). 둘째 pass(`buildScreens`)와 `main.js` 전제의 코드가 이 파일들을 건드리지 않고, 폰 화면만 가진 앱도 준비가 끝난다.
- `phone.js`: esbuild `format: "iife"`, `target: "es2015"`(Hermes에 async/class field를 맡기지 않는다. spike가 그렇게 돌렸다), `jsx: "automatic"`, minify, external source map, `define process.env.NODE_ENV="production"`. 진입은 생성한 stdin이다: `import Screen from "<staging의 phone.tsx>"; globalThis.__lophnMount(Screen);`, 결과 전체를 `try{…}catch(e){globalThis.__lophnFatal && globalThis.__lophnFatal(e)}`로 감싼다(banner·footer). `external`은 `PHONE_HOST_MODULES`(폰의 base bundle이 `globalThis.require`로 내준다). 이 밖의 bare import는 앱 자기 npm 의존(순수 JS)이면 번들에 들고, 아래는 실패시킨다(esbuild `onResolve` plugin):
  - `react-dom`, `@lophn/ui`(과 sub-path), `@lophn/app-ui`: "…은 desktop용이다. 폰 화면은 `@lophn/ui-native`·`@lophn/app-ui-native`를 쓴다"
  - 목록 밖의 `react-native*`, `@react-native/*`, `expo*`: "폰 화면이 쓸 수 없는 module: …"
  - node 내장(`node:*`, `fs` 등)과 staging 밖으로 풀리는 file: 기존 import guard(`staging-only`: realpath가 staging 밖이면 실패)를 그대로 건다
- `phone.json`: `phoneManifestSchema`대로. `kit`은 staging의 `.lophn/sdk/ui-native/<판>`·`app-ui-native/<판>` 설치 사본의 `package.json` 판에서 읽는다(앱이 pin한 판). `modules`는 esbuild metafile이 보인 external import 전부다. `sha256`·`size`는 `phone.js`의 것. `phone.js`가 2 MiB를 넘으면 실패한다("screen bundle is too large").
- preview 진입(`index.html`, `preview.js`): 생성한 진입이 `phone.tsx`를 `UiProvider`(kit)와 error boundary 아래 `react-dom`으로 그린다. esbuild 설정: `react-native`→`react-native-web`(spike의 shim: `TurboModuleRegistry`를 더해 re-export), `.web.*` 확장자 우선, `--define:global=globalThis`, `@react-native/assets-registry/registry`→빈 stub, `expo-clipboard`→`navigator.clipboard` web stub, `react-native-keyboard-controller`→web stub(preview에서만 stub이다. spike에서 real web build도 풀렸지만 입력 focus 쪽을 믿지 못하고 desktop preview는 키보드가 없다), `react-native-svg`·`react-native-reanimated`·`react-native-safe-area-context`·`lucide-react-native`는 web build로 푼다. 이 대체 module과 stub은 `ui-build/phone/`에 core의 file로 둔다(앱 source가 아니다). `index.html`은 `<div id="root">`와 `preview.js` 하나뿐이고 CSP를 덧붙이지 않는다(앱 view의 CSP는 shell이 건다). 폰 화면은 `lophnApp`을 desktop 앱 view와 같은 preload가 준다(`place`는 `phone`으로 열린다. `mobile-preview-phone`).

### 정해야 하는 것: 설치 비용(이 task가 측정하고 정한다)

폰 화면을 가진 앱은 kit의 peer(`react-native`, `react-native-svg`, `react-native-safe-area-context`, `react-native-keyboard-controller`, `expo-clipboard`, `lucide-react-native`, `@lezer/markdown`, `react-native-reanimated`, `react-native-web` 등)를 type 검사(`tsc`)와 preview build를 위해 필요로 한다. 그런데 준비는 `npm install --ignore-scripts`를 120 s 안에 끝내야 하고 `node_modules`를 통째로 bundle(256 MiB 상한)에 담는다. 아래를 **실제로 재서** 하나를 고르고 보고에 숫자(설치 시간, `node_modules` 크기, bundle 크기)와 이유를 적는다.
- 안 A(추천 시작점): 폰 의존은 앱 `devDependencies`다. 준비가 build를 끝낸 뒤 폰 화면이 있는 앱에 한해 `npm prune --omit=dev --ignore-scripts`로 sealed `node_modules`에서 devDependencies를 빼고 읽는다(backend가 실제로 쓰는 `dependencies`만 남는다). 폰 화면이 없는 앱의 준비는 그대로다.
- 안 B: preview build가 쓰는 web 쪽 package(`react-native-web` 등)는 core가 자기 의존으로 갖고 esbuild가 그 위치에서 푼다(import guard에 그 위치만 예외로 연다). 앱은 type용 `@types`·SDK part의 type 선언만 설치한다. 설치가 작지만 core의 의존과 packaging(`tools/package`)이 늘고 `tsc`가 쓸 react-native type의 출처가 따로 필요하다.
- 안 C: 위 둘을 섞는다.
기준: 폰 화면 앱의 준비가 `npm` 120 s와 bundle 256 MiB 안에 안정적으로 들어야 하고(측정은 이 machine의 cache 없는 install로 한다), 앱 agent가 `npm run check`(tsc)로 폰 화면을 type 검사할 수 있어야 하며, 신뢰 경계(AI가 쓴 code는 번들될 뿐 실행되지 않는다, staging 밖 file 금지)가 그대로여야 한다. 안 A 밖을 고르면 이유를 적는다. 결과는 `mobile-sdk-kit`(kit의 package.json이 peer를 어떻게 선언하나)와 `mobile-agent-guidance`(앱 template에 무엇을 더하라고 말하나)가 읽는다.

## 할 일

1. 위 설치 비용을 먼저 잰다(작은 fixture 앱과 실제 peer 판으로. 사람의 `~/.lophn`과 network 아닌 곳을 건드리지 않는다. npm registry 읽기는 된다) — 결과가 나머지의 설계를 정한다.
2. `ui-build/app-build.ts`: `src/screens/<key>/`에 `phone.tsx`가 있으면 폰 갈래(`ui-build/phone/`의 함수)로 가고 `main.tsx`가 있으면 지금처럼 간다. 둘 다 없거나 둘 다 있으면 실패한다. 위 두 build(plain `phone.js`와 preview)와 manifest를 `dist/screens/<key>/`에 쓴다. `esbuild`가 못 풀거나 plugin이 거절한 import는 어느 file의 어느 import인지 한 줄로 나온다(`ui_build_failed`의 stderr 앞부분이 agent에게 간다).
3. `prepare/from-source.ts`와 `flow.ts`: 선언(이미 eval한 JSON)의 `phone` 화면 key 목록과 build 결과(`dist/screens/<key>/phone.json`)를 양쪽으로 맞춰 본다. 폰 화면이 있는 앱의 설치 뒤 정리(1에서 고른 안). `buildScreens`는 `main.js` 화면이 있을 때만 돈다. 파일 수·byte 상한 계산(`counter.addBundle`)이 새 file을 센다.
4. `source-checks.ts`: DOM 전용 검사(`title=` 소문자 JSX, tab-head icon)는 `phone.tsx`에 걸리지 않는다는 것을 확인하고, 걸리면 막는다.
5. test(아래 위험 test와, 폰 화면 하나의 정상 경로 한 개): `tests/support/app/phone`의 fixture 앱으로 `from-source` 준비를 돌린다. kit과 hook은 이 task에서 진짜가 아니다(kit은 mobile-app 계획이 land된 뒤 SDK part가 된다): fixture의 `.lophn/sdk` 사본에 `react-native`의 `View`·`Text`만 쓰는 최소 `@lophn/ui-native`·`@lophn/app-ui-native` stand-in을 두고 build 길만 확인한다. 진짜 kit으로 `preview.js`가 그려지는지는 `mobile-preview-phone`이 확인한다고 보고에 적는다.
6. flows catalog: 바뀐 준비 갈래(폰 화면 build와 새 실패 갈래)는 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다. architecture 문서(`ui-kit.md`의 화면 build 절)는 lead가 계획 끝에 고친다. 대신 `ui-build/phone/` 맨 위 주석에 규약과 이유를 적는다.

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`가 통과한다.
- 위험 test:
  - "폰 화면 build는 host module 목록 밖의 module을 화면에 담지 않는다: `react-dom`·`@lophn/ui`·`@lophn/app-ui`(desktop용), 목록 밖의 `react-native*`·`expo*`, node 내장, staging 밖으로 풀리는 file은 준비를 실패시키고, 결과 `phone.js`가 `require`하는 이름은 `PHONE_HOST_MODULES`의 부분집합이다"(AI가 쓴 code가 폰의 native module에 닿는 길을 build가 막는 경계)
  - "선언의 폰 화면과 `phone.tsx`는 양쪽으로 맞아야 한다: 선언했는데 `phone.tsx`가 없는 화면, `phone.tsx`가 있는데 선언에 없는 화면, 한 key에 `main.tsx`와 `phone.tsx`가 같이 있는 화면은 준비를 실패시킨다"
- 남지 않음: 없음(폰 갈래를 더하기만 하고 desktop 화면 build를 바꾸지 않는다. `grep -rn "main.tsx" packages/core/apps/releases`의 지금 결과가 폰 갈래 때문에 틀리게 읽히는 곳이 없는지 본다).
- `project-docs/flows/`가 check를 통과한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 설치 비용 측정표와 고른 안과 이유, 새 의존의 이름·판(root `package.json`에 lead가 등록할 것)과 packaging(`tools/package`)에 미치는 영향, fixture 앱의 준비 결과 file 목록과 크기(`phone.js`, `preview.js`), 아직 진짜 kit으로 확인하지 못한 것.
