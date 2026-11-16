// Words only the mobile app shows about a preview on the phone and a lophn agent driving it. A sentence the desktop
// already has is not repeated here; the mobile screen uses the desktop key. Keys start with `mobile.`.
export const mobileDrive = {
  "mobile.drive.button.hand-back": "Hand back",
  "mobile.drive.button.take-control": "Take control",
  "mobile.drive.control.sub":
    "lophn can still look at this screen but cannot press or type.",
  "mobile.drive.control.title": "You have control",
  "mobile.drive.driving": "{agent} is driving this screen",
  // An app in the app list whose only phone screen is in its running preview.
  "mobile.drive.list.app": "{name} · Preview",
  "mobile.drive.menu.preview": "Preview from lophn",
  "mobile.drive.menu.preview-sub": "The version lophn is working on",
  "mobile.drive.menu.runs-on": "Preview on {computer}",
  "mobile.drive.note":
    "Test data on {computer}. Nothing you do here reaches the app's real data.",
  "mobile.drive.stopped.body":
    "Start it again on your computer, then open the app's preview on the phone again.",
  "mobile.drive.stopped.title": "The preview stopped on {computer}",
} as const;
