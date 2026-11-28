# App skill deployment replaces app assignment

Breaking: yes
Areas: app, project, home

An agent now uses an app through a deployed skill, not through an assignment
the person made. `lophn app share` and assigning an app to an agent are gone,
and old assignments were not converted.

## What is newly possible

- **Deploy an app's public skill** with `lophn skill deploy <app> <skill> --to
  <where>`: `agent:<handle>` (a lophn is `agent:lophn@<workspace>`),
  `workspace` or `workspace:<project, app or home>`, `global`, or `harness`
  (the person's own coding agents). The agent that receives it knows the app
  and calls its public commands without asking. It follows the app's active
  release; receivers cannot edit it. Read `deploy-skill` for the layer choice.
- **Read who receives what** with `lophn skill deployments [--app <slug>]`
  (an entry the app no longer provides shows `provided: false`; one of an
  archived app also shows `archived: true`), and see who loses a skill when a
  release removes it (`release prepare`, the consent card, the delete list).
  Archiving an app keeps its deployments (nobody receives them until it is
  unarchived); only deleting an app removes them.

## What changed for existing work

- An agent calls an app's commands only when a public skill of that app reaches
  it through the global, workspace or agent layer and is not switched off in
  `skills_off`. Otherwise the call asks the person.
- Jobs, workflow steps and other unattended runs that call an app with no
  deployed skill are refused: they cannot ask.
- App assignments (`apps`, command `permissions`) and the `share_requests`
  were dropped, not converted. Assignment to another computer's app
  (`remote_apps`) is unchanged.

## When to adopt

Per workspace, only where something outside the app already uses it:

- **An app** that exposes public commands but has no public skill cannot be
  deployed, so every outside call asks. Propose that the app's own lophn writes
  a public skill for what it exposes (`write-skill`) and deploys it
  (`deploy-skill`) to where it is used.
- **A project** whose workflow calls an app needs a skill of that app deployed
  to the project (or to the workflow's agent).
- **An agent** that had an app assigned needs the skill deployed to it or to
  its workspace.

Do not propose anything for an app nobody outside it uses.

## What to check before proposing

- `lophn app read <app ID>` for the app's purpose and public commands, and ask
  the app's lophn (`lophn call send`) whether it has a public skill; none means
  nothing to deploy yet.
- `lophn skill deployments --app <slug>` for who already receives it.
- `lophn workflow list` for flows that call the app (`tool({ app })`), and
  `lophn agent list` for agents that worked with it.

## Instruction diff

Check agent-owned `memory.md` and generated skills for obsolete instructions
(assigning an app to an agent, `lophn app share`, asking the person for an
assignment). Edit them directly and report what changed; for person-owned
`LOPHN.md`, propose edits only.
