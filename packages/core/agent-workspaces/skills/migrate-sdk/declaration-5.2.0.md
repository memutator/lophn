# @lophn/declaration 5.2.0

Previous: 5.1.0
Breaking: no. Move together with `@lophn/app-ui` 2.25.1 or `@lophn/app-ui-native` 1.11.1 (they depend on this exact version).

The tables in `sync` may now go to different destinations. Each destination is its own stream: lophn writes and reads it on its own, so one that is missing, stopped or waiting does not hold back the others, and a computer gets only the tables of the destinations it has. Two rules come with it: a foreign key between two listed tables needs both in the same destination (release preparation refuses it otherwise), and an app whose `runs_on` has `phone` still sends all its listed tables to one destination (a declaration error otherwise).

```ts
// lophn.ts, before: every listed table had to name the same destination
sync: { usage_hour: "computers", plan: "computers" },
// after: a table may go elsewhere
sync: { usage_hour: "computers", plan: "computers", session_archive: "personal" },
```

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/5.1.0",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/5.2.0",
```

Change the same version in `lophn.ts` (`sdk_dependencies`). Nothing is required of an existing app: a declaration whose tables all go to one destination validates as before and keeps its hash. Moving a listed table to another destination in a new release keeps every computer's edits (the copies merge column by column when the computers run the new release); a computer that does not have the new destination stops getting that table. `lophn machine environment` now lists, per app, `destinations` (name, tables, state, export, imports) in place of `sends_to`, `destination`, `export` and `imports`. A copy of this SDK older than 5.2.0 in the app's own `validateDeclaration` test refuses tables that name different destinations.

## Instruction diff

The declaration guide and the `design-app` guide for apps whose data reaches other computers now allow a destination per table and state the two rules. When the person wants part of the data somewhere else (an archive on a cloud folder, summaries on all computers), give those tables their own destination instead of moving the whole app. Keep tables that reference each other together. Read `destinations` from `lophn machine environment` from now on. The steps to set up Syncthing or rclone for a named folder moved unchanged from `folder-sync.md` to `folder-tools.md` in the same skill; open that file when you set up a tool.

```diff
diff --git a/packages/core/agent-workspaces/skills/connect-computers/SKILL.md b/packages/core/agent-workspaces/skills/connect-computers/SKILL.md
index d6df8b757..5ad78e95b 100644
--- a/packages/core/agent-workspaces/skills/connect-computers/SKILL.md
+++ b/packages/core/agent-workspaces/skills/connect-computers/SKILL.md
@@ -31,7 +31,7 @@ You set none of this up and nothing chooses between these ways:
 
 The person sees the way each computer's files last arrived, and when each app
 last caught up, in Settings › Sync. You can read the same facts with
-`lophn machine environment` (the other computers and each app's `sends_to`).
+`lophn machine environment` (the other computers and each app's `destinations`).
 Look there before you suggest anything.
 
 Check before you propose any folder or tool: run `lophn machine environment` and
diff --git a/packages/core/agent-workspaces/skills/design-app/folder-sync.md b/packages/core/agent-workspaces/skills/design-app/folder-sync.md
index ff1d38e5a..c280dcd62 100644
--- a/packages/core/agent-workspaces/skills/design-app/folder-sync.md
+++ b/packages/core/agent-workspaces/skills/design-app/folder-sync.md
@@ -73,14 +73,19 @@ to another machine".
    the person set one up for this kind of data (it shows in `destinations`) or
    asks for one. A new name is short and means something to the person
    (`personal`, `work`), and it is the same name on every computer: the path
-   behind it may differ per computer. For now every listed table goes to the same
-   destination.
+   behind it may differ per computer.
+5. Tables may go to different destinations (summaries to `"computers"`, an
+   archive to a named folder). Each syncs on its own and a computer gets only the
+   tables of the destinations it has. Keep tables that reference each other in
+   one destination (release preparation refuses a reference between two). A
+   `runs_on` phone app sends all its listed tables to one destination.
 
 ```ts
 // lophn.ts
 sync: {
   usage_hour: "computers",
   plan: "computers",
+  session_archive: "personal",
 },
 ```
 
@@ -90,7 +95,8 @@ computers already received stay there. Listing a table with rows on several
 computers merges the copies: a shared row takes the copy of the computer that
 starts the release last, over edits and deletions made elsewhere while the
 table was local. If that is not acceptable, sync a new table and move this
-computer's rows into it.
+computer's rows into it. Moving a listed table to another destination keeps
+every computer's edits; a computer without the new destination stops getting it.
 
 Write the choice and the reason in DESIGN.md (Model): which tables go where, which
 stay on each computer, which tool moves them, whether it is encrypted.
@@ -213,69 +219,10 @@ app's data.
 
 ## Move the folder with a tool
 
-For a named destination, lophn only writes files into the folder and reads them.
-Pick the tool in this order:
-
-1. **Syncthing**, when the person's computers reach each other (same network, or
-   Syncthing's relays). It moves files directly between the person's devices,
-   encrypted on the way, and stores them only on those devices. It moves files only
-   while two devices are on at the same time; if the computers are rarely on
-   together, add an always-on device of the person's (a NAS, a home server) to the
-   same Syncthing folder, or use a cloud.
-2. **rclone with a `crypt` remote**, for a cloud. The cloud stores only encrypted
-   files. Google Drive, Dropbox, OneDrive and S3 are all rclone remotes: put the
-   `crypt` remote on top of one of them.
-3. **A network share the person owns** (a NAS mounted on each computer): the
-   destination is a folder on the mount and no tool runs. Use a subfolder of the
-   mount, so an unmounted share shows as `destination_missing` instead of being
-   written to the local disk.
-4. **A cloud folder that does not encrypt** (Google Drive for desktop, the Dropbox
-   or OneDrive app): not by default. Use it only after you say, in plain words,
-   "the files in this folder are uploaded to Google unencrypted, and Google can
-   read them" (name the service), and the person accepts that.
-
-Never send the person's data to a cloud without encryption unless they accepted it
-as in 4.
-
-Who does what:
-
-- The person installs the tool, logs in to the cloud, and pairs devices (accepts a
-  Syncthing device id) on each computer. You prepare the commands, say which
-  button to press, and check the result. Never ask for a password, a token or a
-  pairing code in the chat.
-- The `crypt` password and salt are chosen by the person and typed by the person
-  into `rclone config` on each computer. Tell them to keep the password somewhere
-  safe: without it the cloud copy cannot be read.
-
-### Syncthing
-
-Share the destination folder itself as one Syncthing folder ("Send & Receive") on
-every computer, each at its own destination path. Syncthing starts at login when
-the person installs it as a user service or with the OS's autostart; check that it
-does. No schedule is needed.
-
-### rclone
-
-rclone does not watch the folder, so run it from the OS's scheduler every few
-minutes (5 is fine): a systemd user timer on Linux, a launchd agent on macOS, Task
-Scheduler on Windows. Do not let two runs overlap (each of those schedulers waits
-by default). Do not use `rclone bisync`. Run two commands, upload then download:
-
-```
-# upload this computer's own part; files lophn removed are removed in the cloud too
-rclone sync "<path>/machines/<this machine id>" "<remote>:machines/<this machine id>" --exclude "*.tmp-*"
-# download the other computers' parts; never touch this computer's own part
-rclone copy "<remote>:machines" "<path>/machines" --exclude "/<this machine id>/**" --exclude "*.tmp-*"
-```
-
-`<remote>` is the `crypt` remote, `<path>` the destination path on this computer,
-and `<this machine id>` is `this_machine.id` in `lophn machine environment`
-(`mch_…`). lophn writes only under `machines/<its own id>/` and never removes
-another computer's files; the upload touches only this computer's part and the
-download every part but this one. Run the upload only when
-`<path>/machines/<this machine id>/record.json` exists, so a missing or unmounted
-folder never empties the cloud copy. Put both commands in one small script that the
-timer runs.
+For a named destination, lophn only writes files into the folder and reads them;
+a tool the person runs moves it. Pick and set up the tool as `folder-tools.md`
+says (Syncthing, rclone with an encrypted remote, or a network share; a cloud
+folder that does not encrypt only when the person accepts it).
 
 ### Check it
 
@@ -372,10 +319,10 @@ in their own terminal. If that computer writes to the folder again, it comes bac
 ## Read the state
 
 `lophn machine environment` is what lophn last read and wrote, not live. Each
-`apps[]` entry has `sends_to`, the destination its `sync` names (null when no table
-leaves this computer), and `destination`: `set`, or `not_set_here` when this
-computer has no destination of that name. Each `export` and `imports[]` entry has
-an `error` with a `code`:
+`apps[]` entry has `destinations`, one per destination its `sync` names: `name`,
+`tables`, `state` (`set`, or `not_set_here` when this computer has no such
+destination), `export` and `imports[]`. Each `export` and `imports[]` entry has an
+`error` with a `code`:
 
 - `destination_missing`: the folder is gone, moved or not mounted, or the tool
   removed it. Check the path; if the person moved it, change the destination (with
@@ -427,8 +374,8 @@ on its releases (an app without it has `follow: null` and empty `held` and
   - `diverged`: two computers built releases apart. Merge the other computer's
     branch (`refs/remotes/<machine id>/*`) into this one, build a release and
     activate it; every computer follows it.
-- `held`: changes from another release that wait here, one line per computer and
-  release, with `changes` and `why`:
+- `held`: changes from another release that wait here, one line per destination,
+  computer and release, with `changes` and `why`:
   - `newer_release`: applied once this computer runs that release (`follow`).
   - `older_release`: that computer runs an older release; its changes come when it
     follows.
diff --git a/packages/sdk/declaration/guide.md b/packages/sdk/declaration/guide.md
index 7463e9771..ef351c57c 100644
--- a/packages/sdk/declaration/guide.md
+++ b/packages/sdk/declaration/guide.md
@@ -131,11 +131,13 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   (release 준비가 거절한다), 컴퓨터 전용 일(network, secret, 알림, event 발행, agent)은 `external` operation에 둔다.
   `external`은 컴퓨터에 닿지 않으면 `unavailable`이다. 규칙 전부는 `design-app` skill의 bundled file `phone-apps.md`("Apps that run on the phone")다.
 - `sync` — 앱 DB의 어느 표를 어느 destination으로 보내는가. 표 이름 → destination 이름의 object다(`{ usage_hour: "computers",
-  plan: "computers" }`). 적은 표의 data만 그 destination으로 가고, 적지 않은 표는 이 컴퓨터를 떠나지 않는다. 칸이 없거나 비면
-  data를 내보내지 않고, 칸이 없는 옛 선언의 hash는 그대로다. migration이 표를 더하면 보낼 것만 여기에 더한다.
-  - destination 이름은 소문자로 시작하고 소문자·숫자·`-`로 32자까지다. 지금은 모든 표가 같은 destination이어야 한다(다르면 선언
-    오류다). 표 이름은 `lophn_`과 `sqlite_`로 시작하지 못한다. 적은 표가 앱 DB에 있는지와 PRIMARY KEY가 있는지는 release 준비가
-    target schema의 DB에서 본다.
+  plan: "computers", session_archive: "personal" }`). 적은 표의 data만 그 destination으로 가고, 적지 않은 표는 이 컴퓨터를
+  떠나지 않는다. 칸이 없거나 비면 data를 내보내지 않고, 칸이 없는 옛 선언의 hash는 그대로다. migration이 표를 더하면 보낼 것만
+  여기에 더한다.
+  - destination 이름은 소문자로 시작하고 소문자·숫자·`-`로 32자까지다. 표마다 다른 destination이어도 된다. destination마다
+    따로 내보내고 읽어 하나가 막혀도 다른 것은 돌고, 다른 컴퓨터는 자기에게 있는 destination의 표만 받는다. `runs_on`에
+    `phone`이 있는 앱은 모든 표가 같은 destination이어야 한다(다르면 선언 오류다). 표 이름은 `lophn_`과 `sqlite_`로
+    시작하지 못한다. 적은 표가 앱 DB에 있는지와 PRIMARY KEY가 있는지는 release 준비가 target schema의 DB에서 본다.
   - 사람의 다른 컴퓨터로 보낼 앱은 먼저 `"computers"`(내 컴퓨터들)를 고른다. 사람의 기기 명단에 있는 컴퓨터들이고, 옮기는
     길은 lophn이 고른다(컴퓨터끼리의 연결, 폰, 사람이 Settings에서 더한 같이 보는 폴더). 바깥 도구를 붙일 필요가 없다.
   - 그 밖의 이름(`"personal"`)은 사람이 따로 정한 이름 붙인 폴더다. 이름이 가리키는 폴더 경로는 사람이 기계마다 따로 정하는
@@ -148,7 +150,8 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
   PK·AUTOINCREMENT·PK 밖의 UNIQUE와 CHECK 없음, 그 표에 건 trigger 없음)을 release 준비가 보고, `@lophn/cap-store` 2.0.0
   이상을 고정해야 한다. 보내지 않는 표에는 이 규칙이 없다. 보내지 않는 표에 건 trigger는 보내는 표에 써도 된다. 보내는 표는
   보내지 않는 표를 foreign key로 가리키지 못하고, 보내지 않는 표가 보내는 표를 가리킬 때는 `ON DELETE`·`ON UPDATE`의 `CASCADE`·
-  `SET NULL`·`SET DEFAULT`를 쓰지 못한다(다른 컴퓨터에서 온 변경은 그 동작을 돌리지 않는다). 컴퓨터마다 생기는 줄(그 컴퓨터의
+  `SET NULL`·`SET DEFAULT`를 쓰지 못한다(다른 컴퓨터에서 온 변경은 그 동작을 돌리지 않는다). 보내는 표끼리의 foreign key는
+  같은 destination일 때만 된다(한 destination만 받는 컴퓨터에는 부모 줄이 없다). 컴퓨터마다 생기는 줄(그 컴퓨터의
   원본에서 모은 집계)을 보내면 PRIMARY KEY에 그 컴퓨터의 id를 넣는다: 같은 key를 두 컴퓨터가 쓰면 칸마다 나중 것이 이겨
   서로의 값을 덮는다.
 - `operations` — 앱 안의 operation 목록이다. 화면(`lophnApp.callOperation`)과 앱
```
