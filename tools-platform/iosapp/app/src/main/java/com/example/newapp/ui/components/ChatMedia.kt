package com.example.newapp.ui.components

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import android.util.LruCache
import android.widget.Toast
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.BrokenImage
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import com.example.newapp.shared.model.ChatAttachment
import com.example.newapp.shared.util.DragonClawHelpers
import com.example.newapp.ui.theme.DragonClawPalette
import com.example.newapp.ui.theme.LocalDragonClawPalette
import com.example.newapp.ui.theme.tr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.max

data class LightboxImageItem(
    val urlString: String,
    val title: String
)

data class LightboxPayload(
    val items: List<LightboxImageItem>,
    val initialIndex: Int = 0,
    val token: String = ""
)

object AuthenticatedImageCache {
    private val cache = object : LruCache<String, Bitmap>(
        ((Runtime.getRuntime().maxMemory() / 1024L).toInt() / 8).coerceIn(16_384, 65_536)
    ) {
        override fun sizeOf(key: String, value: Bitmap): Int = (value.byteCount / 1024).coerceAtLeast(1)
    }

    suspend fun loadBitmap(urlString: String, token: String): Result<Bitmap> = withContext(Dispatchers.IO) {
        val cleanUrl = urlString.trim()
        if (cleanUrl.isEmpty()) return@withContext Result.failure(IllegalArgumentException("Empty image URL"))

        val cacheKey = "${token.takeLast(12)}::$cleanUrl"
        cache.get(cacheKey)?.let { cached ->
            if (!cached.isRecycled) return@withContext Result.success(cached)
        }

        if (cleanUrl.startsWith("data:image/", ignoreCase = true)) {
            return@withContext decodeDataUri(cleanUrl).onSuccess { bmp -> cache.put(cacheKey, bmp) }
        }

        val parsed = runCatching { URL(cleanUrl) }.getOrElse {
            return@withContext Result.failure(it)
        }
        var conn: HttpURLConnection? = null
        return@withContext try {
            conn = (parsed.openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 30_000
                instanceFollowRedirects = true
                if (token.isNotBlank()) {
                    setRequestProperty("Authorization", "Bearer $token")
                }
            }
            val code = conn.responseCode
            if (code !in 200..299) {
                return@withContext Result.failure(IllegalStateException("HTTP $code"))
            }
            val bytes = conn.inputStream.use { input ->
                val buffer = ByteArrayOutputStream()
                val chunk = ByteArray(16_384)
                while (true) {
                    val read = input.read(chunk)
                    if (read <= 0) break
                    buffer.write(chunk, 0, read)
                    if (buffer.size() > 24 * 1024 * 1024) {
                        throw IllegalStateException("Image exceeds 24MB limit")
                    }
                }
                buffer.toByteArray()
            }
            val bmp = decodeSampledBitmap(bytes, maxDim = 2048)
                ?: return@withContext Result.failure(IllegalStateException("Failed to decode image"))
            cache.put(cacheKey, bmp)
            Result.success(bmp)
        } catch (err: Throwable) {
            Result.failure(err)
        } finally {
            runCatching { conn?.disconnect() }
        }
    }

    private fun decodeDataUri(uri: String): Result<Bitmap> = runCatching {
        val commaIdx = uri.indexOf(',')
        require(commaIdx > 0) { "Malformed data URI" }
        val rawBytes = Base64.decode(uri.substring(commaIdx + 1), Base64.DEFAULT)
        decodeSampledBitmap(rawBytes, maxDim = 2048) ?: error("Invalid data URI bitmap")
    }

    private fun decodeSampledBitmap(bytes: ByteArray, maxDim: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (max(bounds.outWidth / sample, bounds.outHeight / sample) > maxDim) {
            sample *= 2
        }
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
    }
}

@Composable
fun AuthenticatedRemoteImageCard(
    urlString: String,
    altText: String,
    token: String,
    modifier: Modifier = Modifier,
    cornerRadius: Dp = 14.dp,
    contentScale: ContentScale = ContentScale.Crop,
    onLoaded: ((Bitmap) -> Unit)? = null,
    onClick: (() -> Unit)? = null
) {
    val palette = LocalDragonClawPalette.current
    var reloadNonce by remember(urlString, token) { mutableIntStateOf(0) }
    var bitmap by remember(urlString, token) { mutableStateOf<Bitmap?>(null) }
    var isLoading by remember(urlString, token) { mutableStateOf(true) }
    var loadError by remember(urlString, token) { mutableStateOf<String?>(null) }

    LaunchedEffect(urlString, token, reloadNonce) {
        isLoading = true
        loadError = null
        AuthenticatedImageCache.loadBitmap(urlString, token)
            .onSuccess { bmp ->
                bitmap = bmp
                isLoading = false
                onLoaded?.invoke(bmp)
            }
            .onFailure { err ->
                loadError = err.message ?: "Failed"
                isLoading = false
            }
    }

    val shape = RoundedCornerShape(cornerRadius)
    val clickModifier = if (onClick != null) {
        Modifier.clickable(enabled = bitmap != null) { onClick() }
    } else {
        Modifier
    }

    Box(
        contentAlignment = Alignment.Center,
        modifier = modifier
            .clip(shape)
            .background(palette.elevatedSurface.copy(alpha = 0.65f))
            .border(0.75.dp, palette.glassBorderSoft, shape)
            .then(clickModifier)
    ) {
        val loaded = bitmap
        when {
            loaded != null -> {
                Image(
                    bitmap = loaded.asImageBitmap(),
                    contentDescription = altText.ifBlank { "Image" },
                    contentScale = contentScale,
                    modifier = Modifier.fillMaxSize()
                )
            }
            isLoading -> {
                CircularProgressIndicator(
                    strokeWidth = 2.dp,
                    color = palette.accentStrong,
                    modifier = Modifier.size(24.dp)
                )
            }
            else -> {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier
                        .fillMaxSize()
                        .clickable { reloadNonce += 1 }
                        .padding(10.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        Icon(Icons.Rounded.BrokenImage, contentDescription = null, tint = palette.inkMuted, modifier = Modifier.size(16.dp))
                        Icon(Icons.Rounded.Refresh, contentDescription = "Retry", tint = palette.accentStrong, modifier = Modifier.size(15.dp))
                    }
                    if (altText.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = altText,
                            color = palette.inkMuted,
                            fontSize = 11.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ChatAttachmentGallery(
    attachments: List<ChatAttachment>,
    token: String,
    baseUrl: String,
    palette: DragonClawPalette,
    onOpenLightbox: (List<LightboxImageItem>, Int) -> Unit,
    modifier: Modifier = Modifier
) {
    val images = remember(attachments, baseUrl) {
        attachments.filter { it.isImage }.mapNotNull { att ->
            val src = att.url.takeIf { it.isNotBlank() }
                ?: DragonClawHelpers.resolveImageSourceUrl(baseUrl, att.path)
            if (src.isBlank()) null else LightboxImageItem(urlString = src, title = att.displayName)
        }
    }
    val files = remember(attachments) { attachments.filterNot { it.isImage } }

    Column(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = modifier) {
        if (images.size == 1) {
            val single = images[0]
            AuthenticatedRemoteImageCard(
                urlString = single.urlString,
                altText = single.title,
                token = token,
                cornerRadius = 16.dp,
                contentScale = ContentScale.Crop,
                onClick = { onOpenLightbox(images, 0) },
                modifier = Modifier
                    .widthIn(min = 160.dp, max = 250.dp)
                    .height(176.dp)
            )
        } else if (images.size > 1) {
            val rows = images.chunked(2)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                rows.forEachIndexed { rowIdx, rowItems ->
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        rowItems.forEachIndexed { colIdx, item ->
                            val index = rowIdx * 2 + colIdx
                            AuthenticatedRemoteImageCard(
                                urlString = item.urlString,
                                altText = item.title,
                                token = token,
                                cornerRadius = 14.dp,
                                contentScale = ContentScale.Crop,
                                onClick = { onOpenLightbox(images, index) },
                                modifier = Modifier.size(120.dp)
                            )
                        }
                    }
                }
            }
        }

        if (files.isNotEmpty()) {
            Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                files.forEach { file ->
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = palette.chipSurface.copy(alpha = 0.72f),
                        border = BorderStroke(0.6.dp, palette.glassBorderSoft)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                        ) {
                            Icon(Icons.Rounded.Description, contentDescription = null, tint = palette.accentStrong, modifier = Modifier.size(14.dp))
                            Text(
                                text = file.displayName,
                                color = palette.inkPrimary,
                                fontSize = 11.5.sp,
                                fontWeight = FontWeight.Medium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.widthIn(max = 200.dp)
                            )
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ImageLightboxDialog(
    payload: LightboxPayload,
    language: String,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val safeInitial = payload.initialIndex.coerceIn(0, (payload.items.size - 1).coerceAtLeast(0))
    val pagerState = rememberPagerState(initialPage = safeInitial, pageCount = { payload.items.size })
    val loadedBitmaps = remember { mutableStateMapOf<Int, Bitmap>() }
    var currentPageZoomed by remember { mutableStateOf(false) }

    LaunchedEffect(pagerState.currentPage) {
        currentPageZoomed = false
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xF5080A0D))
        ) {
            HorizontalPager(
                state = pagerState,
                userScrollEnabled = !currentPageZoomed,
                modifier = Modifier.fillMaxSize()
            ) { page ->
                val item = payload.items[page]
                ZoomableLightboxPage(
                    item = item,
                    token = payload.token,
                    isActivePage = pagerState.currentPage == page,
                    onZoomChanged = { zoomed ->
                        if (pagerState.currentPage == page) {
                            currentPageZoomed = zoomed
                        }
                    },
                    onLoaded = { bmp -> loadedBitmaps[page] = bmp }
                )
            }

            val activeItem = payload.items.getOrNull(pagerState.currentPage)
            val activeBitmap = loadedBitmaps[pagerState.currentPage]

            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 14.dp, vertical = 12.dp)
            ) {
                LightboxActionCircle(icon = Icons.Rounded.Close, contentDescription = "Close", onClick = onDismiss)

                Spacer(Modifier.width(10.dp))

                Column(modifier = Modifier.weight(1f)) {
                    if (activeItem != null && activeItem.title.isNotBlank()) {
                        Text(
                            text = activeItem.title,
                            color = Color.White,
                            fontSize = 13.5.sp,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                    if (payload.items.size > 1) {
                        Text(
                            text = "${pagerState.currentPage + 1} / ${payload.items.size}",
                            color = Color.White.copy(alpha = 0.72f),
                            fontSize = 11.5.sp
                        )
                    }
                }

                if (activeBitmap != null) {
                    Spacer(Modifier.width(8.dp))
                    LightboxActionCircle(
                        icon = Icons.Rounded.Download,
                        contentDescription = "Save",
                        onClick = {
                            scope.launch {
                                val saved = saveBitmapToGallery(context, activeBitmap, activeItem?.title)
                                val msg = if (saved) {
                                    tr(language, "已保存到相册", "Saved to gallery")
                                } else {
                                    tr(language, "保存失败", "Failed to save image")
                                }
                                Toast.makeText(context, msg, Toast.LENGTH_SHORT).show()
                            }
                        }
                    )
                    Spacer(Modifier.width(8.dp))
                    LightboxActionCircle(
                        icon = Icons.Rounded.Share,
                        contentDescription = "Share",
                        onClick = {
                            scope.launch {
                                shareBitmap(context, activeBitmap, activeItem?.title)
                            }
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun LightboxActionCircle(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    contentDescription: String,
    onClick: () -> Unit
) {
    Surface(
        shape = CircleShape,
        color = Color.White.copy(alpha = 0.16f),
        onClick = onClick,
        modifier = Modifier.size(38.dp)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = contentDescription, tint = Color.White, modifier = Modifier.size(19.dp))
        }
    }
}

@Composable
private fun ZoomableLightboxPage(
    item: LightboxImageItem,
    token: String,
    isActivePage: Boolean,
    onZoomChanged: (Boolean) -> Unit,
    onLoaded: (Bitmap) -> Unit
) {
    var scale by remember(item.urlString) { mutableFloatStateOf(1f) }
    var offset by remember(item.urlString) { mutableStateOf(Offset.Zero) }
    var bitmap by remember(item.urlString, token) { mutableStateOf<Bitmap?>(null) }
    var isLoading by remember(item.urlString, token) { mutableStateOf(true) }
    var hasError by remember(item.urlString, token) { mutableStateOf(false) }

    LaunchedEffect(isActivePage) {
        if (!isActivePage) {
            scale = 1f
            offset = Offset.Zero
        }
    }

    LaunchedEffect(item.urlString, token) {
        isLoading = true
        hasError = false
        AuthenticatedImageCache.loadBitmap(item.urlString, token)
            .onSuccess { bmp ->
                bitmap = bmp
                isLoading = false
                onLoaded(bmp)
            }
            .onFailure {
                hasError = true
                isLoading = false
            }
    }

    Box(
        contentAlignment = Alignment.Center,
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(item.urlString) {
                detectTapGestures(
                    onDoubleTap = {
                        if (scale > 1.05f) {
                            scale = 1f
                            offset = Offset.Zero
                            onZoomChanged(false)
                        } else {
                            scale = 2.4f
                            onZoomChanged(true)
                        }
                    }
                )
            }
            .pointerInput(item.urlString) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent()
                        val pointerCount = event.changes.count { it.pressed }
                        val zoomChange = event.calculateZoom()
                        val panChange = event.calculatePan()

                        if (pointerCount >= 2 || scale > 1.02f || zoomChange != 1f) {
                            val nextScale = (scale * zoomChange).coerceIn(1f, 4.5f)
                            scale = nextScale
                            if (nextScale <= 1.02f) {
                                offset = Offset.Zero
                                onZoomChanged(false)
                            } else {
                                val maxOffsetX = size.width * (nextScale - 1f) * 0.55f
                                val maxOffsetY = size.height * (nextScale - 1f) * 0.55f
                                offset = Offset(
                                    x = (offset.x + panChange.x).coerceIn(-maxOffsetX, maxOffsetX),
                                    y = (offset.y + panChange.y).coerceIn(-maxOffsetY, maxOffsetY)
                                )
                                onZoomChanged(true)
                            }
                            event.changes.forEach { change ->
                                if (change.positionChanged()) change.consume()
                            }
                        }
                    } while (event.changes.any { it.pressed })
                }
            }
    ) {
        val loaded = bitmap
        when {
            loaded != null -> {
                Image(
                    bitmap = loaded.asImageBitmap(),
                    contentDescription = item.title,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                            translationX = offset.x
                            translationY = offset.y
                        }
                )
            }
            isLoading -> {
                CircularProgressIndicator(color = Color.White, strokeWidth = 2.4.dp)
            }
            hasError -> {
                Icon(Icons.Rounded.BrokenImage, contentDescription = null, tint = Color.White.copy(alpha = 0.65f), modifier = Modifier.size(44.dp))
            }
        }
    }
}

private suspend fun saveBitmapToGallery(context: Context, bitmap: Bitmap, rawTitle: String?): Boolean =
    withContext(Dispatchers.IO) {
        runCatching {
            val cleanName = (rawTitle?.takeIf { it.isNotBlank() } ?: "dragonclaw_${System.currentTimeMillis()}")
                .replace(Regex("[^a-zA-Z0-9._-]"), "_")
                .removeSuffix(".png") + ".png"
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, cleanName)
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/DragonClaw")
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                }
            }
            val resolver = context.contentResolver
            val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return@runCatching false
            resolver.openOutputStream(uri)?.use { out ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            } ?: return@runCatching false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                values.clear()
                values.put(MediaStore.Images.Media.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            }
            true
        }.getOrDefault(false)
    }

private suspend fun shareBitmap(context: Context, bitmap: Bitmap, rawTitle: String?) {
    val file = withContext(Dispatchers.IO) {
        runCatching {
            val dir = File(context.cacheDir, "shared_images").apply { mkdirs() }
            val name = (rawTitle?.takeIf { it.isNotBlank() } ?: "dragonclaw_share")
                .replace(Regex("[^a-zA-Z0-9._-]"), "_")
                .removeSuffix(".png") + "_${System.currentTimeMillis()}.png"
            val target = File(dir, name)
            FileOutputStream(target).use { out ->
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            }
            target
        }.getOrNull()
    } ?: return

    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, null))
}
