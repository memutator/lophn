# platform

config, diagnostics, storage, server, supervision 같은 바닥 module. 이 주제의 architecture 문서는 없다.

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

지금: 앱 release 준비(`apps/releases/prepare/from-source.ts`)는 `readSdkCopies`(`releases/bundle/lock.ts`)로 `<dataRoot>/sdk/<part>/<version>`의 설치 사본을 읽고, 개발용 import map(`packages/core/apps/packages/template/import-map.ts`의 `devImportMap`)과 blueprint 검사(`apps/blueprint/check.ts`)도 같은 자리를 가리킨다. 그런데 그 자리에 사본을 쓰는 코드가 없다. `apps/packages/install.ts`에는 "지원 소스의 설치 사본", "설치 템플릿을 `<dataRoot>/templates/app/`에 둔다" 같은 주석만 남았고, `installPackage`·`installSupportPackage`·`installTemplate`는 쓰지 않는 export를 지운 cleanup에서 함께 지워졌다(그 전에도 부르는 곳은 test뿐이었다). `scaffoldApp`(`packages/core/apps/packages/template/scaffold.ts`)도 부르는 곳이 없다.

영향: 새 data root에서 `lophn-sdk:` 의존을 선언한 앱은 release 준비가 `sdk_not_installed`로 멈춘다. 사람이 앱을 만들어 release할 수 없다. 설치 사본에서 `@lophn/ui/<분류>`가 풀리는지도 core를 띄워서는 확인할 수 없고, 사본을 손으로 깔아 확인해야 한다.

손으로 깔아 보니 더 필요한 것: `packages/sdk/blueprint`와 `cap-store`가 `../../protocol/…`을 상대 경로로 import해서, 사본만으로는 풀리지 않는다(지워진 `vendor.ts` 설치 쪽이 이것을 `vendor/`로 담았다). `packages/design/deno.json`(`@lophn/ui`)에는 `version`이 없어서 설치 판 `1.0.0`을 어디서 읽을지도 정해야 한다.

고치려면:
- core 기동 때 `packages/sdk/*`와 지원 소스(`packages/design`, wording)를 `packageInstallPath` 자리에 읽기 전용으로 풀고, 앱 template을 `templates/app/`에 둔다(중간). 지워진 `install.ts` 함수를 git 기록에서 되살려 기동 조립에 잇는 것이 가장 짧다. 판(version)은 각 `deno.json`의 `version`을 쓴다. 추천.
- release 준비가 data root 대신 repo의 `packages/` 소스를 직접 읽는다(작음). read-only 사본과 "release bundle에 굳힌 사본" 격리가 약해진다.

## 설정 화면의 보호 입력 창이 열리지 않아 OAuth 붙여 넣기와 MCP credential을 넣을 수 없다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/core/lophn-agent, packages/core/secrets]
```

지금: `shell/renderer/desktop/lophn-space/settings/core-call.ts`의 `windowSecretOpener`가 `lophnShell.openConfirmation`을 찾는데, preload(`packages/shell/preload/shell.ts`)는 `openSecretInput`만 낸다. 그래서 이 opener로 보호 입력 창을 여는 길은 `unavailable`이다. provider API key 길만 같은 file의 `windowSecretInputOpener`·`enterSecret`(preload의 `openSecretInput`)으로 고쳤다. OAuth 붙여 넣기 창(`settings/core-source.ts`)과 MCP credential 입력(`settings/agents/core-source.ts`)은 그대로다. MCP의 `sec:` 참조는 창을 고쳐도 옛 ledger `secrets` 표와 keychain을 보므로 `secrets.json`에 넣은 값을 찾지 못한다(`extensions/secret-refs.ts`의 `lookupMcpSecretUse`).

영향: 사람이 token이 필요한 MCP server를 붙일 수 없다. OAuth 코드 붙여 넣기도 안 된다(OAuth로 model을 부르는 길은 원래 없다).

고치려면: MCP credential을 provider와 같은 `secrets.json` 길로 옮긴다. 보호 입력 창은 provider API key가 쓰는 `windowSecretInputOpener`·`enterSecret`을 쓰고, MCP의 secret 참조를 이름(`{name}`)으로 바꾸고 attach가 file 저장소에서 읽는다(중간). 추천: provider 길(`createFileSecretAttach`와 `providerSecretDestinations`)의 모양을 따라 한다.

## sdk package가 catalog에 없어 `package show`가 coding agent에게 SDK guide를 주지 못한다

```yaml
kind: bug
modules: [packages/core/apps, packages/coding-agent]
```

지금: core 기동이 `packages/sdk/*`와 지원 소스를 `<dataRoot>/sdk/<이름 뒤쪽>/<판>`에 설치 사본으로 푼다(`apps/packages/install.ts`의 `installSdkCopies`). 사본에는 `guide.md`가 들어 있지만 package catalog에는 등록하지 않는다(`register_version`·guide blob 준비를 되살리지 않았다). 그런데 coding agent skill `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`는 새 code를 쓰기 전에 `package list`, `package show`로 의존 package의 API와 예제를 읽으라고 하고, `@lophn/app-ui`의 guide도 `package show`로 읽으라고 한다. 등록이 없어 둘 다 빈 결과다.

영향: coding agent가 앱을 만들 때 SDK(`@lophn/app-ui`, `@lophn/blueprint`, `cap-*`)의 API와 예제를 읽지 못하고 짐작으로 쓴다. 사람은 틀린 import·호출로 build와 release 준비가 실패하는 앱을 받는다.

고치려면:
- 기동 설치가 사본을 푼 뒤 같은 byte로 `register_version`을 낸다(중간). `apps/packages/commands.ts`는 같은 name·version의 bundle hash가 다르면 `conflict`("published version bytes are immutable")로 거절하므로, 개발 중 `packages/sdk/*` 소스를 고치고 다시 띄우면 기동이 막힌다. 내장 sdk만 같은 판 덮어쓰기를 허락하거나 판에 소스 hash를 붙여야 한다.
- skill이 `package show` 대신 설치 사본의 `guide.md`(`<dataRoot>/sdk/<이름 뒤쪽>/<판>/guide.md`)를 읽게 한다(작음). agent가 data root 안 사본을 읽을 수 있어야 한다.
- 추천: 둘째. catalog는 사용자 package(@me) 몫으로 두고, 내장 sdk는 설치 사본이 정본이다.

## I/O worker가 뜨기 전 daemon crash는 log에 안 남고, agent runtime crash는 재기동마다 쌓인다

```yaml
kind: bug
modules: [packages/core/main, packages/core/diagnostics]
```

지금: daemon의 crash handler는 diagnostics wiring의 `prepare`에서 걸리지만, log 파일은 I/O worker가 쓰고 I/O worker는 `wiring/supervision.ts`의 `start`에서 뜬다. 그 앞의 crash는 `ctx.diagnosticsWrite`가 `false`로 끝나 stderr와 exit 1뿐이다. agent runtime(`main/agent-runtime/main.ts`)이 계속 죽으면 core가 다시 띄울 때마다 crash 한 줄이 쌓인다(재기동 제한 없음, `lophn-agent/run-loop/runtime.ts`). crash stderr 원문은 기존 redaction 규칙(20자 미만 `sk-` 값 등)에 안 걸리는 값을 가리지 못한다.

영향: 기동 초반 실패는 사람이 terminal을 보지 않으면 원인을 모른다. agent runtime이 crash loop에 빠지면 같은 줄이 log를 채운다.

고치려면:
- 기동 초반 crash: log 파일에 직접 덧붙이는 길을 만든다(작음. log 파일을 I/O worker만 쓴다는 규칙이 깨진다). 실제로 원인을 못 찾는 기동 실패가 나올 때 한다. 추천.
- agent runtime: 재기동에 횟수·간격 제한을 둔다(작음, agent runtime 쪽).
