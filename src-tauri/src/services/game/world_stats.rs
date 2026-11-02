use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::app::paths::launcher_data_dir;
use crate::infra::fs_atomic::write_atomic;
use crate::models::events::{GameStatsDeltaPayload, EVENT_GAME_STATS_DELTA};
use crate::services::game::worlds::nbt;

const BASELINE_FILE: &str = "world_stats_baseline.json";

const MINED_ALL: &str = "mined:_all";
const DRAGON_KILLS: &str = "killed:ender_dragon";
const HARDCORE_DRAGON_KILLS: &str = "hardcore:killed:ender_dragon";
const TIME_SINCE_DEATH: &str = "max:custom:time_since_death";
const ADVENTURING_TIME: &str = "max:adv:adventure/adventuring_time";

/// Counters read from `stats/<uuid>.json` (1.13+ layout, without the `minecraft:` namespace).
/// Must stay in sync with the backend whitelist.
const TRACKED: &[&str] = &[
    "killed:ender_dragon",
    "killed:wither",
    "killed:warden",
    "killed:elder_guardian",
    "killed:ravager",
    "killed:breeze",
    "killed:creeper",
    "killed:enderman",
    "killed:phantom",
    "picked_up:dragon_egg",
    "used:totem_of_undying",
    "custom:damage_blocked_by_shield",
    "custom:damage_dealt",
    "killed_by:creeper",
    "killed_by:ender_dragon",
    "killed_by:warden",
    "custom:deaths",
    "custom:fall_one_cm",
    "custom:eat_cake_slice",
    "mined:diamond_ore",
    "mined:deepslate_diamond_ore",
    "mined:emerald_ore",
    "mined:deepslate_emerald_ore",
    "mined:ancient_debris",
    "mined:amethyst_cluster",
    "broken:wooden_pickaxe",
    "broken:stone_pickaxe",
    "broken:iron_pickaxe",
    "broken:golden_pickaxe",
    "broken:diamond_pickaxe",
    "broken:netherite_pickaxe",
    "custom:walk_one_cm",
    "custom:sprint_one_cm",
    "custom:aviate_one_cm",
    "custom:boat_one_cm",
    "custom:minecart_one_cm",
    "custom:swim_one_cm",
    "custom:strider_one_cm",
    "custom:pig_one_cm",
    "custom:traded_with_villager",
    "custom:raid_win",
    "custom:animals_bred",
    "custom:fish_caught",
    "custom:enchant_item",
    "crafted:beacon",
    "custom:play_noteblock",
    "custom:play_record",
    "custom:bell_ring",
    "custom:open_chest",
    "custom:pot_flower",
];

/// Pre-1.13 flat stat names mapped onto the modern keys.
const LEGACY: &[(&str, &str)] = &[
    ("stat.killEntity.EnderDragon", "killed:ender_dragon"),
    ("stat.killEntity.WitherBoss", "killed:wither"),
    ("stat.killEntity.ElderGuardian", "killed:elder_guardian"),
    ("stat.killEntity.Creeper", "killed:creeper"),
    ("stat.killEntity.Enderman", "killed:enderman"),
    ("stat.entityKilledBy.Creeper", "killed_by:creeper"),
    ("stat.entityKilledBy.EnderDragon", "killed_by:ender_dragon"),
    ("stat.pickup.minecraft.dragon_egg", "picked_up:dragon_egg"),
    ("stat.useItem.minecraft.totem_of_undying", "used:totem_of_undying"),
    ("stat.damageDealt", "custom:damage_dealt"),
    ("stat.deaths", "custom:deaths"),
    ("stat.timeSinceDeath", TIME_SINCE_DEATH),
    ("stat.fallOneCm", "custom:fall_one_cm"),
    ("stat.cakeSlicesEaten", "custom:eat_cake_slice"),
    ("stat.mineBlock.minecraft.diamond_ore", "mined:diamond_ore"),
    ("stat.mineBlock.minecraft.emerald_ore", "mined:emerald_ore"),
    ("stat.breakItem.minecraft.wooden_pickaxe", "broken:wooden_pickaxe"),
    ("stat.breakItem.minecraft.stone_pickaxe", "broken:stone_pickaxe"),
    ("stat.breakItem.minecraft.iron_pickaxe", "broken:iron_pickaxe"),
    ("stat.breakItem.minecraft.golden_pickaxe", "broken:golden_pickaxe"),
    ("stat.breakItem.minecraft.diamond_pickaxe", "broken:diamond_pickaxe"),
    ("stat.walkOneCm", "custom:walk_one_cm"),
    ("stat.sprintOneCm", "custom:sprint_one_cm"),
    ("stat.aviateOneCm", "custom:aviate_one_cm"),
    ("stat.boatOneCm", "custom:boat_one_cm"),
    ("stat.minecartOneCm", "custom:minecart_one_cm"),
    ("stat.swimOneCm", "custom:swim_one_cm"),
    ("stat.pigOneCm", "custom:pig_one_cm"),
    ("stat.tradedWithVillager", "custom:traded_with_villager"),
    ("stat.animalsBred", "custom:animals_bred"),
    ("stat.fishCaught", "custom:fish_caught"),
    ("stat.itemEnchanted", "custom:enchant_item"),
    ("stat.craftItem.minecraft.beacon", "crafted:beacon"),
    ("stat.noteblockPlayed", "custom:play_noteblock"),
    ("stat.recordPlayed", "custom:play_record"),
    ("stat.chestOpened", "custom:open_chest"),
    ("stat.flowerPotted", "custom:pot_flower"),
    ("achievement.exploreAllBiomes", ADVENTURING_TIME),
];

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
struct WorldSnapshot {
    #[serde(default)]
    excluded: bool,
    #[serde(default)]
    hardcore: bool,
    #[serde(default)]
    values: BTreeMap<String, i64>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Baseline {
    saves_dir: PathBuf,
    uuid: String,
    worlds: BTreeMap<String, WorldSnapshot>,
}

fn baseline_path() -> Option<PathBuf> {
    launcher_data_dir().ok().map(|dir| dir.join(BASELINE_FILE))
}

fn add(values: &mut BTreeMap<String, i64>, key: &str, value: i64) {
    if value > 0 {
        *values.entry(key.to_string()).or_insert(0) += value;
    }
}

fn strip_ns(id: &str) -> Option<&str> {
    match id.split_once(':') {
        Some(("minecraft", rest)) => Some(rest),
        Some(_) => None,
        None => Some(id),
    }
}

fn read_modern_stats(stats: &serde_json::Map<String, Value>, out: &mut BTreeMap<String, i64>) {
    for (category, entries) in stats {
        let Some(category) = strip_ns(category) else { continue };
        let Some(entries) = entries.as_object() else { continue };
        for (id, value) in entries {
            let Some(value) = value.as_i64() else { continue };
            if category == "mined" {
                add(out, MINED_ALL, value);
            }
            let Some(id) = strip_ns(id) else { continue };
            if category == "custom" && id == "time_since_death" {
                add(out, TIME_SINCE_DEATH, value);
                continue;
            }
            let key = format!("{category}:{id}");
            if TRACKED.contains(&key.as_str()) {
                add(out, &key, value);
            }
        }
    }
}

fn read_legacy_stats(root: &serde_json::Map<String, Value>, out: &mut BTreeMap<String, i64>) {
    for (name, value) in root {
        let value = value
            .as_i64()
            .or_else(|| value.get("value").and_then(Value::as_i64));
        let Some(value) = value else { continue };
        if name.starts_with("stat.mineBlock.") {
            add(out, MINED_ALL, value);
        }
        if let Some((_, key)) = LEGACY.iter().find(|(legacy, _)| *legacy == name) {
            if *key == ADVENTURING_TIME {
                if value > 0 {
                    out.insert(ADVENTURING_TIME.to_string(), 1);
                }
            } else {
                add(out, key, value);
            }
        }
    }
}

fn parse_stats(raw: &str) -> BTreeMap<String, i64> {
    let mut out = BTreeMap::new();
    let Ok(Value::Object(root)) = serde_json::from_str::<Value>(raw) else {
        return out;
    };
    match root.get("stats").and_then(Value::as_object) {
        Some(stats) => read_modern_stats(stats, &mut out),
        None => read_legacy_stats(&root, &mut out),
    }
    out
}

fn adventuring_time_done(raw: &str) -> bool {
    serde_json::from_str::<Value>(raw)
        .ok()
        .and_then(|v| {
            v.get("minecraft:adventure/adventuring_time")
                .and_then(|a| a.get("done"))
                .and_then(Value::as_bool)
        })
        .unwrap_or(false)
}

/// `(excluded, hardcore)`: worlds with cheats or a creative/spectator default mode do not count.
fn read_level_flags(world: &Path) -> (bool, bool) {
    let Ok(level) = nbt::read_gzip_file(&world.join("level.dat")) else {
        return (true, false);
    };
    let flag = |key: &str| level.path(&["Data", key]).and_then(|t| t.as_i64());
    let cheats = flag("allowCommands") == Some(1);
    let creative_or_spectator = matches!(flag("GameType"), Some(1) | Some(3));
    (cheats || creative_or_spectator, flag("hardcore") == Some(1))
}

fn snapshot_world(world: &Path, uuid: &str) -> Option<WorldSnapshot> {
    let raw = fs::read_to_string(world.join("stats").join(format!("{uuid}.json"))).ok()?;
    let mut values = parse_stats(&raw);
    if let Ok(adv) = fs::read_to_string(world.join("advancements").join(format!("{uuid}.json"))) {
        if adventuring_time_done(&adv) {
            values.insert(ADVENTURING_TIME.to_string(), 1);
        }
    }
    let (excluded, hardcore) = read_level_flags(world);
    Some(WorldSnapshot { excluded, hardcore, values })
}

fn snapshot_saves(saves_dir: &Path, uuid: &str) -> BTreeMap<String, WorldSnapshot> {
    let mut worlds = BTreeMap::new();
    let Ok(entries) = fs::read_dir(saves_dir) else {
        return worlds;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || !path.is_dir() {
            continue;
        }
        if let Some(snapshot) = snapshot_world(&path, uuid) {
            worlds.insert(name, snapshot);
        }
    }
    worlds
}

/// Session delta between two snapshots. Sum counters are differences, `max:` keys are taken
/// as-is but only from worlds whose stats changed during the session.
fn diff(
    before: &BTreeMap<String, WorldSnapshot>,
    after: &BTreeMap<String, WorldSnapshot>,
) -> BTreeMap<String, i64> {
    let empty = WorldSnapshot::default();
    let mut out = BTreeMap::new();
    for (name, now) in after {
        let prev = before.get(name).unwrap_or(&empty);
        if now.excluded || prev.excluded || prev == now {
            continue;
        }
        for (key, value) in &now.values {
            if key.starts_with("max:") {
                continue;
            }
            let delta = value - prev.values.get(key).copied().unwrap_or(0);
            if delta <= 0 {
                continue;
            }
            add(&mut out, key, delta);
            if now.hardcore && key == DRAGON_KILLS {
                add(&mut out, HARDCORE_DRAGON_KILLS, delta);
            }
        }
        for (key, value) in now.values.iter().filter(|(k, _)| k.starts_with("max:")) {
            let slot = out.entry(key.clone()).or_insert(0);
            *slot = (*slot).max(*value);
        }
    }
    out
}

/// Remembers the current world stats right before the game starts. A snapshot left over from a
/// session that ended while the launcher was closed is settled first.
pub(crate) fn begin_session(app: &AppHandle, game_dir: &Path, uuid: &str) {
    finish_session(app);
    let Some(path) = baseline_path() else { return };
    let uuid = uuid.trim();
    if uuid.is_empty() {
        let _ = fs::remove_file(&path);
        return;
    }
    let saves_dir = game_dir.join("saves");
    let baseline = Baseline {
        worlds: snapshot_saves(&saves_dir, uuid),
        saves_dir,
        uuid: uuid.to_string(),
    };
    match serde_json::to_vec(&baseline) {
        Ok(bytes) => {
            if let Err(e) = write_atomic(&path, bytes) {
                eprintln!("[WorldStats] Не удалось сохранить снимок статистики: {e}");
            }
        }
        Err(e) => eprintln!("[WorldStats] Не удалось сериализовать снимок статистики: {e}"),
    }
}

/// Compares world stats with the snapshot taken at launch and emits the session delta.
pub(crate) fn finish_session(app: &AppHandle) {
    let Some(path) = baseline_path() else { return };
    let Ok(raw) = fs::read(&path) else { return };
    let _ = fs::remove_file(&path);
    let Ok(baseline) = serde_json::from_slice::<Baseline>(&raw) else {
        return;
    };
    let after = snapshot_saves(&baseline.saves_dir, &baseline.uuid);
    let stats = diff(&baseline.worlds, &after);
    if !stats.is_empty() {
        let _ = app.emit(EVENT_GAME_STATS_DELTA, GameStatsDeltaPayload { stats });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn world(values: &[(&str, i64)]) -> WorldSnapshot {
        WorldSnapshot {
            excluded: false,
            hardcore: false,
            values: values.iter().map(|(k, v)| (k.to_string(), *v)).collect(),
        }
    }

    #[test]
    fn parses_modern_stats() {
        let raw = r#"{
            "stats": {
                "minecraft:killed": { "minecraft:ender_dragon": 2, "minecraft:zombie": 40, "othermod:boss": 1 },
                "minecraft:mined": { "minecraft:diamond_ore": 5, "minecraft:stone": 95 },
                "minecraft:custom": { "minecraft:walk_one_cm": 1000, "minecraft:time_since_death": 777 }
            },
            "DataVersion": 3953
        }"#;
        let stats = parse_stats(raw);
        assert_eq!(stats.get("killed:ender_dragon"), Some(&2));
        assert_eq!(stats.get("killed:zombie"), None);
        assert_eq!(stats.get("mined:diamond_ore"), Some(&5));
        assert_eq!(stats.get(MINED_ALL), Some(&100));
        assert_eq!(stats.get("custom:walk_one_cm"), Some(&1000));
        assert_eq!(stats.get(TIME_SINCE_DEATH), Some(&777));
    }

    #[test]
    fn parses_legacy_stats() {
        let raw = r#"{
            "stat.killEntity.EnderDragon": 1,
            "stat.mineBlock.minecraft.diamond_ore": 3,
            "stat.mineBlock.minecraft.stone": 7,
            "stat.walkOneCm": 500,
            "achievement.exploreAllBiomes": { "value": 1, "progress": [] }
        }"#;
        let stats = parse_stats(raw);
        assert_eq!(stats.get("killed:ender_dragon"), Some(&1));
        assert_eq!(stats.get("mined:diamond_ore"), Some(&3));
        assert_eq!(stats.get(MINED_ALL), Some(&10));
        assert_eq!(stats.get("custom:walk_one_cm"), Some(&500));
        assert_eq!(stats.get(ADVENTURING_TIME), Some(&1));
    }

    #[test]
    fn detects_adventuring_time() {
        assert!(adventuring_time_done(
            r#"{"minecraft:adventure/adventuring_time": {"criteria": {}, "done": true}}"#
        ));
        assert!(!adventuring_time_done(
            r#"{"minecraft:adventure/adventuring_time": {"criteria": {}, "done": false}}"#
        ));
    }

    #[test]
    fn diff_counts_only_session_progress() {
        let before = BTreeMap::from([
            ("old".to_string(), world(&[("killed:ender_dragon", 4), (TIME_SINCE_DEATH, 9_000)])),
            ("idle".to_string(), world(&[("custom:deaths", 10), (TIME_SINCE_DEATH, 5_000_000)])),
        ]);
        let mut hardcore = world(&[("killed:ender_dragon", 1), (TIME_SINCE_DEATH, 100)]);
        hardcore.hardcore = true;
        let mut cheats = world(&[("killed:ender_dragon", 9)]);
        cheats.excluded = true;
        let after = BTreeMap::from([
            ("old".to_string(), world(&[("killed:ender_dragon", 5), (TIME_SINCE_DEATH, 12_000)])),
            ("idle".to_string(), world(&[("custom:deaths", 10), (TIME_SINCE_DEATH, 5_000_000)])),
            ("new_hc".to_string(), hardcore),
            ("creative".to_string(), cheats),
        ]);
        let delta = diff(&before, &after);
        assert_eq!(delta.get("killed:ender_dragon"), Some(&2));
        assert_eq!(delta.get(HARDCORE_DRAGON_KILLS), Some(&1));
        assert_eq!(delta.get(TIME_SINCE_DEATH), Some(&12_000));
        assert_eq!(delta.get("custom:deaths"), None);
    }

    #[test]
    fn diff_ignores_counters_that_went_down() {
        let before = BTreeMap::from([("w".to_string(), world(&[("custom:deaths", 10)]))]);
        let after = BTreeMap::from([("w".to_string(), world(&[("custom:deaths", 3)]))]);
        assert!(diff(&before, &after).is_empty());
    }
}
