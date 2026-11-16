package com.solartrey.mxtp.ui

import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.MoreExecutors
import com.solartrey.mxtp.LIKE_ACTION
import com.solartrey.mxtp.PlaybackService
import com.solartrey.mxtp.Song
import com.solartrey.mxtp.Store
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** The screens' view of the player: what's playing, and buttons to change it. */
class PlayerState(private val ctx: Context) {
    private var controller: MediaController? = null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    var songId by mutableStateOf<Long?>(null); private set
    var playing by mutableStateOf(false); private set
    var position by mutableLongStateOf(0L); private set
    var duration by mutableLongStateOf(0L); private set
    var queue by mutableStateOf<List<Long>>(emptyList()); private set
    var index by mutableIntStateOf(0); private set
    var shuffle by mutableStateOf(false); private set
    var repeat by mutableIntStateOf(Player.REPEAT_MODE_OFF); private set

    fun connect() {
        val token = SessionToken(ctx, ComponentName(ctx, PlaybackService::class.java))
        val future = MediaController.Builder(ctx, token).buildAsync()
        future.addListener({
            val c = try { future.get() } catch (_: Exception) { return@addListener }
            controller = c
            c.addListener(object : Player.Listener {
                override fun onEvents(player: Player, events: Player.Events) = sync()
            })
            sync()
        }, MoreExecutors.directExecutor())
        scope.launch {
            while (isActive) {
                controller?.let { position = it.currentPosition.coerceAtLeast(0); duration = it.duration.coerceAtLeast(0) }
                delay(400)
            }
        }
    }

    fun release() { controller?.release(); controller = null }

    private fun sync() {
        val c = controller ?: return
        songId = c.currentMediaItem?.mediaId?.toLongOrNull()
        playing = c.isPlaying
        shuffle = c.shuffleModeEnabled
        repeat = c.repeatMode
        index = c.currentMediaItemIndex
        queue = (0 until c.mediaItemCount).mapNotNull { c.getMediaItemAt(it).mediaId.toLongOrNull() }
        position = c.currentPosition.coerceAtLeast(0); duration = c.duration.coerceAtLeast(0)
    }

    private fun items(songs: List<Song>) = songs.map { MediaItem.Builder().setMediaId(it.id.toString()).build() }

    fun play(songs: List<Song>, start: Int = 0, shuffled: Boolean = false) {
        val c = controller ?: return
        if (songs.isEmpty()) return
        c.shuffleModeEnabled = shuffled
        c.setMediaItems(items(songs), if (shuffled) (songs.indices).random() else start, 0L)
        c.prepare(); c.play()
    }
    fun playNext(songs: List<Song>) { controller?.let { it.addMediaItems((it.currentMediaItemIndex + 1).coerceAtMost(it.mediaItemCount), items(songs)) } }
    fun addToQueue(songs: List<Song>) { controller?.addMediaItems(items(songs)) }
    fun playAt(i: Int) { controller?.let { it.seekTo(i, 0L); it.play() } }
    fun removeAt(i: Int) { controller?.removeMediaItem(i) }
    fun toggle() {
        val c = controller ?: return
        if (c.mediaItemCount == 0) { c.prepare(); c.play(); return }   // resume where you left off
        if (c.isPlaying) c.pause() else { if (c.playbackState == Player.STATE_IDLE) c.prepare(); c.play() }
    }
    fun next() { controller?.seekToNext() }
    fun prev() { controller?.seekToPrevious() }
    fun seek(ms: Long) { controller?.seekTo(ms); position = ms }
    fun toggleShuffle() { controller?.let { it.shuffleModeEnabled = !it.shuffleModeEnabled } }
    fun cycleRepeat() {
        controller?.let {
            it.repeatMode = when (it.repeatMode) {
                Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
                Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
                else -> Player.REPEAT_MODE_OFF
            }
        }
    }
    /** Like or unlike a song. The playing one goes through the player so the notification's heart updates too. */
    fun toggleLike(id: Long) {
        val c = controller
        if (c != null && id == songId) c.sendCustomCommand(SessionCommand(LIKE_ACTION, Bundle.EMPTY), Bundle.EMPTY)
        else Store.toggleLike(id)
    }
}
