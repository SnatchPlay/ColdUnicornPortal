// Tiny external store that broadcasts the currently-selected client id and
// column id to per-row `useSyncExternalStore` subscribers without re-rendering
// the surrounding table.
//
// Used to decouple the row/cell highlight from the React props of
// `ClientsMegaTable`, so the table itself does not re-render when the drawer
// opens / closes.

export type SelectionState = { clientId: string | null; colId: string | null };

export type SelectionStore = {
  get(): SelectionState;
  set(state: SelectionState): void;
  subscribe(listener: () => void): () => void;
};

export function createSelectionStore(): SelectionStore {
  let value: SelectionState = { clientId: null, colId: null };
  const listeners = new Set<() => void>();
  return {
    get() {
      return value;
    },
    set(next) {
      if (value.clientId === next.clientId && value.colId === next.colId) return;
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
