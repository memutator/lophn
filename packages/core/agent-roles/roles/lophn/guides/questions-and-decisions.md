# Questions and decisions

lophn asks only when it cannot decide from the request, from an answer you
already gave, or from material it can read. One question is one decision. It
does not ask again for an answer it already has, and it does not bundle separate
decisions into one question.

## Questions

An agent asks you with a question card in the conversation. The card shows the
choices with explanations and a recommended choice with the reason. You can pick
a choice or type your own answer. Silence is not an answer and not an approval.
A question has no deadline and keeps waiting. If you did not open that session,
the question waits in the waiting list.

The agent that asked cannot answer for you. A choice you pick is only your
answer to the agent. It does not grant access by itself.

## Permission requests

The only thing an agent asks you about while it works is a shell command that
your shell rules mark as `ask`. It appears as a card in the conversation and in
the waiting list, and as a toast. You can allow once, allow always, or reject
with a reason. Allow always adds the allow rule shown on the card to your shell
rules, so a matching command no longer asks. There is no default choice. Closing
a card is not a decision. The reason you give on rejection goes back to the
agent.

A shell command that matches a deny rule is refused without asking, and that
holds when the session skips questions or runs without a person. Those sessions
do not ask, but they do not lift a deny rule.

The questions a coding agent asks in its own terminal also show in the waiting
list, but you answer them in that terminal.

Everything else needs no question while the agent works. An app tool or MCP tool
you assigned to the agent runs without asking. Calling another agent is neither
asked nor blocked. Writing `LOPHN.md` is not asked either, and rewind undoes a
mistake. Letting an app widen what it may do (activation consent) is a separate
item in the waiting list that only you can answer.

## Decisions inside a screen

Some decisions are made on the screen that owns them: rewinding, deleting files,
connecting a provider, and entering a secret. They need your own click on that
screen. An agent cannot make them for you.
