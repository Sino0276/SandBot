package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.firstinspires.ftc.vision.VisionPortal;
import org.firstinspires.ftc.vision.apriltag.AprilTagProcessor;

import java.util.Locale;

// 시험 OpMode(visionSim.test.ts I5): RobotAutoDriveToAprilTagOmni처럼 setDecimation(2)로 시작하고, 데시메이션 2·1·3을 4초씩
// 두며 각 구간 끝의 getFps()를 쓰고 끝난다
// (구간 4초는 MovingStatistics 30개가 앞 구간의 간격을 모두 밀어낼 만큼: 데시메이션 1의 약 10 FPS에서도 40개)
@TeleOp(name = "VisionDecimationFps")
public class VisionDecimationFps extends LinearOpMode {
    @Override
    public void runOpMode() {
        AprilTagProcessor tag = new AprilTagProcessor.Builder().build();
        tag.setDecimation(2);
        VisionPortal portal = new VisionPortal.Builder()
                .setCamera(hardwareMap.get(WebcamName.class, "Webcam 1"))
                .addProcessor(tag)
                .build();
        waitForStart();
        while (opModeIsActive() && portal.getCameraState() != VisionPortal.CameraState.STREAMING) {
            sleep(20);
        }
        int[] decimations = {2, 1, 3};
        for (int d : decimations) {
            tag.setDecimation(d);
            sleep(4000);
            System.out.println(String.format(Locale.ROOT, "RESULT d=%d fps=%.3f", d, portal.getFps()));
        }
    }
}
