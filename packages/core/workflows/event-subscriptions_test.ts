import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../../protocol/base/ids.ts";
import {
  type CallPolicy,
  DEFAULT_CALL_POLICY,
} from "../../protocol/lophn-agent/call-policy.ts";
import { reachCheckerOf } from "../events/mod.ts";
import {
  createFlowEventRegistry,
  type FlowEventDelivery,
} from "./event-subscriptions.ts";

const PRJ_A = "prj_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"prj">;
const PRJ_B = "prj_01hzzzzzzzzzzzzzzzzzzzzzzb" as Id<"prj">;
const PRJ_PRIVATE = "prj_01hzzzzzzzzzzzzzzzzzzzzzzp" as Id<"prj">;
const APP_A = "app_01hzzzzzzzzzzzzzzzzzzzzzza" as Id<"app">;
const APP_PRIVATE = "app_01hzzzzzzzzzzzzzzzzzzzzzzp" as Id<"app">;
const WFI_1 = "wfi_01hzzzzzzzzzzzzzzzzzzzzzz1" as Id<"wfi">;
const WFI_2 = "wfi_01hzzzzzzzzzzzzzzzzzzzzzz2" as Id<"wfi">;
const SES_HUMAN = "ses_01hzzzzzzzzzzzzzzzzzzzzzzh" as Id<"ses">;
const SES_DRIVEN = "ses_01hzzzzzzzzzzzzzzzzzzzzzzd" as Id<"ses">;

function policyWith(overrides: Partial<CallPolicy> = {}): CallPolicy {
  return {
    ...DEFAULT_CALL_POLICY,
    ...overrides,
  };
}

test("matching app and session events are delivered and unreachable workspaces are blocked by call policy", () => {
  const policy = policyWith({
    private: [
      { kind: "app", id: APP_PRIVATE },
      { kind: "project", id: PRJ_PRIVATE },
    ],
    workspaces: [
      {
        from: { kind: "project", id: PRJ_A },
        to: { kind: "project", id: PRJ_B },
        allow: false,
      },
    ],
  });
  const registry = createFlowEventRegistry({
    reaches: reachCheckerOf(() => policy),
    isDrivenSession: () => false,
  });

  const receivedA: FlowEventDelivery[] = [];
  const receivedPrivate: FlowEventDelivery[] = [];
  const subApp = registry.subscribe({
    instance: WFI_1,
    project: PRJ_A,
    source: { kind: "app", app: APP_A },
    event: "usage.limit",
    onEvent: (d) => receivedA.push(d),
  });
  registry.subscribe({
    instance: WFI_1,
    project: PRJ_A,
    source: { kind: "app", app: APP_PRIVATE },
    event: "usage.limit",
    onEvent: (d) => receivedA.push(d),
  });
  registry.subscribe({
    instance: WFI_2,
    project: PRJ_PRIVATE,
    source: { kind: "app", app: APP_A },
    event: "usage.limit",
    onEvent: (d) => receivedPrivate.push(d),
  });

  assert.equal(registry.hasAppSubscribers(APP_A, "usage.limit"), true);
  assert.equal(registry.hasAppSubscribers(APP_A, "other.event"), false);
  assert.equal(registry.hasSessionSubscribers(), false);

  // Reachable app event goes to PRJ_A, blocked for private PRJ_PRIVATE.
  assert.equal(
    registry.dispatchAppEvent({
      app: APP_A,
      source: "masup",
      event: "usage.limit",
      payload: { percent: 95 },
    }),
    1,
  );
  assert.deepStrictEqual(receivedA, [
    {
      subscriptionId: subApp,
      source: "masup",
      event: "usage.limit",
      payload: { percent: 95 },
    },
  ]);
  assert.equal(receivedPrivate.length, 0);

  // Private app event is blocked for PRJ_A.
  assert.equal(
    registry.dispatchAppEvent({
      app: APP_PRIVATE,
      source: "secret-app",
      event: "usage.limit",
      payload: { percent: 100 },
    }),
    0,
  );
  // Remote-machine app event is ignored for local flow onEvent subscriptions.
  assert.equal(
    registry.dispatchAppEvent({
      app: APP_A,
      source: "masup",
      event: "usage.limit",
      payload: { percent: 99 },
      machine: "mch_01hzzzzzzzzzzzzzzzzzzzzzzm",
    }),
    0,
  );
  assert.equal(receivedA.length, 1);

  // Session events respect mayReachWorkspace (PRJ_A reaches PRJ_A and Home, not PRJ_B).
  const sessionEvents: FlowEventDelivery[] = [];
  const subSession = registry.subscribe({
    instance: WFI_1,
    project: PRJ_A,
    source: { kind: "session" },
    event: "session.idle",
    onEvent: (d) => sessionEvents.push(d),
  });
  assert.equal(registry.hasSessionSubscribers(), true);

  assert.equal(
    registry.dispatchSessionEvent({
      event: "session.idle",
      payload: { session: SES_HUMAN },
      session: { id: SES_HUMAN, workspace: { kind: "project", id: PRJ_A } },
    }),
    1,
  );
  assert.equal(
    registry.dispatchSessionEvent({
      event: "session.idle",
      payload: { session: SES_HUMAN },
      session: { id: SES_HUMAN, workspace: { kind: "project", id: PRJ_B } },
    }),
    0,
  );
  assert.deepStrictEqual(sessionEvents, [
    {
      subscriptionId: subSession,
      source: "lophn",
      event: "session.idle",
      payload: { session: SES_HUMAN },
    },
  ]);
});

test("app events originating from a subscribing workflow instance's own chain are excluded", () => {
  const registry = createFlowEventRegistry({
    reaches: reachCheckerOf(() => DEFAULT_CALL_POLICY),
  });
  const got1: FlowEventDelivery[] = [];
  const got2: FlowEventDelivery[] = [];
  registry.subscribe({
    instance: WFI_1,
    project: PRJ_A,
    source: { kind: "app", app: APP_A },
    event: "ticket.updated",
    onEvent: (d) => got1.push(d),
  });
  registry.subscribe({
    instance: WFI_2,
    project: PRJ_A,
    source: { kind: "app", app: APP_A },
    event: "ticket.updated",
    onEvent: (d) => got2.push(d),
  });

  // Event caused by WFI_1 is blocked for WFI_1 (loop prevention) but still delivered to WFI_2.
  const count = registry.dispatchAppEvent({
    app: APP_A,
    source: "tracker",
    event: "ticket.updated",
    payload: { id: 42 },
    originInstances: [WFI_1],
  });
  assert.equal(count, 1);
  assert.equal(got1.length, 0);
  assert.equal(got2.length, 1);
  assert.deepStrictEqual(got2[0]!.payload, { id: 42 });
});

test("non-human, workflow, and job driven session events are excluded while human sessions pass", () => {
  let drivenLookups = 0;
  const registry = createFlowEventRegistry({
    reaches: reachCheckerOf(() => DEFAULT_CALL_POLICY),
    isDrivenSession: (sessionId) => {
      drivenLookups += 1;
      return sessionId === SES_DRIVEN;
    },
  });
  const gotA: FlowEventDelivery[] = [];
  const gotB: FlowEventDelivery[] = [];
  registry.subscribe({
    instance: WFI_1,
    project: PRJ_A,
    source: { kind: "session", workspace: PRJ_A },
    event: "session.idle",
    onEvent: (d) => gotA.push(d),
  });
  registry.subscribe({
    instance: WFI_2,
    project: PRJ_A,
    source: { kind: "session" },
    event: "session.idle",
    onEvent: (d) => gotB.push(d),
  });

  // Driven by SQL policy (job/workflow/team/call session).
  assert.equal(
    registry.dispatchSessionEvent({
      event: "session.idle",
      payload: { session: SES_DRIVEN },
      session: { id: SES_DRIVEN, workspace: { kind: "project", id: PRJ_A } },
    }),
    0,
  );
  // Lookup is cached per dispatch across multiple subscribers.
  assert.equal(drivenLookups, 1);

  // Marked driven directly on payload (e.g. workflow_origin or spawned_by).
  assert.equal(
    registry.dispatchSessionEvent({
      event: "session.idle",
      payload: { session: SES_HUMAN },
      session: {
        id: SES_HUMAN,
        workspace: { kind: "project", id: PRJ_A },
        driven: true,
      },
    }),
    0,
  );

  // Non-session core event (e.g. call.settled with session === null).
  assert.equal(
    registry.dispatchSessionEvent({
      event: "session.idle",
      payload: { call: "cal_1" },
      session: null,
    }),
    0,
  );

  // Human-opened session in PRJ_A passes to both subscribers.
  assert.equal(
    registry.dispatchSessionEvent({
      event: "session.idle",
      payload: { session: SES_HUMAN },
      session: { id: SES_HUMAN, workspace: { kind: "project", id: PRJ_A } },
    }),
    2,
  );
  assert.equal(gotA.length, 1);
  assert.equal(gotB.length, 1);
});

test("unsubscribe, unsubscribeInstance, and listener error isolation work cleanly", () => {
  const errors: string[] = [];
  const registry = createFlowEventRegistry({
    reaches: reachCheckerOf(() => DEFAULT_CALL_POLICY),
    onListenerError: ({ subscriptionId }) => errors.push(subscriptionId),
  });

  const got: string[] = [];
  const sub1 = registry.subscribe({
    instance: WFI_1,
    project: PRJ_A,
    source: { kind: "app", app: APP_A },
    event: "ping",
    subscriptionId: "sub_bad",
    onEvent: () => {
      throw new Error("boom");
    },
  });
  const sub2 = registry.subscribe({
    instance: WFI_1,
    project: PRJ_A,
    source: { kind: "session" },
    event: "session.idle",
    onEvent: () => got.push("wfi1_session"),
  });
  const sub3 = registry.subscribe({
    instance: WFI_2,
    project: PRJ_A,
    source: { kind: "app", app: APP_A },
    event: "ping",
    onEvent: () => got.push("wfi2_app"),
  });

  // Throwing listener does not break delivery to other subscribers.
  assert.equal(
    registry.dispatchAppEvent({ app: APP_A, event: "ping", payload: {} }),
    2,
  );
  assert.deepStrictEqual(errors, [sub1]);
  assert.deepStrictEqual(got, ["wfi2_app"]);

  // Unsubscribe single subscription.
  assert.equal(registry.unsubscribe(sub1), true);
  assert.equal(registry.unsubscribe(sub1), false);
  assert.equal(registry.hasSessionSubscribers(), true);

  // Unsubscribe entire instance removes remaining subscriptions of WFI_1 only.
  assert.equal(registry.unsubscribeInstance(WFI_1), 1);
  assert.equal(registry.unsubscribeInstance(WFI_1), 0);
  assert.equal(registry.hasSessionSubscribers(), false);
  assert.equal(registry.unsubscribe(sub2), false);

  // WFI_2 still receives events until unsubscribed.
  got.length = 0;
  assert.equal(
    registry.dispatchAppEvent({ app: APP_A, event: "ping", payload: {} }),
    1,
  );
  assert.deepStrictEqual(got, ["wfi2_app"]);
  assert.equal(registry.unsubscribe(sub3), true);
  assert.equal(registry.hasAppSubscribers(APP_A, "ping"), false);
});
