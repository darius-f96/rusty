import React, { useState, useEffect, useRef } from "react";
import { Search, X, File, AlignLeft, Info } from "lucide-react";
import { useWorkspaceStore } from "../store";
import { invoke } from "@tauri-apps/api/core";

interface SearchPaletteProps {
  onClose: () => void;
}

interface SearchMatch {
  path: string;
  name: string;
  line: number;
  content: string;
  is_content_match: boolean;
}

export const SearchPalette: React.FC<SearchPaletteProps> = ({ onClose }) => {
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const openTab = useWorkspaceStore((state) => state.openTab);

  const [query, setQuery] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [onClose]);

  // Execute search when inputs change (debounced)
  useEffect(() => {
    if (!rootPath) return;

    if (!query.trim()) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    setSearching(true);
    const delayDebounce = setTimeout(async () => {
      try {
        const matches: SearchMatch[] = await invoke("search_project", {
          rootDir: rootPath,
          query,
          matchCase,
          wholeWord,
          isRegex,
        });
        setResults(matches);
        setSelectedIndex(0);
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setSearching(false);
      }
    }, 150);

    return () => clearTimeout(delayDebounce);
  }, [query, matchCase, wholeWord, isRegex, rootPath]);

  // Select item action
  const handleSelectResult = (match: SearchMatch) => {
    openTab({
      id: `file_${match.path.replace(/[^a-zA-Z0-9]/g, "_")}`,
      type: "file",
      title: match.name,
      key: match.path,
      line: match.line > 0 ? match.line : undefined,
    });
    onClose();
  };

  // Keyboard navigation inside search results
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      if (results.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = results[selectedIndex];
        if (selected) {
          handleSelectResult(selected);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [results, selectedIndex, onClose]);

  // Group results by path for clean layout
  const groupedResults = results.reduce<Record<string, { name: string; items: SearchMatch[] }>>((acc, match) => {
    if (!acc[match.path]) {
      acc[match.path] = { name: match.name, items: [] };
    }
    acc[match.path].items.push(match);
    return acc;
  }, {});

  // Compute absolute item index in flat array for styling
  let currentFlatIndex = 0;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-start justify-center pt-[15vh] px-4 font-mono select-none">
      <div
        ref={containerRef}
        className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[65vh]"
      >
        {/* Top Search Area */}
        <div className="p-4 border-b border-[var(--border-color)] bg-black/25 flex items-center space-x-3">
          <Search size={16} className="text-[var(--text-muted)]" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search filenames and references..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-[var(--bg-app)] border border-[var(--border-color)] text-[var(--text-normal)] rounded-lg px-3 py-2 text-xs focus:border-[var(--accent-color)] focus:outline-none transition-all placeholder:text-[var(--text-muted)]/75"
          />

          {/* Search Filters */}
          <div className="flex items-center space-x-1.5">
            <button
              onClick={() => setMatchCase(!matchCase)}
              className={`px-2 py-1 border text-[10px] rounded font-bold cursor-pointer transition-all ${
                matchCase
                  ? "bg-[var(--accent-color)] border-[var(--accent-color)] text-white"
                  : "border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-normal)] hover:border-[var(--border-active)]"
              }`}
              title="Match Case (Aa)"
            >
              Aa
            </button>
            <button
              onClick={() => setWholeWord(!wholeWord)}
              className={`px-2 py-1 border text-[10px] rounded font-bold cursor-pointer transition-all ${
                wholeWord
                  ? "bg-[var(--accent-color)] border-[var(--accent-color)] text-white"
                  : "border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-normal)] hover:border-[var(--border-active)]"
              }`}
              title="Whole Word (W)"
            >
              W
            </button>
            <button
              onClick={() => setIsRegex(!isRegex)}
              className={`px-2 py-1 border text-[10px] rounded font-bold cursor-pointer transition-all ${
                isRegex
                  ? "bg-[var(--accent-color)] border-[var(--accent-color)] text-white"
                  : "border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-normal)] hover:border-[var(--border-active)]"
              }`}
              title="Use Regex (.*)"
            >
              .*
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-zinc-800/50 rounded transition-all cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto scrollbar-none p-3 space-y-4 min-h-[150px] max-h-[45vh]">
          {searching && (
            <div className="w-full py-8 flex items-center justify-center text-xs text-[var(--text-muted)] space-x-2">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-[var(--accent-color)] border-t-transparent animate-spin" />
              <span>Searching workspace...</span>
            </div>
          )}

          {!searching && results.length === 0 && (
            <div className="w-full py-10 flex flex-col items-center justify-center text-xs text-[var(--text-muted)] space-y-2">
              <AlignLeft size={24} className="text-zinc-600 mb-1" />
              <span>
                {query.trim() ? "No search results match." : "Type a query above to search files and reference contents."}
              </span>
            </div>
          )}

          {!searching &&
            Object.entries(groupedResults).map(([filePath, fileGroup]) => {
              const relPath = rootPath ? filePath.replace(rootPath, "") : filePath;
              return (
                <div key={filePath} className="rounded-lg overflow-hidden border border-[var(--border-color)]/50 bg-black/10">
                  {/* File Header */}
                  <div className="px-3 py-1.5 bg-black/20 border-b border-[var(--border-color)]/30 flex items-center space-x-2 text-[10px]">
                    <File size={12} className="text-[var(--accent-color)]" />
                    <span className="font-bold text-[var(--text-light)]">{fileGroup.name}</span>
                    <span className="text-[9px] text-[var(--text-muted)] truncate">{relPath}</span>
                  </div>

                  {/* Matches inside File */}
                  <div className="divide-y divide-[var(--border-color)]/25">
                    {fileGroup.items.map((item) => {
                      const flatIdx = currentFlatIndex;
                      currentFlatIndex++; // increment flat tracker
                      const isSelected = selectedIndex === flatIdx;

                      return (
                        <div
                          key={item.line + "_" + item.content}
                          onClick={() => handleSelectResult(item)}
                          className={`px-4 py-2 text-xs flex items-center justify-between cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-[var(--accent-bg)]/25 text-[var(--text-light)] border-l-2 border-[var(--accent-color)]"
                              : "text-[var(--text-normal)] hover:bg-black/15"
                          }`}
                        >
                          <div className="flex items-center space-x-3 truncate mr-4">
                            {item.is_content_match ? (
                              <>
                                <span className="text-[10px] text-zinc-500 font-bold w-8 text-right flex-shrink-0">
                                  Line {item.line}
                                </span>
                                <span className="text-[11px] font-mono text-[var(--text-normal)] truncate">
                                  {item.content}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="px-1.5 py-0.5 rounded text-[8px] bg-emerald-500/15 text-emerald-400 font-bold border border-emerald-500/30">
                                  Filename
                                </span>
                                <span className="text-[11px] italic text-[var(--text-muted)] truncate">
                                  {fileGroup.name} (match)
                                </span>
                              </>
                            )}
                          </div>

                          {isSelected && (
                            <span className="text-[9px] text-[var(--accent-color)] font-bold flex-shrink-0 animate-pulse">
                              ↵ Open
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </div>

        {/* Footer Area */}
        <div className="px-4 py-2.5 bg-black/20 border-t border-[var(--border-color)] flex items-center justify-between text-[9px] text-[var(--text-muted)]">
          <div className="flex items-center space-x-1">
            <Info size={10} className="text-zinc-500" />
            <span>Search scans all file contents in active workspace.</span>
          </div>
          <div className="flex items-center space-x-2">
            <span>
              <kbd className="px-1 py-0.2 bg-zinc-800 rounded border border-zinc-700 text-zinc-400">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="px-1 py-0.2 bg-zinc-800 rounded border border-zinc-700 text-zinc-400">↵</kbd> select
            </span>
            <span>
              <kbd className="px-1 py-0.2 bg-zinc-800 rounded border border-zinc-700 text-zinc-400">esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
