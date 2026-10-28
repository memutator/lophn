---
name: guide-skills-and-mcp
description: What skills and MCP servers are, the skill layers (built-in, global, domain), the slash menu, and how the person adds, signs in to and assigns MCP servers.
---

# Skills and MCP

A skill and an MCP server are add-ons an agent can use. Finding one, signing in,
choosing it and actually using it are separate steps. Adding either one does not
widen a grant or a decision that still needs you.

## Skills

A skill is a Markdown file with a short header. The name uses lowercase letters,
numbers and single hyphens, from 1 to 64 characters. The description is required
and stays within 1,024 characters. A file that does not match is left out and
you are told why.

lophn reads skills in three layers: the skills that shipped with lophn, your
global skills, and the skills of a domain, which live in the `skills` folder of
that domain. A domain's skills are written by the Project Manager or App
Engineer that looks after it. An agent sees the skills of the domains it works
with, so an Operator chooses among the skills of the domains it was given. If
the same name appears in a domain and in the global layer, the domain one wins.
A built-in skill is never replaced by a skill of the same name from you. It does
not download or install a skill for you.

The agent sees each skill's name and description only. It reads the body with
`skill.read` when it needs it. A skill body cannot add a tool, grant access,
connect an MCP server or change a safety rule. You can turn a skill off for an
agent. Built-in skills cannot be turned off.

Typing `/` in the composer lists the session commands and then the skills you
can call by name. Built-in guidance skills are not in that list; ask the agent
in words. A skill named like a session command is left out of that list.

## MCP

You, not the agent, add or remove an MCP server and choose where it connects and
how it signs in. A server is either a local program (stdio) or remote Streamable
HTTP. Remote connections use HTTPS. Plain HTTP is only for your own machine.
Sign-in can be none, a bearer token or API key header you provide, or OAuth in a
browser you start. The secret stays in lophn's protected storage and is not sent
to the model.

Each agent gets the MCP tools you assign to it. A tool you assigned runs without
asking each time. A server set up in a layer is assigned, and you turn one off
with `mcp_off`.

If the connection drops, lophn retries the same setup a limited number of times.
A rejected sign-in is not retried. Removing a server blocks new calls at once.
An effect that already happened is not described as canceled.
