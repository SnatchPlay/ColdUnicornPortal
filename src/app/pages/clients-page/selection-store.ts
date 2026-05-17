// Tiny external store that broadcasts the currently-selected client id to
// per-row `useSyncExternalStore` subscribers without re-rendering the
// surrounding table.
//
// Used to decouple the row-highlight subscription from the React props of
// `ClientsMegaTable`, so the table itself does not re-render when the drawer
// opens / closes.

export type SelectionStore = {
  get(): string | null;
  set(id: string | null): void;
  subscribe(listener: () => void): () => void;
};

export function createSelectionStore(): SelectionStore {
  let value: string | null = null;
  const listeners = new Set<() => void>();
  return {
    get() {
      return value;
    },
    set(next) {
      if (value === next) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
