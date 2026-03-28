//! Shared key conversion utilities for tmux key names to PTY bytes.

/// Convert tmux key name to bytes for PTY input
pub fn tmux_key_to_bytes(key: &str) -> Vec<u8> {
    match key {
        "Enter" => vec![b'\r'],
        "Space" => vec![b' '],
        "BSpace" => vec![0x7f],
        "Tab" => vec![b'\t'],
        "BTab" => vec![0x1b, b'[', b'Z'],
        "Escape" | "Esc" => vec![0x1b],
        "Up" => vec![0x1b, b'[', b'A'],
        "Down" => vec![0x1b, b'[', b'B'],
        "Right" => vec![0x1b, b'[', b'C'],
        "Left" => vec![0x1b, b'[', b'D'],
        "Home" => vec![0x1b, b'[', b'H'],
        "End" => vec![0x1b, b'[', b'F'],
        "PPage" => vec![0x1b, b'[', b'5', b'~'],
        "NPage" => vec![0x1b, b'[', b'6', b'~'],
        "DC" => vec![0x1b, b'[', b'3', b'~'],
        s if s.starts_with("C-") && s.len() == 3 => {
            // Control character via bitmask: C-a/C-A = 0x01, C-@ = 0x00, C-[ = 0x1b
            let c = s.as_bytes()[2];
            vec![c & 0x1f]
        }
        // For literal text like "y"
        other => other.as_bytes().to_vec(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tmux_key_to_bytes() {
        assert_eq!(tmux_key_to_bytes("Enter"), vec![b'\r']);
        assert_eq!(tmux_key_to_bytes("Space"), vec![b' ']);
        assert_eq!(tmux_key_to_bytes("Up"), vec![0x1b, b'[', b'A']);
        assert_eq!(tmux_key_to_bytes("C-c"), vec![3]); // 0x03
        assert_eq!(tmux_key_to_bytes("C-A"), vec![1]); // uppercase: same as C-a
        assert_eq!(tmux_key_to_bytes("C-@"), vec![0]); // NUL
        assert_eq!(tmux_key_to_bytes("C-["), vec![0x1b]); // ESC
        assert_eq!(tmux_key_to_bytes("BTab"), vec![0x1b, b'[', b'Z']);
        assert_eq!(tmux_key_to_bytes("y"), vec![b'y']);
    }
}
