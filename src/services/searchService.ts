import { invoke } from "@tauri-apps/api/core";

export interface SearchMatch {
  path: string;
  name: string;
  line: number;
  content: string;
  is_content_match: boolean;
}

export interface SearchOptions {
  rootDir: string;
  query: string;
  matchCase: boolean;
  wholeWord: boolean;
  isRegex: boolean;
}

export const searchService = {
  /**
   * Performs a search over filenames and line content in the target directory using Tauri commands.
   */
  async searchProject(options: SearchOptions): Promise<SearchMatch[]> {
    if (!options.rootDir || !options.query.trim()) {
      return [];
    }
    
    return invoke<SearchMatch[]>("search_project", {
      rootDir: options.rootDir,
      query: options.query,
      matchCase: options.matchCase,
      wholeWord: options.wholeWord,
      isRegex: options.isRegex,
    });
  }
};
