# @lophn/agent 1.14.0

Previous: 1.13.0
Breaking: no

No API change. A pending approval in a session's state can now have a new subject kind: `{ kind: "setting", key, lines }`. The agent asks the person to allow a change to a setting that needs their approval (sync folders), and `lines` says the change in plain English, one line each, with full paths.

Nothing is required of an existing app. An app that draws approval cards and switches on `subject.kind` should draw this kind too, showing every line as it is:

```ts
// after
if (subject.kind === "setting") return subject.lines.join("\n");
```

An app that does not handle it still works; that card just has no description.
