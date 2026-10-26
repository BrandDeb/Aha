//! The desktop shell for Aha!
//!
//! The studio is a web app with a local server (compilers, runners, the agent's
//! tools), so the native app is deliberately thin: it starts that server with a
//! bundled Node.js on a free loopback port, shows a loading screen meanwhile,
//! then points the window at it. The page gets no native APIs; it runs exactly
//! as it does in a browser, with the same security model. Links that leave the
//! studio open in your browser, downloads go to your Downloads folder, and the
//! server stops when the app quits.

use std::fs::{self, File};
#[cfg(unix)]
use std::io::Read;
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::webview::DownloadEvent;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

/// The studio's server process
struct Server(Mutex<Option<Child>>);

const NODE: &str = if cfg!(windows) { "node.exe" } else { "node" };
const READY_TIMEOUT: Duration = Duration::from_secs(90);

/// A free port on the loopback interface
fn free_port() -> std::io::Result<u16> {
    Ok(TcpListener::bind("127.0.0.1:0")?.local_addr()?.port())
}

/// A JavaScript string literal
fn js_string(text: &str) -> String {
    let mut out = String::from("\"");
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            '<' => out.push_str("\\u003c"),
            c if (c as u32) < 0x20 => {}
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The PATH your login shell sets up. Apps started from the Dock or Finder get a minimal PATH,
/// which would hide the compilers you installed (Homebrew, rustup, nvm...); the studio prefers them.
#[cfg(unix)]
fn login_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut child = Command::new(shell)
        .args(["-ilc", "printf '%s' \"$PATH\""])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => return None,
            Ok(None) if start.elapsed() > Duration::from_secs(3) => {
                let _ = child.kill();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(30)),
            Err(_) => return None,
        }
    }
    let mut path = String::new();
    child.stdout.take()?.read_to_string(&mut path).ok()?;
    let path = path.trim().to_string();
    (!path.is_empty()).then_some(path)
}

#[cfg(unix)]
fn server_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = login_path().unwrap_or_default().split(':').filter(|p| !p.is_empty()).map(String::from).collect();
    // Common install locations, in case the shell couldn't be asked
    let home = std::env::var("HOME").unwrap_or_default();
    for extra in ["/opt/homebrew/bin", "/usr/local/bin", &format!("{home}/.cargo/bin"), &format!("{home}/.local/bin")] {
        parts.push(extra.to_string());
    }
    for part in current.split(':') {
        parts.push(part.to_string());
    }
    let mut seen = std::collections::HashSet::new();
    parts.retain(|p| !p.is_empty() && seen.insert(p.clone()));
    parts.join(":")
}

#[cfg(windows)]
fn server_path() -> String {
    std::env::var("PATH").unwrap_or_default()
}

/// Start the studio's server (under its supervisor, which restarts it if it crashes)
fn start_server(app: &AppHandle, port: u16) -> Result<(Child, PathBuf), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let node = exe.parent().ok_or("No app folder")?.join(NODE);
    let root = app.path().resource_dir().map_err(|e| e.to_string())?.join("app");
    if !node.exists() {
        return Err(format!("The bundled Node.js is missing ({}). Reinstall the app.", node.display()));
    }
    if !root.join("server.js").exists() {
        return Err(format!("The studio files are missing ({}). Reinstall the app.", root.display()));
    }
    // The install folder is read-only (Program Files, a signed .app): builds go to the cache folder
    let temp = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("temp");
    fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
    let logs = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&logs).map_err(|e| e.to_string())?;
    let log_path = logs.join("server.log");
    let log = File::create(&log_path).map_err(|e| e.to_string())?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    let mut command = Command::new(&node);
    command
        .arg(root.join("scripts").join("supervise.js"))
        .current_dir(&root)
        .env("PATH", server_path())
        .env("NODE_ENV", "production")
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("NEXT_PUBLIC_BASE_URL", format!("http://127.0.0.1:{port}"))
        .env("AHA_TEMP_DIR", &temp)
        .env("AHA_DESKTOP", "1")
        // The supervisor stops the studio if the app disappears without saying so
        .env("AHA_PARENT_PID", std::process::id().to_string())
        .env("NEXT_TELEMETRY_DISABLED", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window for the server
        command.creation_flags(0x0800_0000);
    }
    let child = command.spawn().map_err(|e| format!("Could not start the studio: {e}"))?;
    Ok((child, log_path))
}

/// Wait until the server accepts connections (it listens only once it is ready to serve)
fn wait_ready(port: u16, server: &Mutex<Option<Child>>) -> Result<(), String> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let start = Instant::now();
    while start.elapsed() < READY_TIMEOUT {
        if let Some(child) = server.lock().unwrap().as_mut() {
            if let Ok(Some(status)) = child.try_wait() {
                return Err(format!("The studio stopped while starting ({status})."));
            }
        }
        if TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(80));
    }
    Err("The studio did not start within 90 seconds.".into())
}

/// Stop the server and everything it started
fn stop_server(server: &Mutex<Option<Child>>) {
    let Some(mut child) = server.lock().unwrap().take() else { return };
    #[cfg(unix)]
    {
        // The supervisor forwards SIGTERM to the server, which shuts down cleanly
        let _ = Command::new("kill").args(["-TERM", &child.id().to_string()]).status();
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(4) {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No signals on Windows: end the whole tree (supervisor, server, programs it runs)
        let _ = Command::new("taskkill").args(["/PID", &child.id().to_string(), "/T", "/F"]).creation_flags(0x0800_0000).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Pages the window may show: the loading screen and the studio (and its loopback previews)
fn stays_in_app(url: &Url) -> bool {
    match url.scheme() {
        "tauri" | "about" | "blob" | "data" => true,
        "http" | "https" => matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "tauri.localhost")),
        _ => false,
    }
}

fn file_name(path: &Path, url: &Url) -> PathBuf {
    path.file_name()
        .map(PathBuf::from)
        .or_else(|| url.path_segments().and_then(|mut s| s.next_back().map(PathBuf::from)))
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| PathBuf::from("download"))
}

fn main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let handle = app.clone();
    let downloads = app.path().download_dir().ok();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Aha!")
        .inner_size(1440.0, 900.0)
        .min_inner_size(900.0, 600.0)
        .on_navigation(move |url| {
            if stays_in_app(url) {
                return true;
            }
            // Everything else (docs, GitHub, a provider's site) opens in your browser
            let _ = handle.opener().open_url(url.as_str(), None::<&str>);
            false
        })
        .on_download(move |_webview, event| {
            if let DownloadEvent::Requested { url, destination } = event {
                if let Some(dir) = &downloads {
                    *destination = dir.join(file_name(destination, &url));
                }
            }
            true
        })
        .build()
}

pub fn run() {
    let app = tauri::Builder::default()
        // A second launch focuses the running app instead of starting another server
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            let window = main_window(app.handle())?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let fail = |message: String, log: Option<PathBuf>| {
                    let detail = log.map(|p| format!("Details: {}", p.display())).unwrap_or_default();
                    let _ = window.eval(&format!("window.showError && window.showError({}, {})", js_string(&message), js_string(&detail)));
                };
                let port = match free_port() {
                    Ok(port) => port,
                    Err(e) => return fail(format!("No free port: {e}"), None),
                };
                let server = handle.state::<Server>();
                let log = match start_server(&handle, port) {
                    Ok((child, log)) => {
                        *server.0.lock().unwrap() = Some(child);
                        log
                    }
                    Err(e) => return fail(e, None),
                };
                if let Err(e) = wait_ready(port, &server.0) {
                    return fail(e, Some(log));
                }
                match Url::parse(&format!("http://127.0.0.1:{port}/")) {
                    Ok(url) => {
                        let _ = window.navigate(url);
                    }
                    Err(e) => fail(e.to_string(), None),
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Aha!");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_server(&handle.state::<Server>().0);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_studio_and_loopback_stay_in_the_window() {
        for ok in ["http://127.0.0.1:4123/", "http://localhost:5173/x", "tauri://localhost/index.html", "http://tauri.localhost/index.html", "about:blank"] {
            assert!(stays_in_app(&Url::parse(ok).unwrap()), "{ok}");
        }
        for out in ["https://github.com/login", "https://docs.example.com", "http://127.0.0.1.evil.example/", "file:///etc/passwd", "javascript:alert(1)"] {
            assert!(!stays_in_app(&Url::parse(out).unwrap()), "{out}");
        }
    }

    #[test]
    fn js_strings_cannot_break_out() {
        assert_eq!(js_string("a\"b\\c\nd</script>"), "\"a\\\"b\\\\c\\nd\\u003c/script>\"");
    }

    #[test]
    fn a_free_port_is_free() {
        let port = free_port().unwrap();
        assert!(port > 0);
        TcpListener::bind(("127.0.0.1", port)).unwrap();
    }
}
