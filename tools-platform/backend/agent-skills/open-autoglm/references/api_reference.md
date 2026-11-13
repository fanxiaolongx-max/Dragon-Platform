# Open-AutoGLM REST API Reference (v1)

Base URL: `https://yutang.fanxiaolong.uk`
Authentication: Include `Authorization: Bearer <API_KEY>` or `X-API-Key: <API_KEY>` in headers.

## 1. System Health
- **Method**: `GET /api/v1/health`
- **Response**:
  ```json
  {
    "status": "ok",
    "app": "Open-AutoGLM-GUI",
    "version": "1.0.0",
    "timestamp": "2026-11-14T00:00:00Z"
  }
  ```

## 2. Devices
### List Devices
- **Method**: `GET /api/v1/devices`
- **Response**:
  ```json
  {
    "devices": [
      {
        "id": "3B1QYFE32239E",
        "name": "MEIZU 20",
        "status": "online",
        "model": "MEIZU 20",
        "screen_size": "1080x2400",
        "connection_type": "usb"
      }
    ],
    "count": 1
  }
  ```

### Device Screenshot
- **Method**: `GET /api/v1/devices/{device_id}/screenshot`
- **Query Params**: `format=raw` (returns image/png binary) or `format=base64` (returns JSON).

### Device Remote Action
- **Method**: `POST /api/v1/devices/{device_id}/action`
- **Body**:
  - Tap: `{"action": "tap", "x": 500, "y": 1000}`
  - Swipe: `{"action": "swipe", "x1": 500, "y1": 1500, "x2": 500, "y2": 500, "duration_ms": 300}`
  - Text: `{"action": "text", "text": "Hello AutoGLM"}`
  - Key: `{"action": "key", "key": "home"}`
  - Shell: `{"action": "shell", "command": "dumpsys battery"}`
  - Unlock: `{"action": "unlock"}`
  - Lock: `{"action": "lock"}`

## 3. Tasks
### Run Autonomous AI Task
- **Method**: `POST /api/v1/tasks/run`
- **Body**:
  ```json
  {
    "task": "打开微信给小明发信息",
    "device_id": "optional_device_id",
    "timeout": 1800,
    "force_run": false
  }
  ```

### Query Task Status
- **Method**: `GET /api/v1/tasks/{task_id}`

### Stop Task
- **Method**: `POST /api/v1/tasks/{task_id}/stop`

### List Recent Tasks
- **Method**: `GET /api/v1/tasks?limit=10`
