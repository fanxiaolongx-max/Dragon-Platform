// Claude Desktop accessibility helper. Compiled on first use by claude-ax.js.
// It only reads the Claude window or performs one small action per call; every
// decision (which session, is the target confirmed, draft/busy checks, did the
// text land) is made in Node so it can be tested without a desktop.
// Usage: claude-ax <command> [json-argument]; prints one JSON object.
import AppKit
import ApplicationServices
import Foundation

// The shared accessibility transport only addresses these two desktop clients.
let bundleId = ProcessInfo.processInfo.environment["DRAGON_AX_APP"] == "codex" ? "com.openai.codex" : "com.anthropic.claudefordesktop"
let keptRoles: Set<String> = ["AXButton", "AXHeading", "AXTextArea", "AXRadioButton"]

func emit(_ value: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    exit(0)
}
func fail(_ code: String, _ message: String) -> Never { emit(["ok": false, "code": code, "error": message]) }

func attr(_ element: AXUIElement, _ name: String) -> AnyObject? {
    var value: AnyObject?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}
func text(_ element: AXUIElement, _ name: String) -> String {
    if let s = attr(element, name) as? String { return s }
    if let n = attr(element, name) as? NSNumber { return n.stringValue }
    return ""
}

func claudeApp() -> NSRunningApplication? {
    NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first
}
func mainWindow(_ app: NSRunningApplication) -> AXUIElement? {
    let root = AXUIElementCreateApplication(app.processIdentifier)
    if let main = attr(root, kAXMainWindowAttribute) { return (main as! AXUIElement) }
    return (attr(root, kAXWindowsAttribute) as? [AXUIElement])?.first
}

// Depth-first walk collecting the roles the Node side understands, in screen order.
func collect(_ window: AXUIElement, includeText: Bool = false) -> [(AXUIElement, [String: Any])] {
    var out: [(AXUIElement, [String: Any])] = []
    var stack: [AXUIElement] = [window]
    var visited = 0
    while let element = stack.popLast(), visited < 20000 {
        visited += 1
        let role = text(element, kAXRoleAttribute)
        if keptRoles.contains(role) || (includeText && role == "AXStaticText") {
            var item: [String: Any] = ["role": role, "title": text(element, kAXTitleAttribute), "desc": text(element, kAXDescriptionAttribute)]
            if role == "AXTextArea" || role == "AXRadioButton" || role == "AXStaticText" { item["value"] = String(text(element, kAXValueAttribute).prefix(20000)) }
            if let enabled = attr(element, kAXEnabledAttribute) as? Bool { item["enabled"] = enabled }
            out.append((element, item))
        }
        if let children = attr(element, kAXChildrenAttribute) as? [AXUIElement] { stack.append(contentsOf: children.reversed()) }
    }
    return out
}

func requireWindow() -> (NSRunningApplication, AXUIElement) {
    guard AXIsProcessTrusted() else { fail("AX_PERMISSION", "需要在“系统设置 → 隐私与安全性 → 辅助功能”中允许运行平台服务的程序") }
    guard let app = claudeApp() else { fail("DESKTOP_UNAVAILABLE", "Claude 桌面未运行") }
    guard let window = mainWindow(app) else { fail("DESKTOP_UNAVAILABLE", "Claude 桌面没有打开的窗口") }
    return (app, window)
}
// NSWorkspace only refreshes the frontmost app while the run loop turns, so waits spin it.
func pause(_ seconds: Double) { RunLoop.current.run(until: Date().addingTimeInterval(seconds)) }
func frontmostId() -> String { pause(0.01); return NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "" }
func activate(_ bundle: String) {
    if bundle.isEmpty || bundle == bundleId { return }
    NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first?.activate()
}
func waitFrontmost(_ app: NSRunningApplication) -> Bool {
    for i in 0..<50 {
        if frontmostId() == bundleId { return true }
        if i % 10 == 0 { app.activate() }
        pause(0.1)
    }
    return false
}
// Chromium may initially expose only its outer HTML container while the app is
// in the background. Activate first and wait for actual controls, so a cold AX
// tree is not mistaken for a missing sidebar conversation. No typing occurs.
func prepareWindow() -> (NSRunningApplication, AXUIElement, String) {
    let (app, _) = requireWindow()
    let previous = frontmostId()
    // Existing OS permission does not initialize Electron's web accessibility
    // tree. This is Electron's documented assistive-technology entry point:
    // https://www.electronjs.org/docs/latest/tutorial/accessibility
    let root = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetAttributeValue(root, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    guard waitFrontmost(app) else { activate(previous); fail("DESKTOP_FOCUS", "无法把 Claude 切到前台") }
    for _ in 0..<30 {
        if let window = mainWindow(app) {
            let items = collect(window)
            if items.contains(where: { $0.1["role"] as? String == "AXTextArea" }) && items.contains(where: { $0.1["role"] as? String == "AXButton" }) {
                return (app, window, previous)
            }
        }
        pause(0.1)
    }
    activate(previous)
    fail("DESKTOP_UI_NOT_READY", "Claude 界面尚未提供会话控件，未输入任何内容；请等待界面加载后重试")
}
// Claude's sidebar ignores the synthetic AXPress, so a session row gets a real
// mouse click — only after a hit test proves that point belongs to that row.
func frame(_ element: AXUIElement) -> CGRect? {
    guard let p = attr(element, kAXPositionAttribute), let z = attr(element, kAXSizeAttribute) else { return nil }
    var point = CGPoint.zero, size = CGSize.zero
    AXValueGetValue(p as! AXValue, .cgPoint, &point)
    AXValueGetValue(z as! AXValue, .cgSize, &size)
    return CGRect(origin: point, size: size)
}
func owns(_ row: AXUIElement, _ point: CGPoint) -> Bool {
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(point.x), Float(point.y), &hit) == .success, var node = hit else { return false }
    for _ in 0..<8 {
        if CFEqual(node, row) { return true }
        guard let parent = attr(node, kAXParentAttribute) else { return false }
        node = parent as! AXUIElement
    }
    return false
}
func click(_ point: CGPoint) {
    let saved = CGEvent(source: nil)?.location
    let source = CGEventSource(stateID: .combinedSessionState)
    for type in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
        CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        pause(0.04)
    }
    if let saved = saved { CGWarpMouseCursorPosition(saved) }
}
func key(_ code: CGKeyCode, command: Bool = false) {
    let source = CGEventSource(stateID: .combinedSessionState)
    for down in [true, false] {
        let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down)
        if command { event?.flags = .maskCommand }
        event?.post(tap: .cghidEventTap)
        usleep(20_000)
    }
}

// Only the observed session-suggestion card is actionable. Never expose arbitrary
// buttons (permissions, account settings, deletion, etc.) as remote choices.
func label(_ item: [String: Any]) -> String {
    for key in ["title", "desc", "value"] {
        if let value = item[key] as? String, !value.isEmpty { return value }
    }
    return ""
}
func sessionWindow(_ title: String) -> AXUIElement? {
    guard AXIsProcessTrusted(), let app = claudeApp() else { return nil }
    let root = AXUIElementCreateApplication(app.processIdentifier)
    AXUIElementSetAttributeValue(root, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    let windows = (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? []
    let matches = windows.filter { window in
        collect(window).contains { _, item in
            item["role"] as? String == "AXHeading" && item["desc"] as? String == title && (item["title"] as? String ?? "").isEmpty
        }
    }
    return matches.count == 1 ? matches[0] : nil
}
func sessionChoice(_ window: AXUIElement) -> (String, [(AXUIElement, String)])? {
    let prompts = collect(window, includeText: true).filter { _, item in
        guard item["role"] as? String == "AXStaticText" else { return false }
        let s = label(item)
        return s.hasPrefix("要在单独的会话中启动吗？") || s.hasPrefix("Start in a separate session?")
    }
    guard prompts.count == 1 else { return nil }
    var parent = prompts[0].0
    for _ in 0..<5 {
        guard let next = attr(parent, kAXParentAttribute) else { return nil }
        parent = next as! AXUIElement
        let items = collect(parent, includeText: true)
        let buttons = items.filter { $0.1["role"] as? String == "AXButton" }
        for labels in [["在此处操作", "新建会话"], ["Work here", "New session"]] {
            let choices = labels.map { wanted in buttons.filter { label($0.1) == wanted && ($0.1["enabled"] as? Bool ?? true) } }
            if choices.allSatisfy({ $0.count == 1 }) {
                let prompt = items.filter { $0.1["role"] as? String == "AXStaticText" }.map { label($0.1) }.joined(separator: "\n")
                return (prompt, choices.enumerated().map { (i, matches) in (matches[0].0, labels[i]) })
            }
        }
    }
    return nil
}

let args = CommandLine.arguments
let command = args.count > 1 ? args[1] : "snapshot"
let argument: [String: Any] = args.count > 2 ? ((try? JSONSerialization.jsonObject(with: Data(args[2].utf8))) as? [String: Any] ?? [:]) : [:]

switch command {
case "interaction", "choose":
    let title = argument["title"] as? String ?? ""
    guard !title.isEmpty, let window = sessionWindow(title) else {
        if command == "interaction" { emit(["ok": true, "available": false]) }
        fail("DESKTOP_TARGET_UNCONFIRMED", "请在 Claude 桌面打开对应会话，当前无法唯一确认目标")
    }
    if command == "interaction" {
        guard let choice = sessionChoice(window) else { emit(["ok": true, "available": true, "pending": NSNull()]) }
        emit(["ok": true, "available": true, "pending": ["prompt": choice.0, "options": choice.1.map { $0.1 }]])
    }
    let previous = frontmostId()
    guard let app = claudeApp(), waitFrontmost(app) else { activate(previous); fail("DESKTOP_FOCUS", "无法激活 Claude") }
    AXUIElementPerformAction(window, kAXRaiseAction as CFString)
    pause(0.1)
    // Re-read after activation. Do not click a stale card or a button elsewhere.
    guard let fresh = sessionWindow(title), CFEqual(window, fresh),
          let choice = sessionChoice(fresh), choice.0 == argument["prompt"] as? String,
          let option = choice.1.first(where: { $0.1 == argument["option"] as? String }),
          let box = frame(option.0), box.width > 8, box.height > 8,
          frontmostId() == bundleId, owns(option.0, CGPoint(x: box.midX, y: box.midY)) else {
        activate(previous); fail("DESKTOP_CHOICE_STALE", "Claude 的问题或目标已变化，请刷新后重新选择")
    }
    click(CGPoint(x: box.midX, y: box.midY))
    for _ in 0..<15 {
        pause(0.1)
        if sessionChoice(fresh)?.0 != choice.0 {
            activate(previous); emit(["ok": true, "status": "accepted"])
        }
    }
    activate(previous)
    fail("DESKTOP_CHOICE_UNCONFIRMED", "已点击但尚未确认选择生效，请检查 Claude 后刷新，避免重复操作")
case "status":
    emit(["ok": true, "trusted": AXIsProcessTrusted(), "running": claudeApp() != nil])
case "snapshot":
    let (_, window) = requireWindow()
    emit(["ok": true, "frontmost": frontmostId() == bundleId, "windowTitle": text(window, kAXTitleAttribute), "elements": collect(window).map { $0.1 }])
case "prepare":
    let (_, _, previous) = prepareWindow()
    emit(["ok": true, "previous": previous])
case "submit-text":
    let (app, window) = requireWindow()
    let expected = argument["text"] as? String ?? ""
    let normalize: (String) -> String = {
        $0.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "\n{2,}", with: "\n", options: .regularExpression)
    }
    let matches = collect(window).filter { $0.1["role"] as? String == "AXTextArea" && normalize($0.1["value"] as? String ?? "") == normalize(expected) }
    guard !expected.isEmpty, matches.count == 1 else { fail("DESKTOP_TARGET_UNCONFIRMED", "桌面输入框与新会话问题不一致，未发送") }
    let previous = frontmostId()
    guard waitFrontmost(app) else { fail("DESKTOP_FOCUS", "无法激活桌面客户端") }
    AXUIElementSetAttributeValue(matches[0].0, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    guard frontmostId() == bundleId, normalize(text(matches[0].0, kAXValueAttribute)) == normalize(expected) else { activate(previous); fail("DESKTOP_TARGET_UNCONFIRMED", "发送前输入目标发生变化，已停止") }
    key(36)
    pause(0.2)
    activate(argument["previous"] as? String ?? previous)
    emit(["ok": true])
case "press":
    // Press the one button whose title is exactly argument.title (a sidebar session row).
    // Claude ignores the press while it is in the background, so bring it forward first.
    let (_, window, previous) = prepareWindow()
    let wanted = argument["title"] as? String ?? ""
    let matches = collect(window).filter { $0.1["role"] as? String == "AXButton" && $0.1["title"] as? String == wanted }
    guard matches.count == 1 else { activate(previous); fail("DESKTOP_TARGET_UNCONFIRMED", "Claude 侧栏中找到 \(matches.count) 个同名会话") }
    let row = matches[0].0
    AXUIElementPerformAction(row, "AXScrollToVisible" as CFString)
    pause(0.25)
    guard let box = frame(row), box.width > 20, box.height > 8 else { activate(previous); fail("DESKTOP_TARGET_UNCONFIRMED", "无法定位 Claude 侧栏中的会话") }
    let point = CGPoint(x: box.minX + min(box.width * 0.35, 90), y: box.midY) // 避开行右侧悬停出现的按钮
    guard owns(row, point) else { activate(previous); fail("DESKTOP_TARGET_UNCONFIRMED", "Claude 侧栏中的会话被遮挡，已停止") }
    click(point)
    emit(["ok": true, "previous": previous])
case "paste":
    // Bring Claude forward, focus the only composer and paste argument.text. The
    // previous clipboard is restored; the caller reads the composer back before sending.
    let (app, window) = requireWindow()
    let composers = collect(window).filter { $0.1["role"] as? String == "AXTextArea" }
    guard composers.count == 1 else { fail("DESKTOP_TARGET_UNCONFIRMED", "Claude 窗口中有 \(composers.count) 个输入框，无法确定发送位置") }
    let previous = frontmostId()
    guard waitFrontmost(app) else { activate(previous); fail("DESKTOP_FOCUS", "无法把 Claude 切到前台") }
    AXUIElementSetAttributeValue(composers[0].0, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    pause(0.12)
    let board = NSPasteboard.general
    let saved = (board.pasteboardItems ?? []).map { item -> NSPasteboardItem in
        let copy = NSPasteboardItem()
        for type in item.types { if let data = item.data(forType: type) { copy.setData(data, forType: type) } }
        return copy
    }
    board.clearContents()
    board.setString(argument["text"] as? String ?? "", forType: .string)
    guard frontmostId() == bundleId else { board.clearContents(); board.writeObjects(saved); fail("DESKTOP_FOCUS", "Claude 已不在前台，已停止输入") }
    key(9, command: true) // ⌘V
    pause(0.35)
    board.clearContents()
    if !saved.isEmpty { board.writeObjects(saved) }
    emit(["ok": true, "previous": previous])
case "submit":
    // Press Return in Claude only while it is still frontmost, then hand focus back.
    let (app, _) = requireWindow()
    guard frontmostId() == bundleId else { fail("DESKTOP_FOCUS", "Claude 已不在前台，未发送") }
    key(36)
    pause(0.2)
    activate(argument["previous"] as? String ?? "")
    _ = app
    emit(["ok": true])
case "restore":
    // Hand the foreground back after a refused send.
    activate(argument["previous"] as? String ?? "")
    emit(["ok": true])
default:
    fail("DESKTOP_PROTOCOL", "未知命令")
}
