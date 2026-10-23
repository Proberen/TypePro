export function installListEditing(options: {
  field: HTMLElement;
  transact: (mutate: () => boolean) => boolean;
}): () => void;
