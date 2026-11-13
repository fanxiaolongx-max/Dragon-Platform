#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Open-AutoGLM Model Context Protocol (MCP) Standard Server.
Provides native Tools to any MCP-compliant Agent (Dragon Claw, Claude Desktop, Antigravity, Cursor).
Zero external dependencies (uses standard library JSON-RPC over stdio).
Pre-configured for: https://yutang.fanxiaolong.uk
"""

import sys
import json
import os
import urllib.request
import urllib.error

DEFAULT_BASE_URL = "https://yutang.fanxiaolong.uk"
DEFAULT_API_KEY = "ak_autoglm_0OBKNPasZ6yvBV4zT_5lYieMsrw7nXHczbn-P1K4qj8"

BASE_URL = os.environ.get("AUTOGLM_BASE_URL", DEFAULT_BASE_URL).rstrip("/")
API_KEY = os.environ.get("AUTOGLM_API_KEY", DEFAULT_API_KEY).strip()


def api_request(method: str, path: str, data: dict = None) -> dict:
    url = f"{BASE_URL}{path}"
    headers = {
        "User-Agent": "Open-AutoGLM-MCP/1.0",
    }
    if API_KEY:
        headers["Authorization"] = f"Bearer {API_KEY}"
        headers["X-API-Key"] = API_KEY

    payload = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        payload = json.dumps(data).encode("utf-8")

    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", errors="ignore")
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="ignore")
        try:
            err_json = json.loads(err_body)
            msg = err_json.get("detail", err_json.get("message", err_body))
        except Exception:
            msg = err_body
        raise RuntimeError(f"HTTP {exc.code}: {msg}")
    except Exception as exc:
        raise RuntimeError(f"Failed to connect to {BASE_URL}: {exc}")


TOOLS = [
    {
        "name": "open_autoglm_list_devices",
        "description": "List all connected Android devices with online status, model name, and screen size.",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "open_autoglm_get_screenshot",
        "description": "Capture the real-time screen of the Android device and return base64 image data.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "device_id": {
                    "type": "string",
                    "description": "Target device serial ID (optional, defaults to first online device)",
                },
            },
        },
    },
    {
        "name": "open_autoglm_run_task",
        "description": "Submit an autonomous AI phone operation task in natural language (e.g. '打开微信发朋友圈', '打开设置查看版本号').",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "Natural language instruction for AutoGLM",
                },
                "device_id": {
                    "type": "string",
                    "description": "Target device serial ID (optional)",
                },
            },
            "required": ["task"],
        },
    },
    {
        "name": "open_autoglm_device_action",
        "description": "Perform low-level touch, gesture, or key on the device: tap(x, y), swipe(x1, y1, x2, y2), text(content), key(home/back/enter/power), shell(command).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["tap", "swipe", "text", "key", "shell", "unlock", "lock"],
                    "description": "Action type",
                },
                "x": {"type": "integer", "description": "X coordinate for tap"},
                "y": {"type": "integer", "description": "Y coordinate for tap"},
                "x1": {"type": "integer", "description": "Swipe start X"},
                "y1": {"type": "integer", "description": "Swipe start Y"},
                "x2": {"type": "integer", "description": "Swipe end X"},
                "y2": {"type": "integer", "description": "Swipe end Y"},
                "duration_ms": {"type": "integer", "default": 300},
                "text": {"type": "string", "description": "Text to type"},
                "key": {"type": "string", "description": "Key name (home, back, enter, power)"},
                "command": {"type": "string", "description": "ADB shell command"},
                "device_id": {"type": "string", "description": "Target device ID (optional)"},
            },
            "required": ["action"],
        },
    },
    {
        "name": "open_autoglm_task_status",
        "description": "Query the execution progress and logs of an autonomous AutoGLM task by task_id.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "string",
                    "description": "Task ID returned from open_autoglm_run_task",
                },
            },
            "required": ["task_id"],
        },
    },
]


def handle_tool_call(name: str, args: dict) -> list:
    if name == "open_autoglm_list_devices":
        res = api_request("GET", "/api/v1/devices")
        return [{"type": "text", "text": json.dumps(res, indent=2, ensure_ascii=False)}]

    elif name == "open_autoglm_get_screenshot":
        device_id = args.get("device_id")
        if not device_id:
            devs = api_request("GET", "/api/v1/devices").get("devices", [])
            if not devs:
                return [{"type": "text", "text": "Error: No connected Android devices found."}]
            device_id = devs[0]["id"]
        res = api_request("GET", f"/api/v1/devices/{device_id}/screenshot?format=base64")
        img_b64 = res.get("image", "")
        if not img_b64:
            return [{"type": "text", "text": "Failed to capture screenshot."}]
        return [
            {"type": "text", "text": f"Screenshot captured from device {device_id}."},
            {"type": "image", "data": img_b64, "mimeType": "image/png"},
        ]

    elif name == "open_autoglm_run_task":
        res = api_request("POST", "/api/v1/tasks/run", data=args)
        return [{"type": "text", "text": json.dumps(res, indent=2, ensure_ascii=False)}]

    elif name == "open_autoglm_device_action":
        device_id = args.get("device_id")
        if not device_id:
            devs = api_request("GET", "/api/v1/devices").get("devices", [])
            if not devs:
                return [{"type": "text", "text": "Error: No connected Android devices found."}]
            device_id = devs[0]["id"]
        res = api_request("POST", f"/api/v1/devices/{device_id}/action", data=args)
        return [{"type": "text", "text": json.dumps(res, indent=2, ensure_ascii=False)}]

    elif name == "open_autoglm_task_status":
        task_id = args.get("task_id")
        res = api_request("GET", f"/api/v1/tasks/{task_id}")
        return [{"type": "text", "text": json.dumps(res, indent=2, ensure_ascii=False)}]

    else:
        raise ValueError(f"Unknown tool: {name}")


def main():
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            continue

        method = req.get("method")
        msg_id = req.get("id")

        if method == "initialize":
            res = {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "open-autoglm-mcp", "version": "1.0.0"},
                },
            }
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        elif method == "notifications/initialized":
            # No reply needed
            pass

        elif method == "tools/list":
            res = {
                "jsonrpc": "2.0",
                "id": msg_id,
                "result": {"tools": TOOLS},
            }
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        elif method == "tools/call":
            params = req.get("params", {})
            name = params.get("name")
            args = params.get("arguments", {})
            try:
                content = handle_tool_call(name, args)
                res = {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": {"content": content},
                }
            except Exception as exc:
                res = {
                    "jsonrpc": "2.0",
                    "id": msg_id,
                    "result": {
                        "content": [{"type": "text", "text": f"Error: {exc}"}],
                        "isError": True,
                    },
                }
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()

        elif msg_id is not None:
            # Fallback for unhandled methods
            res = {
                "jsonrpc": "2.0",
                "id": msg_id,
                "error": {"code": -32601, "message": "Method not found"},
            }
            sys.stdout.write(json.dumps(res) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
