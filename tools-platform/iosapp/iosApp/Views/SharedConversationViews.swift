import SwiftUI
import UIKit
import shared

// 共享对话的 iOS 界面：头像、消息署名、邀请横幅、提示条、消息中心里的邀请卡片、共享面板。
// 状态都在 SharingStore（store.sharing）。

/// 账号头像：首字 + 由账号算出的色相，深浅主题都清楚
struct ShareAvatar: View {
    let username: String
    var label: String = ""
    var size: CGFloat = 26
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let hue = Double(username.unicodeScalars.reduce(0) { ($0 * 31 + Int($1.value)) % 360 }) / 360.0
        let text = label.trimmingCharacters(in: .whitespaces).isEmpty ? username : label
        let initial: String = {
            guard let first = text.first else { return "?" }
            return first.isASCII && (first.isLetter || first.isNumber) ? String(text.prefix(2)).uppercased() : String(first)
        }()
        let dark = scheme == .dark
        Text(initial)
            .font(.system(size: size * 0.4, weight: .semibold))
            .foregroundStyle(Color(hue: hue, saturation: dark ? 0.45 : 0.6, brightness: dark ? 0.92 : 0.45))
            .frame(width: size, height: size)
            .background(Color(hue: hue, saturation: dark ? 0.45 : 0.18, brightness: dark ? 0.32 : 0.97), in: Circle())
            .overlay(Circle().strokeBorder(Color(hue: hue, saturation: 0.4, brightness: 0.5).opacity(0.18), lineWidth: 1))
    }
}

/// 共享对话里的消息署名：别人的提问 / 别人的 AI 回答；自己的提问显示「我 · 账号」
struct SharedAuthorLabel: View {
    let message: ChatMessage
    let me: String
    let palette: DragonClawPalette
    let language: String

    var body: some View {
        let author = message.sharedAuthor
        let name = message.sharedAuthorName ?? author ?? me
        let label: String = {
            guard let author else { return L10n.tr(language, zh: "我 · \(me)", en: "Me · \(me)") }
            if message.isUser { return name != author ? "\(name) · \(author)" : name }
            return L10n.tr(language, zh: "\(name) 的 AI 回答", en: "Answered for \(name)")
        }()
        if author != nil || message.isUser {
            HStack(spacing: 6) {
                if message.isUser { Spacer(minLength: 0) }
                ShareAvatar(username: author ?? me, label: name, size: 18)
                Text(label)
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(palette.inkMuted)
                    .lineLimit(1)
                if !message.isUser { Spacer(minLength: 0) }
            }
            .transition(.opacity)
        }
    }
}

/// 顶部邀请横幅：接受并打开 / 拒绝 / 稍后（稍后可在消息中心处理）
struct ShareInviteBanner: View {
    @Bindable var store: DragonClawStore
    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    var body: some View {
        if let item = store.sharing.banner {
            HStack(alignment: .top, spacing: 12) {
                ShareAvatar(username: item.invitedBy.isEmpty ? item.owner : item.invitedBy, label: item.invitedByName.isEmpty ? item.ownerName : item.invitedByName, size: 34)
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.headline(language: lang))
                        .font(.system(size: 13.5, weight: .semibold))
                        .foregroundStyle(palette.inkPrimary)
                    Text("「\(item.title)」 · \(item.meta(language: lang))")
                        .font(.system(size: 12))
                        .foregroundStyle(palette.inkMuted)
                        .lineLimit(1)
                    HStack(spacing: 8) {
                        Button {
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                            store.sharing.respond(item, action: "accept")
                        } label: {
                            Text(L10n.tr(lang, zh: "接受并打开", en: "Accept & open")).font(.system(size: 12.5, weight: .semibold))
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .foregroundStyle(.white)
                                .background(palette.accentStrong, in: Capsule())
                        }
                        Button { store.sharing.respond(item, action: "decline") } label: {
                            Text(L10n.tr(lang, zh: "拒绝", en: "Decline")).font(.system(size: 12.5))
                                .padding(.horizontal, 12).padding(.vertical, 6)
                                .foregroundStyle(palette.inkPrimary)
                                .overlay(Capsule().strokeBorder(palette.hairLine))
                        }
                        Button { store.sharing.dismissBanner(later: true) } label: {
                            Text(L10n.tr(lang, zh: "稍后", en: "Later")).font(.system(size: 12.5))
                                .padding(.horizontal, 8).padding(.vertical, 6)
                                .foregroundStyle(palette.inkSecondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 7)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: 460)
            .background(palette.cardSurface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(palette.hairLine))
            .shadow(color: .black.opacity(0.16), radius: 18, y: 8)
            .padding(.horizontal, 12)
            .padding(.top, 6)
            .transition(.move(edge: .top).combined(with: .opacity))
            .gesture(DragGesture(minimumDistance: 12).onEnded { value in
                if value.translation.height < -20 { store.sharing.dismissBanner(later: true) }
            })
            .task(id: item.shareId) {
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                if store.sharing.banner?.shareId == item.shareId { store.sharing.dismissBanner(later: false) }
            }
        }
    }
}

/// 底部提示条（共享相关的操作结果）
struct ShareNoticeToast: View {
    @Bindable var store: DragonClawStore

    var body: some View {
        if let text = store.sharing.notice, !text.isEmpty {
            Text(text)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(store.palette.accentStrong, in: Capsule())
                .shadow(color: .black.opacity(0.15), radius: 10, y: 4)
                .padding(.bottom, 80)
                .transition(.scale(scale: 0.92).combined(with: .opacity))
                .task(id: text) {
                    try? await Task.sleep(nanoseconds: 2_600_000_000)
                    if store.sharing.notice == text { withAnimation { store.sharing.notice = nil } }
                }
        }
    }
}

/// 消息中心顶部：共享对话邀请（接受 / 拒绝 / 忽略），以及粘贴网页端复制的共享链接加入
struct ShareInvitesSection: View {
    @Bindable var store: DragonClawStore
    @State private var linkDraft = ""
    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    var body: some View {
        if store.sharing.available {
            VStack(alignment: .leading, spacing: 8) {
                if !store.sharing.invites.isEmpty {
                    HStack(spacing: 6) {
                        Image(systemName: "person.2").font(.system(size: 12))
                        Text(L10n.tr(lang, zh: "共享对话邀请", en: "Shared conversation invites")).font(.system(size: 12.5, weight: .medium))
                        Text("\(store.sharing.invites.count)")
                            .font(.system(size: 11, weight: .semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 7).padding(.vertical, 1)
                            .background(palette.accentStrong, in: Capsule())
                    }
                    .foregroundStyle(palette.inkMuted)
                    ForEach(store.sharing.invites, id: \.shareId) { item in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack(spacing: 10) {
                                ShareAvatar(username: item.invitedBy.isEmpty ? item.owner : item.invitedBy, label: item.invitedByName.isEmpty ? item.ownerName : item.invitedByName, size: 32)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("「\(item.title)」").font(.system(size: 13.5, weight: .medium)).foregroundStyle(palette.inkPrimary).lineLimit(1)
                                    Text("\(item.headline(language: lang)) · \(item.meta(language: lang))").font(.system(size: 11.5)).foregroundStyle(palette.inkMuted).lineLimit(2)
                                }
                            }
                            HStack(spacing: 8) {
                                Spacer()
                                Button(L10n.tr(lang, zh: "忽略", en: "Ignore")) { store.sharing.respond(item, action: "ignore") }
                                    .foregroundStyle(palette.inkSecondary)
                                Button(L10n.tr(lang, zh: "拒绝", en: "Decline")) { store.sharing.respond(item, action: "decline") }
                                    .foregroundStyle(palette.inkPrimary)
                                Button {
                                    store.sharing.respond(item, action: "accept")
                                } label: {
                                    Text(L10n.tr(lang, zh: "接受", en: "Accept")).foregroundStyle(.white)
                                        .padding(.horizontal, 14).padding(.vertical, 6)
                                        .background(palette.accentStrong, in: Capsule())
                                }
                            }
                            .font(.system(size: 12.5))
                            .buttonStyle(.plain)
                        }
                        .padding(12)
                        .background(palette.accent.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(palette.accent.opacity(0.28)))
                        .transition(.asymmetric(insertion: .opacity, removal: .move(edge: .trailing).combined(with: .opacity)))
                    }
                }
                HStack(spacing: 8) {
                    Image(systemName: "link").foregroundStyle(palette.inkMuted)
                    TextField(L10n.tr(lang, zh: "粘贴共享链接加入对话", en: "Paste a share link to join"), text: $linkDraft)
                        .font(.system(size: 13))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .onSubmit { join() }
                    Button(L10n.tr(lang, zh: "加入", en: "Join")) { join() }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(palette.accentStrong)
                        .disabled(linkDraft.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(palette.cardSurface, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(palette.hairLine))
            }
            .padding(.horizontal, 16)
            .animation(.snappy, value: store.sharing.invites.count)
        }
    }

    private func join() {
        let text = linkDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        store.sharing.joinLink(text)
        linkDraft = ""
    }
}

/// 共享面板：搜索账号（支持拼音）、最近共享过、常用群组、已在共享中的成员、复制 / 分享链接
struct ShareConversationSheet: View {
    @Bindable var store: DragonClawStore
    @State private var creatingGroup = false
    @State private var groupName = ""
    @State private var copied = false
    @State private var confirmLeave = false
    @FocusState private var searchFocused: Bool
    private var palette: DragonClawPalette { store.palette }
    private var lang: String { store.language }

    var body: some View {
        NavigationStack {
            if let model = store.sharing.sheet {
                VStack(spacing: 0) {
                    header(model)
                    searchField(model)
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 2) {
                            content(model)
                        }
                        .padding(.horizontal, 12)
                        .padding(.bottom, 12)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    footer(model)
                }
                .background(palette.elevatedSurface)
                .toolbar(.hidden, for: .navigationBar)
                .alert(
                    model.share?.isOwner == true ? L10n.tr(lang, zh: "停止共享", en: "Stop sharing") : L10n.tr(lang, zh: "退出共享", en: "Leave"),
                    isPresented: $confirmLeave
                ) {
                    Button(L10n.tr(lang, zh: "取消", en: "Cancel"), role: .cancel) {}
                    Button(model.share?.isOwner == true ? L10n.tr(lang, zh: "停止共享", en: "Stop") : L10n.tr(lang, zh: "退出", en: "Leave"), role: .destructive) { store.sharing.leave() }
                } message: {
                    Text(model.share?.isOwner == true
                         ? L10n.tr(lang, zh: "停止共享后，成员保留已同步的内容，但之后双方的新消息不再互相同步。", en: "Members keep what has been synced, but new messages will no longer sync.")
                         : L10n.tr(lang, zh: "退出后你保留本地的对话副本，但不再收到其他成员的新消息。", en: "You keep your copy, but will stop receiving new messages."))
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    private func header(_ model: ShareSheetModel) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(palette.accentStrong)
                .frame(width: 34, height: 34)
                .background(palette.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(L10n.tr(lang, zh: "共享对话", en: "Share conversation")).font(.system(size: 16, weight: .semibold)).foregroundStyle(palette.inkPrimary)
                Text(model.title.isEmpty ? L10n.tr(lang, zh: "当前对话", en: "This conversation") : model.title)
                    .font(.system(size: 12.5)).foregroundStyle(palette.inkMuted).lineLimit(1)
            }
            Spacer()
            Button { store.sharing.closeSheet() } label: {
                Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(palette.inkMuted)
                    .frame(width: 30, height: 30).background(palette.chipSurface, in: Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
    }

    private func searchField(_ model: ShareSheetModel) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if !model.selected.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(model.selected, id: \.self) { username in
                            let name = model.account(username)?.name ?? username
                            Button { store.sharing.toggleAccount(username) } label: {
                                HStack(spacing: 5) {
                                    ShareAvatar(username: username, label: name, size: 20)
                                    Text(name).font(.system(size: 12.5)).foregroundStyle(palette.inkPrimary)
                                    Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(palette.inkMuted)
                                }
                                .padding(.leading, 3).padding(.trailing, 8).padding(.vertical, 3)
                                .background(palette.chipSurface, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .transition(.scale(scale: 0.7).combined(with: .opacity))
                        }
                    }
                }
            }
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(palette.inkMuted)
                TextField(L10n.tr(lang, zh: "输入账号名或姓名搜索（支持拼音）", en: "Search by name or pinyin"), text: Binding(
                    get: { store.sharing.sheet?.query ?? "" },
                    set: { store.sharing.setQuery($0) }
                ))
                .font(.system(size: 14))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($searchFocused)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(palette.cardSurface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(searchFocused ? palette.accentStrong : palette.hairLine, lineWidth: searchFocused ? 1.5 : 1))
        .animation(.snappy(duration: 0.2), value: searchFocused)
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private func content(_ model: ShareSheetModel) -> some View {
        if model.loading {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
        } else {
            if let error = model.error {
                Text(error).font(.system(size: 12.5)).foregroundStyle(palette.danger).padding(6)
            }
            if model.query.trimmingCharacters(in: .whitespaces).isEmpty {
                if !model.recentUsers.isEmpty {
                    sectionLabel("clock.arrow.circlepath", L10n.tr(lang, zh: "最近共享过", en: "Recently shared with"))
                    WrapLayout(spacing: 6) {
                        ForEach(model.recentUsers, id: \.username) { acc in
                            pill(selected: model.selected.contains(acc.username)) { store.sharing.toggleAccount(acc.username) } label: {
                                ShareAvatar(username: acc.username, label: acc.name, size: 20)
                                Text(acc.name).font(.system(size: 12.5)).foregroundStyle(palette.inkPrimary)
                            }
                        }
                    }
                    .padding(.horizontal, 6)
                }
                sectionLabel("person.2", L10n.tr(lang, zh: "常用群组", en: "Saved groups"))
                WrapLayout(spacing: 6) {
                    ForEach(model.orderedGroups, id: \.id) { group in
                        pill(selected: model.groupIds.contains(group.id)) { store.sharing.toggleGroup(group) } label: {
                            Image(systemName: "person.2").font(.system(size: 11)).foregroundStyle(palette.inkSecondary).padding(.leading, 4)
                            Text(group.name).font(.system(size: 12.5)).foregroundStyle(palette.inkPrimary)
                            Text("\(group.members.count)").font(.system(size: 11.5)).foregroundStyle(palette.inkMuted)
                        }
                        .contextMenu {
                            Button(role: .destructive) { store.sharing.deleteGroup(group) } label: {
                                Label(L10n.tr(lang, zh: "删除群组", en: "Delete group"), systemImage: "trash")
                            }
                        }
                    }
                    pill(selected: false, dashed: true) {
                        if model.selected.isEmpty {
                            store.sharing.notice = L10n.tr(lang, zh: "先在下面勾选要加入群组的人", en: "Select people first")
                        } else {
                            withAnimation(.snappy) { creatingGroup = true }
                        }
                    } label: {
                        Image(systemName: "plus").font(.system(size: 11, weight: .semibold)).foregroundStyle(palette.inkSecondary).padding(.leading, 4)
                        Text(model.selected.isEmpty ? L10n.tr(lang, zh: "新建群组（先勾选成员）", en: "New group (select people first)") : L10n.tr(lang, zh: "把已选的 \(model.selected.count) 人存为群组", en: "Save \(model.selected.count) as group"))
                            .font(.system(size: 12.5)).foregroundStyle(palette.inkSecondary)
                    }
                }
                .padding(.horizontal, 6)
                if creatingGroup {
                    HStack(spacing: 8) {
                        TextField(L10n.tr(lang, zh: "群组名称，如「北美研发」", en: "Group name"), text: $groupName)
                            .font(.system(size: 13))
                            .padding(.horizontal, 10).padding(.vertical, 8)
                            .background(palette.cardSurface, in: RoundedRectangle(cornerRadius: 9))
                            .overlay(RoundedRectangle(cornerRadius: 9).strokeBorder(palette.hairLine))
                        Button(L10n.tr(lang, zh: "保存", en: "Save")) {
                            store.sharing.saveGroup(name: groupName)
                            groupName = ""
                            withAnimation(.snappy) { creatingGroup = false }
                        }
                        .disabled(groupName.trimmingCharacters(in: .whitespaces).isEmpty)
                        .foregroundStyle(palette.accentStrong)
                        Button(L10n.tr(lang, zh: "取消", en: "Cancel")) { withAnimation(.snappy) { creatingGroup = false } }
                            .foregroundStyle(palette.inkSecondary)
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .padding(6)
                    .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            sectionLabel("person", model.query.isEmpty ? L10n.tr(lang, zh: "全部账号", en: "All accounts") : L10n.tr(lang, zh: "搜索结果", en: "Results"), trailing: "\(model.results.count)")
            if model.results.isEmpty {
                Text(L10n.tr(lang, zh: "没有匹配的账号", en: "No matching accounts"))
                    .font(.system(size: 12.5)).foregroundStyle(palette.inkMuted)
                    .frame(maxWidth: .infinity).padding(.vertical, 20)
            }
            ForEach(model.results, id: \.username) { acc in
                accountRow(acc, model: model)
            }
            let members = (model.share?.members ?? []).filter { $0.isAccepted || $0.isPending }
            if members.contains(where: { $0.username != store.username }) {
                sectionLabel("square.and.arrow.up", L10n.tr(lang, zh: "共享成员", en: "Members"), trailing: "\(members.count)")
                ForEach(members, id: \.username) { m in
                    HStack(spacing: 9) {
                        ShareAvatar(username: m.username, label: m.name, size: 22)
                        Text(m.name + (m.username == store.username ? L10n.tr(lang, zh: "（我）", en: " (me)") : ""))
                            .font(.system(size: 13)).foregroundStyle(palette.inkPrimary).lineLimit(1)
                        Spacer()
                        statusTag(ok: m.isAccepted, text: m.isOwner ? L10n.tr(lang, zh: "发起者", en: "Owner") : (m.isAccepted ? L10n.tr(lang, zh: "已加入", en: "Joined") : L10n.tr(lang, zh: "待接受", en: "Pending")))
                        if model.share?.isOwner == true && m.username != store.username {
                            Button { store.sharing.removeMember(m.username) } label: {
                                Image(systemName: "xmark").font(.system(size: 11, weight: .semibold)).foregroundStyle(palette.inkMuted).frame(width: 26, height: 26)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 8).padding(.vertical, 5)
                }
            }
        }
    }

    private func accountRow(_ acc: ShareAccount, model: ShareSheetModel) -> some View {
        let status = model.memberStatus(acc.username)
        let on = model.selected.contains(acc.username)
        return Button {
            UISelectionFeedbackGenerator().selectionChanged()
            store.sharing.toggleAccount(acc.username)
        } label: {
            HStack(spacing: 10) {
                ShareAvatar(username: acc.username, label: acc.name)
                VStack(alignment: .leading, spacing: 1) {
                    Text(acc.name).font(.system(size: 13.5)).foregroundStyle(palette.inkPrimary.opacity(status == nil ? 1 : 0.6)).lineLimit(1)
                    Text(acc.username).font(.system(size: 11.5)).foregroundStyle(palette.inkMuted).lineLimit(1)
                }
                Spacer()
                if let status {
                    statusTag(ok: status == "accepted", text: status == "accepted" ? L10n.tr(lang, zh: "已加入", en: "Joined") : L10n.tr(lang, zh: "待接受", en: "Pending"))
                } else {
                    Image(systemName: on ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 19))
                        .foregroundStyle(on ? palette.accentStrong : palette.inkMuted.opacity(0.5))
                        .symbolEffect(.bounce, value: on)
                }
            }
            .padding(.horizontal, 8).padding(.vertical, 8)
            .background(on ? palette.accent.opacity(0.08) : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(status != nil)
    }

    private func footer(_ model: ShareSheetModel) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            let link = store.sharing.shareLink
            HStack(spacing: 8) {
                Image(systemName: "link").foregroundStyle(palette.inkMuted)
                Text(link ?? L10n.tr(lang, zh: "正在生成共享链接…", en: "Generating link…"))
                    .font(.system(size: 12, design: .monospaced)).foregroundStyle(palette.inkSecondary).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 4)
                Button {
                    guard let link else { return }
                    UIPasteboard.general.string = link
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                    withAnimation(.snappy) { copied = true }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.8) { withAnimation { copied = false } }
                } label: {
                    Label(copied ? L10n.tr(lang, zh: "已复制", en: "Copied") : L10n.tr(lang, zh: "复制", en: "Copy"), systemImage: copied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(palette.accentStrong)
                }
                .buttonStyle(.plain)
                .disabled(link == nil)
                if let link, let url = URL(string: link) {
                    ShareLink(item: url, subject: Text(model.title), message: Text(model.title)) {
                        Image(systemName: "square.and.arrow.up").font(.system(size: 14, weight: .semibold)).foregroundStyle(palette.accentStrong)
                    }
                }
            }
            .padding(.horizontal, 10).padding(.vertical, 9)
            .background(palette.cardSurface, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).strokeBorder(palette.hairLine))
            Text(L10n.tr(lang, zh: "对方点开链接、登录平台后即可接受共享。共享的只是对话上下文（含历史里的附件与图片）；之后的提问、文件与命令都在各自账号下执行。", en: "Anyone with an account can open the link and accept after signing in. Only the conversation context is shared; new questions, files and commands run under each person’s own account."))
                .font(.system(size: 11.5)).foregroundStyle(palette.inkMuted)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                let joined = (model.share?.members ?? []).contains { $0.username != store.username && ($0.isAccepted || $0.isPending) }
                if let share = model.share, joined || !share.isOwner {
                    Button(share.isOwner ? L10n.tr(lang, zh: "停止共享", en: "Stop sharing") : L10n.tr(lang, zh: "退出共享", en: "Leave")) { confirmLeave = true }
                        .font(.system(size: 13)).foregroundStyle(palette.danger)
                }
                Spacer()
                Button(L10n.tr(lang, zh: "取消", en: "Cancel")) { store.sharing.closeSheet() }
                    .font(.system(size: 14)).foregroundStyle(palette.inkSecondary)
                Button {
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                    store.sharing.sendInvites()
                } label: {
                    HStack(spacing: 6) {
                        Text(model.busy ? L10n.tr(lang, zh: "正在发送…", en: "Sending…") : L10n.tr(lang, zh: "发送邀请", en: "Send invites"))
                        if !model.selected.isEmpty && !model.busy {
                            Text("\(model.selected.count)").font(.system(size: 11, weight: .bold))
                                .padding(.horizontal, 6).padding(.vertical, 1)
                                .background(.white.opacity(0.25), in: Capsule())
                                .contentTransition(.numericText())
                        }
                    }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16).padding(.vertical, 9)
                    .background(palette.accentStrong.opacity(model.selected.isEmpty || model.share == nil ? 0.45 : 1), in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(model.selected.isEmpty || model.busy || model.share == nil)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 18)
        .padding(.bottom, 14)
        .background(palette.elevatedSurface)
    }

    private func sectionLabel(_ icon: String, _ text: String, trailing: String? = nil) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 11))
            Text(text).font(.system(size: 11.5, weight: .semibold))
            Spacer()
            if let trailing { Text(trailing).font(.system(size: 11.5)) }
        }
        .foregroundStyle(palette.inkMuted)
        .padding(.horizontal, 8)
        .padding(.top, 14)
        .padding(.bottom, 6)
    }

    private func statusTag(ok: Bool, text: String) -> some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(ok ? palette.accentStrong : palette.inkSecondary)
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(ok ? palette.accent.opacity(0.12) : palette.chipSurface, in: Capsule())
    }

    private func pill<Label: View>(selected: Bool, dashed: Bool = false, action: @escaping () -> Void, @ViewBuilder label: () -> Label) -> some View {
        Button(action: action) {
            HStack(spacing: 6) { label() }
                .padding(.leading, 4).padding(.trailing, 10).padding(.vertical, 4)
                .background(selected ? palette.accent.opacity(0.09) : palette.cardSurface, in: Capsule())
                .overlay(
                    Capsule().strokeBorder(
                        selected ? palette.accentStrong.opacity(0.55) : (dashed ? palette.inkMuted.opacity(0.4) : palette.hairLine),
                        style: StrokeStyle(lineWidth: 1, dash: dashed ? [4, 3] : [])
                    )
                )
        }
        .buttonStyle(.plain)
    }
}

/// 自动换行的横向排布（标签 / 群组）
struct WrapLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maxX: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            x += size.width + spacing
            maxX = max(maxX, x - spacing)
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: proposal.width ?? maxX, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += rowHeight + spacing; rowHeight = 0 }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
