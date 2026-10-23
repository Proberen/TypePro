import { useEffect, useRef } from 'react';
import { openFlowDesigner } from './designer.js';
import './flow.css';

export interface FlowDesignerProps {
  source?: string;
  onSave: (source: string) => void;
  onClose: () => void;
}

/** Keep canvas interaction outside React reconciliation; its modal has one owner. */
export default function FlowDesigner({ source, onSave, onClose }: FlowDesignerProps) {
  const callbacks = useRef({ onSave, onClose });
  callbacks.current = { onSave, onClose };
  useEffect(() => {
    const designer = openFlowDesigner({
      source,
      onSave: async (value) => {
        await callbacks.current.onSave(value);
        callbacks.current.onClose();
      },
      onClose: () => callbacks.current.onClose(),
    });
    return () => designer.destroy();
  }, [source]);
  return null;
}
