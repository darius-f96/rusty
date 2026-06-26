import React from "react";
import { GitHistoryTabContent } from "../GitHistoryTabContent";

interface GitHistoryTabProps {
  tab?: any;
}

export const GitHistoryTab: React.FC<GitHistoryTabProps> = ({ tab }) => {
  return <GitHistoryTabContent tab={tab} />;
};
