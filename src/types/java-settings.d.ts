export interface JavaSettings {
  /** Включить использование пользовательских JVM-аргументов из лаунчера. */
  use_custom_jvm_args: boolean;
  /** Полный путь к java/javaw. Если null, используется встроенный runtime Mojang. */
  java_path: string | null;
  /** Минимальный объём памяти Xms. Формат: число + суффикс M или G (например, "1024M", "2G"). */
  xms: string | null;
  /** Максимальный объём памяти Xmx. Формат: число + суффикс M или G (например, "4096M", "4G"). */
  xmx: string | null;
  /** Дополнительные JVM-аргументы (одна строка или многострочно). */
  jvm_args: string | null;
  /** Имя пресета настроек памяти и JVM-флагов. */
  preset: "balanced" | "performance" | "low_memory" | null;
}

