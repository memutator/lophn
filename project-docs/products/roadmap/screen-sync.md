# 화면 갱신: 앱 화면도 따라오게 한다

상태: **설계안.** lophn 화면의 갱신은 계획 `screen-sync`로 끝났다(2026-11-14, change-log `screen-sync`). 남은 것은 앱 화면(SDK) 단계다. 계획으로 열기 전에 사람이 정한다(아래 "사람이 정할 것").
배경 문서: `project-docs/architecture/event.md`(지키는 것 17·18·20, 결정의 `StateChanged`), `project-docs/architecture/app-call.md`, `project-docs/products/roadmap/{mobile,app-sdk}.md`.

## 지금

- core 상태를 바꾸는 route는 무엇을 바꾸는지 선언하고, core가 commit 뒤 `StateChanged {changes: [{name, id}]}` 하나를 낸다. lophn 화면은 `useCoreRead`로 읽어 맞는 변경과 다시 붙음에 다시 읽는다. polling은 없다.
- 앱 화면(SDK)에는 이 길이 없다. `useOperation`(`packages/sdk/app-ui/use-operation.ts`)은 호출 하나의 상태만 들고, 앱이 자기 write 뒤나 `useEvent` listener에서 operation을 다시 부른다.
- core는 앱 호출마다 `app_activity`(id 앱)를 낸다(invocation 기록의 시작·끝). 그 호출이 read인지 write인지도 안다.

## 무엇을 만드나

- 앱의 write 호출이 끝나면 core가 "그 앱의 data가 바뀌었다"를 낸다(이름 하나를 더하거나 `app_activity`를 effect로 거른다). 열린 앱 화면은 SDK `useOperation`이 읽기 operation을 다시 부른다. 폰과 desktop에 같은 앱이 열려 있을 때 한쪽에서 바꾸면 다른 쪽이 따라오고, 앱을 지은 agent가 따로 할 일이 없다.
- SDK와 앱 agent 지침이 바뀐다(`sdk-note`).

## 사람이 정할 것

1. **앱 화면에도 줄까.** 추천: 준다. 얻는 것: 같은 앱이 폰과 desktop에서 같이 갱신되고 앱마다 갱신 코드를 짓지 않는다. 잃는 것: SDK가 바뀌고, write마다 열린 화면이 읽기 operation을 다시 부른다. 주지 않으면 앱이 앱 event로 스스로 맞춰야 하는데, 앱은 자기가 낸 event를 받지 않는다(`architecture/event.md` 지키는 것 34). 이 규칙이 같은 앱의 화면에도 걸리는지는 계획에서 확인한다.

## 하지 않는 것

- event의 저장, 구독자 cursor, replay, 재시도.
- program이 event를 듣고 일하거나 agent session을 여는 것.
- disk를 따라가는 것(file tree, artifact folder, editor의 file stat, skill·workflow 정의 file).
- 바뀐 내용을 event로 실어 화면이 읽지 않고 고치게 하는 것.
