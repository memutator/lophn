# @lophn/declaration 2.1.0

Previous: 2.0.0
Breaking: no

Adds the optional `skills: [{ name, public, commands }]` field (skills the app gives to other agents). Nothing to change for an app that does not share skills; bump the pin.

To use it: put the skill at `.lophn/skills/<name>/SKILL.md` in the source and commit it; `commands` must be command names of this declaration, all `public` when the skill is `public`. `.gitignore` must ignore `.lophn/sdk/` only, not `.lophn/` as a whole.
