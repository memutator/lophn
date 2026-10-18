# reuse

새 앱을 만들 때 이미 있는 것(내장 SDK, 앱이 낸 package, 다른 앱의 app-api)을 agent가 찾아 쓰는 길이다. architecture 문서는 아직 없다.

## lophn과 App Engineer가 내장 SDK를 볼 길이 없다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/agent-roles]
```

지금:
- 내장 SDK는 기동 때 `<data root>/sdk/<이름>/1.0.0`에 설치 사본으로만 깔린다. `packages/sdk/*`, `@lophn/ui`, `@lophn/wording`이 여기에 든다. package catalog에는 등록하지 않는다(`packages/core/apps/packages/install.ts` 머리 주석).
- `package.list`와 `package.get` tool(`packages/core/apps/agent-tools/package.ts`)은 catalog route(`packagesList`, `packagesVersions`, `packagesGuideBody`)만 읽는다. 그래서 앱이 낸 `@me/*`만 보인다.
- lophn과 App Engineer의 file scope(`packages/core/agent-roles/place/place-folders.ts`의 `placeScope`)에는 `<data root>/sdk`가 없다.
- 그런데 지침은 이 tool로 SDK를 보라고 한다.
  - lophn 지침(`packages/core/agent-roles/roles/lophn/prompt.md`): "build on an existing SDK or package"를 견주기 전에 `package.list`를 읽으라고 한다.
  - App Engineer 지침(`packages/core/agent-roles/roles/app-engineer/prompt.md`): `package.list`와 `package.get`으로 package를 고르라고 한다.
- coding agent 쪽의 같은 문제는 닫혔다(archived `platform.md`의 "sdk package가 catalog에 없어 `package show`가 coding agent에게 SDK guide를 주지 못한다"). coding agent는 설치 사본의 `guide.md`를 읽는다. 그때 정한 것은 "catalog는 @me 몫, 내장 sdk는 설치 사본이 정본"이다.

영향:
- lophn이 새 앱을 기획하면서 "기존 SDK로 하기"를 견줄 때, 내장 SDK가 무엇을 주는지 모른다. 예를 들어 `@lophn/ui`의 data·overlay component나 `@lophn/cap-project`다. 있는 것으로 될 일을 새 앱이나 새 package로 기획할 수 있다.
- App Engineer는 template이 고정한 7개 밖의 내장 package(`@lophn/cap-project`)를 고를 근거를 읽지 못한다.

고치려면:
- `package.list`와 `package.get`이 catalog 뒤에 설치 사본의 내장 SDK도 돌려준다(이름, 판, `guide.md`). catalog에는 등록하지 않는다. 크기는 작음~중간이고, 앞서 정한 "설치 사본이 정본"과 맞는다.
- lophn과 App Engineer의 file scope에 `<data root>/sdk` 읽기를 더하고, 지침에 path를 적는다. 크기는 작음이다. 다만 agent가 path를 알아야 하고, tool 하나로 보이지 않는다.
- 추천: 첫째.

## 다른 앱의 app-api를 agent가 볼 tool이 없다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/agent-roles]
```

지금:
- `app.list`와 `app.get` tool(`packages/core/apps/agent-tools/app.ts`)은 `App`만 돌려준다. 칸은 `packages/protocol/apps/apps.ts`의 `appFields`(id, slug, name, description, source_path, active_release 등)이고, `app.get`은 열린 problem 수를 더한다.
- active release의 app-api 목록(key, label, description, effect, input)은 route `app.app_api`(`packages/protocol/apps/blueprint/read.ts`의 `appAppApi`)가 준다. actors에 agent도 있다.
- 그런데 이 목록을 model에게 보여 주는 tool이 없다. 같은 route를 쓰는 `visual.show`(`packages/core/apps/agent-tools/visual.ts`)는 대화에 앱 카드만 올린다.
- lophn은 project 폴더만, App Engineer는 자기 앱 source만 읽는다(`placeScope`). 그래서 다른 앱의 `blueprint.ts`도 보지 못한다.
- App Engineer의 자격은 자기 앱 하나로 묶여 있다(credential의 `conditions.app`). 그래서 `app.list`에는 자기 앱만 나오고, 다른 앱의 `app.get`과 `app.app_api`는 `not_found`다. 다른 앱의 id도 알 길이 없다.
- 다른 앱의 app-api가 tool로 생기는 것은 사람이 그 앱을 agent에게 할당했을 때뿐이다(`packages/core/lophn-agent/tools/app-tools.ts`).

영향:
- 사람이 새 앱을 청할 때, 다른 앱이 이미 가진 기능(예: 알림 앱의 일정 알림)을 lophn과 App Engineer가 찾지 못한다.
- lophn 지침의 "change an existing app" 견주기가 앱 이름과 한 줄 설명으로만 된다.
- App Engineer는 blueprint `app_connections`에 정확한 app-api key를 적어야 한다(`packages/protocol/apps/blueprint/uses.ts`). 그런데 그 key를 읽을 길이 없다. 사람이 key를 말해 주지 않으면 같은 기능을 새 앱 안에 다시 만든다.

고치려면: `app.app_api`를 감싼 read tool을 새로 두고, lophn과 App Engineer의 tool 목록(`packages/core/agent-roles/tool-lists.ts`)에만 넣는다(작음). App Engineer가 쓰려면 다른 앱의 목록과 app-api를 읽도록 자격을 넓혀야 한다(읽기만). 돌려주는 것은 active release의 app-api 목록(key, label, description, effect)이다. 모든 role이 가진 `app.get`에 싣지 않는 것은 아래 정한 것 때문이다. 같은 tool이 role마다 다른 것을 돌려주지 않게 한다.

정한 것: 다른 앱의 app-api 목록은 lophn과 App Engineer만 본다(사람).

## cap-fs, cap-net, cap-secret이 깔리지 않아 앱이 외부 network, secret, 허락된 경로의 file을 못 쓴다

```yaml
kind: bug
modules: [packages/sdk, packages/core/apps, packages/coding-agent]
```

지금:
- `packages/sdk/cap-fs`, `packages/sdk/cap-net`, `packages/sdk/cap-secret`에는 source와 `guide.md`가 있지만 `deno.json`이 없다.
- 기동 설치(`packages/core/apps/packages/install.ts`의 `installSdkCopies`)는 `deno.json`이 없는 폴더를 "판이 없어" 건너뛴다.
- core 쪽은 셋마다 다르다.
  - fs: release 준비의 권한 검사(`packages/core/apps/releases/sdk-permissions.ts`)와 앱 process의 Deno flag(`packages/core/apps/permissions/flags.ts`)가 있다.
  - net: broker의 `net/fetch`(`packages/core/apps/permissions/broker/net-fetch.ts`)가 요청마다 선언과 grant의 host·port를 검사한다. 그런데 그 broker가 도는 앱 supervisor process의 network 허락은 core port, `lophn.invalid`, 앱 socket뿐이다(`packages/core/apps/control.ts`의 `allow_net`). host 없는 `--allow-net`(`net_any`)은 agent runtime만 쓸 수 있다(`packages/core/supervision/security/launch-spec.ts`). 그래서 기계 밖으로 나가지 못한다. broker는 https만 보낸다.
  - secret: broker의 `secrets/use`(`packages/core/apps/permissions/broker/secrets.ts`)가 있다. 그러나 supervisor 조립(`packages/core/main/app-supervisor/assembly.ts`)이 전달 adapter를 꽂지 않아, 늘 닫힌 기본값(`packages/core/main/app-supervisor/broker.ts`의 `closedSecretDelivery`)으로 `unavailable`이다.
- 앱 process에는 외부 net flag가 없다(`net-fetch.ts` 머리 주석). 그래서 `@lophn/cap-net`이 외부 HTTP의 유일한 길이다.
- blueprint가 셋 중 하나를 의존하면 release 준비가 `sdk_not_installed`로 거절한다(`packages/core/apps/releases/bundle/lock.ts`).
- coding agent skill과 앱 template은 이 셋을 말하지 않는다.

영향: 외부 API를 부르는 앱(일정 동기화, 날씨), secret을 쓰는 앱, 사람이 허락한 경로의 file을 읽고 쓰는 앱을 만들 수 없다. 사람이 그런 앱을 청하면 coding agent는 release 준비에서 막힌다.

고치려면:
- fs(작음): `deno.json`(판 1.0.0)을 둔다.
- net(중간): `deno.json`에 더해, 앱 supervisor가 밖으로 나갈 수 있게 한다. 길은 둘이다.
  - supervisor에 host 없는 net을 준다. 목적지 검사는 지금처럼 broker가 요청마다 한다. 앱 process에는 여전히 net이 없다. 작음.
  - supervisor의 `allow_net`을 grant된 host 목록으로 두고, grant가 바뀌면 supervisor를 다시 띄운다. OS 수준 경계가 남는다. 대신 grant가 바뀔 때마다 모든 앱이 다시 뜬다. 중간.
- secret(중간): `deno.json`에 더해, supervisor 조립이 secret 전달 adapter를 꽂는다. net이 먼저다.
- 확인: 앱 E2E 한 행(loopback 목적지). broker가 https만 보내므로, loopback 목적지에는 http를 허락해야 행을 둘 수 있다.
- 지운다(중간): SDK 셋, broker의 net·secret 통로, 권한 종류(`net.fetch`, `secret.use`, `fs.read`, `fs.write`)를 지운다. 앱은 외부 I/O를 못 하는 것으로 정한다.

정한 것: 살린다(사람). 이 결정은 "core 쪽이 다 있다"는 앞의 잘못된 설명을 보고 내렸다. net과 secret은 위처럼 일이 더 든다. 그래서 다음 셋을 다시 묻는다.

정할 것:
- supervisor network를 여는 길(host 없는 net / grant 목록과 다시 띄우기).
- secret 전달을 이번에 같이 할지.
- loopback 목적지에 http를 허락할지.
