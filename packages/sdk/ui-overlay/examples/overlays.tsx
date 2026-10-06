// 앱 화면 예: 여섯 overlay를 각각 연다. 모두 앱 view 안에 그린다.
import { useState } from "react";
import { Info } from "lucide-react";
import { Button, IconButton } from "@lophn/ui-control";
import {
  type Clock,
  Dialog,
  Menu,
  Palette,
  Popover,
  PopoverRow,
  type Timer,
  ToastProvider,
  Tooltip,
  useToast,
} from "@lophn/ui-overlay";

// 앱이 자기 catalog에서 가져오는 문구 자리다.
const TEXT = {
  about: "About this list",
  aboutBody: "Orders from the last 30 days.",
  filter: "Filter",
  open: "Open orders",
  closed: "Closed orders",
  more: "More",
  export: "Export",
  archive: "Archive",
  rename: "Rename",
  renameBody: "Give this list a new name.",
  cancel: "Cancel",
  commands: "Commands",
  search: "Search commands",
  refresh: "Refresh orders",
  save: "Save",
  saved: "List saved",
};

export interface OverlayExampleProps {
  // 테스트가 tooltip 지연·toast 시간을 바꿔 끼운다.
  timer?: Timer;
  clock?: Clock;
}

export function OverlayExample({ timer, clock }: OverlayExampleProps) {
  return (
    <ToastProvider timer={timer} clock={clock}>
      <Overlays timer={timer} />
    </ToastProvider>
  );
}

function Overlays({ timer }: { timer?: Timer }) {
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [palette, setPalette] = useState(false);
  return (
    <div>
      <Tooltip content={TEXT.aboutBody} timer={timer}>
        <IconButton icon={Info} label={TEXT.about} />
      </Tooltip>
      <Popover trigger={<Button>{TEXT.filter}</Button>}>
        <PopoverRow onSelect={() => {}}>{TEXT.open}</PopoverRow>
        <PopoverRow onSelect={() => {}}>{TEXT.closed}</PopoverRow>
      </Popover>
      <Menu
        trigger={<Button>{TEXT.more}</Button>}
        items={[
          { id: "export", label: TEXT.export },
          { id: "archive", label: TEXT.archive },
        ]}
        onSelect={() => {}}
      />
      <Button onClick={() => setRenaming(true)}>{TEXT.rename}</Button>
      <Dialog
        open={renaming}
        onOpenChange={setRenaming}
        title={TEXT.rename}
        actions={
          <Button onClick={() => setRenaming(false)}>{TEXT.cancel}</Button>
        }
      >
        {TEXT.renameBody}
      </Dialog>
      <Button onClick={() => setPalette(true)}>{TEXT.commands}</Button>
      <Palette
        open={palette}
        onOpenChange={setPalette}
        title={TEXT.search}
        items={[{ id: "refresh", label: TEXT.refresh }]}
        onSelect={() => setPalette(false)}
      />
      <Button
        variant="primary"
        onClick={() => toast.show({ title: TEXT.saved, duration: "brief" })}
      >
        {TEXT.save}
      </Button>
    </div>
  );
}
