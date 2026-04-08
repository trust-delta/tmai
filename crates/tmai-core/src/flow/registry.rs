//! Flow registry — validates and holds parsed flow definitions from config.toml (v2).

use std::collections::{HashMap, HashSet};
use std::fmt;

use super::types::{FlowConfig, GateNodeConfig, PortType, Wire};

/// Validated registry of flow definitions.
#[derive(Debug, Clone)]
pub struct FlowRegistry {
    flows: HashMap<String, FlowDefinition>,
}

/// A validated flow definition with indexed lookups.
#[derive(Debug, Clone)]
pub struct FlowDefinition {
    pub name: String,
    pub config: FlowConfig,
    /// All node IDs (agents + gates)
    pub node_ids: HashSet<String>,
    /// Gate configs indexed by ID
    pub gates: HashMap<String, GateNodeConfig>,
    /// Wires indexed by source (node, port) → wire
    pub wires_from: HashMap<(String, PortType), Wire>,
}

/// Errors during flow config validation
#[derive(Debug)]
pub enum FlowConfigError {
    EmptyAgents { flow: String },
    DuplicateNodeId { flow: String, id: String },
    UnknownEntryNode { flow: String, entry: String },
    WireUnknownNode { flow: String, node: String },
    WirePortMismatch { flow: String, detail: String },
    GateNoThenAction { flow: String, gate: String },
}

impl fmt::Display for FlowConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyAgents { flow } => write!(f, "flow '{flow}' has no agent nodes"),
            Self::DuplicateNodeId { flow, id } => {
                write!(f, "flow '{flow}' has duplicate node ID '{id}'")
            }
            Self::UnknownEntryNode { flow, entry } => {
                write!(f, "flow '{flow}': entry_node '{entry}' not found in agents")
            }
            Self::WireUnknownNode { flow, node } => {
                write!(f, "flow '{flow}': wire references unknown node '{node}'")
            }
            Self::WirePortMismatch { flow, detail } => {
                write!(f, "flow '{flow}': invalid wire — {detail}")
            }
            Self::GateNoThenAction { flow, gate } => {
                write!(f, "flow '{flow}': gate '{gate}' has no then_action")
            }
        }
    }
}

impl std::error::Error for FlowConfigError {}

impl FlowRegistry {
    /// Build a registry from config.toml flow definitions.
    pub fn from_config(configs: &HashMap<String, FlowConfig>) -> Result<Self, FlowConfigError> {
        let mut flows = HashMap::new();
        for (name, config) in configs {
            let definition = Self::validate_flow(name, config)?;
            flows.insert(name.clone(), definition);
        }
        Ok(Self { flows })
    }

    /// Validate a single flow definition
    fn validate_flow(name: &str, config: &FlowConfig) -> Result<FlowDefinition, FlowConfigError> {
        // Must have at least one agent
        if config.agents.is_empty() {
            return Err(FlowConfigError::EmptyAgents {
                flow: name.to_string(),
            });
        }

        // Collect all node IDs, check for duplicates
        let mut node_ids = HashSet::new();
        let mut agent_ids = HashSet::new();
        let mut gate_map = HashMap::new();

        for agent in &config.agents {
            if !node_ids.insert(agent.id.clone()) {
                return Err(FlowConfigError::DuplicateNodeId {
                    flow: name.to_string(),
                    id: agent.id.clone(),
                });
            }
            agent_ids.insert(agent.id.clone());
        }
        for gate in &config.gates {
            if !node_ids.insert(gate.id.clone()) {
                return Err(FlowConfigError::DuplicateNodeId {
                    flow: name.to_string(),
                    id: gate.id.clone(),
                });
            }
            gate_map.insert(gate.id.clone(), gate.clone());
        }

        // entry_node must be an agent
        if !config.entry_node.is_empty() && !agent_ids.contains(&config.entry_node) {
            return Err(FlowConfigError::UnknownEntryNode {
                flow: name.to_string(),
                entry: config.entry_node.clone(),
            });
        }

        // Validate wires
        let mut wires_from = HashMap::new();
        for wire in &config.wires {
            // Both nodes must exist
            if !node_ids.contains(&wire.from.node) {
                return Err(FlowConfigError::WireUnknownNode {
                    flow: name.to_string(),
                    node: wire.from.node.clone(),
                });
            }
            if !node_ids.contains(&wire.to.node) {
                return Err(FlowConfigError::WireUnknownNode {
                    flow: name.to_string(),
                    node: wire.to.node.clone(),
                });
            }

            // from port must be output, to port must be input
            if !wire.from.port.is_output() {
                return Err(FlowConfigError::WirePortMismatch {
                    flow: name.to_string(),
                    detail: format!(
                        "{}.{:?} is not an output port",
                        wire.from.node, wire.from.port
                    ),
                });
            }
            if !wire.to.port.is_input() {
                return Err(FlowConfigError::WirePortMismatch {
                    flow: name.to_string(),
                    detail: format!("{}.{:?} is not an input port", wire.to.node, wire.to.port),
                });
            }

            // Agent output (stop/error) must connect to gate input
            if agent_ids.contains(&wire.from.node)
                && !gate_map.contains_key(&wire.to.node)
                && wire.to.port == PortType::Input
            {
                return Err(FlowConfigError::WirePortMismatch {
                    flow: name.to_string(),
                    detail: format!(
                        "agent {}.{:?} must connect to a gate input",
                        wire.from.node, wire.from.port
                    ),
                });
            }

            wires_from.insert(
                (wire.from.node.clone(), wire.from.port.clone()),
                wire.clone(),
            );
        }

        Ok(FlowDefinition {
            name: name.to_string(),
            config: config.clone(),
            node_ids,
            gates: gate_map,
            wires_from,
        })
    }

    /// Look up a flow by name
    pub fn get(&self, name: &str) -> Option<&FlowDefinition> {
        self.flows.get(name)
    }

    /// List all registered flows
    pub fn list(&self) -> Vec<&FlowDefinition> {
        self.flows.values().collect()
    }

    /// Check if any flows are registered
    pub fn is_empty(&self) -> bool {
        self.flows.is_empty()
    }

    /// Number of registered flows
    pub fn len(&self) -> usize {
        self.flows.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flow::types::*;

    /// Helper: minimal valid v2 flow config
    fn minimal_flow() -> FlowConfig {
        FlowConfig {
            description: "test".to_string(),
            entry_params: vec![],
            entry_node: "worker".to_string(),
            agents: vec![AgentNodeConfig {
                id: "worker".to_string(),
                agent_type: AgentTypeName::default(),
                mode: NodeMode::Spawn,
                prompt_template: String::new(),
                tools: ToolAccess::default(),
            }],
            gates: vec![GateNodeConfig {
                id: "gate1".to_string(),
                resolve: None,
                condition: "true".to_string(),
                then_action: GateAction {
                    action: ActionType::Noop,
                    target: None,
                    prompt: None,
                    params: HashMap::new(),
                },
                else_action: None,
            }],
            wires: vec![Wire {
                from: PortRef {
                    node: "worker".to_string(),
                    port: PortType::Stop,
                },
                to: PortRef {
                    node: "gate1".to_string(),
                    port: PortType::Input,
                },
            }],
        }
    }

    #[test]
    fn test_valid_registry() {
        let mut configs = HashMap::new();
        configs.insert("test".to_string(), minimal_flow());

        let registry = FlowRegistry::from_config(&configs).unwrap();
        assert_eq!(registry.len(), 1);
        assert!(registry.get("test").is_some());
    }

    #[test]
    fn test_duplicate_node_id_rejected() {
        let mut flow = minimal_flow();
        flow.agents.push(AgentNodeConfig {
            id: "worker".to_string(), // duplicate
            ..flow.agents[0].clone()
        });

        let mut configs = HashMap::new();
        configs.insert("bad".to_string(), flow);
        assert!(matches!(
            FlowRegistry::from_config(&configs),
            Err(FlowConfigError::DuplicateNodeId { .. })
        ));
    }

    #[test]
    fn test_unknown_entry_node_rejected() {
        let mut flow = minimal_flow();
        flow.entry_node = "nonexistent".to_string();

        let mut configs = HashMap::new();
        configs.insert("bad".to_string(), flow);
        assert!(matches!(
            FlowRegistry::from_config(&configs),
            Err(FlowConfigError::UnknownEntryNode { .. })
        ));
    }

    #[test]
    fn test_wire_unknown_node_rejected() {
        let mut flow = minimal_flow();
        flow.wires.push(Wire {
            from: PortRef {
                node: "ghost".to_string(),
                port: PortType::Stop,
            },
            to: PortRef {
                node: "gate1".to_string(),
                port: PortType::Input,
            },
        });

        let mut configs = HashMap::new();
        configs.insert("bad".to_string(), flow);
        assert!(matches!(
            FlowRegistry::from_config(&configs),
            Err(FlowConfigError::WireUnknownNode { .. })
        ));
    }

    #[test]
    fn test_wire_port_direction_rejected() {
        let mut flow = minimal_flow();
        flow.wires[0] = Wire {
            from: PortRef {
                node: "worker".to_string(),
                port: PortType::Initial, // input port as source — invalid
            },
            to: PortRef {
                node: "gate1".to_string(),
                port: PortType::Input,
            },
        };

        let mut configs = HashMap::new();
        configs.insert("bad".to_string(), flow);
        assert!(matches!(
            FlowRegistry::from_config(&configs),
            Err(FlowConfigError::WirePortMismatch { .. })
        ));
    }
}
