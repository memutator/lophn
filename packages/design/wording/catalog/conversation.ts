export const conversation = {
  "conversation.body.delete-session":
    'Delete "{title}"? Anything other agents handed to this session and still waiting for an answer will fail. This can\'t be undone.',
  "conversation.body.skill-command-request":
    'Use the "{skill}" skill for this request.',
  "conversation.button.add-model": "Add model",
  "conversation.button.approval-allow": "Allow",
  "conversation.button.approval-allow-always": "Always allow",
  "conversation.button.approval-allow-once": "Allow once",
  "conversation.button.approval-allow-session": "Allow for this session",
  "conversation.button.approval-deny": "Deny",
  "conversation.button.archive": "Archive",
  "conversation.button.archived-toggle": "Archived ({count, number})",
  "conversation.button.attach": "Add attachment",
  "conversation.button.call-cancel": "Cancel",
  "conversation.button.connect-provider": "Connect provider",
  "conversation.button.check-delivery": "Check whether it arrived",
  "conversation.button.delete": "Delete",
  "conversation.button.edit-open": "Open",
  "conversation.button.edit-model": "Edit",
  "conversation.button.fork": "Fork",
  "conversation.button.fork-here": "Fork from here",
  "conversation.button.hidden-hide": "Hide",
  "conversation.button.hidden-show": "Show",
  "conversation.button.jump-latest": "Jump to newest messages",
  "conversation.button.manage-models": "Manage models",
  "conversation.button.model-reset": "Reset",
  "conversation.button.permissions-edit": "Edit in Agents",
  "conversation.button.question-next": "Next",
  "conversation.button.question-submit": "Submit",
  "conversation.button.queued-remove": "Remove from the queue",
  "conversation.button.recap-dismiss": "Dismiss",
  "conversation.button.remove-model": "Remove model",
  "conversation.button.refresh-models": "Refresh models",
  "conversation.button.rename": "Rename",
  "conversation.button.resend": "Send again",
  "conversation.button.retry": "Retry",
  "conversation.button.rewind-go": "Rewind",
  "conversation.button.rewind-here": "Rewind to here",
  "conversation.button.save": "Save",
  "conversation.button.send": "Send",
  "conversation.button.send-now": "Send now",
  "conversation.button.session-new": "New session",
  "conversation.button.stop": "Stop",
  "conversation.empty.no-agent": "lophn isn't set up for conversations yet.",
  "conversation.empty.no-messages":
    "Nothing here yet. Write what you need below.",
  "conversation.error.action-failed": "That didn't work. Try again.",
  "conversation.error.model-effort-none": "Choose at least one effort.",
  "conversation.error.model-info-conflict":
    "This model's details changed elsewhere. The latest is loaded; save again to keep your edits.",
  "conversation.error.model-info-failed":
    "Couldn't save this model. Try again.",
  "conversation.error.model-info-remove-failed":
    "Couldn't remove this model. Try again.",
  "conversation.error.model-limit-invalid": "Enter a whole number above 0.",
  "conversation.error.model-name-required": "Enter the model name.",
  "conversation.error.model-price-invalid":
    "Enter a number like 0.15, or leave it blank.",
  "conversation.error.load-failed":
    "Couldn't load this conversation. Try again.",
  "conversation.error.load-models": "Couldn't load models. Try again.",
  "conversation.error.message-body": "Couldn't load this message.",
  "conversation.error.open-failed":
    "Couldn't start a new conversation. Try again.",
  "conversation.error.refresh-models":
    "Couldn't refresh the model list. Try again.",
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
  "conversation.label.approval-input": "Input",
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
  "conversation.label.approval-target-tool": "{tool} in {app}",
  "conversation.label.approval-target-mcp-tool": "{tool} on {server}",
  "conversation.label.approval-target-other": "Other request",
  "conversation.label.archived": "Archived",
  "conversation.label.call-answered": "Answered",
  "conversation.label.call-cancelled": "Cancelled",
  "conversation.label.call-delivered": "Delivered",
  "conversation.label.call-failed": "Failed",
  "conversation.label.call-in-progress": "In progress",
  "conversation.label.call-reply-conversation": "Back and forth",
  "conversation.label.call-reply-none": "No answer expected",
  "conversation.label.call-reply-result": "Answer expected",
  "conversation.label.call-working-together": "Working together",
  "conversation.label.coding-queued": "Waiting for a coding agent",
  "conversation.label.composer-message": "Message",
  "conversation.label.delete-session": "Delete {title}",
  "conversation.label.delivery-not-sent": "Not sent",
  "conversation.label.delivery-received": "Received",
  "conversation.label.delivery-sending": "Sending",
  "conversation.label.delivery-unconfirmed": "Not confirmed",
  "conversation.label.duration-minutes": "{minutes, number}m",
  "conversation.label.duration-minutes-seconds":
    "{minutes, number}m {seconds, number}s",
  "conversation.label.duration-seconds": "{seconds, number}s",
  "conversation.label.edit-made": "Edited",
  "conversation.label.evidence-annotation": "Annotation",
  "conversation.label.evidence-file": "File",
  "conversation.label.evidence-problem": "Problem",
  "conversation.label.evidence-session": "Session",
  "conversation.label.evidence-ticket": "Ticket",
  "conversation.label.grant-allow": "Runs without asking",
  "conversation.label.grant-ask": "Asks first",
  "conversation.label.grant-deny": "Not allowed",
  "conversation.label.group-earlier": "Earlier",
  "conversation.label.model-changed": "Changed",
  "conversation.label.media-audio": "Audio",
  "conversation.label.media-image": "Image",
  "conversation.label.media-pdf": "PDF",
  "conversation.label.media-text": "Text",
  "conversation.label.media-video": "Video",
  "conversation.label.model-context": "Context: {limit} tokens",
  "conversation.label.model-context-limit": "Context limit",
  "conversation.label.model-effort-default": "Default effort",
  "conversation.label.model-effort-model": "Model default",
  "conversation.label.model-effort-values": "Efforts to offer",
  "conversation.label.model-input-limit": "Input limit",
  "conversation.label.model-input-limit-default": "Same as context",
  "conversation.label.model-input-media": "Input media",
  "conversation.label.model-layer":
    "Using: {layer, select, session {this conversation} agent {this agent} project {project default} other {Workspace default}}",
  "conversation.label.model-list": "Models",
  "conversation.label.model-name": "Model name",
  "conversation.label.model-output-limit": "Output limit",
  "conversation.label.model-output-media": "Output media",
  "conversation.label.model-price-cache-read": "Cache read",
  "conversation.label.model-price-cache-write": "Cache write",
  "conversation.label.model-price-input": "Input",
  "conversation.label.model-price-output": "Output",
  "conversation.label.model-price-unknown": "Unknown",
  "conversation.label.model-prices": "Price per 1M tokens (USD)",
  "conversation.label.model-reasoning": "Reasoning effort",
  "conversation.label.model-tools": "Tool support",
  "conversation.label.model-unknown": "Model",
  "conversation.label.more-actions": "More",
  "conversation.label.next-turn": "Next turn",
  "conversation.label.permission-summary":
    "{count, plural, =0 {Ask first} one {Ask first, # tool allowed} other {Ask first, # tools allowed}}",
  "conversation.label.permissions-may": "What {agent} may do",
  "conversation.label.permissions-of": "Permissions of {agent}",
  "conversation.label.permissions-session": "Allowed for this session",
  "conversation.label.question-answered-elsewhere":
    "Answered in another window",
  "conversation.label.question-cancelled": "Cancelled",
  "conversation.label.question-card": "Questions from {agent}",
  "conversation.label.question-following": "Next question",
  "conversation.label.question-no-answer": "No answer picked",
  "conversation.label.question-own-answer": "Type your own answer: {prompt}",
  "conversation.label.question-own-answer-placeholder": "Type your own answer",
  "conversation.label.question-pick-any": "Pick any",
  "conversation.label.question-previous": "Previous question",
  "conversation.label.questions-answered":
    "Answered {count, plural, one {# question} other {# questions}}",
  "conversation.label.questions-ended-by-message": "Ended by your message",
  "conversation.label.queued-messages": "Waiting for the next turn",
  "conversation.label.read-session": "Read {title}",
  "conversation.label.rename-session": "Rename {title}",
  "conversation.label.reply-to": "Reply to: {task}",
  "conversation.label.request-position": "{current, number} of {total, number}",
  "conversation.label.requests": "Waiting for you",
  "conversation.label.rewind-app-also": "Also rewind {app}",
  "conversation.label.rewind-app-unknown":
    "{count, plural, one {# write has} other {# writes have}} an unknown result and cannot be undone",
  "conversation.label.rewind-app-writes":
    "{count, plural, one {# write} other {# writes}} by this session after this message",
  "conversation.label.rewind-apps-head":
    "Apps this session wrote to after this message",
  "conversation.label.rewind-caller-person": "You",
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
  "conversation.label.rewind-others":
    "Also goes back, though this session did not do it",
  "conversation.label.rewind-outside": "Stays as it is, outside lophn",
  "conversation.label.rewind-quote": "Rewind to this message",
  "conversation.label.rewind-summary-apps": "Conversation, files and {apps}",
  "conversation.label.rewind-summary-files": "Conversation and files only",
  "conversation.label.rewind-summary-messages": "Conversation only",
  "conversation.label.rewind-summary-messages-apps": "Conversation and {apps}",
  "conversation.label.rewind-write-unknown": "Result unknown",
  "conversation.label.search-models": "Search models",
  "conversation.label.search-sessions": "Search {agent} sessions",
  "conversation.label.sender-agent-named": "{role} · {name}",
  "conversation.label.sender-agent-other": "Another agent",
  "conversation.label.sender-based-on": "Based on",
  "conversation.label.sender-coding": "Coding agent · {product}",
  "conversation.label.sender-coding-unknown": "Coding agent",
  "conversation.label.sender-from": "From",
  "conversation.label.sender-head-handed": "What was handed over",
  "conversation.label.sender-head-saw": "What lophn saw",
  "conversation.label.sender-head-why": "Why you got this",
  "conversation.label.sender-program-unknown": "lophn",
  "conversation.label.sender-reaction": "Reaction · {event}",
  "conversation.label.sender-reaction-unknown": "Reaction",
  "conversation.label.sender-role-app-engineer": "App Engineer",
  "conversation.label.sender-role-lophn": "lophn",
  "conversation.label.sender-role-operator": "Operator",
  "conversation.label.sender-role-project-manager": "Project Manager",
  "conversation.label.sender-sent-by": "Sent by {sender}",
  "conversation.label.sender-sent-from": "Sent from",
  "conversation.label.session-list": "{agent} sessions",
  "conversation.label.session-untitled": "New session",
  "conversation.label.since-now": "now",
  "conversation.label.slash-menu": "Commands",
  "conversation.label.slash-unknown": "Unknown command: /{name}",
  "conversation.label.provider-toggle": "Show all {provider} models",
  "conversation.label.status-stopped": "Stopped",
  "conversation.label.status-working": "Working",
  "conversation.label.steer": "Steer · went into the running turn",
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
  "conversation.notice.answer-failed": "Couldn't send your answers. Try again.",
  "conversation.notice.approval-paused": "{agent} is paused until you decide.",
  "conversation.notice.call-answered": "The answer is in the messages below.",
  "conversation.notice.call-as-of":
    "Read when you opened this. Later changes are not announced.",
  "conversation.notice.call-cancel-failed": "Couldn't cancel it. Try again.",
  "conversation.notice.call-cancelled": "It was cancelled before it finished.",
  "conversation.notice.call-delivered":
    "The task reached the session. No answer was asked for.",
  "conversation.notice.call-fail-closed": "That session is closed.",
  "conversation.notice.call-fail-lophn-restarted":
    "lophn restarted before it finished.",
  "conversation.notice.call-fail-not-allowed":
    "This agent is not allowed to hand work to that agent.",
  "conversation.notice.call-fail-not-found": "That session couldn't be found.",
  "conversation.notice.call-fail-receiver-ended":
    "The other session ended before it answered.",
  "conversation.notice.call-unreadable":
    "Couldn't read the current state. This is the last one lophn knew.",
  "conversation.notice.call-waiting": "Waiting for the answer from {to}.",
  "conversation.notice.call-working-together":
    "{to} is working on it. Messages go back and forth until it reports.",
  "conversation.notice.custom-model":
    "Add models this provider doesn't list, and tell lophn what they can do.",
  "conversation.notice.decide-failed":
    "Couldn't send your decision. Try again.",
  "conversation.notice.message-loading": "Loading this message.",
  "conversation.notice.model-limits": "Blank limits use the defaults shown.",
  "conversation.notice.model-media":
    "lophn sends only text and images today. Other media are stored and shown.",
  "conversation.notice.model-prices": "Blank means unknown. 0 means free.",
  "conversation.notice.models-found":
    "Found {count, plural, one {# model} other {# models}} on {provider}.",
  "conversation.notice.models-not-listed":
    "{provider} didn't list its models. Add them by name.",
  "conversation.notice.no-model-options": "No options for this model.",
  "conversation.notice.manage-models-lead":
    "Choose which models appear in the model picker.",
  "conversation.notice.no-listed-models":
    "No models listed yet. Refresh the list, or add a model.",
  "conversation.notice.no-models": "No models match.",
  "conversation.notice.no-providers": "No providers connected.",
  "conversation.notice.no-shown-models":
    "No models are shown. Choose some with Manage models.",
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
  "conversation.notice.request-failed": "The request failed.",
  "conversation.notice.retry-failed": "Couldn't try again. Try once more.",
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
  "conversation.notice.sender-loading": "Loading the details.",
  "conversation.notice.sender-unreadable": "Couldn't read the details.",
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
  "conversation.rewind-why.already-reverted": "This was already undone.",
  "conversation.rewind-why.answered-fact":
    "Your answers and decisions stay in the conversation.",
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
  "conversation.rewind-why.rename-blocked":
    "Another file is at the old name, so the rename isn't undone.",
  "conversation.rewind-why.unknown": "lophn can't undo this edit.",
  "conversation.rewind.preview-failed":
    "Couldn't load what would change. Try again.",
  "conversation.rewind.result-left":
    "Restored {restored, plural, one {# file} other {# files}}, but {left, plural, one {# item stays as it was} other {# items stay as they were}}.",
  "conversation.rewind.result-restored":
    "Restored {count, plural, one {# file} other {# files}}.",
  "conversation.rewind.running":
    "Stop the work in progress first, then rewind.",
  "conversation.rewind.start-failed": "Couldn't start the rewind. Try again.",
  "conversation.title.add-model": "Add model",
  "conversation.title.approval-change": "{agent} wants to change settings",
  "conversation.title.approval-run": "{agent} wants to run {tool}",
  "conversation.title.call-handed": "Handed to {to}",
  "conversation.title.edit-model": "Edit model",
  "conversation.title.manage-models": "Manage models",
  "conversation.title.permissions": "Permissions · {agent}",
  "conversation.title.question-asking": "{agent} is asking",
  "conversation.title.recap": "Recap",
  "conversation.title.rewind": "Rewind to here",
  "project-workspace.notice.agent-not-ready":
    "Conversations aren't ready yet. Try again in a moment.",
  "conversation.title.sender-details": "Sender details",
} as const;
