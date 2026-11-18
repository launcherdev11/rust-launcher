#[cfg(windows)]
pub(super) fn listening_ports(pid: u32) -> Vec<u16> {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCP6TABLE_OWNER_PID, MIB_TCPROW_OWNER_PID,
        MIB_TCPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
    };

    const AF_INET: u32 = 2;
    const AF_INET6: u32 = 23;
    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;

    fn read_table(family: u32) -> Option<Vec<u32>> {
        let mut size = 0u32;
        unsafe {
            GetExtendedTcpTable(None, &mut size, false, family, TCP_TABLE_OWNER_PID_LISTENER, 0);
        }
        for _ in 0..4 {
            let mut buf = vec![0u32; (size as usize).div_ceil(4).max(1)];
            let mut len = (buf.len() * 4) as u32;
            let rc = unsafe {
                GetExtendedTcpTable(
                    Some(buf.as_mut_ptr().cast()),
                    &mut len,
                    false,
                    family,
                    TCP_TABLE_OWNER_PID_LISTENER,
                    0,
                )
            };
            match rc {
                0 => return Some(buf),
                ERROR_INSUFFICIENT_BUFFER => size = len,
                _ => return None,
            }
        }
        None
    }

    fn rows<'a, Row>(buf: &'a [u32], rows_offset: usize) -> &'a [Row] {
        let count = buf[0] as usize;
        let available = (buf.len() * 4).saturating_sub(rows_offset) / std::mem::size_of::<Row>();
        let count = count.min(available);
        unsafe {
            let start = buf.as_ptr().cast::<u8>().add(rows_offset).cast::<Row>();
            std::slice::from_raw_parts(start, count)
        }
    }

    let port_of = |raw: u32| u16::from_be((raw & 0xffff) as u16);
    let mut ports = Vec::new();

    if let Some(buf) = read_table(AF_INET) {
        let offset = std::mem::offset_of!(MIB_TCPTABLE_OWNER_PID, table);
        for row in rows::<MIB_TCPROW_OWNER_PID>(&buf, offset) {
            if row.dwOwningPid == pid {
                ports.push(port_of(row.dwLocalPort));
            }
        }
    }
    if let Some(buf) = read_table(AF_INET6) {
        let offset = std::mem::offset_of!(MIB_TCP6TABLE_OWNER_PID, table);
        for row in rows::<MIB_TCP6ROW_OWNER_PID>(&buf, offset) {
            if row.dwOwningPid == pid {
                ports.push(port_of(row.dwLocalPort));
            }
        }
    }
    ports
}

#[cfg(target_os = "linux")]
pub(super) fn listening_ports(pid: u32) -> Vec<u16> {
    use std::collections::HashSet;

    let Ok(fds) = std::fs::read_dir(format!("/proc/{pid}/fd")) else {
        return Vec::new();
    };
    let inodes: HashSet<String> = fds
        .flatten()
        .filter_map(|entry| std::fs::read_link(entry.path()).ok())
        .filter_map(|target| {
            target
                .to_str()?
                .strip_prefix("socket:[")?
                .strip_suffix(']')
                .map(str::to_owned)
        })
        .collect();
    if inodes.is_empty() {
        return Vec::new();
    }

    let mut ports = Vec::new();
    for table in ["/proc/net/tcp", "/proc/net/tcp6"] {
        let Ok(text) = std::fs::read_to_string(table) else {
            continue;
        };
        for line in text.lines().skip(1) {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 10 || cols[3] != "0A" || !inodes.contains(cols[9]) {
                continue;
            }
            if let Some(port) = cols[1]
                .rsplit(':')
                .next()
                .and_then(|hex| u16::from_str_radix(hex, 16).ok())
            {
                ports.push(port);
            }
        }
    }
    ports
}

#[cfg(target_os = "macos")]
pub(super) fn listening_ports(pid: u32) -> Vec<u16> {
    let Ok(output) = std::process::Command::new("lsof")
        .args(["-nP", "-a", "-p", &pid.to_string(), "-iTCP", "-sTCP:LISTEN", "-Fn"])
        .output()
    else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.strip_prefix('n')?.rsplit(':').next()?.parse().ok())
        .collect()
}

#[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
pub(super) fn listening_ports(_pid: u32) -> Vec<u16> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(any(windows, target_os = "linux", target_os = "macos"))]
    #[test]
    fn own_listening_port_is_found() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(listening_ports(std::process::id()).contains(&port));
    }
}
