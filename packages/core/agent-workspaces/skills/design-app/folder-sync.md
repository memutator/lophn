# Apps whose data reaches the person's other computers

Read this before you set `sync` in `lophn.ts`, before you build a screen that
shows another computer's data, before you set up a sync folder
or the tool that moves it, and when `lophn machine environment` shows an error.
`sync` lists the tables of the app's store that leave this computer, each with a
destination: a folder on each computer. lophn writes the changes of those tables
and the app's source into that folder and reads what the other computers wrote
there. A table that `sync` does not list never leaves this computer. There are two
kinds of destination:

- `computers` ("my computers"): the computers in the person's device list. lophn
  keeps this folder itself and picks how its files travel: a direct link between
  the computers, the paired phone carrying them, or a folder all the person's
  computers see that the person added in Settings. Nothing to set up. A computer
  that is always on carries the files of the others, so two computers that are
  never on together still meet through it.
- A named destination (`personal`, `work`): a folder the person set up themselves
  on each computer. lophn does not move it. A tool the person runs (Syncthing,
  rclone) does, and you set that tool up with the person.

lophn has no code, setting or credential for any storage service, and you never
put one into lophn.

## Two needs that look alike

Decide which one the person has before you touch `sync`:

- **See or use what is on another computer right now.** Examples: how many
  resources the agents on my server use, each computer's own logs or harness
  records. This is not sync. The person can open that computer's app from their
  window: it draws the same screen with that computer's data. An app can also call
  the other computer's commands with `connectCommands(app, commands, { on })`
  (`@lophn/cap-tool`), with the list of computers from `useMachines()`
  (`@lophn/app-ui`) or `machines()` (`@lophn/cap-tool`) and a `MachineSelector`
  (`@lophn/ui`) to pick one. It needs that computer to be on. Use the roster API:
  never read lophn's data folder or guess "this computer" from the hostname.
- **Have the same data on every computer, also while the other one is off.** This
  is `sync`, for the tables that hold that data.

Data that describes one computer (raw logs, file offsets, process state) stays in
tables you do not list. When the screen needs another computer's numbers while it
is off, keep a small summary table and list only that one.

## Pick the tables and the destination

The default is no `sync`: every table stays on this computer (and on the phone, for
a `runs_on` phone app). Choose the default unless the person uses this app on
another computer too, or some of its data must exist on another machine. The
default does not stop the app from reaching the other computers: see "Bring an app
to another machine".

1. Run `lophn machine environment`. Note `this_machine`, the other `machines`, the
   `destinations` this computer has (name, path, state) and the `available` apps.
2. Search this workspace's memory for what the person told you about their setup:
   which computers they have, which cloud they use, which sync tool already runs
   (Syncthing, Drive, Dropbox, a NAS). Ask one short question only if you find
   nothing.
3. Decide per table, not once for the app:
   - List a table when the person needs its rows on the other computers: what they
     write by hand (notes, plans, settings of the app they expect everywhere) and
     small summaries the other computers show.
   - Leave a table out when it describes this computer or can be rebuilt here: raw
     records read from local files, file read positions, caches, large imports.
     Leaving out a large raw table is what keeps the synced data small.
   - Do not send sensitive data (health, money, private notes) out unless the
     person asks: leave its table out, or use a destination that stays on the
     person's own machines.
   - State that belongs to one machine (window layout, a local path, the last
     opened file) does not go in the store at all: keep it in `localStorage`.
   - Secrets never go in the store. Use `@lophn/cap-secret`; the person enters
     them again on each computer.
4. Pick `"computers"` first as the destination. Use a named destination only when
   the person set one up for this kind of data (it shows in `destinations`) or
   asks for one. A new name is short and means something to the person
   (`personal`, `work`), and it is the same name on every computer: the path
   behind it may differ per computer. For now every listed table goes to the same
   destination.

```ts
// lophn.ts
sync: {
  usage_hour: "computers",
  plan: "computers",
},
```

When a migration adds a table, add it to `sync` only if it must leave this
computer. Removing a table from `sync` keeps its rows here; the rows the other
computers already received stay there.

Write the choice and the reason in DESIGN.md (Model): which tables go where, which
stay on each computer, which tool moves them, whether it is encrypted.

## What syncing asks of the app

An app whose `sync` lists a table is a sync app on the computer: every computer
that has the app writes rows to the listed tables and the copies are merged per
column. The rules below apply to the listed tables only (for a `runs_on` phone app,
to every table, because the phone keeps the whole store). Follow the "Data"
section of `phone-apps.md`; release preparation refuses an app that breaks the
first three rules:

- Text ids made with `newId("ord")` from `@lophn/cap-store`. No `INTEGER` primary
  key, no `AUTOINCREMENT`, no `UNIQUE` or `CHECK` outside the primary key. Two
  computers that hand out the same number lose a row.
- No trigger on a listed table: a change from another computer applies to it and
  fires the trigger again. A trigger on a table you did not list may write to a
  listed table (it runs once, on the computer that wrote, and what it wrote is
  sent). A listed table must not reference a table you did not list (the other
  computers have no such parent row). A table you did not list may reference a
  listed one, without `ON DELETE` or `ON UPDATE` `CASCADE`, `SET NULL` or
  `SET DEFAULT` (changes from another computer do not run them).
- Every table listed in `sync` exists in the store and has a primary key, and
  `@lophn/cap-store` 2.0.0 or later is in `sdk_dependencies`.
- Never rename or drop a table or a column, and never change primary key values in
  a migration.

Know and design for these:

- When two computers change the same column of the same row, the later write wins
  and nobody is told. Use separate columns for separate fields, or a new row
  instead of editing a shared one.
- Rows that each computer makes from its own source (an hourly rollup of this
  computer's records) must carry the computer's id in the primary key, for example
  `(machine, hour)`. Read the id from `machines()` (`@lophn/cap-tool`, the entry
  with `current: true`). Without it, two computers write the same key and each
  overwrites the other's numbers column by column.
- Changes apply only between computers that run the same release of the app. A
  change from another release waits on this computer, not lost, until this
  computer runs that release. The other computers that have the app follow a new
  release by themselves (see "Bring an app to another machine").
- Keep the listed tables well under 1 GiB: a larger copy of them cannot go to the
  folder. Tables you did not list do not count.

## Know when data changed

lophn applies the changes that come from the person's other computers and from
the phone. The app is not called for them; instead it gets the `lophn` event
`data.changed` (payload `{}`) once after each batch is applied. It does not say
what changed: read again what you show or hold.

```ts
// lophn.ts
subscriptions: [{ source: "lophn", event: "data.changed" }],
// app process (@lophn/cap-tool)
subscribe("lophn", "data.changed", async () => { /* refresh caches */ });
// screen (@lophn/app-ui or @lophn/app-ui-native)
useEvent("lophn", "data.changed", () => void reload());
```

An event the app publishes stays on this computer unless its declaration says
`across_machines: true` (allowed only when `sync` lists a table). Such an event travels with
the app's data and fires once on every other computer that runs the same release,
with the same payload, to the same subscribers and screens. It can arrive late;
one older than 7 days does not fire. When the person made the app's workspace
private on a computer, that computer neither sends its events nor fires the ones
that arrive. Do not mark an event only to tell other computers the data changed:
`data.changed` does that.

## Set up a destination on this machine

Skip this section for `computers`: it needs no setting. A named destination is
the setting `folder.destinations`: a name mapped to an absolute
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
- The person can also add, change or remove a folder themselves in Settings ›
  Sync, or with `lophn settings set` in their own terminal.

Every other computer needs a destination of the same name, set there by the person
or that computer's lophn agent. A computer without it neither sends nor reads the
app's data.

## Move the folder with a tool

For a named destination, lophn only writes files into the folder and reads them.
Pick the tool in this order:

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

An active app that is not in a `private` workspace reaches the person's other
computers without `sync`: its source and releases travel through `computers`,
and `lophn machine environment` there lists it in `available`. Only its data and
`across_machines` events need `sync`; without it each computer keeps its own
data. Do not set `sync` just to install the app elsewhere.

On the other computer:

1. `lophn machine environment` lists the app in `available`. For a named
   destination, its destination of the same name must be set and the tool must
   have run there first; `computers` needs neither.
2. In lophn's home conversation: `lophn app take-in <app>`. The app gets the same
   id, fetches the app's source commits from the other computer's source bundles,
   and builds and prepares the release natively on this computer. It lands
   prepared; nothing runs yet.
3. In the app's workspace: `lophn release activate <release>`. The person agrees on
   that computer: permissions, grants and secrets are asked again there; nothing of
   them is copied.

If take-in answers `conflict` with `sdk_missing`, or the environment shows
`newer_format`, that computer's lophn is older: ask the person to update it first.
`slug_in_use` means another app there has the slug; tell the person.
`source_incomplete` means the source bundles for that commit have not fully
arrived; wait for the tool (for `computers`, for the link or the carrying computer)
and try again.

For a new release, activate it on one computer only. Every other computer that has
the app installs and activates it by itself once its files arrive (`apps[].follow`
in `lophn machine environment`, see "Releases between computers"). The person is
asked there only when the release asks for more than the one before. Until then
that computer holds the new changes and does not lose them.

The other computer's source arrives in the app's repository as
`refs/remotes/<machine id>/*` and is not merged. Before you change the app on this
computer, merge the other computer's branch if it is ahead, so two computers do not
build diverging releases.

## Tell the person

Say it in their words, once, when you set `sync` or set up a destination:

- what goes where: which of the app's data, to which folder, moved by which tool,
  to which computers or cloud, and whether it is encrypted; and what stays on this
  computer only;
- it is not live: changes arrive as fast as the files travel (with `computers`,
  soon while the computers are connected, otherwise when the phone or the shared
  folder carries them; with a named folder, as fast as the tool moves it);
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

`away` stays set while any of those changes is held: `away.held` counts them and
`away.changes` lists the table, kind and time of each. `away.since` is when the
computer fell behind; it is null once the computer caught up but held changes
remain. They still wait for the person, and while they do this computer sends no
full copy of the app's data (see `away_too_long` below).

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
`apps[]` entry has `sends_to`, the destination its `sync` names (null when no table
leaves this computer), and `destination`: `set`, or `not_set_here` when this
computer has no destination of that name. Each `export` and `imports[]` entry has
an `error` with a `code`:

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
- `clock_ahead`: the clock of `details.machine_name` is ahead (`details.ahead_ms`).
  Tell the person which computer and ask them to set its clock (automatic time).
  The changes wait, nothing is lost.
- `newer_format`: the other computer's lophn is newer. Update lophn on this one.
- `imports[].held` above zero: files from another release of the app wait here.
  Run the same release on every computer.
- `too_large`: the listed tables are over 1 GiB, or the source is too large. Keep
  large files out of the store, and large per-computer tables out of `sync`.
- `app_not_running` or `apply_failed`: the app could not take the changes. lophn
  retries, waiting up to an hour between tries. Check that the app's release is active
  here and read its log.
- `away_too_long`: see "Away too long".
- `source_failed`: git failed or is missing. Data still moves; install git or tell
  the person.

### Releases between computers

For an app whose `sync` lists a table, each `apps[]` entry also shows how the computers stand
on its releases (an app without it has `follow: null` and empty `held` and
`machines`). While anything waits, the app keeps running on this computer's data.

- `machines`: each computer that exchanges this app, with the release it runs
  (`release.number` is its `r<n>` when this computer has that release too,
  `code_commit`, `data_schema`), its lophn version and `exchange`.
- `follow.state`: this computer following the release the others run.
  - `current`: nothing to follow. `installing`, `activating`: under way, wait.
  - `waiting_consent`: the release asks for more than the one before. The person
    allows it on this computer in its approval card; tell them which app and what
    it asks.
  - `declined`: the person refused it here. This computer stays on its release and
    the newer release's changes wait. Do not ask again on your own.
  - `lophn_update`: this computer's lophn is too old for that release. Ask the
    person to update lophn here.
  - `install_failed`, `activation_failed`: read `follow.reason` and the app's log.
    This computer keeps its release. If the cause is in the app, fix it, then build
    and activate a new release on one computer; the others follow it.
  - `diverged`: two computers built releases apart. Merge the other computer's
    branch (`refs/remotes/<machine id>/*`) into this one, build a release and
    activate it; every computer follows it.
- `held`: changes from another release that wait here, one line per computer and
  release, with `changes` and `why`:
  - `newer_release`: applied once this computer runs that release (`follow`).
  - `older_release`: that computer runs an older release; its changes come when it
    follows.
  - `diverged`: they come after the merged release (see `diverged` above).
  - `full: true`: more of them wait in the folder; they come the same way.
- `exchange` (on each of the top `machines` and in `apps[].machines`): `ok`;
  `update_this`: this computer's lophn is too old to read that computer's files,
  ask the person to update lophn here; `update_peer`: that computer's lophn is too
  old, ask the person to update it there. Until then nothing from that computer is
  read, and nothing is lost.
