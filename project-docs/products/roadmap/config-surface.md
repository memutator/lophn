# config surface: 설정을 한 번 선언하면 화면, CLI, agent가 같이 쓴다

상태: 방향을 정했다. 2026-11-11 사람이 방향을 냈고 planner가 정리했다. 사람이 정할 것은 남아 있지 않다. 일은 아직 시작하지 않았다.
배경 문서: `project-docs/architecture/appearance.md`, `keybindings.md`, `extension.md`, `layers.md`, `project-docs/products/roadmap/command-surface.md`(명령 표 하나), `standalone-core.md`(core가 shell 없이 선다), `theme.md`.

## 사람의 말 (원문)

2026-11-11:

> 현재 shell 의 많은 기능들을 좀 뺏어와서 core에 두거나 적어도 core가 client가 될 수 있게끔 하고싶은데
> 왜냐하면 lophn app 관련 설정들을 cli command 따위로 만들고
> lophn home에서 agent가 처리 가능하게끔 두고 싶거든
> 예를 들면 최근에 theme를 바꿀 수 있게끔 들어왔는데
> 그걸 lophn home한테 toko night 테마 만들어서 적용시켜줘 이렇게 하면 되니까

planner가 theme, 단축키, extension을 하나씩 옮기는 단계로 초안을 쓰자:

> 그니까 theme 변경은 하나의 사례에 불가하고 그걸 쉽게 할 기반을 만들어야한다는거지
> 하나 추가할 때마다 하나 추가하고 그런 게 아니라

화면 동작(탭, desk 배치 등)도 같은 기반에 넣을지, agent가 바꿀 때 확인을 받을지 묻자:

> 화면 동작은 필요 없음 어짜피 진짜 해야하는 건 따로 cli로 이미 구현이 되어 있고 설정 관련해서만 하면 될 듯

> 글고 어짜피 사용자 요청으로부터 시작하고 복구나 위험도가 낮아서 딱히 상관 없을 듯? 바로 바꾸는 걸로 ㄱㄱ

## 왜

- lophn의 설정은 화면(Settings)에서 사람이 손으로만 바꿀 수 있다. home의 lophn agent에게 "theme 하나 만들어서 적용해 줘", "글자 좀 키워 줘", "Ctrl+T를 새 터미널로 바꿔 줘"라고 말해도 agent는 할 길이 없다. 터미널의 coding agent도 같다.
- 막는 것은 설정이 shell에 묶여 있다는 것이다. 값은 대부분 이미 core에 저장되지만, 값이 맞는지 아는 규칙과 값을 화면에 적용하는 길이 shell 안에만 있다. 그래서 밖에서 값을 바꿔도 틀렸는지 모르고, 켜져 있는 화면도 따라 바뀌지 않는다.
- 이 roadmap이 만드는 것은 theme 명령이 아니라 기반이다. 설정 하나를 더할 때 그것을 위한 route, 명령, IPC, skill 글을 다시 짓지 않아도 화면, CLI, agent가 같이 쓰게 한다. theme은 그 기반 위에 서는 첫 사례다.
- `command-surface`가 "lophn이 내놓는 일은 명령 표 하나"로 정했다. 설정은 그 표에서 빠져 있는 가장 큰 덩어리다. `standalone-core`로 core는 shell 없이도 돈다. 설정이 shell에 묶여 있으면 그 core는 자기 설정을 바꿀 수 없다.

## 지금 코드 (main `ee98de848`, 제품 판 0.23.30)

### 값은 세 곳에 나뉘어 있다

- **core 선언 설정**(`<data root>/settings.json`): 40개 key. `shell.*` 27, `lophn-agent.*` 8, `extensions.*` 2, `approvals.*` 1, `coding-agent.*` 1, `diagnostics.*` 1. 모양(appearance 16), 단축키(`shell.keybindings`), quick launch, taskbar, tray, browser link, device가 여기 있다(`packages/core/config/shell-settings.ts`, 조립은 `packages/core/main/daemon/wiring/setting-declarations.ts`).
- **shell main이 core를 거치지 않고 직접 읽고 쓰는 file**:
  - `<data root>/themes/*.json`(`packages/shell/main/desktop/theme-files.ts`, 읽기와 watch)
  - `<data root>/shell/workspaces/<workspace>.json`(layout), `shell/global-floats.json`, `shell/window.json`, `shell/bookmarks.json`, `shell/thread-bookmarks.json`, `shell/agent-sessions/<project>.json`
  - `<data root>/extensions/<id>/`(extension 설치 표시)
  - core는 이 file들의 모양을 migration 때만 안다(`wiring/global-floats-tabs.ts`, `wiring/workspace-rename.ts`).
- **renderer localStorage**: sidebar 폭과 열림, 숨긴 recent.
- 설정이 아예 아닌 것: 로그인 때 자동 시작(tray 메뉴의 toggle뿐, `main/desktop/autostart.ts`), OS 전역 단축키(상수 `CommandOrControl+Shift+K`), 언어(상수 `en`).

### 값을 바꾸는 길은 화면 하나다

- route `settingsUpdate`는 actor `user`만 받는다(`packages/protocol/config/file.ts:75-83`). `settingsList`는 user, agent, app, machine이 읽는다.
- CLI 명령은 `settings.get` 하나다(`packages/cli/commands/settings.ts`). 명령 57개 중 설정, 단축키, extension, provider를 쓰는 것은 없다. 가장 가까운 것이 `agent.create`·`agent.update`다.
- home의 lophn agent는 `file.write`·`file.edit`·`shell.run`이 없고(`packages/protocol/lophn-agent/tool-lists.ts`), 쓸 수 있는 곳은 `<data root>/home/skills`뿐이다(`packages/core/agent-workspaces/workspace/workspace-folders.ts:34-45`). `themes/`와 `settings.json`은 읽지도 못한다.
- home prompt는 설정을 "뜻을 물으면 `lophn settings get`으로 읽어라"로만 말한다(`packages/core/agent-workspaces/prompts/home.md:41-42`). 설정을 다루는 내장 skill은 없다.

### 값이 맞는지 아는 규칙이 shell 쪽에만 있다

core는 모양만 본다. 뜻은 shell과 design이 안다.

| 값 | core가 보는 것 | 뜻을 아는 곳 |
|---|---|---|
| theme id(`shell.light_theme`, `shell.dark_theme`) | 정규식뿐. 없는 id도 받는다 | 내장 목록과 file 목록은 `packages/design/themes.ts`의 `loadThemes`와 shell main |
| theme file | 모른다 | `loadThemes`(순수 함수), 256 KB 한도는 `theme-files.ts` |
| 글꼴 이름(`*_custom`) | 길이 64 | `packages/design/appearance.ts`의 `isFontName` |
| 단축키(`shell.keybindings`) | chord 문자열 4개까지, 64자 | 기본 표 `KEYBINDINGS`와 문법 `parseKeyOverrides`(`packages/shell/ipc/keybindings.ts`, 1138줄) |
| coding agent 즐겨찾기(`shell.coding_agents`) | 64자 문자열 | harness id 목록은 renderer와 `packages/shell/ipc/coding.ts` |
| device, link, 글꼴 굵기, quick launch | zod | 같은 범위와 key를 shell이 손으로 한 벌 더 적었다(`ipc/surface.ts:88-90`, `main/browser-bridge/policy.ts:12` 등) |

- `packages/design`의 theme 코드는 node·electron import가 없는 순수 함수지만, `tools/check-deps.ts`의 `PACKAGE_DEPENDENCIES`가 design을 `sdk`와 `shell`에게만 연다. core와 cli는 부를 수 없다.
- 틀린 값은 조용히 넘어간다. 없는 theme id는 기본 theme으로 떨어지고 Settings 화면만 "not found"를 보인다. theme file의 문제(모르는 token 경로, 모자란 대비)도 Settings에만 보인다. 밖에서 바꾼 쪽은 결과를 모른다.

### 켜져 있는 shell은 밖에서 바뀐 설정을 모른다

- core는 설정이 바뀌면 `SettingsChanged`(`{keys}`)를 낸다. 화면이 쓴 것도, `settings.json`을 손으로 고친 것도 낸다(`packages/core/config/store.ts`가 folder를 본다).
- 이 event를 받는 곳은 extension 켜기·끄기, shared apps, trace뿐이다(`main/desktop/wiring/extensions.ts:442`, `agent.ts:224`, `coding.ts:267`, `renderer/commands/extension-keys.ts:120`).
- appearance, 단축키, quick launch는 다른 길이다: renderer가 core에서 값을 읽어 main에 IPC로 민다(`shell:appearance`, `shell:keybindings`). 다시 읽는 때는 core 연결이 `ready`가 될 때와 그 Settings 화면이 열려 있을 때뿐이다(`renderer/desktop/main.tsx:299-322`, `settings/use-reload.ts`).
- 그래서 `shell.dark_theme`을 밖에서 바꾸면, 켜져 있는 shell은 core에 다시 붙거나 사람이 Settings › Appearance를 열 때까지 옛 theme이다.
- theme file은 반대다. file을 고치면 shell main의 watch가 바로 반영한다. 단 이미 고른 theme일 때만이다.

### 화면 동작은 이미 명령이 있다

- host queue: core가 요청을 받아 줄에 넣고, shell main이 long-poll(`host/take`, 5초)로 가져가 하고 `host/done`으로 답한다(`packages/protocol/lophn-agent/host-queue.ts`, shell 쪽은 `main/desktop/wiring/surface.ts:355-400`).
- 요청 kind는 다섯이다: `tab_open`, `tab_close`, `tab_show`, `tool_call`(extension tool), `browser_call`. 명령으로는 `lophn tab`, `lophn browser`, `lophn ext call`, `lophn preview`다. 이 roadmap은 여기에 더하지 않는다(정한 것 7).
- shell이 없을 때 shell을 띄우는 것은 browser 탭 열기뿐이다.

### 설정 하나를 더할 때 고치는 곳

- 선언은 `{key, type, default}`다(`packages/protocol/config/declaration.ts`의 `SettingDeclaration`). 뜻 검사를 둘 자리도, "누가 바꿔도 되나"를 적을 자리도 없다.
- shell은 core를 import하지 못해서(`tools/check-deps.ts`) 설정마다 key, 범위, 규칙을 shell 쪽에 손으로 한 벌 더 적는다.
- 값을 화면에 적용하는 배선을 설정 묶음마다 따로 짓는다: IPC channel(`packages/shell/ipc/appearance.ts`, `keybindings.ts`), preload API, main wiring, Settings 화면의 source와 model. theme을 넣은 commit `8975e4224`는 35 file을 고쳤고 그중 shell의 배선과 Settings가 10 file이다.
- Settings 화면은 12개 중 General 하나만 선언의 schema에서 control을 만든다(`renderer/desktop/settings/general/model.ts`). 나머지는 묶음마다 손으로 지은 화면이다(providers 2206줄, keyboard 1606줄, appearance 1095줄 등).
- 여기에 agent가 쓰게 하려면 지금 구조로는 설정 묶음마다 명령과 skill 글을 또 더해야 한다.

### theme roadmap에서 정했다가 구현에서 바뀐 것

- `theme.md`의 정한 것 9와 단계 2는 "core가 `themes/`를 읽고, 검사하고, watch하고, 목록 API를 낸다"였다. 구현은 shell main이 읽고 지켜보는 것으로 갔다(`theme.md` 상태 줄). 이 roadmap의 첫 예가 바로 그 자리다.
- `tokyo-night`(dark)와 `tokyo-night-day`(light)는 이미 내장 theme이다. 사람의 예는 "내장에 없는 theme(Catppuccin 등)을 agent가 만들어 적용한다"로 읽는다.

## 기반

**한 번 선언하면 화면, CLI, agent가 같이 쓴다. 선언이 곧 명령이고 설명이다.**

### 설정 surface

설정 선언 하나가 값의 모양, 뜻 검사, 설명, 누가 바꿔도 되는지를 다 갖는다. 선언은 core와 shell이 같이 import하는 곳에 둔다.

- **저장과 검사는 core.** 뜻 검사까지 core가 하고, 틀리면 바꾼 쪽이 그 자리에서 이유를 받는다. shell이 손으로 한 벌 더 적은 규칙은 없어진다.
- **바꾸는 길은 하나.** Settings 화면, `lophn settings set`, agent가 같은 route를 부른다. 설정을 더해도 명령과 route가 늘지 않는다.
- **agent가 읽는 설명도 선언에서 나온다.** `lophn settings get`이 key, 뜻, 고를 수 있는 값, 바꿀 수 있는지를 보인다. 설정을 더해도 skill 글을 고치지 않는다. skill은 "`settings get`으로 찾아라"만 말한다.
- **shell은 설정의 살아 있는 사본 하나를 둔다.** main과 renderer가 key를 구독하고(core의 `SettingsChanged`), 값이 바뀌면 누가 바꿨든 적용한다. 설정마다 IPC channel을 짓지 않는다.
- **file로 저장되는 값도 같은 surface다.** theme처럼 항목마다 file 하나인 것(`themes/<id>.json`)은 "값이 folder에 저장되는 설정"으로 선언한다. core가 읽고, 검사하고, watch하고, 같은 route와 같은 event로 내놓는다. theme을 위한 route와 명령 묶음을 따로 만들지 않는다. 사람이 folder에 file을 손으로 두는 길은 그대로다.

### 기반의 시험: 하나를 더할 때 고치는 곳

| 더하는 것 | 지금 | 기반 뒤 |
|---|---|---|
| 설정 하나(예: 로그인 때 자동 시작) | core 선언, shell에 규칙 사본, IPC channel, preload, main wiring, Settings 화면. agent가 쓰려면 명령과 skill 글 | 선언 하나와 그 값을 적용하는 shell 구독 한 곳. CLI, agent, General 화면은 따라온다 |
| file로 두는 설정 묶음(예: theme) | shell main의 file 읽기와 watch, IPC 셋, Settings 목록. agent가 쓰려면 명령 묶음 | folder 선언 하나와 검사 함수. 나머지는 따라온다 |

## 정한 것

1. **설정을 쓰는 명령은 `lophn settings set <key> <value>`와 `settings unset <key>`뿐이다(agent).** 설정이나 설정 묶음마다 명령을 만들지 않는다. theme file도 이 명령으로 쓴다.
2. **선언에 뜻 검사와 "명령으로 바꿀 수 있나"를 둔다(agent).** 권한에 걸린 설정(`approvals.shell_rules`, `lophn-agent.call_policy`, `lophn-agent.extensions.mcp_servers`·`skill_folders`·`skills_off`, `coding-agent.shared_apps`)은 바꿀 수 없음으로 선언한다. agent가 자기 범위를 넓히게 두지 않는다. `command-surface` 정한 것 8과 같은 원칙이다. CLI binary는 user token을 쓰므로 actor가 아니라 선언의 이 칸으로 막는다.
3. **secret과 provider 연결은 넣지 않는다(agent).** secret 값은 보호 입력 창으로만 들어간다(`architecture/approval.md`). agent가 사람에게 넣어 달라고 요청하는 길은 `secret-request.md`가 맡는다.
4. **agent는 file을 직접 쓰지 않는다(agent).** home에 `themes/` 쓰기 권한을 주는 길은 버린다. 설정 surface를 지나야 검사 결과(모르는 token 경로, 모자란 대비)가 agent에게 돌아온다.
5. **shell의 적용 길은 구독 하나로 바꾼다(agent).** renderer가 값을 읽어 main에 미는 길(`shell:appearance`, `shell:keybindings`의 값 보내기, theme file을 shell main이 읽는 것)은 지운다. 기반 위로 옮기지 않은 옛 길을 남기면 한쪽만 바뀌는 bug가 또 난다.
6. **선언과 규칙의 자리는 core와 shell이 같이 import하는 곳이다(agent).** 정확한 자리(`packages/protocol`, 또는 design의 순수한 부분을 core에 열기)는 계획에서 정한다. theme 검사는 token 목록(`packages/design`)이 있어야 한다는 것이 걸린다.
7. **화면 동작은 넣지 않는다(사람, 2026-11-11).** 탭 열기, desk 배치처럼 켜진 화면에서 하는 일은 값이 아니다. 꼭 필요한 것은 이미 명령으로 있고(`lophn tab`, `lophn browser`, `lophn ext call`), 더 필요해지면 그때 그 명령을 더한다. layout(desk, tab, group)의 주인은 지금처럼 renderer다(`architecture/workspace-layout.md`).
8. **lophn agent에게는 home에서만 연다(사람의 말: "lophn home에서").** project·app workspace의 agent는 일하는 중에 사람의 화면 모양을 바꾸지 않는다. 사람의 터미널(CLI binary)은 어디서든 쓴다.
9. **기반을 지은 그 일에서 지금 있는 것을 기반 위로 옮긴다(agent).** 기반만 짓고 쓰는 곳이 없으면 맞는지 알 수 없다. appearance, theme, 단축키, quick launch를 옮기는 것으로 확인한다.
10. **agent는 설정을 묻지 않고 바로 바꾼다(사람, 2026-11-11).** 사람의 요청에서 시작하는 일이고, 되돌리기 쉽고 위험이 낮다. 명령은 바꾸기 전 값을 답에 실어 "원래대로"가 된다. 권한에 걸린 설정은 정한 것 2로 빠져 있다.

## 순서

1. **설정 surface.**
   - 선언에 뜻 검사, 설명, 바꿀 수 있는지를 더하고 core와 shell이 같이 import하는 곳으로 옮긴다. shell의 규칙 사본을 지운다.
   - `settings set`·`unset` 명령, route가 선언대로 agent를 받는다, `settings get`이 바꿀 수 있는지와 고를 값을 보인다.
   - shell의 설정 사본과 구독. appearance, 단축키, quick launch, taskbar, tray를 그 위로 옮기고 묶음마다 있던 IPC 값 보내기를 지운다.
   - folder에 저장되는 설정. theme을 그 위로 옮긴다(`theme.md` 정한 것 9로 돌아간다).
   - home prompt와 내장 skill 하나.
   - 끝나면: home agent에게 "Catppuccin Mocha theme 만들어서 적용해 줘", "글자 크게", "Ctrl+T를 새 터미널로"가 된다. 터미널에서 `lophn settings set shell.dark_theme tokyo-night`를 치면 켜진 창이 바로 바뀐다. 그 뒤 설정 하나를 더하는 일은 선언 하나와 적용 한 곳이다.
2. **기반 위에 더하는 것(기반이 선 뒤, 쓰는 곳이 생길 때 하나씩).** 로그인 때 자동 시작, OS 전역 단축키, 언어를 설정으로. extension 설치 상태, 북마크를 core가 갖는 값으로. 이것들은 계획이 아니라 선언 하나씩이다.

## 하지 않는 것

- 창 관리, 그리기, 탭의 실제 화면을 core로 옮기는 것.
- 화면 동작을 밖에서 부르는 범용 길(shell command를 CLI와 agent에게 여는 것, 화면을 눌러 조작하는 것). 정한 것 7.
- 권한에 걸린 설정, secret, provider 연결을 agent가 바꾸는 것.
- 설정 변경을 rewind에 넣는 것. 명령이 바꾸기 전 값을 돌려주는 것으로 충분하다.
- project·app workspace의 agent에게 여는 것.
- 손으로 지은 Settings 화면 11개를 schema에서 만드는 화면으로 바꾸는 것. 화면은 그대로 두고 쓰는 route와 적용 길만 기반으로 옮긴다.

## 같이 고칠 문서 (계획을 열 때)

- `project-docs/architecture/appearance.md`: 흐름(설정 → core event → shell 구독), theme file의 주인, 결정 "시작 때 값은 renderer가 core에서 읽어 main에 보낸다"를 뒤집은 기록.
- `project-docs/architecture/keybindings.md`, `extension.md`: 규칙의 자리.
- `project-docs/architecture/layers.md`: 선언과 규칙을 core와 shell이 같이 읽는 import 선.
- 설정 surface를 적는 architecture 문서 하나(새로).
- `project-docs/flows/`: 새 명령, 지운 IPC channel.
- home prompt와 내장 skill.

## 계획의 모양

순서 1 안의 일은 서로 기댄다(선언 → route와 명령 → shell 구독 → theme이 그 위에 선다). 병렬 계획이 아니라 branch 하나에서 한 줄로 한다.
