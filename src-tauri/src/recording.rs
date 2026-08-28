const MAX_LINES: usize = 1000;
const MAX_COLUMNS: usize = 160;

pub async fn export_svg(path: String, title: String, lines: Vec<String>) -> Result<(), String> {
    let svg = render_svg(&title, &lines);
    tokio::fs::write(path, svg)
        .await
        .map_err(|error| format!("Failed to write terminal recording: {error}"))
}

fn escape_xml(value: &str) -> String {
    value
        .chars()
        .filter(|character| matches!(*character, '\t' | '\n' | '\r') || *character >= '\u{20}')
        .flat_map(|character| match character {
            '&' => "&amp;".chars().collect::<Vec<_>>(),
            '<' => "&lt;".chars().collect(),
            '>' => "&gt;".chars().collect(),
            '"' => "&quot;".chars().collect(),
            _ => vec![character],
        })
        .collect()
}

fn render_svg(title: &str, recorded_lines: &[String]) -> String {
    let lines = recorded_lines
        .iter()
        .rev()
        .take(MAX_LINES)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
    let height = std::cmp::max(120, 56 + lines.len() * 18);
    let mut text = String::new();

    for (index, line) in lines.iter().enumerate() {
        let truncated: String = line.chars().take(MAX_COLUMNS).collect();
        let escaped = escape_xml(&truncated);
        let content = if escaped.is_empty() { " " } else { &escaped };
        text.push_str(&format!(
            "<text x=\"20\" y=\"{}\">{content}</text>",
            44 + index * 18
        ));
    }

    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1200\" height=\"{height}\" viewBox=\"0 0 1200 {height}\"><rect width=\"100%\" height=\"100%\" fill=\"#0f172a\"/><style>text{{font:14px 'Cascadia Code',monospace;fill:#f1f5f9;white-space:pre}}</style><text x=\"20\" y=\"24\" fill=\"#38bdf8\">{}</text>{text}</svg>",
        escape_xml(title)
    )
}

#[cfg(test)]
mod tests {
    use super::{escape_xml, render_svg};

    #[test]
    fn escapes_markup_and_removes_invalid_controls() {
        assert_eq!(escape_xml("<&\"\u{0007}>"), "&lt;&amp;&quot;&gt;");
    }

    #[test]
    fn renders_a_safe_svg_transcript() {
        let svg = render_svg("Production & API", &["echo <ready>".into()]);

        assert!(svg.contains("Production &amp; API"));
        assert!(svg.contains("echo &lt;ready&gt;"));
        assert!(svg.starts_with("<svg"));
    }
}
