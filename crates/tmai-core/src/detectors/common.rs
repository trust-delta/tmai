use once_cell::sync::Lazy;
use regex::Regex;

/// Shared error detection regex pattern used across all detectors
static ERROR_PATTERN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(?:^|\n)\s*(?:Error|ERROR|error:|✗|❌)").unwrap());

/// Get the shared error detection regex pattern
///
/// Currently used by `detect_error_common`. Other detectors can migrate
/// from per-detector Regex fields to this shared pattern.
#[allow(dead_code)]
pub(crate) fn common_error_pattern() -> &'static Regex {
    &ERROR_PATTERN
}

/// Detect error messages in content using the shared error pattern
///
/// Scans the tail of the content (limited by `tail_bytes`) for error patterns.
/// Returns the first matching error line, or a generic message if the pattern
/// matches but no specific line is found.
pub(crate) fn detect_error_common(content: &str, tail_bytes: usize) -> Option<String> {
    let recent = safe_tail(content, tail_bytes);
    if ERROR_PATTERN.is_match(recent) {
        for line in recent.lines().rev().take(10) {
            let trimmed = line.trim();
            if trimmed.to_lowercase().contains("error")
                || trimmed.contains('✗')
                || trimmed.contains('❌')
            {
                return Some(trimmed.to_string());
            }
        }
        return Some("Error detected".to_string());
    }
    None
}

/// Strip box-drawing characters (U+2500-U+257F) and everything after them from text.
///
/// Handles preview box borders like │, ┌, ┐, └, ┘, etc.
/// Used by both detectors and wrap/analyzer for choice text extraction.
pub(crate) fn strip_box_drawing(text: &str) -> &str {
    if let Some(pos) = text.find(|c: char| ('\u{2500}'..='\u{257F}').contains(&c)) {
        text[..pos].trim()
    } else {
        text
    }
}

/// Get the last n bytes of a string safely, respecting UTF-8 boundaries
pub(crate) fn safe_tail(s: &str, n: usize) -> &str {
    if s.len() <= n {
        s
    } else {
        let start = s.len() - n;
        // Find a valid UTF-8 boundary
        let start = s
            .char_indices()
            .map(|(i, _)| i)
            .find(|&i| i >= start)
            .unwrap_or(s.len());
        &s[start..]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_safe_tail_short_string() {
        assert_eq!(safe_tail("hello", 10), "hello");
    }

    #[test]
    fn test_safe_tail_exact_length() {
        assert_eq!(safe_tail("hello", 5), "hello");
    }

    #[test]
    fn test_safe_tail_truncated() {
        let result = safe_tail("hello world", 5);
        assert_eq!(result, "world");
    }

    #[test]
    fn test_safe_tail_utf8_boundary() {
        // "あいう" = 9 bytes (3 bytes each)
        let s = "あいう";
        let result = safe_tail(s, 4);
        // Should not split a character
        assert_eq!(result, "う");
    }

    #[test]
    fn test_strip_box_drawing_with_border() {
        assert_eq!(strip_box_drawing("Option A  │ preview"), "Option A");
    }

    #[test]
    fn test_strip_box_drawing_no_border() {
        assert_eq!(strip_box_drawing("Option A"), "Option A");
    }

    #[test]
    fn test_detect_error_common_found() {
        let content = "some output\nError: something failed\nmore output";
        assert!(detect_error_common(content, 500).is_some());
    }

    #[test]
    fn test_detect_error_common_not_found() {
        let content = "some normal output\nall good";
        assert!(detect_error_common(content, 500).is_none());
    }
}
