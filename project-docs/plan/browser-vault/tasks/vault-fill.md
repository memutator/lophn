# vault-fill

agent가 `lophn browser act`의 새 행동 `fill_login`으로 login 값을 탭에 치게 한다. shell main이 ref 요소가 든 frame의 origin을 재고, `logins/release`로 값을 받아 친다. snapshot은 password 칸의 value를 가리고, browser 결과는 known-value redaction을 거친다.

- 단위: vault (wave 2)
- 선행: vault-core.
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/host-queue.ts`
  - `packages/shell/main/browser/agent/`
  - `packages/cli/commands/browser.ts`, `packages/cli/commands/browser_test.ts`
  - `packages/core/host-queue/`
  - `packages/core/main/daemon/wiring/host-queue.ts`
  - agent가 `lophn browser`를 배우는 내장 안내(skill·prompt). 위치는 찾아서 보고한다. `packages/core/agent-workspaces/prompts/*.md`는 `gmem` 소유라 고치지 않는다. 고쳐야 하면 넘길 줄로 적는다.
  - `project-docs/flows/areas/{cli,harness}.yaml`, `project-docs/flows/tests/{shell,core-rest}.yaml`
- 읽을 것:
  - 계획 README "정한 것 › login 저장과 채우기"
  - architecture: `project-docs/architecture/browser-tab.md` "agent가 다루는 browser 탭"
  - `tasks/vault-core.md` 계약
- 계약:
  - 쓰는 것: `logins/list`, `logins/release`(vault-core)
  - 내놓는 것:
    - `browserActSchema`에 `{type: "fill_login", ref, login, field: "username" | "password" | "totp"}`
    - CLI `lophn browser act <tab> fill-login --ref eN --login <id> --field <field>`

## 할 일

1. core: `browser_call`을 queue에 넣기 전에 login id가 있는지 확인한다. 없으면 `not_found`. queue·ledger에는 id만 싣고 값은 싣지 않는다.
2. `username`은 비밀이 아니다. 지금 `fill`과 같이 친다(core가 metadata에서 넣는다).
3. shell main driver:
   - `password`·`totp`면 ref node의 frame origin을 CDP로 잰다(최상위 URL이 아니다). 그 origin으로 `logins/release`를 shell capability 자격으로 부른다.
   - 받은 값을 지금 `typeText` 길(`fill`과 같이 다 지우고 친다)로 친다.
   - 치는 동안 그 frame이 이동하면 멈추고 `conflict`를 낸다.
   - 결과는 `filled`만 낸다. 값은 어떤 log·오류·결과에도 싣지 않는다.
   - 사람이 탭을 가져간 동안은 지금 `act`처럼 `conflict`다.
4. `snapshot.ts`: `type=password` 입력 칸은 `value`를 찍지 않는다(`value="••••"`, 비었으면 생략). Chromium AX가 가리는지 기대지 않는다.
5. browser 결과(snapshot, act, evaluate, logs, wait, read)가 caller(lophn agent, CLI)에 가기 전에 core의 known-value redaction을 거치는지 확인한다. 안 거치는 길이 있으면 더한다. 알려진 값을 아직 다 모르는 동안은 지금 규칙(빈 결과나 `unavailable`)을 따른다.
6. 안내: 로그인 칸을 만나면 `lophn login list --origin`으로 보고 `fill-login`을 쓴다. 비밀번호를 `type`/`fill`로 치지 않는다. 후보가 여럿이면 memory의 선택을 보고, 없으면 사람에게 묻는다.
7. flows를 고친다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - "`fill_login`의 queue 항목과 결과에 값이 없다"
  - "snapshot이 password 칸 value를 찍지 않는다"(driver_test 수준)

## 보고

`.claude/skills/orchestrate/brief-template.md` "보고" 꼴.
