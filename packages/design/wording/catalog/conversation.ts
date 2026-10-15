export const conversation = {
  "conversation.body.delete-session":
    'Delete "{title}"? Anything other agents handed to this session and still waiting for an answer will fail. This can\'t be undone.',
  "conversation.body.save-visual-request":
    "Save the visual “{title}” (block {block} in message {message}) as a document.",
  "conversation.body.skill-command-request":
    'Use the "{skill}" skill for this request.',
  "conversation.button.approval-allow": "Allow",
  "conversation.button.approval-allow-always": "Always allow",
  "conversation.button.approval-allow-once": "Allow once",
  "conversation.button.approval-allow-scope": "Allow scope",
  "conversation.button.approval-allow-session": "Allow for this session",
  "conversation.button.approval-deny": "Deny",
  "conversation.button.archive": "Archive",
  "conversation.button.archived-toggle": "Archived ({count, number})",
  "conversation.button.attach": "Add attachment",
  "conversation.button.change-defaults": "Change defaults…",
  "conversation.button.check-delivery": "Check whether it arrived",
  "conversation.button.check-result": "Check the result",
  "conversation.button.close-tab": "Close tab",
  "conversation.button.delete": "Delete",
  "conversation.button.edit-open": "Open",
  "conversation.button.edit-undo": "Undo",
  "conversation.button.favorite-add": "Add {model} to favorites",
  "conversation.button.favorite-remove": "Remove {model} from favorites",
  "conversation.button.fork": "Fork",
  "conversation.button.fork-here": "Fork from here",
  "conversation.button.hidden-hide": "Hide",
  "conversation.button.hidden-show": "Show",
  "conversation.button.jump-latest": "Jump to newest messages",
  "conversation.button.model-reset": "Reset",
  "conversation.button.permissions-edit": "Edit in Agents",
  "conversation.button.question-details": "Details",
  "conversation.button.question-next": "Next",
  "conversation.button.question-skip": "Skip",
  "conversation.button.question-submit": "Submit",
  "conversation.button.queued-remove": "Remove from the queue",
  "conversation.button.recap-dismiss": "Dismiss",
  "conversation.button.redo": "Redo",
  "conversation.button.remove-context": "Remove context",
  "conversation.button.rename": "Rename",
  "conversation.button.resend": "Send again",
  "conversation.button.restore": "Restore",
  "conversation.button.rewind": "Rewind…",
  "conversation.button.rewind-go": "Rewind",
  "conversation.button.rewind-here": "Rewind to here",
  "conversation.button.save": "Save",
  "conversation.button.send": "Send",
  "conversation.button.send-now": "Send now",
  "conversation.button.session-new": "New session",
  "conversation.button.show-all-results": "Show all results",
  "conversation.button.stop": "Stop",
  "conversation.button.summarize-go": "Summarize",
  "conversation.button.summarizing": "Summarizing…",
  "conversation.button.usage": "Usage",
  "conversation.empty.no-agent": "lophn isn't set up for conversations yet.",
  "conversation.empty.no-messages":
    "Nothing here yet. Write what you need below.",
  "conversation.error.action-failed": "That didn't work. Try again.",
  "conversation.error.load-failed":
    "Couldn't load this conversation. Try again.",
  "conversation.error.message-body": "Couldn't load this message.",
  "conversation.error.open-failed":
    "Couldn't start a new conversation. Try again.",
  "conversation.error.stop-failed": "Couldn't stop this work. Try again.",
  "conversation.error.too-long":
    "This message is too long to send. Shorten it, or split it into parts.",
  "conversation.label.approval": "Approval",
  "conversation.label.approval-app": "App {id}",
  "conversation.label.approval-applied": "Allowed, applied",
  "conversation.label.approval-cancelled": "Cancelled",
  "conversation.label.approval-cancelled-detail": "The work ended first",
  "conversation.label.approval-denied": "Denied",
  "conversation.label.approval-effect": "Effect",
  "conversation.label.approval-effect-external": "Reaches outside lophn",
  "conversation.label.approval-effect-read": "Reads data",
  "conversation.label.approval-effect-write": "Changes data",
  "conversation.label.approval-esc": "Esc",
  "conversation.label.approval-input": "Input",
  "conversation.label.approval-preview": "Preview",
  "conversation.label.approval-reason": "Reason for denying",
  "conversation.label.approval-reason-given": "Reason: {reason}",
  "conversation.label.approval-reason-placeholder":
    "Why not? {agent} reads this (optional)",
  "conversation.label.approval-received": "Allowed, applying",
  "conversation.label.approval-scope-always": "Always",
  "conversation.label.approval-scope-once": "Once",
  "conversation.label.approval-scope-session": "For this session",
  "conversation.label.approval-settings-agent-definition":
    "An agent's definition",
  "conversation.label.approval-settings-grant": "Permissions",
  "conversation.label.approval-settings-instructions": "Instructions",
  "conversation.label.approval-settings-setting": "A setting",
  "conversation.label.approval-settings-skill": "A skill",
  "conversation.label.approval-target": "Target",
  "conversation.label.approval-target-app-api": "{api} in {app}",
  "conversation.label.approval-target-mcp-tool": "{tool} on {server}",
  "conversation.label.approval-target-other": "Other request",
  "conversation.label.archived": "Archived",
  "conversation.label.author-check": "Checked by lophn",
  "conversation.label.coding-queued": "Waiting for a coding agent",
  "conversation.label.composer-message": "Message",
  "conversation.label.correction": "Change",
  "conversation.label.delete-session": "Delete {title}",
  "conversation.label.delivery-applied": "Taken into account",
  "conversation.label.delivery-not-sent": "Not sent",
  "conversation.label.delivery-received": "Received",
  "conversation.label.delivery-saved": "Saved, not started",
  "conversation.label.delivery-sending": "Sending",
  "conversation.label.delivery-unconfirmed": "Not confirmed",
  "conversation.label.duration-days-hours": "{days, number}d {hours, number}h",
  "conversation.label.duration-hours-minutes":
    "{hours, number}h {minutes, number}m",
  "conversation.label.duration-minutes": "{minutes, number}m",
  "conversation.label.duration-minutes-seconds":
    "{minutes, number}m {seconds, number}s",
  "conversation.label.duration-seconds": "{seconds, number}s",
  "conversation.label.edit-made": "Edited",
  "conversation.label.edit-undone": "Undid the edit to",
  "conversation.label.favorites": "Favorites",
  "conversation.label.grant-allow": "Runs without asking",
  "conversation.label.grant-ask": "Asks first",
  "conversation.label.grant-deny": "Not allowed",
  "conversation.label.group-earlier": "Earlier",
  "conversation.label.model-changed": "Changed",
  "conversation.label.model-list": "Models",
  "conversation.label.model-unknown": "Model",
  "conversation.label.more-actions": "More",
  "conversation.label.more-results":
    "{count, plural, one {+# more} other {+# more}}",
  "conversation.label.next-turn": "Next turn",
  "conversation.label.permission-summary":
    "{count, plural, =0 {Ask first} one {Ask first, # tool allowed} other {Ask first, # tools allowed}}",
  "conversation.label.permissions-may": "What {agent} may do",
  "conversation.label.permissions-of": "Permissions of {agent}",
  "conversation.label.permissions-session": "Allowed for this session",
  "conversation.label.question-answered":
    "Answered {count, plural, one {# question} other {# questions}}: {answers}",
  "conversation.label.question-answered-elsewhere":
    "Answered in another window",
  "conversation.label.question-applied": "Applied: {answers}",
  "conversation.label.question-apply-failed": "Couldn't apply: {answers}",
  "conversation.label.question-applying": "Applying: {answers}",
  "conversation.label.question-asking":
    "{agent} is asking {count, plural, one {# question} other {# questions}}",
  "conversation.label.question-cancelled": "Cancelled",
  "conversation.label.question-card": "Questions from {agent}",
  "conversation.label.question-expired": "Expired",
  "conversation.label.question-expires": "Expires in {remaining}",
  "conversation.label.question-expires-now": "Expiring now",
  "conversation.label.question-following": "Next question",
  "conversation.label.question-no-answer": "No answer picked",
  "conversation.label.question-own-answer": "Type your own answer: {prompt}",
  "conversation.label.question-own-answer-placeholder": "Type your own answer",
  "conversation.label.question-paused": "Work is paused until you answer",
  "conversation.label.question-pick-any": "Pick any",
  "conversation.label.question-previous": "Previous question",
  "conversation.label.question-recommended": "(Recommended)",
  "conversation.label.question-skipped": "Skipped",
  "conversation.label.questions-answered":
    "Answered {count, plural, one {# question} other {# questions}}",
  "conversation.label.questions-ended-by-message": "Ended by your message",
  "conversation.label.queued-messages": "Waiting for the next turn",
  "conversation.label.read-session": "Read {title}",
  "conversation.label.rename-session": "Rename {title}",
  "conversation.label.request-position": "{current, number} of {total, number}",
  "conversation.label.requests": "Waiting for you",
  "conversation.label.results": "Results",
  "conversation.label.rewind-app-also": "Also rewind {app}",
  "conversation.label.rewind-app-unknown":
    "{count, plural, one {# write has} other {# writes have}} an unknown result and cannot be undone",
  "conversation.label.rewind-app-writes":
    "{count, plural, one {# write} other {# writes}} by this session after this message",
  "conversation.label.rewind-apps-head":
    "Apps this session wrote to after this message",
  "conversation.label.rewind-conversation": "Conversation",
  "conversation.label.rewind-files":
    "Also restore files changed with file tools",
  "conversation.label.rewind-hidden":
    "Rewound here · {count, plural, one {# message} other {# messages}} hidden",
  "conversation.label.rewind-item-answer": "An answer you gave",
  "conversation.label.rewind-item-app": "An app change",
  "conversation.label.rewind-item-approval": "An approval decision",
  "conversation.label.rewind-item-external": "A request that already went out",
  "conversation.label.rewind-item-fact": "Something that already happened",
  "conversation.label.rewind-loading": "Checking what would change…",
  "conversation.label.rewind-messages-only": "Restore messages only",
  "conversation.label.rewind-others":
    "Also goes back, though this session did not do it",
  "conversation.label.rewind-outside": "Stays as it is, outside lophn",
  "conversation.label.rewind-point": "Rewind to",
  "conversation.label.rewind-quote": "Rewind to this message",
  "conversation.label.rewind-restore-all": "Restore messages and documents",
  "conversation.label.rewind-summarize": "Summarize from here",
  "conversation.label.rewind-summary-apps": "Conversation, files and {apps}",
  "conversation.label.rewind-summary-files": "Conversation and files only",
  "conversation.label.rewind-summary-messages": "Conversation only",
  "conversation.label.rewind-summary-messages-apps": "Conversation and {apps}",
  "conversation.label.rewind-write-unknown": "Result unknown",
  "conversation.label.search-models": "Search models",
  "conversation.label.search-sessions": "Search {agent} sessions",
  "conversation.label.send-correction": "Change this work",
  "conversation.label.send-mode": "Send as",
  "conversation.label.send-request": "Next request",
  "conversation.label.session-list": "{agent} sessions",
  "conversation.label.session-untitled": "New session",
  "conversation.label.since-now": "now",
  "conversation.label.slash-menu": "Commands",
  "conversation.label.slash-unknown": "Unknown command: /{name}",
  "conversation.label.status-stopped": "Stopped",
  "conversation.label.status-working": "Working",
  "conversation.label.tasks": "Tasks",
  "conversation.label.tasks-progress":
    "Tasks · {done, number} of {total, number}",
  "conversation.label.tool-read-documents":
    "{count, plural, one {Read # document} other {Read # documents}}",
  "conversation.label.tool-used":
    "{count, plural, one {Used {tool}} other {Used {tool} # times}}",
  "conversation.label.view-compact": "Compact",
  "conversation.label.view-detail": "View detail",
  "conversation.label.view-everything": "Everything",
  "conversation.label.view-messages": "Messages",
  "conversation.label.worked-for": "Worked for {duration}",
  "conversation.notice.agent-paused":
    "This agent is paused. You can read the conversation, but it takes no new messages.",
  "conversation.notice.answer-failed": "Couldn't send your answers. Try again.",
  "conversation.notice.approval-paused": "{agent} is paused until you decide.",
  "conversation.notice.decide-failed":
    "Couldn't send your decision. Try again.",
  "conversation.notice.ended":
    "This conversation has ended. You can read it but not reply.",
  "conversation.notice.external-failed":
    "{connection} didn't respond, so this chat can't continue.",
  "conversation.notice.external-retry-at":
    "The next try is confirmed for {when}.",
  "conversation.notice.external-unknown":
    "The result from {connection} isn't known yet.",
  "conversation.notice.external-waiting":
    "Waiting for {connection}. It has not answered.",
  "conversation.notice.message-loading": "Loading this message.",
  "conversation.notice.no-model-options": "No options for this model.",
  "conversation.notice.no-models": "No models match.",
  "conversation.notice.not-found":
    "lophn didn't find this message. Sending it again won't make a copy.",
  "conversation.notice.not-sent":
    "This message wasn't sent. It's still in the box, so you can send it again.",
  "conversation.notice.offline": "You can send once lophn is connected again.",
  "conversation.notice.permissions-edited-in-agents":
    "Grants are edited in Agents.",
  "conversation.notice.permissions-session-empty": "Nothing yet.",
  "conversation.notice.permissions-session-ends":
    "These end when this session is archived or deleted.",
  "conversation.notice.question-waiting":
    "Waiting for your answer. Sending a message instead also ends the questions.",
  "conversation.notice.questions-ended-by-message":
    "You sent a message while the questions were open, so they closed. The agent reads your message as the answer.",
  "conversation.notice.recap-local":
    "Only shown here. The conversation itself is unchanged.",
  "conversation.notice.rewind-apps":
    "A checked app goes back to this message, including changes others made since. Unchecked apps stay as they are.",
  "conversation.notice.rewind-conversation":
    "Messages after this one are removed from the conversation.",
  "conversation.notice.rewind-no-apps":
    "This session did not write to any app after this message.",
  "conversation.notice.rewind-no-files":
    "No files were changed with file tools after this message.",
  "conversation.notice.rewind-shell-files":
    "Files changed through the shell are not restored.",
  "conversation.notice.rewind-steer":
    "Messages you sent while the agent was working (steer) are not rewind points. Rewinding past one removes only the message.",
  "conversation.notice.session-archived":
    "This session is archived. You can read it, but it takes no new messages.",
  "conversation.notice.session-no-match": "No sessions match.",
  "conversation.notice.slash-no-match": "No commands match.",
  "conversation.notice.slash-working":
    "{agent} is working. A command you pick goes in the next turn.",
  "conversation.notice.stale":
    "Couldn't check for new messages. Last checked {age}.",
  "conversation.notice.stale-never": "Couldn't check for new messages yet.",
  "conversation.notice.unconfirmed":
    "lophn couldn't confirm this message arrived. Check before sending it again.",
  "conversation.notice.working-next-turn":
    "{agent} is working. A message you send now waits for the next turn.",
  "conversation.placeholder.ask":
    "Ask {agent}… Type / for commands and skills.",
  "conversation.rewind-block.copied":
    "Copied from another conversation, so only messages can be restored.",
  "conversation.rewind-block.correction":
    "Sent while work was in progress, so only messages can be restored.",
  "conversation.rewind-block.limit-count":
    "This point is too old, so documents from it can't be restored.",
  "conversation.rewind-block.limit-file":
    "A file here was too large to keep, so documents from this point can't be restored.",
  "conversation.rewind-block.limit-total":
    "Too many earlier changes were kept, so documents from this point can't be restored.",
  "conversation.rewind-block.record-failed":
    "lophn couldn't keep the earlier content of a file here, so documents from this point can't be restored.",
  "conversation.rewind-why.already-reverted": "This was already undone.",
  "conversation.rewind-why.answered-fact":
    "Your answers and decisions stay in the conversation.",
  "conversation.rewind-why.app-failed": "The app couldn't undo this change.",
  "conversation.rewind-why.app-not-settled":
    "This wasn't started because the app changes didn't all finish.",
  "conversation.rewind-why.app-not-started":
    "This wasn't started because an earlier step didn't finish.",
  "conversation.rewind-why.app-revision-changed":
    "The app's data changed since, so this change and the earlier ones from the same app aren't undone.",
  "conversation.rewind-why.app-uncertain":
    "The app was asked to undo this, but its answer never arrived. lophn can't tell if it worked.",
  "conversation.rewind-why.chain-broken":
    "This file was edited between lophn's changes, so it is left as it is.",
  "conversation.rewind-why.created-edited":
    "lophn created this file, but it was edited since, so it isn't deleted.",
  "conversation.rewind-why.edited-outside":
    "This file changed after lophn wrote it, so it is left as it is.",
  "conversation.rewind-why.external-effect":
    "This already reached something outside lophn.",
  "conversation.rewind-why.later-edit":
    "A later edit changed the same file, so only that one can be undone first.",
  "conversation.rewind-why.link-path":
    "This path is a link, so it is left as it is.",
  "conversation.rewind-why.no-pre-image":
    "The earlier content of this file wasn't kept.",
  "conversation.rewind-why.no-receipt":
    "The app didn't give a way to undo this change.",
  "conversation.rewind-why.no-revert-command":
    "The app has no way to undo this change.",
  "conversation.rewind-why.rename-blocked":
    "Another file is at the old name, so the rename isn't undone.",
  "conversation.rewind-why.unknown": "lophn can't undo this edit.",
  "conversation.rewind.hint-messages-only":
    "Hides the messages after this one. Documents and app data stay as they are.",
  "conversation.rewind.hint-restore-all":
    "Hides the messages after this one and puts back the documents and app data that changed since.",
  "conversation.rewind.hint-summarize":
    "Folds everything after this message into a summary. Documents and app data stay as they are.",
  "conversation.rewind.preview-failed":
    "Couldn't load what would change. Try again.",
  "conversation.rewind.result-left":
    "Restored {restored, plural, one {# file} other {# files}}, but {left, plural, one {# item stays as it was} other {# items stay as they were}}.",
  "conversation.rewind.result-restored":
    "Restored {count, plural, one {# file} other {# files}}.",
  "conversation.rewind.running":
    "Stop the work in progress first, then rewind.",
  "conversation.rewind.start-failed": "Couldn't start the rewind. Try again.",
  "conversation.rewind.summary-failed":
    "Couldn't summarize this part, so nothing changed.",
  "conversation.title.approval-change": "{agent} wants to change settings",
  "conversation.title.approval-run": "{agent} wants to run {tool}",
  "conversation.title.new-session": "New session",
  "conversation.title.permissions": "Permissions · {agent}",
  "conversation.title.question-asking": "{agent} is asking",
  "conversation.title.recap": "Recap",
  "conversation.title.rewind": "Rewind to here",
  "project-workspace.notice.agent-not-ready":
    "Conversations aren't ready yet. Try again in a moment.",
} as const;
