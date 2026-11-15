#!/usr/bin/env python3
"""
Fish Audio TTS / 声音创建 CLI 助手
安全从 Dragon Claw 保险箱 (vault.db) 动态读取 FISH_AUDIO_API_KEY 凭证
"""
import sys
import os
import json
import argparse
import urllib.request
import urllib.parse
from datetime import datetime

OFFICIAL_VOICES = [
    {"id": "74c6aba5cbf94a15bbdc547ffce5cb38", "name": "语彤", "name_en": "Yutong", "gender": "女性", "accent": "大陆普通话", "desc": "声音清晰自然，表达利落，适合语音助手、客服和日常播报。"},
    {"id": "5d29a99739c14d4ca3e4fe42193105b2", "name": "梓轩", "name_en": "Zixuan", "gender": "男性", "accent": "大陆普通话", "desc": "声音清晰自然，表达利落，适合语音助手、客服和日常播报。"},
    {"id": "8b1b2413e55e495f82471aa2248561c3", "name": "晓彤", "name_en": "Xiaotong", "gender": "女性", "accent": "大陆普通话", "desc": "清晰明快，充满亲和力，耐心语言导师，适合教程讲解与教学辅导。"},
    {"id": "fdc29e5149ea49c7b21c2556c5f05ce2", "name": "建国", "name_en": "Jianguo", "gender": "男性", "accent": "大陆普通话 (北京)", "desc": "温和沉稳、磁性亲切，适合日常陪伴与轻松漫谈对话。"},
    {"id": "91ec588cf8ef443a9c0d5b21d0c1fa36", "name": "詩涵", "name_en": "Shihan", "gender": "女性", "accent": "台湾普通话", "desc": "聲音清晰自然，表達俐落，適合語音助理、客服和日常播報。"},
    {"id": "d675c275d1d44e57b4ef3840c5a23209", "name": "浩然", "name_en": "Haoran", "gender": "男性", "accent": "大陆普通话", "desc": "声音清晰自然，表达利落，充满活力与职场专业感。"},
    {"id": "e98fa6cdad6946bf8d9bb8f9cb8c2532", "name": "冰冰", "name_en": "Bingbing", "gender": "女性", "accent": "大陆普通话", "desc": "声音清晰自然，表达利落，适合新闻早报与专业播报。"},
    {"id": "1e85fd1e0d3e4cc2b79fbca800e7e3fe", "name": "承翰", "name_en": "Chenghan", "gender": "男性", "accent": "台湾普通话", "desc": "聲音清晰自然，表達俐落，語調溫和有禮。"},
    {"id": "ebfc2bf5a84747bab0bfcba1a6c63f79", "name": "雨薇", "name_en": "Yuwei", "gender": "女性", "accent": "台湾普通话", "desc": "温柔细腻、亲近自然，最适合情感电台、治愈陪伴与生活随谈。"},
    {"id": "e7af89da8abc4fbdacd9a10ab9881933", "name": "家豪", "name_en": "Chia-Hao", "gender": "男性", "accent": "普通话", "desc": "声音清晰自然，表达利落，适合语音助手与日常客服。"},
    {"id": "49066cb45f0a427484ade915a4474534", "name": "雅婷", "name_en": "Ya-Ting", "gender": "女性", "accent": "普通话", "desc": "声音清晰自然，表达利落，亲切自然。"},
    {"id": "e27c0811319145f7832b3c3508401ea5", "name": "柏翰", "name_en": "Bohan", "gender": "男性", "accent": "台湾普通话", "desc": "专业自信、沉着从容，最适合技术支持、专家顾问与客户服务。"}
]

def resolve_api_key():
    # 1. 环境变量
    key = os.environ.get("FISH_AUDIO_API_KEY")
    if key and key.strip():
        return key.strip()

    # 2. 从 Dragon Claw 保险箱动态读取
    candidates = [
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../bin/vault-secret.js")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../bin/vault-secret.js")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../bin/vault-secret.js")),
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                import subprocess
                for owner in ["admin", "f84300033"]:
                    res = subprocess.run(["node", c, "get", "FISH_AUDIO_API_KEY", owner], capture_output=True, text=True, timeout=5)
                    if res.returncode == 0 and res.stdout.strip():
                        return res.stdout.strip()
            except Exception:
                pass

    # 3. 本地受保护配置
    for p in [os.path.expanduser("~/.config/fish-audio/api_key"), os.path.expanduser("~/.fish_audio_key")]:
        if os.path.isfile(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    val = f.read().strip()
                    if val:
                        return val
            except Exception:
                pass

    return None

def find_voice(name_or_id):
    if not name_or_id:
        return OFFICIAL_VOICES[0]
    q = str(name_or_id).strip().lower()
    for v in OFFICIAL_VOICES:
        if v["id"] == q or v["name"].lower() == q or v["name_en"].lower() == q or q in v["name"].lower():
            return v
    return OFFICIAL_VOICES[0]

def main():
    parser = argparse.ArgumentParser(description="Fish Audio 声音合成 CLI")
    parser.add_argument("--voices", action="store_true", help="列出所有 12 款官方安全声音")
    parser.add_argument("--text", type=str, help="要合成的文字内容")
    parser.add_argument("--voice", type=str, default="语彤", help="音色名称或 reference_id（默认：语彤）")
    parser.add_argument("--format", type=str, default="mp3", choices=["mp3", "wav", "opus"], help="音频格式")
    parser.add_argument("--model", type=str, default="s2.1-pro-free", help="TTS 模型版本")
    parser.add_argument("--output", type=str, help="输出音频文件路径")

    args = parser.parse_args()

    if args.voices:
        print(json.dumps(OFFICIAL_VOICES, indent=2, ensure_ascii=False))
        return

    if not args.text:
        parser.error("请使用 --text 指定要合成的文字，或使用 --voices 查看声音列表")

    api_key = resolve_api_key()
    if not api_key:
        sys.exit("错误：未找到 FISH_AUDIO_API_KEY。请在平台「保险箱」录入该 API Key 或配置环境变量。")

    voice = find_voice(args.voice)
    payload = {
        "text": args.text.strip(),
        "reference_id": voice["id"],
        "format": args.format
    }

    req = urllib.request.Request(
        "https://api.fish.audio/v1/tts",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json; charset=utf-8",
            "model": args.model
        },
        data=json.dumps(payload).encode("utf-8")
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            audio_data = resp.read()
    except Exception as e:
        sys.exit(f"Fish Audio 请求失败: {e}")

    out_path = args.output
    if not out_path:
        default_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../outputs/audio"))
        os.makedirs(default_dir, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        out_path = os.path.join(default_dir, f"voice_{voice['name_en'].lower()}_{ts}.{args.format}")

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(audio_data)

    result = {
        "success": True,
        "voice": voice["name"],
        "voice_id": voice["id"],
        "format": args.format,
        "size_kb": round(len(audio_data) / 1024, 1),
        "output_path": os.path.abspath(out_path)
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
