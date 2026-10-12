import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import {
  click,
  render,
  settle,
} from "../../../../../design/components/testing.ts";
import type {
  ConfirmationFrameApi,
  ConfirmationView,
  SubmitResult,
} from "../../frame/api.ts";
import { ConfirmationScreen } from "../../screen.tsx";
import { CONNECTION_REVOKE } from "./connection-revoke.tsx";

const CAC = "cac_01arz3ndektsv4rrffq69g5fav";

type Sent = Parameters<ConfirmationFrameApi["submit"]>[0];

function fakeApi(view: ConfirmationView, result?: SubmitResult) {
  const sent: Sent[] = [];
  let cancelled = 0;
  const api: ConfirmationFrameApi = {
    getDisplay: () => Promise.resolve(view),
    submit: (input) => {
      sent.push(input);
      return Promise.resolve(
        result ?? {
          outcome: "decided",
          receipt: { kind: "entity", id: CAC },
          result: "applied",
        },
      );
    },
    cancel: () => {
      cancelled += 1;
      return Promise.resolve({ outcome: "dismissed" });
    },
  };
  return { api, sent, cancelled: () => cancelled };
}

function revoke(
  extra: Record<string, unknown> = {},
  decisions: string[] = [CONNECTION_REVOKE],
): ConfirmationView {
  return {
    displayId: "dsp_1",
    request: {
      kind: "owner_decision",
      concern: "coding-agent/connection",
      decision: CONNECTION_REVOKE,
      targets: [CAC],
      input: {
        kind: "inline",
        value: { connection: CAC, base_revision: "7" },
      },
      comparison: { base_revision: "7" },
    },
    view: {
      kind: "connection_revoke",
      label: "Desk Claude",
      scope: "all",
      app: null,
      app_name: null,
      connection: CAC,
      revoked: false,
      ...extra,
    },
    decisions,
  };
}

async function show(api: ConfirmationFrameApi) {
  const view = render(<ConfirmationScreen api={api} theme={{}} />);
  await settle();
  return view;
}

function find(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector(selector);
  assert(found !== null, `no ${selector}`);
  return found as HTMLElement;
}

Deno.test("coding-agent/connection#R2, flow manage-coding-access 2: 회수 창은 정확한 연결 이름과 범위를 묻고 lophn 접근만 끊는다고 말한다", async () => {
  const { api } = fakeApi(revoke());
  using view = await show(api);
  assertEquals(
    find(view.container, "h1").textContent,
    "Revoke this connection?",
  );
  assertEquals(
    find(view.container, "[data-focus=first]").textContent,
    "Desk Claude",
  );
  const text = view.container.textContent ?? "";
  assertStringIncludes(text, "stops accepting requests from this connection");
  // 이미 떠 있는 외부 프로세스·파일 편집을 멈춘다고 말하지 않는다(connection#R18).
  assertStringIncludes(text, "keeps running");
  assertStringIncludes(
    find(view.container, "details").textContent ?? "",
    "All apps",
  );
});

Deno.test("coding-agent/connection#R2: 앱 하나 범위는 앱 이름을 보이고 이름을 모르면 앱 ID를 보인다", async () => {
  {
    const { api } = fakeApi(
      revoke({ scope: "app", app: "app_x", app_name: "Grocery budget" }),
    );
    using view = await show(api);
    assertStringIncludes(
      find(view.container, "details").textContent ?? "",
      "Only Grocery budget",
    );
  }
  {
    const { api } = fakeApi(
      revoke({ scope: "app", app: "app_x", app_name: null }),
    );
    using view = await show(api);
    assertStringIncludes(
      find(view.container, "details").textContent ?? "",
      "Only app_x",
    );
  }
});

Deno.test("shell/confirmation-window#R4, platform/approvals#R9: 결정 버튼은 입력 없이 결정 이름 하나만 보내고 닫기는 회수가 아니다", async () => {
  {
    const { api, sent, cancelled } = fakeApi(revoke());
    using view = await show(api);
    click(find(view.container, "[data-decision]"));
    await settle();
    assertEquals(sent.length, 1);
    assertEquals(sent[0].decision, CONNECTION_REVOKE);
    assertEquals(sent[0].input, undefined);
    assertEquals(cancelled(), 0);
    assertStringIncludes(
      view.container.textContent ?? "",
      "no longer accepts this connection",
    );
  }
  {
    const { api, sent, cancelled } = fakeApi(revoke());
    using view = await show(api);
    click(find(view.container, "[data-action='cancel']"));
    await settle();
    assertEquals(sent, []);
    assertEquals(cancelled(), 1);
  }
});

Deno.test("shell/confirmation-window#R5: 이미 회수된 연결에는 결정 버튼이 없고 이유만 있다", async () => {
  const { api } = fakeApi(revoke({ revoked: true }, []));
  using view = await show(api);
  assertEquals(view.container.querySelector("[data-decision]"), null);
  assertStringIncludes(view.container.textContent ?? "", "already revoked");
  assert(view.container.querySelector("[data-action='cancel']") !== null);
});
