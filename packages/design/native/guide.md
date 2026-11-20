# @lophn/ui-native

## 목적

폰 화면의 조각이다. 앱의 폰 화면(`src/screens/<key>/phone.tsx`, 선언의 `places: ["phone"]`)을
React Native로 그릴 때 쓰는 kit이고, desktop 화면의 `@lophn/ui`와 같은 token(색, 글 크기, 간격)에서
나와 light·dark가 같은 뜻이다. `@lophn/ui`는 DOM이라 폰에서 돌지 않는다. 한 화면에 두 kit을 섞지
않고, desktop 화면(`main.tsx`)은 `@lophn/ui`, 폰 화면(`phone.tsx`)은 이 kit을 쓴다. operation과 data는
둘이 하나를 같이 쓴다.

폰 앱이 같은 kit 판을 이미 가지고 있다. 그래서 화면 bundle(`phone.js`)에 kit이 들어가지 않는다(build가
external로 두고 폰이 내준다). 이 package를 설치하는 것은 type 검사와 desktop preview를 위해서다.
새 kit 판으로 지은 화면은 옛 폰 앱에서 열리지 않을 수 있다(폰에 "update the lophn app"이 보인다. 폰 앱을
올려야 한다).

## 공개 API와 type

```tsx
import { Screen, Row, Text, Button } from "@lophn/ui-native";
```

모든 export는 이 root 하나에서 나온다(`@lophn/ui-native/<경로>` 같은 sub-path는 없고 build가 거절한다). 각 조각의 props type은 `<이름>Props`로 같이 나온다(`ScreenProps`, `RowProps`, …). 위
한 줄 쓰임새로 고르고, props는 설치 사본(`.lophn/sdk/ui-native/<판>/`)의 `.tsx`에서 읽는다. 없는
조각을 새로 만들기 전에 아래 목록을 먼저 본다. 아래 목록은 이 package의 `mod.ts`에서 그대로 옮긴 것이다.

### root and theme
- `UiProvider`: Mount once at the root of the app: safe area, keyboard and theme.
- `ThemeProvider`: Switch light and dark for a subtree (a gallery, a preview); UiProvider already has one.
- `useTheme`, `themes`: Read colors, type steps and shadows when a kit part does not fit: a screen's own layout.
- `Ink`: Give text and icons below a color without naming it on each (like CSS currentColor).

### primitives
- `Text`: Every piece of text on the phone: picks a type step, a tone and a weight in Pretendard or JetBrains Mono.
- `Icon`: A Lucide icon at the phone's 1.6 stroke.
- `IconButton`: An action shown as an icon alone in a 44 round target: top bar buttons, search, +.
- `Button`: A labelled action: primary, secondary, ghost or danger, in sm, md or lg.

### frame
- `Screen`: One screen: safe area, a top bar, a body, and a footer that rides up on the keyboard.
- `TopBar`: The bar at the top of every screen: menu, back or close, a title with its quieter part, and actions.
- `Label`: A section's name above its rows, with an optional link at the end.
- `Row`: One line of a list: a session, a computer, a setting, a menu choice.
- `Divider`: A hairline between rows, lined up with their text.
- `Band`: A full-width band that starts a kind of item in a long list.
- `Card`: A rounded box that holds one thing: a waiting request, a note.
- `Plain`: A quiet white box with a faint edge: a numbered list.
- `Group`: Settings rows in a card on a floor screen.
- `ListCard`: Rows in a card inside an app's own layout.
- `Banner`: A state of the whole screen said at its top (the computer is offline).
- `Toast`: A short note floating above the bottom edge (Updated to Release 8).
- `Fab`: The one main action of a list screen, floating at the bottom right.

### display
- `Dot`: A session's or a computer's state as a small dot.
- `Badge`: How many things wait.
- `Tag`: A short quiet word next to a name.
- `STATUS_ICONS`, `StatusMark`: A state said with its status icon and word.
- `Mark`: A project's or an app's colored mark.
- `Pre`: A command, a path or a short output in a mono box.
- `Stat`: A label over a large number.

### input
- `Field`: A label over one control, with a hint under it.
- `Input`: A one-line text box; soft for search.
- `Switch`: Turns one setting on or off right away.
- `Radio`: The mark of a pick-one choice inside a pressable row.
- `Checkbox`: The mark of a pick-many choice inside a pressable row.
- `Tabs`: Underlined tabs across the top of a place.
- `SegmentedControl`: A pick-one of a few short choices side by side.
- `FilterChips`: Pills that narrow a list.
- `Chip`: A quiet pick in the composer's bottom row (model, workspace) that opens a sheet.
- `Pill`: An outlined pick with a chevron: the computer in the top bar, the workspace of a new session.

### overlay
- `Sheet`: Anything that rises from the bottom: a menu, a picker, a short form. Closes by dragging down.
- `Menu`: A list of actions in a sheet; choosing one closes it.

### sidebar
- `Drawer`: The sidebar's panel, sliding in from the left over a scrim.
- `SidebarHead`: The sidebar's top line: the product's face, its name, search.
- `ComputerPicker`: The computer the sidebar belongs to; opens the list of computers.
- `NavRow`: A top-level place: Inbox, Jobs, Agents, Settings.
- `WorkspaceRow`: A workspace: Home, a project, an app.
- `SessionRow`: A session under its workspace, with its state dot.
- `SidebarLabel`: A group's name: Workspaces.
- `WorktreeLabel`: A worktree's name over its sessions.
- `SidebarList`: The sidebar's scrolling middle, fading out at the bottom.
- `SidebarFoot`: The sidebar's bottom line: Settings.

### conversation
- `UserBubble`: What the person said, on the right, with an optional note under it.
- `AgentTurn`: One answer from an agent under its face and name.
- `Act`: A folded line of what the agent did; opens the steps.
- `EditCard`: A file the agent changed; opens the diff.
- `Working`: The line under the last turn while the session runs or waits.
- `ErrorLine`: A turn that stopped on an error, with Retry.
- `Meta`: The quiet line that ends a turn (time, copy).
- `DiffLine`: One line of a file's diff.
- `AskCard`, `AskTitle`: The frame of anything waiting on the person above the composer (a folded todo list too).
- `Fact`: One labelled fact of a request in a mono box.
- `ApprovalCard`: A permission request: Deny, Always allow, Allow once.
- `QuestionCard`: A question: pick an option (or several) or write an answer, one at a time.
- `Composer`: The message box at the bottom of a conversation: +, chips, send or stop.
- `FileChip`, `Thumb`: A picture or a file attached in the composer.
- `MessageList`: The conversation itself: newest at the bottom, follows new text, a button back to the latest.

### reading
- `Markdown`: Markdown from the same parse as desktop: chat for answers, reading for documents.
- `CodeBlock`: Code in a scrolling mono box with copy.


얼굴(agent 얼굴, vendor icon)은 kit에 없다. 그것을 받는 자리(`Row`·`TopBar`의 `lead` 등)는 ReactNode로 받는다.

## 요구 permission

없다. 폰 화면이 부르는 operation의 permission은 그 앱의 선언이 정한다.

## peer 의존

정확한 peer다. 범위가 아니라 정확한 판을 쓴다. 폰 화면이 있는 앱은 이 package와 아래 peer, 그리고
desktop preview가 쓰는 `react-native-web`·`react-dom`을 **모두 `devDependencies`**에 둔다(`dependencies`가
아니다). 폰의 runtime에는 폰 앱이 같은 것을 가지고 있어 앱 bundle에는 들어가지 않고, lophn이 release를
준비할 때 `devDependencies`를 빼 bundle 크기 한도 안에 둔다. `dependencies`에 두면 빠지지 않아
release 준비가 거절한다.

| peer                              | version |
| --------------------------------- | ------- |
| `react`                           | 19.3.0  |
| `react-native`                    | 0.88.1  |
| `react-native-svg`                | 15.16.0 |
| `react-native-safe-area-context`  | 5.11.1  |
| `react-native-keyboard-controller`| 1.22.7  |
| `expo-clipboard`                  | 58.0.4  |
| `lucide-react-native`             | 1.73.0  |
| `@lezer/markdown`                 | 1.7.2   |
| `@lophn/i18n`                     | 1.0.0 (이 package가 의존으로 가져온다) |

`react-native-web`(0.21.2)과 `react-dom`(19.3.0)은 이 package의 peer는 아니지만 desktop preview
build가 쓴다. 폰 화면이 있는 앱의 `devDependencies`에 같이 둔다.

앱 template의 `package.json`에는 `react`, `react-dom`, `@types/react`, `@lezer/markdown`이 이미 있다. 그것은 다시 적지 않는다.

앱 `package.json`:

```json
"devDependencies": {
  "@lophn/ui-native": "file:.lophn/sdk/ui-native/0.3.1",
  "@types/react": "19.3.0",
  "expo-clipboard": "58.0.4",
  "lucide-react-native": "1.73.0",
  "react-dom": "19.3.0",
  "react-native": "0.88.1",
  "react-native-keyboard-controller": "1.22.7",
  "react-native-safe-area-context": "5.11.1",
  "react-native-svg": "15.16.0",
  "react-native-web": "0.21.2"
}
```

앱 `lophn.ts`의 `sdk_dependencies`에도 같은 판을 적는다: `{ name: "@lophn/ui-native", version: "0.3.1" }`.
두 곳의 판은 같아야 한다. operation을 부르는 `@lophn/app-ui-native`도 같은 방식으로 둔다(그 guide).
`@lophn/ui-native`의 peer 판은 위 표가 정확한 판이다. 판을 올리면 표와 같이 바뀐다.

## 폰 규칙

- **화면 root는 `Screen`이고 `top`을 주지 않는다.** 안전 영역, 본문, 키보드 위로 오르는 아래 줄이 거기서 난다.
  `UiProvider`는 폰 앱의 root가 이미 둔다. 화면이 다시 두지 않는다(desktop preview도 같은 진입이 둔다).
  앱 화면의 머리 줄(앱 mark와 이름, ⋯ menu)은 lophn이 그린다. desktop과 같다. 앱은 `TopBar`나 제목 줄을
  그리지 않는다(앱 이름이 lophn의 줄 아래에 한 번 더 선다). view 탭은 본문 맨 위, 주 행동은 `footer`에 둔다.
  `TopBar`는 `onLeft`가 없으면 왼쪽 단추를 그리지 않는다.
- **`Sheet`·`Menu`·`Drawer`는 화면 안에 뜬다**(lophn의 머리 줄 아래). React Native의 `Modal`을 직접 쓰지 않는다. lophn
  앱 전체를 덮고, phone 탭이 그 안을 읽지도 누르지도 못한다.
- **누르는 곳은 44 이상이다.** `IconButton`·`Row`·`Tabs`·`Button`은 그렇게 준다. `Button`은 `sm` 34, `md` 42,
  `lg` 54로 보이지만 눌리는 곳은 위아래로 넓혀 44 이상이다. 화면의 주 행동은 `lg`를 쓴다. 직접 만드는
  `Pressable`도 `minHeight: 44` 아래로 두지 않는다. hover가 없으니 hover로만 보이는 설명·단추를 두지 않는다.
- **등록한 기준 폰의 폭에 맞춰 그린다. 반응형을 만들지 않는다.** 폭과 DPR은 `lophn app phone-target`이
  준다(기기가 없으면 사람에게 폰을 pairing하라고 말한다). 기준 폰이 바뀌면 옛 크기로 그린 화면은 다시 그린다.
- **글자는 `Text` 안에 둔다.** React Native의 `<View>` 아래 글자는 그려지지 않는다. 색은 `useTheme()`의
  `color`로 쓰고(light·dark를 따라간다) 색 문자열을 직접 쓰지 않는다. 글 크기는 사람의 글 배율을 따르므로
  `Text`의 `variant`를 쓰고 `fontSize`를 직접 주지 않는다.
- **화면이 쓸 수 있는 module은 정해져 있다**: `react`, `react/jsx-runtime`, `react-native`,
  `react-native-svg`, `react-native-safe-area-context`, `lucide-react-native`, `@lophn/ui-native`,
  `@lophn/app-ui-native`와 앱 자기 npm 의존 가운데 순수 JS인 것. 이 밖의 native module(`expo-*`,
  `react-native-*`)과 `react-dom`·`@lophn/ui`·`@lophn/app-ui`·Node 내장 module은 release 준비가 거절한다.
  이 목록의 sub-path(`react-native/…`)도 거절한다.
- **network가 없다.** `fetch`, WebSocket에 기대지 않는다. 화면은 data를 bridge(`@lophn/app-ui-native`의
  operation 호출과 event)로만 받는다.
- **이미지는 kit의 icon(`Icon`에 `lucide-react-native`의 icon)과 `data:` URI뿐이다.** 원격 URL의 `Image`는
  뜨지 않는다.

## 사용

```tsx
import { Screen, Group, Row, Text, Button } from "@lophn/ui-native";
import { OperationButton, useOperation } from "@lophn/app-ui-native";

export default function Orders() {
  return (
    <Screen tone="floor" scroll>
      <Group>
        <Row title="Order 1042" sub="Shipped" end={<Text tone="muted">3 items</Text>} />
      </Group>
    </Screen>
  );
}
```

`phone.tsx`는 화면 component 하나를 default export한다(lophn이 `UiProvider`와 오류 경계로 감싸 연다).
`@lophn/app-ui-native`의 쓰는 법과 `lophnApp` bridge는 그 guide를 본다.

desktop에서 확인한다: `lophn tab open --preview <app> --screen <key>`가 기준 폰 크기의 틀로 화면을
연다. 이것은 react-native-web이라 실제 폰과 다를 수 있다(입력, soft keyboard, scroll, 글꼴, 안전 영역).
그런 것은 사람의 폰에서 확인한다: 사람에게 폰의 lophn 앱에서 이 앱의 Preview from lophn을 열고 앱을 앞에 두어 달라고
부탁한 뒤 `lophn tab open --phone <app> [--screen <key>]`로 열고 `lophn browser snapshot|screenshot|act|wait`로 본다(폰의
data는 preview의 throwaway data이고, `Modal`은 읽지도 누르지도 못한다. 자세한 길은 skill `design-app`의
`phone-check.md`). "desktop preview에서 본 것", "폰에서 본 것", "보지 못한 것"을 나눠 알린다.
`Field`의 `label`이 안의 `Input`의 accessibility 이름이 된다(snapshot에서 찾는 이름). 입력마다 `Field`로 감싸 이름을 준다.

## version 정책

판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `ui-native-<판>.md`에 있다(이 SDK의
판을 올리면 그 메모를 같이 쓴다). 폰 앱이 가진 kit 판과 앱이 build에 쓴 판을 견준다:

- **patch**: API·동작을 유지한 내부 수정·문서 고침이다.
- **minor**: 기존 API를 유지한 추가다(새 조각, 새 prop). 이 판으로 지은 화면은 이 판보다 옛 폰 앱에서 열리지
  않을 수 있다. 사람이 폰 앱을 올려야 한다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다. 옛 major로 지은 화면은 새 major의
  폰 앱에서 열리지 않으므로 앱을 새 판으로 옮겨 다시 지어야 한다.

`@lophn/app-ui-native`가 이 kit의 `Button`을 쓰므로 둘은 폰 앱에서 같이 움직이는 판이다.
