# Roles and assignments

lophn has four roles. A role is fixed: it decides which built-in tools an agent
has. What you add on top is the agent's definition (instructions, model, skills,
MCP servers) and what you assign to it.

## The four roles

lophn is the agent you talk to first. There is one for the whole product and it
is not placed in a project or app. It helps you plan a project or an app, hands
the work to the agent that owns it, explains how to use lophn, and tells you how
your apps are doing. It also judges across boundaries: it proposes a new domain,
splitting or merging domains, reusing another domain's tool, or moving code into
a package. It does not design an app in detail, interpret a cause, or write
code. You decide where a boundary is cut.

Project Manager is one per project, created when you register the project. It
looks after the project's domains: it makes them, and writes their kinds files,
`DOMAIN.md` notes, skills and result pages. A saved kinds file is checked and
used at once, without asking you. It does not look after apps.

App Engineer is one per app, created when you register the app. It decides what
the app should do, writes tickets and the blueprint, hands tickets to a coding
agent, and verifies what comes back. It also looks after the app's domains the
same way the Project Manager looks after a project's. To start a new app you ask
lophn; the app is not placed in a project.

Operator is an agent you create for a project or an app. It does repeated or
routine work with the kinds of the domains you let it work with and the tools
you give it. You can have as many as you need in one place. Project Manager and
App Engineer can create and edit the Operators of their own place. They cannot
give an Operator access.

## Agent definition and assignment

An agent's definition holds its name, picture, instructions, model, skills, MCP
servers and, for an Operator, the domains it works with. The built-in
instructions of the four roles are fixed by lophn and change only when lophn
updates.

You assign apps to an agent. You assign a whole app and can then remove single
tools. A tool you assigned runs without asking each time. MCP servers come from
the layers where you set them up (global, project, or the Operator's
definition); a server set up there is assigned, and you turn one off with
`mcp_off`. Calling another agent is neither asked nor blocked. Shell commands
follow the shell rules in Settings.

An agent can be assigned the public tools of another domain. A tool belongs to
the domain of the object it handles. The tools of another domain are visible
only when they are public; private tools do not appear in the assignment list. A
release that removes a public tool another domain uses is blocked.

An assignment belongs to the agent that holds it. An agent that receives a call
works within its own assignment, not the sender's.

## Calls between agents

Agents hand work to each other with a call. The sender chooses the receiver and
whether it expects no answer, one result or a conversation. If an agent cannot
take the work, it replies with the reason. A call that cannot be delivered comes
back to the sender as a failure. Agents do not pass blocked work to a different
agent to get around the block, and you can see and stop any call from the
conversation.
