---
name: connect-computers
description: Help the person keep their apps' data and files in step across their computers (home and work, a dual boot, a laptop and a desktop) or reach a computer directly from outside their network. Explains what lophn does by itself (an always-on computer in the device list becomes the middle with no setup), installs on this computer an app that another computer shares, and sets up the folder all computers see and Tailscale only when they need more.
---

# Connect computers

Use this when the person wants what they have on one computer on another too,
or says things like "my work computer doesn't see my notes", "I dual boot", "I
want to reach my desktop from anywhere". Do not start by installing anything:
first find out what already works.

## What lophn does by itself

You set none of this up and nothing chooses between these ways:

- Computers in the person's device list (`lophn remote devices`; Settings ›
  Remote) connect to each other over the local network or through lophn's relay,
  and an app that declares `sync_to: "computers"` has its data carried over that
  connection while both are on.
- A connected computer also passes on the files of the person's other computers
  that it holds. So a computer in the device list that is always on (a server, a
  VM, a desktop left running with Keep running) becomes the middle by itself:
  every other computer syncs with it whenever it connects, and two computers
  that are never on together (the two systems of a dual boot) still stay in step
  through it. No setup, no folder, no tool.
- A phone paired with two computers carries the files from one to the other when
  it connects to each. The computers need not be on at the same time.
- Releases of an app that arrive this way are taken in and wait for the
  person's OK, as usual.

The person sees the way each computer's files last arrived, and when each app
last caught up, in Settings › Sync. You can read the same facts with
`lophn machine environment` (the other computers and each app's `sync_to`).
Look there before you suggest anything.

Check before you propose any folder or tool: run `lophn machine environment` and
look at `machines[].always_on`.

- A computer in the list is `always_on: true`: say that nothing needs to be set
  up, and stop. Do not suggest a folder, a cloud, rclone, cron or Syncthing.
- None is, but the person has a computer that could stay on (a server, a VM):
  tell them to turn on Keep running in that computer's Settings › Remote ("Keep
  lophn running on this computer"). Once that computer shows `always_on: true`
  here, nothing else is needed.
- Only when there is no always-on computer and no phone that meets both
  computers does the shared folder below apply.

If the computers are not in one device list yet, that is the first step, and
Remote must be on (`lophn remote on`). The person makes an invite on one
computer (Settings › Remote, or `lophn remote invite computer`) and joins with
it on the other. For a computer that cannot be on at the same time (the other
system of a dual boot, a home and a work computer) use `--long`.

## When an app is on another computer but not on this one

Every non-private active app automatically shares its source and record across
the person's computers via `computers` (even when `sync_to` is off; in that case
its data stays local per computer). The person can install it here from Settings
› Sync ("Available from other computers") or from the app's row under that
computer in the sidebar ("Install on this computer"). When they ask you to do
it:

1. `lophn machine environment`. The app is installable when it is listed in
   `available` (with the computer it came from). If it is not there yet, the app
   may be private on that computer (when `sync_to` is off) or its files have not
   arrived yet: say which. Do not ask them to turn on data sync (`sync_to`) just
   to install the app unless they also want its data synced.
2. `lophn app take-in <app>` (`--from <machine>` when more than one computer
   offers it). It installs the app and prepares its release here; nothing runs
   yet. `conflict` says why in `details.reason`: `sdk_missing` (the person
   updates lophn here), `slug_in_use`, `dependency_missing`. `invalid_input`
   with `source_incomplete` means the files have not fully arrived; try again
   later.
3. Activation is done by lophn at the app, and that is where the person is
   asked. Send it with `lophn call send` (`to: {agent: "lophn", workspace: {app:
   "<the app's slug>"}}`, `--reply none`), asking it to run `lophn release
   activate <release>` with the release id `take-in` returned. The person sees
   the consent card there (first activation, new permissions) and allows it;
   you cannot allow it for them. Tell them in one line where the card is.

## When nothing is always on and no phone carries: a folder all of them see

When no computer is always on, no phone carries, and the computers are never on
at the same time (the two systems of a dual boot with no other computer are the
clear case), the person can name one folder that every computer sees. Each computer puts the files it carries there and takes in
the others' after checking their signatures, so the folder itself is not trusted.
It is the setting `folder.shared`, per computer: the path may differ on each.

Good folders:

- a disk both systems of a dual boot read and write (an exFAT or NTFS partition);
- a folder Syncthing moves between the computers (share it as "Send & Receive"
  on every computer; it needs two devices on at the same time, or an always-on
  device of the person's);
- a folder inside Google Drive for desktop, Dropbox or OneDrive.

Before anything asks the person, say in plain words:

- that lophn will copy everything the apps send to `computers` into this folder,
  as plain files: whoever or whatever can read the folder can read them, and with
  a cloud folder it sits in the cloud;
- for Google Drive, Dropbox or OneDrive: the files are uploaded unencrypted and
  the service can read them (name the service). Do it only if the person accepts
  that. Otherwise offer Syncthing or the shared disk, or tell them to keep that
  data off the folder;
- a cloud folder meant for only some of the data is not this setting. An app
  chooses a named destination (`sync_to: "<name>"`); that is the app agent's
  work, in that app's conversation.

Then:

1. Choose the path with the person: absolute, not inside lophn's data folder
   (`~/.lophn`, or the folder `LOPHN_HOME` names) and not a folder that contains
   it, and not inside any folder named in `folder.destinations`. Never put the
   data folder itself on shared storage and never copy it to another computer.
2. Create the folder (`mkdir -p <path>`). A mounted disk must be mounted first.
3. Read `lophn settings get folder.shared`, then in the home conversation:

   ```
   lophn settings set folder.shared '{"path":"/home/me/Sync/lophn"}'
   ```

   The person sees an approval card ("Use a folder all your computers see: …")
   and allows that one change. If they reject it nothing changes. To stop using
   it: `lophn settings unset folder.shared`; it asks the same way. The person can
   also do either in Settings › Sync, which needs no approval.
4. Repeat on the other computers, each with its own path. Files arrive as fast as
   the tool moves the folder, not live.
5. If a tool you set up moves the folder with rclone (cloud storage), follow
   these rules; they are the same as for any destination folder. Never use
   `rclone bisync`. Upload only this computer's own part with `rclone sync`,
   download the others' with `rclone copy` and leave this computer's part out
   (`<this machine id>` is `this_machine.id` in `lophn machine environment`):

   ```
   rclone sync "<path>/machines/<this machine id>" "<remote>:machines/<this machine id>" --exclude "*.tmp-*"
   rclone copy "<remote>:machines" "<path>/machines" --exclude "/<this machine id>/**" --exclude "*.tmp-*"
   ```

   Run the upload only when `<path>/machines/<this machine id>/record.json`
   exists, so a missing or unmounted folder never empties the cloud copy. Run
   both from one small script on the OS's scheduler every few minutes, never two
   runs at once. `<remote>` should be an rclone `crypt` remote when the person
   wants the cloud not to read the files.

`lophn settings set` for these approval settings works only in the home
conversation. Anywhere else, or when nothing can ask the person, tell them where
it is in Settings (Sync for the folder, Remote for the addresses) or give them
the exact command to run in their own terminal.

## When they should connect directly from anywhere: Tailscale

Without it, computers on different networks go through lophn's relay, which is
slower and has a size limit. Tailscale gives every computer a name that reaches
it from any network, and lophn uses such a name when it is told.

1. Install Tailscale on each computer and sign in (tailscale.com/download; on
   Linux `curl -fsSL https://tailscale.com/install.sh | sh`, then `sudo tailscale
   up`). The person signs in in their browser. Never ask for a password, a token
   or an auth key in the chat.
2. Read the computer's name with `tailscale status` (a MagicDNS name such as
   `studio.tail1234.ts.net`, or its 100.x address).
3. The name goes in the setting `remote.addresses`, one list per computer
   (without a port). The person can type it in Settings › Remote ›
   Addresses, which saves at once. Or set it yourself in the home
   conversation, after saying in plain words what it is (the addresses other
   devices try to reach this computer at). Read `lophn settings get
   remote.addresses` first and keep the entries already there:

   ```
   lophn settings set remote.addresses '["studio.tail1234.ts.net"]'
   ```

   The person sees an approval card ("Add address studio.tail1234.ts.net") and
   allows that one change; if they reject it nothing changes. Other devices pick
   the new address up on their next connection; nothing is paired again.

4. Check in Settings › Sync that the computer shows as connected directly instead
   of through the relay.

lophn does not install, start or watch Tailscale. If it stops, computers go back
to the relay and the other ways above.

## Do not

- Do not look for a setting that picks the way: there is none.
- Do not ask for passwords, tokens, auth keys or pairing codes in the chat.
- Do not move lophn's data folder onto shared storage or copy it.
- Do not set up a cloud for the person's data without the plain-words warning
  above.
- Do not set up a folder or a tool while a computer in the device list is always
  on: lophn already uses it as the middle.
