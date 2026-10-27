package android.graphics;

import java.util.HashMap;
import java.util.Locale;

/**
 * SandBot: 안드로이드 android.graphics.Color(API 16)의 순수 Java 구현. FTC SDK(LynxModule 패턴, 색 센서)와 샘플이 쓰는 계산을
 * 실제 안드로이드와 같은 의미로 한다. HSV 변환은 안드로이드가 쓰는 Skia(SkRGBToHSV·SkHSVToColor)와 같은 공식이다.
 */
public class Color {
    public static final int BLACK = 0xFF000000;
    public static final int DKGRAY = 0xFF444444;
    public static final int GRAY = 0xFF888888;
    public static final int LTGRAY = 0xFFCCCCCC;
    public static final int WHITE = 0xFFFFFFFF;
    public static final int RED = 0xFFFF0000;
    public static final int GREEN = 0xFF00FF00;
    public static final int BLUE = 0xFF0000FF;
    public static final int YELLOW = 0xFFFFFF00;
    public static final int CYAN = 0xFF00FFFF;
    public static final int MAGENTA = 0xFFFF00FF;
    public static final int TRANSPARENT = 0;

    public Color() {
    }

    public static int alpha(int color) {
        return color >>> 24;
    }

    public static int red(int color) {
        return (color >> 16) & 0xFF;
    }

    public static int green(int color) {
        return (color >> 8) & 0xFF;
    }

    public static int blue(int color) {
        return color & 0xFF;
    }

    public static int rgb(int red, int green, int blue) {
        return (0xFF << 24) | (red << 16) | (green << 8) | blue;
    }

    public static int argb(int alpha, int red, int green, int blue) {
        return (alpha << 24) | (red << 16) | (green << 8) | blue;
    }

    /**
     * "#RRGGBB", "#AARRGGBB" 또는 색 이름(red, blue, green, black, white, gray, cyan, magenta, yellow, lightgray, darkgray,
     * grey, lightgrey, darkgrey, aqua, fuchsia, lime, maroon, navy, olive, purple, silver, teal). 모르면 IllegalArgumentException.
     */
    public static int parseColor(String colorString) {
        if (colorString.charAt(0) == '#') {
            long color = Long.parseLong(colorString.substring(1), 16);
            if (colorString.length() == 7) {
                color |= 0x00000000ff000000L;
            } else if (colorString.length() != 9) {
                throw new IllegalArgumentException("Unknown color");
            }
            return (int) color;
        } else {
            Integer color = COLOR_NAMES.get(colorString.toLowerCase(Locale.ROOT));
            if (color != null) return color;
        }
        throw new IllegalArgumentException("Unknown color");
    }

    /** RGB(0–255)를 HSV로: hsv[0] 색상 0–360, hsv[1] 채도 0–1, hsv[2] 명도 0–1 */
    public static void RGBToHSV(int red, int green, int blue, float[] hsv) {
        if (hsv.length < 3) throw new RuntimeException("3 components required for hsv");
        int r = red & 0xFF, g = green & 0xFF, b = blue & 0xFF;
        int max = Math.max(r, Math.max(g, b));
        int min = Math.min(r, Math.min(g, b));
        float v = max / 255f;
        int delta = max - min;
        if (delta == 0) {
            hsv[0] = 0;
            hsv[1] = 0;
            hsv[2] = v;
            return;
        }
        float s = (float) delta / max;
        float h;
        if (r == max) h = (float) (g - b) / delta;
        else if (g == max) h = 2 + (float) (b - r) / delta;
        else h = 4 + (float) (r - g) / delta;
        h *= 60;
        if (h < 0) h += 360;
        hsv[0] = h;
        hsv[1] = s;
        hsv[2] = v;
    }

    public static void colorToHSV(int color, float[] hsv) {
        RGBToHSV((color >> 16) & 0xFF, (color >> 8) & 0xFF, color & 0xFF, hsv);
    }

    public static int HSVToColor(float[] hsv) {
        return HSVToColor(0xFF, hsv);
    }

    public static int HSVToColor(int alpha, float[] hsv) {
        if (hsv.length < 3) throw new RuntimeException("3 components required for hsv");
        float s = Math.max(0, Math.min(1, hsv[1]));
        float v = Math.max(0, Math.min(1, hsv[2]));
        int vByte = round(v * 255);
        if (s <= 1f / (1 << 12)) return argb(alpha, vByte, vByte, vByte);
        float hx = (hsv[0] < 0 || hsv[0] >= 360f) ? 0 : hsv[0] / 60f;
        float w = (float) Math.floor(hx);
        float f = hx - w;
        int p = round((1 - s) * v * 255);
        int q = round((1 - s * f) * v * 255);
        int t = round((1 - s * (1 - f)) * v * 255);
        int r, g, b;
        switch ((int) w) {
            case 0: r = vByte; g = t; b = p; break;
            case 1: r = q; g = vByte; b = p; break;
            case 2: r = p; g = vByte; b = t; break;
            case 3: r = p; g = q; b = vByte; break;
            case 4: r = t; g = p; b = vByte; break;
            default: r = vByte; g = p; b = q; break;
        }
        return argb(alpha, r, g, b);
    }

    private static int round(float x) {
        return (int) Math.floor(x + 0.5f);
    }

    private static final HashMap<String, Integer> COLOR_NAMES = new HashMap<>();

    static {
        COLOR_NAMES.put("black", BLACK);
        COLOR_NAMES.put("darkgray", DKGRAY);
        COLOR_NAMES.put("gray", GRAY);
        COLOR_NAMES.put("lightgray", LTGRAY);
        COLOR_NAMES.put("white", WHITE);
        COLOR_NAMES.put("red", RED);
        COLOR_NAMES.put("green", GREEN);
        COLOR_NAMES.put("blue", BLUE);
        COLOR_NAMES.put("yellow", YELLOW);
        COLOR_NAMES.put("cyan", CYAN);
        COLOR_NAMES.put("magenta", MAGENTA);
        COLOR_NAMES.put("aqua", 0xFF00FFFF);
        COLOR_NAMES.put("fuchsia", 0xFFFF00FF);
        COLOR_NAMES.put("darkgrey", DKGRAY);
        COLOR_NAMES.put("grey", GRAY);
        COLOR_NAMES.put("lightgrey", LTGRAY);
        COLOR_NAMES.put("lime", 0xFF00FF00);
        COLOR_NAMES.put("maroon", 0xFF800000);
        COLOR_NAMES.put("navy", 0xFF000080);
        COLOR_NAMES.put("olive", 0xFF808000);
        COLOR_NAMES.put("purple", 0xFF800080);
        COLOR_NAMES.put("silver", 0xFFC0C0C0);
        COLOR_NAMES.put("teal", 0xFF008080);
    }
}
