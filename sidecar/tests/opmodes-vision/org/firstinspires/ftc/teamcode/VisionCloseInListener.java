package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpMode;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerImpl;
import com.qualcomm.robotcore.eventloop.opmode.OpModeManagerNotifier;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.firstinspires.ftc.robotcore.internal.system.AppUtil;
import org.firstinspires.ftc.vision.VisionPortal;
import org.firstinspires.ftc.vision.apriltag.AprilTagProcessor;

// 시험 OpMode(vision.test.ts): OpMode 수명 리스너(START 때, 사이드카에서는 틱 경계의 일 안)가 아직 열리는 중인 포털을 닫는다.
// 다음 경계를 기다릴 수 없는 자리라 포털은 실제 세마포어처럼 진행 중 전이가 끝날 때까지 시간을 보낸 뒤 닫아야 한다(끝없이 돌지 않음)
@TeleOp(name = "VisionCloseInListener")
public class VisionCloseInListener extends LinearOpMode {
    @Override
    public void runOpMode() {
        final VisionPortal portal = new VisionPortal.Builder()
                .setCamera(hardwareMap.get(WebcamName.class, "Webcam 1"))
                .addProcessor(new AprilTagProcessor.Builder().build())
                .build();
        OpModeManagerImpl.getOpModeManagerOfActivity(AppUtil.getInstance().getActivity())
                .registerListener(new OpModeManagerNotifier.Notifications() {
                    @Override public void onOpModePreInit(OpMode opMode) {}

                    @Override public void onOpModePreStart(OpMode opMode) {
                        portal.close();
                        System.out.println("RESULT listener=" + portal.getCameraState());
                    }

                    @Override public void onOpModePostStop(OpMode opMode) {}
                });
        waitForStart();
        while (opModeIsActive() && portal.getCameraState() != VisionPortal.CameraState.CAMERA_DEVICE_CLOSED) {
            sleep(10);
        }
        System.out.println("RESULT final=" + portal.getCameraState());
    }
}
