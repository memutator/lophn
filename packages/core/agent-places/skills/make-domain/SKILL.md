---
name: make-domain
description: What a domain is (a boundary of meaning and responsibility inside a project or app), what it holds, who makes and writes it, and what each agent sees of it.
---

# Domains

A domain is a boundary of meaning and responsibility inside a project or an app.
A budget app may have an expenses domain and a budgets domain. A repository
project may have a plan domain and an eval domain. A project and an app are
containers: they hold folders, source and data. A domain is the boundary inside
them, and it is what keeps an agent's context small.

## What a domain has

Every domain has a folder, and the place information of an agent lists the
folders of the domains it works with.

- **`DOMAIN.md`**: what the domain means, how to use it, and the rules the
  program cannot check. Its text is in the prompt of every agent that works in
  the domain, as "Domain instructions (DOMAIN.md)", so nobody asks for it with a
  file tool. It is written with the file tools, and a mistake is undone with
  rewind.
- **Skills** (`skills/`): one folder per skill, a procedure for one job in the
  domain.
- **Artifacts** (`artifacts/`): result pages agents wrote for the domain.
- **Commands**: only an app has them. Every command an app declares names the
  domain of the object it handles, and may be `public`. An app's operations
  belong to no domain and only its own screens and code call them.

## Who makes and writes it

An agent working in a project or an app makes that place's domains with
`lophn domain create` (a name, a title and a purpose). The person can make one too. The
name is a slug and never changes. Making a domain needs no approval, because it
adds no access. It writes `DOMAIN.md` and skills of the domains
it works with, with its file tools. When a domain it does not work with has to
change, it asks lophn at that project or app. A new app comes with a domain of
its own name. An app always has at least one domain, so its last one cannot be
archived. A project may have none. At home, an agent proposes a new domain, a split or a
merge; the person decides where the line goes.

## One container only

A domain belongs to one project or one app, and stays there. Another place does
not make a second copy. It uses the domain's public commands, which the person
assigns to an agent. Private commands do not show up outside their domain. A
release that removes a public command another domain uses does not stop the
release; the conversation that prepares the release sees the users of that command
when it prepares the release.

## What an agent sees

An agent in a project or an app sees the domains named in its definition that
belong to that place, or all of them if none are named. At home it works with no
domain. The prompt carries only those domains' `DOMAIN.md` and skills, and
the commands list only those domains' commands plus the public commands the
person assigned. Other files in the same project or app may be readable, but they are
not the agent's work.
