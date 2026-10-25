const MAX_LEN: usize = 16;
const MIN_LEN: usize = 3;
const FALLBACK: &str = "Player";

fn transliterate(ch: char) -> Option<&'static str> {
    Some(match ch {
        'а' => "a",
        'б' => "b",
        'в' => "v",
        'г' | 'ґ' => "g",
        'д' => "d",
        'е' | 'ё' | 'э' => "e",
        'є' => "ye",
        'ж' => "zh",
        'з' => "z",
        'и' | 'і' => "i",
        'ї' => "yi",
        'й' | 'ы' => "y",
        'к' => "k",
        'л' => "l",
        'м' => "m",
        'н' => "n",
        'о' => "o",
        'п' => "p",
        'р' => "r",
        'с' => "s",
        'т' => "t",
        'у' => "u",
        'ф' => "f",
        'х' => "kh",
        'ц' => "ts",
        'ч' => "ch",
        'ш' => "sh",
        'щ' => "shch",
        'ю' => "yu",
        'я' => "ya",
        'ъ' | 'ь' => "",
        _ => return None,
    })
}

pub fn sanitize_nickname(raw: &str) -> String {
    let mut out = String::new();
    for ch in raw.trim().chars() {
        match ch {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '_' => out.push(ch),
            ' ' => out.push('_'),
            _ => {
                let lower = ch.to_lowercase().next().unwrap_or(ch);
                if let Some(latin) = transliterate(lower) {
                    if ch.is_uppercase() {
                        let mut chars = latin.chars();
                        if let Some(first) = chars.next() {
                            out.extend(first.to_uppercase());
                            out.push_str(chars.as_str());
                        }
                    } else {
                        out.push_str(latin);
                    }
                }
            }
        }
        if out.len() >= MAX_LEN {
            break;
        }
    }
    out.truncate(MAX_LEN);
    out
}

pub fn launch_nickname(raw: &str) -> String {
    let mut name = sanitize_nickname(raw);
    if name.is_empty() {
        return FALLBACK.to_string();
    }
    while name.len() < MIN_LEN {
        name.push('_');
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_valid_nickname() {
        assert_eq!(sanitize_nickname("Steve_01"), "Steve_01");
    }

    #[test]
    fn transliterates_cyrillic() {
        assert_eq!(sanitize_nickname("Вася"), "Vasya");
        assert_eq!(sanitize_nickname("Щука"), "Shchuka");
        assert_eq!(sanitize_nickname("ёж"), "ezh");
    }

    #[test]
    fn replaces_space_and_drops_unknown() {
        assert_eq!(sanitize_nickname("Иван Иванов"), "Ivan_Ivanov");
        assert_eq!(sanitize_nickname("a-b!c"), "abc");
    }

    #[test]
    fn truncates_to_sixteen() {
        assert_eq!(sanitize_nickname("abcdefghijklmnopqrst").len(), 16);
        assert_eq!(sanitize_nickname("Привет всем друзьям").len(), 16);
    }

    #[test]
    fn launch_nickname_is_always_valid() {
        assert_eq!(launch_nickname(""), "Player");
        assert_eq!(launch_nickname("!!!"), "Player");
        assert_eq!(launch_nickname("ab"), "ab_");
        assert_eq!(launch_nickname("Ольга"), "Olga");
    }
}
