//! Flow-aware orchestrator prompt composer (v2).
//!
//! Generates prompt sections showing:
//! - Available flows with agent/gate topology
//! - In-flight flow run status

use std::collections::HashMap;

use super::registry::{FlowDefinition, FlowRegistry};
use super::types::FlowRun;
use crate::config::OrchestratorSettings;

/// Compose a flow-aware orchestrator prompt.
pub fn compose_flow_aware_prompt(
    registry: &FlowRegistry,
    active_runs: &HashMap<String, FlowRun>,
    orch_settings: &OrchestratorSettings,
) -> String {
    let mut parts: Vec<String> = Vec::new();

    parts.push(orch_settings.role.clone());

    // Workflow rules
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

    // Flow topology
    if !registry.is_empty() {
        parts.push(format_flow_topology(registry));
    }

    // In-flight flows
    let running: Vec<&FlowRun> = active_runs.values().filter(|r| r.is_running()).collect();
    if !running.is_empty() {
        parts.push(format_in_flight_runs(&running));
    }

    parts.push(
        "\nUse tmai MCP tools to manage agents. Use `run_flow` to start a named flow, \
         or `list_agents`, `spawn_worktree`, `dispatch_issue`, `send_prompt`, `approve` for direct control."
            .to_string(),
    );

    parts.join("\n")
}

/// Format the flow topology section
fn format_flow_topology(registry: &FlowRegistry) -> String {
    let mut lines = vec!["\n## Available Flows".to_string()];

    let mut flows: Vec<&FlowDefinition> = registry.list();
    flows.sort_by_key(|f| &f.name);

    for flow in flows {
        let config = &flow.config;
        let entry_params = if config.entry_params.is_empty() {
            String::new()
        } else {
            format!(" (entry: {})", config.entry_params.join(", "))
        };
        lines.push(format!(
            "\n### {}: {}{}",
            flow.name, config.description, entry_params
        ));

        // Agents
        lines.push("  Agents:".to_string());
        for agent in &config.agents {
            lines.push(format!("    {} ({})", agent.id, agent.agent_type_str()));
        }

        // Gates
        if !config.gates.is_empty() {
            lines.push("  Gates:".to_string());
            for gate in &config.gates {
                let else_str = if gate.else_action.is_some() {
                    " / else"
                } else {
                    ""
                };
                lines.push(format!(
                    "    {} — when {} → {:?}{}",
                    gate.id, gate.condition, gate.then_action.action, else_str
                ));
            }
        }
    }

    lines.join("\n")
}

/// Format the in-flight runs section
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

        for step in &run.history {
            let outcome_mark = match &step.outcome {
                super::types::StepOutcome::Completed => "✓",
                super::types::StepOutcome::Error(_) => "✗",
            };
            lines.push(format!("   {outcome_mark} {}", step.node));
        }

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
                description: "Feature flow".to_string(),
                entry_params: vec!["issue_number".to_string()],
                entry_node: "impl".to_string(),
                agents: vec![
                    AgentNodeConfig {
                        id: "impl".to_string(),
                        agent_type: AgentTypeName::default(),
                        mode: None,
                        prompt_template: String::new(),
                        tools: ToolAccess::default(),
                    },
                    AgentNodeConfig {
                        id: "orch".to_string(),
                        agent_type: AgentTypeName::default(),
                        mode: None,
                        prompt_template: String::new(),
                        tools: ToolAccess::All(AllTools("*".to_string())),
                    },
                ],
                gates: vec![GateNodeConfig {
                    id: "check_pr".to_string(),
                    resolve: None,
                    condition: "pr != null".to_string(),
                    then_action: GateAction {
                        action: ActionType::SpawnAgent,
                        target: Some("review".to_string()),
                        prompt: None,
                        params: HashMap::new(),
                    },
                    else_action: Some(GateAction {
                        action: ActionType::SendMessage,
                        target: Some("orch".to_string()),
                        prompt: None,
                        params: HashMap::new(),
                    }),
                }],
                wires: vec![Wire {
                    from: PortRef {
                        node: "impl".to_string(),
                        port: PortType::Stop,
                    },
                    to: PortRef {
                        node: "check_pr".to_string(),
                        port: PortType::Input,
                    },
                }],
            },
        );
        FlowRegistry::from_config(&configs).unwrap()
    }

    #[test]
    fn test_prompt_with_topology() {
        let registry = test_registry();
        let settings = OrchestratorSettings::default();
        let runs = HashMap::new();

        let prompt = compose_flow_aware_prompt(&registry, &runs, &settings);
        assert!(prompt.contains("Available Flows"));
        assert!(prompt.contains("feature"));
        assert!(prompt.contains("impl (claude)"));
        assert!(prompt.contains("check_pr"));
        assert!(prompt.contains("run_flow"));
    }

    #[test]
    fn test_prompt_no_flows() {
        let registry = FlowRegistry::from_config(&HashMap::new()).unwrap();
        let settings = OrchestratorSettings::default();
        let runs = HashMap::new();

        let prompt = compose_flow_aware_prompt(&registry, &runs, &settings);
        assert!(!prompt.contains("Available Flows"));
    }
}
