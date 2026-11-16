package com.solartrey.mxtp

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.LruCache
import android.util.Size
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** One song on the phone, as MediaStore knows it. */
data class Song(
    val id: Long,
    val title: String,
    val artist: String,
    val album: String,
    val albumId: Long,
    val duration: Long,
    val track: Int,
    val year: Int,
    val genre: String,
    val dateAdded: Long,
) {
    val uri: Uri get() = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id)
}

data class Album(val id: Long, val title: String, val artist: String, val year: Int, val songs: List<Song>, val added: Long)
data class Artist(val name: String, val albums: List<Album>, val songs: List<Song>)

/** The music library: every song, grouped into albums, artists and genres. */
class Library(val songs: List<Song>) {
    val byId: Map<Long, Song> = songs.associateBy { it.id }
    val albums: List<Album> = songs.groupBy { it.albumId }.map { (id, s) ->
        val sorted = s.sortedWith(compareBy({ it.track }, { it.title.lowercase() }))
        val artist = s.groupingBy { it.artist }.eachCount().maxByOrNull { it.value }?.key ?: "Unknown artist"
        Album(id, s.first().album, artist, s.maxOf { it.year }, sorted, s.maxOf { it.dateAdded })
    }.sortedBy { sortKey(it.title) }
    val albumById: Map<Long, Album> = albums.associateBy { it.id }
    val artists: List<Artist> = songs.groupBy { it.artist }.map { (name, s) ->
        Artist(name, albums.filter { a -> a.songs.any { it.artist == name } }.sortedByDescending { it.year }, s)
    }.sortedBy { sortKey(it.name) }
    val genres: List<Pair<String, List<Song>>> = songs.groupBy { it.genre }.toList().sortedBy { it.first.lowercase() }

    companion object {
        /** Sort and file under a letter the way record shops do: "The Beatles" goes under B. */
        fun sortKey(s: String): String = s.lowercase().removePrefix("the ").removePrefix("a ").trim()
        fun letterOf(s: String): Char {
            val c = sortKey(s).firstOrNull()?.uppercaseChar() ?: '#'
            return if (c in 'A'..'Z') c else '#'
        }

        suspend fun scan(ctx: Context): Library = withContext(Dispatchers.IO) {
            val out = ArrayList<Song>()
            val cols = mutableListOf(
                MediaStore.Audio.Media._ID, MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM, MediaStore.Audio.Media.ALBUM_ID, MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.TRACK, MediaStore.Audio.Media.YEAR, MediaStore.Audio.Media.DATE_ADDED,
            )
            if (Build.VERSION.SDK_INT >= 30) cols += MediaStore.Audio.Media.GENRE
            try {
                ctx.contentResolver.query(
                    MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, cols.toTypedArray(),
                    "${MediaStore.Audio.Media.IS_MUSIC} != 0", null, null
                )?.use { c ->
                    val genreIdx = if (Build.VERSION.SDK_INT >= 30) c.getColumnIndex(MediaStore.Audio.Media.GENRE) else -1
                    while (c.moveToNext()) {
                        fun str(i: Int, def: String) = c.getString(i)?.takeIf { it.isNotBlank() && it != "<unknown>" } ?: def
                        out += Song(
                            id = c.getLong(0),
                            title = str(1, "Untitled"),
                            artist = str(2, "Unknown artist"),
                            album = str(3, "Unknown album"),
                            albumId = c.getLong(4),
                            duration = c.getLong(5),
                            track = c.getInt(6) % 1000,
                            year = c.getInt(7),
                            genre = if (genreIdx >= 0) str(genreIdx, "Unknown genre") else "Unknown genre",
                            dateAdded = c.getLong(8),
                        )
                    }
                }
            } catch (_: SecurityException) { }
            Library(out)
        }
    }
}

/** Album art from the phone's own thumbnails, cached in memory. */
object Art {
    private val cache = object : LruCache<String, Bitmap>(48 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount
    }
    private val missing = HashSet<String>()

    fun albumUri(albumId: Long): Uri =
        ContentUris.withAppendedId(MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI, albumId)

    fun cached(albumId: Long, px: Int): Bitmap? = cache.get("$albumId@$px")

    suspend fun load(ctx: Context, albumId: Long, px: Int): Bitmap? = withContext(Dispatchers.IO) {
        val key = "$albumId@$px"
        cache.get(key)?.let { return@withContext it }
        if (key in missing) return@withContext null
        val bmp = try {
            if (Build.VERSION.SDK_INT >= 29) {
                ctx.contentResolver.loadThumbnail(albumUri(albumId), Size(px, px), null)
            } else {
                val u = ContentUris.withAppendedId(Uri.parse("content://media/external/audio/albumart"), albumId)
                ctx.contentResolver.openInputStream(u)?.use { android.graphics.BitmapFactory.decodeStream(it) }
            }
        } catch (_: Exception) { null }
        if (bmp != null) cache.put(key, bmp) else missing += key
        bmp
    }
}
