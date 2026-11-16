package com.solartrey.mxtp.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.solartrey.mxtp.Art
import com.solartrey.mxtp.Song
import com.solartrey.mxtp.Store

fun fmt(ms: Long): String { val s = (ms / 1000).coerceAtLeast(0); return "%d:%02d".format(s / 60, s % 60) }

/** An album cover from the phone's thumbnails, with a quiet placeholder while it loads (or if there's none). */
@Composable
fun AlbumArt(albumId: Long, modifier: Modifier = Modifier, px: Int = 384, shape: Shape = RoundedCornerShape(4.dp)) {
    val ctx = LocalContext.current
    val bmp by produceState<Bitmap?>(Art.cached(albumId, px), albumId, px) { value = Art.load(ctx, albumId, px) }
    val pal = LocalPalette.current
    Box(modifier.clip(shape).background(pal.faint), contentAlignment = Alignment.Center) {
        val b = bmp
        if (b != null) Image(b.asImageBitmap(), null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        else Icon(Icons.Filled.MusicNote, null, tint = pal.sub, modifier = Modifier.size(28.dp))
    }
}

@Composable
fun Title(text: String, size: Int = 20, modifier: Modifier = Modifier) {
    Text(text, color = LocalPalette.current.text, fontSize = size.sp, fontWeight = FontWeight.SemiBold, modifier = modifier,
        maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
fun Sub(text: String, modifier: Modifier = Modifier, size: Int = 13) {
    Text(text, color = LocalPalette.current.sub, fontSize = size.sp, modifier = modifier, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

/** The top of each tab: mxtp's wordmark (or a title) and the settings cog. */
@Composable
fun TopBar(title: String?, onSettings: () -> Unit, actions: @Composable () -> Unit = {}) {
    val pal = LocalPalette.current
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 12.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        if (title == null) Text("mxtp", color = pal.accent, fontSize = 30.sp, fontWeight = FontWeight.Bold, letterSpacing = (-1).sp)
        else Text(title, color = pal.text, fontSize = 28.sp, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.weight(1f))
        actions()
        IconButton(onClick = onSettings) { Icon(Icons.Filled.Settings, "Settings", tint = pal.text) }
    }
}

@Composable
fun Pill(text: String, on: Boolean, onClick: () -> Unit) {
    val pal = LocalPalette.current
    Text(text, color = if (on) Color.White else pal.text, fontSize = 13.sp, fontWeight = FontWeight.Medium,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (on) pal.accent else pal.surface)
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp))
}

@Composable
fun HeartButton(liked: Boolean, onClick: () -> Unit, size: Dp = 24.dp) {
    IconButton(onClick = onClick) {
        Icon(if (liked) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, if (liked) "Unlike" else "Like",
            tint = if (liked) HeartPink else LocalPalette.current.sub, modifier = Modifier.size(size))
    }
}

/** What you can do with any song: like it, queue it, add it to a playlist. */
class SongActions(val player: PlayerState) {
    var addToPlaylist by mutableStateOf<List<Song>?>(null)
}

/** One song in a list, with its menu. */
@Composable
fun SongRow(song: Song, actions: SongActions, playingId: Long?, number: Int? = null, showArt: Boolean = true,
            extraMenu: (@Composable (close: () -> Unit) -> Unit)? = null, onClick: () -> Unit) {
    val pal = LocalPalette.current
    @Suppress("UNUSED_VARIABLE") val v = Store.version
    var menu by remember { mutableStateOf(false) }
    val current = song.id == playingId
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(start = 20.dp, end = 4.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically) {
        if (showArt) { AlbumArt(song.albumId, Modifier.size(46.dp), px = 128); Spacer(Modifier.width(12.dp)) }
        else if (number != null) { Text("$number", color = pal.sub, fontSize = 13.sp, modifier = Modifier.width(28.dp)) }
        Column(Modifier.weight(1f)) {
            Text(song.title, color = if (current) pal.accent else pal.text, fontSize = 15.sp, fontWeight = FontWeight.Medium,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            Sub(if (showArt) "${song.artist} · ${song.album}" else song.artist, size = 12)
        }
        if (Store.isLiked(song.id)) Icon(Icons.Filled.Favorite, "Liked", tint = HeartPink, modifier = Modifier.size(16.dp))
        Text(fmt(song.duration), color = pal.sub, fontSize = 12.sp, modifier = Modifier.padding(start = 8.dp))
        Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More", tint = pal.sub) }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text(if (Store.isLiked(song.id)) "Unlike" else "Like") },
                    onClick = { menu = false; actions.player.toggleLike(song.id) })
                DropdownMenuItem(text = { Text("Play next") }, onClick = { menu = false; actions.player.playNext(listOf(song)) })
                DropdownMenuItem(text = { Text("Add to queue") }, onClick = { menu = false; actions.player.addToQueue(listOf(song)) })
                DropdownMenuItem(text = { Text("Add to playlist…") }, onClick = { menu = false; actions.addToPlaylist = listOf(song) })
                extraMenu?.invoke { menu = false }
            }
        }
    }
}

/** Pick a playlist (or make one) for some songs. */
@Composable
fun AddToPlaylistDialog(songs: List<Song>, onDone: () -> Unit) {
    var naming by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    fun add(p: com.solartrey.mxtp.Playlist) { p.songs.addAll(songs.map { it.id }.filter { it !in p.songs }); Store.save(); onDone() }
    AlertDialog(
        onDismissRequest = onDone,
        title = { Text(if (naming) "New playlist" else "Add to playlist") },
        text = {
            if (naming) OutlinedTextField(name, { name = it }, singleLine = true, label = { Text("Name") })
            else LazyColumn(Modifier.height(320.dp)) {
                item {
                    Row(Modifier.fillMaxWidth().clickable { naming = true }.padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Add, null); Spacer(Modifier.width(12.dp)); Text("New playlist…")
                    }
                }
                items(Store.playlists) { p -> Text(p.name, Modifier.fillMaxWidth().clickable { add(p) }.padding(vertical = 12.dp)) }
            }
        },
        confirmButton = { if (naming) TextButton(onClick = { add(Store.newPlaylist(name)) }) { Text("Create") } },
        dismissButton = { TextButton(onClick = onDone) { Text("Cancel") } },
    )
}

@Composable
fun Empty(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Title(title, 18); Sub(body)
    }
}
