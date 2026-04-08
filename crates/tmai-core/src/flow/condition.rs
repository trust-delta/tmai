//! Condition evaluator for flow edge `when` expressions.
//!
//! Phase 1 grammar (simple comparisons with AND):
//! ```text
//! expr     = compare ("&&" compare)*
//! compare  = path op value
//! path     = ident ("." ident)*
//! op       = "==" | "!=" | ">" | "<" | ">=" | "<="
//! value    = "null" | "true" | "false" | number | "'" string "'" | path
//! ```
//!
//! Examples:
//! - `pr != null`
//! - `ci.status == 'success'`
//! - `pr != null && ci.status == 'success'`
//! - `pr.review_decision == 'approved' && merge_status.ci_status == 'success'`
//! - `true` (catch-all)

use std::fmt;

use super::types::FlowContext;

/// Evaluate a `when` expression against a flow context.
///
/// Returns `true` if the expression matches, `false` otherwise.
/// Returns an error if the expression cannot be parsed.
pub fn evaluate(expr: &str, context: &FlowContext) -> Result<bool, ConditionError> {
    let tokens = tokenize(expr)?;
    let mut parser = Parser::new(&tokens);
    parser.parse_expr(context)
}

/// Errors from condition parsing or evaluation
#[derive(Debug)]
pub enum ConditionError {
    /// Unexpected token during parsing
    UnexpectedToken { expected: String, found: String },
    /// Unexpected end of input
    UnexpectedEnd { expected: String },
    /// Invalid number literal
    InvalidNumber(String),
    /// Unterminated string literal
    UnterminatedString,
}

impl fmt::Display for ConditionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnexpectedToken { expected, found } => {
                write!(f, "expected {expected}, found '{found}'")
            }
            Self::UnexpectedEnd { expected } => {
                write!(f, "unexpected end of expression, expected {expected}")
            }
            Self::InvalidNumber(s) => write!(f, "invalid number: '{s}'"),
            Self::UnterminatedString => write!(f, "unterminated string literal"),
        }
    }
}

impl std::error::Error for ConditionError {}

// ============================================================
// Tokenizer
// ============================================================

#[derive(Debug, Clone, PartialEq)]
enum Token {
    Ident(String),     // path segment or keyword
    StringLit(String), // 'quoted string'
    NumberLit(f64),    // 123, 0.5
    Eq,                // ==
    Neq,               // !=
    Gt,                // >
    Lt,                // <
    Gte,               // >=
    Lte,               // <=
    And,               // &&
    Dot,               // .
    Null,              // null keyword
    True,              // true keyword
    False,             // false keyword
}

impl fmt::Display for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Token::Ident(s) => write!(f, "{s}"),
            Token::StringLit(s) => write!(f, "'{s}'"),
            Token::NumberLit(n) => write!(f, "{n}"),
            Token::Eq => write!(f, "=="),
            Token::Neq => write!(f, "!="),
            Token::Gt => write!(f, ">"),
            Token::Lt => write!(f, "<"),
            Token::Gte => write!(f, ">="),
            Token::Lte => write!(f, "<="),
            Token::And => write!(f, "&&"),
            Token::Dot => write!(f, "."),
            Token::Null => write!(f, "null"),
            Token::True => write!(f, "true"),
            Token::False => write!(f, "false"),
        }
    }
}

/// Tokenize a condition expression
fn tokenize(input: &str) -> Result<Vec<Token>, ConditionError> {
    let mut tokens = Vec::new();
    let mut chars = input.chars().peekable();

    while let Some(&c) = chars.peek() {
        match c {
            ' ' | '\t' | '\n' | '\r' => {
                chars.next();
            }
            '=' => {
                chars.next();
                if chars.peek() == Some(&'=') {
                    chars.next();
                    tokens.push(Token::Eq);
                } else {
                    return Err(ConditionError::UnexpectedToken {
                        expected: "'=='".to_string(),
                        found: "=".to_string(),
                    });
                }
            }
            '!' => {
                chars.next();
                if chars.peek() == Some(&'=') {
                    chars.next();
                    tokens.push(Token::Neq);
                } else {
                    return Err(ConditionError::UnexpectedToken {
                        expected: "'!='".to_string(),
                        found: "!".to_string(),
                    });
                }
            }
            '>' => {
                chars.next();
                if chars.peek() == Some(&'=') {
                    chars.next();
                    tokens.push(Token::Gte);
                } else {
                    tokens.push(Token::Gt);
                }
            }
            '<' => {
                chars.next();
                if chars.peek() == Some(&'=') {
                    chars.next();
                    tokens.push(Token::Lte);
                } else {
                    tokens.push(Token::Lt);
                }
            }
            '&' => {
                chars.next();
                if chars.peek() == Some(&'&') {
                    chars.next();
                    tokens.push(Token::And);
                } else {
                    return Err(ConditionError::UnexpectedToken {
                        expected: "'&&'".to_string(),
                        found: "&".to_string(),
                    });
                }
            }
            '.' => {
                chars.next();
                tokens.push(Token::Dot);
            }
            '\'' => {
                chars.next(); // consume opening quote
                let mut s = String::new();
                loop {
                    match chars.next() {
                        Some('\'') => break,
                        Some(ch) => s.push(ch),
                        None => return Err(ConditionError::UnterminatedString),
                    }
                }
                tokens.push(Token::StringLit(s));
            }
            c if c.is_ascii_digit() || c == '-' => {
                let mut num_str = String::new();
                // Allow negative sign
                if c == '-' {
                    num_str.push(c);
                    chars.next();
                }
                while let Some(&d) = chars.peek() {
                    if d.is_ascii_digit() || d == '.' {
                        num_str.push(d);
                        chars.next();
                    } else {
                        break;
                    }
                }
                let n: f64 = num_str
                    .parse()
                    .map_err(|_| ConditionError::InvalidNumber(num_str))?;
                tokens.push(Token::NumberLit(n));
            }
            c if c.is_ascii_alphabetic() || c == '_' => {
                let mut ident = String::new();
                while let Some(&ch) = chars.peek() {
                    if ch.is_ascii_alphanumeric() || ch == '_' {
                        ident.push(ch);
                        chars.next();
                    } else {
                        break;
                    }
                }
                // Check keywords
                match ident.as_str() {
                    "null" => tokens.push(Token::Null),
                    "true" => tokens.push(Token::True),
                    "false" => tokens.push(Token::False),
                    _ => tokens.push(Token::Ident(ident)),
                }
            }
            other => {
                return Err(ConditionError::UnexpectedToken {
                    expected: "valid token".to_string(),
                    found: other.to_string(),
                });
            }
        }
    }

    Ok(tokens)
}

// ============================================================
// Parser
// ============================================================

struct Parser<'a> {
    tokens: &'a [Token],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(tokens: &'a [Token]) -> Self {
        Self { tokens, pos: 0 }
    }

    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.pos)
    }

    fn advance(&mut self) -> Option<&Token> {
        let tok = self.tokens.get(self.pos);
        self.pos += 1;
        tok
    }

    /// expr = compare ("&&" compare)*
    fn parse_expr(&mut self, context: &FlowContext) -> Result<bool, ConditionError> {
        let mut result = self.parse_compare(context)?;

        while self.peek() == Some(&Token::And) {
            self.advance(); // consume &&
            let rhs = self.parse_compare(context)?;
            result = result && rhs;
        }

        Ok(result)
    }

    /// compare = value op value
    ///         | "true"
    ///         | "false"
    fn parse_compare(&mut self, context: &FlowContext) -> Result<bool, ConditionError> {
        // Check for bare "true"/"false" as catch-all
        if self.peek() == Some(&Token::True)
            && self
                .tokens
                .get(self.pos + 1)
                .is_none_or(|t| *t == Token::And)
        {
            self.advance();
            return Ok(true);
        }
        if self.peek() == Some(&Token::False)
            && self
                .tokens
                .get(self.pos + 1)
                .is_none_or(|t| *t == Token::And)
        {
            self.advance();
            return Ok(false);
        }

        let lhs = self.parse_value(context)?;

        let op = match self.advance() {
            Some(Token::Eq) => Op::Eq,
            Some(Token::Neq) => Op::Neq,
            Some(Token::Gt) => Op::Gt,
            Some(Token::Lt) => Op::Lt,
            Some(Token::Gte) => Op::Gte,
            Some(Token::Lte) => Op::Lte,
            Some(other) => {
                return Err(ConditionError::UnexpectedToken {
                    expected: "comparison operator".to_string(),
                    found: other.to_string(),
                })
            }
            None => {
                return Err(ConditionError::UnexpectedEnd {
                    expected: "comparison operator".to_string(),
                })
            }
        };

        let rhs = self.parse_value(context)?;

        Ok(compare(&lhs, &op, &rhs))
    }

    /// value = path | "null" | number | string | "true" | "false"
    /// path  = ident ("." ident)*
    fn parse_value(&mut self, context: &FlowContext) -> Result<CondValue, ConditionError> {
        match self.advance() {
            Some(Token::Null) => Ok(CondValue::Null),
            Some(Token::True) => Ok(CondValue::Bool(true)),
            Some(Token::False) => Ok(CondValue::Bool(false)),
            Some(Token::NumberLit(n)) => Ok(CondValue::Number(*n)),
            Some(Token::StringLit(s)) => Ok(CondValue::String(s.clone())),
            Some(Token::Ident(first)) => {
                // Build dot-path: ident.ident.ident...
                let mut path = first.clone();
                while self.peek() == Some(&Token::Dot) {
                    self.advance(); // consume dot
                    match self.advance() {
                        Some(Token::Ident(segment)) => {
                            path.push('.');
                            path.push_str(segment);
                        }
                        Some(other) => {
                            return Err(ConditionError::UnexpectedToken {
                                expected: "identifier after '.'".to_string(),
                                found: other.to_string(),
                            })
                        }
                        None => {
                            return Err(ConditionError::UnexpectedEnd {
                                expected: "identifier after '.'".to_string(),
                            })
                        }
                    }
                }

                // Resolve path against context
                match context.get(&path) {
                    Some(serde_json::Value::Null) => Ok(CondValue::Null),
                    Some(serde_json::Value::String(s)) => Ok(CondValue::String(s.clone())),
                    Some(serde_json::Value::Number(n)) => {
                        Ok(CondValue::Number(n.as_f64().unwrap_or(0.0)))
                    }
                    Some(serde_json::Value::Bool(b)) => Ok(CondValue::Bool(*b)),
                    Some(_) => Ok(CondValue::Other), // array/object — non-null but not comparable
                    None => Ok(CondValue::Null),     // missing = null
                }
            }
            Some(other) => Err(ConditionError::UnexpectedToken {
                expected: "value".to_string(),
                found: other.to_string(),
            }),
            None => Err(ConditionError::UnexpectedEnd {
                expected: "value".to_string(),
            }),
        }
    }
}

// ============================================================
// Value representation and comparison
// ============================================================

#[derive(Debug, Clone, PartialEq)]
enum CondValue {
    Null,
    String(String),
    Number(f64),
    Bool(bool),
    Other, // non-null, non-comparable (array/object)
}

#[derive(Debug)]
enum Op {
    Eq,
    Neq,
    Gt,
    Lt,
    Gte,
    Lte,
}

/// Compare two values with the given operator
fn compare(lhs: &CondValue, op: &Op, rhs: &CondValue) -> bool {
    match op {
        Op::Eq => values_equal(lhs, rhs),
        Op::Neq => !values_equal(lhs, rhs),
        Op::Gt | Op::Lt | Op::Gte | Op::Lte => {
            // Numeric comparison only
            if let (CondValue::Number(l), CondValue::Number(r)) = (lhs, rhs) {
                match op {
                    Op::Gt => l > r,
                    Op::Lt => l < r,
                    Op::Gte => l >= r,
                    Op::Lte => l <= r,
                    _ => unreachable!(),
                }
            } else {
                false // non-numeric comparison → false
            }
        }
    }
}

/// Check equality between two condition values
fn values_equal(lhs: &CondValue, rhs: &CondValue) -> bool {
    match (lhs, rhs) {
        (CondValue::Null, CondValue::Null) => true,
        (CondValue::String(a), CondValue::String(b)) => a == b,
        (CondValue::Number(a), CondValue::Number(b)) => (a - b).abs() < f64::EPSILON,
        (CondValue::Bool(a), CondValue::Bool(b)) => a == b,
        // Other (object/array) is non-null but not equal to anything specific
        (CondValue::Other, CondValue::Null) | (CondValue::Null, CondValue::Other) => false,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// Helper: build context with common test data
    fn test_context() -> FlowContext {
        let mut ctx = FlowContext::new(HashMap::from([(
            "agent".to_string(),
            serde_json::json!({
                "git_branch": "feat/42",
                "cost_usd": 0.15,
            }),
        )]));
        ctx.set(
            "pr".to_string(),
            serde_json::json!({
                "number": 123,
                "branch": "feat/42",
                "review_decision": "approved",
            }),
        );
        ctx.set(
            "ci".to_string(),
            serde_json::json!({
                "status": "success",
            }),
        );
        ctx
    }

    // ---- Basic conditions ----

    #[test]
    fn test_true_literal() {
        let ctx = FlowContext::new(HashMap::new());
        assert!(evaluate("true", &ctx).unwrap());
    }

    #[test]
    fn test_false_literal() {
        let ctx = FlowContext::new(HashMap::new());
        assert!(!evaluate("false", &ctx).unwrap());
    }

    #[test]
    fn test_null_check_not_null() {
        let ctx = test_context();
        assert!(evaluate("pr != null", &ctx).unwrap());
    }

    #[test]
    fn test_null_check_is_null() {
        let ctx = test_context();
        assert!(evaluate("nonexistent == null", &ctx).unwrap());
    }

    #[test]
    fn test_missing_path_is_null() {
        let ctx = test_context();
        assert!(evaluate("missing.deeply.nested == null", &ctx).unwrap());
    }

    // ---- String comparison ----

    #[test]
    fn test_string_equality() {
        let ctx = test_context();
        assert!(evaluate("ci.status == 'success'", &ctx).unwrap());
    }

    #[test]
    fn test_string_inequality() {
        let ctx = test_context();
        assert!(evaluate("ci.status != 'failure'", &ctx).unwrap());
    }

    #[test]
    fn test_string_path_comparison() {
        let ctx = test_context();
        assert!(evaluate("pr.branch == agent.git_branch", &ctx).unwrap());
    }

    // ---- Number comparison ----

    #[test]
    fn test_number_equality() {
        let ctx = test_context();
        assert!(evaluate("pr.number == 123", &ctx).unwrap());
    }

    #[test]
    fn test_number_greater() {
        let ctx = test_context();
        assert!(evaluate("pr.number > 100", &ctx).unwrap());
    }

    #[test]
    fn test_number_less() {
        let ctx = test_context();
        assert!(evaluate("pr.number < 200", &ctx).unwrap());
    }

    #[test]
    fn test_number_gte() {
        let ctx = test_context();
        assert!(evaluate("pr.number >= 123", &ctx).unwrap());
    }

    #[test]
    fn test_number_lte() {
        let ctx = test_context();
        assert!(evaluate("pr.number <= 123", &ctx).unwrap());
    }

    // ---- AND expressions ----

    #[test]
    fn test_and_both_true() {
        let ctx = test_context();
        assert!(evaluate("pr != null && ci.status == 'success'", &ctx).unwrap());
    }

    #[test]
    fn test_and_one_false() {
        let ctx = test_context();
        assert!(!evaluate("pr != null && ci.status == 'failure'", &ctx).unwrap());
    }

    #[test]
    fn test_and_three_conditions() {
        let ctx = test_context();
        assert!(evaluate(
            "pr != null && ci.status == 'success' && pr.review_decision == 'approved'",
            &ctx
        )
        .unwrap());
    }

    // ---- Real-world edge conditions ----

    #[test]
    fn test_implement_to_review_condition() {
        let ctx = test_context();
        assert!(evaluate("pr != null", &ctx).unwrap());
    }

    #[test]
    fn test_review_to_merge_condition() {
        let ctx = test_context();
        assert!(evaluate(
            "pr.review_decision == 'approved' && ci.status == 'success'",
            &ctx
        )
        .unwrap());
    }

    #[test]
    fn test_review_not_approved() {
        let mut ctx = test_context();
        ctx.set(
            "pr".to_string(),
            serde_json::json!({
                "number": 123,
                "review_decision": "changes_requested",
            }),
        );
        assert!(!evaluate(
            "pr.review_decision == 'approved' && ci.status == 'success'",
            &ctx
        )
        .unwrap());
    }

    // ---- Error cases ----

    #[test]
    fn test_invalid_operator() {
        let ctx = FlowContext::new(HashMap::new());
        let result = evaluate("pr = null", &ctx);
        assert!(result.is_err());
    }

    #[test]
    fn test_unterminated_string() {
        let ctx = FlowContext::new(HashMap::new());
        let result = evaluate("ci.status == 'unterminated", &ctx);
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_expression() {
        let ctx = FlowContext::new(HashMap::new());
        let result = evaluate("", &ctx);
        // Empty expression → unexpected end
        assert!(result.is_err());
    }

    // ---- Object/array values ----

    #[test]
    fn test_object_not_null() {
        let mut ctx = FlowContext::new(HashMap::new());
        ctx.set("obj".to_string(), serde_json::json!({"key": "value"}));
        // Accessing root "obj" returns Other (non-null)
        assert!(evaluate("obj != null", &ctx).unwrap());
    }

    #[test]
    fn test_array_not_null() {
        let mut ctx = FlowContext::new(HashMap::new());
        ctx.set("arr".to_string(), serde_json::json!([1, 2, 3]));
        assert!(evaluate("arr != null", &ctx).unwrap());
    }
}
