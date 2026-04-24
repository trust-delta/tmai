//! Stub entry point compiled by `cargo install tmai`.
//!
//! The real `tmai-ratatui` TUI ships alongside `tmai` in the bundle tarball on
//! <https://github.com/trust-delta/tmai/releases>.

fn main() {
    eprintln!(
        "tmai-ratatui: the crates.io entry is a stub.\n\
         \n\
         Install the real binary via:\n  \
             cargo binstall tmai\n  \
         or:\n  \
             curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash"
    );
    std::process::exit(1);
}
