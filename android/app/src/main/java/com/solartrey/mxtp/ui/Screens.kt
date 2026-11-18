package com.solartrey.mxtp.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyGridState
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.solartrey.mxtp.Album
import com.solartrey.mxtp.Library
import com.solartrey.mxtp.Song
import com.solartrey.mxtp.Store
import kotlinx.coroutines.launch

/** Where you are in the app. */
sealed class Route {
    data object Home : Route()
    data class Lib(val tab: String = "Albums") : Route()
    data object Search : Route()
    data object Liked : Route()
    data object Settings : Route()
    data class AlbumR(val id: Long) : Route()
    data class ArtistR(val name: String) : Route()
    data class GenreR(val name: String) : Route()
    data class PlaylistR(val id: String) : Route()
}

class Ctx(val lib: Library, val player: PlayerState, val actions: SongActions, val go: (Route) -> Unit, val back: () -> Unit)

@Composable
private fun AlbumTile(a: Album, c: Ctx, modifier: Modifier = Modifier) {
    Column(modifier.clickable { c.go(Route.AlbumR(a.id)) }, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        AlbumArt(a.id, Modifier.fillMaxWidth().aspectRatio(1f))
        Column {
            Text(a.title, color = LocalPalette.current.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Sub(a.artist, size = 11)
        }
    }
}

@Composable
private fun SectionHead(title: String, action: String? = null, onAction: () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp), verticalAlignment = Alignment.Bottom) {
        Title(title, 20, Modifier.weight(1f))
        if (action != null) Text(action, color = LocalPalette.current.accent, fontSize = 13.sp, modifier = Modifier.clickable(onClick = onAction))
    }
}

// ---------------------------------------------------------------- Home: Heavy Rotation and Recently added
@Composable
fun HomeScreen(c: Ctx) {
    @Suppress("UNUSED_VARIABLE") val v = Store.version
    val top = c.lib.albums.filter { Store.albumPlays.containsKey(it.id) }
        .sortedByDescending { Store.albumPlays[it.id]!!.first }.take(8)
    val recent = c.lib.albums.sortedByDescending { it.added }.take(12)
    val rotation = top.ifEmpty { recent.take(8) }
    LazyVerticalGrid(GridCells.Fixed(2), contentPadding = PaddingValues(bottom = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            SectionHead("Heavy Rotation", "Play station") {
                val songs = rotation.flatMap { it.songs }.ifEmpty { c.lib.songs }
                c.player.play(songs, shuffled = true)
            }
        }
        if (c.lib.songs.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
            Empty("No music yet", "Put music on your phone (in Music or Downloads) and it'll show up here.")
        }
        items(rotation.size) { i ->
            AlbumTile(rotation[i], c, Modifier.padding(start = if (i % 2 == 0) 20.dp else 0.dp, end = if (i % 2 == 1) 20.dp else 0.dp))
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            Column {
                SectionHead("Recently added", "Shuffle all") { c.player.play(c.lib.songs, shuffled = true) }
                LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    items(recent) { a -> AlbumTile(a, c, Modifier.width(124.dp)) }
                }
            }
        }
    }
}

// ---------------------------------------------------------------- Library: Albums, Artists, Songs, Genres, Playlists
@Composable
fun LibraryScreen(c: Ctx, tab: String, setTab: (String) -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (t in listOf("Albums", "Artists", "Songs", "Genres", "Playlists")) Pill(t, t == tab) { setTab(t) }
        }
        when (tab) {
            "Artists" -> LetterList(c.lib.artists, { it.name }) { a ->
                Row(Modifier.fillMaxWidth().clickable { c.go(Route.ArtistR(a.name)) }.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    AlbumArt(a.albums.firstOrNull()?.id ?: 0, Modifier.size(48.dp), px = 128, shape = CircleShape)
                    Spacer(Modifier.width(14.dp))
                    Column { Title(a.name, 15); Sub("${a.albums.size} albums · ${a.songs.size} songs", size = 12) }
                }
            }
            "Songs" -> {
                val sorted = remember(c.lib) { c.lib.songs.sortedBy { Library.sortKey(it.title) } }
                LetterList(sorted, { it.title }) { s -> SongRow(s, c.actions, c.player.songId) { c.player.play(sorted, sorted.indexOf(s)) } }
            }
            "Genres" -> LazyColumn {
                items(c.lib.genres) { (g, songs) ->
                    Row(Modifier.fillMaxWidth().clickable { c.go(Route.GenreR(g)) }.padding(horizontal = 20.dp, vertical = 14.dp)) {
                        Title(g, 16, Modifier.weight(1f)); Sub("${songs.size} songs")
                    }
                }
            }
            "Playlists" -> PlaylistsList(c)
            else -> AlbumGrid(c, c.lib.albums)
        }
    }
}

/** The outlined letter tile that heads each section; tapping it brings up the whole alphabet. */
@Composable
private fun LetterTile(letter: Char, onClick: () -> Unit) {
    val pal = LocalPalette.current
    Box(Modifier.padding(start = 20.dp, top = 10.dp, bottom = 6.dp).size(32.dp).clip(RoundedCornerShape(4.dp))
        .border(1.5.dp, pal.accent, RoundedCornerShape(4.dp)).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Text(letter.toString(), color = pal.accent, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
    }
}

/** Jump to a letter: every letter, with the ones you have music under in bright text. */
@Composable
private fun JumpGrid(have: Set<Char>, onPick: (Char) -> Unit, onClose: () -> Unit) {
    val pal = LocalPalette.current
    Box(Modifier.fillMaxSize().background(pal.solidBg.copy(alpha = .94f)).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
        val letters = listOf('#') + ('A'..'Z').toList()
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            letters.chunked(4).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { l ->
                        val on = l in have
                        Box(Modifier.size(64.dp).clip(RoundedCornerShape(6.dp)).border(1.5.dp, if (on) pal.accent else pal.faint, RoundedCornerShape(6.dp))
                            .clickable(enabled = on) { onPick(l) }, contentAlignment = Alignment.Center) {
                            Text(l.toString(), color = if (on) pal.text else pal.faint, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun <T> LetterList(list: List<T>, name: (T) -> String, row: @Composable (T) -> Unit) {
    val groups = remember(list) { list.groupBy { Library.letterOf(name(it)) }.toSortedMap() }
    val state = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var jump by remember { mutableStateOf(false) }
    val headerIndex = remember(groups) {
        var i = 0; groups.mapValues { (_, v) -> val at = i; i += v.size + 1; at }
    }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(state = state, modifier = Modifier.fillMaxSize()) {
            groups.forEach { (letter, group) ->
                item(key = "h$letter") { LetterTile(letter) { jump = true } }
                items(group) { row(it) }
            }
        }
        if (jump) JumpGrid(groups.keys, { l -> jump = false; scope.launch { state.scrollToItem(headerIndex[l] ?: 0) } }, { jump = false })
    }
}

@Composable
fun AlbumGrid(c: Ctx, albums: List<Album>) {
    val groups = remember(albums) { albums.groupBy { Library.letterOf(it.title) }.toSortedMap() }
    val state: LazyGridState = rememberLazyGridState()
    val scope = rememberCoroutineScope()
    var jump by remember { mutableStateOf(false) }
    val headerIndex = remember(groups) { var i = 0; groups.mapValues { (_, v) -> val at = i; i += v.size + 1; at } }
    Box(Modifier.fillMaxSize()) {
        LazyVerticalGrid(GridCells.Fixed(3), state = state, contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            groups.forEach { (letter, list) ->
                item(key = "h$letter", span = { GridItemSpan(maxLineSpan) }) { Box(Modifier.padding(start = 0.dp)) { LetterTileNoPad(letter) { jump = true } } }
                items(list.size, key = { list[it].id }) { AlbumTile(list[it], c) }
            }
        }
        if (jump) JumpGrid(groups.keys, { l -> jump = false; scope.launch { state.scrollToItem(headerIndex[l] ?: 0) } }, { jump = false })
    }
}

@Composable
private fun LetterTileNoPad(letter: Char, onClick: () -> Unit) {
    val pal = LocalPalette.current
    Box(Modifier.padding(top = 8.dp).size(32.dp).clip(RoundedCornerShape(4.dp)).border(1.5.dp, pal.accent, RoundedCornerShape(4.dp)).clickable(onClick = onClick),
        contentAlignment = Alignment.Center) { Text(letter.toString(), color = pal.accent, fontWeight = FontWeight.SemiBold, fontSize = 15.sp) }
}

@Composable
fun PlaylistsList(c: Ctx) {
    @Suppress("UNUSED_VARIABLE") val v = Store.version
    var naming by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    val pal = LocalPalette.current
    LazyColumn {
        item {
            Row(Modifier.fillMaxWidth().clickable { naming = true }.padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(52.dp).clip(RoundedCornerShape(4.dp)).background(pal.surface), contentAlignment = Alignment.Center) { Icon(Icons.Filled.Add, null, tint = pal.accent) }
                Spacer(Modifier.width(14.dp)); Title("New playlist", 15)
            }
        }
        items(Store.playlists, key = { it.id }) { p ->
            Row(Modifier.fillMaxWidth().clickable { c.go(Route.PlaylistR(p.id)) }.padding(start = 20.dp, end = 8.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                AlbumArt(p.songs.firstNotNullOfOrNull { c.lib.byId[it] }?.albumId ?: 0, Modifier.size(52.dp), px = 128)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) { Title(p.name, 15); Sub("${p.songs.size} songs", size = 12) }
                IconButton(onClick = { p.fav = !p.fav; Store.save() }) {
                    Icon(if (p.fav) Icons.Filled.Star else Icons.Filled.StarBorder, if (p.fav) "Unfavourite" else "Favourite",
                        tint = if (p.fav) Color(0xFFF5B301) else pal.sub)
                }
            }
        }
    }
    if (naming) AlertDialog(onDismissRequest = { naming = false }, title = { Text("New playlist") },
        text = { OutlinedTextField(name, { name = it }, singleLine = true, label = { Text("Name") }) },
        confirmButton = { TextButton(onClick = { naming = false; val p = Store.newPlaylist(name); name = ""; c.go(Route.PlaylistR(p.id)) }) { Text("Create") } },
        dismissButton = { TextButton(onClick = { naming = false }) { Text("Cancel") } })
}

// ---------------------------------------------------------------- detail pages
@Composable
private fun DetailHeader(c: Ctx, title: String, sub: String, artId: Long?, songs: List<Song>, extra: @Composable () -> Unit = {}) {
    val pal = LocalPalette.current
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp)) {
        IconButton(onClick = c.back, modifier = Modifier.padding(top = 4.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = pal.text) }
        if (artId != null) AlbumArt(artId, Modifier.fillMaxWidth(0.62f).aspectRatio(1f).align(Alignment.CenterHorizontally), px = 768)
        Spacer(Modifier.height(14.dp))
        Text(title, color = pal.text, fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
        Sub(sub, size = 14)
        Row(Modifier.padding(vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.clip(RoundedCornerShape(50)).background(pal.accent).clickable { c.player.play(songs) }.padding(horizontal = 18.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.PlayArrow, null, tint = Color.White); Spacer(Modifier.width(6.dp)); Text("Play", color = Color.White, fontWeight = FontWeight.SemiBold)
            }
            Row(Modifier.clip(RoundedCornerShape(50)).background(pal.surface).clickable { c.player.play(songs, shuffled = true) }.padding(horizontal = 18.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Shuffle, null, tint = pal.text); Spacer(Modifier.width(6.dp)); Text("Shuffle", color = pal.text, fontWeight = FontWeight.SemiBold)
            }
            extra()
        }
    }
}

@Composable
fun AlbumScreen(c: Ctx, id: Long) {
    val a = c.lib.albumById[id] ?: return Empty("Album not found", "It may have been removed from your phone.")
    LazyColumn {
        item { DetailHeader(c, a.title, listOfNotNull(a.artist, a.year.takeIf { it > 0 }?.toString(), "${a.songs.size} songs").joinToString(" · "), a.id, a.songs) {
            IconButton(onClick = { c.actions.addToPlaylist = a.songs }) { Icon(Icons.Filled.Add, "Add album to a playlist", tint = LocalPalette.current.text) }
        } }
        itemsIndexed(a.songs) { i, s -> SongRow(s, c.actions, c.player.songId, number = if (s.track > 0) s.track else i + 1, showArt = false) { c.player.play(a.songs, i) } }
        item {
            Text("More by ${a.artist}", color = LocalPalette.current.accent, fontSize = 14.sp,
                modifier = Modifier.clickable { c.go(Route.ArtistR(a.artist)) }.padding(20.dp))
        }
    }
}

@Composable
fun ArtistScreen(c: Ctx, name: String) {
    val a = c.lib.artists.firstOrNull { it.name == name } ?: return Empty("Artist not found", "")
    LazyColumn {
        item { DetailHeader(c, a.name, "${a.albums.size} albums · ${a.songs.size} songs", null, a.albums.flatMap { it.songs }) }
        item {
            LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                items(a.albums) { al -> AlbumTile(al, c, Modifier.width(140.dp)) }
            }
        }
        item { SectionHead("Songs") }
        val songs = a.songs.sortedBy { it.title.lowercase() }
        itemsIndexed(songs) { i, s -> SongRow(s, c.actions, c.player.songId) { c.player.play(songs, i) } }
    }
}

@Composable
fun GenreScreen(c: Ctx, name: String) {
    val songs = c.lib.genres.firstOrNull { it.first == name }?.second?.sortedBy { Library.sortKey(it.artist) } ?: emptyList()
    LazyColumn {
        item { DetailHeader(c, name, "${songs.size} songs", null, songs) }
        itemsIndexed(songs) { i, s -> SongRow(s, c.actions, c.player.songId) { c.player.play(songs, i) } }
    }
}

@Composable
fun PlaylistScreen(c: Ctx, id: String) {
    @Suppress("UNUSED_VARIABLE") val v = Store.version
    val p = Store.playlists.firstOrNull { it.id == id } ?: return Empty("Playlist not found", "")
    val songs = p.songs.mapNotNull { c.lib.byId[it] }
    var renaming by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf(p.name) }
    val pal = LocalPalette.current
    LazyColumn {
        item {
            DetailHeader(c, p.name, "${songs.size} songs", songs.firstOrNull()?.albumId, songs) {
                IconButton(onClick = { p.fav = !p.fav; Store.save() }) { Icon(if (p.fav) Icons.Filled.Star else Icons.Filled.StarBorder, "Favourite", tint = if (p.fav) Color(0xFFF5B301) else pal.text) }
                IconButton(onClick = { renaming = true }) { Icon(Icons.Filled.Edit, "Rename", tint = pal.text) }
                IconButton(onClick = { deleting = true }) { Icon(Icons.Filled.Delete, "Delete", tint = pal.text) }
            }
        }
        if (songs.isEmpty()) item { Empty("Nothing here yet", "Add songs from any song's ⋮ menu.") }
        itemsIndexed(songs) { i, s ->
            SongRow(s, c.actions, c.player.songId, extraMenu = { close ->
                DropdownMenuItem(text = { Text("Remove from playlist") }, onClick = { close(); p.songs.remove(s.id); Store.save() })
            }) { c.player.play(songs, i) }
        }
    }
    if (renaming) AlertDialog(onDismissRequest = { renaming = false }, title = { Text("Rename playlist") },
        text = { OutlinedTextField(name, { name = it }, singleLine = true) },
        confirmButton = { TextButton(onClick = { renaming = false; p.name = name.ifBlank { p.name }; Store.save() }) { Text("Save") } },
        dismissButton = { TextButton(onClick = { renaming = false }) { Text("Cancel") } })
    if (deleting) AlertDialog(onDismissRequest = { deleting = false }, title = { Text("Delete “${p.name}”?") },
        text = { Text("The songs stay on your phone.") },
        confirmButton = { TextButton(onClick = { deleting = false; Store.playlists.remove(p); Store.save(); c.back() }) { Text("Delete") } },
        dismissButton = { TextButton(onClick = { deleting = false }) { Text("Cancel") } })
}

// ---------------------------------------------------------------- Liked: favourite playlists and liked songs
@Composable
fun LikedScreen(c: Ctx) {
    @Suppress("UNUSED_VARIABLE") val v = Store.version
    val pal = LocalPalette.current
    val liked = Store.liked.entries.sortedByDescending { it.value }.mapNotNull { c.lib.byId[it.key] }
    val favs = Store.playlists.filter { it.fav }
    LazyColumn {
        item { SectionHead("Favourite playlists", "All playlists") { c.go(Route.Lib("Playlists")) } }
        item {
            if (favs.isEmpty()) Sub("Star a playlist to keep it here.", Modifier.padding(horizontal = 20.dp))
            else LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                items(favs, key = { it.id }) { p ->
                    Column(Modifier.width(104.dp).clickable { c.go(Route.PlaylistR(p.id)) }) {
                        AlbumArt(p.songs.firstNotNullOfOrNull { c.lib.byId[it] }?.albumId ?: 0, Modifier.size(104.dp), px = 256)
                        Spacer(Modifier.height(6.dp)); Title(p.name, 13)
                    }
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Title("Liked songs", 20); Sub("${liked.size} songs", size = 12) }
                Box(Modifier.size(52.dp).clip(CircleShape).background(pal.accent).clickable { c.player.play(liked) }, contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.PlayArrow, "Play liked songs", tint = Color.White)
                }
            }
        }
        if (liked.isEmpty()) item { Empty("No liked songs yet", "Tap the heart on anything you love.") }
        itemsIndexed(liked, key = { _, s -> s.id }) { i, s -> SongRow(s, c.actions, c.player.songId) { c.player.play(liked, i) } }
    }
}

// ---------------------------------------------------------------- Search
@Composable
fun SearchScreen(c: Ctx) {
    var q by rememberSaveable { mutableStateOf("") }
    val pal = LocalPalette.current
    val needle = q.trim().lowercase()
    val songs = if (needle.length < 2) emptyList() else c.lib.songs.filter { needle in it.title.lowercase() || needle in it.artist.lowercase() }.take(40)
    val albums = if (needle.length < 2) emptyList() else c.lib.albums.filter { needle in it.title.lowercase() || needle in it.artist.lowercase() }.take(12)
    val artists = if (needle.length < 2) emptyList() else c.lib.artists.filter { needle in it.name.lowercase() }.take(8)
    LazyColumn {
        item {
            OutlinedTextField(q, { q = it }, singleLine = true, placeholder = { Text("Songs, albums, artists") },
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp),
                shape = RoundedCornerShape(50),
                colors = OutlinedTextFieldDefaults.colors(focusedTextColor = pal.text, unfocusedTextColor = pal.text,
                    focusedBorderColor = pal.accent, unfocusedBorderColor = pal.faint, cursorColor = pal.accent))
        }
        if (artists.isNotEmpty()) {
            item { SectionHead("Artists") }
            items(artists) { a -> Text(a.name, color = pal.text, fontSize = 15.sp, modifier = Modifier.fillMaxWidth().clickable { c.go(Route.ArtistR(a.name)) }.padding(horizontal = 20.dp, vertical = 10.dp)) }
        }
        if (albums.isNotEmpty()) {
            item { SectionHead("Albums") }
            item { LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) { items(albums) { a -> AlbumTile(a, c, Modifier.width(124.dp)) } } }
        }
        if (songs.isNotEmpty()) {
            item { SectionHead("Songs") }
            itemsIndexed(songs) { i, s -> SongRow(s, c.actions, c.player.songId) { c.player.play(songs, i) } }
        }
        if (needle.length >= 2 && songs.isEmpty() && albums.isEmpty() && artists.isEmpty()) item { Empty("Nothing found", "Try another word.") }
    }
}

// ---------------------------------------------------------------- Settings
@Composable
fun SettingsScreen(c: Ctx, onRescan: () -> Unit) {
    @Suppress("UNUSED_VARIABLE") val v = Store.version
    val pal = LocalPalette.current
    @Composable fun group(title: String, body: @Composable () -> Unit) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp)) {
            Text(title.uppercase(), color = pal.sub, fontSize = 11.sp, letterSpacing = 1.4.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(10.dp)); body()
        }
    }
    @Composable fun choices(opts: List<Pair<String, String>>, cur: String, set: (String) -> Unit) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { opts.forEach { (k, label) -> Pill(label, k == cur) { set(k) } } }
    }
    LazyColumn {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = c.back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = pal.text) }
                Title("Settings", 24)
            }
        }
        item { group("Theme") { choices(listOf("light" to "Light", "evening" to "Evening", "midnight" to "Midnight"), Store.theme) { Store.set { theme = it } } } }
        if (Store.theme == "evening") item { group("Evening colour") { choices(listOf("purple" to "Purple", "amber" to "Amber", "both" to "Both"), Store.tone) { Store.set { tone = it } } } }
        if (Store.theme == "light") item {
            group("Title line") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Blue line under the top bar", color = pal.text, modifier = Modifier.weight(1f))
                    Switch(Store.lightLine, { Store.set { lightLine = it } }, colors = SwitchDefaults.colors(checkedTrackColor = pal.accent))
                }
            }
        }
        item { group("Now Playing") { choices(listOf("vinyl" to "Vinyl", "cd" to "CD", "cassette" to "Cassette"), Store.media) { Store.set { media = it } } } }
        item {
            group("Your music") {
                Sub("${c.lib.songs.size} songs · ${c.lib.albums.size} albums · ${c.lib.artists.size} artists", size = 13)
                Spacer(Modifier.height(10.dp)); Pill("Rescan my music", false, onRescan)
            }
        }
        item { group("About") { Sub("mxtp for Android 0.2.1 · your music, front and centre", size = 13) } }
    }
}
