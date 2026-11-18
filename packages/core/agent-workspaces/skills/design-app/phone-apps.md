# Apps that run on the phone

Read this before you set `runs_on` in `lophn.ts`, and again when you change the
data or the backend of an app that has it. A phone screen alone does not make an
app run on the phone: by default the backend and the data stay on the computer
and the phone screen calls them there. `runs_on` is the one field that moves
them. Its screens still need at least one `phone` screen.

## Pick `runs_on`

Pick it from what the person needs, not from the screens.

- No `runs_on` (same as `["computer"]`): the app shows the computer's data live,
  or its core is something only the computer does: network, secrets, notices,
  agents, commands, jobs, event subscriptions. This is the default. Choose it
  unless the person needs the phone to work without the computer.
- `["computer", "phone"]`: the person must read and write on the phone while the
  computer is off, and also uses the app on the desktop. The backend runs on both.
  The phone keeps its own copy of the data and the computer is the hub that
  merges. The phone can write while the computer is off; the changes go out when
  it is reachable again, and the phone gets the others' changes then.
- `["phone"]`: the app is only for the phone and does not need a backup. It runs
  only on the phone and its data exists only on that phone. It cannot declare
  `commands`, `subscriptions`, `external` operations, `widgets` or a screen with
  a place other than `phone` (declaration check). Tell the person, in their
  words, that the data is only on that phone, that lophn agents cannot read it,
  that rewind does not cover it and that it is not backed up.

Write the choice and the reason in DESIGN.md (Model).

## Data

The phone and the computer both insert rows and the two copies are merged per
column: for one column the last write wins and a delete wins only when it is
newer. Nothing tells the person about a conflict.

- Ids are text made with `newId("ord")` from `@lophn/cap-store` (the prefix is
  exactly three lowercase letters). No `INTEGER` primary key and no
  `AUTOINCREMENT`: both sides would hand out the same number.
- No trigger: its writes would arrive a second time through the merge. Do that
  work in the handler.
- No `UNIQUE` or `CHECK` outside the primary key: two devices can each be valid
  and be invalid together, and the merge would then fail on every retry. Keep the
  rule in the handler, or put the value into the primary key.
- Never rename or drop a table or a column of an app that syncs, and never write a
  migration that changes primary key values. A rename counts as a drop and a new
  column, so the phone's changes that were not sent yet are lost. Add a column and
  stop using the old one.
- The phone migrates its own copy when a new release is activated, so a migration
  must work on data the phone changed too, not only on data that looks like the
  computer's. `store.migrate()` with no argument runs the release's migrations.
- Do not write when the module loads. Put first data in a migration or in the
  first call.
- Do not write `BEGIN` or `COMMIT` yourself. Use `store.transaction(work)`: each
  call already runs inside one transaction.
- One call's changes must stay well under 8 MiB; a larger one cannot be sent to
  the computer. Split a big import into several calls.
- A change that the other side's schema refuses is skipped and logged, not
  retried.
- A write that stores the same value, and a delete of a row that is not there,
  still count as writes in the merge. That is fine; just know it.

## Backend

The backend runs inside the app's screen on the phone, one call at a time, with
no network.

- Do not import `node:` modules, `@lophn/cap-fs` or `@lophn/flow` anywhere in the
  backend. It is one bundle for both sides, so a command that only runs on the
  computer cannot import them either.
- A read or write operation runs on the phone in one transaction and gets at most
  3 seconds. A longer call is rolled back and answers `unavailable`. Do the work
  in small steps.
- On the phone `fetch`, `@lophn/cap-net`, secrets, notices, event publishing,
  agents and the broker answer `unavailable`. A write operation must not depend on
  them. Put that work in an `external` operation: it always goes to the computer
  and answers `unavailable` when the computer cannot be reached. A read operation
  never writes.
- Register exactly the handlers the declaration lists, as `registerHandlers` in
  the template does.
- Commands and subscriptions run only on the computer. Events that a write on the
  phone would publish are not delivered. When a write from the phone reaches the
  computer, the app there gets the `lophn` event `data.changed` once (declare
  `{source: "lophn", event: "data.changed"}` in `subscriptions`), so its
  process and open screens can read the data again.

## Screens

- A screen shows the `unavailable` error of an `external` operation (or of a
  call that took too long) and says what to do: try again when the computer is
  reachable. Never leave a spinner.
- A screen opened on a phone with the computer off still reads and writes its own
  copy. Do not block it on the computer.
- Two places that edit the same column silently keep the later write. Design the
  screens so that is acceptable (separate columns for separate fields, a new row
  instead of editing a shared one).
- lophn shows the person whether the app is synced or only on this phone; the
  screen does not draw that.

## Check

`lophn release prepare` refuses a phone app with one sentence you can act on:
a `node:` module or `@lophn/cap-fs`/`@lophn/flow` import (it names the file), a
backend that does not register the declared handlers (or registers others), an
SDK below `@lophn/cap-store` 2.0.0 or `@lophn/cap-tool` 2.2.0, and a schema with an
`INTEGER` primary key, `AUTOINCREMENT`, a trigger, `UNIQUE` or `CHECK`. Fix it,
commit and prepare again.

In a preview and in tests the app runs only on the computer. Preview cannot show
the phone's own copy, the merge, or the offline behavior. Say so when you report:
what you saw in the preview, and that the person makes the last check on the
phone.
