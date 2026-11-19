package com.example.newapp.shared.model

import kotlinx.serialization.Serializable

// 共享对话（/api/shared-conversations，后端 backend/models/shared-conversations.js）：与网页端同一套接口。

@Serializable
data class ShareMember(
    val username: String = "",
    val name: String = "",
    val role: String = "member",
    val status: String = "pending",
    val via: String = "invite"
) {
    val isOwner: Boolean get() = role == "owner"
    val isAccepted: Boolean get() = status == "accepted"
    val isPending: Boolean get() = status == "pending"
}

@Serializable
data class SharedConversation(
    val id: String = "",
    val title: String = "",
    val status: String = "active",
    val owner: String = "",
    val ownerName: String = "",
    val isOwner: Boolean = false,
    val link: String = "",
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val messageCount: Int = 0,
    val role: String = "",
    val myStatus: String = "",
    val members: List<ShareMember> = emptyList(),
    val sessionId: String = "",
    val unread: Int = 0
) {
    val isActive: Boolean get() = status == "active"
    val joinedMembers: List<ShareMember> get() = members.filter { it.isAccepted }
    /** 除自己外还有人（已加入或待接受）：发起者打开过共享面板但没邀请任何人时不算 */
    fun hasOthers(me: String): Boolean = members.any { it.username != me && (it.isAccepted || it.isPending) }
}

@Serializable
data class SharedConversationsResponse(val items: List<SharedConversation> = emptyList())

@Serializable
data class ShareResponse(val share: SharedConversation? = null)

@Serializable
data class ShareInvite(
    val shareId: String = "",
    val title: String = "",
    val owner: String = "",
    val ownerName: String = "",
    val invitedBy: String = "",
    val invitedByName: String = "",
    val invitedAt: String? = null,
    val via: String = "invite",
    val messageCount: Int = 0,
    val memberCount: Int = 0
) {
    fun headline(language: String): String = if (via == "link") {
        if (language == "en") "You opened a conversation shared by $ownerName" else "通过链接打开了 $ownerName 共享的对话"
    } else {
        val who = invitedByName.ifBlank { ownerName }
        if (language == "en") "$who invited you to a shared conversation" else "$who 邀请你加入共享对话"
    }
    fun meta(language: String): String =
        if (language == "en") "$messageCount messages · $memberCount joined" else "$messageCount 条消息 · $memberCount 人已加入"
}

@Serializable
data class ShareInboxResponse(val items: List<ShareInvite> = emptyList())

@Serializable
data class ShareRespondRequest(val action: String)

@Serializable
data class ShareRespondResponse(
    val status: String = "",
    val sessionId: String = "",
    val share: SharedConversation? = null
)

@Serializable
data class ShareLinkJoinResponse(
    val status: String = "",
    val shareId: String = "",
    val sessionId: String = "",
    val invite: ShareInvite? = null
)

@Serializable
data class ShareAccount(val username: String = "", val name: String = "")

@Serializable
data class ShareAccountsResponse(val items: List<ShareAccount> = emptyList())

@Serializable
data class ShareGroup(
    val id: String = "",
    val name: String = "",
    val members: List<String> = emptyList(),
    val usedAt: String? = null,
    val createdAt: String? = null
)

@Serializable
data class ShareGroupsResponse(val items: List<ShareGroup> = emptyList())

@Serializable
data class ShareGroupResponse(val item: ShareGroup? = null)

@Serializable
data class ShareGroupRequest(val name: String, val members: List<String>)

@Serializable
data class ShareRecentUser(val username: String = "", val name: String = "", val uses: Int = 0)

@Serializable
data class ShareRecentResponse(
    val users: List<ShareRecentUser> = emptyList(),
    val groups: List<ShareGroup> = emptyList()
)

@Serializable
data class SharePrepareRequest(val title: String = "")

@Serializable
data class ShareInviteRequest(
    val title: String = "",
    val usernames: List<String> = emptyList(),
    val groupIds: List<String> = emptyList()
)

@Serializable
data class ShareInviteResponse(
    val share: SharedConversation? = null,
    val invited: List<String> = emptyList(),
    val already: List<String> = emptyList()
)

@Serializable
data class ShareSyncResult(
    val shareId: String = "",
    val pushed: Int = 0,
    val pulled: Int = 0,
    val closed: Boolean = false
)

@Serializable
data class ShareSyncResponse(val result: ShareSyncResult? = null)

@Serializable
data class ShareLeaveResponse(val closed: Boolean = false, val left: Boolean = false)

@Serializable
data class ShareRemoveRequest(val username: String)

@Serializable
data class ShareOkResponse(val ok: Boolean = false)

@Serializable
class ShareEmptyBody
