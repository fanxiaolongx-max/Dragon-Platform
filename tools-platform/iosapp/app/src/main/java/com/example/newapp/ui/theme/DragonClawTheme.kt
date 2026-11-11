package com.example.newapp.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

@Immutable
data class DragonClawPalette(
    val isDark: Boolean,
    val background: Color,
    val elevatedSurface: Color,
    val cardSurface: Color,
    val chipSurface: Color,
    val userBubble: Color,
    val hairLine: Color,
    val inkPrimary: Color,
    val inkSecondary: Color,
    val inkMuted: Color,
    val accent: Color,
    val accentStrong: Color,
    val danger: Color,
    val warning: Color,
    val info: Color,
    val glassFillTop: Color,
    val glassFillBottom: Color,
    val glassBorderBright: Color,
    val glassBorderSoft: Color
)

val LightDragonClawPalette = DragonClawPalette(
    isDark = false,
    background = Color(0xFFFFFFFF),
    elevatedSurface = Color(0xFFF7F7F8),
    cardSurface = Color(0xFFFFFFFF),
    chipSurface = Color(0xFFF2F2F4),
    userBubble = Color(0xFFEFF7F4),
    hairLine = Color(0x14000000),
    inkPrimary = Color(0xFF1F2328),
    inkSecondary = Color(0xFF4B5563),
    inkMuted = Color(0xFF69717D),
    accent = Color(0xFF10A37F),
    accentStrong = Color(0xFF087F62),
    danger = Color(0xFFEF4444),
    warning = Color(0xFFF59E0B),
    info = Color(0xFF3B82F6),
    glassFillTop = Color(0xE8FFFFFF),
    glassFillBottom = Color(0xCCF3F6F8),
    glassBorderBright = Color(0xF5FFFFFF),
    glassBorderSoft = Color(0x220F172A)
)

val DarkDragonClawPalette = DragonClawPalette(
    isDark = true,
    background = Color(0xFF0F1115),
    elevatedSurface = Color(0xFF15181D),
    cardSurface = Color(0xFF1B1F26),
    chipSurface = Color(0xFF1E232B),
    userBubble = Color(0xFF1F2937),
    hairLine = Color(0x1FFFFFFF),
    inkPrimary = Color(0xFFE6E8EB),
    inkSecondary = Color(0xFFB3B9C2),
    inkMuted = Color(0xFF8D96A3),
    accent = Color(0xFF3ECF9E),
    accentStrong = Color(0xFF10A37F),
    danger = Color(0xFFEF4444),
    warning = Color(0xFFF59E0B),
    info = Color(0xFF60A5FA),
    glassFillTop = Color(0xC9232934),
    glassFillBottom = Color(0xAD151921),
    glassBorderBright = Color(0x4DFFFFFF),
    glassBorderSoft = Color(0x1AFFFFFF)
)

val LocalDragonClawPalette = staticCompositionLocalOf { LightDragonClawPalette }

@Composable
fun DragonClawTheme(
    isDark: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val palette = if (isDark) DarkDragonClawPalette else LightDragonClawPalette
    val colorScheme = if (isDark) {
        darkColorScheme(
            primary = palette.accent,
            onPrimary = Color.Black,
            secondary = palette.accentStrong,
            background = palette.background,
            surface = palette.cardSurface,
            onBackground = palette.inkPrimary,
            onSurface = palette.inkPrimary,
            error = palette.danger
        )
    } else {
        lightColorScheme(
            primary = palette.accentStrong,
            onPrimary = Color.White,
            secondary = palette.accent,
            background = palette.background,
            surface = palette.cardSurface,
            onBackground = palette.inkPrimary,
            onSurface = palette.inkPrimary,
            error = palette.danger
        )
    }

    CompositionLocalProvider(LocalDragonClawPalette provides palette) {
        MaterialTheme(colorScheme = colorScheme, content = content)
    }
}

fun tr(language: String, zh: String, en: String): String =
    if (language == "en") en else zh
