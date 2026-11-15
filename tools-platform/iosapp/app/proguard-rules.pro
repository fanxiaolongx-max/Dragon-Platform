# Dragon Claw release shrinking rules.
# kotlinx.serialization and Ktor ship their own consumer rules; these cover what they leave out.

-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod

# @Serializable models are looked up through generated serializers.
-keepclassmembers class com.example.newapp.shared.model.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.example.newapp.shared.model.**$$serializer { *; }

# Optional dependencies referenced by Ktor / OkHttp / coroutines but absent on Android.
-dontwarn org.slf4j.**
-dontwarn java.lang.management.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
