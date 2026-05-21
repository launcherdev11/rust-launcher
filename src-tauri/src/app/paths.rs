use std::path::PathBuf;

/// Пока это минимальная точка расширения для будущих path helper'ов.
/// По мере переноса из `game_provider.rs` сюда переедут все вычисления директорий.
pub fn launcher_data_dir() -> Result<PathBuf, String> {
    dirs::data_dir()
        .ok_or_else(|| "Не удалось получить папку данных".to_string())
        .map(|p| p.join("16Launcher"))
}

