import Foundation
import Observation
import SwiftUI
import shared

/// 共享对话（与网页端同一套 /api/shared-conversations）：侧栏「共享对话」分类、邀请横幅与消息中心、共享面板、
/// 打开共享对话时的同步与轮询（别人发的新消息直接接在后面）。共享的只是上下文，新的提问在本人账号下执行。
/// 后端还没有该接口（旧服务未重启）时 `available` 为 false，入口全部隐藏。
@Observable
@MainActor
final class SharingStore {
    @ObservationIgnored weak var store: DragonClawStore?
    @ObservationIgnored private var slowTask: Task<Void, Never>?
    @ObservationIgnored private var activeTask: Task<Void, Never>?
    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var bannerShown = Set<String>()
    @ObservationIgnored private var pendingAppend: String?
    @ObservationIgnored private var syncing = false

    var available = false
    var mine: [SharedConversation] = []
    var invites: [ShareInvite] = []
    var banner: ShareInvite?
    var notice: String?
    var isSharedCollapsed = false
    var sheet: ShareSheetModel?

    nonisolated init() {}

    private var sdk: DragonClawSdk? { store?.sdk }
    private var token: String { store?.token ?? "" }
    private var lang: String { store?.language ?? "zh" }

    var inviteCount: Int { available ? invites.count : 0 }
    func info(_ sessionId: String?) -> SharedConversation? {
        guard let sessionId else { return nil }
        return mine.first { $0.sessionId == sessionId }
    }
    func isShared(_ sessionId: String?) -> Bool { info(sessionId) != nil }

    func start(store: DragonClawStore) {
        self.store = store
        isSharedCollapsed = store.sdk.isSharedSessionsCollapsed()
        refreshAll()
        slowTask?.cancel()
        slowTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                guard let self else { return }
                guard let store = self.store, store.isAuthenticated, store.isAppActive else { continue }
                self.refreshAll()
            }
        }
        activeTask?.cancel()
        activeTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                guard let self else { return }
                guard let store = self.store, store.isAuthenticated, store.isAppActive else { continue }
                self.syncActive()
            }
        }
    }

    func stop() {
        slowTask?.cancel(); activeTask?.cancel(); searchTask?.cancel()
        mine = []; invites = []; banner = nil; sheet = nil; available = false
        bannerShown.removeAll()
    }

    func refreshAll() {
        guard let sdk, !token.isEmpty else { return }
        _ = sdk.fetchShareInbox(token: token) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.available = true
                self.invites = res.items
                if let current = self.banner, !self.invites.contains(where: { $0.shareId == current.shareId }) { self.banner = nil }
                if self.banner == nil { self.nextBanner() }
                self.refreshMine()
            }
        } onError: { [weak self] _ in
            Task { @MainActor [weak self] in self?.available = false }
        }
    }

    func refreshMine(then: (() -> Void)? = nil) {
        guard let sdk, !token.isEmpty else { return }
        _ = sdk.fetchSharedConversations(token: token) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self, let store = self.store else { return }
                let me = store.username
                let next = res.items.filter { !$0.isOwner || $0.hasOthers(me: me) }
                if next != self.mine {
                    self.mine = next
                    store.regroupSessions()
                }
                then?()
            }
        } onError: { _ in }
    }

    private func nextBanner() {
        guard let next = invites.first(where: { !bannerShown.contains($0.shareId) }) else { return }
        bannerShown.insert(next.shareId)
        withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) { banner = next }
    }

    func dismissBanner(later: Bool) {
        withAnimation(.spring(response: 0.38, dampingFraction: 0.9)) { banner = nil }
        if later { notice = L10n.tr(lang, zh: "可以随时在消息中心里处理这个邀请", en: "You can respond later from the message center") }
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 450_000_000)
            self?.nextBanner()
        }
    }

    func respond(_ invite: ShareInvite, action: String) {
        guard let sdk else { return }
        if banner?.shareId == invite.shareId { withAnimation { banner = nil } }
        _ = sdk.respondShareInvite(token: token, shareId: invite.shareId, action: action) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                withAnimation(.snappy) { self.invites.removeAll { $0.shareId == invite.shareId } }
                switch action {
                case "accept":
                    self.notice = L10n.tr(self.lang, zh: "已加入共享对话「\(invite.title)」", en: "Joined “\(invite.title)”")
                    let sessionId = res.sessionId
                    self.refreshMine { [weak self] in
                        if !sessionId.isEmpty { self?.store?.openSharedSession(sessionId: sessionId, title: invite.title) }
                    }
                case "decline":
                    self.notice = L10n.tr(self.lang, zh: "已拒绝邀请", en: "Invite declined")
                default:
                    self.notice = L10n.tr(self.lang, zh: "已忽略，之后仍可通过共享链接加入", en: "Ignored. You can still join from the link.")
                }
                self.nextBanner()
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                self?.notice = err
                self?.invites.removeAll { $0.shareId == invite.shareId }
            }
        }
    }

    /// 粘贴网页端复制的共享链接加入
    func joinLink(_ text: String) {
        guard let sdk else { return }
        guard let linkToken = sdk.shareTokenFromLink(text: text) else {
            notice = L10n.tr(lang, zh: "这不是有效的共享链接", en: "That is not a valid share link")
            return
        }
        _ = sdk.joinShareLink(token: token, linkToken: linkToken) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                if res.status == "accepted", !res.sessionId.isEmpty {
                    let sessionId = res.sessionId
                    self.refreshMine { [weak self] in self?.store?.openSharedSession(sessionId: sessionId, title: "") }
                } else if let invite = res.invite {
                    self.invites = [invite] + self.invites.filter { $0.shareId != invite.shareId }
                    self.bannerShown.insert(invite.shareId)
                    withAnimation(.spring(response: 0.42, dampingFraction: 0.82)) { self.banner = invite }
                }
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in self?.notice = err }
        }
    }

    func toggleCollapsed() {
        isSharedCollapsed.toggle()
        sdk?.setSharedSessionsCollapsed(collapsed: isSharedCollapsed)
    }

    // MARK: - 打开中的共享对话

    func syncBeforeOpen(_ sessionId: String, then: @escaping () -> Void) {
        guard let sdk, isShared(sessionId) else { then(); return }
        _ = sdk.syncSharedSession(token: token, sessionId: sessionId) { _ in
            Task { @MainActor in then() }
        } onError: { _ in
            Task { @MainActor in then() }
        }
    }

    private func syncActive() {
        guard let store, let sdk, !syncing, let sessionId = store.currentSessionId, store.activeDesktopSession == nil, isShared(sessionId) else { return }
        syncing = true
        _ = sdk.syncSharedSession(token: token, sessionId: sessionId) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.syncing = false
                let pulled = Int(res.result?.pulled ?? 0)
                if pulled > 0 || self.pendingAppend == sessionId {
                    self.pendingAppend = sessionId
                    self.store?.appendSharedMessages(sessionId: sessionId) { [weak self] done in
                        if done { self?.pendingAppend = nil }
                    }
                }
                if pulled > 0 || res.result?.closed == true { self.refreshMine() }
            }
        } onError: { [weak self] _ in
            Task { @MainActor [weak self] in self?.syncing = false }
        }
    }

    // MARK: - 共享面板

    func openSheet(sessionId: String, title: String) {
        guard let sdk else { return }
        guard available else {
            notice = L10n.tr(lang, zh: "当前服务还不支持共享对话，请升级或重启服务", en: "Sharing is not available on this server yet")
            return
        }
        let clean = sdk.cleanTitle(raw: title)
        sheet = ShareSheetModel(sessionId: sessionId, title: clean)
        let group = DispatchGroup()
        var accounts: [ShareAccount] = [], groups: [ShareGroup] = [], recent = ShareRecentResponse(users: [], groups: [])
        var share: SharedConversation?
        var error: String?
        group.enter()
        _ = sdk.fetchShareAccounts(token: token, query: "") { res in accounts = res.items; group.leave() } onError: { err in error = err; group.leave() }
        group.enter()
        _ = sdk.fetchShareGroups(token: token) { res in groups = res.items; group.leave() } onError: { _ in group.leave() }
        group.enter()
        _ = sdk.fetchShareRecent(token: token) { res in recent = res; group.leave() } onError: { _ in group.leave() }
        group.enter()
        _ = sdk.prepareShare(token: token, sessionId: sessionId, title: clean) { res in share = res.share; group.leave() } onError: { err in error = error ?? err; group.leave() }
        group.notify(queue: .main) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, var model = self.sheet, model.sessionId == sessionId else { return }
                model.loading = false
                model.accounts = accounts
                model.groups = groups
                model.recent = recent
                model.share = share
                model.error = error
                model.results = sdk.sortShareAccounts(accounts: accounts, query: "", recent: recent.users)
                withAnimation(.snappy) { self.sheet = model }
            }
        }
    }

    func closeSheet() { sheet = nil; searchTask?.cancel() }

    /// 搜索：先本地过滤；输入像拼音时再请服务端按拼音匹配显示名，合并结果
    func setQuery(_ query: String) {
        guard let sdk, var model = sheet else { return }
        model.query = query
        model.results = sdk.sortShareAccounts(accounts: model.accounts, query: query, recent: model.recent.users)
        sheet = model
        searchTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.allSatisfy({ $0.isASCII && $0.isLetter }) else { return }
        let token = self.token
        searchTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 220_000_000)
            guard !Task.isCancelled, let self else { return }
            _ = sdk.fetchShareAccounts(token: token, query: trimmed) { [weak self] res in
                Task { @MainActor [weak self] in
                    guard let self, var current = self.sheet, current.query == query else { return }
                    let known = Set(current.results.map { $0.username })
                    current.results = current.results + res.items.filter { !known.contains($0.username) }
                    self.sheet = current
                }
            } onError: { _ in }
        }
    }

    func toggleAccount(_ username: String) {
        guard var model = sheet, model.memberStatus(username) == nil else { return }
        if model.selected.contains(username) { model.selected.removeAll { $0 == username } } else { model.selected.append(username) }
        withAnimation(.snappy(duration: 0.22)) { sheet = model }
    }

    func toggleGroup(_ group: ShareGroup) {
        guard var model = sheet else { return }
        let pickable = group.members.filter { name in model.memberStatus(name) == nil && model.account(name) != nil }
        let on = !pickable.allSatisfy { model.selected.contains($0) }
        if on {
            for name in pickable where !model.selected.contains(name) { model.selected.append(name) }
            model.groupIds.insert(group.id)
        } else {
            model.selected.removeAll { pickable.contains($0) }
            model.groupIds.remove(group.id)
        }
        withAnimation(.snappy(duration: 0.22)) { sheet = model }
    }

    func saveGroup(name: String) {
        guard let sdk, let model = sheet, !model.selected.isEmpty else { return }
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        _ = sdk.createShareGroup(token: token, name: clean, members: model.selected) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self, let group = res.item, var current = self.sheet else { return }
                current.groups.insert(group, at: 0)
                current.groupIds.insert(group.id)
                withAnimation(.snappy) { self.sheet = current }
                self.notice = L10n.tr(self.lang, zh: "已保存常用群组「\(group.name)」", en: "Saved group “\(group.name)”")
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in self?.notice = err }
        }
    }

    func deleteGroup(_ group: ShareGroup) {
        guard let sdk, var model = sheet else { return }
        model.groups.removeAll { $0.id == group.id }
        model.recent = ShareRecentResponse(users: model.recent.users, groups: model.recent.groups.filter { $0.id != group.id })
        withAnimation(.snappy) { sheet = model }
        _ = sdk.deleteShareGroup(token: token, groupId: group.id) { _ in } onError: { _ in }
    }

    func sendInvites() {
        guard let sdk, var model = sheet, !model.selected.isEmpty, !model.busy else { return }
        model.busy = true
        sheet = model
        let snapshot = model
        _ = sdk.inviteToShare(token: token, sessionId: snapshot.sessionId, title: snapshot.title, usernames: snapshot.selected, groupIds: Array(snapshot.groupIds)) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let names = res.invited.map { u in snapshot.account(u)?.name ?? u }
                if names.isEmpty {
                    self.notice = L10n.tr(self.lang, zh: "所选成员都已在共享中", en: "Everyone selected is already in this conversation")
                } else {
                    let head = names.prefix(3).joined(separator: "、")
                    self.notice = L10n.tr(self.lang, zh: "已邀请 \(head)\(names.count > 3 ? " 等 \(names.count) 人" : "")，对方登录后会收到通知", en: "Invited \(names.count) people")
                }
                self.refreshMine()
                self.sheet = nil
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in
                guard let self, var current = self.sheet else { return }
                current.busy = false
                current.error = err
                self.sheet = current
            }
        }
    }

    func removeMember(_ username: String) {
        guard let sdk, let model = sheet else { return }
        _ = sdk.removeShareMember(token: token, sessionId: model.sessionId, username: username) { [weak self] res in
            Task { @MainActor [weak self] in
                guard let self, var current = self.sheet else { return }
                if let share = res.share { current.share = share }
                withAnimation(.snappy) { self.sheet = current }
                self.refreshMine()
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in self?.notice = err }
        }
    }

    func leave() {
        guard let sdk, let model = sheet else { return }
        let owner = model.share?.isOwner == true
        _ = sdk.leaveShare(token: token, sessionId: model.sessionId) { [weak self] _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.sheet = nil
                self.notice = owner ? L10n.tr(self.lang, zh: "已停止共享", en: "Sharing stopped") : L10n.tr(self.lang, zh: "已退出共享对话", en: "Left the shared conversation")
                self.refreshMine()
            }
        } onError: { [weak self] err in
            Task { @MainActor [weak self] in self?.notice = err }
        }
    }

    var shareLink: String? {
        guard let link = sheet?.share?.link, !link.isEmpty else { return nil }
        return sdk?.absoluteShareLink(link: link)
    }
}

struct ShareSheetModel {
    let sessionId: String
    let title: String
    var loading = true
    var accounts: [ShareAccount] = []
    var results: [ShareAccount] = []
    var groups: [ShareGroup] = []
    var recent = ShareRecentResponse(users: [], groups: [])
    var share: SharedConversation?
    var query = ""
    var selected: [String] = []
    var groupIds = Set<String>()
    var busy = false
    var error: String?

    /// 已在共享中的成员（已加入 / 待接受）：列表里只显示状态，不能再勾选
    func memberStatus(_ username: String) -> String? {
        share?.members.first { $0.username == username && ($0.isAccepted || $0.isPending) }?.status
    }
    func account(_ username: String) -> ShareAccount? { accounts.first { $0.username == username } }
    var orderedGroups: [ShareGroup] {
        var seen = Set<String>()
        let fromRecent = recent.groups.compactMap { r in groups.first { $0.id == r.id } }
        return (fromRecent + groups).filter { seen.insert($0.id).inserted }
    }
    var recentUsers: [ShareAccount] {
        recent.users.compactMap { account($0.username) }.filter { memberStatus($0.username) == nil }
    }
}
