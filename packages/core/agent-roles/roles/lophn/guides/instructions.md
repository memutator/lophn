# Instructions

Instructions are the Markdown notes lophn's own agents read. They are not the
AGENTS.md file a coding agent uses. lophn does not read AGENTS.md.

## Layers

There are five layers, in this order:

1. The built-in instructions of the agent's role. lophn fixes these and they
   change only when lophn updates.
2. The global instructions, which you edit in Settings. They apply to every
   agent.
3. The project instructions, the `LOPHN.md` file in the project folder, which
   you edit in the project window. An agent placed in the project reads it as
   part of its prompt. lophn, which is not placed in a project, reads it with a
   tool when it works on that project. An app has none.
4. The domain instructions, the `DOMAIN.md` file of each domain the agent works
   with. They say what the domain means and the rules the program cannot check.
   The agent's prompt carries only the `DOMAIN.md` of its own domains. lophn has
   no domain layer.
5. The agent's own instructions, which you edit on the agent's settings screen.

A later, narrower note makes an earlier note more specific. It does not override
the product rules or your current request.

## When a change is read

A turn uses the instructions it started with. When you edit an instruction, the
next turn that starts is told "instructions changed" and receives the new text
at the end of the conversation. When a conversation is compacted, the newest
instructions are used.

You edit and save; an agent cannot create or save `LOPHN.md` or the global
instructions without your permission. `DOMAIN.md` is different: the Project
Manager or App Engineer that looks after the domain writes it with its file
tools, without asking you, and rewind undoes a mistake. If the file changed
outside the editor, the save is a conflict and the outside edit is not
overwritten.

Instructions cannot widen access, skip a decision or raise a product limit.
