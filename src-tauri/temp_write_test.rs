// 临时工具：直接写入一条 minimax 测试记录到 token_usage.jsonl
// 用于验证监控是否正确捕获
use std::path::PathBuf;
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;

fn main() {
    let data_dir = r"D:\ORD\src-tauri\target\debug\data";
    let file_path = PathBuf::from(data_dir).join("metrics").join("token_usage.jsonl");

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(async {
        // 模拟 minimax test_connection 写入
        let record = serde_json::json!({
            "ts": chrono::Utc::now().to_rfc3339(),
            "provider": "minimax",
            "model": "MiniMax-M2.5",
            "prompt_tokens": 150,
            "completion_tokens": 280,
            "total_tokens": 430,
            "source": "test_connection"
        });

        let line = serde_json::to_string(&record).unwrap();
        let dir = file_path.parent().unwrap();
        tokio::fs::create_dir_all(dir).await.unwrap();
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)
            .await
            .unwrap();
        file.write_all(format!("{}\n", line).as_bytes()).await.unwrap();
        println!("Wrote to {}", file_path.display());
        println!("Record: {}", line);

        // 再写一条不同模型
        let record2 = serde_json::json!({
            "ts": chrono::Utc::now().to_rfc3339(),
            "provider": "minimax",
            "model": "MiniMax-M2.7",
            "prompt_tokens": 80,
            "completion_tokens": 320,
            "total_tokens": 400,
            "source": "test_connection"
        });
        let line2 = serde_json::to_string(&record2).unwrap();
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)
            .await
            .unwrap();
        file.write_all(format!("{}\n", line2).as_bytes()).await.unwrap();
        println!("Record2: {}", line2);

        // 再写一条 openrouter
        let record3 = serde_json::json!({
            "ts": chrono::Utc::now().to_rfc3339(),
            "provider": "openrouter",
            "model": "google/gemini-2.0-flash-thinking-exp:free",
            "prompt_tokens": 60,
            "completion_tokens": 140,
            "total_tokens": 200,
            "source": "test_connection"
        });
        let line3 = serde_json::to_string(&record3).unwrap();
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)
            .await
            .unwrap();
        file.write_all(format!("{}\n", line3).as_bytes()).await.unwrap();
        println!("Record3: {}", line3);

        // 读回验证
        println!("\n=== 读回验证 ===");
        let content = tokio::fs::read_to_string(&file_path).await.unwrap();
        for (i, line) in content.lines().enumerate() {
            let r: serde_json::Value = serde_json::from_str(line).unwrap();
            println!("[{}] {} / {} = {} tokens (source: {})",
                i + 1,
                r["provider"],
                r["model"],
                r["total_tokens"],
                r["source"]
            );
        }
    });
}
