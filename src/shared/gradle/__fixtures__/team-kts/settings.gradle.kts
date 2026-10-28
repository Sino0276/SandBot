pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
        google()
        maven("https://repo.dairy.foundation/releases/")
    }
}

rootProject.name = "FtcRobotController"
include(":FtcRobotController", ":TeamCode")
