use serde::{Deserialize, Serialize};

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub struct Profile {
    pub nickname: String,
    #[serde(default)]
    pub ely_username: Option<String>,
    #[serde(default)]
    pub ely_uuid: Option<String>,
    #[serde(default)]
    pub ely_access_token: Option<String>,
    #[serde(default)]
    pub ely_client_token: Option<String>,
    #[serde(default)]
    pub ely_refresh_token: Option<String>,
    #[serde(default)]
    pub ms_access_token: Option<String>,
    #[serde(default)]
    pub ms_refresh_token: Option<String>,
    #[serde(default)]
    pub ms_id_token: Option<String>,
    #[serde(default)]
    pub mc_uuid: Option<String>,
    #[serde(default)]
    pub mc_username: Option<String>,
    #[serde(default)]
    pub mc_access_token: Option<String>,
}

/// Токены аккаунта. Хранятся в зашифрованном хранилище, а не в json-файлах.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct AccountSecrets {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ely_access_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ely_client_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ely_refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ms_access_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ms_refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ms_id_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mc_access_token: Option<String>,
}

fn non_blank(v: &Option<String>) -> Option<String> {
    v.as_ref().filter(|s| !s.trim().is_empty()).cloned()
}

fn fill_if_blank(dst: &mut Option<String>, src: &Option<String>) {
    if dst.as_ref().map_or(true, |s| s.trim().is_empty()) {
        if let Some(v) = non_blank(src) {
            *dst = Some(v);
        }
    }
}

impl AccountSecrets {
    pub fn is_empty(&self) -> bool {
        *self == AccountSecrets::default()
    }
}

impl Profile {
    pub(crate) fn secrets(&self) -> AccountSecrets {
        AccountSecrets {
            ely_access_token: non_blank(&self.ely_access_token),
            ely_client_token: non_blank(&self.ely_client_token),
            ely_refresh_token: non_blank(&self.ely_refresh_token),
            ms_access_token: non_blank(&self.ms_access_token),
            ms_refresh_token: non_blank(&self.ms_refresh_token),
            ms_id_token: non_blank(&self.ms_id_token),
            mc_access_token: non_blank(&self.mc_access_token),
        }
    }

    /// Копия профиля без токенов — именно она попадает в json на диске.
    pub(crate) fn without_secrets(&self) -> Profile {
        Profile {
            ely_access_token: None,
            ely_client_token: None,
            ely_refresh_token: None,
            ms_access_token: None,
            ms_refresh_token: None,
            ms_id_token: None,
            mc_access_token: None,
            ..self.clone()
        }
    }

    /// Подставляет токены из хранилища туда, где в профиле они пустые.
    pub(crate) fn fill_missing_secrets(&mut self, s: &AccountSecrets) {
        fill_if_blank(&mut self.ely_access_token, &s.ely_access_token);
        fill_if_blank(&mut self.ely_client_token, &s.ely_client_token);
        fill_if_blank(&mut self.ely_refresh_token, &s.ely_refresh_token);
        fill_if_blank(&mut self.ms_access_token, &s.ms_access_token);
        fill_if_blank(&mut self.ms_refresh_token, &s.ms_refresh_token);
        fill_if_blank(&mut self.ms_id_token, &s.ms_id_token);
        fill_if_blank(&mut self.mc_access_token, &s.mc_access_token);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct LauncherAccountEntry {
    pub id: String,
    pub profile: Profile,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub(crate) struct LauncherAccountsStore {
    #[serde(default)]
    pub active_id: Option<String>,
    #[serde(default)]
    pub accounts: Vec<LauncherAccountEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherAccountSummary {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub is_active: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signed_in() -> Profile {
        Profile {
            nickname: "Steve".into(),
            mc_uuid: Some("uuid".into()),
            ms_refresh_token: Some("refresh".into()),
            mc_access_token: Some("mc".into()),
            ely_client_token: Some("   ".into()),
            ..Default::default()
        }
    }

    #[test]
    fn without_secrets_keeps_identity_and_drops_tokens() {
        let stripped = signed_in().without_secrets();
        assert_eq!(stripped.nickname, "Steve");
        assert_eq!(stripped.mc_uuid.as_deref(), Some("uuid"));
        assert!(stripped.secrets().is_empty());
        assert!(stripped.ms_refresh_token.is_none() && stripped.mc_access_token.is_none());
    }

    #[test]
    fn secrets_ignore_blank_values() {
        let s = signed_in().secrets();
        assert_eq!(s.ms_refresh_token.as_deref(), Some("refresh"));
        assert!(s.ely_client_token.is_none());
    }

    #[test]
    fn fill_missing_does_not_override_fresh_tokens() {
        let mut p = signed_in().without_secrets();
        p.mc_access_token = Some("fresh".into());
        p.fill_missing_secrets(&signed_in().secrets());
        assert_eq!(p.mc_access_token.as_deref(), Some("fresh"));
        assert_eq!(p.ms_refresh_token.as_deref(), Some("refresh"));
    }
}
