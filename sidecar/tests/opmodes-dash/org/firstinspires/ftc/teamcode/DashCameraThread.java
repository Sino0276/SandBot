package org.firstinspires.ftc.teamcode;

import com.acmerobotics.dashboard.FtcDashboard;
import com.qualcomm.robotcore.eventloop.opmode.LinearOpMode;
import com.qualcomm.robotcore.eventloop.opmode.TeleOp;

import org.firstinspires.ftc.robotcore.external.stream.CameraStreamSource;

/**
 * 라이브러리 L2 시험(FTC Dashboard 대체의 카메라 안내): 다른 스레드가 startCameraStream을 부른다. 다른 Dashboard 호출처럼 error
 * thread로 멈춰야 한다(안내 줄의 순서가 스레드 일정에 달리지 않게).
 */
@TeleOp
public class DashCameraThread extends LinearOpMode {
    @Override
    public void runOpMode() {
        Thread camera = new Thread(() -> FtcDashboard.getInstance().startCameraStream((CameraStreamSource) null, 0),
                "Camera");
        camera.start();
        while (!isStopRequested()) {
            sleep(5);
        }
    }
}
