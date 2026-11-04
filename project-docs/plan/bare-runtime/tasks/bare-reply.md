# bare-reply

bare session이 `result` call을 받은 turn이 끝나면 마지막 응답 글이 그 call의 답이 된다.

- 단위: bare (wave 3)
- 선행: bare-assembly.
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/`의 새 wiring file 하나와 `packages/core/main/daemon/assembly.ts`(등록)
  - `packages/core/router/{commands,router}.ts`(machine reply 입구가 필요하면)
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`(result, reply, `receiver_ended`), `project-docs/architecture/run.md`
  - 선례: `packages/core/main/daemon/wiring/runs.ts`의 `answer()`(turn의 마지막 agent 메시지를 읽는다)
  - 제품 결정: 계획 README 정한 것 6
- 계약:
  - 쓰는 것: `TurnEnded` event, `router.reply`(`router.ts` l.293)
  - 내놓는 것: 없음

## 할 일

1. 새 wiring이 `TurnEnded`를 본다. 그 session의 agent가 bare이고, turn이 `answer_completed`이고, 그 turn의 입력이 아직 `accepted`인 `result` call이면 마지막 응답 글로 reply한다. 답의 unattended 표시는 그 turn을 따른다.
2. 글이 비었거나 turn이 멈추거나 실패하면 reply하지 않는다(지금 규칙대로 `receiver_ended`로 실패).
3. runtime 쪽(`FinishTurn` 전)에서 하지 않는다. 멈춘 turn에 답을 보낼 수 있다. tx 안에서도 하지 않는다(body blob을 tx에서 만들 수 없다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test(module 수준, router와 fake port):
  - "bare가 `result` call을 받은 turn이 끝나면 call이 `done`이고 보낸 쪽이 마지막 응답 글을 한 번 받는다"
  - "같은 turn을 lophn runtime이 끝내면 자동 답이 없다"
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 새 subprocess·server test가 필요하면 만들지 말고 적는다.
