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
fn read_file_vfs(state: tauri::State<'_, VfsState>, path: String) -> Result<String, String> {
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
fn write_file_vfs(
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
fn apply_vfs_to_disk(state: tauri::State<'_, VfsState>) -> Result<(), String> {
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
fn get_directory_structure(root_dir: String) -> Result<Vec<FileEntry>, String> {
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
fn read_file_disk(path: String) -> Result<String, String> {
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
fn write_file_disk(
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(VfsState(Arc::new(Mutex::new(HashMap::new()))))
        .invoke_handler(tauri::generate_handler![
            read_file_vfs,
            write_file_vfs,
            apply_vfs_to_disk,
            get_directory_structure,
            read_file_disk,
            write_file_disk,
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
            git::git_reset_to_commit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
