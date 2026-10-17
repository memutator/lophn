# agent-call

agent 사이의 call(일 맡기기와 답하기)을 Router가 배달하는 길의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/agent-call.md`.

## 받은 turn의 입력과 뒤 turn의 history가 bytes로 다르다

```yaml
kind: defect
modules: [packages/core/lophn-agent]
```

지금: 받은 turn의 입력은 call의 답 방식(`reply`), reaction의 event type, 실패 답의 이유를 태그 속성에 싣는다(`packages/core/lophn-agent/run-loop/input-text.ts`). 뒤 turn의 history는 session 기록에 그 칸이 없어 `receivedText`가 속성을 비운다(`packages/core/lophn-agent/session/history.ts`). 태그와 escape는 같다.

영향: call·reaction을 받은 turn 다음 요청부터 그 메시지 자리의 prefix가 달라져 cache miss가 한 번 난다. 고치기 전(history가 원문)에도 같았다.

고치려면: 받은 turn의 입력도 history와 같은 속성만 싣는다(작음. 답 방식은 call tool 결과나 본문 한 줄로 알린다). 또는 messages 행에 답 방식과 event type을 저장한다(중간, schema 변경). 추천: 앞의 것.
