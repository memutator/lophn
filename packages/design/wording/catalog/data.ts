export const data = {
  "confirmation-window.approval.no-external":
    "Nothing outside lophn is affected.",
  "confirmation-window.approval.title": "Allow this action?",
  "confirmation-window.automation.effect":
    "Once you allow it, lophn uses this command on schedule without asking again, always with exactly this input.",
  "confirmation-window.automation.effect-external":
    "This command changes things outside the app. Once you allow it, it does so on schedule without asking again, always with exactly this input.",
  "confirmation-window.automation.not-ready":
    "It can't start right now. Allowing it turns it on for when it can.",
  "confirmation-window.automation.now": "This automation is off.",
  "confirmation-window.automation.subject-minutes":
    "{app} will use {command} on its own every {minutes, plural, one {# minute} other {# minutes}}.",
  "confirmation-window.automation.subject-seconds":
    "{app} will use {command} on its own every {seconds, number} seconds.",
  "confirmation-window.automation.subject-start":
    "{app} will use {command} on its own each time it starts.",
  "confirmation-window.body.checking": "Checking this request.",
  "confirmation-window.body.expired": "This confirmation expired.",
  "confirmation-window.body.review": "Review this request before you decide.",
  "confirmation-window.body.second":
    "Check the effect and scope again before you decide.",
  "confirmation-window.body.stale":
    "This request changed. Open the latest version.",
  "confirmation-window.body.unknown":
    "The result is not known yet. It was not sent again.",
  "confirmation-window.button.allow-access": "Allow access",
  "confirmation-window.button.allow-once": "Allow once",
  "confirmation-window.button.allow-session": "Allow for this session",
  "confirmation-window.button.back": "Back",
  "confirmation-window.button.cancel": "Cancel",
  "confirmation-window.button.cancel-request": "Cancel request",
  "confirmation-window.button.choose": "Choose this option",
  "confirmation-window.button.close": "Close",
  "confirmation-window.button.connection-revoke": "Revoke",
  "confirmation-window.button.decide": "Decide",
  "confirmation-window.button.delete-file": "Delete file",
  "confirmation-window.button.disconnect": "Disconnect",
  "confirmation-window.button.problem-dismiss": "Stop working on it",
  "confirmation-window.button.problem-fixed": "Mark as fixed",
  "confirmation-window.button.problem-not-fixed": "Say it's still not fixed",
  "confirmation-window.button.problem-not-visible": "Say I can't see it",
  "confirmation-window.button.refresh": "Open latest",
  "confirmation-window.button.reject": "Reject",
  "confirmation-window.button.rewind": "Rewind",
  "confirmation-window.button.rewind-anyway": "Rewind anyway",
  "confirmation-window.button.save": "Save",
  "confirmation-window.button.summarize": "Summarize",
  "confirmation-window.button.turn-on": "Turn on automation",
  "confirmation-window.button.use-version": "Use this version",
  "confirmation-window.change.missing":
    "There is nothing to compare for this change.",
  "confirmation-window.change.none": "Nothing here.",
  "confirmation-window.change.omitted":
    "Some of this change could not be shown.",
  "confirmation-window.confirm.input-note":
    "The input itself isn't kept with this request. The fingerprint identifies exactly the input that will be used.",
  "confirmation-window.confirm.now": "This hasn't been done yet.",
  "confirmation-window.confirm.preview-none":
    "No safe preview is available for this action. Nothing is tried before you decide.",
  "confirmation-window.confirm.subject":
    "{caller, select, direct {You ask {app} to use {command} once} app {{name} asks {app} to use {command} once} other {An agent asks {app} to use {command} once}}.",
  "confirmation-window.connection.already-revoked":
    "This connection is already revoked.",
  "confirmation-window.connection.effect-revoke":
    "lophn stops accepting requests from this connection right away.",
  "confirmation-window.connection.note-revoke":
    "A revoked connection can't be turned back on. Connect again to make a new one. Anything already running in your coding agent keeps running.",
  "confirmation-window.error.save": "Couldn't save the value. Try again.",
  "confirmation-window.error.send": "Couldn't send this decision. Try again.",
  "confirmation-window.error.too-long":
    "This text is too long. Shorten it and try again.",
  "confirmation-window.error.unavailable":
    "lophn can't take this right now. Try again later.",
  "confirmation-window.file-delete.effect":
    "The file leaves the project. This cannot be undone.",
  "confirmation-window.file-delete.subject":
    "This file will be removed from the project.",
  "confirmation-window.file-delete.title": "Delete this file?",
  "confirmation-window.grant-effect.agent-commands":
    "Agents can use the commands listed here in this app, within what their role allows.",
  "confirmation-window.grant-effect.app-call":
    "The app can use the commands listed here in the target app. This doesn't allow anything the target app asks you to confirm.",
  "confirmation-window.grant-effect.document-save":
    "The app can save documents into the place named by this key.",
  "confirmation-window.grant-effect.fs-read":
    "The app can read what is at this path, including everything under it when subfolders are included.",
  "confirmation-window.grant-effect.fs-write":
    "The app can create, change and delete what is at this path, including everything under it when subfolders are included.",
  "confirmation-window.grant-effect.net-fetch":
    "The app can send requests to this host and port and read the answers.",
  "confirmation-window.grant-effect.net-listen":
    "The app can accept connections on this local host and port.",
  "confirmation-window.grant-effect.secret-use":
    "The app can use this secret without ever seeing its value.",
  "confirmation-window.grant-effect.unknown":
    "This access isn't described here. Check the exact request.",
  "confirmation-window.grant.already":
    "This access is already allowed. Allowing it again changes nothing.",
  "confirmation-window.grant.limit-cpu":
    "lophn doesn't strongly limit how much CPU an app uses.",
  "confirmation-window.grant.limit-disk":
    "lophn doesn't strongly limit how much disk an app uses.",
  "confirmation-window.grant.limit-not-isolated":
    "App protection is Deno permissions, not a virtual machine or container, so it is not full isolation.",
  "confirmation-window.grant.limit-path-secrets":
    "Anything inside an allowed folder, secrets included, can be read by the app.",
  "confirmation-window.grant.limit-rss":
    "lophn doesn't strongly limit how much memory an app uses. A Deno heap setting is not a limit on total memory.",
  "confirmation-window.grant.limit-symlink":
    "If something adds a link inside an allowed folder after you allow it, the app may reach beyond the folder.",
  "confirmation-window.grant.limit-unknown":
    "There is a limit on app protection that can't be described here.",
  "confirmation-window.grant.subject": "{app} is asking for this access.",
  "confirmation-window.grant.warning-file-read-network":
    "This app asked to both read files and use the network. Together they could send your files out of this computer.",
  "confirmation-window.grant.warning-outside-link":
    "Some links inside this folder point outside it, so the app could read what they point to.",
  "confirmation-window.grant.warning-unknown":
    "This access has a warning that can't be described here.",
  "confirmation-window.heading.access": "Access",
  "confirmation-window.heading.automations": "Automations",
  "confirmation-window.heading.commands": "Commands",
  "confirmation-window.heading.data": "Data",
  "confirmation-window.heading.effect": "What this affects",
  "confirmation-window.heading.preview": "Preview",
  "confirmation-window.heading.problems": "Problem reports",
  "confirmation-window.heading.revert": "Undo",
  "confirmation-window.heading.screens": "Screens",
  "confirmation-window.heading.subject": "What changes",
  "confirmation-window.input.blob":
    "The full input is kept separately and checked by this fingerprint.",
  "confirmation-window.label.action": "Action",
  "confirmation-window.label.added": "Added",
  "confirmation-window.label.app": "App",
  "confirmation-window.label.automation": "Automation",
  "confirmation-window.label.change-confirm": "Asking you first",
  "confirmation-window.label.change-effect": "What it does",
  "confirmation-window.label.change-input": "Input",
  "confirmation-window.label.change-revert": "Undo support",
  "confirmation-window.label.changed": "Changed",
  "confirmation-window.label.close-reason":
    "Reason for rejecting or cancelling (optional)",
  "confirmation-window.label.command": "Command",
  "confirmation-window.label.commands": "Commands",
  "confirmation-window.label.comparison": "Checked against",
  "confirmation-window.label.connection-all": "All apps",
  "confirmation-window.label.connection-app": "Only {name}",
  "confirmation-window.label.connection-scope": "Reaches",
  "confirmation-window.label.current": "Now",
  "confirmation-window.label.data-version": "Data version",
  "confirmation-window.label.details": "Details",
  "confirmation-window.label.document-key": "Document key",
  "confirmation-window.label.effect-external": "Changes things outside the app",
  "confirmation-window.label.effect-read": "Only reads data",
  "confirmation-window.label.effect-write": "Changes data in the app",
  "confirmation-window.label.exact-request": "Exact request",
  "confirmation-window.label.expires": "Decide by",
  "confirmation-window.label.full": "Full change",
  "confirmation-window.label.host": "Host",
  "confirmation-window.label.input": "Exact input",
  "confirmation-window.label.input-fingerprint": "Input fingerprint",
  "confirmation-window.label.input-shape": "Input it accepts",
  "confirmation-window.label.limits": "What app protection can't do",
  "confirmation-window.label.name-only": "Only the name or description changed",
  "confirmation-window.label.new-inputs": "New required input",
  "confirmation-window.label.next": "After",
  "confirmation-window.label.no": "No",
  "confirmation-window.label.owner": "Handled by",
  "confirmation-window.label.path": "Path",
  "confirmation-window.label.port": "Port",
  "confirmation-window.label.problem-reason": "Your reason",
  "confirmation-window.label.problem-seen": "Times seen",
  "confirmation-window.label.problem-version": "Version in use",
  "confirmation-window.label.question": "Question",
  "confirmation-window.label.reaches-outside": "Now reaches outside the app",
  "confirmation-window.label.reason": "Why",
  "confirmation-window.label.recommended": "Recommended",
  "confirmation-window.label.removed": "Removed",
  "confirmation-window.label.requested-by": "Requested by",
  "confirmation-window.label.schedule": "Schedule",
  "confirmation-window.label.secret-code": "Code or final address",
  "confirmation-window.label.secret-key": "Key",
  "confirmation-window.label.secret-name": "Secret name",
  "confirmation-window.label.secret-value": "Value",
  "confirmation-window.label.subfolders": "Includes subfolders",
  "confirmation-window.label.target-app": "Target app",
  "confirmation-window.label.targets": "Applies to",
  "confirmation-window.label.yes": "Yes",
  "confirmation-window.option-action.effect":
    "After you choose, lophn makes exactly the change shown here.",
  "confirmation-window.option-action.title": "Choose {option}?",
  "confirmation-window.problem.effect-dismiss":
    "lophn stops working on this issue and closes it. It isn't marked as fixed.",
  "confirmation-window.problem.effect-fixed":
    "lophn closes this issue as checked by you. That isn't a test result.",
  "confirmation-window.problem.effect-not-fixed":
    "lophn keeps this issue open, or opens it again if it was closed. It doesn't start any work by itself.",
  "confirmation-window.problem.effect-not-visible":
    "lophn closes this issue as no longer seen. That isn't a fix and isn't a test result.",
  "confirmation-window.problem.note-dismiss":
    "You can open it again later by saying it's still not fixed.",
  "confirmation-window.problem.note-fixed":
    "If it happens again in the version in use, lophn opens it again.",
  "confirmation-window.problem.note-not-fixed":
    "You can mark it as fixed later.",
  "confirmation-window.problem.note-not-visible":
    "If it shows up again, lophn opens it again.",
  "confirmation-window.release.effect":
    "The app restarts on the new version. Its data stays unless Data below lists a change.",
  "confirmation-window.release.effect-data":
    "The app restarts on the new version, and its data changes as listed under Data, including anything that may be lost.",
  "confirmation-window.release.first":
    "This is the first version of the app, so there is nothing earlier to compare it with.",
  "confirmation-window.release.none":
    "Nothing changed from the version in use.",
  "confirmation-window.release.preview-none":
    "No preview is available for this version.",
  "confirmation-window.release.preview-ready":
    "A preview of this version is ready. Open it from the app to try it safely.",
  "confirmation-window.release.review":
    "Review needed. lophn can't tell whether this version works the same as the one in use, so check each change below.",
  "confirmation-window.release.subject":
    "{app} will switch to version {number, number}.",
  "confirmation-window.result.allowed":
    "You allowed this. It hasn't happened yet, and its result will show in Things to confirm.",
  "confirmation-window.result.answered":
    "Your answer is saved. lophn makes the change next, and its result will show in Things to confirm.",
  "confirmation-window.result.cancelled":
    "You cancelled this request. Nothing will happen.",
  "confirmation-window.result.connection-revoked":
    "Revoked. lophn no longer accepts this connection.",
  "confirmation-window.result.decision-received":
    "Your answer was received. The issue will update shortly.",
  "confirmation-window.result.decision-saved":
    "Your answer is saved. The issue updates to match it.",
  "confirmation-window.result.rejected":
    "You rejected this. Nothing will happen.",
  "confirmation-window.result.removed": "{name} won't be used for new work.",
  "confirmation-window.result.rewind-blocked":
    "Nothing changed. The list changed since you looked, so choose again.",
  "confirmation-window.result.rewind-partly":
    "Some of it was rewound. The rest stays as it is, and the conversation lists it.",
  "confirmation-window.result.rewind-started":
    "Rewinding. lophn is undoing the app changes, and the result will show in the conversation.",
  "confirmation-window.result.rewind-unknown":
    "Some results aren't known yet. Nothing will be repeated.",
  "confirmation-window.result.rewound":
    "Rewound. The conversation shows what changed.",
  "confirmation-window.result.saved": "{name} is saved.",
  "confirmation-window.revert.impossible": "You cannot undo this.",
  "confirmation-window.revert.possible": "You can undo this later.",
  "confirmation-window.revert.unknown":
    "Whether this can be undone isn't known.",
  "confirmation-window.revoke.effect":
    "This app will no longer have this access. Any running app process must stop before removal completes.",
  "confirmation-window.revoke.subject": "{app} has this access now.",
  "confirmation-window.rewind.second-body":
    "These are not restored. The rest will be rewound if you go on.",
  "confirmation-window.rewind.subject-messages-only":
    "The messages after this point are hidden. Documents and app data stay as they are.",
  "confirmation-window.rewind.subject-restore-all":
    "The messages after this point are hidden, and the documents and app data that changed since are put back as far as lophn can.",
  "confirmation-window.rewind.subject-summarize":
    "The messages from this point on are folded into a summary. Documents and app data stay as they are.",
  "confirmation-window.secret-app.title": "Save a value for {name}?",
  "confirmation-window.secret-code.title": "Finish signing in?",
  "confirmation-window.secret-disconnect.effect":
    "lophn deletes the saved key or sign-in for this provider. Agents that use it can't start until you connect it again.",
  "confirmation-window.secret-disconnect.revert":
    "You can connect the provider again later.",
  "confirmation-window.secret-disconnect.subject":
    "This provider is connected with one key or sign-in. Nothing needs to be typed to disconnect it.",
  "confirmation-window.secret-disconnect.title": "Disconnect {name}?",
  "confirmation-window.secret-key.title": "Add the key {name}?",
  "confirmation-window.secret.configured":
    "{name} already has a value. Replacing it isn't available here yet.",
  "confirmation-window.secret.effect":
    "Apps you allowed can use it without seeing it.",
  "confirmation-window.secret.revert": "You can remove it later.",
  "confirmation-window.secret.subject":
    "What you type goes straight to your system keychain. lophn and apps never show it.",
  "confirmation-window.title.automation": "Turn on {automation} in {app}?",
  "confirmation-window.title.confirm": "Confirm",
  "confirmation-window.title.confirm-command": "Allow {command} in {app}?",
  "confirmation-window.title.connection-revoke": "Revoke this connection?",
  "confirmation-window.title.grant-agent-commands":
    "Let agents use commands in {app}?",
  "confirmation-window.title.grant-app-call": "Let {app} use another app?",
  "confirmation-window.title.grant-document-save": "Let {app} save documents?",
  "confirmation-window.title.grant-fs-read": "Let {app} read files?",
  "confirmation-window.title.grant-fs-write": "Let {app} change files?",
  "confirmation-window.title.grant-net-fetch":
    "Let {app} connect to the network?",
  "confirmation-window.title.grant-net-listen":
    "Let {app} listen for connections?",
  "confirmation-window.title.grant-secret-use": "Let {app} use a secret?",
  "confirmation-window.title.problem-dismiss": "Stop working on this issue?",
  "confirmation-window.title.problem-fixed": "Mark this issue as fixed?",
  "confirmation-window.title.problem-not-fixed":
    "Say this issue is still not fixed?",
  "confirmation-window.title.problem-not-visible":
    "Say you can't see this issue now?",
  "confirmation-window.title.release": "Use version {number, number} of {app}?",
  "confirmation-window.title.revoke-access": "Remove access for {app}?",
  "confirmation-window.title.rewind-messages-only": "Rewind messages only?",
  "confirmation-window.title.rewind-restore-all":
    "Rewind messages and documents?",
  "confirmation-window.title.rewind-second": "Some things stay as they are",
  "confirmation-window.title.rewind-summarize": "Summarize from here?",
  "launcher.connection.confirmed-at": "Last checked {when}.",
  "launcher.connection.disconnected":
    "lophn can't refresh this page right now.",
  "launcher.connection.failed": "lophn couldn't get ready.",
  "launcher.connection.starting": "lophn is getting ready.",
  "report-problem.button.copy-text": "Copy your text",
  "report-problem.button.send": "Send report",
  "report-problem.button.view-issue": "View issue",
  "report-problem.error.rejected": "lophn couldn't accept this report.",
  "report-problem.error.too-long": "Keep it to 500 characters or fewer.",
  "report-problem.error.unreachable":
    "Your report wasn't sent because lophn couldn't be reached.",
  "report-problem.heading.sent-with": "Sent with your report",
  "report-problem.hint.draft-memory":
    "Your text is kept only while this window is open.",
  "report-problem.label.screen-details": "Screen name and location",
  "report-problem.label.screenshot": "Screenshot of this app",
  "report-problem.label.what-happened": "What went wrong?",
  "report-problem.notice.capturing": "Taking a screenshot of this app.",
  "report-problem.notice.copy-text": "Copy your text so you don't lose it.",
  "report-problem.notice.existing-issue":
    "This report is added to the issue you were looking at.",
  "report-problem.notice.new-issue":
    "This report isn't added to an existing issue.",
  "report-problem.notice.screen-not-sent": "Screen details won't be sent.",
  "report-problem.notice.screenshot-failed":
    "Couldn't take a screenshot of this app. You can still send your text.",
  "report-problem.notice.screenshot-hidden":
    "No screenshot because this app wasn't showing.",
  "report-problem.notice.screenshot-not-selected":
    "The screenshot is sent only if you select it.",
  "report-problem.notice.screenshot-protected":
    "No screenshot because another lophn window was open over this app.",
  "report-problem.status.received": "Received. lophn will look into it.",
  "report-problem.status.sending": "Sending your report.",
  "report-problem.title.report": "Report a problem",
  "waiting.button.allow": "Allow",
  "waiting.button.allow-always": "Always allow",
  "waiting.button.allow-once": "Allow once",
  "waiting.button.allow-session": "Allow for this session",
  "waiting.button.answer-in-terminal": "Answer in terminal",
  "waiting.button.cancel": "Cancel",
  "waiting.button.deny": "Deny",
  "waiting.button.open-session": "Open session",
  "waiting.label.activation-first":
    "Declared by this version (nothing was active before)",
  "waiting.label.activation-new": "New since the last version",
  "waiting.label.agent-app-engineer": "App Engineer",
  "waiting.label.agent-coding": "Coding agent",
  "waiting.label.agent-lophn": "lophn",
  "waiting.label.agent-operator": "Operator",
  "waiting.label.agent-project-manager": "Project Manager",
  "waiting.label.agent-reaction": "Reaction",
  "waiting.label.declared-app-api": "Other app",
  "waiting.label.declared-file-read": "File (read)",
  "waiting.label.declared-file-write": "File (write)",
  "waiting.label.declared-listen": "Listens on",
  "waiting.label.declared-network": "Network host",
  "waiting.label.declared-other": "Other",
  "waiting.label.declared-secret": "Secret",
  "waiting.label.effect-external": "external",
  "waiting.label.effect-read": "read",
  "waiting.label.effect-write": "write",
  "waiting.label.event-activation-failed": "An activation failed",
  "waiting.label.event-app-restart-halted": "App restarts were halted",
  "waiting.label.event-context-violation": "A context rule was broken",
  "waiting.label.event-problem-opened": "A problem was opened",
  "waiting.label.event-problem-reopened": "A problem was reopened",
  "waiting.label.fact-detail": "Detail",
  "waiting.label.fact-effect": "Effect",
  "waiting.label.fact-event": "Event",
  "waiting.label.fact-input": "Input",
  "waiting.label.fact-opens": "Opens",
  "waiting.label.fact-target": "Target",
  "waiting.label.group-approval": "Approvals",
  "waiting.label.group-permission": "Permission requests",
  "waiting.label.group-question": "Questions",
  "waiting.label.hide-details": "Hide details",
  "waiting.label.loss-drop-column": "Drops column",
  "waiting.label.loss-drop-table": "Drops table",
  "waiting.label.loss-heading": "Data loss",
  "waiting.label.loss-narrow-type": "Narrows type",
  "waiting.label.panel": "Waiting",
  "waiting.label.panel-scope": "All sessions",
  "waiting.label.pill": "{count, number} waiting",
  "waiting.label.place-app": "App {id}",
  "waiting.label.place-project": "Project {id}",
  "waiting.label.reason": "Reason (optional)",
  "waiting.label.session": "Session {id}",
  "waiting.label.settings-agent-definition": "an agent's definition",
  "waiting.label.settings-grant": "permissions",
  "waiting.label.settings-instructions": "instructions",
  "waiting.label.settings-setting": "a setting",
  "waiting.label.settings-skill": "a skill",
  "waiting.label.settled": "Just settled",
  "waiting.label.settled-accepted": "Allowed, applying",
  "waiting.label.settled-applied": "Allowed, applied",
  "waiting.label.settled-cancelled": "Cancelled",
  "waiting.label.settled-denied": "Denied",
  "waiting.label.settled-failed": "Allowed, not applied",
  "waiting.label.show-details": "Show details",
  "waiting.label.target-app-api": "{app} › {api}",
  "waiting.label.target-mcp-tool": "{server} › {tool}",
  "waiting.notice.activation-fine":
    "Only added declarations and data-loss steps are shown.",
  "waiting.notice.activation-first":
    "First activation, so every declaration is new: {declared, plural, one {# declaration} other {# declarations}}, {lost, plural, one {# data-loss step} other {# data-loss steps}}.",
  "waiting.notice.activation-since":
    "Since the last version: {declared, plural, one {# new declaration} other {# new declarations}}, {lost, plural, one {# data-loss step} other {# data-loss steps}}.",
  "waiting.notice.agent-call": "Sends work to {agent}.",
  "waiting.notice.app-api-external":
    "Does something outside lophn through {target}.",
  "waiting.notice.app-api-read": "Reads data from {target}.",
  "waiting.notice.app-api-write": "Changes data in {target}.",
  "waiting.notice.app-resource": "Uses {target}.",
  "waiting.notice.coding":
    "A coding agent is waiting for your answer in its terminal tab.",
  "waiting.notice.decide-failed": "Couldn't send your answer. Try again.",
  "waiting.notice.empty": "Nothing is waiting for you.",
  "waiting.notice.mcp-tool": "Uses {target}, a tool on an outside server.",
  "waiting.notice.question-in-session":
    "This question needs your answer in the session.",
  "waiting.notice.question-loading": "Loading the question.",
  "waiting.notice.question-multiple":
    "{count, plural, one {# question} other {# questions}} to answer in the session.",
  "waiting.notice.reason-help": "Sent to {agent} as the tool result.",
  "waiting.notice.settings-edit": "Changes {what}.",
  "waiting.notice.settled-accepted": "It is being applied now.",
  "waiting.notice.settled-applied": "It was applied.",
  "waiting.notice.settled-cancelled": "The work ended before you answered.",
  "waiting.notice.settled-denied": "You denied it.",
  "waiting.notice.settled-denied-reason": "The reason was sent to {agent}.",
  "waiting.notice.settled-failed":
    "You allowed it, but it could not be applied.",
  "waiting.toast-approval.button": "Review",
  "waiting.toast-approval.body": "Look at what it changes before you decide.",
  "waiting.toast-approval.title":
    "{intent, select, activation {An app update needs approval} other {A request needs approval}}",
  "waiting.toast-permission.button": "Review",
  "waiting.toast-permission.body": "It is waiting for your answer.",
  "waiting.toast-permission.title": "{agent} needs permission",
  "waiting.toast-question.button": "Review",
  "waiting.toast-question.body": "Open the list to answer it.",
  "waiting.toast-question.title": "{agent} has a question",
  "waiting.toast-restart-halted.button": "Open session",
  "waiting.toast-restart-halted.body":
    "{app} kept crashing, so lophn stopped restarting it.",
  "waiting.toast-restart-halted.title": "App restart halted",
  "waiting.toast-violation.button": "Ask Project Manager",
  "waiting.toast-violation.body":
    "A check found documents that don't match the contract in context {context}.",
  "waiting.toast-violation.title": "Documents don't match the contract",
  "waiting.title.activation": "Activate a new version of {app}",
  "waiting.title.agent-call": "Send work to another agent",
  "waiting.title.app-api": "Use {api} in {app}",
  "waiting.title.app-resource": "Use a resource outside the app",
  "waiting.title.coding": "Permission request in the terminal",
  "waiting.title.mcp-tool": "Use the {tool} tool",
  "waiting.title.question": "Question",
  "waiting.title.reaction": "Open a session with {agent}?",
  "waiting.title.settings-edit": "Change settings",
} as const;
