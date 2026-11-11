package com.example.newapp.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.newapp.R
import com.example.newapp.state.DragonClawViewModel
import com.example.newapp.ui.components.DragonClawBackdrop
import com.example.newapp.ui.components.GlassCircleIconButton
import com.example.newapp.ui.components.LiquidGlassSurface
import com.example.newapp.ui.theme.LocalDragonClawPalette
import com.example.newapp.ui.theme.tr

@Composable
fun LoginScreen(vm: DragonClawViewModel) {
    val palette = LocalDragonClawPalette.current
    val lang = vm.language

    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current

    var username by remember { mutableStateOf(vm.sdk.getSavedUsername()) }
    var password by remember { mutableStateOf(vm.sdk.getSavedPassword()) }
    var rememberMe by remember { mutableStateOf(vm.rememberMe) }
    var autoLogin by remember { mutableStateOf(vm.autoLogin) }
    var showPassword by remember { mutableStateOf(false) }
    var showServerDialog by remember { mutableStateOf(false) }
    var serverDraft by remember { mutableStateOf(vm.baseUrl) }

    DragonClawBackdrop {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures(onTap = {
                        focusManager.clearFocus()
                        keyboardController?.hide()
                    })
                }
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .navigationBarsPadding()
                    .imePadding()
                    .padding(horizontal = 20.dp, vertical = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    GlassCircleIconButton(
                        icon = if (vm.isDark) Icons.Rounded.LightMode else Icons.Rounded.DarkMode,
                        contentDescription = tr(lang, "切换主题", "Toggle theme"),
                        onClick = { vm.toggleTheme() }
                    )
                    Spacer(Modifier.width(8.dp))
                    LiquidGlassSurface(
                        shape = RoundedCornerShape(50),
                        elevation = 4.dp,
                        onClick = { vm.toggleLanguage() }
                    ) {
                        Text(
                            text = if (lang == "zh") "EN" else "中文",
                            color = palette.inkPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 9.dp)
                        )
                    }
                    Spacer(Modifier.width(8.dp))
                    GlassCircleIconButton(
                        icon = Icons.Rounded.Dns,
                        contentDescription = tr(lang, "服务器设置", "Server config"),
                        onClick = {
                            serverDraft = vm.baseUrl
                            showServerDialog = true
                        }
                    )
                }

                Column(
                    modifier = Modifier.widthIn(max = 520.dp).fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    LiquidGlassSurface(
                        modifier = Modifier.size(76.dp),
                        shape = RoundedCornerShape(22.dp),
                        elevation = 8.dp
                    ) {
                        Image(
                            painter = painterResource(id = R.drawable.dragon_claw_mascot),
                            contentDescription = "Dragon Claw",
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(6.dp)
                                .clip(RoundedCornerShape(18.dp))
                        )
                    }

                    Spacer(Modifier.height(10.dp))
                    Text(
                        text = vm.identity.localizedName(lang),
                        color = palette.inkPrimary,
                        fontSize = 23.sp,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = vm.identity.localizedSubtitle(lang),
                        color = palette.inkSecondary,
                        fontSize = 12.5.sp,
                        fontWeight = FontWeight.Medium
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = vm.identity.localizedSlogan(lang),
                        color = palette.inkMuted,
                        fontSize = 11.sp,
                        textAlign = TextAlign.Center
                    )

                    Spacer(Modifier.height(14.dp))

                    LiquidGlassSurface(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(24.dp),
                        elevation = 10.dp
                    ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(20.dp)
                ) {
                    Text(
                        text = tr(lang, "账号登录", "Sign In"),
                        color = palette.inkPrimary,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = tr(lang, "登录后可使用 Dragon Claw 智能助手、工作台工具与 KPI 监控", "Access Dragon Claw AI workspace, hosted tools & KPI monitor"),
                        color = palette.inkMuted,
                        fontSize = 11.5.sp,
                        lineHeight = 16.sp,
                        modifier = Modifier.padding(top = 3.dp)
                    )

                    Spacer(Modifier.height(16.dp))

                    val fieldColors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = palette.accent,
                        unfocusedBorderColor = palette.hairLine,
                        focusedContainerColor = palette.chipSurface.copy(alpha = if (palette.isDark) 0.55f else 0.72f),
                        unfocusedContainerColor = palette.chipSurface.copy(alpha = if (palette.isDark) 0.38f else 0.56f),
                        focusedTextColor = palette.inkPrimary,
                        unfocusedTextColor = palette.inkPrimary,
                        focusedLabelColor = palette.accentStrong,
                        unfocusedLabelColor = palette.inkMuted
                    )

                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it },
                        label = { Text(tr(lang, "用户名", "Username")) },
                        leadingIcon = { Icon(Icons.Rounded.Person, contentDescription = null) },
                        singleLine = true,
                        colors = fieldColors,
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(Modifier.height(12.dp))

                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text(tr(lang, "密码", "Password")) },
                        leadingIcon = { Icon(Icons.Rounded.Lock, contentDescription = null) },
                        trailingIcon = {
                            IconButton(onClick = { showPassword = !showPassword }) {
                                Icon(
                                    imageVector = if (showPassword) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility,
                                    contentDescription = null
                                )
                            }
                        },
                        visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                        singleLine = true,
                        colors = fieldColors,
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth()
                    )

                    Spacer(Modifier.height(10.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = tr(lang, "记住账号与密码", "Remember credentials"),
                            color = palette.inkSecondary,
                            fontSize = 13.sp
                        )
                        Switch(
                            checked = rememberMe,
                            onCheckedChange = {
                                rememberMe = it
                                if (!it) autoLogin = false
                            },
                            colors = SwitchDefaults.colors(checkedTrackColor = palette.accentStrong)
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = tr(lang, "下次自动登录", "Auto sign in"),
                            color = palette.inkSecondary,
                            fontSize = 13.sp
                        )
                        Switch(
                            checked = autoLogin,
                            onCheckedChange = {
                                autoLogin = it
                                if (it) rememberMe = true
                            },
                            colors = SwitchDefaults.colors(checkedTrackColor = palette.accentStrong)
                        )
                    }

                    vm.loginError?.let { error ->
                        Spacer(Modifier.height(8.dp))
                        Surface(
                            color = palette.danger.copy(alpha = 0.12f),
                            shape = RoundedCornerShape(12.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = error,
                                color = palette.danger,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(12.dp)
                            )
                        }
                    }

                    Spacer(Modifier.height(16.dp))

                    Button(
                        onClick = { vm.performLogin(username, password, rememberMe, autoLogin) },
                        enabled = !vm.isAuthenticating,
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = palette.accentStrong,
                            contentColor = Color.White
                        ),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(50.dp)
                    ) {
                        if (vm.isAuthenticating) {
                            CircularProgressIndicator(
                                color = Color.White,
                                strokeWidth = 2.dp,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(Modifier.width(8.dp))
                        }
                        Text(
                            text = if (vm.isAuthenticating) {
                                tr(lang, "正在验证身份...", "Signing in...")
                            } else {
                                tr(lang, "进入工作台", "Enter Workspace")
                            },
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }

            Spacer(Modifier.height(10.dp))
            Text(
                text = "Dragon Claw Mobile v${vm.appVersion} · ${vm.baseUrl}",
                color = palette.inkMuted,
                fontSize = 11.sp
            )
        }
    }
}

    if (showServerDialog) {
        AlertDialog(
            onDismissRequest = { showServerDialog = false },
            title = { Text(tr(lang, "服务器连接设置", "Server Endpoint")) },
            text = {
                OutlinedTextField(
                    value = serverDraft,
                    onValueChange = { serverDraft = it },
                    label = { Text("URL") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        vm.updateServerBaseUrl(serverDraft)
                        showServerDialog = false
                    }
                ) {
                    Text(tr(lang, "保存", "Save"))
                }
            },
            dismissButton = {
                TextButton(onClick = { serverDraft = "https://cs.fanxiaolong.uk" }) {
                    Text(tr(lang, "恢复默认", "Reset"))
                }
            }
        )
    }
}
}
