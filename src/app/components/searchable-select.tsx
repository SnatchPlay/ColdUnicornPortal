import { useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";

export interface SearchableOption {
  id: string;
  name: string;
}

/** A single-select whose search happens **in the trigger itself**: closed it reads like any other
 *  field, open it turns into the search box and the panel below holds only the list. One row, no
 *  second input.
 *
 *  Built on `Popover` rather than `Select` for two reasons: Radix's Select owns the keyboard for
 *  its own typeahead (a text field inside it fights the component), and its trigger cannot become
 *  an input. The trigger renders the selected option from `value`, never from the filtered list,
 *  so a narrow search can never blank it. */
export function SearchableSelect({
  value,
  onChange,
  options,
  label,
  placeholder,
  searchPlaceholder = "Search",
  emptyText = "Nothing to choose from.",
  disabled = false,
}: {
  value: string | null;
  onChange: (value: string) => void;
  options: SearchableOption[];
  /** Accessible name of the field. */
  label: string;
  placeholder: string;
  searchPlaceholder?: string;
  /** Shown when there is nothing to choose from at all (still loading, or an empty account). */
  emptyText?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const selected = options.find((option) => option.id === value) ?? null;
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.name.toLowerCase().includes(needle));
  }, [options, query]);

  // The trigger and the input are the same box, so they must not drift apart.
  const boxClass =
    "flex h-auto w-full items-center justify-between gap-2 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-left text-sm text-white outline-none transition focus-within:border-sky-400/40 focus:border-sky-400/40 disabled:cursor-not-allowed disabled:opacity-50";

  function close() {
    setOpen(false);
    setQuery("");
  }

  function moveHighlight(delta: number) {
    if (matches.length === 0) return;
    const next = Math.min(Math.max(highlighted + delta, 0), matches.length - 1);
    setHighlighted(next);
    listRef.current?.querySelectorAll('[role="option"]')[next]?.scrollIntoView({ block: "nearest" });
  }

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverAnchor asChild>
        <div ref={anchorRef}>
          {open ? (
            <div className={boxClass}>
              <input
                autoFocus
                type="text"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-label={searchPlaceholder}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setHighlighted(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") { event.preventDefault(); moveHighlight(1); }
                  else if (event.key === "ArrowUp") { event.preventDefault(); moveHighlight(-1); }
                  else if (event.key === "Enter") {
                    event.preventDefault();
                    const option = matches[highlighted];
                    if (option) { onChange(option.id); close(); }
                  } else if (event.key === "Escape" || event.key === "Tab") {
                    close(); // the input lives outside the popover, so Radix never sees these
                  }
                }}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-neutral-500"
              />
              <ChevronDown className="size-4 shrink-0 rotate-180 opacity-50" />
            </div>
          ) : (
            <button
              type="button"
              role="combobox"
              aria-expanded={false}
              aria-label={label}
              disabled={disabled}
              onClick={() => { setHighlighted(0); setOpen(true); }}
              className={boxClass}
            >
              <span className={selected ? "truncate" : "truncate text-neutral-500"}>
                {selected ? selected.name : placeholder}
              </span>
              <ChevronDown className="size-4 shrink-0 opacity-50" />
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={6}
        // Focus stays in the trigger-turned-input, which lives outside this content.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
        onFocusOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
        className="w-(--radix-popover-trigger-width) rounded-xl border-[#242424] bg-[#050505] p-1 text-white"
      >
        {/* Not `aria-label={label}` — that would give the list the same accessible name as the
            field itself, and "the Client control" would then match two nodes. */}
        <div ref={listRef} id={listId} role="listbox" aria-label={`${label} options`} className="max-h-64 overflow-y-auto">
          {matches.length === 0 ? (
            // An empty list and a failed search are different things to say — `No match for “”`
            // is what you get when the options have not arrived yet.
            <p className="px-3 py-3 text-xs text-muted-foreground">
              {options.length === 0 ? emptyText : `No match for “${query.trim()}”.`}
            </p>
          ) : (
            matches.map((option, index) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === value}
                onClick={() => { onChange(option.id); close(); }}
                onMouseEnter={() => setHighlighted(index)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${
                  index === highlighted ? "bg-[#1a1a1a] text-white" : "text-neutral-200"
                }`}
              >
                <span className="truncate">{option.name}</span>
                {option.id === value ? <Check className="size-4 shrink-0 text-sky-300" /> : null}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
