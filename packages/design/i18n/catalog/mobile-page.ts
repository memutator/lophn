// Words only the mobile app shows: the computer's browser pages, seen and used from the phone.
// Keys start with `mobile.`.
export const mobilePage = {
  "mobile.page.title": "Pages",
  "mobile.page.label.open-on": "Open on {computer}",
  "mobile.page.label.you": "You",
  "mobile.page.label.loading": "Waiting for the page’s picture…",
  "mobile.page.placeholder.open": "Open a page on {computer}",
  "mobile.page.placeholder.type": "Type into the page",
  "mobile.page.button.send": "Type into the page",
  "mobile.page.key.backspace": "Backspace",
  "mobile.page.text.agent-using": "{agent} is using this page",
  "mobile.page.empty": "No pages are open on {computer}.",
  "mobile.page.notice.not-painting":
    "The page’s window on {computer} is minimized or hidden, so it isn’t drawn. The picture comes back when the window shows again.",
  "mobile.page.notice.view-only":
    "This phone can only watch pages. To use them, turn on “Allow typing in terminals” for this phone in Settings › Remote › My devices on {computer}.",
  "mobile.page.notice.gone": "This page is closed on {computer}.",
  "mobile.page.notice.unreachable":
    "lophn on {computer} isn’t answering. The picture may be out of date.",
  "mobile.page.error.open-failed": "Couldn’t open the page on {computer}.",
  "mobile.page.error.send-failed": "Couldn’t type into the page.",
} as const;
