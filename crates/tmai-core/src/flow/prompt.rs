//! Flow-aware orchestrator prompt composer.
//!
//! Extends the orchestrator's system prompt with:
//! - **Static**: flow topology (available flows, their nodes and edge routing)
//! - **Dynamic**: in-flight FlowRun status (current node, history, costs)

use std::collections::HashMap;

use super::registry::{FlowDefinition, FlowRegistry};
use super::types::{FlowRun, NodeMode};
use crate::config::OrchestratorSettings;

/// Compose a flow-aware orchestrator prompt.
///
/// Includes role + rules (from OrchestratorSettings) + flow topology + in-flight runs + MCP tools.
pub fn compose_flow_aware_prompt(
    registry: &FlowRegistry,
    active_runs: &HashMap<String, FlowRun>,
    orch_settings: &OrchestratorSettings,
) -> String {
    let mut parts: Vec<String> = Vec::new();

    // Role
    parts.push(orch_settings.role.clone());

    // Workflow rules (from legacy orchestrator settings)
    let rules = &orch_settings.rules;
    let mut rule_lines: Vec<String> = Vec::new();
    if !rules.branch.is_empty() {
        rule_lines.push(format!("- Branch: {}", rules.branch));
    }
    if !rules.merge.is_empty() {
        rule_lines.push(format!("- Merge: {}", rules.merge));
    }
    if !rules.review.is_empty() {
        rule_lines.push(format!("- Review: {}", rules.review));
    }
    if !rules.custom.is_empty() {
        rule_lines.push(format!("- {}", rules.custom));
    }
    if !rule_lines.is_empty() {
        parts.push(format!("\n## Workflow Rules\n{}", rule_lines.join("\n")));
    }

    // Flow topology (static)
    if !registry.is_empty() {
        parts.push(format_flow_topology(registry));
    }

    // In-flight flows (dynamic)
    let running: Vec<&FlowRun> = active_runs.values().filter(|r| r.is_running()).collect();
    if !running.is_empty() {
        parts.push(format_in_flight_runs(&running));
    }

    // MCP tools instruction
    parts.push(
        "\nUse tmai MCP tools to manage agents. Use `run_flow` to start a named flow, \
         or `list_agents`, `spawn_worktree`, `dispatch_issue`, `send_prompt`, `approve` for direct control."
            .to_string(),
    );

    parts.join("\n")
}

/// Format the static flow topology section
fn format_flow_topology(registry: &FlowRegistry) -> String {
    let mut lines = vec!["\n## Available Flows".to_string()];

    let mut flows: Vec<&FlowDefinition> = registry.list();
    flows.sort_by_key(|f| &f.name);

    for flow in flows {
        let config = &flow.config;

        // Flow header
        let node_chain: Vec<&str> = config.nodes.iter().map(|n| n.role.as_str()).collect();
        let entry_params = if config.entry_params.is_empty() {
            String::new()
        } else {
            format!(" (entry: {})", config.entry_params.join(", "))
        };
        lines.push(format!(
            "\n### {}: {}{}\n  Chain: {}",
            flow.name,
            config.description,
            entry_params,
            node_chain.join(" → "),
        ));

        // Node modes
        for node in &config.nodes {
            let mode_label = match node.mode {
                NodeMode::Spawn => "spawn",
                NodeMode::Persistent => "persistent",
            };
            lines.push(format!("  - {} ({})", node.role, mode_label));
        }

        // Edge routing summary
        for edge in &config.edges {
            lines.push(format!("  Routing from {} stop:", edge.from));
            for route in &edge.route {
                let target_str = route
                    .target
                    .as_deref()
                    .map(|t| format!(" → {t}"))
                    .unwrap_or_default();
                lines.push(format!(
                    "    when {}: {}{}",
                    route.condition, route.action, target_str
                ));
            }
        }
    }

    lines.join("\n")
}

/// Format the dynamic in-flight runs section
fn format_in_flight_runs(runs: &[&FlowRun]) -> String {
    let mut lines = vec!["\n## In-flight Flows".to_string()];

    for (i, run) in runs.iter().enumerate() {
        lines.push(format!(
            "\n{}. [{}] {} — {}",
            i + 1,
            run.run_id,
            run.flow_name,
            run.trigger,
        ));

        // History (completed steps)
        for step in &run.history {
            let duration = step
                .finished_at
                .map(|end| {
                    let dur = end - step.started_at;
                    format!("{}s", dur.num_seconds())
                })
                .unwrap_or_default();
            let outcome_mark = match &step.outcome {
                super::types::StepOutcome::Completed => "✓",
                super::types::StepOutcome::Error(_) => "✗",
            };
            lines.push(format!(
                "   {outcome_mark} {} (agent: {}, {duration})",
                step.node, step.agent_id,
            ));
        }

        // Current node
        let current_agent = run.current_agent_id.as_deref().unwrap_or("pending");
        lines.push(format!(
            "   ● {} (agent: {}, running)",
            run.current_node, current_agent,
        ));
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::OrchestratorSettings;
    use crate::flow::types::*;

    fn test_registry() -> FlowRegistry {
        let mut configs = HashMap::new();
        configs.insert(
            "feature".to_string(),
            FlowConfig {
                description: "Issue実装 → レビュー → マージ".to_string(),
                entry_params: vec!["issue_number".to_string()],
                nodes: vec![
                    FlowNodeConfig {
                        role: "implement".to_string(),
                        mode: NodeMode::Spawn,
                        prompt_template: String::new(),
                        tools: ToolAccess::default(),
                        agent_type: AgentTypeName::default(),
                    },
                    FlowNodeConfig {
                        role: "review".to_string(),
                        mode: NodeMode::Spawn,
                        prompt_template: String::new(),
                        tools: ToolAccess::default(),
                        agent_type: AgentTypeName::default(),
                    },
                    FlowNodeConfig {
                        role: "orchestrator".to_string(),
                        mode: NodeMode::Persistent,
                        prompt_template: String::new(),
                        tools: ToolAccess::All(AllTools("*".to_string())),
                        agent_type: AgentTypeName::default(),
                    },
                ],
                edges: vec![
                    FlowEdgeConfig {
                        from: "implement".to_string(),
                        event: "stop".to_string(),
                        resolve: vec![],
                        route: vec![
                            RouteStepConfig {
                                condition: "pr != null".to_string(),
                                action: "spawn".to_string(),
                                target: Some("review".to_string()),
                                prompt: None,
                                params: HashMap::new(),
                            },
                            RouteStepConfig {
                                condition: "true".to_string(),
                                action: "send_prompt".to_string(),
                                target: Some("orchestrator".to_string()),
                                prompt: None,
                                params: HashMap::new(),
                            },
                        ],
                    },
                    FlowEdgeConfig {
                        from: "review".to_string(),
                        event: "stop".to_string(),
                        resolve: vec![],
                        route: vec![RouteStepConfig {
                            condition: "true".to_string(),
                            action: "send_prompt".to_string(),
                            target: Some("orchestrator".to_string()),
                            prompt: None,
                            params: HashMap::new(),
                        }],
                    },
                ],
            },
        );
        FlowRegistry::from_config(&configs).unwrap()
    }

    #[test]
    fn test_prompt_with_no_flows() {
        let registry = FlowRegistry::from_config(&HashMap::new()).unwrap();
        let settings = OrchestratorSettings::default();
        let runs = HashMap::new();

        let prompt = compose_flow_aware_prompt(&registry, &runs, &settings);
        assert!(prompt.contains("orchestrator agent"));
        assert!(prompt.contains("run_flow"));
        assert!(!prompt.contains("Available Flows"));
        assert!(!prompt.contains("In-flight"));
    }

    #[test]
    fn test_prompt_with_flow_topology() {
        let registry = test_registry();
        let settings = OrchestratorSettings::default();
        let runs = HashMap::new();

        let prompt = compose_flow_aware_prompt(&registry, &runs, &settings);

        // Should contain flow topology
        assert!(prompt.contains("Available Flows"));
        assert!(prompt.contains("feature"));
        assert!(prompt.contains("implement → review → orchestrator"));
        assert!(prompt.contains("entry: issue_number"));

        // Should contain edge routing
        assert!(prompt.contains("Routing from implement stop:"));
        assert!(prompt.contains("when pr != null: spawn → review"));
        assert!(prompt.contains("when true: send_prompt → orchestrator"));

        // Should not contain in-flight (no runs)
        assert!(!prompt.contains("In-flight"));
    }

    #[test]
    fn test_prompt_with_in_flight_runs() {
        let registry = test_registry();
        let settings = OrchestratorSettings::default();

        let mut run = FlowRun::new(
            "run-abc".to_string(),
            "feature".to_string(),
            "issue #42".to_string(),
            "implement".to_string(),
        );
        run.advance(
            "agent-impl-1".to_string(),
            "review".to_string(),
            HashMap::new(),
        );
        run.current_agent_id = Some("agent-review-1".to_string());

        let mut runs = HashMap::new();
        runs.insert("run-abc".to_string(), run);

        let prompt = compose_flow_aware_prompt(&registry, &runs, &settings);

        assert!(prompt.contains("In-flight Flows"));
        assert!(prompt.contains("run-abc"));
        assert!(prompt.contains("feature"));
        assert!(prompt.contains("issue #42"));
        assert!(prompt.contains("✓ implement"));
        assert!(prompt.contains("● review"));
        assert!(prompt.contains("agent-review-1"));
    }

    #[test]
    fn test_prompt_with_rules() {
        let registry = test_registry();
        let mut settings = OrchestratorSettings::default();
        settings.rules.branch = "feat/{issue_number}-{slug}".to_string();
        settings.rules.merge = "squash merge, delete branch".to_string();
        let runs = HashMap::new();

        let prompt = compose_flow_aware_prompt(&registry, &runs, &settings);

        assert!(prompt.contains("Workflow Rules"));
        assert!(prompt.contains("Branch: feat/{issue_number}-{slug}"));
        assert!(prompt.contains("Merge: squash merge, delete branch"));
    }

    #[test]
    fn test_prompt_completed_runs_excluded() {
        let registry = test_registry();
        let settings = OrchestratorSettings::default();

        let mut run = FlowRun::new(
            "run-done".to_string(),
            "feature".to_string(),
            "issue #99".to_string(),
            "implement".to_string(),
        );
        run.complete("agent-1".to_string(), HashMap::new());

        let mut runs = HashMap::new();
        runs.insert("run-done".to_string(), run);

        let prompt = compose_flow_aware_prompt(&registry, &runs, &settings);

        // Completed runs should not appear in "In-flight"
        assert!(!prompt.contains("In-flight"));
        assert!(!prompt.contains("run-done"));
    }
}
