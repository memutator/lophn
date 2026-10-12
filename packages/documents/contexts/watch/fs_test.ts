import { assertEquals } from "@std/assert";
import { createChangeDetector } from "./detector.ts";
import { startFsWatch } from "./fs.ts";
import { contractOf, fakeTimer, fakeWatchFs } from "./testing.ts";

// the fake watcher delivers on a microtask turn; one macrotask is plenty
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const timer = fakeTimer();
  const calls: string[][] = [];
  const detector = createChangeDetector({
    timer,
    rescan: (contexts) => calls.push([...contexts]),
  });
  const watchFs = fakeWatchFs();
  const watch = startFsWatch({ root: "/proj", detector, watchFs });
  const active = [{
    context: "ctx_a",
    contract: contractOf([
      { kind: "docs", paths: ["docs/*.md", "notes/**/*.md"] },
    ]),
  }];
  watch.update(detector.apply(active));
  return { timer, calls, detector, watchFs, watch };
}

Deno.test("documents/contexts#R23 [ctx-I32b]: the adapter opens one watcher per folder at root/folder with the recursive flag", () => {
  const { watchFs, watch } = setup();
  assertEquals(
    watchFs.watchers.map((w) => [w.path, w.recursive]),
    [["/proj/docs", false], ["/proj/notes", true]],
  );
  watch.close();
});

Deno.test("documents/contexts#R23 [ctx-I32b]: an event becomes a project-relative signal, access events are ignored, and nothing is stored", async () => {
  const { timer, calls, watchFs, watch } = setup();
  const docs = watchFs.watchers[0]!;
  docs.emit({ kind: "access", paths: ["/proj/docs/a.md"] });
  await flush();
  assertEquals(timer.pending(), 0);

  docs.emit({ kind: "modify", paths: ["/proj/docs/a.md"] });
  await flush();
  timer.advance(500);
  assertEquals(calls, [["ctx_a"]]);
  watch.close();
});

Deno.test("documents/contexts#R23 [ctx-I32b]: update closes the watchers of removed folders and opens new ones", () => {
  const { detector, watchFs, watch } = setup();
  watch.update(detector.apply([{
    context: "ctx_a",
    contract: contractOf([{
      kind: "docs",
      paths: ["docs/*.md", "specs/x.md"],
    }]),
  }]));
  const byPath = new Map(watchFs.watchers.map((w) => [w.path, w]));
  assertEquals(byPath.get("/proj/notes")!.closed, true);
  assertEquals(byPath.get("/proj/docs")!.closed, false);
  assertEquals(byPath.get("/proj/specs")!.closed, false);
  watch.close();
  assertEquals(watchFs.watchers.every((w) => w.closed), true);
});
