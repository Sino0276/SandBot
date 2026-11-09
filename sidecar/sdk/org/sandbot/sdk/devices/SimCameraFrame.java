package org.sandbot.sdk.devices;

/**
 * 시뮬레이터가 보낸 웹캠 프레임 하나(불변, spec-4d §1.8): 캡처 시각(틱 경계 ns), 해상도, 보이는 태그의 원시 검출(id 오름차순,
 * 꼭짓점 넷은 apriltag 순서의 apriltag 3 픽셀 좌표 = OpenCV 좌표 + 0.5). 영상은 없다.
 */
public final class SimCameraFrame {
    public final long frameNanos;
    public final int width;
    public final int height;
    private final int[] ids;
    private final double[] corners;

    SimCameraFrame(long frameNanos, int width, int height, int[] ids, double[] corners) {
        this.frameNanos = frameNanos;
        this.width = width;
        this.height = height;
        this.ids = ids;
        this.corners = corners;
    }

    /** 시험·다리용: 손으로 만든 프레임(ids.length × 8 꼭짓점 좌표) */
    public static SimCameraFrame of(long frameNanos, int width, int height, int[] ids, double[] corners) {
        if (corners.length != ids.length * 8) throw new IllegalArgumentException("corners must hold 8 values per tag");
        return new SimCameraFrame(frameNanos, width, height, ids.clone(), corners.clone());
    }

    /** 태그 수 */
    public int tagCount() {
        return ids.length;
    }

    public int id(int tag) {
        return ids[tag];
    }

    /** 태그 tag의 꼭짓점 k(0–3)의 x 또는 y(axis 0·1), px */
    public double corner(int tag, int k, int axis) {
        return corners[tag * 8 + k * 2 + axis];
    }
}
