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

## ChatGPT로 로그인한 provider가 그 계정이 못 쓰는 model도 고르게 둔다

```yaml
kind: bug
modules: [packages/core/lophn-agent]
```

지금: model 선택은 catalog에서 provider 정의 key(`openai`)가 같은 model을 모두 보인다(`models/resolve.ts`가 `provider_definition`과 model 이름으로 찾는다). ChatGPT 구독 token(Sign in with ChatGPT)은 계정마다 쓸 수 있는 model이 다르고, OpenAI 문서는 같은 Bearer로 `GET /v1/models`를 불러 `visibility == "list"`인 것만 보이라고 한다. lophn은 그 목록을 읽지 않는다.

영향: ChatGPT로 연결한 사람이 계정이 못 쓰는 model(예: API 전용 `-pro` 변형)을 고를 수 있고, 고르면 turn이 provider 거절로 실패한다.

고치려면:
- 연결 뒤와 갱신 때 runtime이 `GET /v1/models`를 읽어 그 provider의 model block이나 고를 수 있는 목록으로 둔다(중간).
- 추천: 위 안이다. 계정마다 다른 목록을 화면이 모르면 사람은 고른 뒤 실패해서야 안다.

## stack 없는 앱 crash가 crash마다 새 문제와 새 App Engineer session을 연다

```yaml
kind: bug
modules: [packages/core/problems]
```

지금: `packages/core/problems/snapshots/work.ts`의 `observedErrorGroupKey`는 앱 frame 위치를 못 풀면 그 발생의 report id를 묶는 key로 쓴다. 앱 process 종료 관측(`packages/core/apps/runtime/observations/crash.ts`, `process_exit`)은 error·stack이 없어 늘 이 경우라, 같은 앱이 같은 release에서 같은 이유로 거듭 죽어도 묶이지 않는다. `ProblemOpened`마다 reaction이 App Engineer에게 `new_session`으로 가므로(`packages/core/events/reactor/session-opening.ts`) crash마다 session도 하나씩 열린다. view 오류(`observeViewErrorPayload`)도 같은 길이다. `tests/e2e/reaction-app_test.ts`를 만들며 찾았다.

영향: crash loop 앱 하나가 10분 창에서 재시작이 멈출 때까지(`restart-policy.ts`의 `CRASH_LIMIT` 5) 문제 여섯과 App Engineer session 여섯을 열고, `AppRestartHalted`로 하나 더 연다. session마다 model 호출 비용이 든다. 사람의 문제 목록도 같은 crash로 찬다.

고치려면:
- (추천) stack 없는 관측은 관측 종류와 앱·release(`process_exit`이면 exit code나 signal까지)로 key를 만든다. `observedErrorGroupKey` 한 곳이다. 같은 문제의 다음 발생은 새 문제를 열지 않아 reaction도 없다.
- 지금대로 두고 재시작 한도에 기댄다. 비용이 crash 수만큼 든다.

정할 것: stack 없는 앱 crash를 무엇으로 묶을지(앱+release / 앱+release+exit code·signal).
