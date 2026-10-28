use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use image::{imageops, ImageFormat, Rgba, RgbaImage};
use serde::Serialize;
use tauri::command;

use crate::app::paths::{game_root_dir, instance_config_path, instance_dir, versions_dir};
use crate::services::game::profiles::{read_instance_config, set_profile_icon_path};
use crate::services::game::runtime::resolve_client_jar_path;

const TEXTURES_ROOT: &str = "assets/minecraft/textures/";
const ICON_TARGET_PX: u32 = 256;

const TEXTURE_ICONS: &[(&str, &str, Option<&str>)] = &[
    ("diamond_sword", "item/diamond_sword.png", Some("items/diamond_sword.png")),
    ("iron_pickaxe", "item/iron_pickaxe.png", Some("items/iron_pickaxe.png")),
    ("bow", "item/bow.png", Some("items/bow_standby.png")),
    ("trident", "item/trident.png", None),
    ("diamond_chestplate", "item/diamond_chestplate.png", Some("items/diamond_chestplate.png")),
    ("elytra", "item/elytra.png", Some("items/elytra.png")),
    ("totem_of_undying", "item/totem_of_undying.png", Some("items/totem.png")),
    ("golden_apple", "item/golden_apple.png", Some("items/apple_golden.png")),
    ("apple", "item/apple.png", Some("items/apple.png")),
    ("bread", "item/bread.png", Some("items/bread.png")),
    ("cake", "item/cake.png", Some("items/cake.png")),
    ("cookie", "item/cookie.png", Some("items/cookie.png")),
    ("pumpkin_pie", "item/pumpkin_pie.png", Some("items/pumpkin_pie.png")),
    ("cooked_beef", "item/cooked_beef.png", Some("items/beef_cooked.png")),
    ("tropical_fish", "item/tropical_fish.png", Some("items/fish_clownfish_raw.png")),
    ("sweet_berries", "item/sweet_berries.png", None),
    ("diamond", "item/diamond.png", Some("items/diamond.png")),
    ("emerald", "item/emerald.png", Some("items/emerald.png")),
    ("gold_ingot", "item/gold_ingot.png", Some("items/gold_ingot.png")),
    ("iron_ingot", "item/iron_ingot.png", Some("items/iron_ingot.png")),
    ("netherite_ingot", "item/netherite_ingot.png", None),
    ("amethyst_shard", "item/amethyst_shard.png", None),
    ("redstone", "item/redstone.png", Some("items/redstone_dust.png")),
    ("ender_pearl", "item/ender_pearl.png", Some("items/ender_pearl.png")),
    ("ender_eye", "item/ender_eye.png", Some("items/ender_eye.png")),
    ("blaze_powder", "item/blaze_powder.png", Some("items/blaze_powder.png")),
    ("nether_star", "item/nether_star.png", Some("items/nether_star.png")),
    ("heart_of_the_sea", "item/heart_of_the_sea.png", None),
    ("slime_ball", "item/slime_ball.png", Some("items/slimeball.png")),
    ("book", "item/book.png", Some("items/book_normal.png")),
    ("enchanted_book", "item/enchanted_book.png", Some("items/book_enchanted.png")),
    ("writable_book", "item/writable_book.png", Some("items/book_writable.png")),
    ("experience_bottle", "item/experience_bottle.png", Some("items/experience_bottle.png")),
    ("firework_rocket", "item/firework_rocket.png", Some("items/fireworks.png")),
    ("fishing_rod", "item/fishing_rod.png", Some("items/fishing_rod_uncast.png")),
    ("flint_and_steel", "item/flint_and_steel.png", Some("items/flint_and_steel.png")),
    ("lava_bucket", "item/lava_bucket.png", Some("items/bucket_lava.png")),
    ("water_bucket", "item/water_bucket.png", Some("items/bucket_water.png")),
    ("spyglass", "item/spyglass.png", None),
    ("name_tag", "item/name_tag.png", Some("items/name_tag.png")),
    ("saddle", "item/saddle.png", Some("items/saddle.png")),
    ("music_disc_cat", "item/music_disc_cat.png", Some("items/record_cat.png")),
    ("feather", "item/feather.png", Some("items/feather.png")),
    ("bone", "item/bone.png", Some("items/bone.png")),
    ("tnt", "block/tnt_side.png", Some("blocks/tnt_side.png")),
    ("crafting_table", "block/crafting_table_front.png", Some("blocks/crafting_table_front.png")),
    ("furnace", "block/furnace_front.png", Some("blocks/furnace_front_off.png")),
    ("bookshelf", "block/bookshelf.png", Some("blocks/bookshelf.png")),
    ("jukebox", "block/jukebox_side.png", Some("blocks/jukebox_side.png")),
    ("diamond_ore", "block/diamond_ore.png", Some("blocks/diamond_ore.png")),
    ("emerald_ore", "block/emerald_ore.png", Some("blocks/emerald_ore.png")),
    ("gold_ore", "block/gold_ore.png", Some("blocks/gold_ore.png")),
    ("oak_log", "block/oak_log.png", Some("blocks/log_oak.png")),
    ("oak_planks", "block/oak_planks.png", Some("blocks/planks_oak.png")),
    ("bricks", "block/bricks.png", Some("blocks/brick.png")),
    ("mossy_cobblestone", "block/mossy_cobblestone.png", Some("blocks/cobblestone_mossy.png")),
    ("obsidian", "block/obsidian.png", Some("blocks/obsidian.png")),
    ("glowstone", "block/glowstone.png", Some("blocks/glowstone.png")),
    ("netherrack", "block/netherrack.png", Some("blocks/netherrack.png")),
    ("end_stone", "block/end_stone.png", Some("blocks/end_stone.png")),
    ("jack_o_lantern", "block/jack_o_lantern.png", Some("blocks/pumpkin_face_on.png")),
    ("melon", "block/melon_side.png", Some("blocks/melon_side.png")),
    ("sponge", "block/sponge.png", Some("blocks/sponge.png")),
    ("ice", "block/ice.png", Some("blocks/ice.png")),
    ("sea_lantern", "block/sea_lantern.png", Some("blocks/sea_lantern.png")),
    ("amethyst_block", "block/amethyst_block.png", None),
    ("honey_block", "block/honey_block_side.png", None),
    ("poppy", "block/poppy.png", Some("blocks/flower_rose.png")),
    ("dandelion", "block/dandelion.png", Some("blocks/flower_dandelion.png")),
    ("red_mushroom", "block/red_mushroom.png", Some("blocks/mushroom_red.png")),
];

#[derive(Debug, Clone, Serialize)]
pub struct TextureIcon {
    pub id: String,
    pub data_uri: String,
}

fn jar_has_textures(path: &Path) -> bool {
    std::fs::File::open(path)
        .ok()
        .and_then(|f| zip::ZipArchive::new(f).ok())
        .map(|mut zip| zip.by_name("assets/minecraft/textures/item/apple.png").is_ok()
            || zip.by_name("assets/minecraft/textures/items/apple.png").is_ok())
        .unwrap_or(false)
}

fn find_texture_jar(game_version: &str) -> Option<PathBuf> {
    let root = game_root_dir().ok()?;
    let vers = versions_dir().ok()?;
    let preferred = [
        resolve_client_jar_path(&root, &vers, game_version, None),
        Some(vers.join(game_version).join(format!("{game_version}.jar"))),
    ];
    if let Some(path) = preferred.into_iter().flatten().find(|p| p.is_file() && jar_has_textures(p)) {
        return Some(path);
    }

    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = std::fs::read_dir(&vers)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            let jar = entry.path().join(format!("{name}.jar"));
            let modified = std::fs::metadata(&jar).ok()?.modified().ok()?;
            Some((modified, jar))
        })
        .collect();
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates
        .into_iter()
        .map(|(_, jar)| jar)
        .find(|jar| jar_has_textures(jar))
}

fn read_zip_entry(zip: &mut zip::ZipArchive<std::fs::File>, name: &str) -> Option<Vec<u8>> {
    let mut entry = zip.by_name(name).ok()?;
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut buf).ok()?;
    Some(buf)
}

fn read_texture(zip: &mut zip::ZipArchive<std::fs::File>, modern: &str, legacy: Option<&str>) -> Option<RgbaImage> {
    let bytes = read_zip_entry(zip, &format!("{TEXTURES_ROOT}{modern}"))
        .or_else(|| legacy.and_then(|l| read_zip_entry(zip, &format!("{TEXTURES_ROOT}{l}"))))?;
    let img = image::load_from_memory_with_format(&bytes, ImageFormat::Png).ok()?.to_rgba8();
    let side = img.width().min(img.height());
    if side == 0 {
        return None;
    }
    Some(imageops::crop_imm(&img, 0, 0, side, side).to_image())
}

fn png_bytes(img: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, ImageFormat::Png)
        .map_err(|e| format!("Не удалось закодировать PNG: {e}"))?;
    Ok(out.into_inner())
}

fn parse_hex_color(raw: &str) -> Option<[u8; 3]> {
    let hex = raw.trim().trim_start_matches('#');
    if hex.len() != 6 {
        return None;
    }
    let n = u32::from_str_radix(hex, 16).ok()?;
    Some([(n >> 16) as u8, (n >> 8) as u8, n as u8])
}

fn shade(c: [u8; 3], factor: f32) -> Rgba<u8> {
    let f = |v: u8| -> u8 {
        if factor >= 1.0 {
            (v as f32 + (255.0 - v as f32) * (factor - 1.0)).round() as u8
        } else {
            (v as f32 * factor).round() as u8
        }
    };
    Rgba([f(c[0]), f(c[1]), f(c[2]), 255])
}

fn compose_icon(texture: &RgbaImage, background: Option<[u8; 3]>) -> RgbaImage {
    let side = texture.width();
    let unit = (side / 16).max(1);
    let pad = 2 * unit;
    let canvas_side = side + pad * 2;
    let mut canvas = RgbaImage::new(canvas_side, canvas_side);
    if let Some(bg) = background {
        let fill = Rgba([bg[0], bg[1], bg[2], 255]);
        let light = shade(bg, 1.22);
        let dark = shade(bg, 0.62);
        for (x, y, px) in canvas.enumerate_pixels_mut() {
            *px = if x < unit || y < unit {
                light
            } else if x >= canvas_side - unit || y >= canvas_side - unit {
                dark
            } else {
                fill
            };
        }
    }
    imageops::overlay(&mut canvas, texture, pad as i64, pad as i64);
    let scale = (ICON_TARGET_PX / canvas_side).max(1);
    imageops::resize(
        &canvas,
        canvas_side * scale,
        canvas_side * scale,
        imageops::FilterType::Nearest,
    )
}

fn profile_texture_jar(profile_id: &str) -> Result<zip::ZipArchive<std::fs::File>, String> {
    let cfg = read_instance_config(&instance_config_path(profile_id)?)?;
    let jar = find_texture_jar(&cfg.game_version)
        .ok_or_else(|| "Нет установленной версии Minecraft, из которой можно взять текстуры".to_string())?;
    let file = std::fs::File::open(&jar).map_err(|e| format!("Не удалось открыть {}: {e}", jar.display()))?;
    zip::ZipArchive::new(file).map_err(|e| format!("Не удалось прочитать {}: {e}", jar.display()))
}

#[command]
pub async fn list_profile_texture_icons(profile_id: String) -> Result<Vec<TextureIcon>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut zip = profile_texture_jar(&profile_id)?;
        let mut icons = Vec::with_capacity(TEXTURE_ICONS.len());
        for (id, modern, legacy) in TEXTURE_ICONS {
            let Some(texture) = read_texture(&mut zip, modern, *legacy) else {
                continue;
            };
            let png = png_bytes(&texture)?;
            icons.push(TextureIcon {
                id: (*id).to_string(),
                data_uri: format!("data:image/png;base64,{}", BASE64_STANDARD.encode(png)),
            });
        }
        Ok(icons)
    })
    .await
    .map_err(|e| format!("Не удалось загрузить текстуры: {e}"))?
}

#[command]
pub async fn set_profile_icon_from_texture(
    profile_id: String,
    texture_id: String,
    background: Option<String>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (_, modern, legacy) = TEXTURE_ICONS
            .iter()
            .find(|(id, _, _)| *id == texture_id)
            .ok_or_else(|| "Неизвестная текстура".to_string())?;
        let mut zip = profile_texture_jar(&profile_id)?;
        let texture = read_texture(&mut zip, modern, *legacy)
            .ok_or_else(|| "Текстура не найдена в этой версии игры".to_string())?;
        let icon = compose_icon(&texture, background.as_deref().and_then(parse_hex_color));

        let profile_dir = instance_dir(&profile_id)?;
        let dest = profile_dir.join("icon.png");
        crate::infra::fs_atomic::write_atomic(&dest, &png_bytes(&icon)?)?;
        let icon_path = dest.to_str().map(|s| s.to_string());
        set_profile_icon_path(&profile_id, icon_path.clone())?;
        Ok(icon_path)
    })
    .await
    .map_err(|e| format!("Не удалось сохранить иконку: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn icon_ids_are_unique() {
        let mut ids: Vec<&str> = TEXTURE_ICONS.iter().map(|(id, _, _)| *id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), TEXTURE_ICONS.len());
    }

    #[test]
    fn composed_icon_is_crisp_and_framed() {
        let mut texture = RgbaImage::new(16, 16);
        texture.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
        let icon = compose_icon(&texture, Some([100, 50, 200]));
        assert_eq!(icon.width(), 240);
        assert_eq!(*icon.get_pixel(0, 0), shade([100, 50, 200], 1.22));
        assert_eq!(*icon.get_pixel(239, 239), shade([100, 50, 200], 0.62));
        assert_eq!(*icon.get_pixel(24, 24), Rgba([255, 0, 0, 255]));
        assert_eq!(*icon.get_pixel(35, 35), Rgba([255, 0, 0, 255]));
        assert_eq!(*icon.get_pixel(36, 36), Rgba([100, 50, 200, 255]));
    }

    #[test]
    fn transparent_background_keeps_alpha() {
        let texture = RgbaImage::new(16, 16);
        let icon = compose_icon(&texture, None);
        assert_eq!(icon.get_pixel(0, 0)[3], 0);
    }

    #[test]
    fn hex_parsing() {
        assert_eq!(parse_hex_color("#0a0b0c"), Some([10, 11, 12]));
        assert_eq!(parse_hex_color("zz"), None);
    }
}
