plugins {
    id("com.android.application")
}

apply(from = "../deps.gradle.kts")

android {
    namespace = "org.firstinspires.ftc.teamcode"
    compileSdk = 34

    defaultConfig {
        minSdk = 24
    }
}

repositories {
    maven {
        url = uri("https://maven.brott.dev/")
    }
    maven(url = "https://mymaven.bylazar.com/releases")
}

val rrVersion = "1.0.1"
val pedroVersion: String by rootProject.extra

dependencies {
    implementation(project(":FtcRobotController"))
    implementation("com.acmerobotics.roadrunner:core:$rrVersion")
    implementation("com.pedropathing:revhub:$pedroVersion")
    implementation("org.ftclib.ftclib:core:${rootProject.extra["ftclibVersion"]}") {
        exclude(group = "org.firstinspires.ftc")
        isTransitive = false
    }
    implementation(group = "org.ejml", name = "ejml-simple", version = "0.39")
    compileOnly(kotlin("stdlib", "1.9.0"))
    implementation(files("libs/local.jar"))
    testImplementation("junit:junit:4.13.2")
}
