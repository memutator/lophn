// Words only the mobile app shows: the mobile app frame: start and pairing, sidebar, computers, settings. A sentence the desktop already has is not repeated here;
// the mobile screen uses the desktop key. Keys start with `mobile.`.
export const mobileApp = {
  "mobile.computer.button.pair-another": "Pair another computer",
  "mobile.computer.button.remove": "Remove this computer",
  "mobile.computer.heading.computers": "Computers",
  "mobile.computer.heading.connection": "Connection",
  "mobile.computer.heading.on-phone": "On this phone",
  "mobile.computer.heading.remove-confirm": "Remove this computer?",
  "mobile.computer.label.key": "Key",
  "mobile.computer.label.path": "Path",
  "mobile.computer.label.shown-as": "Shown as",
  "mobile.computer.label.status": "Status",
  "mobile.computer.note.relay":
    "The relay only passes sealed messages along. It cannot read them.",
  "mobile.computer.note.remove":
    "Also takes this phone off the computer’s list. If the computer can’t be reached now, pairing with it again replaces the old entry.",
  "mobile.computer.path.direct": "Same network",
  "mobile.computer.path.relay": "Through the relay",
  "mobile.computer.status.connecting": "Connecting…",
  "mobile.computer.status.direct": "Connected · same network",
  "mobile.computer.status.offline": "Offline",
  "mobile.computer.status.relay": "Connected · through the relay",
  "mobile.computer.status.revoked": "Removed by the computer",
  "mobile.frame.label.brand": "lophn",
  "mobile.frame.label.sessions": "Sessions",
  "mobile.settings.button.gallery": "UI kit gallery",
  "mobile.settings.heading.about": "About",
  "mobile.settings.heading.phone": "This phone",
  "mobile.settings.heading.preview": "Preview",
  "mobile.settings.label.app": "lophn for phone",
  "mobile.settings.label.theme": "Theme",
  "mobile.settings.note.appearance":
    "Colors and fonts follow lophn. The theme you picked on a computer stays on that computer.",
  "mobile.start.button.continue": "Continue",
  "mobile.start.button.enter-code": "Enter a pairing code instead",
  "mobile.start.button.flashlight": "Flashlight",
  "mobile.start.button.pair": "Pair",
  "mobile.start.button.scan": "Scan the code",
  "mobile.start.button.scan-again": "Scan again",
  "mobile.start.button.scan-different": "Scan a different code",
  "mobile.start.error.not-a-code": "This is not a pairing code.",
  "mobile.start.heading.enter-code": "Enter a pairing code",
  "mobile.start.heading.expired": "This code has expired",
  "mobile.start.heading.paired": "Paired with {name}",
  "mobile.start.heading.pairing": "Pairing with {name}",
  "mobile.start.heading.scan": "Scan the code on your computer",
  "mobile.start.heading.unreachable": "Cannot reach {name}",
  "mobile.start.heading.welcome": "lophn on your phone",
  "mobile.start.intro.expired":
    "Codes last five minutes. Choose New code in Settings › Remote on your computer and scan again.",
  "mobile.start.intro.paired":
    "This phone now shows under Settings › Remote on that computer. You can remove it from either side.",
  "mobile.start.intro.unreachable":
    "The code is fine but the connection did not open. Check that lophn is running on the computer and that it is online.",
  "mobile.start.intro.welcome":
    "Use your apps, talk to your agents and answer what they ask, wherever you are.",
  "mobile.start.label.scan-path": "Settings › Remote › Add a phone",
  "mobile.start.label.settings-remote": "Settings › Remote",
  "mobile.start.note.encrypted":
    "End-to-end encrypted. Only this phone and your computer can read what passes between them.",
  "mobile.start.note.enter-code":
    "Under the QR code on your computer choose {button}, copy it and paste it here. A code works once, for five minutes.",
  "mobile.start.notice.no-camera":
    "lophn can’t use the camera. Allow it in the phone’s settings, or enter the code instead.",
  "mobile.start.step.add": "Choose {button} and scan the code it shows",
  "mobile.start.step.open": "Open lophn on your computer",
  "mobile.start.step.settings": "Go to {place}",
  "mobile.start.step.code-accepted": "Code accepted",
  "mobile.start.step.keys-exchanged": "Keys exchanged",
  "mobile.start.step.opening": "Opening the connection…",
} as const;
