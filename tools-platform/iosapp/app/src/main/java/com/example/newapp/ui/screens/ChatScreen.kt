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
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.newapp.R
import com.example.newapp.shared.model.AgentSkillItem
import com.example.newapp.shared.model.ChatMessage
import com.example.newapp.state.DragonClawViewModel
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
        if (granted) {
            vm.startVoiceRecording(context)
        } else {
            vm.chatErrorBanner = tr(lang, "请在系统设置中允许麦克风权限以使用语音输入", "Microphone permission is required")
        }
    }

    fun triggerVoiceRecording() {
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            vm.startVoiceRecording(context)
        } else {
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
            if (vm.messages.isEmpty()) {
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
                            Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
                                CircularProgressIndicator(color = palette.accentStrong, strokeWidth = 2.dp)
                            }
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
                    val canSend = trimmed.isNotEmpty() || vm.pendingAttachments.isNotEmpty()
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
                                            modifier = Modifier.widthIn(max = 128.dp)
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

                                IconButton(
                                    onClick = {
                                        showPlusMenu = false
                                        triggerVoiceRecording()
                                    },
                                    modifier = Modifier.size(32.dp)
                                ) {
                                    Icon(Icons.Rounded.MicNone, contentDescription = "Voice", tint = palette.inkPrimary, modifier = Modifier.size(19.dp))
                                }

                                if (vm.isStreaming) {
                                    Surface(
                                        shape = CircleShape,
                                        color = palette.danger,
                                        onClick = { vm.stopStreaming() },
                                        modifier = Modifier.width(40.dp).height(32.dp)
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
                                        modifier = Modifier.width(40.dp).height(32.dp)
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
                                            triggerVoiceRecording()
                                        },
                                        modifier = Modifier.width(42.dp).height(32.dp)
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            Icon(Icons.Rounded.GraphicEq, contentDescription = "Voice Bar", tint = Color.White, modifier = Modifier.size(17.dp))
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
                    Icon(Icons.Rounded.Stop, contentDescription = "Transcribe", tint = palette.inkPrimary, modifier = Modifier.size(15.dp))
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
            modifier = Modifier.fillMaxWidth().padding(end = 16.dp),
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
                        modifier = Modifier.padding(12.dp)
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
    val sections = remember(text) { splitMarkdownCodeSections(text) }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        sections.forEach { (isCode, headerOrText, body) ->
            if (!isCode) {
                val formatted = remember(headerOrText, palette) {
                    buildInlineMarkdownAnnotatedString(headerOrText, palette)
                }
                Text(
                    text = formatted,
                    color = palette.inkPrimary,
                    fontSize = 12.5.sp,
                    lineHeight = 17.5.sp
                )
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(palette.elevatedSurface, RoundedCornerShape(10.dp))
                        .border(0.75.dp, palette.hairLine, RoundedCornerShape(10.dp))
                ) {
                    Text(
                        text = headerOrText.ifBlank { "CODE" }.uppercase(),
                        color = palette.inkMuted,
                        fontSize = 9.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(palette.hairLine)
                            .padding(horizontal = 9.dp, vertical = 4.dp)
                    )
                    Text(
                        text = body,
                        color = palette.inkPrimary,
                        fontSize = 10.5.sp,
                        lineHeight = 14.5.sp,
                        fontFamily = FontFamily.Monospace,
                        softWrap = true,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(9.dp)
                    )
                }
            }
        }
    }
}

private fun buildInlineMarkdownAnnotatedString(
    raw: String,
    palette: DragonClawPalette
): AnnotatedString = buildAnnotatedString {
    val lines = raw.lines()
    lines.forEachIndexed { lineIdx, rawLine ->
        val trimmed = rawLine.trimStart()
        val isHeading = trimmed.startsWith("### ") || trimmed.startsWith("## ") || trimmed.startsWith("# ") || trimmed.startsWith("#### ")
        val line = when {
            trimmed.startsWith("#### ") -> trimmed.drop(5)
            trimmed.startsWith("### ") -> trimmed.drop(4)
            trimmed.startsWith("## ") -> trimmed.drop(3)
            trimmed.startsWith("# ") -> trimmed.drop(2)
            rawLine.startsWith("- ") -> "• ${rawLine.drop(2)}"
            else -> rawLine
        }
        val lineStart = length
        var i = 0
        while (i < line.length) {
            when {
                line.startsWith("**", i) -> {
                    val close = line.indexOf("**", i + 2)
                    if (close > i + 2) {
                        val inner = line.substring(i + 2, close).replace("`", "")
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold, color = palette.inkPrimary)) {
                            append(inner)
                        }
                        i = close + 2
                    } else {
                        append(line[i])
                        i++
                    }
                }
                line[i] == '`' -> {
                    val close = line.indexOf('`', i + 1)
                    if (close > i + 1) {
                        withStyle(
                            SpanStyle(
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.SemiBold,
                                color = palette.accentStrong,
                                background = palette.accent.copy(alpha = 0.12f)
                            )
                        ) {
                            append(" ${line.substring(i + 1, close)} ")
                        }
                        i = close + 1
                    } else {
                        append(line[i])
                        i++
                    }
                }
                else -> {
                    append(line[i])
                    i++
                }
            }
        }
        if (isHeading && length > lineStart) {
            addStyle(SpanStyle(fontWeight = FontWeight.Bold, fontSize = 13.5.sp, color = palette.inkPrimary), lineStart, length)
        }
        if (lineIdx < lines.lastIndex) append('\n')
    }
}

private fun splitMarkdownCodeSections(raw: String): List<Triple<Boolean, String, String>> {
    val result = mutableListOf<Triple<Boolean, String, String>>()
    val textBuf = mutableListOf<String>()
    val codeBuf = mutableListOf<String>()
    var inCode = false
    var lang = ""

    fun flushText() {
        val t = textBuf.joinToString("\n").trim()
        if (t.isNotEmpty()) result.add(Triple(false, t, ""))
        textBuf.clear()
    }

    fun flushCode() {
        result.add(Triple(true, lang, codeBuf.joinToString("\n")))
        codeBuf.clear()
        lang = ""
    }

    raw.lines().forEach { line ->
        val trimmed = line.trim()
        if (trimmed.startsWith("```")) {
            if (inCode) {
                flushCode()
                inCode = false
            } else {
                flushText()
                lang = trimmed.removePrefix("```").trim()
                inCode = true
            }
        } else if (inCode) {
            codeBuf.add(line)
        } else {
            textBuf.add(line)
        }
    }
    if (inCode) flushCode() else flushText()
    return result
}
