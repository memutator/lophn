// Words only the mobile app shows: the mobile Inbox. A sentence the desktop already has is not repeated here;
// the mobile screen uses the desktop key. Keys start with `mobile.`.
export const mobileInbox = {
  "mobile.inbox.empty.text":
    "Approvals, questions, app updates and missed jobs from every workspace show up here.",
  "mobile.inbox.error.changed":
    "This was already answered or changed on the computer.",
  "mobile.inbox.error.unreachable": "Couldn't reach the computer. Try again.",
  "mobile.inbox.filter.all": "All",
  "mobile.inbox.group.yesterday": "Yesterday",
  "mobile.inbox.history.failed": "Couldn't load the history.",
  "mobile.inbox.offline.text":
    "This is what was waiting when you last saw it. You can answer once it is back.",
  "mobile.inbox.update.asked": "Asked {age}",
  "mobile.inbox.update.gone": "This update was already answered.",
  "mobile.inbox.update.title": "New version of {app}",
} as const;
