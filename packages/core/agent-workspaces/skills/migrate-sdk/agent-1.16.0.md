# @lophn/agent 1.16.0

Previous: 1.15.0
Breaking: no

No API change. A call can now cross computers, and the call values widened with it:

- `CallRow.from` can be `{ kind: "remote", machine, computer, agent, session, name }`: an agent on another computer sent the call. `computer` is that computer's name and `name` the agent's.
- `CallRow.to` can be `{ kind: "remote", machine, computer, address }`: the call went to another computer.
- `fail_reason` (in `CallRow`, `CallSent`, `CallSettled` and a call item of a session's state) can be `"expired"` (the other computer did not take it within seven days), `"skipped"` (the person there chose not to run it) or `"old_version"` (lophn there is too old to take it).

Nothing is required of an existing app. An app that switches on `from.kind`, `to.kind` or `fail_reason` should handle the new values too:

```ts
// after
if (row.from.kind === "remote") return `${row.from.name} (${row.from.computer})`;
```

An app that does not handle them still works; those calls just show no sender or reason.
