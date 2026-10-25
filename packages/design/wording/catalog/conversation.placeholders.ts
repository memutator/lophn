// catalog/conversation.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { conversation } from "./conversation.ts";

export type ConversationPlaceholders = {
  "conversation.body.delete-session": {
    title: "string";
  };
  "conversation.body.skill-command-request": {
    skill: "string";
  };
  "conversation.button.add-model": Record<never, never>;
  "conversation.button.approval-allow-always": Record<never, never>;
  "conversation.button.approval-allow-once": Record<never, never>;
  "conversation.button.approval-deny": Record<never, never>;
  "conversation.button.archive": Record<never, never>;
  "conversation.button.archived-toggle": {
    count: "number";
  };
  "conversation.button.attach": Record<never, never>;
  "conversation.button.call-cancel": Record<never, never>;
  "conversation.button.call-open": Record<never, never>;
  "conversation.button.connect-provider": Record<never, never>;
  "conversation.button.check-delivery": Record<never, never>;
  "conversation.button.delete": Record<never, never>;
  "conversation.button.edit-open": Record<never, never>;
  "conversation.button.edit-model": Record<never, never>;
  "conversation.button.fork": Record<never, never>;
  "conversation.button.fork-here": Record<never, never>;
  "conversation.button.hidden-hide": Record<never, never>;
  "conversation.button.hidden-show": Record<never, never>;
  "conversation.button.jump-latest": Record<never, never>;
  "conversation.button.manage-models": Record<never, never>;
  "conversation.button.model-reset": Record<never, never>;
  "conversation.button.permissions-edit": Record<never, never>;
  "conversation.button.preview-image": {
    name: "string";
  };
  "conversation.button.question-next": Record<never, never>;
  "conversation.button.question-submit": Record<never, never>;
  "conversation.button.queued-remove": Record<never, never>;
  "conversation.button.remove-attachment": {
    name: "string";
  };
  "conversation.button.remove-model": Record<never, never>;
  "conversation.button.refresh-models": Record<never, never>;
  "conversation.button.rename": Record<never, never>;
  "conversation.button.resend": Record<never, never>;
  "conversation.button.retry": Record<never, never>;
  "conversation.button.rewind-go": Record<never, never>;
  "conversation.button.rewind-here": Record<never, never>;
  "conversation.button.save": Record<never, never>;
  "conversation.button.send": Record<never, never>;
  "conversation.button.send-now": Record<never, never>;
  "conversation.button.session-new": Record<never, never>;
  "conversation.button.stop": Record<never, never>;
  "conversation.empty.no-agent": Record<never, never>;
  "conversation.empty.no-messages": Record<never, never>;
  "conversation.error.action-failed": Record<never, never>;
  "conversation.error.attach-failed": Record<never, never>;
  "conversation.error.attach-skipped": Record<never, never>;
  "conversation.error.model-effort-none": Record<never, never>;
  "conversation.error.model-info-conflict": Record<never, never>;
  "conversation.error.model-info-failed": Record<never, never>;
  "conversation.error.model-info-remove-failed": Record<never, never>;
  "conversation.error.model-limit-invalid": Record<never, never>;
  "conversation.error.model-name-required": Record<never, never>;
  "conversation.error.model-price-invalid": Record<never, never>;
  "conversation.error.load-failed": Record<never, never>;
  "conversation.error.load-models": Record<never, never>;
  "conversation.error.message-body": Record<never, never>;
  "conversation.error.open-failed": Record<never, never>;
  "conversation.error.refresh-models": Record<never, never>;
  "conversation.error.stop-failed": Record<never, never>;
  "conversation.error.too-long": Record<never, never>;
  "conversation.label.approval": Record<never, never>;
  "conversation.label.approval-app": {
    id: "string";
  };
  "conversation.label.approval-allowed": Record<never, never>;
  "conversation.label.approval-always": Record<never, never>;
  "conversation.label.approval-cancelled": Record<never, never>;
  "conversation.label.approval-cancelled-detail": Record<never, never>;
  "conversation.label.approval-command": Record<never, never>;
  "conversation.label.approval-denied": Record<never, never>;
  "conversation.label.approval-effect": Record<never, never>;
  "conversation.label.approval-effect-external": Record<never, never>;
  "conversation.label.approval-effect-read": Record<never, never>;
  "conversation.label.approval-effect-write": Record<never, never>;
  "conversation.label.approval-reason": Record<never, never>;
  "conversation.label.approval-reason-given": {
    reason: "string";
  };
  "conversation.label.approval-reason-placeholder": {
    agent: "string";
  };
  "conversation.label.approval-scope-always": Record<never, never>;
  "conversation.label.approval-scope-once": Record<never, never>;
  "conversation.label.approval-target": Record<never, never>;
  "conversation.label.approval-target-tool": {
    tool: "string";
    app: "string";
  };
  "conversation.label.approval-target-mcp-tool": {
    tool: "string";
    server: "string";
  };
  "conversation.label.archived": Record<never, never>;
  "conversation.label.attached-image": Record<never, never>;
  "conversation.label.call-answered": Record<never, never>;
  "conversation.label.call-cancelled": Record<never, never>;
  "conversation.label.call-delivered": Record<never, never>;
  "conversation.label.call-failed": Record<never, never>;
  "conversation.label.call-in-progress": Record<never, never>;
  "conversation.label.call-reply-conversation": Record<never, never>;
  "conversation.label.call-reply-none": Record<never, never>;
  "conversation.label.call-reply-result": Record<never, never>;
  "conversation.label.call-working-together": Record<never, never>;
  "conversation.label.coding-queued": Record<never, never>;
  "conversation.label.composer-message": Record<never, never>;
  "conversation.label.delete-session": {
    title: "string";
  };
  "conversation.label.duration-minutes": {
    minutes: "number";
  };
  "conversation.label.duration-minutes-seconds": {
    minutes: "number";
    seconds: "number";
  };
  "conversation.label.duration-seconds": {
    seconds: "number";
  };
  "conversation.label.edit-made": Record<never, never>;
  "conversation.label.evidence-annotation": Record<never, never>;
  "conversation.label.evidence-file": Record<never, never>;
  "conversation.label.evidence-session": Record<never, never>;
  "conversation.label.group-earlier": Record<never, never>;
  "conversation.label.model-changed": Record<never, never>;
  "conversation.label.media-audio": Record<never, never>;
  "conversation.label.media-image": Record<never, never>;
  "conversation.label.media-pdf": Record<never, never>;
  "conversation.label.media-text": Record<never, never>;
  "conversation.label.media-video": Record<never, never>;
  "conversation.label.model-context": {
    limit: "string";
  };
  "conversation.label.model-context-limit": Record<never, never>;
  "conversation.label.model-effort-default": Record<never, never>;
  "conversation.label.model-effort-model": Record<never, never>;
  "conversation.label.model-effort-values": Record<never, never>;
  "conversation.label.model-input-limit": Record<never, never>;
  "conversation.label.model-input-limit-default": Record<never, never>;
  "conversation.label.model-input-media": Record<never, never>;
  "conversation.label.model-layer": {
    layer: "string";
  };
  "conversation.label.model-list": Record<never, never>;
  "conversation.label.model-name": Record<never, never>;
  "conversation.label.model-output-limit": Record<never, never>;
  "conversation.label.model-output-media": Record<never, never>;
  "conversation.label.model-price-cache-read": Record<never, never>;
  "conversation.label.model-price-cache-write": Record<never, never>;
  "conversation.label.model-price-input": Record<never, never>;
  "conversation.label.model-price-output": Record<never, never>;
  "conversation.label.model-price-unknown": Record<never, never>;
  "conversation.label.model-prices": Record<never, never>;
  "conversation.label.model-reasoning": Record<never, never>;
  "conversation.label.model-tools": Record<never, never>;
  "conversation.label.model-unknown": Record<never, never>;
  "conversation.label.more-actions": Record<never, never>;
  "conversation.label.next-turn": Record<never, never>;
  "conversation.label.permission-summary": {
    count: "plural";
  };
  "conversation.label.permissions-may": {
    agent: "string";
  };
  "conversation.label.permissions-all-tools": Record<never, never>;
  "conversation.label.permissions-except": {
    tools: "string";
  };
  "conversation.label.permissions-of": {
    agent: "string";
  };
  "conversation.label.question-answered-elsewhere": Record<never, never>;
  "conversation.label.question-cancelled": Record<never, never>;
  "conversation.label.question-card": {
    agent: "string";
  };
  "conversation.label.question-following": Record<never, never>;
  "conversation.label.question-no-answer": Record<never, never>;
  "conversation.label.question-own-answer": {
    prompt: "string";
  };
  "conversation.label.question-own-answer-placeholder": Record<never, never>;
  "conversation.label.question-pick-any": Record<never, never>;
  "conversation.label.question-previous": Record<never, never>;
  "conversation.label.questions-answered": {
    count: "plural";
  };
  "conversation.label.questions-ended-by-message": Record<never, never>;
  "conversation.label.queued-messages": Record<never, never>;
  "conversation.label.read-session": {
    title: "string";
  };
  "conversation.label.rename-session": {
    title: "string";
  };
  "conversation.label.reply-to": {
    task: "string";
  };
  "conversation.label.request-position": {
    current: "number";
    total: "number";
  };
  "conversation.label.requests": Record<never, never>;
  "conversation.label.rewind-app-also": {
    app: "string";
  };
  "conversation.label.rewind-app-unknown": {
    count: "plural";
  };
  "conversation.label.rewind-app-writes": {
    count: "plural";
  };
  "conversation.label.rewind-apps-head": Record<never, never>;
  "conversation.label.rewind-caller-flow": Record<never, never>;
  "conversation.label.rewind-caller-person": Record<never, never>;
  "conversation.label.rewind-caller-program": Record<never, never>;
  "conversation.label.rewind-conversation": Record<never, never>;
  "conversation.label.rewind-files": Record<never, never>;
  "conversation.label.rewind-hidden": {
    count: "plural";
  };
  "conversation.label.rewind-item-answer": Record<never, never>;
  "conversation.label.rewind-item-app": Record<never, never>;
  "conversation.label.rewind-item-external": Record<never, never>;
  "conversation.label.rewind-item-fact": Record<never, never>;
  "conversation.label.rewind-loading": Record<never, never>;
  "conversation.label.rewind-others": Record<never, never>;
  "conversation.label.rewind-outside": Record<never, never>;
  "conversation.label.rewind-quote": Record<never, never>;
  "conversation.label.rewind-summary-apps": {
    apps: "string";
  };
  "conversation.label.rewind-summary-files": Record<never, never>;
  "conversation.label.rewind-summary-messages": Record<never, never>;
  "conversation.label.rewind-summary-messages-apps": {
    apps: "string";
  };
  "conversation.label.rewind-write-unknown": Record<never, never>;
  "conversation.label.search-models": Record<never, never>;
  "conversation.label.search-sessions": {
    agent: "string";
  };
  "conversation.label.sender-agent-named": {
    role: "string";
    name: "string";
  };
  "conversation.label.sender-agent-other": Record<never, never>;
  "conversation.label.sender-based-on": Record<never, never>;
  "conversation.label.sender-coding": {
    product: "string";
  };
  "conversation.label.sender-coding-unknown": Record<never, never>;
  "conversation.label.sender-from": Record<never, never>;
  "conversation.label.sender-head-handed": Record<never, never>;
  "conversation.label.sender-head-why": Record<never, never>;
  "conversation.label.sender-program-unknown": Record<never, never>;
  "conversation.label.sender-role-app-engineer": Record<never, never>;
  "conversation.label.sender-role-lophn": Record<never, never>;
  "conversation.label.sender-role-operator": Record<never, never>;
  "conversation.label.sender-role-project-manager": Record<never, never>;
  "conversation.label.sender-sent-by": {
    sender: "string";
  };
  "conversation.label.sender-sent-from": Record<never, never>;
  "conversation.label.session-list": {
    agent: "string";
  };
  "conversation.label.session-untitled": Record<never, never>;
  "conversation.label.since-now": Record<never, never>;
  "conversation.label.skip-permissions": Record<never, never>;
  "conversation.label.slash-menu": Record<never, never>;
  "conversation.label.slash-unknown": {
    name: "string";
  };
  "conversation.label.provider-toggle": {
    provider: "string";
  };
  "conversation.label.status-stopped": Record<never, never>;
  "conversation.label.status-working": Record<never, never>;
  "conversation.label.steer": Record<never, never>;
  "conversation.label.stopped-after": {
    duration: "string";
  };
  "conversation.label.tasks": Record<never, never>;
  "conversation.label.tasks-progress": {
    done: "number";
    total: "number";
  };
  "conversation.label.tool-read-documents": {
    count: "plural";
  };
  "conversation.label.tool-used": {
    count: "plural";
    tool: "string";
  };
  "conversation.label.view-compact": Record<never, never>;
  "conversation.label.view-detail": Record<never, never>;
  "conversation.label.view-everything": Record<never, never>;
  "conversation.label.view-messages": Record<never, never>;
  "conversation.label.worked-for": {
    duration: "string";
  };
  "conversation.notice.answer-failed": Record<never, never>;
  "conversation.notice.approval-paused": {
    agent: "string";
  };
  "conversation.notice.call-answered": Record<never, never>;
  "conversation.notice.call-as-of": Record<never, never>;
  "conversation.notice.call-cancel-failed": Record<never, never>;
  "conversation.notice.call-cancelled": Record<never, never>;
  "conversation.notice.call-delivered": Record<never, never>;
  "conversation.notice.call-fail-closed": Record<never, never>;
  "conversation.notice.call-fail-lophn-restarted": Record<never, never>;
  "conversation.notice.call-fail-not-found": Record<never, never>;
  "conversation.notice.call-fail-receiver-ended": Record<never, never>;
  "conversation.notice.call-unreadable": Record<never, never>;
  "conversation.notice.call-waiting": {
    to: "string";
  };
  "conversation.notice.call-working-together": {
    to: "string";
  };
  "conversation.notice.custom-model": Record<never, never>;
  "conversation.notice.decide-failed": Record<never, never>;
  "conversation.notice.message-loading": Record<never, never>;
  "conversation.notice.model-limits": Record<never, never>;
  "conversation.notice.model-media": Record<never, never>;
  "conversation.notice.model-prices": Record<never, never>;
  "conversation.notice.models-found": {
    count: "plural";
    provider: "string";
  };
  "conversation.notice.models-not-listed": {
    provider: "string";
  };
  "conversation.notice.no-model-options": Record<never, never>;
  "conversation.notice.manage-models-lead": Record<never, never>;
  "conversation.notice.no-listed-models": Record<never, never>;
  "conversation.notice.no-models": Record<never, never>;
  "conversation.notice.no-providers": Record<never, never>;
  "conversation.notice.no-shown-models": Record<never, never>;
  "conversation.notice.not-found": Record<never, never>;
  "conversation.notice.not-sent": Record<never, never>;
  "conversation.notice.offline": Record<never, never>;
  "conversation.notice.permissions-mcp": Record<never, never>;
  "conversation.notice.permissions-no-apps": Record<never, never>;
  "conversation.notice.permissions-edited-in-agents": Record<never, never>;
  "conversation.notice.question-waiting": Record<never, never>;
  "conversation.notice.questions-ended-by-message": Record<never, never>;
  "conversation.notice.request-failed": Record<never, never>;
  "conversation.notice.retry-failed": Record<never, never>;
  "conversation.notice.rewind-apps": Record<never, never>;
  "conversation.notice.rewind-conversation": Record<never, never>;
  "conversation.notice.rewind-no-apps": Record<never, never>;
  "conversation.notice.rewind-no-files": Record<never, never>;
  "conversation.notice.rewind-shell-files": Record<never, never>;
  "conversation.notice.rewind-steer": Record<never, never>;
  "conversation.notice.sender-loading": Record<never, never>;
  "conversation.notice.sender-unreadable": Record<never, never>;
  "conversation.notice.session-archived": Record<never, never>;
  "conversation.notice.session-no-match": Record<never, never>;
  "conversation.notice.slash-no-match": Record<never, never>;
  "conversation.notice.slash-working": {
    agent: "string";
  };
  "conversation.notice.stale": {
    age: "string";
  };
  "conversation.notice.stale-never": Record<never, never>;
  "conversation.notice.unconfirmed": Record<never, never>;
  "conversation.notice.working-next-turn": {
    agent: "string";
  };
  "conversation.placeholder.ask": {
    agent: "string";
  };
  "conversation.rewind-why.already-reverted": Record<never, never>;
  "conversation.rewind-why.answered-fact": Record<never, never>;
  "conversation.rewind-why.chain-broken": Record<never, never>;
  "conversation.rewind-why.created-edited": Record<never, never>;
  "conversation.rewind-why.edited-outside": Record<never, never>;
  "conversation.rewind-why.external-effect": Record<never, never>;
  "conversation.rewind-why.later-edit": Record<never, never>;
  "conversation.rewind-why.link-path": Record<never, never>;
  "conversation.rewind-why.no-pre-image": Record<never, never>;
  "conversation.rewind-why.rename-blocked": Record<never, never>;
  "conversation.rewind-why.unknown": Record<never, never>;
  "conversation.rewind.preview-failed": Record<never, never>;
  "conversation.rewind.result-left": {
    restored: "plural";
    left: "plural";
  };
  "conversation.rewind.result-restored": {
    count: "plural";
  };
  "conversation.rewind.running": Record<never, never>;
  "conversation.rewind.start-failed": Record<never, never>;
  "conversation.title.add-model": Record<never, never>;
  "conversation.title.approval-command": {
    agent: "string";
  };
  "conversation.title.approval-run": {
    agent: "string";
    tool: "string";
  };
  "conversation.title.call-handed": {
    to: "string";
  };
  "conversation.title.edit-model": Record<never, never>;
  "conversation.title.manage-models": Record<never, never>;
  "conversation.title.permissions": {
    agent: "string";
  };
  "conversation.title.question-asking": {
    agent: "string";
  };
  "conversation.title.rewind": Record<never, never>;
  "project-workspace.notice.agent-not-ready": Record<never, never>;
  "conversation.title.sender-details": Record<never, never>;
};

type Area = typeof conversation;
type _SameKeys =
  | Exclude<keyof Area, keyof ConversationPlaceholders>
  | Exclude<keyof ConversationPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
