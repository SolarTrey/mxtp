plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.solartrey.mxtp"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.solartrey.mxtp"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
    }

    // Every update must be signed with the same key so it installs over the last one.
    // Set MXTP_KEYSTORE / MXTP_KEY_PASSWORD to use a private key; otherwise the sideload key in keystore/ is used.
    signingConfigs {
        create("release") {
            storeFile = file(System.getenv("MXTP_KEYSTORE") ?: "../keystore/mxtp-sideload.jks")
            storePassword = System.getenv("MXTP_KEY_PASSWORD") ?: "mxtp-sideload"
            keyAlias = System.getenv("MXTP_KEY_ALIAS") ?: "mxtp"
            keyPassword = System.getenv("MXTP_KEY_PASSWORD") ?: "mxtp-sideload"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
    // lint is for the IDE; don't let a warning stop the GitHub build
    lint { abortOnError = false; checkReleaseBuilds = false }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.media3:media3-exoplayer:1.5.1")
    implementation("androidx.media3:media3-session:1.5.1")
    implementation("com.google.guava:guava:33.3.1-android")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-guava:1.9.0")
}
