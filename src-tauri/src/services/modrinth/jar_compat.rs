
use std::io::{Cursor, Read};
use std::path::Path;

use serde_json::Value;
use zip::read::ZipArchive;

/// Fabric API → its modules is one level; modules rarely nest further.
const MAX_NESTED_DEPTH: u8 = 2;
const MAX_NESTED_JARS: usize = 128;
const MAX_NESTED_JAR_BYTES: u64 = 48 * 1024 * 1024;
const MAX_METADATA_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct McVersion {
    major: u32,
    minor: u32,
    patch: u32,
}

fn leading_number(s: &str) -> Option<u32> {
    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// `1.20.1`, `1.21`, `1.21-pre1`, `1.20.5-rc.1` → numeric core. Snapshots (`24w14a`) → None.
fn parse_mc_version(raw: &str) -> Option<McVersion> {
    let s = raw.trim().trim_start_matches('v');
    let core = s.split(['-', '+']).next()?;
    let mut parts = core.split('.');
    let major: u32 = parts.next()?.parse().ok()?;
    let minor = leading_number(parts.next()?)?;
    let patch = parts.next().and_then(leading_number).unwrap_or(0);
    Some(McVersion {
        major,
        minor,
        patch,
    })
}

fn split_operator(token: &str) -> (&str, &str) {
    for op in [">=", "<=", ">", "<", "=", "~", "^"] {
        if let Some(rest) = token.strip_prefix(op) {
            return (op, rest.trim());
        }
    }
    ("", token)
}

fn fabric_predicate_matches(token: &str, game: McVersion) -> Option<bool> {
    let (op, ver) = split_operator(token.trim());
    if ver.is_empty() {
        return None;
    }
    if ver == "*" || ver.eq_ignore_ascii_case("x") {
        return Some(true);
    }

    let wildcard = ver
        .strip_suffix(".x")
        .or_else(|| ver.strip_suffix(".X"))
        .or_else(|| ver.strip_suffix(".*"));
    if let Some(base) = wildcard {
        if !matches!(op, "" | "=" | "~" | "^") {
            return None;
        }
        let nums: Vec<u32> = base
            .split('.')
            .map(|p| p.parse().ok())
            .collect::<Option<Vec<u32>>>()?;
        return match nums.as_slice() {
            [major] => Some(game.major == *major),
            [major, minor] => Some(game.major == *major && game.minor == *minor),
            _ => None,
        };
    }

    let v = parse_mc_version(ver)?;
    let next_minor = McVersion {
        major: v.major,
        minor: v.minor + 1,
        patch: 0,
    };
    let explicit_parts = ver.split(['-', '+']).next().unwrap_or("").split('.').count();
    Some(match op {
        // A bare `1.20` is read leniently as "any 1.20.x": strict loaders reject it,
        // but flagging it here produced more noise than real hits.
        "" | "=" if explicit_parts <= 2 => game.major == v.major && game.minor == v.minor,
        "" | "=" => game == v,
        ">=" => game >= v,
        ">" => game > v,
        "<=" => game <= v,
        "<" => game < v,
        "~" => game >= v && game < next_minor,
        "^" => game >= v && game.major == v.major,
        _ => return None,
    })
}

/// Fabric/Quilt version predicate (`>=1.20.1 <1.21`, `~1.20`, `1.20.x`, `a || b`).
pub fn fabric_minecraft_range_matches(range: &str, game_version: &str) -> Option<bool> {
    let game = parse_mc_version(game_version)?;
    let range = range.trim();
    if range.is_empty() || range == "*" {
        return Some(true);
    }

    if range.contains("||") {
        let mut unknown = false;
        for alt in range.split("||") {
            match fabric_minecraft_range_matches(alt, game_version) {
                Some(true) => return Some(true),
                Some(false) => {}
                None => unknown = true,
            }
        }
        return if unknown { None } else { Some(false) };
    }

    let mut saw_predicate = false;
    for token in range.split_whitespace() {
        let ok = fabric_predicate_matches(token, game)?;
        saw_predicate = true;
        if !ok {
            return Some(false);
        }
    }
    saw_predicate.then_some(true)
}

fn maven_single_range(inner: &str, start_incl: bool, end_incl: bool, game: McVersion) -> Option<bool> {
    let Some((left_raw, right_raw)) = inner.split_once(',') else {
        return Some(game == parse_mc_version(inner)?);
    };
    if !left_raw.trim().is_empty() {
        let left = parse_mc_version(left_raw)?;
        let ok = if start_incl { game >= left } else { game > left };
        if !ok {
            return Some(false);
        }
    }
    if !right_raw.trim().is_empty() {
        let right = parse_mc_version(right_raw)?;
        let ok = if end_incl { game <= right } else { game < right };
        if !ok {
            return Some(false);
        }
    }
    Some(true)
}

/// Maven range as used by Forge/NeoForge, including unions: `[1.20,1.20.1],[1.20.4,)`.
pub fn maven_minecraft_range_matches(range: &str, game_version: &str) -> Option<bool> {
    let game = parse_mc_version(game_version)?;
    let range = range.trim();
    if range.is_empty() || range == "*" {
        return Some(true);
    }
    if !range.starts_with(['[', '(']) {
        // A bare Maven version is only a recommendation: Forge accepts any version.
        return parse_mc_version(range).map(|_| true);
    }

    let mut unknown = false;
    let mut rest = range;
    while !rest.is_empty() {
        let start_incl = match rest.chars().next()? {
            '[' => true,
            '(' => false,
            _ => return None,
        };
        let end = rest.find([']', ')'])?;
        let end_incl = rest[end..].starts_with(']');
        match maven_single_range(&rest[1..end], start_incl, end_incl, game) {
            Some(true) => return Some(true),
            Some(false) => {}
            None => unknown = true,
        }
        rest = rest[end + 1..].trim_start();
        rest = rest.strip_prefix(',').unwrap_or(rest).trim_start();
    }
    if unknown {
        None
    } else {
        Some(false)
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JarModRelation {
    pub mod_id: String,
    pub optional: bool,
    /// Version predicates as written in the metadata (any of them may match).
    /// Empty means "any version".
    pub versions: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JarNestedMod {
    pub mod_id: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JarModInfo {
    pub filename: String,
    pub enabled: bool,
    pub mod_id: Option<String>,
    pub title: Option<String>,
    pub version: Option<String>,
    /// Metadata picked for the profile's loader.
    pub loader: Option<String>,
    /// Every loader this jar ships metadata for (multi-loader jars have several).
    pub loaders: Vec<String>,
    /// `client` / `server` / `*` from fabric.mod.json; None when not declared.
    pub environment: Option<String>,
    pub provides: Vec<String>,
    /// Mods bundled inside the jar (Fabric `jars`, Forge Jar-in-Jar).
    pub nested: Vec<JarNestedMod>,
    pub depends: Vec<JarModRelation>,
    pub breaks: Vec<JarModRelation>,
}

#[derive(Debug, Default)]
struct ParsedMetadata {
    loader: &'static str,
    mod_id: Option<String>,
    title: Option<String>,
    version: Option<String>,
    environment: Option<String>,
    provides: Vec<String>,
    depends: Vec<JarModRelation>,
    breaks: Vec<JarModRelation>,
    /// Minecraft version predicates, any of them may match.
    minecraft: Vec<String>,
    nested_paths: Vec<String>,
}

impl ParsedMetadata {
    fn uses_maven_ranges(&self) -> bool {
        matches!(self.loader, "forge" | "neoforge")
    }

    fn supports_game_version(&self, game_version: &str) -> Option<bool> {
        if self.minecraft.is_empty() {
            return None;
        }
        let mut unknown = false;
        for range in &self.minecraft {
            let res = if self.uses_maven_ranges() {
                maven_minecraft_range_matches(range, game_version)
            } else {
                fabric_minecraft_range_matches(range, game_version)
            };
            match res {
                Some(true) => return Some(true),
                Some(false) => {}
                None => unknown = true,
            }
        }
        if unknown {
            None
        } else {
            Some(false)
        }
    }
}

fn is_platform_mod_id(id: &str) -> bool {
    matches!(
        id.to_ascii_lowercase().as_str(),
        "minecraft"
            | "java"
            | "fabricloader"
            | "fabric-loader"
            | "quilt_loader"
            | "quilt-loader"
            | "forge"
            | "neoforge"
            | "mcp"
            | "fabric"
            | "quilt"
    )
}

fn push_unique(out: &mut Vec<String>, value: String) {
    if value.is_empty() {
        return;
    }
    if !out.iter().any(|x| x.eq_ignore_ascii_case(&value)) {
        out.push(value);
    }
}

fn json_str(value: Option<&Value>) -> Option<String> {
    value
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Placeholders like `${version}` mean the build did not expand them.
fn real_version(raw: Option<String>) -> Option<String> {
    raw.filter(|v| !v.contains("${"))
}

/// String → one predicate, array → alternatives, anything else is kept verbatim so
/// the frontend treats it as "unknown" instead of "any version".
fn version_predicates(value: &Value) -> Vec<String> {
    match value {
        Value::String(s) => {
            let s = s.trim();
            if s.is_empty() || s == "*" {
                Vec::new()
            } else {
                vec![s.to_string()]
            }
        }
        Value::Array(items) => {
            let preds: Vec<String> = items
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if preds.iter().any(|p| p == "*") {
                Vec::new()
            } else {
                preds
            }
        }
        Value::Object(obj) => match obj.get("any") {
            Some(any @ Value::Array(_)) => version_predicates(any),
            _ => vec![value.to_string()],
        },
        _ => Vec::new(),
    }
}

fn fabric_relations(obj: Option<&Value>, optional: bool) -> Vec<JarModRelation> {
    let Some(obj) = obj.and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    obj.iter()
        .filter_map(|(key, val)| {
            let id = key.trim();
            if id.is_empty() || is_platform_mod_id(id) {
                return None;
            }
            Some(JarModRelation {
                mod_id: id.to_string(),
                optional,
                versions: version_predicates(val),
            })
        })
        .collect()
}

fn fabric_minecraft_predicates(depends: Option<&Value>) -> Vec<String> {
    let Some(obj) = depends.and_then(|v| v.as_object()) else {
        return Vec::new();
    };
    obj.iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("minecraft"))
        .map(|(_, v)| match version_predicates(v) {
            preds if preds.is_empty() => vec!["*".to_string()],
            preds => preds,
        })
        .unwrap_or_default()
}

fn parse_fabric_mod_json(bytes: &[u8]) -> Option<ParsedMetadata> {
    let json: Value = serde_json::from_slice(strip_bom(bytes)).ok()?;
    let mut provides = Vec::new();
    for item in json.get("provides").and_then(|v| v.as_array()).into_iter().flatten() {
        if let Some(s) = item.as_str() {
            push_unique(&mut provides, s.trim().to_string());
        }
    }

    let depends_val = json.get("depends");
    let mut depends = fabric_relations(depends_val, false);
    depends.extend(fabric_relations(json.get("recommends"), true));
    depends.extend(fabric_relations(json.get("suggests"), true));

    let mut breaks = fabric_relations(json.get("breaks"), false);
    breaks.extend(fabric_relations(json.get("conflicts"), true));

    let nested_paths = json
        .get("jars")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|j| json_str(j.get("file")))
        .collect();

    Some(ParsedMetadata {
        loader: "fabric",
        mod_id: json_str(json.get("id")),
        title: json_str(json.get("name")),
        version: real_version(json_str(json.get("version"))),
        environment: json_str(json.get("environment")).map(|e| e.to_ascii_lowercase()),
        provides,
        depends,
        breaks,
        minecraft: fabric_minecraft_predicates(depends_val),
        nested_paths,
    })
}

fn quilt_relations(arr: Option<&Value>, breaks: bool) -> (Vec<JarModRelation>, Vec<String>) {
    let mut out = Vec::new();
    let mut minecraft = Vec::new();
    for item in arr.and_then(|v| v.as_array()).into_iter().flatten() {
        let (id, versions, optional) = match item {
            Value::String(s) => (s.trim().to_string(), Vec::new(), false),
            Value::Object(obj) => {
                let Some(id) = json_str(obj.get("id")) else { continue };
                let versions = obj.get("versions").map(version_predicates).unwrap_or_default();
                let optional = obj.get("optional").and_then(|v| v.as_bool()).unwrap_or(false)
                    || obj.contains_key("unless");
                (id, versions, optional)
            }
            _ => continue,
        };
        // Quilt ids may carry a maven group: `org.quiltmc:quilt_loader`.
        let id = id.rsplit(':').next().unwrap_or(&id).to_string();
        if id.is_empty() {
            continue;
        }
        if id.eq_ignore_ascii_case("minecraft") {
            if !breaks && !optional {
                if versions.is_empty() {
                    minecraft.push("*".to_string());
                } else {
                    minecraft.extend(versions);
                }
            }
            continue;
        }
        if is_platform_mod_id(&id) {
            continue;
        }
        out.push(JarModRelation {
            mod_id: id,
            optional,
            versions,
        });
    }
    (out, minecraft)
}

fn parse_quilt_mod_json(bytes: &[u8]) -> Option<ParsedMetadata> {
    let json: Value = serde_json::from_slice(strip_bom(bytes)).ok()?;
    let Some(loader) = json.get("quilt_loader") else {
        // Some jars ship a fabric-style schema under the quilt name.
        return parse_fabric_mod_json(bytes).map(|mut m| {
            m.loader = "quilt";
            m
        });
    };

    let mut provides = Vec::new();
    for item in loader.get("provides").and_then(|v| v.as_array()).into_iter().flatten() {
        let id = item.as_str().map(str::to_string).or_else(|| json_str(item.get("id")));
        if let Some(id) = id {
            push_unique(&mut provides, id.trim().to_string());
        }
    }

    let (depends, minecraft) = quilt_relations(loader.get("depends"), false);
    let (breaks, _) = quilt_relations(loader.get("breaks"), true);

    let nested_paths = loader
        .get("jars")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .filter_map(|j| j.as_str().map(str::to_string))
        .collect();

    Some(ParsedMetadata {
        loader: "quilt",
        mod_id: json_str(loader.get("id")),
        title: json_str(loader.pointer("/metadata/name")).or_else(|| json_str(json.get("name"))),
        version: real_version(json_str(loader.get("version"))),
        environment: json_str(json.pointer("/minecraft/environment")).map(|e| e.to_ascii_lowercase()),
        provides,
        depends,
        breaks,
        minecraft,
        nested_paths,
    })
}

fn toml_str(table: &toml::Table, key: &str) -> Option<String> {
    table
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn parse_mods_toml(text: &str, neoforge_file: bool, jar_version: Option<&str>) -> Option<ParsedMetadata> {
    let doc: toml::Table = toml::from_str(text).ok()?;
    let mods = doc.get("mods")?.as_array()?;

    let resolve_version = |raw: Option<String>| -> Option<String> {
        let raw = raw?;
        if raw.contains("${file.jarVersion}") {
            return jar_version.map(|v| raw.replace("${file.jarVersion}", v));
        }
        real_version(Some(raw))
    };

    let mut meta = ParsedMetadata::default();
    for m in mods.iter().filter_map(|m| m.as_table()) {
        let Some(id) = toml_str(m, "modId") else { continue };
        if meta.mod_id.is_none() {
            meta.mod_id = Some(id);
            meta.title = toml_str(m, "displayName");
            meta.version = resolve_version(toml_str(m, "version"));
        } else {
            // Extra [[mods]] in the same jar are loaded alongside the first one.
            push_unique(&mut meta.provides, id);
        }
    }
    meta.mod_id.as_ref()?;

    let mut mentions_neoforge = false;
    let deps = doc.get("dependencies").and_then(|v| v.as_table());
    for list in deps.into_iter().flat_map(|t| t.values()) {
        for dep in list.as_array().into_iter().flatten().filter_map(|d| d.as_table()) {
            let Some(id) = toml_str(dep, "modId") else { continue };
            let kind = toml_str(dep, "type").map(|t| t.to_ascii_lowercase());
            let mandatory = dep.get("mandatory").and_then(|v| v.as_bool()).unwrap_or(true);
            let server_only = toml_str(dep, "side").is_some_and(|s| s.eq_ignore_ascii_case("server"));
            let range = toml_str(dep, "versionRange");

            if id.eq_ignore_ascii_case("neoforge") {
                mentions_neoforge = true;
            }

            let (is_break, optional) = match kind.as_deref() {
                Some("incompatible") => (true, false),
                Some("discouraged") => (true, true),
                Some("optional") => (false, true),
                Some("required") => (false, false),
                _ => (false, !mandatory),
            };
            // Dependencies declared for the dedicated server are not checked on the client.
            let optional = optional || server_only;

            if id.eq_ignore_ascii_case("minecraft") {
                if !is_break && !optional {
                    meta.minecraft.push(range.unwrap_or_else(|| "*".to_string()));
                }
                continue;
            }
            if is_platform_mod_id(&id) {
                continue;
            }
            let relation = JarModRelation {
                mod_id: id,
                optional,
                versions: range.into_iter().filter(|r| r != "*").collect(),
            };
            if is_break {
                meta.breaks.push(relation);
            } else {
                meta.depends.push(relation);
            }
        }
    }

    // NeoForge 1.20.2–1.20.4 still used META-INF/mods.toml.
    meta.loader = if neoforge_file || mentions_neoforge {
        "neoforge"
    } else {
        "forge"
    };
    Some(meta)
}

/// Last-resort reader for mods.toml files the TOML parser rejects.
fn parse_mods_toml_lenient(text: &str, neoforge_file: bool) -> Option<ParsedMetadata> {
    let mut meta = ParsedMetadata::default();
    let mut in_mods = false;
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            in_mods = t == "[[mods]]";
            continue;
        }
        if !in_mods {
            continue;
        }
        let Some((key, val)) = t.split_once('=') else { continue };
        let val = val.trim().trim_matches('"').trim_matches('\'').trim().to_string();
        if val.is_empty() {
            continue;
        }
        match key.trim() {
            "modId" if meta.mod_id.is_none() => meta.mod_id = Some(val),
            "modId" => push_unique(&mut meta.provides, val),
            "displayName" if meta.title.is_none() => meta.title = Some(val),
            _ => {}
        }
    }
    meta.mod_id.as_ref()?;
    let lower = text.to_ascii_lowercase();
    meta.loader = if neoforge_file || lower.contains("modid=\"neoforge\"") || lower.contains("modid = \"neoforge\"") {
        "neoforge"
    } else {
        "forge"
    };
    Some(meta)
}

/// Legacy Forge (≤1.12) `mcmod.info`.
fn parse_mcmod_info(bytes: &[u8]) -> Option<ParsedMetadata> {
    let json: Value = serde_json::from_slice(strip_bom(bytes)).ok()?;
    let list = json
        .as_array()
        .or_else(|| json.get("modList").and_then(|v| v.as_array()))?;
    let mut meta = ParsedMetadata {
        loader: "forge",
        ..Default::default()
    };
    for m in list {
        let Some(id) = json_str(m.get("modid")) else { continue };
        if meta.mod_id.is_none() {
            meta.mod_id = Some(id);
            meta.title = json_str(m.get("name"));
            meta.version = real_version(json_str(m.get("version")));
            if let Some(mc) = real_version(json_str(m.get("mcversion"))) {
                meta.minecraft.push(format!("[{mc}]"));
            }
        } else {
            push_unique(&mut meta.provides, id);
        }
    }
    meta.mod_id.as_ref()?;
    Some(meta)
}

fn strip_bom(bytes: &[u8]) -> &[u8] {
    bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes)
}

struct Jar {
    archive: ZipArchive<Cursor<Vec<u8>>>,
}

impl Jar {
    fn open(bytes: Vec<u8>) -> Option<Self> {
        ZipArchive::new(Cursor::new(bytes)).ok().map(|archive| Self { archive })
    }

    fn read(&mut self, name: &str, max_bytes: u64) -> Option<Vec<u8>> {
        let file = self.archive.by_name(name).ok()?;
        if file.size() > max_bytes {
            return None;
        }
        let mut buf = Vec::with_capacity(file.size() as usize);
        file.take(max_bytes).read_to_end(&mut buf).ok()?;
        (!buf.is_empty()).then_some(buf)
    }

    fn read_text(&mut self, name: &str) -> Option<String> {
        let bytes = self.read(name, MAX_METADATA_BYTES)?;
        Some(String::from_utf8_lossy(strip_bom(&bytes)).into_owned())
    }

    fn manifest_version(&mut self) -> Option<String> {
        let text = self.read_text("META-INF/MANIFEST.MF")?;
        text.lines().find_map(|line| {
            let (key, val) = line.split_once(':')?;
            (key.trim() == "Implementation-Version")
                .then(|| val.trim().to_string())
                .filter(|v| !v.is_empty())
        })
    }

    fn bundled_jar_paths(&self, declared: &[String]) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for path in declared {
            push_unique(&mut out, path.trim_start_matches('/').to_string());
        }
        for name in self.archive.file_names() {
            let lower = name.to_ascii_lowercase();
            if lower.ends_with(".jar")
                && (lower.starts_with("meta-inf/jars/") || lower.starts_with("meta-inf/jarjar/"))
            {
                push_unique(&mut out, name.to_string());
            }
        }
        out
    }

    /// Every loader's metadata found in this jar, Fabric first.
    fn metadata(&mut self) -> Vec<ParsedMetadata> {
        let mut out = Vec::new();
        if let Some(bytes) = self.read("fabric.mod.json", MAX_METADATA_BYTES) {
            out.extend(parse_fabric_mod_json(&bytes));
        }
        if let Some(bytes) = self.read("quilt.mod.json", MAX_METADATA_BYTES) {
            out.extend(parse_quilt_mod_json(&bytes));
        }
        let mut jar_version: Option<Option<String>> = None;
        for (name, neoforge_file) in [
            ("META-INF/neoforge.mods.toml", true),
            ("META-INF/mods.toml", false),
        ] {
            let Some(text) = self.read_text(name) else { continue };
            let version = if text.contains("${file.jarVersion}") {
                jar_version.get_or_insert_with(|| self.manifest_version()).clone()
            } else {
                None
            };
            let parsed = parse_mods_toml(&text, neoforge_file, version.as_deref())
                .or_else(|| parse_mods_toml_lenient(&text, neoforge_file));
            if let Some(meta) = parsed {
                // neoforge.mods.toml and mods.toml in one jar describe the same mod.
                if !out.iter().any(|m: &ParsedMetadata| m.loader == meta.loader) {
                    out.push(meta);
                }
            }
        }
        if out.is_empty() {
            if let Some(bytes) = self.read("mcmod.info", MAX_METADATA_BYTES) {
                out.extend(parse_mcmod_info(&bytes));
            }
        }
        out
    }

    fn collect_nested(&mut self, declared: &[String], depth: u8, out: &mut Vec<JarNestedMod>) {
        if depth > MAX_NESTED_DEPTH {
            return;
        }
        for path in self.bundled_jar_paths(declared).into_iter().take(MAX_NESTED_JARS) {
            if out.len() >= MAX_NESTED_JARS * 4 {
                return;
            }
            let Some(bytes) = self.read(&path, MAX_NESTED_JAR_BYTES) else { continue };
            let Some(mut inner) = Jar::open(bytes) else { continue };
            let metas = inner.metadata();
            let mut inner_declared = Vec::new();
            for meta in &metas {
                let ids = meta.mod_id.iter().chain(meta.provides.iter());
                for id in ids {
                    if !out.iter().any(|n| n.mod_id.eq_ignore_ascii_case(id)) {
                        out.push(JarNestedMod {
                            mod_id: id.clone(),
                            version: meta.version.clone(),
                        });
                    }
                }
                inner_declared.extend(meta.nested_paths.iter().cloned());
            }
            inner.collect_nested(&inner_declared, depth + 1, out);
        }
    }
}

fn normalize_loader(loader: &str) -> String {
    loader.trim().to_ascii_lowercase()
}

/// Loaders whose mods run on `loader`: Quilt loads Fabric mods, and NeoForge for
/// 1.20.1 is still binary-compatible with Forge. Empty for vanilla/unknown loaders.
pub fn compatible_loaders(loader: &str, game_version: &str) -> Vec<&'static str> {
    match normalize_loader(loader).as_str() {
        "forge" => vec!["forge"],
        "neoforge" if game_version.trim() == "1.20.1" => vec!["neoforge", "forge"],
        "neoforge" => vec!["neoforge"],
        "fabric" => vec!["fabric"],
        "quilt" => vec!["quilt", "fabric"],
        _ => Vec::new(),
    }
}

/// Picks the metadata the given loader would actually read.
fn pick_metadata(metas: &[ParsedMetadata], preferred_loader: Option<&str>) -> Option<usize> {
    if metas.is_empty() {
        return None;
    }
    let preferred = preferred_loader.map(normalize_loader).unwrap_or_default();
    let order: &[&str] = match preferred.as_str() {
        "fabric" => &["fabric", "quilt"],
        "quilt" => &["quilt", "fabric"],
        "neoforge" => &["neoforge", "forge"],
        "forge" => &["forge"],
        _ => &[],
    };
    order
        .iter()
        .find_map(|l| metas.iter().position(|m| m.loader == *l))
        .or(Some(0))
}

fn open_jar(path: &Path) -> Option<Jar> {
    Jar::open(std::fs::read(path).ok()?)
}

pub fn jar_supports_game_version(
    jar_path: &Path,
    game_version: &str,
    loader: &str,
) -> (Option<bool>, Option<String>) {
    let Some(mut jar) = open_jar(jar_path) else {
        return (None, None);
    };
    let metas = jar.metadata();
    let Some(idx) = pick_metadata(&metas, Some(loader)) else {
        return (None, None);
    };
    let meta = &metas[idx];
    let wanted = compatible_loaders(loader, game_version);
    if !wanted.is_empty() && !wanted.contains(&meta.loader) {
        // Wrong-loader jars are reported separately; their Minecraft range says nothing here.
        return (None, meta.title.clone());
    }
    (meta.supports_game_version(game_version), meta.title.clone())
}

pub fn read_jar_mod_info(
    jar_path: &Path,
    filename: &str,
    enabled: bool,
    preferred_loader: Option<&str>,
) -> JarModInfo {
    let mut info = JarModInfo {
        filename: filename.to_string(),
        enabled,
        mod_id: None,
        title: None,
        version: None,
        loader: None,
        loaders: Vec::new(),
        environment: None,
        provides: Vec::new(),
        nested: Vec::new(),
        depends: Vec::new(),
        breaks: Vec::new(),
    };

    let Some(mut jar) = open_jar(jar_path) else {
        return info;
    };
    let mut metas = jar.metadata();
    let Some(idx) = pick_metadata(&metas, preferred_loader) else {
        return info;
    };

    for meta in &metas {
        push_unique(&mut info.loaders, meta.loader.to_string());
    }
    let meta = metas.swap_remove(idx);
    jar.collect_nested(&meta.nested_paths, 1, &mut info.nested);

    info.mod_id = meta.mod_id;
    info.title = meta.title;
    info.version = meta.version;
    info.loader = Some(meta.loader.to_string());
    info.environment = meta.environment;
    info.provides = meta.provides;
    info.depends = meta.depends;
    info.breaks = meta.breaks;
    info
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
    fn fabric_caret_and_tilde() {
        assert_eq!(fabric_minecraft_range_matches("^1.20.1", "1.21.4"), Some(true));
        assert_eq!(fabric_minecraft_range_matches("~1.20.1", "1.20.4"), Some(true));
        assert_eq!(fabric_minecraft_range_matches("~1.20.1", "1.21"), Some(false));
        assert_eq!(fabric_minecraft_range_matches("1.20.x", "1.20.6"), Some(true));
        assert_eq!(fabric_minecraft_range_matches(">=1.21-alpha.24.10.a", "1.21"), Some(true));
        assert_eq!(fabric_minecraft_range_matches("1.19.2 || 1.20.1", "1.20.1"), Some(true));
        assert_eq!(fabric_minecraft_range_matches(">=1.20 <1.21", "24w14a"), None);
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

    #[test]
    fn maven_range_union_and_bare() {
        assert_eq!(
            maven_minecraft_range_matches("[1.20,1.20.1],[1.20.4,)", "1.20.4"),
            Some(true)
        );
        assert_eq!(
            maven_minecraft_range_matches("[1.20,1.20.1],[1.20.4,)", "1.20.2"),
            Some(false)
        );
        assert_eq!(maven_minecraft_range_matches("1.20.1", "1.21"), Some(true));
        assert_eq!(maven_minecraft_range_matches("${mc_range}", "1.21"), None);
    }

    #[test]
    fn mods_toml_detects_neoforge_and_relations() {
        let text = r#"
modLoader="javafml"
loaderVersion="[2,)"
[[mods]]
modId="examplemod"
version="${file.jarVersion}"
displayName="Example"
[[mods]]
modId="examplecompat"
[[dependencies.examplemod]]
modId="neoforge"
type="required"
versionRange="[20.4,)"
[[dependencies.examplemod]]
modId="minecraftcapes"
type="optional"
versionRange="[1.0,)"
[[dependencies.examplemod]]
modId="minecraft"
type="required"
versionRange="[1.20.4,1.20.5)"
[[dependencies.examplemod]]
modId="optifine"
type="incompatible"
"#;
        let meta = parse_mods_toml(text, false, Some("1.2.3")).unwrap();
        assert_eq!(meta.loader, "neoforge");
        assert_eq!(meta.version.as_deref(), Some("1.2.3"));
        assert_eq!(meta.provides, vec!["examplecompat".to_string()]);
        assert_eq!(meta.minecraft, vec!["[1.20.4,1.20.5)".to_string()]);
        assert_eq!(meta.supports_game_version("1.20.4"), Some(true));
        assert_eq!(meta.depends.len(), 1);
        assert!(meta.depends[0].optional);
        assert_eq!(meta.breaks.len(), 1);
        assert_eq!(meta.breaks[0].mod_id, "optifine");
    }

    #[test]
    fn mods_toml_server_side_dependency_is_optional() {
        let text = r#"
[[mods]]
modId="a"
[[dependencies.a]]
modId="serverlib"
mandatory=true
side="SERVER"
"#;
        let meta = parse_mods_toml(text, false, None).unwrap();
        assert_eq!(meta.loader, "forge");
        assert!(meta.depends[0].optional);
    }

    #[test]
    fn fabric_json_relations_keep_versions() {
        let json = br#"{
            "schemaVersion": 1,
            "id": "iris",
            "version": "1.7.0",
            "environment": "client",
            "depends": { "minecraft": ["1.20.1", "1.20.2"], "fabric-api": ">=0.90.0" },
            "breaks": { "sodium": "<0.5.0", "optifabric": "*" }
        }"#;
        let meta = parse_fabric_mod_json(json).unwrap();
        assert_eq!(meta.minecraft.len(), 2);
        assert_eq!(meta.supports_game_version("1.20.2"), Some(true));
        assert_eq!(meta.supports_game_version("1.20.4"), Some(false));
        assert_eq!(meta.depends[0].versions, vec![">=0.90.0".to_string()]);
        let sodium = meta.breaks.iter().find(|b| b.mod_id == "sodium").unwrap();
        assert_eq!(sodium.versions, vec!["<0.5.0".to_string()]);
        let optifabric = meta.breaks.iter().find(|b| b.mod_id == "optifabric").unwrap();
        assert!(optifabric.versions.is_empty());
        assert_eq!(meta.environment.as_deref(), Some("client"));
    }

    #[test]
    fn pick_metadata_prefers_profile_loader() {
        let metas = vec![
            ParsedMetadata {
                loader: "fabric",
                ..Default::default()
            },
            ParsedMetadata {
                loader: "forge",
                ..Default::default()
            },
        ];
        assert_eq!(pick_metadata(&metas, Some("neoforge")), Some(1));
        assert_eq!(pick_metadata(&metas, Some("quilt")), Some(0));
        assert_eq!(pick_metadata(&metas, None), Some(0));
    }
}
