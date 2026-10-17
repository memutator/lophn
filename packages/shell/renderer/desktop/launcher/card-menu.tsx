import type { LucideIcon } from "lucide-react";
import { IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";
import { launcherIcons } from "../../icons/mod.ts";

interface CardMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface CardMenuProps {
  /** 카드 이름. 단추의 이름에 들어가 어느 카드의 메뉴인지 말한다. */
  name: string;
  items: readonly CardMenuItem[];
  onSelect: (id: string) => void;
}

// 카드 오른쪽 위의 ⋯ 메뉴. 카드 전체가 여는 단추라서 이 단추는 그 위(cardAside)에 놓는다.
export function CardMenu({ name, items, onSelect }: CardMenuProps) {
  const label = t("launcher.button.more", { name });
  return (
    <Menu
      trigger={
        <IconButton
          icon={launcherIcons.more}
          label={label}
          size="sm"
          data-card-menu=""
        />
      }
      items={items.map((item) => ({
        id: item.id,
        label: item.label,
        data: { "data-menu-item": item.id },
        leading: <MenuIcon icon={item.icon} />,
      }))}
      onSelect={onSelect}
    />
  );
}
