package org.firstinspires.ftc.teamcode;

import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import org.firstinspires.ftc.robotcore.external.hardware.camera.WebcamName;
import org.firstinspires.ftc.vision.VisionPortal;
import org.firstinspires.ftc.vision.apriltag.AprilTagProcessor;

// 시험 OpMode(vision.test.ts B6): APRILTAG_BUILTIN 풀이기는 묶음 태그를 만나면 실제 OpenCV처럼 CvException을 던지고
// 실행이 멈춘다(spec-4d §1.9). 팀 코드는 루프만 돈다
@TeleOp(name = "VisionSolverStop")
public class VisionSolverStop extends LinearOpMode {
    @Override
    public void runOpMode() {
        AprilTagProcessor tag = new AprilTagProcessor.Builder().build();
        tag.setPoseSolver(AprilTagProcessor.PoseSolver.APRILTAG_BUILTIN);
        new VisionPortal.Builder()
                .setCamera(hardwareMap.get(WebcamName.class, "Webcam 1"))
                .addProcessor(tag)
                .build();
        waitForStart();
        while (opModeIsActive()) {
            sleep(20);
        }
    }
}
