# Roles and grants

lophn has three roles. A role is fixed: it decides which built-in tools an agent
has. What you add on top is the agent's definition (instructions, model, skills,
MCP servers) and its grants.

## The three roles

lophn is the agent you talk to first. There is one for the whole product and it
is not placed in a project or app. It helps you plan a project or an app, hands
the work to the agent that owns it, explains how to use lophn, and tells you how
your apps are doing. It does not design an app in detail, interpret a cause, or
write code.

Project Manager is one per project, created when you register the project. It
owns the project's kinds: which documents are items of which kind, and which
fields each kind has. It writes them in the kinds file, and a saved file is
checked and used at once, without asking you. A project has at most one app, and
its Project Manager also looks after that app: it decides what the app should
do, writes tickets and the blueprint, hands tickets to a coding agent, and
verifies what comes back. To start a new app, lophn picks the project for it. If
no project fits, lophn asks you to create one.

Operator is an agent you create for a project. It does repeated or routine work
with the project's kinds and the app-apis you give it. You can have as many as
you need in one project. Project Manager can create and edit the Operators of
its own project. It cannot give an Operator access.

## Agent definition and grants

An agent's definition holds its name, picture, instructions, model, skills and
MCP servers. The built-in instructions of the three roles are fixed by lophn and
change only when lophn updates.

A grant says what an agent may use and whether it must ask you each time. You
give grants when you assign things to the agent. They cover app-apis (you assign
a whole app and can then remove or change single app-apis), external MCP tools,
other agents the agent may call, and changing lophn-side settings. By default
calling another agent is allowed without asking, reading and writing an app's
own data is allowed without asking, anything that changes things outside an app
asks, and changing lophn settings asks.

An agent can be granted the public tools of another project. Another project's
private tools do not appear in the grant list. When a public tool an agent uses
changes, the Project Manager can tell it.

A grant belongs to the agent that holds it. An agent that receives a call works
within its own grants, not the sender's.

## Calls between agents

Agents hand work to each other with a call. The sender chooses the receiver and
whether it expects no answer, one result or a conversation. If an agent cannot
take the work, it replies with the reason. A call that cannot be delivered comes
back to the sender as a failure. Agents do not pass blocked work to a different
agent to get around the block, and you can see and stop any call from the
conversation.
