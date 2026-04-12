//! AutoAction prompt templates — prompts sent directly to target workers.

use serde::{Deserialize, Serialize};

/// Built-in default template for CI-failed → implementer.
fn default_ci_failed_implementer() -> String {
    "CI check failed on PR #{{pr_number}} ({{title}}, branch {{branch}}).\n\n\
     {{failed_details}}\n\n\
     Please investigate the failure, fix the root cause, and push the fix."
        .to_string()
}

/// Built-in default template for review-feedback → implementer.
fn default_review_feedback_implementer() -> String {
    "Review feedback received on PR #{{pr_number}} ({{title}}):\n\n\
     {{comments_summary}}\n\n\
     Please address these comments and push the fix."
        .to_string()
}

/// Templates rendered by AutoActionExecutor before sending prompts to workers.
///
/// Each template uses `{{var}}` placeholders.  Empty strings fall back to
/// the built-in default (see `defaults()`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct AutoActionTemplates {
    /// Prompt sent to the implementer agent when CI fails.
    /// Empty string → fall back to built-in default at render time.
    #[serde(default)]
    pub ci_failed_implementer: String,

    /// Prompt sent to the implementer agent when review feedback arrives.
    /// Empty string → fall back to built-in default at render time.
    #[serde(default)]
    pub review_feedback_implementer: String,
}

impl AutoActionTemplates {
    /// Return templates pre-populated with built-in default prompts.
    pub fn defaults() -> Self {
        Self {
            ci_failed_implementer: default_ci_failed_implementer(),
            review_feedback_implementer: default_review_feedback_implementer(),
        }
    }

    /// Effective CI-failed template — custom value if non-empty, else built-in default.
    pub fn effective_ci_failed(&self) -> String {
        if self.ci_failed_implementer.is_empty() {
            default_ci_failed_implementer()
        } else {
            self.ci_failed_implementer.clone()
        }
    }

    /// Effective review-feedback template — custom value if non-empty, else built-in default.
    pub fn effective_review_feedback(&self) -> String {
        if self.review_feedback_implementer.is_empty() {
            default_review_feedback_implementer()
        } else {
            self.review_feedback_implementer.clone()
        }
    }
}

/// Expand `{{var}}` placeholders in `template` with `vars` substitutions.
///
/// Missing variables are left as-is so operators can spot unfilled tokens.
pub fn render(template: &str, vars: &[(&str, &str)]) -> String {
    let mut result = template.to_string();
    for (key, value) in vars {
        result = result.replace(&format!("{{{{{key}}}}}"), value);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_render_basic() {
        let out = render(
            "PR #{{pr_number}} on {{branch}}",
            &[("pr_number", "42"), ("branch", "feat/x")],
        );
        assert_eq!(out, "PR #42 on feat/x");
    }

    #[test]
    fn test_render_missing_var_left_intact() {
        let out = render("PR #{{pr_number}} — {{missing}}", &[("pr_number", "42")]);
        assert_eq!(out, "PR #42 — {{missing}}");
    }

    #[test]
    fn test_render_empty_template() {
        assert_eq!(render("", &[("x", "y")]), "");
    }

    #[test]
    fn test_effective_ci_failed_falls_back() {
        let tpl = AutoActionTemplates::default();
        assert!(tpl.effective_ci_failed().contains("{{pr_number}}"));
    }

    #[test]
    fn test_effective_ci_failed_custom_wins() {
        let tpl = AutoActionTemplates {
            ci_failed_implementer: "custom {{pr_number}}".into(),
            review_feedback_implementer: String::new(),
        };
        assert_eq!(tpl.effective_ci_failed(), "custom {{pr_number}}");
    }

    #[test]
    fn test_defaults_non_empty() {
        let tpl = AutoActionTemplates::defaults();
        assert!(!tpl.ci_failed_implementer.is_empty());
        assert!(!tpl.review_feedback_implementer.is_empty());
    }

    #[test]
    fn test_serde_roundtrip_default_is_empty() {
        let tpl = AutoActionTemplates::default();
        let s = toml::to_string(&tpl).unwrap();
        let decoded: AutoActionTemplates = toml::from_str(&s).unwrap();
        assert_eq!(decoded, tpl);
    }
}
