use super::*;

use crate::agents::{AgentMode, ApprovalType};

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
    let status = detector.detect_status_with_context("Thinking about code", "content", &context);
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
    let result =
        detector.detect_status_with_reason("✳ Task name", content, &DetectionContext::default());
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
    let result =
        detector.detect_status_with_reason("✳ Task name", content, &DetectionContext::default());
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
    let result =
        detector.detect_status_with_reason("✳ Task name", content, &DetectionContext::default());
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
    let result =
        detector.detect_status_with_reason("✳ Task name", content, &DetectionContext::default());
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
    let result =
        detector.detect_status_with_reason("✳ Task name", content, &DetectionContext::default());
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
    let result =
        detector.detect_status_with_reason("✳ Task name", &content, &DetectionContext::default());
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
    let result =
        detector.detect_status_with_reason("✳ Task name", content, &DetectionContext::default());
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
    let result =
        detector.detect_status_with_reason("✳ Task name", content, &DetectionContext::default());
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
    let result =
        detector.detect_status_with_reason("✳ Claude Code", content, &DetectionContext::default());
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
    let result =
        detector.detect_status_with_reason("✳ Claude Code", content, &DetectionContext::default());
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
    let result =
        detector.detect_status_with_reason("✳ Claude Code", content, &DetectionContext::default());
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
    let content = "Some output\n\n✻ Conversation compacted (ctrl+o for history)\n\nStatus bar\n";
    let result =
        detector.detect_status_with_reason("✳ Claude Code", content, &DetectionContext::default());
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
    let result =
        detector.detect_status_with_reason("⠂ Task name", content, &DetectionContext::default());
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

#[test]
fn test_preview_format_large_box() {
    let detector = ClaudeCodeDetector::new();
    // AskUserQuestion with a large preview panel (10+ lines)
    // Enclosed between horizontal separators like real tmux capture-pane output
    let content = r#"
Previous conversation...

────────────────────────────────────────────────────────────────────────
Which configuration format do you prefer?

  1. TOML format              ┌──────────────────────────────┐
› 2. YAML format              │ # Example YAML config        │
  3. JSON format              │ server:                      │
                              │   host: localhost             │
                              │   port: 8080                 │
                              │   workers: 4                 │
                              │ database:                    │
                              │   url: postgres://localhost   │
                              │   pool_size: 10              │
                              │   timeout: 30s               │
                              │ logging:                     │
                              │   level: info                │
                              │   format: json               │
                              └──────────────────────────────┘

────────────────────────────────────────────────────────────────────────
  Chat about this

Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel
"#;
    // Simulate tmux padding: add trailing empty lines
    let mut padded = content.to_string();
    for _ in 0..30 {
        padded.push('\n');
    }

    let status = detector.detect_status("✳ Claude Code", &padded);
    match status {
        AgentStatus::AwaitingApproval { approval_type, .. } => {
            if let ApprovalType::UserQuestion {
                choices,
                multi_select,
                cursor_position,
            } = approval_type
            {
                assert_eq!(choices.len(), 3, "Expected 3 choices, got {:?}", choices);
                assert_eq!(cursor_position, 2, "Cursor should be on choice 2");
                assert!(
                    !multi_select,
                    "Preview format should not be detected as multi-select"
                );
                assert!(
                    !choices[0].contains('│'),
                    "Choice text should not contain box chars: {:?}",
                    choices[0]
                );
            } else {
                panic!("Expected UserQuestion, got {:?}", approval_type);
            }
        }
        _ => panic!(
            "Expected AwaitingApproval for large preview box, got {:?}",
            status
        ),
    }
}

#[test]
fn test_preview_format_very_large_box_real_capture() {
    let detector = ClaudeCodeDetector::new();
    // Real-world capture: AskUserQuestion with a very large preview (25+ lines)
    // where choices are far above the preview box in the content.
    // This simulates the actual tmux capture-pane output structure.
    // Simulates real tmux capture-pane: previous conversation above,
    // then two ─── separators enclosing the input area with choices + preview.
    let content = "\
Previous conversation output here...

✻ Worked for 30s

────────────────────────────────────────────────────────────────────────────────
  Capture Feedback

伝えたいことを教えてください。大きいプレビューにカーソルを合わせて確認してください。

  1. Option A                   ┌──────────────────────────────────────────┐
› 2. Option B                   │ # Large Preview B                        │
  3. Option C                   │                                          │
                                │ ## Database Schema                       │
                                │                                          │
                                │ ```sql                                   │
                                │ CREATE TABLE users (                     │
                                │   id UUID PRIMARY KEY,                   │
                                │   email TEXT UNIQUE,                     │
                                │   name TEXT,                             │
                                │   created_at TIMESTAMPTZ                 │
                                │ );                                       │
                                │                                          │
                                │ CREATE TABLE teams (                     │
                                │   id UUID PRIMARY KEY,                   │
                                │   name TEXT,                             │
                                │   owner_id UUID REFERENCES users         │
                                │ );                                       │
                                │                                          │
                                │ CREATE TABLE members (                   │
                                │   team_id UUID REFERENCES teams,         │
                                │   user_id UUID REFERENCES users,         │
                                │   role TEXT DEFAULT 'member',            │
                                │   PRIMARY KEY (team_id, user_id)         │
                                │ );                                       │
                                │ ```                                      │
                                └──────────────────────────────────────────┘

                                Notes: press n to add notes

────────────────────────────────────────────────────────────────────────────────
  Chat about this

Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel
";
    let status = detector.detect_status("✳ Claude Code", content);
    match status {
        AgentStatus::AwaitingApproval { approval_type, .. } => {
            if let ApprovalType::UserQuestion {
                choices,
                cursor_position,
                ..
            } = approval_type
            {
                assert_eq!(choices.len(), 3, "Expected 3 choices, got {:?}", choices);
                assert_eq!(cursor_position, 2, "Cursor should be on choice 2");
            } else {
                panic!("Expected UserQuestion, got {:?}", approval_type);
            }
        }
        _ => panic!(
            "Expected AwaitingApproval for very large preview box, got {:?}",
            status
        ),
    }
}
