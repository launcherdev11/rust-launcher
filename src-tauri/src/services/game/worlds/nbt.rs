use std::collections::HashMap;

#[derive(Debug, Clone)]
pub(crate) enum Tag {
    Byte(i8),
    Short(i16),
    Int(i32),
    Long(i64),
    #[allow(dead_code)]
    Float(f32),
    #[allow(dead_code)]
    Double(f64),
    ByteArray(Vec<i8>),
    String(String),
    List(Vec<Tag>),
    Compound(HashMap<String, Tag>),
    IntArray(Vec<i32>),
    LongArray(Vec<i64>),
}

impl Tag {
    pub(crate) fn get(&self, key: &str) -> Option<&Tag> {
        match self {
            Tag::Compound(map) => map.get(key),
            _ => None,
        }
    }

    pub(crate) fn path(&self, keys: &[&str]) -> Option<&Tag> {
        keys.iter().try_fold(self, |cur, k| cur.get(k))
    }

    pub(crate) fn as_i64(&self) -> Option<i64> {
        match self {
            Tag::Byte(v) => Some(*v as i64),
            Tag::Short(v) => Some(*v as i64),
            Tag::Int(v) => Some(*v as i64),
            Tag::Long(v) => Some(*v),
            _ => None,
        }
    }

    pub(crate) fn as_str(&self) -> Option<&str> {
        match self {
            Tag::String(s) => Some(s),
            _ => None,
        }
    }

    pub(crate) fn as_list(&self) -> Option<&[Tag]> {
        match self {
            Tag::List(v) => Some(v),
            _ => None,
        }
    }

    pub(crate) fn as_long_array(&self) -> Option<&[i64]> {
        match self {
            Tag::LongArray(v) => Some(v),
            _ => None,
        }
    }

    pub(crate) fn as_int_array(&self) -> Option<&[i32]> {
        match self {
            Tag::IntArray(v) => Some(v),
            _ => None,
        }
    }

    pub(crate) fn as_byte_array(&self) -> Option<&[i8]> {
        match self {
            Tag::ByteArray(v) => Some(v),
            _ => None,
        }
    }
}

const MAX_ARRAY_LEN: usize = 1 << 24;
const MAX_DEPTH: usize = 512;

struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        let end = self.pos.checked_add(n).ok_or("NBT: переполнение")?;
        if end > self.buf.len() {
            return Err("NBT: неожиданный конец данных".to_string());
        }
        let out = &self.buf[self.pos..end];
        self.pos = end;
        Ok(out)
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    fn i16(&mut self) -> Result<i16, String> {
        Ok(i16::from_be_bytes(self.take(2)?.try_into().unwrap()))
    }

    fn i32(&mut self) -> Result<i32, String> {
        Ok(i32::from_be_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn i64(&mut self) -> Result<i64, String> {
        Ok(i64::from_be_bytes(self.take(8)?.try_into().unwrap()))
    }

    fn len(&mut self) -> Result<usize, String> {
        let n = self.i32()?;
        if n < 0 || n as usize > MAX_ARRAY_LEN {
            return Err(format!("NBT: некорректная длина {n}"));
        }
        Ok(n as usize)
    }

    fn string(&mut self) -> Result<String, String> {
        let n = self.i16()? as u16 as usize;
        Ok(String::from_utf8_lossy(self.take(n)?).into_owned())
    }

    fn payload(&mut self, kind: u8, depth: usize) -> Result<Tag, String> {
        if depth > MAX_DEPTH {
            return Err("NBT: слишком глубокая вложенность".to_string());
        }
        Ok(match kind {
            1 => Tag::Byte(self.u8()? as i8),
            2 => Tag::Short(self.i16()?),
            3 => Tag::Int(self.i32()?),
            4 => Tag::Long(self.i64()?),
            5 => Tag::Float(f32::from_bits(self.i32()? as u32)),
            6 => Tag::Double(f64::from_bits(self.i64()? as u64)),
            7 => {
                let n = self.len()?;
                Tag::ByteArray(self.take(n)?.iter().map(|b| *b as i8).collect())
            }
            8 => Tag::String(self.string()?),
            9 => {
                let item = self.u8()?;
                let n = self.len()?;
                if item == 0 && n > 0 {
                    return Err("NBT: список пустого типа".to_string());
                }
                let mut v = Vec::with_capacity(n.min(4096));
                for _ in 0..n {
                    v.push(self.payload(item, depth + 1)?);
                }
                Tag::List(v)
            }
            10 => {
                let mut map = HashMap::new();
                loop {
                    let k = self.u8()?;
                    if k == 0 {
                        break;
                    }
                    let name = self.string()?;
                    let value = self.payload(k, depth + 1)?;
                    map.insert(name, value);
                }
                Tag::Compound(map)
            }
            11 => {
                let n = self.len()?;
                let bytes = self.take(n.checked_mul(4).ok_or("NBT: переполнение")?)?;
                Tag::IntArray(bytes.chunks_exact(4).map(|c| i32::from_be_bytes(c.try_into().unwrap())).collect())
            }
            12 => {
                let n = self.len()?;
                let bytes = self.take(n.checked_mul(8).ok_or("NBT: переполнение")?)?;
                Tag::LongArray(bytes.chunks_exact(8).map(|c| i64::from_be_bytes(c.try_into().unwrap())).collect())
            }
            other => return Err(format!("NBT: неизвестный тип {other}")),
        })
    }
}

pub(crate) fn parse(buf: &[u8]) -> Result<Tag, String> {
    let mut r = Reader { buf, pos: 0 };
    let kind = r.u8()?;
    if kind != 10 {
        return Err("NBT: корень не Compound".to_string());
    }
    let _name = r.string()?;
    r.payload(10, 0)
}

pub(crate) fn decompress(kind: u8, data: &[u8]) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut out = Vec::new();
    match kind {
        1 => {
            flate2::read::GzDecoder::new(data)
                .read_to_end(&mut out)
                .map_err(|e| format!("gzip: {e}"))?;
        }
        2 => {
            flate2::read::ZlibDecoder::new(data)
                .read_to_end(&mut out)
                .map_err(|e| format!("zlib: {e}"))?;
        }
        3 => out.extend_from_slice(data),
        other => return Err(format!("UNSUPPORTED_COMPRESSION:{other}")),
    }
    Ok(out)
}

pub(crate) fn read_gzip_file(path: &std::path::Path) -> Result<Tag, String> {
    let raw = std::fs::read(path).map_err(|e| format!("Не удалось прочитать {}: {e}", path.display()))?;
    parse(&decompress(1, &raw)?)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn write_compound(out: &mut Vec<u8>, entries: &[(&str, Tag)]) {
        for (name, tag) in entries {
            write_named(out, name, tag);
        }
        out.push(0);
    }

    fn kind_of(tag: &Tag) -> u8 {
        match tag {
            Tag::Byte(_) => 1,
            Tag::Short(_) => 2,
            Tag::Int(_) => 3,
            Tag::Long(_) => 4,
            Tag::Float(_) => 5,
            Tag::Double(_) => 6,
            Tag::ByteArray(_) => 7,
            Tag::String(_) => 8,
            Tag::List(_) => 9,
            Tag::Compound(_) => 10,
            Tag::IntArray(_) => 11,
            Tag::LongArray(_) => 12,
        }
    }

    fn write_str(out: &mut Vec<u8>, s: &str) {
        out.extend_from_slice(&(s.len() as u16).to_be_bytes());
        out.extend_from_slice(s.as_bytes());
    }

    fn write_named(out: &mut Vec<u8>, name: &str, tag: &Tag) {
        out.push(kind_of(tag));
        write_str(out, name);
        write_payload(out, tag);
    }

    pub(crate) fn write_payload(out: &mut Vec<u8>, tag: &Tag) {
        match tag {
            Tag::Byte(v) => out.push(*v as u8),
            Tag::Short(v) => out.extend_from_slice(&v.to_be_bytes()),
            Tag::Int(v) => out.extend_from_slice(&v.to_be_bytes()),
            Tag::Long(v) => out.extend_from_slice(&v.to_be_bytes()),
            Tag::Float(v) => out.extend_from_slice(&v.to_bits().to_be_bytes()),
            Tag::Double(v) => out.extend_from_slice(&v.to_bits().to_be_bytes()),
            Tag::ByteArray(v) => {
                out.extend_from_slice(&(v.len() as i32).to_be_bytes());
                out.extend(v.iter().map(|b| *b as u8));
            }
            Tag::String(s) => write_str(out, s),
            Tag::List(items) => {
                out.push(items.first().map(kind_of).unwrap_or(0));
                out.extend_from_slice(&(items.len() as i32).to_be_bytes());
                for i in items {
                    write_payload(out, i);
                }
            }
            Tag::Compound(map) => {
                let entries: Vec<(&str, Tag)> = map.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
                write_compound(out, &entries);
            }
            Tag::IntArray(v) => {
                out.extend_from_slice(&(v.len() as i32).to_be_bytes());
                for x in v {
                    out.extend_from_slice(&x.to_be_bytes());
                }
            }
            Tag::LongArray(v) => {
                out.extend_from_slice(&(v.len() as i32).to_be_bytes());
                for x in v {
                    out.extend_from_slice(&x.to_be_bytes());
                }
            }
        }
    }

    pub(crate) fn root(entries: &[(&str, Tag)]) -> Vec<u8> {
        let mut out = vec![10, 0, 0];
        write_compound(&mut out, entries);
        out
    }

    #[test]
    fn roundtrip_basic() {
        let bytes = root(&[
            ("DataVersion", Tag::Int(3465)),
            ("Name", Tag::String("minecraft:stone".into())),
            ("L", Tag::LongArray(vec![1, -2])),
            ("List", Tag::List(vec![Tag::Short(5), Tag::Short(6)])),
        ]);
        let t = parse(&bytes).unwrap();
        assert_eq!(t.get("DataVersion").and_then(Tag::as_i64), Some(3465));
        assert_eq!(t.get("Name").and_then(Tag::as_str), Some("minecraft:stone"));
        assert_eq!(t.get("L").and_then(Tag::as_long_array), Some(&[1i64, -2][..]));
        assert_eq!(t.get("List").and_then(Tag::as_list).map(|l| l.len()), Some(2));
    }

    #[test]
    fn rejects_truncated_and_huge() {
        let mut bytes = root(&[("A", Tag::Int(1))]);
        bytes.truncate(bytes.len() - 3);
        assert!(parse(&bytes).is_err());
        let mut evil = vec![10, 0, 0, 12, 0, 1, b'x'];
        evil.extend_from_slice(&i32::MAX.to_be_bytes());
        assert!(parse(&evil).is_err());
    }
}
