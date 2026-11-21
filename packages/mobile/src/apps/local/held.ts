// What each computer holds of a sync app's files, kept on the phone. The phone never queues "files to send"; what must go to
// computer X is the files in the app's `files/` folder minus what X acknowledged (`stored` or `have`) or refused for good.
// So a file added while another is uploading is seen by the next look, a second computer receives everything the first one
// did, a computer added later starts with an empty record and receives all, and a record that cannot be read means "nothing
// acknowledged": everything is offered again and the computer answers `have` without receiving bytes.
import { hashesIn } from "../files/place.ts";
import { paths } from "./folder.ts";
import type { LocalFiles } from "./ports.ts";

type Entries = { acked: string[]; refused: string[] };
export type Held = { acked: ReadonlySet<string>; refused: ReadonlySet<string> };

function read(files: LocalFiles, app: string, computer: string): Entries {
  try {
    const parsed = JSON.parse(files.readText(paths(app).held(computer)) ?? "") as Partial<Entries>;
    const list = (value: unknown) =>
      Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : [];
    return { acked: list(parsed.acked), refused: list(parsed.refused) };
  } catch {
    return { acked: [], refused: [] };
  }
}

// Written to a temporary name and moved, so a record is the old one or the new one, never half of one.
function write(files: LocalFiles, app: string, computer: string, record: Entries): void {
  const path = paths(app).held(computer);
  files.write(`${path}.tmp`, JSON.stringify(record));
  files.move(`${path}.tmp`, path);
}

export function readHeld(files: LocalFiles, app: string, computer: string): Held {
  const record = read(files, app, computer);
  return { acked: new Set(record.acked), refused: new Set(record.refused) };
}

// Each of these reads and writes within one turn of the event loop (nothing awaits), so two callers do not lose each other's entry.
export function ackFile(files: LocalFiles, app: string, computer: string, file: string): void {
  const record = read(files, app, computer);
  if (record.acked.includes(file)) return;
  write(files, app, computer, { ...record, acked: [...record.acked, file] });
}

export function refuseFile(files: LocalFiles, app: string, computer: string, file: string): void {
  const record = read(files, app, computer);
  if (record.refused.includes(file)) return;
  write(files, app, computer, { ...record, refused: [...record.refused, file] });
}

/** The files in the app's folder that `computer` has neither acknowledged nor refused. */
export function missingFor(files: LocalFiles, app: string, computer: string): string[] {
  const held = readHeld(files, app, computer);
  return hashesIn(files, paths(app).files).filter((file) => !held.acked.has(file) && !held.refused.has(file));
}
