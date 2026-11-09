package org.sandbot.sdk.devices;

import org.firstinspires.ftc.robotcore.external.hardware.camera.CameraName;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.CameraControl;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.ExposureControl;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.FocusControl;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.GainControl;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.PtzControl;
import org.firstinspires.ftc.robotcore.external.hardware.camera.controls.WhiteBalanceControl;
import org.sandbot.sim.SimDevice;

import java.util.List;

/**
 * 구성의 웹캠 하나의 시뮬레이터 쪽(spec-4d §1.9·§1.10). SimWebcamName이 만든다. 웹캠 SimDevice의 출력(serialNumber, state,
 * streaming, width, height, aprilTag, family, decimation, fps, exposureMs, gain — 이 순서, package-info 표)을 쓰고, 입력에서
 * 프레임(frameNanos·frameWidth·frameHeight·tags)과 모델을 읽는다. 한 번에 포털 하나만 잡는다(claim), 카메라 제어는 웹캠마다 하나다.
 */
public final class SimCamera {
    private final SimDevice device;
    private Object owner;
    private final SimExposureControl exposure = new SimExposureControl(this);
    private final SimGainControl gain = new SimGainControl(this);
    private final SimFocusControl focus = new SimFocusControl();
    private final SimWhiteBalanceControl whiteBalance = new SimWhiteBalanceControl();
    private final SimPtzControl ptz = new SimPtzControl();

    SimCamera(SimDevice device) {
        this.device = device;
        publishIdle();
    }

    /** 이 이름의 SandBot 웹캠(SandBot 구성의 웹캠이 아니면 null) */
    public static SimCamera of(CameraName name) {
        return name instanceof SimWebcamName ? ((SimWebcamName) name).camera() : null;
    }

    /** 장치(구성) 이름 */
    public String deviceName() {
        return device.name();
    }

    /** 포털이 웹캠을 잡는다. 다른 포털이 잡고 있으면 false(같은 카메라를 두 번 열 수 없다) */
    public synchronized boolean claim(Object portal) {
        if (owner != null && owner != portal) return false;
        owner = portal;
        return true;
    }

    /** 잡은 포털이 놓는다(그 포털이 아니면 아무것도 하지 않는다). 출력은 포털이 없는 상태로 */
    public void release(Object portal) {
        synchronized (this) {
            if (owner != portal) return;
            owner = null;
        }
        publishIdle();
    }

    public synchronized boolean ownedBy(Object portal) {
        return owner == portal;
    }

    /** 렌즈·SDK 보정의 카메라 모델 id(입력 model, 세계가 없으면 null) */
    public String model() {
        return device.inputString("model", null);
    }

    /** 마지막으로 받은 프레임의 시각(입력 frameNanos, 프레임이 없었으면 Long.MIN_VALUE). 태그를 읽지 않는다 */
    public long frameNanos() {
        Object nanos = device.input("frameNanos");
        return nanos instanceof Number ? ((Number) nanos).longValue() : Long.MIN_VALUE;
    }

    /**
     * 마지막으로 받은 프레임(입력 frameNanos·frameWidth·frameHeight·tags, 프레임이 없었으면 null). tags가 없거나 규칙에 맞지
     * 않으면 태그 없는 프레임으로 본다(런타임이 규칙에 맞는 배열만 넣는다).
     */
    public SimCameraFrame frame() {
        Object nanos = device.input("frameNanos");
        if (!(nanos instanceof Number)) return null;
        long frameNanos = ((Number) nanos).longValue();
        int width = (int) device.inputLong("frameWidth", 0);
        int height = (int) device.inputLong("frameHeight", 0);
        Object tags = device.input("tags");
        int[] ids = new int[0];
        double[] corners = new double[0];
        if (tags instanceof List && ((List<?>) tags).size() % 9 == 0) {
            List<?> list = (List<?>) tags;
            int n = list.size() / 9;
            ids = new int[n];
            corners = new double[n * 8];
            for (int i = 0; i < n; i++) {
                ids[i] = ((Number) list.get(i * 9)).intValue();
                for (int k = 0; k < 8; k++) corners[i * 8 + k] = ((Number) list.get(i * 9 + 1 + k)).doubleValue();
            }
        }
        return new SimCameraFrame(frameNanos, width, height, ids, corners);
    }

    /** 카메라 제어(VisionPortal.getCameraControl, EOCV OpenCvWebcam.getControl): 모르는 형식이면 null */
    public <T extends CameraControl> T control(Class<T> type) {
        CameraControl c = null;
        if (type == ExposureControl.class) c = exposure;
        else if (type == GainControl.class) c = gain;
        else if (type == FocusControl.class) c = focus;
        else if (type == WhiteBalanceControl.class) c = whiteBalance;
        else if (type == PtzControl.class) c = ptz;
        return c == null ? null : type.cast(c);
    }

    /** 포털이 지금 상태를 쓴다(잡은 포털만, spec-4d §1.10 출력) */
    public void publish(Object portal, String state, boolean streaming, int width, int height, boolean aprilTag,
            String family, Double decimation, double fps) {
        if (!ownedBy(portal)) return;
        device.output("state", state);
        device.output("streaming", streaming);
        device.output("width", width);
        device.output("height", height);
        device.output("aprilTag", aprilTag);
        device.output("family", family);
        device.output("decimation", decimation);
        device.output("fps", fps);
        publishControls();
    }

    /** 포털이 없는 출력(serialNumber는 SimWebcamName이 먼저 썼다) */
    private void publishIdle() {
        device.output("state", null);
        device.output("streaming", false);
        device.output("width", null);
        device.output("height", null);
        device.output("aprilTag", false);
        device.output("family", null);
        device.output("decimation", null);
        device.output("fps", 0.0);
        publishControls();
    }

    void controlsChanged() {
        publishControls();
    }

    private void publishControls() {
        device.output("exposureMs", exposure.exposureMs());
        device.output("gain", gain.getGain());
    }
}
