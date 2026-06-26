// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod git;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileEntry>>,
}

pub struct VfsState(pub Arc<Mutex<HashMap<String, String>>>);

#[tauri::command]
async fn read_file_vfs(state: tauri::State<'_, VfsState>, path: String) -> Result<String, String> {
    println!("Rust [read_file_vfs] called for path: {}", path);
    let vfs = state.0.lock().map_err(|e| e.to_string())?;

    // Check VFS first
    if let Some(content) = vfs.get(&path) {
        println!("Rust [read_file_vfs] cache hit in VFS memory");
        return Ok(content.clone());
    }

    // Fall back to physical disk
    println!("Rust [read_file_vfs] cache miss, reading from physical disk");
    let path_buf = PathBuf::from(&path);
    if path_buf.exists() {
        std::fs::read_to_string(&path_buf).map_err(|e| e.to_string())
    } else {
        Err("File not found".into())
    }
}

#[tauri::command]
async fn write_file_vfs(
    state: tauri::State<'_, VfsState>,
    path: String,
    content: String,
) -> Result<(), String> {
    println!(
        "Rust [write_file_vfs] writing path: {} (content size: {} chars)",
        path,
        content.len()
    );
    let mut vfs = state.0.lock().map_err(|e| e.to_string())?;
    vfs.insert(path, content);
    Ok(())
}

#[tauri::command]
async fn apply_vfs_to_disk(state: tauri::State<'_, VfsState>) -> Result<(), String> {
    println!("Rust [apply_vfs_to_disk] flushing in-memory VFS changes to local disk...");
    let mut vfs = state.0.lock().map_err(|e| e.to_string())?;
    for (path_str, content) in vfs.drain() {
        println!("Rust [apply_vfs_to_disk] applying file: {}", path_str);
        let path = PathBuf::from(&path_str);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, content).map_err(|e| e.to_string())?;
    }
    println!("Rust [apply_vfs_to_disk] flush complete!");
    Ok(())
}

#[tauri::command]
async fn get_directory_structure(root_dir: String) -> Result<Vec<FileEntry>, String> {
    println!(
        "Rust [get_directory_structure] reading structure for: {}",
        root_dir
    );
    let root_path = Path::new(&root_dir);
    if !root_path.exists() {
        println!("Rust [get_directory_structure] error: path does not exist");
        return Err("Directory does not exist".into());
    }
    read_dir_recursive(root_path)
}

#[tauri::command]
async fn read_file_disk(path: String) -> Result<String, String> {
    println!(
        "Rust [read_file_disk] reading directly from physical disk: {}",
        path
    );
    let path_buf = PathBuf::from(&path);
    if path_buf.exists() {
        std::fs::read_to_string(&path_buf).map_err(|e| e.to_string())
    } else {
        Err(format!("File not found on physical disk: {}", path))
    }
}

#[tauri::command]
async fn write_file_disk(
    state: tauri::State<'_, VfsState>,
    path: String,
    content: String,
) -> Result<(), String> {
    println!("Rust [write_file_disk] writing path directly to disk: {}", path);
    let path_buf = PathBuf::from(&path);
    if let Some(parent) = path_buf.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path_buf, content).map_err(|e| e.to_string())?;

    // Evict this path from VFS memory cache so subsequent VFS reads fall back to this physical disk file
    let mut vfs = state.0.lock().map_err(|e| e.to_string())?;
    vfs.remove(&path);
    Ok(())
}

fn read_dir_recursive(path: &Path) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    let read_dir = std::fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();

        if entry_path.is_dir() {
            if name == "node_modules"
                || name == ".git"
                || name == "target"
                || name == "dist"
                || name == ".vscode"
                || name == ".gemini"
            {
                continue;
            }
            let children = read_dir_recursive(&entry_path)?;
            entries.push(FileEntry {
                name,
                path: entry_path.to_string_lossy().into_owned(),
                is_dir: true,
                children: Some(children),
            });
        } else {
            entries.push(FileEntry {
                name,
                path: entry_path.to_string_lossy().into_owned(),
                is_dir: false,
                children: None,
            });
        }
    }

    entries.sort_by(|a, b| {
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    Ok(entries)
}

#[tauri::command]
async fn create_file(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if path_buf.exists() {
        return Err("File already exists".into());
    }
    if let Some(parent) = path_buf.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path_buf, "").map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn create_directory(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if path_buf.exists() {
        return Err("Directory already exists".into());
    }
    std::fs::create_dir_all(&path_buf).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_file_or_dir(path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err("Path does not exist".into());
    }
    if path_buf.is_dir() {
        std::fs::remove_dir_all(&path_buf).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(&path_buf).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn log_to_terminal(level: String, message: String) {
    println!("JS [{}] {}", level, message);
}

#[tauri::command]
async fn move_file_or_dir(src: String, dest: String) -> Result<(), String> {
    let src_path = PathBuf::from(&src);
    let dest_path = PathBuf::from(&dest);
    if !src_path.exists() {
        return Err("Source path does not exist".into());
    }
    if dest_path.exists() {
        return Err("Destination path already exists".into());
    }
    if let Some(parent) = dest_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&src_path, &dest_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize, Clone, Debug)]
pub struct SearchMatch {
    path: String,
    name: String,
    line: usize,
    content: String,
    is_content_match: bool,
}

fn search_dir_recursive(
    dir: &Path,
    query: &str,
    match_case: bool,
    whole_word: bool,
    is_regex: bool,
    results: &mut Vec<SearchMatch>,
) -> Result<(), String> {
    let read_dir = std::fs::read_dir(dir).map_err(|e| e.to_string())?;

    // Precompile regex if needed
    let regex_matcher = if is_regex {
        Some(regex::RegexBuilder::new(query)
            .case_insensitive(!match_case)
            .build()
            .map_err(|e| format!("Invalid regex: {}", e))?)
    } else {
        None
    };

    let query_lower = query.to_lowercase();

    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();

        if entry_path.is_dir() {
            if name == "node_modules"
                || name == ".git"
                || name == "target"
                || name == "dist"
                || name == ".vscode"
                || name == ".gemini"
            {
                continue;
            }
            search_dir_recursive(&entry_path, query, match_case, whole_word, is_regex, results)?;
        } else {
            // 1. Check filename match
            let is_name_match = if match_case {
                name.contains(query)
            } else {
                name.to_lowercase().contains(&query_lower)
            };

            if is_name_match {
                results.push(SearchMatch {
                    path: entry_path.to_string_lossy().into_owned(),
                    name: name.clone(),
                    line: 0,
                    content: String::new(),
                    is_content_match: false,
                });
            }

            // 2. Check file content match
            if let Ok(content) = std::fs::read_to_string(&entry_path) {
                let mut line_num = 1;
                for raw_line in content.lines() {
                    let is_match = if let Some(ref re) = regex_matcher {
                        re.is_match(raw_line)
                    } else if match_case {
                        if whole_word {
                            // Check word boundaries by comparing whole words
                            raw_line.split(|c: char| !c.is_alphanumeric() && c != '_')
                                .any(|w| w == query)
                        } else {
                            raw_line.contains(query)
                        }
                    } else {
                        if whole_word {
                            raw_line.split(|c: char| !c.is_alphanumeric() && c != '_')
                                .any(|w| w.to_lowercase() == query_lower)
                        } else {
                            raw_line.to_lowercase().contains(&query_lower)
                        }
                    };

                    if is_match {
                        results.push(SearchMatch {
                            path: entry_path.to_string_lossy().into_owned(),
                            name: name.clone(),
                            line: line_num,
                            content: raw_line.trim().to_string(),
                            is_content_match: true,
                        });
                    }
                    line_num += 1;
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn search_project(
    root_dir: String,
    query: String,
    match_case: bool,
    whole_word: bool,
    is_regex: bool,
) -> Result<Vec<SearchMatch>, String> {
    println!(
        "Rust [search_project] querying: '{}' (case: {}, word: {}, regex: {}) under: {}",
        query, match_case, whole_word, is_regex, root_dir
    );
    
    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    let root_path = Path::new(&root_dir);
    if !root_path.exists() {
        return Err("Directory does not exist".into());
    }

    let mut results = Vec::new();
    search_dir_recursive(root_path, &query, match_case, whole_word, is_regex, &mut results)?;
    
    // Limit results count to prevent sending huge payloads
    results.truncate(150);
    
    Ok(results)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(VfsState(Arc::new(Mutex::new(HashMap::new()))))
        .invoke_handler(tauri::generate_handler![
            log_to_terminal,
            read_file_vfs,
            write_file_vfs,
            apply_vfs_to_disk,
            get_directory_structure,
            read_file_disk,
            write_file_disk,
            create_file,
            create_directory,
            delete_file_or_dir,
            move_file_or_dir,
            search_project,
            git::git_status,
            git::git_init,
            git::git_stage_file,
            git::git_unstage_file,
            git::git_discard_changes,
            git::git_commit,
            git::git_get_head_content,
            git::git_get_branches,
            git::git_checkout_branch,
            git::git_get_index_content,
            git::git_pull,
            git::git_push,
            git::git_get_commit_history,
            git::git_get_commit_files,
            git::git_get_file_content_at_rev,
            git::git_discard_all_changes,
            git::git_revert_commit,
            git::git_reset_to_commit,
            git::git_blame,
            git::git_get_file_commit_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
