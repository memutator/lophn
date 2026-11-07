# @lophn/app-ui 2.5.0

Previous: 2.4.0
Breaking: no

Adds `useKeepAlive(active)`. While `active` is true, lophn keeps the screen's page alive (hidden) when the person leaves its workspace, instead of reloading it on return. Turn it on only while work is running (waiting for an agent answer, an upload) and turn it off after; at most 6 pages per window stay alive, so anything that must survive a reload (such as a session id) is stored by the app.

```tsx
useKeepAlive(uploading);
```

Nothing is required of an existing app. `@lophn/agent` 1.3.0 already does this itself while a turn runs.
