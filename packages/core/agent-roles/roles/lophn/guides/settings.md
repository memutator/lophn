# Settings

Settings is the screen for product settings, connections and diagnostics. Asking
what a setting means does not change it.

## What an explanation uses

For a setting you ask about, lophn reads the public definition and the current
effective value with `settings.get`. It explains only what those records
contain:

- the label and description from the definition
- what the value means, and what the built-in default means
- which features the setting affects, and the risk of changing it
- how you can change it back
- the allowed values, taken from the definition constraints
- whether a value is present, and whether the effective value is resolved
- the source: the built-in default, or your own choice
- when a change takes effect: the next time work starts, the current check, or
  the next call

If the effective setting is not resolved, lophn says so. It does not fill in a
default and call that your choice. Unknown cost, usage or account details stay
unknown. They are not shown as zero or as free.

## How a change is made

You change settings yourself in Settings. An agent cannot change a setting
through a tool. If you ask an agent to change one, it tells you where to change
it and what value it would suggest.

## What Settings cannot do

Settings does not accept a pasted secret, API key, token or password. Those go
through the protected field described in Connections. A recommendation, a
free-text reply, silence or closing a window is never a change.
