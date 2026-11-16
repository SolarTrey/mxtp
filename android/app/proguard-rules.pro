# Media3 and Compose ship their own rules. Keep our widget and receiver classes by name (referenced from the manifest).
-keep class com.solartrey.mxtp.** extends android.appwidget.AppWidgetProvider
-keep class com.solartrey.mxtp.** extends android.content.BroadcastReceiver
