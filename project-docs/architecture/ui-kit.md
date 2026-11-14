# ui-kit

lophn이 내놓는 범용 UI component(kit, package `@lophn/ui`)가 lophn 화면(renderer), 사용자 앱, 봉한 artifact view에 어떻게 닿는지, 사람이 그것을 어디서 보고 승인하는지, 앱이 고정한 SDK 판이 바뀔 때 어떻게 알리고 옮기는지를 다룬다. 흐름은 token → kit → renderer·사용자 앱·artifact → gallery다. Boundary는 `design`(library), `design-api`(공개 API), `sdk-api`, `app-releases`다.

## 문제

- 같은 component를 lophn 화면과 사용자 앱이 따로 갖거나 복사해 쓰면 모양이 갈라지고, 사람은 무엇이 정본인지 볼 곳이 없다.
- 사용자 앱은 사용자와 agent가 고치는 코드다. 그 변경이 lophn 화면을 깨면 안 되고, lophn이 UI를 고쳐도 이미 만든 앱이 깨지면 안 된다.
- 앱을 고치는 agent는 설치된 SDK 사본을 file tool로 읽지 못한다. kit에 무엇이 있고 props가 무엇인지 알 길이 없으면 추측해서 만들거나 있는 component를 새로 만든다.
- 봉한 artifact view는 module을 import하지 못하고 바깥 library도 받지 못한다. 그래도 workflow 그림 같은 kit component를 쓸 수 있어야 한다.
- SDK 판이 바뀌면 고정 판을 쓰는 앱이 옮겨야 할 것이 생기지만, 사람은 SDK 변화가 무엇을 깨고 무엇을 가능하게 했는지 판단하지 못한다.

## 목표와 비목표

- 목표
  - 사용자 앱도 그대로 쓸 만한 component를 한 곳(kit)에 두고 lophn 화면과 사용자 앱이 같은 것을 쓴다.
  - 사용자 변경이 lophn 화면을 깨지 않고, lophn의 UI update가 사용자 앱을 깨지 않는다.
  - agent가 분류 이름으로 kit을 찾아 들어가고, 이름·"언제 쓰나"·props를 한 번의 읽기로 안다.
  - 사람이 gallery에서 실제 component를 보고 승인한다.
  - SDK 판이 바뀐 앱을 사람이 알고, 사람이 맡기면 lophn이 옮긴다.
- 비목표 (일부러 하지 않는 것)
  - preview, slot, eject CLI, 앱 CSS 검사. 사용자가 component를 고치려면 그 file을 앱 `src/`로 복사해 쓰고, 복사한 file은 앱 것이라 lophn의 UI update가 닿지 않는다.
  - 사용자가 token을 직접 쓰는 길. 사람이 고르는 것은 preset과 설치된 글꼴 이름뿐이다(`architecture/appearance.md`).
  - 앱 화면 문구의 번역. 앱은 사용자 한 사람이 쓰므로 번역 catalog가 없고 문구는 앱 코드에 그대로 쓴다.
  - 옛 판 SDK 사본을 data root에 따로 싣기. 지원 하한 아래의 앱은 처음 다시 release할 때 옮긴다.

## 모델

```
design (package @lophn/ui)       범용 kit. 사용자 앱도 그대로 쓸 만한 것만
  token → 생성된 CSS 변수·이름 표
  appearance preset              사람이 고르는 색·글꼴·크기·밀도를 token 덮어쓰기 CSS로(밀도 touch는 폰 remote 화면의 것)
  분류 8개                        primitives, input, layout, navigation, data, feedback, overlay, reading
  _shared                        분류에 안 드는 지원 export
  i18n (package @lophn/i18n)     문구 catalog와 t(), locale별 translator. @formatjs/intl 위의 얇은 층
        │ workspace import
        ├────────────▶ lophn 화면(renderer)    lophn 전용 부품(Avatar, VendorIcon, TabStrip 등)은 renderer 쪽
        │ 판 고정 사본(npm file: 의존)
        └────────────▶ 사용자 앱 화면          @lophn/ui/<분류>로 import
app-ui (package @lophn/app-ui)   앱 bridge를 쓰는 UI만: tool 호출 단추, 호출 hook, place hook, 오류 경계
artifact kit                     판 고정 browser build 하나. 전역 LophnKit 하나(kit 전체, React, 머리 줄 hook)
gallery                          사람이 보고 승인하는 곳. 실제 component를 import만 한다
```

component는 분류 폴더 하나 안에 있고(tsx, module CSS, 보조 file), 분류마다 공개 목록 file이 하나 있다. 그 목록의 `export { … } from` 문 하나가 component 하나(와 그 Props type)이고, 값을 내보내는 문마다 바로 윗줄에 "언제 쓰나" 한 줄(`// …`)이 있다. 비슷한 것과 갈리는 지점을 쓴다(Popover와 Menu, Dialog와 Sheet, Table과 DataTable). 이 줄들이 kit의 목록이고, agent는 분류 이름 8개로 찾아 들어가 그 목록을 읽는다.

### 무엇을 어디에 두나

기준은 범용성이다. "사용자 앱도 그대로 쓸 만한가."

| 경우 | 위치 | 예 |
|---|---|---|
| 범용 | kit의 분류 | Button, Dialog, DataTable, AppShell, Sidebar, FilterBar, ReadState, ToastProvider |
| lophn만의 뜻(session, agent, harness·provider, 대기 질문)이 이름이나 동작에 박힘 | renderer(parts 또는 그 화면 폴더) | Avatar(agent character SVG와 profile 표시), VendorIcon, TabStrip(점이 session 상태), model picker |
| lophn과의 약속(tool 호출 `lophnApp.callTool`, 열린 자리·인자·workspace `lophnApp.place`, `lophn:render-error` event)을 앎 | `@lophn/app-ui` | ToolButton, useTool, usePlace, AppErrorBoundary |
| 쓰는 곳이 gallery뿐 | 두지 않는다 | (지운 것: Chip, AuthorMark, LauncherFrame, OverviewFrame) |

### chart와 GraphDiagram

- chart(LineChart, BarChart, DistributionChart, ScatterChart, GraphDiagram)는 `data` 분류이고 `@lophn/ui/data`로 나간다. d3는 design의 npm 의존이다(d3-scale, d3-shape).
- GraphDiagram의 node는 `status`(label, tone)와 짧은 `note`를 받는다. tone은 token `status`의 key이고 아이콘에만 색을 쓴다. component는 상태 값의 뜻을 모른다. 뜻은 그리는 쪽(workflow artifact, domain)이 정한다.
- 되돌아가는 edge(도착 층이 출발 층보다 앞)는 node 줄 위 여백으로 돌려 그린다. 되돌아가는 edge마다 여백에 줄 하나(16px)를 더하고, 출발 node 위에서 나가 그 줄을 지나 도착 node 위로 들어간다. 한 층 되돌아가는 edge도 같은 규칙이다. 출발이나 도착 node 위에 같은 층의 다른 node가 있으면 그 끝은 옆 면에서 층 사이 틈으로 돈다. label은 위 가로 구간 가운데다. 이렇게 하지 않으면 사이 node 뒤로 지나서 첫 step으로 돌아가는지 사이 step으로 가는지 화면으로 가르지 못한다(eval loop의 끝 step → 첫 step).

### 앱 SDK 판과 지원 하한

- SDK(`@lophn/ui`, `@lophn/app-ui`, `@lophn/declaration`, `@lophn/agent` 등)는 앱이 정확한 판으로 고정한다. 제품 판은 root 하나이고 SDK 판은 package마다 따로다.
- 각 SDK와 지원 소스의 `package.json`에 `lophn.supported_from`(lophn이 아직 돌리는 가장 옛 판)이 있다. 설치 사본은 `package.json`을 의존 경로만 바꿔 그대로 담으므로 이 칸도 사본에 남는다. 고정 판이 하한보다 옛것이면 앱은 못 뜨거나 곧 못 뜬다.
- 하한은 그 판으로 봉인한 bundle이 지금 core에서 뜨는지와 사본이 기대는 판이 설치돼 있는지로 정한다. 예: `@lophn/declaration` 4.0.0은 `sizes`로 봉인한 bundle이 안 떠서 하한이고, `@lophn/app-ui`는 4.0.0에 기대는 2.3.0부터다.
- 판이 바뀔 때 앱이 옮길 곳은 내장 skill `migrate-sdk`의 메모다. 판 하나가 메모 file 하나(`<패키지 이름에서 @lophn/를 뺀 것>-<판>.md`, 예: `declaration-4.0.0.md`)이고, 무엇이 바뀌었나, `Breaking:`, 앞 판에서 옮기는 code before/after, `Previous:`(앞 판)를 적으며 지우지 않는다. 앱 agent는 고정 판 뒤부터 지금 판까지의 메모만 `Previous:`를 따라 `skill.read`로 읽는다. skill 본문은 절차 하나라 판이 늘어도 길어지지 않는다.

### SDK 상태 read

앱이 고정한 판과 지금 판의 차이는 read `app.sdk_status {app?}`(`lophn app sdk-status [<앱>]`, home·앱 workspace, 사람·agent·machine)가 낸다. 계약 오류는 `invalid_input`, `unauthorized`, `forbidden`, `not_found`, `unavailable`이다.

- 보관하지 않은 앱 중 켜진 release가 있는 앱마다, 그 release에 봉인된 선언의 `sdk_dependencies`(정확한 판) 가운데 `@lophn/*`를 `{sdk, pinned, current, supported_from, level, notes, unreviewed}`로 싣고 앱마다 `review`를 싣는다. `current`는 설치 사본의 가장 높은 판이다.
- `level`은 `required`(고정 판 < 그 SDK 설치 사본의 `supported_from`), `available`(하한 이상이지만 지금 판보다 옛것), `current`다.
- `notes`는 `migrate-sdk` 메모 file 이름 가운데 고정 판 다음부터 지금 판까지를 판 순으로 낸 것이다. `Previous:` 사슬을 따르지 않고 file 이름으로 거른다. `current`면 비어 있다.
- `unreviewed`는 home이 그 앱을 두고 마지막으로 결정한 판(마지막 review의 `through`)과 고정 판 가운데 높은 쪽 다음부터 지금 판까지의 메모다. 결정이 없으면 `notes`와 같다. `notes`는 앱 lophn이 판을 올릴 때 읽는 범위이고 `unreviewed`는 home이 판단할 범위다.
- `review`는 앱의 마지막 결정이다: `decision`(`leave`·`update`), 시각, `through`(그때의 지금 판, SDK마다), `migrated`(`update`일 때 지금 고정 판이 `through`에 닿았는지. 저장하지 않고 지금 pin과 견줘 계산하고 `leave`면 null), 고른 기능과 state·한 줄 사유. 앞선 결정의 기능이 아직 `open`이면 같이 싣는다(다음 결정이 덮어 조용히 잊히지 않게). 결정이 없으면 null이다.
- 설치 사본에 없는 SDK 이름은 견줄 수 없어 뺀다.
- 파일을 읽으므로 reader Worker가 아니라 메인 스레드 read다(`app.icon`·`app.skills`와 같다).
- 앱 범위와 archived는 다른 앱 read와 같은 `authorizeApp`이 거른다. 앱 workspace의 agent는 자기 앱만 보고, archived 앱은 agent에게 없는 앱(`not_found`)이며 목록에서 빠진다.

## 지키는 것

1. 사용자 변경이 shell을 깨지 않는다. shell은 repo의 design만 import하고 sdk와 앱을 모르며, 설치 사본은 read-only다(file 0444, 폴더 0555).
2. lophn update가 실행 중인 앱을 깨지 않는다. 앱은 판을 고정하고, release bundle에 굳힌 사본으로 돈다. 같은 판 번호의 byte를 바꾸지 않는다(lock이 있는 기존 앱의 `npm ci`가 실패한다). 바꾸려면 판을 올린다.
3. import 방향은 `design: []`, `sdk: [protocol, design]`, `shell: [protocol, base, design]`이다. design은 renderer·sdk를 모르고, shell은 sdk를 모르고, sdk는 shell을 모른다.
4. design 안 file끼리는 component file을 상대 경로로 직접 가리킨다. 분류 공개 목록이나 package 이름(`@lophn/ui/...`)을 거치지 않는다. 거치면 chart frame이 자기 분류의 공개 목록을 다시 import하는 순환이 생긴다.
5. CSS는 token 변수만 쓴다. design, renderer, 각 sdk package 모두 검사한다. 사람이 고른 appearance는 같은 token 변수를 덮어써서 모든 문서와 사용자 앱에 닿는다(`architecture/appearance.md`).
6. design은 자기가 모르는 능력(syntax highlight)을 React context로 받는다. context가 없는 곳(사용자 앱, gallery의 다른 Row)은 plain이다. design은 shiki를 import하지 않고 앱 template의 의존도 늘지 않는다.
7. 분류 공개 목록의 값 export마다 "언제 쓰나" 한 줄이 윗줄에 있다. 분류 폴더 밖의 component는 없다.
8. gallery는 실제 component를 import만 한다. gallery 안에 component 모양을 흉내 낸 CSS 사본을 두지 않는다.
9. 앱 화면에서 쓰는 npm 의존(react, radix, lucide, markdown parser, icon json, d3 등)은 SDK 사본의 `package.json`이 정확한 판으로 갖는다.
10. 앱 화면 build는 고정된 package 밖의 import를 거절한다.
11. 앱을 고치는 agent는 `package.read @lophn/ui` 한 번으로 모든 분류의 이름과 "언제 쓰나" 줄을 받는다. props 정의가 예산 때문에 밀려도 분류가 사라지지 않는다.
12. SDK 판을 올리면 메모를 같이 쓴다. 지금 판과 하한의 메모, 하한이 판보다 높지 않은 것, 메모 사슬이 check에서 맞아야 한다.
13. 앱마다 SDK 알림 줄을 두지 않는다. 앱 없는 program 줄 하나가 숲의 입구다.
14. artifact kit의 전역은 하나(`LophnKit`)이고 앱이 `@lophn/ui/<분류>`로 받는 분류 8개를 그대로 싣는다(`LophnKit.ui.<분류>`). token은 artifact 문서에 appearance가 이미 넣은 것을 쓴다. 판은 repo의 lock이 잠근 그대로이고 artifact는 판을 고정하지 않는다: lophn이 kit을 바꾸면 이미 쓴 artifact도 따라 바뀐다.

## 경계와 계약

### 공개 export

- design package export: root(token, 이름 표, appearance preset과 CSS 만들기), 분류 8개(`./primitives`, `./input`, `./layout`, `./navigation`, `./data`, `./feedback`, `./overlay`, `./reading`), `./shared`(지원 export), `./base.css`, `./tokens.css`. 분류를 건너 한꺼번에 내는 barrel은 없다.
- `@lophn/app-ui`는 앱 bridge를 쓰는 UI(ToolButton, useTool, usePlace, 오류 경계, 화면 머리 단추 hook 등)를 낸다. 문구는 `@lophn/i18n`의 catalog에서 나오고, 앱 view 문서의 `<html data-lophn-locale>`(main이 dom-ready마다 적는다, `architecture/appearance.md`)로 locale을 고른다. 값이 없거나 그 locale의 catalog가 없으면 en이다. 새 preload API는 없다.
- reading의 `CodeBlock`은 highlighter를 `HighlighterProvider`에서 받아 token 배열을 span으로 그린다. 색은 design token `code.*`(Shiki css-variables theme의 `--code-*` 변수와 같은 이름)다. shell desktop 창이 Shiki Worker를 주고, context가 없는 곳은 plain이다.

### 사용자 앱에 닿는 길

1. 앱 template이 `@lophn/ui`(root와 sub-path 11개), `@lophn/app-ui`, `@lophn/declaration`을 `package.json`의 `file:.lophn/<설치 경로>` 의존으로 적는다.
2. 설치 사본은 data root의 `sdk/<이름 뒤쪽>/<판>`(예: `sdk/ui/1.1.0`)에 있다. 앱 `package.json`이 거는 사본을 앱 폴더의 `.lophn/sdk`로 복사한 뒤, lock이 있으면 `npm ci`, 없으면 `npm install`로 의존을 받는다. npm은 `node_modules/@lophn/*`를 그 사본으로 잇는 symlink로 깔고, Node는 symlink의 실제 경로가 `node_modules` 밖일 때만 그 `.ts`를 돌린다. 사본의 npm 의존과 사본끼리의 `file:` 의존은 앱 `node_modules`에서 풀린다. release 준비도 staging에서 같은 일을 한다. agent shell의 `npm`은 의존을 깔기 전에 사본을 먼저 맞춘다. 그래서 agent가 SDK 의존을 더한 뒤 바로 `npm install`이 그 사본을 찾는다.
3. 화면 build는 `@lophn/declaration`, `@lophn/ui`, `@lophn/app-ui`, `@lophn/agent`, `@lophn/i18n`, `react`, `react-dom`을 external로 둔다. `@lophn/ui/overlay` 같은 sub-path도 같이 external이다. 이 밖의 package는 build가 거절한다.
4. release 준비가 staging의 `.lophn/sdk` 사본과 `node_modules`를 release bundle에 굳힌다. symlink는 `node_modules/.lophn-links.json` 목록으로 굳히고 bundle 사본을 봉인할 때 연결을 다시 만든다(npm package의 `node_modules/<이름>` symlink를 따라 복사하지 않는다). 실행 중인 앱은 그 bundle의 사본만 본다.
5. 앱을 고치는 agent는 template `AGENTS.md`(lophn-managed 절)에서 화면 component는 `@lophn/ui/<분류>`, 앱 bridge component는 `@lophn/app-ui`, 앱 CSS는 `tokens.css`의 변수만 쓰라고 안내받는다.

설치 사본과 앱 template은 core가 기동할 때 repo에서 깐다. 같은 byte면 그대로 두고 다르면 지우고 다시 쓴다. 사본 밖 protocol을 가리키는 sdk(declaration, cap-store, cap-problem)는 그 file을 사본 안 `vendor/`에 담고 specifier를 바꾸며, vendor로 담은 `@lophn/protocol`은 사본 `package.json`의 의존에서 뺀다.

### kit guide (`packages.builtin`, `package.read`)

내장 sdk는 package catalog에 등록하지 않는다. 설치 사본이 정본이다. 모든 workspace 종류의 `package.read` 목록은 `builtin` 칸에 설치 사본의 `@lophn/*` 이름과 판을 싣고, `@lophn/` 이름을 주면 설치 사본의 판과 guide를 읽는다(route `packages.builtin`).

- `@lophn/ui`는 `guide.md`가 없다. 분류 공개 목록의 export 이름과 "언제 쓰나" 줄을 분류별로 모으고, 그 줄마다 props를 붙여 guide로 준다. props는 같은 export 문이 내보내는 type(`SelectProps` 등)의 정의를 component source에서 주석째 옮긴 것이고, `extends`가 가리키는 같은 file의 type(`NativeInput` 등)도 붙인다. 내보낸 type이 없는 component는 함수 인자 type이다. 쓰는 예는 싣지 않는다. 앱을 고치는 agent는 설치 사본을 file tool로 읽지 못해 이 guide가 props를 아는 길이다.
- props는 guide 예산 20 KiB 안에서만 붙고, 분류마다 한 번에 하나씩 돌아가며 배분한다. 예산 밖으로 밀린 props가 있는 분류에는 `- props 정의는 예산 밖이라 뺐다; ...` 한 줄이 남는다. 분류마다 `## 분류`, 설명, `import from` 줄, `- 이름: 언제 쓰나` 줄은 늘 있다. 뺀 props는 앱 폴더의 사본(`.lophn/sdk/ui/<판>/components/<분류>/**`)에서 읽는다. 생성은 결정적이다.
- 예산은 tool 결과 한 창(`TEXT_MAX_BYTES`, 24 KiB)보다 작아 색인과 예산 안의 props가 한 번에 온다. 그보다 긴 guide(`guide.md`를 쓰는 SDK)는 `package.read`가 창을 나눠 주고, 결과 `content`에 `guide_offset_bytes`·`guide_size_bytes`, `continuation.read_next`(`offset_bytes=<다음 창의 시작>`)를 싣는다. 입력 `offset_bytes`는 `name` 없이 주면 `invalid_input`이다. 창은 결과 JSON 전체가 상한 안에 들도록 JSON overhead를 빼서 재고, 내장 SDK와 사용자 package가 같은 규칙을 쓴다.

### SDK 업데이트 감지와 맡기기

- 감지는 core가 새 제품 판으로 켜질 때, 또는 설치된 SDK 판의 묶음이 지난 기동과 달라졌을 때(제품 판이 같아도) 한 번이다. 설치된 SDK 판 묶음(part → 가장 높은 판)은 제품 판 marker 옆 같은 키 값 표에 적고 기동마다 견준다(`architecture/app-notice.md`의 "제품 판 marker"). 새 표나 data root file은 만들지 않는다.
- 필수(`required`) SDK가 있거나 아직 검토하지 않은 메모(`unreviewed`)가 있는 앱이 하나라도 있으면 앱 없는 program 줄 `sdk_update_needed` 하나를 쓴다. params는 `{required, available}`(옮겨야 하는 앱 수, 필수는 없고 `unreviewed` 메모가 있는 앱 수)이고 그대로 두기로 한 앱은 새 판이 나와도 새 메모가 없으면 세지 않는다. 글은 "3 apps must update, 2 can use new SDK features."꼴이다. 한 앱은 둘 중 한 쪽에만 센다. key가 `sdk_update_needed`라 되풀이되는 기동이 줄을 늘리지 않고 그 줄을 새 개수로 바꿔 안 읽음으로 되돌린다.
- action은 `{kind: "open_home_skill", skill: "update-apps", args: ""}`다(전체). 앱마다 줄·단추를 두지 않는다. 앱마다 있던 옛 줄은 ledger에 남고 단추도 그대로 동작하지만 새로 쓰지 않는다. `lophn_updated` 줄에는 SDK 갱신 수를 싣지 않는다(이 줄과 겹친다).
- 맡기기는 늘 home을 거친다. Inbox 단추가 home lophn 대화를 `/update-apps`로 열고(앱 이름을 붙이면 그 앱만), home lophn이 `app.sdk_status`, 앱의 목적·공개 command(`app read`), `unreviewed` 메모로 앱마다 (a) 필수 migration, (b) 새 SDK 기능 중 이 앱에 쓸 만한 것(예: 한도를 넘으면 휘발 알림), (c) 그대로 두기를 정해 추천한다. home은 앱 source를 못 읽어 목적·command·메모로만 판단하고 자세한 것은 앱 lophn에게 맡긴다(내장 skill `update-apps`).
- 진행 상태는 program이 안다: 앱이 어느 판까지 옮겼나(켜진 release의 pin), home이 어느 판까지 보고 무엇을 정했나(review), 맡긴 기능이 끝났나(feature state). home의 memory에는 계산할 수 없는 사람의 취향만 남는다(`architecture/agent-definition.md`의 memory).

### SDK 결정과 맡기기

모델은 표 둘이다(ledger step `apps.sdk-review.tables`). **review**는 home이 앱 하나를 두고 낸 결정 한 번이고 덧붙이기만 한다(앱의 checkpoint는 마지막 review): 앱, 결정한 session, `decision`(`leave`: 그대로 둔다, `update`: 판을 올린다. 고른 기능이 있으면 같이), `through`(그때의 지금 판, SDK마다. program이 채운다), 시각, `update`일 때 보낸 handoff의 call ID. **feature**는 `update` review에 달린 사람이 고른 기능 하나다: 사람 말 제목, 앱 lophn에게 주는 제안 글, 근거 메모 file, `state`(`open` → `done`·`changed`·`skipped`)와 한 줄 사유. 처음 state는 `open`이라 결과를 안 내면 끝난 것으로 보이지 않는다. 판 올리기가 끝났는지는 저장하지 않고 `through`와 지금 pin을 견줘 계산한다. 앱을 지우면 두 표의 그 앱 행이 지워지고 보관한 앱의 행은 남는다.

- **`app.sdk_decide {app, decision, features?}`**(`lophn app sdk-decide <app> --decision … [--features <json>]`, home lophn만). 기능은 `{title, proposal, note}`이고 `note`는 그 앱의 `notes`·`unreviewed`에 나온 메모 file이어야 한다. `leave`는 review를 적는다. `update`는 review와 feature를 적고 같은 동작에서 그 앱의 lophn에게 handoff call(호출한 home session이 보내고 `reply: none`)을 보낸다. 그래서 private 예외와 call 정책, 명함 검사가 그대로 걸린다(`architecture/agent-call.md`). call이 거절되거나 배달에 실패하면 tx가 되돌아가 아무것도 적히지 않고 그 거절이 돌아간다. 기록과 call은 한 tx라 하나만 남지 않는다. `required` SDK가 있는 앱의 `leave`, `leave`에 기능을 단 입력, 모든 SDK가 지금 판인데 기능도 없는 `update`는 `invalid_input`이다. 같은 앱에 `update`를 다시 내면 다시 보낸다(멈춘 handoff 되살리기).
- 판·메모 목록·글 틀은 program이 채우고 agent 입력으로 받지 않는다. 메인 스레드 handler가 지금 판과 메모 file을 읽어 `through`와 handoff 글(옮길 SDK의 고정 판 → 목표 판과 메모 file, "follow the migrate-sdk skill", 기능마다 ID와 agent가 쓴 제안 글)을 만들고, core 안 machine 전용 command 하나(`app.sdk_review_record`)로 tx에 낸다. 기능 ID는 글에 먼저 실려야 해서 handler가 정한다. 글은 call 본문과 같은 길로 redaction과 blob 준비를 거친다.
- **`app.sdk_feature {feature, state, note?}`**(`lophn app sdk-feature <feature> --state … [--note …]`, 앱 workspace의 lophn만). 앱 lophn이 migrate-sdk의 report 단계에서 기능마다 낸다. 자기 앱의 기능만 고치고 없는 기능과 범위 밖 앱의 기능은 같은 답(`not_found`)이다. 판 올리기는 release가 켜지면 pin으로 보이므로 따로 내지 않는다.
- **`/update-apps` 한 round.** `app.sdk_status`를 읽고 앱마다 가른다: `unreviewed`와 `required`가 없으면 볼 것이 없다(지난 `update`가 안 끝났으면, 즉 pin이 `through`보다 옛것이거나 `open` 기능이 있으면 그것만 사람에게 말하고 다시 보낼지 정한다). `unreviewed`가 있으면 그 메모만 읽고 판단한다(지난 결정이 `leave`였어도 새 메모는 새로 본다). `required`는 묻지 않고 `update`다. 새 기능 제안만 `ask`로 묻고, `unreviewed`가 있던 앱마다 `sdk_decide`를 낸다. 맞는 것이 없으면 `leave`다. 판만 올리는 release는 만들지 않는다: `available`이고 고른 기능이 없으면 `leave`이고, 메모가 "다음 release부터 막힌다"고 해도 지금 돌아가는 앱은 두며 그 앱을 다음에 고칠 때 앱 lophn이 migrate-sdk로 옮긴다. session이 중간에 끊기면 결정을 낸 앱은 끝났고 안 낸 앱은 `unreviewed`로 남아 다음 round가 잇는다.
- home이 private 앱에서 받는 것은 기능의 state와 한 줄 사유와 pin뿐이다. call의 답·결과는 여전히 나오지 않는다(결정, 2026-11-11).

ledger에 결정이 없는 앱은 "아직 안 봄"이고(처음에는 모든 앱이 그렇다) 결과가 없는 기능은 "아직 안 끝남"이다. 조용히 끝난 것으로 치는 상태가 없다. 앱 lophn의 일이 멈췄을 때 program이 스스로 깨우지는 않는다(program이 agent session을 여는 길이 없다). 다음 `/update-apps`가 보고한다.

### artifact에 닿는 길

봉한 artifact view는 module을 import하지 못하고 바깥 library도 받지 못한다(`architecture/artifact.md`). 그래서 kit을 판을 고정한 browser build 하나로 묶어 가상 path로 준다. 사용자 앱의 `.lophn/sdk` 사본과 상관없는 길이다.

1. 제품 build가 renderer 화면 셋과 함께 artifact kit entry를 IIFE로 묶어 `entry.js`와 `entry.css`를 낸다. minify하지 않는다(CSS Modules의 class 이름이 `.chart_diagram` 꼴로 남는다). `entry.css`에는 component CSS만 있고(`base.css` 없음), 글꼴(KaTeX)은 data URL로 그 안에 싣는다. 봉한 scheme이 kit file 둘만 주기 때문이다.
2. 전역은 `LophnKit` 하나다. 칸은 `ui`(분류 8개의 공개 목록 그대로), `React`, `h`(`createElement`), `Fragment`와 흔한 hook, `render(element, node)`(같은 element에 다시 부르면 갱신), `icons`(lucide 전체, 앱이 `lucide-react`에서 받는 이름), `useTabHead(head, handlers)`(`@lophn/app-ui`의 같은 이름 hook과 같은 약속, bridge는 artifact preload의 `lophnTabHead`), `renderGraph(element, {nodes, edges, locale?, timeZone?})`(상태 prop `onRetry`·`empty`를 entry가 채운 GraphDiagram)다. build가 없어 JSX 대신 `h`로 부른다. shell은 sdk를 import하지 못해 `useTabHead`는 entry에 사본이 있다.
3. shell main의 봉한 scheme이 이 둘을 모든 artifact view에 `_lophn/kit.js`, `_lophn/kit.css`로 준다. artifact HTML은 plain `<script>`와 stylesheet로 부른다. 쓰는 법은 skill `write-artifact`에 있고, workflow artifact에만 걸린 것은 project workspace skill `write-workflow`에 있다.

### gallery

- 묶음 셋이 구현 여부를 말한다. Kit은 design의 실제 component를 분류마다 page 하나로 상태별로 그린다. Screens는 renderer를 import한 화면을 fake source와 mock data로 상태 하나를 고정해 그리고(mount 뒤 단추를 눌러 사람이 한 것처럼 만드는 drive가 있다), Drafts는 아직 renderer에 없는 승인 전 실험이다. 구현 여부를 손으로 적는 badge는 없다. 그래서 화면 모양을 고친다는 것은 design이나 renderer component를 고친다는 뜻이다.
- 사람은 Kit 묶음을 보고 component 모양과 분류를 승인한다. 다르게 보면 그 component만 옮긴다.
- page 목록은 영역 file 한 곳에 적는다. 영역 file이 자기 page의 `{ id, title, description, render }`를 내고 목록 file의 `GROUPS`(Kit · Screens · Drafts > 영역 > page)가 모은다. Kit은 본문에 바로 그리고 Screens·Drafts는 iframe(`?frame=<id>`)에 그린다.
- CSS는 Drafts와 gallery 자신의 틀 둘(전체 틀, kit page 배치)에만 있다. 무대 배치처럼 몇 줄이면 token 변수를 쓴 inline style로 쓴다.

### check

`npm run check`의 step `kit`이 셋을 본다.

1. gallery의 CSS는 Drafts 안과 gallery 틀 둘에만 있다. 스타일을 새로 쓰는 순간이 component를 새로 만드는 순간이라 복사본 금지를 가장 단순하게 잡는다.
2. 분류 공개 목록이 값으로 내보내는 PascalCase 이름(component, Context, Provider)마다 kit page 아래 file에 한 번은 나온다. 상수, helper 함수, hook, type은 세지 않는다.
3. design의 `.tsx`는 분류 폴더 8개와 `_shared` 안에만 있고, `components/` 바로 아래에는 분류 폴더와 CSS module type 선언뿐이다. 값을 내보내는 문마다 윗줄이 `//` 한 줄이다.

check `sdk notes` step은 지금 판과 하한의 메모, 하한이 판보다 높지 않은 것, 메모 사슬을 본다(AGENTS.md "코드"의 SDK 판 규칙).

## 결정

- 범용인지는 "사용자 앱도 그대로 쓸 만한가"로 가른다. lophn만의 뜻이 박힌 것은 renderer, lophn과의 약속을 아는 것은 sdk(`@lophn/app-ui`), 쓰는 곳이 gallery뿐인 것은 지운다. 분류와 범용·전용은 이 기준으로 정했고 사람이 그대로 받았다. (agent, 사람 승인)
- 남는 sdk UI package 이름은 `@lophn/app-ui`다. 재export뿐이던 `@lophn/tokens`는 지웠다. (agent)
- gallery의 Orders 앱 view는 사용자 앱이 그리는 그림이라 design `Table`로 바꾸지 않고 CSS째 Drafts에 둔다. 버린 안: `Table`에 사용자 정의 칸을 더하기(kit API가 넓어진다). (agent)
- gallery를 정본으로 사람이 component를 보고 승인한다. 범용 component를 한 곳에서 lophn 화면과 사용자 앱에 같이 내보내기 위해서다. 가짜 흉내 CSS와 page 목록 세 곳 적기를 없앴다. (agent)
- 앱 바탕은 `@lophn/ui`가 아니라 앱 template에서 맞춘다. 같은 판의 SDK byte를 바꾸면 기존 앱의 `npm ci`가 깨지고, 판을 올리면 `@lophn/app-ui`·shell·template 고정이 같이 바뀐다. 사람이 강제하지 말라고 했다. 이미 만든 앱은 그대로다. (사람, agent)
- SDK 사본은 앱 폴더 안 `.lophn/sdk`에 실제 file로 두고 npm `file:` 의존으로 건다. Node는 `node_modules` 안의 `.ts`를 돌리지 않고, SDK의 npm 의존은 사본의 실제 경로에서 앱 `node_modules`로 올라가 풀려야 한다. (agent)
- 앱 화면 문구는 앱 코드에 그대로 쓴다. 번역 틀은 표준 library `@formatjs/intl`로 두고 직접 만든 i18n은 쓰지 않는다(`intl-messageformat`과 같은 계열이라 catalog와 호출을 고치지 않는다). 사용자 한 사람이 쓰는 생성 앱에는 번역이 필요 없다. (사람, agent)
- `@lophn/app-ui`의 locale은 appearance가 이미 앱 view에 닿는 dom-ready 길로 보낸다. 새 preload API를 만들지 않는다. (사람)
- 이미 만든 앱은 새 판으로 옮기지 않는다. 옛 판 사본은 기동이 지우지 않아 그 앱은 고정한 판으로 계속 build되고, 새 판은 새 폴더에 깔린다. 같은 판 번호의 byte를 바꾸면 lock이 있는 기존 앱의 `npm ci`가 실패해서 판을 올렸다. (사람, agent)
- 내장 SDK는 catalog에 등록하지 않고 설치 사본을 정본으로 둔다. 버린 안: 기동 때 `register_version`. 같은 판의 byte가 바뀌면 등록이 `conflict`라 개발 중 sdk를 고치고 다시 띄우면 기동이 막힌다. (agent)
- kit props는 생성 파일이 아니라 읽을 때 설치 사본의 source에서 뽑는다. 버린 안: design에 `guide.md`를 생성해 두기(생성물과 그 check가 하나 더 는다). guide에 props는 싣고 쓰는 예는 싣지 않는다. (사람, agent)
- guide는 잘라서 버리지 않고 창으로 나눠 준다. 옛 길은 본문을 tool 결과 상한에서 자른 뒤 덜어낼 배열이 없어 본문 전체를 `null`로 만들어 agent가 kit guide를 한 번도 받지 못했다. paging은 `file.read`·`pdf.read`와 같은 `continuation`이다. 버린 안: guide를 "색인"과 "props" 두 요청으로 나누기(agent가 구조를 알아야 하고 route가 는다). (agent)
- guide 예산은 tool 한 창보다 작은 20 KiB다. props는 분류마다 돌아가며 배분한다. 옛 길은 알파벳 앞 분류가 예산을 다 써서 앱에서 가장 많이 쓰는 `primitives`와 `overlay`가 먼저 사라졌다. 버린 안: props를 guide에서 빼기(13 KiB로 돌아가지만 agent가 props를 모른다). (agent)
- 창 크기는 tool 결과 상한에서 JSON overhead를 빼서 재고, 넘치면 줄여 다시 재서 escape가 늘어나는 본문도 상한을 넘지 않게 한다. (agent)
- 화면 지침은 slop을 없애는 원칙만 둔다. 어떤 component를 쓰라고 지시하지 않고 무엇을 쓸지는 앱 agent가 guide에서 찾는다. 설계 절차, kit 찾기, 화면 원칙은 role prompt가 아니라 skill(`design-app`)에 둔다. (사람)
- kit은 artifact view에 판 고정 IIFE로 주고, 앱과 같은 kit 전체를 싣는다(사람, 2026-11-10). 처음에는 GraphDiagram 하나만 실어 agent가 나머지를 손으로 짰고 화면이 lophn과 달랐다. artifact가 판을 고정하지 않는 것은 받아들인다(한 번 보는 결과물이고 rewind가 있다). kit 쓰는 법은 `write-artifact` 한 곳에 둔다. domain artifact를 쓰는 role이 모두 받고, 같은 API 설명이 두 곳에 있으면 갈라진다. 자기 kind를 가리키는 `ref`는 kind 지도에 edge로 그리지 않고 node의 note에 쓴다(kit은 self-edge 하나로 그림 전체를 오류로 그린다). (agent)
- GraphDiagram의 되돌아가는 edge는 node 줄 위 여백으로 돌린다(작은 변경). 버린 안: 되돌아가는 edge가 지나는 층에 빈 자리를 두어 그 높이로 지나게 하기(layout 규칙이 늘고 node 위치가 바뀐다). (agent)
- SDK 판 메모는 skill 하나에 file로 더하고 지우지 않는다. agent는 범위만 읽어 context는 그 앱이 뒤처진 만큼만 커진다. 버린 안: 판마다 skill. (사람)
- `@lophn/agent` 하한은 1.1.0이다. `agt_` id를 넘긴 1.2.0 앱만 깨지는데 판으로 알 수 없어 1.3.0 메모에 적었다. (agent)
- 감지 신호는 제품 판 marker 옆 같은 표에 둔다. 새 표나 data root file을 만들지 않는다. (agent)
- SDK 알림은 앱 없는 program 줄 하나이고 kind는 `sdk_update_needed`를 다시 쓴다(새 kind를 만들지 않았다). 필수와 가능을 한 줄에 센다. 가능만 있어도 쓴다(새 기능을 채택할지 판단하게 하려는 것). 맡기기는 늘 home을 거친다. 사람은 SDK 변화가 무엇을 깨고 무엇을 가능하게 했는지 판단하지 못하니 lophn이 판단해야 하고, home은 각 앱을 두고 갈지 올릴지 숲을 보는 곳이다. 버린 안: 앱마다 줄에 [Ask lophn] 단추. (사람, 2026-11-07)
- private workspace에 대한 home의 맡기기 예외는 home의 기본 lophn, private 쪽 lophn, `reply: none` 셋이 다 맞을 때뿐이다. home을 통째로 예외로 두지 않는다. (사람이 추천을 받음)
- 옛 SDK 사본을 data root에 따로 싣지 않는다. 하한 아래의 앱은 처음 다시 release할 때 옮긴다. (agent)
- component 추가나 선택 prop 추가는 `@lophn/ui` 판을 올리지 않는다. 이 판에 component를 더해 온 관행을 따른다. (agent)

## 열린 것

- 감지로 쓴 `sdk_update_needed` 줄은 기동 중에 쓰므로 toast가 뜨지 않고 배지와 History로만 보인다(이슈 `startup-program-notice-no-toast`).
- 감지는 제품 판이나 설치된 SDK 판 묶음이 바뀔 때만 돈다. 감지 뒤 지금 상태를 앱 단위로 닫는 길은 없다(위 "SDK 업데이트 감지와 맡기기").
- `update-apps` skill을 실제 model이 그대로 따르는지는 eval이 없다.
- 오래된 major 구간이 길어지면 제품을 낼 때 메모를 합친다.
- check:full은 renderer build를 돌리지 않는다. kit을 바꾸면 renderer build가 되는지 따로 봐야 artifact kit entry가 선다.
- kit check가 못 잡는 것: 이름이 kit page의 import나 주석에만 있어도 "나온다"로 센다. 상태별로 다 그렸는지는 사람이 승인 때 본다.
