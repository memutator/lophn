# theme: 색 theme, 자유 accent, 사용자 override

상태: 끝남(계획 없이 바로 했다, change-log `0.23`의 `color-themes`). 흐름과 지키는 것은 `project-docs/architecture/appearance.md`다. 아래 "지금 코드"는 하기 전의 코드다. 하며 바뀐 것: theme file은 core가 아니라 shell main이 읽고 지켜본다(아래 "단계" 2의 core 몫은 설정과 data step뿐이다), 모드 설정 key는 `shell.mode`다.
2026-11-10 사람이 방향을 냈고, 큰 갈래 셋(아래 "정한 것" 1~3)은 사람이 골랐다.
배경 문서: `project-docs/architecture/appearance.md`, `project-docs/architecture/ui-kit.md`.

## 사람의 말 (요지, 2026-11-10)

- semantic token을 여러 theme으로 두고 싶다. Tokyo Night 같은 것.
- 사용자도 override할 수 있게 바꾸고 싶다.
- primary 색은 지금 고를 수 있는 폭이 너무 좁다.

## 왜

lophn은 사람이 하루 종일 켜 두는 작업 화면이다. 개발자는 editor와 터미널에서 이미 쓰는 theme(Tokyo Night, Catppuccin, Solarized 등)을 그대로 쓰고 싶어 한다. 지금 lophn은 바탕 세 가지와 accent 다섯 가지만 고를 수 있다. syntax, 터미널, diff 색은 고정이라 바탕을 바꿔도 "그 theme"처럼 보이지 않는다. 그리고 사람이 색을 직접 넣을 길이 없다.

## 지금 코드 (main `01ed9e72a`, 제품 판 0.23.27)

- token은 `packages/design/tokens.ts` 한 곳에 있다. 이름은 역할(semantic)이고 값은 hex를 바로 적는다. primitive palette 층은 없다. 색 token은 `color.*`(surface 다섯, border 셋, text 넷, ink 넷, link, focus, selection, danger), `status.*`, `chart.series`, `diff.*`, `code.*`(syntax, Shiki css-variables와 같은 `--code-*`), `terminal.*`(ANSI 16), `tabStrip.bar·hover`, `floating.*`, `window`의 닫기 hover, `fileIcon`이다.
- 색을 고르는 축은 둘이다(`packages/design/presets.ts`). `background`(warm, neutral, cool)는 surface, border, text, tabStrip, floating을 덮는다. `accent`(ink, blue, green, purple, orange)는 손으로 맞춘 값 여섯(ink background·text·hover·soft, focus, selection)을 덮는다. `shell.theme`(light, dark, system)은 각 preset의 light·dark 값 중 하나를 고른다.
- 고른 값은 core 선언 설정 `shell.*`(`packages/core/config/shell-settings.ts`)에 저장된다. renderer가 읽어 IPC `shell:appearance`로 main에 보내면, main은 다시 검사한 뒤 `appearanceCss`로 덮어쓰는 CSS를 만들어 모든 lophn 문서(desktop, overlay, 보호 입력 창, 앱 화면, artifact 화면)에 insertCSS한다.
- `appearance.md`의 지키는 것 10번이 "사람이 고르는 것은 preset과 설치된 글꼴 이름뿐이다. 임의의 token 값이나 CSS를 넣는 길은 없다"이다. 0.2.0에서 사람이 정했다. 지키는 것 3번(CSS에 들어가는 값의 허용 목록)이 앱 화면 guest로 가는 CSS injection을 막는 경계다.
- token 밖 hex는 많지 않다. avatar 캐릭터, file icon(`fileIcon` token), dev fake data 정도다.

## 정한 것

1. **theme은 모드마다 하나씩 고른다.** (사람, 2026-11-10) theme 하나는 light와 dark 중 한 모드의 색 전부다. 사람은 light용 theme과 dark용 theme을 따로 고르고, `shell.theme`(light, dark, system)은 지금처럼 둘 중 무엇을 쓸지 정한다. Tokyo Night처럼 dark 판만 있는 theme도 그대로 들어온다. VS Code와 Zed가 이 꼴이다.
2. **accent는 아무 색이나 고르고 lophn이 보정한다.** (사람, 2026-11-10) 사람은 color picker로 hex 하나를 고른다. lophn이 그 색에서 ink background·text·hover·soft, focus, selection을 모드마다 만든다. 대비(지키는 것 8번)가 모자라면 색상(hue)은 두고 명도를 옮긴다. 그래서 화면에 보이는 색은 고른 색과 조금 다를 수 있다. 기본 값은 "theme을 따른다"이고, 이때는 theme에 적힌 accent를 쓴다.
3. **override는 색 token 전부이고, theme file로 한다.** (사람, 2026-11-10) data root의 `themes/<id>.json` 하나가 theme 하나다. 사람이나 agent가 file을 두면 Settings 목록에 나온다. 색이 아닌 token(간격, 모서리, 크기)은 지금처럼 preset으로만 바꾼다.
4. **색 축을 theme 하나로 합친다.** `shell.background`는 없앤다. warm, neutral, cool은 lophn 내장 theme 여섯(셋 × light·dark)이 된다. 기존 값은 data step으로 옮긴다: `background=X`는 `light_theme=lophn-X-light`, `dark_theme=lophn-X-dark`로, `accent`의 이름은 그 preset의 light background hex로 옮기고, `ink`는 "theme을 따른다"로 옮긴다. (agent: 축이 둘이면 theme과 background가 서로 덮어 무엇이 이기는지 사람이 알 수 없다)
5. **theme이 덮는 범위는 색 token 전부다.** surface, border, text, ink, link, focus, selection, danger, status, chart, diff, code(syntax), terminal(ANSI 16), tabStrip, floating, window 닫기 hover가 들어간다. 그래야 Tokyo Night가 syntax와 터미널까지 Tokyo Night처럼 보인다. file icon 색과 avatar는 넣지 않는다(식별 색이다). (agent)
6. **theme file 모양.** `{ "name", "mode": "light"|"dark", "extends"?: <theme id>, "colors": { "<token 경로>": "<hex>" } }`. 경로는 flatten한 token 이름(`color.surface.base`, `code.token.keyword`)이다. 빠진 token은 `extends`의 theme에서, `extends`가 없으면 같은 모드의 lophn 기본 theme에서 채운다. 그래서 몇 줄짜리 file도 완전한 theme이 된다. 모르는 경로는 무시하고 Settings에 경고로 보인다. (agent)
7. **CSS injection 경계는 값의 형식으로 지킨다.** theme file과 accent의 값은 `#rgb`, `#rrggbb`, `#rrggbbaa`만 받는다. 그 밖의 값은 그 token만 버리고 상속 값을 쓴다. core가 읽을 때 검사하고, main이 CSS를 만들 때 다시 검사한다. 지키는 것 10번은 "고르는 것은 preset, 설치된 글꼴 이름, 검사한 theme file의 hex 색, accent hex다. CSS나 색이 아닌 token 값을 넣는 길은 없다"로 바꾼다. (agent)
8. **theme file의 대비는 막지 않고 알린다.** theme file의 값은 사람이 적은 그대로 쓴다. 지키는 것 8번의 비율을 어기면 Settings의 theme 줄에 어떤 짝이 모자란지 경고한다. 내장 theme은 지금처럼 8번을 지킨다. 보정은 picker로 고른 accent에만 한다(2). (agent: 사람이 일부러 적은 색을 lophn이 바꾸면 theme을 옮겨 올 수 없다)
9. **theme file은 바뀌면 바로 반영한다.** core가 `themes/`를 watch하고, 고른 theme의 file이 바뀌면 열린 문서에 다시 넣는다. agent에게 "Tokyo Night theme 만들어 줘"라고 하면 file을 쓰는 즉시 화면이 바뀐다. (agent)
10. **내장 theme은 처음에 lophn 여섯과 Tokyo Night(dark), Tokyo Night Day(light)다.** 그 밖의 theme은 theme file로 받는다. 내장 theme이 늘면 관리할 대비 값도 늘어서, 더 넣는 것은 따로 정한다. (agent)
11. **사용자 앱은 따로 고치지 않는다.** 앱은 `@lophn/ui/tokens.css`의 같은 변수를 쓰므로 theme이 그대로 닿는다. token 이름이 바뀌지 않으면 SDK 판도 올리지 않는다. token을 더하거나 이름을 바꾸면 `sdk-note`대로 메모를 쓴다. (agent)

## 단계

1. design: theme 모델과 accent 보정(OKLCH에서 명도를 옮겨 대비를 맞춘다). `presets.ts`의 background·accent를 내장 theme과 accent 함수로 바꾸고, `appearanceCss`는 "theme → accent → 글꼴·크기·밀도" 순으로 덮는다. gallery에 theme 고르기를 단다.
2. core: `shell.light_theme`, `shell.dark_theme`, `shell.accent`(theme 또는 hex) 설정과 `shell.background`를 없애는 data step. `themes/` 읽기, 검사, watch, 목록 API를 만든다.
3. shell: IPC `shell:appearance` 값에 풀린 theme 색을 싣고, main이 다시 검사해 CSS를 만든다. xterm은 지금처럼 token을 다시 읽는다. Settings › Appearance에 light·dark theme 고르기, accent picker, theme file 경고, "themes 폴더 열기"를 단다.
4. 내장 Tokyo Night 두 판. 지키는 것 8번의 비율로 확인한다.

## 같이 고칠 문서

- `project-docs/architecture/appearance.md`: 모델, 값 표, 지키는 것 3·8·10번, 결정(0.2.0 결정을 뒤집은 기록).
- `project-docs/architecture/ui-kit.md`: token 층 설명.
- `project-docs/flows/`: Settings › Appearance의 동작, theme file watch.

## 하지 않는 것

- VS Code theme(`.json`) 바로 가져오기. token 이름 대응표가 필요한 따로 할 일이다. 지금은 agent에게 옮겨 달라고 하면 된다.
- 색이 아닌 token(간격, 모서리, 크기, 그림자)의 override.
- theme을 나누고 받는 곳(market).
- 앱이 자기 theme을 내는 것. 앱은 lophn이 고른 theme을 따른다.
