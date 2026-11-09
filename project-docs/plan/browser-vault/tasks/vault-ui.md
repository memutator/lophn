# vault-ui

사람이 Settings › Browser에서 login을 보고, 만들고, 고치고, 지운다. password와 TOTP seed는 보호 입력 창(purpose `login`)으로 넣는다.

- 단위: vault (wave 2)
- 선행: vault-core.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/browser/`
  - `packages/shell/renderer/secret-input/`
  - `packages/shell/ipc/secret-input.ts`
  - `packages/shell/main/secret-input/`
  - `packages/design/i18n/catalog/data.ts`, Settings browser 문구 catalog
  - `tools/wireframes/pages/screens/`의 Settings browser 화면(있으면)
  - `project-docs/flows/areas/{shell-desktop,ipc}.yaml`
- 읽을 것:
  - 계획 README "정한 것 › login 저장과 채우기"
  - architecture: `project-docs/architecture/browser-tab.md`(Settings Browser pane), `project-docs/architecture/app-call.md`(Access 탭의 secret 넣기 흐름)
  - skill: `ui-design`(화면 모양을 바꿀 때)
  - `tasks/vault-core.md` 계약
- 계약:
  - 쓰는 것: `logins/list|save|delete`, `secrets/put`, `secrets/status`
  - 내놓는 것: secret-input open 입력의 `purpose`에 `"login"`. subject에 origin을 싣고 창이 origin을 눈에 띄게 보인다. `vault-request`가 같은 창을 쓴다.

## 할 일

1. Settings › Browser에 Logins 구역을 둔다.
   - 목록 줄: label, origin, username, password 있음, TOTP 있음.
   - [Add]: label, origin, username, note 칸 → `logins/save`.
   - 줄마다 [Set password], [Set TOTP] → 보호 창(`login.<id>.password|totp`). [Edit], [Delete](확인 뒤 `logins/delete`).
2. 보호 입력 창: purpose `login`을 더한다.
   - 제목 "Enter site password" 또는 "Enter TOTP key".
   - origin 줄을 크게 보인다.
   - 값 칸 하나는 지금 그대로다.
3. 문구는 catalog에 둔다(en).
4. flows를 고친다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(화면).

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴.
