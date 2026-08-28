use crate::ssh::ClientHandler;
use serde::Serialize;
use std::sync::Arc;
use tokio::io::AsyncReadExt;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct HealthSnapshot {
    pub cpu: f32,
    pub ram: f32,
    pub ram_used: f32,
    pub ram_total: f32,
    pub swap: f32,
    pub swap_used: f32,
    pub swap_total: f32,
    pub disk: f32,
}

pub async fn collect_health(
    handle: Arc<russh::client::Handle<ClientHandler>>,
) -> Result<HealthSnapshot, String> {
    let exec_channel = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        handle.channel_open_session(),
    )
    .await
    .map_err(|_| "Timed out opening health channel".to_string())?
    .map_err(|error| format!("Failed to open health channel: {error}"))?;

    let command = "set -- $(awk '/^cpu /{print $2+$4,$2+$4+$5+$6+$7+$8+$9}' /proc/stat); busy1=$1; total1=$2; sleep 1; set -- $(awk '/^cpu /{print $2+$4,$2+$4+$5+$6+$7+$8+$9}' /proc/stat); busy2=$1; total2=$2; awk -v b1=$busy1 -v t1=$total1 -v b2=$busy2 -v t2=$total2 'BEGIN{d=b2-b1; t=t2-t1; if(t>0) print (d/t)*100; else print 0}'; free -m | awk '/Mem:/{print $3,$2}'; free -m | awk '/Swap:/{print $3,$2}'; df -h / | tail -1 | awk '{print $5}' | sed 's/%//'";

    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        exec_channel.exec(true, command),
    )
    .await
    .map_err(|_| "Timed out starting health command".to_string())?
    .map_err(|error| format!("Failed to exec health command: {error}"))?;

    let mut output = String::new();
    let mut stream = exec_channel.into_stream();
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        stream.read_to_string(&mut output),
    )
    .await
    .map_err(|_| "Health check timed out".to_string())?
    .map_err(|error| format!("Failed to read health output: {error}"))?;

    parse_health_output(&output)
}

fn parse_pair(line: &str) -> Option<(f32, f32)> {
    let mut values = line.split_whitespace();
    let used = values.next()?.parse().ok()?;
    let total = values.next()?.parse().ok()?;
    Some((used, total))
}

fn percentage(used: f32, total: f32) -> f32 {
    if total > 0.0 {
        (used / total) * 100.0
    } else {
        0.0
    }
}

pub fn parse_health_output(output: &str) -> Result<HealthSnapshot, String> {
    let lines: Vec<&str> = output.lines().collect();
    if lines.len() < 4 {
        return Err(format!("Unexpected health output: {output}"));
    }

    let load = lines[0].parse::<f32>().unwrap_or(0.0);
    let (ram_used, ram_total) = parse_pair(lines[1]).unwrap_or((0.0, 0.0));
    let (swap_used, swap_total) = parse_pair(lines[2]).unwrap_or((0.0, 0.0));

    Ok(HealthSnapshot {
        cpu: (load * 100.0).clamp(0.0, 100.0),
        ram: percentage(ram_used, ram_total),
        ram_used,
        ram_total,
        swap: percentage(swap_used, swap_total),
        swap_used,
        swap_total,
        disk: lines[3].parse::<f32>().unwrap_or(0.0),
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_health_output, HealthSnapshot};

    #[test]
    fn parses_linux_health_output() {
        assert_eq!(
            parse_health_output("0.42\n512 1024\n128 512\n75\n"),
            Ok(HealthSnapshot {
                cpu: 42.0,
                ram: 50.0,
                ram_used: 512.0,
                ram_total: 1024.0,
                swap: 25.0,
                swap_used: 128.0,
                swap_total: 512.0,
                disk: 75.0,
            })
        );
    }

    #[test]
    fn handles_hosts_without_swap() {
        let health = parse_health_output("2.0\n256 1024\n0 0\n10\n")
            .expect("valid health output should parse");

        assert_eq!(health.cpu, 100.0);
        assert_eq!(health.swap, 0.0);
    }

    #[test]
    fn rejects_incomplete_output() {
        assert!(parse_health_output("0.5\n100 200\n").is_err());
    }
}
