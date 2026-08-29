use std::{
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::Mutex,
};
use tauri::{Emitter, Manager};

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
            // 部分揭棋引擎仍以 Windows 本地代码页输出中文。BufRead::lines()
            // 要求严格 UTF-8，首行解码失败后会直接结束迭代，导致后续 ASCII
            // 的 uciok/readyok 永远无法送达前端。按字节切行并宽松解码，协议
            // 关键字仍可原样保留，非 UTF-8 的说明文字则以替换字符展示。
            let mut reader = BufReader::new(stream);
            let mut bytes = Vec::new();
            loop {
                bytes.clear();
                match reader.read_until(b'\n', &mut bytes) {
                    Ok(0) => break,
                    Ok(_) => {
                        let line = String::from_utf8_lossy(&bytes)
                            .trim_end_matches(['\r', '\n'])
                            .to_owned();
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
        .manage(Mutex::new(EngineProcess::default()))
        .invoke_handler(tauri::generate_handler![
            spawn_engine,
            send_to_engine,
            kill_engine
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
