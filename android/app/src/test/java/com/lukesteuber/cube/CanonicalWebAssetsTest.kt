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
    fun gameCallsItselfCuuuube() {
        val html = webDirectory.resolve("index.html").readText()

        assertTrue(html.contains("<title>CUUUUBE</title>"))
        val heading = Regex("""<h1 class="text text--title"[^>]*>(.*?)</h1>""", RegexOption.DOT_MATCHES_ALL)
            .find(html)!!.groupValues[1]
        assertTrue("The title screen must say CUUUUBE", heading.contains("<span>CUUUUBE</span>"))
        assertFalse("The title screen must not say CUBE alone", heading.contains("<span>CUBE</span>"))
    }

    @Test
    fun licensesPageCarriesEveryBundledNoticeInFull() {
        val licenses = webDirectory.resolve("licenses")
        val page = licenses.resolve("index.html").readText()
        val notices = licenses.listFiles { file -> file.extension == "txt" }!!.sortedBy { it.name }

        assertEquals(12, notices.size)
        notices.forEach { notice ->
            val escaped = notice.readText()
                .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            assertTrue("${notice.name} must appear in full on the licenses page", page.contains("<pre>$escaped</pre>"))
        }
        assertFalse("The licenses page must not link anywhere", page.contains("href=") || page.contains("src="))

        val html = webDirectory.resolve("index.html").readText()
        assertTrue("The scoreboard must offer the licenses page", html.contains("scoreboard-licenses"))
        assertTrue(webDirectory.resolve("script.js").readText().contains("./licenses/index.html"))
    }

    @Test
    fun backClosesTheOpenPageBeforeLeaving() {
        val script = webDirectory.resolve("script.js").readText()
        val activity = File("src/main/java/com/lukesteuber/cube/MainActivity.kt").readText()

        assertTrue("The game must answer the Back button", script.contains("Game.prototype.handleBack = function()"))
        assertTrue("window.game must exist for the shell to ask", script.contains("window.game = new Game()"))
        assertTrue("The shell must ask the game before leaving", activity.contains("window.game.handleBack()"))
    }

    @Test
    fun screenReaderHasNamesAndAStatusLine() {
        val html = webDirectory.resolve("index.html").readText()

        assertTrue(html.contains("role=\"status\" aria-live=\"polite\""))
        assertTrue(html.contains("class=\"text text--timer\" role=\"timer\""))
        Regex("<button[^>]*>").findAll(html).forEach { button ->
            val tag = button.value
            assertTrue(
                "Every icon-only button needs a name: $tag",
                tag.contains("aria-label=") || tag.contains("type=\"submit\"") || tag.contains("scoreboard-"),
            )
        }
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
