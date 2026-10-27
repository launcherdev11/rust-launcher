use std::io::Read;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

pub fn run_with_timeout(
    mut cmd: Command,
    timeout: Duration,
    should_abort: impl Fn() -> bool,
) -> Result<Output, String> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    fn drain<R: Read + Send + 'static>(pipe: Option<R>) -> std::thread::JoinHandle<Vec<u8>> {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_end(&mut buf);
            }
            buf
        })
    }
    let out_reader = drain(child.stdout.take());
    let err_reader = drain(child.stderr.take());

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {}
            Err(e) => return Err(e.to_string()),
        }
        if should_abort() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Операция отменена пользователем".to_string());
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "Процесс не завершился за {} мин и был остановлен",
                timeout.as_secs() / 60
            ));
        }
        std::thread::sleep(Duration::from_millis(200));
    };

    Ok(Output {
        status,
        stdout: out_reader.join().unwrap_or_default(),
        stderr: err_reader.join().unwrap_or_default(),
    })
}
