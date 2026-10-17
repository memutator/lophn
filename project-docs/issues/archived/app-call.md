# app-call (닫음)

## 앱 rewind가 안 된다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/lophn-agent, packages/core/main]
closed: fixed
guard: 없음
```

지금: session rewind는 파일과 대화만 되돌린다. 앱 데이터 되돌리기 요청은 wiring(`ctx.peek.appRewind`)이 비어 늘 `unavailable`로 rejected가 남는다.

영향: 앱 데이터는 rewind로 되돌릴 수 없다.

고치려면: 앱 rewind 계약을 짓고 wiring을 채운다.

닫음: `core/main/daemon/wiring/apps.ts`가 `createAppRewind`로 만든 값을 `ctx.provide("appRewind", rewind)`로 내놓고, `wiring/lophn-agent-session.ts`의 `requestRewind`가 `ctx.peek.appRewind.apply(app, from, "user")`를 부른다. 앱 module 쪽 계약(`apps/rewind`, `appRewind` route)도 등록돼 있다. 연결 자체를 보는 test는 없다(`apps/rewind/rewind_test.ts`는 앱 rewind, `lophn-agent/session/rewind/rewind_test.ts`는 가짜 `requestRewind`).

## 앱 rewind 요청(`rewind_apps` 표)이 wiring 없이 늘 rejected다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
closed: fixed
guard: 없음
```

지금: 앱 rewind 요청(`rewind_apps` 표, background, accepted/applied/rejected)을 두었는데 지금은 wiring이 없어 늘 rejected.

영향: 쓰이지 않는 표와 흐름이다.

고치려면: MVP는 앱 rewind를 빼고 파일·대화만 되돌린다(`apps` 입력과 표를 지움).

닫음: 지우지 않고 wiring을 채웠다(위 "앱 rewind가 안 된다"). `lophn-agent/session/rewind/commands.ts` `handleApps`가 `rewind_apps`에 앱별 결과(accepted에서 applied/rejected)를 기록한다.
