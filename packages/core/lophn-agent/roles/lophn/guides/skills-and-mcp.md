# Skills and MCP

A skill and an MCP connection are add-ons a Preset can use. Finding one, signing
in, choosing it, and actually using it are separate steps. Adding either one
does not widen a product limit, a reading limit, or the decisions that still
need you.

## Skills

You prepare a skill folder on this machine and register it. lophn looks in the
folders you registered, then your personal skill collection, then the skills
that shipped with lophn. It looks at each folder and the skill bundles directly
inside it. It does not search app source, parent folders, or another product's
collection, and it does not download or install a skill for you.

A skill is a Markdown file with a short header. The name uses lowercase letters,
numbers, and single hyphens, from 1 to 64 characters. The description is
required and stays within 1,024 characters. A file that does not match is left
out, and you are told why. If the same name appears more than once, the earliest
one in the search is used. You are told which copy was left out. A Preset
selects exact names. A selected name that is not found is reported as missing.
lophn does not substitute another skill.

The role sees the skill name and description only, in alphabetical order. The
body is read only when the role asks for that skill by name. You get the whole
body, or the read fails. You do not get a partial body presented as success.
Supporting notes are read only when you pick them by title, and only from inside
that skill bundle. Scripts are not executed. A skill body cannot add a tool,
grant access, connect an MCP server, or change a safety rule.

The skills a piece of work may use are fixed when that work starts. If a
selected skill changes or disappears before it is read, the read fails. A newly
found skill is available the next time work starts.

## MCP

You, not the agent, add or remove an MCP server and choose whether it is
enabled, where it connects, and how it signs in. A Preset then chooses the exact
server and the exact current tools that role may use. A document, a skill, or a
server reply cannot import this setup. Choosing a server does not choose tools
it may gain later. Every role can use skills and MCP only inside the limit fixed
for that role.

The connection is either a local program (stdio) or remote Streamable HTTP. You
choose which. It does not fall back to another transport. The local program is
started without shell interpretation, and it receives only the environment it
needs plus values you set for that server. Remote connections use HTTPS. Plain
HTTP is only for a loopback address on your machine. Sign-in can be none, a
bearer token or API key header you provide, or OAuth with a browser sign-in that
you start. The secret stays in the keychain. If the address or account changes,
the old secret is not reused. If the keychain is locked, that connection stays
unavailable. There is no plain-text fallback, and the secret is not sent to the
model.

A tool is offered only after its name, description, and input contract check
out. You set each tool as read, write, or external. External means it changes
data outside your machine, sends something to someone, or uploads private
content. A tool with several effects uses the widest one. An external tool whose
undo behavior is unknown asks you first. You can mark that one tool safe on the
Preset so it is not asked about again. That mark does not apply to another tool
and does not widen the role limit. Connection success is not permission to call
a tool.

If the connection drops, lophn retries the same setup a limited number of times.
A rejected sign-in is not retried. Removing a server blocks new calls
immediately. An effect that already happened is not described as canceled.
