import React from "react";
import { Search, X, File, AlignLeft, Info } from "lucide-react";
import { SearchMatch } from "../services/searchService";

interface SearchPaletteViewProps {
  query: string;
  setQuery: (q: string) => void;
  matchCase: boolean;
  setMatchCase: (v: boolean) => void;
  wholeWord: boolean;
  setWholeWord: (v: boolean) => void;
  isRegex: boolean;
  setIsRegex: (v: boolean) => void;
  searching: boolean;
  results: SearchMatch[];
  selectedIndex: number;
  groupedResults: Record<string, { name: string; items: SearchMatch[] }>;
  rootPath: string | null;
  onClose: () => void;
  handleSelectResult: (match: SearchMatch) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export const SearchPaletteView: React.FC<SearchPaletteViewProps> = ({
  query,
  setQuery,
  matchCase,
  setMatchCase,
  wholeWord,
  setWholeWord,
  isRegex,
  setIsRegex,
  searching,
  results,
  selectedIndex,
  groupedResults,
  rootPath,
  onClose,
  handleSelectResult,
  inputRef,
  containerRef,
}) => {
  let currentFlatIndex = 0;

  return (
    <div className="fixed inset-0 bg-[var(--color-surface-overlay)] backdrop-blur-md z-[9999] flex items-start justify-center pt-[15vh] px-4 font-mono select-none modal-overlay">
      <div
        ref={containerRef}
        className="bg-[var(--bg-sidebar)] border border-[var(--border-color)] rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[65vh]"
      >
        {/* Top Search Area */}
        <div className="p-4 border-b border-[var(--border-color)] bg-[var(--color-surface-sunken)] flex items-center space-x-3">
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
                  ? "bg-[var(--accent-color)] border-[var(--accent-color)] text-[var(--color-primary-foreground)]"
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
                  ? "bg-[var(--accent-color)] border-[var(--accent-color)] text-[var(--color-primary-foreground)]"
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
                  ? "bg-[var(--accent-color)] border-[var(--accent-color)] text-[var(--color-primary-foreground)]"
                  : "border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-normal)] hover:border-[var(--border-active)]"
              }`}
              title="Use Regex (.*)"
            >
              .*
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1 text-[var(--text-muted)] hover:text-[var(--text-light)] hover:bg-[var(--color-surface-sunken)] rounded transition-all cursor-pointer"
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
              <AlignLeft size={24} className="text-[var(--color-fg-muted)] mb-1" />
              <span>
                {query.trim() ? "No search results match." : "Type a query above to search files and reference contents."}
              </span>
            </div>
          )}

          {!searching &&
            Object.entries(groupedResults).map(([filePath, fileGroup]) => {
              const relPath = rootPath ? filePath.replace(rootPath, "") : filePath;
              return (
                <div key={filePath} className="rounded-lg overflow-hidden border border-[var(--border-color)]/50 bg-[var(--color-surface-sunken)]">
                  {/* File Header */}
                  <div className="px-3 py-1.5 bg-[var(--color-surface-sunken)] border-b border-[var(--border-color)]/30 flex items-center space-x-2 text-[10px]">
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
                              : "text-[var(--text-normal)] hover:bg-[var(--color-surface-sunken)]"
                          }`}
                        >
                          <div className="flex items-center space-x-3 truncate mr-4">
                            {item.is_content_match ? (
                              <>
                                <span className="text-[10px] text-[var(--color-fg-muted)] font-bold w-8 text-right flex-shrink-0">
                                  Line {item.line}
                                </span>
                                <span className="text-[11px] font-mono text-[var(--text-normal)] truncate">
                                  {item.content}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="px-1.5 py-0.5 rounded text-[8px] bg-[var(--color-status-success-bg)] text-[var(--color-status-success)] font-bold border border-[var(--color-status-success-border)]">
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
        <div className="px-4 py-2.5 bg-[var(--color-surface-sunken)] border-t border-[var(--border-color)] flex items-center justify-between text-[9px] text-[var(--text-muted)]">
          <div className="flex items-center space-x-1">
            <Info size={10} className="text-[var(--color-fg-muted)]" />
            <span>Search scans all file contents in active workspace.</span>
          </div>
          <div className="flex items-center space-x-2">
            <span>
              <kbd className="px-1 py-0.2 bg-[var(--color-surface-sunken)] rounded border border-[var(--color-border-subtle)] text-[var(--color-fg-default)]">↑↓</kbd> navigate
            </span>
            <span>
              <kbd className="px-1 py-0.2 bg-[var(--color-surface-sunken)] rounded border border-[var(--color-border-subtle)] text-[var(--color-fg-default)]">↵</kbd> select
            </span>
            <span>
              <kbd className="px-1 py-0.2 bg-[var(--color-surface-sunken)] rounded border border-[var(--color-border-subtle)] text-[var(--color-fg-default)]">esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
