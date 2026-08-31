use std::{
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::Mutex,
};
use tauri::{Emitter, Manager};

fn user_facing_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(target_os = "windows")]
    {
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{rest}");
        }
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return rest.to_owned();
        }
    }
    value.into_owned()
}

fn is_engine_candidate(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("");
    if cfg!(target_os = "windows") {
        extension.eq_ignore_ascii_case("exe")
    } else {
        extension.is_empty()
            || extension.eq_ignore_ascii_case("bin")
            || extension.eq_ignore_ascii_case("appimage")
    }
}

fn engine_candidate_priority(path: &Path) -> u8 {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if name.contains("pikafish") {
        0
    } else if name.contains("pika") || name.contains("jieqi") {
        1
    } else {
        2
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EnginePathInspection {
    engine_path: Option<String>,
    nnue_path: Option<String>,
}

#[tauri::command]
fn inspect_engine_path(path: String) -> Result<EnginePathInspection, String> {
    let selected = Path::new(&path)
        .canonicalize()
        .map_err(|error| format!("无法访问所选路径：{error}"))?;
    let engine_path = if selected.is_file() {
        Some(selected.clone())
    } else if selected.is_dir() {
        let mut candidates = std::fs::read_dir(&selected)
            .map_err(|error| format!("无法读取所选目录：{error}"))?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|candidate| candidate.is_file() && is_engine_candidate(candidate))
            .collect::<Vec<_>>();
        candidates.sort_by_key(|candidate| engine_candidate_priority(candidate));
        candidates.into_iter().next()
    } else {
        None
    };

    let directory = engine_path
        .as_deref()
        .and_then(Path::parent)
        .unwrap_or(&selected);
    let nnue_path = std::fs::read_dir(directory).ok().and_then(|entries| {
        entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|candidate| {
                candidate.is_file()
                    && candidate
                        .extension()
                        .and_then(|extension| extension.to_str())
                        .is_some_and(|extension| extension.eq_ignore_ascii_case("nnue"))
            })
    });

    Ok(EnginePathInspection {
        engine_path: engine_path.as_deref().map(user_facing_path),
        nnue_path: nnue_path.as_deref().map(user_facing_path),
    })
}

#[derive(Default)]
struct EngineProcess {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
}

fn stop_process(engine: &mut EngineProcess) {
    if let Some(stdin) = engine.stdin.as_mut() {
        let _ = stdin.write_all(b"quit\n");
        let _ = stdin.flush();
    }
    engine.stdin.take();
    if let Some(mut child) = engine.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[tauri::command]
fn spawn_engine(
    path: String,
    args: Vec<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<EngineProcess>>,
) -> Result<(), String> {
    let engine_path = Path::new(&path)
        .canonicalize()
        .map_err(|error| format!("无法访问引擎文件：{error}"))?;
    if !engine_path.is_file() {
        return Err("引擎路径不是文件".into());
    }
    let working_dir = engine_path
        .parent()
        .ok_or_else(|| "无法确定引擎工作目录".to_string())?;

    let mut process = state.lock().map_err(|_| "引擎状态锁异常")?;
    stop_process(&mut process);

    let mut child = Command::new(&engine_path)
        .args(args)
        .current_dir(working_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags_for_windows()
        .spawn()
        .map_err(|error| format!("引擎启动失败：{error}"))?;

    let stdin = child.stdin.take().ok_or("无法连接引擎输入")?;
    let stdout = child.stdout.take().ok_or("无法连接引擎输出")?;
    let stderr = child.stderr.take().ok_or("无法连接引擎错误输出")?;

    for (stream, event_name) in [
        (
            Box::new(stdout) as Box<dyn std::io::Read + Send>,
            "engine-output",
        ),
        (
            Box::new(stderr) as Box<dyn std::io::Read + Send>,
            "engine-error",
        ),
    ] {
        let handle = app.clone();
        std::thread::spawn(move || {
            // 部分揭棋引擎仍以 Windows 本地代码页（GBK）输出中文。BufRead::lines()
            // 要求严格 UTF-8，首行解码失败后会直接结束迭代，导致后续 ASCII
            // 的 uciok/readyok 永远无法送达前端。按字节切行，先按 UTF-8 解码，
            // 失败时回退 GBK，协议关键字不受影响，中文说明文字也能正常显示。
            let mut reader = BufReader::new(stream);
            let mut bytes = Vec::new();
            loop {
                bytes.clear();
                match reader.read_until(b'\n', &mut bytes) {
                    Ok(0) => break,
                    Ok(_) => {
                        let line = match std::str::from_utf8(&bytes) {
                            Ok(text) => text.trim_end_matches(['\r', '\n']).to_owned(),
                            Err(_) => {
                                let (text, _, _) = encoding_rs::GBK.decode(&bytes);
                                text.trim_end_matches(['\r', '\n']).to_owned()
                            }
                        };
                        let _ = handle.emit(event_name, line);
                    }
                    Err(_) => break,
                }
            }
        });
    }

    process.stdin = Some(stdin);
    process.child = Some(child);
    Ok(())
}

trait WindowsCommandExt {
    fn creation_flags_for_windows(&mut self) -> &mut Self;
}

impl WindowsCommandExt for Command {
    fn creation_flags_for_windows(&mut self) -> &mut Self {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(0x08000000);
        }
        self
    }
}

#[tauri::command]
fn send_to_engine(
    command: String,
    state: tauri::State<'_, Mutex<EngineProcess>>,
) -> Result<(), String> {
    let mut process = state.lock().map_err(|_| "引擎状态锁异常")?;
    let stdin = process.stdin.as_mut().ok_or("引擎尚未启动")?;
    stdin
        .write_all(format!("{command}\n").as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("发送引擎命令失败：{error}"))
}

#[tauri::command]
fn kill_engine(state: tauri::State<'_, Mutex<EngineProcess>>) -> Result<(), String> {
    let mut process = state.lock().map_err(|_| "引擎状态锁异常")?;
    stop_process(&mut process);
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(EngineProcess::default()))
        .invoke_handler(tauri::generate_handler![
            spawn_engine,
            send_to_engine,
            kill_engine,
            inspect_engine_path
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("象棋道")?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动象棋道失败");
}
