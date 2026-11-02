// SandBot: Android의 android.content.Context와 같은 API(android-4.1.1.4.jar의 공개 서명) 일부를 새로 쓴 것. 사이드카에는 Android
// 앱이 없어 Context 객체도 없다(hardwareMap.appContext, AppUtil의 Application·Activity는 null). 멤버는 팀 코드와 라이브러리
// 바이트코드(Road Runner TuningFiles.registerRoutes의 getAssets 등)가 실제 서명으로 컴파일·링크되도록 둔 것이다.
package android.content;

import android.content.res.AssetManager;

public abstract class Context {
    public Context() {}

    /** 앱 자원(APK의 assets). 사이드카에는 Context를 구현한 객체가 없다. */
    public abstract AssetManager getAssets();
}
