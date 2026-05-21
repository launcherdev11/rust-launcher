/// Общий state приложения будет вынесен сюда по мере распила монолитов.
/// Сейчас оставляем файл как «якорь» модуля, чтобы постепенно переносить locks/caches/cancellation flags.

#[derive(Default)]
pub struct AppState {}

