import SwiftUI
import WebKit
import shared

struct AuthenticatedToolWebScreen: View {
    @Bindable var store: DragonClawStore
    let tool: PlatformTool
    @Environment(\.dismiss) private var dismiss

    @State private var isLoading = true
    @State private var pageProgress: Double = 0.0
    @State private var webViewRef: WKWebView? = nil

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }
    private var targetUrl: URL? { URL(string: store.sdk.buildToolUrl(routePath: tool.routePath)) }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                DragonClawBackdrop(palette: palette)

                if let url = targetUrl {
                    AuthenticatedWKWebView(
                        url: url,
                        token: store.token,
                        username: store.username,
                        role: store.role,
                        tenantId: store.tenantId,
                        isSuper: store.isSuper,
                        language: store.language,
                        isLoading: $isLoading,
                        progress: $pageProgress,
                        webViewRef: $webViewRef
                    )
                    .ignoresSafeArea(edges: .bottom)
                } else {
                    Text(L10n.tr(lang, zh: "无效的工具地址", en: "Invalid tool URL"))
                        .foregroundStyle(palette.danger)
                }

                if isLoading {
                    ProgressView(value: max(pageProgress, 0.08))
                        .tint(palette.accentStrong)
                }
            }
            .navigationTitle(tool.localizedTitle(language: lang))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark")
                    }
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        webViewRef?.reload()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    if let url = targetUrl {
                        Link(destination: url) {
                            Image(systemName: "safari")
                        }
                    }
                }
            }
        }
    }
}

private struct AuthenticatedWKWebView: UIViewRepresentable {
    let url: URL
    let token: String
    let username: String
    let role: String
    let tenantId: String
    let isSuper: Bool
    let language: String
    @Binding var isLoading: Bool
    @Binding var progress: Double
    @Binding var webViewRef: WKWebView?

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        if !token.isEmpty {
            let seedScript = Self.buildStorageBootstrapScript(
                origin: Self.originString(for: url),
                token: token,
                username: username,
                role: role,
                tenantId: tenantId,
                isSuper: isSuper,
                language: language
            )
            config.userContentController.addUserScript(
                WKUserScript(source: seedScript, injectionTime: .atDocumentStart, forMainFrameOnly: false)
            )
        }

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        context.coordinator.observe(webView)

        Task { @MainActor in
            webViewRef = webView
            await injectAuthCookieAndLoad(webView: webView)
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    private static func originString(for url: URL) -> String {
        let scheme = url.scheme ?? "https"
        let host = url.host ?? ""
        if let port = url.port {
            return "\(scheme)://\(host):\(port)"
        }
        return "\(scheme)://\(host)"
    }

    private static func jsonLiteral(_ value: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [value]),
              let encoded = String(data: data, encoding: .utf8),
              encoded.count >= 2 else {
            return "\"\""
        }
        return String(encoded.dropFirst().dropLast())
    }

    private static func buildStorageBootstrapScript(
        origin: String,
        token: String,
        username: String,
        role: String,
        tenantId: String,
        isSuper: Bool,
        language: String
    ) -> String {
        let cleanTenant = tenantId.isEmpty ? "default" : tenantId
        let cleanLang = language.isEmpty ? "zh" : language
        return """
        (function() {
            try {
                if (window.location && window.location.origin !== \(jsonLiteral(origin))) return;
                var pairs = {
                    tools_token: \(jsonLiteral(token)),
                    tools_user: \(jsonLiteral(username)),
                    tools_role: \(jsonLiteral(role)),
                    tools_super: \(jsonLiteral(isSuper ? "1" : "0")),
                    tools_tenant_id: \(jsonLiteral(cleanTenant)),
                    tools_lang: \(jsonLiteral(cleanLang)),
                    tools_language: \(jsonLiteral(cleanLang))
                };
                Object.keys(pairs).forEach(function(key) {
                    var val = pairs[key];
                    if (val !== undefined && val !== null && val !== '') {
                        try { window.localStorage.setItem(key, val); } catch (_) {}
                        try { window.sessionStorage.setItem(key, val); } catch (_) {}
                    }
                });
                var secureAttr = window.location.protocol === 'https:' ? '; Secure' : '';
                document.cookie = 'tools_token=' + encodeURIComponent(pairs.tools_token) + '; path=/; SameSite=Lax' + secureAttr;
            } catch (_) {}
        })();
        """
    }

    @MainActor
    private func injectAuthCookieAndLoad(webView: WKWebView) async {
        if let host = url.host, !token.isEmpty {
            var props: [HTTPCookiePropertyKey: Any] = [
                .name: "tools_token",
                .value: token,
                .domain: host,
                .path: "/"
            ]
            if url.scheme?.lowercased() == "https" {
                props[.secure] = "TRUE"
            }
            if let cookie = HTTPCookie(properties: props) {
                await webView.configuration.websiteDataStore.httpCookieStore.setCookie(cookie)
            }
        }
        var request = URLRequest(url: url)
        request.setValue("ios", forHTTPHeaderField: "X-Client-Platform")
        request.setValue("DragonClaw/1.0.614", forHTTPHeaderField: "X-Client-Version")
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        webView.load(request)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let parent: AuthenticatedWKWebView
        private var progressObs: NSKeyValueObservation?

        init(_ parent: AuthenticatedWKWebView) {
            self.parent = parent
        }

        func observe(_ webView: WKWebView) {
            progressObs = webView.observe(\.estimatedProgress, options: .new) { [weak self] view, _ in
                Task { @MainActor [weak self] in
                    self?.parent.progress = view.estimatedProgress
                }
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            Task { @MainActor in parent.isLoading = true }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { @MainActor in parent.isLoading = false }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            Task { @MainActor in parent.isLoading = false }
        }
    }
}
