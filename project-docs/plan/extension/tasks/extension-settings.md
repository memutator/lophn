# extension-settings

설정 화면에 extension 목록을 두고 사람이 설치·켜기·끄기·지우기를 한다.

- 단위: extension (wave 2)
- 선행: extension-core.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/**`, `packages/shell/ipc/` 의 새 extension IPC file, `packages/shell/preload/` 해당 file
  - `packages/design/i18n/catalog/**`
  - `tools/wireframes/pages/screens/` 의 settings page(있으면)
- 읽을 것:
  - architecture: `project-docs/architecture/ui-kit.md`
  - 제품 결정: 계획 README 정한 것 3, 4
- 계약:
  - 쓰는 것: `extension-core`의 registry 목록과 켜기·끄기
  - 내놓는 것: 없음

## 할 일

1. Settings에 Extensions 항목: manifest의 이름, 설명, 판, 상태(설치 안 됨·꺼짐·켜짐·판 다름).
2. 단추: 설치(표시 file), 켜기, 끄기, 지우기(확인 dialog).
3. IPC는 shell 내부, 문구는 i18n.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: 없음(화면)
- 남지 않음: 없음

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴.

## lead가 더함

- 추가 소유: `packages/shell/main/desktop/wiring/extensions.ts`(IPC handler를 붙이는 데까지), `packages/shell/main/extensions/registry.ts`(`install(id)` 하나를 더하는 데까지), `packages/shell/preload/shell.ts`·`shell-api.ts`의 extension api 등록 줄, `packages/shell/renderer/desktop/settings/model.ts`의 pane 한 줄.
- 이름 겹침: 지금 Settings › Agents의 `tools` pane(`settings.label.tab-extensions`, `settings/extensions/extensions-panel.tsx`, `settings/extension-settings.ts`)은 lophn agent의 skill 폴더·MCP server이고 이 일과 다르다. 건드리지 않는다. 새 pane은 System 무리에 `extension-packages` 같은 다른 id로 두고 파일 이름도 겹치지 않게 한다. 화면 문구는 "Extensions"여도 되지만 key는 따로 만든다.
- 본보기 IPC: `packages/shell/ipc/coding.ts`, `packages/shell/preload/coding-api.ts`, `packages/shell/main/desktop/coding-ipc.ts`. 새 IPC file은 `packages/shell/ipc/extensions.ts` 하나다. 통로: `list`(registry `list()`), `install(id)`, `remove(id)`. 켜기·끄기는 IPC가 아니라 renderer가 이미 쓰는 settings 쓰기 길(`settings/declared.ts`의 `chooseSetting`)로 `extensions.<id>.enabled`를 바꾼다. registry가 `SettingsChanged`로 맞춘다. 바뀐 뒤 목록을 다시 읽는다.
- `install(id)`: registry에 표시 file(`<data>/extensions/<id>/.lophn-extension`, 빈 `files`)만 두는 method를 더한다. 이미 있으면 그대로(다시 해도 같다). 상태는 `installed`(표시 file)와 `status`로 그린다: 설치 안 됨(installed false, status off) · 꺼짐 · 켜짐 · 판 다름(`incompatible`) · 그 밖의 문제(`invalid`, `no_setting`, `failed`)는 reason을 보인다. 켜기 단추는 설치된 것만 보인다. 지우기는 켜져 있으면 막혀 있으므로 확인 dialog 전에 끄라고 보인다(registry가 `conflict`를 낸다).
- 지금 본체 안 extension이 하나도 없어 목록은 빈 것이 정상이다. 빈 목록 문구를 둔다. 손으로 볼 때는 worktree 안 `packages/shell/main/extensions/bundled/<id>/manifest.json` fixture를 잠시 두고 commit하지 않는다.
- 위험 test는 없다(화면). registry의 `install` 한 줄도 test하지 않는다.
