package org.sandbot.sdk.devices;

/**
 * 오도메트리 장치(Pinpoint·OTOS·OctoQuad 로컬라이저)가 보고하는 자세. 시뮬레이터 입력은 "장치가 켜진 뒤 한 번도 재설정하지
 * 않았을 때 보고할 자세(raw)"이고, 장치는 재설정·자세 쓰기를 그 위에 얹는다:
 * 보고 = 마지막으로 정한 자세 ∘ (마지막으로 정할 때의 raw에서 지금 raw까지의 상대 이동). 단위는 장치마다 다르다(호출한 쪽 단위).
 * 직선 이동에는 linearScale, 회전에는 angularScale을 곱한다(OTOS의 스칼라, Pinpoint의 yaw 스칼라).
 */
final class SimTrackedPose {
    private double setX, setY, setH;
    private double baseX, baseY, baseH;
    double linearScale = 1;
    double angularScale = 1;

    /** 지금 raw(x, y, h)에서 보고할 자세 [x, y, h] */
    double[] reported(double rawX, double rawY, double rawH) {
        double dx = rawX - baseX;
        double dy = rawY - baseY;
        double cos = Math.cos(-baseH);
        double sin = Math.sin(-baseH);
        double localX = (cos * dx - sin * dy) * linearScale;
        double localY = (sin * dx + cos * dy) * linearScale;
        cos = Math.cos(setH);
        sin = Math.sin(setH);
        return new double[] {
            setX + cos * localX - sin * localY,
            setY + sin * localX + cos * localY,
            setH + (rawH - baseH) * angularScale
        };
    }

    /** raw 틀의 벡터(속도 등)를 보고 틀로 돌린다 */
    double[] rotate(double vx, double vy) {
        double a = setH - baseH;
        return new double[] {Math.cos(a) * vx - Math.sin(a) * vy, Math.sin(a) * vx + Math.cos(a) * vy};
    }

    /** 지금 자세를 (x, y, h)로 정한다(재설정이면 0, 0, 0) */
    void set(double rawX, double rawY, double rawH, double x, double y, double h) {
        setX = x;
        setY = y;
        setH = h;
        baseX = rawX;
        baseY = rawY;
        baseH = rawH;
    }
}
