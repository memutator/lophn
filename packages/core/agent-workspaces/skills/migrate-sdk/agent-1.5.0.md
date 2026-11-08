# @lophn/agent 1.5.0

Previous: 1.4.0
Breaking: no

A question item (`detail.kind === "question"` on a tool item in `state.items`) has one more `outcome`, `"parent_reply"`, and an optional `reply` string. A session that a team parent opened asks its questions to the parent, and the parent answers with text. Before, such a question read as `"cancelled"`. Now `outcome` is `"parent_reply"` and `reply` is the parent's answer text. The same `"parent_reply"` joins the `outcome` of the `question_resolved` update.

If you switch on the outcome, handle the new value:

```tsx
// Before
const answered = detail.outcome === "submitted";
// After
const answered = detail.outcome === "submitted" || detail.outcome === "parent_reply";
const text = detail.outcome === "parent_reply" ? detail.reply : undefined;
```

An existing app that does not switch exhaustively on `outcome` keeps working; it just treats the new value like any other unknown outcome. An app that does (a `never` check) fails to type-check until it handles `"parent_reply"`.
