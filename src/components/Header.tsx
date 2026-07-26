import React from "react";
import { HeaderView } from "./Header.view";
import { ProviderQuotaControl } from "./ProviderQuotaControl";
import { useWorkspaceStore } from "../store";
import { formatShortcut } from "../preferences/shortcuts";

interface HeaderProps {
  onSearchOpen: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onSearchOpen }) => {
  const openSearchShortcut = useWorkspaceStore((state) => state.keyboardShortcuts.openSearch);
  return (
    <HeaderView
      onSearchOpen={onSearchOpen}
      searchShortcut={formatShortcut(openSearchShortcut)}
      quotaControl={<ProviderQuotaControl />}
    />
  );
};
