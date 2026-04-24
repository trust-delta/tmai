//! Stub entry point compiled by `cargo install tmai`.
//!
//! The real `tmai` binary is distributed as part of the bundle tarball on
//! <https://github.com/trust-delta/tmai/releases>. Prefer `cargo binstall tmai`
//! or the curl installer instead.

fn main() {
    eprintln!(
        "tmai: the crates.io entry is a stub.\n\
         \n\
         Install the real binary via:\n  \
             cargo binstall tmai\n  \
         or:\n  \
             curl -fsSL https://raw.githubusercontent.com/trust-delta/tmai/main/install.sh | bash\n\
         \n\
         Or download a tarball directly from\n  \
             https://github.com/trust-delta/tmai/releases"
    );
    std::process::exit(1);
}
