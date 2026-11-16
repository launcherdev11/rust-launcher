use std::io::{BufRead, BufReader, Read};

use tauri::{AppHandle, Emitter};

use crate::models::events::{GameConsoleLinePayload, EVENT_GAME_CONSOLE_LINE};

pub fn log_to_console(app: &AppHandle, line: &str) {
    let payload = GameConsoleLinePayload {
        line: line.to_string(),
        source: "stdout".to_string(),
    };
    let _ = app.emit(EVENT_GAME_CONSOLE_LINE, payload);
}

pub(crate) fn for_each_output_line(stream: impl Read, mut on_line: impl FnMut(String)) {
    let mut reader = BufReader::new(stream);
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => return,
            Ok(_) => {
                let text = String::from_utf8_lossy(&buf);
                on_line(text.trim_end_matches(['\r', '\n']).to_string());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect(input: &[u8]) -> Vec<String> {
        let mut lines = Vec::new();
        for_each_output_line(input, |line| lines.push(line));
        lines
    }

    #[test]
    fn non_utf8_line_does_not_stop_reading() {
        let lines = collect(b"first\r\n[Render thread/INFO]: \xC7\xE0\xE3\xF0\xF3\xE7\xEA\xE0\r\nStarted serving on 58719\r\n");
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0], "first");
        assert_eq!(lines[2], "Started serving on 58719");
    }

    #[test]
    fn last_line_without_newline_is_kept() {
        assert_eq!(collect(b"a\nb"), ["a", "b"]);
    }
}
