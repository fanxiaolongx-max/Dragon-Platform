package com.example.newapp.ui.screens

import android.content.Intent
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Logout
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.newapp.R
import com.example.newapp.shared.model.AiSessionSummary
import com.example.newapp.shared.model.AlertCenterEvent
import com.example.newapp.shared.model.SessionBucket
import com.example.newapp.shared.model.SidebarSessionEntry
import com.example.newapp.shared.util.DragonClawHelpers
import com.example.newapp.shared.util.SessionGrouping
import com.example.newapp.state.AppWorkMode
import com.example.newapp.state.DragonClawViewModel
import com.example.newapp.ui.components.DragonClawBackdrop
import com.example.newapp.ui.components.GlassCircleIconButton
import com.example.newapp.ui.components.GlassSegmentedPill
import com.example.newapp.ui.components.LiquidGlassSurface
import com.example.newapp.ui.theme.LocalDragonClawPalette
import com.example.newapp.ui.theme.tr
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlinx.coroutines.launch

private enum class GestureAxisLock {
    UNDECIDED,
    HORIZONTAL_DRAWER,
    HORIZONTAL_TAB,
    LOCKED_VERTICAL_OR_CHILD
}

val LocalSuppressShellHorizontalGesture = staticCompositionLocalOf<MutableState<Boolean>?> { null }

fun Modifier.excludeFromShellHorizontalGesture(): Modifier = composed {
    val suppressState = LocalSuppressShellHorizontalGesture.current ?: return@composed this
    this.pointerInput(suppressState) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
            suppressState.value = true
            try {
                while (true) {
                    val event = awaitPointerEvent(PointerEventPass.Final)
                    if (event.changes.none { it.pressed }) break
                }
            } finally {
                suppressState.value = false
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RootShellScreen(vm: DragonClawViewModel) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val focusManager = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    val drawerProgress = remember { Animatable(0f) }
    var dragFraction by remember { mutableFloatStateOf(-1f) }
    val tabOffsetAnim = remember { Animatable(0f) }
    var dragTabDeltaX by remember { mutableFloatStateOf(0f) }
    val effectiveProgress = if (dragFraction >= 0f) dragFraction else drawerProgress.value
    fun animateSidebar(target: Float) {
        if (target < 0.5f) {
            focusManager.clearFocus()
        }
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
    var showSettingsSheet by remember { mutableStateOf(false) }
    var showServerDialog by remember { mutableStateOf(false) }
    var showSchedulesSheet by remember { mutableStateOf(false) }
    var showAlertCenterSheet by remember { mutableStateOf(false) }
    BackHandler(enabled = vm.activeWebTool == null && !vm.showNativeMetrics && effectiveProgress > 0.45f && !showSettingsSheet && !showAlertCenterSheet && !showServerDialog && !showSchedulesSheet) {
        animateSidebar(0f)
    }
    LaunchedEffect(drawerProgress.value > 0.85f) {
        if (drawerProgress.value > 0.85f) vm.loadSessionsIfStale()
    }
    var scheduleDraft by remember { mutableStateOf("") }
    var serverDraft by remember { mutableStateOf(vm.baseUrl) }
    var renameTargetSession by remember { mutableStateOf<AiSessionSummary?>(null) }
    var renameDraft by remember { mutableStateOf("") }
    var childScrollActiveForGesture by remember { mutableStateOf(false) }
    val suppressHorizontalGesture = remember { mutableStateOf(false) }
    val density = LocalDensity.current
    val tabFlingMinDxPx = remember(density) { with(density) { 48.dp.toPx() } }
    val drawerFlingMinDxPx = remember(density) { with(density) { 44.dp.toPx() } }

    val childScrollLockConnection = remember {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source == NestedScrollSource.Drag && (abs(available.x) > 0.5f || abs(available.y) > 0.5f)) {
                    childScrollActiveForGesture = true
                }
                return Offset.Zero
            }
        }
    }

    // Keep the shell mounted behind full-screen tool/metrics overlays so closing returns
    // directly to the exact ToolsHub scroll offset and filter state.
    Box(modifier = Modifier.fillMaxSize()) {
    CompositionLocalProvider(LocalSuppressShellHorizontalGesture provides suppressHorizontalGesture) {
    BoxWithConstraints(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(childScrollLockConnection)
            .pointerInput(Unit) {
                val touchSlop = viewConfiguration.touchSlop
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Main)
                    if (vm.activeWebTool != null || vm.showNativeMetrics || vm.isVoiceChatActive || dragFraction >= 0f || suppressHorizontalGesture.value) return@awaitEachGesture
                    childScrollActiveForGesture = false
                    val startProgress = drawerProgress.value
                    var lockState = GestureAxisLock.UNDECIDED
                    var totalDx = 0f
                    val velocityTracker = VelocityTracker().apply {
                        addPosition(down.uptimeMillis, down.position)
                    }

                    while (true) {
                        val pass = if (lockState == GestureAxisLock.HORIZONTAL_DRAWER || lockState == GestureAxisLock.HORIZONTAL_TAB) {
                            PointerEventPass.Initial
                        } else {
                            PointerEventPass.Main
                        }
                        val event = awaitPointerEvent(pass)
                        val change = event.changes.firstOrNull { it.id == down.id } ?: break
                        if (!change.pressed) {
                            if (lockState == GestureAxisLock.HORIZONTAL_DRAWER) {
                                change.consume()
                                val width = size.width.coerceAtLeast(1).toFloat()
                                val finalFraction = (startProgress + totalDx / width).coerceIn(0f, 1f)
                                val vx = runCatching { velocityTracker.calculateVelocity().x }.getOrDefault(0f)
                                val predictedFraction = (startProgress + (totalDx + vx * 0.14f) / width).coerceIn(0f, 1f)
                                val openTarget = when {
                                    startProgress < 0.5f -> if (finalFraction > 0.25f || (totalDx > drawerFlingMinDxPx && vx > 1200f && predictedFraction > 0.42f)) 1f else 0f
                                    else -> if (finalFraction < 0.75f || (totalDx < -drawerFlingMinDxPx && vx < -1200f && predictedFraction < 0.58f)) 0f else 1f
                                }
                                scope.launch {
                                    drawerProgress.snapTo(finalFraction)
                                    dragFraction = -1f
                                    drawerProgress.animateTo(
                                        targetValue = openTarget,
                                        animationSpec = spring(dampingRatio = 0.88f, stiffness = Spring.StiffnessMediumLow)
                                    )
                                }
                            } else if (lockState == GestureAxisLock.HORIZONTAL_TAB) {
                                change.consume()
                                val vx = runCatching { velocityTracker.calculateVelocity().x }.getOrDefault(0f)
                                val width = size.width.coerceAtLeast(1).toFloat()
                                val currentOffset = tabOffsetAnim.value
                                val delta = dragTabDeltaX
                                dragTabDeltaX = 0f
                                if (vm.workMode == AppWorkMode.CHAT) {
                                    val shouldSwitch = delta < -width * 0.24f || (delta < -tabFlingMinDxPx && vx < -1200f)
                                    if (shouldSwitch) {
                                        vm.workMode = AppWorkMode.TOOLS
                                    } else {
                                        scope.launch {
                                            tabOffsetAnim.snapTo(currentOffset + delta)
                                            tabOffsetAnim.animateTo(
                                                targetValue = 0f,
                                                animationSpec = spring(dampingRatio = 0.88f, stiffness = Spring.StiffnessMediumLow)
                                            )
                                        }
                                    }
                                } else if (vm.workMode == AppWorkMode.TOOLS) {
                                    val shouldSwitch = delta > width * 0.24f || (delta > tabFlingMinDxPx && vx > 1200f)
                                    if (shouldSwitch) {
                                        vm.workMode = AppWorkMode.CHAT
                                    } else {
                                        scope.launch {
                                            tabOffsetAnim.snapTo(currentOffset + delta)
                                            tabOffsetAnim.animateTo(
                                                targetValue = -width,
                                                animationSpec = spring(dampingRatio = 0.88f, stiffness = Spring.StiffnessMediumLow)
                                            )
                                        }
                                    }
                                }
                            }
                            break
                        }

                        velocityTracker.addPosition(change.uptimeMillis, change.position)

                        if (lockState == GestureAxisLock.UNDECIDED) {
                            if (change.isConsumed || childScrollActiveForGesture || suppressHorizontalGesture.value) {
                                lockState = GestureAxisLock.LOCKED_VERTICAL_OR_CHILD
                                break
                            }
                            totalDx = change.position.x - down.position.x
                            val totalDy = change.position.y - down.position.y
                            val absDx = abs(totalDx)
                            val absDy = abs(totalDy)

                            // Yield early to vertical scroll before horizontal capture can trigger.
                            if (absDy > touchSlop * 0.80f && absDy > absDx * 1.15f) {
                                lockState = GestureAxisLock.LOCKED_VERTICAL_OR_CHILD
                                break
                            }

                            val edgePx = with(density) { 28.dp.toPx() }
                            val isEdgeSwipe = down.position.x <= edgePx || down.position.x >= size.width - edgePx
                            val slopeRatio = if (isEdgeSwipe) 0.90f else 1.35f
                            // Capture on clear horizontal dominance (stricter vertical protection in center, responsive edge pull).
                            if (absDx > touchSlop && absDx > absDy * slopeRatio) {
                                if (startProgress > 0.95f) {
                                    if (totalDx < -touchSlop) {
                                        lockState = GestureAxisLock.HORIZONTAL_DRAWER
                                        change.consume()
                                    } else {
                                        lockState = GestureAxisLock.LOCKED_VERTICAL_OR_CHILD
                                        break
                                    }
                                } else {
                                    if (vm.workMode == AppWorkMode.CHAT) {
                                        if (totalDx > touchSlop) {
                                            lockState = GestureAxisLock.HORIZONTAL_DRAWER
                                            change.consume()
                                        } else if (totalDx < -touchSlop) {
                                            lockState = GestureAxisLock.HORIZONTAL_TAB
                                            change.consume()
                                        }
                                    } else if (vm.workMode == AppWorkMode.TOOLS) {
                                        if (totalDx > touchSlop) {
                                            lockState = GestureAxisLock.HORIZONTAL_TAB
                                            change.consume()
                                        } else {
                                            lockState = GestureAxisLock.LOCKED_VERTICAL_OR_CHILD
                                            break
                                        }
                                    }
                                }
                            }
                        } else if (lockState == GestureAxisLock.HORIZONTAL_DRAWER) {
                            val rawDx = change.position.x - down.position.x
                            totalDx = if (startProgress > 0.5f) min(0f, rawDx) else max(0f, rawDx)
                            change.consume()
                            val width = size.width.coerceAtLeast(1).toFloat()
                            dragFraction = (startProgress + totalDx / width).coerceIn(0f, 1f)
                        } else if (lockState == GestureAxisLock.HORIZONTAL_TAB) {
                            val rawDx = change.position.x - down.position.x
                            totalDx = if (vm.workMode == AppWorkMode.CHAT) min(0f, rawDx) else max(0f, rawDx)
                            change.consume()
                            dragTabDeltaX = totalDx
                        }
                    }
                }
            }
    ) {
        val screenWidth = maxWidth
        val widthPx = with(LocalDensity.current) { screenWidth.toPx().coerceAtLeast(1f) }

        LaunchedEffect(vm.workMode, widthPx) {
            val target = if (vm.workMode == AppWorkMode.CHAT) 0f else -widthPx
            tabOffsetAnim.animateTo(
                targetValue = target,
                animationSpec = spring(dampingRatio = 0.88f, stiffness = Spring.StiffnessMediumLow)
            )
        }
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
                        contentDescription = tr(lang, "打开侧边栏", "Open drawer")
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

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .clipToBounds()
                ) {
                    val pageShiftPx = tabOffsetAnim.value + dragTabDeltaX
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .graphicsLayer { translationX = pageShiftPx }
                    ) {
                        ChatScreen(vm)
                    }
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .graphicsLayer { translationX = widthPx + pageShiftPx }
                    ) {
                        ToolsHubScreen(vm)
                    }
                }
            }
        }

        if (effectiveProgress > 0.005f) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.22f * effectiveProgress))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null
                    ) { animateSidebar(0f) }
            )
        }

        if (effectiveProgress > 0.001f) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer { translationX = (effectiveProgress - 1f) * widthPx }
            ) {
                DragonClawBackdrop {
                    val accountRole = DragonClawHelpers.localizedAccountRole(vm.role, vm.isSuper, lang)
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .background(palette.cardSurface.copy(alpha = if (palette.isDark) 0.58f else 0.68f))
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .statusBarsPadding()
                                .padding(horizontal = 16.dp, vertical = 10.dp)
                        ) {
                            // Compact User Profile Header + Collapse Button
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Box(
                                    contentAlignment = Alignment.Center,
                                    modifier = Modifier
                                        .size(38.dp)
                                        .background(
                                            palette.accent.copy(alpha = if (palette.isDark) 0.24f else 0.16f),
                                            CircleShape
                                        )
                                ) {
                                    Text(
                                        text = vm.username.firstOrNull()?.uppercase() ?: "U",
                                        color = palette.accentStrong,
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                                Spacer(Modifier.width(11.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = vm.username.ifBlank { "User" },
                                        color = palette.inkPrimary,
                                        fontSize = 15.5.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Spacer(Modifier.height(1.dp))
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        Text(
                                            text = accountRole,
                                            color = palette.inkMuted,
                                            fontSize = 11.5.sp,
                                            fontWeight = FontWeight.Medium,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Surface(
                                            shape = CircleShape,
                                            color = palette.chipSurface
                                        ) {
                                            Text(
                                                text = "v${vm.appVersion}",
                                                color = palette.inkMuted,
                                                fontSize = 10.sp,
                                                fontFamily = FontFamily.Monospace,
                                                fontWeight = FontWeight.SemiBold,
                                                maxLines = 1,
                                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.5.dp)
                                            )
                                        }
                                    }
                                }
                                GlassCircleIconButton(
                                    icon = Icons.Rounded.KeyboardDoubleArrowRight,
                                    contentDescription = tr(lang, "收起侧边栏", "Close"),
                                    size = 34.dp
                                ) {
                                    animateSidebar(0f)
                                }
                            }

                            Spacer(Modifier.height(8.dp))

                            // Compact Active / Archived inline scope tabs
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                listOf(
                                    false to tr(lang, "最近会话", "Active"),
                                    true to tr(lang, "已归档", "Archived")
                                ).forEach { (archivedTab, label) ->
                                    val selected = vm.showArchivedSessions == archivedTab
                                    Text(
                                        text = label,
                                        color = if (selected) palette.accentStrong else palette.inkMuted,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier
                                            .clip(CircleShape)
                                            .background(if (selected) palette.accent.copy(alpha = 0.15f) else Color.Transparent)
                                            .clickable {
                                                vm.showArchivedSessions = archivedTab
                                                if (archivedTab) vm.loadArchivedSessions()
                                            }
                                            .padding(horizontal = 10.dp, vertical = 4.dp)
                                    )
                                }
                            }

                            Spacer(Modifier.height(4.dp))

                            LazyColumn(
                                modifier = Modifier.weight(1f),
                                contentPadding = PaddingValues(top = 4.dp, bottom = 92.dp),
                                verticalArrangement = Arrangement.spacedBy(3.dp)
                            ) {
                                if (vm.showArchivedSessions) {
                                    if (vm.archivedSessions.isEmpty()) {
                                        item {
                                            Text(
                                                text = tr(lang, "暂无已归档会话", "No archived conversations"),
                                                color = palette.inkMuted,
                                                fontSize = 12.sp,
                                                modifier = Modifier.padding(vertical = 28.dp, horizontal = 8.dp)
                                            )
                                        }
                                    } else {
                                        items(vm.archivedSessions, key = { "arch_${it.id}" }) { session ->
                                            val entry = SidebarSessionEntry(
                                                stableKey = "ai:${session.id}",
                                                aiSession = session
                                            )
                                            SidebarSessionRow(
                                                entry = entry,
                                                isSelected = vm.currentSidebarSelectionKey == entry.stableKey,
                                                isArchived = true,
                                                language = lang,
                                                onOpen = {
                                                    vm.openSession(session)
                                                    animateSidebar(0f)
                                                },
                                                onRefresh = {
                                                    vm.openSession(session, forceRefresh = true)
                                                    animateSidebar(0f)
                                                },
                                                onRename = {
                                                    renameDraft = session.displayTitle(lang)
                                                    renameTargetSession = session
                                                },
                                                onToggleArchive = { vm.unarchiveSession(session) },
                                                onExport = { vm.exportSession(session) },
                                                onDelete = { vm.deleteSession(session) }
                                            )
                                        }
                                    }
                                } else if (vm.unifiedSessionGroups.isEmpty()) {
                                    item {
                                        Text(
                                            text = tr(lang, "暂无历史会话", "No conversation history"),
                                            color = palette.inkMuted,
                                            fontSize = 12.sp,
                                            modifier = Modifier.padding(vertical = 28.dp, horizontal = 8.dp)
                                        )
                                    }
                                } else {
                                    vm.unifiedSessionGroups.forEach { group ->
                                        val isPinnedGroup = group.bucket == SessionBucket.PINNED
                                        val isCollapsed = SessionGrouping.shouldCollapseGroup(
                                            bucket = group.bucket,
                                            isPinnedCollapsed = vm.isPinnedCollapsed,
                                            searchQuery = vm.sessionSearchQuery
                                        )
                                        item(key = "hdr_${group.bucket}") {
                                            if (isPinnedGroup) {
                                                val chevronRotation by animateFloatAsState(
                                                    targetValue = if (isCollapsed) -90f else 0f,
                                                    animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
                                                    label = "pinnedChevronRotation"
                                                )
                                                Row(
                                                    verticalAlignment = Alignment.CenterVertically,
                                                    modifier = Modifier
                                                        .fillMaxWidth()
                                                        .clip(RoundedCornerShape(8.dp))
                                                        .clickable { vm.togglePinnedCollapsed() }
                                                        .padding(horizontal = 8.dp, vertical = 5.dp)
                                                ) {
                                                    Text(
                                                        text = group.localizedTitle(lang),
                                                        color = palette.inkMuted,
                                                        fontSize = 11.sp,
                                                        fontWeight = FontWeight.SemiBold
                                                    )
                                                    Spacer(Modifier.width(4.dp))
                                                    Text(
                                                        text = "(${group.items.size})",
                                                        color = palette.inkMuted.copy(alpha = 0.78f),
                                                        fontSize = 11.sp,
                                                        fontWeight = FontWeight.Medium
                                                    )
                                                    Spacer(Modifier.weight(1f))
                                                    Icon(
                                                        imageVector = Icons.Rounded.KeyboardArrowDown,
                                                        contentDescription = if (isCollapsed) {
                                                            tr(lang, "展开置顶", "Expand pinned")
                                                        } else {
                                                            tr(lang, "收起置顶", "Collapse pinned")
                                                        },
                                                        tint = palette.inkMuted,
                                                        modifier = Modifier
                                                            .size(16.dp)
                                                            .graphicsLayer { rotationZ = chevronRotation }
                                                    )
                                                }
                                            } else {
                                                Text(
                                                    text = group.localizedTitle(lang),
                                                    color = palette.inkMuted,
                                                    fontSize = 11.sp,
                                                    fontWeight = FontWeight.SemiBold,
                                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                                )
                                            }
                                        }
                                        if (!isCollapsed) {
                                            items(group.items, key = { it.stableKey }) { entry ->
                                                SidebarSessionRow(
                                                    entry = entry,
                                                    isSelected = entry.stableKey == vm.currentSidebarSelectionKey,
                                                    isArchived = false,
                                                    language = lang,
                                                    onOpen = {
                                                        vm.openSidebarEntry(entry)
                                                        animateSidebar(0f)
                                                    },
                                                    onRefresh = {
                                                        entry.aiSession?.let { vm.openSession(it, forceRefresh = true) }
                                                            ?: entry.desktopSession?.let { vm.openDesktopSession(it, forceRefresh = true) }
                                                        animateSidebar(0f)
                                                    },
                                                    onRename = entry.aiSession?.let { session ->
                                                        {
                                                            renameDraft = session.displayTitle(lang)
                                                            renameTargetSession = session
                                                        }
                                                    },
                                                    onTogglePin = {
                                                        entry.aiSession?.let { vm.togglePinSession(it) }
                                                            ?: entry.desktopSession?.let { vm.togglePinDesktopSession(it) }
                                                    },
                                                    onMovePinnedUp = if (entry.isPinned && vm.canMovePinnedEntry(entry, moveUp = true)) {
                                                        { vm.movePinnedEntry(entry, moveUp = true) }
                                                    } else null,
                                                    onMovePinnedDown = if (entry.isPinned && vm.canMovePinnedEntry(entry, moveUp = false)) {
                                                        { vm.movePinnedEntry(entry, moveUp = false) }
                                                    } else null,
                                                    onToggleArchive = entry.aiSession?.let { session -> { vm.archiveSession(session) } },
                                                    onExport = entry.aiSession?.let { session -> { vm.exportSession(session) } },
                                                    onDelete = entry.aiSession?.let { session -> { vm.deleteSession(session) } }
                                                )
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // Subtle bottom fade under floating dock
                        Box(
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .fillMaxWidth()
                                .height(96.dp)
                                .background(
                                    Brush.verticalGradient(
                                        colors = listOf(
                                            Color.Transparent,
                                            (if (palette.isDark) Color.Black else palette.cardSurface).copy(alpha = 0.45f)
                                        )
                                    )
                                )
                        )

                        // Floating Bottom Dock: Settings + Search Pill + New Chat Compose
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .fillMaxWidth()
                                .navigationBarsPadding()
                                .imePadding()
                                .padding(horizontal = 16.dp, vertical = 10.dp)
                        ) {
                            GlassCircleIconButton(
                                icon = Icons.Rounded.Settings,
                                contentDescription = tr(lang, "设置", "Settings"),
                                size = 42.dp,
                                badgeCount = vm.alertUnreadCount
                            ) {
                                focusManager.clearFocus()
                                vm.loadSchedules()
                                vm.loadAlertCenter("all")
                                showSettingsSheet = true
                            }

                            LiquidGlassSurface(
                                shape = CircleShape,
                                elevation = 4.dp,
                                modifier = Modifier
                                    .weight(1f)
                                    .height(42.dp)
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .padding(horizontal = 12.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Rounded.Search,
                                        contentDescription = null,
                                        tint = palette.inkMuted,
                                        modifier = Modifier.size(17.dp)
                                    )
                                    Spacer(Modifier.width(7.dp))
                                    Box(modifier = Modifier.weight(1f)) {
                                        if (vm.sessionSearchQuery.isEmpty()) {
                                            Text(
                                                text = tr(lang, "搜索", "Search"),
                                                color = palette.inkMuted,
                                                fontSize = 13.5.sp,
                                                maxLines = 1,
                                                overflow = TextOverflow.Ellipsis
                                            )
                                        }
                                        BasicTextField(
                                            value = vm.sessionSearchQuery,
                                            onValueChange = {
                                                vm.sessionSearchQuery = it
                                                vm.regroupSessions()
                                            },
                                            singleLine = true,
                                            textStyle = TextStyle(color = palette.inkPrimary, fontSize = 13.5.sp),
                                            cursorBrush = SolidColor(palette.accentStrong),
                                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                                            keyboardActions = KeyboardActions(onSearch = {
                                                focusManager.clearFocus()
                                                if (vm.showArchivedSessions) vm.loadArchivedSessions() else vm.loadSessions()
                                            }),
                                            modifier = Modifier.fillMaxWidth()
                                        )
                                    }
                                    if (vm.sessionSearchQuery.isNotEmpty()) {
                                        Spacer(Modifier.width(4.dp))
                                        Icon(
                                            imageVector = Icons.Rounded.Close,
                                            contentDescription = tr(lang, "清除搜索", "Clear search"),
                                            tint = palette.inkMuted,
                                            modifier = Modifier
                                                .size(16.dp)
                                                .clip(CircleShape)
                                                .clickable {
                                                    vm.sessionSearchQuery = ""
                                                    if (vm.showArchivedSessions) vm.loadArchivedSessions() else vm.loadSessions()
                                                }
                                        )
                                    }
                                }
                            }

                            Surface(
                                shape = CircleShape,
                                color = if (palette.isDark) Color.White.copy(alpha = 0.95f) else palette.inkPrimary,
                                shadowElevation = 4.dp,
                                onClick = {
                                    vm.startNewChat()
                                    animateSidebar(0f)
                                },
                                modifier = Modifier.size(42.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(
                                        imageVector = Icons.Rounded.EditNote,
                                        contentDescription = tr(lang, "新建对话", "New Chat"),
                                        tint = if (palette.isDark) Color.Black else Color.White,
                                        modifier = Modifier.size(21.dp)
                                    )
                                }
                            }
                        }
                    }
                }
        }
        }

        if (vm.isVoiceChatActive) {
            BackHandler(enabled = true) {
                vm.endVoiceConversation()
            }
            VoiceConversationOverlay(vm = vm)
        }
    }

    if (showServerDialog) {
        AlertDialog(
            onDismissRequest = { showServerDialog = false },
            containerColor = palette.cardSurface,
            titleContentColor = palette.inkPrimary,
            textContentColor = palette.inkPrimary,
            title = { Text(tr(lang, "服务器设置", "Server Endpoint"), color = palette.inkPrimary) },
            text = {
                OutlinedTextField(
                    value = serverDraft,
                    onValueChange = { serverDraft = it },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = palette.inkPrimary,
                        unfocusedTextColor = palette.inkPrimary,
                        focusedBorderColor = palette.accentStrong,
                        unfocusedBorderColor = palette.hairLine,
                        cursorColor = palette.accentStrong
                    ),
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    vm.updateServerBaseUrl(serverDraft)
                    showServerDialog = false
                }) { Text(tr(lang, "保存", "Save"), color = palette.accentStrong) }
            },
            dismissButton = {
                TextButton(onClick = { showServerDialog = false }) { Text(tr(lang, "取消", "Cancel"), color = palette.inkMuted) }
            }
        )
    }

    if (showSchedulesSheet) {
        AlertDialog(
            onDismissRequest = { showSchedulesSheet = false },
            containerColor = palette.cardSurface,
            titleContentColor = palette.inkPrimary,
            textContentColor = palette.inkPrimary,
            title = { Text(tr(lang, "定时指令 (/schedule)", "Scheduled Tasks"), color = palette.inkPrimary) },
            text = {
                Column(modifier = Modifier.fillMaxWidth().heightIn(max = 380.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(
                            value = scheduleDraft,
                            onValueChange = { scheduleDraft = it },
                            placeholder = { Text(tr(lang, "每天 9:00 汇总告警", "Daily 9:00 summary"), fontSize = 12.sp, color = palette.inkMuted) },
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = palette.inkPrimary,
                                unfocusedTextColor = palette.inkPrimary,
                                focusedBorderColor = palette.accentStrong,
                                unfocusedBorderColor = palette.hairLine,
                                cursorColor = palette.accentStrong
                            ),
                            modifier = Modifier.weight(1f)
                        )
                        Spacer(Modifier.width(6.dp))
                        FilledIconButton(
                            onClick = {
                                val text = scheduleDraft
                                scheduleDraft = ""
                                vm.createSchedule(text)
                            },
                            enabled = scheduleDraft.isNotBlank()
                        ) {
                            Icon(Icons.Rounded.Add, contentDescription = "Add")
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    if (vm.isLoadingSchedules && vm.schedules.isEmpty()) {
                        Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(modifier = Modifier.size(22.dp))
                        }
                    } else if (vm.schedules.isEmpty()) {
                        Text(
                            tr(lang, "暂无定时任务（也可直接在对话中输入 /schedule）", "No scheduled tasks yet."),
                            color = palette.inkMuted,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(vertical = 12.dp)
                        )
                    } else {
                        Column(modifier = Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            vm.schedules.forEach { item ->
                                Surface(
                                    shape = RoundedCornerShape(12.dp),
                                    color = palette.chipSurface,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp)
                                    ) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(item.instruction, fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, color = palette.inkPrimary)
                                            if (!item.nextRunAt.isNullOrBlank()) {
                                                Text(item.nextRunAt!!, fontSize = 10.5.sp, color = palette.inkMuted)
                                            }
                                            if (item.lastError.isNotBlank()) {
                                                Text(item.lastError, fontSize = 10.5.sp, color = palette.danger, maxLines = 2)
                                            }
                                        }
                                        IconButton(onClick = { vm.deleteSchedule(item) }, modifier = Modifier.size(28.dp)) {
                                            Icon(Icons.Rounded.DeleteOutline, contentDescription = "Cancel", tint = palette.inkMuted, modifier = Modifier.size(16.dp))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showSchedulesSheet = false }) {
                    Text(tr(lang, "关闭", "Close"), color = palette.accentStrong)
                }
            }
        )
    }

    vm.exportedSessionJson?.let { rawJson ->
        AlertDialog(
            onDismissRequest = { vm.exportedSessionJson = null },
            containerColor = palette.cardSurface,
            titleContentColor = palette.inkPrimary,
            textContentColor = palette.inkPrimary,
            title = { Text(tr(lang, "导出对话日志", "Exported Chat Log"), color = palette.inkPrimary) },
            text = {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 260.dp)
                        .verticalScroll(rememberScrollState())
                        .background(palette.chipSurface, RoundedCornerShape(10.dp))
                        .padding(10.dp)
                ) {
                    Text(rawJson.take(4000), fontSize = 10.5.sp, fontFamily = FontFamily.Monospace, color = palette.inkPrimary)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val shareIntent = Intent(Intent.ACTION_SEND).apply {
                        type = "application/json"
                        putExtra(Intent.EXTRA_TEXT, rawJson)
                    }
                    context.startActivity(Intent.createChooser(shareIntent, tr(lang, "分享对话日志", "Share Chat Log")))
                }) { Text(tr(lang, "分享", "Share"), color = palette.accentStrong) }
            },
            dismissButton = {
                TextButton(onClick = {
                    clipboard.setText(AnnotatedString(rawJson))
                    vm.exportedSessionJson = null
                }) { Text(tr(lang, "复制", "Copy"), color = palette.inkMuted) }
            }
        )
    }

    renameTargetSession?.let { target ->
        AlertDialog(
            onDismissRequest = { renameTargetSession = null },
            containerColor = palette.cardSurface,
            titleContentColor = palette.inkPrimary,
            textContentColor = palette.inkPrimary,
            title = { Text(tr(lang, "重命名对话", "Rename Conversation"), color = palette.inkPrimary) },
            text = {
                OutlinedTextField(
                    value = renameDraft,
                    onValueChange = { renameDraft = it },
                    singleLine = true,
                    placeholder = { Text(tr(lang, "输入新的对话名称", "Enter new name"), fontSize = 13.sp, color = palette.inkMuted) },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = palette.inkPrimary,
                        unfocusedTextColor = palette.inkPrimary,
                        focusedBorderColor = palette.accentStrong,
                        unfocusedBorderColor = palette.hairLine,
                        cursorColor = palette.accentStrong
                    ),
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.renameSession(target, renameDraft)
                        renameTargetSession = null
                    },
                    enabled = renameDraft.trim().isNotEmpty()
                ) { Text(tr(lang, "保存", "Save"), color = palette.accentStrong) }
            },
            dismissButton = {
                TextButton(onClick = { renameTargetSession = null }) {
                    Text(tr(lang, "取消", "Cancel"), color = palette.inkMuted)
                }
            }
        )
    }

    if (showSettingsSheet) {
        SettingsModalSheet(
            vm = vm,
            onDismiss = { showSettingsSheet = false },
            onOpenAlertCenter = {
                showSettingsSheet = false
                vm.loadAlertCenter("all")
                showAlertCenterSheet = true
            },
            onOpenSchedules = {
                showSettingsSheet = false
                vm.loadSchedules()
                showSchedulesSheet = true
            },
            onOpenServer = {
                showSettingsSheet = false
                serverDraft = vm.baseUrl
                showServerDialog = true
            },
            onLogout = {
                showSettingsSheet = false
                animateSidebar(0f)
                vm.logout()
            }
        )
    }

    if (showAlertCenterSheet) {
        AlertCenterModalSheet(
            vm = vm,
            onDismiss = { showAlertCenterSheet = false }
        )
    }

    when {
        vm.activeWebTool != null -> {
            ToolWebViewScreen(
                vm = vm,
                tool = vm.activeWebTool!!,
                onClose = { vm.activeWebTool = null }
            )
        }
        vm.showNativeMetrics -> {
            MetricsMonitorRootScreen(
                vm = vm,
                onClose = { vm.showNativeMetrics = false }
            )
        }
    }
    }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsModalSheet(
    vm: DragonClawViewModel,
    onDismiss: () -> Unit,
    onOpenAlertCenter: () -> Unit,
    onOpenSchedules: () -> Unit,
    onOpenServer: () -> Unit,
    onLogout: () -> Unit
) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val accountRole = DragonClawHelpers.localizedAccountRole(vm.role, vm.isSuper, lang)
    val activeSchedules = vm.schedules.count { it.status == "active" }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = palette.elevatedSurface
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = 18.dp)
                .padding(bottom = 22.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = tr(lang, "设置", "Settings"),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = palette.inkPrimary,
                    modifier = Modifier.weight(1f)
                )
                TextButton(onClick = onDismiss) {
                    Text(tr(lang, "完成", "Done"), color = palette.accentStrong)
                }
            }

            // Account Header Card
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = palette.cardSurface,
                border = BorderStroke(0.5.dp, palette.hairLine),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(14.dp)
                ) {
                    Box(
                        contentAlignment = Alignment.Center,
                        modifier = Modifier
                            .size(44.dp)
                            .background(palette.accent.copy(alpha = 0.18f), CircleShape)
                    ) {
                        Text(
                            text = vm.username.firstOrNull()?.uppercase() ?: "U",
                            color = palette.accentStrong,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    Spacer(Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = vm.username.ifBlank { "User" },
                            color = palette.inkPrimary,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                        Spacer(Modifier.height(2.dp))
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Text(
                                text = accountRole,
                                color = palette.inkMuted,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Medium
                            )
                            Surface(
                                shape = CircleShape,
                                color = palette.chipSurface,
                                border = BorderStroke(0.5.dp, palette.hairLine)
                            ) {
                                Text(
                                    text = "v${vm.appVersion}",
                                    color = palette.inkMuted,
                                    fontSize = 10.5.sp,
                                    fontFamily = FontFamily.Monospace,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 1.5.dp)
                                )
                            }
                        }
                    }
                }
            }

            // Notifications & Automation Card
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = palette.cardSurface,
                border = BorderStroke(0.5.dp, palette.hairLine),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column {
                    SettingsNavRow(
                        icon = Icons.Rounded.NotificationsActive,
                        iconTint = if (vm.alertUnreadCount > 0) palette.danger else palette.accentStrong,
                        title = tr(lang, "告警中心", "Alert Center"),
                        badgeText = if (vm.alertUnreadCount > 0) "${vm.alertUnreadCount}" else null,
                        badgeColor = palette.danger,
                        onClick = onOpenAlertCenter
                    )
                    HorizontalDivider(color = palette.hairLine, modifier = Modifier.padding(horizontal = 14.dp))
                    SettingsNavRow(
                        icon = Icons.Rounded.Schedule,
                        iconTint = palette.accentStrong,
                        title = tr(lang, "定时任务", "Scheduled Tasks"),
                        badgeText = if (activeSchedules > 0) "$activeSchedules" else null,
                        badgeColor = palette.accentStrong,
                        onClick = onOpenSchedules
                    )
                }
            }

            // Preferences & Server Card
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = palette.cardSurface,
                border = BorderStroke(0.5.dp, palette.hairLine),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 11.dp)
                    ) {
                        Icon(
                            imageVector = if (vm.isDark) Icons.Rounded.DarkMode else Icons.Rounded.LightMode,
                            contentDescription = null,
                            tint = palette.accentStrong,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(
                            text = tr(lang, "外观主题", "Appearance"),
                            color = palette.inkPrimary,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.weight(1f)
                        )
                        SettingsChoicePills(
                            options = listOf(false to tr(lang, "浅色", "Light"), true to tr(lang, "深色", "Dark")),
                            selected = vm.isDark,
                            onSelect = { wantDark -> if (wantDark != vm.isDark) vm.toggleTheme() }
                        )
                    }
                    HorizontalDivider(color = palette.hairLine, modifier = Modifier.padding(horizontal = 14.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 11.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Language,
                            contentDescription = null,
                            tint = palette.accentStrong,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(
                            text = tr(lang, "界面语言", "Language"),
                            color = palette.inkPrimary,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.weight(1f)
                        )
                        SettingsChoicePills(
                            options = listOf("zh" to "中文", "en" to "EN"),
                            selected = lang,
                            onSelect = { wantLang -> if (wantLang != lang) vm.toggleLanguage() }
                        )
                    }
                    HorizontalDivider(color = palette.hairLine, modifier = Modifier.padding(horizontal = 14.dp))
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable(onClick = onOpenServer)
                            .padding(horizontal = 14.dp, vertical = 13.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Rounded.Dns,
                            contentDescription = null,
                            tint = palette.accentStrong,
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(Modifier.width(12.dp))
                        Text(
                            text = tr(lang, "服务器", "Server"),
                            color = palette.inkPrimary,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            text = vm.baseUrl,
                            color = palette.inkMuted,
                            fontSize = 12.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f).padding(end = 4.dp)
                        )
                        Icon(
                            imageVector = Icons.Rounded.ChevronRight,
                            contentDescription = null,
                            tint = palette.inkMuted,
                            modifier = Modifier.size(18.dp)
                        )
                    }
                }
            }

            OutlinedButton(
                onClick = onLogout,
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = palette.danger),
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.AutoMirrored.Rounded.Logout, contentDescription = null, modifier = Modifier.size(17.dp))
                Spacer(Modifier.width(8.dp))
                Text(tr(lang, "退出登录", "Sign Out"), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
            }

            Text(
                text = "${vm.identity.localizedName(lang)} Mobile · v${vm.appVersion}",
                color = palette.inkMuted,
                fontSize = 11.sp,
                modifier = Modifier.align(Alignment.CenterHorizontally)
            )
        }
    }
}

@Composable
private fun SettingsNavRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    iconTint: Color,
    title: String,
    badgeText: String?,
    badgeColor: Color,
    onClick: () -> Unit
) {
    val palette = LocalDragonClawPalette.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 13.dp)
    ) {
        Icon(imageVector = icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(
            text = title,
            color = palette.inkPrimary,
            fontSize = 14.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f)
        )
        if (!badgeText.isNullOrBlank()) {
            Surface(
                shape = CircleShape,
                color = badgeColor
            ) {
                Text(
                    text = badgeText,
                    color = Color.White,
                    fontSize = 10.5.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp)
                )
            }
            Spacer(Modifier.width(6.dp))
        }
        Icon(
            imageVector = Icons.Rounded.ChevronRight,
            contentDescription = null,
            tint = palette.inkMuted,
            modifier = Modifier.size(18.dp)
        )
    }
}

@Composable
private fun <T> SettingsChoicePills(
    options: List<Pair<T, String>>,
    selected: T,
    onSelect: (T) -> Unit
) {
    val palette = LocalDragonClawPalette.current
    Surface(
        shape = CircleShape,
        color = palette.chipSurface,
        border = BorderStroke(0.5.dp, palette.hairLine)
    ) {
        Row(
            modifier = Modifier.padding(3.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            options.forEach { (value, label) ->
                val active = value == selected
                Text(
                    text = label,
                    color = if (active) palette.accentStrong else palette.inkMuted,
                    fontSize = 11.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier
                        .clip(CircleShape)
                        .background(if (active) palette.accent.copy(alpha = 0.16f) else Color.Transparent)
                        .clickable { onSelect(value) }
                        .padding(horizontal = 10.dp, vertical = 5.dp)
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AlertCenterModalSheet(
    vm: DragonClawViewModel,
    onDismiss: () -> Unit
) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var expandedId by remember { mutableStateOf<String?>(null) }

    val filters = listOf(
        "all" to tr(lang, "全部", "All"),
        "unread" to tr(lang, "未读", "Unread"),
        "config" to tr(lang, "配置", "Config"),
        "security" to tr(lang, "安全", "Security"),
        "user_action" to tr(lang, "操作", "Action"),
        "system" to tr(lang, "系统", "System")
    )

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        containerColor = palette.elevatedSurface,
        dragHandle = { BottomSheetDefaults.DragHandle(color = palette.hairLine) }
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.88f)
                .navigationBarsPadding()
                .padding(horizontal = 18.dp)
                .padding(bottom = 12.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(
                    Icons.Rounded.NotificationsActive,
                    contentDescription = null,
                    tint = palette.danger,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = tr(lang, "告警中心", "Alert Center"),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = palette.inkPrimary,
                    modifier = Modifier.weight(1f)
                )
                if (vm.alertUnreadCount > 0) {
                    TextButton(onClick = { vm.markAllAlertsRead() }) {
                        Text(
                            text = tr(lang, "全部已读", "Mark all read"),
                            fontSize = 12.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = palette.accentStrong
                        )
                    }
                }
                IconButton(onClick = onDismiss, modifier = Modifier.size(32.dp)) {
                    Icon(
                        Icons.Rounded.Close,
                        contentDescription = tr(lang, "关闭", "Close"),
                        tint = palette.inkMuted,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }

            vm.alertSummary?.let { summary ->
                Spacer(Modifier.height(6.dp))
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    AlertSummaryPill(
                        label = tr(lang, "总计", "Total"),
                        value = summary.total.toString(),
                        accent = palette.inkPrimary,
                        modifier = Modifier.weight(1f)
                    )
                    AlertSummaryPill(
                        label = tr(lang, "未读", "Unread"),
                        value = summary.unread.toString(),
                        accent = if (summary.unread > 0) palette.danger else palette.inkPrimary,
                        modifier = Modifier.weight(1f)
                    )
                    AlertSummaryPill(
                        label = tr(lang, "预警以上", "Warn+"),
                        value = summary.warnOrAbove.toString(),
                        accent = if (summary.warnOrAbove > 0) Color(0xFFD97706) else palette.inkPrimary,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            Spacer(Modifier.height(10.dp))
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(bottom = 8.dp)
            ) {
                filters.forEach { (key, title) ->
                    val active = vm.alertFilter == key
                    Surface(
                        shape = RoundedCornerShape(10.dp),
                        color = if (active) palette.accentStrong else palette.chipSurface,
                        onClick = { vm.setAlertCenterFilter(key) }
                    ) {
                        Text(
                            text = title,
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (active) Color.White else palette.inkPrimary,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                        )
                    }
                }
            }

            vm.alertError?.takeIf { it.isNotBlank() }?.let { err ->
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = palette.danger.copy(alpha = 0.12f),
                    modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)
                ) {
                    Text(
                        text = err,
                        color = palette.danger,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                    )
                }
            }

            if (vm.isLoadingAlertEvents && vm.alertEvents.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxWidth().height(180.dp),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(26.dp), color = palette.accentStrong)
                }
            } else if (vm.alertEvents.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxWidth().height(160.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = tr(lang, "当前筛选下暂无告警记录", "No alerts in this filter"),
                        color = palette.inkMuted,
                        fontSize = 13.sp
                    )
                }
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(bottom = 28.dp),
                    modifier = Modifier.fillMaxWidth().weight(1f)
                ) {
                    items(vm.alertEvents, key = { it.id }) { ev ->
                        val isExpanded = expandedId == ev.id
                        val sevColor = when (ev.severity.lowercase()) {
                            "critical", "error" -> palette.danger
                            "warn", "warning" -> Color(0xFFD97706)
                            else -> palette.accentStrong
                        }
                        Surface(
                            shape = RoundedCornerShape(14.dp),
                            color = palette.cardSurface,
                            border = BorderStroke(0.5.dp, palette.hairLine),
                            onClick = { expandedId = if (isExpanded) null else ev.id },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    if (ev.isUnread) {
                                        Box(
                                            modifier = Modifier
                                                .size(7.dp)
                                                .clip(CircleShape)
                                                .background(palette.danger)
                                        )
                                        Spacer(Modifier.width(6.dp))
                                    }
                                    Surface(
                                        shape = RoundedCornerShape(6.dp),
                                        color = sevColor.copy(alpha = 0.14f)
                                    ) {
                                        Text(
                                            text = ev.severityLabel(lang),
                                            color = sevColor,
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold,
                                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                        )
                                    }
                                    Spacer(Modifier.width(6.dp))
                                    Surface(
                                        shape = RoundedCornerShape(6.dp),
                                        color = palette.chipSurface
                                    ) {
                                        Text(
                                            text = ev.typeLabel(lang),
                                            color = palette.inkMuted,
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Medium,
                                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                        )
                                    }
                                    Spacer(Modifier.weight(1f))
                                    Text(
                                        text = ev.created_at.take(16).replace("T", " "),
                                        fontSize = 10.sp,
                                        color = palette.inkMuted
                                    )
                                }
                                Spacer(Modifier.height(6.dp))
                                Text(
                                    text = ev.title.ifBlank { ev.message.take(60) },
                                    fontSize = 13.5.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = palette.inkPrimary
                                )
                                if (ev.message.isNotBlank()) {
                                    Spacer(Modifier.height(3.dp))
                                    Text(
                                        text = ev.message,
                                        fontSize = 12.sp,
                                        color = palette.inkMuted,
                                        maxLines = if (isExpanded) Int.MAX_VALUE else 2,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }

                                if (isExpanded) {
                                    if (ev.actor.isNotBlank() || ev.source.isNotBlank()) {
                                        Spacer(Modifier.height(6.dp))
                                        Text(
                                            text = listOfNotNull(
                                                ev.actor.takeIf { it.isNotBlank() }?.let { "${tr(lang, "触发者", "Actor")}: $it" },
                                                ev.source.takeIf { it.isNotBlank() }?.let { "${tr(lang, "来源", "Source")}: $it" }
                                            ).joinToString(" · "),
                                            fontSize = 11.sp,
                                            color = palette.inkMuted
                                        )
                                    }
                                    val details = ev.detailEntries()
                                    if (details.isNotEmpty()) {
                                        Spacer(Modifier.height(6.dp))
                                        Column(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .background(palette.chipSurface, RoundedCornerShape(8.dp))
                                                .padding(8.dp),
                                            verticalArrangement = Arrangement.spacedBy(2.dp)
                                        ) {
                                            details.forEach { entry ->
                                                Text(entry, fontSize = 11.sp, fontFamily = FontFamily.Monospace, color = palette.inkPrimary)
                                            }
                                        }
                                    }
                                    if (ev.ai_summary.isNotBlank()) {
                                        Spacer(Modifier.height(6.dp))
                                        Text(
                                            text = "AI: ${ev.ai_summary}",
                                            fontSize = 11.5.sp,
                                            color = palette.accentStrong
                                        )
                                    }
                                    Spacer(Modifier.height(8.dp))
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        if (ev.isUnread) {
                                            Surface(
                                                shape = RoundedCornerShape(8.dp),
                                                color = palette.accentStrong.copy(alpha = 0.14f),
                                                onClick = { vm.markAlertRead(ev.id) }
                                            ) {
                                                Text(
                                                    text = tr(lang, "标为已读", "Mark Read"),
                                                    fontSize = 11.5.sp,
                                                    fontWeight = FontWeight.SemiBold,
                                                    color = palette.accentStrong,
                                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                                                )
                                            }
                                        }
                                        Surface(
                                            shape = RoundedCornerShape(8.dp),
                                            color = palette.chipSurface,
                                            onClick = { vm.archiveAlert(ev.id) }
                                        ) {
                                            Text(
                                                text = tr(lang, "归档", "Archive"),
                                                fontSize = 11.5.sp,
                                                fontWeight = FontWeight.Medium,
                                                color = palette.inkMuted,
                                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                                            )
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
}

@Composable
private fun AlertSummaryPill(
    label: String,
    value: String,
    accent: Color,
    modifier: Modifier = Modifier
) {
    val palette = LocalDragonClawPalette.current
    Surface(
        shape = RoundedCornerShape(10.dp),
        color = palette.chipSurface,
        modifier = modifier
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(vertical = 7.dp, horizontal = 6.dp)
        ) {
            Text(value, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = accent)
            Text(label, fontSize = 10.sp, color = palette.inkMuted)
        }
    }
}

@Composable
private fun SidebarSessionRow(
    entry: SidebarSessionEntry,
    isSelected: Boolean,
    isArchived: Boolean,
    language: String,
    onOpen: () -> Unit,
    onRefresh: (() -> Unit)? = null,
    onRename: (() -> Unit)? = null,
    onTogglePin: (() -> Unit)? = null,
    onMovePinnedUp: (() -> Unit)? = null,
    onMovePinnedDown: (() -> Unit)? = null,
    onToggleArchive: (() -> Unit)? = null,
    onExport: (() -> Unit)? = null,
    onDelete: (() -> Unit)? = null
) {
    val palette = LocalDragonClawPalette.current
    var showMenu by remember { mutableStateOf(false) }
    val badge = entry.badgeLabel(language)
    val iconVector = when {
        isArchived -> Icons.Rounded.Inventory2
        entry.desktopSession?.provider?.lowercase() == "codex" -> Icons.Rounded.Terminal
        entry.desktopSession?.provider?.lowercase() == "claudecode" -> Icons.Rounded.AutoAwesome
        entry.desktopSession?.provider?.lowercase() == "antigravity" -> Icons.Rounded.Memory
        entry.desktopSession?.provider?.lowercase() == "workbuddy" -> Icons.Rounded.DesktopMac
        entry.aiSession?.isGroupSession == true -> Icons.Rounded.Groups
        entry.aiSession?.isWorkspaceAgent == true -> Icons.Rounded.Build
        else -> Icons.Rounded.ChatBubbleOutline
    }
    val badgeColor = when (entry.desktopSession?.provider?.lowercase()) {
        "codex" -> Color(0xFF16A34A)
        "claudecode" -> Color(0xFFEA580C)
        "workbuddy" -> Color(0xFF0891B2)
        else -> if (badge == "群聊" || badge == "Group") Color(0xFF4F46E5) else palette.accentStrong
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (isSelected) palette.accent.copy(alpha = 0.15f) else Color.Transparent)
            .clickable(onClick = onOpen)
            .padding(horizontal = 10.dp, vertical = 7.dp)
    ) {
        Icon(
            imageVector = iconVector,
            contentDescription = null,
            tint = if (isSelected) palette.accentStrong else palette.inkMuted,
            modifier = Modifier.size(15.dp)
        )
        Spacer(Modifier.width(7.dp))
        Text(
            text = entry.displayTitle(language),
            color = if (isSelected) palette.accentStrong else palette.inkPrimary,
            fontSize = 12.5.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f)
        )
        if (!badge.isNullOrBlank()) {
            Spacer(Modifier.width(5.dp))
            Box(
                modifier = Modifier
                    .clip(CircleShape)
                    .background(badgeColor.copy(alpha = 0.14f))
                    .padding(horizontal = 6.dp, vertical = 2.dp)
            ) {
                Text(
                    text = badge,
                    color = badgeColor,
                    fontSize = 9.5.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1
                )
            }
        }
        if (entry.isPinned) {
            Spacer(Modifier.width(4.dp))
            Icon(
                imageVector = Icons.Rounded.PushPin,
                contentDescription = "Pinned",
                tint = palette.accentStrong,
                modifier = Modifier.size(13.dp)
            )
        }
        if (entry.busy) {
            Spacer(Modifier.width(5.dp))
            CircularProgressIndicator(strokeWidth = 1.6.dp, color = palette.accentStrong, modifier = Modifier.size(12.dp))
        }
        if (entry.aiSession != null || entry.desktopSession != null || onRefresh != null) {
            Box {
                IconButton(
                    onClick = { showMenu = true },
                    modifier = Modifier.size(28.dp)
                ) {
                    Icon(
                        imageVector = Icons.Rounded.MoreHoriz,
                        contentDescription = "More",
                        tint = palette.inkMuted,
                        modifier = Modifier.size(16.dp)
                    )
                }
                DropdownMenu(
                    expanded = showMenu,
                    onDismissRequest = { showMenu = false },
                    modifier = Modifier.background(palette.cardSurface)
                ) {
                    if (onRefresh != null) {
                        DropdownMenuItem(
                            text = { Text(tr(language, "刷新对话", "Refresh"), color = palette.inkPrimary) },
                            leadingIcon = { Icon(Icons.Rounded.Refresh, contentDescription = null, tint = palette.inkSecondary) },
                            onClick = {
                                showMenu = false
                                onRefresh()
                            }
                        )
                    }
                    if (onRename != null) {
                        DropdownMenuItem(
                            text = { Text(tr(language, "重命名", "Rename"), color = palette.inkPrimary) },
                            leadingIcon = { Icon(Icons.Rounded.Edit, contentDescription = null, tint = palette.inkSecondary) },
                            onClick = {
                                showMenu = false
                                onRename()
                            }
                        )
                    }
                    if (!isArchived && onTogglePin != null) {
                        DropdownMenuItem(
                            text = {
                                Text(
                                    text = if (entry.isPinned) tr(language, "取消置顶", "Unpin") else tr(language, "置顶会话", "Pin"),
                                    color = palette.inkPrimary
                                )
                            },
                            leadingIcon = {
                                Icon(Icons.Rounded.PushPin, contentDescription = null, tint = palette.inkSecondary)
                            },
                            onClick = {
                                showMenu = false
                                onTogglePin()
                            }
                        )
                    }
                    if (!isArchived && onMovePinnedUp != null) {
                        DropdownMenuItem(
                            text = { Text(tr(language, "上移置顶", "Move Up"), color = palette.inkPrimary) },
                            leadingIcon = { Icon(Icons.Rounded.ArrowUpward, contentDescription = null, tint = palette.inkSecondary) },
                            onClick = {
                                showMenu = false
                                onMovePinnedUp()
                            }
                        )
                    }
                    if (!isArchived && onMovePinnedDown != null) {
                        DropdownMenuItem(
                            text = { Text(tr(language, "下移置顶", "Move Down"), color = palette.inkPrimary) },
                            leadingIcon = { Icon(Icons.Rounded.ArrowDownward, contentDescription = null, tint = palette.inkSecondary) },
                            onClick = {
                                showMenu = false
                                onMovePinnedDown()
                            }
                        )
                    }
                    if (onToggleArchive != null) {
                        DropdownMenuItem(
                            text = {
                                Text(
                                    text = if (isArchived) tr(language, "恢复会话", "Unarchive") else tr(language, "归档会话", "Archive"),
                                    color = palette.inkPrimary
                                )
                            },
                            leadingIcon = {
                                Icon(
                                    if (isArchived) Icons.Rounded.Unarchive else Icons.Rounded.Archive,
                                    contentDescription = null,
                                    tint = palette.inkSecondary
                                )
                            },
                            onClick = {
                                showMenu = false
                                onToggleArchive()
                            }
                        )
                    }
                    if (onExport != null) {
                        DropdownMenuItem(
                            text = { Text(tr(language, "导出日志 (JSON)", "Export Log"), color = palette.inkPrimary) },
                            leadingIcon = { Icon(Icons.Rounded.IosShare, contentDescription = null, tint = palette.inkSecondary) },
                            onClick = {
                                showMenu = false
                                onExport()
                            }
                        )
                    }
                    if (onDelete != null) {
                        DropdownMenuItem(
                            text = { Text(tr(language, "删除会话", "Delete"), color = palette.danger) },
                            leadingIcon = { Icon(Icons.Rounded.DeleteOutline, contentDescription = null, tint = palette.danger) },
                            onClick = {
                                showMenu = false
                                onDelete()
                            }
                        )
                    }
                }
            }
        }
    }
}
