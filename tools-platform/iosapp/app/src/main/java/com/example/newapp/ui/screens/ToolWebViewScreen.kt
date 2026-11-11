package com.example.newapp.ui.screens

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
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
                    val parsed = runCatching { Uri.parse(targetUrl) }.getOrNull()
                    val scheme = parsed?.scheme ?: "https"
                    val host = parsed?.host.orEmpty()
                    val portSuffix = if (parsed != null && parsed.port > 0) ":${parsed.port}" else ""
                    val originUrl = if (host.isNotBlank()) "$scheme://$host$portSuffix" else targetUrl
                    val secureFlag = if (scheme.equals("https", ignoreCase = true)) "; Secure" else ""

                    val cm = CookieManager.getInstance()
                    cm.setAcceptCookie(true)
                    if (vm.token.isNotBlank()) {
                        val cookieHeader = "tools_token=${vm.token}; Path=/; SameSite=Lax$secureFlag"
                        cm.setCookie(originUrl, cookieHeader)
                        cm.setCookie(targetUrl, cookieHeader)
                        cm.flush()
                    }
                    val seedScript = buildStorageSeedScript(
                        expectedOrigin = null,
                        token = vm.token,
                        username = vm.username,
                        role = vm.role,
                        tenantId = vm.tenantId,
                        isSuper = vm.isSuper,
                        language = vm.language
                    )
                    val originGuardedScript = buildStorageSeedScript(
                        expectedOrigin = originUrl,
                        token = vm.token,
                        username = vm.username,
                        role = vm.role,
                        tenantId = vm.tenantId,
                        isSuper = vm.isSuper,
                        language = vm.language
                    )

                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.loadWithOverviewMode = true
                        settings.useWideViewPort = true
                        settings.builtInZoomControls = true
                        settings.displayZoomControls = false
                        cm.setAcceptThirdPartyCookies(this, true)
                        webViewClient = object : WebViewClient() {
                            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                                super.onPageStarted(view, url, favicon)
                                if (vm.token.isNotBlank() && originGuardedScript.isNotBlank()) {
                                    view?.evaluateJavascript(originGuardedScript, null)
                                }
                            }
                        }
                        webChromeClient = object : WebChromeClient() {
                            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                                loadProgress = newProgress
                            }
                        }
                        if (vm.token.isNotBlank() && host.isNotBlank()) {
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
                        webViewRef = this
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
