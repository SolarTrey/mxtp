package com.solartrey.mxtp

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** A playlist of song ids. Starred playlists show on Liked as favourites. */
data class Playlist(val id: String, var name: String, var fav: Boolean, val songs: MutableList<Long>)

/**
 * Everything mxtp remembers: likes, play counts, playlists, settings and where you left off.
 * Kept in one small JSON file in the app's private folder. [version] bumps on every change so screens redraw.
 */
object Store {
    private lateinit var file: File
    var version by mutableIntStateOf(0)
        private set

    val liked = LinkedHashMap<Long, Long>()             // song id → when liked
    val albumPlays = HashMap<Long, Pair<Int, Long>>()   // album id → (plays, last played)
    val playlists = ArrayList<Playlist>()
    var theme = "midnight"          // light | evening | midnight
    var tone = "both"               // evening: purple | amber | both
    var lightLine = false           // Light: Rdio-blue line under the top bar
    var media = "vinyl"             // Now Playing: vinyl | cd | cassette
    var lastQueue: List<Long> = emptyList()
    var lastIndex = 0
    var lastPosition = 0L

    fun init(ctx: Context) {
        if (::file.isInitialized) return
        file = File(ctx.filesDir, "mxtp.json")
        try {
            if (!file.exists()) return
            val o = JSONObject(file.readText())
            o.optJSONObject("liked")?.let { j -> j.keys().forEach { k -> liked[k.toLong()] = j.getLong(k) } }
            o.optJSONObject("plays")?.let { j ->
                j.keys().forEach { k -> val a = j.getJSONArray(k); albumPlays[k.toLong()] = a.getInt(0) to a.getLong(1) }
            }
            o.optJSONArray("playlists")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val p = arr.getJSONObject(i); val s = p.getJSONArray("songs")
                    playlists += Playlist(p.getString("id"), p.getString("name"), p.optBoolean("fav"), MutableList(s.length()) { s.getLong(it) })
                }
            }
            theme = o.optString("theme", theme); tone = o.optString("tone", tone)
            lightLine = o.optBoolean("lightLine", false); media = o.optString("media", media)
            o.optJSONArray("lastQueue")?.let { a -> lastQueue = List(a.length()) { a.getLong(it) } }
            lastIndex = o.optInt("lastIndex"); lastPosition = o.optLong("lastPosition")
        } catch (_: Exception) { }
    }

    @Synchronized fun save() {
        version++
        val o = JSONObject()
        o.put("liked", JSONObject().apply { liked.forEach { (k, v) -> put(k.toString(), v) } })
        o.put("plays", JSONObject().apply { albumPlays.forEach { (k, v) -> put(k.toString(), JSONArray().put(v.first).put(v.second)) } })
        o.put("playlists", JSONArray().apply {
            playlists.forEach { p -> put(JSONObject().put("id", p.id).put("name", p.name).put("fav", p.fav).put("songs", JSONArray(p.songs))) }
        })
        o.put("theme", theme).put("tone", tone).put("lightLine", lightLine).put("media", media)
        o.put("lastQueue", JSONArray(lastQueue)).put("lastIndex", lastIndex).put("lastPosition", lastPosition)
        try { file.writeText(o.toString()) } catch (_: Exception) { }
    }

    fun isLiked(id: Long) = liked.containsKey(id)
    fun toggleLike(id: Long) { if (liked.remove(id) == null) liked[id] = System.currentTimeMillis(); save() }

    fun countPlay(albumId: Long) {
        val (n, _) = albumPlays[albumId] ?: (0 to 0L)
        albumPlays[albumId] = (n + 1) to System.currentTimeMillis(); save()
    }

    fun newPlaylist(name: String): Playlist {
        val p = Playlist("p" + System.currentTimeMillis(), name.ifBlank { "New playlist" }, false, mutableListOf())
        playlists += p; save(); return p
    }

    fun set(block: Store.() -> Unit) { block(); save() }
}
