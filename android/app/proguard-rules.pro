# ProGuard rules for AgentRunner

# Yubico YubiKit — uses reflection and JNI for USB/NFC transport
-keep class com.yubico.yubikit.** { *; }
-dontwarn com.yubico.yubikit.**

# Android WebView JavaScript bridge — @JavascriptInterface methods must not be renamed
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# OkHttp — uses reflection for platform detection and TLS
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
