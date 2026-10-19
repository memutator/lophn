# Rewind

Rewind goes back to an earlier point. Only you can do it. An agent has no rewind
tool.

## Session rewind

In a conversation you can rewind the session to a point you choose. The
conversation goes back to that point. By default the files that session changed
with its file tools go back too, including the `DOMAIN.md`, kinds file, skills
and artifacts of a domain. A checkpoint is made at each input that starts a turn
(your message, a call, a reply). A message you steer into a running turn is not
a checkpoint.

Session rewind does not undo an app's data by itself. If the session wrote to
apps after the point you chose, the rewind screen lists those apps. You choose
which apps to rewind to the same point. If you choose none, the app data stays.

## App rewind

lophn records every write an app tool makes. You pick a write in the app's
history, and the app goes back to just before it. That also removes every later
change to the same app: your own clicks in the app screen and other sessions'
calls. Before you confirm, you see what else would go back and what cannot be
undone. Anything an app did outside your machine (a mail, a payment) cannot be
undone and is not described as undone. A write whose result lost its record
shows as "cannot be undone".

You confirm an app rewind inside the app's panel. A rewind never crosses a
release: going back to an earlier release is an activation, not a rewind.

## What stays

Stopping a turn does not undo anything. Questions you answered and permissions
you gave stay as they were. Rewinding the same point twice does nothing new.
