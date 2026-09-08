
use std::cmp::Ordering;
use std::io::{Cursor, Read};
use std::path::Path;

use zip::read::ZipArchive;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct McVersion {
    major: u32,
    minor: u32,
    patch: u32,
}

fn parse_mc_version(raw: &str) -> Option<McVersion> {
    let s = raw.trim().trim_start_matches('v');
    if s.is_empty() || !s.chars().next()?.is_ascii_digit() {
        return None;
    }
    let mut parts = s.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts
        .next()
        .map(|p| {
            let digits: String = p.chars().take_while(|c| c.is_ascii_digit()).collect();
            digits.parse().unwrap_or(0)
        })
        .unwrap_or(0);
    Some(McVersion {
        major,
        minor,
        patch,
    })
}

fn cmp_ver(a: McVersion, b: McVersion) -> Ordering {
    a.cmp(&b)
}

pub fn fabric_minecraft_range_matches(range: &str, game_version: &str) -> Option<bool> {
    let game = parse_mc_version(game_version)?;
    let range = range.trim();
    if range.is_empty() || range == "*" {
        return Some(true);
    }

    if let Some(base) = range.strip_suffix(".x").or_else(|| range.strip_suffix(".X")) {
        let base_ver = parse_mc_version(base)?;
        let next_minor = McVersion {
            major: base_ver.major,
            minor: base_ver.minor + 1,
            patch: 0,
        };
        let floor = McVersion {
            major: base_ver.major,
            minor: base_ver.minor,
            patch: 0,
        };
        return Some(cmp_ver(game, floor) != Ordering::Less && cmp_ver(game, next_minor) == Ordering::Less);
    }

    if range
        .chars()
        .all(|c| c.is_ascii_digit() || c == '.' || c == ' ')
        && !range.contains(' ')
    {
        let expected = parse_mc_version(range)?;
        let range_parts = range.split('.').count();
        return Some(match range_parts {
            1 => game.major == expected.major,
            2 => game.major == expected.major && game.minor == expected.minor,
            _ => game == expected,
        });
    }

    let mut ok = true;
    let mut saw_predicate = false;
    for token in range.split_whitespace() {
        let token = token.trim();
        if token.is_empty() {
            continue;
        }
        let (op, ver_str) = if let Some(v) = token.strip_prefix(">=") {
            (">=", v)
        } else if let Some(v) = token.strip_prefix("<=") {
            ("<=", v)
        } else if let Some(v) = token.strip_prefix('>') {
            (">", v)
        } else if let Some(v) = token.strip_prefix('<') {
            ("<", v)
        } else if let Some(v) = token.strip_prefix('=') {
            ("=", v)
        } else if let Some(v) = token.strip_prefix('~') {
            let ver = parse_mc_version(v)?;
            saw_predicate = true;
            let next = McVersion {
                major: ver.major,
                minor: ver.minor + 1,
                patch: 0,
            };
            ok = ok && cmp_ver(game, ver) != Ordering::Less && cmp_ver(game, next) == Ordering::Less;
            continue;
        } else if let Some(v) = token.strip_prefix('^') {
            let ver = parse_mc_version(v)?;
            saw_predicate = true;
            let next = McVersion {
                major: ver.major,
                minor: ver.minor + 1,
                patch: 0,
            };
            ok = ok && cmp_ver(game, ver) != Ordering::Less && cmp_ver(game, next) == Ordering::Less;
            continue;
        } else {
            return None;
        };

        let ver = parse_mc_version(ver_str)?;
        saw_predicate = true;
        ok = ok
            && match op {
                ">=" => cmp_ver(game, ver) != Ordering::Less,
                ">" => cmp_ver(game, ver) == Ordering::Greater,
                "<=" => cmp_ver(game, ver) != Ordering::Greater,
                "<" => cmp_ver(game, ver) == Ordering::Less,
                "=" => game == ver,
                _ => return None,
            };
    }

    if !saw_predicate {
        return None;
    }
    Some(ok)
}

pub fn maven_minecraft_range_matches(range: &str, game_version: &str) -> Option<bool> {
    let game = parse_mc_version(game_version)?;
    let range = range.trim();
    if range.is_empty() || range == "*" {
        return Some(true);
    }

    let chars: Vec<char> = range.chars().collect();
    if chars.len() < 3 {
        return None;
    }
    let start_incl = match chars[0] {
        '[' => true,
        '(' => false,
        _ => return None,
    };
    let end_incl = match chars[chars.len() - 1] {
        ']' => true,
        ')' => false,
        _ => return None,
    };
    let inner: String = chars[1..chars.len() - 1].iter().collect();
    let (left_raw, right_raw) = match inner.split_once(',') {
        Some(pair) => pair,
        None => {
            let only = parse_mc_version(inner.trim())?;
            return Some(game == only);
        }
    };

    if !left_raw.trim().is_empty() {
        let left = parse_mc_version(left_raw)?;
        let left_ok = if start_incl {
            cmp_ver(game, left) != Ordering::Less
        } else {
            cmp_ver(game, left) == Ordering::Greater
        };
        if !left_ok {
            return Some(false);
        }
    }
    if !right_raw.trim().is_empty() {
        let right = parse_mc_version(right_raw)?;
        let right_ok = if end_incl {
            cmp_ver(game, right) != Ordering::Greater
        } else {
            cmp_ver(game, right) == Ordering::Less
        };
        if !right_ok {
            return Some(false);
        }
    }
    Some(true)
}

fn read_zip_entry(bytes: &[u8], name: &str) -> Option<Vec<u8>> {
    let cursor = Cursor::new(bytes);
    let mut archive = ZipArchive::new(cursor).ok()?;
    let mut file = archive.by_name(name).ok()?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    if buf.is_empty() {
        None
    } else {
        Some(buf)
    }
}

fn fabric_mod_title_and_mc_range(json_bytes: &[u8]) -> (Option<String>, Option<String>) {
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(json_bytes) else {
        return (None, None);
    };
    let title = json
        .get("name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let range = json
        .pointer("/depends/minecraft")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .or_else(|| {
            json.get("depends")
                .and_then(|d| d.as_object())
                .and_then(|obj| {
                    obj.iter().find_map(|(k, v)| {
                        if k.eq_ignore_ascii_case("minecraft") {
                            v.as_str().map(|s| s.trim().to_string())
                        } else {
                            None
                        }
                    })
                })
                .filter(|s| !s.is_empty())
        });
    (title, range)
}

fn mods_toml_title_and_mc_range(text: &str) -> (Option<String>, Option<String>) {
    let mut title: Option<String> = None;
    for line in text.lines() {
        let t = line.trim();
        if let Some(rest) = t
            .strip_prefix("displayName")
            .or_else(|| t.strip_prefix("displayName "))
        {
            let rest = rest.trim().trim_start_matches('=').trim();
            let val = rest.trim_matches('"').trim_matches('\'').trim();
            if !val.is_empty() && title.is_none() {
                title = Some(val.to_string());
            }
        }
    }

    let lower = text.to_ascii_lowercase();
    let mut range: Option<String> = None;
    let mut search_from = 0;
    while let Some(rel) = lower[search_from..].find("modid") {
        let abs = search_from + rel;
        let after = &text[abs..];
        let line_end = after.find('\n').unwrap_or(after.len());
        let line = &after[..line_end];
        let is_minecraft = line.to_ascii_lowercase().contains("minecraft");
        if is_minecraft {
            let window = &text[abs..((abs + 400).min(text.len()))];
            for wline in window.lines().take(12) {
                let wl = wline.trim();
                if let Some(rest) = wl
                    .strip_prefix("versionRange")
                    .or_else(|| wl.strip_prefix("versionRange "))
                {
                    let rest = rest.trim().trim_start_matches('=').trim();
                    let val = rest.trim_matches('"').trim_matches('\'').trim();
                    if !val.is_empty() {
                        range = Some(val.to_string());
                        break;
                    }
                }
            }
            if range.is_some() {
                break;
            }
        }
        search_from = abs + 5;
    }

    (title, range)
}

pub fn jar_supports_game_version(
    jar_path: &Path,
    game_version: &str,
) -> (Option<bool>, Option<String>) {
    let bytes = match std::fs::read(jar_path) {
        Ok(b) => b,
        Err(_) => return (None, None),
    };

    if let Some(json_bytes) = read_zip_entry(&bytes, "fabric.mod.json") {
        let (title, range) = fabric_mod_title_and_mc_range(&json_bytes);
        if let Some(range) = range {
            if let Some(ok) = fabric_minecraft_range_matches(&range, game_version) {
                return (Some(ok), title);
            }
        }
    }

    for toml_name in ["META-INF/mods.toml", "META-INF/neoforge.mods.toml"] {
        if let Some(toml_bytes) = read_zip_entry(&bytes, toml_name) {
            let Ok(text) = String::from_utf8(toml_bytes) else {
                continue;
            };
            let (title, range) = mods_toml_title_and_mc_range(&text);
            if let Some(range) = range {
                if let Some(ok) = maven_minecraft_range_matches(&range, game_version) {
                    return (Some(ok), title);
                }
            }
        }
    }

    (None, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fabric_range_below_1_21() {
        assert_eq!(
            fabric_minecraft_range_matches(">=1.20.1 <1.21", "1.20.1"),
            Some(true)
        );
        assert_eq!(
            fabric_minecraft_range_matches(">=1.20.1 <1.21", "1.21.9"),
            Some(false)
        );
    }

    #[test]
    fn maven_range_below_1_21() {
        assert_eq!(
            maven_minecraft_range_matches("[1.20.1,1.21)", "1.20.1"),
            Some(true)
        );
        assert_eq!(
            maven_minecraft_range_matches("[1.20.1,1.21)", "1.21.9"),
            Some(false)
        );
    }
}
