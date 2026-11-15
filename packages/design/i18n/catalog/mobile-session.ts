// Words only the mobile app shows: the mobile conversation screen. A sentence the desktop already has is not repeated here;
// the mobile screen uses the desktop key. Keys start with `mobile.`.
export const mobileSession = {
  "mobile.session.button.context": "Context",
  "mobile.session.button.permissions": "Permissions",
  "mobile.session.label.agent-everywhere": "Every workspace",
  "mobile.session.label.agent-lophn": "Built-in · plans and hands work on",
  "mobile.session.label.agent-only-in": "Only in {workspace}",
  "mobile.session.label.app-card": "A card from {app}",
  "mobile.session.label.commands": "Commands and skills",
  "mobile.session.label.commands-sub": "Or type / in the message",
  "mobile.session.label.diff-under":
    "{folder} · +{added, number} −{removed, number}",
  "mobile.session.label.stopped-after-at": "Stopped after {duration} · {time}",
  "mobile.session.label.subagent": "{agent} · {description}",
  "mobile.session.label.where": "{agent} · {workspace}",
  "mobile.session.label.where-desk": "{agent} · {workspace} · {desk}",
  "mobile.session.label.worked-for-at": "Worked for {duration} · {time}",
  "mobile.session.label.working-for": "Working · {duration}",
  "mobile.session.label.workspace-file": "A file in {workspace}",
  "mobile.session.label.workspace-file-sub": "Point {agent} at it by name",
  "mobile.session.notice.coding-on-computer":
    "This session continues on {computer}. Open lophn there to work in it.",
  "mobile.session.notice.secret-on-computer":
    "Secrets are typed on the computer so they never pass through this phone. Open lophn on {computer} to enter it.",
  "mobile.session.notice.sign-in-on-computer":
    "Signing in happens on the computer so your account never passes through this phone. Open lophn on {computer} to sign in.",
  "mobile.session.placeholder.new": "Describe a task or ask a question…",
  "mobile.session.placeholder.queue": "Queue a message…",
  "mobile.session.placeholder.reply": "Reply…",
  "mobile.session.placeholder.reply-instead": "Reply instead…",
  "mobile.session.title.agents": "Who works on it",
  "mobile.session.title.attach": "Add to the message",
  "mobile.session.title.new": "What should {agent} work on?",
  "mobile.session.title.steps": "What {agent} did",
} as const;
