/*
 * File Purpose: Classifies WebView destinations without coupling policy to Android UI code.
 * Primary Components: UrlDecision and UrlPolicy.
 * Inputs/Outputs: Accepts a URL string and returns allow-local, open-external, or block.
 */

package com.lukesteuber.cube

import java.net.URI

internal enum class UrlDecision {
    ALLOW_LOCAL,
    OPEN_EXTERNAL,
    BLOCK,
}

internal object UrlPolicy {
    private const val ASSET_PATH_PREFIX = "/android_asset/"

    fun classify(rawUrl: String?): UrlDecision {
        if (rawUrl.isNullOrBlank()) return UrlDecision.BLOCK

        val uri = runCatching { URI(rawUrl) }.getOrNull() ?: return UrlDecision.BLOCK
        return when (uri.scheme?.lowercase()) {
            "file" -> {
                if (uri.host.isNullOrEmpty() && uri.path?.startsWith(ASSET_PATH_PREFIX) == true) {
                    UrlDecision.ALLOW_LOCAL
                } else {
                    UrlDecision.BLOCK
                }
            }
            "http", "https" -> UrlDecision.OPEN_EXTERNAL
            else -> UrlDecision.BLOCK
        }
    }
}
