#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Open-AutoGLM Standalone Client SDK & CLI.
Zero external dependencies (uses standard library urllib and json).
Generated for: https://yutang.fanxiaolong.uk
"""

import os
import sys
import json
import time
import argparse
import urllib.request
import urllib.error
import urllib.parse
from typing import Optional, Dict, Any, List

DEFAULT_BASE_URL = "https://yutang.fanxiaolong.uk"
DEFAULT_API_KEY = "ak_autoglm_0OBKNPasZ6yvBV4zT_5lYieMsrw7nXHczbn-P1K4qj8"


class AutoGLMClient:
    """Client for Open-AutoGLM Web & Agent API."""

    def __init__(self, base_url: Optional[str] = None, api_key: Optional[str] = None):
        self.base_url = (
            base_url
            or os.environ.get("AUTOGLM_BASE_URL")
            or DEFAULT_BASE_URL
        ).rstrip("/")
        self.api_key = (
            api_key
            or os.environ.get("AUTOGLM_API_KEY")
            or DEFAULT_API_KEY
        ).strip()

    def _request(
        self,
        method: str,
        path: str,
        data: Optional[Dict[str, Any]] = None,
        raw_response: bool = False,
    ) -> Any:
        url = f"{self.base_url}{path}"
        headers = {
            "User-Agent": "Open-AutoGLM-Client/1.0",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
            headers["X-API-Key"] = self.api_key

        payload = None
        if data is not None:
            headers["Content-Type"] = "application/json"
            payload = json.dumps(data).encode("utf-8")

        req = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                if raw_response:
                    return resp.read()
                charset = resp.headers.get_content_charset() or "utf-8"
                text = resp.read().decode(charset)
                return json.loads(text) if text else {}
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="ignore")
            try:
                err_json = json.loads(err_body)
                msg = err_json.get("detail", err_json.get("message", err_body))
            except Exception:
                msg = err_body
            raise RuntimeError(f"HTTP {exc.code}: {msg}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Failed to connect to {self.base_url}: {exc.reason}") from exc

    def health(self) -> Dict[str, Any]:
        """Check server health and connectivity."""
        return self._request("GET", "/api/v1/health")

    def get_devices(self) -> List[Dict[str, Any]]:
        """List all connected Android devices."""
        res = self._request("GET", "/api/v1/devices")
        return res.get("devices", [])

    def get_device(self, device_id: str) -> Dict[str, Any]:
        """Get details of a specific device."""
        return self._request("GET", f"/api/v1/devices/{device_id}")

    def get_screenshot(
        self,
        device_id: Optional[str] = None,
        save_path: Optional[str] = None,
    ) -> bytes:
        """Capture screenshot from device (as bytes or save to disk)."""
        if not device_id:
            devs = self.get_devices()
            if not devs:
                raise RuntimeError("No connected devices found")
            device_id = devs[0]["id"]
        img_bytes = self._request("GET", f"/api/v1/devices/{device_id}/screenshot", raw_response=True)
        if save_path:
            with open(save_path, "wb") as f:
                f.write(img_bytes)
        return img_bytes

    def get_screenshot_base64(self, device_id: Optional[str] = None) -> str:
        """Capture screenshot as base64 string."""
        if not device_id:
            devs = self.get_devices()
            if not devs:
                raise RuntimeError("No connected devices found")
            device_id = devs[0]["id"]
        res = self._request("GET", f"/api/v1/devices/{device_id}/screenshot?format=base64")
        return res.get("image", "")

    def execute_action(
        self,
        action: str,
        device_id: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Execute a remote device action (tap, swipe, text, key, shell, unlock, lock)."""
        if not device_id:
            devs = self.get_devices()
            if not devs:
                raise RuntimeError("No connected devices found")
            device_id = devs[0]["id"]
        payload = {"action": action, **kwargs}
        return self._request("POST", f"/api/v1/devices/{device_id}/action", data=payload)

    def tap(self, x: int, y: int, device_id: Optional[str] = None) -> Dict[str, Any]:
        """Tap at screen coordinates (x, y)."""
        return self.execute_action("tap", device_id=device_id, x=x, y=y)

    def swipe(
        self,
        x1: int,
        y1: int,
        x2: int,
        y2: int,
        duration_ms: int = 300,
        device_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Swipe from (x1, y1) to (x2, y2)."""
        return self.execute_action(
            "swipe",
            device_id=device_id,
            x1=x1,
            y1=y1,
            x2=x2,
            y2=y2,
            duration_ms=duration_ms,
        )

    def text(self, text_content: str, device_id: Optional[str] = None) -> Dict[str, Any]:
        """Input text to the focused field."""
        return self.execute_action("text", device_id=device_id, text=text_content)

    def key(self, key_name: str, device_id: Optional[str] = None) -> Dict[str, Any]:
        """Send keyevent (e.g. 'home', 'back', 'enter', 'power', or keycode)."""
        return self.execute_action("key", device_id=device_id, key=key_name)

    def shell(self, command: str, device_id: Optional[str] = None) -> Dict[str, Any]:
        """Execute ADB shell command on the device."""
        return self.execute_action("shell", device_id=device_id, command=command)

    def run_task(
        self,
        task_instruction: str,
        device_id: Optional[str] = None,
        wait: bool = False,
        timeout: int = 1800,
        force_run: bool = False,
    ) -> Dict[str, Any]:
        """Submit an autonomous AutoGLM AI task."""
        payload = {
            "task": task_instruction,
            "device_id": device_id,
            "timeout": timeout,
            "force_run": force_run,
        }
        res = self._request("POST", "/api/v1/tasks/run", data=payload)
        task_id = res.get("task_id")
        if not wait or not task_id:
            return res

        print(f"Task submitted (ID: {task_id}). Monitoring progress...", file=sys.stderr)
        start_t = time.time()
        last_log_idx = 0
        while time.time() - start_t < timeout:
            status_data = self.get_task(task_id)
            status = status_data.get("status", "")
            logs = status_data.get("latest_logs", [])
            while last_log_idx < len(logs):
                print(f"[AutoGLM] {logs[last_log_idx]}", file=sys.stderr)
                last_log_idx += 1

            if status in ("completed", "success", "failed", "stopped", "interrupted"):
                return status_data
            time.sleep(2)
        return self.get_task(task_id)

    def get_task(self, task_id: str) -> Dict[str, Any]:
        """Get task status and logs by task ID."""
        return self._request("GET", f"/api/v1/tasks/{task_id}")

    def stop_task(self, task_id: str) -> Dict[str, Any]:
        """Stop a running task."""
        return self._request("POST", f"/api/v1/tasks/{task_id}/stop")

    def list_tasks(self, limit: int = 10) -> List[Dict[str, Any]]:
        """List recent tasks."""
        res = self._request("GET", f"/api/v1/tasks?limit={limit}")
        return res.get("tasks", [])


def main():
    parser = argparse.ArgumentParser(description="Open-AutoGLM CLI & Agent Tool")
    parser.add_argument("--base-url", default=None, help=f"Server base URL (default: {DEFAULT_BASE_URL})")
    parser.add_argument("--api-key", default=None, help="API Key")

    subparsers = parser.add_subparsers(dest="command", required=True)

    # health
    subparsers.add_parser("health", help="Check server health")

    # devices
    subparsers.add_parser("devices", help="List connected Android devices")

    # screenshot
    p_screen = subparsers.add_parser("screenshot", help="Capture device screenshot")
    p_screen.add_argument("--device", help="Device ID / serial")
    p_screen.add_argument("--out", default="screenshot.png", help="Output file path (default: screenshot.png)")

    # tap
    p_tap = subparsers.add_parser("tap", help="Tap screen coordinates")
    p_tap.add_argument("x", type=int, help="X coordinate")
    p_tap.add_argument("y", type=int, help="Y coordinate")
    p_tap.add_argument("--device", help="Device ID")

    # swipe
    p_swipe = subparsers.add_parser("swipe", help="Swipe gesture")
    p_swipe.add_argument("x1", type=int)
    p_swipe.add_argument("y1", type=int)
    p_swipe.add_argument("x2", type=int)
    p_swipe.add_argument("y2", type=int)
    p_swipe.add_argument("--duration", type=int, default=300, help="Duration in ms")
    p_swipe.add_argument("--device", help="Device ID")

    # text
    p_text = subparsers.add_parser("text", help="Input text into current field")
    p_text.add_argument("content", help="Text to input")
    p_text.add_argument("--device", help="Device ID")

    # key
    p_key = subparsers.add_parser("key", help="Send key event (home, back, enter, power, etc.)")
    p_key.add_argument("key_name", help="Key name or keycode")
    p_key.add_argument("--device", help="Device ID")

    # shell
    p_shell = subparsers.add_parser("shell", help="Execute ADB shell command")
    p_shell.add_argument("cmd", help="Shell command to execute")
    p_shell.add_argument("--device", help="Device ID")

    # run
    p_run = subparsers.add_parser("run", help="Run autonomous AI task")
    p_run.add_argument("instruction", help="Task description in natural language")
    p_run.add_argument("--device", help="Device ID")
    p_run.add_argument("--wait", action="store_true", help="Wait for task to complete")
    p_run.add_argument("--timeout", type=int, default=1800, help="Timeout in seconds")
    p_run.add_argument("--force", action="store_true", help="Force interrupt active tasks")

    # status
    p_status = subparsers.add_parser("status", help="Query task status")
    p_status.add_argument("task_id", help="Task ID")

    # stop
    p_stop = subparsers.add_parser("stop", help="Stop task")
    p_stop.add_argument("task_id", help="Task ID")

    # list-tasks
    p_tasks = subparsers.add_parser("list-tasks", help="List recent tasks")
    p_tasks.add_argument("--limit", type=int, default=10)

    args = parser.parse_args()
    client = AutoGLMClient(base_url=args.base_url, api_key=args.api_key)

    try:
        if args.command == "health":
            res = client.health()
            print(json.dumps(res, indent=2, ensure_ascii=False))
        elif args.command == "devices":
            devs = client.get_devices()
            if not devs:
                print("No connected Android devices.")
            else:
                print(f"Connected devices ({len(devs)}):")
                for d in devs:
                    print(f"  - [{d.get('id')}] {d.get('name')} (Status: {d.get('status')}, Model: {d.get('model')}, Res: {d.get('screen_size')})")
        elif args.command == "screenshot":
            client.get_screenshot(device_id=args.device, save_path=args.out)
            print(f"Screenshot saved to {args.out}")
        elif args.command == "tap":
            res = client.tap(args.x, args.y, device_id=args.device)
            print(json.dumps(res, indent=2, ensure_ascii=False))
        elif args.command == "swipe":
            res = client.swipe(args.x1, args.y1, args.x2, args.y2, duration_ms=args.duration, device_id=args.device)
            print(json.dumps(res, indent=2, ensure_ascii=False))
        elif args.command == "text":
            res = client.text(args.content, device_id=args.device)
            print(json.dumps(res, indent=2, ensure_ascii=False))
        elif args.command == "key":
            res = client.key(args.key_name, device_id=args.device)
            print(json.dumps(res, indent=2, ensure_ascii=False))
        elif args.command == "shell":
            res = client.shell(args.cmd, device_id=args.device)
            print(json.dumps(res, indent=2, ensure_ascii=False))
        elif args.command == "run":
            res = client.run_task(args.instruction, device_id=args.device, wait=args.wait, timeout=args.timeout, force_run=args.force)
            print(json.dumps(res, indent=2, ensure_ascii=False))
        elif args.command == "status":
            res = client.get_task(args.task_id)
            print(json.dumps(res, indent=2, ensure_ascii=False))
        elif args.command == "stop":
            res = client.stop_task(args.task_id)
            print(json.dumps(res, indent=2, ensure_ascii=False))
        elif args.command == "list-tasks":
            res = client.list_tasks(limit=args.limit)
            print(json.dumps(res, indent=2, ensure_ascii=False))
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
