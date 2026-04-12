//! In-memory counters for AutoAction attempts, used to enforce guardrails.
//!
//! Counts are per-branch (CI retries) or per-PR (review loops).  Reset on
//! `PrClosed` or explicit reset call.  State is memory-only — matches the
//! existing PR monitor's in-memory design.

use std::collections::HashMap;

use parking_lot::Mutex;

/// Tracks AutoAction attempt counts for guardrail enforcement.
#[derive(Debug, Default)]
pub struct AutoActionTracker {
    ci_retries: Mutex<HashMap<String, u64>>,
    review_loops: Mutex<HashMap<u64, u64>>,
}

impl AutoActionTracker {
    /// Create a new, empty tracker.
    pub fn new() -> Self {
        Self::default()
    }

    /// Increment and return the CI-retry count for `branch`.
    pub fn increment_ci(&self, branch: &str) -> u64 {
        let mut map = self.ci_retries.lock();
        let entry = map.entry(branch.to_string()).or_insert(0);
        *entry += 1;
        *entry
    }

    /// Increment and return the review-loop count for `pr_number`.
    pub fn increment_review(&self, pr_number: u64) -> u64 {
        let mut map = self.review_loops.lock();
        let entry = map.entry(pr_number).or_insert(0);
        *entry += 1;
        *entry
    }

    /// Clear the CI-retry counter for `branch`.
    pub fn reset_ci(&self, branch: &str) {
        self.ci_retries.lock().remove(branch);
    }

    /// Clear the review-loop counter for `pr_number`.
    pub fn reset_review(&self, pr_number: u64) {
        self.review_loops.lock().remove(&pr_number);
    }

    /// Read the current CI-retry count (for tests / introspection).
    #[allow(dead_code)]
    pub fn ci_count(&self, branch: &str) -> u64 {
        self.ci_retries.lock().get(branch).copied().unwrap_or(0)
    }

    /// Read the current review-loop count (for tests / introspection).
    #[allow(dead_code)]
    pub fn review_count(&self, pr_number: u64) -> u64 {
        self.review_loops
            .lock()
            .get(&pr_number)
            .copied()
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn test_increment_ci() {
        let t = AutoActionTracker::new();
        assert_eq!(t.increment_ci("feat/x"), 1);
        assert_eq!(t.increment_ci("feat/x"), 2);
        assert_eq!(t.increment_ci("feat/y"), 1);
    }

    #[test]
    fn test_increment_review() {
        let t = AutoActionTracker::new();
        assert_eq!(t.increment_review(10), 1);
        assert_eq!(t.increment_review(10), 2);
        assert_eq!(t.increment_review(11), 1);
    }

    #[test]
    fn test_reset_ci() {
        let t = AutoActionTracker::new();
        t.increment_ci("feat/x");
        t.increment_ci("feat/x");
        t.reset_ci("feat/x");
        assert_eq!(t.ci_count("feat/x"), 0);
        assert_eq!(t.increment_ci("feat/x"), 1);
    }

    #[test]
    fn test_reset_review() {
        let t = AutoActionTracker::new();
        t.increment_review(10);
        t.reset_review(10);
        assert_eq!(t.review_count(10), 0);
    }

    #[test]
    fn test_concurrent_increment() {
        let t = Arc::new(AutoActionTracker::new());
        let mut handles = Vec::new();
        for _ in 0..8 {
            let t = Arc::clone(&t);
            handles.push(std::thread::spawn(move || {
                for _ in 0..100 {
                    t.increment_ci("feat/x");
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        assert_eq!(t.ci_count("feat/x"), 800);
    }
}
