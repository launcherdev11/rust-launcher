use serde::Deserialize;
use tauri::command;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(windows), allow(dead_code))]
pub struct JumpListProfile {
    pub profile_id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[command]
pub async fn update_jump_list(category: String, profiles: Vec<JumpListProfile>) -> Result<(), String> {
    #[cfg(windows)]
    {
        // COM в отдельном потоке, чтобы не трогать апартамент потоков Tauri
        tokio::task::spawn_blocking(move || windows_impl::update(&category, &profiles))
            .await
            .map_err(|e| format!("Jump List: {e}"))?
    }
    #[cfg(not(windows))]
    {
        let _ = (category, profiles);
        Ok(())
    }
}

#[cfg(windows)]
mod windows_impl {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{
        DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW,
        ShellLink,
    };

    use super::JumpListProfile;
    use crate::infra::window_icon::launcher_icon_file_path;
    use crate::profile_launch::LAUNCH_PROFILE_ARG;

    struct ComGuard;

    impl Drop for ComGuard {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    pub fn update(category: &str, profiles: &[JumpListProfile]) -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| format!("Jump List: путь к exe: {e}"))?;
        let icon = launcher_icon_file_path(&exe).unwrap_or_else(|| exe.clone());
        let work_dir = exe.parent().map(|p| p.to_path_buf());

        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED)
                .ok()
                .map_err(|e| format!("Jump List: COM: {e}"))?;
            let _com = ComGuard;

            let list: ICustomDestinationList =
                CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| format!("Jump List: {e}"))?;
            let mut max_slots = 0u32;
            let _removed: IObjectArray = list
                .BeginList(&mut max_slots)
                .map_err(|e| format!("Jump List: BeginList: {e}"))?;

            if !profiles.is_empty() {
                let collection: IObjectCollection =
                    CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)
                        .map_err(|e| format!("Jump List: {e}"))?;
                let limit = (max_slots as usize).max(1);
                for profile in profiles.iter().take(limit) {
                    let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)
                        .map_err(|e| format!("Jump List: {e}"))?;
                    link.SetPath(&HSTRING::from(exe.as_os_str()))
                        .map_err(|e| format!("Jump List: {e}"))?;
                    link.SetArguments(&HSTRING::from(format!(
                        "{LAUNCH_PROFILE_ARG} \"{}\"",
                        profile.profile_id
                    )))
                    .map_err(|e| format!("Jump List: {e}"))?;
                    if let Some(dir) = &work_dir {
                        let _ = link.SetWorkingDirectory(&HSTRING::from(dir.as_os_str()));
                    }
                    let _ = link.SetIconLocation(&HSTRING::from(icon.as_os_str()), 0);
                    if let Some(description) = profile.description.as_deref() {
                        let _ = link.SetDescription(&HSTRING::from(description));
                    }

                    let store: IPropertyStore = link.cast().map_err(|e| format!("Jump List: {e}"))?;
                    store
                        .SetValue(&PKEY_Title, &PROPVARIANT::from(profile.name.as_str()))
                        .map_err(|e| format!("Jump List: {e}"))?;
                    store.Commit().map_err(|e| format!("Jump List: {e}"))?;

                    collection.AddObject(&link).map_err(|e| format!("Jump List: {e}"))?;
                }
                let items: IObjectArray = collection.cast().map_err(|e| format!("Jump List: {e}"))?;
                // при выключенных недавних элементах в списках переходов своя категория недоступна
                if list.AppendCategory(&HSTRING::from(category), &items).is_err() {
                    if let Err(e) = list.AddUserTasks(&items) {
                        let _ = list.AbortList();
                        return Err(format!("Jump List: AddUserTasks: {e}"));
                    }
                }
            }

            list.CommitList().map_err(|e| format!("Jump List: CommitList: {e}"))?;
        }
        Ok(())
    }
}
