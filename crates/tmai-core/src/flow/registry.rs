//! Flow registry — validates and holds parsed flow definitions from config.toml.

use std::collections::{HashMap, HashSet};
use std::fmt;

use super::types::{FlowConfig, FlowEdgeConfig, FlowNodeConfig};

/// Validated registry of flow definitions.
///
/// Constructed from `Settings.flow` at startup. Provides lookup by flow name
/// and validation that all node/edge references are consistent.
#[derive(Debug, Clone)]
pub struct FlowRegistry {
    flows: HashMap<String, FlowDefinition>,
}

/// A validated flow definition with indexed node lookup.
#[derive(Debug, Clone)]
pub struct FlowDefinition {
    /// Flow name (key from config)
    pub name: String,
    /// Original config
    pub config: FlowConfig,
    /// Node configs indexed by role name
    pub nodes: HashMap<String, FlowNodeConfig>,
    /// The role of the first node (entry point when flow is kicked)
    pub first_node: String,
}

/// Errors that can occur during flow config validation
#[derive(Debug)]
pub enum FlowConfigError {
    /// No nodes defined in a flow
    EmptyNodes { flow: String },
    /// Duplicate role names within a flow
    DuplicateRole { flow: String, role: String },
    /// Edge references a non-existent source node
    UnknownEdgeSource { flow: String, from: String },
    /// Route references a non-existent target node
    UnknownRouteTarget {
        flow: String,
        edge_from: String,
        target: String,
    },
    /// Edge has no route steps
    EmptyRoutes { flow: String, edge_from: String },
}

impl fmt::Display for FlowConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::EmptyNodes { flow } => {
                write!(f, "flow '{flow}' has no nodes defined")
            }
            Self::DuplicateRole { flow, role } => {
                write!(f, "flow '{flow}' has duplicate role '{role}'")
            }
            Self::UnknownEdgeSource { flow, from } => {
                write!(f, "flow '{flow}': edge references unknown node '{from}'")
            }
            Self::UnknownRouteTarget {
                flow,
                edge_from,
                target,
            } => write!(
                f,
                "flow '{flow}': edge from '{edge_from}' routes to unknown node '{target}'"
            ),
            Self::EmptyRoutes { flow, edge_from } => {
                write!(f, "flow '{flow}': edge from '{edge_from}' has no routes")
            }
        }
    }
}

impl std::error::Error for FlowConfigError {}

impl FlowRegistry {
    /// Build a registry from config.toml flow definitions.
    ///
    /// Validates:
    /// - Each flow has at least one node
    /// - No duplicate role names within a flow
    /// - Edge `from` references an existing node in the same flow
    /// - Route `target` references an existing node in the same flow
    /// - Each edge has at least one route
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
        // Must have at least one node
        if config.nodes.is_empty() {
            return Err(FlowConfigError::EmptyNodes {
                flow: name.to_string(),
            });
        }

        // Build node index and check for duplicates
        let mut nodes = HashMap::new();
        let mut seen_roles = HashSet::new();
        for node in &config.nodes {
            if !seen_roles.insert(&node.role) {
                return Err(FlowConfigError::DuplicateRole {
                    flow: name.to_string(),
                    role: node.role.clone(),
                });
            }
            nodes.insert(node.role.clone(), node.clone());
        }

        // First node is the entry point
        let first_node = config.nodes[0].role.clone();

        // Validate edges
        for edge in &config.edges {
            Self::validate_edge(name, edge, &nodes)?;
        }

        Ok(FlowDefinition {
            name: name.to_string(),
            config: config.clone(),
            nodes,
            first_node,
        })
    }

    /// Validate a single edge within a flow
    fn validate_edge(
        flow_name: &str,
        edge: &FlowEdgeConfig,
        nodes: &HashMap<String, FlowNodeConfig>,
    ) -> Result<(), FlowConfigError> {
        // from must reference an existing node
        if !nodes.contains_key(&edge.from) {
            return Err(FlowConfigError::UnknownEdgeSource {
                flow: flow_name.to_string(),
                from: edge.from.clone(),
            });
        }

        // Must have at least one route
        if edge.route.is_empty() {
            return Err(FlowConfigError::EmptyRoutes {
                flow: flow_name.to_string(),
                edge_from: edge.from.clone(),
            });
        }

        // Route targets must reference existing nodes (if specified)
        for route in &edge.route {
            if let Some(ref target) = route.target {
                if !nodes.contains_key(target) {
                    return Err(FlowConfigError::UnknownRouteTarget {
                        flow: flow_name.to_string(),
                        edge_from: edge.from.clone(),
                        target: target.clone(),
                    });
                }
            }
        }

        Ok(())
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

    /// Helper: build a minimal valid flow config
    fn minimal_flow() -> FlowConfig {
        FlowConfig {
            description: "test".to_string(),
            entry_params: vec![],
            nodes: vec![FlowNodeConfig {
                role: "worker".to_string(),
                mode: NodeMode::Spawn,
                prompt_template: String::new(),
                tools: ToolAccess::default(),
                agent_type: AgentTypeName::default(),
            }],
            edges: vec![FlowEdgeConfig {
                from: "worker".to_string(),
                event: "stop".to_string(),
                resolve: vec![],
                route: vec![RouteStepConfig {
                    condition: "true".to_string(),
                    action: "noop".to_string(),
                    target: None,
                    prompt: None,
                    params: HashMap::new(),
                }],
            }],
        }
    }

    #[test]
    fn test_valid_registry() {
        let mut configs = HashMap::new();
        configs.insert("test".to_string(), minimal_flow());

        let registry = FlowRegistry::from_config(&configs).unwrap();
        assert_eq!(registry.len(), 1);
        assert!(!registry.is_empty());

        let def = registry.get("test").unwrap();
        assert_eq!(def.name, "test");
        assert_eq!(def.first_node, "worker");
        assert!(def.nodes.contains_key("worker"));
    }

    #[test]
    fn test_empty_nodes_rejected() {
        let config = FlowConfig {
            description: String::new(),
            entry_params: vec![],
            nodes: vec![],
            edges: vec![],
        };
        let mut configs = HashMap::new();
        configs.insert("bad".to_string(), config);

        let err = FlowRegistry::from_config(&configs).unwrap_err();
        assert!(matches!(err, FlowConfigError::EmptyNodes { .. }));
    }

    #[test]
    fn test_duplicate_role_rejected() {
        let node = FlowNodeConfig {
            role: "worker".to_string(),
            mode: NodeMode::Spawn,
            prompt_template: String::new(),
            tools: ToolAccess::default(),
            agent_type: AgentTypeName::default(),
        };
        let config = FlowConfig {
            description: String::new(),
            entry_params: vec![],
            nodes: vec![node.clone(), node],
            edges: vec![],
        };
        let mut configs = HashMap::new();
        configs.insert("bad".to_string(), config);

        let err = FlowRegistry::from_config(&configs).unwrap_err();
        assert!(matches!(err, FlowConfigError::DuplicateRole { .. }));
    }

    #[test]
    fn test_unknown_edge_source_rejected() {
        let config = FlowConfig {
            description: String::new(),
            entry_params: vec![],
            nodes: vec![FlowNodeConfig {
                role: "worker".to_string(),
                mode: NodeMode::Spawn,
                prompt_template: String::new(),
                tools: ToolAccess::default(),
                agent_type: AgentTypeName::default(),
            }],
            edges: vec![FlowEdgeConfig {
                from: "nonexistent".to_string(),
                event: "stop".to_string(),
                resolve: vec![],
                route: vec![RouteStepConfig {
                    condition: "true".to_string(),
                    action: "noop".to_string(),
                    target: None,
                    prompt: None,
                    params: HashMap::new(),
                }],
            }],
        };
        let mut configs = HashMap::new();
        configs.insert("bad".to_string(), config);

        let err = FlowRegistry::from_config(&configs).unwrap_err();
        assert!(matches!(err, FlowConfigError::UnknownEdgeSource { .. }));
    }

    #[test]
    fn test_unknown_route_target_rejected() {
        let config = FlowConfig {
            description: String::new(),
            entry_params: vec![],
            nodes: vec![FlowNodeConfig {
                role: "worker".to_string(),
                mode: NodeMode::Spawn,
                prompt_template: String::new(),
                tools: ToolAccess::default(),
                agent_type: AgentTypeName::default(),
            }],
            edges: vec![FlowEdgeConfig {
                from: "worker".to_string(),
                event: "stop".to_string(),
                resolve: vec![],
                route: vec![RouteStepConfig {
                    condition: "true".to_string(),
                    action: "send_prompt".to_string(),
                    target: Some("ghost".to_string()),
                    prompt: Some("hello".to_string()),
                    params: HashMap::new(),
                }],
            }],
        };
        let mut configs = HashMap::new();
        configs.insert("bad".to_string(), config);

        let err = FlowRegistry::from_config(&configs).unwrap_err();
        assert!(matches!(err, FlowConfigError::UnknownRouteTarget { .. }));
    }

    #[test]
    fn test_empty_routes_rejected() {
        let config = FlowConfig {
            description: String::new(),
            entry_params: vec![],
            nodes: vec![FlowNodeConfig {
                role: "worker".to_string(),
                mode: NodeMode::Spawn,
                prompt_template: String::new(),
                tools: ToolAccess::default(),
                agent_type: AgentTypeName::default(),
            }],
            edges: vec![FlowEdgeConfig {
                from: "worker".to_string(),
                event: "stop".to_string(),
                resolve: vec![],
                route: vec![], // empty!
            }],
        };
        let mut configs = HashMap::new();
        configs.insert("bad".to_string(), config);

        let err = FlowRegistry::from_config(&configs).unwrap_err();
        assert!(matches!(err, FlowConfigError::EmptyRoutes { .. }));
    }

    #[test]
    fn test_multi_flow_registry() {
        let mut configs = HashMap::new();
        configs.insert("feature".to_string(), minimal_flow());

        let mut hotfix = minimal_flow();
        hotfix.description = "hotfix".to_string();
        configs.insert("hotfix".to_string(), hotfix);

        let registry = FlowRegistry::from_config(&configs).unwrap();
        assert_eq!(registry.len(), 2);
        assert!(registry.get("feature").is_some());
        assert!(registry.get("hotfix").is_some());
        assert!(registry.get("nonexistent").is_none());
    }

    #[test]
    fn test_multi_node_flow_with_edges() {
        let config = FlowConfig {
            description: "implement → review → merge".to_string(),
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
                            prompt: Some("Review please".to_string()),
                            params: HashMap::new(),
                        },
                        RouteStepConfig {
                            condition: "true".to_string(),
                            action: "send_prompt".to_string(),
                            target: Some("orchestrator".to_string()),
                            prompt: Some("No PR".to_string()),
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
                        prompt: Some("Review done".to_string()),
                        params: HashMap::new(),
                    }],
                },
            ],
        };

        let mut configs = HashMap::new();
        configs.insert("feature".to_string(), config);

        let registry = FlowRegistry::from_config(&configs).unwrap();
        let def = registry.get("feature").unwrap();
        assert_eq!(def.first_node, "implement");
        assert_eq!(def.nodes.len(), 3);
    }

    #[test]
    fn test_list_flows() {
        let mut configs = HashMap::new();
        configs.insert("a".to_string(), minimal_flow());
        configs.insert("b".to_string(), minimal_flow());

        let registry = FlowRegistry::from_config(&configs).unwrap();
        let list = registry.list();
        assert_eq!(list.len(), 2);
    }
}
