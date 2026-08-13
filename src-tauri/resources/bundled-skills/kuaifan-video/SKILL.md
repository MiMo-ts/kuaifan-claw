---
name: kuaifan-video
description: Use when the user explicitly asks to create, generate, animate, or make a video through Kuaifan Seedance, including Chinese requests such as 生视频, 生成视频, 文生视频, 图生视频, 视频生成, 使用豆包生成视频, or 请使用豆包帮我生成一段视频.
---

# Kuaifan Video

Use this Skill only for an explicit video result. Do not use it for video
analysis, video scripts, or a request that only mentions Doubao or Seedance.

## Required Conversation

Before calling the script, complete these two questions in order. Do not assume
defaults and do not submit a task until both answers are explicit.

1. Ask the user to select one model:
   - doubao-seedance-2-0-260128: Seedance Standard
   - doubao-seedance-2-0-mini-260615: Seedance Mini
2. After the model is selected, ask the user to choose one resolution:
   480p, 720p, or 1080p.

Keep the user prompt unchanged except for necessary clarification.

## Image-To-Video Sources

For image-to-video, pass each local attachment or public image URL as `--source`
(same pattern as kuaifan-image). Local paths are read from disk and encoded as
data URLs. Public references must be HTTPS. Legacy `--image-url` remains an
alias for a single HTTPS URL.

Prefer the user's attached local image path when present. Do not ask the user
to re-upload a file that is already available as a local attachment path.

## Configuration

The app configures the Kuaifan Provider URL and API Key once. This Skill reads
the active runtime configuration and calls <baseUrl>/video/generations; never
send a Seedance model to /chat/completions. Never put keys in prompts, command
arguments, logs, or replies.

## Generate

Resolve <SKILL_DIR> to the absolute directory containing this SKILL.md.
Run the bundled script by absolute path. It submits the task, polls until its
terminal state, downloads the MP4, and stores it under the active runtime's
managed media directory.

~~~powershell
python "<SKILL_DIR>\scripts\kuaifan_video.py" --runtime openclaw --prompt "A paper boat sailing through a rainy city, cinematic" --model "doubao-seedance-2-0-260128" --resolution "720p"
~~~

Image-to-video with a local attachment path:

~~~powershell
python "<SKILL_DIR>\scripts\kuaifan_video.py" --runtime hermes --prompt "Make this scene come alive with gentle camera motion" --source "C:\Users\me\Pictures\reference.jpeg" --model "doubao-seedance-2-0-mini-260615" --resolution "720p"
~~~

Image-to-video with a public HTTPS image:

~~~powershell
python "<SKILL_DIR>\scripts\kuaifan_video.py" --runtime hermes --prompt "Make this scene come alive with gentle camera motion" --source "https://example.com/reference.jpeg" --model "doubao-seedance-2-0-mini-260615" --resolution "720p"
~~~

## Output Contract

On success the client prints one JSON artifact. OpenClaw then receives exactly
one MEDIA:<absolute-path>.mp4 line. Hermes receives only the JSON artifact;
its existing gateway validates the managed video_path and sends a native video
attachment. Do not manually send the same file again.

~~~json
{
  "artifact": "kuaifan-video/v1",
  "mode": "text_to_video",
  "video_path": "C:/managed/media/kuaifan-video/result.mp4",
  "task_id": "task_...",
  "model": "doubao-seedance-2-0-260128",
  "resolution": "720p"
}
~~~
