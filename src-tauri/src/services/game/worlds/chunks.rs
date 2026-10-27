use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use base64::Engine;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::command;

use super::backups::{create_backup_blocking, game_is_running, world_dir, BackupKind};
use super::nbt::{self, Tag};

const SECTOR: u64 = 4096;
const REGION_PX: u32 = 512;
const DV_FLAT_LAYOUT: i64 = 2844;
const DV_NON_SPANNING: i64 = 2527;
const DV_PALETTE: i64 = 1451;
const RENDER_CACHE_LIMIT: usize = 96;

const ST_ABSENT: u8 = 0;
const ST_OK: u8 = 1;
const ST_DAMAGED: u8 = 2;
const ST_UNREADABLE: u8 = 3;
const ST_PROTO: u8 = 4;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldDimension {
    pub id: String,
    pub region_count: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldRegionRef {
    pub rx: i32,
    pub rz: i32,
    pub chunk_count: u32,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldOverview {
    pub data_version: Option<i64>,
    pub version_name: Option<String>,
    pub regions: Vec<WorldRegionRef>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorldRegionDetail {
    pub rx: i32,
    pub rz: i32,
    pub image: String,
    pub status: Vec<u8>,
    pub inhabited_ticks: Vec<u32>,
    pub data_version: Vec<u32>,
    pub saved_at: Vec<u32>,
}

#[derive(Debug, Deserialize)]
pub struct ChunkPos {
    pub x: i32,
    pub z: i32,
}

static RENDER_CACHE: Lazy<Mutex<HashMap<(PathBuf, u64), WorldRegionDetail>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn dimension_root(world: &Path, dimension: &str) -> Result<PathBuf, String> {
    match dimension {
        "minecraft:overworld" => Ok(world.to_path_buf()),
        "minecraft:the_nether" => Ok(world.join("DIM-1")),
        "minecraft:the_end" => Ok(world.join("DIM1")),
        other => {
            let (ns, path) = other.split_once(':').ok_or("Некорректное измерение")?;
            let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '_' | '-' | '.' | '/')) && !s.contains("..");
            if !ok(ns) || !ok(path) {
                return Err("Некорректное измерение".to_string());
            }
            Ok(world.join("dimensions").join(ns).join(path))
        }
    }
}

fn region_files(region_dir: &Path) -> Vec<(i32, i32, PathBuf)> {
    let Ok(rd) = fs::read_dir(region_dir) else { return Vec::new() };
    rd.flatten()
        .filter_map(|e| {
            let p = e.path();
            let name = p.file_name()?.to_str()?.to_string();
            let mut parts = name.strip_prefix("r.")?.strip_suffix(".mca")?.split('.');
            let rx = parts.next()?.parse().ok()?;
            let rz = parts.next()?.parse().ok()?;
            Some((rx, rz, p))
        })
        .collect()
}

fn read_header(file: &mut fs::File) -> Option<(Vec<u32>, Vec<u32>)> {
    let mut buf = vec![0u8; 8192];
    file.seek(SeekFrom::Start(0)).ok()?;
    file.read_exact(&mut buf).ok()?;
    let locations = buf[..4096].chunks_exact(4).map(|c| u32::from_be_bytes(c.try_into().unwrap())).collect();
    let stamps = buf[4096..].chunks_exact(4).map(|c| u32::from_be_bytes(c.try_into().unwrap())).collect();
    Some((locations, stamps))
}

enum ChunkRead {
    Ok(Tag),
    Damaged,
    Unreadable,
}

fn read_chunk(file: &mut fs::File, file_len: u64, location: u32, region_dir: &Path, cx: i32, cz: i32) -> ChunkRead {
    let offset = (location >> 8) as u64 * SECTOR;
    let sectors = (location & 0xff) as u64;
    if offset < 2 * SECTOR || sectors == 0 || offset + 5 > file_len {
        return ChunkRead::Damaged;
    }
    let mut head = [0u8; 5];
    if file.seek(SeekFrom::Start(offset)).is_err() || file.read_exact(&mut head).is_err() {
        return ChunkRead::Damaged;
    }
    let len = u32::from_be_bytes(head[..4].try_into().unwrap()) as u64;
    let kind = head[4];
    let data = if kind & 0x80 != 0 {
        match fs::read(region_dir.join(format!("c.{cx}.{cz}.mcc"))) {
            Ok(d) => d,
            Err(_) => return ChunkRead::Damaged,
        }
    } else {
        if len < 1 || offset + 4 + len > file_len || len > sectors * SECTOR {
            return ChunkRead::Damaged;
        }
        let mut d = vec![0u8; (len - 1) as usize];
        if file.read_exact(&mut d).is_err() {
            return ChunkRead::Damaged;
        }
        d
    };
    match nbt::decompress(kind & 0x7f, &data) {
        Ok(raw) => match nbt::parse(&raw) {
            Ok(tag) => ChunkRead::Ok(tag),
            Err(_) => ChunkRead::Damaged,
        },
        Err(e) if e.starts_with("UNSUPPORTED_COMPRESSION") => ChunkRead::Unreadable,
        Err(_) => ChunkRead::Damaged,
    }
}

fn packed_get(data: &[i64], bits: u32, index: usize, spanning: bool) -> Option<u32> {
    if bits == 0 || bits > 32 {
        return None;
    }
    let mask = (1u64 << bits) - 1;
    if spanning {
        let bit = index * bits as usize;
        let (word, shift) = (bit / 64, (bit % 64) as u32);
        let lo = *data.get(word)? as u64 >> shift;
        let value = if shift + bits > 64 {
            lo | ((*data.get(word + 1)? as u64) << (64 - shift))
        } else {
            lo
        };
        Some((value & mask) as u32)
    } else {
        let per_long = (64 / bits) as usize;
        let word = *data.get(index / per_long)? as u64;
        Some(((word >> ((index % per_long) as u32 * bits)) & mask) as u32)
    }
}

fn heightmap_bits(data: &[i64], spanning: bool) -> Option<u32> {
    let longs = data.len();
    if spanning {
        let bits = longs * 64 / 256;
        return (1..=32).contains(&bits).then_some(bits as u32);
    }
    (1..=32u32).find(|&b| {
        let per_long = 64 / b;
        let used = per_long * b;
        256usize.div_ceil(per_long as usize) == longs
            && (used == 64 || data.iter().all(|&w| (w as u64) >> used == 0))
    })
}

fn bits_for(count: usize, min: u32) -> u32 {
    let mut bits = 0;
    while (1usize << bits) < count {
        bits += 1;
    }
    bits.max(min)
}

fn block_color(name: &str) -> [u8; 3] {
    let n = name.strip_prefix("minecraft:").unwrap_or(name);
    let table: &[(&str, [u8; 3])] = &[
        ("water", [52, 92, 196]),
        ("kelp", [52, 92, 196]),
        ("seagrass", [52, 92, 196]),
        ("bubble_column", [52, 92, 196]),
        ("lava", [214, 96, 24]),
        ("magma", [150, 60, 20]),
        ("grass_block", [96, 148, 60]),
        ("moss", [90, 120, 50]),
        ("short_grass", [96, 148, 60]),
        ("tall_grass", [96, 148, 60]),
        ("fern", [80, 130, 55]),
        ("leaves", [54, 104, 40]),
        ("vine", [54, 104, 40]),
        ("snow", [236, 242, 246]),
        ("powder_snow", [236, 242, 246]),
        ("ice", [150, 186, 236]),
        ("sandstone", [214, 200, 150]),
        ("red_sand", [190, 104, 50]),
        ("sand", [220, 206, 156]),
        ("gravel", [134, 128, 124]),
        ("clay", [160, 166, 178]),
        ("mud", [70, 60, 56]),
        ("podzol", [104, 74, 40]),
        ("mycelium", [112, 96, 112]),
        ("dirt", [134, 96, 66]),
        ("farmland", [110, 76, 50]),
        ("dirt_path", [148, 122, 70]),
        ("terracotta", [160, 92, 68]),
        ("deepslate", [76, 76, 82]),
        ("netherrack", [110, 48, 48]),
        ("nether_wart", [120, 20, 30]),
        ("crimson", [140, 40, 50]),
        ("warped", [40, 120, 110]),
        ("soul_s", [80, 64, 52]),
        ("basalt", [70, 70, 76]),
        ("blackstone", [42, 38, 44]),
        ("end_stone", [220, 222, 160]),
        ("purpur", [168, 124, 168]),
        ("chorus", [130, 90, 130]),
        ("obsidian", [24, 18, 36]),
        ("bedrock", [60, 60, 60]),
        ("log", [102, 80, 50]),
        ("wood", [102, 80, 50]),
        ("planks", [162, 130, 80]),
        ("stairs", [140, 132, 124]),
        ("slab", [140, 132, 124]),
        ("glass", [190, 220, 230]),
        ("cobblestone", [118, 118, 118]),
        ("stone", [124, 124, 124]),
        ("andesite", [132, 134, 134]),
        ("diorite", [188, 188, 188]),
        ("granite", [150, 104, 86]),
        ("tuff", [108, 108, 98]),
        ("calcite", [222, 222, 218]),
        ("ore", [130, 130, 130]),
        ("cactus", [80, 130, 40]),
        ("pumpkin", [200, 120, 30]),
        ("melon", [120, 160, 40]),
        ("flower", [200, 180, 60]),
        ("wool", [210, 210, 210]),
        ("concrete", [160, 160, 170]),
        ("brick", [150, 80, 64]),
    ];
    for (key, color) in table {
        if n.contains(key) {
            return *color;
        }
    }
    let mut h: u32 = 2166136261;
    for b in n.bytes() {
        h = (h ^ b as u32).wrapping_mul(16777619);
    }
    [90 + (h & 63) as u8, 90 + ((h >> 8) & 63) as u8, 90 + ((h >> 16) & 63) as u8]
}

fn legacy_color(id: u8) -> [u8; 3] {
    match id {
        1 => [124, 124, 124],
        2 => [96, 148, 60],
        3 => [134, 96, 66],
        4 => [118, 118, 118],
        8 | 9 => [52, 92, 196],
        10 | 11 => [214, 96, 24],
        12 => [220, 206, 156],
        13 => [134, 128, 124],
        17 | 162 => [102, 80, 50],
        18 | 161 => [54, 104, 40],
        24 => [214, 200, 150],
        31 | 32 | 37 | 38 | 175 => [96, 148, 60],
        78 | 80 => [236, 242, 246],
        79 | 174 => [150, 186, 236],
        81 => [80, 130, 40],
        82 => [160, 166, 178],
        87 => [110, 48, 48],
        110 => [112, 96, 112],
        121 => [220, 222, 160],
        159 | 172 => [160, 92, 68],
        _ => [110, 110, 110],
    }
}

struct Surface {
    colors: [[u8; 3]; 256],
    heights: [i32; 256],
}

fn surface_modern(chunk: &Tag, dv: i64) -> Option<Surface> {
    let flat = dv >= DV_FLAT_LAYOUT;
    let level = if flat { chunk } else { chunk.get("Level")? };
    let spanning = dv < DV_NON_SPANNING;
    let min_y: i32 = if flat {
        level.get("yPos").and_then(Tag::as_i64).map(|v| v as i32 * 16).unwrap_or(-64)
    } else {
        0
    };
    let heightmap = level.path(&["Heightmaps", "WORLD_SURFACE"])?.as_long_array()?;
    let sections = level.get(if flat { "sections" } else { "Sections" })?.as_list()?;

    let mut by_y: HashMap<i32, (&[Tag], Option<&[i64]>)> = HashMap::new();
    for s in sections {
        let y = s.get("Y").and_then(Tag::as_i64)? as i32;
        let (palette, data) = if flat {
            let bs = match s.get("block_states") {
                Some(b) => b,
                None => continue,
            };
            (bs.get("palette").and_then(Tag::as_list), bs.get("data").and_then(Tag::as_long_array))
        } else {
            (s.get("Palette").and_then(Tag::as_list), s.get("BlockStates").and_then(Tag::as_long_array))
        };
        if let Some(p) = palette {
            by_y.insert(y, (p, data));
        }
    }

    let hm_bits = heightmap_bits(heightmap, spanning)?;
    let mut out = Surface { colors: [[0; 3]; 256], heights: [i32::MIN; 256] };
    for i in 0..256usize {
        let raw = packed_get(heightmap, hm_bits, i, spanning)? as i32;
        let top = min_y + raw - 1;
        out.heights[i] = top;
        if raw == 0 {
            out.colors[i] = [16, 16, 20];
            continue;
        }
        let (sy, ly) = (top.div_euclid(16), top.rem_euclid(16) as usize);
        let color = by_y.get(&sy).and_then(|(palette, data)| {
            let idx = match data {
                None => 0,
                Some(d) => {
                    let bits = bits_for(palette.len(), 4);
                    packed_get(d, bits, ly * 256 + i, spanning)? as usize
                }
            };
            let name = palette.get(idx)?.get("Name")?.as_str()?;
            Some(block_color(name))
        });
        out.colors[i] = color.unwrap_or([110, 110, 110]);
    }
    Some(out)
}

fn surface_legacy(chunk: &Tag) -> Option<Surface> {
    let level = chunk.get("Level")?;
    let heightmap = level.get("HeightMap")?.as_int_array()?;
    let sections = level.get("Sections")?.as_list()?;
    let mut by_y: HashMap<i32, &[i8]> = HashMap::new();
    for s in sections {
        if let (Some(y), Some(blocks)) = (s.get("Y").and_then(Tag::as_i64), s.get("Blocks").and_then(Tag::as_byte_array)) {
            by_y.insert(y as i32, blocks);
        }
    }
    let mut out = Surface { colors: [[0; 3]; 256], heights: [i32::MIN; 256] };
    for i in 0..256usize {
        let top = *heightmap.get(i)? - 1;
        out.heights[i] = top;
        let block = by_y
            .get(&top.div_euclid(16))
            .and_then(|b| b.get(top.rem_euclid(16) as usize * 256 + i))
            .copied()
            .unwrap_or(0) as u8;
        out.colors[i] = legacy_color(block);
    }
    Some(out)
}

fn shade(color: [u8; 3], factor: f32) -> [u8; 3] {
    color.map(|c| (c as f32 * factor).clamp(0.0, 255.0) as u8)
}

fn render_region(path: &Path, rx: i32, rz: i32) -> Result<WorldRegionDetail, String> {
    let region_dir = path.parent().ok_or("Некорректный путь региона")?;
    let mut file = fs::File::open(path).map_err(|e| format!("Регион недоступен: {e}"))?;
    let file_len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut img = image::RgbaImage::new(REGION_PX, REGION_PX);
    let mut status = vec![ST_ABSENT; 1024];
    let mut inhabited = vec![0u32; 1024];
    let mut dvs = vec![0u32; 1024];
    let mut saved = vec![0u32; 1024];

    let Some((locations, stamps)) = read_header(&mut file) else {
        return Ok(WorldRegionDetail {
            rx,
            rz,
            image: encode_png(&img)?,
            status: vec![ST_DAMAGED; 1024],
            inhabited_ticks: inhabited,
            data_version: dvs,
            saved_at: saved,
        });
    };

    for idx in 0..1024usize {
        let loc = locations[idx];
        if loc == 0 {
            continue;
        }
        let (lx, lz) = ((idx % 32) as u32, (idx / 32) as u32);
        saved[idx] = stamps[idx];
        let (cx, cz) = (rx * 32 + lx as i32, rz * 32 + lz as i32);
        let chunk = match read_chunk(&mut file, file_len, loc, region_dir, cx, cz) {
            ChunkRead::Ok(t) => t,
            ChunkRead::Damaged => {
                status[idx] = ST_DAMAGED;
                fill(&mut img, lx, lz, [170, 40, 40]);
                continue;
            }
            ChunkRead::Unreadable => {
                status[idx] = ST_UNREADABLE;
                fill(&mut img, lx, lz, [70, 70, 90]);
                continue;
            }
        };
        let dv = chunk.get("DataVersion").and_then(Tag::as_i64).unwrap_or(0);
        dvs[idx] = dv.clamp(0, u32::MAX as i64) as u32;
        let flat = dv >= DV_FLAT_LAYOUT;
        let level = if flat { Some(&chunk) } else { chunk.get("Level") };
        inhabited[idx] = level
            .and_then(|l| l.get("InhabitedTime"))
            .and_then(Tag::as_i64)
            .unwrap_or(0)
            .clamp(0, u32::MAX as i64) as u32;
        let chunk_status = level.and_then(|l| l.get("Status")).and_then(Tag::as_str).unwrap_or("full");
        let full = chunk_status.ends_with("full") || chunk_status.ends_with("postprocessed") || dv < DV_PALETTE;
        status[idx] = if full { ST_OK } else { ST_PROTO };

        let surface = if dv >= DV_PALETTE { surface_modern(&chunk, dv) } else { surface_legacy(&chunk) };
        match surface {
            Some(s) => {
                for z in 0..16u32 {
                    for x in 0..16u32 {
                        let i = (x + z * 16) as usize;
                        let north = if z > 0 { s.heights[i - 16] } else { s.heights[i] };
                        let diff = (s.heights[i] - north).clamp(-4, 4) as f32;
                        let mut c = shade(s.colors[i], 1.0 + diff * 0.06);
                        if !full {
                            c = shade(c, 0.55);
                        }
                        img.put_pixel(lx * 16 + x, lz * 16 + z, image::Rgba([c[0], c[1], c[2], 255]));
                    }
                }
            }
            None => fill(&mut img, lx, lz, if full { [96, 96, 96] } else { [50, 50, 56] }),
        }
    }

    Ok(WorldRegionDetail {
        rx,
        rz,
        image: encode_png(&img)?,
        status,
        inhabited_ticks: inhabited,
        data_version: dvs,
        saved_at: saved,
    })
}

fn fill(img: &mut image::RgbaImage, lx: u32, lz: u32, c: [u8; 3]) {
    for z in 0..16 {
        for x in 0..16 {
            img.put_pixel(lx * 16 + x, lz * 16 + z, image::Rgba([c[0], c[1], c[2], 255]));
        }
    }
}

fn encode_png(img: &image::RgbaImage) -> Result<String, String> {
    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| format!("Не удалось отрисовать регион: {e}"))?;
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(buf.into_inner())
    ))
}

fn mtime_ms(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn count_chunks(path: &Path) -> u32 {
    let Ok(mut f) = fs::File::open(path) else { return 0 };
    read_header(&mut f)
        .map(|(loc, _)| loc.iter().filter(|l| **l != 0).count() as u32)
        .unwrap_or(0)
}

#[command]
pub async fn list_world_dimensions(profile_id: String, world: String) -> Result<Vec<WorldDimension>, String> {
    let dir = world_dir(&profile_id, &world)?;
    tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        for id in ["minecraft:overworld", "minecraft:the_nether", "minecraft:the_end"] {
            if let Ok(root) = dimension_root(&dir, id) {
                let n = region_files(&root.join("region")).len() as u32;
                if n > 0 || id == "minecraft:overworld" {
                    out.push(WorldDimension { id: id.to_string(), region_count: n });
                }
            }
        }
        if let Ok(namespaces) = fs::read_dir(dir.join("dimensions")) {
            for ns in namespaces.flatten().filter(|e| e.path().is_dir()) {
                let ns_name = ns.file_name().to_string_lossy().to_string();
                let mut stack = vec![(ns.path(), String::new())];
                while let Some((path, rel)) = stack.pop() {
                    if rel.matches('/').count() > 3 {
                        continue;
                    }
                    let n = region_files(&path.join("region")).len() as u32;
                    if n > 0 && !rel.is_empty() {
                        let id = format!("{ns_name}:{rel}");
                        if !out.iter().any(|d: &WorldDimension| d.id == id) {
                            out.push(WorldDimension { id, region_count: n });
                        }
                    }
                    if let Ok(children) = fs::read_dir(&path) {
                        for c in children.flatten().filter(|e| e.path().is_dir()) {
                            let name = c.file_name().to_string_lossy().to_string();
                            if name == "region" || name == "entities" || name == "poi" || name == "data" {
                                continue;
                            }
                            let next = if rel.is_empty() { name } else { format!("{rel}/{name}") };
                            stack.push((c.path(), next));
                        }
                    }
                }
            }
        }
        out
    })
    .await
    .map_err(|e| format!("Ошибка чтения мира: {e}"))
}

#[command]
pub async fn get_world_overview(profile_id: String, world: String, dimension: String) -> Result<WorldOverview, String> {
    let dir = world_dir(&profile_id, &world)?;
    tokio::task::spawn_blocking(move || {
        let level = nbt::read_gzip_file(&dir.join("level.dat")).ok();
        let data = level.as_ref().and_then(|l| l.get("Data"));
        let data_version = data.and_then(|d| d.get("DataVersion")).and_then(Tag::as_i64);
        let version_name = data
            .and_then(|d| d.path(&["Version", "Name"]))
            .and_then(Tag::as_str)
            .map(str::to_string);
        let root = dimension_root(&dir, &dimension)?;
        let mut regions: Vec<WorldRegionRef> = region_files(&root.join("region"))
            .into_iter()
            .map(|(rx, rz, p)| WorldRegionRef {
                rx,
                rz,
                chunk_count: count_chunks(&p),
                size: fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
            })
            .filter(|r| r.chunk_count > 0)
            .collect();
        regions.sort_by_key(|r| (r.rz, r.rx));
        Ok(WorldOverview { data_version, version_name, regions })
    })
    .await
    .map_err(|e| format!("Ошибка чтения мира: {e}"))?
}

#[command]
pub async fn get_world_region(
    profile_id: String,
    world: String,
    dimension: String,
    rx: i32,
    rz: i32,
) -> Result<WorldRegionDetail, String> {
    let dir = world_dir(&profile_id, &world)?;
    let path = dimension_root(&dir, &dimension)?.join("region").join(format!("r.{rx}.{rz}.mca"));
    if !path.is_file() {
        return Err("Регион не найден".to_string());
    }
    let key = (path.clone(), mtime_ms(&path));
    if let Some(hit) = RENDER_CACHE.lock().ok().and_then(|c| c.get(&key).cloned()) {
        return Ok(hit);
    }
    let detail = tokio::task::spawn_blocking(move || render_region(&path, rx, rz))
        .await
        .map_err(|e| format!("Ошибка чтения региона: {e}"))??;
    if let Ok(mut cache) = RENDER_CACHE.lock() {
        if cache.len() >= RENDER_CACHE_LIMIT {
            cache.clear();
        }
        cache.insert(key, detail.clone());
    }
    Ok(detail)
}

#[command]
pub async fn delete_world_chunks(
    profile_id: String,
    world: String,
    dimension: String,
    chunks: Vec<ChunkPos>,
) -> Result<u32, String> {
    if game_is_running() {
        return Err("Закройте игру перед удалением чанков".to_string());
    }
    if chunks.is_empty() {
        return Ok(0);
    }
    let dir = world_dir(&profile_id, &world)?;
    let root = dimension_root(&dir, &dimension)?;
    tokio::task::spawn_blocking(move || {
        create_backup_blocking(&profile_id, &world, BackupKind::Safety)?;
        let mut by_region: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
        for c in &chunks {
            let idx = (c.x.rem_euclid(32) + c.z.rem_euclid(32) * 32) as usize;
            by_region.entry((c.x.div_euclid(32), c.z.div_euclid(32))).or_default().push(idx);
        }
        let mut removed = 0u32;
        for ((rx, rz), indices) in by_region {
            for (sub, counts) in [("region", true), ("entities", false), ("poi", false)] {
                let path = root.join(sub).join(format!("r.{rx}.{rz}.mca"));
                if !path.is_file() {
                    continue;
                }
                let n = clear_header_entries(&path, &indices)?;
                if counts {
                    removed += n;
                }
                if let Ok(mut cache) = RENDER_CACHE.lock() {
                    cache.retain(|(p, _), _| p != &path);
                }
            }
        }
        Ok(removed)
    })
    .await
    .map_err(|e| format!("Ошибка удаления чанков: {e}"))?
}

fn clear_header_entries(path: &Path, indices: &[usize]) -> Result<u32, String> {
    let mut file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| format!("Регион занят или недоступен: {e}"))?;
    let (locations, _) = read_header(&mut file).ok_or("Заголовок региона повреждён")?;
    let mut removed = 0;
    for &idx in indices {
        if idx >= 1024 || locations[idx] == 0 {
            continue;
        }
        for table in [0u64, 4096] {
            file.seek(SeekFrom::Start(table + idx as u64 * 4))
                .and_then(|_| file.write_all(&[0u8; 4]))
                .map_err(|e| format!("Не удалось изменить регион: {e}"))?;
        }
        removed += 1;
    }
    file.sync_all().map_err(|e| format!("Не удалось сохранить регион: {e}"))?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::game::worlds::nbt::tests::root;

    #[test]
    fn packed_non_spanning_and_spanning() {
        let mut word: u64 = 0;
        for i in 0..16u64 {
            word |= i << (i * 4);
        }
        assert_eq!(packed_get(&[word as i64], 4, 5, false), Some(5));
        let mut data = [0u64; 2];
        let value: u64 = 0b10111;
        data[0] |= value << 60;
        data[1] |= value >> 4;
        let longs = [data[0] as i64, data[1] as i64];
        assert_eq!(packed_get(&longs, 5, 12, true), Some(0b10111));
        let nonspan = [(0b10111u64 << 5) as i64];
        assert_eq!(packed_get(&nonspan, 5, 1, false), Some(0b10111));
    }

    #[test]
    fn bits_for_palette() {
        assert_eq!(bits_for(1, 4), 4);
        assert_eq!(bits_for(16, 4), 4);
        assert_eq!(bits_for(17, 4), 5);
        assert_eq!(bits_for(300, 1), 9);
    }

    #[test]
    fn heightmap_widths() {
        assert_eq!(heightmap_bits(&[0; 37], false), Some(9));
        assert_eq!(heightmap_bits(&[0; 36], true), Some(9));
        let twelve = vec![(2000i64 << 48) | 2000; 52];
        assert_eq!(heightmap_bits(&twelve, false), Some(12));
        let eleven = vec![(1000i64 << 44) | 1000; 52];
        assert_eq!(heightmap_bits(&eleven, false), Some(11));
        assert_eq!(heightmap_bits(&[], false), None);
    }

    fn write_region(path: &Path, chunks: &[(usize, Vec<u8>)]) {
        let mut header = vec![0u8; 8192];
        let mut body = Vec::new();
        let mut sector = 2u32;
        for (idx, nbt_bytes) in chunks {
            let mut compressed = Vec::new();
            {
                let mut enc = flate2::write::ZlibEncoder::new(&mut compressed, flate2::Compression::fast());
                enc.write_all(nbt_bytes).unwrap();
                enc.finish().unwrap();
            }
            let mut payload = ((compressed.len() + 1) as u32).to_be_bytes().to_vec();
            payload.push(2);
            payload.extend_from_slice(&compressed);
            let sectors = payload.len().div_ceil(4096) as u32;
            payload.resize(sectors as usize * 4096, 0);
            header[idx * 4..idx * 4 + 4].copy_from_slice(&((sector << 8) | sectors).to_be_bytes());
            header[4096 + idx * 4..4096 + idx * 4 + 4].copy_from_slice(&1_700_000_000u32.to_be_bytes());
            body.extend_from_slice(&payload);
            sector += sectors;
        }
        let mut all = header;
        all.extend_from_slice(&body);
        fs::write(path, all).unwrap();
    }

    #[test]
    fn renders_modern_chunk_and_clears_it() {
        let dir = std::env::temp_dir().join(format!("mc16-region-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let mut hm = vec![0i64; 37];
        for i in 0..256usize {
            let per = 7;
            hm[i / per] |= 65i64 << ((i % per) * 9);
        }
        let palette = Tag::List(vec![Tag::Compound(HashMap::from([(
            "Name".to_string(),
            Tag::String("minecraft:grass_block".into()),
        )]))]);
        let section = Tag::Compound(HashMap::from([
            ("Y".to_string(), Tag::Byte(0)),
            ("block_states".to_string(), Tag::Compound(HashMap::from([("palette".to_string(), palette)]))),
        ]));
        let chunk = root(&[
            ("DataVersion", Tag::Int(3465)),
            ("yPos", Tag::Int(-4)),
            ("Status", Tag::String("minecraft:full".into())),
            ("InhabitedTime", Tag::Long(1200)),
            ("Heightmaps", Tag::Compound(HashMap::from([("WORLD_SURFACE".to_string(), Tag::LongArray(hm))]))),
            ("sections", Tag::List(vec![section])),
        ]);
        let region = dir.join("r.0.0.mca");
        write_region(&region, &[(0, chunk), (33, b"garbage".to_vec())]);

        let detail = render_region(&region, 0, 0).unwrap();
        assert_eq!(detail.status[0], ST_OK);
        assert_eq!(detail.inhabited_ticks[0], 1200);
        assert_eq!(detail.data_version[0], 3465);
        assert_eq!(detail.status[33], ST_DAMAGED);
        assert_eq!(detail.status[1], ST_ABSENT);
        assert!(detail.image.starts_with("data:image/png;base64,"));
        let surf = surface_modern(&nbt::parse(&root(&[])).unwrap(), 3465);
        assert!(surf.is_none());

        assert_eq!(clear_header_entries(&region, &[0, 1]).unwrap(), 1);
        assert_eq!(render_region(&region, 0, 0).unwrap().status[0], ST_ABSENT);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dimension_ids_are_validated() {
        let w = Path::new("w");
        assert_eq!(dimension_root(w, "minecraft:the_nether").unwrap(), w.join("DIM-1"));
        assert!(dimension_root(w, "mod:../x").is_err());
        assert!(dimension_root(w, "noseparator").is_err());
        assert_eq!(
            dimension_root(w, "twilightforest:twilight_forest").unwrap(),
            w.join("dimensions").join("twilightforest").join("twilight_forest")
        );
    }
}
