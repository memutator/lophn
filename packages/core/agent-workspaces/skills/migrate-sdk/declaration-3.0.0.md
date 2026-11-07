# @lophn/declaration 3.0.0

Previous: 2.1.0
Breaking: yes. A release sealed with 2.x (commands with `domain`) no longer starts; re-release from the migrated source. Move together with `@lophn/app-ui` 2.2.0.

Domains are gone. A command has no `domain` field (an unknown field is rejected). Agents call a command as `lophn <app slug> <command>`; a command that is not `public` is visible only to agents in this app's own workspace.

Before:

```ts
commands: [{ name: "order-find", description: "...", inputSchema: null,
             effect: "read", public: false, domain: "orders" }],
```

After:

```ts
commands: [{ name: "order-find", description: "...", inputSchema: null,
             effect: "read", public: false }],
```

Also fix text in the app that tells the reader to run `lophn <domain> <command>` or `lophn domain ...`: use the app slug, and drop domain wording from `DESIGN.md`, skills and docs.
