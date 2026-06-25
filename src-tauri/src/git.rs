use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Represents the git status of an individual file.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitFileStatus {
    /// The absolute path of the file on disk.
    pub path: String,
    /// The filename (basename).
    pub name: String,
    /// The modification category: "modified", "added", "deleted", or "untracked".
    pub status_type: String,
}

/// Represents the aggregated repository status.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitStatusResult {
    /// Indicates whether the workspace folder is a valid git repository.
    pub is_repo: bool,
    /// The name of the current active branch (or "empty-repo" if no commits yet).
    pub current_branch: String,
    /// Files that are staged for commit in the index.
    pub staged: Vec<GitFileStatus>,
    /// Files that are modified or untracked in the working tree.
    pub unstaged: Vec<GitFileStatus>,
}

/// Helper function to check if the given directory contains a git work tree.
fn check_is_git_repo(root_dir: &str) -> bool {
    let output = Command::new("git")
        .args(&["rev-parse", "--is-inside-work-tree"])
        .current_dir(root_dir)
        .output();
    
    match output {
        Ok(out) => out.status.success(),
        Err(_) => false,
    }
}

/// Fetches the complete git status of the workspace, including current branch name,
/// staged changes, and unstaged/untracked changes.
#[tauri::command]
pub async fn git_status(root_dir: String) -> Result<GitStatusResult, String> {
    let root_path = Path::new(&root_dir);
    if !root_path.exists() {
        return Err("Directory does not exist".into());
    }

    // Return status early if it's not a git repository
    let is_repo = check_is_git_repo(&root_dir);
    if !is_repo {
        return Ok(GitStatusResult {
            is_repo: false,
            current_branch: "".into(),
            staged: Vec::new(),
            unstaged: Vec::new(),
        });
    }

    // 1. Get the current active branch name
    let branch_output = Command::new("git")
        .args(&["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&root_dir)
        .output();
        
    let mut current_branch = String::new();
    if let Ok(out) = branch_output {
        if out.status.success() {
            current_branch = String::from_utf8_lossy(&out.stdout).trim().to_string();
        } else {
            // Check if it's a new repo that hasn't made its first commit yet
            let show_branch = Command::new("git")
                .args(&["branch", "--show-current"])
                .current_dir(&root_dir)
                .output();
            if let Ok(sb_out) = show_branch {
                current_branch = String::from_utf8_lossy(&sb_out.stdout).trim().to_string();
            }
            if current_branch.is_empty() {
                current_branch = "empty-repo".to_string();
            }
        }
    }

    // 2. Query porcelain output to easily parse staged, unstaged, and untracked changes
    let status_output = Command::new("git")
        .args(&["status", "--porcelain"])
        .current_dir(&root_dir)
        .output()
        .map_err(|e| e.to_string())?;

    let output_str = String::from_utf8_lossy(&status_output.stdout);
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();

    for line in output_str.lines() {
        if line.len() < 4 {
            continue;
        }
        
        // Extract status characters X and Y
        // X represents index status, Y represents working tree status
        let x = line.chars().nth(0).unwrap_or(' ');
        let y = line.chars().nth(1).unwrap_or(' ');
        let relative_path = &line[3..];
        
        // Clean quotes from files with spaces or non-ascii names
        let clean_path = relative_path.trim_matches('"').to_string();
        
        let file_name = Path::new(&clean_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&clean_path)
            .to_string();

        let abs_path = root_path.join(&clean_path).to_string_lossy().into_owned();

        if x == '?' && y == '?' {
            // "??" indicates an untracked file
            unstaged.push(GitFileStatus {
                path: abs_path,
                name: file_name,
                status_type: "untracked".into(),
            });
        } else {
            // Process staged changes (X represents the index state)
            if x != ' ' {
                let status_type = match x {
                    'M' => "modified",
                    'A' => "added",
                    'D' => "deleted",
                    'R' => "renamed",
                    _ => "modified",
                };
                staged.push(GitFileStatus {
                    path: abs_path.clone(),
                    name: file_name.clone(),
                    status_type: status_type.into(),
                });
            }
            
            // Process unstaged changes (Y represents the working tree state)
            if y != ' ' {
                let status_type = match y {
                    'M' => "modified",
                    'D' => "deleted",
                    'A' => "added",
                    _ => "modified",
                };
                unstaged.push(GitFileStatus {
                    path: abs_path,
                    name: file_name,
                    status_type: status_type.into(),
                });
            }
        }
    }

    Ok(GitStatusResult {
        is_repo: true,
        current_branch,
        staged,
        unstaged,
    })
}

/// Initializes a new Git repository in the specified directory path.
#[tauri::command]
pub async fn git_init(root_dir: String) -> Result<(), String> {
    let output = Command::new("git")
        .arg("init")
        .current_dir(&root_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

/// Stages a file by executing `git add <file>`.
#[tauri::command]
pub async fn git_stage_file(root_dir: String, file_path: String) -> Result<(), String> {
    let root_path = Path::new(&root_dir);
    let full_path = Path::new(&file_path);
    let relative = full_path
        .strip_prefix(root_path)
        .map_err(|_| "File is not in the workspace root".to_string())?
        .to_str()
        .ok_or_else(|| "Invalid file path encoding".to_string())?;

    let output = Command::new("git")
        .args(&["add", relative])
        .current_dir(&root_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

/// Unstages a file from the index.
/// Uses `git reset HEAD <file>` if a HEAD ref exists, or `git rm --cached` in an empty repo.
#[tauri::command]
pub async fn git_unstage_file(root_dir: String, file_path: String) -> Result<(), String> {
    let root_path = Path::new(&root_dir);
    let full_path = Path::new(&file_path);
    let relative = full_path
        .strip_prefix(root_path)
        .map_err(|_| "File is not in the workspace root".to_string())?
        .to_str()
        .ok_or_else(|| "Invalid file path encoding".to_string())?;

    // Determine if HEAD commit exists
    let has_head = Command::new("git")
        .args(&["rev-parse", "HEAD"])
        .current_dir(&root_dir)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    let output = if has_head {
        Command::new("git")
            .args(&["reset", "HEAD", relative])
            .current_dir(&root_dir)
            .output()
            .map_err(|e| e.to_string())?
    } else {
        Command::new("git")
            .args(&["rm", "--cached", "-r", "--ignore-unmatch", relative])
            .current_dir(&root_dir)
            .output()
            .map_err(|e| e.to_string())?
    };

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

/// Discards unstaged modifications.
/// Attempts `git checkout -- <file>`, falling back to `git restore <file>`,
/// and deletes the physical file if it is fully untracked.
#[tauri::command]
pub async fn git_discard_changes(root_dir: String, file_path: String) -> Result<(), String> {
    let root_path = Path::new(&root_dir);
    let full_path = Path::new(&file_path);
    let relative = full_path
        .strip_prefix(root_path)
        .map_err(|_| "File is not in the workspace root".to_string())?
        .to_str()
        .ok_or_else(|| "Invalid file path encoding".to_string())?;

    // Try traditional checkout first
    let output = Command::new("git")
        .args(&["checkout", "--", relative])
        .current_dir(&root_dir)
        .output();
        
    let success = match output {
        Ok(out) => out.status.success(),
        Err(_) => false,
    };
    
    if !success {
        // Fallback to git restore
        let restore_output = Command::new("git")
            .args(&["restore", relative])
            .current_dir(&root_dir)
            .output();
            
        let restore_success = match restore_output {
            Ok(out) => out.status.success(),
            Err(_) => false,
        };
        
        if !restore_success {
            // Delete untracked files
            let path_buf = PathBuf::from(&file_path);
            if path_buf.exists() && !Command::new("git")
                .args(&["ls-files", "--error-unmatch", relative])
                .current_dir(&root_dir)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false) 
            {
                std::fs::remove_file(path_buf).map_err(|e| e.to_string())?;
                return Ok(());
            }
            return Err("Failed to discard changes".to_string());
        }
    }

    Ok(())
}

/// Commits all currently staged changes with the provided commit message.
#[tauri::command]
pub async fn git_commit(root_dir: String, message: String) -> Result<(), String> {
    let output = Command::new("git")
        .args(&["commit", "-m", &message])
        .current_dir(&root_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

/// Returns the content of the file at the `HEAD` commit.
/// Used to construct side-by-side diff editors against currently edited files.
/// Returns an empty string if the file is untracked or the repository has no commits yet.
#[tauri::command]
pub async fn git_get_head_content(root_dir: String, file_path: String) -> Result<String, String> {
    let root_path = Path::new(&root_dir);
    let full_path = Path::new(&file_path);
    let relative = full_path
        .strip_prefix(root_path)
        .map_err(|_| "File is not in the workspace root".to_string())?
        .to_str()
        .ok_or_else(|| "Invalid file path encoding".to_string())?;

    let output = Command::new("git")
        .args(&["show", &format!("HEAD:{}", relative)])
        .current_dir(&root_dir)
        .output();

    match output {
        Ok(out) => {
            if out.status.success() {
                Ok(String::from_utf8_lossy(&out.stdout).into_owned())
            } else {
                // Return empty if file is new or repository has no commits
                Ok("".to_string())
            }
        }
        Err(_) => Ok("".to_string()),
    }
}

/// Retrieves a list of all local branches present in the Git repository.
/// Returns their short names (e.g., "main", "feature-xyz").
#[tauri::command]
pub async fn git_get_branches(root_dir: String) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .args(&["branch", "--format=%(refname:short)"])
        .current_dir(&root_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }

    let out_str = String::from_utf8_lossy(&output.stdout);
    let branches: Vec<String> = out_str
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    
    Ok(branches)
}

/// Performs a checkout to switch the repository's active branch.
#[tauri::command]
pub async fn git_checkout_branch(root_dir: String, branch_name: String) -> Result<(), String> {
    let output = Command::new("git")
        .args(&["checkout", &branch_name])
        .current_dir(&root_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

/// Returns the content of the file as staged in the Git index database.
/// Used to diff against HEAD (for staged files) or current VFS (for unstaged files).
/// Falls back to the HEAD version if not explicitly modified in the index.
#[tauri::command]
pub async fn git_get_index_content(root_dir: String, file_path: String) -> Result<String, String> {
    let root_path = Path::new(&root_dir);
    let full_path = Path::new(&file_path);
    let relative = full_path
        .strip_prefix(root_path)
        .map_err(|_| "File is not in the workspace root".to_string())?
        .to_str()
        .ok_or_else(|| "Invalid file path encoding".to_string())?;

    let output = Command::new("git")
        .args(&["show", &format!(":{}", relative)])
        .current_dir(&root_dir)
        .output();

    match output {
        Ok(out) => {
            if out.status.success() {
                Ok(String::from_utf8_lossy(&out.stdout).into_owned())
            } else {
                // Fall back to HEAD content if index fetch fails
                git_get_head_content(root_dir, file_path).await
            }
        }
        Err(_) => git_get_head_content(root_dir, file_path).await,
    }
}

/// Pulls remote commits from the upstream repository into the active branch.
#[tauri::command]
pub async fn git_pull(root_dir: String) -> Result<(), String> {
    let output = Command::new("git")
        .arg("pull")
        .current_dir(&root_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

/// Pushes local committed changes to the remote repository.
/// Automatically sets the upstream origin tracking branch if not already configured.
#[tauri::command]
pub async fn git_push(root_dir: String, branch_name: String) -> Result<(), String> {
    // 1. Try a regular push first
    let output = Command::new("git")
        .arg("push")
        .current_dir(&root_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        return Ok(());
    }

    // 2. If it fails, check if it's due to no upstream configuration
    let stderr = String::from_utf8_lossy(&output.stderr);
    if stderr.contains("no upstream branch") || stderr.contains("has no upstream branch") {
        // Run git push --set-upstream origin <branch_name>
        let upstream_output = Command::new("git")
            .args(&["push", "--set-upstream", "origin", &branch_name])
            .current_dir(&root_dir)
            .output()
            .map_err(|e| e.to_string())?;
        
        if upstream_output.status.success() {
            return Ok(());
        } else {
            return Err(String::from_utf8_lossy(&upstream_output.stderr).into_owned());
        }
    }

    Err(stderr.into_owned())
}

/// Represents details of an individual Git commit.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitCommitInfo {
    /// Full SHA-1 commit hash.
    pub hash: String,
    /// 7-character abbreviated commit hash.
    pub short_hash: String,
    /// Parent commit hashes.
    pub parents: Vec<String>,
    /// Commit author name.
    pub author: String,
    /// Relative or absolute commit date.
    pub date: String,
    /// Commit message subject line.
    pub subject: String,
    /// Ref decorations (e.g., tags, branches).
    pub decorations: String,
    /// Flag indicating whether the commit is unpushed to remotes.
    pub is_unpushed: bool,
}

/// Retrieves the last 100 commits from all branches and flags commits that are unpushed.
#[tauri::command]
pub async fn git_get_commit_history(root_dir: String) -> Result<Vec<GitCommitInfo>, String> {
    if !Path::new(&root_dir).exists() {
        return Err("Directory does not exist".into());
    }

    // 1. Find all local commits that are not present in any remote tracking branches (unpushed)
    let unpushed_output = Command::new("git")
        .args(&["log", "--branches", "--not", "--remotes", "--format=%H"])
        .current_dir(&root_dir)
        .output();
    
    let mut unpushed_hashes = std::collections::HashSet::new();
    if let Ok(out) = unpushed_output {
        if out.status.success() {
            let out_str = String::from_utf8_lossy(&out.stdout);
            for line in out_str.lines() {
                let h = line.trim().to_string();
                if !h.is_empty() {
                    unpushed_hashes.insert(h);
                }
            }
        }
    }

    // 2. Fetch the commit logs using a structured format split by '|'
    let log_output = Command::new("git")
        .args(&[
            "log",
            "--format=%H|%P|%an|%cr|%s|%d",
            "--max-count=100",
            "--all",
        ])
        .current_dir(&root_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if !log_output.status.success() {
        // Return an empty list if there are no commits yet (brand new repo)
        return Ok(Vec::new());
    }

    let log_str = String::from_utf8_lossy(&log_output.stdout);
    let mut history = Vec::new();

    for line in log_str.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() < 5 {
            continue;
        }

        let hash = parts[0].trim().to_string();
        let short_hash = if hash.len() >= 7 { hash[0..7].to_string() } else { hash.clone() };
        let parents: Vec<String> = parts[1].split_whitespace().map(|s| s.to_string()).collect();
        let author = parts[2].trim().to_string();
        let date = parts[3].trim().to_string();
        let subject = parts[4].trim().to_string();
        let decorations = parts.get(5).cloned().unwrap_or(&"").trim().to_string();

        let is_unpushed = unpushed_hashes.contains(&hash);

        history.push(GitCommitInfo {
            hash,
            short_hash,
            parents,
            author,
            date,
            subject,
            decorations,
            is_unpushed,
        });
    }

    Ok(history)
}

/// Represents status details of a file changed in a commit.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GitCommitFileStatus {
    pub path: String,
    pub name: String,
    pub status_type: String, // "added", "modified", "deleted"
}

/// Retrieves the list of files modified, added, or deleted in a specific commit.
#[tauri::command]
pub async fn git_get_commit_files(root_dir: String, commit_hash: String) -> Result<Vec<GitCommitFileStatus>, String> {
    if !Path::new(&root_dir).exists() {
        return Err("Directory does not exist".into());
    }

    // Run git diff-tree --no-commit-id --name-status -r <commit_hash>
    let output = Command::new("git")
        .args(&["diff-tree", "--no-commit-id", "--name-status", "-r", &commit_hash])
        .current_dir(&root_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }

    let out_str = String::from_utf8_lossy(&output.stdout);
    let mut files = Vec::new();

    for line in out_str.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }

        let status_code = parts[0];
        let relative_path = parts[1];

        let status_type = match status_code.chars().next().unwrap_or('M') {
            'A' => "added",
            'D' => "deleted",
            _ => "modified",
        };

        let abs_path = Path::new(&root_dir).join(relative_path).to_string_lossy().into_owned();
        let file_name = Path::new(relative_path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| relative_path.to_string());

        files.push(GitCommitFileStatus {
            path: abs_path,
            name: file_name,
            status_type: status_type.to_string(),
        });
    }

    Ok(files)
}

/// Returns the content of a file at a specific Git revision reference (e.g. "HEAD", a branch name, or a commit hash).
/// Returns an empty string if the file was not tracked/did not exist at that revision, or if the revision is invalid.
#[tauri::command]
pub async fn git_get_file_content_at_rev(root_dir: String, revision: String, file_path: String) -> Result<String, String> {
    let root_path = Path::new(&root_dir);
    let full_path = Path::new(&file_path);
    let relative = full_path
        .strip_prefix(root_path)
        .map_err(|_| "File is not in the workspace root".to_string())?
        .to_str()
        .ok_or_else(|| "Invalid file path encoding".to_string())?;

    let output = Command::new("git")
        .args(&["show", &format!("{}:{}", revision, relative)])
        .current_dir(&root_dir)
        .output();

    match output {
        Ok(out) => {
            if out.status.success() {
                Ok(String::from_utf8_lossy(&out.stdout).into_owned())
            } else {
                Ok("".to_string())
            }
        }
        Err(_) => Ok("".to_string()),
    }
}

/// Discards all unstaged changes in the repository.
/// Executes `git checkout -- .` and `git clean -df` to remove untracked files.
#[tauri::command]
pub async fn git_discard_all_changes(root_dir: String) -> Result<(), String> {
    // Discard changes to tracked files
    Command::new("git")
        .args(&["checkout", "--", "."])
        .current_dir(&root_dir)
        .output()
        .map_err(|e| e.to_string())?;

    // Discard untracked files and directories
    Command::new("git")
        .args(&["clean", "-df"])
        .current_dir(&root_dir)
        .output()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Reverts a specific commit by executing `git revert --no-edit <commit_hash>`.
#[tauri::command]
pub async fn git_revert_commit(root_dir: String, commit_hash: String) -> Result<(), String> {
    let output = Command::new("git")
        .args(&["revert", "--no-edit", &commit_hash])
        .current_dir(&root_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

/// Resets the current branch to a specific commit by executing `git reset --hard <commit_hash>`.
#[tauri::command]
pub async fn git_reset_to_commit(root_dir: String, commit_hash: String) -> Result<(), String> {
    let output = Command::new("git")
        .args(&["reset", "--hard", &commit_hash])
        .current_dir(&root_dir)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}
