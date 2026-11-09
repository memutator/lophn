# vault-core

login metadata store(`<data>/logins.json`)와 login route를 만든다. 값은 `secrets.json`의 `login.<id>.password|totp`다. agent가 보는 `lophn login list`를 더한다.

- 단위: vault (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/secrets/`
  - `packages/core/secrets/`
  - `packages/core/main/daemon/wiring/secrets.ts`
  - `packages/cli/commands/login.ts`(새 file)
  - `packages/cli/commands/mod.ts`
  - `project-docs/flows/areas/{core-platform,cli}.yaml`, `project-docs/flows/tests/core-rest.yaml`
  - `project-docs/module-catalog.yaml`, `project-docs/boundary-catalog.yaml`(필요하면)
- 읽을 것:
  - 계획 README "정한 것 › login 저장과 채우기"
  - architecture: `project-docs/architecture/agent-definition.md` secret 저장소 절, `project-docs/architecture/app-call.md`의 `apps.secret_value`(machine 자격만 부르는 값 route의 본보기), `project-docs/architecture/approval.md`의 shell capability
- 계약:
  - 쓰는 것: `secrets.json` store(`file-store.ts`, `secret-store.ts`), known-value 등록(`openSecretStore`의 sync)
  - 내놓는 것(뒤 task가 쓴다):
    - `logins/list` 입력 `{origin?}` 결과 `[{id, label, origin, username, note, totp: boolean}]`. actor user, agent.
    - `logins/save` 입력 `{id?, label, origin, username, note?}` 결과 `{id}`. actor user. id가 없으면 새 `lgn_` id. origin은 `URL(origin).origin`과 같아야 한다(`invalid_input`).
    - `logins/delete` 입력 `{id}`. actor user. metadata와 `login.<id>.password`, `login.<id>.totp`를 같이 지운다.
    - `logins/release` 입력 `{id, field: "password" | "totp", origin}` 결과 `{value}`(totp면 지금 6자리 code). shell capability로만 부른다. origin이 저장된 origin과 정확히 같지 않으면 `forbidden`. 값이 없으면 `not_found`.
    - 값은 기존 `secrets/put`(보호 입력 창)으로 이름 `login.<id>.password|totp`에 넣는다. `purposeOf`(`file-attach.ts`)에 `login.`을 더해 https 목적지로는 절대 나가지 않게 한다.

## 할 일

1. protocol에 위 route schema를 둔다. `secretNameSchema`가 `login.<id>.password` 꼴을 받는지 확인한다.
2. `logins.json` store를 만든다. `file-store.ts`와 같은 0600·atomic write다. 파일이 없으면 빈 목록이다.
3. release의 자격 검사: shell capability(`connect {client: shell}`로 등록되는 것)를 지금 어떻게 확인하는지 `packages/core/server/identity/`에서 찾아 같은 길을 쓴다. 없으면 가장 단순한 길을 정해 보고에 적는다.
4. TOTP code: RFC 6238(SHA1, 6자리, 30초)이다. seed는 base32나 `otpauth://` URI로 받는다. 시각은 `Clock` 인자로 받는다.
5. `lophn login list [--origin <url>]` 명령을 둔다. 값이 없으니 untrusted로 감싸지 않는다.
6. flows를 고친다(`flows` skill).

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "origin이 다르면 release가 값을 내주지 않는다"
  - "shell capability가 아닌 자격(user token, agent credential)은 release를 부르지 못한다"
  - "`logins/list`는 값을 싣지 않는다"
  - "login을 지우면 두 secret 이름도 지워진다"

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴.
