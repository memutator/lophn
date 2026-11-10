# appearance

사람이 고른 색(accent, 배경), 글꼴, 글자 크기, 밀도, theme이 lophn의 모든 문서에 같이 닿게 하는 메커니즘이다. 문서는 desktop 창, overlay, 보호 입력 창, 사용자 앱 화면과 artifact 화면이다. 앱 화면과 artifact 화면은 shell 창의 `<webview>` guest다. 사람은 Settings › Appearance에서 preset과 설치된 글꼴을 고르고, 고른 값은 열린 문서와 이후 열리는 문서에 같은 모양으로 적용된다. token과 component의 자리는 `ui-kit.md`다.

## 문제

lophn은 사람이 오래 읽고 쓰는 앱이라 색과 글꼴을 자기 취향대로 바꾸고 싶어 한다. 문제는 화면이 한 문서가 아니라는 점이다. desktop 창, 따로 뜨는 overlay와 보호 입력 창, CSP가 걸린 사용자 앱 guest, token 정의가 아예 없는 artifact 문서가 모두 같은 변수를 쓴다. 문서마다 다른 길로 값을 받으면 한쪽만 바뀌고, 사용자 앱이나 AI가 만든 앱이 받는 CSS가 injection 경로가 된다. 사람이 고른 모양이 어느 문서에서는 적용되지 않거나, 값 하나로 앱 화면이 깨지거나, 앱마다 따로 놀면 이 메커니즘은 실패다.

## 목표와 비목표

- 목표: 사람이 고른 appearance가 shell 화면, overlay, 보호 입력 창, 앱 화면, artifact 화면에 같은 token 변수로 닿는다. token 변수만 쓴 앱은 따로 고치지 않아도 따라 바뀐다. 색 역할이 화면마다 같다. 대비를 지킨다.
- 비목표: 사용자가 임의의 token 값이나 CSS를 넣는 길(고르는 것은 preset과 설치된 글꼴 이름뿐이다). hex 색이나 글꼴 이름을 직접 쓴 앱 CSS를 검사하거나 고치는 일. shadow의 색조 바꾸기(popover·dialog 그림자는 background preset과 상관없이 같다). 이미 만든 xterm 터미널의 글꼴 즉시 갱신.

## 모델

고르는 값은 열네 개다. 모두 core의 선언 설정(`shell.*`)에 저장되고 기본 값이 있다. 열네 값은 하나의 묶음(Appearance)으로 다룬다. 문서 읽기 폭(`shell.reading_width`)은 이 묶음에 들지 않는다. 읽기 폭은 CSS가 아니라 문서가 따로 읽는다.

흐름은 설정 → desktop renderer → main → 모든 lophn 문서의 CSS다.

```
Settings › Appearance
  고르면 선언 설정 shell.*에 저장 ─┐
  시작 때 core가 준비되면 같은 설정을 읽는다
        │ Appearance 열네 값을 main에 보낸다 (IPC shell:appearance)
        ▼
main
  1. 값을 검사한다 (목록 밖 값이면 전체 거절)
  2. nativeTheme.themeSource = theme
  3. 기본이 아닌 선택만 token을 덮어쓰는 CSS로 만든다
  4. lophn 문서(lophn-shell://, lophn-app://, lophn-artifact://. <webview> guest 포함)의
     webContents마다 insertCSS한다
       - 값이 바뀌면 옛 CSS를 지우고 새 CSS를 넣는다
       - 문서를 새로 읽을 때마다(dom-ready) 지금 CSS를 다시 넣는다
       - artifact 문서에는 token 정의가 없어 token 정의 전체와 scroll 막대 규칙을 appearance CSS 앞에 붙인다
```

- 보내는 쪽은 desktop renderer 하나다. main은 보낸 쪽이 desktop 창 본문인지 보고 값을 다시 검사한다. renderer가 직접 쓰는 것은 자기 문서의 `data-theme`뿐이고, 나머지는 desktop 창도 앱 화면 guest와 같은 길(main의 insertCSS)로 받는다.
- main은 처음에 값을 모른다. desktop 창이 core가 준비된 뒤 설정을 읽어 보내면 그때부터 열린 모든 문서와 이후 열리는 문서에 넣는다. 그 전의 첫 한 번은 기본 모양이 잠깐 보일 수 있다.
- CSS는 insertCSS로 들어가 앱 화면 guest의 CSP를 지난다. 그래서 CSS 문자열에 들어가는 값은 preset 상수, 허용 목록의 굵기, 검사한 Custom 글꼴 이름뿐이다.
- 덮어쓰는 CSS를 만드는 규칙은 순수 함수 하나이고 main, gallery, test가 같은 규칙을 쓴다.

### 값과 preset

preset은 token과 같은 경로 모양이라 CSS 변수 이름이 token과 같다. 기본 preset은 아무것도 덮지 않는다. 기본이 아닌 선택만 덮고, 모두 기본이면 CSS는 빈 문자열이다.

| 설정 key | 값(기본 먼저) | 바뀌는 token |
|---|---|---|
| `shell.theme` | system, light, dark | CSS가 아니라 `data-theme`과 `nativeTheme.themeSource` |
| `shell.accent` | ink, blue, green, purple, orange | `color.ink`(background·text·hover·soft), `color.focus`, `color.selection` |
| `shell.background` | warm, neutral, cool | `color.surface` 다섯(floor·base·subtle·muted·shell), `color.border` 셋, `color.text` 넷, `code.foreground`, `tabStrip.bar·hover`, `floating.surface·hover` |
| `shell.font`, `shell.font_custom`, `shell.font_weight` | pretendard, system, custom / 100~900(400) | `font.sans`, `font.weight.regular`(UI 본문 굵기. medium·semibold는 그대로라 강조·제목은 따로 굵다) |
| `shell.code_font`, `shell.code_font_custom`, `shell.code_font_weight` | jetbrains-mono, system, custom / 100~900(400) | `font.mono`, `font.weight.mono`(`code`·`pre`·`.mono`, 코드 편집기, xterm) |
| `shell.reading_font`, `shell.reading_font_custom`, `shell.reading_font_weight` | ui, serif, custom / 100~900(400) | `font.reading`(문서·대화 본문: design `Markdown`, markdown 편집기), `font.weight.reading`. ui는 `font.sans`와 그 굵기를 따른다. serif는 글꼴을 싣지 않고 OS serif stack이다 |
| `shell.text_size` | default, small, large | `type.*.size·line`(비율 0.92, 1.12) |
| `shell.density` | comfortable, compact | `control`, `field.gap`, `menu.row`, `tree.row`, `palette.item`, `layout.panePadding`, `tab.contentGap` |
| `shell.reading_width` | narrow, default, wide | CSS가 아니다. 문서가 따로 읽는다 |

- `color.surface.shell`은 창 바탕(sidebar·title bar 뒤)이고 content card는 `surface.base`다. 각 background preset의 shell은 그 preset의 `subtle` light 값과 `floor` dark 값을 다시 쓴다.
- 모서리 `radius`는 xs 6, sm 8, md 10, lg 14, xl 20, full 9999px이고 preset으로 바뀌지 않는다. Dialog·Sheet·Palette는 xl, 떠 있는 표면(FloatPanel·Menu·Popover·Toast)은 lg, Tooltip·입력·Button은 md, SegmentedControl은 full이다.
- accent를 따르는 것: 고른 tab의 강조선(`TabStrip`의 focus 칸, design `Tabs`의 밑줄), primary Button·Switch·badge, focus ring, 고른 행의 selection 바탕.
- 글꼴 stack: custom은 `"<이름>", "Pretendard Variable", system-ui, sans-serif`처럼 기본 stack으로 이어진다. 이름의 글꼴이 설치돼 있지 않아도 깨지지 않는다. reading의 custom은 `font.reading`의 기본 stack으로 이어진다.
- 글꼴 고르기: 화면은 이름을 직접 받지 않는다. 글꼴 줄은 design `SearchSelect`(목록 위 검색 칸)에 preset과 설치된 글꼴을 두고, 설치된 글꼴을 고르면 `*_custom`에 family 이름을 쓰고 줄 값을 `custom`으로 한다. 옆 Select가 그 글꼴에 있는 굵기를 고르고, 글꼴을 바꿔 지금 굵기가 없으면 가장 가까운 굵기로 옮긴다. 앱에 실은 Pretendard·JetBrains Mono는 400~600, OS stack(system, serif)과 목록에 없는 이름은 400·700으로 고정한 목록이다.
- 설치된 글꼴: renderer가 Chromium Local Font Access(`queryLocalFonts`)로 OS 글꼴을 읽어 family와 굵기(style 이름과 PostScript 이름 끝에서, 기울임은 뺀다)로 묶는다. desktop 창은 기본 session이라 권한 handler 없이 허용된다. 화면을 열 때 읽고, 비어 있으면 글꼴 칸을 열 때(사람이 누른 때) 다시 읽는다. 앱에 실은 글꼴은 "(built in)"을 붙여 OS에 깐 같은 이름 글꼴과 구별한다. Custom 글꼴 이름 규칙을 어기는 family는 목록에서 뺀다. 저장된 이름이 목록에 없으면 그 이름에 Not installed를 붙여 preset 다음에 두고, 줄 아래에 기본 글꼴을 쓴다고 알린다.

### CSS 모양

덮어쓰는 CSS는 token 정의 CSS와 같은 구조를 따른다.

```
html:root { light 값과 글꼴·크기·밀도 }
html[data-theme="dark"] { dark 값 }
@media (prefers-color-scheme: dark) { html:root:not([data-theme="light"]) { dark 값 } }
```

- 선택자에 `html`을 붙여 token 정의의 같은 규칙보다 우선순위가 한 칸 높다. 문서 안 stylesheet의 순서와 상관없이 이긴다.
- desktop 창은 `data-theme`으로, overlay·보호 입력 창·앱 화면·artifact 화면 guest는 `data-theme`이 없어 `prefers-color-scheme`으로 theme을 따른다. main이 `nativeTheme.themeSource`를 맞춰 그 문서들이 desktop 창과 같은 theme이 된다.
- xterm 터미널은 색을 CSS가 아니라 option으로 받는다. 터미널은 surface·text·selection token을 쓰는 숨은 요소의 transition으로 값이 바뀐 것을 알고 색(바탕, 글자, 선택, ANSI `terminal.*`)을 다시 읽는다. 숨은 탭에서는 transition이 돌지 않아 탭을 보일 때 다시 읽는다. 글꼴과 굵기는 터미널을 만들 때 한 번만 읽어서 새로 연 터미널부터 바뀐다.

### 사용자 앱에 닿는 길

앱은 `@lophn/ui/tokens.css`의 같은 변수를 쓰므로 main의 insertCSS가 앱 화면 guest에도 같은 변수를 덮는다. 앱 CSS가 token 변수만 쓰면 따라 바뀐다(앱 template의 `AGENTS.md`가 시킨다). hex 색이나 글꼴 이름을 직접 쓴 앱은 바뀌지 않는다. 검사하지 않는다.

같은 dom-ready에서 main은 앱 화면 guest(`lophn-app://`) 문서의 `<html>`에 `data-lophn-locale`(lophn 화면의 언어)을 `executeJavaScript`로 적는다. CSP가 페이지 script를 막아도 main이 넣는 script는 돈다. 값은 상수라 페이지 입력이 섞이지 않는다. `@lophn/app-ui`가 이 속성을 보고 자기 문구의 언어를 고르고, 값이 바뀌면 다시 그린다.

## 지키는 것

1. 모든 lophn 문서(desktop 창, overlay, 보호 입력 창, 앱 화면, artifact 화면)가 같은 appearance를 받는다. 값이 바뀌면 지금 열린 문서가 바뀌고, 이후 열리는 문서와 새로 읽은 문서(dom-ready)에도 지금 CSS가 들어간다. lophn 것이 아닌 문서(devtools 등)에는 넣지 않는다.
2. main은 desktop 창 본문이 보낸 값만 받고, 받을 때 다시 검사한다. 고르는 값이 목록 밖이면 전체를 거절하고 아무것도 바꾸지 않는다. 거절은 응답 없이 끝난다.
3. CSS 문자열에 들어가는 값은 preset 상수, 허용 목록의 굵기, 검사한 Custom 글꼴 이름뿐이다. Custom 글꼴 이름은 글자·숫자(Unicode, 한글 포함)·공백·`-`·`_`로 1~64자만 받는다. 따옴표, 괄호, 세미콜론, 중괄호, 역슬래시, 줄바꿈이 들어올 수 없어 CSS 문자열 밖으로 나갈 수 없다. renderer는 저장 전에 이 규칙으로 거절하고, main은 어긴 이름만 버려 기본 글꼴로 둔다. core는 길이만 본다. 이것이 앱 화면 guest에 들어가는 CSS의 injection을 막는 경계다.
4. 기본이 아닌 선택만 token을 덮어쓴다. 모두 기본이면 덮어쓰는 CSS는 비어 있다. 단 artifact 문서에는 token 정의가 없으므로 CSS가 비어도 token 정의를 넣는다. scroll 막대도 OS 기본이 아니라 lophn 모양이어야 해서 `design/base.css`의 막대 규칙 사본을 같이 넣는다(body 배경·글꼴 file은 넣지 않는다. page의 것과 부딪친다).
5. 덮어쓰는 CSS는 문서 안 stylesheet의 순서와 상관없이 token 정의를 이긴다.
6. 색 역할이 같다. "주 행동·고른 것·켜진 것·지금 것"의 표시(primary 단추, 강조선, marker, 고른 option 바탕)는 `color.ink.background`다. `color.focus`는 키보드 focus ring, 글 넣는 칸의 focus 테두리, 끌기와 drop 신호(탭 줄 resizer, 칸 divider, drop 자리)에만 쓴다. `color.text.*`는 글자에만 쓰고 표시 색으로 쓰지 않는다. 기본 Ink는 focus·selection·`ink.soft`까지 무채색이라 화면에 accent 색이 하나뿐이다.
7. 되돌릴 수 없는 일을 실제로 하는 단추(지우기 확인, Rewind, 연결 끊기, 값 지우기, Workflow Stop)만 `color.danger`(채운 빨강, 흰 글자)다. accent에 묶지 않는다. Deny·Skip은 secondary다. link(`color.link`)는 accent에 묶지 않는다. link는 "누르는 것"을 알리는 뜻이라 accent가 Ink(검정)일 때도 파랑으로 남는다.
8. 대비를 지키는 값만 둔다. ink 글자와 바탕(hover 포함) 4.5:1 이상, focus ring과 모든 background preset의 surface 3:1 이상, selection 위 text 4.5:1 이상, primary·secondary·muted 글자와 모든 surface 4.5:1 이상이다. 값을 바꿀 때는 이 비율을 WCAG 상대 휘도로 계산해 확인한다.
9. 굵기는 그 글꼴의 본문 굵기만 바꾼다. 강조·제목 굵기(medium, semibold)는 그대로 더 굵다.
10. 사람이 고르는 것은 preset과 설치된 글꼴 이름뿐이다. 임의의 token 값이나 CSS를 넣는 길은 없다.
11. 설치되지 않은 글꼴 이름이 저장돼 있어도 깨지지 않는다. 기본 stack으로 이어지고, 화면은 Not installed와 기본 글꼴을 쓴다는 안내를 보인다.

## 경계와 계약

- IPC channel `shell:appearance`(preload `lophnAppearance.set`). 값은 Appearance 열네 값이다. 응답이 없다. 보낼 수 있는 쪽은 desktop 창 본문이다. boundary-catalog의 `shell`, `design-api`에 걸친다.
- 설정 key(core 선언 설정): `shell.theme`, `shell.accent`, `shell.background`, `shell.font`, `shell.font_custom`, `shell.font_weight`, `shell.code_font`, `shell.code_font_custom`, `shell.code_font_weight`, `shell.reading_font`, `shell.reading_font_custom`, `shell.reading_font_weight`, `shell.text_size`, `shell.density`, `shell.reading_width`(CSS가 아님). 모두 기본 값이 있고 없으면 기본으로 읽힌다. `*_custom`은 core가 길이(64)만 검사한다.
- 문서 scheme: `lophn-shell://`, `lophn-app://`, `lophn-artifact://`만 CSS를 받는다. `lophn-app://`만 `data-lophn-locale`을 받는다.
- token 변수: preset이 덮는 변수는 위 표의 token이 이름이다. 앱은 `@lophn/ui/tokens.css`로 같은 변수를 쓴다.
- 저장 순서: 화면은 고르면 main에 먼저 보내고 `shell.*` 설정을 한 줄씩 쓴다. 쓰기가 하나라도 실패하면 저장된 값을 다시 읽어 그 모양으로 돌아가고 main에도 그 값이 간다. 읽기가 실패하면 적용하지 않고 오류 화면(다시 시도)을 보인다.
- 오류 code는 따로 두지 않는다. main의 거절은 응답 없이 끝난다.

## 결정

- 사람이 고르는 shell theme과 token override를 한다. 그동안 `ui-kit.md`가 비목표로 두었던 것을 이번에 하기로 정했다. 단 고르는 것은 preset과 설치된 글꼴 이름뿐이고 임의 token이나 CSS를 넣는 길은 없다. (사람, 0.2.0)
- 기본 Ink에서는 focus도 무채색이다. 이유: primary 단추는 검정·흰색인데 focus·selection·고른 표시가 파랑이라 화면에 accent가 둘로 보였고 사람이 accent가 blue인 줄 알았다. 버린 안: focus만 파랑으로 남기기. (사람, 0.13.0)
- link(`color.link`)는 accent에 묶지 않는다. 이유: link는 누르는 것을 알리는 뜻이라 Ink(검정) accent에서도 파랑이어야 한다. 버린 안: accent를 따라 link 색을 바꾸기(Ink에서 구별이 사라지고 값이 늘어난다). (agent, 0.2.0)
- preset은 기본 token 정의 밖에 따로 둔다. 이유: token 정의 안에 두면 CSS 변수 생성기가 preset까지 변수로 만들어 버린다. (agent, 0.2.0)
- 덮어쓰는 CSS를 만드는 규칙은 design에 둔다. 이유: main, gallery, test가 같은 규칙을 써야 하고 main은 design을 import할 수 있다. (결정자 기록 없음, 0.2.0)
- 시작 때 값은 renderer가 core에서 읽어 main에 보낸다. main이 core를 직접 읽지 않는다. 이유: theme을 보내던 길과 같다. 첫 한 번은 기본 모양이 잠깐 보일 수 있다. (agent, 0.2.0)
- Custom 글꼴 이름에 한글 같은 Unicode 글자와 숫자도 받는다. 문자열 밖으로 나갈 수 있는 글자는 여전히 받지 않는다. (agent, 0.2.0)
- 읽기(reading) 글꼴을 UI 글꼴과 따로 고른다. 이유: lophn은 문서와 긴 agent 대화를 오래 읽는 앱이다. 요청은 사람이 했다. (사람, 0.17.0)
- 읽기 글꼴의 선택지는 UI 글꼴 따르기(기본), Serif, Custom이다. Serif는 글꼴 파일을 싣지 않고 OS serif stack(Noto Serif KR, 나눔명조, Georgia 순)이다. 기본은 화면이 그대로다. (agent, 0.17.0)
- 굵기는 글꼴마다 본문 굵기만 바꾸고 강조·제목은 원래대로 더 굵게 둔다. 버린 안: 모든 글자를 고른 굵기 하나로(위계가 사라진다). (agent, 0.17.0)
- 설치된 글꼴 목록은 core나 main이 아니라 renderer가 Local Font Access로 읽는다. 이유: desktop 창은 기본 session이라 권한 handler 없이 사람의 클릭 없이도 읽힌다. 버린 안: main에서 `fc-list`(Linux만 된다). (agent, 0.17.0)
- 굵기는 style 이름과 PostScript 이름 끝을 같이 본다. 이유: 한국어 이름 글꼴은 style이 "굵은", "가는"처럼 OS 언어로 온다. (agent, 0.17.0)
- 기본 글꼴과 OS stack의 굵기는 고정 목록이다. 실은 글꼴은 400~600, OS stack과 목록에 없는 이름은 400·700. (agent, 0.17.0)
- 탭 줄 resizer·칸 divider·drop 표시는 끌기 신호라 `color.focus`를 쓴다. (agent, 0.13.0)
- 되돌릴 수 없는 일에만 danger 단추를 쓴다. 이유: 줄마다 채운 빨강이 서면 과하다(bookmark 줄의 Remove는 바로 지워도 secondary다). 앱이 되돌릴 수 있는 Deny·Skip도 secondary다. (agent, 0.13.0)
- 앱 화면의 언어는 appearance가 이미 앱 화면에 닿는 dom-ready 길로 보낸다. 새 preload API를 만들지 않는다. (사람, 0.10.2)
- 새 설정 key는 기본 값이 있어 data root를 옮기지 않는다. 저장 모양(`shell.font`의 custom과 `shell.font_custom` 이름)은 그대로라 예전에 쓴 이름은 목록에서 고른 값으로 이어진다. (agent, 0.17.0)

## 열린 것

- 다른 desktop 창의 `data-theme`은 즉시 바뀌지 않는다. CSS 값은 모든 창에 바로 가지만 `data-theme`은 그 창이 설정을 다시 읽을 때 맞춘다.
- 이미 만든 xterm 터미널의 글꼴과 굵기는 새로 열어야 바뀐다.
- shadow의 색조는 background preset과 상관없이 같다.
- 언어를 고르는 설정은 없다. 앱 화면에 적는 `data-lophn-locale`은 en 상수다.
- 앱이 hex 색이나 글꼴 이름을 직접 쓰면 appearance가 닿지 않는다. 검사하지 않는다.
