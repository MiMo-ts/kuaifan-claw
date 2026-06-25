use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
pub struct AuthUserResponse {
    pub id: i32,
    pub username: String,
    pub display_name: String,
    pub role: i32,
    pub status: i32,
    pub group: String,
    pub quota: i32,
    pub used_quota: i32,
    pub request_count: i32,
    pub email: Option<String>,
    pub aff_code: Option<String>,
}

impl From<crate::services::auth::UserInfo> for AuthUserResponse {
    fn from(u: crate::services::auth::UserInfo) -> Self {
        Self {
            id: u.id, username: u.username, display_name: u.display_name,
            role: u.role, status: u.status, group: u.group,
            quota: u.quota, used_quota: u.used_quota, request_count: u.request_count,
            email: u.email, aff_code: u.aff_code,
        }
    }
}

#[tauri::command]
pub fn login(api_url: String, username: String, password: String, data_dir: String) -> Result<AuthUserResponse, String> {
    let dir = PathBuf::from(data_dir);
    let user = crate::services::auth::login(&api_url, &username, &password, &dir)?;
    Ok(user.into())
}

#[tauri::command]
pub fn register(api_url: String, username: String, password: String, display_name: String, data_dir: String) -> Result<AuthUserResponse, String> {
    let dir = PathBuf::from(data_dir);
    let user = crate::services::auth::register(&api_url, &username, &password, &display_name, &dir)?;
    Ok(user.into())
}

#[tauri::command]
pub fn logout(api_url: String, data_dir: String) -> Result<(), String> {
    crate::services::auth::logout(&api_url, &PathBuf::from(data_dir))
}

#[tauri::command]
pub fn get_self(api_url: String, data_dir: String) -> Result<AuthUserResponse, String> {
    let user = crate::services::auth::get_self(&api_url, &PathBuf::from(data_dir))?;
    Ok(user.into())
}

#[tauri::command]
pub fn check_auth(data_dir: String) -> Result<bool, String> {
    match crate::services::auth::load_session(&PathBuf::from(data_dir)) {
        Ok(Some(_)) => Ok(true),
        Ok(None) => Ok(false),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub fn save_api_key(data_dir: String, api_key: String) -> Result<(), String> {
    let dir = PathBuf::from(data_dir);
    let mut session = crate::services::auth::load_session(&dir)?.ok_or("未登录")?;
    session.api_key = api_key;
    crate::services::auth::save_session(&dir, &session)
}

#[tauri::command]
pub fn get_user_id(data_dir: String) -> Result<i32, String> {
    let dir = PathBuf::from(data_dir);
    crate::services::auth::load_session(&dir)?.map(|s| s.user.id).ok_or("未登录".into())
}
