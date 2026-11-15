# mobile-push-send

Expo Push로 글을 보내는 sender(ticket과 receipt 처리, 죽은 token 알리기), 그 endpoint를 정하는 locked 설정 `remote.push`, 개발과 test가 쓰는 fake push server를 짓는다. 실제 Expo endpoint를 개발과 test에서 부르지 않게 하는 것이 이 task의 경계다. 보내는 글을 만들고 누구에게 보낼지 정하는 것은 `mobile-attention-core`이고, 이 task는 만들어진 글을 나른다.

- 단위: mobile-push (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/attention/push`(새 폴더 전체. 같은 폴더 위의 `*.ts`는 `mobile-attention-core`의 것이다)
  - `packages/core/config/shell-settings.ts`
  - `packages/core/config/shell-settings_test.ts`
  - `tests/support/fake-push`(새 폴더)
  - `tests/support/core/mod.ts`
  - `tools/dev.ts`
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/push-survey.md`의 2.2(sender), 3.6~3.7, 8(Expo 사실)
  - 설정 본보기: `shell-settings.ts`의 `remoteRelaySetting`(locked, 빈 값은 끔, 목록 `shellSettings` 끝 근처에 등록)
  - fake 본보기: `tests/support/fake-server/mod.ts`(`createFakeHandler`, `handle`, journal), `tests/support/fake-oauth/mod.ts`, 그것을 띄우는 `tools/dev.ts`의 `startDevFake`와 `plantFakeProvider`(`settings.json`에 key를 더하는 길)
  - Timers: `packages/core/runs/ports.ts`의 `Timers`·`systemTimers`
- 계약:
  - 쓰는 것: `packages/base`의 `Clock`, `Result`, `packages/core/server/serve.ts`의 `serve`(fake server가 쓴다)
  - 내놓는 것:
    - 설정 `remote.push`: locked, 값은 `""`(push 끔) 또는 http(s) URL. 기본은 `https://exp.host/--/api/v2/push/send`. 설명(description)에 "Expo가 아닌 곳을 가리키면 글(제목과 상태 문장)이 그곳에 간다"를 쓴다. 영수증 URL은 같은 주소에서 끝의 `/send`를 `/getReceipts`로 바꿔 만든다.
    - `packages/core/attention/push/mod.ts`의 `createExpoPushSender(deps): { send(message): Promise<"sent" | "dropped">; close(): void }`. `deps`는 `{ fetch, url: () => string, timers: Timers, onDeadToken(token: string): void }`(`fetch`는 `typeof fetch`로 받는다. 시각이 필요하면 `Clock`도 받는다. 전역 `fetch`를 직접 부르지 않는다). `message` 모양은 `mobile-attention-core`와 같다(둘이 맞는지는 `mobile-push-device`가 잇다가 확인한다). 이 task의 `packages/core/attention/push/types.ts`에 그대로 적는다:
      ```ts
      export type PushMessage = { to: string; title: string; body?: string; data: { host: string; kind: "session" | "app" | "inbox"; session?: string; app?: string }; channelId: "needs-you" | "finished" | "apps"; priority: "high" | "default"; ttl: number };
      ```
    - `tests/support/fake-push/mod.ts`의 `createFakePushHandler(options?)`: `handle(request): Promise<Response>`(`fake-server`와 같은 꼴, socket 없이 직접 부를 수 있다), `journal`(받은 `send` 요청 본문 전체), `failNext(...)`처럼 다음 응답을 정하는 최소 장치(ticket error `DeviceNotRegistered`, HTTP 429·500), `/--/api/v2/push/send`와 `/--/api/v2/push/getReceipts` 둘을 말한다. 그리고 `startFakePush({ port })`가 `serve`로 띄워 `{ url, close }`를 준다.

## 할 일

1. 설정 `remote.push`를 `shell-settings.ts`에 `remoteRelaySetting` 옆에 선언하고 `shellSettings` 목록에 올린다. `shell-settings_test.ts`가 설정 수나 목록을 세면 맞춘다.
2. sender: `send`는 `url()`이 `""`이면 `fetch`를 부르지 않고 `"dropped"`를 돌려준다. 아니면 한 글을 `POST`(`content-type`, `accept: application/json`, 본문은 글 하나)하고 응답의 ticket을 읽는다. `ok`면 ticket id를 메모리 목록에 `{ id, token }`으로 쥐고 `"sent"`. ticket error `DeviceNotRegistered`면 `onDeadToken(token)`을 부르고 `"dropped"`. 다른 error(`MessageTooBig` 등)는 `"dropped"`. 네트워크 오류와 HTTP 429·5xx는 backoff(1초, 2초, 4초, 세 번까지)로 다시 시도하고 그래도 안 되면 `"dropped"`(큐를 두지 않는다. Inbox가 기록이다). `send`는 던지지 않는다.
3. receipt: 보낸 ticket id는 약 15분 뒤(`timers.set`) 한 번에 모아(최대 1000) 영수증 URL로 `POST {ids}`해서 `DeviceNotRegistered`가 있으면 그 id의 token으로 `onDeadToken`을 부른다. 결과를 확인한 id는 목록에서 뺀다. 영수증 확인이 실패하면 버린다(다시 하지 않는다). `close()`는 timer를 지운다.
4. fake push server를 `tests/support/fake-push/`에 짓는다(위 계약). ticket id는 순서대로, 영수증은 기본 `ok`이고 `DeviceNotRegistered`로 만들 token을 장치로 정할 수 있다. journal은 core가 보낸 본문을 그대로 둔다(글이 맞는지 보는 쪽이 읽는다).
5. `tests/support/core/mod.ts`: `writeSettings`의 기본 `body`에 `"remote.push": ""`를 더해(`...settings`가 덮을 수 있게 앞에) test의 core가 실제 Expo를 부르지 않게 한다.
6. `tools/dev.ts`: `npm run dev`와 `npm run dev:core`(`dev:mock` 제외)가 fake push server를 고정 port(기본 7498, `LOPHN_DEV_PUSH_PORT`)로 띄우고, `plantFakeProvider`처럼 core를 띄우기 전에 `settings.json`에 `remote.push`를 그 주소(`http://127.0.0.1:<port>/--/api/v2/push/send`)로 적는다(이미 값이 있으면 덮는다. 개발 core가 실제 Expo를 가리키면 안 된다). `LOPHN_LIVE_PROVIDER=1`이어도 fake push는 띄운다. 받은 글마다 stdout에 한 줄(제목, 본문, `data`)을 찍는다. 끝날 때 닫는다(`closers`).

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`packages/core/attention/push/mod_test.ts`, 메모리 fake로 in-process):
  - "`remote.push`가 비어 있으면 `fetch`를 한 번도 부르지 않는다"
  - "`DeviceNotRegistered`는 ticket 단계와 receipt 단계 모두 그 token으로 `onDeadToken`을 부르고, 네트워크 실패와 500은 던지지 않고 `dropped`를 낸다"
- subprocess를 띄우는 test와 E2E는 만들지 않는다. dev 확인은 `npm run dev:core`를 한 번 띄워 fake가 뜨고 `.dev-data/settings.json`의 `remote.push`가 그 주소인지 보는 것으로 한다(끝나면 그 process를 직접 정리한다. 사람의 `~/.lophn`을 쓰지 않는다).
- 남지 않음: 없음(지우는 것이 없다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `createExpoPushSender`의 `deps`와 쓰는 법(`mobile-push-device`가 잇는다), fake push server의 장치 목록, dev에서 확인한 것, lead가 고칠 목록(`flows`의 설정 항목과 test file, `architecture/platform.md`의 설정 표가 `remote.relay`를 적은 곳).
