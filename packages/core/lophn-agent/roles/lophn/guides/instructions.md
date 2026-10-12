# Instructions

Instructions are the Markdown notes lophn's own agents read. They are not the
AGENTS.md file a coding agent uses. The button label is [Instructions]. The file
path and internal version identifiers stay out of the normal screen.

## Where you edit

There are three layers. The global file is the one for this installation. A
project file belongs to that project. An app file belongs to that app. Settings
opens the global file. The project workspace opens the project file. App detail
opens the app file. Each opens in the lophn editor. If the file does not exist
yet, you see an empty draft. The file is created only when you save it the first
time.

You write Markdown and save. If the file changed outside the editor, the save is
a conflict and the outside edit is not overwritten. Restoring an older version
writes a new version after the same check. It is not a silent overwrite. An
agent can propose a change as a question. It cannot create the file, save it, or
change where it is connected. You edit and save, or you do not.

## What the next call reads

Each role reads the layers for its current working place, in order: global, then
project, then app, then any Instructions attached to the Preset. A later,
narrower note makes an earlier note more specific. It does not override the
product rules or your current request. App Engineer uses the app it is
responsible for. Operator uses the project or app it is attached to. lophn and
Context Engineer keep the place where you opened the conversation until you
explicitly change that place. Switching the tab you are looking at does not
change it.

The text is read again immediately before each call. A change to the file is
picked up on the next call of work already in progress. A change to which
Instructions a Preset includes is a new Preset version and applies the next time
work starts. One file can be up to 32 KiB. All instruction text for one call can
be up to 128 KiB. If a file is larger, cannot be decoded, or exists but cannot
be read, that call stops and you are told why. The file is not trimmed and then
sent as if it were complete. A missing file and a file that failed to read are
not treated as the same thing.

Instructions cannot widen access, skip a decision, or raise a product limit. A
LOPHN file found inside some other material is not promoted into the
instructions for the current place.
