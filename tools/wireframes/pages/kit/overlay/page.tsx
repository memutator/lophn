// Kit · overlay. @lophn/ui/overlay의 Popover·Tooltip·Toast, 같은 CSS Module로 짠 Menu·Dialog·Sheet·Palette(look-alike)와
// 예제(overlays). Menu·Dialog·Sheet·Palette는 modal이라 열어 두면 page 전체가 잠겨서(Radix가 body를 inert로 만든다)
// stage 안에 정적으로 그린다.
import { Button, Icon, IconButton, Kbd } from "@lophn/ui/primitives";
import { Popover, PopoverRow, Toast, Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import {
  paletteIcons,
  workspaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import dialogStyles from "../../../../../packages/design/components/overlay/dialog/dialog.module.css";
import sheetStyles from "../../../../../packages/design/components/overlay/sheet/sheet.module.css";
import paletteStyles from "../../../../../packages/design/components/overlay/palette/palette.module.css";
import menuStyles from "../../../../../packages/design/components/overlay/menu/menu.module.css";
import { OverlayExample } from "./overlays.tsx";
import { Example, FROZEN_TIMER, kit, Page, Section, Stage } from "../kit.tsx";

const NOOP = () => {};

export function KitOverlay() {
  const item = (label: string, group: string, hint?: string) => ({
    label,
    group,
    hint,
  });
  const rows = [
    item("Projects", "Go to"),
    item("Things to confirm", "Go to", "G C"),
    item("exp-008-query-tools.md", "Documents"),
    item("Search phroner", "Actions", "Ctrl K"),
  ];
  const stop = { timer: FROZEN_TIMER, onClose: NOOP };
  return (
    <Page>
      <Section
        title="Menu"
        note="Radix 메뉴는 열면 page 전체가 inert가 되어서 같은 CSS Module로 짠 정적 모양이다. 위쪽 행이 highlight다."
      >
        <div className={kit.panel}>
          <div
            className={`${menuStyles.menu}`}
            role="menu"
            style={{ minWidth: "200px", display: "inline-block" }}
          >
            {["Open", "Open read-only", "Rename", "Move…", "Archive"].map((
              label,
              index,
            ) => (
              <div
                key={label}
                role="menuitem"
                className={menuStyles.item}
                data-highlighted={index === 0 ? "" : undefined}
                data-disabled={label === "Archive" ? "" : undefined}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </Section>
      <Section
        title="Popover and Tooltip"
        note="실제 component를 열어 둔 채로 아래 상자에 그린다."
      >
        <Stage height={220} center>
          {(container) => (
            <div className={kit.row} style={{ gap: "160px" }}>
              <Popover
                open
                container={container}
                trigger={<Button>Move to…</Button>}
              >
                <PopoverRow onSelect={NOOP}>Grocery budget</PopoverRow>
                <PopoverRow onSelect={NOOP}>Home office</PopoverRow>
                <PopoverRow onSelect={NOOP} disabled>phroner</PopoverRow>
              </Popover>
              <Tooltip open container={container} content="Split pane">
                <IconButton
                  icon={workspaceIcons.splitPane}
                  label="Split pane"
                />
              </Tooltip>
            </div>
          )}
        </Stage>
      </Section>
      <Section
        title="Dialog"
        note="modal. backdrop 위 dialog 층, 오른쪽 끝에 주 행동. 같은 CSS Module로 짠 정적 모양이다."
      >
        <Stage height={320}>
          {() => (
            <>
              <div className={dialogStyles.backdrop} />
              <div
                className={`${dialogStyles.dialog} ${dialogStyles.default}`}
                role="dialog"
              >
                <h2 className={dialogStyles.title}>Archive this project?</h2>
                <div className={dialogStyles.body}>
                  Its documents stay where they are. You can bring the project
                  back from Projects.
                </div>
                <div className={dialogStyles.actions}>
                  <Button>Cancel</Button>
                  <Button variant="danger">Archive</Button>
                </div>
              </div>
            </>
          )}
        </Stage>
      </Section>
      <Section
        title="Sheet"
        note="backdrop 없는 non-modal 패널. 같은 CSS Module로 짠 정적 모양이다."
      >
        <Stage height={320}>
          {() => (
            <div
              className={sheetStyles.sheet}
              role="dialog"
              style={{ width: "var(--dialog-width-default)" }}
            >
              <h2 className={dialogStyles.title}>Document details</h2>
              <div className={dialogStyles.body}>
                Version 3, saved 2 hours ago. 3 contexts include this document.
              </div>
              <div className={dialogStyles.actions}>
                <Button>Close</Button>
              </div>
            </div>
          )}
        </Stage>
      </Section>
      <Section
        title="Palette"
        note="폭 640px, 항목 36px, 묶음 이름 아래에 행이 모인다. 같은 CSS Module로 짠 정적 모양이다."
      >
        <Stage height={380}>
          {() => (
            <>
              <div className={dialogStyles.backdrop} />
              <div className={paletteStyles.palette} role="dialog">
                <label className={paletteStyles.title}>Command palette</label>
                <div className={paletteStyles.search}>
                  <Icon
                    icon={paletteIcons.search}
                    pixels={iconPixels("base")}
                    className={paletteStyles.icon}
                  />
                  <input
                    className={paletteStyles.input}
                    defaultValue="plan"
                    readOnly
                  />
                </div>
                <div className={paletteStyles.list} role="listbox">
                  {rows.map((row, index) => (
                    <div key={row.label} role="presentation">
                      {row.group !== rows[index - 1]?.group
                        ? <div className={paletteStyles.group}>{row.group}</div>
                        : null}
                      <div
                        role="option"
                        aria-selected={index === 1}
                        className={`${paletteStyles.item} ${
                          index === 1 ? paletteStyles.active : ""
                        }`}
                      >
                        <span className={paletteStyles.text}>
                          <span className={paletteStyles.label}>
                            {row.label}
                          </span>
                        </span>
                        {row.hint === undefined
                          ? null
                          : (
                            <span className={paletteStyles.hint}>
                              {row.hint}
                            </span>
                          )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className={paletteStyles.footer}>
                  <span className={paletteStyles.key}>
                    <Kbd keys={["↑", "↓"]} /> Move
                  </span>
                  <span className={paletteStyles.key}>
                    <Kbd keys={["↵"]} /> Open
                  </span>
                  <span className={paletteStyles.key}>
                    <Kbd keys={["Esc"]} /> Close
                  </span>
                </div>
              </div>
            </>
          )}
        </Stage>
      </Section>
      <Section
        title="Toast"
        note="행동은 최대 둘. 시간이 가지 않는 timer를 줘서 열린 채로 둔다. error는 시간으로 닫지 않는다."
      >
        <div className={kit.column}>
          <Toast title="Saved" duration="brief" {...stop} />
          <Toast
            title="1 Operator repeats a check here"
            actions={[{ id: "see", label: "See Operators" }]}
            {...stop}
          />
          <Toast
            title="eval: 2 documents don't match the contract"
            body="Open the Violations tab to see which ones."
            actions={[{ id: "view", label: "View" }, {
              id: "later",
              label: "Later",
            }]}
            {...stop}
          />
          <Toast
            title="Couldn't save the document"
            body="The folder isn't reachable."
            tone="error"
            actions={[{ id: "retry", label: "Try again" }]}
            {...stop}
          />
        </div>
      </Section>
      <Section
        title="overlays"
        note="tooltip·popover·menu·dialog·toast를 여는 단추들이다. 눌러 열어 볼 수 있다."
      >
        <Example>
          <div className={kit.panel}>
            <OverlayExample />
          </div>
        </Example>
      </Section>
    </Page>
  );
}
