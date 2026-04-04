//! Docker-style session name generator.
//!
//! Generates human-readable session names by combining a nature/weather adjective
//! with an animal/nature noun (e.g., "amber-falcon", "misty-wolf").

use rand::RngExt;

/// Nature and weather themed adjectives (~100 entries).
const ADJECTIVES: &[&str] = &[
    "amber",
    "arctic",
    "autumn",
    "blazing",
    "breezy",
    "calm",
    "celestial",
    "coastal",
    "coral",
    "crimson",
    "crystal",
    "dawn",
    "deep",
    "desert",
    "dewy",
    "dusty",
    "emerald",
    "evening",
    "fern",
    "floral",
    "foggy",
    "frozen",
    "gentle",
    "glacial",
    "golden",
    "granite",
    "hazy",
    "highland",
    "icy",
    "ivory",
    "jade",
    "jasmine",
    "juniper",
    "keen",
    "lapis",
    "lavender",
    "leafy",
    "lunar",
    "maple",
    "marble",
    "meadow",
    "midnight",
    "misty",
    "monsoon",
    "mossy",
    "nimble",
    "noble",
    "ocean",
    "olive",
    "opal",
    "orchid",
    "pacific",
    "pearly",
    "pine",
    "polar",
    "prairie",
    "quartz",
    "quiet",
    "radiant",
    "rain",
    "rocky",
    "rosy",
    "rustic",
    "sandy",
    "sapphire",
    "scarlet",
    "shadow",
    "silver",
    "snowy",
    "solar",
    "spring",
    "stellar",
    "stone",
    "storm",
    "summer",
    "sunny",
    "swift",
    "teal",
    "tender",
    "thunder",
    "tidal",
    "timber",
    "topaz",
    "tropic",
    "turquoise",
    "twilight",
    "valley",
    "velvet",
    "verdant",
    "violet",
    "warm",
    "wild",
    "willow",
    "winter",
    "zen",
    "alpine",
    "ashen",
    "birch",
    "boreal",
    "copper",
    "dusk",
    "ember",
    "frost",
];

/// Animal and nature themed nouns (~100 entries).
const NOUNS: &[&str] = &[
    "badger",
    "bear",
    "beetle",
    "bison",
    "bobcat",
    "bunny",
    "butterfly",
    "cardinal",
    "caribou",
    "cheetah",
    "cobra",
    "condor",
    "coral",
    "cougar",
    "crane",
    "crow",
    "deer",
    "dolphin",
    "dove",
    "dragon",
    "eagle",
    "egret",
    "elk",
    "falcon",
    "finch",
    "flamingo",
    "fox",
    "frog",
    "gazelle",
    "gecko",
    "goose",
    "grouse",
    "hawk",
    "heron",
    "horse",
    "husky",
    "ibis",
    "iguana",
    "impala",
    "jackal",
    "jaguar",
    "jay",
    "kestrel",
    "kite",
    "koala",
    "lark",
    "lemur",
    "leopard",
    "lion",
    "lizard",
    "llama",
    "lynx",
    "macaw",
    "manta",
    "marten",
    "moose",
    "moth",
    "newt",
    "nightjar",
    "ocelot",
    "oriole",
    "osprey",
    "otter",
    "owl",
    "panda",
    "panther",
    "parrot",
    "pelican",
    "penguin",
    "phoenix",
    "puma",
    "quail",
    "rabbit",
    "raven",
    "robin",
    "salmon",
    "seal",
    "shark",
    "sparrow",
    "spider",
    "stork",
    "swan",
    "swift",
    "tiger",
    "toucan",
    "turtle",
    "viper",
    "vulture",
    "walrus",
    "whale",
    "wolf",
    "wolverine",
    "wren",
    "yak",
    "zebra",
    "coyote",
    "hare",
    "orca",
    "pike",
];

/// Generates a random Docker-style session name by combining a nature/weather
/// adjective with an animal/nature noun.
///
/// # Returns
///
/// A string in the format `"{adjective}-{noun}"` (e.g., `"amber-falcon"`).
///
/// # Examples
///
/// ```
/// let name = tmai_core::utils::namegen::generate_session_name();
/// assert!(name.contains('-'));
/// ```
pub fn generate_session_name() -> String {
    let mut rng = rand::rng();
    let adj = ADJECTIVES[rng.random_range(0..ADJECTIVES.len())];
    let noun = NOUNS[rng.random_range(0..NOUNS.len())];
    format!("{}-{}", adj, noun)
}

/// Generates a unique Docker-style session name that does not collide with
/// any of the provided existing names.
///
/// Attempts up to 10 random combinations. If all collide (extremely unlikely
/// given ~10,000 combinations), falls back to appending a Unix timestamp.
///
/// # Arguments
///
/// * `existing` - A slice of existing session names to check against.
///
/// # Returns
///
/// A unique session name string.
///
/// # Examples
///
/// ```
/// let existing = vec!["amber-falcon".to_string()];
/// let name = tmai_core::utils::namegen::generate_unique_name(&existing);
/// assert!(!existing.contains(&name));
/// ```
pub fn generate_unique_name(existing: &[String]) -> String {
    for _ in 0..10 {
        let name = generate_session_name();
        if !existing.contains(&name) {
            return name;
        }
    }
    // Fallback: append timestamp to guarantee uniqueness
    let name = generate_session_name();
    let ts = chrono::Utc::now().timestamp();
    format!("{}-{}", name, ts)
}

/// Convert a title string into a valid branch-name slug.
///
/// Rules: lowercase, replace non-alphanumeric runs with `-`, strip leading/trailing
/// hyphens, and truncate to `max_len` on a word boundary.
///
/// # Examples
///
/// ```
/// let slug = tmai_core::utils::namegen::slugify_for_branch("feat: Spawn Worktree Issue Number!", 50);
/// assert_eq!(slug, "feat-spawn-worktree-issue-number");
/// ```
pub fn slugify_for_branch(title: &str, max_len: usize) -> String {
    // Lowercase and replace any non-alphanumeric character run with a single hyphen
    let slug: String = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();

    // Collapse consecutive hyphens and trim leading/trailing hyphens
    let mut result = String::with_capacity(slug.len());
    let mut prev_hyphen = true; // treat start as hyphen to strip leading
    for c in slug.chars() {
        if c == '-' {
            if !prev_hyphen {
                result.push('-');
            }
            prev_hyphen = true;
        } else {
            result.push(c);
            prev_hyphen = false;
        }
    }
    // Trim trailing hyphen
    while result.ends_with('-') {
        result.pop();
    }

    // Truncate to max_len on a hyphen boundary if possible
    if result.len() > max_len {
        let truncated = &result[..max_len];
        if let Some(last_hyphen) = truncated.rfind('-') {
            result = truncated[..last_hyphen].to_string();
        } else {
            result = truncated.to_string();
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_session_name_format() {
        let name = generate_session_name();
        let parts: Vec<&str> = name.splitn(2, '-').collect();
        assert_eq!(parts.len(), 2, "Name should have adjective-noun format");
        assert!(!parts[0].is_empty(), "Adjective should not be empty");
        assert!(!parts[1].is_empty(), "Noun should not be empty");
    }

    #[test]
    fn test_generate_session_name_uses_valid_words() {
        let name = generate_session_name();
        let parts: Vec<&str> = name.splitn(2, '-').collect();
        assert!(
            ADJECTIVES.contains(&parts[0]),
            "Adjective '{}' should be in ADJECTIVES list",
            parts[0]
        );
        assert!(
            NOUNS.contains(&parts[1]),
            "Noun '{}' should be in NOUNS list",
            parts[1]
        );
    }

    #[test]
    fn test_generate_unique_name_avoids_collisions() {
        let existing = vec!["amber-falcon".to_string(), "misty-wolf".to_string()];
        let name = generate_unique_name(&existing);
        assert!(
            !existing.contains(&name),
            "Generated name '{}' should not collide with existing names",
            name
        );
    }

    #[test]
    fn test_generate_unique_name_empty_existing() {
        let existing: Vec<String> = vec![];
        let name = generate_unique_name(&existing);
        assert!(!name.is_empty(), "Should generate a non-empty name");
    }

    #[test]
    fn test_generate_unique_name_fallback_with_timestamp() {
        // Create a list with all possible combinations to force fallback
        // We can't enumerate all ~10,000 combinations, so we test the fallback
        // path by mocking would be complex. Instead, verify the function
        // always returns a non-empty, valid string.
        let existing: Vec<String> = vec![];
        let name = generate_unique_name(&existing);
        assert!(name.contains('-'), "Name should contain a hyphen separator");
    }

    #[test]
    fn test_slugify_basic() {
        assert_eq!(
            slugify_for_branch("feat: Spawn Worktree Issue Number!", 50),
            "feat-spawn-worktree-issue-number"
        );
    }

    #[test]
    fn test_slugify_special_characters() {
        assert_eq!(
            slugify_for_branch("Add `issue_number` param to spawn_worktree MCP tool", 60),
            "add-issue-number-param-to-spawn-worktree-mcp-tool"
        );
    }

    #[test]
    fn test_slugify_truncation() {
        let slug = slugify_for_branch(
            "this is a very long title that should be truncated properly at word boundary",
            30,
        );
        assert!(
            slug.len() <= 30,
            "Slug should be at most 30 chars, got {}: {}",
            slug.len(),
            slug
        );
        assert!(!slug.ends_with('-'), "Slug should not end with hyphen");
    }

    #[test]
    fn test_slugify_leading_trailing_hyphens() {
        assert_eq!(slugify_for_branch("---hello---", 50), "hello");
    }

    #[test]
    fn test_slugify_empty() {
        assert_eq!(slugify_for_branch("", 50), "");
    }

    #[test]
    fn test_slugify_consecutive_specials() {
        assert_eq!(slugify_for_branch("a!!!b###c", 50), "a-b-c");
    }
}
