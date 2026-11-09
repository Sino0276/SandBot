package org.sandbot.sdk.devices;

import org.firstinspires.ftc.robotcore.internal.camera.calibration.CameraCalibrationIdentity;
import org.firstinspires.ftc.robotcore.internal.camera.calibration.VendorProductCalibrationIdentity;

/**
 * 웹캠 카메라 모델 id(세계 입력 model, src/shared/sim/cameraData.ts의 CameraModelId) → SDK 보정 식별자(USB vid·pid). 값은
 * RobotCore 12.0 AAR의 res/xml/builtinwebcamcalibrations.xml(sha256 43febb0e…5106)에서 옮겼다(spec-4d §1.2·§1.13). 같은 값을 가진
 * 다른 pid(C920 0x08E5, LifeCam 0x0810)는 같은 보정이라 첫 pid만 쓴다. vitest(sidecar/tests/vision.test.ts B13)가 이 표를 TS
 * CAMERA_MODELS와 정규식으로 대조하므로 줄 꼴(model("id", 0xVID, 0xPID))을 바꾸지 않는다.
 */
public final class SandbotCameraModels {
    private SandbotCameraModels() {}

    private static final class Model {
        final String id;
        final int vid;
        final int pid;

        Model(String id, int vid, int pid) {
            this.id = id;
            this.vid = vid;
            this.pid = pid;
        }
    }

    private static Model model(String id, int vid, int pid) {
        return new Model(id, vid, pid);
    }

    // UI 순서(CAMERA_MODEL_IDS). vid: Logitech 0x046D, Microsoft 0x045E(UsbConstants), goBILDA 카메라 XML vid "0xBDA"(= 3034,
    // UsbConstants.VENDOR_ID_AUSDOM과 같은 값)
    private static final Model[] MODELS = {
        model("logitechC920", 0x046D, 0x082D),
        model("logitechC270", 0x046D, 0x0825),
        model("logitechC310", 0x046D, 0x081B),
        model("lifecamHd3000", 0x045E, 0x0779),
        model("gobilda3122", 0x0BDA, 0x5805),
    };

    /** 모델 id의 보정 식별자. 모르는 모델이나 null이면 null(SDK getCalibrationIdentity가 null인 것과 같다) */
    public static CameraCalibrationIdentity identity(String modelId) {
        if (modelId == null) return null;
        for (Model m : MODELS) if (m.id.equals(modelId)) return new VendorProductCalibrationIdentity(m.vid, m.pid);
        return null;
    }
}
