# platform

config, diagnostics, storage, server, supervision 같은 바닥 module. 이 주제의 architecture 문서는 없다.

## 화면이 둘 이상인 앱의 합친 `app.js.map`에 `mappings`가 없다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/problems]
```

지금: `core/apps/releases/ui-build/build.ts`가 화면별 source map을 `app.js.map` 하나로 합칠 때, 화면이 둘 이상이면 `mappings`를 담지 않는다. `core/problems/snapshots/work.ts`는 앱 오류 stack을 앱 source 위치로 풀 때 이 `mappings`를 읽는다. annotation의 source 위치 잇기를 지운 뒤 이 map을 읽는 곳은 problems뿐이다.

영향: 화면이 둘 이상인 앱의 오류는 stack을 source 위치로 풀지 못하고 bundle 위치로만 남는다. App Engineer가 고칠 곳을 찾는 데 시간이 든다.

고치려면:
- 화면별 map을 따로 봉인하고 problems가 stack의 화면 bundle에 맞는 map을 읽는다(중간).
- 합친 map에 index map(`sections`)을 쓴다(중간. 읽는 쪽이 sections를 풀어야 한다).

추천: 첫째.

## 기동 중 crash와 supervisor·앱 process·shell main의 crash가 log에 안 남는다

```yaml
kind: bug
modules: [packages/core/main, packages/core/apps, packages/shell/main]
```

지금: `installCrashHandler`는 daemon의 diagnostics wiring `start` 뒤와 agent runtime의 `startAgentRuntime` 성공 뒤에만 걸린다. 그 앞의 crash는 stderr와 종료뿐이다. 앱 supervisor, 앱 process, shell main은 crash handler가 없다. agent runtime이 계속 죽으면 core가 다시 띄울 때마다 한 줄씩 쌓인다(재기동 제한 없음). agent runtime이 적은 `location`이 I/O worker catalog에 없으면 ingress가 버린다. stderr 원문은 기존 redaction 규칙(20자 미만 `sk-` 값 등)에 안 걸리는 값을 가리지 못한다.

영향: 기동 실패와 앱 쪽 crash는 사람이 terminal을 보지 않으면 원인을 모른다.

고치려면:
- 필요해질 때 같은 `installCrashHandler`를 각 entry에 건다(작음, 곳마다).

## events 점검이 Reactor backoff를 보지 못한다

```yaml
kind: bug
modules: [packages/core/main, packages/core/events]
```

지금: `core/main/daemon/wiring/events.ts`의 `events` 점검은 연결이 열려 있고 `start` 뒤인지, `events` 표를 한 번 읽을 수 있는지만 본다. `ReactorRunner`에 상태를 내는 칸이 없어 handler가 실패해 backoff 중이어도 `available`이다. 두 점검 모두 마지막 응답 시각은 보지 않는다.

영향: reaction이 멈춰 있어도 Diagnostics는 정상으로 보인다.

고치려면: `ReactorRunner`에 마지막 성공 시각이나 backoff 여부를 내는 읽기를 더하고 점검이 본다(작음). 필요해질 때 한다.

## data root에 sdk 설치 사본과 앱 template을 까는 코드가 없다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금: 앱 release 준비(`apps/releases/prepare/from-source.ts`)는 `readSdkCopies`(`releases/bundle/lock.ts`)로 `<dataRoot>/sdk/<part>/<version>`의 설치 사본을 읽고, 개발용 import map(`packages/template/import-map.ts`의 `devImportMap`)과 blueprint 검사(`apps/blueprint/check.ts`)도 같은 자리를 가리킨다. 그런데 그 자리에 사본을 쓰는 코드가 없다. `apps/packages/install.ts`에는 "지원 소스의 설치 사본", "설치 템플릿을 `<dataRoot>/templates/app/`에 둔다" 같은 주석만 남았고, `installPackage`·`installSupportPackage`·`installTemplate`는 쓰지 않는 export를 지운 cleanup에서 함께 지워졌다(그 전에도 부르는 곳은 test뿐이었다). `scaffoldApp`(`packages/template/scaffold.ts`)도 부르는 곳이 없다.

영향: 새 data root에서 `lophn-sdk:` 의존을 선언한 앱은 release 준비가 `sdk_not_installed`로 멈춘다. 사람이 앱을 만들어 release할 수 없다. 설치 사본에서 `@lophn/ui/<분류>`가 풀리는지도 core를 띄워서는 확인할 수 없고, 사본을 손으로 깔아 확인해야 한다.

손으로 깔아 보니 더 필요한 것: `packages/sdk/blueprint`와 `cap-store`가 `../../protocol/…`을 상대 경로로 import해서, 사본만으로는 풀리지 않는다(지워진 `vendor.ts` 설치 쪽이 이것을 `vendor/`로 담았다). `packages/design/deno.json`(`@lophn/ui`)에는 `version`이 없어서 설치 판 `1.0.0`을 어디서 읽을지도 정해야 한다.

고치려면:
- core 기동 때 `packages/sdk/*`와 지원 소스(`packages/design`, wording)를 `packageInstallPath` 자리에 읽기 전용으로 풀고, 앱 template을 `templates/app/`에 둔다(중간). 지워진 `install.ts` 함수를 git 기록에서 되살려 기동 조립에 잇는 것이 가장 짧다. 판(version)은 각 `deno.json`의 `version`을 쓴다. 추천.
- release 준비가 data root 대신 repo의 `packages/` 소스를 직접 읽는다(작음). read-only 사본과 "release bundle에 굳힌 사본" 격리가 약해진다.

## template 앱의 release 준비가 file 수 상한(10,000)에 걸린다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금: `apps/releases/prepare/from-source.ts`의 `fetchExternal`이 앱 npm 의존을 `deno cache`(`nodeModulesDir: "auto"`)로 받고, `releases/bundle/vendor.ts`의 `readVendorFiles`가 `node_modules/`를 읽어 bundle file로 만든다. `collect`는 `Deno.stat`으로 symlink를 따라가므로 `node_modules/<이름>` symlink가 가리키는 `node_modules/.deno/<이름>@<판>/…` 폴더를 한 번 더 복사한다. 앱 template이 쓰는 `lucide-react@1.51.0` 하나가 4306 file이라 두 번 담기면 그것만 8600개를 넘는다. 손으로 깐 사본으로 template 앱의 release 준비를 돌리면 약 15,000 file이 되어 `RELEASE_FILE_MAX_COUNT`(`packages/protocol/apps/releases.ts`, 10,000)에서 `invalid_input`·`file_count`로 멈춘다.

영향: template으로 만든 앱은 화면 build와 blueprint 평가를 지나도 release를 준비하지 못한다. 위 "설치 사본" 이슈를 고쳐도 release는 여기서 막힌다.

고치려면:
- `collect`가 symlink를 따라 복사하지 않고, 실제 폴더는 `.deno/` 안 한 곳만 담는다. bundle을 푸는 쪽(운영 process가 읽는 자리)이 `node_modules/<이름>` 연결을 다시 만든다(중간). 크기도 반으로 준다. 추천.
- 상한을 올린다(작음). bundle에 같은 file이 두 번 들어가는 것은 그대로다.

## API key로 provider를 연결해도 쓸 수 있는 provider가 생기지 않는다

```yaml
kind: bug
modules: [packages/core/secrets, packages/core/lophn-agent, packages/core/main, packages/protocol, packages/shell/main, packages/shell/renderer]
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

## 설정 화면의 보호 입력 창이 열리지 않아 OAuth 붙여 넣기와 MCP credential을 넣을 수 없다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/lophn-agent, packages/core/secrets]
```

지금: `shell/renderer/desktop/lophn-space/settings/core-call.ts`의 `windowSecretOpener`가 `lophnShell.openConfirmation`을 찾는데, preload(`packages/shell/preload/shell.ts`)는 `openSecretInput`만 낸다. 그래서 설정 화면이 보호 입력 창을 여는 길이 모두 `unavailable`이다. 계획 `agent-io`의 `provider-connect-shell`이 provider API key 길만 새 opener로 고친다. OAuth 붙여 넣기 창(`settings/core-source.ts`)과 MCP credential 입력(`settings/agents/core-source.ts`)은 그대로다. MCP의 `sec:` 참조는 창을 고쳐도 옛 ledger `secrets` 표와 keychain을 보므로 `secrets.json`에 넣은 값을 찾지 못한다(`extensions/secret-refs.ts`의 `lookupMcpSecretUse`).

영향: 사람이 token이 필요한 MCP server를 붙일 수 없다. OAuth 코드 붙여 넣기도 안 된다(OAuth로 model을 부르는 길은 원래 없다).

고치려면: MCP credential을 provider와 같은 `secrets.json` 길로 옮긴다. 보호 입력 창은 `provider-connect-shell`이 만든 opener를 쓰고, MCP의 secret 참조를 이름(`{name}`)으로 바꾸고 attach가 file 저장소에서 읽는다(중간). 추천: `agent-io` 계획이 끝난 뒤 그 모양을 따라 한다.
