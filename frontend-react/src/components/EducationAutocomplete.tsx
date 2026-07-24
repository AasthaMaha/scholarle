import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export type AutocompleteOption = {
  id: string;
  label: string;
  secondary?: string;
  institutionType?: "high_school" | "postsecondary";
  location?: string;
  cipCode?: string;
};

export function EducationAutocomplete({
  value,
  placeholder,
  minimumCharacters = 1,
  search,
  onSelect,
  fallbackOption,
  pinnedOptions = [],
  noResultsText = "No matches found.",
  ariaLabel,
  accent = "primary",
}: {
  value: string;
  placeholder: string;
  minimumCharacters?: number;
  search: (query: string, signal: AbortSignal) => Promise<AutocompleteOption[]>;
  onSelect: (option: AutocompleteOption, query: string) => void;
  fallbackOption?: AutocompleteOption;
  pinnedOptions?: AutocompleteOption[];
  noResultsText?: string;
  ariaLabel: string;
  accent?: "primary" | "info";
}) {
  const [query, setQuery] = useState(value);
  const [results, setResults] = useState<AutocompleteOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef(search);

  useEffect(() => setQuery(value), [value]);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);
  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!open || trimmed.length < minimumCharacters) {
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        setResults(await searchRef.current(trimmed, controller.signal));
      } catch (searchError) {
        if (!(searchError instanceof DOMException && searchError.name === "AbortError")) {
          setResults([]);
          setError(searchError instanceof Error ? searchError.message : "Search is temporarily unavailable.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [minimumCharacters, open, query]);

  const resultLimit = Math.max(0, 10 - pinnedOptions.length - (fallbackOption ? 1 : 0));
  const options = [...pinnedOptions, ...results.slice(0, resultLimit), ...(fallbackOption ? [fallbackOption] : [])];
  const inputTone = accent === "info"
    ? "border-info/15 bg-white hover:border-info/30 focus:border-info/60 focus:ring-info/20"
    : "border-border bg-background focus:ring-primary/40";
  const menuTone = accent === "info" ? "border-info/15 shadow-[0_18px_44px_-28px_rgba(31,42,68,0.38)]" : "border-border shadow-xl";
  const optionTone = (active: boolean) => accent === "info"
    ? active ? "bg-info/[0.08] text-foreground" : "hover:bg-info/[0.05]"
    : active ? "bg-accent" : "hover:bg-accent";

  function choose(option: AutocompleteOption) {
    onSelect(option, query);
    setQuery(option.label);
    setOpen(false);
    setActiveIndex(-1);
  }

  return (
    <div ref={containerRef} className="relative mt-5">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          autoFocus
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.min(index + 1, options.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && open && activeIndex >= 0) {
              event.preventDefault();
              choose(options[activeIndex]);
            } else if (event.key === "Escape") {
              setOpen(false);
              setActiveIndex(-1);
            }
          }}
          placeholder={placeholder}
          className={`w-full rounded-lg border py-3 pl-9 pr-10 text-sm text-foreground outline-none transition-colors focus:ring-2 ${inputTone}`}
        />
        <button
          type="button"
          aria-label={open ? "Close suggestions" : "Open suggestions"}
          onClick={() => {
            setOpen((current) => !current);
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <div id={listboxId} role="listbox" className={`relative z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border bg-popover p-1.5 ${menuTone}`}>
          {query.trim().length < minimumCharacters && (
            <p className="px-3 py-2.5 text-sm text-muted-foreground">
              Enter at least {minimumCharacters} character{minimumCharacters === 1 ? "" : "s"} to search.
            </p>
          )}
          {loading && (
            <p className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground" role="status">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> Searching…
            </p>
          )}
          {error && (
            <p className="px-3 py-2.5 text-sm text-destructive" role="status">{error}</p>
          )}
          {!loading && !error && query.trim().length >= minimumCharacters && results.length === 0 && (
            <p className="px-3 py-2.5 text-sm text-muted-foreground" role="status">{noResultsText}</p>
          )}
          {options.length > 0 && (
            <div>
              {options.map((option, index) => (
                <button
                  key={option.id}
                  id={`${listboxId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={activeIndex === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${optionTone(activeIndex === index)}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {option.label}
                      {option.secondary && <span className="font-normal text-muted-foreground"> — {option.secondary}</span>}
                    </span>
                  </span>
                  {value === option.label && <Check className={`size-4 shrink-0 ${accent === "info" ? "text-info" : "text-primary"}`} aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
