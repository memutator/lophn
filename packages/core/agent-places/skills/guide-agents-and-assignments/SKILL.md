---
name: guide-agents-and-assignments
description: The agents (lophn and the ones you make), where a conversation works (home, a project, an app), what an agent definition holds, how apps and MCP servers are assigned, and how agents call each other.
---

# Agents and assignments

lophn has agents. What you add on top of one is its definition (instructions,
model, skills, MCP servers) and what you assign to it.

## Agents and places

lophn is the built-in agent that is always there. Its name and picture cannot be
changed, and it cannot be removed. An agent you make has one name across the
product; `lophn` cannot be used. A definition does not belong to a project or an
app.

A conversation gets its place when it opens: the Launcher opens it at home, a
project window in that project, an app window in that app. The kind of place
decides the built-in tools, instructions and skills, and the folders it can use.
The same kind works the same way whatever agent is in it.

- At home, an agent plans, registers apps, answers how to use lophn and how the
  apps are doing, and reads project folders only.
- In a project, an agent works with the project's folders, the domains it works
  with (their kinds, `DOMAIN.md`, skills and artifacts), and the project's
  workflows.
- In an app, an agent designs the app, builds and releases it, and works with the
  app's domains.

To start a new app, ask lophn at home. It registers the app and hands it to lophn
at that app.

## Agent definition and assignment

An agent's definition holds its name, picture, instructions, model, skills, MCP
servers and the domains it works with (none means all domains of the project or
app a conversation opens in). The built-in instructions of each place are fixed
by lophn and change only when lophn updates.

You assign apps to an agent. You assign a whole app and can then remove single
tools. A tool you assigned runs without asking each time. MCP servers come from
the layers where you set them up (global, project, or the agent's definition); a
server set up there is assigned, and you turn one off with `mcp_off`. Calling
another agent is neither asked nor blocked. Shell commands follow the shell
rules in Settings.

An agent can be assigned the public tools of another domain. A tool belongs to
the domain of the object it handles. The tools of another domain are visible
only when they are public; private tools do not appear in the assignment list. A
release that removes a public tool another domain uses is not stopped; the
conversation that prepares the release sees the users of that tool when it
prepares the release.

An assignment belongs to the agent that holds it. An agent that receives a call
works within its own assignment, not the sender's.

## Calls between agents

Agents hand work to each other with a call. The sender chooses the receiver by
agent name and place (`{project: <name>}` or `{app: <name>}`; no place means
home) and whether it expects no answer, one result or a conversation. If an
agent cannot take the work, it replies with the reason. A call that cannot be
delivered comes back to the sender as a failure. Agents do not pass blocked work
to a different agent to get around the block, and you can see and stop any call
from the conversation.
