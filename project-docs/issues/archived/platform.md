# platform (닫음)

## daemon과 agent runtime의 crash가 diagnostic log에 안 남는다

```yaml
kind: bug
modules: [packages/core/main, packages/core/diagnostics]
closed: fixed
guard: 없음
```

지금: diagnostic log 쓰기는 I/O worker(`main/worker/io.ts`의 `createSafeLog`, `createDiagnosticIngress`)가 받는다. 그런데 daemon(`main/daemon/main.ts`)에는 `unhandledrejection`/`error` listener가 없고, agent runtime(`main/agent-runtime/main.ts`)은 기동 실패와 `child.run()` 거절만 자기 stderr writer(`createDiagnosticWriter`)로 쓴다. 이 쪽 어디도 ingress로 `platform.diagnostics.write`를 보내지 않는다. 앱 supervisor(`main/app-supervisor/main.ts`)는 stderr에 한 줄 남기고, 앱 process(`apps/runtime/entrypoint/crash.ts`)는 자기 보고 경로가 있다. 옛 text의 `createDiagnosticHost`는 지금 코드에 없다.

영향: daemon이나 agent runtime이 처리 못한 reject로 죽으면 원인이 터미널 stderr에만 남고 `diagnostics.list`에는 없다. 나중에 사람이 볼 수 없다.

고치려면: daemon `main.ts`와 agent runtime `main.ts`에 `unhandledrejection`/`error` listener를 달고, 로그에 쓴 뒤 종료한다. 쓰기 길은 I/O worker의 ingress를 재사용한다(작음~중간. 권한(`DiagnosticAuthority`)과 종료 직전 flush 순서를 정해야 함). 추천.

정한 것: log에 쓰다가 또 실패하면 stderr로만 둔다.

닫음: I/O worker의 `currentAuthority`를 core 고정 authority(`lophn_internal`만 허락)로 바꿔 diagnostics 쓰기를 받게 했다. `diagnostics/crash.ts`의 `installCrashHandler`가 daemon과 agent runtime에서 처리 못한 예외를 받아 원문은 가려 stderr에, 분류 한 줄(`lophn_internal`, `internal_exception`)은 diagnostic log에 쓰고 종료한다. 쓰기가 실패하거나 2초를 넘기면 stderr만 남는다. 일부러 낸 rejection으로 `logs/platform-0.jsonl`에 줄이 남는 것을 손으로 확인했다.

## Diagnostics 점검이 core·ledger 둘뿐이다

```yaml
kind: bug
modules: [packages/core/diagnostics, packages/core/main]
closed: fixed
guard: 없음
```

지금: `diagnostics/components.ts` `createComponentChecks`가 core와 ledger만 짓는다. `ctx.componentChecks`(`wiring/context.ts`)에 더하는 곳은 `wiring/diagnostics.ts` 하나뿐이고, events·앱·sandbox·agent runtime의 wiring은 아무것도 더하지 않는다(`componentChecks.push`를 쓰는 다른 파일이 없다).

영향: `diagnostics.status`가 나머지 component를 점검하지 않아 events, 앱 supervisor, agent runtime이 죽어도 status는 정상으로 보일 수 있다.

고치려면: 각 owner wiring(`events.ts`, `apps.ts`, `supervision.ts`, `lophn-agent-runtime.ts`)이 `ctx.componentChecks.push`로 자기 점검을 더한다. component마다 작음. 점검이 무엇을 보는지(살아 있음, 마지막 응답 시각) 정하는 쪽이 일이다. 추천.

정한 것: events와 agent runtime 점검만 더한다.

닫음: `wiring/events.ts`가 `events` 점검(읽기 연결이 열려 있고 Reactor가 start된 뒤 `events` 표를 한 번 읽는다), `wiring/lophn-agent-runtime.ts`가 `agent-runtime` 점검(I/O observation의 `available`)을 `componentChecks`에 더했다. 둘 다 고정 이유 문장만 낸다. `diagnostics/status`에 core, ledger, events, agent-runtime이 나오는 것을 손으로 확인했다.

## crash 기록의 기한 timer가 둘이고 redactor fallback이 있다

```yaml
kind: defect
modules: [packages/core/diagnostics, packages/core/main]
closed: kept
guard: 없음
```

지금: `main/daemon/wiring/diagnostics.ts`의 `diagnosticsWrite`가 응답을 2초 기다리는 timer를 두고(pending 표가 새지 않게), `diagnostics/crash.ts`의 `installCrashHandler`도 쓰기를 2초 기다리는 timer를 둔다. daemon의 crash handler는 `createProductRedactor(ctx.peek.knownSecrets)`를 쓰고, known secret이 아직 없으면 pattern만 쓰는 redactor로 한 번 더 감싼다. `diagnosticsWiring`은 `uninstallCrash` 닫힘 때문에 객체 literal에서 factory 본문으로 바뀌었다.

영향: 같은 일을 하는 기한이 두 곳에 있어 한쪽만 고치면 어긋난다. fallback은 기동 초반 crash에만 쓰인다.

고치려면:
- timer를 `installCrashHandler` 하나로 줄이고 `diagnosticsWrite`는 응답이 없으면 pending을 닫힐 때 비운다(작음).
- 그대로 둔다(둘 다 짧다).

닫음: 기한 둘의 목적이 다르다(하나는 pending 표가 새지 않게, 하나는 crash 뒤 종료가 늦지 않게). redactor fallback은 기동 초반 crash에만 쓰인다. 둘 다 짧다.

## API key로 provider를 연결해도 쓸 수 있는 provider가 생기지 않는다

```yaml
kind: bug
modules: [packages/core/secrets, packages/core/lophn-agent, packages/core/main, packages/protocol, packages/shell/main, packages/shell/renderer]
closed: fixed
guard: packages/core/lophn-agent/providers/secret-refs_test.ts "attach는 허락한 provider endpoint origin이 아닌 목적지에 값을 붙이지 않는다", packages/core/lophn-agent/providers/commands_test.ts "Connect는 provider.<id>가 아닌 secret 이름을 거절하고 row를 남기지 않는다"
```

지금: secret 저장을 `<dataRoot>/secrets.json`(`secrets/file-store.ts`)으로 옮기면서 옛 보호 입력 relay와 keychain 준비(preparation) 작업을 지웠는데, provider 쪽은 옛 길에 남았다.
- 설정 화면의 API key 연결(`settings/providers/core-source.ts`의 `connect`, `registerCustom`의 key 있는 길)은 `connectIntent`로 보호 입력 창을 연다. 창의 제출(`shell/main/secret-input/submit.ts`의 `submitSecret`)은 `secrets/put`으로 값만 올린다. intent의 `connect`(이름, 정의, endpoint, protocol)로 provider를 등록하는 호출은 어디에도 없다. `providers/register`를 부르는 곳은 key 없는 custom 길 하나다.
- 새 길의 `ConnectProvider`(`protocol/lophn-agent/providers.ts`, `credential: {secret}`)는 protocol에만 있고 core handler가 없다(`lophn-agent/providers/commands.ts`는 register, disconnect, refresh, record-availability, login만).
- `RegisterProvider`는 api_key의 값 참조를 옛 `credential.preparation.sealed_ref`로만 받는다. 그 준비를 만드는 코드는 지워졌다.
- agent runtime의 전송은 옛 keychain에서 읽는다(`run-loop/runtime-secret.ts`의 `createSecretAttach({keychain})`). 새 `createFileSecretAttach`는 `main/daemon/wiring/secrets.ts`에서 allowance가 늘 `forbidden`, 목적지가 빈 목록이다.
- OAuth도 model 호출에 못 쓴다(`models/resolve.ts`가 api_key와 none 밖의 credential을 거절).

영향: 사람이 Anthropic·OpenAI 같은 cloud provider를 key로 연결할 수 없다. key는 `secrets.json`에 저장되지만 연결된 provider 목록은 비고, agent는 model을 부를 수 없다. 인증 없는 loopback provider(이 컴퓨터의 local model)만 쓸 수 있다. 코드로 확인했고 화면으로 돌려 보지는 않았다.

고치려면:
- `secrets.json` 길로 끝낸다(중간). core에 `ConnectProvider` handler를 두어 `credential: {secret: <이름>}`으로 provider를 만들고, 보호 입력 창이 `secrets/put` 뒤에 intent의 `connect`로 `ConnectProvider`를 부르고, agent runtime의 attach를 `createFileSecretAttach`로 바꿔 provider endpoint host를 목적지로 허락한다. `RegisterProvider`의 `preparation`과 provider가 쓰던 옛 keychain 코드는 지운다. 추천.
- 옛 keychain 길을 되살린다(큼). 지운 relay와 준비 작업을 되돌려야 하고 Linux Secret Service 밖에서는 여전히 안 된다.

정한 것: `secrets.json` 길로 끝낸다. 저장소는 이미 그쪽으로 옮겼고 옛 relay는 지워져 있다(AGENTS.md "호환성": 옛 길을 남기지 않는다). (agent)

닫음: `secrets.json` 길로 끝냈다. 설정 화면의 API key 연결은 보호 입력 창(`openSecretInput`)이 `stored`를 답한 뒤 `providers/connect`를 `credential: {secret: "provider.<id>"}`로 부르고, 실패하면(conflict 말고) 올린 값을 지운다. key 없는 custom도 `connect`다. 끊기는 `secrets/delete`로 값도 지운다. core의 `ConnectProvider`는 `provider.<id>` 밖의 이름을 `invalid_input`으로 거절하고, credential의 `secret_ref`는 `{name}`이며 같은 연결인지는 `logged_in_at`으로 본다. agent runtime은 감독 pipe에 `{name, destination}`을 싣고 core의 `createFileSecretAttach`가 provider credential만 허용하고, process가 살아 있고 목적지가 그 이름의 회수되지 않은 provider endpoint origin일 때만 값을 읽어 준다. `RegisterProvider`, `preparation`, provider keychain 참조 통로와 회수(`reclaim`·`sweep`)는 지웠다. MCP는 옛 keychain 길이 그대로다. OAuth credential로 model을 부르는 길은 여전히 없다.

## template 앱의 release 준비가 file 수 상한(10,000)에 걸린다

```yaml
kind: bug
modules: [packages/core/apps]
closed: fixed
guard: packages/core/apps/releases/bundle/vendor_test.ts
```

지금: `apps/releases/prepare/from-source.ts`의 `fetchExternal`이 앱 npm 의존을 `deno cache`(`nodeModulesDir: "auto"`)로 받고, `releases/bundle/vendor.ts`의 `readVendorFiles`가 `node_modules/`를 읽어 bundle file로 만든다. `collect`는 `Deno.stat`으로 symlink를 따라가므로 `node_modules/<이름>` symlink가 가리키는 `node_modules/.deno/<이름>@<판>/…` 폴더를 한 번 더 복사한다. 앱 template이 쓰는 `lucide-react@1.51.0` 하나가 4306 file이라 두 번 담기면 그것만 8600개를 넘는다. 손으로 깐 사본으로 template 앱의 release 준비를 돌리면 약 15,000 file이 되어 `RELEASE_FILE_MAX_COUNT`(`packages/protocol/apps/releases.ts`, 10,000)에서 `invalid_input`·`file_count`로 멈춘다.

영향: template으로 만든 앱은 화면 build와 blueprint 평가를 지나도 release를 준비하지 못한다. 위 "설치 사본" 이슈를 고쳐도 release는 여기서 막힌다.

고치려면:
- `collect`가 symlink를 따라 복사하지 않고, 실제 폴더는 `.deno/` 안 한 곳만 담는다. bundle을 푸는 쪽(운영 process가 읽는 자리)이 `node_modules/<이름>` 연결을 다시 만든다(중간). 크기도 반으로 준다. 추천.
- 상한을 올린다(작음). bundle에 같은 file이 두 번 들어가는 것은 그대로다.

닫음: `readVendorFiles`의 `collect`는 symlink를 따라가지 않고 `Deno.readLink` 값을 `node_modules/.lophn-links.json`(`bundle/links.ts`) 목록 하나로 bundle에 굳힌다. 실제 폴더는 `.deno/` 안 한 벌만 담긴다. `sealBundle`이 정규 file을 다 쓴 뒤 그 목록으로 연결을 다시 만들고, 사본 밖을 가리키는 target(절대 경로, 부모 깊이를 넘는 `..`, 중간 `..`, 연결 아래 연결)은 아무것도 만들기 전에 `invalid_input`으로 거절한다. 상한은 그대로다. 실제 template 앱으로 file 수가 상한 아래인지는 손으로 확인하지 않았다(E2E 몫).

## 화면이 둘 이상인 앱의 합친 `app.js.map`에 `mappings`가 없다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/problems]
closed: fixed
guard: packages/core/problems/snapshots/work_test.ts
```

지금: `core/apps/releases/ui-build/build.ts`가 화면별 source map을 `app.js.map` 하나로 합칠 때, 화면이 둘 이상이면 `mappings`를 담지 않는다. `core/problems/snapshots/work.ts`는 앱 오류 stack을 앱 source 위치로 풀 때 이 `mappings`를 읽는다. annotation의 source 위치 잇기를 지운 뒤 이 map을 읽는 곳은 problems뿐이다.

영향: 화면이 둘 이상인 앱의 오류는 stack을 source 위치로 풀지 못하고 bundle 위치로만 남는다. App Engineer가 고칠 곳을 찾는 데 시간이 든다.

고치려면:
- 화면별 map을 따로 봉인하고 problems가 stack의 화면 bundle에 맞는 map을 읽는다(중간).
- 합친 map에 index map(`sections`)을 쓴다(중간. 읽는 쪽이 sections를 풀어야 한다).

추천: 첫째.

닫음: 화면 build(`ui-build/build.ts`)가 화면마다 `screens/<key>/main.js.map`을 bundle file로 내고 합친 `app.js.map`은 없다. problems(`snapshots/work.ts`의 `frameFromScreenMap`)는 stack에서 `/screens/<key>/main.js`를 가리킨 첫 site의 화면 map으로 앱 source 위치를 풀고, 그것을 `framesInsideBundle`보다 먼저 시도한다. 위치를 모르는 stack에서 map 전체를 푸는 가지는 지웠다. mappings 문자열 한도(`stack_bytes`, 16 KiB)를 넘는 큰 화면은 여전히 bundle 위치로만 남는다.

## 기동 중 crash와 supervisor·앱 process·shell main의 crash가 log에 안 남는다

```yaml
kind: bug
modules: [packages/core/main, packages/core/apps, packages/shell/main]
closed: fixed
guard: 없음
```

지금: `installCrashHandler`는 daemon의 diagnostics wiring `start` 뒤와 agent runtime의 `startAgentRuntime` 성공 뒤에만 걸린다. 그 앞의 crash는 stderr와 종료뿐이다. 앱 supervisor, 앱 process, shell main은 crash handler가 없다. agent runtime이 계속 죽으면 core가 다시 띄울 때마다 한 줄씩 쌓인다(재기동 제한 없음). agent runtime이 적은 `location`이 I/O worker catalog에 없으면 ingress가 버린다. stderr 원문은 기존 redaction 규칙(20자 미만 `sk-` 값 등)에 안 걸리는 값을 가리지 못한다.

영향: 기동 실패와 앱 쪽 crash는 사람이 terminal을 보지 않으면 원인을 모른다.

고치려면:
- 필요해질 때 같은 `installCrashHandler`를 각 entry에 건다(작음, 곳마다).

닫음: daemon은 `installCrashHandler`를 diagnostics wiring의 `prepare`(진단 입구를 provide한 직후)에서 건다. 앱 supervisor(`main/app-supervisor/main.ts`)는 `unhandledrejection` listener 대신 `installCrashHandler`로 core에 진단 한 줄을 보내고 앱 자식을 정지한 뒤 exit 1 하고, core(`wiring/apps.ts`)가 component·location을 정해 log에 쓴다. shell main은 `desktop/wiring/crash.ts`가 `ctx.core.diagnostic`으로 한 줄 보내고 core(`daemon/parent.ts`의 `internal`)가 받는다. 새 location과 component는 I/O worker catalog에 올렸다. 앱 process는 이 절의 서술과 달리 이미 `installCrashExit`와 exception observer, supervisor의 crash 관측(problems)이 있어 걸지 않았다. 남은 것(I/O worker가 뜨기 전 crash, agent runtime 재기동마다 쌓이는 줄, stderr redaction 한계)은 열린 절로 다시 썼다.

## data root에 sdk 설치 사본과 앱 template을 까는 코드가 없다

```yaml
kind: bug
modules: [packages/core/apps]
closed: fixed
guard: packages/core/apps/packages/install_test.ts
```

지금: 앱 release 준비(`apps/releases/prepare/from-source.ts`)는 `readSdkCopies`(`releases/bundle/lock.ts`)로 `<dataRoot>/sdk/<part>/<version>`의 설치 사본을 읽고, 개발용 import map(`packages/core/apps/packages/template/import-map.ts`의 `devImportMap`)과 blueprint 검사(`apps/blueprint/check.ts`)도 같은 자리를 가리킨다. 그런데 그 자리에 사본을 쓰는 코드가 없다. `apps/packages/install.ts`에는 "지원 소스의 설치 사본", "설치 템플릿을 `<dataRoot>/templates/app/`에 둔다" 같은 주석만 남았고, `installPackage`·`installSupportPackage`·`installTemplate`는 쓰지 않는 export를 지운 cleanup에서 함께 지워졌다(그 전에도 부르는 곳은 test뿐이었다). `scaffoldApp`(`packages/core/apps/packages/template/scaffold.ts`)도 부르는 곳이 없다.

영향: 새 data root에서 `lophn-sdk:` 의존을 선언한 앱은 release 준비가 `sdk_not_installed`로 멈춘다. 사람이 앱을 만들어 release할 수 없다. 설치 사본에서 `@lophn/ui/<분류>`가 풀리는지도 core를 띄워서는 확인할 수 없고, 사본을 손으로 깔아 확인해야 한다.

손으로 깔아 보니 더 필요한 것: `packages/sdk/blueprint`와 `cap-store`가 `../../protocol/…`을 상대 경로로 import해서, 사본만으로는 풀리지 않는다(지워진 `vendor.ts` 설치 쪽이 이것을 `vendor/`로 담았다). `packages/design/deno.json`(`@lophn/ui`)에는 `version`이 없어서 설치 판 `1.0.0`을 어디서 읽을지도 정해야 한다.

고치려면:
- core 기동 때 `packages/sdk/*`와 지원 소스(`packages/design`, wording)를 `packageInstallPath` 자리에 읽기 전용으로 풀고, 앱 template을 `templates/app/`에 둔다(중간). 지워진 `install.ts` 함수를 git 기록에서 되살려 기동 조립에 잇는 것이 가장 짧다. 판(version)은 각 `deno.json`의 `version`을 쓴다. 추천.
- release 준비가 data root 대신 repo의 `packages/` 소스를 직접 읽는다(작음). read-only 사본과 "release bundle에 굳힌 사본" 격리가 약해진다.

닫음: core 기동의 `sdkInstallWiring`(`main/daemon/wiring/sdk-install.ts`, `build`)이 `installSdkCopies`로 `packages/sdk/*` 중 `deno.json`이 있는 것과 `@lophn/ui`·`@lophn/wording`을 `<dataRoot>/sdk/<이름 뒤쪽>/<판>`에 읽기 전용으로 풀고, `installBuiltinTemplate`으로 template을 `templates/app/`에 둔다. 같은 byte면 건드리지 않고 다르면 지우고 다시 쓴다. blueprint·cap-store·cap-problem이 사본 밖을 가리키던 import는 사본 안 `vendor/`로 담고 specifier를 바꾼다. 판은 각 `deno.json`의 `version`이다(`packages/design`·`design/wording`에 `1.0.0`을 더하고 `packages/sdk/cap-store/deno.json`을 만들었다). catalog 등록은 하지 않는다(열린 절 "sdk package가 catalog에 없어…"). 배포판은 `tools/package-linux.ts`가 `packages/`를 `platform/packages`로 복사해 같은 상대 계산이 풀린다.

## sdk package가 catalog에 없어 `package show`가 coding agent에게 SDK guide를 주지 못한다

```yaml
kind: bug
modules: [packages/core/apps, packages/coding-agent]
closed: fixed
guard: 없음
```

지금: core 기동이 `packages/sdk/*`와 지원 소스를 `<dataRoot>/sdk/<이름 뒤쪽>/<판>`에 설치 사본으로 푼다(`apps/packages/install.ts`의 `installSdkCopies`). 사본에는 `guide.md`가 들어 있지만 package catalog에는 등록하지 않는다(`register_version`·guide blob 준비를 되살리지 않았다). 그런데 coding agent skill `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`는 새 code를 쓰기 전에 `package list`, `package show`로 의존 package의 API와 예제를 읽으라고 하고, `@lophn/app-ui`의 guide도 `package show`로 읽으라고 한다. 등록이 없어 둘 다 빈 결과다.

영향: coding agent가 앱을 만들 때 SDK(`@lophn/app-ui`, `@lophn/blueprint`, `cap-*`)의 API와 예제를 읽지 못하고 짐작으로 쓴다. 사람은 틀린 import·호출로 build와 release 준비가 실패하는 앱을 받는다.

고치려면:
- 기동 설치가 사본을 푼 뒤 같은 byte로 `register_version`을 낸다(중간). `apps/packages/commands.ts`는 같은 name·version의 bundle hash가 다르면 `conflict`("published version bytes are immutable")로 거절하므로, 개발 중 `packages/sdk/*` 소스를 고치고 다시 띄우면 기동이 막힌다. 내장 sdk만 같은 판 덮어쓰기를 허락하거나 판에 소스 hash를 붙여야 한다.
- skill이 `package show` 대신 설치 사본의 `guide.md`(`<dataRoot>/sdk/<이름 뒤쪽>/<판>/guide.md`)를 읽게 한다(작음). agent가 data root 안 사본을 읽을 수 있어야 한다.
- 추천: 둘째. catalog는 사용자 package(@me) 몫으로 두고, 내장 sdk는 설치 사본이 정본이다.

닫음: 둘째 안으로 고쳤다. `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`가 내장 SDK는 앱 `.lophn/import-map.json`이 가리키는 설치 사본 폴더의 `guide.md`를 읽게 하고, `package list`·`package show`는 사용자 package 몫으로 둔다. 설치 사본에는 각 sdk의 `guide.md`가 `mod.ts`와 같은 폴더에 들어 있다(`installSdkCopies`가 폴더째 복사한다).

## I/O worker가 뜨기 전 daemon crash는 log에 안 남고, agent runtime crash는 재기동마다 쌓인다

```yaml
kind: bug
modules: [packages/core/main, packages/core/diagnostics]
closed: kept
guard: 없음
```

지금: daemon의 crash handler는 diagnostics wiring의 `prepare`에서 걸리지만, log 파일은 I/O worker가 쓰고 I/O worker는 `wiring/supervision.ts`의 `start`에서 뜬다. 그 앞의 crash는 `ctx.diagnosticsWrite`가 `false`로 끝나 stderr와 exit 1뿐이다. agent runtime(`main/agent-runtime/main.ts`)이 계속 죽으면 core가 다시 띄울 때마다 crash 한 줄이 쌓인다(재기동 제한 없음, `lophn-agent/run-loop/runtime.ts`). crash stderr 원문은 기존 redaction 규칙(20자 미만 `sk-` 값 등)에 안 걸리는 값을 가리지 못한다.

영향: 기동 초반 실패는 사람이 terminal을 보지 않으면 원인을 모른다. agent runtime이 crash loop에 빠지면 같은 줄이 log를 채운다.

고치려면:
- 기동 초반 crash: log 파일에 직접 덧붙이는 길을 만든다(작음. log 파일을 I/O worker만 쓴다는 규칙이 깨진다). 실제로 원인을 못 찾는 기동 실패가 나올 때 한다. 추천.
- agent runtime: 재기동에 횟수·간격 제한을 둔다(작음, agent runtime 쪽).

닫음: 남긴다. 기동 초반 crash도 stderr와 exit 1은 남고(`main/daemon/wiring/diagnostics.ts` 주석), log 파일에 직접 쓰면 log를 I/O worker만 쓴다는 규칙이 깨진다. agent runtime 줄은 틀렸다: 재기동은 `packages/core/supervision/responsiveness/supervisor.ts`가 하고 `slot.ts`의 `RESTART_LIMIT`(3번)에서 멈추므로 log가 계속 쌓이지 않는다. redaction에 안 걸리는 값은 이 변경이 아니라 redaction 규칙 쪽 한계다.

## 설정 화면의 보호 입력 창이 열리지 않아 MCP credential을 넣을 수 없다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/lophn-agent, packages/core/secrets]
closed: fixed
guard: "secret 값은 자기 이름 공간의 목적지로만 간다", "MCP 설정은 mcp. 밖의 secret 이름과 stdio env의 secret을 받지 않는다", "OAuth token은 각자 알려진 값이 되고 갱신이 거절되면 세 이름이 지워진다"
```

지금: `packages/shell/renderer/desktop/lophn-space/settings/core-call.ts`의 `windowSecretOpener`가 `lophnShell.openConfirmation`을 찾는데, preload(`packages/shell/preload/shell.ts`)는 `openSecretInput`만 낸다. 그래서 이 opener로 보호 입력 창을 여는 길은 `unavailable`이다. provider API key만 같은 file의 `windowSecretInputOpener`·`enterSecret`(preload의 `openSecretInput`)으로 고쳤다. 이 opener를 쓰는 곳은 셋이다: 전역 MCP credential(`settings/core-source.ts`의 `enterServerCredential`), agent 설정에서 만든 서버의 credential(`settings/agents/core-source.ts`의 `createServer`), provider OAuth 붙여 넣기(`settings/providers/core-source.ts`의 `signIn`, 아래 절). MCP의 `sec:` 참조는 창을 고쳐도 옛 ledger `secrets` 표와 keychain을 보므로 `secrets.json`에 넣은 값을 찾지 못한다(`packages/core/lophn-agent/extensions/secret-refs.ts`의 `lookupMcpSecretUse`, `run-loop/runtime-secret.ts`의 MCP 가지).

영향: 사람이 token이 필요한 MCP server를 붙일 수 없다.

고치려면: MCP credential을 provider와 같은 `secrets.json` 길로 옮긴다. 보호 입력 창은 `windowSecretInputOpener`·`enterSecret`을 쓰고, MCP의 secret 참조를 이름(`{name}`)으로 바꾸고 attach가 file 저장소에서 읽는다(중간). provider 길(`createFileSecretAttach`, `providerSecretDestinations`)의 모양을 따른다. 다 옮기면 `windowSecretOpener`와 그 intent type은 쓰는 곳이 없으니 지운다. 추천: 이 안.

정한 것: keychain 길을 통째로 지운다. MCP credential과 MCP OAuth token을 `secrets.json`으로 옮기고, keychain adapter, 옛 ledger `secrets` 표와 그 command·read, `libsecret-tools` 의존을 지운다. `windowSecretOpener`는 provider OAuth `signIn`이 아직 쓰므로 그 절의 결정 때 지운다. (사람)

닫음: MCP credential과 OAuth token이 `secrets.json`에 있다. 설정의 `{secret}`은 `mcp.` 이름만 받고(보통 `mcp.<global 또는 project id>.<서버>`) renderer가 서버를 더한 뒤 `windowSecretInputOpener`·`enterSecret`(purpose `mcp`)으로 값을 받는다. 상태는 `secrets/status`로 읽는다. OAuth token은 `mcp-oauth.<scope>.<server>.access`·`.refresh`·`.meta`다. 감독 pipe는 `{name, destination}` 하나이고 `createFileSecretAttach`가 이름의 앞머리로 용도를 정하며 `lophn-agent/secret-destinations.ts`가 이름 공간마다 목적지를 찾는다. `windowSecretOpener`는 provider OAuth `signIn`이 아직 쓴다(provider OAuth 절).

## provider OAuth 로그인 길은 있지만 그 credential로 model을 부르는 길이 없다

```yaml
kind: bug
modules: [packages/core/lophn-agent, packages/protocol, packages/shell/renderer]
closed: fixed
guard: [packages/core/lophn-agent/providers/login_test.ts, packages/core/lophn-agent/providers/oauth-refresh_test.ts, packages/core/lophn-agent/providers/secret-refs_test.ts]
```

지금: provider 정의의 `auth_kinds`에 `oauth`가 있고(`packages/protocol/lophn-agent/provider-values.ts`), core에 로그인 흐름(`packages/core/lophn-agent/providers/oauth.ts`, `providers/login.ts`)이, 설정 화면에 `signIn`(`settings/providers/core-source.ts`)이 있다. 그러나 붙여 넣기 창을 여는 `settings/core-call.ts`의 `windowSecretOpener`가 preload에 없는 `lophnShell.openConfirmation`을 찾아 창이 열리지 않고(preload는 `openSecretInput`만 낸다), agent runtime의 secret 전달(`run-loop/runtime-secret.ts`)은 `provider.`·`mcp.`·`mcp-oauth.` 이름만 보낸다. OAuth token이 model 호출에 실리는 길이 없다.

영향: 사람이 구독 계정(OAuth)으로 provider를 연결할 수 없다. 화면에는 sign in 단추가 보인다.

고치려면:
- 살린다(큼): 붙여 넣기 창을 `openSecretInput` 길로 고치고, token을 `secrets.json`에 두고, runtime이 provider 호출에 token을 싣고 갱신(`RefreshProviderCredential`)을 잇는다.
- 지운다(중간): OAuth 정의와 로그인 흐름, 화면의 sign in을 지운다. API key와 loopback provider만 남는다.
- 추천: 사람이 구독 OAuth를 제품에 둘지 정한 뒤 그대로 한다. 둘 생각이 없으면 지운다.

정한 것: 구독 계정 OAuth를 제품에 둔다. ChatGPT(공식 Sign in with ChatGPT)와 SuperGrok(device code)만 두고 Claude는 두지 않는다(Anthropic 금지). (사람, Claude 제외는 agent)

닫음: 로그인이 끝나면 core(`providers/login.ts`)가 token을 `provider.<id>`·`.refresh`·`.meta`에 저장하고 ConnectProvider(`auth_kind: oauth`, `expires_at`)를 부른다. 화면은 begin → OS browser → interval마다 complete이고 붙여넣기 창은 없다. `models/resolve.ts`가 OAuth를 Bearer로 싣고, runtime이 token을 청할 때 core(`providers/oauth-refresh.ts`)가 만료 5분 전이면 갱신한다. 발급자 호출은 MCP와 같은 대기열(`issuer-requests.ts`)로 runtime이 보낸다. gate 셋(`LOPHN_LIVE_PROVIDER`, `verified_for_lophn`, wiring의 http 없음)은 지웠다.
