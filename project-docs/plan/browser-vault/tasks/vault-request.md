# vault-request

agent가 탭의 입력 칸(ref)을 가리켜 사람에게 login 저장이나 한 번 넣기를 요청한다. 요청은 대화에 card로 뜨고, 사람이 눌러야 보호 입력 창이 열린다. 값은 model에 가지 않는다.

- 단위: vault (wave 3)
- 선행: vault-fill, vault-ui.
- 소유(이 task만 고친다):
  - 새 요청의 protocol·core(`ask` 대기열 옆 또는 위. `packages/core/lophn-agent/tools/questions/`, `packages/protocol/lophn-agent/`의 새 file)
  - `packages/shell/renderer/conversation/`의 새 card
  - `packages/shell/renderer/secret-input/`, `packages/shell/ipc/secret-input.ts`, `packages/shell/main/secret-input/`
  - `packages/shell/main/browser/agent/`(한 번 넣기)
  - `packages/cli/commands/login.ts`
  - `project-docs/flows/`
- 읽을 것:
  - 계획 README "정한 것 › agent의 입력 요청"
  - architecture: `project-docs/architecture/browser-tab.md`, `project-docs/architecture/agent-chat.md`(redaction), `ask` 흐름(`packages/core/lophn-agent/tools/questions/wait.ts`, `packages/protocol/lophn-agent/ask-tool.ts`)
  - `tasks/vault-core.md`, `tasks/vault-fill.md`, `tasks/vault-ui.md` 계약
- 계약:
  - 쓰는 것: `logins/save`, `secrets/put`, `fill_login`, 보호 창 purpose `login`
  - 내놓는 것: CLI `lophn login request <tab> --ref eN --mode save|once [--label <글>]`. 결과는 `{login: id}`(save), `{filled: true}`(once), `cancelled`, `unattended`.

## 할 일

1. 요청은 session당 하나다. 지금 `ask`의 "session당 사람에게 보이는 질문 하나" 대기열을 쓰거나 같은 규칙을 따른다. 사람이 없으면(unattended) 바로 `unattended`다.
2. card에는 agent 이름, 탭, origin을 보인다. origin은 shell main이 그 ref의 frame에서 잰 값이다(agent 입력이 아니다). [Enter] 누르면 보호 창, [Cancel]이 있다.
3. save:
   - 창에 label(agent의 `--label`을 기본값), username, password, 선택 TOTP를 받는다.
   - `logins/save`와 `secrets/put`으로 넣는다. origin은 잰 값이다.
   - agent는 login id를 받고, 이어서 `fill-login`을 직접 부른다.
4. once:
   - 창은 값 하나를 받는다.
   - shell main이 그 ref에 바로 친다. 그 전에 frame origin이 card에 보인 것과 같은지 다시 본다.
   - 값을 저장하지 않는다. 그 session이 끝날 때까지 known-value로 등록해 snapshot·결과에서 지운다.
   - agent는 `filled`만 받는다.
5. 창 하나의 입력 칸이 여럿이 된다(save). 기존 purpose의 단일 칸 모양은 그대로 둔다.
6. flows를 고친다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "once 값이 secrets·ledger·결과에 남지 않는다"
  - "card의 origin과 칠 때 frame origin이 다르면 치지 않는다"

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴.
