export function openFlowDesigner(options: {
  source?: string;
  onSave: (source: string) => void | Promise<void>;
  onClose: () => void;
}): { destroy: () => void };
