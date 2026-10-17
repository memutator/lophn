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

## crash 기록의 기한 timer가 둘이고 redactor fallback이 있다

```yaml
kind: defect
modules: [packages/core/diagnostics, packages/core/main]
```

지금: `main/daemon/wiring/diagnostics.ts`의 `diagnosticsWrite`가 응답을 2초 기다리는 timer를 두고(pending 표가 새지 않게), `diagnostics/crash.ts`의 `installCrashHandler`도 쓰기를 2초 기다리는 timer를 둔다. daemon의 crash handler는 `createProductRedactor(ctx.peek.knownSecrets)`를 쓰고, known secret이 아직 없으면 pattern만 쓰는 redactor로 한 번 더 감싼다. `diagnosticsWiring`은 `uninstallCrash` 닫힘 때문에 객체 literal에서 factory 본문으로 바뀌었다.

영향: 같은 일을 하는 기한이 두 곳에 있어 한쪽만 고치면 어긋난다. fallback은 기동 초반 crash에만 쓰인다.

고치려면:
- timer를 `installCrashHandler` 하나로 줄이고 `diagnosticsWrite`는 응답이 없으면 pending을 닫힐 때 비운다(작음).
- 그대로 둔다(둘 다 짧다).

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
