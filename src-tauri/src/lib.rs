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

struct ScoredSearchMatch {
    match_val: SearchMatch,
    score: i64,
}

fn read_and_check_text_file(path: &Path) -> Option<String> {
    if let Ok(metadata) = std::fs::metadata(path) {
        // Skip files larger than 2MB
        if metadata.len() > 2 * 1024 * 1024 {
            return None;
        }
    }

    let mut file = std::fs::File::open(path).ok()?;
    use std::io::{Read, Seek};
    let mut buffer = [0; 1024];
    let bytes_read = file.read(&mut buffer).ok()?;
    if buffer[..bytes_read].contains(&0) {
        return None; // Binary file detection
    }

    file.seek(std::io::SeekFrom::Start(0)).ok()?;
    let mut content = String::new();
    file.read_to_string(&mut content).ok()?;
    Some(content)
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

    let results = Arc::new(Mutex::new(Vec::new()));
    let query_lower = query.to_lowercase();
    let query_arc = Arc::new(query);
    let query_lower_arc = Arc::new(query_lower);
    let root_path_buf = root_path.to_path_buf();
    let root_path_arc = Arc::new(root_path_buf);

    let regex_matcher = if is_regex {
        let re = regex::RegexBuilder::new(&query_arc)
            .case_insensitive(!match_case)
            .build()
            .map_err(|e| format!("Invalid regex: {}", e))?;
        Some(Arc::new(re))
    } else {
        None
    };

    use fuzzy_matcher::FuzzyMatcher;
    use ignore::WalkBuilder;

    let walker = WalkBuilder::new(&*root_path_arc)
        .hidden(true) // Skip hidden files and directories (like .git) by default
        .build_parallel();

    walker.run(|| {
        let results = results.clone();
        let query = query_arc.clone();
        let query_lower = query_lower_arc.clone();
        let root_path = root_path_arc.clone();
        let regex_matcher = regex_matcher.clone();
        let matcher = fuzzy_matcher::skim::SkimMatcherV2::default();

        Box::new(move |entry_result| {
            let entry = match entry_result {
                Ok(e) => e,
                Err(_) => return ignore::WalkState::Continue,
            };

            let path = entry.path();

            // Guard against massive build/dependency directories if not gitignored
            if entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                if let Some(dir_name) = path.file_name().and_then(|n| n.to_str()) {
                    if dir_name == "node_modules"
                        || dir_name == ".git"
                        || dir_name == "target"
                        || dir_name == "dist"
                        || dir_name == ".vscode"
                        || dir_name == ".gemini"
                    {
                        return ignore::WalkState::Skip;
                    }
                }
            }

            if entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                let rel_path = path.strip_prefix(&*root_path)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .into_owned();

                // 1. Fuzzy match filename
                let filename_score = matcher.fuzzy_match(&rel_path, &*query).unwrap_or(0);
                if filename_score > 0 {
                    let mut lock = results.lock().unwrap();
                    lock.push(ScoredSearchMatch {
                        match_val: SearchMatch {
                            path: path.to_string_lossy().into_owned(),
                            name: name.clone(),
                            line: 0,
                            content: String::new(),
                            is_content_match: false,
                        },
                        score: filename_score,
                    });
                }

                // 2. Scan file content
                if let Some(content) = read_and_check_text_file(path) {
                    let mut line_num = 1;
                    for raw_line in content.lines() {
                        let is_match = if let Some(ref re) = regex_matcher {
                            re.is_match(raw_line)
                        } else if match_case {
                            if whole_word {
                                raw_line.split(|c: char| !c.is_alphanumeric() && c != '_')
                                    .any(|w| w == query.as_str())
                            } else {
                                raw_line.contains(query.as_str())
                            }
                        } else {
                            if whole_word {
                                raw_line.split(|c: char| !c.is_alphanumeric() && c != '_')
                                    .any(|w| w.to_lowercase() == query_lower.as_str())
                            } else {
                                raw_line.to_lowercase().contains(query_lower.as_str())
                            }
                        };

                        if is_match {
                            let mut lock = results.lock().unwrap();
                            lock.push(ScoredSearchMatch {
                                match_val: SearchMatch {
                                    path: path.to_string_lossy().into_owned(),
                                    name: name.clone(),
                                    line: line_num,
                                    content: raw_line.trim().to_string(),
                                    is_content_match: true,
                                },
                                score: 0,
                            });
                        }
                        line_num += 1;
                    }
                }
            }

            ignore::WalkState::Continue
        })
    });

    // Unwrap results and sort them
    let mut scored_results = Arc::try_unwrap(results)
        .map_err(|_| "Failed to resolve search results threads".to_string())?
        .into_inner()
        .map_err(|e| e.to_string())?;

    scored_results.sort_by(|a, b| {
        match (a.match_val.is_content_match, b.match_val.is_content_match) {
            (false, false) => b.score.cmp(&a.score), // Sort filename matches by fuzzy score desc
            (false, true) => std::cmp::Ordering::Less, // Filenames always first
            (true, false) => std::cmp::Ordering::Greater,
            (true, true) => {
                // Sort content matches alphabetically by path, then line number
                a.match_val.path.cmp(&b.match_val.path)
                    .then_with(|| a.match_val.line.cmp(&b.match_val.line))
            }
        }
    });

    let mut final_results: Vec<SearchMatch> = scored_results
        .into_iter()
        .map(|r| r.match_val)
        .collect();

    final_results.truncate(150);
    Ok(final_results)
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
