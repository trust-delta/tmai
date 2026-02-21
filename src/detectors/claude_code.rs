use regex::Regex;

use crate::agents::{AgentMode, AgentStatus, AgentType, ApprovalType};
use crate::config::SpinnerVerbsMode;

use super::{DetectionConfidence, DetectionContext, DetectionResult, StatusDetector};

/// Idle indicator - ✳ appears when Claude Code is waiting for input
const IDLE_INDICATOR: char = '✳';

/// Processing spinner characters used in terminal title
///
/// Claude Code uses only ⠂ (U+2802) and ⠐ (U+2810) as title spinners.
/// The remaining Braille/circle patterns are kept for compatibility with
/// other agents or future changes, but are not used by Claude Code v2.1.39.
const PROCESSING_SPINNERS: &[char] = &[
    // Claude Code actual spinners (2 frames, 960ms interval)
    '⠂', '⠐', // Legacy Braille patterns (kept for other agents / future compatibility)
    '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏', '⠿', '⠾', '⠽', '⠻', '⠟', '⠯', '⠷', '⠳', '⠱',
    '⠰', // Circle spinners
    '◐', '◓', '◑', '◒',
];

/// Past-tense verbs used in turn duration display (e.g., "✻ Cooked for 1m 6s")
/// These indicate a completed turn and should be detected as Idle.
const TURN_DURATION_VERBS: &[&str] = &[
    "Baked",
    "Brewed",
    "Churned",
    "Cogitated",
    "Cooked",
    "Crunched",
    "Sautéed",
    "Worked",
];

/// Content-area spinner characters (decorative asterisks used by Claude Code)
/// These appear in content as "✶ Spinning…", "✻ Working…", "✢ Thinking…", etc.
/// Claude Code animates through these characters, so all variants must be covered.
/// The full rotation includes: ✶ ✻ ✽ ✢ · * ✳ (and possibly ✹ ✧)
/// Note: ✳ is also the IDLE_INDICATOR in title, but in content it appears as a
/// spinner char (macOS/Ghostty). The detect_content_spinner() function requires
/// uppercase verb + ellipsis after the char, so title-based idle detection is unaffected.
const CONTENT_SPINNER_CHARS: &[char] = &['✶', '✻', '✽', '✹', '✧', '✢', '·', '✳'];

/// Built-in spinner verbs used by Claude Code (v2.1.41, 185 verbs)
///
/// These are the default verbs that appear in content spinners like "✶ Spinning…".
/// When a verb from this list is detected, confidence is elevated to High.
/// Custom verbs from settings remain at Medium confidence.
const BUILTIN_SPINNER_VERBS: &[&str] = &[
    "Accomplishing",
    "Actioning",
    "Actualizing",
    "Architecting",
    "Baking",
    "Beaming",
    "Beboppin'",
    "Befuddling",
    "Billowing",
    "Blanching",
    "Bloviating",
    "Boogieing",
    "Boondoggling",
    "Booping",
    "Bootstrapping",
    "Brewing",
    "Burrowing",
    "Calculating",
    "Canoodling",
    "Caramelizing",
    "Cascading",
    "Catapulting",
    "Cerebrating",
    "Channeling",
    "Channelling",
    "Choreographing",
    "Churning",
    "Clauding",
    "Coalescing",
    "Cogitating",
    "Combobulating",
    "Composing",
    "Computing",
    "Concocting",
    "Considering",
    "Contemplating",
    "Cooking",
    "Crafting",
    "Creating",
    "Crunching",
    "Crystallizing",
    "Cultivating",
    "Deciphering",
    "Deliberating",
    "Determining",
    "Dilly-dallying",
    "Discombobulating",
    "Doing",
    "Doodling",
    "Drizzling",
    "Ebbing",
    "Effecting",
    "Elucidating",
    "Embellishing",
    "Enchanting",
    "Envisioning",
    "Evaporating",
    "Fermenting",
    "Fiddle-faddling",
    "Finagling",
    "Flambéing",
    "Flibbertigibbeting",
    "Flowing",
    "Flummoxing",
    "Fluttering",
    "Forging",
    "Forming",
    "Frolicking",
    "Frosting",
    "Gallivanting",
    "Galloping",
    "Garnishing",
    "Generating",
    "Germinating",
    "Gitifying",
    "Grooving",
    "Gusting",
    "Harmonizing",
    "Hashing",
    "Hatching",
    "Herding",
    "Honking",
    "Hullaballooing",
    "Hyperspacing",
    "Ideating",
    "Imagining",
    "Improvising",
    "Incubating",
    "Inferring",
    "Infusing",
    "Ionizing",
    "Jitterbugging",
    "Julienning",
    "Kneading",
    "Leavening",
    "Levitating",
    "Lollygagging",
    "Manifesting",
    "Marinating",
    "Meandering",
    "Metamorphosing",
    "Misting",
    "Moonwalking",
    "Moseying",
    "Mulling",
    "Mustering",
    "Musing",
    "Nebulizing",
    "Nesting",
    "Newspapering",
    "Noodling",
    "Nucleating",
    "Orbiting",
    "Orchestrating",
    "Osmosing",
    "Perambulating",
    "Percolating",
    "Perusing",
    "Philosophising",
    "Photosynthesizing",
    "Pollinating",
    "Pondering",
    "Pontificating",
    "Pouncing",
    "Precipitating",
    "Prestidigitating",
    "Processing",
    "Proofing",
    "Propagating",
    "Puttering",
    "Puzzling",
    "Quantumizing",
    "Razzle-dazzling",
    "Razzmatazzing",
    "Recombobulating",
    "Reticulating",
    "Roosting",
    "Ruminating",
    "Sautéing",
    "Scampering",
    "Schlepping",
    "Scurrying",
    "Seasoning",
    "Shenaniganing",
    "Shimmying",
    "Simmering",
    "Skedaddling",
    "Sketching",
    "Slithering",
    "Smooshing",
    "Sock-hopping",
    "Spelunking",
    "Spinning",
    "Sprouting",
    "Stewing",
    "Sublimating",
    "Swirling",
    "Swooping",
    "Symbioting",
    "Synthesizing",
    "Tempering",
    "Thinking",
    "Thundering",
    "Tinkering",
    "Tomfoolering",
    "Topsy-turvying",
    "Transfiguring",
    "Transmuting",
    "Twisting",
    "Undulating",
    "Unfurling",
    "Unravelling",
    "Vibing",
    "Waddling",
    "Wandering",
    "Warping",
    "Whatchamacalliting",
    "Whirlpooling",
    "Whirring",
    "Whisking",
    "Wibbling",
    "Working",
    "Wrangling",
    "Zesting",
    "Zigzagging",
];

/// Detector for Claude Code CLI
pub struct ClaudeCodeDetector {
    // Approval patterns
    file_edit_pattern: Regex,
    file_create_pattern: Regex,
    file_delete_pattern: Regex,
    bash_pattern: Regex,
    mcp_pattern: Regex,
    general_approval_pattern: Regex,
    // Choice pattern for AskUserQuestion
    choice_pattern: Regex,
    // Error patterns
    error_pattern: Regex,
}

/// Strip box-drawing characters (U+2500-U+257F) and everything after them from choice text.
/// Handles preview box borders like │, ┌, ┐, └, ┘, etc.
fn strip_box_drawing(text: &str) -> &str {
    if let Some(pos) = text.find(|c: char| ('\u{2500}'..='\u{257F}').contains(&c)) {
        text[..pos].trim()
    } else {
        text
    }
}

impl ClaudeCodeDetector {
    pub fn new() -> Self {
        Self {
            file_edit_pattern: Regex::new(
                r"(?i)(Edit|Write|Modify)\s+.*?\?|Do you want to (edit|write|modify)|Allow.*?edit",
            )
            .expect("Invalid file_edit_pattern regex"),
            file_create_pattern: Regex::new(
                r"(?i)Create\s+.*?\?|Do you want to create|Allow.*?create",
            )
            .expect("Invalid file_create_pattern regex"),
            file_delete_pattern: Regex::new(
                r"(?i)Delete\s+.*?\?|Do you want to delete|Allow.*?delete",
            )
            .expect("Invalid file_delete_pattern regex"),
            bash_pattern: Regex::new(
                r"(?i)(Run|Execute)\s+(command|bash|shell)|Do you want to run|Allow.*?(command|bash)|run this command",
            )
            .expect("Invalid bash_pattern regex"),
            mcp_pattern: Regex::new(r"(?i)MCP\s+tool|Do you want to use.*?MCP|Allow.*?MCP")
                .expect("Invalid mcp_pattern regex"),
            general_approval_pattern: Regex::new(
                r"(?i)\[y/n\]|\[Y/n\]|\[yes/no\]|\(Y\)es\s*/\s*\(N\)o|Yes\s*/\s*No|y/n|Allow\?|Do you want to (allow|proceed|continue|run|execute)",
            )
            .expect("Invalid general_approval_pattern regex"),
            // Choice pattern: handles "> 1. Option" or "  1. Option" or "❯ 1. Option" or "› 1. Option"
            choice_pattern: Regex::new(r"^\s*(?:[>❯›]\s*)?(\d+)\.\s+(.+)$")
                .expect("Invalid choice_pattern regex"),
            error_pattern: Regex::new(r"(?i)(?:^|\n)\s*(?:Error|ERROR|error:|✗|❌)")
                .expect("Invalid error_pattern regex"),
        }
    }

    /// Detect AskUserQuestion with numbered choices
    fn detect_user_question(&self, content: &str) -> Option<(ApprovalType, String)> {
        let lines: Vec<&str> = content.lines().collect();
        if lines.is_empty() {
            return None;
        }

        // Strip trailing empty lines (tmux capture-pane pads with blank lines)
        let effective_len = lines
            .iter()
            .rposition(|line| !line.trim().is_empty())
            .map(|i| i + 1)
            .unwrap_or(lines.len());
        let lines = &lines[..effective_len];

        // Find the last prompt marker (❯ or ›) - choices should be BEFORE it
        // Note: ❯/› followed by number is a selection cursor, not a prompt
        let last_prompt_idx = lines.iter().rposition(|line| {
            let trimmed = line.trim();
            // Only count ❯/› as prompt if it's alone or followed by space (not "❯ 1." pattern)
            if trimmed == "❯" || trimmed == "›" {
                return true;
            }
            // Check if ❯/› is followed by a number (selection cursor)
            if trimmed.starts_with('❯') || trimmed.starts_with('›') {
                let after_marker = trimmed
                    .trim_start_matches('❯')
                    .trim_start_matches('›')
                    .trim_start();
                // If followed by digit, it's a selection cursor, not a prompt
                if after_marker
                    .chars()
                    .next()
                    .map(|c| c.is_ascii_digit())
                    .unwrap_or(false)
                {
                    return false;
                }
                // Very short ❯/› line could be prompt
                return trimmed.len() < 3;
            }
            false
        });

        // If no prompt found, search entire content; otherwise search before prompt
        let search_end = last_prompt_idx.unwrap_or(lines.len());
        // Also search the entire content if prompt is at the very end
        // Narrowed window (was 30/25) reduces false positives from conversation history
        let search_start = if search_end == lines.len() {
            lines.len().saturating_sub(15)
        } else {
            search_end.saturating_sub(15)
        };
        let check_lines = &lines[search_start..search_end];

        if check_lines.is_empty() {
            return None;
        }

        let mut choices = Vec::new();
        let mut question = String::new();
        let mut first_choice_idx = None;
        let mut last_choice_idx = None;
        let mut is_multi_select = false;
        let mut cursor_position: usize = 0;

        // Check for multi-select indicators in the content
        for line in check_lines.iter() {
            let lower = line.to_lowercase();
            if lower.contains("space to")
                || lower.contains("toggle")
                || lower.contains("select all")
                || lower.contains("multi")
            {
                is_multi_select = true;
                break;
            }
        }

        // [ ] checkbox format detection
        if !is_multi_select {
            for line in check_lines.iter() {
                if let Some(cap) = self.choice_pattern.captures(line) {
                    let choice_text = cap[2].trim();
                    if choice_text.starts_with("[ ]")
                        || choice_text.starts_with("[x]")
                        || choice_text.starts_with("[X]")
                        || choice_text.starts_with("[×]")
                        || choice_text.starts_with("[✔]")
                    {
                        is_multi_select = true;
                        break;
                    }
                }
            }
        }

        if !is_multi_select {
            for line in check_lines.iter() {
                let lower = line.to_lowercase();
                // "Enter to select" in preview-mode footer is NOT multi-select
                // Multi-select footer uses "space to toggle" (already detected above)
                if lower.contains("複数選択") {
                    is_multi_select = true;
                    break;
                }
            }
        }

        // Store all found choice sets, keep the last valid one
        let mut best_choices: Vec<String> = Vec::new();
        let mut best_first_idx: Option<usize> = None;
        let mut best_last_idx: Option<usize> = None;
        let mut best_cursor_position: usize = 0;

        for (i, line) in check_lines.iter().enumerate() {
            let trimmed = line.trim();

            // Skip UI elements (box drawing characters)
            if trimmed.starts_with('│')
                || trimmed.starts_with('├')
                || trimmed.starts_with('└')
                || trimmed.starts_with('┌')
                || trimmed.starts_with('─')
                || trimmed.starts_with('✻')
                || trimmed.starts_with('╌')
            {
                continue;
            }

            // Check for numbered choices (e.g., "1. Option text" or "> 1. Option text")
            if let Some(cap) = self.choice_pattern.captures(line) {
                if let Ok(num) = cap[1].parse::<u32>() {
                    // Strip preview box content (box-drawing chars) before extracting label
                    let choice_text = strip_box_drawing(cap[2].trim());
                    if num as usize == choices.len() + 1 {
                        let label = choice_text
                            .split('（')
                            .next()
                            .unwrap_or(choice_text)
                            .trim()
                            .to_string();
                        choices.push(label);
                        if first_choice_idx.is_none() {
                            first_choice_idx = Some(i);
                        }
                        last_choice_idx = Some(i);

                        // Check if this line has cursor marker (❯, ›, or >)
                        if trimmed.starts_with('❯')
                            || trimmed.starts_with('›')
                            || trimmed.starts_with('>')
                        {
                            cursor_position = num as usize;
                        }
                    } else if num == 1 {
                        // New choice set starting - save current if valid (must have cursor marker)
                        if choices.len() >= 2 && cursor_position > 0 {
                            best_choices = choices.clone();
                            best_first_idx = first_choice_idx;
                            best_last_idx = last_choice_idx;
                            best_cursor_position = cursor_position;
                        }
                        // Start new choice set
                        choices.clear();
                        let label = choice_text
                            .split('（')
                            .next()
                            .unwrap_or(choice_text)
                            .trim()
                            .to_string();
                        choices.push(label);
                        first_choice_idx = Some(i);
                        last_choice_idx = Some(i);
                        cursor_position = if trimmed.starts_with('❯')
                            || trimmed.starts_with('›')
                            || trimmed.starts_with('>')
                        {
                            1
                        } else {
                            0
                        };
                    }
                }
            }
        }

        // Use the last valid choice set (must have cursor marker to be AskUserQuestion)
        if choices.len() >= 2 && cursor_position > 0 {
            best_choices = choices;
            best_first_idx = first_choice_idx;
            best_last_idx = last_choice_idx;
            best_cursor_position = cursor_position;
        }

        // Restore best choices
        choices = best_choices;
        first_choice_idx = best_first_idx;
        last_choice_idx = best_last_idx;
        cursor_position = best_cursor_position;

        // Choices must be near the end (allow for UI hints like "Enter to select")
        // Use the last non-empty line as the effective end, since tmux capture-pane
        // pads output with trailing empty lines to fill the terminal height.
        if let Some(last_idx) = last_choice_idx {
            let effective_end = check_lines
                .iter()
                .rposition(|line| !line.trim().is_empty())
                .map(|i| i + 1)
                .unwrap_or(check_lines.len());
            if effective_end - last_idx > 15 {
                return None;
            }
        }

        // Find the question before choices
        if let Some(first_idx) = first_choice_idx {
            for j in (0..first_idx).rev() {
                let prev = check_lines[j].trim();
                if prev.is_empty() {
                    continue;
                }
                if prev.ends_with('?') || prev.ends_with('？') {
                    question = prev.to_string();
                    break;
                }
                if question.is_empty() {
                    question = prev.to_string();
                }
                if first_idx - j > 5 {
                    break;
                }
            }
        }

        if choices.len() >= 2 {
            // Filter out Claude Code settings menus (model selection, etc.)
            // These show "Enter to confirm" footer instead of "Esc to cancel · Tab to amend"
            let tail_lines: Vec<&str> = lines
                .iter()
                .rev()
                .filter(|l| !l.trim().is_empty())
                .take(8)
                .copied()
                .collect();
            let tail_text = tail_lines.join(" ");
            if tail_text.contains("Enter to confirm") {
                return None;
            }

            // Default cursor to 1 if not detected
            let cursor = if cursor_position == 0 {
                1
            } else {
                cursor_position
            };
            Some((
                ApprovalType::UserQuestion {
                    choices,
                    multi_select: is_multi_select,
                    cursor_position: cursor,
                },
                question,
            ))
        } else {
            None
        }
    }

    /// Detect "Do you want to proceed?" style approval (1. Yes / 2. Yes, don't ask / 3. No)
    ///
    /// Returns extracted choices when found. This allows number key navigation
    /// even when the cursor marker (❯) is not captured by tmux capture-pane.
    fn detect_proceed_prompt(content: &str) -> Option<Vec<String>> {
        // Filter out empty lines and take last 15 non-empty lines (in original order)
        let check_lines: Vec<&str> = content
            .lines()
            .filter(|line| !line.trim().is_empty())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .take(15)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();

        let mut has_yes = false;
        let mut has_no = false;

        for line in &check_lines {
            let trimmed = line.trim();
            // Pattern: "1. Yes" or "❯ 1. Yes" or "> 1. Yes"
            if trimmed.contains("1.") && trimmed.contains("Yes") {
                has_yes = true;
            }
            // Pattern: "2. No" or "3. No"
            if (trimmed.contains("2. No") || trimmed.contains("3. No")) && trimmed.len() < 20 {
                has_no = true;
            }
        }

        if !(has_yes && has_no) {
            return None;
        }

        // Extract numbered choices
        let mut choices = Vec::new();
        for line in &check_lines {
            let clean = line
                .trim()
                .trim_start_matches('❯')
                .trim_start_matches('›')
                .trim_start_matches('>')
                .trim();
            if let Some(dot_pos) = clean.find(". ") {
                if let Ok(num) = clean[..dot_pos].trim().parse::<usize>() {
                    if num == choices.len() + 1 {
                        // Strip preview box content (box-drawing chars) before extracting label
                        let choice_text = strip_box_drawing(clean[dot_pos + 2..].trim());
                        let label = choice_text
                            .split('（')
                            .next()
                            .unwrap_or(choice_text)
                            .trim()
                            .to_string();
                        choices.push(label);
                    }
                }
            }
        }

        if choices.len() >= 2 {
            Some(choices)
        } else {
            None
        }
    }

    /// Extract question text from content (e.g., "Do you want to proceed?")
    fn extract_question_text(content: &str) -> String {
        content
            .lines()
            .rev()
            .take(20)
            .find(|line| {
                let t = line.trim();
                !t.is_empty() && (t.ends_with('?') || t.ends_with('？'))
            })
            .map(|l| l.trim().to_string())
            .unwrap_or_else(|| "Do you want to proceed?".to_string())
    }

    /// Detect Yes/No button-style approval
    fn detect_yes_no_buttons(&self, lines: &[&str]) -> bool {
        let check_lines: Vec<&str> = lines.iter().rev().take(8).copied().collect();

        let mut has_yes = false;
        let mut has_no = false;
        let mut yes_line_idx: Option<usize> = None;
        let mut no_line_idx: Option<usize> = None;

        for (idx, line) in check_lines.iter().enumerate() {
            let trimmed = line.trim();

            if trimmed.is_empty() || trimmed.len() > 50 {
                continue;
            }

            // Check for "Yes" button
            if (trimmed == "Yes" || trimmed.starts_with("Yes,") || trimmed.starts_with("Yes "))
                && trimmed.len() < 40
            {
                has_yes = true;
                yes_line_idx = Some(idx);
            }

            // Check for "No" button
            if (trimmed == "No" || trimmed.starts_with("No,") || trimmed.starts_with("No "))
                && trimmed.len() < 40
            {
                has_no = true;
                no_line_idx = Some(idx);
            }
        }

        // Both Yes and No must be present and close together (within 4 lines)
        if has_yes && has_no {
            if let (Some(y_idx), Some(n_idx)) = (yes_line_idx, no_line_idx) {
                let distance = y_idx.abs_diff(n_idx);
                return distance <= 4;
            }
        }

        false
    }

    /// Detect approval request in content, returning the rule name that matched
    fn detect_approval(&self, content: &str) -> Option<(ApprovalType, String, &'static str)> {
        let lines: Vec<&str> = content.lines().collect();
        if lines.is_empty() {
            return None;
        }

        // Strip trailing empty lines (tmux capture-pane pads with blank lines)
        let effective_len = lines
            .iter()
            .rposition(|line| !line.trim().is_empty())
            .map(|i| i + 1)
            .unwrap_or(lines.len());
        let lines = &lines[..effective_len];

        // Check last ~12 lines (narrowed from 20 to reduce false positives)
        let check_start = lines.len().saturating_sub(12);
        let recent_lines = &lines[check_start..];
        let _recent = recent_lines.join("\n");

        // Check for AskUserQuestion first (highest priority)
        if let Some((approval_type, details)) = self.detect_user_question(content) {
            return Some((approval_type, details, "user_question_numbered_choices"));
        }

        // Check for "1. Yes / 2. ... / 3. No" style proceed prompt
        let proceed_choices = Self::detect_proceed_prompt(content);
        let has_proceed_prompt = proceed_choices.is_some();

        // Check for button-style approval
        let has_yes_no_buttons = self.detect_yes_no_buttons(recent_lines);

        // Check for text-format approval
        let last_lines: Vec<&str> = recent_lines.iter().rev().take(10).copied().collect();
        let last_text = last_lines.join("\n");
        let has_text_approval = self.general_approval_pattern.is_match(&last_text);

        if !has_proceed_prompt && !has_yes_no_buttons && !has_text_approval {
            return None;
        }

        // If proceed_prompt extracted choices, return as UserQuestion for number key support
        if let Some(choices) = proceed_choices {
            let question = Self::extract_question_text(content);
            return Some((
                ApprovalType::UserQuestion {
                    choices,
                    multi_select: false,
                    cursor_position: 1,
                },
                question,
                "proceed_prompt",
            ));
        }

        // Determine which rule matched
        let rule = if has_yes_no_buttons {
            "yes_no_buttons"
        } else {
            "yes_no_text_pattern"
        };

        // Determine approval type
        let context = safe_tail(content, 1500);

        if self.file_edit_pattern.is_match(context) {
            let details = self.extract_file_path(context).unwrap_or_default();
            return Some((ApprovalType::FileEdit, details, rule));
        }

        if self.file_create_pattern.is_match(context) {
            let details = self.extract_file_path(context).unwrap_or_default();
            return Some((ApprovalType::FileCreate, details, rule));
        }

        if self.file_delete_pattern.is_match(context) {
            let details = self.extract_file_path(context).unwrap_or_default();
            return Some((ApprovalType::FileDelete, details, rule));
        }

        if self.bash_pattern.is_match(context) {
            let details = self.extract_command(context).unwrap_or_default();
            return Some((ApprovalType::ShellCommand, details, rule));
        }

        if self.mcp_pattern.is_match(context) {
            return Some((ApprovalType::McpTool, "MCP tool call".to_string(), rule));
        }

        Some((
            ApprovalType::Other("Pending approval".to_string()),
            String::new(),
            rule,
        ))
    }

    /// Detect error in content
    fn detect_error(&self, content: &str) -> Option<String> {
        let recent = safe_tail(content, 500);
        if self.error_pattern.is_match(recent) {
            // Extract error message
            for line in recent.lines().rev() {
                let trimmed = line.trim();
                if trimmed.to_lowercase().contains("error")
                    || trimmed.contains('✗')
                    || trimmed.contains('❌')
                {
                    return Some(trimmed.to_string());
                }
            }
            return Some("Error detected".to_string());
        }
        None
    }

    fn extract_file_path(&self, content: &str) -> Option<String> {
        let path_pattern =
            Regex::new(r"(?m)(?:file|path)[:\s]+([^\s\n]+)|([./][\w/.-]+\.\w+)").ok()?;
        path_pattern
            .captures(content)
            .and_then(|c| c.get(1).or(c.get(2)))
            .map(|m| m.as_str().to_string())
    }

    fn extract_command(&self, content: &str) -> Option<String> {
        let cmd_pattern =
            Regex::new(r"(?m)(?:command|run)[:\s]+`([^`]+)`|```(?:bash|sh)?\n([^`]+)```").ok()?;
        cmd_pattern
            .captures(content)
            .and_then(|c| c.get(1).or(c.get(2)))
            .map(|m| m.as_str().trim().to_string())
    }

    /// Check if content contains Tasks list with in-progress tasks
    /// ◼ indicates an in-progress task in Claude Code's task list
    fn has_in_progress_tasks(content: &str) -> bool {
        // Look for the Tasks header pattern and in-progress indicator
        let recent = safe_tail(content, 2000);

        // Check for Tasks header with in_progress count > 0
        for line in recent.lines() {
            let trimmed = line.trim();
            // Match task summary formats:
            // - "Tasks (X done, Y in progress, Z open)" (Teams/Plan format)
            // - "N tasks (X done, Y in progress, Z open)" (internal task list)
            // - "N task (X done, Y in progress, Z open)" (singular)
            let is_task_summary = trimmed.contains("in progress")
                && (trimmed.starts_with("Tasks (")
                    || trimmed.contains(" tasks (")
                    || trimmed.contains(" task ("));
            if is_task_summary {
                // Check if there's at least 1 in progress
                if let Some(start) = trimmed.find(", ") {
                    if let Some(end) = trimmed[start + 2..].find(" in progress") {
                        let num_str = &trimmed[start + 2..start + 2 + end];
                        if let Ok(count) = num_str.parse::<u32>() {
                            if count > 0 {
                                return true;
                            }
                        }
                    }
                }
            }
            // Check for ◼ indicator (in-progress task)
            // Formats: "◼ #N task name" (Teams) or "◼ task name" (internal)
            if trimmed.starts_with('◼') {
                return true;
            }
        }
        false
    }

    /// Check if title matches custom spinner verbs from settings
    ///
    /// Returns Some(activity) if a custom verb matches, None otherwise.
    fn detect_custom_spinner_verb(title: &str, context: &DetectionContext) -> Option<String> {
        let settings_cache = context.settings_cache?;
        let settings = settings_cache.get_settings(context.cwd)?;
        let spinner_config = settings.spinner_verbs?;

        if spinner_config.verbs.is_empty() {
            return None;
        }

        // Check if title starts with any custom verb
        for verb in &spinner_config.verbs {
            if title.starts_with(verb) {
                // Extract activity text after the verb
                let activity = title
                    .strip_prefix(verb)
                    .map(|s| s.trim_start())
                    .unwrap_or("")
                    .to_string();
                return Some(activity);
            }
        }

        None
    }

    /// Detect turn duration completion pattern (e.g., "✻ Cooked for 1m 6s")
    ///
    /// When Claude Code finishes a turn, it displays a line like "✻ Cooked for 1m 6s"
    /// using a past-tense verb. This is a definitive Idle indicator.
    ///
    /// Only checks the last 5 non-empty lines to avoid matching residual
    /// turn duration messages from previous turns while a new turn is active.
    fn detect_turn_duration(content: &str) -> Option<String> {
        for line in content
            .lines()
            .rev()
            .filter(|line| !line.trim().is_empty())
            .take(5)
        {
            let trimmed = line.trim();

            // Check for content spinner char at the start (Unicode only, not plain *)
            let first_char = match trimmed.chars().next() {
                Some(c) => c,
                None => continue,
            };

            if !CONTENT_SPINNER_CHARS.contains(&first_char) {
                continue;
            }

            let rest = trimmed[first_char.len_utf8()..].trim_start();

            // Check for past-tense verb + " for " + duration pattern
            for verb in TURN_DURATION_VERBS {
                if let Some(after_verb) = rest.strip_prefix(verb) {
                    if after_verb.starts_with(" for ") {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
        None
    }

    /// Detect active spinner verbs in content area
    ///
    /// Claude Code shows spinner activity like "✶ Spinning…", "✻ Levitating…", "* Working…"
    /// in the content. Active spinners contain "…" (ellipsis), while completed ones show
    /// "✻ Crunched for 6m 5s" (past tense + time, no ellipsis).
    ///
    /// Returns (matched_text, is_builtin_verb) — builtin verbs get High confidence,
    /// unknown/custom verbs get Medium confidence.
    ///
    /// This is critical for detecting processing when the title still shows ✳ (idle),
    /// e.g. during /compact or title update lag.
    fn detect_content_spinner(content: &str, context: &DetectionContext) -> Option<(String, bool)> {
        // If idle prompt ❯ is near the end (last 5 non-empty lines), any spinner above is a past residual
        let has_idle_prompt = content
            .lines()
            .rev()
            .filter(|line| !line.trim().is_empty())
            .take(5)
            .any(|line| {
                let trimmed = line.trim();
                trimmed == "❯" || trimmed == "›"
            });
        if has_idle_prompt {
            return None;
        }

        // Check last 15 non-empty lines (skip empty lines entirely).
        // Claude Code TUI has status bar (3 lines) + separators + empty padding,
        // so using raw line count can miss spinners beyond the window.
        for line in content
            .lines()
            .rev()
            .filter(|line| !line.trim().is_empty())
            .take(15)
        {
            let trimmed = line.trim();

            let first_char = match trimmed.chars().next() {
                Some(c) => c,
                None => continue,
            };

            // Check for decorative asterisk chars or plain '*'
            let is_spinner_char = CONTENT_SPINNER_CHARS.contains(&first_char) || first_char == '*';
            if !is_spinner_char {
                continue;
            }

            let rest = trimmed[first_char.len_utf8()..].trim_start();

            // Must start with uppercase letter (verb) and contain ellipsis (active)
            let starts_upper = rest
                .chars()
                .next()
                .map(|c| c.is_uppercase())
                .unwrap_or(false);
            let has_ellipsis = rest.contains('…') || rest.contains("...");

            if starts_upper && has_ellipsis {
                // Extract the verb (first word) and check against builtin/custom lists
                let verb = rest.split_whitespace().next().unwrap_or("");
                // Strip trailing ellipsis from verb if present (e.g., "Spinning…")
                let verb_clean = verb.trim_end_matches('…').trim_end_matches("...");
                let is_builtin = BUILTIN_SPINNER_VERBS.contains(&verb_clean);
                // Also check custom spinnerVerbs from Claude Code settings
                let is_custom = if !is_builtin {
                    context
                        .settings_cache
                        .and_then(|cache| cache.get_settings(context.cwd))
                        .and_then(|s| s.spinner_verbs)
                        .map(|config| config.verbs.iter().any(|v| v == verb_clean))
                        .unwrap_or(false)
                } else {
                    false
                };
                return Some((trimmed.to_string(), is_builtin || is_custom));
            }
        }
        None
    }

    /// Detect permission mode from title icon
    ///
    /// Claude Code displays mode icons in the terminal title:
    /// - ⏸ (U+23F8) = Plan mode
    /// - ⇢ (U+21E2) = Delegate mode
    /// - ⏵⏵ (U+23F5 x2) = Auto-approve (acceptEdits/bypassPermissions/dontAsk)
    pub fn detect_mode(title: &str) -> AgentMode {
        if title.contains('\u{23F8}') {
            AgentMode::Plan
        } else if title.contains('\u{21E2}') {
            AgentMode::Delegate
        } else if title.contains("\u{23F5}\u{23F5}") {
            AgentMode::AutoApprove
        } else {
            AgentMode::Default
        }
    }

    /// Check if we should skip default Braille spinner detection
    ///
    /// Returns true if mode is "replace" and custom verbs are configured.
    fn should_skip_default_spinners(context: &DetectionContext) -> bool {
        let settings_cache = match context.settings_cache {
            Some(cache) => cache,
            None => return false,
        };

        let settings = match settings_cache.get_settings(context.cwd) {
            Some(s) => s,
            None => return false,
        };

        matches!(
            settings.spinner_verbs,
            Some(ref config) if config.mode == SpinnerVerbsMode::Replace && !config.verbs.is_empty()
        )
    }
}

impl Default for ClaudeCodeDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl StatusDetector for ClaudeCodeDetector {
    fn detect_status(&self, title: &str, content: &str) -> AgentStatus {
        self.detect_status_with_reason(title, content, &DetectionContext::default())
            .status
    }

    fn detect_status_with_context(
        &self,
        title: &str,
        content: &str,
        context: &DetectionContext,
    ) -> AgentStatus {
        self.detect_status_with_reason(title, content, context)
            .status
    }

    fn detect_status_with_reason(
        &self,
        title: &str,
        content: &str,
        context: &DetectionContext,
    ) -> DetectionResult {
        // 1. Check for AskUserQuestion or approval (highest priority)
        if let Some((approval_type, details, rule)) = self.detect_approval(content) {
            let matched = safe_tail(content, 200);
            return DetectionResult::new(
                AgentStatus::AwaitingApproval {
                    approval_type,
                    details,
                },
                rule,
                DetectionConfidence::High,
            )
            .with_matched_text(matched);
        }

        // 1.5 Fast path: Braille spinner in title → Processing (skip content parsing)
        //     Any character in the Braille Patterns block (U+2800..=U+28FF) indicates
        //     active processing. This avoids expensive content analysis when the title
        //     already provides a definitive signal.
        //     Approval detection (step 1) is always checked first.
        {
            let title_activity = title
                .chars()
                .skip_while(|c| matches!(*c, '\u{2800}'..='\u{28FF}') || c.is_whitespace())
                .collect::<String>();
            if title.chars().any(|c| matches!(c, '\u{2800}'..='\u{28FF}')) {
                return DetectionResult::new(
                    AgentStatus::Processing {
                        activity: title_activity,
                    },
                    "title_braille_spinner_fast_path",
                    DetectionConfidence::High,
                )
                .with_matched_text(title);
            }
        }

        // 2. Check for errors
        if let Some(message) = self.detect_error(content) {
            return DetectionResult::new(
                AgentStatus::Error {
                    message: message.clone(),
                },
                "error_pattern",
                DetectionConfidence::High,
            )
            .with_matched_text(&message);
        }

        // 3. Check for Tasks list with in-progress tasks (◼)
        if Self::has_in_progress_tasks(content) {
            return DetectionResult::new(
                AgentStatus::Processing {
                    activity: "Tasks running".to_string(),
                },
                "tasks_in_progress",
                DetectionConfidence::High,
            );
        }

        // 4. Check for Compacting (✽ Compacting conversation)
        if title.contains('✽') && title.to_lowercase().contains("compacting") {
            return DetectionResult::new(
                AgentStatus::Processing {
                    activity: "Compacting...".to_string(),
                },
                "title_compacting",
                DetectionConfidence::High,
            )
            .with_matched_text(title);
        }

        // 5. Content-based "Conversation compacted" detection → Idle
        //    e.g., "✻ Conversation compacted (ctrl+o for history)"
        {
            let recent = safe_tail(content, 1000);
            if recent.contains("Conversation compacted") {
                // Verify it's a spinner-prefixed line (not just any text mentioning it)
                for line in recent
                    .lines()
                    .rev()
                    .filter(|l| !l.trim().is_empty())
                    .take(15)
                {
                    let trimmed = line.trim();
                    let first_char = trimmed.chars().next().unwrap_or('\0');
                    if (CONTENT_SPINNER_CHARS.contains(&first_char) || first_char == '*')
                        && trimmed.contains("Conversation compacted")
                    {
                        return DetectionResult::new(
                            AgentStatus::Idle,
                            "content_conversation_compacted",
                            DetectionConfidence::High,
                        )
                        .with_matched_text(trimmed);
                    }
                }
            }
        }

        // 6. Content-based spinner detection (overrides title idle)
        //    Catches cases where title still shows ✳ but content has active spinner
        //    e.g. during /compact, or title update lag
        if let Some((activity, is_builtin)) = Self::detect_content_spinner(content, context) {
            let confidence = if is_builtin {
                DetectionConfidence::High
            } else {
                DetectionConfidence::Medium
            };
            return DetectionResult::new(
                AgentStatus::Processing {
                    activity: activity.clone(),
                },
                "content_spinner_verb",
                confidence,
            )
            .with_matched_text(&activity);
        }

        // 7. Check for turn duration completion (e.g., "✻ Cooked for 1m 6s")
        //    Placed after content spinner so active spinners take priority over
        //    residual turn duration messages from previous turns.
        if let Some(matched) = Self::detect_turn_duration(content) {
            return DetectionResult::new(
                AgentStatus::Idle,
                "turn_duration_completed",
                DetectionConfidence::High,
            )
            .with_matched_text(&matched);
        }

        // 8. Title-based detection: ✳ in title = Idle
        if title.contains(IDLE_INDICATOR) {
            return DetectionResult::new(
                AgentStatus::Idle,
                "title_idle_indicator",
                DetectionConfidence::High,
            )
            .with_matched_text(title);
        }

        // 9. Check for custom spinner verbs from settings
        if let Some(activity) = Self::detect_custom_spinner_verb(title, context) {
            return DetectionResult::new(
                AgentStatus::Processing { activity },
                "custom_spinner_verb",
                DetectionConfidence::Medium,
            )
            .with_matched_text(title);
        }

        // 10. Default Braille spinner detection (unless mode is "replace")
        if !Self::should_skip_default_spinners(context)
            && title.chars().any(|c| PROCESSING_SPINNERS.contains(&c))
        {
            let activity = title
                .chars()
                .skip_while(|c| PROCESSING_SPINNERS.contains(c) || c.is_whitespace())
                .collect::<String>();
            return DetectionResult::new(
                AgentStatus::Processing { activity },
                "braille_spinner",
                DetectionConfidence::Medium,
            )
            .with_matched_text(title);
        }

        // No indicator - default to Processing
        DetectionResult::new(
            AgentStatus::Processing {
                activity: String::new(),
            },
            "fallback_no_indicator",
            DetectionConfidence::Low,
        )
    }

    fn detect_context_warning(&self, content: &str) -> Option<u8> {
        // Look for "Context left until auto-compact: XX%"
        for line in content.lines().rev().take(30) {
            if line.contains("Context left until auto-compact:") {
                // Extract percentage
                if let Some(pct_str) = line.split(':').next_back() {
                    let pct_str = pct_str.trim().trim_end_matches('%');
                    if let Ok(pct) = pct_str.parse::<u8>() {
                        return Some(pct);
                    }
                }
            }
        }
        None
    }

    fn agent_type(&self) -> AgentType {
        AgentType::ClaudeCode
    }

    fn approval_keys(&self) -> &str {
        // Claude Code uses cursor-based selection UI
        // Cursor is already on "Yes", just press Enter to confirm
        "Enter"
    }
    // Note: Rejection removed - use number keys, input mode, or passthrough mode
}

/// Get the last n bytes of a string safely
fn safe_tail(s: &str, n: usize) -> &str {
    if s.len() <= n {
        s
    } else {
        let start = s.len() - n;
        // Find a valid UTF-8 boundary
        let start = s
            .char_indices()
            .map(|(i, _)| i)
            .find(|&i| i >= start)
            .unwrap_or(s.len());
        &s[start..]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_idle_with_asterisk() {
        let detector = ClaudeCodeDetector::new();
        let status = detector.detect_status("✳ Claude Code", "some content");
        assert!(matches!(status, AgentStatus::Idle));
    }

    #[test]
    fn test_processing_with_spinner() {
        let detector = ClaudeCodeDetector::new();
        let status = detector.detect_status("⠋ Processing task", "some content");
        assert!(matches!(status, AgentStatus::Processing { .. }));
    }

    #[test]
    fn test_yes_no_button_approval() {
        let detector = ClaudeCodeDetector::new();
        let content = r#"
Do you want to allow this action?

  Yes
  Yes, and don't ask again for this session
  No
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(matches!(status, AgentStatus::AwaitingApproval { .. }));
    }

    #[test]
    fn test_no_false_positive_for_prompt() {
        let detector = ClaudeCodeDetector::new();
        // ❯ alone should not trigger approval
        let content = "Some previous output\n\n❯ ";
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(matches!(status, AgentStatus::Idle));
    }

    #[test]
    fn test_numbered_choices() {
        let detector = ClaudeCodeDetector::new();
        // AskUserQuestion always has ❯ cursor on the selected option line
        let content = r#"
Which option do you prefer?

❯ 1. Option A
  2. Option B
  3. Option C
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                assert!(matches!(approval_type, ApprovalType::UserQuestion { .. }));
            }
            _ => panic!("Expected AwaitingApproval with UserQuestion"),
        }
    }

    #[test]
    fn test_numbered_list_not_detected_as_question() {
        let detector = ClaudeCodeDetector::new();
        // Regular numbered list without ❯ cursor should NOT be detected as AskUserQuestion
        let content = r#"
Here are the changes:

1. Fixed the bug
2. Added tests
3. Updated docs
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        // Should be Idle, not AwaitingApproval
        assert!(matches!(status, AgentStatus::Idle));
    }

    #[test]
    fn test_numbered_choices_with_cursor() {
        let detector = ClaudeCodeDetector::new();
        // Format with > cursor marker on selected option
        let content = r#"
Which option do you prefer?

> 1. Option A
  2. Option B
  3. Option C

❯
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion { choices, .. } = approval_type {
                    assert_eq!(choices.len(), 3);
                } else {
                    panic!("Expected UserQuestion");
                }
            }
            _ => panic!("Expected AwaitingApproval with UserQuestion"),
        }
    }

    #[test]
    fn test_numbered_choices_with_descriptions() {
        let detector = ClaudeCodeDetector::new();
        // Real AskUserQuestion format with multi-line options
        let content = r#"
───────────────────────────────────────────────────────────────────────────────
 ☐ 動作確認

数字キーで選択できますか？

❯ 1. 1番: 動作した
     数字キーで1を押して選択できた
  2. 2番: まだ動かない
     数字キーが反応しない
  3. 3番: 別の問題
     他の問題が発生した
  4. Type something.
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion { choices, .. } = approval_type {
                    assert_eq!(choices.len(), 4, "Expected 4 choices, got {:?}", choices);
                } else {
                    panic!("Expected UserQuestion, got {:?}", approval_type);
                }
            }
            _ => panic!("Expected AwaitingApproval, got {:?}", status),
        }
    }

    #[test]
    fn test_would_you_like_to_proceed() {
        let detector = ClaudeCodeDetector::new();
        let content = r#"Would you like to proceed?

 ❯ 1. Yes, clear context and auto-accept edits (shift+tab)
   2. Yes, auto-accept edits
   3. Yes, manually approve edits
   4. Type here to tell Claude what to change"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion { choices, .. } = approval_type {
                    assert_eq!(choices.len(), 4, "Expected 4 choices, got {:?}", choices);
                } else {
                    panic!("Expected UserQuestion, got {:?}", approval_type);
                }
            }
            _ => panic!("Expected AwaitingApproval, got {:?}", status),
        }
    }

    #[test]
    fn test_would_you_like_to_proceed_with_footer() {
        let detector = ClaudeCodeDetector::new();
        // Real captured content with UI footer
        let content = r#"   - 環境変数未設定時に警告ログが出ることを確認

 ---
 完了条件

 - getInvitationLink ヘルパー関数を作成
 - queries.ts と mutations.ts でヘルパー関数を使用
 - 型チェック・リント・テストがパス
 - Issue #62 の関連項目をクローズ
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

 Would you like to proceed?

 ❯ 1. Yes, clear context and auto-accept edits (shift+tab)
   2. Yes, auto-accept edits
   3. Yes, manually approve edits
   4. Type here to tell Claude what to change

 ctrl-g to edit in Micro · .claude/plans/eventual-humming-hellman.md"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion { choices, .. } = approval_type {
                    assert_eq!(choices.len(), 4, "Expected 4 choices, got {:?}", choices);
                } else {
                    panic!("Expected UserQuestion, got {:?}", approval_type);
                }
            }
            _ => panic!("Expected AwaitingApproval, got {:?}", status),
        }
    }

    #[test]
    fn test_numbered_choices_with_ui_hints() {
        let detector = ClaudeCodeDetector::new();
        // Real format with UI hints at the bottom
        let content = r#"
───────────────────────────────────────────────────────────────────────────────
 ☐ コンテンツ取得

デバッグのため、コンテンツを貼り付けてもらえますか？

❯ 1. 貼り付ける
     「その他」でコンテンツを入力
  2. 別のアプローチ
     デバッグモードを追加して原因を特定
  3. Type something.

───────────────────────────────────────────────────────────────────────────────
  Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion { choices, .. } = approval_type {
                    assert_eq!(choices.len(), 3, "Expected 3 choices, got {:?}", choices);
                } else {
                    panic!("Expected UserQuestion, got {:?}", approval_type);
                }
            }
            _ => panic!("Expected AwaitingApproval, got {:?}", status),
        }
    }

    #[test]
    fn test_tasks_in_progress_detected_as_processing() {
        let detector = ClaudeCodeDetector::new();
        // Tasks list with in_progress tasks should be Processing, not Idle
        let content = r#"
  Tasks (0 done, 2 in progress, 8 open) · ctrl+t to hide tasks
  ◼ #1 T1: helpers仕様書の作成
  ◼ #2 T2: Result型仕様書の作成
  ◻ #3 T3: past-medication-record-edit更新
  ◻ #4 T4: medication-history更新
  ◻ #10 T10: OVERVIEW更新 › blocked by #9
"#;
        // Even with ✳ in title, should be Processing due to in-progress tasks
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::Processing { .. }),
            "Expected Processing, got {:?}",
            status
        );
    }

    #[test]
    fn test_tasks_in_progress_internal_format() {
        let detector = ClaudeCodeDetector::new();
        // Claude Code internal task format: "N tasks (X done, Y in progress, Z open)"
        // Note: uses lowercase "tasks" with number prefix, and ◼ without #N
        let content = r#"
  7 tasks (6 done, 1 in progress, 0 open)
  ✔ Fix 1: screen_context の機密情報サニタイズ
  ✔ Fix 2: in_flight/cooldowns の TOCTOU 修正
  ◼ 検証: cargo fmt, clippy, test, build
  ✔ Fix 4: judge.rs の stdout truncation
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::Processing { .. }),
            "Expected Processing for internal task format, got {:?}",
            status
        );
    }

    #[test]
    fn test_tasks_in_progress_indicator_without_hash() {
        let detector = ClaudeCodeDetector::new();
        // ◼ without #N should also be detected
        let content = "Some output\n  ◼ Running tests\n  ✔ Build passed\n";
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::Processing { .. }),
            "Expected Processing for ◼ without #N, got {:?}",
            status
        );
    }

    #[test]
    fn test_tasks_all_done_is_idle() {
        let detector = ClaudeCodeDetector::new();
        // Tasks list with all done (no in_progress) should be Idle
        let content = r#"
  Tasks (10 done, 0 in progress, 0 open) · ctrl+t to hide tasks
  ✔ #1 T1: helpers仕様書の作成
  ✔ #2 T2: Result型仕様書の作成
  ✔ #3 T3: past-medication-record-edit更新
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::Idle),
            "Expected Idle, got {:?}",
            status
        );
    }

    #[test]
    fn test_tasks_all_done_internal_format_is_idle() {
        let detector = ClaudeCodeDetector::new();
        // Internal format with all tasks done
        let content = r#"
  7 tasks (7 done, 0 in progress, 0 open)
  ✔ Fix 1: screen_context の機密情報サニタイズ
  ✔ Fix 2: in_flight/cooldowns の TOCTOU 修正
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::Idle),
            "Expected Idle for all-done internal format, got {:?}",
            status
        );
    }

    #[test]
    fn test_web_search_approval() {
        let detector = ClaudeCodeDetector::new();
        let content = r#"● Web Search("MCP Apps iframe UI Model Context Protocol 2026")

● Explore(プロジェクト構造の調査)
  ⎿  Done (11 tool uses · 85.3k tokens · 51s)

───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Tool use

   Web Search("MCP Apps iframe UI Model Context Protocol 2026")
   Claude wants to search the web for: MCP Apps iframe UI Model Context Protocol 2026

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for Web Search commands in /home/trustdelta/works/conversation-handoff-mcp
   3. No

 Esc to cancel · Tab to add additional instructions"#;
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::AwaitingApproval { .. }),
            "Expected AwaitingApproval, got {:?}",
            status
        );
    }

    #[test]
    fn test_proceed_prompt_detection() {
        let detector = ClaudeCodeDetector::new();
        let content = r#"
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for Web Search commands
   3. No

 Esc to cancel"#;
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::AwaitingApproval { .. }),
            "Expected AwaitingApproval, got {:?}",
            status
        );
    }

    #[test]
    fn test_actual_captured_content() {
        let detector = ClaudeCodeDetector::new();
        // Content with ❯ appearing both as user prompt and selection cursor
        let content = "Line1\nLine2\nLine3\nLine4\nLine5\nLine6\n\
❯ MCP Appsが公開された、テスト\n\
Line8\nLine9\nLine10\n\
Line11\nLine12\nLine13\nLine14\nLine15\n\
 Tool use\n\
   Web Search(\"test\")\n\
\n\
 Do you want to proceed?\n\
 ❯ 1. Yes\n\
   2. No\n\
\n\
 Esc to cancel";
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::AwaitingApproval { .. }),
            "Expected AwaitingApproval, got {:?}",
            status
        );
    }

    #[test]
    fn test_web_search_with_full_capture() {
        let detector = ClaudeCodeDetector::new();
        // Full capture from actual tmux pane - includes welcome screen
        let content = r#"╭─── Claude Code v2.1.17 ─────────────────────────────────────────────────────────────────────────────────────────────╮
│                                                     │ Tips for getting started                                      │
│             Welcome back trust.delta!               │ Run /init to create a CLAUDE.md file with instructions for Cl…│
│                                                     │                                                               │
│                                                     │ ───────────────────────────────────────────────────────────── │
│                      ▐▛███▜▌                        │ Recent activity                                               │
│                     ▝▜█████▛▘                       │ No recent activity                                            │
│                       ▘▘ ▝▝                         │                                                               │
│  Opus 4.5 · Claude Max · trust.delta@gmail.com's    │                                                               │
│  Organization                                       │                                                               │
│          ~/works/conversation-handoff-mcp           │                                                               │
╰─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯

❯ MCP Appsが公開された、mcpにiframeでuiを追加できる様子。実験がてらアプデが止まってたconversation-handoff-mcpに組
  み込んでみようと思います

● MCP Appsは興味深い新機能ですね。まずMCP Appsの仕様と現在のconversation-handoff-mcpの状態を調査しましょう。

● Web Search("MCP Apps iframe UI Model Context Protocol 2026")

● Explore(プロジェクト構造の調査)
  ⎿  Done (11 tool uses · 85.3k tokens · 51s)

───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Tool use

   Web Search("MCP Apps iframe UI Model Context Protocol 2026")
   Claude wants to search the web for: MCP Apps iframe UI Model Context Protocol 2026

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and don't ask again for Web Search commands in /home/trustdelta/works/conversation-handoff-mcp
   3. No

 Esc to cancel · Tab to add additional instructions"#;
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::AwaitingApproval { .. }),
            "Expected AwaitingApproval, got {:?}",
            status
        );
    }

    #[test]
    fn test_proceed_prompt_without_cursor_returns_user_question() {
        let detector = ClaudeCodeDetector::new();
        // 3-choice approval WITHOUT cursor marker ❯
        let content = r#"
 Tool use

   Bash("ls -la")

 Do you want to proceed?
   1. Yes
   2. Yes, and don't ask again for Bash commands
   3. No

 Esc to cancel"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion {
                    choices,
                    multi_select,
                    cursor_position,
                } = approval_type
                {
                    assert_eq!(choices.len(), 3, "Expected 3 choices, got {:?}", choices);
                    assert!(!multi_select);
                    assert_eq!(cursor_position, 1);
                    assert!(choices[0].contains("Yes"));
                    assert!(choices[2].contains("No"));
                } else {
                    panic!(
                        "Expected UserQuestion for cursor-less proceed prompt, got {:?}",
                        approval_type
                    );
                }
            }
            _ => panic!("Expected AwaitingApproval, got {:?}", status),
        }
    }

    #[test]
    fn test_proceed_prompt_2_choice_without_cursor() {
        let detector = ClaudeCodeDetector::new();
        // Simple 2-choice without cursor
        let content = r#" Do you want to proceed?
   1. Yes
   2. No"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion { choices, .. } = approval_type {
                    assert_eq!(choices.len(), 2, "Expected 2 choices, got {:?}", choices);
                } else {
                    panic!("Expected UserQuestion, got {:?}", approval_type);
                }
            }
            _ => panic!("Expected AwaitingApproval, got {:?}", status),
        }
    }

    #[test]
    fn test_custom_spinner_verb_detection_replace_mode() {
        use crate::config::ClaudeSettingsCache;

        let detector = ClaudeCodeDetector::new();
        let cache = ClaudeSettingsCache::new();

        // Manually inject settings for testing (since we can't create real files in unit tests)
        // We'll test the detection logic directly

        // Test that custom verb is detected when present in title
        let context = DetectionContext {
            cwd: None, // No cwd means no settings loaded
            settings_cache: Some(&cache),
        };

        // Without settings, should fall back to default spinner detection
        let status =
            detector.detect_status_with_context("Thinking about code", "content", &context);
        // Should be Processing (no indicator found, but also no settings to check)
        assert!(
            matches!(status, AgentStatus::Processing { .. }),
            "Expected Processing, got {:?}",
            status
        );
    }

    #[test]
    fn test_default_spinner_still_works_without_settings() {
        let detector = ClaudeCodeDetector::new();
        let context = DetectionContext::default();

        // Braille spinner should still be detected without settings
        let status = detector.detect_status_with_context("⠋ Working on task", "content", &context);
        match status {
            AgentStatus::Processing { activity } => {
                assert_eq!(activity, "Working on task");
            }
            _ => panic!("Expected Processing, got {:?}", status),
        }
    }

    #[test]
    fn test_simple_yes_no_proceed() {
        let detector = ClaudeCodeDetector::new();
        // Exact format reported by user as being detected as Idle
        let content = r#" Do you want to proceed?
 ❯ 1. Yes
   2. No"#;
        let status = detector.detect_status("✳ Claude Code", content);
        assert!(
            matches!(status, AgentStatus::AwaitingApproval { .. }),
            "Expected AwaitingApproval, got {:?}",
            status
        );
    }

    #[test]
    fn test_content_spinner_overrides_title_idle() {
        let detector = ClaudeCodeDetector::new();
        // Title shows ✳ (idle) but content has active spinner and no bare ❯ prompt
        // - should be Processing
        let content = r#"
✻ Cogitated for 2m 6s

❯ コミットしてdev-log

✶ Spinning… (37s · ↑ 38 tokens)

Some other output here
"#;
        let result = detector.detect_status_with_reason(
            "✳ Git commit dev-log",
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Processing { .. }),
            "Expected Processing when content has active spinner, got {:?}",
            result.status
        );
        assert_eq!(result.reason.rule, "content_spinner_verb");
        // "Spinning" is a builtin verb, so confidence is High
        assert_eq!(result.reason.confidence, DetectionConfidence::High);
    }

    #[test]
    fn test_content_spinner_with_four_teardrop() {
        let detector = ClaudeCodeDetector::new();
        // ✢ (U+2722) is another spinner char Claude Code uses
        // No bare ❯ prompt at end, so spinner should be detected
        let content = "Some output\n\n✢ Bootstrapping… (1m 27s)\n\nMore output\n";
        let result = detector.detect_status_with_reason(
            "✳ Task name",
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Processing { .. }),
            "Expected Processing for ✢ spinner, got {:?}",
            result.status
        );
        assert_eq!(result.reason.rule, "content_spinner_verb");
    }

    #[test]
    fn test_content_spinner_with_plain_asterisk() {
        let detector = ClaudeCodeDetector::new();
        // Plain * spinner should also be detected
        // No bare ❯ prompt at end, so spinner should be detected
        let content = "Some output\n\n* Perambulating…\n\nMore output\n";
        let result = detector.detect_status_with_reason(
            "✳ Task name",
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Processing { .. }),
            "Expected Processing for * spinner, got {:?}",
            result.status
        );
    }

    #[test]
    fn test_completed_spinner_not_detected_as_active() {
        let detector = ClaudeCodeDetector::new();
        // Completed spinners (past tense, no ellipsis) should NOT trigger processing
        let content = "Some output\n\n✻ Crunched for 6m 5s\n\n❯ \n";
        let result = detector.detect_status_with_reason(
            "✳ Task name",
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Idle),
            "Expected Idle for completed spinner, got {:?}",
            result.status
        );
    }

    #[test]
    fn test_detect_status_with_context_backwards_compatible() {
        let detector = ClaudeCodeDetector::new();
        let context = DetectionContext::default();

        // Test that detect_status and detect_status_with_context give same results
        // when context is empty
        let title = "✳ Claude Code";
        let content = "some content";

        let status1 = detector.detect_status(title, content);
        let status2 = detector.detect_status_with_context(title, content, &context);

        // Both should be Idle
        assert!(matches!(status1, AgentStatus::Idle));
        assert!(matches!(status2, AgentStatus::Idle));
    }

    #[test]
    fn test_multi_select_with_trailing_empty_lines() {
        let detector = ClaudeCodeDetector::new();
        // Real capture-pane output: AskUserQuestion with multi-select checkboxes,
        // followed by many trailing empty lines (tmux pads to terminal height).
        // This previously failed because check_lines.len() - last_choice_idx > 15.
        let content = "\
今日の作業内容を教えてください（複数選択可）\n\
\n\
❯ 1. [ ] 機能実装\n\
  --audit モードの実装\n\
  2. [ ] ドキュメント更新\n\
  CHANGELOG, README, CLAUDE.md更新\n\
  3. [ ] CI/CD構築\n\
  タグプッシュ時の自動npm publishワークフロー作成\n\
  4. [ ] リリース\n\
  v0.7.0のnpm publish\n\
  5. [ ] Type something\n\
     Submit\n\
──────────────────────────────────────────\n\
  6. Chat about this\n\
\n\
Enter to select · ↑/↓ to navigate · Esc to cancel\n\
\n\n\n\n\n\n\n\n\n\n\n\n\n\n";
        let status = detector.detect_status("✳ Dev Log", content);
        assert!(
            matches!(status, AgentStatus::AwaitingApproval { .. }),
            "Should detect AskUserQuestion despite trailing empty lines, got {:?}",
            status
        );
        if let AgentStatus::AwaitingApproval { approval_type, .. } = status {
            if let ApprovalType::UserQuestion {
                choices,
                multi_select,
                cursor_position,
                ..
            } = approval_type
            {
                assert_eq!(choices.len(), 6, "Expected 6 choices, got {:?}", choices);
                // Note: multi_select detection relies on English keywords ("space to", "toggle")
                // which aren't present in this Japanese UI. The [ ] checkboxes are visual-only.
                let _ = multi_select;
                assert_eq!(cursor_position, 1);
            } else {
                panic!("Expected UserQuestion, got {:?}", approval_type);
            }
        }
    }

    #[test]
    fn test_content_spinner_not_detected_when_idle_prompt_present() {
        let detector = ClaudeCodeDetector::new();
        // Old spinner text above idle prompt should NOT trigger processing
        let content = "Some output\n\n✽ Forging… (2m 3s)\n\nMore output\n\n❯ \n";
        let result = detector.detect_status_with_reason(
            "✳ Task name",
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Idle),
            "Expected Idle when ❯ prompt is present below old spinner, got {:?}",
            result.status
        );
    }

    #[test]
    fn test_actual_title_spinner_chars() {
        let detector = ClaudeCodeDetector::new();
        // ⠂ (U+2802) and ⠐ (U+2810) are the actual Claude Code title spinner frames
        for (spinner, label) in [('⠂', "U+2802"), ('⠐', "U+2810")] {
            let title = format!("{} Working on task", spinner);
            let result = detector.detect_status_with_reason(
                &title,
                "some content",
                &DetectionContext::default(),
            );
            assert!(
                matches!(result.status, AgentStatus::Processing { .. }),
                "Expected Processing for {} ({}), got {:?}",
                spinner,
                label,
                result.status
            );
            assert_eq!(
                result.reason.rule, "title_braille_spinner_fast_path",
                "Expected title_braille_spinner_fast_path rule for {} ({})",
                spinner, label
            );
        }
    }

    #[test]
    fn test_content_spinner_with_empty_line_padding() {
        let detector = ClaudeCodeDetector::new();
        // Spinner line followed by many empty lines (TUI padding)
        let content = "Some output\n\n✶ Bootstrapping… (5s)\n\n\n\n\n\n\n\n\n\n\n\n";
        let result = detector.detect_status_with_reason(
            "✳ Task name",
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Processing { .. }),
            "Expected Processing when spinner is followed by empty line padding, got {:?}",
            result.status
        );
        assert_eq!(result.reason.rule, "content_spinner_verb");
    }

    #[test]
    fn test_content_spinner_beyond_old_window() {
        let detector = ClaudeCodeDetector::new();
        // Spinner line with >15 lines after it (mix of empty and non-empty status bar lines)
        // Previously the 15-line raw window would miss this spinner
        let mut content = String::from("Some output\n\n✻ Levitating… (10s)\n");
        // Add 10 empty lines + 3 status bar lines + 5 empty lines = 18 trailing lines
        for _ in 0..10 {
            content.push('\n');
        }
        content.push_str("───────────────────────\n");
        content.push_str("  ctrl-g to edit\n");
        content.push_str("  Status bar line\n");
        for _ in 0..5 {
            content.push('\n');
        }
        let result = detector.detect_status_with_reason(
            "✳ Task name",
            &content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Processing { .. }),
            "Expected Processing when spinner is beyond old 15-line window, got {:?}",
            result.status
        );
        assert_eq!(result.reason.rule, "content_spinner_verb");
    }

    #[test]
    fn test_idle_prompt_detection_with_empty_lines() {
        let detector = ClaudeCodeDetector::new();
        // ❯ prompt with empty lines after it should still be detected as idle
        let content = "Some output\n\n✶ Spinning… (5s)\n\nMore output\n\n❯ \n\n\n\n\n\n\n\n\n\n\n";
        let result = detector.detect_status_with_reason(
            "✳ Task name",
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Idle),
            "Expected Idle when ❯ prompt is present (even with empty line padding), got {:?}",
            result.status
        );
    }

    #[test]
    fn test_content_spinner_with_idle_indicator_char() {
        let detector = ClaudeCodeDetector::new();
        // ✳ used as content spinner on macOS/Ghostty (same char as IDLE_INDICATOR)
        // Should be detected as Processing when used with uppercase verb + ellipsis
        let content = "Some output\n\n✳ Ruminating… (3s)\n\nMore output\n";
        let result = detector.detect_status_with_reason(
            "Claude Code", // non-Braille title so fast path doesn't intercept
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Processing { .. }),
            "Expected Processing for ✳ content spinner, got {:?}",
            result.status
        );
        assert_eq!(result.reason.rule, "content_spinner_verb");
    }

    #[test]
    fn test_multi_select_windows_checkbox() {
        let detector = ClaudeCodeDetector::new();
        // Windows/fallback uses [×] for checked checkbox
        let content = r#"
Which items to include?

❯ 1. [×] Feature A
  2. [ ] Feature B
  3. [×] Feature C
  4. Type something.
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion {
                    choices,
                    multi_select,
                    ..
                } = approval_type
                {
                    assert_eq!(choices.len(), 4, "Expected 4 choices, got {:?}", choices);
                    assert!(multi_select, "Expected multi_select=true for [×] checkbox");
                } else {
                    panic!("Expected UserQuestion, got {:?}", approval_type);
                }
            }
            _ => panic!("Expected AwaitingApproval, got {:?}", status),
        }
    }

    #[test]
    fn test_mode_detection_plan() {
        assert_eq!(
            ClaudeCodeDetector::detect_mode("⏸ ✳ Claude Code"),
            AgentMode::Plan
        );
        assert_eq!(
            ClaudeCodeDetector::detect_mode("⏸ ⠂ Working on task"),
            AgentMode::Plan
        );
    }

    #[test]
    fn test_mode_detection_delegate() {
        assert_eq!(
            ClaudeCodeDetector::detect_mode("⇢ ✳ Claude Code"),
            AgentMode::Delegate
        );
    }

    #[test]
    fn test_mode_detection_auto_approve() {
        assert_eq!(
            ClaudeCodeDetector::detect_mode("⏵⏵ ✳ Claude Code"),
            AgentMode::AutoApprove
        );
        assert_eq!(
            ClaudeCodeDetector::detect_mode("⏵⏵ ⠐ Processing"),
            AgentMode::AutoApprove
        );
    }

    #[test]
    fn test_mode_detection_default() {
        assert_eq!(
            ClaudeCodeDetector::detect_mode("✳ Claude Code"),
            AgentMode::Default
        );
        assert_eq!(
            ClaudeCodeDetector::detect_mode("⠂ Working"),
            AgentMode::Default
        );
    }

    #[test]
    fn test_turn_duration_cooked() {
        let detector = ClaudeCodeDetector::new();
        // "✻ Cooked for 1m 6s" = completed turn → Idle
        let content = "Some output\n\n✻ Cooked for 1m 6s\n\nSome status bar\n";
        let result = detector.detect_status_with_reason(
            "✳ Task name",
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Idle),
            "Expected Idle for turn duration, got {:?}",
            result.status
        );
        assert_eq!(result.reason.rule, "turn_duration_completed");
        assert_eq!(result.reason.confidence, DetectionConfidence::High);
    }

    #[test]
    fn test_turn_duration_brewed() {
        let detector = ClaudeCodeDetector::new();
        let content = "Output\n\n✻ Brewed for 42s\n\n";
        let result = detector.detect_status_with_reason(
            "✳ Claude Code",
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Idle),
            "Expected Idle for Brewed duration, got {:?}",
            result.status
        );
        assert_eq!(result.reason.rule, "turn_duration_completed");
    }

    #[test]
    fn test_turn_duration_sauteed() {
        let detector = ClaudeCodeDetector::new();
        // Sautéed with accent
        let content = "Output\n\n✶ Sautéed for 3m 12s\n\n";
        let result = detector.detect_status_with_reason(
            "✳ Claude Code",
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Idle),
            "Expected Idle for Sautéed duration, got {:?}",
            result.status
        );
    }

    #[test]
    fn test_turn_duration_does_not_match_active_spinner() {
        let detector = ClaudeCodeDetector::new();
        // Active spinner (with ellipsis) should NOT be matched as turn duration
        let content = "Output\n\n✻ Cooking… (5s)\n\n";
        let result = detector.detect_status_with_reason(
            "✳ Claude Code",
            content,
            &DetectionContext::default(),
        );
        // Should be Processing (content spinner), not Idle
        assert!(
            matches!(result.status, AgentStatus::Processing { .. }),
            "Expected Processing for active spinner, got {:?}",
            result.status
        );
    }

    #[test]
    fn test_conversation_compacted_in_content() {
        let detector = ClaudeCodeDetector::new();
        let content =
            "Some output\n\n✻ Conversation compacted (ctrl+o for history)\n\nStatus bar\n";
        let result = detector.detect_status_with_reason(
            "✳ Claude Code",
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Idle),
            "Expected Idle for Conversation compacted, got {:?}",
            result.status
        );
        assert_eq!(result.reason.rule, "content_conversation_compacted");
        assert_eq!(result.reason.confidence, DetectionConfidence::High);
    }

    #[test]
    fn test_conversation_compacted_title_still_works() {
        let detector = ClaudeCodeDetector::new();
        // Title-based compacting detection should still work
        let content = "Some content\n";
        let result = detector.detect_status_with_reason(
            "✽ Compacting conversation",
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Processing { .. }),
            "Expected Processing for title compacting, got {:?}",
            result.status
        );
        assert_eq!(result.reason.rule, "title_compacting");
    }

    #[test]
    fn test_builtin_spinner_verb_high_confidence() {
        let detector = ClaudeCodeDetector::new();
        // Builtin verb "Spinning" should get High confidence
        let content = "Some output\n\n✶ Spinning… (5s)\n\nMore output\n";
        let result = detector.detect_status_with_reason(
            "Claude Code", // non-Braille title so fast path doesn't intercept
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Processing { .. }),
            "Expected Processing, got {:?}",
            result.status
        );
        assert_eq!(result.reason.rule, "content_spinner_verb");
        assert_eq!(result.reason.confidence, DetectionConfidence::High);
    }

    #[test]
    fn test_unknown_spinner_verb_medium_confidence() {
        let detector = ClaudeCodeDetector::new();
        // Unknown verb should get Medium confidence
        let content = "Some output\n\n✶ Zazzlefrazzing… (5s)\n\nMore output\n";
        let result = detector.detect_status_with_reason(
            "Claude Code", // non-Braille title so fast path doesn't intercept
            content,
            &DetectionContext::default(),
        );
        assert!(
            matches!(result.status, AgentStatus::Processing { .. }),
            "Expected Processing, got {:?}",
            result.status
        );
        assert_eq!(result.reason.rule, "content_spinner_verb");
        assert_eq!(result.reason.confidence, DetectionConfidence::Medium);
    }

    #[test]
    fn test_builtin_verb_flambeing_with_accent() {
        let detector = ClaudeCodeDetector::new();
        // "Flambéing" with accent should match as builtin
        let content = "Output\n\n✻ Flambéing… (2s)\n\n";
        let result = detector.detect_status_with_reason(
            "⠂ Task name",
            content,
            &DetectionContext::default(),
        );
        assert_eq!(result.reason.confidence, DetectionConfidence::High);
    }

    #[test]
    fn test_windows_ascii_radio_buttons() {
        let detector = ClaudeCodeDetector::new();
        // Windows ASCII radio buttons: ( ) and (*) — single-select (not multi)
        let content = r#"
Which option?

❯ 1. (*) Option A
  2. ( ) Option B
  3. ( ) Option C
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion {
                    choices,
                    multi_select,
                    ..
                } = approval_type
                {
                    assert_eq!(choices.len(), 3, "Expected 3 choices, got {:?}", choices);
                    assert!(
                        !multi_select,
                        "Expected multi_select=false for (*) radio buttons (single-select)"
                    );
                } else {
                    panic!("Expected UserQuestion, got {:?}", approval_type);
                }
            }
            _ => panic!("Expected AwaitingApproval, got {:?}", status),
        }
    }

    #[test]
    fn test_preview_format_with_single_right_angle() {
        let detector = ClaudeCodeDetector::new();
        // AskUserQuestion with preview panel: › cursor marker + right-side │ box
        let content = r#"
Which approach do you prefer?

  1. Base directories          ┌──────────────────────┐
› 2. Bookmark style            │ # config.toml        │
  3. Both                      │ [create_process]     │
  4. Default input             │ directories = [...]  │
                               └──────────────────────┘

  Chat about this

Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel
"#;
        let status = detector.detect_status("✳ Claude Code", content);
        match status {
            AgentStatus::AwaitingApproval { approval_type, .. } => {
                if let ApprovalType::UserQuestion {
                    choices,
                    multi_select,
                    cursor_position,
                } = approval_type
                {
                    assert_eq!(choices.len(), 4, "Expected 4 choices, got {:?}", choices);
                    assert_eq!(cursor_position, 2, "Cursor should be on choice 2");
                    assert!(
                        !multi_select,
                        "Preview format should not be detected as multi-select"
                    );
                    // Verify preview box content is stripped from choice text
                    assert!(
                        !choices[0].contains('│'),
                        "Choice text should not contain box chars: {:?}",
                        choices[0]
                    );
                } else {
                    panic!("Expected UserQuestion, got {:?}", approval_type);
                }
            }
            _ => panic!("Expected AwaitingApproval, got {:?}", status),
        }
    }
}
