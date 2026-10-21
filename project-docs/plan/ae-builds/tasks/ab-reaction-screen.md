# ab-reaction-screen

Settings › Reactions 화면을 지운다. 남은 reaction `ReleaseActivationFailed`가 없어지므로(ab-reaction-core) 끄고 켤 것이 없다. `ui-design` skill로 gallery page `new-settings-reactions`부터 지우고 문구는 `wording` skill로 지운다(README "화면"). core와 protocol의 reaction 선언은 ab-reaction-core가 지운다. 화면이 먼저 그 선언을 쓰지 않게 한다.

- 단위: reaction (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/reactions/`(지운다)
  - `packages/shell/renderer/desktop/settings/{settings-screen.tsx,model.ts,declared.ts}`
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/desktop/dev-mock/admin.ts`
  - `packages/shell/renderer/icons/settings.ts`
  - `packages/shell/renderer/desktop/settings/general/{model.ts,named-control.tsx}`
  - `tools/wireframes/pages/screens/{settings.tsx,settings-pages.tsx}`
  - `packages/design/wording/catalog/`
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "`release.activate`의 결과"(`ReleaseActivationFailed` reaction과 reaction 설정, Settings › Reactions를 지운다)와 "화면"
  - 뒤 task: `project-docs/plan/ae-builds/tasks/ab-reaction-core.md`의 "내놓는 것"(wave 2에서 protocol `approvals/reactions.ts`, core `reaction-settings.ts`, Settings 값 `reactions.release_activation_failed`의 선언을 지운다)
  - 화면: `.claude/skills/ui-design/SKILL.md`("먼저 알아둘 것", "새 화면 만들기" 7: 버린 화면은 영역 file에 올리지 않는다, "확인"), `.claude/skills/wording/SKILL.md`("key를 지우기 전에")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `design`, `approvals`; `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `tools`
  - 코드(줄은 main `dd956b49f`)
    - `packages/shell/renderer/desktop/settings/reactions/`: `source.ts`(`REACTION_EVENTS`, `ReactionsSource`. protocol의 모양을 옮겨 둔 것이라 protocol `approvals/reactions.ts`를 import하지 않는다), `core-source.ts`(`coreReactionsSource`), `model.ts`(`REACTION_ROWS`, `settingKeyOf`), `reactions-panel.tsx`(`ReactionsPanel`), `testdata/fake-source.ts`(`fakeReactions`, `SAMPLE_MODES`)
    - `packages/shell/renderer/desktop/settings/settings-screen.tsx` 22-23(import), 30-40(`SettingsPanels`의 `"reactions"` 35), 59-60(prop), 82(destructure), 165-166(`case "reactions"`)
    - `packages/shell/renderer/desktop/settings/model.ts` 11-21(`SettingsPane`의 `"reactions"` 20), 92-107(묶음 `system`의 `reactions` 항목 96-100)
    - `packages/shell/renderer/desktop/settings/declared.ts` 1-2(주석의 "Reactions")
    - `packages/shell/renderer/desktop/entry.tsx` 44(import), 96(`reactions: coreReactionsSource(core)`)
    - `packages/shell/renderer/desktop/dev-mock/admin.ts` 14-17(import), 47(`reactions:`)
    - `packages/shell/renderer/icons/settings.ts` 11(`Zap`), 24(`reactions: Zap`)
    - `packages/shell/renderer/desktop/settings/general/model.ts` 63-70(`SHOWN_ELSEWHERE`의 `"reactions."` 66: General이 Reactions 화면이 보이던 설정을 빼는 줄), `general/named-control.tsx` 1-2(주석 "Appearance·Reactions도 쓴다")
    - gallery: `tools/wireframes/pages/screens/settings.tsx` 29(import `SettingsReactions`), 44(영역 summary의 "Reactions"), 192-198(page `new-settings-reactions`); `tools/wireframes/pages/screens/settings-pages.tsx` 48-49(`SettingsReactions`)
    - wording: `packages/design/wording/catalog/workspace-settings.ts` 59-60(`settings.intro.reactions`), 127(`settings.label.reaction-activation-failed`), 128(`settings.label.reactions-target`), 149(`settings.label.tab-reactions`), 181-182(`settings.note.reactions-unlisted`), 189-192(`settings.reaction.activation-failed-when`, `settings.reaction.opens-app-engineer`)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: Settings에 `reactions` 항목이 없다(`SettingsScreen`의 `reactions` prop, settings model의 nav 항목, `ReactionsSource`, `ReactionsPanel`). renderer는 `packages/protocol/approvals/reactions.ts`의 것(`REACTION_EVENT_TYPES`, `reactionSettingKey`, `REACTION_MODES`)을 import하지 않는다. gallery page `new-settings-reactions`와 `SettingsReactions`가 없다. Reactions 화면만 쓰던 wording key가 없다.
  - 그대로 두는 것: toast(`packages/shell/renderer/desktop/connection/events/reactions.ts`의 `reactionsOf`, `REACTION_EVENT_TYPES`)와 `packages/shell/renderer/workspace/reactions/`, `app-frame/toast-handler.ts`는 이름만 비슷하고 reaction 설정과 상관없다.
  - 등록할 것(lead): `tools/wireframes/pages/index.ts` 머리 주석의 버린 화면 목록에 "Settings › Reactions"를 더한다. page는 `index.ts`에 따로 올라 있지 않다(영역 file `settings.tsx`가 낸다).

## 할 일

근거: README "`release.activate`의 결과". activation 실패는 `release.activate`의 결과로 App Engineer에게 돌아가고 program이 agent를 부르지 않으니 사람이 끄고 켤 reaction이 없다. core의 선언은 wave 2(ab-reaction-core)까지 남지만 화면은 먼저 지운다.

1. gallery(`ui-design` skill)
   - `settings.tsx`: page `new-settings-reactions`(192-198)와 import `SettingsReactions`를 지우고, 영역 summary(44)에서 "Reactions, "를 뺀다.
   - `settings-pages.tsx`: `SettingsReactions`(48-49)를 지운다.
2. renderer
   - `settings/reactions/` 폴더를 통째로 지운다(`testdata/` 포함).
   - `settings-screen.tsx`: `ReactionsPanel`·`ReactionsSource` import, `SettingsPanels`의 `"reactions"`, prop `reactions`와 그 doc 주석, destructure, `case "reactions"`를 지운다.
   - `model.ts`: `SettingsPane`의 `"reactions"`와 묶음 `system`의 `reactions` 항목을 지운다. 묶음 `system`은 Diagnostics 하나로 남는다(묶음 이름 `settings.label.group-system`은 그대로).
   - `declared.ts`: 머리 주석에서 "Reactions·"를 뺀다.
   - `entry.tsx`: `coreReactionsSource` import와 `settingsPanels`의 `reactions:` 줄을 지운다.
   - `dev-mock/admin.ts`: `fakeReactions`, `SAMPLE_MODES` import와 `mockSettingsPanels`의 `reactions:` 줄을 지운다.
   - `icons/settings.ts`: `reactions: Zap`과 쓰지 않게 된 `Zap` import를 지운다.
   - General 화면의 남은 줄을 맞춘다
     - `general/model.ts`의 `SHOWN_ELSEWHERE`에서 `"reactions."`를 지운다. 이 prefix는 Reactions 화면이 보이던 설정을 General에서 빼던 줄이다. wave 2(ab-reaction-core) 전까지는 General에 `reactions.release_activation_failed` 줄이 날 이름(key 그대로)으로 보이는데, plan branch 안의 틈이라 받아들인다(README "뼈대 검토에서 정한 것"의 wave 틈과 같다).
     - `general/named-control.tsx` 머리 주석의 "Appearance·Reactions도 쓴다"를 "Appearance도 쓴다"로 고친다.
3. wording(`wording` skill)
   - 지운다: `settings.intro.reactions`, `settings.label.reaction-activation-failed`, `settings.label.reactions-target`, `settings.label.tab-reactions`, `settings.note.reactions-unlisted`, `settings.reaction.activation-failed-when`, `settings.reaction.opens-app-engineer`.
   - 지우기 전에 앞부분으로 grep해 template 호출이 없는지 본다: `git grep -n 'settings\.intro\.\|settings\.label\.reaction\|settings\.label\.tab-\|settings\.note\.\|settings\.reaction\.' -- packages tools ':!packages/design/wording/catalog'`. main 기준 settings의 template 호출은 `settings.error.${…}`(providers `connect-dialog.tsx` 188), `settings.label.api-${…}`(같은 file 321), `settings.label.shell-action-${…}`(`shell-rules/model.ts` 15), `settings.${key}.name|help`(`general/model.ts` 78)뿐이고 위 key에 닿지 않는다. `general/model.ts`의 `settings.${key}`는 `settings.reactions-…` 꼴이 되는데 catalog에 그런 key가 없다.
   - 남긴다: `settings.label.group-system`, `settings.label.value-on`, `settings.label.value-off`, `settings.error.value-not-saved`, `common.empty.not-ready`(다른 화면도 쓴다).
   - catalog에서 이 task가 고치는 것은 `workspace-settings.ts`와 그 생성물 `workspace-settings.placeholders.ts`뿐이다. 같은 wave의 ab-coding-tab이 `app-space.ts`를 고친다.
   - `deno task wording`으로 placeholders를 다시 만든다(손으로 고치지 않는다). `deno run --allow-read tools/check-wording.ts`를 돈다.

## 끝남

- `deno task check`가 통과한다. renderer를 고쳤으니 `deno run -A packages/shell/renderer/build.ts`도 된다.
- `deno task wireframes`가 되고, gallery 목록에 `new-settings-reactions`가 없으며, `settings-general`의 Settings sidebar에서 System 묶음에 Diagnostics만 있다(보는 법은 ui-design "확인").
- 위험 test: 없음. 화면과 문구다(`.claude/skills/write-test/SKILL.md` "쓰지 않는 test").
- 남지 않음
  - `git grep -n "ReactionsPanel\|ReactionsSource\|coreReactionsSource\|fakeReactions\|SettingsReactions\|new-settings-reactions\|settings/reactions" -- packages tools`가 0줄이다.
  - `git grep -n '"reactions"\|"reactions\."\|settingsIcons\.reactions' -- packages/shell/renderer tools/wireframes`가 0줄이다.
  - `git grep -n 'settings\.intro\.reactions\|settings\.label\.reaction\|tab-reactions\|reactions-unlisted\|settings\.reaction\.' -- packages tools`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 예상: gallery `pages/index.ts` 머리 주석의 버린 화면 목록에 "Settings › Reactions"
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳. 없음이면 "없음"
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"(예상: ab-reaction-core가 merge되기 전까지 General에 `reactions.release_activation_failed`가 보인다)
