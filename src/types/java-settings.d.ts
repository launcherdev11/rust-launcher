export interface JavaSettings {
  use_custom_jvm_args: boolean;
  java_path: string | null;
  xms: string | null;
  xmx: string | null;
  jvm_args: string | null;
  preset: "balanced" | "performance" | "low_memory" | null;
}

