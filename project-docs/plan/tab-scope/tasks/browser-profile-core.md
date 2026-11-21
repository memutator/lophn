# browser-profile-core

core가 browser profile을 안다. profile 목록을 사람만 쓰는 설정으로 선언하고, agent 정의에 사람만 쓰는 칸 `browser_profile`을 더하고, agent가 `tab open --url`로 여는 탭에 그 profile을 실으며, 저장 login을 profile에 속하게 한다(`profile` 칸이 없는 login은 기본 profile의 것이라 기존 login은 옮기지 않아도 기본 profile에 선다). `lophn login list`, `fill-login`, `logins/release`, login 저장 요청은 그 탭의 profile에 든 login만 다룬다.

- 단위: browser-profile (wave 2)
- 선행: tab-owner-core, browser-profile-partitions. 탭 표의 `profile`과 `Page.profile`이 거기서 온다.
- 소유(이 task만 고친다):
  - `packages/core/config/shell-settings.ts`
  - `packages/protocol/lophn-agent/agent-values.ts`
  - `packages/protocol/lophn-agent/agent-definitions.ts`
  - `packages/core/lophn-agent/agents/definition-file.ts`
  - `packages/core/lophn-agent/agents/commands.ts`
  - `packages/core/lophn-agent/agents/commands_test.ts`
  - `packages/core/lophn-agent/agents/directory.ts`
  - `packages/core/lophn-agent/agents/reads.ts`
  - `packages/protocol/secrets/logins.ts`
  - `packages/core/secrets/logins.ts`
  - `packages/core/secrets/login-routes.ts`
  - `packages/core/secrets/login-routes_test.ts`
  - `packages/core/secrets/mod.ts`
  - `packages/core/main/daemon/wiring/secrets.ts`
  - `packages/core/main/daemon/wiring/browser-profile.ts`
  - `packages/core/host-queue/queue.ts`
  - `packages/core/main/daemon/wiring/host-queue.ts`
  - `packages/protocol/lophn-agent/input-request.ts`
  - `packages/core/main/daemon/wiring/input-request.ts`
  - `packages/cli/commands/login.ts`
  - `packages/shell/main/browser/agent/driver.ts`
  - `packages/shell/main/desktop/core/connection.ts`
  - `packages/shell/main/secret-input/request.ts`
  - `project-docs/flows/areas/models.yaml`
  - `project-docs/flows/areas/harness.yaml`
  - `project-docs/flows/areas/agents.yaml`
- 읽을 것:
  - 계획: `project-docs/plan/tab-scope/README.md`("agent 정의의 칸 이름은 `browser_profile`", "탭의 profile", "저장 login은 profile에 속한다", "profile을 지우면")
  - 제품 결정: `project-docs/products/roadmap/browser-profile.md`의 "다는 자리", "저장 login", "정한 것" 3·4·6
  - architecture: `project-docs/architecture/agent-definition.md`의 "agent 정의"(칸 목록, 사람만 쓰는 칸)와 지키는 것 18, `project-docs/architecture/browser-tab.md`의 "site login"(지키는 것 44~53)
  - 코드: `packages/core/lophn-agent/agents/commands.ts`(`HUMAN_ONLY_MESSAGE`, create·change의 사람만 쓰는 칸 검사), `definition-file.ts`(칸 순서), `directory.ts`(`AgentInfo`), `packages/core/secrets/login-routes.ts`, `packages/core/main/daemon/wiring/host-queue.ts`(`open`의 browser 갈래, `act`의 `fill_login`), `packages/core/main/daemon/wiring/input-request.ts`(login view를 짓는 곳), `packages/shell/main/browser/agent/driver.ts`(`fillLogin`), `packages/shell/main/secret-input/request.ts`(`saveLogin`), `packages/core/secrets/logins.ts`(store가 `logins.json`을 읽고 쓰는 곳)
- 계약:
  - 쓰는 것: `packages/protocol/shell/browser-profiles.ts`(`BROWSER_PROFILES_SETTING`, `browserProfilesSchema`. lead가 wave 1 전에 commit했다. core와 shell 코드만 import한다), profile id의 꼴 `idSchema("bpf")`(`packages/protocol/base/ids.ts`. `packages/protocol/lophn-agent/`와 `packages/protocol/secrets/`의 file은 이것만 쓰고 `protocol/shell/`을 import하지 않는다. `check-deps`의 protocol-cycle이 막는다), `HostQueue`의 `TabEntry.profile`과 `OpenInput.profile`(`tab-owner-core`), `Page.profile`(`browser-profile-partitions`).
  - 내놓는 것(이 task가 정확히 이 모양으로 고친다. wave 3의 `browser-profile-settings`가 기댄다):
    - 설정 `shell.browser_profiles`: `browserProfilesSchema`, 기본 `[]`, `locked: true`(agent가 바꾸지 못한다). `packages/core/config/shell-settings.ts`의 `shellSettings`에 든다.
    - agent 정의 칸 `browser_profile?: <bpf id>`(`agent-values.ts`의 입력·출력 칸 둘 다). 없으면 기본 profile이다. agent 자격의 `agent.create`는 이 칸이 있으면, `agent.change`는 지금 file의 값과 다르면 `forbidden`(`HUMAN_ONLY_MESSAGE`에 browser profile을 더한다). 목록 행 `agentRowSchema`에 `browser_profile: <bpf id> | null`(정의에 적힌 값 그대로. 지운 profile이면 화면이 표시한다).
    - login: route가 내는 `loginSchema`에 `profile: idSchema("bpf").nullable()`(null은 기본 profile). 저장 모양(`logins.json`의 항목)은 `profile?: <bpf id>`이고 칸이 없으면 기본 profile이다(탭 값의 `profile?`, 정의의 `browser_profile?`와 같은 규칙). `loginsList` 입력 `{ origin?, tab?: tab id }`, 출력 행에 `profile`. `loginsSave` 입력에 `profile?: <bpf id> | null`(새 login에만 쓴다. 없으면 기본. 있는 login을 고칠 때는 그 login의 profile을 그대로 둔다). `loginsRelease` 입력에 `profile: <bpf id> | null`(page의 profile).
    - input request login view(`input-request.ts`의 `loginViewSchema`)에 `profile: <bpf id> | null`(요청한 탭의 profile).
    - `HostQueue` port에 `tabProfile(tab, caller): Result<string | null>`(자기 browser 탭의 profile. 없는 탭·남의 탭은 지금 `browserTab`과 같은 `not_found`).

## 할 일

1. 설정 선언과 agent 정의 칸: 위 모양대로 `shell-settings.ts`, `agent-values.ts`, `definition-file.ts`(칸 순서에 `browser_profile`), `commands.ts`(사람만 쓰는 칸), `directory.ts`(`AgentInfo.browserProfile: string | null`), `reads.ts`(행의 `browser_profile`), `agent-definitions.ts`를 고친다. 내장 lophn의 정의 file도 이 칸을 쓸 수 있는지 `definition-file.ts`의 lophn 규칙을 보고, 막혀 있으면 다른 사람만 쓰는 칸(`skip`)과 같게 연다.
2. 정한 profile 풀기: 새 file `wiring/browser-profile.ts`에 `agentBrowserProfile(session): string | null`을 둔다. session row → agent의 `AgentInfo.browserProfile` → 그 id가 지금 설정 `shell.browser_profiles`에 있으면 그 id, 없거나 지운 profile이면 null(기본). host-queue와 secrets wiring이 같이 쓴다.
3. `tab open --url`: `wiring/host-queue.ts`의 browser 갈래가 agent면 `profile: agentBrowserProfile(caller)`(null이면 넘기지 않는다), 사람 token은 기본이다. `queue.ts`에 `tabProfile()`을 더한다.
4. login의 profile:
   - `protocol/secrets/logins.ts` 모양을 위대로 고친다.
   - store(`packages/core/secrets/logins.ts`): 항목의 `profile`은 선택 칸이다. 읽을 때 없으면 null(기본 profile)로 내고, 기본 profile의 login을 쓸 때는 칸을 적지 않는다. data step은 두지 않는다(기존 `logins.json`은 그대로 읽힌다).
   - `login-routes.ts`: list는 agent면 `tab`이 있으면 `tabProfile(tab, session)`, 없으면 `agentBrowserProfile(session)`의 login만, 사람은 `tab`이 있으면 그 탭(`"person"`)의 profile, 없으면 전부를 낸다. save는 새 login에 `profile`을 적는다. release는 `login.profile !== input.profile`이면 `forbidden`(origin 불일치와 같은 꼴의 고정 문장). handler deps에 `tabProfile`과 `agentBrowserProfile`을 받고 `wiring/secrets.ts`가 `ctx.hostQueue`와 2의 함수로 잇는다(부를 때 읽는다).
   - `fill_login`(`wiring/host-queue.ts`의 `act`): login의 profile이 그 탭의 profile과 다르면 없는 login과 같은 `not_found`("no login with that id").
   - shell main: `driver.ts`의 `fillLogin`이 `releaseLogin({id, field, origin, profile: page.profile})`, `connection.ts`의 `releaseLogin` 요청 type에 `profile`. `secret-input/request.ts`의 `saveLogin`이 `request.profile`을 `logins/save`에 싣는다. `wiring/input-request.ts`가 login view에 그 탭의 `tabProfile`을 싣는다.
5. CLI `login.ts`의 `login.list`에 `--tab <tab>`(선택)을 더하고 description을 "그 탭의 browser profile에 든 login만, `--tab`이 없으면 당신 agent의 profile"로 고친다. `login.request`의 save가 그 탭의 profile에 저장된다고 적는다.
6. flows: `models.yaml`의 `login-list`·`login-save`·`login-release`(release의 profile 불일치 `forbidden` outcome), `harness.yaml`의 `host-browser-tab-open`(profile을 싣는 step)과 `host-browser-act`의 `not_found` `when`(다른 profile의 login), `agents.yaml`의 정의 만들기·고치기 `forbidden` `when`. 더한 test의 outcome을 `project-docs/flows/tests/`의 그 test file 줄 `covers`에 적는다. `node tools/flows.ts check`.

정한 것:
- 목록은 설정(`settings.json`)에 둔다. 사람만 바꾸는 설정(`locked`)이 이미 있고, shell main이 설정 사본(`ShellSettings`)으로 바로 읽으며, 새 route가 필요 없다. 기계 사이에 맞추기(다음 계획)는 그때 자리를 다시 본다.
- 지운 profile을 가리키는 정의는 저장을 막지 않는다. 풀 때 기본으로 떨어지고 화면이 표시한다(roadmap 정한 것 6).
- `logins/save`의 `profile`은 선택 입력이다. 저장 모양의 `profile`도 선택 칸이고 없으면 기본 profile이다. data step을 두지 않는다(lead, 2026-11-21: 탭 값과 정의의 칸이 이미 "없으면 기본"이고, `profile: null`만 채우는 step은 사람의 `logins.json`을 다시 쓰는 위험만 더한다).

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - `packages/core/lophn-agent/agents/commands_test.ts`: "agent 자격은 정의의 browser_profile을 넣거나 바꾸지 못한다(forbidden)이고 사람은 된다"
  - `packages/core/secrets/login-routes_test.ts`: "release는 page의 profile과 login의 profile이 다르면 값을 내주지 않는다(forbidden)", "agent의 login list는 그 탭 profile의 login만 낸다"
  - `packages/core/secrets/login-routes_test.ts`: "`profile` 칸이 없는 저장 login은 기본 profile의 login으로 읽히고 다른 profile의 탭에는 나오지 않는다"
- 남지 않음: 없음.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
