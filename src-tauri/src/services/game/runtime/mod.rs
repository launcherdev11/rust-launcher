mod downloads;
mod env;
mod jvm;
mod launch_prep;
mod lan_bridge;
mod session;

pub use lan_bridge::{
    lan_bridge_attach, lan_bridge_detach, lan_bridge_game_port, lan_bridge_query_world,
    lan_bridge_set_flow, lan_bridge_set_host_port, lan_bridge_start_guest, lan_bridge_stop,
    lan_bridge_write,
};
pub(crate) use lan_bridge::{clear_game_lan_port, observe_game_log_line};

#[cfg(target_os = "linux")]
pub(crate) use env::apply_linux_display_env;
pub(crate) use env::apply_windows_graphics_preference;

pub(crate) use downloads::*;
pub(crate) use jvm::*;
pub(crate) use launch_prep::*;
pub(crate) use session::*;

pub(crate) use crate::services::game::version_types::{parse_forge_id, parse_neoforge_id};