//! memlog desktop shell (Tauri 2).
//!
//! The frontend talks to the backend through a single `#[tauri::command]`
//! (`memlog_rpc`) which forwards to a long-running sidecar over stdio
//! JSON-RPC. No HTTP, no ports, no CORS — just an OS pipe between the
//! webview and the Bun-compiled backend.
//!
//! Debug vs release:
//!
//! - **Debug** (`tauri dev`): Vite serves the UI on :5173. The Tauri window
//!   still points there, and JS invokes `memlog_rpc` just like in prod —
//!   the Rust side always spawns the sidecar and proxies calls.
//!
//! - **Release** (`tauri build`): the frontend is bundled as static assets;
//!   the sidecar binary + Pyodide runtime ship inside the .app / .exe and
//!   are resolved relative to the executable.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tokio::sync::{oneshot, Mutex};

/// Shared IPC channel to the sidecar, available via Tauri's State manager.
struct Ipc {
    /// Writable end of the child's stdin — we .write JSON frames here.
    child: Mutex<CommandChild>,
    /// Pending requests awaiting a matching `{"id": N, "result|error"}` frame.
    pending: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    /// Monotonic id generator.
    next_id: AtomicU64,
}

impl Ipc {
    async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().await;
            pending.insert(id, tx);
        }

        let frame = json!({"id": id, "method": method, "params": params}).to_string() + "\n";
        {
            let mut child = self.child.lock().await;
            child
                .write(frame.as_bytes())
                .map_err(|e| format!("ipc write: {e}"))?;
        }

        let resp = rx
            .await
            .map_err(|_| "sidecar dropped the request".to_string())?;

        if let Some(err) = resp.get("error").and_then(Value::as_str) {
            return Err(err.to_string());
        }
        Ok(resp
            .get("result")
            .cloned()
            .unwrap_or(Value::Null))
    }
}

#[tauri::command]
async fn memlog_rpc(
    method: String,
    params: Option<Value>,
    ipc: State<'_, Arc<Ipc>>,
) -> Result<Value, String> {
    ipc.call(&method, params.unwrap_or(Value::Null)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![memlog_rpc])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = setup_main(handle).await {
                    eprintln!("[memlog-app] setup failed: {err}");
                    std::process::exit(1);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

async fn setup_main(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let ipc = spawn_sidecar(&app).await?;
    app.manage(ipc);

    let url = if cfg!(debug_assertions) {
        WebviewUrl::External("http://localhost:5173".parse()?)
    } else {
        WebviewUrl::App("index.html".into())
    };

    let builder = WebviewWindowBuilder::new(&app, "main", url)
        .title("memlog")
        .inner_size(1200.0, 800.0)
        .min_inner_size(720.0, 480.0)
        .resizable(true);

    // Platform-specific chrome:
    //   macOS — keep native traffic lights but hide the title & make the
    //           title bar transparent so our React header paints through.
    //   Win/Linux — full custom chrome; our TitleBar draws min/max/close.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);

    let window = builder.build()?;

    // Intercept ⌘W / × → hide to tray rather than destroy. Quit via tray menu.
    // On macOS we also flip the activation policy to Accessory so the Dock
    // icon disappears (Docker-style menubar-only mode).
    let app_handle_for_close = app.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if let Some(w) = app_handle_for_close.get_webview_window("main") {
                let _ = w.hide();
            }
            #[cfg(target_os = "macos")]
            {
                let _ = app_handle_for_close
                    .set_activation_policy(tauri::ActivationPolicy::Accessory);
            }
            api.prevent_close();
        }
    });

    setup_tray(&app)?;
    Ok(())
}

/// System tray icon with a context menu that doubles as the app's "always
/// here" entry point. Left-click re-opens the main window; right-click shows
/// Home / Search / Write / Quit.
fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItemBuilder::with_id("open", "Open memlog")
        .accelerator("CmdOrCtrl+Shift+M")
        .build(app)?;
    let search = MenuItemBuilder::with_id("search", "Search…")
        .accelerator("CmdOrCtrl+Shift+F")
        .build(app)?;
    let write = MenuItemBuilder::with_id("write", "New entry")
        .accelerator("CmdOrCtrl+Shift+N")
        .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit memlog")
        .accelerator("CmdOrCtrl+Q")
        .build(app)?;
    let menu = MenuBuilder::new(app)
        .items(&[&open, &search, &write])
        .separator()
        .items(&[&quit])
        .build()?;

    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;

    TrayIconBuilder::with_id("memlog-tray")
        .tooltip("memlog")
        .icon(tray_icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false) // left-click = show window, right-click = menu
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main(app, None),
            "search" => show_main(app, Some("/search")),
            "write" => show_main(app, Some("/write")),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle(), None);
            }
        })
        .build(app)?;

    Ok(())
}

/// Bring the main window to the front and optionally route to a frontend
/// path via an emitted event (the React Router side listens for this).
fn show_main(app: &AppHandle, route: Option<&str>) {
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        if let Some(path) = route {
            let _ = app.emit("memlog://navigate", path.to_string());
        }
    }
}

/// Spawn the memlog sidecar in stdio JSON-RPC mode and wire up an Ipc that
/// the `memlog_rpc` command can use. Waits for the sidecar's `[ipc] ready`
/// stderr line before returning, so the first invoke() can't lose a request.
async fn spawn_sidecar(app: &AppHandle) -> Result<Arc<Ipc>, Box<dyn std::error::Error>> {
    let pyodide_dir = app
        .path()
        .resource_dir()?
        .join("resources")
        .join("pyodide");

    // Co-located config: <install_dir>/config.json sits next to both the
    // Tauri exe and the sidecar binary. Schema: { "db_path": "..." }.
    // If `db_path` is set we forward it via --db; otherwise the sidecar
    // falls back to <install_dir>/data/db.sqlite — same dir, single source
    // of truth for both viewer and MCP.
    let config_path = std::env::current_exe()?
        .parent()
        .ok_or("current_exe has no parent")?
        .join("config.json");

    let configured_db: Option<String> = std::fs::read_to_string(&config_path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .and_then(|v| v.get("db_path").and_then(Value::as_str).map(str::to_string))
        .filter(|s| !s.is_empty());

    let mut cmd = app
        .shell()
        .sidecar("memlog")?
        .env("MEMLOG_PYODIDE_DIR", &pyodide_dir);
    if let Some(db) = configured_db {
        cmd = cmd.args(["--db", &db]);
    }

    let (mut rx, child) = cmd.spawn()?;

    let ipc = Arc::new(Ipc {
        child: Mutex::new(child),
        pending: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(0),
    });

    // Background task: read stdout, route {id, result|error} frames to their
    // waiting oneshot senders. Stderr is mirrored verbatim for debugging.
    let (ready_tx, ready_rx) = oneshot::channel::<()>();
    let mut ready_tx_opt = Some(ready_tx);
    let ipc_for_task = ipc.clone();

    tauri::async_runtime::spawn(async move {
        let mut stdout_buf = String::new();
        let mut stderr_buf = String::new();
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    stdout_buf.push_str(&String::from_utf8_lossy(&bytes));
                    drain_frames(&mut stdout_buf, &ipc_for_task).await;
                }
                CommandEvent::Stderr(bytes) => {
                    stderr_buf.push_str(&String::from_utf8_lossy(&bytes));
                    while let Some(nl) = stderr_buf.find('\n') {
                        let line = stderr_buf[..nl].to_string();
                        stderr_buf.drain(..=nl);
                        eprintln!("[memlog-sidecar] {}", line);
                        if line.contains("[ipc] ready") {
                            if let Some(t) = ready_tx_opt.take() {
                                let _ = t.send(());
                            }
                        }
                    }
                }
                CommandEvent::Error(err) => {
                    eprintln!("[memlog-sidecar] error: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[memlog-sidecar] exited: {:?}", payload);
                    // Fail any still-pending requests so the UI sees errors
                    // rather than hanging forever.
                    let mut pending = ipc_for_task.pending.lock().await;
                    for (_id, tx) in pending.drain() {
                        let _ = tx.send(json!({"error": "sidecar exited"}));
                    }
                    break;
                }
                _ => {}
            }
        }
    });

    // Don't return control until we've seen the ready marker.
    tokio::time::timeout(Duration::from_secs(15), ready_rx)
        .await
        .map_err(|_| "timed out waiting for sidecar ipc ready")?
        .map_err(|_| "sidecar exited before reporting ready")?;

    Ok(ipc)
}

/// Given a buffer that may contain 0+ newline-terminated JSON frames plus a
/// trailing partial line, parse out the complete ones and dispatch each.
async fn drain_frames(buf: &mut String, ipc: &Arc<Ipc>) {
    loop {
        let Some(nl) = buf.find('\n') else { break };
        let line = buf[..nl].to_string();
        buf.drain(..=nl);
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(frame) = serde_json::from_str::<Value>(trimmed) else {
            eprintln!("[memlog-sidecar] non-json stdout: {trimmed}");
            continue;
        };
        let Some(id) = frame.get("id").and_then(Value::as_u64) else {
            continue;
        };
        let mut pending = ipc.pending.lock().await;
        if let Some(tx) = pending.remove(&id) {
            let _ = tx.send(frame);
        }
    }
}
