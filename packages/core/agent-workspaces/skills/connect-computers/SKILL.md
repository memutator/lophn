---
name: connect-computers
description: Help the person keep their apps' data and files in step across their computers (home and work, a dual boot, a laptop and a desktop) or reach a computer directly from outside their network. Explains what lophn does by itself, and sets up the folder all computers see and Tailscale when they need more.
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
- A phone paired with two computers carries the files from one to the other when
  it connects to each. The computers need not be on at the same time.
- Releases of an app that arrive this way are taken in and wait for the
  person's OK, as usual.

The person sees the way each computer's files last arrived, and when each app
last caught up, in Settings › Sync. You can read the same facts with
`lophn machine environment` (the other computers and each app's `sync_to`).
Look there before you suggest anything.

If the computers are not in one device list yet, that is the first step, and
Remote must be on (`lophn remote on`). The person makes an invite on one
computer (Settings › Remote, or `lophn remote invite computer`) and joins with
it on the other. For a computer that cannot be on at the same time (the other
system of a dual boot, a home and a work computer) use `--long`.

## When the computers are rarely on together: a folder all of them see

When no phone carries and the computers are never on at the same time (the two
systems of a dual boot are the clear case), the person can name one folder that
every computer sees. Each computer puts the files it carries there and takes in
the others' after checking their signatures, so the folder itself is not trusted.
It is the setting `folder.shared`, per computer: the path may differ on each.

Good folders:

- a disk both systems of a dual boot read and write (an exFAT or NTFS partition);
- a folder Syncthing moves between the computers (share it as "Send & Receive"
  on every computer; it needs two devices on at the same time, or an always-on
  device of the person's);
- a folder inside Google Drive for desktop, Dropbox or OneDrive.

Before anything asks the person, say in plain words:

- that lophn will copy the data of their apps that sync to their computers into
  this folder, as plain files: whoever or whatever can read the folder can read
  them;
- for Google Drive, Dropbox or OneDrive: the files are uploaded unencrypted and
  the service can read them (name the service). Do it only if the person accepts
  that. Otherwise offer Syncthing or the shared disk, or tell them to keep that
  data off the folder.

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

`lophn settings set` works only in the home conversation. Anywhere else, or when
nothing can ask the person, give them the explanation and the exact command to
run in their own terminal.

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
3. The name goes in the setting `remote.addresses`, one list per computer. It
   is a setting only the person can change, so you cannot set it: tell them the
   exact line to run in their own terminal:

   ```
   lophn settings set remote.addresses '["studio.tail1234.ts.net"]'
   ```

   Other devices pick the new address up on their next connection; nothing is
   paired again.
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
