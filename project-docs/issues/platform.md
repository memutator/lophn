# platform

config, diagnostics, storage, server, supervision 같은 바닥 module. 이 주제의 architecture 문서는 없다.

## Diagnostics 점검이 core·ledger 둘뿐이다

```yaml
kind: bug
modules: [packages/core/diagnostics, packages/core/main]
```

지금: `diagnostics/components.ts` `createComponentChecks`가 core와 ledger만 짓는다. `ctx.componentChecks`(`wiring/context.ts`)에 더하는 곳은 `wiring/diagnostics.ts` 하나뿐이고, events·앱·sandbox·agent runtime의 wiring은 아무것도 더하지 않는다(`componentChecks.push`를 쓰는 다른 파일이 없다).

영향: `diagnostics.status`가 나머지 component를 점검하지 않아 events, 앱 supervisor, agent runtime이 죽어도 status는 정상으로 보일 수 있다.

고치려면: 각 owner wiring(`events.ts`, `apps.ts`, `supervision.ts`, `lophn-agent-runtime.ts`)이 `ctx.componentChecks.push`로 자기 점검을 더한다. component마다 작음. 점검이 무엇을 보는지(살아 있음, 마지막 응답 시각) 정하는 쪽이 일이다. 추천.

정한 것: events와 agent runtime 점검만 더한다.

## 화면이 둘 이상인 앱의 합친 `app.js.map`에 `mappings`가 없다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/problems]
```

지금: `core/apps/releases/ui-build/build.ts`가 화면별 source map을 `app.js.map` 하나로 합칠 때, 화면이 둘 이상이면 `mappings`를 담지 않는다. `core/problems/snapshots/work.ts`는 앱 오류 stack을 앱 source 위치로 풀 때 이 `mappings`를 읽는다. annotation의 source 위치 잇기를 지운 뒤(`annotation-target`) 이 map을 읽는 곳은 problems뿐이다.

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
