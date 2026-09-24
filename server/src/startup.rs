//! Startup contracts independent of the expensive card database.
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    net::{Ipv4Addr, TcpListener},
    path::Path,
};

const BIND_ATTEMPTS: usize = 100;

fn try_ports<T>(desired: u16, mut bind: impl FnMut(u16) -> io::Result<T>) -> io::Result<T> {
    let mut port = desired;
    for attempt in 0..BIND_ATTEMPTS {
        match bind(port) {
            Ok(listener) => return Ok(listener),
            Err(error) => {
                if error.kind() != io::ErrorKind::AddrInUse
                    || attempt + 1 == BIND_ATTEMPTS
                    || port == u16::MAX
                    || port == 0
                {
                    return Err(error);
                }
                port += 1;
            }
        }
    }
    unreachable!("at least one bind attempt")
}

pub fn bind(desired: u16) -> io::Result<TcpListener> {
    let listener = try_ports(desired, |port| {
        TcpListener::bind((Ipv4Addr::LOCALHOST, port))
    })?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

/// Publish complete JSON atomically without replacing ANY existing destination.
/// A same-directory hard link provides atomic create-if-absent on Windows and
/// Unix; unsupported filesystems fail safely rather than falling back to overwrite.
/// The caller owns stale-file cleanup, preferably using a unique per-run path.
pub fn publish_endpoint(path: &Path, port: u16, pid: u32) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temporary = None;
    for _ in 0..100 {
        let candidate = parent.join(format!(
            ".phase-mana-endpoint-{pid}-{:016x}.tmp",
            rand::random::<u64>()
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => {
                temporary = Some((candidate, file));
                break;
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    let (temporary, mut file) = temporary.ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::AlreadyExists,
            "cannot create endpoint staging file",
        )
    })?;
    let result = (|| {
        writeln!(file, "{}", serde_json::json!({"port": port, "pid": pid}))?;
        file.sync_all()?;
        // Close before linking/removing for Windows compatibility.
        drop(file);
        fs::hard_link(&temporary, path)
    })();
    let _ = fs::remove_file(&temporary);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn occupied_port_falls_forward() {
        let occupied = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = occupied.local_addr().unwrap().port();
        if port == u16::MAX {
            return;
        }
        let listener = bind(port).unwrap();
        let actual = listener.local_addr().unwrap();
        assert!(actual.ip().is_loopback());
        assert!(actual.port() > port);
        assert!(u32::from(actual.port()) < u32::from(port) + 100);
    }

    #[test]
    fn ephemeral_port_reports_actual_port() {
        assert_ne!(bind(0).unwrap().local_addr().unwrap().port(), 0);
    }

    #[test]
    fn retry_bound_overflow_and_non_address_errors() {
        for (start, kind, expected) in [
            (3001, io::ErrorKind::AddrInUse, 100),
            (65534, io::ErrorKind::AddrInUse, 2),
            (0, io::ErrorKind::AddrInUse, 1),
            (3001, io::ErrorKind::PermissionDenied, 1),
            (3001, io::ErrorKind::AddrNotAvailable, 1),
        ] {
            let mut ports = Vec::new();
            let result: io::Result<()> = try_ports(start, |port| {
                ports.push(port);
                Err(io::Error::new(kind, "injected bind failure"))
            });
            assert_eq!(result.unwrap_err().kind(), kind);
            assert_eq!(ports.len(), expected);
            assert_eq!(ports[0], start);
            assert!(ports.windows(2).all(|pair| pair[1] == pair[0] + 1));
        }
    }

    #[test]
    fn endpoint_is_complete_and_never_overwrites() {
        let dir =
            std::env::temp_dir().join(format!("phase-mana-test-{:016x}", rand::random::<u64>()));
        fs::create_dir(&dir).unwrap();
        let path = dir.join("endpoint.json");
        publish_endpoint(&path, 4321, 123).unwrap();
        let original = fs::read(&path).unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&original).unwrap(),
            serde_json::json!({"port": 4321, "pid": 123})
        );
        assert!(publish_endpoint(&path, 4322, 124).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        fs::write(&path, b"unrelated data").unwrap();
        assert!(publish_endpoint(&path, 4322, 124).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"unrelated data");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        assert!(publish_endpoint(&dir.join("missing/endpoint.json"), 1, 1).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
