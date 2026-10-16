# Instructions

Instructions are the Markdown notes lophn's own agents read. They are not the
AGENTS.md file a coding agent uses. lophn does not read AGENTS.md.

## Layers

There are four layers, in this order:

1. The built-in instructions of the agent's role. lophn fixes these and they
   change only when lophn updates.
2. The global instructions, which you edit in Settings. They apply to every
   agent.
3. The project instructions, the `LOPHN.md` file in the project folder, which
   you edit in the project window. An agent placed in the project reads it as
   part of its prompt. lophn, which is not placed in a project, reads it with a
   tool when it works on that project.
4. The agent's own instructions, which you edit on the agent's settings screen.

There are no instructions for an app. A later, narrower note makes an earlier
note more specific. It does not override the product rules or your current
request.

## When a change is read

A turn uses the instructions it started with. When you edit an instruction, the
next turn that starts is told "instructions changed" and receives the new text
at the end of the conversation. When a conversation is compacted, the newest
instructions are used.

You edit and save; an agent cannot create or save an instruction file without
your permission. If the file changed outside the editor, the save is a conflict
and the outside edit is not overwritten.

Instructions cannot widen access, skip a decision or raise a product limit.
