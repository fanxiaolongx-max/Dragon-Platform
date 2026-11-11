package com.example.newapp.ui.components

import android.graphics.RuntimeShader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.newapp.ui.theme.DragonClawPalette
import com.example.newapp.ui.theme.LocalDragonClawPalette

private const val LIQUID_GLASS_AGSL = """
uniform float2 uSize;
uniform float4 uTopColor;
uniform float4 uBottomColor;
uniform float4 uTintColor;
uniform float uTintAlpha;

half4 main(float2 fragCoord) {
    float2 uv = fragCoord / max(uSize, float2(1.0, 1.0));
    float2 centered = uv - float2(0.5, 0.5);
    float diagonal = clamp(uv.x * 0.42 + uv.y * 0.78, 0.0, 1.0);
    half4 base = mix(half4(uTopColor), half4(uBottomColor), half(diagonal));

    // Specular curved lens caustic sweep across top-left rim
    float specWave = exp(-pow((uv.y - 0.14 - 0.10 * sin(uv.x * 3.14159)) * 5.2, 2.0));
    half4 spec = half4(1.0, 1.0, 1.0, 1.0) * half(specWave * 0.16);

    // Subtle refraction glow near lower edge
    float edgeDist = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float rim = smoothstep(0.18, 0.0, edgeDist);
    half4 tint = half4(uTintColor) * half(uTintAlpha * (0.65 + 0.35 * (1.0 - length(centered))));

    half4 combined = base + tint + spec;
    combined.rgb += half3(rim * 0.05);
    return combined;
}
"""

@Composable
fun DragonClawBackdrop(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit
) {
    val palette = LocalDragonClawPalette.current
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(palette.background)
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        palette.accent.copy(alpha = if (palette.isDark) 0.17f else 0.11f),
                        Color.Transparent
                    ),
                    center = Offset(size.width * 0.88f, size.height * 0.10f),
                    radius = size.maxDimension * 0.55f
                ),
                radius = size.maxDimension * 0.55f,
                center = Offset(size.width * 0.88f, size.height * 0.10f)
            )
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        Color(0xFF06B6D4).copy(alpha = if (palette.isDark) 0.13f else 0.08f),
                        Color.Transparent
                    ),
                    center = Offset(size.width * 0.12f, size.height * 0.85f),
                    radius = size.maxDimension * 0.48f
                ),
                radius = size.maxDimension * 0.48f,
                center = Offset(size.width * 0.12f, size.height * 0.85f)
            )
        }
        content()
    }
}

/**
 * Tactile Liquid Glass container powered by AGSL RuntimeShader refraction & specular sweep on Android 13+,
 * and crisp gradient highlight glass on Android 7-12, while keeping foreground content unblurred and sharp.
 */
@Composable
fun LiquidGlassSurface(
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(20.dp),
    tint: Color? = null,
    tintAlpha: Float = 0.14f,
    elevation: Dp = 6.dp,
    consumeTouches: Boolean = false,
    onClick: (() -> Unit)? = null,
    content: @Composable BoxScope.() -> Unit
) {
    val palette = LocalDragonClawPalette.current
    val resolvedTint = tint ?: palette.accent
    val appliedTintAlpha = if (tint != null) tintAlpha else 0f

    val borderBrush = remember(palette) {
        Brush.linearGradient(
            colors = listOf(palette.glassBorderBright, palette.glassBorderSoft, palette.glassBorderBright.copy(alpha = 0.35f))
        )
    }

    val clickableModifier = if (onClick != null) {
        Modifier.clickable(
            interactionSource = remember { MutableInteractionSource() },
            indication = null,
            onClick = onClick
        )
    } else if (consumeTouches) {
        // Absorb stray taps inside overlay containers (e.g. composer) so nothing behind can receive them
        Modifier.clickable(
            interactionSource = remember { MutableInteractionSource() },
            indication = null,
            onClick = {}
        )
    } else {
        Modifier
    }

    Box(
        modifier = modifier
            .shadow(
                elevation = elevation,
                shape = shape,
                ambientColor = Color.Black.copy(alpha = if (palette.isDark) 0.45f else 0.12f),
                spotColor = resolvedTint.copy(alpha = if (tint != null) 0.20f else 0.08f)
            )
            .clip(shape)
            .then(clickableModifier)
    ) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            AgslGlassFill(
                palette = palette,
                tint = resolvedTint,
                tintAlpha = appliedTintAlpha,
                modifier = Modifier.matchParentSize()
            )
        } else {
            Box(
                modifier = Modifier
                    .matchParentSize()
                    .background(
                        Brush.linearGradient(
                            colors = listOf(
                                palette.glassFillTop,
                                palette.glassFillBottom
                            )
                        )
                    )
                    .background(resolvedTint.copy(alpha = appliedTintAlpha))
            )
        }

        Box(
            modifier = Modifier
                .matchParentSize()
                .border(BorderStroke(1.dp, borderBrush), shape)
        )

        content()
    }
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
@Composable
private fun AgslGlassFill(
    palette: DragonClawPalette,
    tint: Color,
    tintAlpha: Float,
    modifier: Modifier = Modifier
) {
    val shader = remember { RuntimeShader(LIQUID_GLASS_AGSL) }
    val brush = remember(shader) { ShaderBrush(shader) }

    Canvas(modifier = modifier) {
        shader.setFloatUniform("uSize", size.width, size.height)
        shader.setFloatUniform(
            "uTopColor",
            palette.glassFillTop.red,
            palette.glassFillTop.green,
            palette.glassFillTop.blue,
            palette.glassFillTop.alpha
        )
        shader.setFloatUniform(
            "uBottomColor",
            palette.glassFillBottom.red,
            palette.glassFillBottom.green,
            palette.glassFillBottom.blue,
            palette.glassFillBottom.alpha
        )
        shader.setFloatUniform("uTintColor", tint.red, tint.green, tint.blue, 1f)
        shader.setFloatUniform("uTintAlpha", tintAlpha)
        drawRect(brush = brush)
    }
}

@Composable
fun GlassCircleIconButton(
    icon: ImageVector,
    contentDescription: String,
    modifier: Modifier = Modifier,
    tint: Color? = null,
    size: Dp = 36.dp,
    badgeCount: Int = 0,
    onClick: () -> Unit
) {
    val palette = LocalDragonClawPalette.current
    Box(modifier = modifier) {
        LiquidGlassSurface(
            modifier = Modifier.size(size),
            shape = CircleShape,
            elevation = 4.dp,
            onClick = onClick
        ) {
            Icon(
                imageVector = icon,
                contentDescription = contentDescription,
                tint = tint ?: palette.inkPrimary,
                modifier = Modifier
                    .size(18.dp)
                    .align(Alignment.Center)
            )
        }
        if (badgeCount > 0) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .size(9.dp)
                    .background(palette.danger, CircleShape)
            )
        }
    }
}

@Composable
fun <T> GlassSegmentedPill(
    options: List<Triple<T, String, ImageVector>>,
    selected: T,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier
) {
    val palette = LocalDragonClawPalette.current
    LiquidGlassSurface(
        modifier = modifier,
        shape = CircleShape,
        elevation = 5.dp
    ) {
        Row(
            modifier = Modifier.padding(3.5.dp),
            horizontalArrangement = Arrangement.spacedBy(3.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            options.forEach { (value, label, icon) ->
                val isSelected = value == selected
                Surface(
                    shape = CircleShape,
                    color = if (isSelected) palette.accent.copy(alpha = if (palette.isDark) 0.24f else 0.16f) else Color.Transparent,
                    onClick = { onSelect(value) }
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Icon(
                            imageVector = icon,
                            contentDescription = null,
                            tint = if (isSelected) palette.accentStrong else palette.inkSecondary,
                            modifier = Modifier.size(14.dp)
                        )
                        Text(
                            text = label,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (isSelected) palette.accentStrong else palette.inkSecondary
                        )
                    }
                }
            }
        }
    }
}
