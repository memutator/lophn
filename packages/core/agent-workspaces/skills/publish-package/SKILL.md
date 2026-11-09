---
name: publish-package
description: Publish part of this app's code as a user package (@me/...) that other apps can pin, or use a package another app published. Read this before `lophn package publish`, when you are asked to move code into a package, or when you add an @me package to this app.
---

# Publish or use a user package

A user package is a folder of this app's code that other apps pin and import as
`@me/<part>`. Names are global: the first app that publishes a name owns it, and
only that app publishes new versions. A published version never changes and is
never deleted. A mistake is fixed by publishing a new version.

Publish only when lophn at home decided to share the code and handed it to you.
It decides; do not ask the person. Do not publish on your own to reuse code
inside this app.

## Publish

1. Put the code in one folder of the source, for example `packages/<part>/`.
   Give it a `package.json`:

   ```json
   {
     "name": "@me/<part>",
     "version": "1.0.0",
     "type": "module",
     "exports": "./mod.ts",
     "dependencies": { "@lophn/cap-net": "1.0.0" }
   }
   ```

   - `name` and `version` must be exactly what you publish, or publish fails.
   - Versions are exact `x.y.z`. No `-beta`, no ranges.
   - List `@lophn/*` and `@me/*` packages the folder imports, each with one exact
     version. Avoid other npm dependencies: an app that uses the package resolves
     them from its own `node_modules`, so it would have to add them too.
   - Write `package.json` with two-space JSON indentation and a final newline.
   - Everything in the folder is published. Keep tests and fixtures out of it,
     or accept that they ship.
2. Make the app import the folder by relative path, run `npm run check` and
   `npm test`, and commit. Publish reads the HEAD commit, and the whole source
   must be clean: no uncommitted changes and no untracked files anywhere, not
   only in the folder. Symlinks are rejected.
3. Write the guide. It is the only thing other agents read before they use the
   package, and nothing checks it, so make it correct:
   - `purpose`: what the package does and when to use it, in a few sentences.
   - `api`: every export with its type signature, and what each returns or throws.
   - `examples`: the smallest code an app copies to use it, with the import line.
4. Set `permissions`: every declaration permission the package needs at run
   time (`fs.read`, `fs.write`, `net.fetch`, `net.listen`, `secret.use`,
   `notify.send`). Publish fails if they do not cover what its `@lophn/cap-*`
   dependencies need (for example `@lophn/cap-net` needs `net.fetch`). Include
   what the `@me` packages it depends on list, too. Every app that pins this
   version must declare all of them, or its release fails.
5. Publish:

   ```
   lophn package publish <app> @me/<part> 1.0.0 --path packages/<part> \
     --description "<one line>" \
     --input '{"guide":{"purpose":"...","api":"...","examples":"..."},"permissions":["net.fetch"]}'
   ```

6. Check it: `lophn package read @me/<part>` shows the guide (read on with the
   offset it gives when the guide is long), `owner_app`, other versions and the
   apps that use each version.
7. If other apps use an older version, tell lophn at each of them with
   `lophn call send` (`to: {agent: "lophn", workspace: {app: "<app name>"}}`, no
   reply expected): the new version, what changed, and whether they must move.

When publish fails:
- `working_tree_changed` or `uncommitted_file`: commit or remove the files, then
  publish again.
- `conflict`: that version exists with other bytes, guide or permissions. Raise
  the version (`package.json` too), commit, publish again.
- `forbidden`: another app owns the name. Pick another name.
- An error about `package.json` name or version: make the folder's
  `package.json` match what you publish.
- A missing permission: add it to `permissions`.

Publishing the same commit with the same input again succeeds and changes
nothing. Do it if publish failed after the version was registered.

## Use a package from another app

1. `lophn package read` lists the packages; `lophn package read @me/<part>`
   gives the guide, permissions and versions. Pick one exact version.
2. Pin it in two places with the same version:
   - `package.json`: `"@me/<part>": "file:.lophn/sdk/@me/<part>/<version>"`
   - `lophn.ts` `sdk_dependencies`: `{ name: "@me/<part>", version: "<version>" }`
3. Add every permission the package lists to the declaration `permissions`,
   with your reason. Release prepare fails without them.
4. Run `npm install`, then use it as the guide says.
5. A bug in the package goes to lophn at the owning app (`owner_app`) with
   `lophn call send`, no reply expected. Do not copy the package into this app
   to patch it.

To move to a newer version, read its guide and change both pins together.
