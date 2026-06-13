use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

pub fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
}
