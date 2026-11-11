package com.example.newapp.ui.screens

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.VolumeOff
import androidx.compose.material.icons.automirrored.rounded.VolumeUp
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.example.newapp.R
import com.example.newapp.shared.model.AgentSkillItem
import com.example.newapp.shared.model.ChatMessage
import com.example.newapp.shared.util.MarkdownParser
import com.example.newapp.shared.util.MdBlock
import com.example.newapp.shared.util.MdBlockKind
import com.example.newapp.shared.util.MdSpan
import com.example.newapp.shared.util.MdSpanKind
import com.example.newapp.state.DragonClawViewModel
import com.example.newapp.state.VoiceChatPhase
import com.example.newapp.ui.components.DragonClawBackdrop
import com.example.newapp.ui.components.LiquidGlassSurface
import com.example.newapp.ui.theme.DragonClawPalette
import com.example.newapp.ui.theme.LocalDragonClawPalette
import com.example.newapp.ui.theme.tr
import java.io.File
import java.util.UUID

@Composable
fun ChatScreen(vm: DragonClawViewModel) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    val context = LocalContext.current
    val listState = rememberLazyListState()
    var showModelMenu by remember { mutableStateOf(false) }
    var showPlusMenu by remember { mutableStateOf(false) }
    var showSkillsDialog by remember { mutableStateOf(false) }
    var skillSearch by remember { mutableStateOf("") }
    var pendingCameraUri by remember { mutableStateOf<Uri?>(null) }
    var pendingVoiceChatOnPermission by remember { mutableStateOf(false) }

    val filePickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        if (uris.isNotEmpty()) {
            vm.uploadUris(context.contentResolver, uris)
        }
    }

    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickMultipleVisualMedia(5)
    ) { uris ->
        if (uris.isNotEmpty()) {
            vm.uploadUris(context.contentResolver, uris)
        }
    }

    val cameraLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.TakePicture()
    ) { success ->
        val uri = pendingCameraUri
        pendingCameraUri = null
        if (success && uri != null) {
            vm.uploadUris(context.contentResolver, listOf(uri))
        }
    }

    val audioPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        val launchVoiceChat = pendingVoiceChatOnPermission
        pendingVoiceChatOnPermission = false
        if (granted) {
            if (launchVoiceChat) {
                vm.startVoiceConversation(context)
            } else {
                vm.startVoiceRecording(context)
            }
        } else {
            vm.chatErrorBanner = tr(lang, "请在系统设置中允许麦克风权限以使用语音输入", "Microphone permission is required")
        }
    }

    fun triggerVoiceRecording(voiceChat: Boolean = false) {
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            if (voiceChat) {
                vm.startVoiceConversation(context)
            } else {
                vm.startVoiceRecording(context)
            }
        } else {
            pendingVoiceChatOnPermission = voiceChat
            audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    fun launchCameraCapture() {
        runCatching {
            val dir = File(context.cacheDir, "camera").apply { mkdirs() }
            val photo = File(dir, "capture_${UUID.randomUUID()}.jpg")
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", photo)
            pendingCameraUri = uri
            cameraLauncher.launch(uri)
        }.onFailure {
            vm.chatErrorBanner = tr(lang, "无法打开相机：${it.message ?: ""}", "Unable to open camera")
        }
    }

    LaunchedEffect(vm.messages.size, vm.messages.lastOrNull()?.content) {
        if (vm.messages.size > 2) {
            listState.animateScrollToItem(vm.messages.lastIndex)
        }
    }

    val starterPrompts = remember(vm.suggestions, lang) {
        if (vm.suggestions.isNotEmpty()) {
            vm.suggestions.take(6).map { it.question }
        } else if (lang == "en") {
            listOf(
                "Summarize this month's failing SLA & KPI metrics",
                "Show overdue tickets that need urgent escalation",
                "How do I check the Night Duty Roster and PR audit?"
            )
        } else {
            listOf(
                "总结本月异常 KPI 指标并给出改进建议",
                "排查当前超时与临期 SLA 工单清单",
                "帮我说明月报核算和 PR 稽查怎么操作"
            )
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .navigationBarsPadding()
            .imePadding()
    ) {
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            if (vm.messages.isEmpty() && vm.isLoadingSessionMessages) {
                ChatShimmerSkeleton(modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp, vertical = 18.dp))
            } else if (vm.messages.isEmpty()) {
                LazyColumn(
                    contentPadding = PaddingValues(horizontal = 18.dp, vertical = 20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.fillMaxSize()
                ) {
                    item {
                        Spacer(Modifier.height(14.dp))
                        LiquidGlassSurface(
                            shape = CircleShape,
                            elevation = 8.dp,
                            modifier = Modifier.size(80.dp)
                        ) {
                            Image(
                                painter = painterResource(id = R.drawable.dragon_claw_avatar),
                                contentDescription = "Dragon Claw",
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(6.dp)
                                    .clip(CircleShape)
                            )
                        }
                        Spacer(Modifier.height(14.dp))
                        Text(
                            text = tr(lang, "Dragon Claw，让想法落地", "Dragon Claw, from idea to done"),
                            color = palette.inkPrimary,
                            fontSize = 20.sp,
                            fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center
                        )
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = vm.identity.localizedSlogan(lang),
                            color = palette.inkMuted,
                            fontSize = 12.sp,
                            textAlign = TextAlign.Center
                        )
                        Spacer(Modifier.height(12.dp))

                        Box {
                            LiquidGlassSurface(
                                shape = CircleShape,
                                elevation = 4.dp,
                                onClick = { showModelMenu = true }
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp)
                                ) {
                                    Icon(Icons.Rounded.Memory, contentDescription = null, tint = palette.accentStrong, modifier = Modifier.size(15.dp))
                                    Spacer(Modifier.width(5.dp))
                                    Text(vm.activeModelDisplayName, color = palette.inkPrimary, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
                                    Spacer(Modifier.width(4.dp))
                                    Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = null, tint = palette.inkMuted, modifier = Modifier.size(15.dp))
                                }
                            }
                            DropdownMenu(expanded = showModelMenu, onDismissRequest = { showModelMenu = false }) {
                                DropdownMenuItem(
                                    text = { Text(tr(lang, "系统推荐模型", "Default Model")) },
                                    onClick = {
                                        vm.selectModel("")
                                        showModelMenu = false
                                    }
                                )
                                vm.models.forEach { model ->
                                    DropdownMenuItem(
                                        text = { Text(model.name) },
                                        onClick = {
                                            vm.selectModel(model.id)
                                            showModelMenu = false
                                        }
                                    )
                                }
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                    }

                    item {
                        Text(
                            text = tr(lang, "快速提问", "Suggested Prompts"),
                            color = palette.inkMuted,
                            fontSize = 11.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp)
                        )
                    }

                    items(starterPrompts) { prompt ->
                        LiquidGlassSurface(
                            shape = RoundedCornerShape(15.dp),
                            elevation = 4.dp,
                            onClick = { vm.sendPrompt(prompt) },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(horizontal = 13.dp, vertical = 10.dp)
                            ) {
                                Icon(Icons.Rounded.AutoAwesome, contentDescription = null, tint = palette.accentStrong, modifier = Modifier.size(15.dp))
                                Spacer(Modifier.width(9.dp))
                                Text(prompt, color = palette.inkPrimary, fontSize = 12.5.sp, lineHeight = 18.sp, modifier = Modifier.weight(1f))
                                Icon(Icons.Rounded.NorthEast, contentDescription = null, tint = palette.inkMuted, modifier = Modifier.size(14.dp))
                            }
                        }
                    }
                }
            } else {
                LazyColumn(
                    state = listState,
                    contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    modifier = Modifier.fillMaxSize()
                ) {
                    if (vm.isLoadingSessionMessages) {
                        item {
                            ChatShimmerSkeleton(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
                        }
                    }
                    items(vm.messages, key = { it.id }) { msg ->
                        ChatBubbleItem(
                            message = msg,
                            language = lang,
                            onRetry = { vm.retryLastPrompt() }
                        )
                    }
                }
            }
        }

        // Floating Liquid Glass Composer Bar
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            contentAlignment = Alignment.BottomStart
        ) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                vm.activeDesktopSession?.let { desktop ->
                    LiquidGlassSurface(
                        shape = CircleShape,
                        elevation = 2.dp,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .clip(CircleShape)
                                    .background(palette.accent.copy(alpha = 0.16f))
                                    .padding(horizontal = 8.dp, vertical = 2.dp)
                            ) {
                                Text(
                                    text = desktop.providerDisplayName(),
                                    color = palette.accentStrong,
                                    fontSize = 10.5.sp,
                                    fontWeight = FontWeight.SemiBold
                                )
                            }
                            Spacer(Modifier.width(8.dp))
                            Text(
                                text = desktop.displayTitle(lang),
                                color = palette.inkPrimary,
                                fontSize = 12.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f)
                            )
                            if (vm.activeDesktopBusy) {
                                CircularProgressIndicator(strokeWidth = 2.dp, color = palette.accentStrong, modifier = Modifier.size(12.dp))
                                Spacer(Modifier.width(5.dp))
                                Text(tr(lang, "运行中", "Running"), color = palette.accentStrong, fontSize = 11.sp)
                            } else if (!vm.activeDesktopCanSend) {
                                Text(tr(lang, "只读", "Read-only"), color = palette.inkMuted, fontSize = 11.sp)
                            }
                        }
                    }
                }

                vm.chatErrorBanner?.let { err ->
                    LiquidGlassSurface(
                        shape = CircleShape,
                        tint = palette.danger,
                        tintAlpha = 0.14f,
                        elevation = 3.dp,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                        ) {
                            Icon(Icons.Rounded.Error, contentDescription = null, tint = palette.danger, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(err, color = palette.danger, fontSize = 12.sp, maxLines = 2, modifier = Modifier.weight(1f))
                            IconButton(onClick = { vm.chatErrorBanner = null }, modifier = Modifier.size(24.dp)) {
                                Icon(Icons.Rounded.Close, contentDescription = null, tint = palette.inkMuted, modifier = Modifier.size(15.dp))
                            }
                        }
                    }
                }

                vm.chatStatusBanner?.let { status ->
                    LiquidGlassSurface(
                        shape = CircleShape,
                        tint = palette.accent,
                        tintAlpha = 0.14f,
                        elevation = 3.dp,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp)
                        ) {
                            CircularProgressIndicator(strokeWidth = 1.8.dp, color = palette.accentStrong, modifier = Modifier.size(13.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(status, color = palette.accentStrong, fontSize = 12.sp, maxLines = 1, modifier = Modifier.weight(1f))
                            IconButton(onClick = { vm.chatStatusBanner = null }, modifier = Modifier.size(24.dp)) {
                                Icon(Icons.Rounded.Close, contentDescription = null, tint = palette.inkMuted, modifier = Modifier.size(15.dp))
                            }
                        }
                    }
                }

                if (vm.pendingAttachments.isNotEmpty() || vm.isUploadingFiles) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                    ) {
                        if (vm.isUploadingFiles) {
                            LiquidGlassSurface(shape = CircleShape, elevation = 2.dp) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                                ) {
                                    CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(12.dp))
                                    Spacer(Modifier.width(6.dp))
                                    Text(tr(lang, "上传中...", "Uploading..."), fontSize = 11.sp, color = palette.inkSecondary)
                                }
                            }
                        }
                        vm.pendingAttachments.forEach { file ->
                            LiquidGlassSurface(shape = CircleShape, elevation = 2.dp) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                                ) {
                                    Icon(Icons.Rounded.AttachFile, contentDescription = null, modifier = Modifier.size(13.dp), tint = palette.inkSecondary)
                                    Spacer(Modifier.width(4.dp))
                                    Text(file.name, fontSize = 11.sp, color = palette.inkPrimary, maxLines = 1)
                                    Spacer(Modifier.width(4.dp))
                                    Icon(
                                        imageVector = Icons.Rounded.Close,
                                        contentDescription = "Remove",
                                        tint = palette.inkMuted,
                                        modifier = Modifier
                                            .size(14.dp)
                                            .clickable { vm.removePendingAttachment(file) }
                                    )
                                }
                            }
                        }
                    }
                }

                if (vm.isRecordingVoice) {
                    InlineVoiceWaveformBar(
                        samples = vm.voiceWaveformSamples,
                        elapsedSeconds = vm.voiceElapsedSeconds,
                        onCancel = { vm.cancelVoiceRecording() },
                        onStopToDraft = { vm.finishVoiceRecording(sendImmediately = false) },
                        onStopAndSend = { vm.finishVoiceRecording(sendImmediately = true) }
                    )
                } else {
                    val trimmed = vm.composerText.trim()
                    val hasPayload = trimmed.isNotEmpty() || vm.pendingAttachments.isNotEmpty()
                    val canSend = if (vm.activeDesktopSession != null) {
                        trimmed.isNotEmpty() && vm.activeDesktopCanSend
                    } else {
                        hasPayload
                    }
                    val plusRotation by animateFloatAsState(
                        targetValue = if (showPlusMenu) 45f else 0f,
                        animationSpec = tween(220),
                        label = "plusRot"
                    )

                    LiquidGlassSurface(
                        shape = RoundedCornerShape(24.dp),
                        elevation = 10.dp,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 14.dp, vertical = 10.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.Bottom,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Box(modifier = Modifier.weight(1f).padding(vertical = 3.dp)) {
                                    if (vm.composerText.isEmpty()) {
                                        Text(
                                            text = tr(lang, "与 ${vm.identity.localizedName(lang)} 协作", "Collaborate with ${vm.identity.localizedName(lang)}"),
                                            color = palette.inkMuted,
                                            fontSize = 14.sp
                                        )
                                    }
                                    BasicTextField(
                                        value = vm.composerText,
                                        onValueChange = { vm.composerText = it },
                                        textStyle = TextStyle(color = palette.inkPrimary, fontSize = 14.sp, lineHeight = 20.sp),
                                        cursorBrush = SolidColor(palette.accentStrong),
                                        maxLines = 5,
                                        modifier = Modifier.fillMaxWidth()
                                    )
                                }
                                if (trimmed.isNotEmpty()) {
                                    IconButton(
                                        onClick = { vm.enhanceDraftPrompt() },
                                        enabled = !vm.isEnhancingPrompt,
                                        modifier = Modifier.size(30.dp)
                                    ) {
                                        if (vm.isEnhancingPrompt) {
                                            CircularProgressIndicator(strokeWidth = 2.dp, color = palette.accentStrong, modifier = Modifier.size(14.dp))
                                        } else {
                                            Icon(Icons.Rounded.AutoAwesome, contentDescription = "Enhance", tint = palette.accentStrong, modifier = Modifier.size(16.dp))
                                        }
                                    }
                                }
                            }

                            Spacer(Modifier.height(8.dp))

                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Surface(
                                    shape = CircleShape,
                                    color = palette.chipSurface,
                                    onClick = { showPlusMenu = !showPlusMenu },
                                    modifier = Modifier.size(32.dp)
                                ) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Icon(
                                            imageVector = Icons.Rounded.Add,
                                            contentDescription = "More",
                                            tint = palette.inkPrimary,
                                            modifier = Modifier.size(18.dp).rotate(plusRotation)
                                        )
                                    }
                                }

                                Spacer(Modifier.weight(1f))

                                Box {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier
                                            .clip(CircleShape)
                                            .clickable { showModelMenu = true }
                                            .padding(horizontal = 8.dp, vertical = 6.dp)
                                    ) {
                                        Text(
                                            text = vm.activeModelDisplayName,
                                            color = palette.inkSecondary,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Medium,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                            modifier = Modifier.widthIn(max = 136.dp)
                                        )
                                        Spacer(Modifier.width(3.dp))
                                        Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = null, tint = palette.inkMuted, modifier = Modifier.size(15.dp))
                                    }
                                    DropdownMenu(
                                        expanded = showModelMenu,
                                        onDismissRequest = { showModelMenu = false }
                                    ) {
                                        DropdownMenuItem(
                                            text = { Text(tr(lang, "默认模型", "Default")) },
                                            onClick = {
                                                vm.selectModel("")
                                                showModelMenu = false
                                            }
                                        )
                                        vm.models.forEach { m ->
                                            DropdownMenuItem(
                                                text = { Text(m.name) },
                                                onClick = {
                                                    vm.selectModel(m.id)
                                                    showModelMenu = false
                                                }
                                            )
                                        }
                                    }
                                }

                                Surface(
                                    shape = CircleShape,
                                    color = palette.chipSurface.copy(alpha = 0.55f),
                                    onClick = {
                                        showPlusMenu = false
                                        triggerVoiceRecording(voiceChat = false)
                                    },
                                    modifier = Modifier.size(34.dp)
                                ) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Icon(Icons.Rounded.MicNone, contentDescription = "Speech to text", tint = palette.inkPrimary, modifier = Modifier.size(19.dp))
                                    }
                                }

                                if (vm.isStreaming) {
                                    Surface(
                                        shape = CircleShape,
                                        color = palette.danger,
                                        onClick = { vm.stopStreaming() },
                                        modifier = Modifier.width(40.dp).height(34.dp)
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            Icon(Icons.Rounded.Stop, contentDescription = "Stop", tint = Color.White, modifier = Modifier.size(16.dp))
                                        }
                                    }
                                } else if (canSend) {
                                    Surface(
                                        shape = CircleShape,
                                        color = palette.accentStrong,
                                        onClick = {
                                            showPlusMenu = false
                                            vm.sendPrompt()
                                        },
                                        modifier = Modifier.width(40.dp).height(34.dp)
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            Icon(Icons.Rounded.ArrowUpward, contentDescription = "Send", tint = Color.White, modifier = Modifier.size(17.dp))
                                        }
                                    }
                                } else {
                                    Surface(
                                        shape = CircleShape,
                                        color = palette.accentStrong,
                                        onClick = {
                                            showPlusMenu = false
                                            triggerVoiceRecording(voiceChat = true)
                                        },
                                        modifier = Modifier.width(42.dp).height(34.dp)
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            Icon(Icons.Rounded.GraphicEq, contentDescription = "AI Voice Conversation", tint = Color.White, modifier = Modifier.size(17.dp))
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            androidx.compose.animation.AnimatedVisibility(
                visible = showPlusMenu,
                enter = fadeIn(tween(150)) + scaleIn(initialScale = 0.88f, transformOrigin = TransformOrigin(0f, 1f)),
                exit = fadeOut(tween(120)) + scaleOut(targetScale = 0.9f, transformOrigin = TransformOrigin(0f, 1f)),
                modifier = Modifier.padding(bottom = 104.dp)
            ) {
                LiquidGlassSurface(
                    shape = RoundedCornerShape(24.dp),
                    elevation = 14.dp,
                    modifier = Modifier.width(196.dp)
                ) {
                    Column(modifier = Modifier.padding(vertical = 8.dp, horizontal = 6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        PlusActionRow(
                            icon = Icons.Rounded.PhotoCamera,
                            title = tr(lang, "相机", "Camera")
                        ) {
                            showPlusMenu = false
                            launchCameraCapture()
                        }
                        PlusActionRow(
                            icon = Icons.Rounded.Image,
                            title = tr(lang, "照片", "Photos")
                        ) {
                            showPlusMenu = false
                            photoPickerLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        }
                        PlusActionRow(
                            icon = Icons.Rounded.AttachFile,
                            title = tr(lang, "文件", "Files")
                        ) {
                            showPlusMenu = false
                            filePickerLauncher.launch(arrayOf("*/*"))
                        }
                        PlusActionRow(
                            icon = Icons.Rounded.AlternateEmail,
                            title = tr(lang, "技能", "Skills")
                        ) {
                            showPlusMenu = false
                            vm.loadSkills()
                            showSkillsDialog = true
                        }
                        if (vm.currentSessionId != null && vm.messages.isNotEmpty()) {
                            HorizontalDivider(color = palette.hairLine, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
                            PlusActionRow(
                                icon = Icons.Rounded.Compress,
                                title = tr(lang, "压缩上下文", "Compact")
                            ) {
                                showPlusMenu = false
                                vm.compactCurrentSession()
                            }
                        }
                    }
                }
            }
        }
    }

    if (showSkillsDialog) {
        val filteredSkills = remember(vm.skills, skillSearch, lang) {
            val q = skillSearch.trim().lowercase()
            if (q.isEmpty()) vm.skills
            else vm.skills.filter {
                it.localizedName(lang).lowercase().contains(q) ||
                    it.localizedDescription(lang).lowercase().contains(q) ||
                    it.id.lowercase().contains(q)
            }
        }
        AlertDialog(
            onDismissRequest = { showSkillsDialog = false },
            title = { Text(tr(lang, "技能与能力", "Skills")) },
            text = {
                Column(modifier = Modifier.fillMaxWidth().heightIn(max = 380.dp)) {
                    OutlinedTextField(
                        value = skillSearch,
                        onValueChange = { skillSearch = it },
                        placeholder = { Text(tr(lang, "搜索技能...", "Search skills..."), fontSize = 12.sp) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(Modifier.height(10.dp))
                    if (filteredSkills.isEmpty()) {
                        Text(tr(lang, "暂无匹配技能", "No matching skills"), color = palette.inkMuted, fontSize = 12.sp)
                    } else {
                        Column(modifier = Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            filteredSkills.forEach { skill ->
                                Surface(
                                    shape = RoundedCornerShape(12.dp),
                                    color = palette.chipSurface,
                                    onClick = {
                                        vm.applySkill(skill)
                                        showSkillsDialog = false
                                    },
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) {
                                        Text("@${skill.localizedName(lang)}", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = palette.inkPrimary)
                                        val desc = skill.localizedDescription(lang)
                                        if (desc.isNotBlank()) {
                                            Text(desc, fontSize = 11.sp, color = palette.inkSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showSkillsDialog = false }) { Text(tr(lang, "关闭", "Close")) }
            }
        )
    }

    if (vm.isVoiceChatActive) {
        VoiceConversationDialog(vm = vm)
    }
}

@Composable
private fun PlusActionRow(
    icon: ImageVector,
    title: String,
    onClick: () -> Unit
) {
    val palette = LocalDragonClawPalette.current
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 7.dp)
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(34.dp)
                .background(palette.chipSurface, CircleShape)
        ) {
            Icon(icon, contentDescription = null, tint = palette.inkPrimary, modifier = Modifier.size(16.dp))
        }
        Spacer(Modifier.width(12.dp))
        Text(title, color = palette.inkPrimary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun InlineVoiceWaveformBar(
    samples: List<Float>,
    elapsedSeconds: Int,
    onCancel: () -> Unit,
    onStopToDraft: () -> Unit,
    onStopAndSend: () -> Unit
) {
    val palette = LocalDragonClawPalette.current
    LiquidGlassSurface(
        shape = CircleShape,
        elevation = 10.dp,
        modifier = Modifier
            .fillMaxWidth()
            .border(0.8.dp, palette.accentStrong.copy(alpha = 0.35f), CircleShape)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 8.dp)
        ) {
            Surface(
                shape = CircleShape,
                color = palette.chipSurface,
                onClick = onCancel,
                modifier = Modifier.size(34.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Close, contentDescription = "Cancel", tint = palette.inkPrimary, modifier = Modifier.size(16.dp))
                }
            }

            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(2.5.dp),
                modifier = Modifier.weight(1f).height(26.dp)
            ) {
                val count = samples.size
                samples.forEachIndexed { idx, level ->
                    val h by animateDpAsState(
                        targetValue = (3f + level * 21f).dp,
                        animationSpec = tween(durationMillis = 70),
                        label = "bar_$idx"
                    )
                    val color = if (idx >= count - 8) palette.inkPrimary else palette.inkMuted.copy(alpha = 0.6f)
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height(h)
                            .clip(CircleShape)
                            .background(color)
                    )
                }
            }

            val mins = elapsedSeconds / 60
            val secs = elapsedSeconds % 60
            Text(
                text = "%d:%02d".format(mins, secs),
                color = palette.inkMuted,
                fontSize = 11.sp,
                fontFamily = FontFamily.Monospace
            )

            Surface(
                shape = CircleShape,
                color = palette.chipSurface,
                onClick = onStopToDraft,
                modifier = Modifier.size(34.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Check, contentDescription = "Transcribe to draft", tint = palette.inkPrimary, modifier = Modifier.size(16.dp))
                }
            }

            Surface(
                shape = CircleShape,
                color = palette.accentStrong,
                onClick = onStopAndSend,
                modifier = Modifier.size(34.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.ArrowUpward, contentDescription = "Send Voice", tint = Color.White, modifier = Modifier.size(17.dp))
                }
            }
        }
    }
}

@Composable
private fun ChatBubbleItem(
    message: ChatMessage,
    language: String,
    onRetry: () -> Unit
) {
    val palette = LocalDragonClawPalette.current
    val clipboard = LocalClipboardManager.current
    var showThinking by remember { mutableStateOf(false) }
    var copied by remember { mutableStateOf(false) }

    if (message.isUser) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End
        ) {
            LiquidGlassSurface(
                shape = RoundedCornerShape(18.dp),
                tint = palette.accent,
                tintAlpha = 0.16f,
                elevation = 4.dp,
                modifier = Modifier.widthIn(max = 310.dp)
            ) {
                Text(
                    text = message.content,
                    color = palette.inkPrimary,
                    fontSize = 12.5.sp,
                    lineHeight = 17.5.sp,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                )
            }
        }
    } else {
        Column(
            modifier = Modifier.fillMaxWidth().padding(end = 4.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Image(
                    painter = painterResource(id = R.drawable.dragon_claw_avatar),
                    contentDescription = null,
                    modifier = Modifier.size(24.dp).clip(CircleShape)
                )
                Spacer(Modifier.width(8.dp))
                Text("Dragon Claw", color = palette.inkPrimary, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                if (!message.statusText.isNullOrBlank()) {
                    Spacer(Modifier.width(8.dp))
                    LiquidGlassSurface(shape = CircleShape, tint = palette.accent, tintAlpha = 0.12f, elevation = 2.dp) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 9.dp, vertical = 3.dp)
                        ) {
                            CircularProgressIndicator(strokeWidth = 1.8.dp, color = palette.accentStrong, modifier = Modifier.size(11.dp))
                            Spacer(Modifier.width(5.dp))
                            Text(message.statusText!!, color = palette.accentStrong, fontSize = 11.sp)
                        }
                    }
                } else if (message.isStreaming) {
                    Spacer(Modifier.width(8.dp))
                    CircularProgressIndicator(strokeWidth = 1.8.dp, color = palette.accentStrong, modifier = Modifier.size(12.dp))
                }
            }

            if (message.thinking.isNotEmpty()) {
                LiquidGlassSurface(
                    shape = RoundedCornerShape(14.dp),
                    elevation = 2.dp,
                    onClick = { showThinking = !showThinking },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.Psychology, contentDescription = null, tint = palette.accentStrong, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(6.dp))
                            Text(
                                text = tr(language, "思考过程 (${message.thinking.length} 字)", "Thinking Process"),
                                color = palette.inkSecondary,
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.weight(1f)
                            )
                            Icon(
                                imageVector = if (showThinking) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore,
                                contentDescription = null,
                                tint = palette.inkMuted,
                                modifier = Modifier.size(17.dp)
                            )
                        }
                        AnimatedVisibility(visible = showThinking) {
                            Text(
                                text = message.thinking,
                                color = palette.inkSecondary,
                                fontSize = 11.5.sp,
                                lineHeight = 16.5.sp,
                                modifier = Modifier.padding(top = 6.dp)
                            )
                        }
                    }
                }
            }

            if (message.toolCalls.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    message.toolCalls.forEach { trace ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(palette.elevatedSurface, RoundedCornerShape(12.dp))
                                .padding(horizontal = 10.dp, vertical = 7.dp)
                        ) {
                            if (trace.isFinished) {
                                Icon(
                                    imageVector = if (trace.ok) Icons.Rounded.CheckCircle else Icons.Rounded.Error,
                                    contentDescription = null,
                                    tint = if (trace.ok) palette.accentStrong else palette.danger,
                                    modifier = Modifier.size(15.dp)
                                )
                            } else {
                                CircularProgressIndicator(strokeWidth = 1.8.dp, modifier = Modifier.size(13.dp))
                            }
                            Spacer(Modifier.width(8.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(trace.toolName, color = palette.inkPrimary, fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold)
                                val detail = trace.summary.ifBlank { trace.argsSummary }
                                if (detail.isNotBlank()) {
                                    Text(detail, color = palette.inkMuted, fontSize = 10.5.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                }
                            }
                            trace.durationMs?.let { ms ->
                                Text("${ms}ms", color = palette.inkMuted, fontSize = 10.sp, fontFamily = FontFamily.Monospace)
                            }
                        }
                    }
                }
            }

            if (message.content.isNotEmpty()) {
                LiquidGlassSurface(
                    shape = RoundedCornerShape(18.dp),
                    elevation = 4.dp,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    FormattedResponseContent(
                        text = message.content,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp)
                    )
                }
            }

            if (!message.isStreaming) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    LiquidGlassSurface(
                        shape = CircleShape,
                        elevation = 2.dp,
                        onClick = {
                            clipboard.setText(AnnotatedString(message.content))
                            copied = true
                        }
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                        ) {
                            Icon(if (copied) Icons.Rounded.Check else Icons.Rounded.ContentCopy, contentDescription = null, modifier = Modifier.size(12.dp), tint = palette.inkSecondary)
                            Spacer(Modifier.width(4.dp))
                            Text(if (copied) tr(language, "已复制", "Copied") else tr(language, "复制", "Copy"), fontSize = 11.sp, color = palette.inkSecondary)
                        }
                    }
                    LiquidGlassSurface(
                        shape = CircleShape,
                        elevation = 2.dp,
                        onClick = onRetry
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp)
                        ) {
                            Icon(Icons.Rounded.Refresh, contentDescription = null, modifier = Modifier.size(12.dp), tint = palette.inkSecondary)
                            Spacer(Modifier.width(4.dp))
                            Text(tr(language, "重试", "Retry"), fontSize = 11.sp, color = palette.inkSecondary)
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    message.modelName?.takeIf { it.isNotBlank() }?.let {
                        Text(it, color = palette.inkMuted, fontSize = 11.sp)
                    }
                    message.outputTokens?.let {
                        Text("${it} tok", color = palette.inkMuted, fontSize = 11.sp, fontFamily = FontFamily.Monospace)
                    }
                }
            }
        }
    }
}

@Composable
private fun FormattedResponseContent(text: String, modifier: Modifier = Modifier) {
    val palette = LocalDragonClawPalette.current
    val clipboard = LocalClipboardManager.current
    val blocks = remember(text) { MarkdownParser.parse(text) }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(9.dp)) {
        if (blocks.isEmpty() && text.isNotEmpty()) {
            SelectionContainer {
                Text(
                    text = text,
                    color = palette.inkPrimary,
                    fontSize = 14.5.sp,
                    lineHeight = 22.sp
                )
            }
        } else {
            blocks.forEachIndexed { index, block ->
                MdBlockItemView(
                    block = block,
                    isFirst = index == 0,
                    palette = palette,
                    onCopyCode = { code -> clipboard.setText(AnnotatedString(code)) }
                )
            }
        }
    }
}

@Composable
private fun MdBlockItemView(
    block: MdBlock,
    isFirst: Boolean,
    palette: DragonClawPalette,
    onCopyCode: (String) -> Unit
) {
    when (block.kind) {
        MdBlockKind.HEADING -> {
            val fontSize = when (block.level) {
                1 -> 18.sp
                2 -> 16.5.sp
                3 -> 15.5.sp
                else -> 14.5.sp
            }
            val lineHeight = when (block.level) {
                1 -> 25.sp
                2 -> 23.sp
                else -> 22.sp
            }
            MdSpanText(
                spans = block.spans,
                baseSizeSp = fontSize.value,
                lineHeightSp = lineHeight.value,
                forceBold = true,
                palette = palette,
                modifier = Modifier.padding(top = if (isFirst) 0.dp else 5.dp)
            )
        }

        MdBlockKind.PARAGRAPH -> {
            MdSpanText(
                spans = block.spans,
                baseSizeSp = 14.5f,
                lineHeightSp = 22f,
                forceBold = false,
                palette = palette
            )
        }

        MdBlockKind.BULLET_ITEM -> {
            val indentDp = (block.level * 15).dp
            val bulletGlyph = when (block.level) {
                0 -> "•"
                1 -> "◦"
                else -> "▪"
            }
            Row(
                verticalAlignment = Alignment.Top,
                modifier = Modifier.fillMaxWidth().padding(start = indentDp)
            ) {
                Text(
                    text = bulletGlyph,
                    color = if (block.level == 0) palette.inkPrimary else palette.inkSecondary,
                    fontSize = 14.5.sp,
                    lineHeight = 22.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.width(16.dp)
                )
                MdSpanText(
                    spans = block.spans,
                    baseSizeSp = 14.5f,
                    lineHeightSp = 22f,
                    forceBold = false,
                    palette = palette,
                    modifier = Modifier.weight(1f)
                )
            }
        }

        MdBlockKind.ORDERED_ITEM -> {
            val indentDp = (block.level * 15).dp
            Row(
                verticalAlignment = Alignment.Top,
                modifier = Modifier.fillMaxWidth().padding(start = indentDp)
            ) {
                Text(
                    text = block.marker,
                    color = palette.inkPrimary,
                    fontSize = 14.5.sp,
                    lineHeight = 22.sp,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.widthIn(min = 24.dp).padding(end = 6.dp)
                )
                MdSpanText(
                    spans = block.spans,
                    baseSizeSp = 14.5f,
                    lineHeightSp = 22f,
                    forceBold = false,
                    palette = palette,
                    modifier = Modifier.weight(1f)
                )
            }
        }

        MdBlockKind.BLOCKQUOTE -> {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(palette.elevatedSurface.copy(alpha = 0.7f), RoundedCornerShape(10.dp))
                    .padding(horizontal = 10.dp, vertical = 8.dp)
            ) {
                Box(
                    modifier = Modifier
                        .width(3.dp)
                        .heightIn(min = 20.dp)
                        .background(palette.accentStrong.copy(alpha = 0.85f), RoundedCornerShape(2.dp))
                )
                Spacer(Modifier.width(10.dp))
                MdSpanText(
                    spans = block.spans,
                    baseSizeSp = 14f,
                    lineHeightSp = 21f,
                    forceBold = false,
                    palette = palette,
                    modifier = Modifier.weight(1f)
                )
            }
        }

        MdBlockKind.DIVIDER -> {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 4.dp)
                    .height(1.dp)
                    .background(palette.hairLine)
            )
        }

        MdBlockKind.CODE_BLOCK -> {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(palette.elevatedSurface, RoundedCornerShape(12.dp))
                    .border(0.75.dp, palette.hairLine, RoundedCornerShape(12.dp))
                    .clip(RoundedCornerShape(12.dp))
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(palette.hairLine)
                        .padding(horizontal = 11.dp, vertical = 6.dp)
                ) {
                    Text(
                        text = block.codeLanguage.ifBlank { "CODE" }.uppercase(),
                        color = palette.inkMuted,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f)
                    )
                    Icon(
                        imageVector = Icons.Rounded.ContentCopy,
                        contentDescription = "Copy code",
                        tint = palette.inkSecondary,
                        modifier = Modifier
                            .size(14.dp)
                            .clickable { onCopyCode(block.codeText) }
                    )
                }
                Box(modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
                    SelectionContainer {
                        Text(
                            text = block.codeText,
                            color = palette.inkPrimary,
                            fontSize = 12.sp,
                            lineHeight = 17.sp,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.padding(11.dp)
                        )
                    }
                }
            }
        }

        MdBlockKind.TABLE -> {
            val hScroll = rememberScrollState()
            Column(
                modifier = Modifier
                    .horizontalScroll(hScroll)
                    .background(palette.elevatedSurface.copy(alpha = 0.7f), RoundedCornerShape(10.dp))
                    .border(0.75.dp, palette.hairLine, RoundedCornerShape(10.dp))
                    .clip(RoundedCornerShape(10.dp))
            ) {
                block.tableRows.forEachIndexed { rIdx, row ->
                    Row(
                        modifier = Modifier
                            .background(if (rIdx == 0) palette.hairLine.copy(alpha = 0.65f) else Color.Transparent)
                    ) {
                        row.forEach { cellSpans ->
                            MdSpanText(
                                spans = cellSpans,
                                baseSizeSp = 13f,
                                lineHeightSp = 18.5f,
                                forceBold = rIdx == 0,
                                palette = palette,
                                modifier = Modifier
                                    .widthIn(min = 90.dp, max = 210.dp)
                                    .padding(horizontal = 10.dp, vertical = 7.dp)
                            )
                        }
                    }
                    if (rIdx < block.tableRows.lastIndex) {
                        Box(modifier = Modifier.fillMaxWidth().height(0.75.dp).background(palette.hairLine))
                    }
                }
            }
        }
    }
}

@Suppress("DEPRECATION")
@Composable
private fun MdSpanText(
    spans: List<MdSpan>,
    baseSizeSp: Float,
    lineHeightSp: Float,
    forceBold: Boolean,
    palette: DragonClawPalette,
    modifier: Modifier = Modifier
) {
    val uriHandler = LocalUriHandler.current
    val hasWebLinks = remember(spans) { spans.any { it.kind == MdSpanKind.WEB_LINK && !it.url.isNullOrBlank() } }
    val annotated = remember(spans, baseSizeSp, forceBold, palette) {
        buildMdAnnotatedString(spans, baseSizeSp, forceBold, palette)
    }
    val textStyle = TextStyle(
        color = palette.inkPrimary,
        fontSize = baseSizeSp.sp,
        lineHeight = lineHeightSp.sp
    )

    if (hasWebLinks) {
        ClickableText(
            text = annotated,
            style = textStyle,
            modifier = modifier,
            onClick = { offset ->
                annotated.getStringAnnotations(tag = "URL", start = offset, end = offset)
                    .firstOrNull()?.let { range ->
                        runCatching { uriHandler.openUri(range.item) }
                    }
            }
        )
    } else {
        SelectionContainer(modifier = modifier) {
            Text(text = annotated, style = textStyle)
        }
    }
}

private fun buildMdAnnotatedString(
    spans: List<MdSpan>,
    baseSizeSp: Float,
    forceBold: Boolean,
    palette: DragonClawPalette
): AnnotatedString = buildAnnotatedString {
    val codeBg = if (palette.isDark) Color(0xFF2E3340) else Color(0xFFE7EDF4)
    val chipBg = if (palette.isDark) Color(0xFF1D293B) else Color(0xFFE5EFFC)
    val chipFg = if (palette.isDark) Color(0xFF9AC5FF) else Color(0xFF1656AD)
    val codeFg = if (palette.isDark) Color(0xFFE5ECF6) else Color(0xFF1E2D3D)

    spans.forEach { span ->
        val bold = forceBold || span.isBold || span.kind == MdSpanKind.BOLD
        val fontStyle = if (span.isItalic || span.kind == MdSpanKind.ITALIC) FontStyle.Italic else FontStyle.Normal
        when (span.kind) {
            MdSpanKind.CODE -> {
                withStyle(
                    SpanStyle(
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Medium,
                        fontSize = (baseSizeSp - 1.2f).coerceAtLeast(11.5f).sp,
                        color = codeFg,
                        background = codeBg
                    )
                ) {
                    append("\u202F${span.text}\u202F")
                }
            }

            MdSpanKind.SYMBOL_CHIP -> {
                val badge = span.badge
                if (!badge.isNullOrEmpty()) {
                    val badgeTint = when (badge) {
                        "PY" -> Color(0xFF2EA969)
                        "JS", "TS" -> Color(0xFFD69A1F)
                        "KT", "SW" -> Color(0xFFDE663B)
                        else -> palette.accentStrong
                    }
                    withStyle(
                        SpanStyle(
                            fontFamily = FontFamily.Monospace,
                            fontWeight = FontWeight.Bold,
                            fontSize = (baseSizeSp - 3.5f).coerceAtLeast(9.5f).sp,
                            color = badgeTint,
                            background = chipBg
                        )
                    ) {
                        append("\u202F$badge ")
                    }
                } else {
                    withStyle(SpanStyle(background = chipBg)) {
                        append("\u202F")
                    }
                }
                withStyle(
                    SpanStyle(
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = (baseSizeSp - 1.2f).coerceAtLeast(11.5f).sp,
                        color = chipFg,
                        background = chipBg
                    )
                ) {
                    append("${span.text}\u202F")
                }
            }

            MdSpanKind.WEB_LINK -> {
                val url = span.url.orEmpty()
                if (url.isNotBlank()) pushStringAnnotation(tag = "URL", annotation = url)
                withStyle(
                    SpanStyle(
                        color = palette.accentStrong,
                        fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Medium,
                        fontStyle = fontStyle,
                        textDecoration = TextDecoration.Underline
                    )
                ) {
                    append(span.text)
                }
                if (url.isNotBlank()) pop()
            }

            MdSpanKind.PLAIN, MdSpanKind.BOLD, MdSpanKind.ITALIC -> {
                withStyle(
                    SpanStyle(
                        color = palette.inkPrimary,
                        fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
                        fontStyle = fontStyle
                    )
                ) {
                    append(span.text)
                }
            }
        }
    }
}

@Composable
private fun ChatShimmerSkeleton(modifier: Modifier = Modifier) {
    val palette = LocalDragonClawPalette.current
    val transition = rememberInfiniteTransition(label = "chatShimmer")
    val shift by transition.animateFloat(
        initialValue = -320f,
        targetValue = 980f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1250, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "shimmerShift"
    )
    val baseColor = palette.inkMuted.copy(alpha = if (palette.isDark) 0.22f else 0.14f)
    val highlightColor = Color.White.copy(alpha = if (palette.isDark) 0.22f else 0.70f)
    val shimmerBrush = Brush.linearGradient(
        colors = listOf(baseColor, highlightColor, baseColor),
        start = Offset(shift - 220f, 0f),
        end = Offset(shift + 220f, 180f)
    )

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Box(
                modifier = Modifier
                    .width(172.dp)
                    .height(40.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(shimmerBrush)
            )
        }
        AssistantSkeletonCard(shimmerBrush, listOf(0.92f, 0.78f, 0.54f))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Box(
                modifier = Modifier
                    .width(134.dp)
                    .height(36.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(shimmerBrush)
            )
        }
        AssistantSkeletonCard(shimmerBrush, listOf(0.86f, 0.62f))
    }
}

@Composable
private fun AssistantSkeletonCard(shimmerBrush: Brush, lineRatios: List<Float>) {
    Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(
            modifier = Modifier
                .size(28.dp)
                .clip(CircleShape)
                .background(shimmerBrush)
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Box(
                modifier = Modifier
                    .width(92.dp)
                    .height(12.dp)
                    .clip(RoundedCornerShape(6.dp))
                    .background(shimmerBrush)
            )
            LiquidGlassSurface(shape = RoundedCornerShape(18.dp), elevation = 2.dp) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(9.dp)
                ) {
                    lineRatios.forEach { ratio ->
                        Box(
                            modifier = Modifier
                                .fillMaxWidth(ratio)
                                .height(14.dp)
                                .clip(RoundedCornerShape(7.dp))
                                .background(shimmerBrush)
                        )
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(modifier = Modifier.width(64.dp).height(26.dp).clip(CircleShape).background(shimmerBrush))
                Box(modifier = Modifier.width(64.dp).height(26.dp).clip(CircleShape).background(shimmerBrush))
            }
        }
    }
}

@Composable
private fun VoiceConversationDialog(vm: DragonClawViewModel) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language
    val phase = vm.voiceChatPhase

    val liveAssistantText = remember(vm.messages.lastOrNull()?.content, vm.voiceChatAssistantTranscript, phase) {
        val lastModel = vm.messages.lastOrNull()?.takeIf { !it.isUser }?.content.orEmpty()
        if ((phase == VoiceChatPhase.THINKING || phase == VoiceChatPhase.SPEAKING) && lastModel.isNotBlank()) {
            MarkdownParser.toSpeechText(lastModel).ifBlank { lastModel }
        } else {
            vm.voiceChatAssistantTranscript
        }
    }

    val statusTitle = when (phase) {
        VoiceChatPhase.LISTENING ->
            if (vm.voiceChatHasSpeech) tr(lang, "正在听你说话…", "Listening to you...")
            else tr(lang, "请开始说话", "Speak anytime")
        VoiceChatPhase.TRANSCRIBING -> tr(lang, "正在识别语音…", "Transcribing speech...")
        VoiceChatPhase.THINKING -> tr(lang, "AI 正在思考…", "Dragon Claw is thinking...")
        VoiceChatPhase.SPEAKING -> tr(lang, "正在语音回复…", "Speaking...")
        VoiceChatPhase.PAUSED, VoiceChatPhase.IDLE -> tr(lang, "语音对话已暂停", "Voice chat paused")
    }

    val pulseTransition = rememberInfiniteTransition(label = "voiceOrbPulse")
    val pulseScale by pulseTransition.animateFloat(
        initialValue = 0.96f,
        targetValue = 1.12f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 900),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseScale"
    )
    val animatedMicScale by animateFloatAsState(
        targetValue = 0.94f + vm.voiceChatAudioLevel * 0.34f,
        animationSpec = tween(durationMillis = 110),
        label = "micOrbScale"
    )
    val orbScale = when (phase) {
        VoiceChatPhase.LISTENING -> animatedMicScale
        VoiceChatPhase.SPEAKING, VoiceChatPhase.THINKING -> pulseScale
        VoiceChatPhase.TRANSCRIBING -> 1.03f
        VoiceChatPhase.PAUSED, VoiceChatPhase.IDLE -> 0.92f
    }

    Dialog(
        onDismissRequest = { vm.endVoiceConversation() },
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        DragonClawBackdrop {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .navigationBarsPadding()
                    .padding(horizontal = 20.dp, vertical = 14.dp)
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    LiquidGlassSurface(shape = CircleShape, elevation = 3.dp) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(if (phase == VoiceChatPhase.PAUSED) palette.inkMuted else palette.accentStrong)
                            )
                            Spacer(Modifier.width(7.dp))
                            Text(
                                text = vm.activeModelDisplayName,
                                color = palette.inkPrimary,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.widthIn(max = 180.dp)
                            )
                        }
                    }

                    Spacer(Modifier.weight(1f))

                    LiquidGlassSurface(
                        shape = CircleShape,
                        elevation = 3.dp,
                        onClick = { vm.toggleVoiceChatMute() },
                        modifier = Modifier.size(38.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = if (vm.isVoiceChatSpeechMuted) Icons.AutoMirrored.Rounded.VolumeOff else Icons.AutoMirrored.Rounded.VolumeUp,
                                contentDescription = "Toggle speech audio",
                                tint = if (vm.isVoiceChatSpeechMuted) palette.inkMuted else palette.accentStrong,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }

                Spacer(Modifier.weight(1f))

                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.size(220.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(210.dp)
                            .scale(orbScale * 1.12f)
                            .clip(CircleShape)
                            .background(
                                Brush.radialGradient(
                                    colors = listOf(
                                        palette.accent.copy(alpha = 0.28f),
                                        palette.accentStrong.copy(alpha = 0.03f)
                                    )
                                )
                            )
                    )
                    Surface(
                        shape = CircleShape,
                        color = palette.accentStrong,
                        shadowElevation = 14.dp,
                        onClick = {
                            when (phase) {
                                VoiceChatPhase.SPEAKING, VoiceChatPhase.THINKING -> vm.interruptAndListenInVoiceChat()
                                VoiceChatPhase.LISTENING -> vm.submitVoiceConversationTurn()
                                else -> vm.toggleVoiceChatPause()
                            }
                        },
                        modifier = Modifier
                            .size(132.dp)
                            .scale(orbScale)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Image(
                                painter = painterResource(id = R.drawable.dragon_claw_avatar),
                                contentDescription = "Dragon Claw Voice Orb",
                                modifier = Modifier
                                    .size(92.dp)
                                    .clip(CircleShape)
                            )
                        }
                    }
                }

                Spacer(Modifier.height(14.dp))

                Text(
                    text = statusTitle,
                    color = palette.inkPrimary,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(4.dp))
                val hint = when (phase) {
                    VoiceChatPhase.LISTENING -> tr(lang, "说完停顿 1.4 秒自动发送，也可点击下方发送", "Pauses auto-send after 1.4s, or tap Send")
                    VoiceChatPhase.SPEAKING, VoiceChatPhase.THINKING -> tr(lang, "轻触龙爪头像可随时打断插话", "Tap avatar anytime to interrupt")
                    else -> ""
                }
                if (hint.isNotEmpty()) {
                    Text(text = hint, color = palette.inkMuted, fontSize = 11.5.sp, textAlign = TextAlign.Center)
                }

                Spacer(Modifier.height(16.dp))

                Column(
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 210.dp)
                        .verticalScroll(rememberScrollState())
                ) {
                    vm.voiceChatErrorText?.takeIf { it.isNotBlank() }?.let { err ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(palette.danger.copy(alpha = 0.10f), RoundedCornerShape(12.dp))
                                .padding(10.dp)
                        ) {
                            Icon(Icons.Rounded.Warning, contentDescription = null, tint = palette.danger, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(err, color = palette.danger, fontSize = 12.sp)
                        }
                    }

                    if (vm.voiceChatUserTranscript.isNotBlank()) {
                        LiquidGlassSurface(
                            shape = RoundedCornerShape(16.dp),
                            tint = palette.accent,
                            tintAlpha = 0.10f,
                            elevation = 2.dp,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text(tr(lang, "你", "You"), color = palette.accentStrong, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                Spacer(Modifier.height(3.dp))
                                Text(vm.voiceChatUserTranscript, color = palette.inkPrimary, fontSize = 14.sp, lineHeight = 20.sp)
                            }
                        }
                    }

                    if (liveAssistantText.isNotBlank()) {
                        LiquidGlassSurface(
                            shape = RoundedCornerShape(16.dp),
                            elevation = 2.dp,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Column(modifier = Modifier.padding(12.dp)) {
                                Text("Dragon Claw", color = palette.inkMuted, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                Spacer(Modifier.height(3.dp))
                                Text(liveAssistantText, color = palette.inkPrimary, fontSize = 14.sp, lineHeight = 21.sp)
                            }
                        }
                    }
                }

                Spacer(Modifier.weight(1f))

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(24.dp),
                    modifier = Modifier.padding(bottom = 18.dp)
                ) {
                    LiquidGlassSurface(
                        shape = CircleShape,
                        elevation = 4.dp,
                        onClick = { vm.toggleVoiceChatPause() },
                        modifier = Modifier.size(56.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                imageVector = if (phase == VoiceChatPhase.PAUSED) Icons.Rounded.Mic else Icons.Rounded.Pause,
                                contentDescription = "Pause or resume",
                                tint = palette.inkPrimary,
                                modifier = Modifier.size(22.dp)
                            )
                        }
                    }

                    when (phase) {
                        VoiceChatPhase.LISTENING -> {
                            Surface(
                                shape = CircleShape,
                                color = palette.accentStrong,
                                onClick = { vm.submitVoiceConversationTurn() },
                                modifier = Modifier.size(66.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(Icons.Rounded.ArrowUpward, contentDescription = "Send speech", tint = Color.White, modifier = Modifier.size(24.dp))
                                }
                            }
                        }
                        VoiceChatPhase.SPEAKING, VoiceChatPhase.THINKING -> {
                            Surface(
                                shape = CircleShape,
                                color = palette.accentStrong,
                                onClick = { vm.interruptAndListenInVoiceChat() },
                                modifier = Modifier.size(66.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Icon(Icons.Rounded.FrontHand, contentDescription = "Interrupt", tint = Color.White, modifier = Modifier.size(24.dp))
                                }
                            }
                        }
                        else -> {
                            LiquidGlassSurface(shape = CircleShape, elevation = 4.dp, modifier = Modifier.size(66.dp)) {
                                Box(contentAlignment = Alignment.Center) {
                                    CircularProgressIndicator(strokeWidth = 2.5.dp, color = palette.accentStrong, modifier = Modifier.size(24.dp))
                                }
                            }
                        }
                    }

                    Surface(
                        shape = CircleShape,
                        color = palette.danger,
                        onClick = { vm.endVoiceConversation() },
                        modifier = Modifier.size(56.dp)
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(Icons.Rounded.Close, contentDescription = "End voice call", tint = Color.White, modifier = Modifier.size(22.dp))
                        }
                    }
                }
            }
        }
    }
}
