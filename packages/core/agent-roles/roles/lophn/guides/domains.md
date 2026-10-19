# Domains

A domain is a boundary of meaning and responsibility inside a project or an app.
A budget app may have an expenses domain and a budgets domain. A repository
project may have a plan domain and an eval domain. A project and an app are
containers: they hold folders, source and data. A domain is the boundary inside
them, and it is what keeps an agent's context small.

## What a domain has

- **Kinds file** (`kinds.yaml`): which documents are items of which kind, and
  which fields each kind has. The program checks it and opens a problem when a
  document breaks it. One file per domain. An app domain usually has none,
  because its objects live in the app's data and are reached through tools.
- **`DOMAIN.md`**: what the domain means, how to use it, and the rules the
  program cannot check. It is part of the agent's instructions (see the
  Instructions guide).
- **Skills**: one procedure for one job in the domain (see the Skills and MCP
  guide).
- **Artifacts**: result pages agents wrote for the domain (see the Artifact
  guide).
- **Tools**: only an app has them. Every tool an app declares names the domain
  of the object it handles, and may be `public`.

## Who makes and writes it

The Project Manager makes the domains of a project and the App Engineer makes
the domains of an app. You can make one too. Making a domain needs no approval,
because it adds no access. They write its kinds file, `DOMAIN.md` and skills
with their file tools. An Operator writes only artifacts, and only in the
domains you gave it; when something else has to change it asks the Project
Manager or App Engineer. A new app comes with a domain of its own name. An app
always has at least one domain, so its last one cannot be archived. A project
may have none. lophn proposes a new domain, a split or a merge; you decide where
the line goes.

## One container only

A domain belongs to one project or one app, and stays there. Another place does
not make a second copy. It uses the domain's public tools, which you grant to an
agent. Private tools do not show up outside their domain. A release that removes
a public tool another domain uses is blocked, and the users of a tool that
changed are told.

## What an agent sees

A Project Manager or App Engineer sees all the domains of its place. An Operator
sees the domains named in its definition, or all of them if none are named. The
prompt carries only those domains' `DOMAIN.md`, kinds and skills, and the tools
list only those domains' tools plus the public tools you granted. Other files in
the same project or app may be readable, but they are not the agent's work.
