import { assertEquals } from "@std/assert";
import { loadContract } from "../extract/testing.ts";
import { createChangeDetector } from "./detector.ts";
import { contractOf, fakeTimer } from "./testing.ts";
import type { ActiveContext } from "./types.ts";

const fixture: ActiveContext = {
  context: "ctx_eval",
  contract: loadContract("eval-project").contract,
};
// docs/ only
const docsOnly: ActiveContext = {
  context: "ctx_docs",
  contract: contractOf([{ kind: "docs", paths: ["docs/*.md"] }]),
};

function setup(active: readonly ActiveContext[] = [fixture, docsOnly]) {
  const timer = fakeTimer();
  const calls: string[][] = [];
  const detector = createChangeDetector({
    timer,
    rescan: (contexts) => calls.push([...contexts]),
  });
  detector.apply(active);
  return { timer, calls, detector };
}

Deno.test("documents/contexts#R23 [ctx-I32b]: the watch set is the merged folders of every active context", () => {
  const { detector } = setup();
  assertEquals(detector.folders(), [
    { path: "docs", recursive: false },
    { path: "eval/experiments", recursive: false },
    { path: "eval/scenarios", recursive: false },
    { path: "loop/findings", recursive: false },
  ]);
});

Deno.test("documents/contexts#R23 [ctx-I32b]: an event rescans exactly the contexts whose folders cover the path", () => {
  const { timer, calls, detector } = setup();
  detector.signal(["eval/experiments/exp-001-plan.md"]);
  timer.advance(500);
  assertEquals(calls, [["ctx_eval"]]);

  detector.signal(["docs/guide-a.md"]);
  timer.advance(500);
  // docs/ is in both contexts
  assertEquals(calls, [["ctx_eval"], ["ctx_docs", "ctx_eval"]]);
});

Deno.test("documents/contexts#R23 [ctx-I32b]: a path outside every contract does nothing, not even arming the timer", () => {
  const { timer, calls, detector } = setup();
  detector.signal([
    "src/main.ts",
    "docs/sub/deeper.md",
    "README.md",
    "eval/x.md",
  ]);
  assertEquals(timer.pending(), 0);
  timer.advance(5000);
  assertEquals(calls, []);
});

Deno.test("documents/contexts#R23 [ctx-I32b]: signals inside 500 ms coalesce into one sorted rescan and a later signal does not extend the window", () => {
  const { timer, calls, detector } = setup();
  detector.signal(["loop/findings/F-001.md"]); // t=0 opens the window
  timer.advance(200);
  detector.signal(["docs/guide-a.md"]); // t=200
  timer.advance(299);
  detector.signal(["loop/findings/F-002.md"]); // t=499, same context again
  assertEquals(calls, []);
  timer.advance(1); // t=500
  assertEquals(calls, [["ctx_docs", "ctx_eval"]]);
  timer.advance(5000);
  assertEquals(calls.length, 1);
});

Deno.test("documents/contexts#R23 [ctx-I32b]: a signal after the window closed opens a new one", () => {
  const { timer, calls, detector } = setup();
  detector.signal(["docs/a.md"]);
  timer.advance(500);
  timer.advance(300);
  detector.signal(["loop/findings/F-001.md"]); // t=800
  timer.advance(499);
  assertEquals(calls.length, 1);
  timer.advance(1);
  assertEquals(calls, [["ctx_docs", "ctx_eval"], ["ctx_eval"]]);
});

Deno.test("documents/contexts#R23 [ctx-I32b]: a custom window is honoured", () => {
  const timer = fakeTimer();
  const calls: string[][] = [];
  const detector = createChangeDetector({
    timer,
    window_ms: 50,
    rescan: (contexts) => calls.push([...contexts]),
  });
  detector.apply([docsOnly]);
  detector.signal(["docs/a.md"]);
  timer.advance(49);
  assertEquals(calls, []);
  timer.advance(1);
  assertEquals(calls, [["ctx_docs"]]);
});

Deno.test("documents/contexts#R23 [ctx-I32b]: applying a new bundle recomputes the watch set and reports only the folders to open and close", () => {
  const { detector } = setup([docsOnly]);
  assertEquals(detector.folders(), [{ path: "docs", recursive: false }]);

  // the applied bundle now also points into notes/ (recursive) and no longer into docs/
  const diff = detector.apply([{
    context: "ctx_docs",
    contract: contractOf([{ kind: "docs", paths: ["notes/**/*.md"] }]),
  }]);
  assertEquals(diff, {
    start: [{ path: "notes", recursive: true }],
    stop: [{ path: "docs", recursive: false }],
  });
  assertEquals(detector.folders(), [{ path: "notes", recursive: true }]);

  // the same set again: nothing to open or close
  assertEquals(
    detector.apply([{
      context: "ctx_docs",
      contract: contractOf([{ kind: "docs", paths: ["notes/**/*.md"] }]),
    }]),
    { start: [], stop: [] },
  );
});

Deno.test("documents/contexts#R23 [ctx-I32b]: archiving a context closes only the folders no other active context needs and drops its pending rescan", () => {
  const { timer, calls, detector } = setup();
  detector.signal(["docs/a.md"]); // both contexts pending
  const diff = detector.apply([docsOnly]); // ctx_eval archived
  assertEquals(diff, {
    start: [],
    stop: [
      { path: "eval/experiments", recursive: false },
      { path: "eval/scenarios", recursive: false },
      { path: "loop/findings", recursive: false },
    ],
  });
  timer.advance(500);
  assertEquals(calls, [["ctx_docs"]]);

  // events under the closed folders map to nobody now
  detector.signal(["loop/findings/F-001.md"]);
  assertEquals(timer.pending(), 0);

  // unarchiving brings the folders back
  assertEquals(detector.apply([docsOnly, fixture]).start.length, 3);
});

Deno.test("documents/contexts#R23 [ctx-I32b]: a context removed from the active set mid-window is not rescanned", () => {
  const { timer, calls, detector } = setup();
  detector.signal(["loop/findings/F-001.md"]); // only ctx_eval pending
  detector.apply([docsOnly]);
  timer.advance(500);
  assertEquals(calls, []);
});

Deno.test("documents/contexts#R23 [ctx-I32b]: close drops the pending rescan", () => {
  const { timer, calls, detector } = setup();
  detector.signal(["docs/a.md"]);
  detector.close();
  timer.advance(5000);
  assertEquals(calls, []);
  assertEquals(timer.pending(), 0);
});

Deno.test("documents/contexts#R23 [ctx-I32b]: the detector exposes no change history, only the watch set and the hint", () => {
  const { detector } = setup();
  assertEquals(Object.keys(detector).sort(), [
    "apply",
    "close",
    "folders",
    "signal",
  ]);
});
