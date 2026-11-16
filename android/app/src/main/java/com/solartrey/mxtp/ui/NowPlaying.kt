package com.solartrey.mxtp.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.Player
import com.solartrey.mxtp.Song
import com.solartrey.mxtp.Store

// ---------------------------------------------------------------- the mini player above the tabs
@Composable
fun MiniPlayer(c: Ctx, onOpen: () -> Unit) {
    @Suppress("UNUSED_VARIABLE") val v = Store.version
    val pal = LocalPalette.current
    val s = c.player.songId?.let { c.lib.byId[it] } ?: return
    Column(Modifier.padding(horizontal = 10.dp, vertical = 6.dp).shadow(12.dp, RoundedCornerShape(12.dp))
        .clip(RoundedCornerShape(12.dp)).background(if (pal.light) Color.White else Color(0xFF16191E)).clickable(onClick = onOpen)) {
        Row(Modifier.padding(start = 10.dp, end = 4.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            AlbumArt(s.albumId, Modifier.size(44.dp), px = 128, shape = RoundedCornerShape(6.dp))
            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                Text(s.title, color = if (pal.light) pal.text else Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Sub(s.artist, size = 12)
            }
            HeartButton(Store.isLiked(s.id), { c.player.toggleLike(s.id) }, 22.dp)
            Box(Modifier.size(44.dp).clip(CircleShape).background(pal.accent).clickable { c.player.toggle() }, contentAlignment = Alignment.Center) {
                Icon(if (c.player.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (c.player.playing) "Pause" else "Play", tint = Color.White)
            }
            Spacer(Modifier.width(6.dp))
        }
        val frac = if (c.player.duration > 0) c.player.position.toFloat() / c.player.duration else 0f
        Box(Modifier.fillMaxWidth().height(3.dp).background(pal.faint)) {
            Box(Modifier.fillMaxWidth(frac.coerceIn(0f, 1f)).height(3.dp).background(pal.accent))
        }
    }
}

// ---------------------------------------------------------------- Now Playing
@Composable
fun NowPlayingScreen(c: Ctx, onClose: () -> Unit) {
    @Suppress("UNUSED_VARIABLE") val v = Store.version
    val pal = LocalPalette.current
    val p = c.player
    val s = p.songId?.let { c.lib.byId[it] }
    var showQueue by remember { mutableStateOf(false) }
    val fg = if (pal.light) pal.text else Color.White
    Box(Modifier.fillMaxSize().background(pal.nowPlaying).statusBarsPadding().navigationBarsPadding()) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.Filled.KeyboardArrowDown, "Close", tint = fg, modifier = Modifier.size(30.dp)) }
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("PLAYING FROM", color = fg.copy(alpha = .65f), fontSize = 11.sp, letterSpacing = 1.6.sp)
                    Text(s?.album ?: "Nothing playing", color = fg, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                IconButton(onClick = { showQueue = true }) { Icon(Icons.AutoMirrored.Filled.QueueMusic, "Queue", tint = fg) }
            }
            Box(Modifier.fillMaxWidth().weight(1f).padding(horizontal = 24.dp), contentAlignment = Alignment.Center) {
                if (s != null) MediaStage(s, p.playing, Store.media)
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 28.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(s?.title ?: "", color = fg, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(listOfNotNull(s?.artist, s?.year?.takeIf { it > 0 }?.toString()).joinToString(" · "), color = fg.copy(alpha = .75f), fontSize = 15.sp,
                        maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.clickable { s?.let { c.go(Route.ArtistR(it.artist)); onClose() } })
                }
                if (s != null) HeartButton(Store.isLiked(s.id), { p.toggleLike(s.id) }, 28.dp)
            }
            var dragging by remember { mutableStateOf(false) }
            var dragPos by remember { mutableFloatStateOf(0f) }
            val frac = if (p.duration > 0) p.position.toFloat() / p.duration else 0f
            Slider(value = if (dragging) dragPos else frac.coerceIn(0f, 1f), onValueChange = { dragging = true; dragPos = it },
                onValueChangeFinished = { p.seek((dragPos * p.duration).toLong()); dragging = false },
                modifier = Modifier.padding(horizontal = 20.dp),
                colors = SliderDefaults.colors(thumbColor = fg, activeTrackColor = pal.accent, inactiveTrackColor = fg.copy(alpha = .25f)))
            Row(Modifier.fillMaxWidth().padding(horizontal = 28.dp)) {
                Text(fmt(if (dragging) (dragPos * p.duration).toLong() else p.position), color = fg.copy(alpha = .7f), fontSize = 12.sp)
                Spacer(Modifier.weight(1f))
                Text(fmt(p.duration), color = fg.copy(alpha = .7f), fontSize = 12.sp)
            }
            // play/pause stays dead centre
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = p::toggleShuffle) { Icon(Icons.Filled.Shuffle, "Shuffle", tint = if (p.shuffle) pal.accent else fg.copy(alpha = .75f)) }
                IconButton(onClick = p::prev, modifier = Modifier.size(56.dp)) { Icon(Icons.Filled.SkipPrevious, "Previous", tint = fg, modifier = Modifier.size(36.dp)) }
                Box(Modifier.size(76.dp).shadow(14.dp, CircleShape).clip(CircleShape).background(pal.accent).clickable { p.toggle() }, contentAlignment = Alignment.Center) {
                    Icon(if (p.playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (p.playing) "Pause" else "Play", tint = Color.White, modifier = Modifier.size(38.dp))
                }
                IconButton(onClick = p::next, modifier = Modifier.size(56.dp)) { Icon(Icons.Filled.SkipNext, "Next", tint = fg, modifier = Modifier.size(36.dp)) }
                IconButton(onClick = p::cycleRepeat) {
                    Icon(if (p.repeat == Player.REPEAT_MODE_ONE) Icons.Filled.RepeatOne else Icons.Filled.Repeat, "Repeat",
                        tint = if (p.repeat != Player.REPEAT_MODE_OFF) pal.accent else fg.copy(alpha = .75f))
                }
            }
            Row(Modifier.fillMaxWidth().padding(bottom = 18.dp, top = 4.dp), horizontalArrangement = Arrangement.Center) {
                for ((k, label) in listOf("vinyl" to "Vinyl", "cd" to "CD", "cassette" to "Cassette")) {
                    Text(label, color = fg.copy(alpha = if (Store.media == k) 1f else .7f), fontSize = 12.sp,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (Store.media == k) fg.copy(alpha = .14f) else Color.Transparent)
                            .clickable { Store.set { media = k } }.padding(horizontal = 14.dp, vertical = 7.dp))
                }
            }
        }
        AnimatedVisibility(showQueue, enter = slideInVertically { it } + fadeIn(), exit = slideOutVertically { it } + fadeOut()) {
            QueueSheet(c) { showQueue = false }
        }
    }
}

@Composable
private fun QueueSheet(c: Ctx, onClose: () -> Unit) {
    val pal = LocalPalette.current
    val state = rememberLazyListState()
    LaunchedEffect(Unit) { state.scrollToItem((c.player.index - 1).coerceAtLeast(0)) }
    Column(Modifier.fillMaxSize().background(pal.solidBg)) {
        Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Title("Up next", 22, Modifier.weight(1f))
            IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "Close", tint = pal.text) }
        }
        LazyColumn(state = state) {
            itemsIndexed(c.player.queue) { i, id ->
                val s = c.lib.byId[id] ?: return@itemsIndexed
                SongRow(s, c.actions, c.player.songId, extraMenu = { close ->
                    androidx.compose.material3.DropdownMenuItem(text = { Text("Remove from queue") }, onClick = { close(); c.player.removeAt(i) })
                }) { c.player.playAt(i) }
            }
        }
    }
}

// ---------------------------------------------------------------- the record, CD or cassette
@Composable
fun MediaStage(s: Song, playing: Boolean, media: String) {
    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        val size = minOf(maxWidth * 0.8f, maxHeight * 0.92f)
        val spin = rememberInfiniteTransition(label = "spin")
        val angle by spin.animateFloat(0f, 360f, infiniteRepeatable(tween(if (media == "cd") 1200 else 1800, easing = LinearEasing), RepeatMode.Restart), label = "angle")
        val out by animateFloatAsState(if (playing) 1f else 0f, tween(900), label = "out")
        if (media == "cassette") { Cassette(s, playing, size.value, angle); return@BoxWithConstraints }
        // the cover stays centred; the record or CD slides half out to the right while playing, back in when paused
        Box(Modifier.size(size), contentAlignment = Alignment.Center) {
            Box(Modifier.size(size * 0.96f).offset(x = size * 0.36f * out).rotate(if (playing) angle else 0f)) {
                if (media == "cd") Cd(s) else Vinyl(s)
            }
            AlbumArt(s.albumId, Modifier.size(size).shadow(18.dp, RoundedCornerShape(2.dp)), px = 1024, shape = RoundedCornerShape(2.dp))
        }
    }
}

@Composable
private fun Vinyl(s: Song) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val r = size.minDimension / 2
            drawCircle(Color(0xFF0E0E10), r)
            var g = r * 0.98f
            while (g > r * 0.36f) { drawCircle(Color(0xFF1E1F22), g, style = Stroke(width = 1.2f)); g -= 5f }
            drawCircle(Brush.sweepGradient(listOf(Color.Transparent, Color.White.copy(alpha = .08f), Color.Transparent, Color.Transparent, Color.White.copy(alpha = .06f), Color.Transparent)), r)
        }
        AlbumArt(s.albumId, Modifier.fillMaxSize(0.33f), px = 256, shape = CircleShape)
        Box(Modifier.size(8.dp).clip(CircleShape).background(Color(0xFF111111)))
    }
}

@Composable
private fun Cd(s: Song) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val r = size.minDimension / 2
            drawCircle(Brush.sweepGradient(listOf(Color(0xFFE6E9EE), Color(0xFFB9C9F0), Color(0xFFF2D7EF), Color(0xFFC9F0E4), Color(0xFFF4EFC9), Color(0xFFE6E9EE))), r)
            drawCircle(Color.White.copy(alpha = .25f), r, style = Stroke(width = 2f))
        }
        AlbumArt(s.albumId, Modifier.fillMaxSize(0.62f), px = 512, shape = CircleShape)
        Box(Modifier.fillMaxSize(0.2f).clip(CircleShape).background(Color(0xFFDADDE2)))
        Box(Modifier.fillMaxSize(0.1f).clip(CircleShape).background(Color.Black.copy(alpha = .85f)))
    }
}

/** The cassette while playing (hubs turning, tape moving across); its case with the album art when paused. */
@Composable
private fun Cassette(s: Song, playing: Boolean, sizeDp: Float, angle: Float) {
    val w = sizeDp.dp
    Box(Modifier.size(w), contentAlignment = Alignment.Center) {
        AnimatedVisibility(!playing, enter = fadeIn(tween(500)), exit = fadeOut(tween(400))) {
            // the case: clear plastic over a J-card
            Column(Modifier.height(w).aspectRatio(128f / 200f).shadow(18.dp, RoundedCornerShape(4.dp)).clip(RoundedCornerShape(4.dp))
                .background(Color(0xFFF2EFE8))) {
                Box(Modifier.fillMaxWidth().height(10.dp).background(Brush.verticalGradient(listOf(Color(0xFF2A2C30), Color(0xFF9EA2A8), Color(0xFF151619)))))
                AlbumArt(s.albumId, Modifier.fillMaxWidth().aspectRatio(1f), px = 768, shape = RoundedCornerShape(0.dp))
                Box(Modifier.fillMaxWidth().height(4.dp).background(RdioBlue))
                Column(Modifier.padding(horizontal = 10.dp, vertical = 8.dp).weight(1f)) {
                    Text(s.album, color = Color(0xFF1B1D21), fontWeight = FontWeight.Bold, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(s.artist, color = Color(0xFF555B63), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Box(Modifier.fillMaxWidth().height(10.dp).background(Brush.verticalGradient(listOf(Color(0xFF2A2C30), Color(0xFF9EA2A8), Color(0xFF151619)))))
            }
        }
        AnimatedVisibility(playing, enter = fadeIn(tween(500)), exit = fadeOut(tween(400))) {
            Box(Modifier.fillMaxWidth().aspectRatio(200f / 127f).shadow(16.dp, RoundedCornerShape(10.dp)).clip(RoundedCornerShape(10.dp))) {
                Canvas(Modifier.fillMaxSize()) {
                    val k = size.width / 200f
                    fun r(x: Float, y: Float, ww: Float, hh: Float, c: Color, rad: Float = 0f) =
                        drawRoundRect(c, Offset(x * k, y * k), Size(ww * k, hh * k), CornerRadius(rad * k))
                    r(0f, 0f, 200f, 127f, Color(0xFF34363C), 6f)                         // smoky shell
                    r(13f, 11f, 174f, 73f, Color(0xFFDADDD8), 3f)                         // label
                    r(18f, 14.5f, 164f, 27f, Color(0xFFF7F7F3), 1.5f)                     // writing area
                    r(13f, 72f, 174f, 10f, RdioBlue)                                      // stripe
                    r(40f, 44.5f, 120f, 23f, Color(0xFF121315), 2f)                       // window
                    val prog = 0.3f
                    drawCircle(Color(0xFF3A2A22), (9f + 18f * (1 - prog)) * k * 0.62f, Offset(70f * k, 56f * k))   // tape packs
                    drawCircle(Color(0xFF3A2A22), (9f + 18f * prog) * k * 0.62f, Offset(130f * k, 56f * k))
                    for (cx in listOf(70f, 130f)) {
                        drawCircle(Color(0xFFE9E8E3), 7.6f * k, Offset(cx * k, 56f * k))
                        drawCircle(Color(0xFF141517), 4.6f * k, Offset(cx * k, 56f * k))
                        for (t in 0 until 6) {
                            val a = Math.toRadians((angle + t * 60f).toDouble())
                            drawCircle(Color(0xFFF2F1EC), 0.9f * k, Offset((cx + 3.6f * Math.sin(a).toFloat()) * k, (56f - 3.6f * Math.cos(a).toFloat()) * k))
                        }
                    }
                    val trap = androidx.compose.ui.graphics.Path().apply {
                        moveTo(48f * k, 127f * k); lineTo(55.5f * k, 98.5f * k); lineTo(144.5f * k, 98.5f * k); lineTo(152f * k, 127f * k); close()
                    }
                    drawPath(trap, Color.White.copy(alpha = .06f))
                    for (x in listOf(8.5f, 191.5f)) for (y in listOf(8.5f, 118.5f)) drawCircle(Color(0xFF55585E), 2.5f * k, Offset(x * k, y * k))
                    drawCircle(Color(0xFF55585E), 2.5f * k, Offset(100f * k, 91.5f * k))
                }
                // handwritten title lines on the label
                Column(Modifier.fillMaxWidth().padding(start = (w.value * 0.11f).dp, end = (w.value * 0.1f).dp, top = (w.value * 0.06f).dp)) {
                    Text(s.title, color = Color(0xFF1E2B55), fontFamily = FontFamily.Cursive, fontStyle = FontStyle.Italic, fontSize = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${s.artist} — ${s.album}", color = Color(0xFF33406B), fontFamily = FontFamily.Cursive, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text("A", color = Color(0xFF16171A), fontWeight = FontWeight.Bold, fontSize = 22.sp,
                    modifier = Modifier.align(Alignment.CenterStart).padding(start = (w.value * 0.08f).dp))
            }
        }
    }
}
