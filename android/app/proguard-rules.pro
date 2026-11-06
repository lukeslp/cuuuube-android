# File Purpose: Documents shrinker behavior for Cube's deliberately small Android shell.
# Primary Components: WebView callback retention policy.
# Inputs/Outputs: Read by R8 when producing optimized release APK and AAB artifacts.

# No JavaScript interface is exposed. Keep WebViewClient overrides defensively so
# platform callback entry points remain obvious if optimization changes.
-keepclassmembers class * extends android.webkit.WebViewClient {
    public *;
}
