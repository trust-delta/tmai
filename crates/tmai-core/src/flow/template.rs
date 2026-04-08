//! Template engine for `{{placeholder}}` expansion in flow prompts and params.
//!
//! Supports dot-path resolution against `FlowContext` (e.g., `{{pr.number}}`,
//! `{{agent.git_branch}}`). Unknown or null placeholders are replaced with
//! empty strings to avoid broken prompts.

use std::collections::HashMap;

use super::types::FlowContext;

/// Expand `{{placeholder}}` patterns in a template string.
///
/// Placeholders are dot-paths resolved against the flow context.
/// Unknown or null values are replaced with empty strings.
///
/// # Examples
/// ```ignore
/// let result = expand("PR #{{pr.number}} on {{agent.git_branch}}", &context);
/// // → "PR #123 on feat/42-auth"
/// ```
pub fn expand(template: &str, context: &FlowContext) -> String {
    let mut result = String::with_capacity(template.len());
    let mut chars = template.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '{' && chars.peek() == Some(&'{') {
            // Consume second '{'
            chars.next();

            // Read until '}}'
            let mut path = String::new();
            let mut found_close = false;
            while let Some(inner) = chars.next() {
                if inner == '}' && chars.peek() == Some(&'}') {
                    chars.next(); // consume second '}'
                    found_close = true;
                    break;
                }
                path.push(inner);
            }

            if found_close {
                let path = path.trim();
                let value = context.get(path);
                match value {
                    Some(serde_json::Value::String(s)) => result.push_str(s),
                    Some(serde_json::Value::Number(n)) => result.push_str(&n.to_string()),
                    Some(serde_json::Value::Bool(b)) => result.push_str(&b.to_string()),
                    Some(serde_json::Value::Null) | None => {} // empty string for null/missing
                    Some(other) => {
                        // Arrays and objects: serialize as compact JSON
                        result.push_str(&other.to_string());
                    }
                }
            } else {
                // Unterminated placeholder — emit raw
                result.push_str("{{");
                result.push_str(&path);
            }
        } else {
            result.push(c);
        }
    }

    result
}

/// Expand template placeholders in all string values of a params map.
///
/// Non-string values (bool, number) are passed through unchanged.
/// String values containing `{{...}}` are expanded against the context.
pub fn expand_params(
    params: &HashMap<String, serde_json::Value>,
    context: &FlowContext,
) -> HashMap<String, serde_json::Value> {
    params
        .iter()
        .map(|(k, v)| {
            let expanded = match v {
                serde_json::Value::String(s) => {
                    let expanded_str = expand(s, context);
                    // Try to parse back to number/bool if the template resolved to one
                    if let Ok(n) = expanded_str.parse::<i64>() {
                        serde_json::Value::Number(n.into())
                    } else if let Ok(n) = expanded_str.parse::<f64>() {
                        serde_json::json!(n)
                    } else {
                        serde_json::Value::String(expanded_str)
                    }
                }
                other => other.clone(),
            };
            (k.clone(), expanded)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// Helper: build context with agent and pr data
    fn test_context() -> FlowContext {
        FlowContext::with_accumulated(
            HashMap::from([(
                "agent".to_string(),
                serde_json::json!({
                    "git_branch": "feat/42-auth",
                    "cwd": "/home/user/project",
                    "display_name": "wt-auth-42",
                    "cost_usd": 0.15,
                }),
            )]),
            HashMap::from([(
                "pr".to_string(),
                serde_json::json!({
                    "number": 123,
                    "title": "Add authentication",
                    "branch": "feat/42-auth",
                }),
            )]),
        )
    }

    #[test]
    fn test_simple_expansion() {
        let ctx = test_context();
        let result = expand("PR #{{pr.number}}", &ctx);
        assert_eq!(result, "PR #123");
    }

    #[test]
    fn test_string_expansion() {
        let ctx = test_context();
        let result = expand("Branch: {{agent.git_branch}}", &ctx);
        assert_eq!(result, "Branch: feat/42-auth");
    }

    #[test]
    fn test_multiple_placeholders() {
        let ctx = test_context();
        let result = expand(
            "PR #{{pr.number}} ({{pr.title}}) on {{agent.git_branch}}",
            &ctx,
        );
        assert_eq!(result, "PR #123 (Add authentication) on feat/42-auth");
    }

    #[test]
    fn test_missing_placeholder_empty() {
        let ctx = test_context();
        let result = expand("Value: {{nonexistent}}", &ctx);
        assert_eq!(result, "Value: ");
    }

    #[test]
    fn test_null_placeholder_empty() {
        let mut ctx = test_context();
        ctx.set("nullable".to_string(), serde_json::Value::Null);
        let result = expand("Value: {{nullable}}", &ctx);
        assert_eq!(result, "Value: ");
    }

    #[test]
    fn test_no_placeholders() {
        let ctx = test_context();
        let result = expand("No placeholders here", &ctx);
        assert_eq!(result, "No placeholders here");
    }

    #[test]
    fn test_empty_template() {
        let ctx = test_context();
        let result = expand("", &ctx);
        assert_eq!(result, "");
    }

    #[test]
    fn test_unterminated_placeholder() {
        let ctx = test_context();
        let result = expand("Start {{incomplete", &ctx);
        assert_eq!(result, "Start {{incomplete");
    }

    #[test]
    fn test_whitespace_in_placeholder() {
        let ctx = test_context();
        let result = expand("{{ pr.number }}", &ctx);
        assert_eq!(result, "123");
    }

    #[test]
    fn test_float_expansion() {
        let ctx = test_context();
        let result = expand("Cost: ${{agent.cost_usd}}", &ctx);
        assert_eq!(result, "Cost: $0.15");
    }

    #[test]
    fn test_bool_expansion() {
        let ctx = FlowContext::new(HashMap::from([(
            "flag".to_string(),
            serde_json::json!(true),
        )]));
        let result = expand("Active: {{flag}}", &ctx);
        assert_eq!(result, "Active: true");
    }

    #[test]
    fn test_expand_params_string() {
        let ctx = test_context();
        let params = HashMap::from([(
            "pr_number".to_string(),
            serde_json::Value::String("{{pr.number}}".to_string()),
        )]);

        let expanded = expand_params(&params, &ctx);
        // "123" parsed back to number
        assert_eq!(expanded["pr_number"], serde_json::json!(123));
    }

    #[test]
    fn test_expand_params_passthrough_bool() {
        let ctx = test_context();
        let params = HashMap::from([
            ("delete_worktree".to_string(), serde_json::Value::Bool(true)),
            (
                "method".to_string(),
                serde_json::Value::String("squash".to_string()),
            ),
        ]);

        let expanded = expand_params(&params, &ctx);
        assert_eq!(expanded["delete_worktree"], serde_json::json!(true));
        assert_eq!(expanded["method"], serde_json::json!("squash"));
    }

    #[test]
    fn test_expand_params_mixed() {
        let ctx = test_context();
        let params = HashMap::from([
            (
                "pr_number".to_string(),
                serde_json::Value::String("{{pr.number}}".to_string()),
            ),
            (
                "method".to_string(),
                serde_json::Value::String("squash".to_string()),
            ),
            ("delete_worktree".to_string(), serde_json::Value::Bool(true)),
        ]);

        let expanded = expand_params(&params, &ctx);
        assert_eq!(expanded["pr_number"], serde_json::json!(123));
        assert_eq!(expanded["method"], serde_json::json!("squash"));
        assert_eq!(expanded["delete_worktree"], serde_json::json!(true));
    }

    #[test]
    fn test_adjacent_placeholders() {
        let ctx = test_context();
        let result = expand("{{pr.number}}{{pr.number}}", &ctx);
        assert_eq!(result, "123123");
    }

    #[test]
    fn test_nested_braces_literal() {
        let ctx = test_context();
        // Single braces should pass through
        let result = expand("json: {key: {{pr.number}}}", &ctx);
        assert_eq!(result, "json: {key: 123}");
    }
}
