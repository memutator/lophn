// catalog/conversation.ts에서 생성한다. 직접 고치지 않고 `deno run --allow-read --allow-write packages/design/wording/generate.ts`로 다시 만든다.
import type { conversation } from "./conversation.ts";

export type ConversationPlaceholders = {
  "conversation.body.delete-session": {
    title: "string";
  };
  "conversation.body.save-visual-request": {
    title: "string";
    block: "string";
    message: "string";
  };
  "conversation.body.skill-command-request": {
    skill: "string";
  };
  "conversation.button.approval-allow": Record<never, never>;
  "conversation.button.approval-allow-once": Record<never, never>;
  "conversation.button.approval-allow-scope": Record<never, never>;
  "conversation.button.approval-allow-session": Record<never, never>;
  "conversation.button.approval-deny": Record<never, never>;
  "conversation.button.archive": Record<never, never>;
  "conversation.button.archived-toggle": {
    count: "number";
  };
  "conversation.button.attach": Record<never, never>;
  "conversation.button.change-defaults": Record<never, never>;
  "conversation.button.check-delivery": Record<never, never>;
  "conversation.button.check-result": Record<never, never>;
  "conversation.button.close-tab": Record<never, never>;
  "conversation.button.delete": Record<never, never>;
  "conversation.button.edit-open": Record<never, never>;
  "conversation.button.edit-undo": Record<never, never>;
  "conversation.button.favorite-add": {
    model: "string";
  };
  "conversation.button.favorite-remove": {
    model: "string";
  };
  "conversation.button.fork": Record<never, never>;
  "conversation.button.fork-here": Record<never, never>;
  "conversation.button.hidden-hide": Record<never, never>;
  "conversation.button.hidden-show": Record<never, never>;
  "conversation.button.jump-latest": Record<never, never>;
  "conversation.button.question-details": Record<never, never>;
  "conversation.button.question-next": Record<never, never>;
  "conversation.button.question-skip": Record<never, never>;
  "conversation.button.question-submit": Record<never, never>;
  "conversation.button.redo": Record<never, never>;
  "conversation.button.remove-context": Record<never, never>;
  "conversation.button.rename": Record<never, never>;
  "conversation.button.resend": Record<never, never>;
  "conversation.button.restore": Record<never, never>;
  "conversation.button.rewind": Record<never, never>;
  "conversation.button.rewind-go": Record<never, never>;
  "conversation.button.rewind-here": Record<never, never>;
  "conversation.button.save": Record<never, never>;
  "conversation.button.send": Record<never, never>;
  "conversation.button.session-new": Record<never, never>;
  "conversation.button.show-all-results": Record<never, never>;
  "conversation.button.stop": Record<never, never>;
  "conversation.button.summarize-go": Record<never, never>;
  "conversation.button.summarizing": Record<never, never>;
  "conversation.button.usage": Record<never, never>;
  "conversation.empty.no-agent": Record<never, never>;
  "conversation.empty.no-messages": Record<never, never>;
  "conversation.error.action-failed": Record<never, never>;
  "conversation.error.load-failed": Record<never, never>;
  "conversation.error.message-body": Record<never, never>;
  "conversation.error.open-failed": Record<never, never>;
  "conversation.error.stop-failed": Record<never, never>;
  "conversation.error.too-long": Record<never, never>;
  "conversation.label.approval": Record<never, never>;
  "conversation.label.approval-esc": Record<never, never>;
  "conversation.label.approval-preview": Record<never, never>;
  "conversation.label.author-check": Record<never, never>;
  "conversation.label.composer-message": Record<never, never>;
  "conversation.label.correction": Record<never, never>;
  "conversation.label.delete-session": {
    title: "string";
  };
  "conversation.label.delivery-applied": Record<never, never>;
  "conversation.label.delivery-not-sent": Record<never, never>;
  "conversation.label.delivery-received": Record<never, never>;
  "conversation.label.delivery-saved": Record<never, never>;
  "conversation.label.delivery-sending": Record<never, never>;
  "conversation.label.delivery-unconfirmed": Record<never, never>;
  "conversation.label.duration-days-hours": {
    days: "number";
    hours: "number";
  };
  "conversation.label.duration-hours-minutes": {
    hours: "number";
    minutes: "number";
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
  "conversation.label.edit-undone": Record<never, never>;
  "conversation.label.favorites": Record<never, never>;
  "conversation.label.group-earlier": Record<never, never>;
  "conversation.label.model-list": Record<never, never>;
  "conversation.label.model-unknown": Record<never, never>;
  "conversation.label.more-actions": Record<never, never>;
  "conversation.label.more-results": {
    count: "plural";
  };
  "conversation.label.permission-summary": {
    count: "plural";
  };
  "conversation.label.question-answered": {
    count: "plural";
    answers: "string";
  };
  "conversation.label.question-applied": {
    answers: "string";
  };
  "conversation.label.question-apply-failed": {
    answers: "string";
  };
  "conversation.label.question-applying": {
    answers: "string";
  };
  "conversation.label.question-asking": {
    agent: "string";
    count: "plural";
  };
  "conversation.label.question-cancelled": Record<never, never>;
  "conversation.label.question-expired": Record<never, never>;
  "conversation.label.question-expires": {
    remaining: "string";
  };
  "conversation.label.question-expires-now": Record<never, never>;
  "conversation.label.question-own-answer": {
    prompt: "string";
  };
  "conversation.label.question-own-answer-placeholder": Record<never, never>;
  "conversation.label.question-paused": Record<never, never>;
  "conversation.label.question-recommended": Record<never, never>;
  "conversation.label.question-skipped": Record<never, never>;
  "conversation.label.rename-session": {
    title: "string";
  };
  "conversation.label.request-position": {
    current: "number";
    total: "number";
  };
  "conversation.label.requests": Record<never, never>;
  "conversation.label.results": Record<never, never>;
  "conversation.label.rewind-hidden": {
    count: "plural";
  };
  "conversation.label.rewind-item-answer": Record<never, never>;
  "conversation.label.rewind-item-app": Record<never, never>;
  "conversation.label.rewind-item-approval": Record<never, never>;
  "conversation.label.rewind-item-external": Record<never, never>;
  "conversation.label.rewind-item-fact": Record<never, never>;
  "conversation.label.rewind-loading": Record<never, never>;
  "conversation.label.rewind-messages-only": Record<never, never>;
  "conversation.label.rewind-point": Record<never, never>;
  "conversation.label.rewind-restore-all": Record<never, never>;
  "conversation.label.rewind-summarize": Record<never, never>;
  "conversation.label.search-models": Record<never, never>;
  "conversation.label.search-sessions": {
    agent: "string";
  };
  "conversation.label.send-correction": Record<never, never>;
  "conversation.label.send-mode": Record<never, never>;
  "conversation.label.send-request": Record<never, never>;
  "conversation.label.session-list": {
    agent: "string";
  };
  "conversation.label.session-untitled": Record<never, never>;
  "conversation.label.since-now": Record<never, never>;
  "conversation.label.slash-blocked": {
    agent: "string";
  };
  "conversation.label.slash-menu": Record<never, never>;
  "conversation.label.slash-origin-place": Record<never, never>;
  "conversation.label.slash-origin-workspace": Record<never, never>;
  "conversation.label.slash-unknown": {
    name: "string";
  };
  "conversation.label.status-stopped": Record<never, never>;
  "conversation.label.status-working": Record<never, never>;
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
  "conversation.notice.agent-paused": Record<never, never>;
  "conversation.notice.ended": Record<never, never>;
  "conversation.notice.external-failed": {
    connection: "string";
  };
  "conversation.notice.external-retry-at": {
    when: "string";
  };
  "conversation.notice.external-unknown": {
    connection: "string";
  };
  "conversation.notice.external-waiting": {
    connection: "string";
  };
  "conversation.notice.message-loading": Record<never, never>;
  "conversation.notice.model-definition": Record<never, never>;
  "conversation.notice.model-session-only": Record<never, never>;
  "conversation.notice.model-value-fitted": {
    axis: "string";
    to: "string";
    from: "string";
    model: "string";
  };
  "conversation.notice.no-model-options": Record<never, never>;
  "conversation.notice.no-models": Record<never, never>;
  "conversation.notice.not-found": Record<never, never>;
  "conversation.notice.not-sent": Record<never, never>;
  "conversation.notice.offline": Record<never, never>;
  "conversation.notice.session-no-match": Record<never, never>;
  "conversation.notice.slash-choose": {
    name: "string";
  };
  "conversation.notice.slash-no-match": Record<never, never>;
  "conversation.notice.stale": {
    age: "string";
  };
  "conversation.notice.stale-never": Record<never, never>;
  "conversation.notice.unconfirmed": Record<never, never>;
  "conversation.placeholder.ask": {
    agent: "string";
  };
  "conversation.rewind-block.copied": Record<never, never>;
  "conversation.rewind-block.correction": Record<never, never>;
  "conversation.rewind-block.limit-count": Record<never, never>;
  "conversation.rewind-block.limit-file": Record<never, never>;
  "conversation.rewind-block.limit-total": Record<never, never>;
  "conversation.rewind-block.record-failed": Record<never, never>;
  "conversation.rewind-why.already-reverted": Record<never, never>;
  "conversation.rewind-why.answered-fact": Record<never, never>;
  "conversation.rewind-why.app-failed": Record<never, never>;
  "conversation.rewind-why.app-not-settled": Record<never, never>;
  "conversation.rewind-why.app-not-started": Record<never, never>;
  "conversation.rewind-why.app-revision-changed": Record<never, never>;
  "conversation.rewind-why.app-uncertain": Record<never, never>;
  "conversation.rewind-why.chain-broken": Record<never, never>;
  "conversation.rewind-why.created-edited": Record<never, never>;
  "conversation.rewind-why.edited-outside": Record<never, never>;
  "conversation.rewind-why.external-effect": Record<never, never>;
  "conversation.rewind-why.later-edit": Record<never, never>;
  "conversation.rewind-why.link-path": Record<never, never>;
  "conversation.rewind-why.no-pre-image": Record<never, never>;
  "conversation.rewind-why.no-receipt": Record<never, never>;
  "conversation.rewind-why.no-revert-command": Record<never, never>;
  "conversation.rewind-why.rename-blocked": Record<never, never>;
  "conversation.rewind-why.unknown": Record<never, never>;
  "conversation.rewind.hint-messages-only": Record<never, never>;
  "conversation.rewind.hint-restore-all": Record<never, never>;
  "conversation.rewind.hint-summarize": Record<never, never>;
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
  "conversation.rewind.summary-failed": Record<never, never>;
  "conversation.title.new-session": Record<never, never>;
  "conversation.title.rewind": Record<never, never>;
  "project-workspace.notice.agent-not-ready": Record<never, never>;
};

type Area = typeof conversation;
type _SameKeys =
  | Exclude<keyof Area, keyof ConversationPlaceholders>
  | Exclude<keyof ConversationPlaceholders, keyof Area>;
const _sameKeys: [_SameKeys] extends [never] ? true : never = true;
void _sameKeys;
