# ap-shell-settings

Settings에 shell 규칙 항목을 더한다. 제품 기본 목록(읽기만), 전역 규칙, project별 규칙을 보고 고친다. `ui-design` skill로 wireframe부터 만들고 문구는 `wording` skill을 따른다.

- 단위: shell (wave 3)
- 선행: ap-shell-gate
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/general/model.ts`
  - `packages/shell/renderer/desktop/settings/shell-rules/`(새 폴더)
  - `packages/shell/renderer/desktop/settings/{model.ts,settings-screen.tsx}`
  - `packages/shell/renderer/icons/settings.ts`
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/desktop/dev-mock/admin.ts`
  - `tools/wireframes/pages/screens/{settings-pages.tsx,settings.tsx,settings-frame.tsx}`
  - `packages/design/wording/catalog/`
- 읽을 것:
  - 계획: `project-docs/plan/approval-simplify/README.md`의 "정한 것"(shell 규칙은 제품 기본, 전역, project 세 층이고 Settings에 둔다)과 "뼈대 검토에서 정한 것"(pattern의 `*`, 조각마다 가장 엄한 것, `always`가 더하는 `<앞 두 낱말> *` 줄, floor deny는 덮지 못한다)
  - roadmap: `project-docs/products/roadmap/approval.md`의 "shell 규칙"(마지막에 맞은 규칙이 이긴다, 맞는 규칙이 없으면 allow, 전역과 project 규칙은 lophn data에 둔다, `always`의 층은 place로 정하고 Settings에서 옮기고 고친다)
  - architecture: `project-docs/architecture/approval.md`(지금 코드. 결정은 사람만 한다), `project-docs/architecture/ui-kit.md`의 "gallery가 정본이다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `config`, `design-api`; `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/design`
  - skill: `.claude/skills/ui-design/SKILL.md`(새 page, "모든 화면의 규칙"), `.claude/skills/wording/SKILL.md`, `.claude/skills/write-test/SKILL.md`
  - 계약:
    - `packages/protocol/approvals/shell-rules.ts`(ap-contract): `ShellRule`, `SHELL_RULE_ACTIONS`, `shellRulesSettingSchema`, `PRODUCT_SHELL_RULES`, `SHELL_RULES_SETTING_KEY`. 목록 값은 ap-contract가 정했다.
    - 설정 선언 `approvals.shell_rules`(ap-shell-gate, `packages/core/main/daemon/wiring/setting-declarations.ts`). 읽기와 쓰기는 memory `settings/list`·`settings/update`다.
    - `packages/protocol/projects/project-routes.ts`의 `projectList`(project 이름)
  - 본보기(화면과 통로): Settings › Reactions 한 벌이 가장 가깝다. `packages/shell/renderer/desktop/settings/reactions/{source.ts,core-source.ts,model.ts,reactions-panel.tsx,testdata/fake-source.ts}`, 설정 읽고 쓰기 `packages/shell/renderer/desktop/settings/declared.ts`(`readEffective`, `chooseSetting`), 부르기 `packages/shell/renderer/desktop/settings/core-call.ts`(`call`), 다시 읽기 `packages/shell/renderer/desktop/settings/use-reload.ts`, 줄 꼴 `packages/shell/renderer/desktop/settings/general/named-control.tsx`와 `packages/shell/renderer/desktop/settings/settings.module.css`의 `.lines`·`.line`·`.lineMain`·`.lineControl`
  - 조립: `packages/shell/renderer/desktop/settings/model.ts`(`SettingsPane`, `SETTINGS_GROUPS`), `packages/shell/renderer/desktop/settings/settings-screen.tsx`(`SettingsPanels`, `bodyOf`), `packages/shell/renderer/desktop/entry.tsx`의 `settingsPanels`, `packages/shell/renderer/desktop/dev-mock/admin.ts`의 `mockSettingsPanels`(앞 계획 land 뒤 path 확인. `pr-reactions`와 ap-reaction이 같은 file의 reaction 몫을 고쳤다), `packages/shell/renderer/desktop/settings/general/model.ts`의 `SHOWN_ELSEWHERE`(소유 밖)
  - 본보기(gallery): `tools/wireframes/pages/screens/settings.tsx`(영역 file), `tools/wireframes/pages/screens/settings-pages.tsx`, `tools/wireframes/pages/screens/settings-frame.tsx`(`mock.settingsPanels`를 쓴다)
- 계약:
  - 쓰는 것: `ShellRule`, `shellRulesSettingSchema`, `PRODUCT_SHELL_RULES`, `SHELL_RULES_SETTING_KEY`(ap-contract), memory route `settings/list`·`settings/update`, 설정 선언(ap-shell-gate)
  - 내놓는 것: 없음(화면. Settings pane `shell-rules`)

## 할 일

근거: README "정한 것"(세 층, Settings에 둔다), roadmap "shell 규칙"(마지막 일치, 맞는 규칙이 없으면 allow, floor deny는 덮지 못한다, Settings에서 옮기고 고친다), README "뼈대 검토에서 정한 것"(`*`의 뜻, `always`가 더하는 줄). 읽기만인 제품 기본 목록은 protocol 상수를 그대로 그리고 route를 두지 않는다. gallery는 renderer component를 그대로 그리므로(`ui-kit.md` "gallery가 정본이다") 1과 2~6을 같이 바꿔야 그려진다.

1. gallery page부터 만든다(ui-design skill "새 화면 만들기" 4~7).
   - `tools/wireframes/pages/screens/settings-pages.tsx`: `SettingsShellRules`(`<SettingsFrame pane="shell-rules" />`)와 `SettingsShellRulesAdd`(같은 화면에서 Workspace 절의 더하기 줄에 pattern `npm publish *`를 치고 action을 Ask로 고른 상태. `steps`로 건다)를 더한다.
   - `tools/wireframes/pages/screens/settings.tsx`: page `new-settings-shell-rules`, `new-settings-shell-rules-add`를 더한다(title 영어, description 한국어 한두 문장). 영역 `summary`의 항목 목록에 Shell rules를 넣는다.
   - 같은 file의 `new-settings-agents` 설명에서 "grant 기본값 설명"을 뺀다(ap-assign-editor가 그 절을 지웠다).
   - `tools/wireframes/pages/screens/settings-frame.tsx`: `mock.settingsPanels`가 `shellRules`를 가지면 고칠 것이 없다. 상태를 바꿀 option이 필요할 때만 더한다.
2. 통로(`settings/shell-rules/`).
   - `source.ts`: 화면 값과 통로.
     - `ShellRuleLayer = { kind: "global" } | { kind: "project"; project: string }`
     - `ShellRulesView = { global: readonly ShellRule[]; projects: readonly { id: string; name: string; rules: readonly ShellRule[] }[] }`. projects는 `projectList`의 모든 project(규칙이 없는 것 포함, 이름 순)와 설정에만 남은 project id(이름은 id로 보인다)다.
     - `ShellRulesSource`: `watch(listener)`, `read()`, `add(layer, rule)`, `remove(layer, index)`, `setAction(layer, index, action)`. 결과는 `SourceResult`다.
   - `model.ts`: 순수 함수. 설정 값(`shellRulesSettingSchema`의 type)에 `withAdded`, `withRemoved`, `withAction`을 대어 새 값을 만든다. 고친 층 밖의 줄은 그대로 둔다. action 선택지와 그 문구 key(`ACTION_OPTIONS`)도 여기 둔다.
   - `core-source.ts`: `coreShellRulesSource(core)`.
     - `read`: `readEffective(core, [SHELL_RULES_SETTING_KEY])`의 값을 `shellRulesSettingSchema.safeParse`로 읽는다. 틀리면 읽기 실패다(모르는 값을 지어내지 않는다, `settings/model.ts` 머리 주석). project 이름은 `projectList`로 읽는다.
     - `add`·`remove`·`setAction`: 저장 직전에 값을 다시 읽고 `model.ts`의 함수를 대어 `chooseSetting(core, SHELL_RULES_SETTING_KEY, next)`로 값 전체를 쓴다(정한 것 2). 거절이면 그 reason이 code다.
   - `testdata/fake-source.ts`: `fakeShellRules({ value?, readFails?, saveCode? })`와 대표 값 `SAMPLE_SHELL_RULES`(Workspace에 `always`가 더한 꼴의 `git push *` allow와 사람이 쓴 `npm publish *` ask, project 하나에 `deno task *` allow). 메모리에서 끝나고 core를 부르지 않는다.
3. 화면(`settings/shell-rules/shell-rules-panel.tsx`).
   - 위에서부터: 제목과 lead 한 문단(명령을 돌리기 전에 이 규칙을 본다, Deny는 막고 Ask는 사람을 기다리고 Allow는 돈다, 같은 층에서는 마지막에 맞은 규칙이 이긴다, 맞는 규칙이 없으면 돈다).
   - Built in 절: `PRODUCT_SHELL_RULES.floor`(늘 막는다)와 `.ask`(먼저 묻는다)를 pattern 목록으로 그린다. 조작이 없다. 아래 한 줄: 아래 규칙은 늘 막는 것을 풀지 못한다.
   - Workspace 절(전역 층)과 project마다 절 하나: 줄마다 pattern(mono)과 오른쪽 끝 고정 열의 action `Select`, [Remove] `IconButton`. 절 끝에 더하기 줄(pattern `Input`, action `Select`, 오른쪽 끝 [Add rule])이 있다. 규칙이 없으면 빈 안내 한 줄이다.
   - 저장은 줄마다 바로 한다(Reactions처럼). 실패하면 앞 값으로 돌아가고 그 줄에 `settings.error.value-not-saved`를 보인다. 읽기 실패는 `ErrorState`다. 빈 pattern이면 [Add rule]이 꺼진다.
   - CSS는 `settings.module.css`의 줄 class를 쓴다. 새 class가 꼭 필요하면 이 폴더의 `shell-rules.module.css`에 token 변수로 둔다.
4. 조립.
   - `settings/model.ts`: `SettingsPane`에 `"shell-rules"`를, `SETTINGS_GROUPS`의 `agents` 묶음 끝(`coding` 뒤)에 `{ id: "shell-rules", label: "settings.label.tab-shell-rules", icon: settingsIcons.shellRules }`를 더한다(정한 것 1).
   - `icons/settings.ts`: `shellRules: ShieldCheck`(lucide-react 1.51.0에 있다).
   - `settings/settings-screen.tsx`: prop `shellRules?: ShellRulesSource`, `SettingsPanels`의 Pick에 `"shellRules"`, `bodyOf`의 `"shell-rules"` 갈래.
   - `desktop/entry.tsx`: `settingsPanels`에 `shellRules: coreShellRulesSource(core)`.
   - `desktop/dev-mock/admin.ts`: `mockSettingsPanels`에 `shellRules: fakeShellRules({ value: SAMPLE_SHELL_RULES }).source`.
5. 소유 줄에 없는 file. lead가 소유에 더하지 않았으면 최소로 고치고 보고의 "넘길 줄"에 적는다.
   - `packages/shell/renderer/desktop/settings/general/model.ts`의 `SHOWN_ELSEWHERE`에 `"approvals.shell_rules"`를 더한다. 빼지 않으면 General이 그 설정을 바꿀 수 없는 줄("Approvals" 묶음)로 같이 보인다.
6. wording(`packages/design/wording/catalog/workspace-settings.ts`). 같은 뜻의 key(`common.*`, `settings.error.value-not-saved`)가 있으면 그것을 쓴다.
   - 더할 것(값은 wording skill 규칙을 따른다): `settings.label.tab-shell-rules`("Shell rules"), `settings.intro.shell-rules`, Built in 절의 제목과 두 목록 이름, floor 안내 한 줄, Workspace 절 제목, project 절 제목(`{name}`), action 셋의 이름(Allow, Ask, Deny), pattern 칸 이름, [Add rule], [Remove] label, 빈 안내, `ErrorState`의 target
   - 값에 안쪽 말(`floor`, `layer`, `grant`)을 쓰지 않는다.
   - `deno task wording`, `deno run --allow-read tools/check-wording.ts`
7. 위험 test 하나(`settings/shell-rules/core-source_test.ts`, write-test skill. 사용자 data를 잃는 규칙). 메모리 fake `CoreSource`(`call`이 `settings/list`·`settings/update`·`projects/list`를 받는다)로 본다. 서버나 subprocess를 띄우지 않는다.
   - "규칙 하나를 더하면 저장 직전에 다시 읽은 값에 그 줄만 더한다: 화면을 연 뒤 `always`가 더한 줄과 다른 층, 다른 project의 줄이 남는다." 첫 읽기와 저장 직전 읽기가 다른 값을 돌려주게 하고, `settings/update`가 받은 값을 비교한다.

정한 것:
1. 항목 자리는 Settings의 Agents 묶음 끝이다. 이유: agent가 돌리는 명령의 규칙이고, 같은 묶음에 Tools and skills와 Coding agents가 있다.
2. 바꿀 때마다 값을 다시 읽고 한 줄만 고쳐 값 전체를 쓴다. 이유: `settings/update`에 compare가 없고, 화면을 연 사이 `always`가 같은 값에 줄을 더한다. 화면이 쥔 값을 통째로 쓰면 그 줄을 잃는다.
3. 층 사이 옮기기와 순서 바꾸기 단추를 두지 않는다. 이유: 지우고 다른 층에 더하면 된다(roadmap "Settings에서 옮기고 고친다"는 이것으로 채운다). 새 줄은 층의 끝에 붙어 그 층에서 가장 나중에 맞는다.
4. pattern을 고치는 칸이 없다. 이유: 지우고 다시 더하면 된다. 줄마다 바꾸는 것은 action뿐이다.

## 끝남

- `deno task check`가 통과한다.
- `deno run -A packages/shell/renderer/build.ts`가 통과한다.
- `deno run --allow-read tools/check-wording.ts`에 오류가 없다.
- `deno task wireframes`가 되고 gallery에서 다음이 그려진다.
  - `new-settings-shell-rules`: sidebar의 Agents 묶음 끝에 Shell rules가 있고, 본문에 Built in(늘 막는 것, 먼저 묻는 것), Workspace, project 절이 있다. action은 줄 오른쪽 끝 열이다.
  - `new-settings-shell-rules-add`: Workspace 절의 더하기 줄에 `npm publish *`와 Ask가 들어 있다.
  - `new-settings-general`: Approvals 묶음이 없다.
  - `new-settings-agents`: 설명에 grant 기본값이 없다.
- 위험 test: "규칙 하나를 더하면 저장 직전에 다시 읽은 값에 그 줄만 더한다: 화면을 연 뒤 `always`가 더한 줄과 다른 층, 다른 project의 줄이 남는다"(`packages/shell/renderer/desktop/settings/shell-rules/core-source_test.ts`)
- 남지 않음: 지우는 이름이 없다. 설정 key는 protocol 상수로만 쓴다: `grep -rn --exclude-dir=dist '"approvals.shell_rules"' packages/shell/renderer tools/wireframes`가 `general/model.ts`의 `SHOWN_ELSEWHERE` 한 줄뿐이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(할 일 5)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 적어도 확인해 적는다: 다시 읽기와 쓰기 사이에 `always`가 쓰면 그 줄을 잃을 수 있다(`settings/update`에 compare가 없다), 지운 project의 규칙은 id로만 보인다.
