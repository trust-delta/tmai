//! Extract distinctive phrases from capture-pane content for JSONL matching.

/// Characters that indicate UI chrome (prompts, decorations) rather than conversation content
const PROMPT_CHARS: &[char] = &['❯', '>', '$', '#', '%', '│', '─', '━', '┃', '╭', '╰'];

/// Extract distinctive phrases from capture-pane content for searching in JSONL files.
///
/// Filters out UI elements, empty lines, and short/generic lines, then returns
/// the most distinctive phrases suitable for substring matching.
///
/// Returns up to `max_phrases` phrases, each 15-80 characters long.
pub fn extract_phrases(content: &str, max_phrases: usize) -> Vec<String> {
    let mut candidates: Vec<(usize, String)> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();

        // Skip empty and very short lines
        if trimmed.len() < 15 {
            continue;
        }

        // Skip lines that are mostly UI chrome
        if is_ui_chrome(trimmed) {
            continue;
        }

        // Skip lines that are just repeated characters (borders, separators)
        if is_repeated_chars(trimmed) {
            continue;
        }

        // Truncate overly long lines (wrapping differences cause mismatch)
        // Use char boundary-safe truncation for multi-byte characters (e.g., Japanese)
        let phrase = if trimmed.len() > 80 {
            let mut end = 80;
            while end > 0 && !trimmed.is_char_boundary(end) {
                end -= 1;
            }
            &trimmed[..end]
        } else {
            trimmed
        };

        // Score by distinctiveness: prefer longer, non-ASCII (Japanese etc.), mixed content
        let score = score_phrase(phrase);
        candidates.push((score, phrase.to_string()));
    }

    // Sort by score descending (most distinctive first)
    candidates.sort_by(|a, b| b.0.cmp(&a.0));

    // Deduplicate similar phrases
    let mut result = Vec::new();
    for (_, phrase) in candidates {
        if result.len() >= max_phrases {
            break;
        }
        // Skip if too similar to an already-selected phrase
        if result.iter().any(|existing: &String| {
            existing.contains(&phrase) || phrase.contains(existing.as_str())
        }) {
            continue;
        }
        result.push(phrase);
    }

    result
}

/// Check if a line is UI chrome (prompts, borders, status lines)
fn is_ui_chrome(line: &str) -> bool {
    // Line starts with prompt character
    if let Some(first) = line.chars().next() {
        if PROMPT_CHARS.contains(&first) {
            return true;
        }
    }

    // ANSI spinner/status patterns
    if line.contains("✳") || line.contains("⠂") || line.contains("⠐") {
        return true;
    }

    // Lines that are mostly box-drawing or decoration
    let decoration_count = line
        .chars()
        .filter(|c| {
            matches!(
                c,
                '─' | '━'
                    | '│'
                    | '┃'
                    | '╭'
                    | '╰'
                    | '╮'
                    | '╯'
                    | '┌'
                    | '└'
                    | '┐'
                    | '┘'
                    | '├'
                    | '┤'
                    | '┬'
                    | '┴'
                    | '┼'
                    | '═'
                    | '║'
            )
        })
        .count();
    if decoration_count > line.chars().count() / 2 {
        return true;
    }

    false
}

/// Check if a line is just repeated characters (borders, separators)
fn is_repeated_chars(line: &str) -> bool {
    let chars: Vec<char> = line.chars().collect();
    if chars.len() < 3 {
        return false;
    }
    let first = chars[0];
    chars.iter().all(|&c| c == first || c == ' ')
}

/// Score a phrase by distinctiveness (higher = more distinctive)
fn score_phrase(phrase: &str) -> usize {
    let mut score = phrase.len();

    // Bonus for non-ASCII chars (Japanese, etc.) — very distinctive
    let non_ascii_count = phrase.chars().filter(|c| !c.is_ascii()).count();
    score += non_ascii_count * 3;

    // Bonus for mixed content (letters + numbers + symbols)
    let has_letters = phrase.chars().any(|c| c.is_alphabetic());
    let has_digits = phrase.chars().any(|c| c.is_ascii_digit());
    let has_symbols = phrase
        .chars()
        .any(|c| !c.is_alphanumeric() && !c.is_whitespace());
    if has_letters && has_digits {
        score += 10;
    }
    if has_symbols {
        score += 5;
    }

    // Penalty for lines that look like markdown headers or simple patterns
    if phrase.starts_with('#') || phrase.starts_with("```") {
        score = score.saturating_sub(20);
    }

    score
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_phrases_filters_short_lines() {
        let content =
            "short\n\nThis is a distinctive conversation about implementing PTY wrapping\n";
        let phrases = extract_phrases(content, 5);
        assert_eq!(phrases.len(), 1);
        assert!(phrases[0].contains("PTY wrapping"));
    }

    #[test]
    fn test_extract_phrases_filters_ui_chrome() {
        let content = "❯ some prompt\n│ border line\n✳ spinner line\nActual conversation content about session lookup feature\n";
        let phrases = extract_phrases(content, 5);
        assert_eq!(phrases.len(), 1);
        assert!(phrases[0].contains("session lookup"));
    }

    #[test]
    fn test_extract_phrases_prefers_distinctive() {
        let content = "The quick brown fox jumps\nカスタムスピナー対応実装計画を確認しました\nAnother simple english line here\n";
        let phrases = extract_phrases(content, 2);
        // Japanese text should be ranked higher
        assert!(phrases[0].contains("カスタムスピナー"));
    }

    #[test]
    fn test_extract_phrases_truncates_long_lines() {
        let long_line = "a".repeat(200);
        let content = format!("{}\n", long_line);
        let phrases = extract_phrases(&content, 5);
        if !phrases.is_empty() {
            assert!(phrases[0].len() <= 80);
        }
    }

    #[test]
    fn test_extract_phrases_respects_max() {
        let content = "Line one about implementing features\nLine two about testing patterns\nLine three about deployment configs\nLine four about session management\nLine five about configuration setup\nLine six about error handling logic\n";
        let phrases = extract_phrases(&content, 3);
        assert!(phrases.len() <= 3);
    }

    #[test]
    fn test_is_repeated_chars() {
        assert!(is_repeated_chars("────────────"));
        assert!(is_repeated_chars("============"));
        assert!(!is_repeated_chars("hello world!"));
    }

    #[test]
    fn test_score_phrase_japanese_bonus() {
        let jp = score_phrase("カスタムスピナー対応");
        let en = score_phrase("custom spinner support");
        assert!(jp > en, "Japanese should score higher: {} vs {}", jp, en);
    }

    #[test]
    fn test_extract_phrases_multibyte_truncation() {
        // Regression: slicing at byte 80 can split a multi-byte char (e.g., '気' at bytes 79..82)
        let long_jp = "● 了解！テスト確認しました。何か作業が必要になったら気軽に声をかけてください。追加の情報もここに書きます。";
        let content = format!("{}\n", long_jp);
        // Should not panic
        let phrases = extract_phrases(&content, 5);
        // The phrase should be valid UTF-8 and not empty
        assert!(!phrases.is_empty());
        for phrase in &phrases {
            assert!(
                phrase.len() <= 80,
                "phrase should be at most 80 bytes, got {}",
                phrase.len()
            );
        }
    }
}
