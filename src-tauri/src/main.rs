#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use std::thread;
use std::time::Duration;

#[cfg(windows)]
use windows_sys::Win32::Foundation::RECT;
#[cfg(windows)]
use windows_sys::Win32::Graphics::Gdi::{CreateRoundRectRgn, DeleteObject, SetWindowRgn};
#[cfg(windows)]
use windows_sys::Win32::UI::WindowsAndMessaging::{GetClientRect, IsZoomed};

const DESKTOP_SESSION_SERVICE: &str = "com.marumaru.knowledgebase";
const DESKTOP_SESSION_ACCOUNT: &str = "desktop-bearer-session";

fn desktop_session_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(DESKTOP_SESSION_SERVICE, DESKTOP_SESSION_ACCOUNT)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn read_desktop_session_token() -> Result<Option<String>, String> {
    match desktop_session_entry()?.get_password() {
        Ok(token) if token.trim().is_empty() => Ok(None),
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn save_desktop_session_token(token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("session token must not be empty".into());
    }
    desktop_session_entry()?.set_password(&token).map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_desktop_session_token() -> Result<(), String> {
    match desktop_session_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_maximize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    let maximized = window.is_maximized().map_err(|error| error.to_string())?;
    if maximized {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
}

#[tauri::command]
fn is_maximized_window(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_maximized().map_err(|error| error.to_string())
}

#[tauri::command]
fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) { app.exit(0); }

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_always_on_top(false);
        let _ = window.set_focus();
    }
}

#[cfg(windows)]
fn apply_window_region_hwnd(hwnd: windows_sys::Win32::Foundation::HWND) {
    unsafe {
        if IsZoomed(hwnd) != 0 {
            SetWindowRgn(hwnd, std::ptr::null_mut(), 1);
            return;
        }
        let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if GetClientRect(hwnd, &mut rect) == 0 {
            return;
        }
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        if width <= 0 || height <= 0 {
            return;
        }
        let radius = 24;
        let region = CreateRoundRectRgn(0, 0, width + 1, height + 1, radius * 2, radius * 2);
        if !region.is_null() && SetWindowRgn(hwnd, region, 1) == 0 {
            DeleteObject(region);
        }
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            minimize_window,
            toggle_maximize_window,
            is_maximized_window,
            close_window,
            read_desktop_session_token,
            save_desktop_session_token,
            clear_desktop_session_token,
            exit_app,
        ])
        .plugin(
            tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                show_main_window(app);
            }),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        show_main_window(app);
                        let name = shortcut.to_string().to_ascii_uppercase().replace(' ', "");
                        if name == "CTRL+SHIFT+J" {
                            let _ = app.emit("desktop-daily-note-shortcut", ());
                        }
                    }
                })
                .build(),
        )
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_background_color(Some((242, 238, 231, 255).into()));
                if let Ok(hwnd) = window.hwnd() { apply_window_region_hwnd(hwnd.0 as _); }
            }
            let open = MenuItem::with_id(app, "open", "打开 MaruMaru", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出 MaruMaru", true, None::<&str>)?;
            let menu = MenuBuilder::new(app).items(&[&open, &quit]).build()?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().ok_or("missing application icon")?.clone())
                .icon_as_template(false)
                .tooltip("MaruMaru")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "quit" => {
                        let _ = app.emit("daily-note-exit-request", ());
                        // The authenticated UI flushes drafts before exiting. If the
                        // UI is still on the session gate or has already unloaded,
                        // guarantee that tray Quit cannot leave a hidden process.
                        let handle = app.clone();
                        thread::spawn(move || {
                            thread::sleep(Duration::from_secs(2));
                            handle.exit(0);
                        });
                    },
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Windows may reserve Alt+Space for the native window menu. A conflict
            // must not prevent the desktop client from starting.
            let _ = app.global_shortcut().register("ALT+SPACE");
            let _ = app.global_shortcut().register("CTRL+SHIFT+M");
            let _ = app.global_shortcut().register("CTRL+SHIFT+J");
            // Explicitly surface the first window; dev launches can otherwise
            // leave a valid WebView behind the terminal that started Tauri.
            show_main_window(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }) {
                if let Ok(hwnd) = window.hwnd() {
                    apply_window_region_hwnd(hwnd.0 as _);
                    // Maximize/restore updates the client rect asynchronously on Windows.
                    #[cfg(windows)]
                    {
                        let hwnd = hwnd.0 as usize;
                        thread::spawn(move || {
                            thread::sleep(Duration::from_millis(40));
                            apply_window_region_hwnd(hwnd as windows_sys::Win32::Foundation::HWND);
                        });
                    }
                }
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.app_handle().emit("daily-note-window-hidden", ());
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running MaruMaru");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_session_credential_round_trip() {
        let entry = keyring::Entry::new("com.marumaru.knowledgebase.test", DESKTOP_SESSION_ACCOUNT)
            .expect("open Windows credential entry");
        entry.delete_credential().ok();
        entry.set_password("test-desktop-session-token").expect("write Windows credential entry");
        assert_eq!(entry.get_password().expect("read Windows credential entry"), "test-desktop-session-token");
        entry.delete_credential().expect("delete Windows credential entry");
    }
}
