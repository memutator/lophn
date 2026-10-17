# call-history-tag

다른 agent·program이 보낸 입력(call, reply, reaction, 알림)은 받은 turn에서만 태그(`<lophn-call ...>` 등)에 싸이고 다음 turn의 history에서는 원문이 된다. history도 입력과 같은 규칙으로 싼다.

- 단위: call-history-tag (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/session/history.ts`
  - `packages/core/lophn-agent/run-loop/input-text.ts`
  - 위 file의 `*_test.ts`(없으면 새 file 하나)
- 읽을 것:
  - 이슈: `project-docs/issues/agent-call.md`의 "가져간 call 글이 뒤 turn의 history에서 태그 없이 원문으로 들어간다"
  - architecture: `project-docs/architecture/agent-call.md`(입력함 순서와 history), `project-docs/architecture/agent-definition.md`("같은 재료는 같은 bytes다": history는 cache prefix라 싸는 결과가 turn마다 같아야 한다)
  - 코드: `input-text.ts`의 `wrap`(입력 출처마다 태그와 escape), `history.ts`의 `readSessionConversation`(message의 `from_kind`와 본문), history를 쓰는 곳(compact `session/compact.ts`·`compactor.ts`, fork `session/fork.ts`, rewind 요약)
  - AGENTS.md "속도"(막는 것은 AI가 만든 글)
- 계약: 쓰는 것 없음(내부). 내놓는 것 없음.

## 할 일

1. `history.ts`가 사람 메시지가 아닌 입력의 본문을 `input-text.ts`의 같은 함수로 싸서 history에 넣는다. 받은 turn의 입력과 뒤 turn의 history가 같은 bytes가 되게 한다(같은 함수, 같은 인자). 필요하면 `wrap`을 export하거나 입력 하나를 싸는 함수로 나눈다.
2. 사람 메시지는 지금처럼 싸지 않는다.
3. compact·fork·rewind 요약이 history를 쓰면 같이 바뀐다. 그 test가 깨지면 새 규칙으로 고친다.

## 끝남

- `deno task check:full`, core 기동 두 번이 통과한다.
- `tests/e2e/agent-call_test.ts`와 `tests/e2e/compact_test.ts` 한 번씩 통과.
- 위험 test(unit): "다른 agent가 보낸 call 본문은 받은 turn의 입력과 뒤 turn의 history에서 같은 태그로 싸인다"

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 고치기 전 실패: 위험 test가 고치기 전 코드에서 실패한 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
