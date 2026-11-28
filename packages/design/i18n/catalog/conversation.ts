export const conversation = {
  "conversation.announce.replied": "{agent} replied",
  "conversation.announce.response-started": "Response started",
  "conversation.body.archive-running":
    "A turn is running in this session. Archiving will stop it.",
  "conversation.body.delete-session":
    'Delete "{title}"? Anything other agents handed to this session and still waiting for an answer will fail. This can\'t be undone.',
  "conversation.body.skill-command-request":
    'Use the "{skill}" skill for this request.',
  "conversation.button.add-model": "Add model",
  "conversation.button.approval-allow-always": "Always allow",
  "conversation.button.approval-allow-session": "Allow for this session",
  "conversation.button.approval-allow-once": "Allow once",
  "conversation.button.approval-deny": "Deny",
  "conversation.button.archive": "Archive",
  "conversation.button.archive-stop-turn": "Stop and archive",
  "conversation.button.archived-toggle": "Archived ({count, number})",
  "conversation.button.attach": "Add files or photos",
  "conversation.button.bookmark-remove": "Remove bookmark",
  "conversation.button.bookmark-turn": "Bookmark turn",
  "conversation.button.call-cancel": "Cancel",
  "conversation.button.call-open": "Open conversation",
  "conversation.button.child-send": "Send",
  "conversation.button.consent-review": "Review",
  "conversation.button.connect-provider": "Connect provider",
  "conversation.button.check-delivery": "Check whether it arrived",
  "conversation.button.delete": "Delete",
  "conversation.button.dock-more": "+{count} more",
  "conversation.button.dock-stop": "Stop",
  "conversation.button.edit-open": "Open",
  "conversation.button.edit-diff-hide": "Hide diff",
  "conversation.button.edit-diff-show": "Show diff",
  "conversation.button.edit-model": "Edit",
  "conversation.button.find-close": "Close find",
  "conversation.button.find-next": "Next match",
  "conversation.button.find-previous": "Previous match",
  "conversation.button.fold-less": "Show less",
  "conversation.button.fold-more": "Show more",
  "conversation.button.fork": "Fork",
  "conversation.button.fork-here": "Fork from here",
  "conversation.button.goal-clear": "Clear",
  "conversation.button.goal-pause": "Pause",
  "conversation.button.goal-resume": "Resume",
  "conversation.button.hidden-hide": "Hide",
  "conversation.button.hidden-show": "Show",
  "conversation.button.jump-latest": "Jump to newest messages",
  "conversation.button.input-request-cancel": "Cancel",
  "conversation.button.input-request-enter": "Enter",
  "conversation.button.input-request-sign-in": "Sign in",
  "conversation.button.manage-models": "Manage models",
  "conversation.button.mermaid-show-diagram": "View diagram",
  "conversation.button.mermaid-show-source": "View source",
  "conversation.button.model-reset": "Reset",
  "conversation.button.permissions-edit": "Edit in Agents",
  "conversation.button.plan-approve": "Approve · {mode}",
  "conversation.button.plan-keep-planning": "Keep planning",
  "conversation.button.plan-show-full": "Show full plan",
  "conversation.button.off-models":
    "{count, plural, one {# model off} other {# models off}}",
  "conversation.button.preview-image": "Preview {name}",
  "conversation.button.question-next": "Next",
  "conversation.button.question-submit": "Submit",
  "conversation.button.queued-move-down": "Move down",
  "conversation.button.queued-move-up": "Move up",
  "conversation.button.queued-remove": "Remove from the queue",
  "conversation.button.remove-attachment": "Remove {name}",
  "conversation.button.remove-model": "Remove model",
  "conversation.button.reset-model-limits": "Reset limits",
  "conversation.button.refresh-models": "Refresh models",
  "conversation.button.rename": "Rename",
  "conversation.button.resend": "Send again",
  "conversation.button.provider-key": "Enter {name} key",
  "conversation.button.provider-key-open": "Open Providers",
  "conversation.button.retry": "Retry",
  "conversation.button.rewind-go": "Rewind",
  "conversation.button.run-in-terminal": "Run in terminal",
  "conversation.button.rewind-here": "Rewind to here",
  "conversation.button.rewind-hide-files": "Hide files",
  "conversation.button.rewind-show-files": "Show files",
  "conversation.button.save": "Save",
  "conversation.button.send": "Send",
  "conversation.button.send-now": "Send now",
  "conversation.button.fill-shell": "Run in shell mode",
  "conversation.button.session-new": "New session",
  "conversation.button.stop": "Stop",
  "conversation.empty.no-agent": "lophn isn't set up for conversations yet.",
  "conversation.empty.no-messages":
    "Nothing here yet. Write what you need below.",
  "conversation.error.action-failed": "That didn't work. Try again.",
  "conversation.error.attach-failed":
    "Couldn't attach the image, so the message wasn't sent. Try again.",
  "conversation.error.attach-skipped":
    "Some files couldn't be attached. Images must be PNG, JPEG, GIF or WebP up to 5 MB.",
  "conversation.error.changed-elsewhere":
    "This conversation changed on another device. Read the new messages, then send again.",
  "conversation.error.model-effort-none": "Choose at least one effort.",
  "conversation.error.model-info-conflict":
    "This model's details changed elsewhere. The latest is loaded; save again to keep your edits.",
  "conversation.error.model-info-failed":
    "Couldn't save this model. Try again.",
  "conversation.error.model-info-remove-failed":
    "Couldn't remove this model. Try again.",
  "conversation.error.model-info-reset-failed":
    "Couldn't reset this model's limits. Try again.",
  "conversation.error.model-limit-invalid": "Enter a whole number above 0.",
  "conversation.error.model-name-required": "Enter the model name.",
  "conversation.error.model-price-invalid":
    "Enter a number like 0.15, or leave it blank.",
  "conversation.error.load-failed":
    "Couldn't load this conversation. Try again.",
  "conversation.error.load-models": "Couldn't load models. Try again.",
  "conversation.error.no-model":
    "Choose a model to send. Open the model menu below.",
  "conversation.error.open-failed":
    "Couldn't start a new conversation. Try again.",
  "conversation.error.refresh-models":
    "Couldn't refresh the model list. Try again.",
  "conversation.error.request-id": "Request ID: {id}",
  "conversation.error.stop-failed": "Couldn't stop this work. Try again.",
  "conversation.error.verdict-path": "Failure path: {path}",
  "conversation.error.too-long":
    "This message is too long to send. Shorten it, or split it into parts.",
  "conversation.error.tool-body-failed": "Couldn't load the input and output.",
  "conversation.error.turn-active-limit":
    "The agent reached its working time limit and stopped.",
  "conversation.error.turn-clock-uncertain":
    "lophn couldn't trust the system clock, so it stopped.",
  "conversation.error.turn-configuration-unavailable":
    "The chosen model or its provider can't be used right now. Check the model below, or Settings → Providers.",
  "conversation.error.turn-context-limit":
    "This conversation is too long for the model. Compact it, or start a new one.",
  "conversation.error.turn-effect-unknown":
    "lophn couldn't tell whether the last action finished. Check it before trying again.",
  "conversation.error.turn-internal":
    "lophn hit an internal error and stopped this turn. Try again; if it keeps happening, report it.",
  "conversation.error.turn-model-attempt-limit":
    "The model failed too many times in a row.",
  "conversation.error.turn-model-error": "The model returned an error.",
  "conversation.error.turn-model-required":
    "No model is chosen yet. Pick one in the model menu below, then try again.",
  "conversation.error.turn-no-answer":
    "The agent finished without writing an answer.",
  "conversation.error.turn-rate-limited":
    "The provider is limiting requests right now. Wait a moment, then retry.",
  "conversation.error.turn-repeated-tool-failure":
    "The same tool kept failing, so the agent stopped.",
  "conversation.error.turn-sign-in-rejected":
    "The provider rejected the key or sign-in. Enter the key again, or sign in again in Settings → Providers.",
  "conversation.error.turn-stall-limit": "The agent stopped making progress.",
  "conversation.error.turn-target-unavailable": "This agent no longer exists.",
  "conversation.error.turn-tool-error": "A tool failed and the agent stopped.",
  "conversation.error.turn-usage-limit":
    "This provider's usage limit is reached. Check your plan or billing, or pick another model below.",
  "conversation.label.approval": "Approval",
  "conversation.label.approval-app": "App {id}",
  "conversation.label.approval-allowed": "Allowed",
  "conversation.label.approval-always": "Always allow adds",
  "conversation.label.approval-change-create": "Create {path}",
  "conversation.label.approval-change-delete": "Delete {path}",
  "conversation.label.approval-change-lines": "{change} (+{added} −{removed})",
  "conversation.label.approval-change-update": "Edit {path}",
  "conversation.label.approval-changes": "Changes",
  "conversation.label.approval-cancelled": "Cancelled",
  "conversation.label.approval-cancelled-detail": "The work ended first",
  "conversation.label.approval-command": "Command",
  "conversation.label.approval-cwd": "Working folder",
  "conversation.label.approval-env-keys": "Environment keys",
  "conversation.label.approval-before": "Before",
  "conversation.label.approval-after": "After",
  "conversation.label.approval-denied": "Denied",
  "conversation.label.approval-effect": "Effect",
  "conversation.label.approval-effect-external": "Reaches outside lophn",
  "conversation.label.approval-effect-read": "Reads data",
  "conversation.label.approval-effect-write": "Changes data",
  "conversation.label.approval-key-always": "⌘/Ctrl+Shift+Enter",
  "conversation.label.approval-key-back": "Esc",
  "conversation.label.approval-key-deny": "Esc",
  "conversation.label.approval-key-once": "Enter",
  "conversation.label.approval-reason": "Reason for denying",
  "conversation.label.approval-reason-given": "Reason: {reason}",
  "conversation.label.approval-reason-placeholder":
    "Why not? {agent} reads this (optional)",
  "conversation.label.approval-scope-always": "Always",
  "conversation.label.approval-scope-session": "This session",
  "conversation.label.approval-scope-once": "Once",
  "conversation.label.approval-target": "Target",
  "conversation.label.approval-target-tool": "{tool} in {app}",
  "conversation.label.approval-target-mcp-tool": "{tool} on {server}",
  "conversation.label.archived": "Archived",
  "conversation.label.attached-image": "Attached image",
  "conversation.label.call-cancelled": "Cancelled",
  "conversation.label.call-failed": "Failed",
  "conversation.label.child-steer": "Tell this subagent something",
  "conversation.label.child-view": "Subagent conversation",
  "conversation.label.composer-message": "Message",
  "conversation.label.delete-session": "Delete {title}",
  "conversation.label.dock": "Running work",
  "conversation.label.dock-queued": "Queued · {count}",
  "conversation.label.dock-running": "Running · {count}",
  "conversation.label.dock-todo": "Todo",
  "conversation.label.dock-todo-count": "{done}/{total}",
  "conversation.label.duration-hours": "{hours, number}h",
  "conversation.label.duration-hours-minutes":
    "{hours, number}h {minutes, number}m",
  "conversation.label.duration-minutes": "{minutes, number}m",
  "conversation.label.duration-minutes-seconds":
    "{minutes, number}m {seconds, number}s",
  "conversation.label.duration-seconds": "{seconds, number}s",
  "conversation.label.edit-failed": "Edit",
  "conversation.label.edit-made": "Edited",
  "conversation.label.edit-running": "Editing",
  "conversation.label.evidence-annotation": "Annotation",
  "conversation.label.evidence-file": "File",
  "conversation.label.evidence-session": "Session",
  "conversation.label.goal-active": "Active",
  "conversation.label.goal-blocked": "Blocked",
  "conversation.label.goal-done": "Done",
  "conversation.label.goal-paused": "Paused",
  "conversation.label.info-warning": "Warning",
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
    "Using: {layer, select, session {this conversation} agent {this agent} project {workspace default} other {global default}}",
  "conversation.label.model-limit-auto": "Automatic",
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
  "conversation.label.permission-mode": "Mode",
  "conversation.label.permission-summary":
    "{count, plural, =0 {No apps from other computers} one {# app from another computer} other {# apps from other computers}}",
  "conversation.label.permissions-may": "What {agent} may use",
  "conversation.label.permissions-all-tools": "All tools",
  "conversation.label.permissions-except": "All tools except {tools}",
  "conversation.label.permissions-of": "Permissions of {agent}",
  "conversation.label.plan": "Plan",
  "conversation.label.plan-approved": "Plan approved",
  "conversation.label.plan-approved-mode": "Plan approved · {mode}",
  "conversation.label.plan-cancelled": "Cancelled",
  "conversation.label.plan-completed": "Done",
  "conversation.label.plan-in-progress": "In progress",
  "conversation.label.plan-not-approved": "Plan not approved",
  "conversation.label.plan-pending": "To do",
  "conversation.label.input-request-card": "Input request from {agent}",
  "conversation.label.input-request-destinations": "Sent to",
  "conversation.label.input-request-secret": "Secret",
  "conversation.label.input-request-sign-in-at": "Sign in at",
  "conversation.label.input-request-origin": "Page origin",
  "conversation.label.input-request-tab": "Tab",
  "conversation.label.question-answered-by-parent": "Answered by the parent",
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
  "conversation.label.queued-edit-message": "Edit message: {text}",
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
  "conversation.label.rewind-caller-event": "App event",
  "conversation.label.rewind-caller-flow": "Workflow",
  "conversation.label.rewind-caller-person": "You",
  "conversation.label.rewind-caller-program": "Job",
  "conversation.label.rewind-files":
    "{count, plural, one {Also restore # file} other {Also restore # files}} changed with file tools",
  "conversation.label.rewind-hidden":
    "Rewound here · {count, plural, one {# message} other {# messages}} hidden",
  "conversation.label.rewind-item-answer": "An answer you gave",
  "conversation.label.rewind-item-app": "An app change",
  "conversation.label.rewind-item-external": "A request that already went out",
  "conversation.label.rewind-item-fact": "Something that already happened",
  "conversation.label.rewind-loading": "Checking what would change…",
  "conversation.label.rewind-others":
    "Also goes back, though this session did not do it",
  "conversation.label.rewind-outside": "Stays as it is, outside lophn",
  "conversation.label.rewind-quote": "Rewind to this message",
  "conversation.label.rewind-write-unknown": "Result unknown",
  "conversation.label.find": "Find in conversation",
  "conversation.label.find-count": "{current, number}/{total, number}",
  "conversation.label.find-none": "No matches",
  "conversation.label.history-search": "Search your messages",
  "conversation.label.roles": "Roles",
  "conversation.label.roles-chat": "Chat",
  "conversation.label.roles-model": "Model",
  "conversation.label.search-models": "Search models",
  "conversation.label.search-sessions": "Search {agent} sessions",
  "conversation.label.sender-agent-other": "Another agent",
  "conversation.label.sender-based-on": "Based on",
  "conversation.label.sender-computer": "Computer",
  "conversation.label.sender-from": "From",
  "conversation.label.sender-member-from": "Team member · from",
  "conversation.label.sender-head-handed": "What was handed over",
  "conversation.label.sender-head-why": "Why you got this",
  "conversation.label.sender-program-unknown": "lophn",
  "conversation.label.sender-remote-session": "Session on that computer",
  "conversation.label.sender-sent-by": "Sent by {sender}",
  "conversation.label.sender-sent-from": "Sent from",
  "conversation.label.session-archived-title": "{title} · Archived",
  "conversation.label.session-list": "{agent} sessions",
  "conversation.label.session-untitled": "New session",
  "conversation.label.session-opening": "Opening session",
  "conversation.label.run-on-machine": "Run on",
  "conversation.notice.machine-open-there":
    "Open this project on this computer",
  "conversation.label.shell-chip": "Shell",
  "conversation.label.shell-chip-tooltip":
    "Shell mode: what you send runs as a command",
  "conversation.label.shell-exit": "exit {code}",
  "conversation.label.shell-running": "Running",
  "conversation.label.shell-you-ran": "You ran",
  "conversation.label.since-now": "now",
  "conversation.label.slash-badge-app": "lophn",
  "conversation.label.slash-badge-mcp": "MCP",
  "conversation.label.slash-badge-plugin": "Plugin",
  "conversation.label.slash-badge-project": "Project",
  "conversation.label.slash-badge-skill": "Skill",
  "conversation.label.slash-badge-user": "User",
  "conversation.label.slash-group-app": "lophn",
  "conversation.label.slash-group-custom": "Custom",
  "conversation.label.slash-group-extensions": "Plugins & MCP",
  "conversation.label.slash-group-skills": "Skills",
  "conversation.label.slash-menu": "Commands",
  "conversation.label.slash-unknown": "Unknown command: /{name}",
  "conversation.label.provider-toggle": "Show all {provider} models",
  "conversation.label.status-account": "Account",
  "conversation.label.status-context": "Context window",
  "conversation.label.status-context-value":
    "{used, number} of {limit, number} tokens ({percent, number}% used)",
  "conversation.label.status-cost": "Cost",
  "conversation.label.status-cost-subscription": "Included in your plan",
  "conversation.label.status-cost-unknown": "Unknown",
  "conversation.label.status-footer-context": "{percent, number}% of {limit}",
  "conversation.label.status-footer-tokens": "{input} in · {output} out",
  "conversation.label.status-limit-resets": "Resets {time}",
  "conversation.label.status-limits": "Limits",
  "conversation.label.status-model": "Model",
  "conversation.label.status-provider": "Provider",
  "conversation.label.status-provider-available": "{provider} · connected",
  "conversation.label.status-provider-rejected":
    "{provider} · sign-in rejected",
  "conversation.label.status-provider-revoked": "{provider} · signed out",
  "conversation.label.status-provider-wait":
    "{provider} · usage limit until {time}",
  "conversation.label.status-session": "Session",
  "conversation.label.status-tokens": "Tokens",
  "conversation.label.status-tokens-input": "Input",
  "conversation.label.status-tokens-cached": "Cached",
  "conversation.label.status-tokens-output": "Output",
  "conversation.label.status-turns": "Turns",
  "conversation.label.status-turns-value":
    "{turns, plural, one {# turn} other {# turns}}",
  "conversation.label.status-of": "Status of this session",
  "conversation.label.usage-of": "Usage of this session",
  "conversation.label.context-of": "Context of this session",
  "conversation.label.usage-loading": "Checking plan usage…",
  "conversation.label.usage-no-limits":
    "No plan usage limits available for this session.",
  "conversation.label.context-unavailable":
    "Context usage is not available yet.",
  "conversation.label.status-slow":
    "Taking longer than usual · a large turn or a busy machine takes time",
  "conversation.label.status-still-working":
    "Slow response · the provider or network may be struggling",
  "conversation.label.status-stopped": "Stopped",
  "conversation.label.status-thinking": "Thinking",
  "conversation.label.status-activity": "· {activity}",
  "conversation.label.status-waiting-answer": "Waiting for your answer",
  "conversation.label.status-waiting-approval": "Waiting for your approval",
  "conversation.label.status-working": "Working",
  "conversation.label.via": "via {app}",
  "conversation.label.steer": "Steer · went into the running turn",
  "conversation.label.steps-value": "Show steps: {detail}",
  "conversation.label.stopped-after": "Stopped after {duration}",
  "conversation.label.subagent-running": "Running",
  "conversation.label.subagent-tag": "subagent",
  "conversation.label.child-back": "Back to {agent}",
  "conversation.label.thinking": "Thinking",
  "conversation.label.thought": "Thought",
  "conversation.label.thought-for": "Thought for {duration}",
  "conversation.label.thought-for-words":
    "Thought for {duration} · {words, plural, one {# word} other {# words}}",
  "conversation.label.thread-index": "Conversation index",
  "conversation.label.thread-index-file": "File",
  "conversation.label.thread-index-image": "Image",
  "conversation.label.thread-index-tick-bookmarked": "{title}, bookmarked turn",
  "conversation.label.tool-call-cancelled": "Cancelled",
  "conversation.label.tool-call-denied": "Denied",
  "conversation.label.tool-call-failed": "Failed",
  "conversation.label.tool-input": "Input",
  "conversation.label.tool-listed":
    "{count, plural, one {Listed # folder} other {Listed # folders}}",
  "conversation.label.tool-output": "Output",
  "conversation.label.tool-ran":
    "{count, plural, one {Ran # command} other {Ran # commands}}",
  "conversation.label.tool-read":
    "{count, plural, one {Read # file} other {Read # files}}",
  "conversation.label.tool-searched":
    "{count, plural, one {Searched # time} other {Searched # times}}",
  "conversation.label.tool-used":
    "{count, plural, one {Used {tool}} other {Used {tool} # times}}",
  "conversation.label.tool-web":
    "{count, plural, one {Used the web # time} other {Used the web # times}}",
  "conversation.label.view-compact": "Compact",
  "conversation.label.view-detail": "View detail",
  "conversation.label.view-everything": "Everything",
  "conversation.label.view-messages": "Messages",
  "conversation.label.waited-for": "Waited {duration} for you",
  "conversation.label.worked-for": "Worked for {duration}",
  "conversation.note.tool-body-truncated": "Only the first 64 KiB is shown.",
  "conversation.notice.answer-failed": "Couldn't send your answers. Try again.",
  "conversation.notice.approval-paused": "{agent} is paused until you decide.",
  "conversation.notice.call-cancel-failed": "Couldn't cancel it. Try again.",
  "conversation.notice.call-cancelled": "It was cancelled before it finished.",
  "conversation.notice.call-delivery-held":
    "Waiting in {computer}'s Inbox for the person to start it.",
  "conversation.notice.call-delivery-pending":
    "Not delivered yet. It goes when {computer} is reachable.",
  "conversation.notice.call-delivery-running": "Running on {computer}.",
  "conversation.notice.call-delivery-unknown":
    "Sent to {computer}; not known whether it arrived.",
  "conversation.notice.call-fail-closed": "That session is closed.",
  "conversation.notice.call-fail-expired":
    "The other computer didn't take it within seven days.",
  "conversation.notice.call-fail-lophn-restarted":
    "lophn restarted before it finished.",
  "conversation.notice.call-fail-not-found": "That session couldn't be found.",
  "conversation.notice.call-fail-old-version":
    "The other computer's lophn is too old for it. Update lophn there.",
  "conversation.notice.call-fail-receiver-ended":
    "The other session ended before it answered.",
  "conversation.notice.call-fail-skipped":
    "The person on the other computer chose not to run it.",
  "conversation.notice.custom-model":
    "Add models this provider doesn't list, and tell lophn what they can do.",
  "conversation.notice.decide-failed":
    "Couldn't send your decision. Try again.",
  "conversation.notice.edit-diff-missing": "This diff is no longer available.",
  "conversation.notice.mermaid-failed":
    "Couldn't draw this diagram. The source is below.",
  "conversation.notice.history-no-match": "No messages match.",
  "conversation.notice.model-limits": "Blank limits use the defaults shown.",
  "conversation.notice.model-limits-inherit":
    "Blank limits use what this model already has from its provider. Context is the window the model can use in a session: Codex uses its own default operational window, not the model's maximum.",
  "conversation.notice.model-media":
    "lophn sends only text and images today. Other media are stored and shown.",
  "conversation.notice.model-prices": "Blank means unknown. 0 means free.",
  "conversation.notice.models-found":
    "Found {count, plural, one {# model} other {# models}} on {provider}.",
  "conversation.notice.models-not-listed":
    "{provider} didn't list its models. Add them by name.",
  "conversation.notice.no-model-options": "No options for this model.",
  "conversation.notice.manage-models-lead":
    "Choose which models appear in the model picker. Edit a model to change its limits.",
  "conversation.notice.no-listed-models":
    "No models listed for this provider yet.",
  "conversation.notice.no-models": "No models match.",
  "conversation.notice.no-providers": "No providers connected.",
  "conversation.notice.no-shown-models":
    "No models are shown. Choose some with Manage models.",
  "conversation.notice.not-found":
    "lophn didn't find this message. Sending it again won't make a copy.",
  "conversation.notice.not-sent":
    "This message wasn't sent. It's still in the box, so you can send it again.",
  "conversation.notice.offline": "You can send once lophn is connected again.",
  "conversation.notice.permissions-mcp":
    "MCP servers are set globally, in the project, or on this agent.",
  "conversation.notice.permissions-no-apps":
    "No apps from other computers are assigned.",
  "conversation.notice.permissions-edited-in-agents":
    "Apps from other computers are assigned in Agents.",
  "conversation.notice.input-request-failed":
    "Can't open the protected window right now. Try again.",
  "conversation.notice.input-request-help":
    "You type in a protected window. {agent} never sees the value.",
  "conversation.notice.input-request-sign-in-help":
    "You sign in in your browser. {agent} never sees your credentials.",
  "conversation.notice.input-request-signing-in":
    "Finish signing in in your browser.",
  "conversation.notice.input-request-user-code":
    "Finish signing in in your browser. Code: {code}",
  "conversation.notice.input-request-no-destination":
    "This app declares no network destination yet.",
  "conversation.notice.input-request-replaces":
    "A value is already set. Entering one replaces it.",
  "conversation.notice.question-waiting":
    "Waiting for your answer. Sending a message instead also ends the questions.",
  "conversation.notice.questions-ended-by-message":
    "You sent a message while the questions were open, so they closed. The agent reads your message as the answer.",
  "conversation.notice.request-failed": "The request failed.",
  "conversation.notice.retry-failed": "Couldn't try again. Try once more.",
  "conversation.notice.rewind-apps":
    "A checked app goes back to this message, including changes others made since. Unchecked apps stay as they are.",
  "conversation.notice.rewind-conversation":
    "Messages after this one are removed from the conversation.",
  "conversation.notice.rewind-shell-files":
    "Files changed through the shell are not restored.",
  "conversation.notice.rewind-steer":
    "Messages you sent while the agent was working (steer) are not rewind points. Rewinding past one removes only the message.",
  "conversation.notice.sender-loading": "Loading the details.",
  "conversation.notice.sender-unreadable": "Couldn't read the details.",
  "conversation.notice.session-archived":
    "This session is archived. You can read it, but it takes no new messages.",
  "conversation.notice.session-no-match": "No sessions match.",
  "conversation.notice.shell-mode": "Runs in your shell · Esc to leave",
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
  "conversation.placeholder.message": "Message {agent}…",
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
  "conversation.title.archive-running": "Stop running turn and archive?",
  "conversation.title.approval-command": "{agent} wants to run a command",
  "conversation.title.approval-change":
    "{agent} wants to change {count, plural, one {a file} other {# files}}",
  "conversation.title.approval-plan": "{agent} has a plan ready",
  "conversation.title.approval-run": "{agent} wants to run {tool}",
  "conversation.title.approval-setting": "Change a lophn setting",
  "conversation.title.approval-project-command": "{agent} wants to run {name}",
  "conversation.title.approval-project-command-add":
    "{agent} wants to add project command {name}",
  "conversation.title.approval-project-command-update":
    "{agent} wants to update project command {name}",
  "conversation.title.approval-project-command-remove":
    "{agent} wants to remove project command {name}",
  "conversation.title.approval-workflow-one-off":
    "{agent} wants to run one-off workflow {workflow}",
  "conversation.title.approval-workflow-override":
    "{agent} wants to run {workflow} with instance overrides",
  "conversation.title.approval-workflow-override-code":
    "{agent} wants to override flow code for {workflow}",
  "conversation.title.consent-handled": "Release approval request handled",
  "conversation.title.consent-waiting":
    "Waiting for your approval to release {app}",
  "conversation.title.call-asked": "Asked {to}",
  "conversation.title.call-handoff": "Handoff to {to}",
  "conversation.title.call-working-with": "Working with {to}",
  "conversation.title.edit-model": "Edit model",
  "conversation.title.manage-models": "Manage models",
  "conversation.title.model-limits": "Model limits",
  "conversation.title.permissions": "Permissions · {agent}",
  "conversation.title.input-request-app":
    "{agent} asks you to enter a secret for the app {subject}",
  "conversation.title.input-request-mcp":
    "{agent} asks you to enter a secret for the MCP server {subject}",
  "conversation.title.input-request-once":
    "{agent} asks you to type a value into this page",
  "conversation.title.input-request-provider":
    "{agent} asks you to enter an API key for {subject}",
  "conversation.title.input-request-sign-in":
    "{agent} asks you to sign in to {subject}",
  "conversation.title.input-request-save":
    "{agent} asks you to save a login for this page",
  "conversation.title.question-asking": "{agent} is asking",
  "conversation.title.rewind": "Rewind to here",
  "project-workspace.notice.agent-not-ready":
    "Conversations aren't ready yet. Try again in a moment.",
  "conversation.title.status": "Status",
  "conversation.title.usage": "Usage",
  "conversation.title.context": "Context",
  "conversation.title.sender-details": "Sender details",
  "conversation.label.approval-key-session": "Shift+Enter",
  "conversation.label.approval-reason-why": "Why",
  "conversation.label.approval-outside-rewind": "Outside rewind",
  "conversation.label.approval-outside-rewind-note":
    "Changes here can't be undone with Rewind.",
  "conversation.label.approval-path": "Path",
  "conversation.label.approval-folder": "Folder",
  "conversation.label.approval-script": "Script",
  "conversation.label.approval-sha256": "SHA-256",
  "conversation.title.approval-file-read": "{agent} wants to read a file",
  "conversation.title.approval-file-read-outside":
    "{agent} wants to read a file outside the workspace",
  "conversation.title.approval-file-read-sensitive":
    "{agent} wants to read a sensitive file",
  "conversation.title.approval-file-write":
    "{agent} wants to {action, select, delete {delete} edit {edit} other {write}} a file",
  "conversation.title.approval-file-write-outside":
    "{agent} wants to {action, select, delete {delete} edit {edit} other {write}} a file outside the workspace",
  "conversation.title.approval-file-write-sensitive":
    "{agent} wants to {action, select, delete {delete} edit {edit} other {write}} a sensitive file",
  "conversation.title.approval-local-tool":
    "{agent} wants to run local tool {name}",
  "conversation.title.approval-local-tool-changed":
    "{agent} wants to run changed local tool {name}",
  "conversation.label.mode-read_only": "Read only",
  "conversation.label.mode-ask": "Ask everything",
  "conversation.label.mode-workspace": "Auto-edit workspace",
  "conversation.label.mode-full": "Full auto",
  "conversation.label.blocked": "Blocked",
  "conversation.label.blocked-rule": "Rule: {pattern}",
  "conversation.button.recover-edit-rule": "Edit rule",
  "conversation.button.recover-change-mode": "Switch to {mode}",
  "conversation.button.recover-change-mode-generic": "Change mode",
  "conversation.button.recover-trust-local-tool": "Trust",
  "conversation.button.recover-trust-mcp": "Trust",
  "conversation.button.recover-add-allow-rule": "Add allow rule",
  "conversation.button.recover-sign-in-mcp": "Sign in again",
  "conversation.notice.recover-done": "Updated. Send a message to continue.",
  "conversation.notice.recover-failed":
    "Couldn't apply that change. Try again.",
  "conversation.heading.permissions-mode": "Permission mode",
  "conversation.heading.permissions-folders": "Read/write folders",
  "conversation.heading.permissions-rules": "Rules",
  "conversation.heading.permissions-tools":
    "Other computers' apps, MCP & local tools",
  "conversation.heading.permissions-denials": "Recent blocks",
  "conversation.label.permissions-folders-workspace": "Workspace",
  "conversation.label.permissions-folders-opened": "Opened for this session",
  "conversation.empty.permissions-folders": "No folders registered.",
  "conversation.label.permissions-floor-count":
    "{count, plural, one {# built-in floor rule} other {# built-in floor rules}}",
  "conversation.label.permissions-global-rules":
    "Global rules ({count, number})",
  "conversation.label.permissions-project-rules":
    "Project rules ({count, number})",
  "conversation.label.permissions-session-grants":
    "Allowed for this session ({count, number})",
  "conversation.empty.permissions-session-grants": "No session-only grants.",
  "conversation.button.permissions-revoke": "Revoke",
  "conversation.label.permissions-ask-tools": "Ask on: {tools}",
  "conversation.label.permissions-mcp-trusted": "Trusted",
  "conversation.label.permissions-mcp-untrusted": "Untrusted",
  "conversation.label.permissions-local-trusted": "Trusted",
  "conversation.label.permissions-local-untrusted": "Not trusted",
  "conversation.button.permissions-untrust": "Untrust",
  "conversation.button.permissions-trust": "Trust",
  "conversation.empty.permissions-denials": "Nothing blocked in this session.",
  "conversation.button.permissions-open-rules": "Edit rules",
} as const;
