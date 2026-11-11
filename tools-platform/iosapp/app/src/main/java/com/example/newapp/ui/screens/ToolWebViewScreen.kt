package com.example.newapp.ui.screens

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.OpenInBrowser
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.example.newapp.shared.model.PlatformTool
import com.example.newapp.state.DragonClawViewModel
import com.example.newapp.ui.components.DragonClawBackdrop
import com.example.newapp.ui.components.GlassCircleIconButton
import com.example.newapp.ui.theme.LocalDragonClawPalette

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ToolWebViewScreen(
    vm: DragonClawViewModel,
    tool: PlatformTool,
    onClose: () -> Unit
) {
    val palette = LocalDragonClawPalette.current
    val context = LocalContext.current
    val targetUrl = remember(tool.routePath, vm.baseUrl) { vm.sdk.buildToolUrl(tool.routePath) }
    var loadProgress by remember { mutableIntStateOf(0) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }

    BackHandler {
        val wv = webViewRef
        if (wv != null && wv.canGoBack()) {
            wv.goBack()
        } else {
            onClose()
        }
    }

    DragonClawBackdrop {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp)
            ) {
                GlassCircleIconButton(
                    icon = Icons.Rounded.Close,
                    contentDescription = "Close",
                    onClick = onClose
                )
                Spacer(Modifier.width(10.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = tool.localizedTitle(vm.language),
                        color = palette.inkPrimary,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = tool.routePath,
                        color = palette.inkMuted,
                        fontSize = 11.sp,
                        maxLines = 1
                    )
                }
                GlassCircleIconButton(
                    icon = Icons.Rounded.ArrowBack,
                    contentDescription = "Back",
                    size = 36.dp
                ) {
                    if (webViewRef?.canGoBack() == true) webViewRef?.goBack()
                }
                Spacer(Modifier.width(6.dp))
                GlassCircleIconButton(
                    icon = Icons.Rounded.Refresh,
                    contentDescription = "Refresh",
                    size = 36.dp
                ) {
                    webViewRef?.reload()
                }
                Spacer(Modifier.width(6.dp))
                GlassCircleIconButton(
                    icon = Icons.Rounded.OpenInBrowser,
                    contentDescription = "Browser",
                    size = 36.dp
                ) {
                    runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(targetUrl)))
                    }
                }
            }

            if (loadProgress in 1..99) {
                LinearProgressIndicator(
                    progress = { loadProgress / 100f },
                    color = palette.accentStrong,
                    modifier = Modifier.fillMaxWidth().height(2.5.dp)
                )
            }

            AndroidView(
                factory = { ctx ->
                    val cm = CookieManager.getInstance()
                    cm.setAcceptCookie(true)
                    if (vm.token.isNotBlank()) {
                        cm.setCookie(targetUrl, "tools_token=${vm.token}; Path=/; SameSite=Lax")
                        cm.flush()
                    }
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.loadWithOverviewMode = true
                        settings.useWideViewPort = true
                        settings.builtInZoomControls = true
                        settings.displayZoomControls = false
                        cm.setAcceptThirdPartyCookies(this, true)
                        webViewClient = WebViewClient()
                        webChromeClient = object : WebChromeClient() {
                            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                                loadProgress = newProgress
                            }
                        }
                        val headers = if (vm.token.isNotBlank()) {
                            mapOf("Authorization" to "Bearer ${vm.token}")
                        } else {
                            emptyMap()
                        }
                        loadUrl(targetUrl, headers)
                        webViewRef = this
                    }
                },
                modifier = Modifier.weight(1f).fillMaxWidth()
            )
        }
    }
}
