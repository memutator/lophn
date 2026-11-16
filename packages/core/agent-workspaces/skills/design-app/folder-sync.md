# Apps whose data reaches the person's other computers

Read this before you set `sync_to` in `lophn.ts`, before you set up a sync folder
or the tool that moves it, and when `lophn machine environment` shows an error.
`sync_to` names a destination: a folder on each computer. lophn writes the app's
changes, releases and source into that folder and reads what the other computers
wrote there. lophn does not move the folder. A tool the person runs (Syncthing,
rclone) does, and you set that tool up with the person. lophn has no code, setting
or credential for any storage service, and you never put one into lophn.

## Pick `sync_to`

The default is no `sync_to`: the data stays on this computer (and on the phone, for
a `runs_on` phone app). Choose the default unless the person uses this app on
another computer too, or the data must exist on another machine.

1. Run `lophn machine environment`. Note `this_machine`, the other `machines`, the
   `destinations` this computer has (name, path, state) and the `available` apps.
2. Search this workspace's memory for what the person told you about their setup:
   which computers they have, which cloud they use, which sync tool already runs
   (Syncthing, Drive, Dropbox, a NAS). Ask one short question only if you find
   nothing.
3. Decide per app, not once for the person:
   - Do not send sensitive data (health, money, private notes) out unless the
     person asks: leave `sync_to` out, or use a destination that stays on the
     person's own machines.
   - Every table of the app's store goes to the destination. State that belongs to
     one machine (window layout, a local path, the last opened file) does not go in
     the store: keep it in `localStorage`.
   - Secrets never go in the store. Use `@lophn/cap-secret`; the person enters
     them again on each computer.
4. Use the name of a destination that already exists if it fits. A new name is
   short and means something to the person (`personal`, `work`), and it is the
   same name on every computer: the path behind it may differ per computer.

Write the choice and the reason in DESIGN.md (Model): which data goes where, which
tool moves it, whether it is encrypted.

## What syncing asks of the app

An app with `sync_to` is a sync app on the computer: every computer that has the
app writes rows and the copies are merged per column. Follow the "Data" section of
`phone-apps.md`; release preparation refuses an app that breaks the first two
rules:

- Text ids made with `newId("ord")` from `@lophn/cap-store`. No `INTEGER` primary
  key, no `AUTOINCREMENT`, no trigger, no `UNIQUE` or `CHECK` outside the primary
  key. Two computers that hand out the same number lose a row.
- `@lophn/cap-store` 2.0.0 or later in `sdk_dependencies`.
- Never rename or drop a table or a column, and never change primary key values in
  a migration.

Know and design for these:

- When two computers change the same column of the same row, the later write wins
  and nobody is told. Use separate columns for separate fields, or a new row
  instead of editing a shared one.
- Changes apply only between computers that run the same release of the app. A
  change from another release waits on this computer, not lost, until this
  computer runs that release. After you activate a new release on one computer,
  activate it on the others too (see "Bring an app to another machine").
- Keep the app's data well under 1 GiB: a larger store cannot go to the folder.

## Set up a destination on this machine

A destination is the setting `folder.destinations`: a name mapped to an absolute
local path, on this computer only. Only the person sets, changes or removes it,
because it starts sending their data out of lophn. If `lophn machine environment`
already shows a destination of that name with state `ok`, skip this section.

1. Explain first, in plain words, before anything asks the person:
   - which app's data, and what it is ("your recipes and shopping lists"),
   - which folder on this computer it is written to (the full path),
   - which tool moves that folder, and to where: which computers, which cloud,
   - whether it is encrypted on the way and where it is stored.
2. Choose the path with the person. Rules (the setting refuses the first two):
   - an absolute path, not inside lophn's data folder (`~/.lophn`, or the folder
     `LOPHN_HOME` names), and not a folder that contains it,
   - not inside another destination,
   - never put lophn's data folder itself on shared storage (a Syncthing, Drive,
     Dropbox or network folder), and never copy it to another computer. Its live
     database breaks under a sync tool, and a copy runs as a second lophn that
     writes as the same machine.
3. Create the folder (`mkdir -p <path>`).
4. Read the current value with `lophn settings get folder.destinations`. The value
   is the whole map, so keep every name already there:

   ```
   lophn settings set folder.destinations '{"personal":{"path":"/home/me/Sync/lophn"}}'
   ```

   The person sees an approval card with the name and the full path ("Add sync
   folder "personal": /home/me/Sync/lophn") and allows that one change. If they
   reject it, nothing changes. To change a path or remove one name, set the map
   with the new path or without that name; it asks the same way.
   `lophn settings unset folder.destinations` removes every destination.

Where it runs:

- `lophn settings set` works only in lophn's home conversation. In an app
  workspace, give the person the explanation and the exact command, and ask them
  to run it in their own terminal or to ask lophn at home.
- A job or an unattended run cannot ask; the change is refused. Leave it for the
  person.
- A coding agent outside lophn (in a terminal) cannot ask either; it is refused
  with `needs_approval`. The person runs the command in their own terminal, which
  is never asked.
- There is no Settings screen for destinations yet. The person's own way is
  `lophn settings set` in their terminal.

Every other computer needs a destination of the same name, set there by the person
or that computer's lophn agent. A computer without it neither sends nor reads the
app's data.

## Move the folder with a tool

lophn only writes files into the folder and reads them. Pick the tool in this order:

1. **Syncthing**, when the person's computers reach each other (same network, or
   Syncthing's relays). It moves files directly between the person's devices,
   encrypted on the way, and stores them only on those devices. It moves files only
   while two devices are on at the same time; if the computers are rarely on
   together, add an always-on device of the person's (a NAS, a home server) to the
   same Syncthing folder, or use a cloud.
2. **rclone with a `crypt` remote**, for a cloud. The cloud stores only encrypted
   files. Google Drive, Dropbox, OneDrive and S3 are all rclone remotes: put the
   `crypt` remote on top of one of them.
3. **A network share the person owns** (a NAS mounted on each computer): the
   destination is a folder on the mount and no tool runs. Use a subfolder of the
   mount, so an unmounted share shows as `destination_missing` instead of being
   written to the local disk.
4. **A cloud folder that does not encrypt** (Google Drive for desktop, the Dropbox
   or OneDrive app): not by default. Use it only after you say, in plain words,
   "the files in this folder are uploaded to Google unencrypted, and Google can
   read them" (name the service), and the person accepts that.

Never send the person's data to a cloud without encryption unless they accepted it
as in 4.

Who does what:

- The person installs the tool, logs in to the cloud, and pairs devices (accepts a
  Syncthing device id) on each computer. You prepare the commands, say which
  button to press, and check the result. Never ask for a password, a token or a
  pairing code in the chat.
- The `crypt` password and salt are chosen by the person and typed by the person
  into `rclone config` on each computer. Tell them to keep the password somewhere
  safe: without it the cloud copy cannot be read.

### Syncthing

Share the destination folder itself as one Syncthing folder ("Send & Receive") on
every computer, each at its own destination path. Syncthing starts at login when
the person installs it as a user service or with the OS's autostart; check that it
does. No schedule is needed.

### rclone

rclone does not watch the folder, so run it from the OS's scheduler every few
minutes (5 is fine): a systemd user timer on Linux, a launchd agent on macOS, Task
Scheduler on Windows. Do not let two runs overlap (each of those schedulers waits
by default). Do not use `rclone bisync`. Run two commands, upload then download:

```
# upload this computer's own part; files lophn removed are removed in the cloud too
rclone sync "<path>/machines/<this machine id>" "<remote>:machines/<this machine id>" --exclude "*.tmp-*"
# download the other computers' parts; never touch this computer's own part
rclone copy "<remote>:machines" "<path>/machines" --exclude "/<this machine id>/**" --exclude "*.tmp-*"
```

`<remote>` is the `crypt` remote, `<path>` the destination path on this computer,
and `<this machine id>` is `this_machine.id` in `lophn machine environment`
(`mch_…`). lophn writes only under `machines/<its own id>/` and never removes
another computer's files; the upload touches only this computer's part and the
download every part but this one. Run the upload only when
`<path>/machines/<this machine id>/record.json` exists, so a missing or unmounted
folder never empties the cloud copy. Put both commands in one small script that the
timer runs.

### Check it

Try it on this computer first: run the tool once by hand and see it finish. Then,
after the tool has run on another computer too, `lophn machine environment` here
lists that computer in `machines` and the destination's `machines` count is above
zero. If not, read "Read the state".

## Bring an app to another machine

On the other computer, after its destination of the same name is set and the tool
has run there:

1. `lophn machine environment` lists the app in `available`.
2. In lophn's home conversation: `lophn app take-in <app>`. The app gets the same
   id, and the release is the exact bundle the first computer built. It lands
   prepared; nothing runs yet.
3. In the app's workspace: `lophn release activate <release>`. The person agrees on
   that computer: permissions, grants and secrets are asked again there; nothing of
   them is copied.

If take-in answers `conflict` with `sdk_missing`, or the environment shows
`newer_format`, that computer's lophn is older: ask the person to update it first.
`slug_in_use` means another app there has the slug; tell the person.
`release_incomplete` means the release files have not fully arrived; wait for the
tool and try again.

For a new release: activate it on the first computer, then on each other computer
run `lophn app take-in <app>` again (it installs only the new release) and activate
it there. Until then that computer holds the new changes and does not lose them.

The other computer's source arrives in the app's repository as
`refs/remotes/<machine id>/*` and is not merged. Before you change the app on this
computer, merge the other computer's branch if it is ahead, so two computers do not
build diverging releases.

## Tell the person

Say it in their words, once, when you set `sync_to` or set up a destination:

- what goes where: which app's data, to which folder, moved by which tool, to which
  computers or cloud, and whether it is encrypted;
- it is not live: changes arrive as fast as the tool moves the folder (lophn writes
  a few seconds after a change and reads within minutes);
- what they write on the phone reaches other computers only through a computer it
  is paired with, and only while that computer is on; the phone does not use the
  folder;
- every computer must run the same release of the app; until it does, its changes
  wait and nothing is lost;
- agent definitions, skills, settings, secrets and provider keys stay on each
  computer and are not synced;
- a computer whose clock runs more than 5 minutes ahead has its changes wait until
  the clocks agree.

## Away too long

`apps[].away` in `lophn machine environment`, or the notice "This app was away
from your other computers too long", means this computer did not catch up with the
others for more than 90 days for that app. The others have cleaned up the records
of rows they deleted, so some of this computer's changes could bring deleted rows
back. Those changes are held on this computer: not sent, not applied, not lost.

1. `lophn app sync-held <app> list` shows each held change: its `seq`, where it came
   from, and the table, kind and time of each row it touches.
2. Show the person each change in their words and let them decide, one by one:
   - still right: `lophn app sync-held <app> apply <seq>` writes it again now, as a
     new write on this computer that goes to the others;
   - not wanted: `lophn app sync-held <app> discard <seq>`.
3. Never choose for the person.

A computer the person no longer uses holds back that cleanup for the others. The
person can remove it from a computer's list with `lophn machine forget <machine>`
in their own terminal. If that computer writes to the folder again, it comes back.

## Read the state

`lophn machine environment` is what lophn last read and wrote, not live. Each
`export` and `imports[]` entry has an `error` with a `code`:

- `destination_missing`: the folder is gone, moved or not mounted, or the tool
  removed it. Check the path; if the person moved it, change the destination (with
  their approval).
- `not_writable`: lophn cannot write the folder. Fix its owner or permissions.
- `foreign_writer`: this computer's part of the folder holds a file it did not
  write. Two computers probably run copies of the same lophn data folder. Export of
  the app stops. Tell the person; once the copy no longer writes there, the person
  runs `lophn app sync-resume <app>` in their own terminal.
- `invalid_file`, or `waiting_for` set: the tool has not finished moving a file.
  Wait for the next run. If it stays, check that the tool runs on both computers and
  that nothing else changes the files.
- `release_incomplete`: the release files have not fully arrived. Wait.
- `clock_ahead`: the clock of `details.machine_name` is ahead (`details.ahead_ms`).
  Tell the person which computer and ask them to set its clock (automatic time).
  The changes wait, nothing is lost.
- `newer_format`: the other computer's lophn is newer. Update lophn on this one.
- `imports[].held` above zero: files from another release of the app wait here.
  Run the same release on every computer.
- `too_large`: the app's data is over 1 GiB, or its source is too large. Keep large
  files out of the store.
- `app_not_running` or `apply_failed`: the app could not take the changes. lophn
  retries, waiting up to an hour between tries. Check that the app's release is active
  here and read its log.
- `away_too_long`: see "Away too long".
- `source_failed`: git failed or is missing. Data still moves; install git or tell
  the person.
