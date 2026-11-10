package org.sandbot.sdk.devices;

import android.content.Context;

import com.qualcomm.robotcore.util.SerialNumber;

import org.firstinspires.ftc.robotcore.external.function.Consumer;
import org.firstinspires.ftc.robotcore.external.function.Continuation;
import org.firstinspires.ftc.robotcore.external.hardware.camera.CameraCharacteristics;
import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.firstinspires.ftc.robotcore.internal.system.Deadline;
import org.sandbot.sim.SimDevice;
import org.sandbot.sim.SimUnsupportedException;

/**
 * 구성의 웹캠(Webcam 태그). 실제 WebcamNameImpl처럼 isWebcam·isAttached는 true다. VisionPortal이 SimCamera.of로 이 웹캠의
 * 시뮬레이터 쪽(프레임 입력·출력·카메라 제어, spec-4d §1.9)을 찾는다. 영상은 없다.
 */
final class SimWebcamName implements WebcamName {
    static final String KIND = "webcam";

    private final String serial;
    private final SimCamera camera;

    SimWebcamName(String serial, SimDevice device) {
        this.serial = serial;
        device.output("serialNumber", serial);
        camera = new SimCamera(device);
    }

    SimCamera camera() {
        return camera;
    }

    @Override public SerialNumber getSerialNumber() {
        throw new SimUnsupportedException("org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName#getSerialNumber()");
    }

    @Override public String getUsbDeviceNameIfAttached() {
        return "/dev/bus/usb/sandbot/" + serial;
    }

    @Override public boolean isAttached() {
        return true;
    }

    @Override public boolean isWebcam() {
        return true;
    }

    @Override public boolean isCameraDirection() {
        return false;
    }

    @Override public boolean isSwitchable() {
        return false;
    }

    @Override public boolean isUnknown() {
        return false;
    }

    @Override public void asyncRequestCameraPermission(Context context, Deadline deadline, Continuation<? extends Consumer<Boolean>> continuation) {
        throw new SimUnsupportedException("org.firstinspires.ftc.robotcore.external.hardware.camera.CameraName#asyncRequestCameraPermission(android.content.Context,org.firstinspires.ftc.robotcore.internal.system.Deadline,org.firstinspires.ftc.robotcore.external.function.Continuation)");
    }

    @Override public boolean requestCameraPermission(Deadline deadline) {
        return true;
    }

    @Override public CameraCharacteristics getCameraCharacteristics() {
        throw new SimUnsupportedException("org.firstinspires.ftc.robotcore.external.hardware.camera.CameraName#getCameraCharacteristics()");
    }

    @Override public Manufacturer getManufacturer() {
        return Manufacturer.Unknown;
    }

    @Override public String getDeviceName() {
        return "Webcam";
    }

    @Override public String getConnectionInfo() {
        return "USB (" + serial + ")";
    }

    @Override public int getVersion() {
        return 1;
    }

    @Override public void resetDeviceConfigurationForOpMode() {
    }

    @Override public void close() {
    }

    @Override public String toString() {
        return "Webcam(" + serial + ")";
    }
}
