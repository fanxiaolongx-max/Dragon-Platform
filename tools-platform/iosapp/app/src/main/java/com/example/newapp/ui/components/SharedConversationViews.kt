package com.example.newapp.ui.components

import android.content.Intent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.newapp.shared.model.ChatMessage
import com.example.newapp.shared.model.ShareGroup
import com.example.newapp.shared.model.ShareInvite
import com.example.newapp.state.DragonClawViewModel
import com.example.newapp.ui.theme.LocalDragonClawPalette
import com.example.newapp.ui.theme.tr
import kotlinx.coroutines.delay

// 共享对话的安卓界面：头像、邀请横幅、提示条、消息中心里的邀请卡片、共享面板、消息署名。
// 状态都在 SharedConversationsController（vm.sharing）。

/** 账号头像：首字 + 由账号算出的色相，深浅主题都清楚 */
@Composable
fun ShareAvatar(username: String, label: String = username, size: Dp = 26.dp) {
    val palette = LocalDragonClawPalette.current
    var h = 0
    for (ch in username) h = (h * 31 + ch.code) % 360
    val text = label.trim().ifEmpty { username }
    val initial = if (text.firstOrNull()?.let { it.code < 128 && it.isLetterOrDigit() } == true) text.take(2).uppercase() else text.take(1)
    val bg = if (palette.isDark) Color.hsl(h.toFloat(), 0.35f, 0.26f) else Color.hsl(h.toFloat(), 0.7f, 0.9f)
    val fg = if (palette.isDark) Color.hsl(h.toFloat(), 0.7f, 0.82f) else Color.hsl(h.toFloat(), 0.55f, 0.32f)
    Box(
        modifier = Modifier.size(size).clip(CircleShape).background(bg),
        contentAlignment = Alignment.Center
    ) {
        Text(initial, color = fg, fontSize = (size.value * 0.4f).sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

/** 共享对话里的消息署名：别人的提问 / 别人的 AI 回答；自己的提问显示「我 · 账号」 */
@Composable
fun SharedAuthorLabel(message: ChatMessage, isSharedThread: Boolean, me: String, language: String) {
    val palette = LocalDragonClawPalette.current
    val author = message.sharedAuthor
    if (author == null && !(isSharedThread && message.isUser)) return
    val name = message.sharedAuthorName ?: author ?: me
    val label = when {
        author == null -> tr(language, "我 · $me", "Me · $me")
        message.isUser -> if (name != author) "$name · $author" else name
        else -> tr(language, "$name 的 AI 回答", "Answered for $name")
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = if (message.isUser) Arrangement.End else Arrangement.Start,
        modifier = Modifier.fillMaxWidth().padding(bottom = 4.dp)
    ) {
        ShareAvatar(author ?: me, name, 18.dp)
        Spacer(Modifier.width(6.dp))
        Text(label, color = palette.inkMuted, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** 顶部邀请横幅：接受并打开 / 拒绝 / 稍后（稍后可在消息中心处理） */
@Composable
fun ShareInviteBanner(vm: DragonClawViewModel, modifier: Modifier = Modifier) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    val invite = vm.sharing.banner
    var shown by remember { mutableStateOf<ShareInvite?>(null) }
    if (invite != null) shown = invite
    LaunchedEffect(invite?.shareId) {
        if (invite != null) { delay(20_000L); if (vm.sharing.banner?.shareId == invite.shareId) vm.sharing.dismissBanner(later = false) }
    }
    AnimatedVisibility(
        visible = invite != null,
        enter = slideInVertically(spring(dampingRatio = 0.8f, stiffness = Spring.StiffnessMediumLow)) { -it * 2 } + fadeIn(),
        exit = slideOutVertically { -it * 2 } + fadeOut(),
        modifier = modifier
    ) {
        val item = shown ?: return@AnimatedVisibility
        Surface(
            shape = RoundedCornerShape(16.dp),
            color = palette.cardSurface,
            shadowElevation = 10.dp,
            border = androidx.compose.foundation.BorderStroke(1.dp, palette.hairLine),
            modifier = Modifier.statusBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp).widthIn(max = 460.dp).fillMaxWidth()
        ) {
            Row(Modifier.padding(14.dp), verticalAlignment = Alignment.Top) {
                ShareAvatar(item.invitedBy.ifBlank { item.owner }, item.invitedByName.ifBlank { item.ownerName }, 34.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(item.headline(lang), color = palette.inkPrimary, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold)
                    Text("「${item.title}」 · ${item.meta(lang)}", color = palette.inkMuted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
                    Row(Modifier.padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { vm.sharing.respond(item, "accept") }, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp), modifier = Modifier.height(32.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = palette.accentStrong)) { Text(tr(lang, "接受并打开", "Accept & open"), fontSize = 12.5.sp) }
                        OutlinedButton(onClick = { vm.sharing.respond(item, "decline") }, contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp), modifier = Modifier.height(32.dp)) {
                            Text(tr(lang, "拒绝", "Decline"), fontSize = 12.5.sp, color = palette.inkPrimary)
                        }
                        TextButton(onClick = { vm.sharing.dismissBanner(later = true) }, modifier = Modifier.height(32.dp)) {
                            Text(tr(lang, "稍后", "Later"), fontSize = 12.5.sp, color = palette.inkSecondary)
                        }
                    }
                }
            }
        }
    }
}

/** 底部提示条（共享相关的操作结果） */
@Composable
fun ShareNoticeToast(vm: DragonClawViewModel, modifier: Modifier = Modifier) {
    val palette = LocalDragonClawPalette.current
    val text = vm.sharing.notice
    var shown by remember { mutableStateOf("") }
    if (!text.isNullOrBlank()) shown = text
    LaunchedEffect(text) { if (!text.isNullOrBlank()) { delay(2600L); if (vm.sharing.notice == text) vm.sharing.notice = null } }
    AnimatedVisibility(visible = !text.isNullOrBlank(), enter = fadeIn() + scaleIn(initialScale = 0.92f), exit = fadeOut() + scaleOut(targetScale = 0.96f), modifier = modifier) {
        Surface(shape = RoundedCornerShape(999.dp), color = palette.accentStrong, shadowElevation = 6.dp, modifier = Modifier.padding(16.dp)) {
            Text(shown, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp))
        }
    }
}

/** 消息中心顶部：共享对话邀请（接受 / 拒绝 / 忽略），以及粘贴网页端复制的共享链接加入 */
@Composable
fun ShareInvitesSection(vm: DragonClawViewModel) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    if (!vm.sharing.available) return
    var linkDraft by remember { mutableStateOf("") }
    Column(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
        if (vm.sharing.invites.isNotEmpty()) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 6.dp)) {
                Icon(Icons.Rounded.Groups, contentDescription = null, tint = palette.inkMuted, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(6.dp))
                Text(tr(lang, "共享对话邀请", "Shared conversation invites"), color = palette.inkMuted, fontSize = 12.5.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.width(6.dp))
                Box(Modifier.clip(CircleShape).background(palette.accentStrong).padding(horizontal = 7.dp, vertical = 1.dp)) {
                    Text("${vm.sharing.invites.size}", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
            }
            vm.sharing.invites.forEach { item ->
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = palette.accent.copy(alpha = 0.06f),
                    border = androidx.compose.foundation.BorderStroke(1.dp, palette.accent.copy(alpha = 0.28f)),
                    modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            ShareAvatar(item.invitedBy.ifBlank { item.owner }, item.invitedByName.ifBlank { item.ownerName }, 32.dp)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text("「${item.title}」", color = palette.inkPrimary, fontSize = 13.5.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text("${item.headline(lang)} · ${item.meta(lang)}", color = palette.inkMuted, fontSize = 11.5.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            }
                        }
                        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                            TextButton(onClick = { vm.sharing.respond(item, "ignore") }) { Text(tr(lang, "忽略", "Ignore"), color = palette.inkSecondary, fontSize = 12.5.sp) }
                            OutlinedButton(onClick = { vm.sharing.respond(item, "decline") }) { Text(tr(lang, "拒绝", "Decline"), color = palette.inkPrimary, fontSize = 12.5.sp) }
                            Button(onClick = { vm.sharing.respond(item, "accept") }, colors = ButtonDefaults.buttonColors(containerColor = palette.accentStrong)) { Text(tr(lang, "接受", "Accept"), fontSize = 12.5.sp) }
                        }
                    }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 2.dp)) {
            OutlinedTextField(
                value = linkDraft,
                onValueChange = { linkDraft = it },
                singleLine = true,
                placeholder = { Text(tr(lang, "粘贴共享链接加入对话", "Paste a share link to join"), fontSize = 12.5.sp) },
                leadingIcon = { Icon(Icons.Rounded.Link, contentDescription = null, modifier = Modifier.size(18.dp)) },
                textStyle = LocalTextStyleSmall(),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { if (linkDraft.isNotBlank()) { vm.sharing.joinLink(linkDraft); linkDraft = "" } }),
                modifier = Modifier.weight(1f).heightIn(min = 48.dp)
            )
            Spacer(Modifier.width(8.dp))
            TextButton(enabled = linkDraft.isNotBlank(), onClick = { vm.sharing.joinLink(linkDraft); linkDraft = "" }) { Text(tr(lang, "加入", "Join"), color = palette.accentStrong) }
        }
    }
}

@Composable
private fun LocalTextStyleSmall() = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.sp)

/** 共享面板：搜索账号（支持拼音）、最近共享过、常用群组、已在共享中的成员、复制 / 分享链接 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ShareConversationSheet(vm: DragonClawViewModel) {
    val state = vm.sharing.sheet ?: return
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    val me = vm.username
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var creatingGroup by remember { mutableStateOf(false) }
    var groupName by remember { mutableStateOf("") }
    var copied by remember { mutableStateOf(false) }
    var confirmLeave by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(1800L); copied = false } }

    ModalBottomSheet(
        onDismissRequest = { vm.sharing.closeSheet() },
        sheetState = sheetState,
        containerColor = palette.elevatedSurface,
        dragHandle = { BottomSheetDefaults.DragHandle(color = palette.hairLine) }
    ) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f).navigationBarsPadding().imePadding()) {
            // 标题
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(horizontal = 18.dp)) {
                Box(Modifier.size(34.dp).clip(RoundedCornerShape(10.dp)).background(palette.accent.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Share, contentDescription = null, tint = palette.accentStrong, modifier = Modifier.size(18.dp))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(tr(lang, "共享对话", "Share conversation"), color = palette.inkPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    Text(state.title.ifBlank { tr(lang, "当前对话", "This conversation") }, color = palette.inkMuted, fontSize = 12.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            // 搜索框 + 已选标签
            Column(Modifier.padding(horizontal = 18.dp, vertical = 12.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, palette.hairLine, RoundedCornerShape(12.dp)).background(palette.cardSurface).padding(horizontal = 10.dp, vertical = 6.dp)) {
                if (state.selected.isNotEmpty()) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
                        state.selected.forEach { username ->
                            val acc = state.account(username)
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clip(CircleShape).background(palette.chipSurface).clickable { vm.sharing.toggleAccount(username) }.padding(start = 3.dp, end = 8.dp, top = 2.dp, bottom = 2.dp)) {
                                ShareAvatar(username, acc?.name ?: username, 20.dp)
                                Spacer(Modifier.width(5.dp))
                                Text(acc?.name ?: username, color = palette.inkPrimary, fontSize = 12.5.sp, maxLines = 1)
                                Spacer(Modifier.width(3.dp))
                                Icon(Icons.Rounded.Close, contentDescription = tr(lang, "移除", "Remove"), tint = palette.inkMuted, modifier = Modifier.size(13.dp))
                            }
                        }
                    }
                }
                TextField(
                    value = state.query,
                    onValueChange = { vm.sharing.setQuery(it) },
                    singleLine = true,
                    placeholder = { Text(tr(lang, "输入账号名或姓名搜索（支持拼音）", "Search by name or pinyin"), fontSize = 13.5.sp, color = palette.inkMuted) },
                    leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null, tint = palette.inkMuted) },
                    colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent, cursorColor = palette.accentStrong),
                    modifier = Modifier.fillMaxWidth()
                )
            }

            LazyColumn(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                if (state.loading) {
                    item { Box(Modifier.fillMaxWidth().height(120.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator(Modifier.size(24.dp), color = palette.accentStrong) } }
                }
                state.error?.let { err -> item { Text(err, color = palette.danger, fontSize = 12.5.sp, modifier = Modifier.padding(6.dp)) } }
                if (state.query.isBlank() && !state.loading) {
                    if (state.recentUsers.isNotEmpty()) {
                        item { SectionLabel(Icons.Rounded.History, tr(lang, "最近共享过", "Recently shared with")) }
                        item {
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(horizontal = 6.dp)) {
                                state.recentUsers.forEach { acc -> Pill(selected = acc.username in state.selected, onClick = { vm.sharing.toggleAccount(acc.username) }) { ShareAvatar(acc.username, acc.name, 20.dp); Spacer(Modifier.width(6.dp)); Text(acc.name, fontSize = 12.5.sp, color = palette.inkPrimary) } }
                            }
                        }
                    }
                    item { SectionLabel(Icons.Rounded.Groups, tr(lang, "常用群组", "Saved groups")) }
                    item {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(horizontal = 6.dp)) {
                            state.orderedGroups.forEach { group -> GroupPill(vm, group, state.groupIds.contains(group.id)) }
                            Pill(selected = false, dashed = true, onClick = {
                                if (state.selected.isEmpty()) vm.sharing.notice = tr(lang, "先在下面勾选要加入群组的人", "Select people first") else creatingGroup = true
                            }) {
                                Icon(Icons.Rounded.Add, contentDescription = null, tint = palette.inkSecondary, modifier = Modifier.size(15.dp)); Spacer(Modifier.width(4.dp))
                                Text(if (state.selected.isEmpty()) tr(lang, "新建群组（先勾选成员）", "New group (select people first)") else tr(lang, "把已选的 ${state.selected.size} 人存为群组", "Save ${state.selected.size} as group"), fontSize = 12.5.sp, color = palette.inkSecondary)
                            }
                        }
                    }
                    if (creatingGroup) item {
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(6.dp)) {
                            OutlinedTextField(value = groupName, onValueChange = { groupName = it.take(40) }, singleLine = true, placeholder = { Text(tr(lang, "群组名称，如「北美研发」", "Group name"), fontSize = 13.sp) }, modifier = Modifier.weight(1f))
                            TextButton(onClick = { vm.sharing.saveGroup(groupName); groupName = ""; creatingGroup = false }, enabled = groupName.isNotBlank()) { Text(tr(lang, "保存", "Save"), color = palette.accentStrong) }
                            TextButton(onClick = { creatingGroup = false }) { Text(tr(lang, "取消", "Cancel"), color = palette.inkSecondary) }
                        }
                    }
                }
                if (!state.loading) {
                    item { SectionLabel(Icons.Rounded.Person, if (state.query.isBlank()) tr(lang, "全部账号", "All accounts") else tr(lang, "搜索结果", "Results"), trailing = "${state.results.size}") }
                    if (state.results.isEmpty()) item { Text(tr(lang, "没有匹配的账号", "No matching accounts"), color = palette.inkMuted, fontSize = 12.5.sp, modifier = Modifier.fillMaxWidth().padding(20.dp)) }
                    items(state.results, key = { "acc_" + it.username }) { acc ->
                        val status = state.memberStatus(acc.username)
                        val on = acc.username in state.selected
                        val rowBg by animateColorAsState(if (on) palette.accent.copy(alpha = 0.08f) else Color.Transparent, label = "shareRowBg")
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(rowBg)
                                .clickable(enabled = status == null) { vm.sharing.toggleAccount(acc.username) }
                                .padding(horizontal = 8.dp, vertical = 8.dp)
                        ) {
                            ShareAvatar(acc.username, acc.name)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(acc.name, color = palette.inkPrimary.copy(alpha = if (status != null) 0.6f else 1f), fontSize = 13.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(acc.username, color = palette.inkMuted, fontSize = 11.5.sp, maxLines = 1)
                            }
                            if (status != null) StatusTag(status == "accepted", if (status == "accepted") tr(lang, "已加入", "Joined") else tr(lang, "待接受", "Pending"))
                            else Checkbox(checked = on, onCheckedChange = { vm.sharing.toggleAccount(acc.username) }, colors = CheckboxDefaults.colors(checkedColor = palette.accentStrong))
                        }
                    }
                    val members = state.share?.members.orEmpty().filter { it.isAccepted || it.isPending }
                    if (members.any { it.username != me }) {
                        item { SectionLabel(Icons.Rounded.Share, tr(lang, "共享成员", "Members"), trailing = "${members.size}") }
                        items(members, key = { "mem_" + it.username }) { m ->
                            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 5.dp)) {
                                ShareAvatar(m.username, m.name, 22.dp)
                                Spacer(Modifier.width(9.dp))
                                Text(m.name + if (m.username == me) tr(lang, "（我）", " (me)") else "", color = palette.inkPrimary, fontSize = 13.sp, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                StatusTag(m.isAccepted, when { m.isOwner -> tr(lang, "发起者", "Owner"); m.isAccepted -> tr(lang, "已加入", "Joined"); else -> tr(lang, "待接受", "Pending") })
                                if (state.share?.isOwner == true && m.username != me) {
                                    IconButton(onClick = { vm.sharing.removeMember(m.username) }, modifier = Modifier.size(28.dp)) { Icon(Icons.Rounded.Close, contentDescription = tr(lang, "移除", "Remove"), tint = palette.inkMuted, modifier = Modifier.size(15.dp)) }
                                }
                            }
                        }
                    }
                }
            }

            // 底部：共享链接 + 操作
            HorizontalDivider(color = palette.hairLine)
            Column(Modifier.padding(horizontal = 18.dp, vertical = 12.dp)) {
                val link = vm.sharing.shareLink()
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).border(1.dp, palette.hairLine, RoundedCornerShape(11.dp)).background(palette.cardSurface).padding(start = 10.dp, end = 4.dp, top = 4.dp, bottom = 4.dp)) {
                    Icon(Icons.Rounded.Link, contentDescription = null, tint = palette.inkMuted, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(8.dp))
                    Text(link ?: tr(lang, "正在生成共享链接…", "Generating link…"), color = palette.inkSecondary, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    TextButton(enabled = link != null, onClick = { link?.let { clipboard.setText(AnnotatedString(it)); copied = true } }) {
                        Text(if (copied) tr(lang, "已复制 ✓", "Copied ✓") else tr(lang, "复制", "Copy"), color = palette.accentStrong, fontSize = 12.5.sp)
                    }
                    IconButton(enabled = link != null, onClick = {
                        link?.let {
                            val send = Intent(Intent.ACTION_SEND).apply { type = "text/plain"; putExtra(Intent.EXTRA_TEXT, "${state.title}\n$it") }
                            context.startActivity(Intent.createChooser(send, tr(lang, "发送共享链接", "Send share link")))
                        }
                    }, modifier = Modifier.size(34.dp)) { Icon(Icons.Rounded.IosShare, contentDescription = tr(lang, "发送链接", "Send link"), tint = palette.accentStrong, modifier = Modifier.size(18.dp)) }
                }
                Text(tr(lang, "对方点开链接、登录平台后即可接受共享。共享的只是对话上下文（含历史里的附件与图片）；之后的提问、文件与命令都在各自账号下执行。", "Anyone with an account can open the link and accept after signing in. Only the conversation context is shared; new questions, files and commands run under each person’s own account."),
                    color = palette.inkMuted, fontSize = 11.5.sp, lineHeight = 16.sp, modifier = Modifier.padding(top = 7.dp))
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 10.dp)) {
                    val joined = state.share?.members.orEmpty().any { it.username != me && (it.isAccepted || it.isPending) }
                    if (state.share != null && (joined || state.share.isOwner == false)) {
                        TextButton(onClick = { confirmLeave = true }) { Text(if (state.share.isOwner) tr(lang, "停止共享", "Stop sharing") else tr(lang, "退出共享", "Leave"), color = palette.danger, fontSize = 13.sp) }
                    }
                    Spacer(Modifier.weight(1f))
                    TextButton(onClick = { vm.sharing.closeSheet() }) { Text(tr(lang, "取消", "Cancel"), color = palette.inkSecondary) }
                    Spacer(Modifier.width(6.dp))
                    Button(onClick = { vm.sharing.sendInvites() }, enabled = state.selected.isNotEmpty() && !state.busy && state.share != null, colors = ButtonDefaults.buttonColors(containerColor = palette.accentStrong)) {
                        Text(if (state.busy) tr(lang, "正在发送…", "Sending…") else tr(lang, "发送邀请", "Send invites"))
                        if (state.selected.isNotEmpty() && !state.busy) {
                            Spacer(Modifier.width(6.dp))
                            Box(Modifier.clip(CircleShape).background(Color.White.copy(alpha = 0.25f)).padding(horizontal = 6.dp)) { Text("${state.selected.size}", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Color.White) }
                        }
                    }
                }
            }
        }
    }
    if (confirmLeave) {
        val owner = state.share?.isOwner == true
        AlertDialog(
            onDismissRequest = { confirmLeave = false },
            title = { Text(if (owner) tr(lang, "停止共享", "Stop sharing") else tr(lang, "退出共享", "Leave")) },
            text = { Text(if (owner) tr(lang, "停止共享后，成员保留已同步的内容，但之后双方的新消息不再互相同步。", "Members keep what has been synced, but new messages will no longer sync.") else tr(lang, "退出后你保留本地的对话副本，但不再收到其他成员的新消息。", "You keep your copy, but will stop receiving new messages.")) },
            confirmButton = { TextButton(onClick = { confirmLeave = false; vm.sharing.leave() }) { Text(if (owner) tr(lang, "停止共享", "Stop") else tr(lang, "退出", "Leave"), color = LocalDragonClawPalette.current.danger) } },
            dismissButton = { TextButton(onClick = { confirmLeave = false }) { Text(tr(lang, "取消", "Cancel")) } }
        )
    }
}

@Composable
private fun SectionLabel(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, trailing: String? = null) {
    val palette = LocalDragonClawPalette.current
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 14.dp, bottom = 7.dp)) {
        Icon(icon, contentDescription = null, tint = palette.inkMuted, modifier = Modifier.size(14.dp))
        Spacer(Modifier.width(6.dp))
        Text(text, color = palette.inkMuted, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        if (trailing != null) Text(trailing, color = palette.inkMuted, fontSize = 11.5.sp)
    }
}

@Composable
private fun StatusTag(ok: Boolean, text: String) {
    val palette = LocalDragonClawPalette.current
    Box(Modifier.clip(CircleShape).background(if (ok) palette.accent.copy(alpha = 0.12f) else palette.chipSurface).padding(horizontal = 8.dp, vertical = 2.dp)) {
        Text(text, color = if (ok) palette.accentStrong else palette.inkSecondary, fontSize = 11.sp)
    }
}

@Composable
private fun Pill(selected: Boolean, dashed: Boolean = false, onClick: () -> Unit, content: @Composable RowScope.() -> Unit) {
    val palette = LocalDragonClawPalette.current
    val border by animateColorAsState(if (selected) palette.accentStrong.copy(alpha = 0.55f) else palette.hairLine, label = "pillBorder")
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.clip(CircleShape).border(1.dp, if (dashed) palette.inkMuted.copy(alpha = 0.4f) else border, CircleShape)
            .background(if (selected) palette.accent.copy(alpha = 0.09f) else palette.cardSurface)
            .clickable(onClick = onClick).padding(start = 4.dp, end = 10.dp, top = 4.dp, bottom = 4.dp),
        content = content
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun GroupPill(vm: DragonClawViewModel, group: ShareGroup, selected: Boolean) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    var menu by remember { mutableStateOf(false) }
    Box {
        Pill(selected = selected, onClick = { vm.sharing.toggleGroup(group) }) {
            Spacer(Modifier.width(4.dp))
            Icon(Icons.Rounded.Groups, contentDescription = null, tint = palette.inkSecondary, modifier = Modifier.size(15.dp))
            Spacer(Modifier.width(5.dp))
            Text(group.name, fontSize = 12.5.sp, color = palette.inkPrimary)
            Spacer(Modifier.width(5.dp))
            Text("${group.members.size}", fontSize = 11.5.sp, color = palette.inkMuted)
            Spacer(Modifier.width(2.dp))
            Icon(Icons.Rounded.MoreVert, contentDescription = tr(lang, "群组操作", "Group actions"), tint = palette.inkMuted, modifier = Modifier.size(15.dp).clip(CircleShape).clickable { menu = true })
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, modifier = Modifier.background(palette.cardSurface)) {
            DropdownMenuItem(
                text = { Text(tr(lang, "删除群组", "Delete group"), color = palette.danger) },
                leadingIcon = { Icon(Icons.Rounded.Delete, contentDescription = null, tint = palette.danger) },
                onClick = { menu = false; vm.sharing.deleteGroup(group) }
            )
        }
    }
}
