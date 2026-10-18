import asyncio, json, sys, re, os, edge_tts
# 每段 = (开场, 目的句, 正文, 目的卡片短句)。目的句在画面中以"为什么"卡片强调；为空则不显示卡片。
LINES = {
 "s1": ["", "", "Hi, I'm Little Dragon! Today I'll show you the Dragon Platform, and how a whole month of data turns, step by step, into one monthly report.", ""],
 "bg": ["First, the background.", "", "Every month, the operations team has to produce a service quality report. The data is scattered across several systems. You log in to each one and export it, tidy everything into tables, work out the pass rates by hand, chase people one by one to fix issues, and finally lay it all out as a report. It takes days, and mistakes creep in. The Dragon Platform links this whole routine into one automatic pipeline.", ""],
 "ov": ["", "", "The whole pipeline has five stations: Data Capture, Data Import, Report Board, One-click Nudge, and Monthly Report. Scripts capture data, rules calculate metrics, the board scores and saves, nudges chase weak spots, and the monthly report wraps up.", ""],
 "s2": ["Station one: Data Capture.", "Your data is scattered across systems. Exporting by hand is slow and easy to get wrong, so a script pulls it all back in one click.", "This is the Script Workshop. First install the UI.Vision extension; Chrome and Edge both work. On the left is the smart script library. The default scripts work out of the box, and you can sort, rename, import and export them.", "Manual export is slow and error-prone, scripts do it in one click"],
 "s3": ["", "No ready-made script? No coding needed. Three steps turn an API request into a capture script.", "Pick a request address, for example DataFab, or one of the NetCare regional nodes. Paste the request payload. Then paste a sample JSON response. You can copy both the payload and the response from the Network panel of your browser's developer tools.", "No code, three steps to a capture script"],
 "s4": ["", "This step is about capturing the right data, and all of it.", "What if the response holds several tables? Type a keyword in Data Focus and the system scores each table and picks the best match. If several match, a pop-up lets you choose. Then switch on the options you need: Auto Paging to capture every page, Summary Fallback, and Dynamic CPC and NID. When a report spans two months, turn on Current plus Previous Month, so the start of the month never misses last month's data.", "Capture the right data, and all of it"],
 "s5": ["", "Save finished scripts to the library, then rerun them in one click every month.", "Click Generate to get a production-grade UI.Vision macro, or copy the console script instead. Happy with it? Add it to the sidebar. It is sorted automatically, and AI even suggests a name. Hit an unfamiliar website? Use the AI adapter: paste Copy as fetch and a sample response, sanitize it first, then analyze, and you do not have to study the API yourself.", "Save to the library, rerun every month in one click"],
 "s6": ["", "Captured data has to get into the platform. This step saves you the download, rename and upload chores.", "In the library, tick your scripts and click Run Batch. It pages through the data automatically. When it is done, the data goes straight to the Data Import page. One reminder: from capture until import finishes, please do not switch tenants.", "No more download, rename, upload"],
 "s7": ["Station two: Data Import.", "Import turns scattered tables into one data source the platform can calculate with.", "Click Batch Import All Tables. The system sorts the files by filename prefix into five types: Remediation, Routine Risk, Special Risk, SR Details and Vulnerability Alerts. Then it shows red, yellow and green warnings by status and due date, so you see at a glance which ticket is about to run late.", "Scattered tables become one data source"],
 "s8": ["", "Why set up metric rules? Set them once, and every month's import calculates the numbers for you, with no manual counting.", "Click the Metrics button on a table and pick a mode. Extract One Row: where column X contains Y, take the value in column Z from that row. Extract Many Rows: with the same condition, add up column Z, or take the average, maximum or minimum, or count the valid entries.", "Set a rule once, metrics appear every month"],
 "s9": ["", "", "Count Times: among rows where column X contains Y, count the rows where column Z contains keyword K. Count Ratio: the rows where Z contains K, divided by the rows where X contains Y. Leave X empty and it divides by all rows. Return rate and overdue rate in your assessments are calculated exactly this way, and conditions can test for empty or filled cells.", ""],
 "s10": ["", "", "Conditions not enough? Turn on Advanced Filters and add more column conditions: AND means all must match, OR means any one will do. The data range can be the current table, or all independent tables. A rule can be a main metric on its own, or hang under a main metric as a child metric, so one metric can be split by office, and you can see at a glance who is dragging it down.", ""],
 "s11": ["", "With a target in place, the system can tell whether you hit it, and light up warnings by itself.", "In Alert Settings, set a target and a warning direction for each month, January to December. In All Rules you can search and copy rules, map templates quickly, and paste two columns from Excel to fill in dozens of rules in seconds. After any rule change, the system recalculates by itself, so you do not need to upload again.", "Targets let the system judge and warn"],
 "s12": ["Station three: Report Board.", "The board turns piles of metrics into scores and rankings, so you can see at a glance who is doing well and who is not.", "Choose the assessment month and the board scores each metric against its target, giving you a health ranking of customer groups and offices. You can add metrics by hand and set weights, groups and a bilingual dictionary. Others are only monitored, not scored. Click Save to store a snapshot, map it with a template, or export the race table.", "Piles of metrics become scores and rankings"],
 "s13": ["Station four: One-click Nudge.", "No more hunting through tables for weak spots, or writing reminder messages one by one.", "It reads the latest saved snapshot and automatically picks out the metrics that lost points or are overdue, and anything matching an ignore keyword is hidden. In the template settings, write the greeting, title and closing, and use MM and DD for the month and date.", "Finds weak spots, writes the nudge"],
 "s14": ["", "", "Send them to specific people? In Advanced Distribution, first add people and groups to the roster, then click a category card to assign. Network name mapping matches tickets to categories. It supports direct chat, group chat, email CC and meeting invites. You can also copy the WeLink script, or download an Excel weak spot matrix. Everyone only receives the tickets that concern them, so nudges hit the mark.", ""],
 "s15": ["Station five: Monthly Report page.", "Numbers in the report come straight from the data library and always match the source tables, with no copy and paste.", "It is a three column workspace: the library on the left, the canvas in the middle, settings on the right. Create a report and choose the report month. In the library you can browse raw tables, metrics and topics for any past month without touching the current report. Drag a worksheet onto the canvas and it becomes a table.", "Numbers link to the library and match the source"],
 "s16": ["", "", "The canvas offers five component types: Text, Metric, Table, Pivot Chart and Rule Summary. Charts work like Excel: drag fields into Filters, Columns, Rows and Values, and switch between seven chart types any time. Type the at sign in the text to insert a metric number, and two neighboring metrics can even form a formula. Change the month and everything recalculates, so numbers are never copied by hand, or copied wrong.", ""],
 "s17": ["", "Next month you do not redo the report. Change the month and the whole thing updates.", "Behind this are month relations: This Month, Last Month, Same Month Last Year, an offset month, or a fixed month. Bind both this month and last month to one chart, and you get month over month. Switch to a new month and a comparison preview pops up showing Updated, Consistent, Fixed Version and Pending. Tick the ones to apply, and you can undo it.", "Next month, change the month and update it all"],
 "s18": ["", "", "Finally, save to the server, check the layout in the preview, and export as HTML, PDF, a long image, or an Outlook email. Capture, import, board, nudge, report: five stations done. Go and give it a try!", ""],
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
