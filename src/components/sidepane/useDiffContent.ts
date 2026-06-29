import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export const useDiffContent = (
  selectedNodeId: string | null,
  activeDiffFile: string,
  nodeStatus: string
) => {
  const [originalCode, setOriginalCode] = useState("// Loading original content...");
  const [modifiedCode, setModifiedCode] = useState("// Loading modified content...");
  const [isLoading, setIsLoading] = useState(false);
  const loadingFileRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const fetchDiffContent = async () => {
      if (!selectedNodeId || !activeDiffFile) return;

      setIsLoading(true);
      loadingFileRef.current = activeDiffFile;

      try {
        console.log(`SidePane [fetchDiffContent] loading paths`, { activeDiffFile });
        const modified: string = await invoke("read_file_vfs", { path: activeDiffFile });

        let original = "";
        try {
          original = await invoke("read_file_disk", { path: activeDiffFile });
        } catch (diskErr) {
          console.log(`SidePane [fetchDiffContent] File not on disk yet (treating as new file)`);
          original = "";
        }

        if (active && loadingFileRef.current === activeDiffFile) {
          setOriginalCode(original);
          setModifiedCode(modified);
          setIsLoading(false);
        }
      } catch (e: any) {
        console.error("SidePane [fetchDiffContent] failed to read content:", e);
        if (active && loadingFileRef.current === activeDiffFile) {
          setOriginalCode(`// Error reading file: ${e.message}`);
          setModifiedCode(`// Error reading file: ${e.message}`);
          setIsLoading(false);
        }
      }
    };

    fetchDiffContent();
    return () => {
      active = false;
    };
  }, [selectedNodeId, activeDiffFile, nodeStatus]);

  return { originalCode, modifiedCode, isLoading };
};
