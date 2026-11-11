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
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
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
import androidx.compose.material.icons.rounded.OpenInFull
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Share
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.zIndex
import androidx.core.content.FileProvider
import com.example.newapp.shared.model.ChatAttachment
import com.example.newapp.shared.network.AndroidBinaryHttpClient
import com.example.newapp.shared.util.DragonClawHelpers
import com.example.newapp.ui.theme.DragonClawPalette
import com.example.newapp.ui.theme.LocalDragonClawPalette
import com.example.newapp.ui.theme.tr
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import kotlin.math.abs
import kotlin.math.hypot
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

    fun peekCached(urlString: String, token: String): Bitmap? {
        val cleanUrl = urlString.trim()
        if (cleanUrl.isEmpty()) return null
        val cacheKey = "${token.takeLast(12)}::$cleanUrl"
        return cache.get(cacheKey)?.takeIf { !it.isRecycled }
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

        return@withContext try {
            val bytes = AndroidBinaryHttpClient.fetchBytes(cleanUrl, token, maxBytes = 24 * 1024 * 1024)
            val bmp = decodeSampledBitmap(bytes, maxDim = 2048)
                ?: return@withContext Result.failure(IllegalStateException("Failed to decode image"))
            cache.put(cacheKey, bmp)
            Result.success(bmp)
        } catch (err: Throwable) {
            Result.failure(err)
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
    cornerRadius: Dp = 16.dp,
    contentScale: ContentScale = ContentScale.Fit,
    adaptiveMaxWidth: Dp? = null,
    innerPadding: Dp = 0.dp,
    onLoaded: ((Bitmap) -> Unit)? = null,
    onClick: (() -> Unit)? = null
) {
    val palette = LocalDragonClawPalette.current
    var reloadNonce by remember(urlString, token) { mutableIntStateOf(0) }
    var bitmap by remember(urlString, token) {
        mutableStateOf(AuthenticatedImageCache.peekCached(urlString, token))
    }
    var isLoading by remember(urlString, token) { mutableStateOf(bitmap == null) }
    var loadError by remember(urlString, token) { mutableStateOf<String?>(null) }

    LaunchedEffect(urlString, token, reloadNonce) {
        if (bitmap == null) {
            isLoading = true
        }
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

    val adaptiveFrame = remember(bitmap, adaptiveMaxWidth) {
        adaptiveMaxWidth?.let { maxW ->
            DragonClawHelpers.computeAestheticSingleImageFrame(
                pixelWidth = bitmap?.width ?: 0,
                pixelHeight = bitmap?.height ?: 0,
                maxContainerWidth = maxW.value.toDouble()
            )
        }
    }

    val sizedModifier = if (adaptiveFrame != null) {
        modifier.size(width = adaptiveFrame.width.dp, height = adaptiveFrame.height.dp)
    } else {
        modifier
    }

    val effectivePadding = maxOf(innerPadding.value, (adaptiveFrame?.innerPadding ?: 0.0).toFloat()).dp
    val needsBackdrop = adaptiveFrame?.needsBackdropFrame == true
    val cardFill = if (needsBackdrop) {
        palette.cardSurface.copy(alpha = if (palette.isDark) 0.90f else 0.96f)
    } else {
        palette.elevatedSurface.copy(alpha = 0.65f)
    }

    val shape = RoundedCornerShape(cornerRadius)
    val clickModifier = if (onClick != null) {
        Modifier.clickable(enabled = bitmap != null) { onClick() }
    } else {
        Modifier
    }

    Box(
        contentAlignment = Alignment.Center,
        modifier = sizedModifier
            .clip(shape)
            .background(cardFill)
            .border(0.75.dp, palette.glassBorderSoft, shape)
            .then(clickModifier)
    ) {
        val loaded = bitmap
        when {
            loaded != null -> {
                Image(
                    bitmap = loaded.asImageBitmap(),
                    contentDescription = altText.ifBlank { "Image" },
                    contentScale = if (adaptiveFrame != null) ContentScale.Fit else contentScale,
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(effectivePadding)
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
fun ChatStackedImageDeck(
    items: List<LightboxImageItem>,
    token: String,
    palette: DragonClawPalette,
    onOpenLightbox: (List<LightboxImageItem>, Int) -> Unit,
    modifier: Modifier = Modifier
) {
    if (items.isEmpty()) return
    if (items.size == 1) {
        val single = items[0]
        AuthenticatedRemoteImageCard(
            urlString = single.urlString,
            altText = single.title,
            token = token,
            cornerRadius = 16.dp,
            contentScale = ContentScale.Fit,
            adaptiveMaxWidth = 246.dp,
            onClick = { onOpenLightbox(items, 0) },
            modifier = modifier
        )
        return
    }

    val count = items.size
    var activeIndex by remember(items.map { it.urlString }) { mutableIntStateOf(0) }
    val safeActive = activeIndex.coerceIn(0, count - 1)
    if (safeActive != activeIndex) activeIndex = safeActive

    val dragOffsetPx = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current

    val cardWidth = 204.dp
    val cardHeight = 248.dp
    val visibleDepths = minOf(3, count)
    val peekPadding = if (visibleDepths >= 3) 30.dp else 16.dp
    val cardWidthPx = with(density) { cardWidth.toPx() }
    val offset1Px = with(density) { 15.dp.toPx() }
    val offset2Px = with(density) { 28.dp.toPx() }

    val currentActiveState by rememberUpdatedState(safeActive)
    val currentItemsState by rememberUpdatedState(items)

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier
    ) {
        Box(
            contentAlignment = Alignment.CenterStart,
            modifier = Modifier
                .width(cardWidth + peekPadding)
                .height(cardHeight)
                .pointerInput(count) {
                    val touchSlop = viewConfiguration.touchSlop
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false)
                        var lockedHorizontal = false
                        var movedTooFar = false
                        var dragX = 0f
                        val tracker = VelocityTracker().apply {
                            addPosition(down.uptimeMillis, down.position)
                        }
                        while (true) {
                            val event = awaitPointerEvent(PointerEventPass.Main)
                            val change = event.changes.firstOrNull { it.id == down.id } ?: break
                            tracker.addPosition(change.uptimeMillis, change.position)
                            val dx = change.position.x - down.position.x
                            val dy = change.position.y - down.position.y
                            if (!change.pressed) {
                                if (lockedHorizontal) {
                                    val vx = runCatching { tracker.calculateVelocity().x }.getOrDefault(0f)
                                    val threshold = cardWidthPx * 0.24f
                                    scope.launch {
                                        when {
                                            dragX < -threshold || vx < -340f -> {
                                                activeIndex = (currentActiveState + 1) % count
                                                dragOffsetPx.snapTo(0f)
                                            }
                                            dragX > threshold || vx > 340f -> {
                                                activeIndex = (currentActiveState - 1 + count) % count
                                                dragOffsetPx.snapTo(0f)
                                            }
                                            else -> {
                                                dragOffsetPx.animateTo(
                                                    0f,
                                                    spring(dampingRatio = 0.82f, stiffness = Spring.StiffnessMedium)
                                                )
                                            }
                                        }
                                    }
                                } else if (!movedTooFar && !change.isConsumed) {
                                    onOpenLightbox(currentItemsState, currentActiveState)
                                }
                                break
                            }

                            if (hypot(dx.toDouble(), dy.toDouble()) > touchSlop * 1.05) {
                                movedTooFar = true
                            }

                            if (!lockedHorizontal) {
                                if (abs(dy) > touchSlop * 0.8f && abs(dy) > abs(dx) * 1.15f) {
                                    // Yield to vertical transcript scrolling cleanly.
                                    break
                                }
                                if (abs(dx) > touchSlop * 0.85f && abs(dx) > abs(dy) * 1.35f) {
                                    lockedHorizontal = true
                                    dragX = dx.coerceIn(-cardWidthPx * 0.95f, cardWidthPx * 0.95f)
                                    change.consume()
                                    scope.launch { dragOffsetPx.snapTo(dragX) }
                                }
                            } else {
                                dragX = dx.coerceIn(-cardWidthPx * 0.95f, cardWidthPx * 0.95f)
                                change.consume()
                                scope.launch { dragOffsetPx.snapTo(dragX) }
                            }
                        }
                    }
                }
        ) {
            val dragX = dragOffsetPx.value
            val prevIdx = (safeActive - 1 + count) % count
            val draggingRight = dragX > 3f
            val rightProgress = if (draggingRight) (dragX / (cardWidthPx * 0.62f)).coerceIn(0f, 1f) else 0f
            val leftProgress = if (dragX < -3f) (-dragX / (cardWidthPx * 0.62f)).coerceIn(0f, 1f) else 0f

            for (depth in (visibleDepths - 1) downTo 0) {
                val idx = (safeActive + depth) % count
                if (draggingRight && depth > 0 && idx == prevIdx) continue

                val item = items[idx]
                val isFront = depth == 0
                val tx: Float
                val cardScale: Float
                val rotZ: Float
                val cardAlpha: Float

                if (draggingRight) {
                    tx = when (depth) {
                        0 -> offset1Px * 0.65f * rightProgress
                        1 -> offset1Px + (offset2Px - offset1Px) * rightProgress
                        else -> offset2Px
                    }
                    cardScale = when (depth) {
                        0 -> 1f - 0.05f * rightProgress
                        1 -> 0.94f - 0.05f * rightProgress
                        else -> 0.88f
                    }
                    rotZ = if (isFront) 1.5f * rightProgress else 1.4f
                    cardAlpha = when (depth) {
                        0 -> 1f - 0.08f * rightProgress
                        1 -> 0.95f
                        else -> 0.88f
                    }
                } else {
                    tx = when (depth) {
                        0 -> dragX
                        1 -> offset1Px * (1f - leftProgress)
                        else -> offset2Px - (offset2Px - offset1Px) * leftProgress
                    }
                    cardScale = when (depth) {
                        0 -> 1f - 0.04f * leftProgress
                        1 -> 0.94f + 0.06f * leftProgress
                        else -> 0.88f + 0.06f * leftProgress
                    }
                    rotZ = when (depth) {
                        0 -> -4.2f * leftProgress
                        1 -> 1.4f * (1f - leftProgress)
                        else -> 2.4f - 1.0f * leftProgress
                    }
                    cardAlpha = when (depth) {
                        0 -> 1f - 0.14f * leftProgress
                        1 -> 0.95f + 0.05f * leftProgress
                        else -> 0.88f + 0.07f * leftProgress
                    }
                }

                key("deck:${idx}:${item.urlString}") {
                    StackedImageDeckCard(
                        item = item,
                        token = token,
                        palette = palette,
                        isFront = isFront && !draggingRight,
                        frontCounterLabel = if (isFront && !draggingRight) "${safeActive + 1} / $count" else null,
                        modifier = Modifier
                            .size(width = cardWidth, height = cardHeight)
                            .zIndex((visibleDepths - depth).toFloat())
                            .graphicsLayer {
                                translationX = tx
                                scaleX = cardScale
                                scaleY = cardScale
                                rotationZ = rotZ
                            }
                            .alpha(cardAlpha)
                    )
                }
            }

            if (draggingRight) {
                val incomingItem = items[prevIdx]
                key("deck:${prevIdx}:${incomingItem.urlString}") {
                    StackedImageDeckCard(
                        item = incomingItem,
                        token = token,
                        palette = palette,
                        isFront = true,
                        frontCounterLabel = "${prevIdx + 1} / $count",
                        modifier = Modifier
                            .size(width = cardWidth, height = cardHeight)
                            .zIndex(10f)
                            .graphicsLayer {
                                translationX = -cardWidthPx * 0.56f * (1f - rightProgress)
                                scaleX = 0.92f + 0.08f * rightProgress
                                scaleY = 0.92f + 0.08f * rightProgress
                                rotationZ = 3.2f * (1f - rightProgress)
                            }
                            .alpha((0.40f + 0.60f * rightProgress).coerceIn(0f, 1f))
                    )
                }
            }
        }

        // Compact stack indicator dots centered under front card
        Row(
            horizontalArrangement = Arrangement.spacedBy(5.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .width(cardWidth)
                .padding(end = 2.dp),
            content = {
                Spacer(Modifier.weight(1f))
                items.indices.take(8).forEach { dotIdx ->
                    val active = dotIdx == safeActive
                    Box(
                        modifier = Modifier
                            .size(width = if (active) 14.dp else 5.dp, height = 5.dp)
                            .clip(CircleShape)
                            .background(
                                if (active) palette.accentStrong else palette.inkMuted.copy(alpha = 0.34f)
                            )
                    )
                }
                Spacer(Modifier.weight(1f))
            }
        )
    }
}

@Composable
private fun StackedImageDeckCard(
    item: LightboxImageItem,
    token: String,
    palette: DragonClawPalette,
    isFront: Boolean,
    frontCounterLabel: String?,
    modifier: Modifier = Modifier
) {
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = palette.cardSurface.copy(alpha = if (palette.isDark) 0.94f else 0.98f),
        border = BorderStroke(
            width = if (isFront) 1.dp else 0.75.dp,
            color = if (isFront) palette.glassBorderSoft else palette.hairLine
        ),
        shadowElevation = if (isFront) 10.dp else 4.dp,
        modifier = modifier
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            AuthenticatedRemoteImageCard(
                urlString = item.urlString,
                altText = item.title,
                token = token,
                cornerRadius = 16.dp,
                contentScale = ContentScale.Fit,
                innerPadding = 6.dp,
                onClick = null,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(4.dp)
            )
            if (frontCounterLabel != null) {
                Surface(
                    shape = CircleShape,
                    color = Color.Black.copy(alpha = 0.56f),
                    border = BorderStroke(0.6.dp, Color.White.copy(alpha = 0.22f)),
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(10.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = frontCounterLabel,
                            color = Color.White,
                            fontSize = 10.5.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                        Icon(
                            imageVector = Icons.Rounded.OpenInFull,
                            contentDescription = null,
                            tint = Color.White.copy(alpha = 0.9f),
                            modifier = Modifier.size(10.dp)
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

    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = modifier) {
        if (images.size == 1) {
            val single = images[0]
            AuthenticatedRemoteImageCard(
                urlString = single.urlString,
                altText = single.title,
                token = token,
                cornerRadius = 16.dp,
                contentScale = ContentScale.Fit,
                adaptiveMaxWidth = 246.dp,
                onClick = { onOpenLightbox(images, 0) }
            )
        } else if (images.size > 1) {
            ChatStackedImageDeck(
                items = images,
                token = token,
                palette = palette,
                onOpenLightbox = onOpenLightbox
            )
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
