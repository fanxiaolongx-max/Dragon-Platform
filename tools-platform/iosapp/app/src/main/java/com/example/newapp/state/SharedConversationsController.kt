package com.example.newapp.state

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.example.newapp.shared.model.*
import com.example.newapp.ui.theme.tr
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * 共享对话（与网页端同一套 /api/shared-conversations）：侧栏「共享对话」分类、邀请横幅与消息中心、共享面板、
 * 打开共享对话时的同步与轮询（别人发的新消息直接接在后面）。共享的只是上下文，新的提问在本人账号下执行。
 * 后端还没有该接口（旧服务未重启）时 [available] 为 false，入口全部隐藏。
 */
class SharedConversationsController(
    private val vm: DragonClawViewModel,
    private val scope: CoroutineScope
) {
    private val sdk get() = vm.sdk
    private val token get() = vm.token
    private val lang get() = vm.language

    var available by mutableStateOf(false)
        private set
    var mine by mutableStateOf<List<SharedConversation>>(emptyList())
        private set
    var invites by mutableStateOf<List<ShareInvite>>(emptyList())
        private set
    /** 横幅：本次打开 App 后还没提示过的邀请，一次一个 */
    var banner by mutableStateOf<ShareInvite?>(null)
        private set
    var notice by mutableStateOf<String?>(null)
    var isSharedCollapsed by mutableStateOf(sdk.isSharedSessionsCollapsed())
        private set
    var sheet by mutableStateOf<ShareSheetState?>(null)
        private set

    private val bannerShown = HashSet<String>()
    private var slowJob: Job? = null
    private var activeJob: Job? = null
    private var searchJob: Job? = null
    private var pendingAppend: String? = null

    fun info(sessionId: String?): SharedConversation? = sessionId?.let { id -> mine.firstOrNull { it.sessionId == id } }
    fun isShared(sessionId: String?): Boolean = info(sessionId) != null
    val inviteCount: Int get() = if (available) invites.size else 0

    fun start() {
        refreshAll()
        slowJob?.cancel()
        slowJob = scope.launch {
            while (isActive) {
                delay(30_000L)
                if (vm.isAuthenticated && vm.isAppInForeground()) refreshAll()
            }
        }
        activeJob?.cancel()
        activeJob = scope.launch {
            while (isActive) {
                delay(4_000L)
                if (vm.isAuthenticated && vm.isAppInForeground()) syncActive()
            }
        }
    }

    fun stop() {
        slowJob?.cancel(); activeJob?.cancel(); searchJob?.cancel()
        mine = emptyList(); invites = emptyList(); banner = null; sheet = null; available = false
        bannerShown.clear()
    }

    fun refreshAll() {
        if (token.isBlank()) return
        scope.launch {
            runCatching { sdk.api.getShareInbox(token) }
                .onSuccess { res ->
                    available = true
                    invites = res.items
                    if (banner == null) nextBanner()
                    else if (invites.none { it.shareId == banner?.shareId }) { banner = null; nextBanner() }
                }
                .onFailure { available = false }
            if (available) refreshMine()
        }
    }

    suspend fun refreshMine() {
        if (token.isBlank()) return
        runCatching { sdk.api.getMySharedConversations(token) }.onSuccess { res ->
            val me = vm.username
            val next = res.items.filter { !it.isOwner || it.hasOthers(me) }
            if (next != mine) {
                mine = next
                vm.regroupSessions()
            }
        }
    }

    private fun nextBanner() {
        val next = invites.firstOrNull { it.shareId !in bannerShown } ?: return
        bannerShown.add(next.shareId)
        banner = next
    }

    fun dismissBanner(later: Boolean) {
        banner = null
        if (later) notice = tr(lang, "可以随时在消息中心里处理这个邀请", "You can respond later from the message center")
        nextBanner()
    }

    fun respond(invite: ShareInvite, action: String) {
        if (banner?.shareId == invite.shareId) banner = null
        scope.launch {
            runCatching { sdk.api.respondShareInvite(token, invite.shareId, action) }
                .onSuccess { res ->
                    invites = invites.filterNot { it.shareId == invite.shareId }
                    when (action) {
                        "accept" -> {
                            refreshMine()
                            notice = tr(lang, "已加入共享对话「${invite.title}」", "Joined “${invite.title}”")
                            if (res.sessionId.isNotBlank()) vm.openSharedSession(res.sessionId, invite.title)
                        }
                        "decline" -> notice = tr(lang, "已拒绝邀请", "Invite declined")
                        else -> notice = tr(lang, "已忽略，之后仍可通过共享链接加入", "Ignored. You can still join from the link.")
                    }
                    nextBanner()
                }
                .onFailure { err ->
                    notice = err.message
                    invites = invites.filterNot { it.shareId == invite.shareId }
                }
        }
    }

    /** 粘贴网页端复制的共享链接加入 */
    fun joinLink(text: String) {
        val linkToken = sdk.shareTokenFromLink(text)
        if (linkToken == null) { notice = tr(lang, "这不是有效的共享链接", "That is not a valid share link"); return }
        scope.launch {
            runCatching { sdk.api.joinShareLink(token, linkToken) }
                .onSuccess { res ->
                    if (res.status == "accepted" && res.sessionId.isNotBlank()) {
                        refreshMine(); vm.openSharedSession(res.sessionId, "")
                    } else {
                        val invite = res.invite
                        invites = (listOfNotNull(invite) + invites).distinctBy { it.shareId }
                        if (invite != null) { bannerShown.add(invite.shareId); banner = invite }
                    }
                }
                .onFailure { err -> notice = err.message }
        }
    }

    fun toggleCollapsed() {
        isSharedCollapsed = !isSharedCollapsed
        sdk.setSharedSessionsCollapsed(isSharedCollapsed)
    }

    // ── 打开中的共享对话：先同步再读历史；之后定时同步，新消息接在后面 ──
    suspend fun syncBeforeOpen(sessionId: String) {
        if (!isShared(sessionId)) return
        runCatching { sdk.api.syncSharedSession(token, sessionId) }
    }

    private suspend fun syncActive() {
        val sessionId = vm.currentSessionId ?: return
        if (!isShared(sessionId) || vm.activeDesktopSession != null) return
        val result = runCatching { sdk.api.syncSharedSession(token, sessionId) }.getOrNull()?.result ?: return
        if (result.pulled > 0 || pendingAppend == sessionId) {
            pendingAppend = sessionId
            if (vm.appendSharedMessages(sessionId)) pendingAppend = null
        }
        if (result.pulled > 0 || result.closed) refreshMine()
    }

    // ── 共享面板 ──
    fun openSheet(sessionId: String, title: String) {
        if (!available) { notice = tr(lang, "当前服务还不支持共享对话，请升级或重启服务", "Sharing is not available on this server yet"); return }
        val clean = sdk.cleanTitle(title)
        sheet = ShareSheetState(sessionId = sessionId, title = clean)
        scope.launch {
            val accounts = runCatching { sdk.api.getShareAccounts(token) }
            val groups = runCatching { sdk.api.getShareGroups(token) }.getOrNull()?.items.orEmpty()
            val recent = runCatching { sdk.api.getShareRecent(token) }.getOrNull() ?: ShareRecentResponse()
            val prepared = runCatching { sdk.api.prepareShare(token, sessionId, clean) }
            update(sessionId) {
                it.copy(
                    loading = false,
                    accounts = accounts.getOrNull()?.items.orEmpty(),
                    results = sdk.sortShareAccounts(accounts.getOrNull()?.items.orEmpty(), "", recent.users),
                    groups = groups,
                    recent = recent,
                    share = prepared.getOrNull()?.share,
                    error = accounts.exceptionOrNull()?.message ?: prepared.exceptionOrNull()?.message
                )
            }
        }
    }

    fun closeSheet() { sheet = null; searchJob?.cancel() }

    private inline fun update(sessionId: String, block: (ShareSheetState) -> ShareSheetState) {
        val current = sheet ?: return
        if (current.sessionId == sessionId) sheet = block(current)
    }

    /** 搜索：先本地过滤；输入像拼音时再请服务端按拼音匹配显示名，合并结果 */
    fun setQuery(query: String) {
        val current = sheet ?: return
        sheet = current.copy(query = query, results = sdk.sortShareAccounts(current.accounts, query, current.recent.users))
        searchJob?.cancel()
        if (query.isBlank() || !query.trim().all { it.isLetter() && it.code < 128 }) return
        searchJob = scope.launch {
            delay(220L)
            val remote = runCatching { sdk.api.getShareAccounts(token, query) }.getOrNull()?.items ?: return@launch
            val state = sheet ?: return@launch
            if (state.query != query) return@launch
            val merged = (state.results + remote).distinctBy { it.username }
            sheet = state.copy(results = sdk.sortShareAccounts(merged, "", state.recent.users).sortedBy { acc -> if (state.results.any { it.username == acc.username }) 0 else 1 })
        }
    }

    fun toggleAccount(username: String) {
        val current = sheet ?: return
        if (current.memberStatus(username) != null) return
        sheet = current.copy(selected = if (username in current.selected) current.selected - username else current.selected + username)
    }

    fun toggleGroup(group: ShareGroup) {
        val current = sheet ?: return
        val pickable = group.members.filter { current.memberStatus(it) == null && current.accounts.any { acc -> acc.username == it } }
        val on = !pickable.all { it in current.selected }
        sheet = current.copy(
            selected = if (on) current.selected + pickable else current.selected - pickable.toSet(),
            groupIds = if (on) current.groupIds + group.id else current.groupIds - group.id
        )
    }

    fun saveGroup(name: String) {
        val current = sheet ?: return
        if (name.isBlank() || current.selected.isEmpty()) return
        scope.launch {
            runCatching { sdk.api.createShareGroup(token, name.trim(), current.selected.toList()) }
                .onSuccess { res ->
                    val group = res.item ?: return@onSuccess
                    update(current.sessionId) { it.copy(groups = listOf(group) + it.groups, groupIds = it.groupIds + group.id) }
                    notice = tr(lang, "已保存常用群组「${group.name}」", "Saved group “${group.name}”")
                }
                .onFailure { err -> notice = err.message }
        }
    }

    fun deleteGroup(group: ShareGroup) {
        val current = sheet ?: return
        update(current.sessionId) { it.copy(groups = it.groups.filterNot { g -> g.id == group.id }, recent = it.recent.copy(groups = it.recent.groups.filterNot { g -> g.id == group.id })) }
        scope.launch { runCatching { sdk.api.deleteShareGroup(token, group.id) } }
    }

    fun sendInvites() {
        val current = sheet ?: return
        if (current.selected.isEmpty() || current.busy) return
        sheet = current.copy(busy = true)
        scope.launch {
            runCatching { sdk.api.inviteToShare(token, current.sessionId, ShareInviteRequest(current.title, current.selected.toList(), current.groupIds.toList())) }
                .onSuccess { res ->
                    val names = res.invited.map { u -> current.accounts.firstOrNull { it.username == u }?.name ?: u }
                    notice = if (names.isEmpty()) tr(lang, "所选成员都已在共享中", "Everyone selected is already in this conversation")
                    else tr(lang, "已邀请 ${names.take(3).joinToString("、")}${if (names.size > 3) " 等 ${names.size} 人" else ""}，对方登录后会收到通知", "Invited ${names.size} people")
                    refreshMine()
                    sheet = null
                }
                .onFailure { err -> update(current.sessionId) { it.copy(busy = false, error = err.message) } }
        }
    }

    fun removeMember(username: String) {
        val current = sheet ?: return
        scope.launch {
            runCatching { sdk.api.removeShareMember(token, current.sessionId, username) }
                .onSuccess { res -> update(current.sessionId) { it.copy(share = res.share ?: it.share) }; refreshMine() }
                .onFailure { err -> notice = err.message }
        }
    }

    fun leave() {
        val current = sheet ?: return
        val owner = current.share?.isOwner == true
        scope.launch {
            runCatching { sdk.api.leaveShare(token, current.sessionId) }
                .onSuccess {
                    sheet = null
                    notice = if (owner) tr(lang, "已停止共享", "Sharing stopped") else tr(lang, "已退出共享对话", "Left the shared conversation")
                    refreshMine()
                }
                .onFailure { err -> notice = err.message }
        }
    }

    fun shareLink(): String? = sheet?.share?.link?.takeIf { it.isNotBlank() }?.let { sdk.absoluteShareLink(it) }
}

data class ShareSheetState(
    val sessionId: String,
    val title: String,
    val loading: Boolean = true,
    val accounts: List<ShareAccount> = emptyList(),
    val results: List<ShareAccount> = emptyList(),
    val groups: List<ShareGroup> = emptyList(),
    val recent: ShareRecentResponse = ShareRecentResponse(),
    val share: SharedConversation? = null,
    val query: String = "",
    val selected: Set<String> = emptySet(),
    val groupIds: Set<String> = emptySet(),
    val busy: Boolean = false,
    val error: String? = null
) {
    /** 已在共享中的成员（已加入 / 待接受）：列表里只显示状态，不能再勾选 */
    fun memberStatus(username: String): String? =
        share?.members?.firstOrNull { it.username == username && (it.isAccepted || it.isPending) }?.status

    fun account(username: String): ShareAccount? = accounts.firstOrNull { it.username == username }

    /** 常用群组：最近用过的排前面 */
    val orderedGroups: List<ShareGroup>
        get() = (recent.groups.mapNotNull { r -> groups.firstOrNull { it.id == r.id } } + groups).distinctBy { it.id }

    val recentUsers: List<ShareAccount>
        get() = recent.users.mapNotNull { account(it.username) }.filter { memberStatus(it.username) == null }
}
