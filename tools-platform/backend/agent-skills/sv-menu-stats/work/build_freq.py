#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SV 餐厅菜品频次清单 — 以菜品为主视角的 Excel。"""
from __future__ import annotations

import collections
import datetime
import json
import os
import re
import unicodedata
from pathlib import Path
from zoneinfo import ZoneInfo


def menu_home() -> Path:
    env = os.environ.get("SV_MENU_HOME")
    if env:
        return Path(env).expanduser().resolve()
    return Path(__file__).resolve().parent.parent


ROOT = menu_home()
WORK = ROOT / "work"
OUT = ROOT / "SV餐厅菜品频次清单_2023-2026.xlsx"
CAIRO = ZoneInfo("Africa/Cairo")
MEALS = ["早餐", "午餐", "晚餐", "夜宵"]
YEARS = ["2023", "2024", "2025", "2026"]

# ---------- 轻度规范化（只合并空白/标点/表情等显而易见的重复，不合并不同菜） ----------
EMO = re.compile(
    "["
    "\U0001F300-\U0001F6FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FAFF"
    "\U00002600-\U000026FF"
    "\U00002700-\U000027BF"
    "\U0000FE00-\U0000FE0F"
    "\U0001F1E6-\U0001F1FF"
    "\u200d\u20e3\ufe0f"
    "]+"
)
LEADING_JUNK = re.compile(r"^[\s:：;；\-—·•．.⁺₊°*#]+")


def display_name(name: str) -> str:
    s = unicodedata.normalize("NFKC", name)
    s = EMO.sub("", s)
    s = LEADING_JUNK.sub("", s)
    s = re.sub(r"[\s\u3000]+", " ", s).strip()
    s = s.strip(" \t*~～-—_.。!！?？\"“”'）)(（：:&/\\+＝=#⁺₊")
    return s or name.strip()


def canon_key(name: str) -> str:
    s = display_name(name)
    s = s.replace("＆", "&")
    if "&" not in s:
        s = s.replace(" ", "")
    else:
        s = re.sub(r"\s*&\s*", " & ", s)
    return s or name.strip()


# ---------- 分类规则（沿用原分析脚本，并对常备项做纠错） ----------
def rx(s):
    return re.compile(s)


CAT = [
    ("小吃/炸物", rx(r"薯条|薯片|甜甜圈|沙琪玛|开口笑|炸鲜奶|麻圆|鸡米花|炸鸡|鸡块$|麻辣烫")),
    ("面条/粉", rx(r"麻食|^.{0,2}炸酱$|卤$|^.{0,3}打卤|粉条|拉条|云吞")),
    ("饮品", rx(r"(汁|茶|豆浆|牛奶|酸奶|咖啡|可乐|饮料|奶茶|莫吉托|薄荷水|番石榴|奶昔|酸梅汤|乌梅汤|豆奶|椰奶|柠檬水|杏仁露)$")),
    ("面条/粉", rx(r"^汤粉$|^汤面$|面$|面条|米线|河粉|米粉|粉丝汤|^.{0,4}粉$|面片|疙瘩汤|凉皮|擀面皮|拉条子|面筋")),
    ("汤/粥", rx(r"粥|汤$|羹|糊$|汤饭|豆腐脑|豆花")),
    ("甜品/水果", rx(r"甜水|糯米糍|糯米滋|龟苓膏|银耳|双皮|糖环|萨其马|粑粑|拔丝|水果|蛋糕|布丁|西米|糖水|双皮奶|冰粉|慕斯|蛋挞|小贝|麻薯|汤圆|元宵|果冻|西瓜|甜品|奶冻|芋圆|糖葫芦|月饼|绿豆沙|酒酿|班戟|泡芙|曲奇|雪糕|冰淇淋|蛋黄酥|麻花|^西点$|奶黄|椰子|桃|梨|苹果|香蕉|葡萄|芒果$|橙$")),
    ("面点/包点", rx(r"混沌|炒手|粉果|派$|包$|包子|饺|馒头|花卷|饼|卷$|烧麦|馄饨|抄手|锅贴|油条|馍|火烧|盒子|酥$|糕|窝窝头|肠粉|生煎|小笼|汉堡|三明治|面包|披萨|吐司|华夫|麻团|麻园|点心|春卷|粽|油糕|糍粑|烧饼|大饼|饼干|角$|发面|麻球|驴打滚|油饼|煎包|包$")),
    ("米饭类", rx(r"饭$|饭团|寿司|焖饭|盖饭|抓饭|炒饭|^米饭$|粽子")),
    ("火锅/烧烤/铁板", rx(r"火锅|串|烧烤|烤肉|铁板|锅$|干锅|烤全羊|羊排$")),
    ("蛋类", rx(r"蛋$")),
    ("水产海鲜", rx(r"斑|花甲|花枝|鲷|鱼|虾|蟹|鱿|贝|蛤|海鲜|三文|墨鱼|章鱼|海参|蚌|螺|鳗|带鱼|海带")),
    ("牛肉", rx(r"牛")),
    ("羊肉", rx(r"羊")),
    ("禽肉", rx(r"雁|鸡|鸭|鹅|翅|凤爪|鸽")),
    ("猪肉/其他肉", rx(r"兔|脑花|黄喉|肺片|大骨|狮子头|蚂蚁上树|毛血旺|猪|排骨|五花|肉|蹄|肘|里脊|腊肠|香肠|培根|丸|肥肠|大肠|腰花|肚|午餐肉|火腿|叉烧")),
    ("豆制品", rx(r"香干|干丝|黄豆|豆腐|豆皮|腐竹|千张|豆干|素鸡|油豆")),
    ("凉菜/小菜", rx(r"卤味|卤水|凉拌|拌|拍黄瓜|花生|泡菜|咸菜|榨菜|皮蛋|酱菜|小菜|沙拉")),
    ("粗粮", rx(r"红薯$|香芋|^(玉米|红薯|紫薯|南瓜|山药|芋头|土豆|毛豆|花生|杂粮)$|蒸(玉米|红薯|南瓜|山药|芋头|紫薯)")),
    ("素菜", rx(r"瓜$|瓜丝|瓜片|上海青|茼蒿|豇豆|银牙|尖椒|辣子|小炒|乱炖|一碗香|小瓜|魔芋|菜|蔬|白菜|土豆|茄|豆角|西蓝花|花菜|菜花|黄瓜|萝卜|菌|菇|蘑|木耳|西葫芦|冬瓜|苦瓜|丝瓜|南瓜|藕|笋|芹|韭|青椒|辣椒|洋葱|生菜|油麦|菠菜|包菜|甘蓝|芦笋|山药|豆芽|荷兰豆|四季豆|秋葵|地三鲜|玉米")),
]
MEAT = rx(r"鱼|虾|蟹|鱿|贝|海鲜|三文|牛|羊|鸡|鸭|鹅|翅|凤爪|猪|排骨|五花|肉|蹄|肘|里脊|肠|培根|丸|腰花|肚|火腿|叉烧")
METH = [
    ("凉拌", r"凉拌|拌|凉"),
    ("爆炒/小炒", r"炒|爆|煸|熘|溜"),
    ("红烧/烧", r"红烧|烧(?!麦|饼|烤)|焖|扒"),
    ("炖/煲", r"炖|煲|煨|砂锅"),
    ("蒸", r"蒸"),
    ("煮/涮", r"煮|涮|汆|水煮|火锅"),
    ("煎/贴", r"煎|锅贴"),
    ("炸", r"炸|酥"),
    ("烤/铁板", r"烤|烘|铁板|焗|串"),
    ("卤/酱", r"卤|酱"),
]
FLAV = [
    ("麻辣/香辣", r"麻辣|香辣|辣子|剁椒|泡椒|水煮|麻婆|红油|钵钵|毛血旺|干锅|辣"),
    ("酸辣/酸", r"酸辣|酸菜|酸汤|老坛|酸"),
    ("糖醋/酸甜", r"糖醋|酸甜|锅包|菠萝|茄汁"),
    ("孜然", r"孜然"),
    ("蒜香", r"蒜"),
    ("咖喱", r"咖喱"),
    ("酱香", r"酱|豉"),
    ("椒盐", r"椒盐"),
    ("甜", r"甜|蜜|糖|豆沙|红枣"),
    ("清淡", r"清炒|清蒸|清汤|白灼|上汤"),
]
REG = [
    ("埃及/中东", r"本地|埃及|大饼|鹰嘴豆|法拉费|塔米亚|科沙里|蚕豆泥|沙威玛|皮塔|阿拉伯|土耳其|中东"),
    ("西式", r"披萨|汉堡|意面|意大利|牛排|三明治|沙拉|薯条|华夫|吐司|面包|蛋糕|布丁|西点|焗|芝士|奶酪|培根|泡芙|曲奇|蛋挞|慕斯|西式|牛角"),
    ("日韩/东南亚", r"寿司|韩式|日式|石锅|泡菜|咖喱|冬阴功|泰式|越南|椰|照烧|天妇罗|紫菜包饭|部队"),
    ("川渝", r"麻婆|回锅|宫保|鱼香|水煮|川|钵钵|毛血旺|夫妻肺片|辣子鸡|酸菜鱼|担担|口水|重庆|麻辣|红油|冒菜|串串|干煸|老干妈|豆花"),
    ("湘赣", r"剁椒|湘|小炒肉|农家|擂椒|外婆菜|口味"),
    ("粤港/潮汕", r"广式|广东|肠粉|叉烧|烧腊|煲仔|凤爪|虾饺|潮州|潮汕|港式|白切|白灼|蜜汁|菠萝包|蛋挞|流沙|老婆饼|糖水|双皮奶"),
    ("西北/新疆", r"兰州|新疆|大盘鸡|肉夹馍|凉皮|泡馍|油泼|裤带面|抓饭|烤包子|手抓|biang|臊子|拉条子|西北|陕西|甘肃|宁夏|羊肉串|馕|胡辣|擀面皮|岐山|洋芋|烩面|羊杂"),
    ("东北/华北", r"锅包肉|地三鲜|东北|小鸡炖蘑菇|炖粉条|酸菜白肉|杀猪菜|京酱|北京|天津|煎饼果子|卤煮|驴肉|山东|葱烧|把子肉|道口|河南|水煎包|山西|刀削|饸饹|打卤"),
    ("江浙沪/闽", r"扬州|东坡|小笼|生煎|杭州|宁波|上海|苏式|无锡|沙县|福建|闽|梅干菜|醉|腌笃鲜|狮子头|蟹粉"),
    ("云贵/桂", r"云南|过桥|贵州|酸汤|桂林|螺蛳|柳州|米线"),
]

STAPLE = {
    "牛奶", "酸奶", "豆浆", "茶叶蛋", "水煮蛋", "煎蛋", "鸡蛋", "咸鸭蛋",
    "清炒时蔬", "炒青菜", "米饭", "杂粮饭", "馒头", "水果", "果汁",
    "汤粉", "汤面", "面条", "手工面", "西点", "中式点心", "玉米", "红薯",
    "埃及本地米饭", "本地面包", "花卷", "凉拌黄瓜",
}

# 常备项及明显误判的手工校正（如「水煮蛋」被「水煮」规则打成川渝/麻辣）
OVERRIDES = {
    "水煮蛋": ("蛋类", "高", "素", "煮/涮", "家常/未标明", "家常中式(默认)"),
    "茶叶蛋": ("蛋类", "高", "素", "卤/酱", "家常/未标明", "家常中式(默认)"),
    "煎蛋": ("蛋类", "高", "素", "煎/贴", "家常/未标明", "家常中式(默认)"),
    "咸鸭蛋": ("蛋类", "高", "素", "未标明", "家常/未标明", "家常中式(默认)"),
    "鸡蛋": ("蛋类", "高", "素", "未标明", "家常/未标明", "家常中式(默认)"),
    "水果": ("甜品/水果", "高", "—", "未标明", "家常/未标明", "—"),
    "酸奶": ("饮品", "高", "—", "未标明", "家常/未标明", "—"),
    "牛奶": ("饮品", "高", "—", "未标明", "家常/未标明", "—"),
    "豆浆": ("饮品", "高", "—", "未标明", "家常/未标明", "—"),
    "果汁": ("饮品", "高", "—", "未标明", "家常/未标明", "—"),
    "玉米": ("粗粮", "高", "素", "未标明", "家常/未标明", "家常中式(默认)"),
    "红薯": ("粗粮", "高", "素", "未标明", "家常/未标明", "家常中式(默认)"),
    "清炒时蔬": ("素菜", "高", "素", "爆炒/小炒", "清淡", "家常中式(默认)"),
    "炒青菜": ("素菜", "高", "素", "爆炒/小炒", "清淡", "家常中式(默认)"),
    "凉拌黄瓜": ("凉菜/小菜", "高", "素", "凉拌", "清淡", "家常中式(默认)"),
    "米饭": ("米饭类", "高", "素", "未标明", "家常/未标明", "家常中式(默认)"),
    "杂粮饭": ("米饭类", "高", "素", "未标明", "家常/未标明", "家常中式(默认)"),
    "埃及本地米饭": ("米饭类", "高", "素", "未标明", "家常/未标明", "埃及/中东"),
    "馒头": ("面点/包点", "高", "素", "未标明", "家常/未标明", "家常中式(默认)"),
    "花卷": ("面点/包点", "高", "素", "未标明", "家常/未标明", "家常中式(默认)"),
    "手工面": ("面条/粉", "高", "素", "未标明", "家常/未标明", "家常中式(默认)"),
    "汤粉": ("面条/粉", "高", "素", "未标明", "家常/未标明", "家常中式(默认)"),
    "汤面": ("面条/粉", "高", "素", "未标明", "家常/未标明", "家常中式(默认)"),
    "面条": ("面条/粉", "高", "素", "未标明", "家常/未标明", "家常中式(默认)"),
    "西点": ("甜品/水果", "高", "—", "未标明", "家常/未标明", "西式"),
    "中式点心": ("面点/包点", "高", "素", "未标明", "家常/未标明", "家常中式(默认)"),
    "本地面包": ("面点/包点", "高", "素", "未标明", "家常/未标明", "埃及/中东"),
}


def classify_raw(d: str):
    cat, conf = "其他/未识别", "低"
    for c, r in CAT:
        if r.search(d):
            cat, conf = c, "高"
            break
    if cat == "其他/未识别" and re.search(r"(鲜榨|饮|露)", d):
        cat, conf = "饮品", "中"
    hs = (
        "荤"
        if MEAT.search(d) and cat not in ("饮品", "甜品/水果")
        else ("素" if cat not in ("饮品", "甜品/水果") else "—")
    )
    meth = next((m for m, r in METH if re.search(r, d)), "未标明")
    flav = next((m for m, r in FLAV if re.search(r, d)), "家常/未标明")
    reg = next((m for m, r in REG if re.search(r, d)), "家常中式(默认)")
    if reg == "家常中式(默认)" and cat == "饮品":
        reg = "—"
    return cat, conf, hs, meth, flav, reg


def classify(d: str):
    if d in OVERRIDES:
        return OVERRIDES[d]
    cat, conf, hs, meth, flav, reg = classify_raw(d)
    # 「水煮蛋/水煮鸡蛋」不应因「水煮」被判成麻辣、川渝
    if re.search(r"水煮.*蛋", d) and "肉" not in d and "鱼" not in d:
        if flav == "麻辣/香辣":
            flav = "家常/未标明"
        if reg == "川渝":
            reg = "家常中式(默认)"
    if cat in ("饮品", "甜品/水果") and d in STAPLE:
        hs = "—"
        if flav in ("麻辣/香辣", "酸辣/酸", "糖醋/酸甜"):
            flav = "家常/未标明"
    return cat, conf, hs, meth, flav, reg


def is_staple_or_drink(d: str) -> bool:
    return d in STAPLE or classify(d)[0] == "饮品"


def supply_status(days: int) -> str:
    if days <= 14:
        return "近期仍有"
    if days <= 60:
        return "近两月有"
    if days <= 180:
        return "近半年有"
    return "已久未见"


def main_meals(meal_counts: dict) -> str:
    if not meal_counts:
        return "—"
    mx = max(meal_counts.values())
    if mx <= 0:
        return "—"
    return "、".join(m for m in MEALS if meal_counts.get(m, 0) == mx)


# ---------- 数据 ----------
def load_and_aggregate():
    slots = json.loads((WORK / "slots.json").read_text())["slots"]
    stats = json.loads((WORK / "stats.json").read_text())

    # 规范化映射：canon -> 展示名（取出现次数最多的清洗后原名）
    raw_cnt = collections.Counter()
    for s in slots:
        for d, _sec in s["dishes"]:
            raw_cnt[d] += 1
    groups = collections.defaultdict(list)
    for d, n in raw_cnt.items():
        groups[canon_key(d)].append((d, n, display_name(d)))
    canon_to_display = {}
    merges = []
    for k, items in groups.items():
        items_sorted = sorted(items, key=lambda x: (-x[1], len(x[2]), x[2]))
        chosen = items_sorted[0][2] or k
        if " " in chosen and "&" not in chosen:
            chosen = chosen.replace(" ", "")
        canon_to_display[k] = chosen
        if len(items) > 1:
            merges.append((chosen, [(a, b) for a, b, _ in items]))

    # 聚合
    allc = collections.Counter()
    bym = collections.defaultdict(collections.Counter)
    byy = collections.defaultdict(collections.Counter)
    days = collections.defaultdict(set)
    first, last = {}, {}
    for s in slots:
        date, meal, year = s["date"], s["meal"], s["date"][:4]
        seen = set()
        for d, _sec in s["dishes"]:
            name = canon_to_display[canon_key(d)]
            if not name or name in seen:
                continue
            seen.add(name)
            allc[name] += 1
            bym[name][meal] += 1
            byy[name][year] += 1
            days[name].add(date)
            first.setdefault(name, date)
            if date >= last.get(name, ""):
                last[name] = date

    d0, d1 = stats["d0"], stats["d1"]
    end = datetime.date.fromisoformat(d1)
    n_dates = stats["dates"]  # 有文字餐单的天数
    total_occ = sum(allc.values())

    rows = []
    for name, n in allc.most_common():
        cat, conf, hs, meth, flav, reg = classify(name)
        ndays = len(days[name])
        since = (end - datetime.date.fromisoformat(last[name])).days
        meal_counts = {m: bym[name][m] for m in MEALS}
        rows.append(
            {
                "name": name,
                "n": n,
                "share": n / total_occ if total_occ else 0,
                "days": ndays,
                "day_cover": ndays / n_dates if n_dates else 0,
                "meals": meal_counts,
                "main_meal": main_meals(meal_counts),
                "years": {y: byy[name][y] for y in YEARS},
                "cat": cat,
                "hs": hs,
                "meth": meth,
                "flav": flav,
                "reg": reg,
                "staple": "是" if name in STAPLE else "",
                "conf": conf,
                "first": first[name],
                "last": last[name],
                "since": since,
                "status": supply_status(since),
            }
        )

    # 分类汇总
    cat_rows = []
    catc = collections.Counter()
    cat_dish = collections.defaultdict(set)
    cat_meal = collections.defaultdict(collections.Counter)
    cat_top = collections.defaultdict(collections.Counter)
    hs_c = collections.Counter()
    hs_dish = collections.defaultdict(set)
    status_c = collections.Counter()
    status_dish = collections.Counter()
    for r in rows:
        catc[r["cat"]] += r["n"]
        cat_dish[r["cat"]].add(r["name"])
        for m in MEALS:
            cat_meal[r["cat"]][m] += r["meals"][m]
        cat_top[r["cat"]][r["name"]] = r["n"]
        hs_c[r["hs"]] += r["n"]
        hs_dish[r["hs"]].add(r["name"])
        status_c[r["status"]] += r["n"]
        status_dish[r["status"]] += 1

    for cat, n in catc.most_common():
        tops = "、".join(d for d, _ in cat_top[cat].most_common(3))
        cat_rows.append(
            {
                "cat": cat,
                "dishes": len(cat_dish[cat]),
                "n": n,
                "share": n / total_occ if total_occ else 0,
                "meals": {m: cat_meal[cat][m] for m in MEALS},
                "tops": tops,
            }
        )

    # 按月频次与重复率
    def month_span(start, end):
        y, m = int(start[:4]), int(start[5:7])
        ey, em = int(end[:4]), int(end[5:7])
        out = []
        while (y, m) <= (ey, em):
            out.append(f"{y:04d}-{m:02d}")
            m += 1
            if m > 12:
                m = 1
                y += 1
        return out

    month_slots = collections.defaultdict(list)
    for s in slots:
        month_slots[s["date"][:7]].append(s)

    seen_before = set()
    month_rows = []
    for mo in month_span(d0, d1):
        sls = month_slots.get(mo, [])
        month_dishes = collections.Counter()
        unique = set()
        for s in sls:
            seen = set()
            for d, _sec in s["dishes"]:
                name = canon_to_display[canon_key(d)]
                if not name or name in seen:
                    continue
                seen.add(name)
                month_dishes[name] += 1
                unique.add(name)
        occ = sum(month_dishes.values())
        n_unique = len(unique)
        month_rows.append(
            {
                "month": mo,
                "slots": len(sls),
                "occ": occ,
                "unique": n_unique,
                "repeat": (1 - n_unique / occ) if occ else None,
                "new": len(unique - seen_before),
                "partial": mo in (d0[:7], d1[:7]),
            }
        )
        seen_before |= unique

    nslots = []
    for s in slots:
        seen = set()
        ds = []
        for d, _sec in s["dishes"]:
            name = canon_to_display[canon_key(d)]
            if not name or name in seen:
                continue
            seen.add(name)
            ds.append(name)
        nslots.append({"date": s["date"], "meal": s["meal"], "dishes": ds, "n": s.get("n", 1)})

    return {
        "stats": stats,
        "slots": slots,
        "rows": rows,
        "cat_rows": cat_rows,
        "month_rows": month_rows,
        "hs": [(k, hs_c[k], len(hs_dish[k])) for k in ("荤", "素", "—") if hs_c[k]],
        "status": [
            (k, status_dish[k], status_c[k])
            for k in ("近期仍有", "近两月有", "近半年有", "已久未见")
            if status_dish[k]
        ],
        "merges": merges,
        "total_occ": total_occ,
        "d0": d0,
        "d1": d1,
        "allc": allc,
        "bym": bym,
        "nslots": nslots,
    }


# ---------- 样式 ----------
INK = "#1F3A4A"
INK2 = "#2C4A5A"
GOLD = "#C4A35A"
BAR = "#2E7D6F"
BAR_SOFT = "#7BA89E"
HEADER_BG = "#1F3A4A"
HEADER_FG = "#FFFFFF"
ALT = "#F4F1EC"
WHITE = "#FFFFFF"
LINE = "#E4DFD6"
NOTE_FG = "#6B6B6B"
KPI_BG = "#1F3A4A"
KPI_LBL = "#E8E4DC"
STATUS_COLORS = {
    "近期仍有": "#1F7A4D",
    "近两月有": "#5A7A2E",
    "近半年有": "#A06B20",
    "已久未见": "#8A8A8A",
}
FONT = "微软雅黑"


def fmt(wb, **kw):
    base = dict(font_name=FONT, font_size=10, valign="vcenter")
    base.update(kw)
    return wb.add_format(base)


def add_databar(ws, r1, c, r2, color=BAR, only=True, max_val=None):
    opt = {
        "type": "data_bar",
        "bar_color": color,
        "bar_solid": True,
        "bar_only": only,
        "bar_border_color": color,
        "min_type": "num",
        "min_value": 0,
    }
    if max_val is not None:
        opt.update({"max_type": "num", "max_value": max_val})
    else:
        opt["max_type"] = "max"
    ws.conditional_format(r1, c, r2, c, opt)


def build(data, out_path=None):
    now = datetime.datetime.now(CAIRO).strftime("%Y-%m-%d %H:%M")
    st, rows, d0, d1 = data["stats"], data["rows"], data["d0"], data["d1"]
    total_occ = data["total_occ"]
    n_dish = len(rows)
    dest = Path(out_path) if out_path else Path(os.environ.get("SV_MENU_OUT") or OUT)

    try:
        import xlsxwriter
    except ImportError:
        raise SystemExit("生成 Excel 需要 xlsxwriter，请先运行：pip install xlsxwriter")

    wb = xlsxwriter.Workbook(
        str(dest),
        {"constant_memory": False, "strings_to_urls": False, "nan_inf_to_errors": True},
    )
    wb.set_properties(
        {
            "title": "SV餐厅菜品频次清单 2023-2026",
            "author": "晓龙 范",
            "comments": f"数据范围 {d0} 至 {d1}（开罗时间）；生成于 {now}",
        }
    )

    # formats
    f_title = fmt(wb, font_size=18, bold=True, font_color=INK)
    f_sub = fmt(wb, font_size=10, font_color=NOTE_FG)
    f_note = fmt(wb, font_size=9, italic=True, font_color=NOTE_FG, text_wrap=True, valign="top")
    f_sec = fmt(wb, font_size=12, bold=True, font_color=INK, bottom=2, bottom_color=GOLD)
    f_h = fmt(
        wb,
        font_size=9,
        bold=True,
        bg_color=HEADER_BG,
        font_color=HEADER_FG,
        align="center",
        text_wrap=True,
        border=0,
        bottom=1,
        bottom_color=GOLD,
    )
    def cell(bg, align="left", num=None, bold=False, color=None, size=10):
        kw = dict(
            font_size=size,
            bg_color=bg,
            font_color=color or INK,
            align=align,
            border=1,
            border_color=LINE,
            bold=bold,
        )
        if num:
            kw["num_format"] = num
        return fmt(wb, **kw)

    f_txt = {0: cell(WHITE), 1: cell(ALT)}
    f_txt_b = {0: cell(WHITE, bold=True), 1: cell(ALT, bold=True)}
    f_cen = {0: cell(WHITE, "center"), 1: cell(ALT, "center")}
    f_int = {0: cell(WHITE, "right", "#,##0"), 1: cell(ALT, "right", "#,##0")}
    f_int_b = {0: cell(WHITE, "right", "#,##0", True), 1: cell(ALT, "right", "#,##0", True)}
    f_pct = {0: cell(WHITE, "right", "0.00%"), 1: cell(ALT, "right", "0.00%")}
    f_bar = {0: cell(WHITE, "left"), 1: cell(ALT, "left")}  # value hidden by bar_only
    f_date = {0: cell(WHITE, "center"), 1: cell(ALT, "center")}
    f_st = {}
    for name, color in STATUS_COLORS.items():
        f_st[name] = {
            0: cell(WHITE, "center", color=color, bold=True),
            1: cell(ALT, "center", color=color, bold=True),
        }

    f_kpi_n = fmt(wb, font_size=20, bold=True, font_color=HEADER_FG, bg_color=KPI_BG, align="center", valign="vcenter")
    f_kpi_l = fmt(wb, font_size=9, font_color=INK, bg_color=KPI_LBL, align="center", valign="vcenter")
    f_kl = fmt(wb, font_size=10, bold=True, bg_color=ALT, font_color=INK, border=1, border_color=LINE)
    f_kv = fmt(wb, font_size=10, bold=True, font_color=INK, border=1, border_color=LINE, align="right", num_format="#,##0")
    f_kt = fmt(wb, font_size=10, border=1, border_color=LINE, font_color=INK)
    f_pct2 = fmt(wb, font_size=10, border=1, border_color=LINE, align="right", num_format="0.0%", font_color=INK)
    f_d1 = fmt(wb, font_size=10, border=1, border_color=LINE, align="right", num_format="0.0", font_color=INK)
    f_cen2 = fmt(wb, font_size=10, border=1, border_color=LINE, align="center", font_color=INK)
    f_h2 = f_h

    f_back = fmt(
        wb,
        font_size=11,
        bold=True,
        font_color=HEADER_FG,
        bg_color=BAR,
        align="center",
        valign="vcenter",
    )
    f_home_title = fmt(wb, font_size=24, bold=True, font_color=INK, valign="vcenter")
    f_home_sub = fmt(wb, font_size=12, font_color=NOTE_FG, valign="vcenter")
    f_home_note = fmt(wb, font_size=13, font_color=INK2, text_wrap=True, valign="vcenter")
    f_home_h = fmt(
        wb,
        font_size=14,
        bold=True,
        bg_color=HEADER_BG,
        font_color=HEADER_FG,
        align="center",
        text_wrap=True,
        valign="vcenter",
        bottom=1,
        bottom_color=GOLD,
    )
    f_home_sec = fmt(wb, font_size=18, bold=True, font_color=INK, bottom=2, bottom_color=GOLD, valign="vcenter")
    f_home_link = fmt(wb, font_size=15, bold=True, font_color=BAR, underline=True, valign="vcenter")
    f_home_desc = fmt(wb, font_size=14, font_color=INK2, valign="vcenter")

    def hcell(bg, align="center", num=None, bold=False, color=None):
        kw = dict(
            font_size=15,
            bg_color=bg,
            font_color=color or INK,
            align=align,
            border=1,
            border_color=LINE,
            bold=bold,
            valign="vcenter",
        )
        if num:
            kw["num_format"] = num
        return fmt(wb, **kw)

    hf_cen = {0: hcell(WHITE, "center", bold=True), 1: hcell(ALT, "center", bold=True)}
    hf_cen_p = {
        0: hcell(WHITE, "center", bold=True, color="#A06B20"),
        1: hcell(ALT, "center", bold=True, color="#A06B20"),
    }
    hf_int = {0: hcell(WHITE, "right", "#,##0", True), 1: hcell(ALT, "right", "#,##0", True)}
    hf_pct = {0: hcell(WHITE, "right", "0.0%", True), 1: hcell(ALT, "right", "0.0%", True)}
    hf_tot_l = hcell("#E8E4DC", "center", bold=True)
    hf_tot_n = hcell("#E8E4DC", "right", "#,##0", True)
    hf_tot_p = hcell("#E8E4DC", "right", "0.0%", True)

    def add_back_link(ws):
        formula = """=HYPERLINK("#'每月概览'!A1","← 返回目录")"""
        ws.merge_range(0, 0, 0, 1, formula, f_back)

    # ============================================================
    # Sheet 1  每月概览（打开时的首页）
    # ============================================================
    month_rows = data["month_rows"]
    home = wb.add_worksheet("每月概览")
    home.activate()
    home.set_tab_color(GOLD)
    home.hide_gridlines(2)
    home.set_zoom(130)
    home.set_portrait()
    home.set_paper(9)
    home.fit_to_pages(1, 1)
    home.freeze_panes(4, 1)
    home.set_header('&L&"微软雅黑,24"SV餐厅 · 每月概览&R&"微软雅黑"数据截至 ' + d1)
    home.set_footer('&C第 &P 页 / 共 &N 页&R生成于 ' + now + "（开罗时间）")

    home_widths = [16, 12, 22, 16, 14, 16]
    for i, w in enumerate(home_widths):
        home.set_column(i, i, w)
    home.set_column(6, 8, 3)

    home.merge_range(0, 0, 0, 5, "SV餐厅  ·  每月菜品频次与重复率", f_home_title)
    home.set_row(0, 36)
    home.merge_range(
        1, 0, 1, 5,
        f"数据范围：{d0} 至 {d1}（开罗时间）  ｜  共 {len(month_rows)} 个月  ｜  {st['slots']:,} 个餐次  ·  {total_occ:,} 次出现  ·  {n_dish:,} 道菜  ｜  生成于 {now}（开罗时间）",
        f_home_sub,
    )
    home.set_row(1, 22)
    home.merge_range(
        2, 0, 2, 5,
        "重复率 = 1 − 当月不同菜品数 ÷ 当月菜品出现总次数。越高，说明当月越集中在常做的那几道菜；0% 表示每道菜当月只出现一次。"
        "「本月新菜」是到该月为止第一次出现的菜。标「不足月」的是数据窗口的首月（2023-06 从 15 日计）和末月（2026-11 只到 12 日），次数偏低，不宜与整月直接比较。",
        f_home_note,
    )
    home.set_row(2, 48)

    home_heads = ["月份", "餐次数", "菜品出现总次数", "不同菜品数", "重复率", "本月新菜数"]
    home.set_row(3, 32)
    for j, h in enumerate(home_heads):
        home.write(3, j, h, f_home_h)

    for i, mr in enumerate(month_rows):
        row = 4 + i
        b = i % 2
        label = mr["month"] + (" 不足月" if mr["partial"] else "")
        home.write_string(row, 0, label, (hf_cen_p if mr["partial"] else hf_cen)[b])
        home.write_number(row, 1, mr["slots"], hf_int[b])
        home.write_number(row, 2, mr["occ"], hf_int[b])
        home.write_number(row, 3, mr["unique"], hf_int[b])
        if mr["repeat"] is None:
            home.write_blank(row, 4, None, hf_pct[b])
        else:
            home.write_number(row, 4, mr["repeat"], hf_pct[b])
        home.write_number(row, 5, mr["new"], hf_int[b])
        home.set_row(row, 26)

    first_data, last_data_m = 4, 3 + len(month_rows)
    add_databar(home, first_data, 1, last_data_m, color=BAR_SOFT, only=False)
    add_databar(home, first_data, 2, last_data_m, color=BAR, only=False)
    add_databar(home, first_data, 3, last_data_m, color=BAR_SOFT, only=False)
    add_databar(home, first_data, 4, last_data_m, color=GOLD, only=False, max_val=1)
    add_databar(home, first_data, 5, last_data_m, color=BAR, only=False)

    tot_row = last_data_m + 1
    home.set_row(tot_row, 28)
    home.write_string(tot_row, 0, "合计 / 全程", hf_tot_l)
    home.write_number(tot_row, 1, st["slots"], hf_tot_n)
    home.write_number(tot_row, 2, total_occ, hf_tot_n)
    home.write_number(tot_row, 3, n_dish, hf_tot_n)
    home.write_number(tot_row, 4, (1 - n_dish / total_occ) if total_occ else 0, hf_tot_p)
    home.write_number(tot_row, 5, n_dish, hf_tot_n)

    dir_row = tot_row + 2
    home.merge_range(dir_row, 0, dir_row, 5, "目录", f_home_sec)
    home.set_row(dir_row, 30)
    toc = [
        ("菜品频次清单", "全部出现过的菜，按次数从高到低排列，带横向频次条。看特色菜时可把「常备项」筛成空白。"),
        ("总览", "关键数字、按餐次和主类结构，以及数据说明。"),
        ("分类汇总", "按主类、荤素、供应状态和常备项汇总。"),
        ("各餐招牌", "去掉常备项与饮品后，早餐 / 午餐 / 晚餐 / 夜宵 / 全部各 Top 30。"),
    ]
    for i, (name, desc) in enumerate(toc):
        r = dir_row + 2 + i
        home.write_url(r, 0, f"internal:'{name}'!A1", f_home_link, name)
        home.merge_range(r, 1, r, 5, desc, f_home_desc)
        home.set_row(r, 28)
    home.set_row(dir_row + 1, 10)

    # ============================================================
    # Sheet 2  菜品频次清单
    # ============================================================
    ws = wb.add_worksheet("菜品频次清单")
    ws.set_tab_color(INK)
    ws.hide_gridlines(2)
    ws.set_default_row(18)
    ws.freeze_panes(4, 2)
    ws.set_zoom(110)
    ws.set_landscape()
    ws.set_paper(9)
    ws.fit_to_pages(1, 0)
    ws.repeat_rows(0, 3)
    ws.set_header('&L&"微软雅黑"SV餐厅 · 菜品频次清单&R&"微软雅黑"数据截至 ' + d1)
    ws.set_footer('&C第 &P 页 / 共 &N 页&R生成于 ' + now + "（开罗时间）")

    heads = [
        "排名", "菜品", "主类", "荤素", "出现次数", "频次", "占比", "出现天数", "日覆盖",
        "早餐", "午餐", "晚餐", "夜宵", "主餐次",
        "2023", "2024", "2025", "2026",
        "首次出现", "最近出现", "距截止日(天)", "供应状态", "常备项",
        "烹饪方式", "口味", "地域风味",
    ]
    # 26 columns 0-25; autofilter was 21 — fix to 25
    widths = [
        6, 22, 12, 6, 10, 22, 8, 9, 8,
        7, 7, 7, 7, 10,
        7, 7, 7, 7,
        12, 12, 12, 10, 8,
        11, 12, 14,
    ]
    for i, w in enumerate(widths):
        ws.set_column(i, i, w)

    add_back_link(ws)
    ws.merge_range(0, 2, 0, 25, "SV‘埃’生活圈  ·  SV餐厅菜品出现频次清单", f_title)
    ws.set_row(0, 28)
    ws.merge_range(
        1, 0, 1, 25,
        f"数据范围：{d0} 至 {d1}（开罗时间）  ｜  {st['msgs']:,} 条餐单文字  ·  {st['slots']:,} 个餐次  ·  {st['dates']:,} 天  ｜  "
        f"{total_occ:,} 次出现  ·  {n_dish:,} 道菜  ｜  按出现次数从高到低  ｜  生成于 {now}（开罗时间）",
        f_sub,
    )
    ws.set_row(1, 18)
    ws.merge_range(
        2, 0, 2, 25,
        "用法：点击表头筛选或排序。建议先把「常备项」筛成空白，即可去掉每天都有的基础项。"
        "「出现次数」按去重后的日期×餐次计（同一餐次出现一次记一次）；「出现天数」是不同供餐日数；「日覆盖」= 出现天数 / 有文字餐单的天数。"
        "「频次」条形按出现次数比例绘制。「距截止日」相对数据截止日期 "
        + d1
        + "，此次未纳入该日之后的菜单。分类为关键词规则推断，仅供参考。",
        f_note,
    )
    ws.set_row(2, 32)
    ws.set_row(3, 28)
    for j, h in enumerate(heads):
        ws.write(3, j, h, f_h)

    # fix autofilter to last col
    ws.autofilter(3, 0, 3 + len(rows), len(heads) - 1)

    max_n = rows[0]["n"] if rows else 1
    for i, r in enumerate(rows):
        row = 4 + i
        b = i % 2
        ws.write_number(row, 0, i + 1, f_cen[b])
        ws.write_string(row, 1, r["name"], f_txt_b[b])
        ws.write_string(row, 2, r["cat"], f_cen[b])
        ws.write_string(row, 3, r["hs"], f_cen[b])
        ws.write_number(row, 4, r["n"], f_int_b[b])
        ws.write_number(row, 5, r["n"], f_bar[b])
        ws.write_number(row, 6, r["share"], f_pct[b])
        ws.write_number(row, 7, r["days"], f_int[b])
        ws.write_number(row, 8, r["day_cover"], f_pct[b])
        for k, m in enumerate(MEALS):
            v = r["meals"][m]
            if v:
                ws.write_number(row, 9 + k, v, f_int[b])
            else:
                ws.write_blank(row, 9 + k, None, f_int[b])
        ws.write_string(row, 13, r["main_meal"], f_cen[b])
        for k, y in enumerate(YEARS):
            v = r["years"][y]
            if v:
                ws.write_number(row, 14 + k, v, f_int[b])
            else:
                ws.write_blank(row, 14 + k, None, f_int[b])
        ws.write_string(row, 18, r["first"], f_date[b])
        ws.write_string(row, 19, r["last"], f_date[b])
        ws.write_number(row, 20, r["since"], f_cen[b])
        ws.write_string(row, 21, r["status"], f_st[r["status"]][b])
        ws.write_string(row, 22, r["staple"], f_cen[b])
        ws.write_string(row, 23, r["meth"], f_cen[b])
        ws.write_string(row, 24, r["flav"], f_cen[b])
        ws.write_string(row, 25, r["reg"], f_cen[b])

    last_data = 3 + len(rows)
    add_databar(ws, 4, 5, last_data, color=BAR, only=True, max_val=max_n)

    ws.freeze_panes(4, 2)
    ws.print_area(0, 0, last_data, len(heads) - 1)
    ws.set_print_scale(70)

    # ============================================================
    # Sheet 2  总览
    # ============================================================
    ov = wb.add_worksheet("总览")
    ov.set_tab_color(GOLD)
    ov.hide_gridlines(2)
    ov.set_zoom(120)
    ov.set_portrait()
    ov.set_paper(9)
    ov.fit_to_pages(1, 1)
    ov.set_column(0, 0, 16)
    ov.set_column(1, 1, 14)
    ov.set_column(2, 2, 3)
    ov.set_column(3, 3, 16)
    ov.set_column(4, 4, 14)
    ov.set_column(5, 5, 3)
    ov.set_column(6, 6, 16)
    ov.set_column(7, 8, 14)
    ov.set_column(9, 12, 12)

    add_back_link(ov)
    ov.merge_range(0, 2, 0, 8, "SV‘埃’生活圈  ·  SV餐厅餐单总览", f_title)
    ov.set_row(0, 28)
    ov.merge_range(
        1, 0, 1, 8,
        f"数据范围：{d0} 至 {d1}（开罗时间）  ｜  来源：本机解密微信数据库  ｜  生成于 {now}（开罗时间）",
        f_sub,
    )

    kpis = [
        (st["msgs"], "餐单文字消息"),
        (st["slots"], "去重后餐次"),
        (st["dates"], "有菜单的天数"),
        (total_occ, "菜品出现总次数"),
        (n_dish, "不同菜品"),
        (st["imgonly"], "仅图片、未解析菜名"),
    ]
    # 2 rows x 3 KPIs
    positions = [(4, 0), (4, 3), (4, 6), (7, 0), (7, 3), (7, 6)]
    for (num, lab), (r, c) in zip(kpis, positions):
        ov.merge_range(r, c, r, c + 1, num, f_kpi_n)
        ov.set_row(r, 32)
        ov.merge_range(r + 1, c, r + 1, c + 1, lab, f_kpi_l)
        ov.set_row(r + 1, 18)

    # 按餐次
    r = 10
    ov.merge_range(r, 0, r, 4, "按餐次", f_sec)
    r = 11
    meal_heads = ["餐次", "餐单次数", "覆盖天数", "占有菜单天数", "平均菜品数/次"]
    for j, h in enumerate(meal_heads):
        ov.write(r, j, h, f_h2)
    mealslots = st["mealslots"]
    mealdays = st["mealdays"]
    avgd = st["avgd"]
    for i, m in enumerate(MEALS):
        ov.write(r + 1 + i, 0, m, f_cen2)
        ov.write_number(r + 1 + i, 1, mealslots[m], f_kv)
        ov.write_number(r + 1 + i, 2, mealdays[m], f_kv)
        ov.write_number(r + 1 + i, 3, mealdays[m] / st["dates"], f_pct2)
        ov.write_number(r + 1 + i, 4, avgd[m], f_d1)
    add_databar(ov, r + 1, 1, r + 4, color=BAR, only=False)

    # 主类 Top（次数）
    r = 17
    ov.merge_range(r, 0, r, 4, "主类结构（按出现次数）", f_sec)
    r = 18
    for j, h in enumerate(["主类", "出现次数", "占比", "不同菜名", "代表菜（前3）"]):
        ov.write(r, j, h, f_h2)
    ov.set_column(4, 4, 36)
    for i, cr in enumerate(data["cat_rows"]):
        ov.write(r + 1 + i, 0, cr["cat"], f_kl)
        ov.write_number(r + 1 + i, 1, cr["n"], f_kv)
        ov.write_number(r + 1 + i, 2, cr["share"], f_pct2)
        ov.write_number(r + 1 + i, 3, cr["dishes"], f_kv)
        ov.write(r + 1 + i, 4, cr["tops"], f_kt)
    add_databar(ov, r + 1, 1, r + len(data["cat_rows"]), color=BAR, only=False)

    # 供应状态 + 荤素 右侧
    rstat = 11
    ov.merge_range(rstat, 6, rstat, 8, "供应状态（相对截止日期）", f_sec)
    rstat = 12
    for j, h in enumerate(["状态", "菜品数", "出现次数"]):
        ov.write(rstat, j + 6, h, f_h2)
    for i, (name, nd, noc) in enumerate(data["status"]):
        ov.write(rstat + 1 + i, 6, name, f_cen2)
        ov.write_number(rstat + 1 + i, 7, nd, f_kv)
        ov.write_number(rstat + 1 + i, 8, noc, f_kv)

    rstat = 18
    ov.merge_range(rstat, 6, rstat, 8, "荤素（按出现次数）", f_sec)
    rstat = 19
    for j, h in enumerate(["荤素", "出现次数", "不同菜名"]):
        ov.write(rstat, j + 6, h, f_h2)
    for i, (name, noc, nd) in enumerate(data["hs"]):
        ov.write(rstat + 1 + i, 6, name, f_cen2)
        ov.write_number(rstat + 1 + i, 7, noc, f_kv)
        ov.write_number(rstat + 1 + i, 8, nd, f_kv)

    # 说明
    note_row = 19 + len(data["cat_rows"]) + 2
    ov.merge_range(note_row, 0, note_row, 8, "说明", f_sec)
    notes = [
        f"1. 本文件以「菜品频次清单」为主表，每道出现过的菜一行，按出现次数从高到低排列；「总览」「分类汇总」「各餐招牌」为辅助表。旧版多维分析表仍保留在同目录，未被覆盖。",
        f"2. 数据截至 {d1}（开罗时间），未纳入此后的菜单。同一天同一餐次的重发已合并，菜品取并集。约 {st['imgonly']} 个餐次只发了图片，无法计入菜名。",
        "3. 菜名仅做轻度合并：去掉表情、多余空白、句首冒号等，以及原有的同义规范（如 番茄→西红柿、水煮鸡蛋→水煮蛋、脆皮油条→油条）。「红烧牛肉面」与「牛肉面」仍分开统计，故不同菜名数会偏高。",
        "4. 主类 / 荤素 / 烹饪 / 口味 / 地域为关键词规则推断，个别低频长尾可能标为「其他/未识别」。地域「家常中式(默认)」只表示菜名里没有明确地域线索。",
        "5. 「常备项」是几乎每天都有的基础项（牛奶、豆浆、水煮蛋、清炒时蔬、玉米、红薯、水果等）。看特色菜时建议在主表把这一列筛成空白。",
        "6. 周四中午多为接龙简餐，文字菜单较少；周六供餐明显偏少；夜宵主要在周日、周一、周二。",
    ]
    for i, t in enumerate(notes):
        ov.merge_range(note_row + 1 + i, 0, note_row + 1 + i, 8, t, f_note)
        ov.set_row(note_row + 1 + i, 28)

    # ============================================================
    # Sheet 3  分类汇总
    # ============================================================
    cs = wb.add_worksheet("分类汇总")
    cs.set_tab_color("#2E7D6F")
    cs.hide_gridlines(2)
    cs.set_zoom(120)
    cs.set_landscape()
    cs.set_paper(9)
    cs.fit_to_pages(1, 1)
    add_back_link(cs)
    cs.merge_range(0, 2, 0, 9, "SV餐厅  ·  按主类 / 荤素 / 供应状态汇总", f_title)
    cs.set_row(0, 26)
    cs.merge_range(1, 0, 1, 9, f"数据范围：{d0} 至 {d1}（开罗时间）  ｜  出现总次数 {total_occ:,}  ｜  不同菜品 {n_dish:,}", f_sub)

    cs.merge_range(3, 0, 3, 9, "按主类", f_sec)
    cat_heads = ["主类", "不同菜名", "出现次数", "频次", "占比", "早餐", "午餐", "晚餐", "夜宵", "代表菜（出现最多的3道）"]
    cat_widths = [16, 10, 12, 22, 9, 9, 9, 9, 9, 46]
    for j, (h, w) in enumerate(zip(cat_heads, cat_widths)):
        cs.set_column(j, j, w)
        cs.write(4, j, h, f_h)
    cs.set_row(4, 24)
    for i, cr in enumerate(data["cat_rows"]):
        row = 5 + i
        b = i % 2
        cs.write(row, 0, cr["cat"], f_txt_b[b])
        cs.write_number(row, 1, cr["dishes"], f_int[b])
        cs.write_number(row, 2, cr["n"], f_int_b[b])
        cs.write_number(row, 3, cr["n"], f_bar[b])
        cs.write_number(row, 4, cr["share"], f_pct[b])
        for k, m in enumerate(MEALS):
            cs.write_number(row, 5 + k, cr["meals"][m], f_int[b])
        cs.write(row, 9, cr["tops"], f_txt[b])
    add_databar(cs, 5, 3, 4 + len(data["cat_rows"]), color=BAR, only=True)
    cs.autofilter(4, 0, 4 + len(data["cat_rows"]), 9)
    cs.freeze_panes(5, 1)

    r = 6 + len(data["cat_rows"])
    cs.merge_range(r, 0, r, 3, "按荤素", f_sec)
    r += 1
    for j, h in enumerate(["荤素", "不同菜名", "出现次数", "频次", "占比"]):
        cs.write(r, j, h, f_h)
    hs_total = sum(n for _, n, _ in [(a, b, c) for a, b, c in [(x[0], x[1], x[2]) for x in data["hs"]]])
    # data["hs"] is (name, occ, n_dishes)
    for i, (name, noc, nd) in enumerate(data["hs"]):
        row = r + 1 + i
        b = i % 2
        cs.write(row, 0, name, f_txt_b[b])
        cs.write_number(row, 1, nd, f_int[b])
        cs.write_number(row, 2, noc, f_int_b[b])
        cs.write_number(row, 3, noc, f_bar[b])
        cs.write_number(row, 4, noc / total_occ if total_occ else 0, f_pct[b])
    add_databar(cs, r + 1, 3, r + len(data["hs"]), color=BAR, only=True)

    r = r + len(data["hs"]) + 3
    cs.merge_range(r, 0, r, 3, "按供应状态（相对 " + d1 + "）", f_sec)
    r += 1
    for j, h in enumerate(["供应状态", "不同菜名", "出现次数", "频次", "占菜品数"]):
        cs.write(r, j, h, f_h)
    for i, (name, nd, noc) in enumerate(data["status"]):
        row = r + 1 + i
        b = i % 2
        cs.write(row, 0, name, f_st[name][b])
        cs.write_number(row, 1, nd, f_int[b])
        cs.write_number(row, 2, noc, f_int_b[b])
        cs.write_number(row, 3, noc, f_bar[b])
        cs.write_number(row, 4, nd / n_dish if n_dish else 0, f_pct[b])
    add_databar(cs, r + 1, 3, r + len(data["status"]), color=BAR, only=True)

    r = r + len(data["status"]) + 3
    cs.merge_range(r, 0, r, 5, "常备项 vs 其他", f_sec)
    r += 1
    for j, h in enumerate(["类型", "不同菜名", "出现次数", "频次", "占比"]):
        cs.write(r, j, h, f_h)
    staple_rows = [x for x in rows if x["staple"] == "是"]
    other_rows = [x for x in rows if x["staple"] != "是"]
    for i, (lab, subset) in enumerate([("常备/基础项", staple_rows), ("其他菜品", other_rows)]):
        row = r + 1 + i
        b = i % 2
        noc = sum(x["n"] for x in subset)
        cs.write(row, 0, lab, f_txt_b[b])
        cs.write_number(row, 1, len(subset), f_int[b])
        cs.write_number(row, 2, noc, f_int_b[b])
        cs.write_number(row, 3, noc, f_bar[b])
        cs.write_number(row, 4, noc / total_occ if total_occ else 0, f_pct[b])
    add_databar(cs, r + 1, 3, r + 2, color=BAR, only=True)

    # ============================================================
    # Sheet 4  各餐招牌
    # ============================================================
    sp = wb.add_worksheet("各餐招牌")
    sp.set_tab_color("#A06B20")
    sp.hide_gridlines(2)
    sp.set_zoom(120)
    sp.set_landscape()
    sp.set_paper(9)
    sp.fit_to_pages(1, 1)
    add_back_link(sp)
    sp.merge_range(0, 2, 0, 18, "SV餐厅  ·  各餐次招牌菜（不含常备项与饮品）", f_title)
    sp.set_row(0, 26)
    sp.merge_range(
        1, 0, 1, 18,
        f"数据范围：{d0} 至 {d1}（开罗时间）  ｜  已排除牛奶、豆浆、蛋类、清炒时蔬、玉米、红薯、水果等常备项，以及各类饮品  ｜  每列 Top 30",
        f_sub,
    )

    # 5 groups: 早 午 晚 夜 全部, each 排名/菜/次数/频次  + spacer
    groups = MEALS + ["全部"]
    topn = 30
    for gi, g in enumerate(groups):
        c0 = gi * 5
        sp.set_column(c0, c0, 6)
        sp.set_column(c0 + 1, c0 + 1, 16)
        sp.set_column(c0 + 2, c0 + 2, 8)
        sp.set_column(c0 + 3, c0 + 3, 14)
        if gi < len(groups) - 1:
            sp.set_column(c0 + 4, c0 + 4, 2)
        title = f"{g} Top {topn}"
        sp.merge_range(3, c0, 3, c0 + 3, title, f_sec)
        for j, h in enumerate(["排名", "菜品", "次数", "频次"]):
            sp.write(4, c0 + j, h, f_h)
        if g == "全部":
            items = [(x["name"], x["n"]) for x in rows if not is_staple_or_drink(x["name"])][:topn]
        else:
            cand = sorted(
                (
                    (x["name"], x["meals"][g])
                    for x in rows
                    if not is_staple_or_drink(x["name"]) and x["meals"][g] > 0
                ),
                key=lambda t: -t[1],
            )[:topn]
            items = cand
        mx = items[0][1] if items else 1
        for i, (name, n) in enumerate(items):
            row = 5 + i
            b = i % 2
            sp.write_number(row, c0, i + 1, f_cen[b])
            sp.write_string(row, c0 + 1, name, f_txt_b[b])
            sp.write_number(row, c0 + 2, n, f_int_b[b])
            sp.write_number(row, c0 + 3, n, f_bar[b])
        if items:
            add_databar(sp, 5, c0 + 3, 4 + len(items), color=BAR, only=True, max_val=mx)
    sp.freeze_panes(5, 0)

    wb.close()
    return {
        "out": str(dest),
        "n_dish": n_dish,
        "total_occ": total_occ,
        "merges": data["merges"],
        "top15": [(r["name"], r["n"]) for r in rows[:15]],
        "d0": d0,
        "d1": d1,
        "sheets": ["每月概览", "菜品频次清单", "总览", "分类汇总", "各餐招牌"],
        "month_rows": month_rows,
    }


if __name__ == "__main__":
    data = load_and_aggregate()
    info = build(data)
    print("WROTE", info["out"])
    print("DISHES", info["n_dish"], "OCC", info["total_occ"])
    print("MERGES", len(info["merges"]))
    for m in info["merges"]:
        print("  MERGE", m)
    print("TOP15")
    for i, (n, c) in enumerate(info["top15"], 1):
        print(f"  {i:2d}. {n} {c}")
    print("SHEETS", info["sheets"])
    print("MONTHS")
    for mr in info["month_rows"]:
        if mr["month"] in ("2023-06", "2023-07", "2024-07", "2025-12", "2026-10", "2026-11") or mr["month"].endswith("-01"):
            rep = "" if mr["repeat"] is None else f"{mr['repeat']*100:.1f}%"
            print(f"  {mr['month']}{' 不足月' if mr['partial'] else ''}  餐次{mr['slots']}  出现{mr['occ']}  不同{mr['unique']}  重复率{rep}  新菜{mr['new']}")
