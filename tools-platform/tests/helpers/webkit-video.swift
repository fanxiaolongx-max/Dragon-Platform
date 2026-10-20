// Native WebKit/AVFoundation media regression runner. Requires macOS and Command Line Tools.
import Cocoa
import WebKit

class Results: NSObject, WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let text = String(describing: message.body)
        print(text)
        fflush(stdout)
        if text == "TEST_DONE" { exit(0) }
        if text.hasPrefix("TEST_FAILED:") { exit(1) }
    }
}
let app = NSApplication.shared
let config = WKWebViewConfiguration()
config.mediaTypesRequiringUserActionForPlayback = []
let results = Results()
config.userContentController.add(results, name: "result")
let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 900), configuration: config)
let window = NSWindow(contentRect: web.frame, styleMask: [.titled], backing: .buffered, defer: false)
window.contentView = web
window.orderBack(nil)
web.load(URLRequest(url: URL(string: CommandLine.arguments[1])!))
DispatchQueue.main.asyncAfter(deadline: .now() + 240) { print("TEST_FAILED: WebKit timeout"); exit(1) }
app.run()
