#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RedirectLanguage {
    Ru,
    En,
    De,
    Es,
}

impl RedirectLanguage {
    pub fn from_code(code: &str) -> Self {
        match code.trim().to_ascii_lowercase().as_str() {
            "en" => Self::En,
            "de" => Self::De,
            "es" => Self::Es,
            _ => Self::Ru,
        }
    }

    pub fn html_lang(self) -> &'static str {
        match self {
            Self::Ru => "ru",
            Self::En => "en",
            Self::De => "de",
            Self::Es => "es",
        }
    }
}

struct RedirectTexts {
    success_page_title: &'static str,
    success_title: &'static str,
    success_subtitle: &'static str,
    success_hint: &'static str,
    error_page_title: &'static str,
    error_title: &'static str,
    error_subtitle: &'static str,
    brand: &'static str,
}

fn texts(lang: RedirectLanguage) -> RedirectTexts {
    match lang {
        RedirectLanguage::En => RedirectTexts {
            success_page_title: "16Launcher — sign-in complete",
            success_title: "Microsoft sign-in complete",
            success_subtitle: "Your account has been linked to 16Launcher.",
            success_hint: "You can close this tab and return to the launcher.",
            error_page_title: "16Launcher — sign-in failed",
            error_title: "Could not complete sign-in",
            error_subtitle: "Close this tab and try again in the launcher.",
            brand: "16Launcher",
        },
        RedirectLanguage::De => RedirectTexts {
            success_page_title: "16Launcher — Anmeldung abgeschlossen",
            success_title: "Microsoft-Anmeldung abgeschlossen",
            success_subtitle: "Ihr Konto wurde erfolgreich mit 16Launcher verknüpft.",
            success_hint: "Sie können diesen Tab schließen und zum Launcher zurückkehren.",
            error_page_title: "16Launcher — Anmeldung fehlgeschlagen",
            error_title: "Anmeldung konnte nicht abgeschlossen werden",
            error_subtitle: "Schließen Sie diesen Tab und versuchen Sie es erneut im Launcher.",
            brand: "16Launcher",
        },
        RedirectLanguage::Es => RedirectTexts {
            success_page_title: "16Launcher — inicio de sesión completado",
            success_title: "Inicio de sesión con Microsoft completado",
            success_subtitle: "La cuenta se ha vinculado correctamente a 16Launcher.",
            success_hint: "Puede cerrar esta pestaña y volver al launcher.",
            error_page_title: "16Launcher — error de inicio de sesión",
            error_title: "No se pudo completar el inicio de sesión",
            error_subtitle: "Cierre esta pestaña e inténtelo de nuevo en el launcher.",
            brand: "16Launcher",
        },
        RedirectLanguage::Ru => RedirectTexts {
            success_page_title: "16Launcher — вход выполнен",
            success_title: "Вход через Microsoft завершён",
            success_subtitle: "Аккаунт успешно привязан к 16Launcher.",
            success_hint: "Можно закрыть эту вкладку и вернуться в лаунчер.",
            error_page_title: "16Launcher — ошибка входа",
            error_title: "Не удалось завершить вход",
            error_subtitle: "Закройте вкладку и попробуйте снова в лаунчере.",
            brand: "16Launcher",
        },
    }
}

const SHARED_STYLES: &str = r#"
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #ffffff;
      background-color: #050609;
      background-image:
        radial-gradient(ellipse 70% 55% at 50% -10%, rgba(46, 204, 113, 0.14), transparent 65%),
        radial-gradient(ellipse 50% 40% at 100% 100%, rgba(52, 152, 219, 0.08), transparent 60%);
    }
    .card {
      width: min(100%, 420px);
      padding: 32px 28px;
      border-radius: 1.25rem;
      border: 1px solid rgba(255, 255, 255, 0.06);
      background: rgba(26, 26, 26, 0.68);
      box-shadow: 0 18px 45px rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      text-align: center;
    }
    .icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 20px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, rgba(46, 204, 113, 0.22), rgba(46, 204, 113, 0.08));
      border: 1px solid rgba(46, 204, 113, 0.35);
    }
    .icon svg { width: 32px; height: 32px; }
    .icon-error {
      background: linear-gradient(135deg, rgba(248, 113, 113, 0.22), rgba(248, 113, 113, 0.08));
      border-color: rgba(248, 113, 113, 0.35);
    }
    h1 {
      font-size: 1.35rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 10px;
      color: #ffffff;
    }
    p {
      font-size: 0.95rem;
      line-height: 1.55;
      color: rgba(255, 255, 255, 0.7);
    }
    .hint {
      margin-top: 18px;
      padding: 12px 14px;
      border-radius: 0.75rem;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.12);
      font-size: 0.88rem;
      color: rgba(46, 204, 113, 0.95);
    }
    .hint-error {
      color: rgba(248, 113, 113, 0.9);
      border-color: rgba(248, 113, 113, 0.25);
      background: rgba(248, 113, 113, 0.08);
    }
    .brand {
      margin-top: 22px;
      font-size: 0.78rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.38);
    }
"#;

pub fn success_html(lang: RedirectLanguage) -> String {
    let t = texts(lang);
    format!(
        r##"<!DOCTYPE html>
<html lang="{html_lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>{page_title}</title>
  <style>{styles}</style>
</head>
<body>
  <main class="card">
    <div class="icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="#2ecc71" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
    </div>
    <h1>{title}</h1>
    <p>{subtitle}</p>
    <p class="hint">{hint}</p>
    <p class="brand">{brand}</p>
  </main>
</body>
</html>"##,
        html_lang = lang.html_lang(),
        page_title = t.success_page_title,
        styles = SHARED_STYLES,
        title = t.success_title,
        subtitle = t.success_subtitle,
        hint = t.success_hint,
        brand = t.brand,
    )
}

pub fn error_html(lang: RedirectLanguage) -> String {
    let t = texts(lang);
    format!(
        r##"<!DOCTYPE html>
<html lang="{html_lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>{page_title}</title>
  <style>{styles}</style>
</head>
<body>
  <main class="card">
    <div class="icon icon-error" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
      </svg>
    </div>
    <h1>{title}</h1>
    <p class="hint hint-error">{subtitle}</p>
    <p class="brand">{brand}</p>
  </main>
</body>
</html>"##,
        html_lang = lang.html_lang(),
        page_title = t.error_page_title,
        styles = SHARED_STYLES,
        title = t.error_title,
        subtitle = t.error_subtitle,
        brand = t.brand,
    )
}
