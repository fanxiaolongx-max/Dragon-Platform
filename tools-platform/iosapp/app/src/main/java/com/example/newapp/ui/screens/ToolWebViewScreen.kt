package com.example.newapp.ui.screens

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.view.ViewGroup
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import com.example.newapp.shared.network.WebViewDnsProxy
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
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

    DisposableEffect(Unit) {
        onDispose { webViewRef?.stopLoading(); webViewRef?.destroy(); webViewRef = null }
    }

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
                    val parsed = runCatching { Uri.parse(targetUrl) }.getOrNull()
                    val scheme = parsed?.scheme ?: "https"
                    val host = parsed?.host.orEmpty()
                    val portSuffix = if (parsed != null && parsed.port > 0) ":${parsed.port}" else ""
                    val originUrl = if (host.isNotBlank()) "$scheme://$host$portSuffix" else targetUrl
                    val secureFlag = if (scheme.equals("https", ignoreCase = true)) "; Secure" else ""

                    // Only the platform's own origin ever receives the session token.
                    val trusted = vm.sdk.isPlatformOrigin(targetUrl)
                    val sessionToken = if (trusted) vm.token else ""

                    val cm = CookieManager.getInstance()
                    cm.setAcceptCookie(true)
                    if (sessionToken.isNotBlank()) {
                        val cookieHeader = "tools_token=$sessionToken; Path=/; SameSite=Lax$secureFlag"
                        cm.setCookie(originUrl, cookieHeader)
                        cm.setCookie(targetUrl, cookieHeader)
                        cm.flush()
                    }
                    val seedScript = buildStorageSeedScript(
                        expectedOrigin = null,
                        token = sessionToken,
                        username = vm.username,
                        role = vm.role,
                        tenantId = vm.tenantId,
                        isSuper = vm.isSuper,
                        language = vm.language
                    )
                    val originGuardedScript = buildStorageSeedScript(
                        expectedOrigin = originUrl,
                        token = sessionToken,
                        username = vm.username,
                        role = vm.role,
                        tenantId = vm.tenantId,
                        isSuper = vm.isSuper,
                        language = vm.language
                    )

                    WebView(ctx).apply {
                        // Explicit MATCH_PARENT avoids Compose WRAP_CONTENT default, which causes
                        // Android WebView to evaluate 100vh as 0px on desktop-width viewports.
                        layoutParams = ViewGroup.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT
                        )
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.loadWithOverviewMode = true
                        settings.useWideViewPort = true
                        settings.builtInZoomControls = true
                        settings.displayZoomControls = false
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        cm.setAcceptThirdPartyCookies(this, false)
                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(
                                view: WebView?,
                                request: android.webkit.WebResourceRequest?
                            ): Boolean {
                                val next = request?.url ?: return false
                                if (request.isForMainFrame.not()) return false
                                val nextScheme = next.scheme?.lowercase().orEmpty()
                                val sameHost = next.host.equals(host, ignoreCase = true)
                                if ((nextScheme == "http" || nextScheme == "https") && sameHost) return false
                                // Anything leaving the tool's own site (or a custom scheme) opens outside the app.
                                runCatching {
                                    ctx.startActivity(
                                        Intent(Intent.ACTION_VIEW, next).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                    )
                                }
                                return true
                            }

                            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                                super.onPageStarted(view, url, favicon)
                                if (sessionToken.isNotBlank() && originGuardedScript.isNotBlank()) {
                                    view?.evaluateJavascript(originGuardedScript, null)
                                }
                            }
                        }
                        webChromeClient = object : WebChromeClient() {
                            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                                loadProgress = newProgress
                            }
                        }
                        webViewRef = this
                        val loadTool = Runnable {
                            if (webViewRef !== this) return@Runnable
                            if (sessionToken.isNotBlank() && host.isNotBlank()) {
                                val bootstrapHtml = """
                                    <!DOCTYPE html><html><head><meta charset="utf-8"><script>
                                    $seedScript
                                    window.location.replace(${JSONObject.quote(targetUrl)});
                                    </script></head><body></body></html>
                                """.trimIndent()
                                loadDataWithBaseURL("$originUrl/", bootstrapHtml, "text/html", "utf-8", null)
                            } else {
                                loadUrl(targetUrl)
                            }
                        }
                        if (WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
                            val proxy = WebViewDnsProxy.instance
                            ProxyController.getInstance().setProxyOverride(
                                ProxyConfig.Builder().addProxyRule("socks://127.0.0.1:${proxy.port}").build(),
                                androidx.core.content.ContextCompat.getMainExecutor(ctx),
                                loadTool
                            )
                        } else {
                            loadTool.run()
                        }
                    }
                },
                modifier = Modifier.weight(1f).fillMaxWidth()
            )
        }
    }
}

private fun buildStorageSeedScript(
    expectedOrigin: String?,
    token: String,
    username: String,
    role: String,
    tenantId: String,
    isSuper: Boolean,
    language: String
): String {
    if (token.isBlank()) return ""
    val cleanTenant = tenantId.ifBlank { "default" }
    val cleanLang = language.ifBlank { "zh" }
    val originCheck = if (!expectedOrigin.isNullOrBlank()) {
        "if (window.location && window.location.origin !== ${JSONObject.quote(expectedOrigin)}) return;"
    } else {
        ""
    }
    return """
        (function() {
            try {
                $originCheck
                var pairs = {
                    tools_token: ${JSONObject.quote(token)},
                    tools_user: ${JSONObject.quote(username)},
                    tools_role: ${JSONObject.quote(role)},
                    tools_super: ${JSONObject.quote(if (isSuper) "1" else "0")},
                    tools_tenant_id: ${JSONObject.quote(cleanTenant)},
                    tools_lang: ${JSONObject.quote(cleanLang)},
                    tools_language: ${JSONObject.quote(cleanLang)}
                };
                Object.keys(pairs).forEach(function(key) {
                    var val = pairs[key];
                    if (val !== undefined && val !== null && val !== '') {
                        try { window.localStorage.setItem(key, val); } catch (_) {}
                        try { window.sessionStorage.setItem(key, val); } catch (_) {}
                    }
                });
                var secureAttr = window.location && window.location.protocol === 'https:' ? '; Secure' : '';
                document.cookie = 'tools_token=' + encodeURIComponent(pairs.tools_token) + '; path=/; SameSite=Lax' + secureAttr;
            } catch (_) {}
        })();
    """.trimIndent()
}
