import asyncio, json, sys, re, os, edge_tts
# 每段 = (开场, 目的句, 正文, 目的卡片短句)。目的句在画面中以"为什么"卡片强调；为空则不显示卡片。
LINES = {
 "s1": ["", "", "Hi, I'm Little Dragon! Today I'll cover Operation Incentive Statistics: how it turns each month's night operations into everyone's incentive, and, more importantly, how it makes sure every single payout is accurate and checks out.", ""],
 "bg": ["First, the background.", "", "Every month, colleagues who did night operations earn an incentive. The data comes from an Excel sheet with thousands of rows. You have to pick out the night operations that were truly completed. If one person did several tickets on the same day, only the highest level counts, once. Then you apply the amount for each level, and finally total it up per person. Doing this by hand is slow, it is easy to miss things or make mistakes, and it affects what each person is paid. So this tool does three things: it calculates automatically, every step can be checked, and everyone confirms the result.", ""],
 "ov": ["", "", "The process has four steps: import the data, set the rules, verify accuracy, and export for confirmation. Verifying accuracy is the most important step.", ""],
 "s2": ["Step one: import the data.", "Drop in this month's night operations sheet as it is, with no manual tidying first.", "Click Choose Excel file and pick the sheet exported for the month. Once imported, the top of the page shows the file name and the number of records. The system also splits people into non WX and WX groups, depending on whether the operator ID contains WX, and counts them separately so they never get mixed up.", "Import directly, no manual tidying"],
 "s3": ["Step two: set the rules.", "The amounts and the night hours are rules you can see and change. It is not a black box.", "Click Rule Settings. Here you set the incentive amount for each of four levels: Low, Medium, High and Fatal. The defaults are fifty, one eighty, two eighty and six hundred. Tick Night operations only, and the hours default to ten at night until six in the morning. You can also choose which column identifies the operator. After editing, click Save and Apply, and the results recalculate automatically.", "Rules you can see and change"],
 "s4": ["", "Every record has to pass four gates before it counts toward the incentive.", "First, the task must be completed. Second, if the night rule is on, the operation time must fall in the night window. Third, there must be an operator and a start time. Pass these three gates and it becomes a valid record by the rules. Fourth, for the same person on the same day, even with several tickets, only the highest level is counted, once. For example, if one day has a Low, a High and a Fatal ticket, only the Fatal six hundred counts.", "Four gates before it counts"],
 "s5": ["Step three: verify accuracy.", "Records that are not counted never quietly disappear. Every one can be traced.", "Switch to Exceptions, and every record that did not pass states its reason, for example task not completed, not a night operation, or missing operator. Then open Calculation Details. Every row is marked Counted or Ignored, and ignored rows say why, for example several tickets on the same day, already counted at a higher level. For any payout, you can find out why it was counted, and why it was not.", "Every record can be traced"],
 "s6": ["", "", "Below the table, a Data Quality Check panel looks for problems for you. Name and ID mismatch: the operator ID does not match the ID attached to the name in the sheet. Unrecognized level: these records are treated as zero, and the level needs filling in. Night field and time disagree: the two ways of judging give different answers. Every item can be opened to see the details. Note that these are only warnings. They never change the results behind your back. You make the call.", ""],
 "s7": ["", "Month boundaries are where mistakes happen most easily.", "For example, an operation that runs from late at night on the last day of the month into the early hours of the first. By local start time it belongs to last month, but by the year and month columns in the original sheet it may belong to next month. So choose the basis for assigning months under Period Basis. The page also warns you: confirm the basis before exporting, so nothing is missed and incentive amounts are not affected.", "Month boundaries trip people up"],
 "s8": ["", "Incentives go only to people who are on the job, so check each ID's current status.", "Click Download WeLink Person Query script. It covers every ID in the sheet. Run it, and it looks up the IDs one by one and produces a text result. Then click Import WeLink results. The system tags people. If the lookup comes back empty, they are tagged Possibly resigned. If an ID has changed, they are tagged ID changed, and their department can be shown too. Possibly resigned is only a hint, and you must confirm it by hand a second time.", "Check that each person is still on the job"],
 "s9": ["", "", "What if you find a problem? There are three ways to handle it. First, the Incentive Blacklist: enter an ID, optionally with a reason. People on the list stay in the details, but are no longer paid. Second, Exclusion Rules: set a condition on any column, or on a WeLink person field, and everyone who matches is not paid. Third, the Meeting Attendance Alert: if someone who earned an incentive was absent or late in the meeting attendance snapshots, the page warns you. Tick them and add them to the blacklist in one click, or export a checklist. After handling, the results are recalculated automatically.", ""],
 "s10": ["", "", "Once checked, you can look at the results. At the top you can filter quickly by this month, last month, this quarter and so on, or filter by BU, customer, person and level. There are six views: Dimension, Period, Period Cross, Person, Details and Exceptions. There are also year over year and month over month comparisons, and a row of charts where you click a shape to drill down to the person or month. The number cards always show the raw records, valid records, deduplicated records, headcount and incentive total for the current scope, so the numbers tie out from start to finish.", ""],
 "s11": ["Step four: export and confirm.", "Calculating is not the end. Everyone and their supervisors must confirm, and only then does it count.", "Click Export Current Results. The exported file keeps every column of the original sheet, keeps only the rows that were paid, and adds the row incentive amount, the WeLink department, and the ID change. So every incentive can be checked against the original record. Send it to each supervisor and colleague to confirm, and for anyone marked Possibly resigned, the supervisor must confirm in person. If anything is in doubt, go back to the tool, add to the blacklist or change the rules, then export again.", "Calculated, then confirmed by everyone"],
 "s12": ["", "", "Once confirmed, save a snapshot. Click Save Snapshot, give it a name and a period, for example September 2026. The system stores the original data, the rules and the blacklist on the server together. Later, in the Snapshot Library, you can reload that exact workspace in one click, and look back to see how that month was calculated.", ""],
 "s13": ["", "", "To sum up: the rules are open and editable, every record has a destination, anomalies raise their own alerts, and finally a person confirms. The tool does the calculating, people do the confirming. Every incentive is clear, and it all checks out. Go and give it a try!", ""],
}
# 只给语音用的同音替换（字幕仍显示原文）："行"在表格语境读 háng
SPOKEN = []
VOICE = "en-US-AvaNeural"
PUN = r'[，。！？；：、,.!?;:\s“”"\'（）()—…@]'
def spoken(text):
    for a, b in SPOKEN: text = text.replace(a, b)
    return text
async def one(k, parts, out):
    pre, why, body, short = parts
    text = " ".join(x for x in (pre, why, body) if x)
    c = edge_tts.Communicate(spoken(text), VOICE, rate="+3%", pitch="+0Hz", boundary="WordBoundary")
    words = []
    with open(f"{out}/{k}.mp3", "wb") as f:
        async for ch in c.stream():
            if ch["type"] == "audio": f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                words.append({"text": ch["text"].replace("航", "行"), "start": ch["offset"] / 1e7, "end": (ch["offset"] + ch["duration"]) / 1e7})
    w = None
    if why:
        a = len(re.sub(PUN, '', pre)); b = a + len(re.sub(PUN, '', why))
        chars = []
        for t in words:
            for ch in re.sub(PUN, '', t["text"]): chars.append((t["start"], t["end"]))
        w = {"t": short, "s": round(chars[min(a, len(chars) - 1)][0], 2), "e": round(chars[min(b - 1, len(chars) - 1)][1], 2), "chars": b}
    return {"id": k, "text": text, "words": words, "why": w}
async def main(out):
    try: old = {x["id"]: x for x in json.load(open(f"{out}/words.json"))}
    except Exception: old = {}
    res = []
    for k, v in LINES.items():
        o = old.get(k)
        if o and o["text"] == " ".join(x for x in v[:3] if x) and os.path.exists(f"{out}/{k}.mp3"): res.append(o)
        else: res.append(await one(k, v, out))
    json.dump(res, open(f"{out}/words.json", "w"), ensure_ascii=False, indent=1)
asyncio.run(main(sys.argv[1]))
