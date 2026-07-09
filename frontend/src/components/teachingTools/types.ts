import React from "react";

export interface ToolProps {
  show: boolean;
  onClose: () => void;
  zCounterRef: React.MutableRefObject<number>;
}
