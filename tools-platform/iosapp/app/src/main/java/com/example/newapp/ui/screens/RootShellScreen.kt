package com.example.newapp.ui.screens

import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.newapp.R
import com.example.newapp.state.AppWorkMode
import com.example.newapp.state.DragonClawViewModel
import com.example.newapp.ui.components.DragonClawBackdrop
import com.example.newapp.ui.components.GlassCircleIconButton
import com.example.newapp.ui.components.GlassSegmentedPill
import com.example.newapp.ui.components.LiquidGlassSurface
import com.example.newapp.ui.theme.LocalDragonClawPalette
import com.example.newapp.ui.theme.tr
import kotlin.math.abs
import kotlinx.coroutines.launch

@Composable
fun RootShellScreen(vm: DragonClawViewModel) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    val scope = rememberCoroutineScope()
    val drawerProgress = remember { Animatable(0f) }
    var dragFraction by remember { mutableFloatStateOf(-1f) }
    val effectiveProgress = if (dragFraction >= 0f) dragFraction else drawerProgress.value
    fun animateSidebar(target: Float) {
        scope.launch {
            if (dragFraction >= 0f) {
                drawerProgress.snapTo(dragFraction)
                dragFraction = -1f
            }
            drawerProgress.animateTo(
                targetValue = target,
                animationSpec = spring(dampingRatio = 0.88f, stiffness = Spring.StiffnessMediumLow)
            )
        }
    }
    BackHandler(enabled = effectiveProgress > 0.45f) { animateSidebar(0f) }
    var showServerDialog by remember { mutableStateOf(false) }
    var serverDraft by remember { mutableStateOf(vm.baseUrl) }

    when {
        vm.activeWebTool != null -> {
            ToolWebViewScreen(
                vm = vm,
                tool = vm.activeWebTool!!,
                onClose = { vm.activeWebTool = null }
            )
            return
        }
        vm.showNativeMetrics -> {
            MetricsMonitorRootScreen(
                vm = vm,
                onClose = { vm.showNativeMetrics = false }
            )
            return
        }
    }

    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(Unit) {
                val touchSlop = viewConfiguration.touchSlop
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Final)
                    if (dragFraction >= 0f) return@awaitEachGesture
                    val startProgress = drawerProgress.value
                    var engaged = false
                    var totalDx = 0f
                    var lastPosX = down.position.x
                    var lastTimeMs = down.uptimeMillis
                    var vx = 0f

                    while (true) {
                        val pass = if (engaged) PointerEventPass.Initial else PointerEventPass.Final
                        val event = awaitPointerEvent(pass)
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        if (!change.pressed) {
                            if (engaged) {
                                change.consume()
                                val width = size.width.coerceAtLeast(1).toFloat()
                                val finalFraction = (startProgress + totalDx / width).coerceIn(0f, 1f)
                                val openTarget = when {
                                    vx > 480f -> 1f
                                    vx < -480f -> 0f
                                    startProgress < 0.5f -> if (finalFraction > 0.25f) 1f else 0f
                                    else -> if (finalFraction < 0.75f) 0f else 1f
                                }
                                scope.launch {
                                    drawerProgress.snapTo(finalFraction)
                                    dragFraction = -1f
                                    drawerProgress.animateTo(
                                        targetValue = openTarget,
                                        animationSpec = spring(dampingRatio = 0.88f, stiffness = Spring.StiffnessMediumLow)
                                    )
                                }
                            }
                            break
                        }

                        val dx = change.position.x - lastPosX
                        val dt = (change.uptimeMillis - lastTimeMs).coerceAtLeast(1L)
                        lastPosX = change.position.x
                        lastTimeMs = change.uptimeMillis

                        if (!engaged) {
                            if (change.isConsumed) break
                            totalDx = change.position.x - down.position.x
                            val totalDy = change.position.y - down.position.y
                            val absDx = abs(totalDx)
                            val absDy = abs(totalDy)
                            if (absDy > touchSlop && absDy > absDx * 1.1f) break
                            val validDirection = (startProgress < 0.05f && totalDx > touchSlop) ||
                                (startProgress > 0.95f && totalDx < -touchSlop)
                            if (absDx > touchSlop && absDx > absDy * 1.25f && validDirection) {
                                engaged = true
                                change.consume()
                            }
                        } else {
                            totalDx = change.position.x - down.position.x
                            vx = dx / dt * 1000f
                            change.consume()
                        }

                        if (engaged) {
                            val width = size.width.coerceAtLeast(1).toFloat()
                            dragFraction = (startProgress + totalDx / width).coerceIn(0f, 1f)
                        }
                    }
                }
            }
    ) {
        val widthPx = with(LocalDensity.current) { maxWidth.toPx().coerceAtLeast(1f) }
        val contentBlur by animateDpAsState(
            targetValue = if (effectiveProgress > 0.35f) 8.dp else 0.dp,
            label = "drawerBlur"
        )
        val blurModifier = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && contentBlur > 0.dp) {
            Modifier.blur(contentBlur)
        } else {
            Modifier
        }

        DragonClawBackdrop(
            modifier = Modifier
                .fillMaxSize()
                .graphicsLayer {
                    translationX = effectiveProgress * widthPx * 0.24f
                    val scale = 1f - 0.025f * effectiveProgress
                    scaleX = scale
                    scaleY = scale
                }
                .then(blurModifier)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 14.dp, vertical = 8.dp)
                ) {
                    GlassCircleIconButton(
                        icon = Icons.Rounded.Menu,
                        contentDescription = tr(lang, "打开侧边栏", "Open drawer"),
                        badgeCount = vm.alertUnreadCount
                    ) {
                        animateSidebar(1f)
                    }

                    GlassSegmentedPill(
                        options = listOf(
                            Triple(AppWorkMode.CHAT, tr(lang, "对话", "Chat"), Icons.Rounded.ChatBubbleOutline),
                            Triple(AppWorkMode.TOOLS, tr(lang, "工具", "Tools"), Icons.Rounded.GridView)
                        ),
                        selected = vm.workMode,
                        onSelect = { vm.workMode = it }
                    )

                    if (vm.workMode == AppWorkMode.CHAT) {
                        GlassCircleIconButton(
                            icon = Icons.Rounded.EditNote,
                            contentDescription = tr(lang, "新对话", "New Chat")
                        ) {
                            vm.startNewChat()
                        }
                    } else {
                        GlassCircleIconButton(
                            icon = Icons.Rounded.ShowChart,
                            contentDescription = "KPI Monitor",
                            tint = palette.accentStrong
                        ) {
                            vm.openMetricsModule()
                        }
                    }
                }

                Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                    when (vm.workMode) {
                        AppWorkMode.CHAT -> ChatScreen(vm)
                        AppWorkMode.TOOLS -> ToolsHubScreen(vm)
                    }
                }
            }
        }

        if (effectiveProgress > 0.005f) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.22f * effectiveProgress))
            )
        }

        if (effectiveProgress > 0.001f) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer { translationX = (effectiveProgress - 1f) * widthPx }
            ) {
                DragonClawBackdrop {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(palette.cardSurface.copy(alpha = if (palette.isDark) 0.56f else 0.62f))
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .statusBarsPadding()
                                .navigationBarsPadding()
                                .padding(horizontal = 18.dp, vertical = 12.dp)
                        ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Image(
                                painter = painterResource(id = R.drawable.dragon_claw_avatar),
                                contentDescription = "Dragon Claw",
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                            )
                            Spacer(Modifier.width(10.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = vm.identity.localizedName(lang),
                                    color = palette.inkPrimary,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = vm.identity.localizedSubtitle(lang),
                                    color = palette.inkMuted,
                                    fontSize = 10.5.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                            GlassCircleIconButton(
                                icon = Icons.Rounded.Close,
                                contentDescription = tr(lang, "关闭", "Close"),
                                size = 34.dp
                            ) {
                                animateSidebar(0f)
                            }
                        }

                        Spacer(Modifier.height(12.dp))

                        OutlinedTextField(
                            value = vm.sessionSearchQuery,
                            onValueChange = { vm.sessionSearchQuery = it },
                            textStyle = LocalTextStyle.current.copy(fontSize = 13.sp),
                            placeholder = { Text(tr(lang, "搜索历史会话...", "Search sessions..."), fontSize = 12.sp) },
                            leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null, modifier = Modifier.size(18.dp)) },
                            trailingIcon = {
                                if (vm.sessionSearchQuery.isNotEmpty()) {
                                    IconButton(onClick = {
                                        vm.sessionSearchQuery = ""
                                        vm.loadSessions()
                                    }) {
                                        Icon(Icons.Rounded.Close, contentDescription = null, modifier = Modifier.size(16.dp))
                                    }
                                }
                            },
                            singleLine = true,
                            shape = RoundedCornerShape(14.dp),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                            keyboardActions = KeyboardActions(onSearch = { vm.loadSessions() }),
                            modifier = Modifier.fillMaxWidth()
                        )

                        Spacer(Modifier.height(10.dp))

                        LiquidGlassSurface(
                            shape = RoundedCornerShape(14.dp),
                            tint = palette.accent,
                            tintAlpha = 0.14f,
                            elevation = 4.dp,
                            onClick = {
                                vm.startNewChat()
                                animateSidebar(0f)
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(Icons.Rounded.AddComment, contentDescription = null, tint = palette.accentStrong, modifier = Modifier.size(17.dp))
                                Spacer(Modifier.width(8.dp))
                                Text(
                                    text = tr(lang, "开启新对话", "New Chat"),
                                    color = palette.inkPrimary,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                        }

                        Spacer(Modifier.height(8.dp))

                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            LiquidGlassSurface(
                                shape = RoundedCornerShape(12.dp),
                                elevation = 3.dp,
                                onClick = {
                                    vm.workMode = AppWorkMode.TOOLS
                                    animateSidebar(0f)
                                },
                                modifier = Modifier.weight(1f)
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 9.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center
                                ) {
                                    Icon(Icons.Rounded.GridView, contentDescription = null, tint = palette.inkPrimary, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text(tr(lang, "工具台", "Tools"), fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = palette.inkPrimary)
                                }
                            }

                            LiquidGlassSurface(
                                shape = RoundedCornerShape(12.dp),
                                elevation = 3.dp,
                                onClick = {
                                    vm.openMetricsModule()
                                    animateSidebar(0f)
                                },
                                modifier = Modifier.weight(1f)
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 9.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center
                                ) {
                                    Icon(Icons.Rounded.Timeline, contentDescription = null, tint = palette.accentStrong, modifier = Modifier.size(16.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text("KPI / SLA", fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = palette.accentStrong)
                                }
                            }
                        }

                        if (vm.alertUnreadCount > 0) {
                            Spacer(Modifier.height(8.dp))
                            Surface(
                                color = palette.danger.copy(alpha = 0.12f),
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(Icons.Rounded.NotificationsActive, contentDescription = null, tint = palette.danger, modifier = Modifier.size(15.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Text(
                                        text = tr(lang, "告警中心有 ${vm.alertUnreadCount} 条未读", "${vm.alertUnreadCount} unread alerts"),
                                        color = palette.inkPrimary,
                                        fontSize = 11.5.sp,
                                        fontWeight = FontWeight.Medium
                                    )
                                }
                            }
                        }

                        Spacer(Modifier.height(10.dp))
                        HorizontalDivider(color = palette.hairLine)
                        Spacer(Modifier.height(6.dp))

                        LazyColumn(
                            modifier = Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            if (vm.sessionGroups.isEmpty()) {
                                item {
                                    Text(
                                        text = tr(lang, "暂无历史会话", "No conversation history"),
                                        color = palette.inkMuted,
                                        fontSize = 11.5.sp,
                                        modifier = Modifier.padding(vertical = 20.dp, horizontal = 8.dp)
                                    )
                                }
                            } else {
                                vm.sessionGroups.forEach { group ->
                                    item(key = "hdr_${group.bucket}") {
                                        Text(
                                            text = group.localizedTitle(lang),
                                            color = palette.inkMuted,
                                            fontSize = 10.5.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp)
                                        )
                                    }
                                    items(group.items, key = { it.id }) { session ->
                                        val isSelected = session.id == vm.currentSessionId
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .clip(RoundedCornerShape(12.dp))
                                                .background(if (isSelected) palette.accent.copy(alpha = 0.15f) else Color.Transparent)
                                                .clickable {
                                                    vm.openSession(session)
                                                    animateSidebar(0f)
                                                }
                                                .padding(horizontal = 10.dp, vertical = 8.dp)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Rounded.ChatBubbleOutline,
                                                contentDescription = null,
                                                tint = if (isSelected) palette.accentStrong else palette.inkMuted,
                                                modifier = Modifier.size(15.dp)
                                            )
                                            Spacer(Modifier.width(8.dp))
                                            Text(
                                                text = session.displayTitle(lang),
                                                color = if (isSelected) palette.accentStrong else palette.inkPrimary,
                                                fontSize = 12.5.sp,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis,
                                                modifier = Modifier.weight(1f)
                                            )
                                            Spacer(Modifier.width(8.dp))
                                            IconButton(
                                                onClick = { vm.deleteSession(session) },
                                                modifier = Modifier.size(28.dp)
                                            ) {
                                                Icon(
                                                    imageVector = Icons.Rounded.DeleteOutline,
                                                    contentDescription = tr(lang, "删除", "Delete"),
                                                    tint = palette.inkMuted,
                                                    modifier = Modifier.size(16.dp)
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        Spacer(Modifier.height(8.dp))
                        LiquidGlassSurface(
                            shape = RoundedCornerShape(18.dp),
                            elevation = 4.dp,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Box(
                                        contentAlignment = Alignment.Center,
                                        modifier = Modifier
                                            .size(34.dp)
                                            .background(palette.accent.copy(alpha = 0.18f), CircleShape)
                                    ) {
                                        Text(
                                            text = vm.username.firstOrNull()?.uppercase() ?: "U",
                                            color = palette.accentStrong,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                    Spacer(Modifier.width(10.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(vm.username.ifBlank { "User" }, color = palette.inkPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                                        Text(vm.role.uppercase(), color = palette.inkMuted, fontSize = 9.5.sp)
                                    }
                                    GlassCircleIconButton(
                                        icon = if (vm.isDark) Icons.Rounded.LightMode else Icons.Rounded.DarkMode,
                                        contentDescription = "Theme",
                                        size = 34.dp
                                    ) { vm.toggleTheme() }
                                    Spacer(Modifier.width(6.dp))
                                    GlassCircleIconButton(
                                        icon = Icons.Rounded.Language,
                                        contentDescription = "Language",
                                        size = 34.dp
                                    ) { vm.toggleLanguage() }
                                }
                                Spacer(Modifier.height(10.dp))
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedButton(
                                        onClick = {
                                            serverDraft = vm.baseUrl
                                            showServerDialog = true
                                        },
                                        shape = RoundedCornerShape(12.dp),
                                        modifier = Modifier.weight(1f)
                                    ) {
                                        Icon(Icons.Rounded.Dns, contentDescription = null, modifier = Modifier.size(15.dp))
                                        Spacer(Modifier.width(4.dp))
                                        Text(tr(lang, "服务器", "Server"), fontSize = 11.5.sp)
                                    }
                                    OutlinedButton(
                                        onClick = { vm.logout() },
                                        shape = RoundedCornerShape(12.dp),
                                        colors = ButtonDefaults.outlinedButtonColors(contentColor = palette.danger),
                                        modifier = Modifier.weight(1f)
                                    ) {
                                        Icon(Icons.AutoMirrored.Rounded.Logout, contentDescription = null, modifier = Modifier.size(15.dp))
                                        Spacer(Modifier.width(4.dp))
                                        Text(tr(lang, "退出", "Logout"), fontSize = 11.5.sp)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    }

    if (showServerDialog) {
        AlertDialog(
            onDismissRequest = { showServerDialog = false },
            title = { Text(tr(lang, "服务器设置", "Server Endpoint")) },
            text = {
                OutlinedTextField(
                    value = serverDraft,
                    onValueChange = { serverDraft = it },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    vm.updateServerBaseUrl(serverDraft)
                    showServerDialog = false
                }) { Text(tr(lang, "保存", "Save")) }
            },
            dismissButton = {
                TextButton(onClick = { showServerDialog = false }) { Text(tr(lang, "取消", "Cancel")) }
            }
        )
    }
}
