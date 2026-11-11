import SwiftUI
import shared

struct LoginView: View {
    @Bindable var store: DragonClawStore

    @State private var usernameInput: String = ""
    @State private var passwordInput: String = ""
    @State private var rememberMe: Bool = true
    @State private var autoLogin: Bool = false
    @State private var showPassword: Bool = false
    @State private var showServerConfig: Bool = false
    @State private var serverUrlDraft: String = ""

    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    var body: some View {
        ZStack {
            DragonClawBackdrop(palette: palette)

            ScrollView {
                VStack(spacing: 24) {
                    topUtilityBar

                    brandHero

                    loginGlassCard

                    if !store.appVersion.isEmpty {
                        Text("Dragon Claw Mobile v\(store.appVersion) · \(store.baseUrl)")
                            .font(.caption2)
                            .foregroundStyle(palette.inkMuted)
                            .multilineTextAlignment(.center)
                            .padding(.top, 4)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
                .padding(.bottom, 32)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .onAppear {
            usernameInput = store.sdk.getSavedUsername()
            passwordInput = store.sdk.getSavedPassword()
            rememberMe = store.rememberMe
            autoLogin = store.autoLogin
            serverUrlDraft = store.baseUrl
        }
        .sheet(isPresented: $showServerConfig) {
            serverConfigSheet
        }
    }

    private var topUtilityBar: some View {
        HStack {
            Spacer()
            GlassEffectContainer(spacing: 8) {
                HStack(spacing: 8) {
                    GlassCircleIconButton(
                        systemImage: store.themeMode == "dark" ? "sun.max.fill" : "moon.fill",
                        accessibilityLabel: L10n.tr(lang, zh: "切换主题", en: "Toggle theme")
                    ) {
                        store.toggleTheme()
                    }

                    Button {
                        store.toggleLanguage()
                    } label: {
                        Text(lang == "zh" ? "EN" : "中文")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(palette.inkPrimary)
                            .padding(.horizontal, 14)
                            .frame(height: 38)
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .glassEffect(.regular.interactive(), in: .capsule)

                    GlassCircleIconButton(
                        systemImage: "server.rack",
                        accessibilityLabel: L10n.tr(lang, zh: "服务器配置", en: "Server settings")
                    ) {
                        serverUrlDraft = store.baseUrl
                        showServerConfig = true
                    }
                }
            }
        }
    }

    private var brandHero: some View {
        VStack(spacing: 12) {
            Image("DragonClawMascot")
                .resizable()
                .scaledToFit()
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .padding(8)
                .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 26, style: .continuous))

            Text(store.displayPlatformName)
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundStyle(palette.inkPrimary)

            Text(store.identity.localizedSubtitle(language: lang))
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(palette.inkSecondary)

            Text(store.identity.localizedSlogan(language: lang))
                .font(.system(size: 11.5))
                .foregroundStyle(palette.inkMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 12)
        }
        .padding(.top, 8)
    }

    private var loginGlassCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 5) {
                Text(L10n.tr(lang, zh: "账号登录", en: "Sign In"))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(palette.inkPrimary)
                Text(L10n.tr(lang, zh: "登录后可使用 Dragon Claw 智能助手、工作台工具与 KPI 监控", en: "Access Dragon Claw AI workspace, hosted tools & KPI monitor"))
                    .font(.system(size: 11.5))
                    .foregroundStyle(palette.inkMuted)
            }

            VStack(spacing: 12) {
                HStack(spacing: 10) {
                    Image(systemName: "person")
                        .foregroundStyle(palette.inkMuted)
                        .frame(width: 20)
                    TextField(L10n.tr(lang, zh: "用户名", en: "Username"), text: $usernameInput)
                        .font(.system(size: 13.5))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .foregroundStyle(palette.inkPrimary)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(palette.chipSurface.opacity(0.75), in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                HStack(spacing: 10) {
                    Image(systemName: "lock")
                        .foregroundStyle(palette.inkMuted)
                        .frame(width: 20)
                    Group {
                        if showPassword {
                            TextField(L10n.tr(lang, zh: "密码", en: "Password"), text: $passwordInput)
                        } else {
                            SecureField(L10n.tr(lang, zh: "密码", en: "Password"), text: $passwordInput)
                        }
                    }
                    .font(.system(size: 13.5))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .foregroundStyle(palette.inkPrimary)

                    Button {
                        showPassword.toggle()
                    } label: {
                        Image(systemName: showPassword ? "eye.slash" : "eye")
                            .font(.subheadline)
                            .foregroundStyle(palette.inkMuted)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(palette.chipSurface.opacity(0.75), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }

            VStack(spacing: 10) {
                Toggle(isOn: $rememberMe) {
                    Text(L10n.tr(lang, zh: "记住账号与密码", en: "Remember credentials"))
                        .font(.system(size: 13))
                        .foregroundStyle(palette.inkSecondary)
                }
                .tint(palette.accent)
                .onChange(of: rememberMe) { _, newValue in
                    if !newValue { autoLogin = false }
                }

                Toggle(isOn: $autoLogin) {
                    Text(L10n.tr(lang, zh: "下次自动登录", en: "Auto sign in next time"))
                        .font(.system(size: 13))
                        .foregroundStyle(palette.inkSecondary)
                }
                .tint(palette.accent)
                .onChange(of: autoLogin) { _, newValue in
                    if newValue { rememberMe = true }
                }
            }

            if let error = store.loginError, !error.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(palette.danger)
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(palette.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(palette.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }

            Button {
                store.performLogin(
                    username: usernameInput,
                    password: passwordInput,
                    remember: rememberMe,
                    autoLogin: autoLogin
                )
            } label: {
                HStack(spacing: 8) {
                    if store.isAuthenticating {
                        ProgressView()
                            .tint(.white)
                    }
                    Text(
                        store.isAuthenticating
                            ? L10n.tr(lang, zh: "正在验证身份...", en: "Signing in...")
                            : L10n.tr(lang, zh: "进入工作台", en: "Enter Workspace")
                    )
                    .font(.system(size: 14.5, weight: .semibold))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
            }
            .buttonStyle(.glassProminent)
            .tint(palette.accentStrong)
            .disabled(store.isAuthenticating)
        }
        .padding(22)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
    }

    private var serverConfigSheet: some View {
        NavigationStack {
            ZStack {
                DragonClawBackdrop(palette: palette)

                VStack(alignment: .leading, spacing: 16) {
                    Text(L10n.tr(lang, zh: "服务端地址", en: "Server Endpoint"))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(palette.inkSecondary)

                    TextField("https://cs.fanxiaolong.uk", text: $serverUrlDraft)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .padding(14)
                        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 14, style: .continuous))

                    HStack(spacing: 12) {
                        Button(L10n.tr(lang, zh: "恢复默认", en: "Reset")) {
                            serverUrlDraft = "https://cs.fanxiaolong.uk"
                        }
                        .buttonStyle(.glass)

                        Button(L10n.tr(lang, zh: "保存并应用", en: "Save")) {
                            store.updateServerBaseUrl(serverUrlDraft)
                            showServerConfig = false
                        }
                        .buttonStyle(.glassProminent)
                        .tint(palette.accentStrong)
                    }

                    Spacer()
                }
                .padding(20)
            }
            .navigationTitle(L10n.tr(lang, zh: "服务器连接设置", en: "Server Connection"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.tr(lang, zh: "关闭", en: "Close")) {
                        showServerConfig = false
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
