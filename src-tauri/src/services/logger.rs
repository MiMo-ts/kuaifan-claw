// 日志服务
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

#[allow(dead_code)]
pub fn init_logger(log_dir: &str, level: &str) -> anyhow::Result<()> {
    std::fs::create_dir_all(log_dir)?;
    let file_appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_suffix("app.log")
        .build(log_dir)?;
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
    std::mem::forget(_guard);

    let filter = match level {
        "DEBUG" => EnvFilter::from_default_env().add_directive(tracing::Level::DEBUG.into()),
        "WARN" => EnvFilter::from_default_env().add_directive(tracing::Level::WARN.into()),
        "ERROR" => EnvFilter::from_default_env().add_directive(tracing::Level::ERROR.into()),
        _ => EnvFilter::from_default_env().add_directive(tracing::Level::INFO.into()),
    };

    tracing_subscriber::registry()
        .with(fmt::layer().with_writer(non_blocking).with_ansi(false))
        .with(filter)
        .init();
    Ok(())
}
