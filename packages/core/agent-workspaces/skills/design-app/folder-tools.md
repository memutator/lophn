# Move a named sync folder with a tool

Read this from `folder-sync.md` when an app's data goes to a named destination (not
`computers`) and the folder has to reach the person's other computers.

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

## Syncthing

Share the destination folder itself as one Syncthing folder ("Send & Receive") on
every computer, each at its own destination path. Syncthing starts at login when
the person installs it as a user service or with the OS's autostart; check that it
does. No schedule is needed.

## rclone

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
