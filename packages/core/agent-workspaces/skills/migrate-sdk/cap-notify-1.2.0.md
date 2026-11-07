# @lophn/cap-notify 1.2.0

Previous: 1.1.0
Breaking: no

Adds the optional `persistent` flag to `notify({ title, body?, key?, persistent? })`. The default `false` is the old behavior: the notice disappears when the person dismisses it (50 per app). With `persistent: true` dismissing only marks it read and the notice stays as a record the person can find later (the newest 200 per app). Same `notify.send` permission. Nothing is required of an existing app; every existing `notify()` call keeps working as a non-persistent notice.

Optional change: for a result the person may look for later (a report was sent, a long job finished), pass `persistent: true`. Keep short-lived status (a low-limit warning) non-persistent.

```ts
// before
await notify({ title: "Weekly report was sent" });
// after
await notify({ title: "Weekly report was sent", persistent: true });
```
