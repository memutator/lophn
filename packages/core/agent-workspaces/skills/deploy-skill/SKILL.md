---
name: deploy-skill
description: "Make an app's public skill reach agents: when to deploy it, to whom, and how to undo or check it."
---

# Deploy a skill

An app keeps the original of its public skill in its own source and ships it
with each release. Deploying a skill records that agents on one layer receive
that released skill: its name and description go into their prompt, and they
read it with `skill.read`. Receivers cannot edit it. It always follows the app's
active release, so a new release changes it everywhere at once; the person
never copies anything. A change to the skill goes to the app's own workspace.

A deployed skill is also what lets an agent call the app's public commands
without asking the person each time. An agent that has no deployed skill of an
app can still call its command, but the person is asked first.

## When to deploy

- After you built or changed an app and something outside it should use it:
  another agent, a project, or the person's own coding agent.
- When the person says they want to use an app from somewhere else
  ("let the bookkeeper use the budget app", "I want it in Claude Code").

If no agent outside the app needs it, do not deploy.

## Choose the layer

Take the narrowest layer that covers the use. Every session that receives a
skill carries its name and description in its prompt, so a wide layer costs
every conversation on it.

| Who should use it | `--to` |
|---|---|
| One agent only | `agent:<handle>` (`agent:lophn@<workspace>` for a lophn) |
| The work of one project or app | `workspace` (the workspace you run in) or `workspace:<project, app or home>` |
| Everyone, everywhere | `global` |
| The person's coding agents (Claude Code, Codex, OpenCode) | `harness` (the person is always asked) |

- Every workspace has its own `lophn`, so `agent:lophn` alone is ambiguous: write
  `agent:lophn@home`, `agent:lophn@<project name>` or `agent:lophn@<app slug>`.
  In an agent session, `agent:lophn` without a workspace means the lophn of your
  own workspace; a person's terminal gets an error that lists the choices.
- `harness` copies the skill into the skill folder of every coding agent on this
  computer that has the lophn hook installed. The copy follows the app's active
  release; it is refreshed when a release is activated.

## Before you deploy

1. The skill is declared `public: true` in `lophn.ts` and its commands are all
   public, and the release that carries it is prepared and activated
   (`lophn declaration check`, `lophn release prepare`, `lophn release activate`).
   A skill that is not in the active release cannot be deployed.
2. Its description tells a stranger when to read it, and the body works for an
   agent that knows nothing about the app's insides.

If the app has no public skill, it cannot be deployed. In the app's own
workspace, write one first (read the skill `write-skill`); from anywhere else,
ask lophn at that app with `lophn call send`.

## Commands

```
lophn skill deploy budget log-expense --to agent:bookkeeper
lophn skill deploy budget log-expense --to workspace:Household
lophn skill deploy budget log-expense --to agent:lophn@home
lophn skill deploy budget log-expense --to harness
lophn skill undeploy budget log-expense --to agent:bookkeeper
lophn skill deployments
lophn skill deployments --app budget
```

The first two words after `deploy` are the app slug and the skill name. Running
the same deploy twice changes nothing. `deployments` lists, for each deployed
skill, the app, the skill and where it goes (`global`, `harness`, a workspace
or an agent).

## Who is asked

- In the app's own workspace you deploy that app's skills to any agent,
  workspace or `global` without asking. Home's lophn deploys any app there
  without asking.
- `harness` is different: the skill is written into the person's own coding
  agents, which have a shell and no approval step, so the person always gets a
  card for it, whoever you are. Only the person deploys it without a card.
- In any other session the person gets a card and decides; if they refuse, the
  command fails with `forbidden` and their reason.
- An unattended run (a job, a workflow step, a background run) is refused with
  `forbidden`: it has no one to ask. Report that the person has to deploy it.

## Undeploy, and look before you change

Before you rename or remove a public skill or one of its commands, read who has
it: `lophn skill deployments --app <slug>`. In the app's own workspace you see
the places that concern you (every agent, coding agents, this workspace and its
agents) and a count of the other places, not their names; ask lophn at Home who
they are. Anyone else sees only the places that concern them, and Home's lophn
and the person see all. `provided: false` marks a skill the app no longer
offers, and `unreadable` counts places that could not be read. An agent that still has the old name
loses the skill after the release; deploy the new name where the old one was,
then `lophn skill undeploy` the old. Deleting or archiving an app removes its
deployments by itself.
