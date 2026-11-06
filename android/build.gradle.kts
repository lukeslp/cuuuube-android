/*
 * File Purpose: Pins the Android and Kotlin build plugins used by Cube.
 * Primary Components: Android application plugin and Kotlin Android plugin.
 * Inputs/Outputs: Resolves cached or remote plugins for all Android modules.
 */

plugins {
    id("com.android.application") version "8.13.0" apply false
    id("org.jetbrains.kotlin.android") version "2.2.21" apply false
}
