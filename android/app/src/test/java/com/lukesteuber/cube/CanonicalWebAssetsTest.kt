/*
 * File Purpose: Guards the Android package's dependency on Cube's canonical web directory.
 * Primary Components: Asset inventory, relative-link, and localStorage contract checks.
 * Inputs/Outputs: Reads ../../web through a Gradle-injected path and reports contract failures.
 */

package com.lukesteuber.cube

import java.io.File
import java.net.URI
import java.security.MessageDigest
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CanonicalWebAssetsTest {
    private val webDirectory = File(requireNotNull(System.getProperty("cube.webDir")))

    @Test
    fun requiredAssetsExist() {
        listOf(
            "index.html",
            "script.js",
            "style.css",
            "vendor/three.min.js",
        ).forEach { relativePath ->
            assertTrue("$relativePath must exist in the canonical web bundle", webDirectory.resolve(relativePath).isFile)
        }
    }

    @Test
    fun entryPointUsesBundledRelativeAssets() {
        val html = webDirectory.resolve("index.html").readText()

        val references = Regex("""(?:href|src)=["']([^"']+)["']""")
            .findAll(html).map { URI(it.groupValues[1]) }.toList()
        val localPaths = references.filter { it.scheme == null && it.rawAuthority == null }
            .map { it.path.removePrefix("./") }
        assertTrue("Stylesheet must resolve to its bundled file", "style.css" in localPaths)
        assertTrue("Three.js must resolve to its bundled file", "vendor/three.min.js" in localPaths)
        assertTrue("Game script must resolve to its bundled file", "script.js" in localPaths)
        assertFalse(html.contains("""src="http"""))
    }

    @Test
    fun stylesheetRequestsNothingFromTheNetwork() {
        val css = webDirectory.resolve("style.css").readText()

        assertFalse("The stylesheet must not import other stylesheets", css.contains("@import"))
        val remote = Regex("""url\(\s*["']?(?:https?:)?//""", RegexOption.IGNORE_CASE).find(css)
        assertTrue("Remote stylesheet URL found: ${remote?.value}", remote == null)
    }

    @Test
    fun bundledTypefaceMatchesPinnedUpstreamBytes() {
        val css = webDirectory.resolve("style.css").readText()
        val face = Regex("""@font-face\s*\{[^}]*font-family:\s*"Space Grotesk"[^}]*\}""").find(css)
        assertTrue("Space Grotesk must be declared with @font-face", face != null)
        val data = Regex("""url\("data:font/woff2;base64,([A-Za-z0-9+/=]+)"\)""").find(face!!.value)
        assertTrue("Space Grotesk must be embedded as a WOFF2 data URI", data != null)

        val bytes = Base64.getDecoder().decode(data!!.groupValues[1])
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { "%02x".format(it) }
        assertEquals(SPACE_GROTESK_2_0_0_SHA256, digest)
        assertTrue(
            "The Space Grotesk OFL notice must ship beside the game",
            webDirectory.resolve("licenses/Space-Grotesk-OFL-1.1.txt").isFile,
        )
    }

    @Test
    fun gameKeepsItsPersistentStorageContract() {
        val script = webDirectory.resolve("script.js").readText()

        assertTrue(script.contains("localStorage"))
        assertTrue(script.contains("theCube_preferences"))
        assertTrue(script.contains("theCube_leaderboard"))
    }

    @Test
    fun androidRendererKeepsItsMobileGpuBudget() {
        val script = webDirectory.resolve("script.js").readText()

        assertTrue(script.contains("const IS_ANDROID_DEVICE = /Android/i"))
        assertTrue(script.contains("const ANDROID_PIXEL_RATIO_CAP = 1.25"))
        assertTrue(script.contains("this.renderer.shadowMap.enabled = ! IS_ANDROID_DEVICE"))
    }

    private companion object {
        // third_party/space-grotesk-2.0.0/SOURCE.md: upstream tag 2.0.0, commit 7220f5d.
        const val SPACE_GROTESK_2_0_0_SHA256 =
            "8e085aa438094f11487a836652edd5c054fa6a96f63fc7c282105ee3a4b08c07"
    }
}
