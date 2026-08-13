use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

const MANIFEST_FILE: &str = "bundle-manifest.json";
const MANAGED_SKILL_NAMES: &[&str] = &["kuaifan-image", "kuaifan-video"];

#[derive(Debug, Deserialize)]
struct BundleManifest {
    schema_version: u32,
    revision: String,
    content_sha256: Option<String>,
}

fn normalized_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn read_manifest(skill_dir: &Path) -> Result<BundleManifest, String> {
    let path = skill_dir.join(MANIFEST_FILE);
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("read bundled Skill manifest {}: {}", path.display(), error))?;
    let manifest: BundleManifest = serde_json::from_str(&content)
        .map_err(|error| format!("parse bundled Skill manifest {}: {}", path.display(), error))?;
    if manifest.schema_version != 1 || manifest.revision.trim().is_empty() {
        return Err(format!("invalid bundled Skill manifest {}", path.display()));
    }
    if let Some(digest) = &manifest.content_sha256 {
        if digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(format!("invalid bundled Skill digest {}", path.display()));
        }
    }
    Ok(manifest)
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("create managed Skill directory {}: {}", destination.display(), error))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("read bundled Skill directory {}: {}", source.display(), error))?
    {
        let entry = entry.map_err(|error| format!("read bundled Skill entry: {}", error))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if entry
            .file_type()
            .map_err(|error| format!("read bundled Skill entry type: {}", error))?
            .is_dir()
        {
            copy_dir_recursive(&source_path, &destination_path)?;
        } else {
            fs::copy(&source_path, &destination_path).map_err(|error| {
                format!(
                    "copy bundled Skill file {} to {}: {}",
                    source_path.display(),
                    destination_path.display(),
                    error
                )
            })?;
        }
    }
    Ok(())
}

pub fn managed_skill_root(data_dir: &Path) -> PathBuf {
    data_dir.join("bundled-skills")
}

pub fn ensure_managed_skill(resource_root: &Path, data_dir: &Path) -> Result<PathBuf, String> {
    let source_root = resource_root.join("bundled-skills");
    let destination_root = managed_skill_root(data_dir);
    fs::create_dir_all(&destination_root).map_err(|error| {
        format!(
            "create managed Skill root {}: {}",
            destination_root.display(),
            error
        )
    })?;
    for skill_name in MANAGED_SKILL_NAMES {
        let source_skill = source_root.join(skill_name);
        if !source_skill.join("SKILL.md").is_file() {
            return Err(format!("bundled Skill is missing: {}", source_skill.display()));
        }
        let source_manifest = read_manifest(&source_skill)?;
        let destination_skill = destination_root.join(skill_name);
        let already_current = read_manifest(&destination_skill)
            .map(|manifest| {
                manifest.schema_version == source_manifest.schema_version
                    && manifest.revision == source_manifest.revision
                    && manifest.content_sha256 == source_manifest.content_sha256
            })
            .unwrap_or(false);
        if already_current {
            continue;
        }

        let stage = destination_root.join(format!(".{}-stage-{}", skill_name, std::process::id()));
        let backup = destination_root.join(format!(".{}-previous-{}", skill_name, std::process::id()));
        if stage.exists() {
            fs::remove_dir_all(&stage)
                .map_err(|error| format!("clear managed Skill staging directory {}: {}", stage.display(), error))?;
        }
        if backup.exists() {
            fs::remove_dir_all(&backup)
                .map_err(|error| format!("clear managed Skill backup directory {}: {}", backup.display(), error))?;
        }

        copy_dir_recursive(&source_skill, &stage)?;
        read_manifest(&stage)?;
        if destination_skill.exists() {
            fs::rename(&destination_skill, &backup).map_err(|error| {
                format!(
                    "stage managed Skill update from {}: {}",
                    destination_skill.display(),
                    error
                )
            })?;
        }
        if let Err(error) = fs::rename(&stage, &destination_skill) {
            if backup.exists() {
                let _ = fs::rename(&backup, &destination_skill);
            }
            return Err(format!("promote managed Skill update: {}", error));
        }
        if backup.exists() {
            fs::remove_dir_all(&backup)
                .map_err(|error| format!("remove previous managed Skill {}: {}", backup.display(), error))?;
        }
    }
    Ok(destination_root)
}

pub fn bundled_skills_resource_root() -> Result<PathBuf, String> {
    let mut candidates = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources")];
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            candidates.push(directory.join("resources"));
            candidates.push(directory.join("..").join("resources"));
        }
    }
    candidates
        .into_iter()
        .find(|candidate| {
            MANAGED_SKILL_NAMES.iter().all(|skill_name| {
                candidate.join("bundled-skills").join(skill_name).is_dir()
            })
        })
        .ok_or_else(|| "bundled managed Skill resources are missing".to_string())
}

pub fn bootstrap_managed_skill(data_dir: &Path) -> Result<PathBuf, String> {
    let resource_root = bundled_skills_resource_root()?;
    ensure_managed_skill(&resource_root, data_dir)
}

pub fn register_openclaw_skill_root(config: &mut serde_json::Value, root: &Path) {
    let root = normalized_path(root);
    if !config.is_object() {
        *config = serde_json::json!({});
    }
    let config = config.as_object_mut().expect("object ensured above");
    let skills = config
        .entry("skills".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !skills.is_object() {
        *skills = serde_json::json!({});
    }
    let skills = skills.as_object_mut().expect("object ensured above");
    let load = skills
        .entry("load".to_string())
        .or_insert_with(|| serde_json::json!({}));
    if !load.is_object() {
        *load = serde_json::json!({});
    }
    let load = load.as_object_mut().expect("object ensured above");
    let extra_dirs = load
        .entry("extraDirs".to_string())
        .or_insert_with(|| serde_json::json!([]));
    if !extra_dirs.is_array() {
        *extra_dirs = serde_json::json!([]);
    }
    let extra_dirs = extra_dirs.as_array_mut().expect("array ensured above");
    if !extra_dirs.iter().any(|entry| {
        entry
            .as_str()
            .map(|value| value.replace('\\', "/") == root)
            .unwrap_or(false)
    }) {
        extra_dirs.push(serde_json::Value::String(root));
    }
}

pub fn register_hermes_skill_root(config: &mut serde_yaml::Mapping, root: &Path) {
    let root = normalized_path(root);
    let skills_key = serde_yaml::Value::String("skills".into());
    let skills = config
        .entry(skills_key)
        .or_insert_with(|| serde_yaml::Value::Mapping(Default::default()));
    if !skills.is_mapping() {
        *skills = serde_yaml::Value::Mapping(Default::default());
    }
    let skills = skills.as_mapping_mut().expect("mapping ensured above");
    let dirs_key = serde_yaml::Value::String("external_dirs".into());
    let external_dirs = skills
        .entry(dirs_key)
        .or_insert_with(|| serde_yaml::Value::Sequence(Vec::new()));
    if !external_dirs.is_sequence() {
        *external_dirs = serde_yaml::Value::Sequence(Vec::new());
    }
    let external_dirs = external_dirs.as_sequence_mut().expect("sequence ensured above");
    if !external_dirs.iter().any(|entry| {
        entry
            .as_str()
            .map(|value| value.replace('\\', "/") == root)
            .unwrap_or(false)
    }) {
        external_dirs.push(serde_yaml::Value::String(root));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    fn write_bundled_skill(resources: &Path, revision: &str) {
        for skill_name in MANAGED_SKILL_NAMES {
            let skill_dir = resources.join("bundled-skills").join(skill_name);
            fs::create_dir_all(skill_dir.join("scripts")).unwrap();
            fs::write(skill_dir.join("SKILL.md"), format!("---\nname: {}\n---\n", skill_name)).unwrap();
            fs::write(skill_dir.join("scripts").join("skill.py"), "print('skill')\n").unwrap();
            fs::write(
                skill_dir.join("bundle-manifest.json"),
                format!(
                    "{{\"schema_version\":1,\"revision\":\"{}\",\"content_sha256\":\"{}\"}}",
                    revision,
                    "0".repeat(64)
                ),
            )
            .unwrap();
        }
    }

    #[test]
    fn managed_skill_bootstrap_installs_only_its_own_directory() {
        let temp = tempfile::tempdir().unwrap();
        let resources = temp.path().join("resources");
        let data = temp.path().join("data");
        write_bundled_skill(&resources, "1");
        let user_skill = data.join("bundled-skills").join("user-skill").join("SKILL.md");
        fs::create_dir_all(user_skill.parent().unwrap()).unwrap();
        fs::write(&user_skill, "user managed").unwrap();

        let root = ensure_managed_skill(&resources, &data).unwrap();

        assert_eq!(root, data.join("bundled-skills"));
        assert!(root.join("kuaifan-image").join("SKILL.md").is_file());
        assert!(root.join("kuaifan-video").join("SKILL.md").is_file());
        assert_eq!(fs::read_to_string(user_skill).unwrap(), "user managed");
    }

    #[test]
    fn managed_skill_registration_preserves_unrelated_entries() {
        let root = Path::new("D:/data/bundled-skills");
        let mut openclaw = serde_json::json!({
            "skills": { "load": { "extraDirs": ["D:/custom-skills"] } }
        });
        register_openclaw_skill_root(&mut openclaw, root);
        register_openclaw_skill_root(&mut openclaw, root);
        let extra_dirs = openclaw
            .pointer("/skills/load/extraDirs")
            .and_then(serde_json::Value::as_array)
            .unwrap();
        assert_eq!(extra_dirs.len(), 2);
        assert!(extra_dirs.iter().any(|entry| entry == "D:/custom-skills"));
        assert!(extra_dirs.iter().any(|entry| entry == "D:/data/bundled-skills"));

        let mut hermes = serde_yaml::from_str::<serde_yaml::Value>(
            "providers:\n  existing:\n    api: https://example.test/v1\n",
        )
        .unwrap()
        .as_mapping()
        .cloned()
        .unwrap();
        register_hermes_skill_root(&mut hermes, root);
        register_hermes_skill_root(&mut hermes, root);
        let external_dirs = hermes
            .get(serde_yaml::Value::String("skills".into()))
            .and_then(serde_yaml::Value::as_mapping)
            .and_then(|skills| skills.get(serde_yaml::Value::String("external_dirs".into())))
            .and_then(serde_yaml::Value::as_sequence)
            .unwrap();
        assert_eq!(external_dirs.len(), 1);
        assert_eq!(external_dirs[0].as_str(), Some("D:/data/bundled-skills"));
        assert!(hermes.contains_key(serde_yaml::Value::String("providers".into())));
    }

    #[test]
    fn managed_skill_bootstrap_installs_every_managed_skill() {
        let temp = tempfile::tempdir().unwrap();
        let resources = temp.path().join("resources");
        let data = temp.path().join("data");
        write_bundled_skill(&resources, "2");

        let root = ensure_managed_skill(&resources, &data).unwrap();

        for skill_name in MANAGED_SKILL_NAMES {
            assert!(root.join(skill_name).join("SKILL.md").is_file());
            assert!(root.join(skill_name).join(MANIFEST_FILE).is_file());
        }
    }
}
