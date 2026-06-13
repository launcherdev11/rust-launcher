mod downloads;
mod env;
mod jvm;
mod launch_prep;
mod proxy;
mod session;

pub use env::load_project_env_for_runtime;

#[cfg(target_os = "linux")]
pub(crate) use env::apply_linux_display_env;

pub(crate) use downloads::*;
pub(crate) use jvm::*;
pub(crate) use launch_prep::*;
pub(crate) use proxy::*;
pub(crate) use session::*;

pub(crate) use crate::services::game::version_types::{parse_forge_id, parse_neoforge_id};