package com.solartrey.mxtp

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.LibraryMusic
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.solartrey.mxtp.ui.AddToPlaylistDialog
import com.solartrey.mxtp.ui.AlbumScreen
import com.solartrey.mxtp.ui.ArtistScreen
import com.solartrey.mxtp.ui.Ctx
import com.solartrey.mxtp.ui.Empty
import com.solartrey.mxtp.ui.GenreScreen
import com.solartrey.mxtp.ui.HomeScreen
import com.solartrey.mxtp.ui.LibraryScreen
import com.solartrey.mxtp.ui.LikedScreen
import com.solartrey.mxtp.ui.LocalPalette
import com.solartrey.mxtp.ui.MiniPlayer
import com.solartrey.mxtp.ui.NowPlayingScreen
import com.solartrey.mxtp.ui.PlayerState
import com.solartrey.mxtp.ui.PlaylistScreen
import com.solartrey.mxtp.ui.Route
import com.solartrey.mxtp.ui.SearchScreen
import com.solartrey.mxtp.ui.SettingsScreen
import com.solartrey.mxtp.ui.SongActions
import com.solartrey.mxtp.ui.TopBar
import com.solartrey.mxtp.ui.currentPalette
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var player: PlayerState

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Store.init(this)
        player = PlayerState(this)
        setContent { App(player) }
    }

    override fun onStart() { super.onStart(); player.connect() }
    override fun onStop() { player.release(); super.onStop() }
}

private fun audioPermission() = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE

@Composable
fun App(player: PlayerState) {
    val pal = currentPalette()
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(ctx, audioPermission()) == PackageManager.PERMISSION_GRANTED) }
    var lib by remember { mutableStateOf(Repo.library) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { r -> granted = r[audioPermission()] == true }
    LaunchedEffect(Unit) {
        if (!granted) ask.launch(buildList { add(audioPermission()); if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS) }.toTypedArray())
    }
    LaunchedEffect(granted) { if (granted && lib == null) lib = Repo.library(ctx) }

    val stack = remember { mutableStateListOf<Route>(Route.Home) }
    var npOpen by remember { mutableStateOf(false) }
    val actions = remember { SongActions(player) }
    fun go(r: Route) { if (r is Route.Home || r is Route.Lib || r is Route.Search || r is Route.Liked) { stack.clear() }; stack.add(r) }
    fun back() { if (stack.size > 1) stack.removeAt(stack.lastIndex) }
    BackHandler(enabled = npOpen || stack.size > 1) { if (npOpen) npOpen = false else back() }

    val scheme = if (pal.light) lightColorScheme(primary = pal.accent) else darkColorScheme(primary = pal.accent)
    MaterialTheme(colorScheme = scheme) {
        CompositionLocalProvider(LocalPalette provides pal) {
            Box(Modifier.fillMaxSize().background(pal.bg)) {
                val l = lib
                if (!granted || l == null) {
                    Column(Modifier.fillMaxSize().statusBarsPadding(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("mxtp", color = pal.accent, fontSize = 44.sp, fontWeight = FontWeight.Bold)
                        if (!granted) {
                            Empty("Let mxtp see your music", "mxtp plays the songs on your phone. Nothing leaves it.")
                            Text("Allow access", color = Color.White, fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.clip(RoundedCornerShape(50)).background(pal.accent)
                                    .clickable { ask.launch(arrayOf(audioPermission())) }.padding(horizontal = 22.dp, vertical = 12.dp))
                        } else Empty("Finding your music…", "")
                    }
                    return@Box
                }
                val c = Ctx(l, player, actions, ::go, ::back)
                val route = stack.last()
                Column(Modifier.fillMaxSize().statusBarsPadding()) {
                    pal.line?.let { Box(Modifier.fillMaxWidth().height(2.dp).background(it)) }
                    val tab = when (route) { is Route.Lib -> "Library"; Route.Search -> "Search"; Route.Liked -> "Liked"; Route.Home -> null; else -> "" }
                    if (tab != "") TopBar(tab, { go(Route.Settings) })
                    Box(Modifier.weight(1f)) {
                        when (route) {
                            Route.Home -> HomeScreen(c)
                            is Route.Lib -> LibraryScreen(c, route.tab) { t -> stack[stack.lastIndex] = Route.Lib(t) }
                            Route.Search -> SearchScreen(c)
                            Route.Liked -> LikedScreen(c)
                            Route.Settings -> SettingsScreen(c) { scope.launch { Repo.library = null; lib = Repo.library(ctx) } }
                            is Route.AlbumR -> AlbumScreen(c, route.id)
                            is Route.ArtistR -> ArtistScreen(c, route.name)
                            is Route.GenreR -> GenreScreen(c, route.name)
                            is Route.PlaylistR -> PlaylistScreen(c, route.id)
                        }
                    }
                    MiniPlayer(c) { npOpen = true }
                    BottomNav(stack.first(), ::go)
                }
                AnimatedVisibility(npOpen, enter = slideInVertically { it }, exit = slideOutVertically { it }) {
                    NowPlayingScreen(c) { npOpen = false }
                }
                actions.addToPlaylist?.let { songs -> AddToPlaylistDialog(songs) { actions.addToPlaylist = null } }
            }
        }
    }
    DisposableEffect(Unit) { onDispose { } }
}

@Composable
private fun BottomNav(root: Route, go: (Route) -> Unit) {
    val pal = LocalPalette.current
    val items = listOf(
        Triple(Route.Home, "Home", Icons.Filled.Home),
        Triple(Route.Lib(), "Library", Icons.AutoMirrored.Filled.LibraryMusic),
        Triple(Route.Search, "Search", Icons.Filled.Search),
        Triple(Route.Liked, "Liked", Icons.Filled.Favorite),
    )
    Row(Modifier.fillMaxWidth().background(if (pal.light) Color.White else Color(0xFF0B0D10)).navigationBarsPadding().padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.SpaceAround) {
        for ((r, label, ic) in items) {
            val on = r::class == root::class
            Column(Modifier.clip(RoundedCornerShape(12.dp)).clickable { go(r) }.padding(horizontal = 14.dp, vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(ic, label, tint = if (on) pal.accent else pal.sub, modifier = Modifier.size(24.dp))
                Text(label, color = if (on) pal.accent else pal.sub, fontSize = 11.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium)
            }
        }
    }
}
