/*
 * File Purpose: Configures Cube's Android application, release signing, tests, and assets.
 * Primary Components: API 36 build settings, JDK 21 compilation, release build, and JUnit.
 * Inputs/Outputs: Bundles ../../web into APK/AAB files and optionally signs from private properties.
 */

import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun privateValue(name: String): String? =
    providers.environmentVariable(name)
        .orElse(providers.gradleProperty(name))
        .orNull
        ?.takeIf(String::isNotBlank)

val releaseStorePath = privateValue("CUBE_RELEASE_STORE_FILE")
val releaseStorePassword = privateValue("CUBE_RELEASE_STORE_PASSWORD")
val releaseKeyAlias = privateValue("CUBE_RELEASE_KEY_ALIAS")
val releaseKeyPassword = privateValue("CUBE_RELEASE_KEY_PASSWORD")
val hasReleaseSigning = listOf(
    releaseStorePath,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { it != null }
val versionProperties = Properties().apply {
    file("../version.properties").inputStream().use(::load)
}
val cubeVersionName = requireNotNull(versionProperties.getProperty("VERSION_NAME"))
val cubeVersionCode = requireNotNull(versionProperties.getProperty("VERSION_CODE")).toInt()

android {
    namespace = "com.lukesteuber.cube"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.lukesteuber.cube"
        minSdk = 26
        targetSdk = 36
        versionCode = cubeVersionCode
        versionName = cubeVersionName
        testInstrumentationRunner = "android.test.InstrumentationTestRunner"
    }

    sourceSets {
        getByName("main").assets.srcDir("../../web")
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = file(requireNotNull(releaseStorePath))
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = true
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isDebuggable = false
            // Gradle's root is android/, below the repository's .git; in released APKs
            // this file only said NO_SUPPORTED_VCS_FOUND. Omitting it keeps release
            // bytes independent of how the source was checked out (F-Droid rebuilds).
            vcsInfo.include = false
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            signingConfig = signingConfigs.findByName("release")
        }
    }

    // F-Droid's scanner rejects the Play dependency-metadata signing block.
    dependenciesInfo {
        includeInApk = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    testOptions {
        unitTests.isIncludeAndroidResources = false
        unitTests.all {
            it.systemProperty("cube.webDir", file("../../web").absolutePath)
            it.inputs.dir(file("../../web"))
                .withPropertyName("canonicalWebAssets")
                .withPathSensitivity(org.gradle.api.tasks.PathSensitivity.RELATIVE)
        }
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        warningsAsErrors = true
        // AAPT requires adaptive-icon XML in a v26-qualified directory even
        // though API 26 is also this app's minimum SDK.
        disable += "ObsoleteSdkInt"
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        allWarningsAsErrors.set(true)
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
