package com.solartrey.mxtp

import android.app.PendingIntent
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.BitmapLoader
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.guava.future

/** Holds the library so the player service and the screens share one scan. */
object Repo {
    @Volatile var library: Library? = null
    suspend fun library(ctx: android.content.Context): Library = library ?: Library.scan(ctx).also { library = it }
}

const val ART_SCHEME = "mxtpart"
const val LIKE_ACTION = "mxtp.LIKE"

/** A song as the player sees it: where to play it from, and what to show on the lock screen. */
fun Song.toItem(): MediaItem = MediaItem.Builder()
    .setMediaId(id.toString())
    .setUri(uri)
    .setMediaMetadata(
        MediaMetadata.Builder()
            .setTitle(title).setArtist(artist).setAlbumTitle(album).setAlbumArtist(artist)
            .setTrackNumber(track).setReleaseYear(if (year > 0) year else null)
            .setArtworkUri(Uri.parse("$ART_SCHEME://$albumId"))
            .setIsPlayable(true).setIsBrowsable(false)
            .setExtras(Bundle().apply { putLong("albumId", albumId) })
            .build()
    ).build()

/**
 * Plays your music in the background, with the notification, lock screen, headphone buttons and
 * Android Auto-style controls that Media3 provides. Adds a Like button to the notification.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private lateinit var player: ExoPlayer
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private val likeCommand = SessionCommand(LIKE_ACTION, Bundle.EMPTY)

    companion object { @Volatile var instance: PlaybackService? = null }

    override fun onCreate() {
        super.onCreate()
        Store.init(this)
        instance = this
        player = ExoPlayer.Builder(this)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            .setHandleAudioBecomingNoisy(true)
            .build()
        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
                val albumId = item?.mediaMetadata?.extras?.getLong("albumId") ?: return
                if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO || reason == Player.MEDIA_ITEM_TRANSITION_REASON_SEEK ||
                    reason == Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED) Store.countPlay(albumId)
                refresh()
            }
            override fun onIsPlayingChanged(isPlaying: Boolean) { refresh(); if (!isPlaying) remember() }
        })
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        session = MediaSession.Builder(this, player)
            .setSessionActivity(open)
            .setBitmapLoader(ArtLoader())
            .setCallback(Callback())
            .build()
        refresh()
    }

    /** Album art for the notification and lock screen comes from the phone's own thumbnails. */
    private inner class ArtLoader : BitmapLoader {
        private val fallback = DataSourceBitmapLoader(this@PlaybackService)
        override fun supportsMimeType(mimeType: String) = fallback.supportsMimeType(mimeType)
        override fun decodeBitmap(data: ByteArray): ListenableFuture<Bitmap> = fallback.decodeBitmap(data)
        override fun loadBitmap(uri: Uri): ListenableFuture<Bitmap> =
            if (uri.scheme == ART_SCHEME) scope.future(Dispatchers.IO) {
                Art.load(this@PlaybackService, uri.host?.toLongOrNull() ?: 0L, 512) ?: throw IllegalStateException("no art")
            } else fallback.loadBitmap(uri)
    }

    private inner class Callback : MediaSession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult =
            MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(
                    MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon().add(likeCommand).build()
                ).build()

        override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo,
                                     customCommand: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
            if (customCommand.customAction == LIKE_ACTION) toggleLike()
            return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
        }

        // songs come from the screens as ids only; fill in where to play them from
        override fun onAddMediaItems(mediaSession: MediaSession, controller: MediaSession.ControllerInfo,
                                     mediaItems: MutableList<MediaItem>): ListenableFuture<MutableList<MediaItem>> =
            scope.future(Dispatchers.IO) {
                val lib = Repo.library(this@PlaybackService)
                mediaItems.mapNotNull { lib.byId[it.mediaId.toLongOrNull()]?.toItem() }.toMutableList()
            }

        // "resume" from the lock screen, headphones or the widgets after mxtp was closed
        override fun onPlaybackResumption(mediaSession: MediaSession, controller: MediaSession.ControllerInfo):
                ListenableFuture<MediaSession.MediaItemsWithStartPosition> = scope.future(Dispatchers.IO) {
            val lib = Repo.library(this@PlaybackService)
            var items = Store.lastQueue.mapNotNull { lib.byId[it]?.toItem() }
            var index = Store.lastIndex.coerceIn(0, (items.size - 1).coerceAtLeast(0))
            var pos = Store.lastPosition
            if (items.isEmpty()) { items = lib.songs.shuffled().take(100).map { it.toItem() }; index = 0; pos = 0 }
            MediaSession.MediaItemsWithStartPosition(items, index, pos)
        }
    }

    fun toggleLike() {
        val id = player.currentMediaItem?.mediaId?.toLongOrNull() ?: return
        Store.toggleLike(id)
        refresh()
    }

    /** Update the notification's Like button and the home-screen widgets. */
    fun refresh() {
        val id = player.currentMediaItem?.mediaId?.toLongOrNull()
        val liked = id != null && Store.isLiked(id)
        session?.setCustomLayout(ImmutableList.of(
            CommandButton.Builder()
                .setDisplayName(if (liked) "Unlike" else "Like")
                .setIconResId(if (liked) R.drawable.ic_heart else R.drawable.ic_heart_outline)
                .setSessionCommand(likeCommand)
                .build()
        ))
        Widgets.update(this, id, player.isPlaying)
    }

    /** Where you left off, for resuming later. */
    private fun remember() {
        Store.lastQueue = (0 until player.mediaItemCount).mapNotNull { player.getMediaItemAt(it).mediaId.toLongOrNull() }
        Store.lastIndex = player.currentMediaItemIndex
        Store.lastPosition = player.currentPosition
        Store.save()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        val p = session?.player
        if (p == null || !p.playWhenReady || p.mediaItemCount == 0) stopSelf()
    }

    override fun onDestroy() {
        remember()
        instance = null
        session?.run { player.release(); release() }
        session = null
        Widgets.update(this, null, false)
        super.onDestroy()
    }
}
