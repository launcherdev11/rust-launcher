use std::time::Duration;

#[derive(Debug, Clone)]
pub struct ProcessSnapshot {
    // имя исполняемого файла в нижнем регистре, например "javaw.exe"
    pub name: String,
    // время запуска в секундах от UNIX epoch
    pub start_time: u64,
    // суммарное процессорное время по всем ядрам
    pub cpu_time: Duration,
    pub memory_bytes: u64,
}

pub fn total_memory_bytes() -> u64 {
    system_memory().0
}

#[cfg(windows)]
mod imp {
    use std::time::Duration;

    use windows::core::{w, HSTRING, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, FILETIME, HANDLE};
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_SZ};
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows::Win32::System::Threading::{
        GetExitCodeProcess, GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
        TerminateProcess, PROCESS_ACCESS_RIGHTS, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
    };

    use super::ProcessSnapshot;

    const STILL_ACTIVE: u32 = 259;
    // секунды между 1601-01-01 и 1970-01-01
    const WINDOWS_TO_UNIX_EPOCH_SECS: u64 = 11_644_473_600;

    struct Handle(HANDLE);

    impl Handle {
        fn open(pid: u32, access: PROCESS_ACCESS_RIGHTS) -> Option<Self> {
            if pid == 0 {
                return None;
            }
            unsafe { OpenProcess(access, false, pid) }.ok().map(Self)
        }
    }

    impl Drop for Handle {
        fn drop(&mut self) {
            let _ = unsafe { CloseHandle(self.0) };
        }
    }

    fn filetime_to_u64(ft: FILETIME) -> u64 {
        ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64
    }

    fn exit_code(handle: &Handle) -> Option<u32> {
        let mut code = 0u32;
        unsafe { GetExitCodeProcess(handle.0, &mut code) }.ok()?;
        Some(code)
    }

    fn image_name(handle: &Handle) -> Option<String> {
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        unsafe {
            QueryFullProcessImageNameW(handle.0, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
        }
        .ok()?;
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        let name = path.rsplit(['\\', '/']).next().unwrap_or(&path);
        Some(name.to_ascii_lowercase())
    }

    pub fn is_alive(pid: u32) -> bool {
        Handle::open(pid, PROCESS_QUERY_LIMITED_INFORMATION)
            .and_then(|h| exit_code(&h))
            .is_some_and(|code| code == STILL_ACTIVE)
    }

    pub fn terminate(pid: u32) -> bool {
        Handle::open(pid, PROCESS_TERMINATE)
            .is_some_and(|h| unsafe { TerminateProcess(h.0, 1) }.is_ok())
    }

    pub fn system_memory() -> (u64, u64) {
        let mut status = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        match unsafe { GlobalMemoryStatusEx(&mut status) } {
            Ok(()) => (status.ullTotalPhys, status.ullAvailPhys),
            Err(_) => (0, 0),
        }
    }

    fn registry_string(name: &str) -> Option<String> {
        let mut buf = [0u16; 256];
        let mut size = std::mem::size_of_val(&buf) as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"),
                &HSTRING::from(name),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr().cast()),
                Some(&mut size),
            )
        };
        if status.is_err() {
            return None;
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..len]).trim().to_string()).filter(|s| !s.is_empty())
    }

    pub fn os_description() -> String {
        let build = registry_string("CurrentBuildNumber");
        let major = match build.as_deref().and_then(|b| b.parse::<u32>().ok()) {
            Some(n) if n >= 22000 => Some("11"),
            Some(n) if n >= 10240 => Some("10"),
            _ => None,
        };
        let mut out = String::from("Windows");
        for part in [major.map(str::to_string), registry_string("DisplayVersion")]
            .into_iter()
            .flatten()
        {
            out.push(' ');
            out.push_str(&part);
        }
        if let Some(build) = build {
            out.push_str(&format!(" ({build})"));
        }
        out
    }

    pub fn snapshot(pid: u32) -> Option<ProcessSnapshot> {
        let handle = Handle::open(pid, PROCESS_QUERY_LIMITED_INFORMATION)?;
        if exit_code(&handle)? != STILL_ACTIVE {
            return None;
        }

        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        unsafe { GetProcessTimes(handle.0, &mut creation, &mut exit, &mut kernel, &mut user) }
            .ok()?;
        let start_time = (filetime_to_u64(creation) / 10_000_000)
            .saturating_sub(WINDOWS_TO_UNIX_EPOCH_SECS);
        // FILETIME в интервалах по 100 нс
        let cpu_time =
            Duration::from_nanos((filetime_to_u64(kernel) + filetime_to_u64(user)) * 100);

        let mut counters = PROCESS_MEMORY_COUNTERS {
            cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32,
            ..Default::default()
        };
        let memory_bytes = if unsafe { K32GetProcessMemoryInfo(handle.0, &mut counters, counters.cb) }
            .as_bool()
        {
            counters.WorkingSetSize as u64
        } else {
            0
        };

        Some(ProcessSnapshot {
            name: image_name(&handle).unwrap_or_default(),
            start_time,
            cpu_time,
            memory_bytes,
        })
    }
}

#[cfg(not(windows))]
mod imp {
    use std::sync::Mutex;
    use std::time::Duration;

    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

    use super::ProcessSnapshot;

    static MEMORY_SYSTEM: Mutex<Option<System>> = Mutex::new(None);

    pub fn system_memory() -> (u64, u64) {
        let mut guard = MEMORY_SYSTEM.lock().unwrap_or_else(|e| e.into_inner());
        let sys = guard.get_or_insert_with(System::new);
        sys.refresh_memory();
        (sys.total_memory(), sys.available_memory())
    }

    pub fn os_description() -> String {
        format!(
            "{} {}",
            System::name().unwrap_or_default(),
            System::os_version().unwrap_or_default()
        )
        .trim()
        .to_string()
    }

    fn with_process<T>(pid: u32, kind: ProcessRefreshKind, f: impl FnOnce(&sysinfo::Process) -> T) -> Option<T> {
        if pid == 0 {
            return None;
        }
        let pid = Pid::from_u32(pid);
        let mut sys = System::new();
        sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, kind);
        sys.process(pid).map(f)
    }

    pub fn is_alive(pid: u32) -> bool {
        with_process(pid, ProcessRefreshKind::nothing(), |_| ()).is_some()
    }

    pub fn terminate(pid: u32) -> bool {
        with_process(pid, ProcessRefreshKind::nothing(), |p| p.kill()).unwrap_or(false)
    }

    pub fn snapshot(pid: u32) -> Option<ProcessSnapshot> {
        with_process(
            pid,
            ProcessRefreshKind::nothing().with_cpu().with_memory(),
            |p| ProcessSnapshot {
                name: p.name().to_string_lossy().to_ascii_lowercase(),
                start_time: p.start_time(),
                cpu_time: Duration::from_millis(p.accumulated_cpu_time()),
                memory_bytes: p.memory(),
            },
        )
    }
}

pub use imp::{is_alive, os_description, snapshot, system_memory, terminate};
