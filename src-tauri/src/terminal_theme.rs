//! Built-in terminal color schemes.
//!
//! The catalogue lives in the backend so the frontend only renders it:
//! a theme is a named set of the 16 ANSI colors plus foreground,
//! background, cursor, and selection colors. User-chosen preferences
//! (theme id, font) stay in the webview, next to the other terminal
//! settings.

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalTheme {
    pub id: &'static str,
    pub name: &'static str,
    /// Whether the scheme is intended for a dark or light UI.
    pub dark: bool,
    pub background: &'static str,
    pub foreground: &'static str,
    pub cursor: &'static str,
    pub cursor_accent: &'static str,
    pub selection: &'static str,
    pub black: &'static str,
    pub red: &'static str,
    pub green: &'static str,
    pub yellow: &'static str,
    pub blue: &'static str,
    pub magenta: &'static str,
    pub cyan: &'static str,
    pub white: &'static str,
    pub bright_black: &'static str,
    pub bright_red: &'static str,
    pub bright_green: &'static str,
    pub bright_yellow: &'static str,
    pub bright_blue: &'static str,
    pub bright_magenta: &'static str,
    pub bright_cyan: &'static str,
    pub bright_white: &'static str,
}

const fn theme(
    id: &'static str,
    name: &'static str,
    dark: bool,
    palette: [&'static str; 22],
) -> TerminalTheme {
    TerminalTheme {
        id,
        name,
        dark,
        background: palette[0],
        foreground: palette[1],
        cursor: palette[2],
        cursor_accent: palette[3],
        selection: palette[4],
        black: palette[5],
        red: palette[6],
        green: palette[7],
        yellow: palette[8],
        blue: palette[9],
        magenta: palette[10],
        cyan: palette[11],
        white: palette[12],
        bright_black: palette[13],
        bright_red: palette[14],
        bright_green: palette[15],
        bright_yellow: palette[16],
        bright_blue: palette[17],
        bright_magenta: palette[18],
        bright_cyan: palette[19],
        bright_white: palette[20],
    }
}

/// The built-in schemes, in display order. The `mobaxtauri-*` entries are
/// the application defaults and match the terminal's original colors.
pub fn builtin_themes() -> Vec<TerminalTheme> {
    vec![
        theme(
            "mobaxtauri-dark",
            "MobaXTauri Dark",
            true,
            [
                "#0f172a",
                "#f1f5f9",
                "#38bdf8",
                "#0f172a",
                "rgba(56, 189, 248, 0.3)",
                "#1e293b",
                "#ef4444",
                "#22c55e",
                "#eab308",
                "#3b82f6",
                "#a855f7",
                "#06b6d4",
                "#f8fafc",
                "#64748b",
                "#f87171",
                "#4ade80",
                "#facc15",
                "#60a5fa",
                "#c084fc",
                "#22d3ee",
                "#ffffff",
                "#ffffff",
            ],
        ),
        theme(
            "mobaxtauri-light",
            "MobaXTauri Light",
            false,
            [
                "#ffffff",
                "#1e293b",
                "#38bdf8",
                "#ffffff",
                "rgba(56, 189, 248, 0.3)",
                "#1e293b",
                "#ef4444",
                "#22c55e",
                "#eab308",
                "#3b82f6",
                "#a855f7",
                "#06b6d4",
                "#f8fafc",
                "#64748b",
                "#f87171",
                "#4ade80",
                "#facc15",
                "#60a5fa",
                "#c084fc",
                "#22d3ee",
                "#ffffff",
                "#ffffff",
            ],
        ),
        theme(
            "dracula",
            "Dracula",
            true,
            [
                "#282a36",
                "#f8f8f2",
                "#f8f8f0",
                "#282a36",
                "rgba(68, 71, 90, 0.6)",
                "#21222c",
                "#ff5555",
                "#50fa7b",
                "#f1fa8c",
                "#bd93f9",
                "#ff79c6",
                "#8be9fd",
                "#f8f8f2",
                "#6272a4",
                "#ff6e6e",
                "#69ff94",
                "#ffffa5",
                "#d6acff",
                "#ff92df",
                "#a4ffff",
                "#ffffff",
                "#ffffff",
            ],
        ),
        theme(
            "nord",
            "Nord",
            true,
            [
                "#2e3440",
                "#d8dee9",
                "#d8dee9",
                "#2e3440",
                "rgba(76, 86, 106, 0.6)",
                "#3b4252",
                "#bf616a",
                "#a3be8c",
                "#ebcb8b",
                "#81a1c1",
                "#b48ead",
                "#88c0d0",
                "#e5e9f0",
                "#4c566a",
                "#bf616a",
                "#a3be8c",
                "#ebcb8b",
                "#81a1c1",
                "#b48ead",
                "#8fbcbb",
                "#eceff4",
                "#eceff4",
            ],
        ),
        theme(
            "solarized-dark",
            "Solarized Dark",
            true,
            [
                "#002b36",
                "#839496",
                "#93a1a1",
                "#002b36",
                "rgba(38, 139, 210, 0.3)",
                "#073642",
                "#dc322f",
                "#859900",
                "#b58900",
                "#268bd2",
                "#d33682",
                "#2aa198",
                "#eee8d5",
                "#002b36",
                "#cb4b16",
                "#586e75",
                "#657b83",
                "#839496",
                "#6c71c4",
                "#93a1a1",
                "#fdf6e3",
                "#fdf6e3",
            ],
        ),
        theme(
            "solarized-light",
            "Solarized Light",
            false,
            [
                "#fdf6e3",
                "#657b83",
                "#586e75",
                "#fdf6e3",
                "rgba(38, 139, 210, 0.25)",
                "#073642",
                "#dc322f",
                "#859900",
                "#b58900",
                "#268bd2",
                "#d33682",
                "#2aa198",
                "#eee8d5",
                "#002b36",
                "#cb4b16",
                "#586e75",
                "#657b83",
                "#839496",
                "#6c71c4",
                "#93a1a1",
                "#fdf6e3",
                "#fdf6e3",
            ],
        ),
        theme(
            "gruvbox-dark",
            "Gruvbox Dark",
            true,
            [
                "#282828",
                "#ebdbb2",
                "#ebdbb2",
                "#282828",
                "rgba(80, 73, 69, 0.6)",
                "#282828",
                "#cc241d",
                "#98971a",
                "#d79921",
                "#458588",
                "#b16286",
                "#689d6a",
                "#a89984",
                "#928374",
                "#fb4934",
                "#b8bb26",
                "#fabd2f",
                "#83a598",
                "#d3869b",
                "#8ec07c",
                "#ebdbb2",
                "#ebdbb2",
            ],
        ),
        theme(
            "one-dark",
            "One Dark",
            true,
            [
                "#282c34",
                "#abb2bf",
                "#528bff",
                "#282c34",
                "rgba(82, 139, 255, 0.3)",
                "#282c34",
                "#e06c75",
                "#98c379",
                "#e5c07b",
                "#61afef",
                "#c678dd",
                "#56b6c2",
                "#abb2bf",
                "#5c6370",
                "#e06c75",
                "#98c379",
                "#e5c07b",
                "#61afef",
                "#c678dd",
                "#56b6c2",
                "#ffffff",
                "#ffffff",
            ],
        ),
        theme(
            "monokai",
            "Monokai",
            true,
            [
                "#272822",
                "#f8f8f2",
                "#f8f8f0",
                "#272822",
                "rgba(73, 72, 62, 0.6)",
                "#272822",
                "#f92672",
                "#a6e22e",
                "#f4bf75",
                "#66d9ef",
                "#ae81ff",
                "#a1efe4",
                "#f8f8f2",
                "#75715e",
                "#f92672",
                "#a6e22e",
                "#f4bf75",
                "#66d9ef",
                "#ae81ff",
                "#a1efe4",
                "#f9f8f5",
                "#f9f8f5",
            ],
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::builtin_themes;

    fn is_hex_color(value: &str) -> bool {
        value.len() == 7
            && value.starts_with('#')
            && value[1..].chars().all(|c| c.is_ascii_hexdigit())
    }

    #[test]
    fn ids_and_names_are_unique() {
        let themes = builtin_themes();
        let mut ids: Vec<&str> = themes.iter().map(|theme| theme.id).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "theme ids must be unique");

        let mut names: Vec<&str> = themes.iter().map(|theme| theme.name).collect();
        names.sort_unstable();
        let count = names.len();
        names.dedup();
        assert_eq!(names.len(), count, "theme names must be unique");
    }

    #[test]
    fn every_theme_uses_valid_hex_colors() {
        for theme in builtin_themes() {
            let colors = [
                theme.background,
                theme.foreground,
                theme.cursor,
                theme.cursor_accent,
                theme.black,
                theme.red,
                theme.green,
                theme.yellow,
                theme.blue,
                theme.magenta,
                theme.cyan,
                theme.white,
                theme.bright_black,
                theme.bright_red,
                theme.bright_green,
                theme.bright_yellow,
                theme.bright_blue,
                theme.bright_magenta,
                theme.bright_cyan,
                theme.bright_white,
            ];
            for color in colors {
                assert!(
                    is_hex_color(color),
                    "{} uses a non-hex color: {color}",
                    theme.id
                );
            }
            assert!(
                theme.selection.contains("rgba("),
                "{} selection should be translucent",
                theme.id
            );
        }
    }

    #[test]
    fn offers_both_dark_and_light_schemes() {
        let themes = builtin_themes();
        assert!(themes.iter().any(|theme| theme.dark));
        assert!(themes.iter().any(|theme| !theme.dark));
        assert!(
            themes.iter().any(|theme| theme.id == "mobaxtauri-dark"),
            "the default dark scheme must exist"
        );
        assert!(
            themes.iter().any(|theme| theme.id == "mobaxtauri-light"),
            "the default light scheme must exist"
        );
    }
}
