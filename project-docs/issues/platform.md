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
