# appearance

사람이 고른 색(accent, 배경), 글꼴, 글자 크기, 밀도가 어떻게 lophn의 모든 문서(desktop 창, overlay, 보호 입력 창, 사용자 앱 화면)에 같이 닿는지를 다룬다. 앱 화면과 artifact 화면은 shell 창의 `<webview>` guest이고, main은 모든 webContents에 CSS를 넣는다. 흐름은 설정 → renderer → main → 모든 webContents의 CSS다. token과 component의 자리는 `ui-kit.md`다.

## 흐름

```
Settings › Appearance (renderer/desktop/settings/appearance)
  고르면 core 선언 설정 shell.*(아래 표의 key)에 저장 ─┐
  시작 때 core가 준비되면 같은 설정을 읽는다           │
        │ lophnAppearance.set(Appearance 아홉 값)      │
        ▼                                              │
main  wiring/appearance.ts  (channel shell:appearance)
  1. parseAppearance로 검사(목록 밖 값이면 전체 거절)
  2. nativeTheme.themeSource = theme
  3. appearanceCss(appearance) → token을 덮어쓰는 CSS
  4. lophn 문서(lophn-shell://, lophn-app://, lophn-artifact://, `<webview>` guest 포함)의 webContents마다 insertCSS. artifact 문서에는 tokens.css가 없어 token 정의 전체(`renderCss`)를 appearance CSS 앞에 붙인다
        - 값이 바뀌면 removeInsertedCSS로 옛 것을 지우고 새로 넣는다
        - web-contents-created의 dom-ready마다 지금 CSS를 다시 넣는다
```

- desktop renderer가 유일한 보내는 쪽이다. main은 caller host가 `desktop`인지 보고 값을 다시 검사한다. renderer는 자기 문서의 `data-theme`만 직접 쓴다. 나머지는 모든 문서가 같은 경로(main의 insertCSS)로 받아 desktop 창도 앱 화면 guest와 같은 CSS를 받는다.
- main은 처음에 값을 모른다. desktop 창이 core가 준비된 뒤 읽어 보내면 그때부터 지금 열린 모든 문서와 이후 열리는 문서에 넣는다. 그 전 한 번은 기본 모양이다.
- CSS는 insertCSS라 앱 화면 guest의 CSP를 지나서도 들어간다. 그래서 CSS 문자열에 들어가는 값은 모두 `packages/design/presets.ts`의 상수이거나 검사한 Custom 글꼴 이름이다. guest도 `web-contents-created`의 `dom-ready`마다 같은 길로 받는다(문서 URL로 고른다).

## 값과 preset

`packages/design/presets.ts`가 preset을 가진다. 모양이 `tokens`와 같은 경로라서 `flatten`(`packages/design/flatten.ts`)하면 CSS 변수 이름이 token과 같다. 기본 preset은 아무것도 덮지 않는다.

| 설정 key | 값(기본 먼저) | 바뀌는 token |
|---|---|---|
| `shell.theme` | system, light, dark | CSS가 아니라 `data-theme`과 `nativeTheme.themeSource` |
| `shell.accent` | ink, blue, green, purple, orange | `color.ink`(background·text·hover), `color.focus`, `color.selection` |
| `shell.background` | warm, neutral, cool | `color.surface` 넷, `color.border` 셋, `color.text` 넷, `code.foreground`, `tabStrip.bar·hover`, `floating.surface·hover` |
| `shell.font`, `shell.font_custom` | pretendard, system, custom | `font.sans` |
| `shell.code_font`, `shell.code_font_custom` | jetbrains-mono, system, custom | `font.mono` |
| `shell.text_size` | default, small, large | `type.*.size·line`(비율 0.92, 1.12) |
| `shell.density` | comfortable, compact | `control`, `field.gap`, `menu.row`, `tree.row`, `palette.item`, `layout.panePadding`, `tab.contentGap` |
| `shell.reading_width` | narrow, default, wide | CSS가 아니다. 문서가 따로 읽는다 |

- accent: 고른 tab 강조선(`TabStrip`의 focus 칸, design `Tabs`의 밑줄, 맨 위 `FloatPanel`의 bar 위 강조선), primary Button·Switch·badge, focus ring, 고른 행의 selection 바탕이 따른다. link(`color.link`)는 accent에 묶지 않는다. link는 "누르는 것"을 알리는 뜻이라 accent가 Ink(검정)일 때도 파랑으로 남아야 한다.
- 대비를 지키는 값만 둔다. ink 글자와 바탕(hover 포함) 4.5:1 이상, focus ring과 모든 background preset의 surface 3:1 이상, selection 위 text 4.5:1 이상, primary·secondary·muted 글자와 모든 surface 4.5:1 이상이다. 값을 바꿀 때는 이 비율을 계산해 확인한다(WCAG 상대 휘도).
- Custom 글꼴 이름은 CSS 문자열 안에 들어간다. `isFontName`이 글자·숫자·공백·`-`·`_`(1~64자)만 받는다. 따옴표, 괄호, 세미콜론, 중괄호, 역슬래시, 줄바꿈은 들어올 수 없어 문자열 밖으로 나갈 수 없다. renderer는 이 규칙으로 저장 전에 거절하고, main의 `parseAppearance`는 어긴 이름만 버려 기본 글꼴로 둔다. core는 길이만 본다. 이 규칙은 앱 화면 guest에 들어가는 CSS의 injection을 막는 경계다.
- 글꼴 stack: custom은 `"<이름>", "Pretendard Variable", system-ui, sans-serif`처럼 기본 stack으로 이어진다. 이름의 글꼴이 설치돼 있지 않아도 깨지지 않는다.

## CSS 모양

`appearanceCss`(`packages/design/appearance.ts`)는 순수 함수다. 기본이 아닌 선택만 덮고, 모두 기본이면 빈 문자열이다. `tokens.css`와 같은 구조를 따른다.

```
html:root { light 값과 글꼴·크기·밀도 }
html[data-theme="dark"] { dark 값 }
@media (prefers-color-scheme: dark) { html:root:not([data-theme="light"]) { dark 값 } }
```

- 선택자에 `html`을 붙여 `tokens.css`의 같은 규칙보다 우선순위가 한 칸 높다. 문서 안 stylesheet의 순서와 상관없이 이긴다.
- desktop 창은 `data-theme`으로, overlay·보호 입력 창·앱 화면·artifact 화면 guest는 `data-theme`이 없어 `prefers-color-scheme`으로 theme을 따른다. main이 `nativeTheme.themeSource`를 맞춰 그 문서들이 같은 theme이 된다.
- xterm 터미널은 색을 CSS가 아니라 option으로 받는다. `terminal/xterm-view.ts`가 surface·text·selection token을 쓰는 숨은 요소의 transition으로 값이 바뀐 것을 알고 색(바탕, 글자, 선택, ANSI `terminal.*`)을 다시 읽는다. 숨은 탭에서는 transition이 돌지 않아 탭을 보일 때(fit) 다시 읽는다.

## 사용자 앱에 닿는 길

앱은 `@lophn/ui/tokens.css`의 같은 변수를 쓰므로 main의 insertCSS가 앱 화면 guest에도 같은 변수를 덮는다. 앱 CSS가 token 변수만 쓰면 따라 바뀐다(앱 template의 `AGENTS.md`가 시킨다). hex 색이나 글꼴 이름을 직접 쓴 앱은 바뀌지 않는다. 검사하지 않는다.

같은 dom-ready에서 main은 앱 화면 guest(`lophn-app://`) 문서의 `<html>`에 `data-lophn-locale`(lophn 화면의 언어, `packages/design/i18n`의 `LOPHN_LOCALE`)을 `executeJavaScript`로 적는다. CSP가 페이지 script를 막아도 main이 넣는 script는 돈다. 값은 상수라 페이지 입력이 섞이지 않는다. `@lophn/app-ui`가 이 속성을 보고 자기 문구의 언어를 고르고, 값이 바뀌면 다시 그린다.

## 하지 않는 것

- 사용자가 임의의 token 값이나 CSS를 넣는 길. 고르는 것은 preset과 설치된 글꼴 이름뿐이다.
- 이미 만든 xterm 터미널의 글꼴 갱신. xterm은 만들 때 `--font-mono`를 한 번 읽어서 새로 연 터미널부터 바뀐다.
- 다른 desktop 창의 `data-theme` 즉시 갱신. CSS 값은 모든 창에 바로 가지만 `data-theme`은 그 창이 설정을 다시 읽을 때 맞춘다.
- shadow의 색조(popover·dialog 그림자는 background preset과 상관없이 같다).
