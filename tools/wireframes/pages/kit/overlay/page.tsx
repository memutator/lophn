// Kit · overlay. @lophn/ui/overlay의 모든 component를 실제로 그린다. 닫혀 있다가 열리는 modal(Menu·Dialog·Palette)은
// 열면 page 전체가 inert가 되어 Light·Dark 단추까지 막히므로 단추로 연다. 열린 면은 Stage 상자 안에 그린다.
import { type ReactNode, useState } from "react";
import {
  FileText,
  Minimize2,
  PanelTop,
  RotateCcw,
  RotateCw,
  X,
} from "lucide-react";
import { t } from "@lophn/i18n";
import { Button, FileIcon, Icon, IconButton } from "@lophn/ui/primitives";
import {
  Dialog,
  FloatPanel,
  ImagePreview,
  Menu,
  MenuIcon,
  Palette,
  type PaletteItem,
  Popover,
  PopoverRow,
  Sheet,
  Toast,
  ToastStack,
  Tooltip,
} from "@lophn/ui/overlay";
import {
  paletteIcons,
  workspaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import { OverlayExample } from "./overlays.tsx";
import {
  Example,
  FROZEN_TIMER,
  kit,
  Page,
  Row,
  Section,
  Stage,
} from "../kit.tsx";

const NOOP = () => {};
const stop = { timer: FROZEN_TIMER, onClose: NOOP };

const PALETTE_ITEMS: readonly PaletteItem[] = [
  {
    id: "projects",
    label: "Projects",
    group: "Go to",
    icon: paletteIcons.project,
  },
  {
    id: "confirm",
    label: "Things to confirm",
    group: "Go to",
    hint: "G C",
    icon: paletteIcons.bookmark,
  },
  {
    id: "doc",
    label: "exp-008-query-tools.md",
    group: "Documents",
    detail: "Grocery budget",
    icon: paletteIcons.document,
  },
  {
    id: "search",
    label: "Search phroner",
    group: "Actions",
    hint: "Ctrl K",
    icon: paletteIcons.search,
  },
];

// 단추를 누르면 열리는 modal 하나. 닫으면 inert가 풀린다.
function Opens({
  label,
  children,
}: {
  label: string;
  children: (open: boolean, setOpen: (open: boolean) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      {children(open, setOpen)}
    </>
  );
}

function Close({ onClick }: { onClick: () => void }) {
  return <Button onClick={onClick}>Close</Button>;
}

export function KitOverlay() {
  return (
    <Page>
      <Section
        title="Tooltip"
        note="hover·focus에 잠깐 뜨는 짧은 설명. 열어 둔 채로 아래 상자에 그린다."
      >
        <Stage height={140} center>
          {(container) => (
            <Tooltip open container={container} content="Split pane">
              <IconButton icon={workspaceIcons.splitPane} label="Split pane" />
            </Tooltip>
          )}
        </Stage>
      </Section>
      <Section
        title="Popover and PopoverRow"
        note="눌러서 여는 작은 면. PopoverRow는 고를 수 있는 한 줄이고 disabled도 있다."
      >
        <Stage height={200} center>
          {(container) => (
            <Popover
              open
              container={container}
              trigger={<Button>Move to…</Button>}
            >
              <PopoverRow onSelect={NOOP}>Grocery budget</PopoverRow>
              <PopoverRow onSelect={NOOP}>Home office</PopoverRow>
              <PopoverRow onSelect={NOOP} disabled>
                phroner
              </PopoverRow>
            </Popover>
          )}
        </Stage>
      </Section>
      <Section
        title="Menu and MenuIcon"
        note="행동 목록. 단추로 연다. 왼쪽은 글만, 오른쪽은 항목 앞에 MenuIcon(design 아이콘, FileIcon)을 놓고 한 항목은 disabled다."
      >
        <Stage height={240} center>
          {(container) => (
            <div className={kit.row} style={{ gap: "var(--space-8)" }}>
              <Menu
                container={container}
                trigger={<Button>Plain menu</Button>}
                items={[
                  { id: "open", label: "Open" },
                  { id: "rename", label: "Rename" },
                  { id: "archive", label: "Archive", disabled: true },
                ]}
                onSelect={NOOP}
              />
              <Menu
                container={container}
                trigger={<Button>Menu with icons</Button>}
                items={[
                  {
                    id: "open",
                    label: "Open",
                    leading: <MenuIcon icon={paletteIcons.document} />,
                  },
                  {
                    id: "file",
                    label: "notes.md",
                    leading: (
                      <MenuIcon>
                        <FileIcon name="notes.md" />
                      </MenuIcon>
                    ),
                  },
                  {
                    id: "trash",
                    label: "Move to trash",
                    leading: <MenuIcon icon={workspaceIcons.trash} />,
                    disabled: true,
                  },
                ]}
                onSelect={NOOP}
              />
            </div>
          )}
        </Stage>
      </Section>
      <Section
        title="Dialog"
        note="작업을 멈추고 답을 받는 modal. 단추로 연다. default·wide 폭과 행동 줄 유무를 본다."
      >
        <Stage height={320} center>
          {(container) => (
            <div className={kit.row}>
              <Opens label="Default with actions">
                {(open, setOpen) => (
                  <Dialog
                    open={open}
                    onOpenChange={setOpen}
                    container={container}
                    title="Archive this project?"
                    actions={
                      <>
                        <Close onClick={() => setOpen(false)} />
                        <Button variant="danger" onClick={() => setOpen(false)}>
                          Archive
                        </Button>
                      </>
                    }
                  >
                    Its documents stay where they are. You can bring the project
                    back from Projects.
                  </Dialog>
                )}
              </Opens>
              <Opens label="Wide">
                {(open, setOpen) => (
                  <Dialog
                    open={open}
                    onOpenChange={setOpen}
                    container={container}
                    width="wide"
                    title="Agent run"
                    actions={<Close onClick={() => setOpen(false)} />}
                  >
                    Wide fits longer text, such as a run log or a diff that
                    needs more room to read.
                  </Dialog>
                )}
              </Opens>
              <Opens label="Without actions">
                {(open, setOpen) => (
                  <Dialog
                    open={open}
                    onOpenChange={setOpen}
                    container={container}
                    title="Saved"
                  >
                    Press Escape to close.
                  </Dialog>
                )}
              </Opens>
            </div>
          )}
        </Stage>
      </Section>
      <Section
        title="ImagePreview"
        note="그림 하나를 크게 본다. 단추로 연다. 바깥이나 Esc나 [x]로 닫는다."
      >
        <Stage height={320} center>
          {(container) => (
            <Opens label="Open image">
              {(open, setOpen) => (
                <ImagePreview
                  src={
                    open
                      ? `data:image/svg+xml;utf8,${encodeURIComponent(
                          '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="480" height="300" fill="#2a78d6"/><circle cx="140" cy="130" r="60" fill="#fab219"/></svg>',
                        )}`
                      : null
                  }
                  alt="screenshot.png"
                  onClose={() => setOpen(false)}
                  container={container}
                />
              )}
            </Opens>
          )}
        </Stage>
      </Section>
      <Section
        title="Sheet"
        note="backdrop 없는 non-modal 면이라 열어 둔 채로 아래 상자에 그린다. default·wide 폭."
      >
        <Row label="default">
          <div style={{ width: "100%" }}>
            <Stage height={280}>
              {(container) => (
                <Sheet
                  open
                  onOpenChange={NOOP}
                  container={container}
                  title="Document details"
                  actions={<Button>Close</Button>}
                >
                  Version 3, saved 2 hours ago. 3 notes link to this document.
                </Sheet>
              )}
            </Stage>
          </div>
        </Row>
        <Row label="wide">
          <div style={{ width: "100%" }}>
            <Stage height={280}>
              {(container) => (
                <Sheet
                  open
                  onOpenChange={NOOP}
                  container={container}
                  width="wide"
                  title="Document details"
                  actions={<Button>Close</Button>}
                >
                  Version 3, saved 2 hours ago. 3 notes link to this document.
                </Sheet>
              )}
            </Stage>
          </div>
        </Row>
      </Section>
      <Section
        title="FloatPanel"
        note="부모 안에서 옮기고 크기를 바꾸는 패널 껍데기. 끌기 논리는 없어서 여기서는 손으로 끌리지 않는다. 위쪽이 active(위 bar 강조선이 focus 색), 아래쪽이 inactive. 가장자리 여덟 군데에 resize 손잡이가 겹쳐 있다."
      >
        <Stage height={360}>
          {() => (
            <>
              <FloatPanel
                title="Other notes"
                icon={<Icon icon={FileText} pixels={14} />}
                x={500}
                y={150}
                width={380}
                height={200}
              >
                <div style={{ padding: "var(--space-4)" }}>
                  Version 3, saved 2 hours ago.
                </div>
              </FloatPanel>
              <FloatPanel
                title="notes.md"
                icon={<FileIcon name="notes.md" />}
                x={40}
                y={24}
                width={420}
                height={220}
                active
                actions={
                  <>
                    <IconButton
                      icon={Minimize2}
                      label={t("project-workspace.button.float-minimize")}
                      size="sm"
                    />
                    <IconButton
                      icon={PanelTop}
                      label={t("project-workspace.button.float-dock")}
                      size="sm"
                    />
                    <IconButton
                      icon={X}
                      label={t("project-workspace.button.float-close")}
                      size="sm"
                    />
                  </>
                }
              >
                <div style={{ padding: "var(--space-4)" }}>
                  Version 3, saved 2 hours ago. 3 notes link to this document.
                </div>
              </FloatPanel>
            </>
          )}
        </Stage>
      </Section>
      <Section
        title="Palette"
        note="검색해서 고르는 명령·이동 창. 단추로 연다. 항목이 있을 때와 항목이 없어 결과가 없다고 나올 때."
      >
        <Stage height={420} center>
          {(container) => (
            <div className={kit.row}>
              <Opens label="With items">
                {(open, setOpen) => (
                  <Palette
                    open={open}
                    onOpenChange={setOpen}
                    container={container}
                    title="Command palette"
                    items={PALETTE_ITEMS}
                    onSelect={() => setOpen(false)}
                  />
                )}
              </Opens>
              <Opens label="No results">
                {(open, setOpen) => (
                  <Palette
                    open={open}
                    onOpenChange={setOpen}
                    container={container}
                    title="Command palette"
                    items={[]}
                    onSelect={() => setOpen(false)}
                  />
                )}
              </Opens>
            </div>
          )}
        </Stage>
      </Section>
      <Section
        title="Toast"
        note="잠깐 뜨는 알림. neutral과 error, 행동 0~3개. 시간이 가지 않는 timer를 줘서 열린 채로 둔다. error는 시간으로 닫지 않는다."
      >
        <Row label="neutral">
          <Toast title="Saved" duration="brief" {...stop} />
        </Row>
        <Row label="1 action">
          <Toast
            title="1 agent repeats a check here"
            actions={[{ id: "see", label: "See agents" }]}
            {...stop}
          />
        </Row>
        <Row label="2 actions + body">
          <Toast
            title="eval: 2 documents don't match the contract"
            body="Open the Violations tab to see which ones."
            actions={[
              { id: "view", label: "View" },
              {
                id: "later",
                label: "Later",
              },
            ]}
            {...stop}
          />
        </Row>
        <Row label="lead + action">
          <Toast
            title="Claude Code is waiting for you"
            lead={<Icon icon={FileText} pixels={16} />}
            actions={[{ id: "view", label: "View", variant: "primary" }]}
            {...stop}
          />
        </Row>
        <Row label="3 actions">
          <Toast
            title="Update ready"
            actions={[
              { id: "later", label: "Later" },
              { id: "notes", label: "Release notes" },
              {
                id: "restart",
                label: "Restart",
                icon: RotateCw,
                variant: "primary",
              },
            ]}
            {...stop}
          />
        </Row>
        <Row label="error">
          <Toast
            title="Couldn't save the document"
            body="The folder isn't reachable."
            tone="error"
            actions={[{ id: "retry", label: "Try again", icon: RotateCcw }]}
            {...stop}
          />
        </Row>
      </Section>
      <Section
        title="ToastStack"
        note="Toast들을 위쪽 가운데 층에 쌓는다. 아래 상자 위쪽 가운데를 본다. 행동 단추는 닫기 단추와 같은 오른쪽 끝이다."
      >
        <Stage height={300}>
          {() => (
            <ToastStack>
              <Toast title="Saved" duration="brief" {...stop} />
              <Toast
                title="Couldn't save the document"
                tone="error"
                actions={[{ id: "retry", label: "Try again" }]}
                {...stop}
              />
            </ToastStack>
          )}
        </Stage>
      </Section>
      <Section
        title="ToastProvider and useToast"
        note="앱 root에 둔 queue로 toast를 띄운다. Save를 누르면 아래 상자에 뜬다. tooltip·popover·menu·dialog·palette를 여는 단추들도 같이 있다."
      >
        <Example height={300}>
          <div className={kit.panel}>
            <OverlayExample />
          </div>
        </Example>
      </Section>
    </Page>
  );
}
