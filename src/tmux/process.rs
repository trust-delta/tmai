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

    /// Clear expired entries from the cache
    pub fn cleanup(&self) {
        let mut cache = self.cache.write();
        cache.retain(|_, info| info.last_update.elapsed() < self.ttl);
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
