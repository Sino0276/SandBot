// SandBot: Android의 android.content.res.AssetManager와 같은 API(android-4.1.1.4.jar의 공개 서명) 일부를 새로 쓴 것. 사이드카에는
// APK가 없어 앱 자원(assets)도 없다. 실제처럼 공개 생성자가 없고 getAssets()로 이것을 돌려줄 Context도 없으므로 만들어지지 않는다.
// 멤버는 라이브러리 바이트코드(Road Runner의 웹 처리기 FileServingKt 등)가 실제 서명으로 링크되도록 둔 것이고, 부르면 앱 자원이
// 없다는 IOException(open은 없는 자원처럼 FileNotFoundException)이다.
package android.content.res;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;

public final class AssetManager {
    public static final int ACCESS_UNKNOWN = 0;
    public static final int ACCESS_RANDOM = 1;
    public static final int ACCESS_STREAMING = 2;
    public static final int ACCESS_BUFFER = 3;

    private AssetManager() {}

    public void close() {}

    public final InputStream open(String fileName) throws IOException {
        return open(fileName, ACCESS_STREAMING);
    }

    public final InputStream open(String fileName, int accessMode) throws IOException {
        throw new FileNotFoundException(noAssets(fileName));
    }

    public final String[] list(String path) throws IOException {
        throw new IOException(noAssets(path));
    }

    private static String noAssets(String path) {
        return "SandBot has no Android app assets (the APK assets folder is not simulated): " + path;
    }
}
