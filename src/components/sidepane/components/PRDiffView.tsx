import React, { useState, useEffect, useRef } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { ChevronDown, ChevronRight, ChevronLeft, Save, RotateCcw, Loader2, FileCode } from "lucide-react";
import { VfsRegistry } from "../../../services/vfs";
import { invoke } from "@tauri-apps/api/core";
import { DiffViewToggle } from "../../ui/DiffViewToggle";
import { notify } from "../../../notificationStore";
import { CustomSelect } from "../../CustomSelect";
import { getMonacoLanguageId } from "../../../services/lspLanguage";

interface PRDiffViewProps {
  tabId: string;
  modifiedFiles: string[];
}

interface FileDiffState {
  path: string;
  name: string;
  dir: string;
  original: string;
  modified: string;
  edited: string;
  isDirty: boolean;
  isCollapsed: boolean;
  isSaving: boolean;
}

interface FileDiffCardProps {
  file: string;
  state: FileDiffState;
  renderSideBySide: boolean;
  onContentChange: (filePath: string, newContent: string) => void;
  onSaveFile: (filePath: string) => Promise<void>;
  onResetFile: (filePath: string, editor: any) => void;
  toggleCollapse: (filePath: string) => void;
}

const FileDiffCard: React.FC<FileDiffCardProps> = ({
  file,
  state,
  renderSideBySide,
  onContentChange,
  onSaveFile,
  onResetFile,
  toggleCollapse,
}) => {
  const [hasRendered, setHasRendered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const diffEditorRef = useRef<any>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasRendered(true);
        }
      },
      {
        rootMargin: "400px 0px 400px 0px", // Preload when within 400px
      }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => {
      if (containerRef.current) {
        observer.unobserve(containerRef.current);
      }
    };
  }, []);

  const lineCount = Math.max(state.original.split("\n").length, state.edited.split("\n").length);
  const editorHeight = lineCount * 18 + 20;

  return (
    <div
      ref={containerRef}
      className="border border-[var(--border-color)] rounded-xl overflow-hidden shadow-md flex flex-col bg-[var(--color-surface-sunken)] transition-all hover:border-[var(--border-active)]/55"
    >
      {/* Git PR File Header */}
      <div
        onClick={() => toggleCollapse(file)}
        className="px-4 py-3 bg-[var(--bg-sidebar)] border-b border-[var(--border-color)] flex items-center justify-between select-none cursor-pointer hover:bg-[var(--bg-sidebar)]/80 transition-colors"
      >
        <div className="flex items-center space-x-2 font-mono text-xs text-[var(--text-light)]">
          {state.isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className="font-semibold">{state.name}</span>
          {state.dir && <span className="text-[10px] text-[var(--text-muted)] truncate max-w-[200px]">({state.dir})</span>}
        </div>

        <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
          {state.isDirty && (
            <span className="text-[9px] font-mono text-[var(--color-status-warning)] bg-[var(--color-status-warning-bg)] border border-[var(--color-status-warning-border)] px-1.5 py-0.5 rounded uppercase">
              Unsaved
            </span>
          )}
          {/* Save/Reset controls */}
          {state.isDirty && (
            <>
              <button
                onClick={() => onResetFile(file, diffEditorRef.current)}
                disabled={state.isSaving}
                className="p-1 hover:bg-[var(--bg-app)] hover:text-[var(--text-light)] text-[var(--text-muted)] rounded transition-colors"
                title="Reset file changes"
              >
                <RotateCcw size={13} />
              </button>
              <button
                onClick={() => onSaveFile(file)}
                disabled={state.isSaving}
                className="p-1 hover:bg-[var(--color-status-success-solid)] bg-[var(--color-status-success-bg)] text-[var(--color-status-success)] hover:text-[var(--color-status-success-solid-foreground)] rounded transition-colors flex items-center space-x-1"
                title="Save file changes to VFS"
              >
                {state.isSaving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Monaco Diff Editor Section */}
      {!state.isCollapsed && (
        <div
          style={{ height: `${editorHeight}px` }}
          className="w-full border-t border-[var(--border-color)] overflow-hidden relative bg-[var(--bg-app)]/30"
        >
          {hasRendered ? (
            <DiffEditor
              height="100%"
              language={getMonacoLanguageId(file)}
              theme="axiom-custom-theme"
              original={state.original}
              modified={state.edited}
              onMount={(editor) => {
                diffEditorRef.current = editor;
                const modifiedEditor = editor.getModifiedEditor();
                modifiedEditor.updateOptions({ readOnly: false });
                modifiedEditor.onDidChangeModelContent(() => {
                  onContentChange(file, modifiedEditor.getValue());
                });
              }}
              options={{
                readOnly: false,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                lineNumbers: "on",
                renderSideBySide: renderSideBySide,
                fontSize: 11,
                scrollbar: {
                  vertical: "hidden",
                  handleMouseWheel: false,
                },
                automaticLayout: true,
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-app)] text-[var(--text-muted)] text-[11px] font-mono">
              <Loader2 className="animate-spin text-[var(--color-status-danger)] mr-2" size={14} />
              <span>Preloading editor for {state.name}...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const PRDiffView: React.FC<PRDiffViewProps> = ({ tabId, modifiedFiles }) => {
  const [filesState, setFilesState] = useState<Record<string, FileDiffState>>({});
  const [loading, setLoading] = useState(false);
  const [renderSideBySide, setRenderSideBySide] = useState(true);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  // Load all file diffs
  const loadAllDiffs = async () => {
    if (modifiedFiles.length === 0) {
      setFilesState({});
      setActiveFilePath(null);
      return;
    }
    setLoading(true);
    const newState: Record<string, FileDiffState> = {};
    for (const file of modifiedFiles) {
      try {
        const modified: string = await VfsRegistry.getOrCreate(tabId).readFile(file);
        let original = "";
        try {
          original = await invoke("read_file_disk", { path: file });
        } catch {
          original = "[New file generated during execution - not present on disk]";
        }
        const parts = file.split("/");
        const name = parts[parts.length - 1];
        const dir = parts.slice(0, -1).join("/");

        newState[file] = {
          path: file,
          name,
          dir,
          original,
          modified,
          edited: modified,
          isDirty: false,
          isCollapsed: false,
          isSaving: false,
        };
      } catch (err) {
        console.error(`Failed to load diff content for ${file}:`, err);
      }
    }
    setFilesState(newState);
    if (modifiedFiles.length > 0) {
      setActiveFilePath((prev) => (prev && modifiedFiles.includes(prev) ? prev : modifiedFiles[0]));
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAllDiffs();
  }, [tabId, modifiedFiles.join(",")]);

  const toggleCollapse = (filePath: string) => {
    setFilesState((prev) => {
      const current = prev[filePath];
      if (!current) return prev;
      return {
        ...prev,
        [filePath]: {
          ...current,
          isCollapsed: !current.isCollapsed,
        },
      };
    });
  };

  const handleContentChange = (filePath: string, newContent: string) => {
    setFilesState((prev) => {
      const current = prev[filePath];
      if (!current) return prev;
      return {
        ...prev,
        [filePath]: {
          ...current,
          edited: newContent,
          isDirty: newContent !== current.modified,
        },
      };
    });
  };

  const handleSaveFile = async (filePath: string) => {
    const file = filesState[filePath];
    if (!file || !file.isDirty || file.isSaving) return;

    setFilesState((prev) => ({
      ...prev,
      [filePath]: { ...prev[filePath], isSaving: true },
    }));

    try {
      await VfsRegistry.getOrCreate(tabId).writeFile(filePath, file.edited);
      setFilesState((prev) => {
        const current = prev[filePath];
        return {
          ...prev,
          [filePath]: {
            ...current,
            modified: current.edited,
            isDirty: false,
            isSaving: false,
          },
        };
      });
      // Save canvas
      const { canvasFileService } = await import("../../tabs/canvas/services/canvasFileService");
      canvasFileService.autoSaveCanvas(tabId);
      notify("Saved", `${file.name} saved successfully to VFS.`, "success");
    } catch (err: any) {
      console.error(`Failed to save VFS file:`, err);
      notify("Save Failed", `Failed to save ${file.name}: ${err.message || String(err)}`, "error");
      setFilesState((prev) => ({
        ...prev,
        [filePath]: { ...prev[filePath], isSaving: false },
      }));
    }
  };

  const handleResetFile = (filePath: string, editor: any) => {
    const file = filesState[filePath];
    if (!file) return;
    if (editor) {
      editor.setValue(file.modified);
    }
    setFilesState((prev) => ({
      ...prev,
      [filePath]: {
        ...prev[filePath],
        edited: file.modified,
        isDirty: false,
      },
    }));
  };

  const currentIndex = activeFilePath ? modifiedFiles.indexOf(activeFilePath) : -1;

  const handlePrev = () => {
    if (currentIndex > 0) {
      setActiveFilePath(modifiedFiles[currentIndex - 1]);
    }
  };

  const handleNext = () => {
    if (currentIndex < modifiedFiles.length - 1) {
      setActiveFilePath(modifiedFiles[currentIndex + 1]);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-[var(--bg-app)] text-[var(--text-muted)] text-xs font-mono">
        <Loader2 className="animate-spin text-[var(--color-status-danger)] mb-2" size={24} />
        <span>Loading all code diffs...</span>
      </div>
    );
  }

  if (modifiedFiles.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-[var(--text-muted)]">
        <FileCode size={32} className="text-[var(--text-muted)]/20 mb-2" />
        <span className="text-xs">No modified VFS files detected.</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg-app)]">
      {/* File Selector and Navigation Toolbar */}
      <div className="flex flex-col border-b border-[var(--border-color)] bg-[var(--bg-sidebar)]/30 flex-shrink-0">
        <div className="px-4 py-2 bg-[var(--bg-sidebar)]/80 flex items-center justify-between text-xs font-mono select-none">
          <div className="flex items-center space-x-2">
            <button
              onClick={handlePrev}
              disabled={currentIndex <= 0}
              className="p-1.5 rounded hover:bg-[var(--accent-bg)] text-[var(--text-muted)] hover:text-[var(--text-light)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)] transition-colors cursor-pointer disabled:cursor-not-allowed border border-[var(--border-color)]"
              title="Previous file"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={handleNext}
              disabled={currentIndex >= modifiedFiles.length - 1}
              className="p-1.5 rounded hover:bg-[var(--accent-bg)] text-[var(--text-muted)] hover:text-[var(--text-light)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--text-muted)] transition-colors cursor-pointer disabled:cursor-not-allowed border border-[var(--border-color)]"
              title="Next file"
            >
              <ChevronRight size={14} />
            </button>
            
            <CustomSelect
              value={activeFilePath || ""}
              onChange={(val) => setActiveFilePath(val || null)}
              options={modifiedFiles.map(file => {
                const parts = file.split("/");
                const name = parts[parts.length - 1];
                const state = filesState[file];
                const label = state?.isDirty ? `* ${name}` : name;
                return { id: file, name: label };
              })}
              placeholder="Select file"
              className="w-64 text-xs font-mono"
              direction="down"
            />

            <span className="text-[10px] text-[var(--text-muted)] font-mono pl-1">
              {currentIndex + 1} of {modifiedFiles.length}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <DiffViewToggle
              viewMode={renderSideBySide ? "side-by-side" : "inline"}
              isAutoMode={false}
              onToggle={() => setRenderSideBySide(!renderSideBySide)}
              onEnableAuto={() => {}}
            />
          </div>
        </div>
      </div>

      {/* Active File Diff Card */}
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {activeFilePath && filesState[activeFilePath] && (
          <FileDiffCard
            file={activeFilePath}
            state={{ ...filesState[activeFilePath], isCollapsed: false }}
            renderSideBySide={renderSideBySide}
            onContentChange={handleContentChange}
            onSaveFile={handleSaveFile}
            onResetFile={handleResetFile}
            toggleCollapse={toggleCollapse}
          />
        )}
      </div>
    </div>
  );
};
