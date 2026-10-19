# rp-attached-remove

아무도 만들지 않는 `attached` 기구를 지운다.

- 단위: core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/inputs.ts`
  - `packages/protocol/lophn-agent/message-content.ts`
  - `packages/protocol/lophn-agent/input-tags.ts`
  - `packages/core/lophn-agent/run-loop/input-text.ts`
  - `packages/core/lophn-agent/session/message-commands.ts`
  - `packages/core/agent-roles/roles/prompts.ts`
  - `packages/core/main/daemon/wiring/router.ts`
  - `packages/shell/renderer/conversation/`
  - `tests/e2e/`
  - `tests/support/`
- 읽을 것:
  - 이슈: `project-docs/issues/agent-definition.md`의 "붙인 것(`attached`) 기구가 file 종류만 남았고 아무도 만들지 않는다"(정한 것: 지운다)
  - architecture: `project-docs/architecture/agent-definition.md`

## 할 일

1. `SendMessage.attached`(`attachedChipSchema`), 본문 part `attached`, 입력 태그 `<lophn-attached>`(`ATTACHED_KINDS`, `attachedText`)와 role 공통 지침의 그 설명 줄, shell의 `attached` part 그리기를 지운다.
2. 부르는 쪽의 `attached: []`(router wiring, shell, e2e, test support)를 지운다. 이름이 같은 다른 뜻의 `attached`(log buffer 등)는 건드리지 않는다.
3. 지침 snapshot이나 test가 있으면 맞춘다.

## 끝남

- `deno task check:full`이 통과한다.
- 고친 e2e file마다 `deno task e2e:deps` 뒤 한 번 통과한다.
- 남지 않음: `grep -rn "attachedChip\|lophn-attached\|ATTACHED_KINDS\|attachedText" packages tests tools`가 0줄이다.
- 위험 test: 없음.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴대로(바꾼 file, 통과한 check, 정한 것, 넘길 줄, 계약 바꾸기 요청, 무겁게 짠 것, 알려진 미완 동작).
