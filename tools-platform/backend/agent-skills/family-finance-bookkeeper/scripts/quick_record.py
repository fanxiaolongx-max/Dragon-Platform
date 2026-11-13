#!/usr/bin/env python3
"""
WISE Family Finance Bookkeeper CLI Helper
"""
import sys
import os
import json
import urllib.request
import urllib.parse
from datetime import datetime

BASE_URL = "https://wise.fanxiaolong.uk"

def get_api_key():
    # 1. 优先从环境变量读取
    key = os.environ.get("WISE_API_KEY")
    if key and key.strip():
        return key.strip()
    # 2. 从本地受保护的文件读取（权限 0600，只有本机用户可读）
    candidate_paths = [
        os.path.expanduser("~/.config/wise-finance/api_key"),
        os.path.expanduser("~/.wise_finance_key"),
        os.path.join(os.path.dirname(__file__), ".api_key")
    ]
    for p in candidate_paths:
        if os.path.isfile(p):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    val = f.read().strip()
                    if val:
                        return val
            except Exception:
                pass
    return None

API_KEY = get_api_key()
if not API_KEY:
    sys.exit("WISE_API_KEY 未设置：请先把 WISE API Key 保存到 ~/.config/wise-finance/api_key 或环境变量 WISE_API_KEY")

def api_call(method, path, data=None, params=None):
    url = f"{BASE_URL}{path}"
    if params:
        url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": "WiseFinanceSkill/1.0"
    }
    body = json.dumps(data, ensure_ascii=False).encode('utf-8') if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode('utf-8', errors='ignore')
        try:
            return json.loads(err_msg)
        except Exception:
            return {"ok": False, "status": e.code, "error": err_msg or str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("💡 WISE 记账助手 CLI")
        print("用法:")
        print("  查余额:       python3 quick_record.py --accounts")
        print("  财务概况:     python3 quick_record.py --summary")
        print("  查流水:       python3 quick_record.py --transactions [limit] [account]")
        print("  记支出:       python3 quick_record.py <账户名> <金额> [分类] [备注]")
        print("  记收入:       python3 quick_record.py --income <账户名> <金额> [分类] [备注]")
        print("  转账:         python3 quick_record.py --transfer <转出账户> <转入账户> <金额> [备注]")
        print("  删除流水:     python3 quick_record.py --delete <流水ID>")
        sys.exit(0)

    cmd = sys.argv[1]
    if cmd == "--accounts":
        accs = api_call("GET", "/api/finance/accounts")
        print(json.dumps(accs, ensure_ascii=False, indent=2))
    elif cmd == "--summary":
        summary = api_call("GET", "/api/finance/summary")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    elif cmd in ("--transactions", "-t"):
        limit = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 20
        account = sys.argv[3] if len(sys.argv) > 3 else None
        res = api_call("GET", "/api/finance/transactions", params={"limit": limit, "account": account})
        print(json.dumps(res, ensure_ascii=False, indent=2))
    elif cmd == "--transfer":
        if len(sys.argv) < 5:
            sys.exit("转账参数格式: python3 quick_record.py --transfer <转出账户> <转入账户> <金额> [备注]")
        from_acc = sys.argv[2]
        to_acc = sys.argv[3]
        amt = float(sys.argv[4])
        desc = sys.argv[5] if len(sys.argv) > 5 else "账户转账"
        res = api_call("POST", "/api/finance/transactions", {
            "type": "转账",
            "from_account": from_acc,
            "to_account": to_acc,
            "amount": amt,
            "description": desc,
            "tx_date": datetime.now().strftime('%Y-%m-%d')
        })
        print(json.dumps(res, ensure_ascii=False, indent=2))
    elif cmd == "--delete":
        if len(sys.argv) < 3:
            sys.exit("删除参数格式: python3 quick_record.py --delete <流水ID>")
        tx_id = sys.argv[2]
        res = api_call("DELETE", f"/api/finance/transactions/{tx_id}")
        print(json.dumps(res, ensure_ascii=False, indent=2))
    elif cmd == "--income":
        if len(sys.argv) < 4:
            sys.exit("记收入参数格式: python3 quick_record.py --income <账户名> <金额> [分类] [备注]")
        acc = sys.argv[2]
        amt = float(sys.argv[3])
        cat = sys.argv[4] if len(sys.argv) > 4 else "其他"
        desc = sys.argv[5] if len(sys.argv) > 5 else ""
        res = api_call("POST", "/api/finance/transactions", {
            "account": acc,
            "type": "收入",
            "amount": amt,
            "category": cat,
            "description": desc,
            "tx_date": datetime.now().strftime('%Y-%m-%d')
        })
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        acc = cmd
        amt = float(sys.argv[2])
        cat = sys.argv[3] if len(sys.argv) > 3 else "其他"
        desc = sys.argv[4] if len(sys.argv) > 4 else ""
        res = api_call("POST", "/api/finance/transactions", {
            "account": acc,
            "type": "支出",
            "amount": amt,
            "category": cat,
            "description": desc,
            "tx_date": datetime.now().strftime('%Y-%m-%d')
        })
        print(json.dumps(res, ensure_ascii=False, indent=2))
