package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.firstinspires.ftc.vision.VisionPortal;
import org.firstinspires.ftc.vision.apriltag.AprilTagDetection;
import org.firstinspires.ftc.vision.apriltag.AprilTagProcessor;

import java.util.List;

// 시험 OpMode(vision.test.ts): 팀 보정 파일을 읽는 포털(열 때 보정을 찾는다). 버린 보정 안내가 나와도 실행은 계속되고 검출이 온다
@TeleOp(name = "VisionTeamCalibration")
public class VisionTeamCalibration extends LinearOpMode {
    @Override
    public void runOpMode() {
        AprilTagProcessor tag = new AprilTagProcessor.Builder().build();
        new VisionPortal.Builder()
                .setCamera(hardwareMap.get(WebcamName.class, "Webcam 1"))
                .addProcessor(tag)
                .build();
        waitForStart();
        boolean reported = false;
        while (opModeIsActive()) {
            List<AprilTagDetection> fresh = tag.getFreshDetections();
            if (!reported && fresh != null && !fresh.isEmpty()) {
                reported = true;
                System.out.println("RESULT detections=" + fresh.size());
            }
            sleep(20);
        }
    }
}
