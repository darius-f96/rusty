// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod git;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri::Manager;
use tauri::Emitter;
use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem, MasterPty};
use std::io::{Write, Read};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileEntry>>,
}

pub struct VfsState(pub Arc<Mutex<HashMap<String, HashMap<String, String>>>>);
pub struct NodeFileTracker(pub Arc<Mutex<HashMap<String, Vec<String>>>>);
pub struct CurrentExecutingNode(pub Arc<Mutex<Option<String>>>);

pub struct SidecarState(pub Arc<Mutex<Option<CommandChild>>>);

pub struct TerminalSession {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
}

pub struct TerminalState(pub Arc<Mutex<HashMap<String, TerminalSession>>>);


fn get_tab_id(tab_id: Option<String>) -> String {
    let t = tab_id.unwrap_or_default();
    if t.is_empty() {
        "global".to_string()
    } else {
        t
    }
}

#[tauri::command]
async fn read_file_vfs(
    state: tauri::State<'_, VfsState>,
    path: String,
    tab_id: Option<String>,
) -> Result<String, String> {
    let tid = get_tab_id(tab_id);
    println!("Rust [read_file_vfs] called for path: {}, tab_id: {}", path, tid);
    let vfs = state.0.lock().map_err(|e| e.to_string())?;

    // Check VFS first
    if let Some(tab_map) = vfs.get(&tid) {
        if let Some(content) = tab_map.get(&path) {
            println!("Rust [read_file_vfs] cache hit in VFS memory for tab: {}", tid);
            return Ok(content.clone());
        }
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
    node_file_tracker: tauri::State<'_, NodeFileTracker>,
    path: String,
    content: String,
    node_id: Option<String>,
    tab_id: Option<String>,
) -> Result<(), String> {
    let tid = get_tab_id(tab_id);
    println!(
        "Rust [write_file_vfs] writing path: {} (content size: {} chars), node_id: {:?}, tab_id: {}",
        path,
        content.len(),
        node_id,
        tid
    );
    let mut vfs = state.0.lock().map_err(|e| e.to_string())?;
    let tab_map = vfs.entry(tid.clone()).or_insert_with(HashMap::new);
    tab_map.insert(path.clone(), content);

    if let Some(nid) = node_id {
        let mut tracker = node_file_tracker.0.lock().map_err(|e| e.to_string())?;
        tracker.entry(nid.clone()).or_insert_with(Vec::new).push(path.clone());
        println!("Rust [write_file_vfs] tracked file for node: {}", nid);
    }

    Ok(())
}

#[tauri::command]
async fn apply_vfs_to_disk(
    state: tauri::State<'_, VfsState>,
    tab_id: Option<String>,
) -> Result<(), String> {
    let tid = get_tab_id(tab_id);
    println!("Rust [apply_vfs_to_disk] flushing in-memory VFS changes for tab: {} to local disk...", tid);
    let mut vfs = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut tab_map) = vfs.remove(&tid) {
        for (path_str, content) in tab_map.drain() {
            println!("Rust [apply_vfs_to_disk] applying file: {}", path_str);
            let path = PathBuf::from(&path_str);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&path, content).map_err(|e| e.to_string())?;
        }
    }
    println!("Rust [apply_vfs_to_disk] flush complete!");
    Ok(())
}

#[tauri::command]
async fn set_current_executing_node(
    state: tauri::State<'_, CurrentExecutingNode>,
    node_id: Option<String>,
) -> Result<(), String> {
    println!("Rust [set_current_executing_node] node_id: {:?}", node_id);
    let mut current = state.0.lock().map_err(|e| e.to_string())?;
    *current = node_id;
    Ok(())
}

#[tauri::command]
async fn delete_node_vfs_files(
    vfs_state: tauri::State<'_, VfsState>,
    tracker_state: tauri::State<'_, NodeFileTracker>,
    node_id: String,
    tab_id: Option<String>,
) -> Result<(), String> {
    let tid = get_tab_id(tab_id);
    println!("Rust [delete_node_vfs_files] deleting all VFS files for node: {} under tab: {}", node_id, tid);
    let mut tracker = tracker_state.0.lock().map_err(|e| e.to_string())?;
    if let Some(files) = tracker.remove(&node_id) {
        println!("Rust [delete_node_vfs_files] found {} files to delete: {:?}", files.len(), files);
        let mut vfs = vfs_state.0.lock().map_err(|e| e.to_string())?;
        if let Some(tab_map) = vfs.get_mut(&tid) {
            for file_path in files {
                tab_map.remove(&file_path);
                println!("Rust [delete_node_vfs_files] removed from VFS: {}", file_path);
            }
        }
    } else {
        println!("Rust [delete_node_vfs_files] no files tracked for node: {}", node_id);
    }
    Ok(())
}

#[derive(Serialize)]
struct NodeFilesResponse {
    node_id: String,
    files: Vec<String>,
}

#[tauri::command]
async fn get_all_node_vfs_files(
    tracker_state: tauri::State<'_, NodeFileTracker>,
) -> Result<Vec<NodeFilesResponse>, String> {
    println!("Rust [get_all_node_vfs_files] fetching all tracked files");
    let tracker = tracker_state.0.lock().map_err(|e| e.to_string())?;
    let result: Vec<NodeFilesResponse> = tracker
        .iter()
        .map(|(node_id, files)| NodeFilesResponse {
            node_id: node_id.clone(),
            files: files.clone(),
        })
        .collect();
    println!("Rust [get_all_node_vfs_files] found {} nodes with tracked files", result.len());
    Ok(result)
}

#[tauri::command]
async fn export_vfs_contents(
    state: tauri::State<'_, VfsState>,
    tab_id: Option<String>,
) -> Result<std::collections::HashMap<String, String>, String> {
    let tid = get_tab_id(tab_id);
    println!("Rust [export_vfs_contents] exporting VFS files for tab: {}", tid);
    let vfs = state.0.lock().map_err(|e| e.to_string())?;
    let mut result = std::collections::HashMap::new();
    if let Some(tab_map) = vfs.get(&tid) {
        for (k, v) in tab_map {
            result.insert(k.clone(), v.clone());
        }
    }
    println!("Rust [export_vfs_contents] exported {} files for tab: {}", result.len(), tid);
    Ok(result)
}

#[tauri::command]
async fn import_vfs_contents(
    state: tauri::State<'_, VfsState>,
    tab_id: Option<String>,
    files: std::collections::HashMap<String, String>,
) -> Result<(), String> {
    let tid = get_tab_id(tab_id);
    println!("Rust [import_vfs_contents] importing {} files into VFS for tab: {}", files.len(), tid);
    let mut vfs = state.0.lock().map_err(|e| e.to_string())?;
    let tab_map = vfs.entry(tid.clone()).or_insert_with(HashMap::new);
    for (path, content) in files {
        tab_map.insert(path, content);
    }
    println!("Rust [import_vfs_contents] import complete for tab: {}", tid);
    Ok(())
}

#[tauri::command]
async fn export_vfs_tracker(
    tracker_state: tauri::State<'_, NodeFileTracker>,
) -> Result<std::collections::HashMap<String, Vec<String>>, String> {
    println!("Rust [export_vfs_tracker] exporting all node file tracking");
    let tracker = tracker_state.0.lock().map_err(|e| e.to_string())?;
    let result: std::collections::HashMap<String, Vec<String>> = tracker
        .iter()
        .map(|(node_id, files)| (node_id.clone(), files.clone()))
        .collect();
    println!("Rust [export_vfs_tracker] exported tracking for {} nodes", result.len());
    Ok(result)
}

#[tauri::command]
async fn import_vfs_tracker(
    tracker_state: tauri::State<'_, NodeFileTracker>,
    tracker: std::collections::HashMap<String, Vec<String>>,
) -> Result<(), String> {
    println!("Rust [import_vfs_tracker] importing tracking for {} nodes", tracker.len());
    let mut state = tracker_state.0.lock().map_err(|e| e.to_string())?;
    state.clear();
    for (node_id, files) in tracker {
        state.insert(node_id, files);
    }
    println!("Rust [import_vfs_tracker] import complete");
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
    tab_id: Option<String>,
) -> Result<(), String> {
    println!("Rust [write_file_disk] writing path directly to disk: {}", path);
    let path_buf = PathBuf::from(&path);
    if let Some(parent) = path_buf.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path_buf, content).map_err(|e| e.to_string())?;

    // Evict this path from VFS memory cache
    let mut vfs = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(tid) = tab_id {
        if let Some(tab_map) = vfs.get_mut(&tid) {
            tab_map.remove(&path);
        }
    } else {
        for tab_map in vfs.values_mut() {
            tab_map.remove(&path);
        }
    }
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
async fn save_chat_history(
    rootDir: String,
    chatId: String,
    content: String,
) -> Result<String, String> {
    println!("Rust [save_chat_history] saving chat {} to {}", chatId, rootDir);
    let chats_dir = PathBuf::from(&rootDir).join(".axiom").join("chats");
    std::fs::create_dir_all(&chats_dir).map_err(|e| e.to_string())?;

    // One file per chat, identified by chatId. Overwrites so all requests/replies
    // in a conversation accumulate in the same file.
    let file_name = format!("{}.json", chatId);
    let file_path = chats_dir.join(&file_name);

    std::fs::write(&file_path, &content).map_err(|e| e.to_string())?;
    println!("Rust [save_chat_history] saved to {:?}", file_path);

    Ok(file_path.to_string_lossy().into_owned())
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
async fn create_terminal_session(
    app: tauri::AppHandle,
    state: tauri::State<'_, TerminalState>,
    session_id: String,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<(), String> {
    println!("Rust [create_terminal_session] session_id: {}, cols: {}, rows: {}, cwd: {:?}", session_id, cols, rows, cwd);
    
    let shell = if cfg!(target_os = "windows") {
        "powershell.exe".to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
    };

    let pty_system = NativePtySystem::default();
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system.openpty(size).map_err(|e| e.to_string())?;
    
    let mut cmd = CommandBuilder::new(&shell);
    if let Some(ref cwd_dir) = cwd {
        if !cwd_dir.is_empty() {
            cmd.cwd(cwd_dir);
        }
    }
    let _child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let master = pair.master;
    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = master.take_writer().map_err(|e| e.to_string())?;

    {
        let mut map = state.0.lock().map_err(|e| e.to_string())?;
        map.insert(session_id.clone(), TerminalSession {
            master,
            writer,
        });
    }

    let app_clone = app.clone();
    let session_id_clone = session_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    #[derive(Clone, serde::Serialize)]
                    struct TerminalOutputPayload {
                        session_id: String,
                        data: String,
                    }
                    let _ = app_clone.emit(
                        "terminal-output",
                        TerminalOutputPayload {
                            session_id: session_id_clone.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        
        #[derive(Clone, serde::Serialize)]
        struct TerminalExitPayload {
            session_id: String,
        }
        let _ = app_clone.emit(
            "terminal-exit",
            TerminalExitPayload {
                session_id: session_id_clone,
            },
        );
    });

    Ok(())
}

#[tauri::command]
async fn write_to_terminal(
    state: tauri::State<'_, TerminalState>,
    session_id: String,
    input: String,
) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(session) = map.get_mut(&session_id) {
        session.writer.write_all(input.as_bytes()).map_err(|e| e.to_string())?;
        session.writer.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn resize_terminal(
    state: tauri::State<'_, TerminalState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(session) = map.get(&session_id) {
        session.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn close_terminal_session(
    state: tauri::State<'_, TerminalState>,
    session_id: String,
) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    map.remove(&session_id);
    Ok(())
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

fn spawn_sidecar(app: &tauri::App) {
    // Resolve the bundled server.js from the app resources.
    // In dev, resources are copied to target/debug/resources/; in release they're
    // bundled into the app bundle. resource_dir() handles both cases.
    let resource_dir = match app.path().resource_dir() {
        Ok(d) => d,
        Err(e) => {
            eprintln!("[sidecar] failed to resolve resource dir: {}", e);
            return;
        }
    };
    let server_js = resource_dir.join("resources").join("sidecar").join("server.js");

    if !server_js.exists() {
        eprintln!(
            "[sidecar] server.js not found at {}. \
             Run `npm run build:sidecar` to generate it.",
            server_js.display()
        );
        return;
    }

    // Resolve the bundled Node binary declared via `externalBin` in tauri.conf.json.
    let sidecar_cmd = match app.shell().sidecar("node") {
        Ok(cmd) => cmd,
        Err(e) => {
            eprintln!("[sidecar] failed to resolve bundled node binary: {}", e);
            return;
        }
    };

    match sidecar_cmd
        .args([server_js.to_string_lossy().to_string()])
        .spawn()
    {
        Ok((mut rx, child)) => {
            println!(
                "[sidecar] spawned node sidecar (server.js at {})",
                server_js.display()
            );

            // Store the child handle so we can kill it on app exit.
            if let Some(state) = app.try_state::<SidecarState>() {
                *state.0.lock().unwrap() = Some(child);
            }

            // Forward sidecar stdout/stderr to the host console so it's observable.
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(bytes) => {
                            println!("[sidecar] {}", String::from_utf8_lossy(&bytes).trim());
                        }
                        CommandEvent::Stderr(bytes) => {
                            eprintln!("[sidecar] {}", String::from_utf8_lossy(&bytes).trim());
                        }
                        CommandEvent::Terminated(status) => {
                            println!("[sidecar] process exited: {:?}", status);
                            break;
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(e) => {
            eprintln!(
                "[sidecar] failed to spawn: {}. \
                 If port 4000 is already in use, stop any manually started sidecar first.",
                e
            );
        }
    }
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(VfsState(Arc::new(Mutex::new(HashMap::new()))))
        .manage(NodeFileTracker(Arc::new(Mutex::new(HashMap::new()))))
        .manage(CurrentExecutingNode(Arc::new(Mutex::new(None))))
        .manage(SidecarState(Arc::new(Mutex::new(None))))
        .manage(TerminalState(Arc::new(Mutex::new(HashMap::new()))))
        .setup(|app| {
            // Spawn the bundled Node sidecar on startup (both dev and release).
            // The Node binary is bundled via `externalBin` and server.js via `resources`,
            // so the user never needs to install Node or run the sidecar manually.
            spawn_sidecar(app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            log_to_terminal,
            create_terminal_session,
            write_to_terminal,
            resize_terminal,
            close_terminal_session,
            read_file_vfs,
            write_file_vfs,
            apply_vfs_to_disk,
            set_current_executing_node,
            delete_node_vfs_files,
            get_all_node_vfs_files,
            export_vfs_contents,
            import_vfs_contents,
            export_vfs_tracker,
            import_vfs_tracker,
            get_directory_structure,
            read_file_disk,
            write_file_disk,
            create_file,
            create_directory,
            save_chat_history,
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
            git::git_get_all_branches,
            git::git_fetch,
            git::git_checkout_branch,
            git::git_create_branch,
            git::git_delete_branch,
            git::git_delete_remote_branch,
            git::git_merge_branch,
            git::git_rebase_branch,
            git::git_abort_pending,
            git::git_undo_last_rename,
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
            git::git_get_file_commit_history,
            git::git_scan_subprojects
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Kill the sidecar process on app exit.
            if let Some(state) = app_handle.try_state::<SidecarState>() {
                if let Some(child) = state.0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        }
    });
}
