package com.solartrey.mxtp.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import com.solartrey.mxtp.Store

val RdioBlue = Color(0xFF008FD5)
val RdioBlueLight = Color(0xFF3FB6F0)
val HeartPink = Color(0xFFFF3D8B)

/** mxtp's three looks, with Rdio blue as the accent in all of them. */
data class Palette(
    val light: Boolean,
    val bg: Brush,
    val solidBg: Color,
    val surface: Color,
    val card: Color,
    val text: Color,
    val sub: Color,
    val faint: Color,
    val line: Brush?,          // the thin neon line under the top bar
    val nowPlaying: Brush,     // Now Playing's background
    val accent: Color = RdioBlue,
)

private fun fade(vararg c: Color) = Brush.horizontalGradient(listOf(Color.Transparent, *c, Color.Transparent))

fun paletteFor(theme: String, tone: String, lightLine: Boolean): Palette = when (theme) {
    "light" -> Palette(
        light = true, bg = Brush.verticalGradient(listOf(Color.White, Color.White)), solidBg = Color.White,
        surface = Color(0xFFF2F5F7), card = Color.White, text = Color(0xFF1B1D21), sub = Color(0xFF5B626B), faint = Color(0xFFE3E7EB),
        line = if (lightLine) fade(RdioBlue, RdioBlueLight) else null,
        nowPlaying = Brush.verticalGradient(listOf(Color(0xFFF7F9FB), Color(0xFFE4EBF1))),
    )
    "evening" -> {
        val (top, bottom, line) = when (tone) {
            "purple" -> Triple(Color(0xFF3A1E64), Color(0xFF140A26), fade(Color(0xFF6A3CC0), Color(0xFFB25AE0)))
            "amber" -> Triple(Color(0xFF5A2E10), Color(0xFF180C04), fade(Color(0xFFC86E1E), Color(0xFFF0A030)))
            else -> Triple(Color(0xFF3A1F5C), Color(0xFF4A2410), fade(Color(0xFF7A44C8), Color(0xFFF0A030)))
        }
        Palette(
            light = false, bg = Brush.verticalGradient(listOf(top, bottom)), solidBg = bottom,
            surface = Color.White.copy(alpha = .08f), card = Color(0xFF1E1426), text = Color.White, sub = Color(0xFFC9C0D6), faint = Color.White.copy(alpha = .14f),
            line = line,
            nowPlaying = Brush.verticalGradient(listOf(top, Color(0xFF241238), bottom)),
        )
    }
    else -> Palette(
        light = false, bg = Brush.verticalGradient(listOf(Color.Black, Color.Black)), solidBg = Color.Black,
        surface = Color(0xFF16191E), card = Color(0xFF16191E), text = Color.White, sub = Color(0xFF9AA3AD), faint = Color(0xFF242930),
        line = fade(RdioBlue, RdioBlueLight),
        nowPlaying = Brush.verticalGradient(listOf(Color(0xFF0C141C), Color.Black)),
    )
}

val LocalPalette = staticCompositionLocalOf { paletteFor("midnight", "both", false) }

@Composable
fun currentPalette(): Palette {
    @Suppress("UNUSED_VARIABLE") val v = Store.version   // redraw when settings change
    return paletteFor(Store.theme, Store.tone, Store.lightLine)
}
