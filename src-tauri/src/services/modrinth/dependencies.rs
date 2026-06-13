use std::collections::{HashMap, HashSet};

use super::client::{
    modrinth_get_json, project_versions_url, should_filter_by_loader, MODRINTH_API_BASE,
};
use super::types::{ModrinthDependency, ModrinthDownloadTarget, ModrinthVersion};

struct DependencyResolver<'a> {
    client: &'a reqwest::Client,
    game_version: &'a str,
    loader: &'a str,
    visited_versions: HashSet<String>,
    version_cache: HashMap<String, ModrinthVersion>,
    collected_urls: HashSet<String>,
    targets: Vec<ModrinthDownloadTarget>,
}

impl<'a> DependencyResolver<'a> {
    fn new(client: &'a reqwest::Client, game_version: &'a str, loader: &'a str) -> Self {
        Self {
            client,
            game_version,
            loader,
            visited_versions: HashSet::new(),
            version_cache: HashMap::new(),
            collected_urls: HashSet::new(),
            targets: Vec::new(),
        }
    }

    async fn fetch_version_cached(&mut self, version_id: &str) -> Result<&ModrinthVersion, String> {
        if !self.version_cache.contains_key(version_id) {
            let url = format!("{MODRINTH_API_BASE}/version/{version_id}");
            let version: ModrinthVersion = modrinth_get_json(
                self.client,
                &url,
                &format!("получение версии Modrinth {version_id}"),
            )
            .await?;
            self.version_cache.insert(version_id.to_string(), version);
        }
        match self.version_cache.get(version_id) {
            Some(version) => Ok(version),
            None => Err(format!(
                "внутренняя ошибка кэша версий Modrinth ({version_id})"
            )),
        }
    }

    async fn resolve_project_version_id(&self, project_id: &str) -> Result<String, String> {
        let url = project_versions_url(project_id, self.game_version, self.loader);
        let versions: Vec<ModrinthVersion> = modrinth_get_json(
            self.client,
            &url,
            &format!(
                "поиск версии проекта {project_id} для MC {} {}",
                self.game_version,
                if should_filter_by_loader(self.loader) {
                    format!("({})", self.loader)
                } else {
                    String::new()
                }
            ),
        )
        .await?;

        let chosen = versions.into_iter().next().ok_or_else(|| {
            format!(
                "Не найдена версия проекта {project_id} для Minecraft {} {}",
                self.game_version,
                if should_filter_by_loader(self.loader) {
                    format!("и загрузчика {}", self.loader)
                } else {
                    String::new()
                }
            )
        })?;

        Ok(chosen.id)
    }

    async fn resolve_dependency_version_id(
        &self,
        dep: &ModrinthDependency,
    ) -> Result<String, String> {
        if let Some(ref version_id) = dep.version_id {
            return Ok(version_id.clone());
        }
        if let Some(ref project_id) = dep.project_id {
            return self.resolve_project_version_id(project_id).await;
        }
        Err("Зависимость Modrinth без version_id и project_id".to_string())
    }

    fn push_download_target(&mut self, version: &ModrinthVersion) -> Result<(), String> {
        let file = version.primary_file().ok_or_else(|| {
            format!(
                "У версии Modrinth {} нет прикреплённых файлов",
                version.id
            )
        })?;
        if file.url.is_empty() {
            return Err(format!(
                "У версии Modrinth {} нет URL файла для скачивания",
                version.id
            ));
        }
        if self.collected_urls.insert(file.url.clone()) {
            self.targets.push(ModrinthDownloadTarget {
                version_id: version.id.clone(),
                project_id: version.project_id.clone(),
                file_id: file.id.clone(),
                url: file.url.clone(),
                filename: file.filename.clone(),
                sha1: file.sha1_hex(),
                skipped: false,
            });
        }
        Ok(())
    }

    async fn collect(&mut self, initial_version_id: &str) -> Result<(), String> {
        let mut stack: Vec<(String, u8)> = vec![(initial_version_id.to_string(), 0)];

        while let Some((version_id, phase)) = stack.pop() {
            if phase == 1 {
                let version = self.fetch_version_cached(&version_id).await?.clone();
                self.push_download_target(&version)?;
                continue;
            }

            if !self.visited_versions.insert(version_id.clone()) {
                continue;
            }

            stack.push((version_id.clone(), 1));

            let version = self.fetch_version_cached(&version_id).await?.clone();
            let mut dep_version_ids = Vec::new();
            for dep in &version.dependencies {
                if dep.dependency_type != "required" {
                    continue;
                }
                dep_version_ids.push(self.resolve_dependency_version_id(dep).await?);
            }
            for dep_vid in dep_version_ids.into_iter().rev() {
                stack.push((dep_vid, 0));
            }
        }

        Ok(())
    }

    async fn finish(mut self, initial_version_id: &str) -> Result<Vec<ModrinthDownloadTarget>, String> {
        self.collect(initial_version_id).await?;
        Ok(self.targets)
    }
}


pub async fn collect_modrinth_required_downloads(
    client: &reqwest::Client,
    initial_version_id: &str,
    game_version: &str,
    loader: &str,
) -> Result<Vec<ModrinthDownloadTarget>, String> {
    if initial_version_id.trim().is_empty() {
        return Err("version_id не может быть пустым".to_string());
    }
    if game_version.trim().is_empty() {
        return Err("game_version не может быть пустым".to_string());
    }

    DependencyResolver::new(client, game_version.trim(), loader.trim())
        .finish(initial_version_id.trim())
        .await
}
