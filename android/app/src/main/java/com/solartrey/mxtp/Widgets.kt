package com.solartrey.mxtp

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.KeyEvent
import android.widget.RemoteViews
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** The bar widget: art, song, like, previous, play/pause, next. */
class BarWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) = Widgets.updateAll(context)
}

/** The square widget: the album, with like and play/pause. */
class SquareWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, appWidgetIds: IntArray) = Widgets.updateAll(context)
}

/** The widgets' Like button (play, skip and so on go through Android's media buttons). */
class WidgetActions : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == LIKE_ACTION) PlaybackService.instance?.toggleLike()
    }
}

object Widgets {
    private var lastSong: Long? = null
    private var lastPlaying = false

    fun updateAll(ctx: Context) = update(ctx, lastSong, lastPlaying)

    fun update(ctx: Context, songId: Long?, playing: Boolean) {
        lastSong = songId; lastPlaying = playing
        val app = ctx.applicationContext
        CoroutineScope(Dispatchers.IO).launch {
            Store.init(app)
            val song = songId?.let { Repo.library?.byId?.get(it) }
            val art = song?.let { Art.load(app, it.albumId, 384) }
            val mgr = AppWidgetManager.getInstance(app)
            for ((cls, layout) in listOf(BarWidget::class.java to R.layout.widget_bar, SquareWidget::class.java to R.layout.widget_square)) {
                val ids = mgr.getAppWidgetIds(ComponentName(app, cls))
                if (ids.isEmpty()) continue
                val v = RemoteViews(app.packageName, layout)
                v.setTextViewText(R.id.w_title, song?.title ?: "mxtp")
                if (layout == R.layout.widget_bar) {
                    v.setTextViewText(R.id.w_artist, song?.let { "${it.artist} — ${it.album}" } ?: "Tap play to pick up where you left off")
                    v.setOnClickPendingIntent(R.id.w_prev, mediaButton(app, KeyEvent.KEYCODE_MEDIA_PREVIOUS))
                    v.setOnClickPendingIntent(R.id.w_next, mediaButton(app, KeyEvent.KEYCODE_MEDIA_NEXT))
                }
                if (art != null) v.setImageViewBitmap(R.id.w_art, art) else v.setImageViewResource(R.id.w_art, R.drawable.ic_note)
                v.setImageViewResource(R.id.w_play, if (playing) R.drawable.ic_pause else R.drawable.ic_play)
                v.setImageViewResource(R.id.w_like, if (song != null && Store.isLiked(song.id)) R.drawable.ic_heart else R.drawable.ic_heart_outline)
                v.setOnClickPendingIntent(R.id.w_play, mediaButton(app, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
                v.setOnClickPendingIntent(R.id.w_like, PendingIntent.getBroadcast(app, 40,
                    Intent(app, WidgetActions::class.java).setAction(LIKE_ACTION), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
                v.setOnClickPendingIntent(R.id.w_art, PendingIntent.getActivity(app, 41, Intent(app, MainActivity::class.java),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
                mgr.updateAppWidget(ids, v)
            }
        }
    }

    /** A headphone-style media button, handled by Media3 even when mxtp isn't running. */
    private fun mediaButton(ctx: Context, key: Int): PendingIntent {
        val i = Intent(Intent.ACTION_MEDIA_BUTTON)
            .setComponent(ComponentName(ctx, androidx.media3.session.MediaButtonReceiver::class.java))
            .putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, key))
        return PendingIntent.getBroadcast(ctx, key, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
}
