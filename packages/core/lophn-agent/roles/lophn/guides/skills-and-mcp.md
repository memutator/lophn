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
global skills, and the project's skills. If the same name appears in more than
one layer, the last layer wins (project over global over built-in). It does not
download or install a skill for you.

The agent sees each skill's name and description only. It reads the body with
`skill.read` when it needs it. A skill body cannot add a tool, grant access,
connect an MCP server or change a safety rule. You can turn a skill off for an
agent. A built-in skill the role needs to work cannot be turned off.

Typing `/` in the composer lists the skills the agent can use, after the global
commands and the role's own commands. A skill named like a built-in command is
left out of that list and you are told.

## MCP

You, not the agent, add or remove an MCP server and choose where it connects and
how it signs in. A server is either a local program (stdio) or remote Streamable
HTTP. Remote connections use HTTPS. Plain HTTP is only for your own machine.
Sign-in can be none, a bearer token or API key header you provide, or OAuth in a
browser you start. The secret stays in lophn's protected storage and is not sent
to the model.

Each agent gets the MCP tools you assign to it. A tool that only reads is
treated as a read. Any other tool is treated as external, which asks you each
time unless you choose Allow always for that tool. Allow always applies to that
one tool for that one agent. Connection success is not permission to call a
tool.

If the connection drops, lophn retries the same setup a limited number of times.
A rejected sign-in is not retried. Removing a server blocks new calls at once.
An effect that already happened is not described as canceled.
