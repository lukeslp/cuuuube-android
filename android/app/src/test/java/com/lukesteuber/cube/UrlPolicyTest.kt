/*
 * File Purpose: Verifies that WebView navigation cannot escape the bundled game unexpectedly.
 * Primary Components: Local asset, external browser, malformed URL, and unsafe-scheme tests.
 * Inputs/Outputs: Supplies representative URLs and asserts deterministic UrlDecision values.
 */

package com.lukesteuber.cube

import org.junit.Assert.assertEquals
import org.junit.Test

class UrlPolicyTest {
    @Test
    fun bundledAssetsStayInsideWebView() {
        assertEquals(
            UrlDecision.ALLOW_LOCAL,
            UrlPolicy.classify("file:///android_asset/index.html"),
        )
        assertEquals(
            UrlDecision.ALLOW_LOCAL,
            UrlPolicy.classify("file:///android_asset/vendor/three.min.js"),
        )
    }

    @Test
    fun webLinksOpenExternally() {
        assertEquals(
            UrlDecision.OPEN_EXTERNAL,
            UrlPolicy.classify("https://lukesteuber.com"),
        )
        assertEquals(
            UrlDecision.OPEN_EXTERNAL,
            UrlPolicy.classify("http://example.com/path"),
        )
    }

    @Test
    fun nonAssetFilesAndActiveSchemesAreBlocked() {
        assertEquals(UrlDecision.BLOCK, UrlPolicy.classify("file:///sdcard/private.txt"))
        assertEquals(UrlDecision.BLOCK, UrlPolicy.classify("javascript:alert(1)"))
        assertEquals(UrlDecision.BLOCK, UrlPolicy.classify("content://example/data"))
        assertEquals(UrlDecision.BLOCK, UrlPolicy.classify(null))
    }
}
