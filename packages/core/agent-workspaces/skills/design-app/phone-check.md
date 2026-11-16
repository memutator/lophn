# Check a phone screen on the person's phone

The desktop `--preview --screen` check draws with react-native-web, so it can
differ from the phone: text input, the soft keyboard, scrolling, fonts, the real
phone size. Fix the screen on the desktop first. Check on the person's phone
what depends on those, when the person is at the phone to open the preview.

## Steps

1. `lophn preview start` (commit and `lophn release prepare` first).
2. Ask the person to open the app's preview on their phone and keep lophn in
   front. Say which app and screen. When the app has a live release with a
   phone screen, the preview is Preview from lophn in that app screen's menu.
   When it has none yet (its first phone screen), the app's line in the lophn
   app on the phone is marked Preview while the preview runs and opens the
   preview directly. If the person cannot find it, say so and fall back to the
   desktop `--preview --screen` check; tell them what you could not check on
   the phone.
3. `lophn tab open --phone <app id> [--screen <key>]`. It returns the tab id.
   `--screen` opens only while the phone shows that screen; without it the tab
   is the screen the phone shows now. An app has one phone tab.
4. Read and drive it with `lophn browser`:
   - `snapshot <tab>`: the first line is `screen <key> <w>x<h>dp`; each element
     is `- <role> "<name>" [ref=e12]`, flags such as `[offscreen]`.
   - `act <tab> click --ref e12`, `type` (appends), `fill` (replaces) with
     `--text`, `press --key Enter`, `scroll [--ref e12 | --dy <px>]`. No other
     act works on the phone (`invalid_input`).
   - `wait <tab> --text <text>`, and `screenshot <tab>` (a JPEG; read the file).
5. A ref is valid only for the last snapshot. `conflict` on a ref means take a
   new snapshot.

An input is named in the snapshot by its `Field` label, else by its
placeholder. Put every input in a `Field` with a label so you can find it.

## What the answers mean

- Before the person opens the preview, `tab open --phone` is `unavailable` and
  retrying does not help: ask and wait.
- When the phone goes to the background or the person leaves the preview, the
  calls are `unavailable`, and work again when they return. Ask them to bring
  lophn back in front; do not retry in a loop.
- When the person presses Take control, `act` is `conflict`; `snapshot`,
  `screenshot` and `wait` still answer until they press Hand back. Wait, or ask.
- `conflict` on `tab open --phone` with no preview running: `preview start`.
- A rebuilt preview (a new `preview start`) switches the phone to the new
  bundle, and the same tab keeps working.

## Limits

- The data on the phone is the preview's throwaway data, not the person's.
- A kit `Sheet` or any `Modal` on the screen cannot be read or driven from the
  phone tab, and it says so. Design the check so the step under test is on the
  screen itself, and tell the person what you could not check.
- There is no Back and no system dialog (permission prompts, share sheet,
  keyboard chrome): you cannot press or see them.
- The lophn app must stay in front. The person can take control at any time.
- Report what you saw on the phone, what you saw only on the desktop, and what
  you could not check.
