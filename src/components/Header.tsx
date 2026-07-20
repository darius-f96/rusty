import React from "react";
import { HeaderView } from "./Header.view";
import { ProviderQuotaControl } from "./ProviderQuotaControl";

interface HeaderProps {
  onSearchOpen: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onSearchOpen }) => {
  return <HeaderView onSearchOpen={onSearchOpen} quotaControl={<ProviderQuotaControl />} />;
};
