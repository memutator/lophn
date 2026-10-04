import { assert, assertEquals } from "@std/assert";
import { Window } from "happy-dom";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";

import type { ConfirmationFrameApi, ConfirmationView } from "./frame/api.ts";
import { ConfirmationFrame } from "./frame/frame.tsx";

function installDom(): Window {
  const dom = new Window();
  const g = globalThis as unknown as Record<string, unknown>;
  g["window"] = dom;
  g["document"] = dom.document;
  g["HTMLElement"] = dom.HTMLElement;
  g["KeyboardEvent"] = dom.KeyboardEvent;
  g["Node"] = dom.Node;
  return dom;
}

function click(dom: Window, selector: string): void {
  const node = dom.document.querySelector(selector);
  if (node !== null && "click" in node) {
    (node as { click(): void }).click();
  }
}

function view(state: "ready" | "stale", second = false): ConfirmationView {
  return {
    displayId: "dsp_1",
    gate: {
      state,
      decisions: state === "ready" ? ["grant_approval_request"] : undefined,
      second,
      reason: state === "stale" ? "changed" : undefined,
    },
    display: state === "ready"
      ? {
        titleKey: "confirmation-window.frame.title",
        bodyKey: "confirmation-window.frame.body",
      }
      : null,
  };
}

async function render(state: "ready" | "stale" = "ready", second = false) {
  const dom = installDom();
  const submitted: { decision: string; confirmedSecond?: boolean }[] = [];
  const cancelled = { n: 0 };
  const api: ConfirmationFrameApi = {
    getDisplay: () => Promise.resolve(view(state, second)),
    submit: (input) => {
      submitted.push(input);
      return Promise.resolve({ ok: true });
    },
    cancel: () => {
      cancelled.n += 1;
      return Promise.resolve({ outcome: "dismissed" });
    },
  };
  const root = dom.document.createElement("div");
  dom.document.body.append(root);
  await act(() => {
    createRoot(root).render(
      createElement(ConfirmationFrame, {
        api,
        theme: { "--color-focus": "#1f6feb" },
      }),
    );
  });
  await act(() => api.getDisplay().then(() => undefined));
  return { dom, submitted, cancelled };
}

Deno.test("shell/confirmation-window#R4: 첫 화면은 설명이고 결정 버튼이 기본 선택이 아니다", async () => {
  const { dom } = await render();
  const heading = dom.document.querySelector("h1");
  const decision = dom.document.querySelector("[data-decision]");
  assert(heading !== null);
  assertEquals(decision?.getAttribute("autofocus"), null);
  assertEquals(
    dom.document.querySelector("p")?.getAttribute("data-copy") !== null,
    true,
  );
});

Deno.test("shell/confirmation-window#R4: Enter는 제출하지 않고 Escape·닫기는 결정이 아니다", async () => {
  const { dom, submitted, cancelled } = await render();
  dom.document.dispatchEvent(
    new dom.KeyboardEvent("keydown", { key: "Enter" }),
  );
  assertEquals(submitted.length, 0);
  dom.document.dispatchEvent(
    new dom.KeyboardEvent("keydown", { key: "Escape" }),
  );
  click(dom, "[data-action=cancel]");
  await act(() => Promise.resolve());
  assert(cancelled.n >= 1);
  assertEquals(submitted.length, 0);
});

Deno.test("shell/confirmation-window#R4: 2차 확인은 별도 단계이고 그 전엔 제출하지 않는다", async () => {
  const { dom, submitted } = await render("ready", true);
  click(dom, "[data-decision]");
  await act(() => Promise.resolve());
  assertEquals(submitted.length, 0);
  assertEquals(
    dom.document.querySelector("[data-state]")?.getAttribute("data-state"),
    "second",
  );
});

Deno.test("shell/confirmation-window#R5: 대상이 바뀌면 옛 결정 버튼이 없다", async () => {
  const { dom } = await render("stale");
  assertEquals(dom.document.querySelectorAll("[data-decision]").length, 0);
  assert(dom.document.querySelector("[data-action=refresh]") !== null);
});

Deno.test("shell/confirmation-window#R7: 화면은 slot·fork 없이 검증된 token만 style로 쓴다", async () => {
  const { dom } = await render();
  const frame = dom.document.querySelector(".confirmation-frame");
  assert(frame !== null && "style" in frame);
  assertEquals(
    (frame as { style: { getPropertyValue(name: string): string } }).style
      .getPropertyValue("--color-focus"),
    "#1f6feb",
  );
  assertEquals(frame.getAttribute("data-slot"), null);
  assertEquals(frame.getAttribute("data-fork"), null);
});
