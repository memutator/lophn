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
