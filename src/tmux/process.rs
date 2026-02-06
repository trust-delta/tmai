use parking_lot::RwLock;
use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Cached process information
#[derive(Debug, Clone)]
pub struct ProcessInfo {
    /// Process command line
    pub cmdline: String,
    /// When this entry was last updated
    pub last_update: Instant,
}

/// Cache for process information to reduce /proc reads
pub struct ProcessCache {
    /// Cached process info by PID
    cache: RwLock<HashMap<u32, ProcessInfo>>,
    /// How long entries remain valid
    ttl: Duration,
}

impl ProcessCache {
    /// Create a new process cache with default TTL (5 seconds)
    pub fn new() -> Self {
        Self {
            cache: RwLock::new(HashMap::new()),
            ttl: Duration::from_secs(5),
        }
    }

    /// Create a new process cache with custom TTL
    pub fn with_ttl(ttl: Duration) -> Self {
        Self {
            cache: RwLock::new(HashMap::new()),
            ttl,
        }
    }

    /// Get the command line for a process, using cache if available
    pub fn get_cmdline(&self, pid: u32) -> Option<String> {
        // Check cache first
        {
            let cache = self.cache.read();
            if let Some(info) = cache.get(&pid) {
                if info.last_update.elapsed() < self.ttl {
                    return Some(info.cmdline.clone());
                }
            }
        }

        // Read from /proc
        let cmdline = self.read_cmdline(pid)?;

        // Update cache
        {
            let mut cache = self.cache.write();
            cache.insert(
                pid,
                ProcessInfo {
                    cmdline: cmdline.clone(),
                    last_update: Instant::now(),
                },
            );
        }

        Some(cmdline)
    }

    /// Read command line directly from /proc
    fn read_cmdline(&self, pid: u32) -> Option<String> {
        let path = format!("/proc/{}/cmdline", pid);
        std::fs::read_to_string(&path)
            .ok()
            .map(|s| s.replace('\0', " ").trim().to_string())
    }

    /// Get cmdline of first child process (for detecting agents running under shell)
    pub fn get_child_cmdline(&self, pid: u32) -> Option<String> {
        // Check cache first with child_ prefix
        let cache_key = pid + 1_000_000_000; // Use offset to differentiate from direct pid
        {
            let cache = self.cache.read();
            if let Some(info) = cache.get(&cache_key) {
                if info.last_update.elapsed() < self.ttl {
                    return Some(info.cmdline.clone());
                }
            }
        }

        // Find child processes
        let children_path = format!("/proc/{}/task/{}/children", pid, pid);
        let children = std::fs::read_to_string(&children_path).ok()?;

        // Get first child's cmdline
        let child_pid: u32 = children.split_whitespace().next()?.parse().ok()?;
        let cmdline = self.read_cmdline(child_pid)?;

        // Update cache
        {
            let mut cache = self.cache.write();
            cache.insert(
                cache_key,
                ProcessInfo {
                    cmdline: cmdline.clone(),
                    last_update: Instant::now(),
                },
            );
        }

        Some(cmdline)
    }

    /// Clear expired entries from the cache
    pub fn cleanup(&self) {
        let mut cache = self.cache.write();
        cache.retain(|_, info| info.last_update.elapsed() < self.ttl);
    }

    /// Read a specific environment variable from a process
    ///
    /// Reads `/proc/{pid}/environ` and extracts the value of the given variable.
    /// Returns None on any error (permission denied, process gone, etc.)
    pub fn get_env_var(&self, pid: u32, var_name: &str) -> Option<String> {
        // Use cache key with env_ prefix to differentiate from cmdline cache
        let cache_key = pid + 2_000_000_000; // Use different offset from child cmdline
        let cache_subkey = format!("{}:{}", cache_key, var_name);

        // Check cache first (using the hash of var_name + pid as key)
        // For simplicity, just read from /proc directly since env reads are infrequent
        let environ_path = format!("/proc/{}/environ", pid);
        let content = std::fs::read(&environ_path).ok()?;

        let prefix = format!("{}=", var_name);

        // environ is null-byte separated
        for entry in content.split(|&b| b == 0) {
            if let Ok(entry_str) = std::str::from_utf8(entry) {
                if let Some(value) = entry_str.strip_prefix(&prefix) {
                    return Some(value.to_string());
                }
            }
        }

        // Suppress unused variable warning
        let _ = cache_subkey;

        None
    }

    /// Clear all entries from the cache
    pub fn clear(&self) {
        let mut cache = self.cache.write();
        cache.clear();
    }

    /// Get the number of cached entries
    pub fn len(&self) -> usize {
        self.cache.read().len()
    }

    /// Check if the cache is empty
    pub fn is_empty(&self) -> bool {
        self.cache.read().is_empty()
    }
}

impl Default for ProcessCache {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cache_creation() {
        let cache = ProcessCache::new();
        assert!(cache.is_empty());
    }

    #[test]
    fn test_cache_with_ttl() {
        let cache = ProcessCache::with_ttl(Duration::from_secs(10));
        assert!(cache.is_empty());
    }

    #[test]
    fn test_cache_clear() {
        let cache = ProcessCache::new();
        // Can't easily test with real PIDs in unit tests
        cache.clear();
        assert!(cache.is_empty());
    }
}
