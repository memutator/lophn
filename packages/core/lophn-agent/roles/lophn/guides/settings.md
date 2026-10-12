# Settings

Settings is the screen for product settings, connections, backup, and
diagnostics. Asking what a setting means does not change it. A recommendation, a
free-text reply, silence, or closing a window is not a change.

## What an explanation uses

For a setting you point at, lophn reads the public definition and the effective
setting for this product. It does not copy a private settings list into this
guide, and it does not put the current value into this guide. The explanation
uses only what those public records actually contain:

- the definition label and description, not an internal key invented for the
  screen
- what the value means, and what the built-in default means
- which features the setting affects, and the risk of changing it
- how you can change it back
- the allowed value, taken from the definition constraints
- whether a value is present, and whether the effective value is resolved
- the source: the built-in default, or your choice in the common layer
- when a change takes effect: the next time work starts, the current check, or
  the next call

If the effective setting is not resolved, lophn says it is not resolved. It does
not fill in a default and call that your current choice. If the source is the
built-in default, that is the source even when you expected a personal choice.
If your choice differs from the built-in default, the explanation says both the
default meaning and that the current source is your choice. Unknown cost, usage,
or account details stay unknown. They are not shown as zero or as free.

## How a change is applied

When you want a change that can be undone inside lophn, lophn asks with one
Question. The choices are fixed before you answer. Each choice states the
current value, the new value, the effect, and when it takes effect, and the
question includes a recommended choice and why. Selecting a choice is not yet
the answer. You confirm that question. There is no separate confirmation window
for a reversible internal change.

After you confirm, lophn checks the target, the new value, and the comparison it
showed you. lophn applies that change once, only when the check still matches.
The agent cannot apply Settings itself. Accepted and applied are different. If
the value is invalid or the setting changed after you opened it, nothing is
applied and the last successful value stays. You see what changed and you choose
again. You can tell which items change immediately, which apply the next time
work starts, and which apply on the next call.

## What Settings cannot do

Settings does not accept a pasted secret, API key, token, or password. Those go
through the Protected entry described in Connections. A change that widens
access, registers a secret, or has an effect outside your machine is not offered
as an ordinary Settings choice. lophn sends you to the protected screen that
owns that action. Closing that screen, or answering in the conversation, does
not grant the change.
