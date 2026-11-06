/*
 * File Purpose: Declares the Cube Android Gradle project and dependency sources.
 * Primary Components: Plugin repositories, dependency repositories, and the app module.
 * Inputs/Outputs: Reads Gradle plugin coordinates and exposes the :app build.
 */

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "CubeAndroid"
include(":app")
