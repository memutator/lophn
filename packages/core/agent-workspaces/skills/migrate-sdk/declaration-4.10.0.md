# @lophn/declaration 4.10.0

Previous: 4.9.0
Breaking: no. Move together with `@lophn/app-ui` 2.20.0 and `@lophn/app-ui-native` 1.7.0.

Two additions for apps whose data goes to the person's other computers.

**`data.changed`.** When lophn applies changes that came from the phone or from another computer to this app's data, it sends the app the `lophn` event `data.changed` (payload `{}`) once per applied batch, to this app only. It does not say what changed. Subscribe to it like any `lophn` event and read again what the screen shows or the process caches:

```ts
// lophn.ts
subscriptions: [{ source: "lophn", event: "data.changed" }],
// app process (@lophn/cap-tool)
subscribe("lophn", "data.changed", async () => { /* refresh caches */ });
// screen (@lophn/app-ui or @lophn/app-ui-native)
useEvent("lophn", "data.changed", () => void reload());
```

**`across_machines`.** An entry of `events` can say `across_machines: true`. Such an event also travels with the app's data to the person's other computers and fires once on each one that runs the same release, with the same payload, to the same subscribers and screens. It can arrive late, and one older than 7 days does not fire. A computer where the person made the app's workspace private neither sends the app's events nor fires the ones that arrive. Without the field, or with `false`, an event fires on this computer only, and the declaration hash does not change. One new check, `invalid_input`:

- `an event that goes to other machines needs sync_to: it travels with the app's data`

```ts
// lophn.ts
sync_to: "computers",
events: [
  {
    name: "order.shipped",
    description: "An order was shipped.",
    payloadSchema: { /* ... */ },
    across_machines: true,
  },
],
```

`sync_to: "computers"` ("my computers") is now the first choice for an app whose data goes to the person's other computers: lophn picks how the files travel (a direct link between the computers, the phone, or a folder all of them see that the person added in Settings), and nothing needs to be set up. A named destination is only for a folder the person set up themselves.

```json
// package.json, before
"@lophn/declaration": "file:.lophn/sdk/declaration/4.9.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.19.0",
// after
"@lophn/declaration": "file:.lophn/sdk/declaration/4.10.0",
"@lophn/app-ui": "file:.lophn/sdk/app-ui/2.20.0",
```

Change the same versions in `lophn.ts` (`sdk_dependencies`); if the app has phone screens, also move `@lophn/app-ui-native` to 1.7.0. Nothing is required of an existing app: existing declarations validate as before and keep their hash. An app with `sync_to` or with `"phone"` in `runs_on` that shows or caches data should subscribe to `data.changed`; without it, the screen keeps showing old data until it reads again. Mark an event `across_machines` only when subscribers on the person's other computers must hear about it too; `data.changed` already tells every computer that the data changed.

## Instruction diff

The SDK guide gained `across_machines`, `data.changed` and `"computers"` under `sync_to`; the `design-app` skill and its bundled files `folder-sync.md` and `phone-apps.md` say to pick `"computers"` first and to learn about outside changes from `data.changed`; the app template gained one line. Make the lophn-managed part of this app's `AGENTS.md` match the new template lines below. From now on, choose `sync_to: "computers"` unless the person set up a named folder for this data, and do not build your own "data changed" signal: subscribe to `data.changed`.

```diff
# @lophn/declaration guide.md
@@ -91 +91 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
-- `events` — 이 앱이 내는 event 목록이다. 항목은 `{name, description, payloadSchema}`다. `name`은 1~64자
+- `events` — 이 앱이 내는 event 목록이다. 항목은 `{name, description, payloadSchema, across_machines?}`다. `name`은 1~64자
@@ -97,0 +98,5 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
+  - `across_machines: true`면 그 event가 앱의 data와 같은 길로 사람의 다른 기계에도 가서, 그 앱이 같은 release로 있는 기계마다
+    한 번 난다(발행 앱, 구독 handler, 화면, payload는 그 기계에서 낸 것과 같다). `sync_to`가 없는 선언에 쓰면 선언 오류다(event는
+    data와 같이 간다). 칸이 없거나 false면 이 기계에서만 나고, 칸이 없는 옛 선언의 hash는 그대로다. data처럼 늦게 닿을 수 있고
+    7일보다 옛 event는 내지 않는다. 사람이 이 앱 workspace를 private으로 둔 기계에서는 그 기계가 낸 event가 다른 기계로 가지
+    않고, 다른 기계에서 온 event도 그 기계에서 나지 않는다. 다른 기계에서 온 data의 변경은 이 칸 없이 `data.changed`로 안다.
@@ -99 +104,3 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
-  lophn이 내는 event의 `"lophn"`이다(lophn이 내는 event는 session lifecycle의 `session.started|running|waiting|idle|ended`다. `@lophn/agent` guide). 사람 허락은 없다. 받는 handler 이름은 `on.<source>.<event>`로 정해지고
+  lophn이 내는 event의 `"lophn"`이다(lophn이 내는 event는 session lifecycle의 `session.started|running|waiting|idle|ended`(`@lophn/agent` guide)와
+  `data.changed`다. `data.changed`는 폰이나 사람의 다른 컴퓨터에서 온 변경을 lophn이 이 앱의 DB에 적용한 뒤 이 앱에만 한 번 가고
+  payload는 `{}`다. 무엇이 바뀌었는지는 싣지 않으니 화면과 앱 process는 받으면 보이는 data를 다시 읽는다). 사람 허락은 없다. 받는 handler 이름은 `on.<source>.<event>`로 정해지고
@@ -118,5 +125,9 @@ import { defineApp, validateDeclaration } from "@lophn/declaration";
-- `sync_to` — 이 앱의 data를 어느 destination으로 내보내는가. destination 이름 하나다(`"personal"`).
-  소문자로 시작하고 소문자·숫자·`-`로 32자까지다. 칸이 없으면 data를 내보내지 않고, 칸이 없는 옛 선언의 hash는 그대로다.
-  값은 이름뿐이다: 이름이 가리키는 폴더 경로는 사람이 기계마다 따로 정하는 설정이라 같은 선언이 어느 기계에서나 맞고,
-  이 기계에 그 이름의 destination이 없으면 이 기계는 그 앱의 data를 내보내지도 읽지도 않는다. 바깥 도구가 그 폴더를
-  다른 기계로 옮긴다. `["phone"]`인 앱은 쓰지 못한다(폰의 data는 컴퓨터를 거쳐서만 나가는데 그 앱은 컴퓨터 사본이 없다).
+- `sync_to` — 이 앱의 data를 어느 destination으로 내보내는가. destination 이름 하나다. 소문자로 시작하고 소문자·숫자·`-`로
+  32자까지다. 칸이 없으면 data를 내보내지 않고, 칸이 없는 옛 선언의 hash는 그대로다.
+  - 사람의 다른 컴퓨터로 보낼 앱은 먼저 `"computers"`(내 컴퓨터들)를 고른다. 사람의 기기 명단에 있는 컴퓨터들이고, 옮기는
+    길은 lophn이 고른다(컴퓨터끼리의 연결, 폰, 사람이 Settings에서 더한 같이 보는 폴더). 바깥 도구를 붙일 필요가 없다.
+  - 그 밖의 이름(`"personal"`)은 사람이 따로 정한 이름 붙인 폴더다. 이름이 가리키는 폴더 경로는 사람이 기계마다 따로 정하는
+    설정이라 같은 선언이 어느 기계에서나 맞고, 이 기계에 그 이름의 destination이 없으면 이 기계는 그 앱의 data를 내보내지도
+    읽지도 않는다. 바깥 도구가 그 폴더를 다른 기계로 옮긴다.
+  - `["phone"]`인 앱은 쓰지 못한다(폰의 data는 컴퓨터를 거쳐서만 나가는데 그 앱은 컴퓨터 사본이 없다). 다른 기계와 폰에서 온
+    변경은 `lophn`의 `data.changed`로 안다(`subscriptions`).
```

```diff
# design-app SKILL.md
@@ -300,6 +300,6 @@ phone app is older than the kit the screen was built with, the phone shows
-To check those on the person's phone (`lophn tab open --phone`), first read the
-bundled `phone-check.md`; for home screen widgets (`widgets`) and phone location
-(`phone.use`), first read `phone-features.md`; when the app's backend and data
-also run on the phone (`runs_on`), first read `phone-apps.md`; when the app's
-data must reach the person's other computers (`sync_to`), first read
-`folder-sync.md`. Read each with
+First read the bundled `phone-check.md` to check those on the person's
+phone (`lophn tab open --phone`); `phone-features.md` for home screen widgets
+and phone location (`phone.use`); `phone-apps.md` when the app's backend and
+data also run on the phone (`runs_on`); `folder-sync.md` when its data must
+reach the person's other computers (`sync_to`, `"computers"` first; changes
+from there arrive as `data.changed`). Use
```

```diff
# design-app folder-sync.md
@@ -7,3 +7,12 @@ changes, releases and source into that folder and reads what the other computers
-wrote there. lophn does not move the folder. A tool the person runs (Syncthing,
-rclone) does, and you set that tool up with the person. lophn has no code, setting
-or credential for any storage service, and you never put one into lophn.
+wrote there. There are two kinds:
+
+- `computers` ("my computers"): the computers in the person's device list. lophn
+  keeps this folder itself and picks how its files travel: a direct link between
+  the computers, the paired phone carrying them, or a folder all the person's
+  computers see that the person added in Settings. Nothing to set up.
+- A named destination (`personal`, `work`): a folder the person set up themselves
+  on each computer. lophn does not move it. A tool the person runs (Syncthing,
+  rclone) does, and you set that tool up with the person.
+
+lophn has no code, setting or credential for any storage service, and you never
+put one into lophn.
@@ -32,3 +41,5 @@ another computer too, or the data must exist on another machine.
-4. Use the name of a destination that already exists if it fits. A new name is
-   short and means something to the person (`personal`, `work`), and it is the
-   same name on every computer: the path behind it may differ per computer.
+4. Pick `sync_to: "computers"` first. Use a named destination only when the
+   person set one up for this kind of data (it shows in `destinations`) or asks
+   for one. A new name is short and means something to the person (`personal`,
+   `work`), and it is the same name on every computer: the path behind it may
+   differ per computer.
@@ -63,0 +75,25 @@ Know and design for these:
+## Know when data changed
+
+lophn applies the changes that come from the person's other computers and from
+the phone. The app is not called for them; instead it gets the `lophn` event
+`data.changed` (payload `{}`) once after each batch is applied. It does not say
+what changed: read again what you show or hold.
+
+```ts
+// lophn.ts
+subscriptions: [{ source: "lophn", event: "data.changed" }],
+// app process (@lophn/cap-tool)
+subscribe("lophn", "data.changed", async () => { /* refresh caches */ });
+// screen (@lophn/app-ui or @lophn/app-ui-native)
+useEvent("lophn", "data.changed", () => void reload());
+```
+
+An event the app publishes stays on this computer unless its declaration says
+`across_machines: true` (allowed only with `sync_to`). Such an event travels with
+the app's data and fires once on every other computer that runs the same release,
+with the same payload, to the same subscribers and screens. It can arrive late;
+one older than 7 days does not fire. When the person made the app's workspace
+private on a computer, that computer neither sends its events nor fires the ones
+that arrive. Do not mark an event only to tell other computers the data changed:
+`data.changed` does that.
+
@@ -66 +102,2 @@ Know and design for these:
-A destination is the setting `folder.destinations`: a name mapped to an absolute
+Skip this section for `computers`: it needs no setting. A named destination is
+the setting `folder.destinations`: a name mapped to an absolute
@@ -108,2 +145,2 @@ Where it runs:
-- There is no Settings screen for destinations yet. The person's own way is
-  `lophn settings set` in their terminal.
+- The person can also add, change or remove a folder themselves in Settings ›
+  Sync, or with `lophn settings set` in their own terminal.
@@ -117 +154,2 @@ app's data.
-lophn only writes files into the folder and reads them. Pick the tool in this order:
+For a named destination, lophn only writes files into the folder and reads them.
+Pick the tool in this order:
@@ -223,2 +261,3 @@ Say it in their words, once, when you set `sync_to` or set up a destination:
-- it is not live: changes arrive as fast as the tool moves the folder (lophn writes
-  a few seconds after a change and reads within minutes);
+- it is not live: changes arrive as fast as the files travel (with `computers`,
+  soon while the computers are connected, otherwise when the phone or the shared
+  folder carries them; with a named folder, as fast as the tool moves it);
```

```diff
# design-app phone-apps.md
@@ -82 +82,4 @@ no network.
-  phone would publish are not delivered.
+  phone would publish are not delivered. When a write from the phone reaches the
+  computer, the app there gets the `lophn` event `data.changed` once (declare
+  `{source: "lophn", event: "data.changed"}` in `subscriptions`), so its
+  process and open screens can read the data again.
```

```diff
# app template AGENTS.md
@@ -75 +75,2 @@ Package를 쓴다.
-  `sync_to`는 앱의 data를 사람의 다른 컴퓨터로 보낼 destination 이름이다. 없으면 data는 이 기계에만 있다.
+  `sync_to`는 앱의 data를 사람의 다른 컴퓨터로 보낼 destination 이름이다. 없으면 data는 이 기계에만 있다. 먼저 `"computers"`를
+  고른다(옮기는 길은 lophn이 고른다). 다른 기계와 폰에서 온 변경은 `lophn`의 event `data.changed`로 안다.
```
