// Localized desktop UI. Conversation messages and diagnostic payloads are never translated.
(function () {
    const translations = {
    "常驻额度面板": "Always show quotas",
    "反重力额度组": "Antigravity group",
    "额度来源": "Quota source",
    "自动选择额度来源": "Auto-select quota source",
    "自然眼神与轻微动效": "Natural gaze and subtle eye motion",
    "随机眨眼与待机动作": "Random blinking and idle poses",
    "隐藏桌宠时保留额度 HUD": "Keep quota HUD when pet is hidden",
    "Dragon 主动讲故事": "Dragon's spontaneous stories",
    "故事间隔（分钟）": "Story interval (minutes)",
    "点击听完整故事 ✦": "Click for the full story ✦",
    "Dragon 故事屋 · 随时可听": "Dragon stories · always ready",
    "听一个故事": "Tell me a story",
    "阅读内置全文": "Read the built-in story",
    "故事库暂时不可用": "Story library unavailable",

    "✦ Dragon桌宠": "✦ Dragon desktop pet",
    "✦ Dragon桌宠设置": "✦ Dragon pet settings",
    "Dragon桌宠设置": "Dragon pet settings",
    "关闭设置": "Close settings",
    "体型缩放": "Size",
    "捏捏音量": "Sound volume",
    "开启头顶趣味气泡": "Speech bubbles",
    "打字与任务起舞动效 (全局敲键盘)": "Animate while typing",
    "macOS 系统全局键盘权限": "macOS keyboard access",
    "去授权": "Allow",
    "需要「辅助功能」授权才能在其他应用打字时感知按键": "Enable Accessibility to react to typing in other apps.",
    "重置屏幕坐标 (右下角)": "Reset position (bottom right)",
    "本次隐藏桌宠 (下次启动恢复)": "Hide until next launch",
    "永久隐藏 (切换为无桌宠模式)": "Disable desktop pet",
    "永久隐藏后，可在系统右下角托盘随时恢复开启": "Enable again from the system tray menu.",
    "Dragon": "Dragon",
    "Dragon设置": "Dragon settings",
    "关闭菜单": "Close menu",
    "小黄鸭 (挤压音)": "Duck squeak",
    "静音": "Mute",
    "5小时额度 (常用)": "5-hour quota",
    "每周总额度": "Weekly quota",
    "双额度交替轮播": "Alternate quotas",
    "自动跟随 (托腮思考/静静守候)": "Auto (thinking / standing by)",
    "专注思考 (键盘联动)": "Focused thinking (typing)",
    "托腮思考 (工作中)": "Thinking (working)",
    "静静守候 (待机)": "Standing by (idle)",
    "挥手问候 (互动)": "Waving hello (interaction)",
    "迈步出发 (拖动)": "Stepping out (dragging)",
    "轻盈落地 (下落)": "Landing (falling)",
    "挥手回应 (摸头)": "Waving back (head pats)",
    "跟随反重力启动和退出": "Follow start and exit",
    "仅跟随反重力启动": "Follow start only",
    "自己手动启动，自动检测": "Manual start, auto detect",
    "填 0 表示不自动关闭": "0 keeps it open",
    "大小": "Size",
    "音效": "Sound",
    "音量": "Volume",
    "配额": "Quota",
    "状态": "State",
    "跟随反重力": "Antigravity",
    "气泡": "Bubbles",
    "打字工友": "Typing buddy",
    "重力下落": "Gravity",
    "对话消耗": "Token usage",
    "自动关闭": "Close after",
    "秒": "sec",
    "✕ 退出桌宠": "✕ Exit pet",
    "轻一点，我的毛毡小肚子怕痒。": "Easy there, my little felt belly is ticklish.",
    "碰一碰，今天的灵感就亮起来了。": "One little tap and inspiration lights up.",
    "收到你的问候，开心得想摇摇尾巴。": "Your hello makes me want to wag my tail.",
    "毛毡小龙，装着满满的好奇心。": "A little felt dragon, full of curiosity.",
    "再碰一下，灵感也许就要起飞了。": "One more tap and inspiration might take flight.",
    "给我一点阳光，我就能陪你很久。": "A little sunshine and I can keep you company all day.",
    "补充一点灵感，我们继续写代码吧。": "A little inspiration, then back to coding together.",
    "今天也是与你并肩工作的一天 ✦": "Another day working by your side ✦",
    "我是Dragon，今天也陪你把想法变成代码 ✦": "I'm Dragon. Let's turn ideas into code today ✦",
    "遇到 Bug 别慌，我们一起梳理线索。": "A bug? Let's follow the clues together.",
    "愿今天的代码顺畅，测试全绿 ✦": "May your code flow and your tests turn green ✦",
    "你敲代码真快，Dragon正在努力跟上。": "You're coding so fast. Dragon is keeping up.",
    "一行一行，想法正在成为现实。": "Line by line, your ideas are becoming real.",
    "辛苦了，记得喝水，也让眼睛休息一下。": "Good work. Have some water and rest your eyes.",
    "不急，慢慢来，我会一直在这里。": "Take your time. I'll be right here.",
    "休息一下吧，回来时我还在这里。": "Take a break. I'll be here when you return.",
    "代码没有 Bug，只是有独特的个性！": "The code has no bugs, just a unique personality!",
    "反重力编译中… 正在将咖啡因转化为可用代码！": "Antigravity compiling… Turning caffeine into code!",
    "✦ 灵感之门开启，Dragon准备就绪！": "✦ The door to inspiration is open. Dragon is ready!",
    "Git commit: \"又改了一堆玄学代码\" (嘘)": "Git commit: \"More mysterious fixes\" (shh)",
    "正在向宇宙发射好运光波… 编译一次通过！": "Sending lucky cosmic rays… Build on the first try!",
    "报错也是线索，下一步就从这里开始。": "An error is a clue. Start the next step here.",
    "键盘声像细雨，想法正慢慢生长。": "Keys patter like rain. Ideas are growing.",
    "✦ 纯净桌宠模式": "✦ Companion mode",
    "反重力未开启 · 待机陪伴中 ✦": "Antigravity offline · Keeping you company ✦",
    "✦ Gemini 周配额": "✦ Gemini weekly quota",
    "✦ Gemini 5小时配额": "✦ Gemini 5-hour quota",
    "反重力全速运转中 ✦": "Antigravity at full speed ✦",
    "离线缓存额度 · 待机中 ✦": "Cached quota · Standing by ✦",
    "呜哇... 屁股摔得好痛痛 QAQ": "Ouch… That landing hurt! QAQ",
    "呜呜呜... 谁把人家扔下来的？！": "Waaah… Who dropped me?!",
    "晕乎乎... 头顶冒小星星了 @o@": "Dizzy… Seeing little stars! @o@",
    "哎哟... 下次要接住我嘛~ 哼！": "Oww… Catch me next time, please~!",
    "谢谢你的摸摸，Dragon收到啦 ✦": "Thanks for the head pat. Dragon appreciates it ✦",
    "一点温暖，点亮今天的青绿时光 ✦": "A little warmth lights up this turquoise day ✦",
    "我的小尾巴今天也元气满满。": "My little tail is full of energy today.",
    "摸摸头，愿今天的代码一路顺利 ✦": "A head pat for a smooth day of coding ✦",
    "这会儿很安静，适合酝酿一个好想法。": "A quiet moment for a good idea to take shape.",
    "温柔的问候，总会带来新的灵感 ✦": "A gentle hello brings fresh inspiration ✦",
    "✦ 正在思考与敲代码...": "✦ Thinking and coding…",
    "专注工作中 ✦": "Focused on the task ✦",
    "✦ 本次一共消耗:": "✦ Total usage this turn:",
    "待机中": "Standing by",
    "✦ 反重力引擎启动，青绿守护就绪": "✦ Antigravity on. Your turquoise guardian is ready.",
    "我在这里，陪你把思路慢慢写下来 ✦": "I'm here while you put your thoughts into code ✦",
    "浮空守候中，今天的视野很开阔 ✦": "Hovering nearby. What a clear view today ✦",
    "青绿守护者随时待命 ✦": "Your turquoise guardian is standing by ✦",
    "键盘声响起来了，我们一起专注吧 ✦": "The keys are tapping. Let's focus together ✦",
    "Dragon正在思考，愿下一次测试全绿 ✦": "Dragon is thinking. May the next test run turn green ✦",
    "键盘要敲冒烟啦！这就是传说中的手速吗？！(🔥)": "Your keyboard is on fire! Such speed! (🔥)",
    "先检查，再提交，让每一步都稳稳落地。": "Check, then commit. One steady step at a time.",
    "Ctrl+C，Ctrl+V… 别忘了留一点时间休息。": "Ctrl+C, Ctrl+V… Remember to take a break.",
    "反重力引擎正在把灵感转化为代码 ✦": "Antigravity is turning inspiration into code ✦",
    "✦ 结对编程就绪，我们一步一步来。": "✦ Pair programming ready. Let's take it step by step.",
    "继续写吧，遇到报错我们一起解决。": "Keep coding. We'll work through errors together.",
    "✦ 反重力已连接，今天的灵感从哪里开始？": "✦ Antigravity connected. Where shall we begin?",
    "✦ 反重力已退出，Dragon静静守候": "✦ Antigravity exited. Dragon is standing by.",
    "✦ 我在这里，Dragon随时为你效劳": "✦ I'm right here. Dragon is at your service.",
    "✦ 反重力已退出，Dragon与你暂别": "✦ Antigravity exited. Dragon is signing off.",
    "Dragon · 桌面智能伴侣": "Dragon · Desktop companion",
    "青绿守护者已连线 · 陪你探索与思考": "Turquoise guardian connected · Explore and think together",
    "清空并开启新对话": "Clear and start a new chat",
    "关闭对话框 (点击桌宠可重新打开)": "Close chat (click the pet to reopen)",
    "伴侣待命模式 · 平台工具就绪": "Companion standing by · Tools ready",
    "你好，我是你的青绿桌面伙伴": "Hello, I'm your turquoise desktop companion",
    "「Dragon」": "“Dragon”",
    "！": "!",
    "我已经接通了 Tools Platform 后台智能客服引擎。你可以随时向我询问：": "I'm connected to the Tools Platform assistant. Ask me about:",
    "• 平台系统工具使用说明与自动化技巧": "• Platform tools and automation tips",
    "• 今日任务、告警中心与数据运维状态": "• Today's tasks, alerts, and operations",
    "• 灵感探索、日常闲聊与编程协作": "• Ideas, everyday conversation, and coding together",
    "Dragon正在整理思路… ✦": "Dragon is gathering thoughts… ✦",
    "今日告警速报": "Today's alerts",
    "常用工具导航": "Platform tools",
    "灵感小憩": "A little inspiration",
    "自定义工具指引": "Custom tools",
    "请帮我检查一下当前平台的告警中心，最近有无未处理的异常告警？": "Please check the platform alert center for recent unresolved alerts.",
    "请介绍一下平台支持哪些核心运维工具和系统功能？": "What core operations tools and features does the platform offer?",
    "Dragon，我写代码有点累了，给我讲个关于古老图书馆的小故事，鼓励我一下吧。": "Dragon, I'm tired of coding. Tell me a little story about an ancient library and cheer me up.",
    "请告诉我如何使用平台的新增自定义系统工具？": "How do I use the platform's custom tools?",
    "向Dragon提问或闲聊… (Enter发送)": "Ask Dragon anything… (Enter to send)",
    "按 Enter 发送，Shift+Enter 换行": "Enter to send, Shift+Enter for a new line",
    "发送": "Send",
    "已复制 ✅": "Copied ✅",
    "自动复制受限，请在下方手动全选复制。": "Copy unavailable. Select and copy the report below.",
    "已同步": "Synced",
    "📅 周额度:": "📅 Weekly quota:",
    "正常在线": "Online",
    "独立伴侣模式 · 平台工具就绪": "Companion mode · Tools ready",
    "Dragon收到，准备继续。": "Dragon is ready to continue.",
    "AI 回复出错": "AI reply failed",
    "网络连接失败": "Network connection failed",
    "连接平台 AI 服务时遇到了一点问题：": "There was a problem connecting to the AI service:",
    "点击查看服务器原始请求与返回详情": "View request and response details",
    "(点击查看原始请求/返回 🔍)": "(View request / response 🔍)",
    "📡 平台服务端交互诊断报告": "📡 Service diagnostic report",
    "📋 复制诊断报告": "📋 Copy diagnostic report",
    "新的对话已开启，Dragon准备好了。一起探索下一个想法吧 ✦": "A fresh conversation is ready. Let's explore the next idea with Dragon ✦",
    "✦ Dragon · 桌面智能客服伴侣": "✦ Dragon · Desktop AI companion",
    "服务响应异常": "Service response error",
    "AI服务交互异常": "AI service error",
    "【客户端请求】": "[Client request]",
    "【服务端返回】": "[Server response]",
    "Dragon · 青绿桌面伙伴": "Dragon · Turquoise companion",
    "毛毡小龙 Dragon": "Dragon, the teal felt companion",
    "✦ Dragon · 青绿桌面伙伴": "✦ Dragon · Turquoise companion",
    "专注陪伴 (全局键盘联动)": "Focused companion (global typing)",
    "✦ 30 连击！心流渐入佳境，专注力拉满 ✦": "✦ 30 combo! Flow state unlocked, peak focus ✦",
    "🔥 50 连击！键盘敲出残影了，这就是大神的手速吗？！": "🔥 50 combo! Blazing hands, pure speed!",
    "⚡ 100 连击突破！反重力编译器超频全开 ⚡": "⚡ 100 combo! Antigravity compiler running at full throttle ⚡",
    "🐉 500 连击！Dragon 的小尾巴都跟着你的手速摇起来了 ✨": "🐉 500 combo! Dragon is wagging its tail to your rhythm ✨",
    "✦ 1000 连击破壁！唯有绝对专注与智慧不可阻挡 ✦": "✦ 1000 combo transcendence! Pure wisdom and unstoppable focus ✦"
};
    const originals = new Map(Object.entries(translations).map(([zh, en]) => [en.trim(), zh]));
    let language = 'zh-CN';
    function t(text) { return language === 'en-US' ? (translations[text] || text) : text; }
    function translateValue(value, write) {
        const trimmed = value.trim();
        const source = Object.hasOwn(translations, trimmed) ? trimmed : originals.get(trimmed);
        if (!source) return;
        const next = value.replace(trimmed, t(source));
        if (value !== next) write(next);
    }
    function apply(root = document) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent || parent.closest('script, style, pre, code')) continue;
            if (parent.closest('.msg-row') && !parent.closest('[data-pet-ui]')) continue;
            translateValue(node.nodeValue, value => { node.nodeValue = value; });
        }
        root.querySelectorAll('[title], [placeholder], [alt], [data-prompt]').forEach(el => {
            if (el.closest('.msg-row') && !el.closest('[data-pet-ui]')) return;
            for (const key of ['title', 'placeholder', 'alt', 'data-prompt']) {
                if (el.hasAttribute(key)) translateValue(el.getAttribute(key), value => el.setAttribute(key, value));
            }
        });
    }
    function setLanguage(value) {
        if (!['zh-CN', 'en-US'].includes(value)) return;
        language = value;
        document.documentElement.lang = language;
        apply();
        window.dispatchEvent(new CustomEvent('pet:languagechange', { detail: { language } }));
    }
    window.PetI18n = { t, apply, setLanguage, getLanguage: () => language };
    let revision = 0;
    try {
        const ipc = require('electron').ipcRenderer;
        ipc.on('pet-language-change', (_event, value) => { revision++; setLanguage(value); });
        const initialRevision = revision;
        ipc.invoke('pet-get-language').then(value => {
            if (revision === initialRevision) setLanguage(value);
        }).catch(() => {});
    } catch (_) {}
    document.addEventListener('DOMContentLoaded', () => {
        apply();
        new MutationObserver(() => apply()).observe(document.body, {
            subtree: true, childList: true, characterData: true,
            attributes: true, attributeFilter: ['title', 'placeholder', 'alt', 'data-prompt']
        });
    });
})();
