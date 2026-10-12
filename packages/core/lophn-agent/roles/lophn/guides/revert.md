# Revert

Revert is for one piece of agent work that has ended: it finished, it failed, or
it stopped. You ask for it. The agent cannot revert for you, and revert does not
start that work over.

## Before anything changes

Stop work that is still in progress or waiting on you, and wait until it has
actually ended. Stopping alone does not undo a change that already happened.
Before applying revert, lophn checks every confirmed change against its current
version, its relationships, and your access. You see, for each change, whether
it can be restored, whether it cannot, which facts stay, and any conflict, with
the reason.

If a later change conflicts, or restoring would break a relationship, nothing is
restored. If a change cannot be restored and is mixed with changes that can,
revert stops unless you explicitly accept what will remain. Even then, only the
safe independent changes that can be restored are applied. All of those are
included. Revert does not drop some of them quietly. A conflict that appears
after you opened the review is not ignored.

## What restore means

lophn leaves a restored new Version. A document keeps a new Version with the
earlier content. It does not erase history or move the current version backward.
An app change that supports restore is reversed through that app's own restore
action, using the record of the original call and the current state. Questions
you answered, decisions you made, and recorded usage stay as they were.

The same revert applies once. What already left your machine, a secret that was
used, and a change made by someone else are not described as undone. If only
some changes can be restored, the result is not described as fully restored. An
app restore and the product record are not one single all-or-nothing step. If a
call fails or its result is unknown, you see what was restored, what never
started, and what is unknown.

You can also export a local record. The default export is the description only.
Body text is included only when you choose it for that export, and only after
sensitive details are left out. Export does not use the network, and a failed
export does not change the original result.
