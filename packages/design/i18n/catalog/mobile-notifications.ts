// 폰의 알림(허락 묻기, Settings › Notifications, 알림 채널) 문구. 폰만의 key라 `mobile.`으로 시작한다.
// 알림 자체의 글은 core가 정해 보내므로 여기 없다.
export const mobileNotifications = {
  "mobile.notifications.button.open-settings": "Open system settings",
  "mobile.notifications.button.test": "Send a test notification",
  "mobile.notifications.button.turn-on": "Turn on notifications",
  "mobile.notifications.channel.apps": "Apps",
  "mobile.notifications.channel.apps-note":
    "An app update waits, or an app has something for you.",
  "mobile.notifications.channel.finished": "Finished work",
  "mobile.notifications.channel.finished-note":
    "A long turn finished or failed.",
  "mobile.notifications.channel.needs-you": "Needs you",
  "mobile.notifications.channel.needs-you-note":
    "An agent asks for approval or has a question, or a job was missed.",
  "mobile.notifications.denied.note":
    "Notifications are blocked for lophn in this phone’s system settings.",
  "mobile.notifications.heading.how": "How",
  "mobile.notifications.heading.know-when": "Know when you are needed",
  "mobile.notifications.heading.tell-me-when": "Tell me when",
  "mobile.notifications.heading.test": "Developer",
  "mobile.notifications.label.app-notify": "My apps notify me",
  "mobile.notifications.label.app-update": "An app update waits",
  "mobile.notifications.label.job-missed": "A job was missed",
  "mobile.notifications.label.long-finish": "Long work finishes",
  "mobile.notifications.label.needs-you": "An agent needs me",
  "mobile.notifications.label.quiet-when-present":
    "Stay quiet while I am at the computer",
  "mobile.notifications.label.show-names": "Show session names",
  "mobile.notifications.note.ask":
    "Get a notification when an agent asks for approval, has a question, or finishes long work. Notifications never show what was said.",
  "mobile.notifications.note.footer":
    "A notification never carries what was said or the command an agent wants to run.",
  "mobile.notifications.note.off":
    "Notifications are off. Turn them on to hear from your computers when you are away.",
  "mobile.notifications.note.test":
    "Shows in a few seconds. Put the app in the background to see it. Tapping it opens the same place a real one would.",
  "mobile.notifications.note.unavailable":
    "Notifications are not available in this build.",
  "mobile.notifications.sub.app-notify": "Whatever an app sends with notify",
  "mobile.notifications.sub.long-finish":
    "A turn that ran longer than a minute",
  "mobile.notifications.sub.needs-you": "Approvals and questions",
  "mobile.notifications.sub.quiet-when-present":
    "lophn knows when you are using it there",
  "mobile.notifications.sub.show-names": "Off shows only “An agent needs you”",
  "mobile.notifications.sub.show-names-warning":
    "On, session titles pass through Expo and Google to reach this phone.",
  "mobile.notifications.title.screen": "Notifications",
  "mobile.notifications.test.title": "Test notification",
  "mobile.notifications.test.body": "Tap to open it.",
} as const;
