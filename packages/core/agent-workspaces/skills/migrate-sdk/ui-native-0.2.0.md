# @lophn/ui-native 0.2.0

Previous: 0.1.0
Breaking: no. Move together with `@lophn/app-ui-native` 1.2.0 if the app uses it.

`Input` now names itself for accessibility: the `label` of the `Field` around it, or its `placeholder` when it is not inside a `Field`. Before, the name was the placeholder only. When lophn drives a phone screen on the person's phone, it finds an input by this name, so give every input on a phone screen a `Field` label (a placeholder alone still works but is a hint, not a name). A secure input is named the same way; its value is never the name.

```tsx
// Before: the input is found as "type here"
<Input value={title} onChangeText={setTitle} placeholder="type here" />
// After: the input is found as "Title"
<Field label="Title">
  <Input value={title} onChangeText={setTitle} placeholder="type here" />
</Field>
```

To move, change the pins in `package.json` and `lophn.ts` (`sdk_dependencies`) in both places, and `@lophn/app-ui-native` with them:

```json
"@lophn/ui-native": "file:.lophn/sdk/ui-native/0.2.0",
"@lophn/app-ui-native": "file:.lophn/sdk/app-ui-native/1.2.0",
```

Nothing is required of an existing app: no API changed, so existing screens build and look the same. Add a `Field` label around inputs that have none when you next touch the screen.

A screen built with 0.2.0 does not open on a lophn phone app whose kit is still 0.1.0 (the phone shows "update the phone app"). A screen built with 0.1.0 keeps opening on a phone app with 0.2.0.

## Instruction diff

The lophn instructions for phone screens changed: after you change a phone screen, check it once on the person's phone (when the person is there) instead of only in the desktop preview. Update the lophn-managed part of your `AGENTS.md` to match the new lines below if it carries the old ones. From now on: fix the screen in the desktop preview first; for input, the soft keyboard, scrolling, fonts and the real phone size, run `lophn preview start`, ask the person to open this app's Preview from lophn in the lophn app on the phone and keep lophn in front, then `lophn tab open --phone <app> [--screen <key>]` and read and drive it with `lophn browser snapshot|screenshot|act|wait`. Put every phone `Input` inside a `Field` with a label: that label is its name in the snapshot. The steps, the answers (`unavailable`, `conflict`) and the limits are in the file `phone-check.md` of the `design-app` skill (new): read it with `skill.read {name: "design-app", path: "phone-check.md"}`; it is not in the diff below.

```diff
# lophn app agent prompt
@@ -72,2 +72,4 @@ information). Use `lophn app link-source` only for an existing git repo with a c
    skill `design-app` has the phone screen rules and what the preview cannot show).
+   If you changed a phone screen and the person is here, check it once on their
+   phone (`lophn tab open --phone <app>`; `phone-check.md` in `design-app`).
 6. `lophn release activate` the release:
# design-app skill
@@ -293,7 +293,7 @@ Check it on the desktop:
 The preview draws with react-native-web, so the phone can differ: text input,
-the soft keyboard, scrolling, fonts, the safe area. When you report, say what
-you saw in the desktop preview and what you could not see on the phone, and
-that the person makes the last check on their phone. If the phone app is older
-than the kit the screen was built with, the phone shows "update the lophn app";
-tell the person.
+the soft keyboard, scrolling, fonts, the safe area. For those, check on the
+person's phone with `lophn tab open --phone`: `skill.read` this skill's
+`phone-check.md`. When you report, say what you saw on the desktop, on the
+phone, and what you could not check. If the phone app is older than the kit the
+screen was built with, the phone shows "update the lophn app"; tell the person.
 
# @lophn/ui-native guide.md
@@ -214,3 +214,7 @@ desktop에서 확인한다: `lophn tab open --preview <app> --screen <key>`가 
 연다. 이것은 react-native-web이라 실제 폰과 다를 수 있다(입력, soft keyboard, scroll, 글꼴, 안전 영역).
-"desktop preview에서 본 것"과 "폰에서 보지 못한 것"을 나눠 알리고, 마지막 확인은 사람이 폰에서 한다.
+그런 것은 사람의 폰에서 확인한다: 사람에게 폰의 lophn 앱에서 이 앱의 Preview from lophn을 열고 앱을 앞에 두어 달라고
+부탁한 뒤 `lophn tab open --phone <app> [--screen <key>]`로 열고 `lophn browser snapshot|screenshot|act|wait`로 본다(폰의
+data는 preview의 throwaway data이고, `Sheet`와 `Modal`은 읽지도 누르지도 못한다. 자세한 길은 skill `design-app`의
+`phone-check.md`). "desktop preview에서 본 것", "폰에서 본 것", "보지 못한 것"을 나눠 알린다.
+`Field`의 `label`이 안의 `Input`의 accessibility 이름이 된다(snapshot에서 찾는 이름). 입력마다 `Field`로 감싸 이름을 준다.
 
```
