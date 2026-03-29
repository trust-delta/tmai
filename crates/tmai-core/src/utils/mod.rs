pub mod keys;
pub mod namegen;

use once_cell::sync::Lazy;
use regex::Regex;

/// Strip ANSI escape sequences (OSC + CSI) from text for detection logic
pub fn strip_ansi(input: &str) -> String {
    static OSC_RE: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)").unwrap());
    static CSI_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]").unwrap());

    let without_osc = OSC_RE.replace_all(input, "");
    CSI_RE.replace_all(&without_osc, "").to_string()
}
